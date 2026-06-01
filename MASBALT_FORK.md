# Pascal Editor 3D — Masbalt Fork

This is a fork of [pascalorg/editor](https://github.com/pascalorg/editor) with a single addition: an `/embed` route that loads SceneGraph data from a URL parameter, enabling external integrations.

## Why this fork?

The upstream Pascal Editor expects scenes to be created interactively or loaded from its own backend API. For the **Deviz Masbalt** integration, we needed a way to programmatically generate a 3D scene from an AI estimate and open it instantly — without going through Pascal's auth/backend layer.

This fork adds a single new route (`/embed`) that accepts a base64-encoded SceneGraph JSON via the `?scene=` URL parameter and hydrates Pascal's Editor component with it. No other code is modified.

## Embed endpoint

```
https://<deployment-url>/embed?scene=<base64-encoded-json>[&source=<label>]
```

- **`scene`** (required): Base64-encoded JSON conforming to the Pascal `SceneGraph` shape:
  ```typescript
  type SceneGraph = {
    nodes: Record<string, unknown>  // All scene nodes (Site, Building, Level, Wall, ...)
    rootNodeIds: string[]           // Top-level node IDs (typically site IDs)
  }
  ```
- **`source`** (optional): Free-form label shown to the user (e.g. `"Deviz Masbalt"`) for branding context.

The route handles URL-safe base64 (with `-` and `_` substitutions) and missing padding automatically.

### Example client code (JavaScript)

```javascript
const sceneGraph = {
  nodes: {
    site_1:    { id: 'site_1', type: 'Site', parentId: null, children: ['building_1'] },
    building_1:{ id: 'building_1', type: 'Building', parentId: 'site_1', children: ['level_1'] },
    level_1:   { id: 'level_1', type: 'Level', parentId: 'building_1', height: 2.7, children: ['wall_1', 'slab_1'] },
    wall_1:    { id: 'wall_1', type: 'Wall', parentId: 'level_1', start: [0, 0], end: [5, 0], thickness: 0.15 },
    slab_1:    { id: 'slab_1', type: 'Slab', parentId: 'level_1', polygon: [[0,0],[5,0],[5,4],[0,4]] },
  },
  rootNodeIds: ['site_1'],
}

const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(sceneGraph))))
const url = `https://pascal-editor-3d.vercel.app/embed?scene=${encoded}&source=Deviz%20Masbalt`
window.open(url, '_blank')
```

### Error handling

- Missing `?scene=` parameter → friendly message with link to `/scenes` and `/`
- Invalid base64 or invalid SceneGraph shape → clear error message with link to empty editor
- All errors are logged to the browser console under the `[embed]` prefix for debugging

## Local development

Same as upstream:

```bash
bun install
bun dev
```

Test the embed route locally:

```
http://localhost:3000/embed?scene=eyJub2RlcyI6e30sInJvb3ROb2RlSWRzIjpbXX0=
```

(The example above decodes to `{"nodes":{},"rootNodeIds":[]}` — an empty scene.)

## Deployment

This fork deploys to Vercel as a standard Next.js application:

- **Framework preset**: Next.js
- **Root directory**: `apps/editor`
- **Build command**: `cd ../.. && bun run build --filter=editor` (or `turbo build --filter=editor`)
- **Install command**: `bun install`
- **Node version**: 20 or later (Bun runtime should also work)

If Bun is unavailable on the build environment, fallback to `npm install` and `npm run build`.

### Required environment variables

The embed route itself requires **no environment variables** — it works purely client-side from URL parameters.

Standard Pascal Editor env vars (from `.env.example`) only affect the `/scene/[id]` route and the `/api/scenes/*` endpoints, which are not used by `/embed`.

## Keeping in sync with upstream

To pull updates from `pascalorg/editor`:

```bash
git remote add upstream https://github.com/pascalorg/editor.git
git fetch upstream
git merge upstream/main
git push origin main
```

Only the `apps/editor/app/embed/page.tsx` file is added by this fork. All other code remains identical to upstream, so conflicts during upstream pulls are unlikely.

## License

MIT — same as upstream Pascal Editor. See `LICENSE` file.

## Credits

- Upstream project: [pascalorg/editor](https://github.com/pascalorg/editor)
- This fork: maintained for the Deviz Masbalt / Ditrade Moldova construction ERP integration
