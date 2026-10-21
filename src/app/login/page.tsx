import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getSession().catch(() => null)) redirect('/')
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-app-border bg-app-surface p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">ProStream</p>
          <h1 className="mt-1 text-2xl font-bold">Player Import</h1>
          <p className="mt-2 text-sm text-app-muted">Sign in with your ProStream Scoreboard admin account.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
