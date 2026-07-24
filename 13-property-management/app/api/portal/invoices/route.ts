import { requireAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"
import { STATUS_SQL, applyLateFees, generateInvoices } from "@/lib/rent"

export const runtime = "nodejs"

/**
 * GET: invoices with derived status + paid totals (late fees auto-applied first).
 * POST { action: "generate" }: idempotently bill the current month.
 * POST { action: "pay", invoiceId, amount, method? }: record a payment.
 */

export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  await applyLateFees() // keep fees current every time the rent tab loads
  const res = await getPool().query(
    `SELECT i.id, i.lease_id, i.period, i.amount_cents, i.late_fee_cents, i.due_date,
            COALESCE(paid.total, 0)::bigint AS paid_cents,
            t.name AS tenant_name, pr.name AS property_name, un.label AS unit_label,
            (${STATUS_SQL}) AS status
     FROM invoices i
     JOIN leases l ON l.id = i.lease_id
     JOIN units un ON un.id = l.unit_id
     JOIN properties pr ON pr.id = un.property_id
     JOIN tenants t ON t.id = l.tenant_id
     LEFT JOIN LATERAL (
       SELECT SUM(p.amount_cents) AS total FROM payments p WHERE p.invoice_id = i.id
     ) paid ON true
     ORDER BY i.period DESC, t.name`,
  )
  return Response.json({
    invoices: res.rows.map((r) => ({
      id: r.id,
      leaseId: r.lease_id,
      tenantName: r.tenant_name,
      propertyName: r.property_name,
      unitLabel: r.unit_label,
      period: r.period,
      amountCents: r.amount_cents,
      lateFeeCents: r.late_fee_cents,
      paidCents: Number(r.paid_cents),
      dueDate: r.due_date,
      status: r.status,
    })),
  })
}

export async function POST(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    action?: "generate" | "pay"
    invoiceId?: number
    amount?: number
    method?: string
  }

  if (body.action === "generate") {
    const now = new Date()
    const created = await generateInvoices(now.getUTCFullYear(), now.getUTCMonth() + 1)
    const fees = await applyLateFees()
    return Response.json({ ok: true, created, lateFeesApplied: fees })
  }

  if (body.action === "pay") {
    if (!Number.isInteger(body.invoiceId) || !(Number(body.amount) > 0)) {
      return Response.json({ error: "invoiceId and a positive amount are required." }, { status: 400 })
    }
    const pool = getPool()
    const inv = await pool.query(
      `SELECT i.amount_cents + i.late_fee_cents AS total_due,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i WHERE i.id = $1`,
      [body.invoiceId],
    )
    if (inv.rows.length === 0) {
      return Response.json({ error: "Invoice not found." }, { status: 404 })
    }
    const amountCents = Math.round(Number(body.amount) * 100)
    const remaining = Number(inv.rows[0].total_due) - Number(inv.rows[0].paid)
    if (remaining <= 0) {
      return Response.json({ error: "This invoice is already fully paid." }, { status: 409 })
    }
    if (amountCents > remaining) {
      return Response.json(
        { error: `Overpayment: $${(remaining / 100).toFixed(2)} remains on this invoice. Record at most that.` },
        { status: 400 },
      )
    }
    await pool.query(
      `INSERT INTO payments (invoice_id, amount_cents, method) VALUES ($1, $2, $3)`,
      [body.invoiceId, amountCents, body.method?.trim() || "manual"],
    )
    return Response.json({ ok: true })
  }

  return Response.json({ error: "Pass action: \"generate\" or \"pay\"." }, { status: 400 })
}
