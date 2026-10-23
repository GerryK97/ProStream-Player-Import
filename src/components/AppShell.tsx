'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/requests', label: 'Requests' },
  { href: '/', label: 'Import player' },
  { href: '/teams', label: 'Import team' },
  { href: '/history', label: 'Recent imports' },
]

export function AppShell({ user, scoreboardUrl, children }: { user: { displayName: string; username: string }; scoreboardUrl: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen">
      <header className="bg-app-header text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold tracking-widest text-primary uppercase">ProStream</span>
            <span className="font-bold">Player Import</span>
          </div>
          <nav className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-1.5 transition ${pathname === n.href ? 'bg-white/15 font-semibold' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <a href={scoreboardUrl} target="_blank" rel="noreferrer" className="text-white/70 hover:text-white">
              Scoreboard ↗
            </a>
            <span className="text-white/50">|</span>
            <span className="text-white/80">{user.displayName}</span>
            <button onClick={logout} className="rounded-md border border-white/20 px-2.5 py-1 text-white/80 hover:bg-white/10">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
