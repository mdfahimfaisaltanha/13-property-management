import { readFileSync } from "node:fs"
import pg from "pg"

/**
 * One-shot setup: creates tables and seeds a realistic portfolio —
 * 3 properties, 12 units, tenants, leases in every state (active, expiring
 * soon, expired, ended), invoices for the last 3 months with a mix of paid /
 * partial / overdue, and maintenance requests across the workflow.
 *
 *   npm run setup
 *
 * Reads DATABASE_URL from .env.local (or the environment). Safe to re-run:
 * it skips seeding if data already exists.
 */

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    /* no .env.local — rely on the environment */
  }
}

loadEnvLocal()

if (!process.env.DATABASE_URL) {
  console.error("\n❌ DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.\n")
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })

const SCHEMA = `
CREATE TABLE IF NOT EXISTS properties (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  address TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id                SERIAL PRIMARY KEY,
  property_id       INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  bedrooms          INTEGER NOT NULL DEFAULT 1,
  market_rent_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS leases (
  id                 SERIAL PRIMARY KEY,
  unit_id            INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  monthly_rent_cents INTEGER NOT NULL,
  deposit_cents      INTEGER NOT NULL DEFAULT 0,
  ended              BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS invoices (
  id             SERIAL PRIMARY KEY,
  lease_id       INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  period         DATE NOT NULL,
  amount_cents   INTEGER NOT NULL,
  late_fee_cents INTEGER NOT NULL DEFAULT 0,
  due_date       DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lease_id, period)
);

CREATE TABLE IF NOT EXISTS payments (
  id           SERIAL PRIMARY KEY,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL DEFAULT 'manual',
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id          SERIAL PRIMARY KEY,
  unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id   INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'medium',
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

/** date helper: first day of the month `offset` months from now (UTC). */
function monthStart(offset) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
}
function iso(d) {
  return d.toISOString().slice(0, 10)
}
function addDays(d, n) {
  return new Date(d.getTime() + n * 86_400_000)
}

async function main() {
  console.log("⏳ Creating tables…")
  await pool.query(SCHEMA)

  const existing = await pool.query(`SELECT COUNT(*)::int AS item_count FROM properties`)
  if (existing.rows[0].item_count > 0) {
    console.log("ℹ️  Data already exists — skipping seed. (Drop the tables to reseed.)")
    await pool.end()
    return
  }

  console.log("🏗️  Seeding portfolio…")

  const props = await pool.query(
    `INSERT INTO properties (name, address) VALUES
     ('Maple Court', '12 Maple St'),
     ('Harbor View', '88 Bayside Ave'),
     ('Cedar Lofts', '450 Cedar Rd')
     RETURNING id`,
  )
  const [p1, p2, p3] = props.rows.map((r) => r.id)

  const unitDefs = [
    [p1, "1A", 1, 120000], [p1, "1B", 1, 125000], [p1, "2A", 2, 165000], [p1, "2B", 2, 170000],
    [p2, "101", 1, 140000], [p2, "102", 1, 140000], [p2, "201", 2, 190000], [p2, "202", 3, 240000],
    [p3, "L1", 1, 155000], [p3, "L2", 2, 185000], [p3, "L3", 2, 185000], [p3, "L4", 3, 260000],
  ]
  const unitIds = []
  for (const [pid, label, beds, rent] of unitDefs) {
    const r = await pool.query(
      `INSERT INTO units (property_id, label, bedrooms, market_rent_cents) VALUES ($1,$2,$3,$4) RETURNING id`,
      [pid, label, beds, rent],
    )
    unitIds.push(r.rows[0].id)
  }

  const tenantDefs = [
    ["Ayesha Siddiqua", "ayesha@example.com"], ["Omar Farooq", "omar@example.com"],
    ["Nadia Islam", "nadia@example.com"], ["Daniel Chen", "daniel@example.com"],
    ["Sofia Garcia", "sofia@example.com"], ["Liam O'Brien", "liam@example.com"],
    ["Priya Sharma", "priya@example.com"], ["Yusuf Karim", "yusuf@example.com"],
    ["Emma Wilson", "emma@example.com"], ["Tariq Aziz", "tariq@example.com"],
  ]
  const tenantIds = []
  for (const [name, email] of tenantDefs) {
    const r = await pool.query(
      `INSERT INTO tenants (name, email) VALUES ($1,$2) RETURNING id`,
      [name, email],
    )
    tenantIds.push(r.rows[0].id)
  }

  // Leases in every state. 10 of 12 units leased → ~83% occupancy.
  // [unitIdx, tenantIdx, startMonthsAgo, lengthMonths, rentCents, ended]
  const leaseDefs = [
    [0, 0, -10, 12, 120000, false], // active, expiring in 2 months (dashboard)
    [1, 1, -3, 12, 125000, false],  // active
    [2, 2, -8, 12, 165000, false],  // active
    [3, 3, -1, 12, 170000, false],  // active, started recently
    [4, 4, -11, 12, 140000, false], // expiring in ~1 month
    [6, 5, -6, 12, 190000, false],  // active
    [7, 6, -2, 24, 240000, false],  // active, long lease
    [8, 7, -14, 12, 150000, true],  // ended (historical)
    [9, 8, -4, 12, 185000, false],  // active
    [11, 9, -5, 12, 260000, false], // active
  ]
  const leaseIds = []
  for (const [ui, ti, startOff, len, rent, ended] of leaseDefs) {
    const start = monthStart(startOff)
    const end = addDays(monthStart(startOff + len), -1)
    const r = await pool.query(
      `INSERT INTO leases (unit_id, tenant_id, start_date, end_date, monthly_rent_cents, deposit_cents, ended)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, start_date, end_date, monthly_rent_cents, ended`,
      [unitIds[ui], tenantIds[ti], iso(start), iso(end), rent, rent, ended],
    )
    leaseIds.push(r.rows[0])
  }

  // Invoices for the last 3 months for each lease active in that month.
  // Payment mix: months 1-2 back mostly paid, one partial, one unpaid
  // (→ overdue + late fee once the app applies fees); current month pending.
  console.log("🧾 Billing the last 3 months…")
  let invoiceCount = 0
  for (let back = 2; back >= 0; back--) {
    const period = monthStart(-back)
    const periodEnd = addDays(monthStart(-back + 1), -1)
    for (let i = 0; i < leaseIds.length; i++) {
      const lease = leaseIds[i]
      if (new Date(lease.start_date) > periodEnd || new Date(lease.end_date) < period) continue
      if (lease.ended && back === 0) continue
      const inv = await pool.query(
        `INSERT INTO invoices (lease_id, period, amount_cents, due_date)
         VALUES ($1,$2,$3,$2) ON CONFLICT (lease_id, period) DO NOTHING RETURNING id, amount_cents`,
        [lease.id, iso(period), lease.monthly_rent_cents],
      )
      if (inv.rows.length === 0) continue
      invoiceCount++
      const { id: invId, amount_cents } = inv.rows[0]
      if (back === 0) {
        // current month: first two leases already paid, rest pending
        if (i < 2) await pool.query(`INSERT INTO payments (invoice_id, amount_cents, method) VALUES ($1,$2,'bank transfer')`, [invId, amount_cents])
      } else if (i === 4) {
        // Sofia: chronic partial payer → partial/overdue rows
        await pool.query(`INSERT INTO payments (invoice_id, amount_cents, method) VALUES ($1,$2,'cash')`, [invId, Math.round(amount_cents * 0.5)])
      } else if (i === 6 && back === 1) {
        // Priya: skipped last month entirely → overdue + late fee
      } else {
        await pool.query(`INSERT INTO payments (invoice_id, amount_cents, method) VALUES ($1,$2,'bank transfer')`, [invId, amount_cents])
      }
    }
  }

  console.log("🔧 Seeding maintenance requests…")
  const maint = [
    [0, "Kitchen sink leaking", "Steady drip under the basin, cabinet floor is warping.", "high", "open"],
    [2, "AC not cooling", "Blows warm air even at max setting.", "emergency", "in_progress"],
    [4, "Broken window latch", "Bedroom window won't lock.", "medium", "open"],
    [6, "Hallway light flickering", "", "low", "open"],
    [9, "Water heater pilot out", "No hot water since yesterday.", "high", "resolved"],
    [11, "Garage door stuck", "Opens halfway then stops.", "medium", "resolved"],
  ]
  for (const [ui, title, desc, priority, status] of maint) {
    await pool.query(
      `INSERT INTO maintenance_requests (unit_id, tenant_id, title, description, priority, status)
       VALUES ($1,
         (SELECT l.tenant_id FROM leases l WHERE l.unit_id = $1 AND l.ended = false LIMIT 1),
         $2,$3,$4,$5)`,
      [unitIds[ui], title, desc, priority, status],
    )
  }

  console.log(`\n✅ Seeded: 3 properties, 12 units, ${tenantDefs.length} tenants, ${leaseDefs.length} leases, ${invoiceCount} invoices, ${maint.length} maintenance requests.`)
  console.log("   Expect: ~83% occupancy, overdue invoices with late fees, leases expiring within 60 days.")
  console.log("🎉 Setup complete. Run: npm run dev → http://localhost:3000")
  await pool.end()
}

main().catch((err) => {
  console.error("\n❌ Setup failed:", err.message)
  process.exit(1)
})
