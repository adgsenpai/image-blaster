import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildBackWall } from './RoomBackWall'
import { gameTex } from './gameTextures'
import { PERKS, WEAPONS, type PerkId } from './weapons'

/**
 * Everything placeable in a room, as one flat list the in-game editor can move, rotate,
 * add and delete. Positions are room-local (photo camera at the origin, looking down -z).
 * Each builder returns an unpositioned group with its feet / back face at the local origin.
 */
export type RoomItemType =
  | 'machine' | 'sign' | 'board' | 'arch' | 'backWall'
  | 'crate' | 'sandbags' | 'planks' | 'lamp' | 'barrel' | 'glb'

export interface RoomItem {
  id: string
  type: RoomItemType
  at: [number, number, number]
  rotY: number
  scale?: number
  perk?: PerkId
  size?: [number, number]
  width?: number
  height?: number
  url?: string
  name?: string
  door?: boolean
}

/** Types that block movement (bounding-box collider). Wall decor doesn't. */
export const SOLID: Record<RoomItemType, boolean> = {
  machine: true, sign: false, board: false, arch: true, backWall: true,
  crate: true, sandbags: true, planks: false, lamp: false, barrel: true, glb: true,
}

export const PALETTE: { type: RoomItemType; label: string; extra?: Partial<RoomItem> }[] = [
  { type: 'machine', label: 'Rooibos Rush machine', extra: { perk: 'rooibos' } },
  { type: 'machine', label: 'Mtn Tonic machine', extra: { perk: 'tonic' } },
  { type: 'crate', label: 'crate' },
  { type: 'barrel', label: 'barrel' },
  { type: 'sandbags', label: 'sandbag wall', extra: { width: 1.8 } },
  { type: 'planks', label: 'plank pile' },
  { type: 'lamp', label: 'lantern' },
  { type: 'sign', label: 'trader sign', extra: { size: [2.1, 0.55] } },
  { type: 'board', label: 'price board', extra: { size: [0.9, 1.25] } },
  { type: 'arch', label: 'barricade', extra: { width: 2.4, height: 2.6 } },
]

// ---------- textures ----------

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(...repeat)
  }
  return t
}

let seed = 3
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const cache = new Map<string, THREE.Texture>()
const cached = (key: string, make: () => THREE.Texture) => {
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key)!
}

function machineTextures(perk: PerkId) {
  const p = PERKS[perk]
  const draw = (ctx: CanvasRenderingContext2D, glowOnly: boolean) => {
    const W = 512
    const H = 1180
    ctx.fillStyle = glowOnly ? '#000' : p.color
    ctx.fillRect(0, 0, W, H)
    if (!glowOnly) {
      for (let i = 0; i < 220; i++) {
        ctx.fillStyle = `rgba(${40 + rnd() * 40},${20 + rnd() * 20},10,${rnd() * 0.25})`
        ctx.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 18, 2 + rnd() * 40)
      }
    }
    ctx.fillStyle = glowOnly ? '#000' : '#1b0e0a'
    ctx.fillRect(30, 30, W - 60, 230)
    ctx.textAlign = 'center'
    ctx.shadowColor = p.label
    ctx.shadowBlur = 24
    ctx.fillStyle = p.label
    const words = p.name.split(' ')
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [p.name]
    ctx.font = `bold ${lines.length > 1 ? 62 : 78}px Georgia, serif`
    lines.forEach((l, i) => ctx.fillText(l, W / 2, (lines.length > 1 ? 120 : 160) + i * 78))
    ctx.font = 'italic 30px Georgia, serif'
    ctx.fillText('Cape Town · est. 1652', W / 2, 245)
    ctx.shadowBlur = 0
    ctx.fillStyle = glowOnly ? '#3a2a10' : '#2a1c10'
    ctx.fillRect(70, 300, 300, 600)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 95 + col * 70
        const y = 330 + row * 145
        const grd = ctx.createLinearGradient(x, y, x, y + 110)
        grd.addColorStop(0, '#ffe1a0')
        grd.addColorStop(1, p.color)
        ctx.fillStyle = grd
        ctx.fillRect(x + 10, y + 30, 32, 80)
        ctx.fillRect(x + 20, y, 12, 34)
        ctx.fillStyle = p.label
        ctx.fillRect(x + 10, y + 60, 32, 18)
      }
    }
    ctx.fillStyle = glowOnly ? '#000' : '#202020'
    ctx.fillRect(395, 320, 80, 260)
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = glowOnly ? '#553' : '#c9a227'
      ctx.beginPath()
      ctx.arc(435, 360 + i * 55, 16, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = glowOnly ? '#000' : '#f4efe6'
    ctx.fillRect(80, 950, 350, 110)
    ctx.fillStyle = glowOnly ? '#000' : '#1a1a1a'
    ctx.font = 'bold 54px monospace'
    ctx.fillText(`R${p.price.toLocaleString('en-ZA')}`, 255, 1025)
    ctx.fillStyle = glowOnly ? '#000' : '#111'
    ctx.fillRect(140, 1090, 230, 60)
  }
  return {
    map: cached(`m-${perk}`, () => canvasTex(512, 1180, (c) => draw(c, false))),
    emissive: cached(`me-${perk}`, () => canvasTex(512, 1180, (c) => draw(c, true))),
  }
}

function signTexture(w: number, h: number) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#3b2617'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.15})`
      ctx.fillRect(0, (i * h) / 9, w, 3)
    }
    ctx.fillStyle = 'rgba(230,215,190,0.85)'
    ctx.beginPath()
    ctx.moveTo(w * 0.28, h * 0.36)
    ctx.lineTo(w * 0.36, h * 0.16)
    ctx.lineTo(w * 0.64, h * 0.14)
    ctx.lineTo(w * 0.72, h * 0.36)
    ctx.closePath()
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#efe3cc'
    ctx.font = `bold ${h * 0.34}px Georgia, serif`
    ctx.fillText('SURVIVOR TRADER', w / 2, h * 0.7)
    ctx.font = `${h * 0.15}px Georgia, serif`
    ctx.fillText('WEAPONS  ·  AMMO  ·  SUPPLIES', w / 2, h * 0.9)
  })
}

function boardTexture(w: number, h: number) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#141414'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#5a4630'
    ctx.lineWidth = 18
    ctx.strokeRect(9, 9, w - 18, h - 18)
    ctx.fillStyle = '#f2f2f2'
    ctx.font = `bold ${h * 0.09}px monospace`
    ctx.fillText('SHOP', w * 0.12, h * 0.13)
    const names = { magnum: 'magnum', shotgun: 'shotgun', mg: 'AK-47', sniper: 'sniper' } as const
    const rows: [string, string][] = [
      ...(['magnum', 'shotgun', 'mg', 'sniper'] as const).map((id) => [names[id], `R${WEAPONS[id].price.toLocaleString('en-ZA')}`] as [string, string]),
      ['ammo', 'R150-350'],
      ['Rooibos Rush', `R${PERKS.rooibos.price.toLocaleString('en-ZA')}`],
      ['Mtn Tonic', `R${PERKS.tonic.price.toLocaleString('en-ZA')}`],
    ]
    ctx.font = `${Math.min(h * 0.055, w * 0.085)}px monospace`
    rows.forEach(([n, p], i) => {
      const y = h * (0.26 + i * 0.1)
      ctx.fillStyle = '#e8e8e8'
      ctx.textAlign = 'left'
      ctx.fillText(n, w * 0.08, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#ffd27a'
      ctx.fillText(p, w * 0.92, y)
    })
  })
}

function archTexture(w: number, h: number) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#0d0b0a'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#c9a227'
    ctx.font = `bold ${h * 0.08}px Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('INFECTED · NO ENTRY', w / 2, h * 0.44)
    ctx.fillStyle = '#8a1010'
    ctx.font = `bold ${h * 0.05}px Impact, sans-serif`
    ctx.fillText('KITCHEN SEALED', w / 2, h * 0.52)
  })
}

function rustTex() {
  return cached('rust', () => canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = '#3d4a3a'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${110 + rnd() * 60},${50 + rnd() * 30},20,${rnd() * 0.45})`
      ctx.beginPath()
      ctx.arc(rnd() * 256, rnd() * 256, 2 + rnd() * 10, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#c9a227'
    ctx.fillRect(0, 110, 256, 36)
    ctx.fillStyle = '#111'
    for (let x = -40; x < 256; x += 36) {
      ctx.beginPath()
      ctx.moveTo(x, 146)
      ctx.lineTo(x + 18, 110)
      ctx.lineTo(x + 34, 110)
      ctx.lineTo(x + 16, 146)
      ctx.fill()
    }
  }))
}

// ---------- builders ----------

const mat = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o)
const metal = mat({ color: '#2b2b2b', metalness: 0.6, roughness: 0.5 })

function machine(perk: PerkId) {
  const t = machineTextures(perk)
  const p = PERKS[perk]
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.95, 0.72), mat({ color: p.color, roughness: 0.55, metalness: 0.25 }))
  body.position.y = 0.975
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.84),
    mat({ map: t.map, emissiveMap: t.emissive, emissive: '#ffffff', emissiveIntensity: 1.8, roughness: 0.35 }))
  front.position.set(0, 0.97, 0.362)
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.76), metal)
  cap.position.y = 1.99
  const glow = new THREE.PointLight(p.color, 6, 3.5, 2)
  glow.position.set(0, 1.4, 0.6)
  // Glow spill on the floor in front of the machine.
  const spill = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }))
  spill.rotation.x = -Math.PI / 2
  spill.position.set(0, 0.015, 0.75)
  spill.userData.noBounds = true
  g.add(body, front, cap, glow, spill)
  return g
}

function panel(w: number, h: number, map: THREE.Texture, emissive = '#000') {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), [metal, metal, metal, metal, mat({ map, emissive, roughness: 0.85 }), metal])
  m.position.z = 0.025
  const g = new THREE.Group()
  g.add(m)
  return g
}

function arch(w: number, height: number) {
  const g = new THREE.Group()
  let s = 7
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, height), mat({ map: archTexture(1024, Math.round((1024 * height) / (w + 0.6))), roughness: 1 }))
  back.position.set(0, height / 2, -0.25)
  g.add(back)
  const wood = ['#d0b090', '#b89878', '#a08060', '#c8a888'].map((c) => mat({ color: c, map: gameTex('wood', [w / 1.5, 0.12]), roughness: 0.85 }))
  for (let i = 0; i < 9; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.18, 0.045), wood[i % 4])
    plank.position.set((r() - 0.5) * 0.15, 0.55 + (i / 8) * (height - 1.0), 0.02 + i * 0.004)
    plank.rotation.z = (r() - 0.5) * 0.5
    g.add(plank)
  }
  g.add(sandbags(w, 0.32))
  return g
}

function sandbags(w: number, z = 0) {
  const g = new THREE.Group()
  const sack = mat({ color: '#b8a888', map: gameTex('sandbag', [3, 2]), roughness: 1 })
  const n = Math.max(1, Math.floor(w / 0.55))
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < n - (row % 2); k++) {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.36, 4, 8), sack)
      bag.rotation.z = Math.PI / 2
      bag.scale.set(1, 1, 0.8)
      bag.position.set(-((n - 1) * 0.55) / 2 + k * 0.55 + (row % 2) * 0.27, 0.15 + row * 0.27, z)
      g.add(bag)
    }
  }
  return g
}

function crate() {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), mat({ map: gameTex('crate', [1, 0.9]), roughness: 0.85 }))
  box.position.y = 0.35
  g.add(box)
  const edge = mat({ color: '#3a2414', roughness: 0.8 })
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.72, 0.07), edge)
    post.position.set(x * 0.38, 0.35, z * 0.38)
    g.add(post)
  }
  for (const y of [0.04, 0.68]) {
    for (const z of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.07, 0.04), edge)
      rail.position.set(0, y, z * 0.4)
      g.add(rail)
    }
  }
  return g
}

function barrel() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 24), mat({ map: gameTex('rust', [2, 1]), metalness: 0.45, roughness: 0.65 }))
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.292, 0.292, 0.12, 24, 1, true), mat({ map: rustTex(), metalness: 0.4, roughness: 0.6 }))
  band.position.y = 0.44
  g.add(band)
  body.position.y = 0.44
  const ringMat = mat({ color: '#2a2f28', metalness: 0.7, roughness: 0.5 })
  for (const y of [0.22, 0.66]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.015, 6, 24), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    g.add(ring)
  }
  g.add(body)
  return g
}

function planks() {
  const g = new THREE.Group()
  const wood = ['#d0b090', '#b89878', '#a08060'].map((c) => mat({ color: c, map: gameTex('wood', [1.2, 0.12]), roughness: 0.85 }))
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.2), wood[i % 3])
    p.position.set((rnd() - 0.5) * 0.1, 0.02 + Math.floor(i / 2) * 0.045, (i % 2) * 0.22 - 0.11)
    p.rotation.y = (rnd() - 0.5) * 0.12
    g.add(p)
  }
  return g
}

function lamp() {
  const g = new THREE.Group()
  const brass = mat({ color: '#8a6a2c', metalness: 0.9, roughness: 0.35 })
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.04, 16), brass)
  base.position.y = 0.02
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16), mat({ color: '#ffd9a0', emissive: '#ffae4a', emissiveIntensity: 3, transparent: true, opacity: 0.85 }))
  glass.position.y = 0.15
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.08, 16), brass)
  top.position.y = 0.29
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16, Math.PI), brass)
  handle.position.y = 0.33
  const light = new THREE.PointLight('#ffad55', 3, 4, 2)
  light.position.y = 0.2
  g.add(base, glass, top, handle, light)
  return g
}

const loader = new GLTFLoader()

function glb(url: string) {
  const g = new THREE.Group()
  loader.load(url, (gltf) => {
    const root = gltf.scene
    // Normalise: largest side ~1 m, feet on the floor, centred.
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const k = 1 / Math.max(size.x, size.y, size.z, 1e-3)
    root.scale.setScalar(k)
    const b2 = new THREE.Box3().setFromObject(root)
    const c = b2.getCenter(new THREE.Vector3())
    root.position.set(-c.x, -b2.min.y, -c.z)
    g.add(root)
    g.dispatchEvent({ type: 'loaded' } as never)
  })
  return g
}

export function buildItem(it: RoomItem): THREE.Group {
  switch (it.type) {
    case 'machine': return machine(it.perk ?? 'rooibos')
    case 'sign': {
      const [w, h] = it.size ?? [2.1, 0.55]
      return panel(w, h, signTexture(1024, Math.round((1024 * h) / w)))
    }
    case 'board': {
      const [w, h] = it.size ?? [0.9, 1.25]
      return panel(w, h, boardTexture(600, Math.round((600 * h) / w)), '#222')
    }
    case 'arch': return arch(it.width ?? 3, it.height ?? 3)
    case 'backWall': {
      const g = buildBackWall({ at: [0, 0, 0], width: it.width ?? 7, height: it.height ?? 4.5, rotY: 0, door: it.door })
      return g
    }
    case 'crate': return crate()
    case 'barrel': return barrel()
    case 'sandbags': return sandbags(it.width ?? 1.8)
    case 'planks': return planks()
    case 'lamp': return lamp()
    case 'glb': return glb(it.url ?? '')
  }
}

export const itemLabel = (it: RoomItem) =>
  it.name ?? (it.type === 'machine' ? `${PERKS[it.perk ?? 'rooibos'].name} machine` : it.type === 'glb' ? (it.url ?? '').split('/').pop() ?? 'model' : it.type)

/** Front of a machine (where you stand to buy). */
export function machineFront(it: RoomItem): [number, number, number] {
  return [it.at[0] + Math.sin(it.rotY) * 0.95, 1, it.at[2] + Math.cos(it.rotY) * 0.95]
}

/** Convert the older per-kind config (machines/sign/board/arch/backWall) into a flat item list. */
export function itemsFromConfig(props: Record<string, unknown>): RoomItem[] {
  if (Array.isArray(props.items)) return props.items as RoomItem[]
  const out: RoomItem[] = []
  let n = 0
  const id = (t: string) => `${t}-${++n}`
  type P = { at: [number, number, number]; rotY?: number; size?: [number, number]; perk?: PerkId; width?: number; height?: number }
  for (const m of (props.machines as P[] | undefined) ?? []) out.push({ id: id('machine'), type: 'machine', at: m.at, rotY: m.rotY ?? 0, perk: m.perk })
  for (const k of ['sign', 'board'] as const) {
    const s = props[k] as P | undefined
    if (s) out.push({ id: id(k), type: k, at: s.at, rotY: s.rotY ?? 0, size: s.size })
  }
  for (const k of ['arch', 'backWall'] as const) {
    const s = props[k] as P | undefined
    if (s) out.push({ id: id(k), type: k, at: s.at, rotY: s.rotY ?? 0, width: s.width, height: s.height })
  }
  return out
}
