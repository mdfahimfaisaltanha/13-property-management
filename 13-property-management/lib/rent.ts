import { GRACE_DAYS, LATE_FEE_CENTS, getPool } from "@/lib/db"

/**
 * Rent engine: idempotent monthly invoice generation, mid-month proration,
 * one-time late fees, and derived invoice status.
 *
 * Design notes (README § "Rent engine"):
 * - Invoices are UNIQUE(lease_id, period) — generation can run any number of
 *   times (button, cron) without duplicating a month. `ON CONFLICT DO NOTHING`
 *   makes it a no-op for already-billed months.
 * - First month is prorated by days actually leased: rent × daysLeft/daysInMonth
 *   (rounded to a cent). Same for the final month if the lease ends mid-month.
 * - A flat late fee is applied AT MOST ONCE, when an unpaid invoice passes
 *   due date + grace days (guarded by `late_fee_cents = 0`).
 * - Status is always derived from payments, never trusted from a column:
 *   paid | partial | overdue | pending.
 */

export function prorate(
  monthlyRentCents: number,
  year: number,
  month: number, // 1-12
  leaseStart: Date,
  leaseEnd: Date,
): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthFirst = Date.UTC(year, month - 1, 1)
  const monthLast = Date.UTC(year, month - 1, daysInMonth)
  const from = Math.max(monthFirst, Date.UTC(leaseStart.getUTCFullYear(), leaseStart.getUTCMonth(), leaseStart.getUTCDate()))
  const to = Math.min(monthLast, Date.UTC(leaseEnd.getUTCFullYear(), leaseEnd.getUTCMonth(), leaseEnd.getUTCDate()))
  if (to < from) return 0
  const daysLeased = Math.round((to - from) / 86_400_000) + 1
  if (daysLeased >= daysInMonth) return monthlyRentCents
  return Math.round((monthlyRentCents * daysLeased) / daysInMonth)
}

/**
 * Generate invoices for a given period (YYYY-MM) for every lease active in
 * that month. Idempotent. Returns how many new invoices were created.
 */
export async function generateInvoices(year: number, month: number): Promise<number> {
  const pool = getPool()
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`

  const leases = await pool.query(
    `SELECT id, start_date, end_date, monthly_rent_cents
     FROM leases
     WHERE ended = false
       AND start_date <= (DATE($1) + INTERVAL '1 month' - INTERVAL '1 day')::date
       AND end_date >= DATE($1)`,
    [periodStart],
  )

  let created = 0
  for (const lease of leases.rows) {
    const amount = prorate(
      lease.monthly_rent_cents,
      year,
      month,
      new Date(lease.start_date),
      new Date(lease.end_date),
    )
    if (amount <= 0) continue
    // Due on the 1st of the period (or the lease start, if it begins mid-month).
    const dueDate = new Date(lease.start_date) > new Date(periodStart) ? lease.start_date : periodStart
    const res = await pool.query(
      `INSERT INTO invoices (lease_id, period, amount_cents, due_date)
       VALUES ($1, DATE($2), $3, DATE($4))
       ON CONFLICT (lease_id, period) DO NOTHING`,
      [lease.id, periodStart, amount, dueDate],
    )
    created += res.rowCount ?? 0
  }
  return created
}

/** Apply the one-time flat late fee to unpaid invoices past due + grace. */
export async function applyLateFees(): Promise<number> {
  const res = await getPool().query(
    `UPDATE invoices i SET late_fee_cents = $1
     WHERE i.late_fee_cents = 0
       AND i.due_date + $2::int < CURRENT_DATE
       AND COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)
           < i.amount_cents
     RETURNING i.id`,
    [LATE_FEE_CENTS, GRACE_DAYS],
  )
  return res.rowCount ?? 0
}

/** SQL fragment: derived status for invoice `i` with paid total `paid`. */
export const STATUS_SQL = `
  CASE
    WHEN COALESCE(paid.total, 0) >= i.amount_cents + i.late_fee_cents THEN 'paid'
    WHEN i.due_date + ${GRACE_DAYS} < CURRENT_DATE THEN 'overdue'
    WHEN COALESCE(paid.total, 0) > 0 THEN 'partial'
    ELSE 'pending'
  END
`
