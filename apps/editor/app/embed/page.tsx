/**
 * /embed route - Server component wrapper for the encoded scene loader.
 *
 * Marked as force-dynamic to prevent Next.js from trying to prerender this
 * page at build time (it depends entirely on URL search params, which don't
 * exist at build time).
 *
 * The actual logic lives in `embed-client.tsx` (client component) and is
 * wrapped in Suspense as required by Next.js for components using
 * useSearchParams().
 */

import { Suspense } from 'react'
import EmbedClient from './embed-client'

export const dynamic = 'force-dynamic'

function EmbedLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-muted-foreground text-sm">Loading scene...</div>
    </div>
  )
}

export default function EmbedPage() {
  return (
    <Suspense fallback={<EmbedLoading />}>
      <EmbedClient />
    </Suspense>
  )
}
