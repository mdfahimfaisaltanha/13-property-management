/** Shared types. All money is integer cents to avoid float drift. */

export type UnitRow = {
  id: number
  propertyId: number
  propertyName: string
  label: string
  bedrooms: number
  marketRentCents: number
  /** Name of the active tenant, or null if vacant. */
  occupiedBy: string | null
}

export type LeaseRow = {
  id: number
  unitLabel: string
  propertyName: string
  tenantName: string
  tenantEmail: string
  startDate: string
  endDate: string
  monthlyRentCents: number
  depositCents: number
  /** Derived: active | expiring_soon (<=60 days) | expired | ended */
  status: string
  daysToExpiry: number
}

export type InvoiceRow = {
  id: number
  leaseId: number
  tenantName: string
  propertyName: string
  unitLabel: string
  period: string
  amountCents: number
  lateFeeCents: number
  paidCents: number
  dueDate: string
  /** Derived: paid | partial | overdue | pending */
  status: string
}

export type MaintenanceRow = {
  id: number
  propertyName: string
  unitLabel: string
  tenantName: string | null
  title: string
  description: string
  priority: "low" | "medium" | "high" | "emergency"
  status: "open" | "in_progress" | "resolved"
  createdAt: string
  updatedAt: string
}

export type DashboardData = {
  units: number
  occupied: number
  occupancyPct: number
  collectedThisMonthCents: number
  billedThisMonthCents: number
  overdueCents: number
  overdueCount: number
  expiringLeases: LeaseRow[]
  openMaintenance: { priority: string; count: number }[]
}
