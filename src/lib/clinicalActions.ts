import { api } from './api';

/**
 * Completing an examination, and the follow-up it books.
 *
 * The JavaFX doctor app closed a visit in one action: completing an EXAMINATION
 * automatically created the return visit, fourteen days out, in the MORNING zone, marked
 * FOLLOW_UP, carrying the amount the doctor typed, and stamped the patient's `followUpDate`.
 * The amount field only appeared for examinations, because a follow-up has nothing to
 * charge for.
 *
 * Two things are deliberate here:
 *
 * - **The booking rules are pure functions.** `followUpPlan` decides the date, zone,
 *   category, notes and amount with no I/O, so the business rules can be asserted directly
 *   instead of inferred from a rendered dialog.
 * - **There is one appointment-creation call in the client.** `createAppointment` is the
 *   only place that POSTs to `/api/appointments`, and both the manual booking screen and the
 *   follow-up flow go through it. Two copies would drift, and the follow-up is exactly the
 *   path nobody tests by hand.
 */

/** Days between an examination and its follow-up. Legacy value, preserved. */
export const FOLLOW_UP_OFFSET_DAYS = 14;
/** The follow-up always lands in the morning slot. Legacy value, preserved. */
export const FOLLOW_UP_TIME_ZONE = 'MORNING';
/** Category marking a return visit. */
export const FOLLOW_UP_CATEGORY = 'FOLLOW_UP';
/** The appointment category that triggers an automatic follow-up. */
export const EXAMINATION_CATEGORY = 'EXAMINATION';

/** The single appointment-creation call in the client. */
export async function createAppointment(payload: Record<string, unknown>): Promise<any> {
  const res = await api.post('/api/appointments', payload);
  return res.data;
}

/** Adds whole days to an ISO `YYYY-MM-DD` date, without timezone drift. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface FollowUpPlanInput {
  /** The appointment being completed. */
  appointment: { id?: number; category?: string | null; patientId?: number };
  patientId: number;
  /** Today as `YYYY-MM-DD`; injected so the rule is testable. */
  today: string;
  /** What the doctor typed into the next-appointment amount field. */
  amount?: string | number | null;
}

/**
 * The follow-up appointment to book, or null when none should be booked.
 *
 * Only an EXAMINATION produces one. A follow-up visit, a cancelled appointment, or a
 * missing patient all mean no booking - the legacy app showed the amount field exclusively
 * for examinations and prompted only in that branch.
 */
export function followUpPlan(input: FollowUpPlanInput): Record<string, unknown> | null {
  const { appointment, patientId, today, amount } = input;

  if (!patientId || patientId <= 0) return null;
  if ((appointment.category ?? '') !== EXAMINATION_CATEGORY) return null;

  const parsed = Number(amount);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;

  return {
    patientId,
    date: addDays(today, FOLLOW_UP_OFFSET_DAYS),
    timeZone: FOLLOW_UP_TIME_ZONE,
    category: FOLLOW_UP_CATEGORY,
    status: 'SCHEDULED',
    notes: `Follow-up for appointment #${appointment.id ?? ''}`,
    // Sent only when the doctor actually charged something, matching the legacy payload.
    ...(hasAmount ? { requiredAmount: parsed } : {}),
  };
}

export interface CompleteVisitInput {
  appointmentId: number;
  patientId: number;
  category?: string | null;
  diagnosis?: string;
  notes?: string;
  /** Next-appointment amount. Only meaningful for an examination. */
  followUpAmount?: string | number | null;
  /** Today as `YYYY-MM-DD`; injected for testability. */
  today: string;
}

export interface CompleteVisitResult {
  /** The completion call succeeded. The visit is closed either way. */
  completed: boolean;
  /** The follow-up was booked, or null when none was due. */
  followUp: Record<string, unknown> | null;
  /** Set when the follow-up could not be booked. The completion is not undone. */
  followUpError: string | null;
  /** Set when `followUpDate` could not be stamped on the patient. */
  followUpDateError: string | null;
}

/**
 * Completes an appointment and, for an examination, books its follow-up.
 *
 * Ordering is deliberate: the visit is closed first and is never rolled back. A doctor who
 * has finished with a patient must not be left staring at a failure because the *next* visit
 * could not be booked - the legacy app created the follow-up locally and let the sync carry
 * it, so a failure there was silent rather than blocking.
 *
 * Because of that, failures in the follow-up steps are reported rather than thrown.
 */
export async function completeVisit(input: CompleteVisitInput): Promise<CompleteVisitResult> {
  const { appointmentId, patientId, diagnosis, notes, followUpAmount, today } = input;

  await api.post(`/api/appointments/${appointmentId}/complete`, {
    diagnosis: diagnosis?.trim() || undefined,
    notes: notes?.trim() || undefined,
  });

  const plan = followUpPlan({
    appointment: { id: appointmentId, category: input.category, patientId },
    patientId,
    today,
    amount: followUpAmount,
  });

  // Not an examination: the legacy app booked nothing, and there is no followUpDate to set.
  if (!plan) {
    return { completed: true, followUp: null, followUpError: null, followUpDateError: null };
  }

  const result: CompleteVisitResult = {
    completed: true,
    followUp: null,
    followUpError: null,
    followUpDateError: null,
  };

  try {
    result.followUp = await createAppointment(plan);
  } catch (err: any) {
    // Reported, not thrown. The server also refuses a second active appointment, so a
    // patient who already has one cannot be given a follow-up; that is a normal outcome
    // here rather than an error the doctor has to resolve.
    result.followUpError = err?.message || 'تعذّر حجز موعد المتابعة تلقائياً.';
  }

  try {
    await api.put(`/api/patients/${patientId}`, { followUpDate: plan.date });
  } catch (err: any) {
    result.followUpDateError = err?.message || 'تعذّر تحديث تاريخ المتابعة.';
  }

  return result;
}
