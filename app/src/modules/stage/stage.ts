/**
 * Procedural stage that extends a single-image world into a full neighbourhood.
 *
 * The splat world is clipped to the box it reconstructed cleanly; everything
 * beyond is real geometry laid out in the same street frame (u along the
 * street, v across it) so it lines up with the scanned street.
 */
export interface StageConfig {
  /** Splats outside this street-space box are hidden (the smeared part). */
  clip: { uMin: number; uMax: number; vMin: number; vMax: number; yMax: number }
  /** Cross-section of the scanned street, in v (metres from the arena origin). */
  street: { left: number; right: number; roadLeft: number; roadRight: number; curb: number }
  /** Cross streets at these u positions (a natural break where the scan ends). */
  crossStreets: { u: number; width: number }[]
  /** How far the generated city extends. */
  extent: { front: number; back: number; side: number }
  fog: { color: string; density: number }
  /** Facade plaster colours. */
  palette: string[]
  seed?: number
  rain?: boolean
  /** Experimental: hide splats outside `clip` at render time with a Spark SplatEdit. Prefer `splat`. */
  clipSplats?: boolean
  /** Pre-clipped splat file (local-gen/clip_splats.py), relative to the world folder. */
  splat?: string
}

export interface HouseSpec {
  /** Street-space centre of the facade line. */
  u: number
  v: number
  /** Facade faces +u, -u, +v or -v (street side). */
  face: 'u+' | 'u-' | 'v+' | 'v-'
  width: number
  height: number
  depth: number
  stories: number
  bays: number
  color: string
  trim: string
  door: number
  lantern: boolean
  variant: number
}

export interface StripSpec {
  /** Street-space rectangle. */
  u0: number
  u1: number
  v0: number
  v1: number
  y: number
  kind: 'road' | 'sidewalk' | 'curb'
}

export interface PropSpec {
  kind: 'lamp' | 'planter' | 'potted' | 'barrier'
  u: number
  v: number
  rot: number
}

export interface StageLayout {
  houses: HouseSpec[]
  strips: StripSpec[]
  props: PropSpec[]
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DEPTH = 9
const TRIM = ['#f3eee4', '#ece5d6', '#f6f2ea']

/** Lay out a row of terraced houses along a facade line. */
function row(
  out: HouseSpec[],
  rnd: () => number,
  palette: string[],
  face: HouseSpec['face'],
  line: number,
  from: number,
  to: number,
  depth = DEPTH,
) {
  const dir = Math.sign(to - from)
  let pos = from
  let last = ''
  while ((to - pos) * dir > 2.5) {
    const width = Math.min(Math.abs(to - pos), 4.2 + rnd() * 3.4)
    const stories = rnd() < 0.42 ? 2 : 1
    const height = stories === 2 ? 6.4 + rnd() * 1.4 : 3.9 + rnd() * 1.1
    let color = palette[Math.floor(rnd() * palette.length)]
    if (color === last) color = palette[(palette.indexOf(color) + 1) % palette.length]
    last = color
    const bays = width > 6.4 ? 3 : width > 4.8 ? 2 : 1
    const center = pos + (dir * width) / 2
    const isU = face === 'u+' || face === 'u-'
    out.push({
      u: isU ? line : center,
      v: isU ? center : line,
      face,
      width,
      height,
      depth,
      stories,
      bays,
      color,
      trim: TRIM[Math.floor(rnd() * TRIM.length)],
      door: Math.floor(rnd() * bays),
      lantern: rnd() < 0.5,
      variant: Math.floor(rnd() * 4),
    })
    pos += dir * width
  }
}

export function buildLayout(cfg: StageConfig): StageLayout {
  const rnd = mulberry32(cfg.seed ?? 1337)
  const { street, clip, extent } = cfg
  const houses: HouseSpec[] = []
  const strips: StripSpec[] = []
  const props: PropSpec[] = []
  const crosses = [...cfg.crossStreets].sort((a, b) => a.u - b.u)
  const front = crosses.find((c) => c.u > clip.uMax - 1)
  const back = [...crosses].reverse().find((c) => c.u < clip.uMin + 1)
  const frontStart = front ? front.u + front.width / 2 : clip.uMax
  const backStart = back ? back.u - back.width / 2 : clip.uMin
  const sideDepth = DEPTH

  // Main street blocks beyond the cross streets (both sides).
  for (const [from, to] of [[frontStart, extent.front], [backStart, -extent.back]] as const) {
    row(houses, rnd, cfg.palette, 'v+', street.left, from, to) // left side faces +v
    row(houses, rnd, cfg.palette, 'v-', street.right, from, to) // right side faces -v
  }

  // Cross streets: facades on both sides, running out to the side extent.
  for (const c of crosses) {
    const near = c.u > 0 ? c.u - c.width / 2 : c.u + c.width / 2
    const far = c.u > 0 ? c.u + c.width / 2 : c.u - c.width / 2
    const nearFace = c.u > 0 ? 'u+' : 'u-'
    const farFace = c.u > 0 ? 'u-' : 'u+'
    // Near side: thin house fronts cap the clipped scan houses (no deep boxes inside
    // the clean zone), then full-depth houses continue outwards past the clip box.
    row(houses, rnd, cfg.palette, nearFace, near, street.left, clip.vMin, 0.7)
    row(houses, rnd, cfg.palette, nearFace, near, street.right, clip.vMax, 0.7)
    row(houses, rnd, cfg.palette, nearFace, near, clip.vMin, -extent.side)
    row(houses, rnd, cfg.palette, nearFace, near, clip.vMax, extent.side)
    // Far side: starts past the main street corner houses.
    row(houses, rnd, cfg.palette, farFace, far, street.left - sideDepth, -extent.side)
    row(houses, rnd, cfg.palette, farFace, far, street.right + sideDepth, extent.side)

    // Cross street ground: full-width road through the intersection, road + sidewalks beyond.
    const uA = Math.min(near, far)
    const uB = Math.max(near, far)
    strips.push({ u0: uA, u1: uB, v0: street.left, v1: street.right, y: 0, kind: 'road' })
    for (const [s0, s1] of [[-extent.side, street.left], [street.right, extent.side]]) {
      strips.push({ u0: uA + 1.5, u1: uB - 1.5, v0: s0, v1: s1, y: 0, kind: 'road' })
      strips.push({ u0: uA, u1: uA + 1.5, v0: s0, v1: s1, y: cfg.street.curb, kind: 'sidewalk' })
      strips.push({ u0: uB - 1.5, u1: uB, v0: s0, v1: s1, y: cfg.street.curb, kind: 'sidewalk' })
    }
    // Street lamps along the cross street.
    for (let v = 10; v < extent.side; v += 16) {
      props.push({ kind: 'lamp', u: uA + 0.7, v: -v, rot: 0 })
      props.push({ kind: 'lamp', u: uB - 0.7, v: v + 6, rot: Math.PI })
    }
  }

  // Main street ground: from the clip edge up to each intersection, then beyond it.
  const segments: [number, number][] = []
  const span = (a: number, b: number) => {
    if (b - a > 0.05) segments.push([a, b])
  }
  if (front) {
    span(clip.uMax - 0.3, front.u - front.width / 2)
    span(front.u + front.width / 2, extent.front)
  } else span(clip.uMax - 0.3, extent.front)
  if (back) {
    span(back.u + back.width / 2, clip.uMin + 0.3)
    span(-extent.back, back.u - back.width / 2)
  } else span(-extent.back, clip.uMin + 0.3)
  for (const [u0, u1] of segments) {
    strips.push({ u0, u1, v0: street.roadLeft, v1: street.roadRight, y: 0, kind: 'road' })
    strips.push({ u0, u1, v0: street.left, v1: street.roadLeft, y: street.curb, kind: 'sidewalk' })
    strips.push({ u0, u1, v0: street.roadRight, v1: street.right, y: street.curb, kind: 'sidewalk' })
  }

  // Lamps, planters and pots along the main street blocks.
  for (const [from, to] of [[frontStart + 4, extent.front], [backStart - 4, -extent.back]] as const) {
    const dir = Math.sign(to - from)
    let side = 0
    for (let u = from; (to - u) * dir > 0; u += dir * 15) {
      const left = side++ % 2 === 0
      props.push({ kind: 'lamp', u, v: left ? street.roadLeft - 0.45 : street.roadRight + 0.45, rot: left ? -Math.PI / 2 : Math.PI / 2 })
    }
    for (let u = from + dir * 3; (to - u) * dir > 0; u += dir * (6 + rnd() * 9)) {
      const left = rnd() < 0.5
      const v = left ? street.left + 0.55 : street.right - 0.55
      props.push({ kind: rnd() < 0.35 ? 'planter' : 'potted', u, v, rot: rnd() * Math.PI * 2 })
    }
  }

  return { houses, strips, props }
}
