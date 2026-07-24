# Property Management Platform

A landlord/manager portal for a rental portfolio: **lease tracking**, **rent collection** (idempotent monthly billing, proration, partial payments, late fees), and a **maintenance request workflow** — with a dashboard for occupancy, collection rate, overdue rent, and expiring leases.

Built with **Next.js 14 (App Router)**, **TypeScript**, and **Postgres**. All money is integer cents.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL (Neon/Supabase free tier) + ADMIN_PASSWORD
npm run setup                # tables + realistic seed (3 properties, 12 units, invoices in every state)
npm run dev                  # http://localhost:3000
```

Sign in with `ADMIN_PASSWORD`. The seed produces a lived-in portfolio on day one: ~83% occupancy, a chronic partial payer, an overdue invoice awaiting its late fee, leases expiring within 60 days, and an emergency AC ticket in progress. A guided tour is in `samples/walkthrough.md`.

---

## What's inside

| Piece | File | Notes |
|---|---|---|
| Dashboard | `app/api/portal/dashboard/route.ts` | Occupancy, billed vs collected this month, overdue total, expiring leases (≤60 days), open maintenance by priority |
| Properties & units | `app/api/portal/units/route.ts` | Registry with live occupancy per unit |
| Leases | `app/api/portal/leases/route.ts` | Create (tenant find-or-create by email), end early, derived status: active / expiring_soon / expired / ended |
| Rent engine | `lib/rent.ts` + `app/api/portal/invoices/route.ts` | Invoice generation, proration, late fees, payments — see below |
| Maintenance | `app/api/portal/maintenance/route.ts` | open → in_progress → resolved, priority-sorted (emergency first), tenant auto-attached from the active lease |
| Seed | `scripts/setup.mjs` | Idempotent; leases/invoices in every state so every screen has data |

## Rent engine (interview talking points)

**Idempotent billing.** Invoices are `UNIQUE(lease_id, period)` and generation inserts with `ON CONFLICT DO NOTHING` — the “Generate this month's invoices” button (or a cron hitting the same endpoint) can run any number of times without double-billing. Re-run count is reported honestly (`created: 0` the second time).

**Proration.** First and last months are billed by days actually leased: `rent × daysLeased / daysInMonth`, rounded to a cent. A lease starting the 16th of a 30-day month bills exactly half.

**Derived status, never stored.** An invoice's status (`paid | partial | overdue | pending`) is always computed from its payments at read time — there is no status column to drift out of sync. Overdue means unpaid past `due date + GRACE_DAYS` (default 5).

**One-time late fees.** When an invoice crosses into overdue, a flat `LATE_FEE` (default $50) is applied exactly once — guarded by `late_fee_cents = 0`, so re-checks never stack fees.

**Payment integrity.** Partial payments accumulate toward `amount + late fee`; overpayments are rejected with the exact remaining balance; paying a settled invoice is a 409.

**Lease overlap prevention.** A unit can't have two leases covering the same dates — the create endpoint checks the range and returns 409 with the conflicting tenant's name.

## Edge cases handled

| Case | Behavior |
|---|---|
| Double-clicking “Generate invoices” | No-op — unique constraint + ON CONFLICT |
| Mid-month lease start/end | Prorated by days leased, to the cent |
| Partial payment | Status `partial`; remaining balance shown; further payments accumulate |
| Overpayment | Rejected with the exact remaining amount |
| Paying a paid invoice | 409 |
| Late fee re-application | Impossible — applied only where `late_fee_cents = 0` |
| Overlapping lease on a unit | 409 naming the conflicting tenant |
| Lease ended early | `end_date` clamped to today; unit shows vacant; future billing stops |
| Maintenance on a vacant unit | Allowed — tenant is null, request still tracked |
| Currency drift | All math in integer cents; dollars only at the UI boundary |

## Deployment (Vercel + Neon)

1. Create a free Postgres database at [neon.tech](https://neon.tech).
2. `DATABASE_URL=... npm run setup` against it (or set `.env.local` first).
3. Push to GitHub → import in Vercel → set `DATABASE_URL` + `ADMIN_PASSWORD` → deploy.
4. Optional: point a Vercel Cron at `POST /api/portal/invoices` monthly — generation is idempotent so overlap is harmless (note: the endpoint requires the admin session; for cron use, add a bearer-secret check — a 5-line change).

## Limitations / roadmap

- Single-manager auth — upgrade path is a users table + NextAuth, plus a tenant-facing portal (submit maintenance, view balance) with per-tenant logins.
- Payments are recorded manually — Stripe/ACH integration would replace the “Record payment” flow (project #2 in this portfolio covers Stripe depth).
- Late fee is flat; percentage-based or compounding policies would slot into `applyLateFees`.
- No file attachments on maintenance requests yet (photos would need object storage).
