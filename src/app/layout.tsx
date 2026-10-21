import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ProStream Player Import',
  description: 'Scrape CricHeroes and STUMPS player data into ProStream Scoreboard profiles',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
