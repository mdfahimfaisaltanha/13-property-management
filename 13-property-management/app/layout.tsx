import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Property Management Platform",
  description:
    "Lease tracking, rent collection with proration and late fees, and a maintenance request workflow.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
