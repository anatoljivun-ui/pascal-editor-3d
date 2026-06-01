'use client'

/**
 * /embed route - Encoded scene loader for external integrations
 *
 * Loads a SceneGraph from the `?scene=<base64-encoded-json>` URL parameter.
 * Designed for embedding/linking from external apps (e.g. Deviz Masbalt
 * generating 3D previews from estimate data).
 *
 * Usage:
 *   /embed?scene=eyJub2RlcyI6ey4uLn0sInJvb3ROb2RlSWRzIjpbInNpdGVfMSJdfQ==
 *
 * Falls back to standard /scenes page when no scene param is provided
 * or when decoding/parsing fails.
 */

import { Editor, type SceneGraph, type SidebarTab } from '@pascal-app/editor'
import { Layers, Package, Settings } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

// Polyfill atob for Unicode-safe base64 decoding
function decodeBase64Url(value: string): string {
  // Normalize URL-safe base64 → standard base64
  let str = value.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  const pad = str.length % 4
  if (pad) str += '='.repeat(4 - pad)
  // Decode → Uint8Array → UTF-8 string (Unicode-safe)
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function parseSceneFromParam(sceneParam: string): SceneGraph | null {
  try {
    const json = decodeBase64Url(sceneParam)
    const parsed = JSON.parse(json) as Partial<SceneGraph>
    // Minimal validation
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.nodes ||
      typeof parsed.nodes !== 'object' ||
      !Array.isArray(parsed.rootNodeIds)
    ) {
      console.error('[embed] Invalid SceneGraph shape:', parsed)
      return null
    }
    return parsed as SceneGraph
  } catch (err) {
    console.error('[embed] Failed to parse scene param:', err)
    return null
  }
}

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'items',
    label: 'Items',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
  },
]

const PROJECT_ID = 'embed-scene'

export default function EmbedPage() {
  const searchParams = useSearchParams()
  const sceneParam = searchParams?.get('scene') ?? null
  const sourceLabel = searchParams?.get('source') ?? null
  const [hasParam, setHasParam] = useState<boolean | null>(null)
  const [parseError, setParseError] = useState(false)

  const initialScene = useMemo<SceneGraph | null>(() => {
    if (!sceneParam) return null
    return parseSceneFromParam(sceneParam)
  }, [sceneParam])

  useEffect(() => {
    setHasParam(Boolean(sceneParam))
    setParseError(Boolean(sceneParam) && !initialScene)
  }, [sceneParam, initialScene])

  const handleLoad = useCallback(async (): Promise<SceneGraph> => {
    if (initialScene) return initialScene
    // Fallback empty scene
    return { nodes: {}, rootNodeIds: [] }
  }, [initialScene])

  // Loading skeleton while hydrating
  if (hasParam === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading scene...</div>
      </div>
    )
  }

  // No scene param provided — show helpful message + link to /scenes
  if (!hasParam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 text-center shadow-xl">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
            Embed mode
          </p>
          <h1 className="mt-2 font-semibold text-lg">No scene to display</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            This route expects a <code className="font-mono">?scene=</code> URL
            parameter with a base64-encoded SceneGraph JSON.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Link
              className="rounded-md border border-border bg-accent px-3 py-2 font-medium text-sm hover:bg-accent/80"
              href="/scenes"
            >
              Browse scenes
            </Link>
            <Link
              className="rounded-md border border-border bg-background px-3 py-2 font-medium text-sm hover:bg-accent/40"
              href="/"
            >
              Open editor
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Parse error — show clear message
  if (parseError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 text-center shadow-xl">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
            Embed mode — error
          </p>
          <h1 className="mt-2 font-semibold text-lg">Invalid scene data</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            The provided <code className="font-mono">?scene=</code> parameter
            could not be decoded as a valid SceneGraph JSON. Check the encoding
            and shape (must include <code className="font-mono">nodes</code> and{' '}
            <code className="font-mono">rootNodeIds</code>).
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Link
              className="rounded-md border border-border bg-background px-3 py-2 font-medium text-sm hover:bg-accent/40"
              href="/"
            >
              Open empty editor
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Render Editor with the decoded scene
  return (
    <div className="relative h-screen w-screen">
      <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
          <span className="text-muted-foreground">
            {sourceLabel ? `Embedded from ${sourceLabel}` : 'Embedded scene'} —
            changes are not saved.
          </span>
        </div>
      </div>
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        onLoad={handleLoad}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
