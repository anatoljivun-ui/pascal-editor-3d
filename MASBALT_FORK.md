# Pascal Editor 3D — Masbalt Fork

This is a fork of [pascalorg/editor](https://github.com/pascalorg/editor) with two additions:

1. An `/embed` route that loads SceneGraph data from a URL parameter
2. **HMAC token authentication** to restrict access to authorized callers (Masbalt deployments)

## Why this fork?

The upstream Pascal Editor expects scenes to be created interactively or loaded from its own backend API. For the **Deviz Masbalt** integration, we needed a way to programmatically generate a 3D scene from an AI estimate and open it instantly — without going through Pascal's auth/backend layer.

This fork adds a single new route (`/embed`) that:
- Accepts a base64-encoded SceneGraph JSON via the `?scene=` URL parameter
- **Requires** a valid HMAC token (`?token=`) issued by a trusted Masbalt deployment
- Hydrates Pascal's Editor component with the decoded scene

The rest of the upstream codebase is unchanged.

## Required environment variable

```
MASBALT_HMAC_SECRET=<shared-secret-string>
```

Set this in **both**:
- The Pascal Editor 3D Vercel project (for token validation)
- The Deviz Masbalt Vercel project (for token generation)

Both projects must use **the same secret** so HMAC validation succeeds across the boundary.

**Recommended**: generate a 64-character random string. Example (do not use this exact value):
```
openssl rand -hex 32
# → e.g. f3a8c2e9b1d4f7a6c5e8b1d4f7a6c5e8b1d4f7a6c5e8b1d4f7a6c5e8b1d4f7a6
```

## Embed endpoint

```
https://<deployment-url>/embed?scene=<base64-encoded-json>&token=<hmac-token>[&source=<label>]
```

### Parameters

| Param   | Required | Description |
|---------|----------|-------------|
| `scene` | yes      | Base64-encoded JSON conforming to the Pascal `SceneGraph` shape: `{ nodes: Record<string, unknown>, rootNodeIds: string[] }` |
| `token` | yes      | HMAC token issued by Masbalt: `<payload_base64url>.<hmac_sha256_hex>` |
| `source`| no       | Free-form label shown to the user (e.g. `"Deviz Masbalt"`) for branding context |

### Token format

The token has two parts separated by a `.`:

```
<payload_base64url>.<hmac_sha256_hex>
```

**Payload** (decoded base64url) is a JSON object:
```json
{
  "userId":  "alexandru",
  "devizId": "deviz_xyz123",
  "exp":     1735689600
}
```

**Signature** is `hmac_sha256(payload_base64url, MASBALT_HMAC_SECRET)` in lowercase hex.

The `exp` field (Unix timestamp in seconds) is checked server-side. Recommended TTL: **24 hours**.

### Generating a token in Masbalt (Node.js)

```javascript
import crypto from 'node:crypto'

function generateEmbedToken({ userId, devizId, ttlSeconds = 86400 }) {
  const payload = {
    userId,
    devizId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payloadStr = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadStr, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '') // base64url, no padding

  const secret = process.env.MASBALT_HMAC_SECRET
  if (!secret) throw new Error('MASBALT_HMAC_SECRET not configured')

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('hex')

  return `${payloadB64}.${signature}`
}

// Example usage when opening Pascal:
const sceneB64 = btoa(JSON.stringify(sceneGraph))
const token = generateEmbedToken({ userId: 'alexandru', devizId: 'deviz_xyz' })
const url = `https://pascal-editor-3d-editor.vercel.app/embed?scene=${sceneB64}&token=${token}&source=Deviz%20Masbalt`
window.open(url, '_blank')
```

### Validation errors

If the token is missing or invalid, the route renders an "Access denied" screen with one of the following reasons (shown in the footer for debugging):

| Reason          | Meaning |
|-----------------|---------|
| `no_token`      | No `?token=` parameter in the URL |
| `no_secret`     | Server is missing `MASBALT_HMAC_SECRET` env var (misconfiguration) |
| `malformed`     | Token does not have the expected `<payload>.<signature>` shape, or payload isn't valid JSON |
| `bad_signature` | HMAC signature does not match (token forged or wrong secret) |
| `expired`       | `payload.exp` is in the past |

## Local development

Same as upstream:

```bash
bun install
bun dev
```

For local testing of the embed route, set the secret in `.env.local`:

```
MASBALT_HMAC_SECRET=local-dev-secret-change-me
```

Then generate a test token (Node REPL):

```javascript
const crypto = require('node:crypto')
const secret = 'local-dev-secret-change-me'
const payload = JSON.stringify({ userId: 'test', devizId: 'test', exp: Math.floor(Date.now()/1000) + 3600 })
const payloadB64 = Buffer.from(payload).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex')
console.log(`${payloadB64}.${sig}`)
```

Open:
```
http://localhost:3000/embed?scene=eyJub2RlcyI6e30sInJvb3ROb2RlSWRzIjpbXX0=&token=<generated-token>
```

## Deployment

Standard Next.js deployment on Vercel:

- **Framework preset**: Next.js
- **Root directory**: `apps/editor`
- **Build command**: `cd ../.. && npx -y bun@1.3.13 run build --filter=editor` (from `vercel.json`)
- **Install command**: `cd ../.. && npx -y bun@1.3.13 install --frozen-lockfile`
- **Node version**: 20 or later

### Required environment variables on Vercel

| Variable | Required | Notes |
|----------|----------|-------|
| `MASBALT_HMAC_SECRET` | **yes** | Without this, all `/embed` requests are rejected with `no_secret` |

All other Pascal env vars from `.env.example` (Google Maps API key, etc.) are optional and only affect features not used by the `/embed` route.

## Keeping in sync with upstream

```bash
git remote add upstream https://github.com/pascalorg/editor.git
git fetch upstream
git merge upstream/main
git push origin main
```

Only `apps/editor/app/embed/` is added by this fork. Upstream merges are unlikely to conflict.

## License

MIT — same as upstream Pascal Editor.

## Credits

- Upstream project: [pascalorg/editor](https://github.com/pascalorg/editor)
- This fork: maintained for the Deviz Masbalt / Ditrade Moldova construction ERP integration
