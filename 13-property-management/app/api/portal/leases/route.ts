import { requireAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/**
 * GET: all leases with derived status.
 * POST: create a lease (tenant created inline if new). Rejects overlapping
 *       leases on the same unit — the core data-integrity rule.
 * PATCH: end a lease early ({ id }).
 */

export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  const res = await getPool().query(
    `SELECT l.id, un.label AS unit_label, pr.name AS property_name,
            t.name AS tenant_name, t.email AS tenant_email,
            l.start_date, l.end_date, l.monthly_rent_cents, l.deposit_cents, l.ended,
            (l.end_date - CURRENT_DATE)::int AS days_to_expiry
     FROM leases l
     JOIN units un ON un.id = l.unit_id
     JOIN properties pr ON pr.id = un.property_id
     JOIN tenants t ON t.id = l.tenant_id
     ORDER BY l.end_date DESC`,
  )
  return Response.json({
    leases: res.rows.map((r) => {
      let status = "active"
      if (r.ended) status = "ended"
      else if (r.days_to_expiry < 0) status = "expired"
      else if (r.days_to_expiry <= 60) status = "expiring_soon"
      return {
        id: r.id,
        unitLabel: r.unit_label,
        propertyName: r.property_name,
        tenantName: r.tenant_name,
        tenantEmail: r.tenant_email,
        startDate: r.start_date,
        endDate: r.end_date,
        monthlyRentCents: r.monthly_rent_cents,
        depositCents: r.deposit_cents,
        status,
        daysToExpiry: r.days_to_expiry,
      }
    }),
  })
}

export async function POST(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    unitId?: number
    tenantName?: string
    tenantEmail?: string
    startDate?: string
    endDate?: string
    monthlyRent?: number
    deposit?: number
  }

  const { unitId, tenantName, tenantEmail, startDate, endDate } = body
  if (!Number.isInteger(unitId) || !tenantName?.trim() || !tenantEmail?.trim() || !startDate || !endDate) {
    return Response.json(
      { error: "unitId, tenantName, tenantEmail, startDate, and endDate are required." },
      { status: 400 },
    )
  }
  if (!(Number(body.monthlyRent) > 0)) {
    return Response.json({ error: "monthlyRent must be positive." }, { status: 400 })
  }
  if (new Date(endDate) <= new Date(startDate)) {
    return Response.json({ error: "endDate must be after startDate." }, { status: 400 })
  }

  const pool = getPool()

  // Data-integrity rule: one active lease per unit per date range.
  const overlap = await pool.query(
    `SELECT l.id, t.name FROM leases l JOIN tenants t ON t.id = l.tenant_id
     WHERE l.unit_id = $1 AND l.ended = false
       AND l.start_date <= DATE($3) AND l.end_date >= DATE($2)`,
    [unitId, startDate, endDate],
  )
  if (overlap.rows.length > 0) {
    return Response.json(
      { error: `This unit already has an overlapping lease (${overlap.rows[0].name}). End it first or adjust dates.` },
      { status: 409 },
    )
  }

  // Find-or-create the tenant by email.
  const tenant = await pool.query(
    `INSERT INTO tenants (name, email) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantName.trim(), tenantEmail.trim().toLowerCase()],
  )

  const res = await pool.query(
    `INSERT INTO leases (unit_id, tenant_id, start_date, end_date, monthly_rent_cents, deposit_cents)
     VALUES ($1, $2, DATE($3), DATE($4), $5, $6) RETURNING id`,
    [
      unitId,
      tenant.rows[0].id,
      startDate,
      endDate,
      Math.round(Number(body.monthlyRent) * 100),
      Math.round(Number(body.deposit ?? 0) * 100),
    ],
  )
  return Response.json({ ok: true, id: res.rows[0].id })
}

export async function PATCH(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as { id?: number }
  if (!Number.isInteger(body.id)) {
    return Response.json({ error: "Pass { id } of the lease to end." }, { status: 400 })
  }
  await getPool().query(
    `UPDATE leases SET ended = true, end_date = LEAST(end_date, CURRENT_DATE) WHERE id = $1`,
    [body.id],
  )
  return Response.json({ ok: true })
}
