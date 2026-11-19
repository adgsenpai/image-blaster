import * as THREE from 'three'

/**
 * A built back wall closing a scanned room where the scan only invented geometry:
 * plaster over a wood wainscot, a real double EXIT door with a lit sign and lamp,
 * and boarded windows either side. Local frame: wall centred on x = 0, floor y = 0,
 * room side is +z.
 */
export interface BackWallConfig {
  at: [number, number, number]
  width: number
  height: number
  rotY: number
}

function tex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(...repeat)
  }
  return t
}

let seed = 11
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

function plaster(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Weathered terracotta-red plaster with lighter patches, like the scanned walls.
  ctx.fillStyle = '#8c2f22'
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 900; i++) {
    const a = rnd() * 0.12
    ctx.fillStyle = rnd() < 0.5 ? `rgba(30,10,5,${a})` : `rgba(220,170,140,${a})`
    const r = 4 + rnd() * 40
    ctx.beginPath()
    ctx.ellipse(rnd() * w, rnd() * h, r, r * (0.4 + rnd()), rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 14; i++) {
    // Chipped patches showing pale plaster underneath.
    ctx.fillStyle = `rgba(200,180,155,${0.35 + rnd() * 0.3})`
    ctx.beginPath()
    const x = rnd() * w
    const y = rnd() * h
    ctx.moveTo(x, y)
    for (let k = 0; k < 7; k++) ctx.lineTo(x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 80)
    ctx.fill()
  }
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(20,8,4,${0.15 + rnd() * 0.2})`
    ctx.lineWidth = 1 + rnd() * 2
    ctx.beginPath()
    const x = rnd() * w
    ctx.moveTo(x, 0)
    ctx.lineTo(x + (rnd() - 0.5) * 30, h * (0.2 + rnd() * 0.6))
    ctx.stroke()
  }
}

function planks(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const n = 8
  for (let i = 0; i < n; i++) {
    const x = (i * w) / n
    const b = 0.75 + rnd() * 0.35
    ctx.fillStyle = `rgb(${Math.round(92 * b)},${Math.round(60 * b)},${Math.round(36 * b)})`
    ctx.fillRect(x, 0, w / n, h)
    for (let g = 0; g < 26; g++) {
      ctx.strokeStyle = `rgba(30,18,8,${0.15 + rnd() * 0.25})`
      ctx.lineWidth = 1
      ctx.beginPath()
      const gx = x + rnd() * (w / n)
      ctx.moveTo(gx, 0)
      ctx.bezierCurveTo(gx + (rnd() - 0.5) * 8, h / 3, gx + (rnd() - 0.5) * 8, (2 * h) / 3, gx + (rnd() - 0.5) * 6, h)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(15,8,3,0.85)'
    ctx.fillRect(x, 0, 3, h)
  }
}

function doorTex(ctx: CanvasRenderingContext2D, w: number, h: number) {
  planks(ctx, w, h)
  // Two recessed panels + scuffs + a stencilled warning.
  ctx.strokeStyle = 'rgba(20,10,4,0.8)'
  ctx.lineWidth = 10
  ctx.strokeRect(w * 0.14, h * 0.07, w * 0.72, h * 0.38)
  ctx.strokeRect(w * 0.14, h * 0.52, w * 0.72, h * 0.4)
  ctx.fillStyle = 'rgba(230,220,200,0.75)'
  ctx.font = `bold ${w * 0.11}px Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('KEEP', w / 2, h * 0.3)
  ctx.fillText('SHUT', w / 2, h * 0.38)
}

function exitTex(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#063a12'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#7dff9a'
  ctx.shadowColor = '#3dff6a'
  ctx.shadowBlur = 18
  ctx.font = `bold ${h * 0.68}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('EXIT', w * 0.58, h * 0.54)
  // Running-man-ish arrow.
  ctx.beginPath()
  ctx.moveTo(w * 0.06, h * 0.5)
  ctx.lineTo(w * 0.2, h * 0.22)
  ctx.lineTo(w * 0.2, h * 0.78)
  ctx.fill()
}

export function buildBackWall(cfg: BackWallConfig) {
  const { width: W, height: H } = cfg
  const g = new THREE.Group()
  g.position.set(...cfg.at)
  g.rotation.y = cfg.rotY
  const DOOR_W = 1.7
  const DOOR_H = 2.35
  const WAIN = 1.05

  const plasterMat = new THREE.MeshStandardMaterial({ map: tex(1024, 512, plaster, [W / 4, H / 2]), roughness: 0.95 })
  const woodMat = new THREE.MeshStandardMaterial({ map: tex(512, 256, planks, [W / 2, 1]), roughness: 0.8 })
  const trimMat = new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: 0.7 })

  // Wall slab with a door-shaped hole: build it from pieces around the doorway.
  const T = 0.18
  const side = (W - DOOR_W) / 2
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    g.add(m)
    return m
  }
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(side, H - WAIN, T), plasterMat, s * (DOOR_W / 2 + side / 2), WAIN + (H - WAIN) / 2, -T / 2)
    add(new THREE.BoxGeometry(side, WAIN, T + 0.03), woodMat, s * (DOOR_W / 2 + side / 2), WAIN / 2, -T / 2)
  }
  add(new THREE.BoxGeometry(DOOR_W, H - DOOR_H, T), plasterMat, 0, DOOR_H + (H - DOOR_H) / 2, -T / 2)
  // Chair rail along the top of the wainscot.
  add(new THREE.BoxGeometry(W, 0.06, 0.06), trimMat, 0, WAIN, 0.02)
  add(new THREE.BoxGeometry(W, 0.12, 0.04), trimMat, 0, 0.06, 0.01)

  // Door frame + two leaves (slightly ajar texture variety).
  add(new THREE.BoxGeometry(0.12, DOOR_H + 0.1, T + 0.08), trimMat, -DOOR_W / 2 - 0.02, DOOR_H / 2, -T / 2)
  add(new THREE.BoxGeometry(0.12, DOOR_H + 0.1, T + 0.08), trimMat, DOOR_W / 2 + 0.02, DOOR_H / 2, -T / 2)
  add(new THREE.BoxGeometry(DOOR_W + 0.28, 0.14, T + 0.08), trimMat, 0, DOOR_H + 0.05, -T / 2)
  const doorMat = new THREE.MeshStandardMaterial({ map: tex(256, 512, doorTex), roughness: 0.75 })
  const brass = new THREE.MeshStandardMaterial({ color: '#b08d3c', metalness: 0.9, roughness: 0.35 })
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(DOOR_W / 2 - 0.02, DOOR_H - 0.02, 0.06), doorMat, s * (DOOR_W / 4), DOOR_H / 2, -0.08)
    add(new THREE.BoxGeometry(0.04, 0.42, 0.05), brass, s * 0.1, 1.05, -0.02)
  }
  // Push bar across both leaves.
  add(new THREE.BoxGeometry(DOOR_W * 0.8, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#9a9a9a', metalness: 0.8, roughness: 0.4 }), 0, 1.0, 0.0)

  // Lit EXIT sign + its glow.
  const exit = add(new THREE.BoxGeometry(0.62, 0.24, 0.08),
    new THREE.MeshStandardMaterial({ color: '#0a2a10', emissive: '#ffffff', emissiveIntensity: 1.6, emissiveMap: tex(256, 100, exitTex), map: tex(256, 100, exitTex) }),
    0, DOOR_H + 0.32, 0.05)
  exit.name = 'exit-sign'
  const green = new THREE.PointLight('#45ff7a', 2.2, 3.2, 2)
  green.position.set(0, DOOR_H + 0.25, 0.45)
  g.add(green)

  // Warm caged wall lamps either side of the door.
  for (const s of [-1, 1]) {
    const lamp = new THREE.Group()
    lamp.position.set(s * (DOOR_W / 2 + 0.55), 2.05, 0.08)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffcf8a', emissive: '#ffb050', emissiveIntensity: 4 }))
    bulb.position.z = 0.12
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8, 1, true), new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.7, roughness: 0.5, wireframe: true }))
    cage.rotation.x = Math.PI / 2
    cage.position.z = 0.12
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 12), brass)
    plate.rotation.x = Math.PI / 2
    const light = new THREE.PointLight('#ffb35c', 3.5, 4.5, 2)
    light.position.z = 0.35
    lamp.add(bulb, cage, plate, light)
    g.add(lamp)
  }

  // Boarded windows either side.
  const glass = new THREE.MeshStandardMaterial({ color: '#0b1220', emissive: '#1a2740', emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.3 })
  const boardMats = ['#5a3d26', '#6b4a2e', '#4a3220'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }))
  for (const s of [-1, 1]) {
    const cx = s * (DOOR_W / 2 + side / 2 + 0.15)
    if (side < 1.4) continue
    add(new THREE.PlaneGeometry(1.1, 1.25), glass, cx, 1.85, 0.005)
    add(new THREE.BoxGeometry(1.24, 0.08, 0.1), trimMat, cx, 1.2, 0.03)
    add(new THREE.BoxGeometry(1.24, 0.08, 0.06), trimMat, cx, 2.5, 0.02)
    for (const dx of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.07, 1.36, 0.06), trimMat, cx + dx, 1.85, 0.02)
    for (let i = 0; i < 4; i++) {
      const b = add(new THREE.BoxGeometry(1.4, 0.16, 0.04), boardMats[i % 3], cx, 1.35 + i * 0.32, 0.07 + i * 0.005)
      b.rotation.z = (rnd() - 0.5) * 0.5
    }
  }
  return g
}
