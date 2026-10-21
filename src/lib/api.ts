import 'server-only'
import { NextResponse } from 'next/server'
import { AuthError, requireSession, type SessionUser } from './auth'
import { CapabilityError } from './capabilities'
import { PublishConflictError } from './publish'
import { HttpError } from './sources/http'

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status })
}

/** Wrap a route handler with session enforcement and consistent error mapping. */
export function withSession<A extends unknown[]>(
  handler: (user: SessionUser, ...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      const user = await requireSession()
      return await handler(user, ...args)
    } catch (err) {
      if (err instanceof AuthError) return jsonError(401, 'Your session has expired. Sign in again.')
      if (err instanceof PublishConflictError) return jsonError(409, err.message, { existingId: err.existingId })
      if (err instanceof CapabilityError) return jsonError(412, err.message)
      if (err instanceof HttpError) return jsonError(502, `Source site error: ${err.message}`)
      if (err instanceof SyntaxError) return jsonError(400, 'Invalid JSON body')
      console.error('[api]', err)
      const message = err instanceof Error ? err.message : 'Unexpected error'
      return jsonError(500, message)
    }
  }
}
