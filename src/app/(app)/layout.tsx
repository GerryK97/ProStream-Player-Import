import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession().catch(() => null)
  if (!user) redirect('/login')
  return (
    <AppShell user={user} scoreboardUrl={process.env.SCOREBOARD_URL || 'https://score.prostream.lk'}>
      {children}
    </AppShell>
  )
}
