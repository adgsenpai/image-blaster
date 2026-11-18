import * as THREE from 'three'

/**
 * Facade detail textures drawn on canvas: Cape Malay / Bo-Kaap terraced house
 * fronts with sash windows, burglar bars, panelled doors, string courses and
 * pilasters. The wall itself is transparent so one texture works on any
 * plaster colour; lit windows go into the emissive map.
 */
const PX_PER_M = 64

export interface FacadeTextures {
  map: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
}

const cache = new Map<string, FacadeTextures>()

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
}

function sashWindow(
  ctx: CanvasRenderingContext2D,
  em: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, trim: string, lit: boolean, bars: boolean, rnd: () => number,
) {
  const f = Math.max(4, w * 0.07)
  // Moulded surround.
  rect(ctx, x - f * 1.6, y - f * 1.6, w + f * 3.2, h + f * 3.2, trim)
  rect(ctx, x - f * 2.2, y + h + f * 1.2, w + f * 4.4, f * 1.4, trim) // sill
  // Glass: dark reflective blue, or warm interior light.
  const g = ctx.createLinearGradient(x, y, x, y + h)
  if (lit) {
    g.addColorStop(0, '#f2c27a')
    g.addColorStop(1, '#c9873f')
  } else {
    g.addColorStop(0, '#1c2533')
    g.addColorStop(0.5, '#0f151f')
    g.addColorStop(1, '#202a38')
  }
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  if (lit) {
    em.fillStyle = rnd() < 0.5 ? '#ffb866' : '#ffcf8f'
    em.fillRect(x, y, w, h)
    // Curtain shadow.
    ctx.fillStyle = 'rgba(90,40,20,0.45)'
    ctx.fillRect(x, y, w * (0.2 + rnd() * 0.25), h)
    em.fillStyle = 'rgba(0,0,0,0.55)'
    em.fillRect(x, y, w * 0.2, h)
  }
  // Sash bars: 6-over-6 panes.
  ctx.fillStyle = trim
  const bar = Math.max(2, w * 0.035)
  ctx.fillRect(x, y + h / 2 - bar, w, bar * 2)
  for (let i = 1; i < 3; i++) ctx.fillRect(x + (w * i) / 3 - bar / 2, y, bar, h)
  for (const yy of [y + h / 4, y + (h * 3) / 4]) ctx.fillRect(x, yy - bar / 2, w, bar)
  em.fillStyle = '#000'
  em.fillRect(x, y + h / 2 - bar, w, bar * 2)
  // Burglar bars (very common on these streets).
  if (bars) {
    ctx.strokeStyle = 'rgba(20,20,22,0.9)'
    ctx.lineWidth = Math.max(2, w * 0.022)
    for (let i = 1; i < 6; i++) {
      ctx.beginPath()
      ctx.moveTo(x + (w * i) / 6, y - f)
      ctx.lineTo(x + (w * i) / 6, y + h + f)
      ctx.stroke()
    }
  }
}

function door(ctx: CanvasRenderingContext2D, em: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, trim: string, rnd: () => number) {
  const f = w * 0.09
  rect(ctx, x - f * 1.6, y - f * 1.6, w + f * 3.2, h + f * 1.6, trim)
  const woods = ['#4a2c1c', '#5a3a22', '#2f3d2e', '#2b3448', '#6b2a24']
  const wood = woods[Math.floor(rnd() * woods.length)]
  rect(ctx, x, y, w, h, wood)
  // Panels.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 3
  const pw = w * 0.36
  for (const px of [x + w * 0.09, x + w * 0.55]) {
    ctx.strokeRect(px, y + h * 0.42, pw, h * 0.48)
    ctx.strokeRect(px, y + h * 0.08, pw, h * 0.28)
  }
  // Fanlight.
  const fan = ctx.createLinearGradient(x, y - f * 5, x, y)
  fan.addColorStop(0, '#e9b06a')
  fan.addColorStop(1, '#a8682e')
  ctx.fillStyle = fan
  ctx.fillRect(x, y - f * 5.2, w, f * 3.4)
  em.fillStyle = '#c98a44'
  em.fillRect(x, y - f * 5.2, w, f * 3.4)
  // Security gate (as in the source photo).
  ctx.strokeStyle = 'rgba(25,25,28,0.95)'
  ctx.lineWidth = 3
  for (let i = 1; i < 7; i++) {
    ctx.beginPath()
    ctx.moveTo(x + (w * i) / 7, y)
    ctx.lineTo(x + (w * i) / 7, y + h)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(x, y + h * 0.5)
  ctx.lineTo(x + w, y + h * 0.5)
  ctx.stroke()
  // Step.
  rect(ctx, x - f * 2, y + h, w + f * 4, f * 1.2, '#8f8a82')
}

/** Facade texture for a house front `widthM` x `heightM`. */
export function facadeTextures(
  widthM: number, heightM: number, stories: number, bays: number, doorBay: number, trim: string, variant: number,
): FacadeTextures {
  const wQ = Math.max(3, Math.round(widthM))
  const hQ = Math.max(3, Math.round(heightM))
  const key = `${wQ}:${hQ}:${stories}:${bays}:${doorBay}:${trim}:${variant}`
  const hit = cache.get(key)
  if (hit) return hit

  let s = 0
  for (const ch of key) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }

  const W = Math.round(wQ * PX_PER_M)
  const H = Math.round(hQ * PX_PER_M)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const e = document.createElement('canvas')
  e.width = W
  e.height = H
  const em = e.getContext('2d')!
  em.fillStyle = '#000'
  em.fillRect(0, 0, W, H)

  const m = PX_PER_M
  // Pilasters at the party walls + cornice + plinth.
  const pil = 0.26 * m
  rect(ctx, 0, 0, pil, H, trim)
  rect(ctx, W - pil, 0, pil, H, trim)
  rect(ctx, 0, 0, W, 0.34 * m, trim)
  rect(ctx, 0, 0.34 * m, W, 0.08 * m, 'rgba(0,0,0,0.18)') // cornice shadow
  rect(ctx, 0, H - 0.42 * m, W, 0.42 * m, 'rgba(40,36,34,0.55)') // damp plinth
  if (variant % 2 === 0) {
    // Decorative parapet gable centre (Cape Malay style).
    ctx.fillStyle = trim
    ctx.beginPath()
    ctx.moveTo(W / 2 - 0.9 * m, 0.34 * m)
    ctx.quadraticCurveTo(W / 2, -0.2 * m, W / 2 + 0.9 * m, 0.34 * m)
    ctx.fill()
  }

  const storyH = (H - 0.34 * m) / stories
  for (let st = 0; st < stories; st++) {
    const top = 0.34 * m + st * storyH
    const ground = st === stories - 1
    if (st > 0) rect(ctx, 0, top - 0.06 * m, W, 0.14 * m, trim) // string course
    const bayW = (W - pil * 2) / bays
    for (let b = 0; b < bays; b++) {
      const cx = pil + bayW * (b + 0.5)
      if (ground && b === doorBay) {
        const dw = Math.min(1.05 * m, bayW * 0.7)
        const dh = Math.min(2.2 * m, storyH * 0.78)
        door(ctx, em, cx - dw / 2, top + storyH - dh - 0.18 * m, dw, dh, trim, rnd)
      } else {
        const ww = Math.min(1.0 * m, bayW * 0.6)
        const wh = Math.min(1.55 * m, storyH * 0.55)
        const wy = top + storyH * (ground ? 0.3 : 0.25)
        sashWindow(ctx, em, cx - ww / 2, wy, ww, wh, trim, rnd() < 0.38, ground && rnd() < 0.75, rnd)
      }
    }
    // Balcony railing on some upper floors.
    if (!ground && variant === 3) {
      const ry = top + storyH * 0.82
      rect(ctx, pil, ry, W - pil * 2, 0.07 * m, '#1d1d20')
      ctx.strokeStyle = '#1d1d20'
      ctx.lineWidth = 3
      for (let x = pil; x < W - pil; x += 0.16 * m) {
        ctx.beginPath()
        ctx.moveTo(x, ry)
        ctx.lineTo(x, ry + 0.85 * m)
        ctx.stroke()
      }
    }
  }

  // Weathering: rain streaks under sills, grime toward the ground, darker party-wall corners.
  ctx.globalCompositeOperation = 'source-atop'
  const grime = ctx.createLinearGradient(0, 0, 0, H)
  grime.addColorStop(0, 'rgba(0,0,0,0.12)')
  grime.addColorStop(0.7, 'rgba(0,0,0,0)')
  grime.addColorStop(1, 'rgba(0,0,0,0.25)')
  ctx.fillStyle = grime
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  for (let i = 0; i < W / 18; i++) {
    const x = rnd() * W
    const y0 = 0.4 * m + rnd() * H * 0.6
    const len = (0.4 + rnd() * 1.4) * m
    const streak = ctx.createLinearGradient(x, y0, x, y0 + len)
    streak.addColorStop(0, 'rgba(20,18,16,0.22)')
    streak.addColorStop(1, 'rgba(20,18,16,0)')
    ctx.fillStyle = streak
    ctx.fillRect(x, y0, 1.5 + rnd() * 3, len)
  }
  const corner = ctx.createLinearGradient(0, 0, W, 0)
  corner.addColorStop(0, 'rgba(0,0,0,0.28)')
  corner.addColorStop(0.06, 'rgba(0,0,0,0)')
  corner.addColorStop(0.94, 'rgba(0,0,0,0)')
  corner.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.fillStyle = corner
  ctx.fillRect(0, 0, W, H)

  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const emissive = new THREE.CanvasTexture(e)
  emissive.colorSpace = THREE.SRGBColorSpace
  const tex = { map, emissive }
  cache.set(key, tex)
  return tex
}
