import { requireAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"
import { STATUS_SQL } from "@/lib/rent"
import type { DashboardData } from "@/lib/types"

export const runtime = "nodejs"

export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  const pool = getPool()

  const [occupancy, month, overdue, expiring, maint] = await Promise.all([
    pool.query(
      `SELECT COUNT(u.id)::int AS units,
              COUNT(l.id)::int AS occupied
       FROM units u
       LEFT JOIN leases l ON l.unit_id = u.id AND l.ended = false
            AND CURRENT_DATE BETWEEN l.start_date AND l.end_date`,
    ),
    pool.query(
      `SELECT COALESCE(SUM(i.amount_cents + i.late_fee_cents), 0)::bigint AS billed,
              COALESCE(SUM(LEAST(COALESCE(paid.total, 0), i.amount_cents + i.late_fee_cents)), 0)::bigint AS collected
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_cents) AS total FROM payments p WHERE p.invoice_id = i.id
       ) paid ON true
       WHERE i.period = date_trunc('month', CURRENT_DATE)::date`,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS overdue_count,
              COALESCE(SUM(i.amount_cents + i.late_fee_cents - COALESCE(paid.total, 0)), 0)::bigint AS overdue_total
       FROM invoices i
       LEFT JOIN LATERAL (
         SELECT SUM(p.amount_cents) AS total FROM payments p WHERE p.invoice_id = i.id
       ) paid ON true
       WHERE (${STATUS_SQL}) = 'overdue'`,
    ),
    pool.query(
      `SELECT l.id, un.label AS unit_label, pr.name AS property_name, t.name AS tenant_name, t.email AS tenant_email,
              l.start_date, l.end_date, l.monthly_rent_cents, l.deposit_cents,
              (l.end_date - CURRENT_DATE)::int AS days_to_expiry
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties pr ON pr.id = un.property_id
       JOIN tenants t ON t.id = l.tenant_id
       WHERE l.ended = false AND l.end_date >= CURRENT_DATE
         AND l.end_date <= CURRENT_DATE + 60
       ORDER BY l.end_date`,
    ),
    pool.query(
      `SELECT priority, COUNT(*)::int AS item_count
       FROM maintenance_requests WHERE status != 'resolved'
       GROUP BY priority`,
    ),
  ])

  const units = occupancy.rows[0].units
  const occupied = occupancy.rows[0].occupied
  const data: DashboardData = {
    units,
    occupied,
    occupancyPct: units > 0 ? Math.round((occupied / units) * 100) : 0,
    billedThisMonthCents: Number(month.rows[0].billed),
    collectedThisMonthCents: Number(month.rows[0].collected),
    overdueCents: Number(overdue.rows[0].overdue_total),
    overdueCount: overdue.rows[0].overdue_count,
    expiringLeases: expiring.rows.map((r) => ({
      id: r.id,
      unitLabel: r.unit_label,
      propertyName: r.property_name,
      tenantName: r.tenant_name,
      tenantEmail: r.tenant_email,
      startDate: r.start_date,
      endDate: r.end_date,
      monthlyRentCents: r.monthly_rent_cents,
      depositCents: r.deposit_cents,
      status: "expiring_soon",
      daysToExpiry: r.days_to_expiry,
    })),
    openMaintenance: maint.rows.map((r) => ({ priority: r.priority, count: r.item_count })),
  }
  return Response.json(data)
}
