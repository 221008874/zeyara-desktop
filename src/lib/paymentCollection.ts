import { api } from './api';

/**
 * Collecting money against a payment that already exists.
 *
 * The JavaFX secretary app had two ways to take money and both of them *updated* the
 * outstanding payment rather than creating another one: a partial collection, and a quick
 * payment that always targeted the first unpaid row. Each guarded the amount against that
 * payment's remaining balance.
 *
 * This client had only one way: `POST /api/payments`, always a new record. Someone paying
 * 400 and then 600 against a 1,000 bill ended up with two payment rows. The sum still
 * balanced, so it looked right, but the audit trail no longer matched the bill and the
 * "amount exceeds remaining" guard was gone, because the form was only ever validating
 * against its own fields.
 *
 * `PUT /api/payments/{id}` already exists on the server and the legacy client used it, so
 * this needs no backend change.
 */

/** A payment as the client sees it. */
export interface Payment {
  id: number;
  patientId?: number;
  appointmentId?: number | null;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  paymentMethod?: string;
  [k: string]: unknown;
}

export type CollectionRejection = 'no-payment' | 'not-outstanding' | 'invalid-amount' | 'exceeds-remaining';

export interface CollectionPlan {
  ok: boolean;
  /** The `paidAmount` to write. Present only when `ok`. */
  paidAmount?: number;
  /** The `remainingAmount` to write. Present only when `ok`. */
  remainingAmount?: number;
  /** Why the collection was refused. Present only when `!ok`. */
  reason?: CollectionRejection;
  /** The outstanding balance the caller should show in the error. */
  remaining?: number;
}

/** Outstanding balance, tolerant of a missing or malformed field. */
export function remainingOf(payment: Partial<Payment> | null | undefined): number {
  const explicit = Number(payment?.remainingAmount);
  if (Number.isFinite(explicit)) return explicit;
  const total = Number(payment?.totalAmount ?? 0);
  const paid = Number(payment?.paidAmount ?? 0);
  return Number.isFinite(total) && Number.isFinite(paid) ? total - paid : 0;
}

/**
 * Decides what a collection of `amount` does to `payment`.
 *
 * Pure, and the only place the over-collection rule lives. `amount` must be positive and
 * must not exceed the payment's remaining balance - the same guard the legacy quick-pay
 * enforced, without which a receptionist could collect more than is owed.
 */
export function planCollection(
  payment: Partial<Payment> | null | undefined,
  amount: number
): CollectionPlan {
  if (!payment || !payment.id) return { ok: false, reason: 'no-payment' };

  const remaining = remainingOf(payment);
  if (remaining <= 0) return { ok: false, reason: 'not-outstanding', remaining };

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: 'invalid-amount', remaining };

  // Compared with a tolerance so a remainder like 0.30000000000000004 from repeated
  // decimal arithmetic does not reject a payment that is exactly the balance.
  if (value - remaining > 0.005) return { ok: false, reason: 'exceeds-remaining', remaining };

  const paid = Number(payment.paidAmount ?? 0) + value;
  return { ok: true, paidAmount: paid, remainingAmount: Math.max(0, remaining - value) };
}

export interface CollectResult {
  ok: boolean;
  reason?: CollectionRejection;
  remaining?: number;
  /** The payment as the server returned it. */
  payment?: any;
}

/**
 * Applies a collection to an existing payment.
 *
 * Sends only the mutable fields, exactly as the legacy client did, so the server keeps the
 * rest - crucially `appointmentId` and `patientId`. A full request body here would be a
 * regression: a partial update that dropped the appointment link would detach the payment
 * from the visit that justified it.
 */
export async function collectAgainstPayment(
  payment: Payment,
  amount: number,
  paymentMethod?: string
): Promise<CollectResult> {
  const plan = planCollection(payment, amount);
  if (!plan.ok) {
    return { ok: false, reason: plan.reason, remaining: plan.remaining };
  }

  const res = await api.put(`/api/payments/${payment.id}`, {
    paidAmount: plan.paidAmount,
    remainingAmount: plan.remainingAmount,
    ...(paymentMethod ? { paymentMethod } : {}),
  });

  return { ok: true, payment: res.data };
}

/** Payments that still owe money, oldest first, for offering a collection target. */
export function outstandingPayments(payments: Payment[] | null | undefined): Payment[] {
  if (!Array.isArray(payments)) return [];
  return payments.filter((p) => p && remainingOf(p) > 0);
}
