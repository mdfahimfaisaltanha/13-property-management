import { requireAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/** GET: all units with occupancy. POST: add a property or a unit. */

export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  const res = await getPool().query(
    `SELECT u.id, u.property_id, pr.name AS property_name, u.label, u.bedrooms, u.market_rent_cents,
            t.name AS occupied_by
     FROM units u
     JOIN properties pr ON pr.id = u.property_id
     LEFT JOIN leases l ON l.unit_id = u.id AND l.ended = false
          AND CURRENT_DATE BETWEEN l.start_date AND l.end_date
     LEFT JOIN tenants t ON t.id = l.tenant_id
     ORDER BY pr.name, u.label`,
  )
  const props = await getPool().query(`SELECT id, name, address FROM properties ORDER BY name`)
  return Response.json({
    properties: props.rows,
    units: res.rows.map((r) => ({
      id: r.id,
      propertyId: r.property_id,
      propertyName: r.property_name,
      label: r.label,
      bedrooms: r.bedrooms,
      marketRentCents: r.market_rent_cents,
      occupiedBy: r.occupied_by,
    })),
  })
}

export async function POST(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    kind?: "property" | "unit"
    name?: string
    address?: string
    propertyId?: number
    label?: string
    bedrooms?: number
    marketRent?: number
  }

  if (body.kind === "property") {
    if (!body.name?.trim() || !body.address?.trim()) {
      return Response.json({ error: "Property name and address are required." }, { status: 400 })
    }
    const res = await getPool().query(
      `INSERT INTO properties (name, address) VALUES ($1, $2) RETURNING id`,
      [body.name.trim(), body.address.trim()],
    )
    return Response.json({ ok: true, id: res.rows[0].id })
  }

  if (body.kind === "unit") {
    if (!Number.isInteger(body.propertyId) || !body.label?.trim() || !(Number(body.marketRent) > 0)) {
      return Response.json({ error: "propertyId, label, and a positive marketRent are required." }, { status: 400 })
    }
    const res = await getPool().query(
      `INSERT INTO units (property_id, label, bedrooms, market_rent_cents) VALUES ($1, $2, $3, $4) RETURNING id`,
      [body.propertyId, body.label.trim(), body.bedrooms ?? 1, Math.round(Number(body.marketRent) * 100)],
    )
    return Response.json({ ok: true, id: res.rows[0].id })
  }

  return Response.json({ error: "Pass kind: \"property\" or \"unit\"." }, { status: 400 })
}
