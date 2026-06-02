/**
 * /embed route - Server component with OPTIONAL HMAC token validation.
 *
 * **Current state (Phase 1.95):** Token validation is DISABLED by default
 * to unblock the end-to-end demo while Masbalt finishes wiring its side
 * of the HMAC token issuance. Anyone with a valid `?scene=` parameter
 * can render a scene here. This is acceptable for now because the route
 * doesn't expose any sensitive backend data — it's purely a scene viewer.
 *
 * **Re-enabling validation:** Set the env var `EMBED_REQUIRE_TOKEN=true`
 * on the Pascal Editor Vercel project (Production environment) and
 * redeploy. The validation logic, helpers, and access-denied UI below
 * are intentionally kept in place so re-enabling is a one-variable flip
 * with zero code change.
 *
 * **When enabled, the route is gated by a Masbalt-issued HMAC token:**
 * Pass `?token=<payload_base64url>.<hmac_sha256_hex>` and set the shared
 * secret in the `MASBALT_HMAC_SECRET` env var on both this project AND
 * on the Masbalt deployment so tokens issued by Masbalt validate here.
 *
 * Token payload shape (decoded base64url):
 *   {
 *     "userId":  string,    // who initiated (e.g. "alexandru")
 *     "devizId": string,    // optional reference (e.g. "deviz_xxx")
 *     "exp":     number     // Unix timestamp (seconds) when token expires
 *   }
 *
 * The route's actual rendering logic lives in `embed-client.tsx`.
 */

import crypto from 'node:crypto'
import { Suspense } from 'react'
import EmbedAccessDenied from './access-denied'
import EmbedClient from './embed-client'

export const dynamic = 'force-dynamic'

type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'no_token' | 'no_secret' | 'malformed' | 'bad_signature' | 'expired' }

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    const bufA = Buffer.from(a, 'hex')
    const bufB = Buffer.from(b, 'hex')
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

function validateToken(token: string | undefined | null): ValidationResult {
  if (!token) return { ok: false, reason: 'no_token' }

  const secret = process.env.MASBALT_HMAC_SECRET
  if (!secret) {
    console.error('[embed] MASBALT_HMAC_SECRET env var not set — cannot validate tokens')
    return { ok: false, reason: 'no_secret' }
  }

  const parts = token.split('.')
  if (parts.length !== 2) {
    return { ok: false, reason: 'malformed' }
  }

  const [payloadB64, signature] = parts
  if (!payloadB64 || !signature) {
    return { ok: false, reason: 'malformed' }
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('hex')

  if (!timingSafeEqualHex(signature.toLowerCase(), expectedSignature)) {
    return { ok: false, reason: 'bad_signature' }
  }

  try {
    // Convert base64url → base64
    let b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) b64 += '='.repeat(4 - pad)
    const payloadStr = Buffer.from(b64, 'base64').toString('utf-8')
    const payload = JSON.parse(payloadStr) as { exp?: number }
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'expired' }
    }
    return { ok: true }
  } catch (err) {
    console.error('[embed] Failed to decode payload:', err)
    return { ok: false, reason: 'malformed' }
  }
}

function EmbedLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-muted-foreground text-sm">Loading scene...</div>
    </div>
  )
}

interface EmbedPageProps {
  searchParams: Promise<{ scene?: string; token?: string; source?: string }>
}

export default async function EmbedPage({ searchParams }: EmbedPageProps) {
  const params = await searchParams

  // Token validation is currently OPTIONAL — gated behind the
  // EMBED_REQUIRE_TOKEN env var. This lets us ship the integration
  // before the Masbalt side is fully wired to issue tokens.
  //
  // To re-enable strict validation in the future, set
  //   EMBED_REQUIRE_TOKEN=true
  // on the Pascal Editor Vercel project (Production env) and redeploy.
  // The validation helpers and access-denied UI below stay in place so
  // re-enabling is a one-variable flip with no code change.
  const requireToken = process.env.EMBED_REQUIRE_TOKEN === 'true'

  if (requireToken) {
    const validation = validateToken(params.token)
    if (!validation.ok) {
      return <EmbedAccessDenied reason={validation.reason} />
    }
  }

  return (
    <Suspense fallback={<EmbedLoading />}>
      <EmbedClient />
    </Suspense>
  )
}
