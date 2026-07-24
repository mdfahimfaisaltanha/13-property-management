import { requireAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

const PRIORITIES = ["low", "medium", "high", "emergency"]
const STATUSES = ["open", "in_progress", "resolved"]

/** GET: all requests. POST: create. PATCH { id, status }: advance workflow. */

export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  const res = await getPool().query(
    `SELECT m.id, pr.name AS property_name, un.label AS unit_label, t.name AS tenant_name,
            m.title, m.description, m.priority, m.status, m.created_at, m.updated_at
     FROM maintenance_requests m
     JOIN units un ON un.id = m.unit_id
     JOIN properties pr ON pr.id = un.property_id
     LEFT JOIN tenants t ON t.id = m.tenant_id
     ORDER BY (m.status = 'resolved'),
              array_position(ARRAY['emergency','high','medium','low'], m.priority),
              m.created_at DESC`,
  )
  return Response.json({
    requests: res.rows.map((r) => ({
      id: r.id,
      propertyName: r.property_name,
      unitLabel: r.unit_label,
      tenantName: r.tenant_name,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  })
}

export async function POST(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    unitId?: number
    title?: string
    description?: string
    priority?: string
  }
  if (!Number.isInteger(body.unitId) || !body.title?.trim()) {
    return Response.json({ error: "unitId and title are required." }, { status: 400 })
  }
  const priority = PRIORITIES.includes(body.priority ?? "") ? body.priority : "medium"

  // Attach the unit's current tenant automatically, if any.
  const res = await getPool().query(
    `INSERT INTO maintenance_requests (unit_id, tenant_id, title, description, priority)
     VALUES (
       $1,
       (SELECT l.tenant_id FROM leases l WHERE l.unit_id = $1 AND l.ended = false
          AND CURRENT_DATE BETWEEN l.start_date AND l.end_date LIMIT 1),
       $2, $3, $4
     ) RETURNING id`,
    [body.unitId, body.title.trim(), body.description?.trim() ?? "", priority],
  )
  return Response.json({ ok: true, id: res.rows[0].id })
}

export async function PATCH(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as { id?: number; status?: string }
  if (!Number.isInteger(body.id) || !STATUSES.includes(body.status ?? "")) {
    return Response.json({ error: "Pass { id, status } with status open | in_progress | resolved." }, { status: 400 })
  }
  await getPool().query(
    `UPDATE maintenance_requests SET status = $2, updated_at = now() WHERE id = $1`,
    [body.id, body.status],
  )
  return Response.json({ ok: true })
}
