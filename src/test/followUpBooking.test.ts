import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addDays,
  completeVisit,
  createAppointment,
  followUpPlan,
  FOLLOW_UP_CATEGORY,
  FOLLOW_UP_OFFSET_DAYS,
  FOLLOW_UP_TIME_ZONE,
} from '../lib/clinicalActions';

/**
 * B2 - the follow-up appointment booked when an examination is completed.
 *
 * The JavaFX doctor app closed a visit in one action: completing an EXAMINATION booked the
 * return visit automatically, fourteen days out, in the morning, as a FOLLOW_UP, carrying
 * the amount the doctor typed, and stamped the patient's followUpDate. That behaviour was
 * lost in the Tauri port, which reduced the completion dialog to a diagnosis and a note.
 *
 * The rules are pure so they can be asserted directly. The orchestration is asserted against
 * a mocked API so the ordering and the failure handling are visible too.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api', () => ({ api }));

const TODAY = '2026-03-10';

beforeEach(() => {
  api.post.mockReset();
  api.put.mockReset();
  api.post.mockResolvedValue({ data: { id: 1 } });
  api.put.mockResolvedValue({ data: {} });
});

const exam = { id: 42, category: 'EXAMINATION', patientId: 7 };

describe('follow-up booking rules', () => {
  it('books a follow-up 14 days out for an examination', () => {
    const plan = followUpPlan({ appointment: exam, patientId: 7, today: TODAY });
    expect(plan?.date).toBe('2026-03-24');
    expect(FOLLOW_UP_OFFSET_DAYS).toBe(14);
  });

  it('uses the MORNING zone', () => {
    const plan = followUpPlan({ appointment: exam, patientId: 7, today: TODAY });
    expect(plan?.timeZone).toBe('MORNING');
    expect(FOLLOW_UP_TIME_ZONE).toBe('MORNING');
  });

  it('marks the follow-up as FOLLOW_UP and SCHEDULED', () => {
    const plan = followUpPlan({ appointment: exam, patientId: 7, today: TODAY });
    expect(plan?.category).toBe('FOLLOW_UP');
    expect(plan?.category).toBe(FOLLOW_UP_CATEGORY);
    expect(plan?.status).toBe('SCHEDULED');
  });

  it('preserves the required amount', () => {
    const plan = followUpPlan({ appointment: exam, patientId: 7, today: TODAY, amount: '350' });
    expect(plan?.requiredAmount).toBe(350);
  });

  it('accepts a numeric amount as well as a string from the form', () => {
    const plan = followUpPlan({ appointment: exam, patientId: 7, today: TODAY, amount: 350 });
    expect(plan?.requiredAmount).toBe(350);
  });

  it('omits the amount when the doctor left it blank, rather than sending zero', () => {
    const plan = followUpPlan({ appointment: exam, patientId: 7, today: TODAY, amount: '' });
    expect(plan).not.toHaveProperty('requiredAmount');
  });

  it('omits a zero or negative amount', () => {
    expect(followUpPlan({ appointment: exam, patientId: 7, today: TODAY, amount: 0 })).not.toHaveProperty('requiredAmount');
    expect(followUpPlan({ appointment: exam, patientId: 7, today: TODAY, amount: -5 })).not.toHaveProperty('requiredAmount');
  });

  it('books nothing for a follow-up visit - it is already the return visit', () => {
    const plan = followUpPlan({
      appointment: { id: 9, category: 'FOLLOW_UP', patientId: 7 },
      patientId: 7,
      today: TODAY,
    });
    expect(plan).toBeNull();
  });

  it('books nothing when the appointment has no category', () => {
    expect(followUpPlan({ appointment: { id: 9, patientId: 7 }, patientId: 7, today: TODAY })).toBeNull();
  });

  it('books nothing without a valid patient', () => {
    expect(followUpPlan({ appointment: exam, patientId: 0, today: TODAY })).toBeNull();
  });

  it('references the completed appointment in the notes', () => {
    const plan = followUpPlan({ appointment: exam, patientId: 7, today: TODAY });
    expect(plan?.notes).toBe('Follow-up for appointment #42');
  });

  it('crosses month and year boundaries correctly', () => {
    // A naive `new Date(iso)` would parse this as UTC and can land a day early or late in
    // other zones; the arithmetic is done in UTC and formatted back to ISO.
    expect(addDays('2026-01-31', 14)).toBe('2026-02-14');
    expect(addDays('2026-12-20', 14)).toBe('2027-01-03');
    expect(addDays('2028-02-20', 14)).toBe('2028-03-05'); // leap year
  });
});

describe('completing an examination', () => {
  it('completes the appointment, books the follow-up and sets followUpDate', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (String(url).includes('/complete')) return { data: { id: 42 } };
      return { data: { id: 99, date: '2026-03-24' } };
    });

    const result = await completeVisit({
      appointmentId: 42,
      patientId: 7,
      category: 'EXAMINATION',
      diagnosis: 'Acute sinusitis',
      notes: 'Reviewed in 10 days',
      followUpAmount: '350',
      today: TODAY,
    });

    expect(result.completed).toBe(true);
    expect(result.followUpError).toBeNull();
    expect(result.followUpDateError).toBeNull();
    expect(result.followUp).toMatchObject({ id: 99, date: '2026-03-24' });

    // 1. completion, 2. follow-up booking, 3. followUpDate stamp.
    const calls = [...api.post.mock.calls, ...api.put.mock.calls].map((c) => String(c[0]));
    expect(calls).toEqual([
      '/api/appointments/42/complete',
      '/api/appointments',
      '/api/patients/7',
    ]);
  });

  it('sends the diagnosis and notes on the completion', async () => {
    await completeVisit({
      appointmentId: 42,
      patientId: 7,
      category: 'EXAMINATION',
      diagnosis: '  Acute sinusitis  ',
      notes: '  Reviewed  ',
      today: TODAY,
    });
    expect(api.post.mock.calls[0][1]).toEqual({
      diagnosis: 'Acute sinusitis',
      notes: 'Reviewed',
    });
  });

  it('omits blank diagnosis and notes rather than sending empty strings', async () => {
    await completeVisit({
      appointmentId: 42,
      patientId: 7,
      category: 'EXAMINATION',
      diagnosis: '   ',
      notes: '',
      today: TODAY,
    });
    expect(api.post.mock.calls[0][1]).toEqual({ diagnosis: undefined, notes: undefined });
  });

  it('sets followUpDate to the follow-up date', async () => {
    await completeVisit({
      appointmentId: 42,
      patientId: 7,
      category: 'EXAMINATION',
      today: TODAY,
    });
    expect(api.put).toHaveBeenCalledWith('/api/patients/7', { followUpDate: '2026-03-24' });
  });

  it('books nothing and touches nothing else for a non-examination', async () => {
    const result = await completeVisit({
      appointmentId: 42,
      patientId: 7,
      category: 'FOLLOW_UP',
      today: TODAY,
    });

    expect(result.followUp).toBeNull();
    // Exactly one call: the completion.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('reports a failed follow-up booking without undoing the completion', async () => {
    // A doctor who has finished with the patient must not be blocked because the *next*
    // visit could not be booked. The server also refuses a second active appointment, so
    // this is a normal outcome rather than an error to throw.
    api.post.mockImplementation(async (url: string) => {
      if (String(url).includes('/complete')) return { data: { id: 42 } };
      throw new Error('Patient already has an active appointment on 2026-03-20');
    });

    const result = await completeVisit({
      appointmentId: 42,
      patientId: 7,
      category: 'EXAMINATION',
      today: TODAY,
    });

    expect(result.completed).toBe(true);
    expect(result.followUp).toBeNull();
    expect(result.followUpError).toMatch(/already has an active appointment/);
    // followUpDate is still stamped, and nothing re-completes the appointment.
    expect(api.put).toHaveBeenCalledWith('/api/patients/7', { followUpDate: '2026-03-24' });
    expect(api.post.mock.calls.filter((c) => String(c[0]).includes('/complete'))).toHaveLength(1);
  });

  it('reports a failed followUpDate stamp without losing the booked follow-up', async () => {
    api.put.mockRejectedValue(new Error('Patient not found'));

    const result = await completeVisit({
      appointmentId: 42,
      patientId: 7,
      category: 'EXAMINATION',
      today: TODAY,
    });

    expect(result.followUp).not.toBeNull();
    expect(result.followUpDateError).toMatch(/Patient not found/);
  });

  it('throws when the completion itself fails, so the visit is not reported as done', async () => {
    api.post.mockRejectedValue(new Error('Appointment not found'));

    await expect(
      completeVisit({ appointmentId: 42, patientId: 7, category: 'EXAMINATION', today: TODAY })
    ).rejects.toThrow('Appointment not found');

    // No follow-up attempted for a visit that was never closed.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('one appointment-creation call site', () => {
  it('createAppointment posts the payload unchanged', async () => {
    const payload = { patientId: 7, date: '2026-03-24', timeZone: 'MORNING', category: 'FOLLOW_UP' };
    const res = await createAppointment(payload);
    expect(api.post).toHaveBeenCalledWith('/api/appointments', payload);
    expect(res).toEqual({ id: 1 });
  });
});
