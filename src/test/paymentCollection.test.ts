import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  collectAgainstPayment,
  outstandingPayments,
  planCollection,
  remainingOf,
  type Payment,
} from '../lib/paymentCollection';

/**
 * B3 - collecting money against a payment that already exists.
 *
 * The JavaFX secretary app had a partial collection and a quick payment, and both *updated*
 * the outstanding payment through `PUT /api/payments/{id}` with an over-collection guard.
 * The Tauri port had neither: collection always POSTed a new payment, so paying 400 and then
 * 600 against a 1,000 bill produced two payment rows. The sum balanced, which is why it went
 * unnoticed, but the audit trail no longer matched the bill and the guard was gone.
 *
 * The rule is a pure function so the arithmetic and the refusal cases are asserted directly;
 * the request shape is asserted separately, because dropping `appointmentId` from an update
 * would silently detach a payment from the visit that justified it.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api', () => ({ api }));

beforeEach(() => {
  api.post.mockReset();
  api.put.mockReset();
  api.put.mockResolvedValue({ data: { id: 5, paidAmount: 400, remainingAmount: 600 } });
});

const bill: Payment = {
  id: 5,
  patientId: 7,
  appointmentId: 42,
  totalAmount: 1000,
  paidAmount: 0,
  remainingAmount: 1000,
};

describe('remaining balance', () => {
  it('prefers the explicit remainingAmount', () => {
    expect(remainingOf(bill)).toBe(1000);
  });

  it('derives from total minus paid when remainingAmount is absent', () => {
    expect(remainingOf({ totalAmount: 500, paidAmount: 200 })).toBe(300);
  });

  it('is zero for a missing or malformed payment', () => {
    expect(remainingOf(null)).toBe(0);
    expect(remainingOf({})).toBe(0);
  });
});

describe('partial collection', () => {
  it('adds the amount to what is already paid', () => {
    const plan = planCollection(bill, 400);
    expect(plan.ok).toBe(true);
    expect(plan.paidAmount).toBe(400);
  });

  it('subtracts the amount from the remaining balance', () => {
    expect(planCollection(bill, 400).remainingAmount).toBe(600);
  });

  it('accumulates across successive partial collections', () => {
    // 400 then 600 against a 1,000 bill must land on the same totals as paying 1,000 once.
    const first = planCollection(bill, 400);
    const second = planCollection(
      { ...bill, paidAmount: first.paidAmount, remainingAmount: first.remainingAmount },
      600
    );
    expect(second).toMatchObject({ ok: true, paidAmount: 1000, remainingAmount: 0 });
  });

  it('is anchored to the payment, not to the form', () => {
    // The legacy bug was validating the typed amount against the form's own total, so an
    // outstanding ledger was never the thing being checked.
    const partPaid = { ...bill, paidAmount: 900, remainingAmount: 100 };
    expect(planCollection(partPaid, 100).ok).toBe(true);
    expect(planCollection(partPaid, 101).ok).toBe(false);
  });
});

describe('full / remaining collection', () => {
  it('settles the payment exactly', () => {
    const plan = planCollection(bill, 1000);
    expect(plan).toMatchObject({ ok: true, paidAmount: 1000, remainingAmount: 0 });
  });

  it('accepts the exact remaining balance', () => {
    const partPaid = { ...bill, paidAmount: 400, remainingAmount: 600 };
    expect(planCollection(partPaid, 600).ok).toBe(true);
  });

  it('never writes a negative balance', () => {
    // The over-collection guard has a 0.005 tolerance, so an amount a few mills over the
    // exact balance is accepted. Without the clamp that writes a small negative remaining,
    // which then reads as "settled" on one screen and as owing money on another.
    const exact = { ...bill, totalAmount: 100, paidAmount: 0, remainingAmount: 100 };
    const plan = planCollection(exact, 100.004);
    expect(plan.ok).toBe(true);
    expect(plan.remainingAmount).toBe(0);
  });

  it('clamps rather than trusting decimal subtraction', () => {
    const awkward = { ...bill, totalAmount: 0.3, paidAmount: 0, remainingAmount: 0.30000000000000004 };
    const plan = planCollection(awkward, 0.3);
    expect(plan.remainingAmount).toBeGreaterThanOrEqual(0);
  });
});

describe('over-collection is refused', () => {
  it('rejects more than the remaining balance', () => {
    const plan = planCollection(bill, 1000.01);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('exceeds-remaining');
    expect(plan.remaining).toBe(1000);
  });

  it('rejects a large over-collection and reports the balance', () => {
    const plan = planCollection(bill, 5000);
    expect(plan.reason).toBe('exceeds-remaining');
    expect(plan.remaining).toBe(1000);
  });

  it('tolerates a sub-cent remainder instead of refusing an exact settlement', () => {
    const awkward = { ...bill, totalAmount: 100, paidAmount: 33.33, remainingAmount: 66.67 };
    expect(planCollection(awkward, 66.67).ok).toBe(true);
  });

  it('rejects a zero or negative amount', () => {
    expect(planCollection(bill, 0)).toMatchObject({ ok: false, reason: 'invalid-amount' });
    expect(planCollection(bill, -10)).toMatchObject({ ok: false, reason: 'invalid-amount' });
  });

  it('rejects a non-numeric amount', () => {
    expect(planCollection(bill, NaN)).toMatchObject({ ok: false, reason: 'invalid-amount' });
  });

  it('rejects when there is no payment to collect against', () => {
    expect(planCollection(null, 100)).toMatchObject({ ok: false, reason: 'no-payment' });
  });

  it('rejects a payment that is already settled', () => {
    const settled = { ...bill, paidAmount: 1000, remainingAmount: 0 };
    expect(planCollection(settled, 10)).toMatchObject({ ok: false, reason: 'not-outstanding' });
  });
});

describe('the request updates the existing payment', () => {
  it('uses PUT on the payment id, never a create', async () => {
    const result = await collectAgainstPayment(bill, 400, 'CARD');

    expect(result.ok).toBe(true);
    expect(api.put).toHaveBeenCalledWith('/api/payments/5', {
      paidAmount: 400,
      remainingAmount: 600,
      paymentMethod: 'CARD',
    });
    // The regression this closes: a second payment record for the same bill.
    expect(api.post).not.toHaveBeenCalled();
  });

  it('preserves appointmentId by never sending it', async () => {
    // The server keeps the fields it is not given, so sending only the mutable pair leaves
    // the payment attached to the appointment that justified it. Sending a full body built
    // from a partial read would be how that link gets lost.
    await collectAgainstPayment(bill, 400);
    const body = api.put.mock.calls[0][1];
    expect(body).not.toHaveProperty('appointmentId');
    expect(body).not.toHaveProperty('patientId');
    expect(Object.keys(body).sort()).toEqual(['paidAmount', 'remainingAmount']);
  });

  it('omits paymentMethod when none is chosen, so the stored method is kept', async () => {
    await collectAgainstPayment(bill, 400);
    expect(api.put.mock.calls[0][1]).not.toHaveProperty('paymentMethod');
  });

  it('settles the full remaining balance in one call', async () => {
    await collectAgainstPayment(bill, 1000);
    expect(api.put).toHaveBeenCalledWith('/api/payments/5', {
      paidAmount: 1000,
      remainingAmount: 0,
    });
  });

  it('makes no request when the amount is refused', async () => {
    const result = await collectAgainstPayment(bill, 5000);
    expect(result).toMatchObject({ ok: false, reason: 'exceeds-remaining', remaining: 1000 });
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('returns the server payment on success', async () => {
    const result = await collectAgainstPayment(bill, 400);
    expect(result.payment).toEqual({ id: 5, paidAmount: 400, remainingAmount: 600 });
  });
});

describe('choosing a collection target', () => {
  const list: Payment[] = [
    { id: 1, totalAmount: 100, paidAmount: 100, remainingAmount: 0 },
    { id: 2, totalAmount: 500, paidAmount: 100, remainingAmount: 400 },
    { id: 3, totalAmount: 200, paidAmount: 0, remainingAmount: 200 },
  ];

  it('lists only the payments that still owe money', () => {
    expect(outstandingPayments(list).map((p) => p.id)).toEqual([2, 3]);
  });

  it('treats a settled payment as not collectable', () => {
    expect(outstandingPayments([list[0]])).toEqual([]);
  });

  it('handles a missing list', () => {
    expect(outstandingPayments(null)).toEqual([]);
    expect(outstandingPayments(undefined)).toEqual([]);
  });
});
