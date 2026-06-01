/**
 * /embed route - Server component with HMAC token validation.
 *
 * This route is gated by a Masbalt-issued HMAC token to prevent
 * unauthorized public access to the editor. The token must be passed
 * as `?token=<payload_base64url>.<hmac_sha256_hex>`.
 *
 * The shared secret is loaded from the `MASBALT_HMAC_SECRET` environment
 * variable. Set it in BOTH the Pascal Editor Vercel project AND in the
 * Masbalt deployments so tokens issued by Masbalt validate here.
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
  const validation = validateToken(params.token)

  if (!validation.ok) {
    return <EmbedAccessDenied reason={validation.reason} />
  }

  return (
    <Suspense fallback={<EmbedLoading />}>
      <EmbedClient />
    </Suspense>
  )
}
