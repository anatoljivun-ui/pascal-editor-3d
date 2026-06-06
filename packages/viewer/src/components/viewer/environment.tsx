'use client'

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  type DataTexture as DataTextureType,
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
} from 'three/webgpu'
import useViewer from '../../store/use-viewer'

// Image-based lighting for the photoreal ("rendered") shading mode. We don't
// ship an HDRI asset — instead we synthesize a small equirectangular sky→
// horizon→ground gradient as a half-float texture and hand it to
// `scene.environment`. three/webgpu prefilters it on the GPU (PMREMNode), so
// every MeshStandardNodeMaterial picks up roughness-correct IBL: soft sky fill
// from above, a warm horizon band that shows up as a gentle reflection on
// glossier surfaces, and a darker ground bounce. RGBA16F (not Float32) so the
// texture stays filterable on WebGPU without the float32-filterable feature.
//
// Only active in `rendered`; `solid` (the embed default) leaves
// `scene.environment` null so the pascal-color Lambert look is untouched.

// Overall IBL strength. Kept modest so it fills shadowed areas and adds subtle
// reflections without flattening the directional key light or the SSGI contact
// shadows. Tunable.
const ENV_INTENSITY = 0.55

// Linear-light radiance triplets for the three gradient stops. Authored
// directly in linear space (not sRGB hex) so they feed the IBL math correctly.
const ZENITH: [number, number, number] = [0.32, 0.46, 0.82] // sky overhead
const HORIZON: [number, number, number] = [0.82, 0.83, 0.8] // bright haze band
const GROUND: [number, number, number] = [0.13, 0.12, 0.11] // floor bounce

const ENV_WIDTH = 256
const ENV_HEIGHT = 128

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function createProceduralEnvTexture(): DataTextureType {
  const data = new Uint16Array(ENV_WIDTH * ENV_HEIGHT * 4)

  for (let y = 0; y < ENV_HEIGHT; y++) {
    // v runs 0 (nadir / straight down) → 1 (zenith / straight up) for an
    // equirectangular map with the default flipY=false data layout.
    const v = (y + 0.5) / ENV_HEIGHT
    let r: number
    let g: number
    let b: number
    if (v < 0.5) {
      const k = smoothstep(0, 0.5, v) // ground → horizon
      r = GROUND[0] + (HORIZON[0] - GROUND[0]) * k
      g = GROUND[1] + (HORIZON[1] - GROUND[1]) * k
      b = GROUND[2] + (HORIZON[2] - GROUND[2]) * k
    } else {
      const k = smoothstep(0.5, 1, v) // horizon → sky
      r = HORIZON[0] + (ZENITH[0] - HORIZON[0]) * k
      g = HORIZON[1] + (ZENITH[1] - HORIZON[1]) * k
      b = HORIZON[2] + (ZENITH[2] - HORIZON[2]) * k
    }

    const rHalf = DataUtils.toHalfFloat(r)
    const gHalf = DataUtils.toHalfFloat(g)
    const bHalf = DataUtils.toHalfFloat(b)
    const aHalf = DataUtils.toHalfFloat(1)
    for (let x = 0; x < ENV_WIDTH; x++) {
      const i = (y * ENV_WIDTH + x) * 4
      data[i] = rHalf
      data[i + 1] = gHalf
      data[i + 2] = bHalf
      data[i + 3] = aHalf
    }
  }

  const texture = new DataTexture(data, ENV_WIDTH, ENV_HEIGHT, RGBAFormat, HalfFloatType)
  texture.mapping = EquirectangularReflectionMapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export function Environment() {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const shading = useViewer((state) => state.shading)

  const envTexture = useMemo(() => createProceduralEnvTexture(), [])

  useEffect(() => {
    return () => {
      envTexture.dispose()
    }
  }, [envTexture])

  useEffect(() => {
    const enabled = shading === 'rendered'
    scene.environment = enabled ? envTexture : null
    scene.environmentIntensity = enabled ? ENV_INTENSITY : 1
    invalidate()
    return () => {
      scene.environment = null
      scene.environmentIntensity = 1
    }
  }, [scene, shading, envTexture, invalidate])

  return null
}
