'use client'

/**
 * /embed client component — SceneGraph loader from URL parameter.
 *
 * Supports two encodings for the `?scene=` parameter (auto-detected):
 *  1. base64url(JSON.stringify(scene))           — raw UTF-8 JSON
 *  2. base64url(gzip(JSON.stringify(scene)))     — gzipped (for large scenes)
 *
 * Gzip is detected by inspecting the first two decoded bytes for the gzip
 * magic number (0x1f 0x8b). When detected, we use the browser-native
 * DecompressionStream API to inflate the payload before parsing JSON.
 *
 * Wrapped in Suspense by the parent server component (page.tsx) because
 * useSearchParams() requires a Suspense boundary in Next.js 14+.
 */

import { emitter } from '@pascal-app/core'
import { AnyNode } from '@pascal-app/core/schema'
import { Editor, type SceneGraph, type SidebarTab, useViewer } from '@pascal-app/editor'
import {
  Layers,
  Maximize,
  Package,
  RotateCcw,
  RotateCw,
  Settings,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

// Decode base64url (RFC 4648 §5) → Uint8Array. Handles missing padding and
// the `-`/`_` URL-safe substitutions for `+`/`/`.
function decodeBase64UrlToBytes(value: string): Uint8Array {
  let str = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = str.length % 4
  if (pad) str += '='.repeat(4 - pad)
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Inflate a gzipped Uint8Array using the browser DecompressionStream API.
async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'This browser does not support DecompressionStream. ' +
        'Please use an up-to-date Chrome, Edge, Firefox, or Safari.',
    )
  }
  // Wrap Uint8Array → Blob → ReadableStream so we can pipe through gzip.
  // Using a Blob is the simplest cross-browser path; the alternative is
  // constructing a ReadableStream by hand which is more verbose.
  // Cast through ArrayBufferLike — Uint8Array<SharedArrayBuffer> is not
  // assignable to BlobPart in stricter TS configs.
  const blob = new Blob([bytes.buffer as ArrayBuffer])
  const ds = new DecompressionStream('gzip')
  const stream = blob.stream().pipeThrough(ds)
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

// Schema defaults that Pascal's door/window renderers read directly (often
// by tuple index, e.g. openingCornerRadii[0]). The scene is applied with
// `setScene(as any)` which SKIPS Zod parsing, so these defaults are NOT
// auto-filled — any field the generator omits arrives as `undefined` and the
// renderer crashes ("Cannot read properties of undefined (reading '0')").
// We fill them here so doors/windows render reliably regardless of how
// complete the generated node is.
const DOOR_DEFAULTS: Record<string, unknown> = {
  rotation: [0, 0, 0],
  width: 0.9,
  height: 2.1,
  doorCategory: 'interior',
  doorType: 'hinged',
  leafCount: 1,
  operationState: 0,
  slideDirection: 'left',
  trackStyle: 'none',
  garagePanelCount: 4,
  openingKind: 'door',
  openingShape: 'rectangle',
  openingRadiusMode: 'all',
  openingTopRadii: [0.15, 0.15],
  cornerRadius: 0.15,
  archHeight: 0.45,
  openingRevealRadius: 0.025,
  frameThickness: 0.05,
  frameDepth: 0.07,
  threshold: true,
  thresholdHeight: 0.02,
  hingesSide: 'left',
  swingDirection: 'inward',
  swingAngle: 0,
  handle: true,
  handleHeight: 1.05,
  handleSide: 'right',
  contentPadding: [0.04, 0.04],
  doorCloser: false,
  panicBar: false,
  panicBarHeight: 1.0,
}

const SEGMENT_DEFAULTS: Record<string, unknown> = {
  type: 'panel',
  heightRatio: 1,
  columnRatios: [1],
  dividerThickness: 0.03,
  panelDepth: 0.01,
  panelInset: 0.04,
}

const DEFAULT_DOOR_SEGMENTS = [
  { ...SEGMENT_DEFAULTS, heightRatio: 0.4 },
  { ...SEGMENT_DEFAULTS, heightRatio: 0.6 },
]

const WINDOW_DEFAULTS: Record<string, unknown> = {
  rotation: [0, 0, 0],
  width: 1.5,
  height: 1.5,
  openingKind: 'window',
  windowType: 'fixed',
  operationState: 0,
  awningDirection: 'up',
  casementStyle: 'single',
  hingesSide: 'left',
  openingShape: 'rectangle',
  openingRadiusMode: 'all',
  openingCornerRadii: [0.15, 0.15, 0.15, 0.15],
  cornerRadius: 0.15,
  archHeight: 0.35,
  openingRevealRadius: 0.025,
  frameThickness: 0.05,
  frameDepth: 0.07,
  columnRatios: [1],
  rowRatios: [1],
  columnDividerThickness: 0.03,
  rowDividerThickness: 0.03,
  sill: true,
  sillDepth: 0.08,
  sillThickness: 0.03,
}

// Fill missing keys from defaults (generator-provided values always win).
function withDefaults(
  node: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node }
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === undefined || out[k] === null) out[k] = v
  }
  return out
}

// Normalize a scene so every node carries the fields its renderer expects.
// Keeps the structural shell (site/building/level/wall/slab/zone) plus
// doors and windows (completed with schema defaults). Item/furniture nodes
// need a fully-formed `asset` object to render; they are dropped unless that
// is present, so a partial item can never crash the render loop.
function sanitizeSceneForViewer(scene: SceneGraph): SceneGraph {
  const STRUCTURAL = new Set(['site', 'building', 'level', 'wall', 'slab', 'zone'])
  // Rich structural extras (roof/ceiling/stair/column/shelf + their segment
  // children). These were previously dropped, leaving a flat open-top box.
  // We keep them via the real Zod schema (AnyNode.safeParse), which fills
  // every default and validates — partial generator output that would crash
  // the renderer fails validation and is dropped defensively instead.
  const RICH = new Set([
    'roof',
    'roof-segment',
    'ceiling',
    'stair',
    'stair-segment',
    'column',
    'shelf',
  ])
  const nodes: Record<string, unknown> = {}

  for (const [id, raw] of Object.entries(scene.nodes)) {
    const node = raw as Record<string, unknown> | null
    if (!node || typeof node !== 'object') continue
    const type = node.type as string

    if (STRUCTURAL.has(type)) {
      nodes[id] = { ...node }
    } else if (type === 'door') {
      const d = withDefaults(node, DOOR_DEFAULTS)
      const segs = Array.isArray(d.segments) && d.segments.length > 0 ? d.segments : DEFAULT_DOOR_SEGMENTS
      d.segments = (segs as Record<string, unknown>[]).map((s) => withDefaults(s, SEGMENT_DEFAULTS))
      nodes[id] = d
    } else if (type === 'window') {
      nodes[id] = withDefaults(node, WINDOW_DEFAULTS)
    } else if (type === 'item') {
      // Only keep items that already carry a full asset descriptor.
      const asset = node.asset as Record<string, unknown> | undefined
      if (asset && typeof asset === 'object' && asset.src) {
        nodes[id] = { ...node }
      }
      // else: drop partial item silently
    } else if (RICH.has(type)) {
      const parsed = AnyNode.safeParse(node)
      if (parsed.success) nodes[id] = parsed.data
      // else: drop node that fails schema validation
    }
    // unknown types are dropped
  }

  // Drop child references that point at nodes we removed.
  for (const id of Object.keys(nodes)) {
    const node = nodes[id] as Record<string, unknown>
    if (Array.isArray(node.children)) {
      node.children = (node.children as string[]).filter((cid) => nodes[cid] !== undefined)
    }
  }

  const rootNodeIds = scene.rootNodeIds.filter((id) => nodes[id] !== undefined)
  return { nodes, rootNodeIds } as SceneGraph
}

// Decode the `?scene=` parameter end-to-end and return parsed SceneGraph,
// auto-detecting gzip vs raw UTF-8 JSON. Returns null when decoding fails
// or the resulting object is not a valid SceneGraph shape.
async function decodeSceneParam(value: string): Promise<SceneGraph | null> {
  try {
    let bytes = decodeBase64UrlToBytes(value)
    // gzip magic number: first two bytes are 0x1f 0x8b
    const isGzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
    if (isGzipped) {
      bytes = await gunzipBytes(bytes)
    }
    const json = new TextDecoder('utf-8').decode(bytes)
    const parsed = JSON.parse(json) as Partial<SceneGraph>
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
    return sanitizeSceneForViewer(parsed as SceneGraph)
  } catch (err) {
    console.error('[embed] Failed to decode scene param:', err)
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

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-param' }
  | { kind: 'parse-error' }
  | { kind: 'ready'; scene: SceneGraph }

export default function EmbedClient() {
  const searchParams = useSearchParams()
  const sceneParam = searchParams?.get('scene') ?? null
  const sourceLabel = searchParams?.get('source') ?? null
  // Clean presentation mode is ON by default for the embed (it exists to show
  // a polished render to external apps). Pass `?clean=0` to restore editor
  // chrome (grid, dimension lines, zone name labels) for debugging.
  const cleanMode = (searchParams?.get('clean') ?? '1') !== '0'

  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  // Apply / restore presentation chrome toggles. These flags are not
  // persisted (see use-viewer partialize), so this never leaks into the
  // main editor — each load starts with chrome on and we flip it here.
  useEffect(() => {
    const apply = () => {
      const v = useViewer.getState()
      v.setShowGrid(!cleanMode)
      v.setShowMeasurements(!cleanMode)
      v.setShowZoneLabels(!cleanMode)
      // Colour the embed by surface role (floors/furniture/doors/windows) using
      // the vivid 'pascal-color' theme. Role colours apply only when textures
      // are off, so force that here for the presentation embed.
      v.setTextures(false)
      v.setSceneTheme('pascal-color')
    }
    apply()
    // The Editor re-initialises chrome (grid / dimension lines / zone labels)
    // when it mounts on scene load, which happens AFTER this effect's first
    // run and would otherwise clobber clean mode. Re-apply once the scene is
    // ready and again on short delays so clean mode reliably wins the race.
    const timers = [setTimeout(apply, 120), setTimeout(apply, 600)]
    return () => timers.forEach(clearTimeout)
  }, [cleanMode, state.kind])

  // Decode scene parameter asynchronously (gzip inflation requires
  // DecompressionStream which is Promise-based).
  useEffect(() => {
    if (!sceneParam) {
      setState({ kind: 'no-param' })
      return
    }
    let cancelled = false
    setState({ kind: 'loading' })
    decodeSceneParam(sceneParam).then((scene) => {
      if (cancelled) return
      if (!scene) {
        setState({ kind: 'parse-error' })
      } else {
        setState({ kind: 'ready', scene })
      }
    })
    return () => {
      cancelled = true
    }
  }, [sceneParam])

  // Stable scene reference for Editor's onLoad callback.
  const readyScene = state.kind === 'ready' ? state.scene : null
  const handleLoad = useCallback(async (): Promise<SceneGraph> => {
    if (readyScene) return readyScene
    return { nodes: {}, rootNodeIds: [] }
  }, [readyScene])

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <div className="text-muted-foreground text-sm">Loading scene...</div>
        </div>
      </div>
    )
  }

  if (state.kind === 'no-param') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 text-center shadow-xl">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
            Embed mode
          </p>
          <h1 className="mt-2 font-semibold text-lg">No scene to display</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            This route expects a <code className="font-mono">?scene=</code> URL
            parameter with a base64-encoded SceneGraph JSON (gzipped or raw).
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

  if (state.kind === 'parse-error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 text-center shadow-xl">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
            Embed mode &mdash; error
          </p>
          <h1 className="mt-2 font-semibold text-lg">Invalid scene data</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            The provided <code className="font-mono">?scene=</code> parameter
            could not be decoded as a valid SceneGraph JSON. Supported encodings
            are base64url of raw JSON, or base64url of gzipped JSON. The decoded
            object must include <code className="font-mono">nodes</code> and{' '}
            <code className="font-mono">rootNodeIds</code>.
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

  // state.kind === 'ready'
  return (
    <div className="relative h-screen w-screen">
      <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
          <span className="text-muted-foreground">
            {sourceLabel ? `Embedded from ${sourceLabel}` : 'Embedded scene'} &mdash;
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

      {/*
        On-screen camera controls. These drive the camera through the core
        event bus, so they work identically with a mouse, a laptop trackpad
        (where Safari/macOS make drag-rotate and pinch-zoom unreliable), and
        touch on tablets. Buttons are 44px+ for comfortable tapping.
      */}
      <div className="pointer-events-none absolute right-3 bottom-3 z-40 flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/90 shadow-lg backdrop-blur">
          <ControlButton
            label="Apropie (zoom +)"
            onClick={() => emitter.emit('camera-controls:zoom', { factor: 1 })}
          >
            <ZoomIn className="h-5 w-5" />
          </ControlButton>
          <div className="h-px bg-border/60" />
          <ControlButton
            label="Departe (zoom -)"
            onClick={() => emitter.emit('camera-controls:zoom', { factor: -1 })}
          >
            <ZoomOut className="h-5 w-5" />
          </ControlButton>
        </div>

        <div className="pointer-events-auto flex overflow-hidden rounded-2xl border border-border/60 bg-background/90 shadow-lg backdrop-blur">
          <ControlButton
            label="Rotește stânga"
            onClick={() => emitter.emit('camera-controls:orbit-ccw', undefined)}
          >
            <RotateCcw className="h-5 w-5" />
          </ControlButton>
          <div className="w-px bg-border/60" />
          <ControlButton
            label="Rotește dreapta"
            onClick={() => emitter.emit('camera-controls:orbit-cw', undefined)}
          >
            <RotateCw className="h-5 w-5" />
          </ControlButton>
        </div>

        <div className="pointer-events-auto flex overflow-hidden rounded-2xl border border-border/60 bg-background/90 shadow-lg backdrop-blur">
          <ControlButton
            label="Vedere de sus / 3D"
            onClick={() => emitter.emit('camera-controls:top-view', undefined)}
          >
            <Layers className="h-5 w-5" />
          </ControlButton>
          <div className="w-px bg-border/60" />
          <ControlButton
            label="Încadrează tot (reset)"
            onClick={() => emitter.emit('camera-controls:fit-scene', {})}
          >
            <Maximize className="h-5 w-5" />
          </ControlButton>
        </div>
      </div>
    </div>
  )
}

// A single large, touch-friendly camera-control button.
function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center text-foreground/80 transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80"
    >
      {children}
    </button>
  )
}
