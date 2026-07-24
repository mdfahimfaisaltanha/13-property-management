"use client"

import { useCallback, useEffect, useState } from "react"
import type { DashboardData, InvoiceRow, LeaseRow, MaintenanceRow, UnitRow } from "@/lib/types"

type PropertyRow = { id: number; name: string; address: string }
type Tab = "dashboard" | "units" | "leases" | "rent" | "maintenance"

const fmt = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })

const STATUS_BADGE: Record<string, string> = {
  paid: "ok", partial: "warn", overdue: "bad", pending: "muted",
  active: "ok", expiring_soon: "warn", expired: "bad", ended: "muted",
  open: "bad", in_progress: "warn", resolved: "ok",
  emergency: "bad", high: "warn", medium: "info", low: "muted",
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${STATUS_BADGE[value] ?? "muted"}`}>{value.replace(/_/g, " ")}</span>
}

export default function Portal() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState("")
  const [tab, setTab] = useState<Tab>("dashboard")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [dash, setDash] = useState<DashboardData | null>(null)
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [units, setUnits] = useState<UnitRow[]>([])
  const [leases, setLeases] = useState<LeaseRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([])

  // forms
  const [propName, setPropName] = useState("")
  const [propAddress, setPropAddress] = useState("")
  const [unitProp, setUnitProp] = useState("")
  const [unitLabel, setUnitLabel] = useState("")
  const [unitBeds, setUnitBeds] = useState("1")
  const [unitRent, setUnitRent] = useState("")
  const [leaseUnit, setLeaseUnit] = useState("")
  const [leaseTenant, setLeaseTenant] = useState("")
  const [leaseEmail, setLeaseEmail] = useState("")
  const [leaseStart, setLeaseStart] = useState("")
  const [leaseEnd, setLeaseEnd] = useState("")
  const [leaseRent, setLeaseRent] = useState("")
  const [leaseDeposit, setLeaseDeposit] = useState("")
  const [payFor, setPayFor] = useState<number | null>(null)
  const [payAmount, setPayAmount] = useState("")
  const [mUnit, setMUnit] = useState("")
  const [mTitle, setMTitle] = useState("")
  const [mDesc, setMDesc] = useState("")
  const [mPriority, setMPriority] = useState("medium")

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [d, u, l, i, m] = await Promise.all([
        fetch("/api/portal/dashboard"),
        fetch("/api/portal/units"),
        fetch("/api/portal/leases"),
        fetch("/api/portal/invoices"),
        fetch("/api/portal/maintenance"),
      ])
      if (d.status === 401) {
        setAuthed(false)
        return
      }
      setDash(await d.json())
      const uData = await u.json()
      setProperties(uData.properties ?? [])
      setUnits(uData.units ?? [])
      setLeases((await l.json()).leases ?? [])
      setInvoices((await i.json()).invoices ?? [])
      setMaintenance((await m.json()).requests ?? [])
      setAuthed(true)
    } catch {
      setError("Failed to load data. Is the database set up? Run `npm run setup`.")
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function post(url: string, body: unknown, method = "POST"): Promise<boolean> {
    setError(null)
    setNotice(null)
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Request failed.")
      return false
    }
    void refresh()
    return true
  }

  async function login(e: React.FormEvent) {
    e.preventDefault()
    if (await post("/api/portal/login", { password })) setPassword("")
  }

  if (authed === null) return <main className="container"><p className="meta">Loading…</p></main>

  if (!authed) {
    return (
      <main className="container">
        <div className="login-wrap card">
          <h2>🏠 Property Management</h2>
          <p className="meta" style={{ marginBottom: 14 }}>Sign in with the manager password (ADMIN_PASSWORD in .env.local).</p>
          <form className="row" onSubmit={login}>
            <input type="password" placeholder="Manager password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: 1 }} />
            <button className="primary" type="submit">Sign in</button>
          </form>
          {error && <div className="error-box">⛔ {error}</div>}
        </div>
      </main>
    )
  }

  return (
    <main className="container">
      <div className="topbar">
        <div>
          <h1>🏠 Property Management</h1>
          <div className="sub">Leases · rent collection · maintenance</div>
        </div>
        <button className="ghost" onClick={async () => { await fetch("/api/portal/login", { method: "DELETE" }); setAuthed(false) }}>Sign out</button>
      </div>

      <div className="tabs">
        {([["dashboard", "📊 Dashboard"], ["units", "🏢 Properties"], ["leases", "📄 Leases"], ["rent", "💰 Rent"], ["maintenance", "🔧 Maintenance"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setError(null); setNotice(null) }}>{label}</button>
        ))}
      </div>

      {error && <div className="error-box">⛔ {error}</div>}
      {notice && <div className="ok-box">✅ {notice}</div>}

      {tab === "dashboard" && dash && (
        <>
          <div className="grid-4">
            <div className="kpi"><div className="value">{dash.occupancyPct}%</div><div className="label">Occupancy ({dash.occupied}/{dash.units} units)</div></div>
            <div className="kpi">
              <div className="value">{fmt(dash.collectedThisMonthCents)}</div>
              <div className="label">Collected this month of {fmt(dash.billedThisMonthCents)} billed</div>
              <div className="progress"><div style={{ width: `${dash.billedThisMonthCents > 0 ? Math.min(100, (dash.collectedThisMonthCents / dash.billedThisMonthCents) * 100) : 0}%` }} /></div>
            </div>
            <div className="kpi"><div className="value" style={{ color: dash.overdueCount > 0 ? "var(--bad)" : undefined }}>{fmt(dash.overdueCents)}</div><div className="label">Overdue across {dash.overdueCount} invoices</div></div>
            <div className="kpi"><div className="value">{dash.openMaintenance.reduce((n, m) => n + m.count, 0)}</div><div className="label">Open maintenance {dash.openMaintenance.map((m) => `${m.priority}: ${m.count}`).join(" · ")}</div></div>
          </div>

          <div className="card">
            <h2>⏳ Leases expiring within 60 days</h2>
            {dash.expiringLeases.length === 0 ? <p className="meta">None — all leases have more than 60 days left.</p> : (
              <table>
                <thead><tr><th>Tenant</th><th>Unit</th><th>Ends</th><th>Days left</th><th>Rent</th></tr></thead>
                <tbody>
                  {dash.expiringLeases.map((l) => (
                    <tr key={l.id}>
                      <td>{l.tenantName}<div className="meta">{l.tenantEmail}</div></td>
                      <td>{l.propertyName} · {l.unitLabel}</td>
                      <td>{fmtDate(l.endDate)}</td>
                      <td><Badge value={l.daysToExpiry <= 30 ? "expiring_soon" : "active"} /> {l.daysToExpiry}d</td>
                      <td>{fmt(l.monthlyRentCents)}/mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "units" && (
        <>
          <div className="card">
            <h2>Add property</h2>
            <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/portal/units", { kind: "property", name: propName, address: propAddress })) { setPropName(""); setPropAddress("") } }}>
              <input placeholder="Name (e.g. Maple Court)" value={propName} onChange={(e) => setPropName(e.target.value)} />
              <input placeholder="Address" value={propAddress} onChange={(e) => setPropAddress(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <button className="primary" type="submit">Add property</button>
            </form>
            <h2 style={{ marginTop: 18 }}>Add unit</h2>
            <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/portal/units", { kind: "unit", propertyId: Number(unitProp), label: unitLabel, bedrooms: Number(unitBeds), marketRent: Number(unitRent) })) { setUnitLabel(""); setUnitRent("") } }}>
              <select value={unitProp} onChange={(e) => setUnitProp(e.target.value)}>
                <option value="">Property…</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input placeholder="Unit label (e.g. 2B)" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} style={{ width: 140 }} />
              <input type="number" min={0} value={unitBeds} onChange={(e) => setUnitBeds(e.target.value)} style={{ width: 80 }} title="Bedrooms" />
              <input type="number" min={1} step="0.01" placeholder="Market rent $" value={unitRent} onChange={(e) => setUnitRent(e.target.value)} style={{ width: 140 }} />
              <button className="primary" type="submit" disabled={!unitProp}>Add unit</button>
            </form>
          </div>

          <div className="card">
            <h2>Units ({units.length})</h2>
            <table>
              <thead><tr><th>Property</th><th>Unit</th><th>Beds</th><th>Market rent</th><th>Status</th></tr></thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id}>
                    <td>{u.propertyName}</td>
                    <td>{u.label}</td>
                    <td>{u.bedrooms}</td>
                    <td>{fmt(u.marketRentCents)}/mo</td>
                    <td>{u.occupiedBy ? <><Badge value="active" /> {u.occupiedBy}</> : <Badge value="ended" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta" style={{ marginTop: 8 }}>Vacant units show a gray badge — they drag occupancy on the dashboard.</p>
          </div>
        </>
      )}

      {tab === "leases" && (
        <>
          <div className="card">
            <h2>Create lease</h2>
            <form className="row" onSubmit={async (e) => {
              e.preventDefault()
              if (await post("/api/portal/leases", { unitId: Number(leaseUnit), tenantName: leaseTenant, tenantEmail: leaseEmail, startDate: leaseStart, endDate: leaseEnd, monthlyRent: Number(leaseRent), deposit: Number(leaseDeposit) || 0 })) {
                setLeaseTenant(""); setLeaseEmail(""); setLeaseRent(""); setLeaseDeposit("")
                setNotice("Lease created. Generate this month's invoices from the Rent tab to bill it (first month is prorated automatically).")
              }
            }}>
              <select value={leaseUnit} onChange={(e) => setLeaseUnit(e.target.value)}>
                <option value="">Unit…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.propertyName} · {u.label}</option>)}
              </select>
              <input placeholder="Tenant name" value={leaseTenant} onChange={(e) => setLeaseTenant(e.target.value)} />
              <input placeholder="Tenant email" value={leaseEmail} onChange={(e) => setLeaseEmail(e.target.value)} />
              <input type="date" value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} title="Start date" />
              <input type="date" value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} title="End date" />
              <input type="number" min={1} step="0.01" placeholder="Rent $/mo" value={leaseRent} onChange={(e) => setLeaseRent(e.target.value)} style={{ width: 120 }} />
              <input type="number" min={0} step="0.01" placeholder="Deposit $" value={leaseDeposit} onChange={(e) => setLeaseDeposit(e.target.value)} style={{ width: 120 }} />
              <button className="primary" type="submit" disabled={!leaseUnit}>Create</button>
            </form>
            <p className="meta" style={{ marginTop: 8 }}>Overlapping leases on the same unit are rejected (409) — end the current lease first.</p>
          </div>

          <div className="card">
            <h2>Leases ({leases.length})</h2>
            <table>
              <thead><tr><th>Tenant</th><th>Unit</th><th>Term</th><th>Rent</th><th>Deposit</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {leases.map((l) => (
                  <tr key={l.id}>
                    <td>{l.tenantName}<div className="meta">{l.tenantEmail}</div></td>
                    <td>{l.propertyName} · {l.unitLabel}</td>
                    <td>{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                    <td>{fmt(l.monthlyRentCents)}/mo</td>
                    <td>{fmt(l.depositCents)}</td>
                    <td><Badge value={l.status} />{l.status === "expiring_soon" && <div className="meta">{l.daysToExpiry}d left</div>}</td>
                    <td>{(l.status === "active" || l.status === "expiring_soon") && <button className="ghost" onClick={async () => { if (confirm("End this lease today?")) await post("/api/portal/leases", { id: l.id }, "PATCH") }}>End</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "rent" && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ marginBottom: 0 }}>Invoices</h2>
              <button className="primary" onClick={async () => {
                const res = await fetch("/api/portal/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate" }) })
                const data = await res.json().catch(() => ({}))
                if (!res.ok) setError(data.error || "Generation failed.")
                else setNotice(`Generated ${data.created} new invoice(s) for this month; applied ${data.lateFeesApplied} late fee(s). Re-running is safe — it never double-bills.`)
                void refresh()
              }}>Generate this month's invoices</button>
            </div>
            <p className="meta" style={{ marginTop: 8 }}>Idempotent: one invoice per lease per month. First/last months are prorated by days leased. Unpaid invoices past due + grace get a one-time late fee.</p>
          </div>

          <div className="card">
            <table>
              <thead><tr><th>Period</th><th>Tenant</th><th>Unit</th><th>Amount</th><th>Paid</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {invoices.map((inv) => {
                  const total = inv.amountCents + inv.lateFeeCents
                  const remaining = total - inv.paidCents
                  return (
                    <tr key={inv.id}>
                      <td>{new Date(inv.period).toLocaleDateString("en-US", { year: "numeric", month: "short" })}</td>
                      <td>{inv.tenantName}</td>
                      <td>{inv.propertyName} · {inv.unitLabel}</td>
                      <td>{fmt(total)}{inv.lateFeeCents > 0 && <div className="meta">incl. {fmt(inv.lateFeeCents)} late fee</div>}</td>
                      <td>{fmt(inv.paidCents)}</td>
                      <td>{fmtDate(inv.dueDate)}</td>
                      <td><Badge value={inv.status} /></td>
                      <td>
                        {remaining > 0 && (payFor === inv.id ? (
                          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/portal/invoices", { action: "pay", invoiceId: inv.id, amount: Number(payAmount) })) { setPayFor(null); setPayAmount("") } }}>
                            <input type="number" min={0.01} step="0.01" placeholder={`≤ ${(remaining / 100).toFixed(2)}`} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={{ width: 110 }} autoFocus />
                            <button className="primary" type="submit">Save</button>
                            <button className="ghost" type="button" onClick={() => setPayFor(null)}>×</button>
                          </form>
                        ) : (
                          <button className="ghost" onClick={() => { setPayFor(inv.id); setPayAmount((remaining / 100).toFixed(2)) }}>Record payment</button>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {invoices.length === 0 && <p className="meta">No invoices yet — click “Generate this month's invoices”.</p>}
          </div>
        </>
      )}

      {tab === "maintenance" && (
        <>
          <div className="card">
            <h2>New request</h2>
            <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await post("/api/portal/maintenance", { unitId: Number(mUnit), title: mTitle, description: mDesc, priority: mPriority })) { setMTitle(""); setMDesc("") } }}>
              <select value={mUnit} onChange={(e) => setMUnit(e.target.value)}>
                <option value="">Unit…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.propertyName} · {u.label}</option>)}
              </select>
              <input placeholder="Title (e.g. Kitchen sink leaking)" value={mTitle} onChange={(e) => setMTitle(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <input placeholder="Details (optional)" value={mDesc} onChange={(e) => setMDesc(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <select value={mPriority} onChange={(e) => setMPriority(e.target.value)}>
                {["low", "medium", "high", "emergency"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="primary" type="submit" disabled={!mUnit}>Submit</button>
            </form>
            <p className="meta" style={{ marginTop: 8 }}>The unit's current tenant is attached automatically. Sorted by open status, then priority.</p>
          </div>

          <div className="card">
            <h2>Requests ({maintenance.filter((m) => m.status !== "resolved").length} open)</h2>
            <table>
              <thead><tr><th>Request</th><th>Unit</th><th>Tenant</th><th>Priority</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {maintenance.map((m) => (
                  <tr key={m.id}>
                    <td>{m.title}<div className="meta">{m.description}</div></td>
                    <td>{m.propertyName} · {m.unitLabel}</td>
                    <td>{m.tenantName ?? <span className="meta">—</span>}</td>
                    <td><Badge value={m.priority} /></td>
                    <td><Badge value={m.status} /></td>
                    <td className="row">
                      {m.status === "open" && <button className="ghost" onClick={() => post("/api/portal/maintenance", { id: m.id, status: "in_progress" }, "PATCH")}>Start</button>}
                      {m.status !== "resolved" && <button className="ghost" onClick={() => post("/api/portal/maintenance", { id: m.id, status: "resolved" }, "PATCH")}>Resolve</button>}
                      {m.status === "resolved" && <button className="ghost" onClick={() => post("/api/portal/maintenance", { id: m.id, status: "open" }, "PATCH")}>Reopen</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
