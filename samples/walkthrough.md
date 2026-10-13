# Guided walkthrough (after `npm run setup`)

A 5-minute tour that touches every feature, in order.

## 1. Dashboard

- **Occupancy** shows ~83% — 10 of 12 units have active leases (unit 1B at Maple Court and L1 at Cedar Lofts are vacant; L1's lease ended historically).
- **Collected this month** shows a partial bar — the seed pays only the first two current-month invoices.
- **Overdue** is non-zero: Sofia (partial payer) and Priya (skipped a month) are behind.
- **Expiring leases** lists tenants ending within 60 days — renewal conversations to have this week.

## 2. Rent tab — the core demo

1. Click **“Generate this month's invoices”**. Note the message: some invoices are created, and **late fees are applied** to the overdue ones (exactly once).
2. Click it **again** — `0 created`. That's the idempotency guarantee (UNIQUE(lease_id, period) + ON CONFLICT DO NOTHING).
3. Find an **overdue** invoice — the amount now includes the $50 late fee line.
4. Click **Record payment** on it, but try paying **more** than the remaining balance → rejected with the exact remainder.
5. Pay **half** the remaining → status flips to `partial`, paid total updates.
6. Pay the rest → `paid`.

## 3. Leases tab

1. Try creating a lease on a unit that already has one, with overlapping dates → **409 naming the sitting tenant**.
2. Create a lease on the vacant unit **Maple Court · 1B** starting mid-month → then generate invoices on the Rent tab and note the **prorated first month**.
3. **End** a lease → its unit immediately shows vacant on the Properties tab and occupancy drops on the dashboard.

## 4. Maintenance tab

- The list is sorted: open emergencies first (**AC not cooling** is in progress), resolved at the bottom.
- Submit a request on any unit — the sitting tenant attaches automatically; on a vacant unit it's tracked with no tenant.
- Walk one through **Start → Resolve**, then **Reopen** it.

## 5. Properties tab

- Add a property, add a unit to it — it appears as vacant (gray badge) and lowers the occupancy percentage until leased.
