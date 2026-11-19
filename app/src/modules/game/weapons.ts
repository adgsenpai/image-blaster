import * as THREE from 'three'

export type WeaponId = 'pistol' | 'magnum' | 'mg' | 'shotgun' | 'sniper' | 'knife'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: number
  /** Rounds per magazine; 0 for melee. */
  mag: number
  /** Seconds between shots / swings. */
  interval: number
  auto: boolean
  reload: number
  bodyDamage: number
  headDamage: number
  /** Max hitscan range (m). */
  range: number
  /** Bullet passes through every zombie on the ray. */
  pierce: boolean
  /** Cone half-angle (rad) when firing from the hip / aiming. */
  hipSpread: number
  adsSpread: number
  /** Camera FOV while aiming. */
  adsFov: number
  /** Show the scope overlay and hide the viewmodel while aiming. */
  scope: boolean
  /** Upward kick per shot (rad). */
  kick: number
  /** Viewmodel rest position (hip) and aimed position. */
  hip: [number, number, number]
  aim: [number, number, number]
  /** Muzzle position relative to the viewmodel root. */
  muzzle: [number, number, number]
  /** Pellets per shot (shotgun). */
  pellets?: number
  /** Shop price (Rand); 0 = starting weapon. */
  price: number
  /** Spare rounds when bought / max reserve, and the price of an ammo refill. */
  reserve: number
  ammoPrice: number
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife', name: 'knife', slot: 1, mag: 0, interval: 0.42, auto: false, reload: 0,
    bodyDamage: 3, headDamage: 6, range: 1.9, pierce: false,
    hipSpread: 0, adsSpread: 0, adsFov: 75, scope: false, kick: 0,
    hip: [0.2, -0.2, -0.36], aim: [0.2, -0.2, -0.36], muzzle: [0, 0, -0.2],
    price: 0, reserve: 0, ammoPrice: 0,
  },
  pistol: {
    id: 'pistol', name: '9mm pistol', slot: 2, mag: 8, interval: 0.2, auto: false, reload: 1.2,
    bodyDamage: 0.8, headDamage: 3, range: 60, pierce: false,
    hipSpread: 0.012, adsSpread: 0.003, adsFov: 60, scope: false, kick: 0.014,
    hip: [0.2, -0.19, -0.42], aim: [0, -0.112, -0.33], muzzle: [0, 0.022, -0.21],
    price: 0, reserve: 48, ammoPrice: 150,
  },
  magnum: {
    id: 'magnum', name: '.44 magnum', slot: 3, mag: 6, interval: 0.32, auto: false, reload: 1.7,
    bodyDamage: 2.2, headDamage: 99, range: 90, pierce: false,
    hipSpread: 0.008, adsSpread: 0.001, adsFov: 52, scope: false, kick: 0.04,
    hip: [0.2, -0.19, -0.42], aim: [0, -0.112, -0.33], muzzle: [0, 0.022, -0.21],
    price: 3500, reserve: 36, ammoPrice: 350,
  },
  shotgun: {
    id: 'shotgun', name: 'shotgun', slot: 4, mag: 6, interval: 0.75, auto: false, reload: 2.1,
    bodyDamage: 0.9, headDamage: 3, range: 28, pierce: false, pellets: 8,
    hipSpread: 0.07, adsSpread: 0.045, adsFov: 62, scope: false, kick: 0.06,
    hip: [0.22, -0.2, -0.46], aim: [0, -0.13, -0.38], muzzle: [0, 0.015, -0.55],
    price: 4500, reserve: 30, ammoPrice: 250,
  },
  mg: {
    id: 'mg', name: 'AK-47', slot: 5, mag: 30, interval: 0.1, auto: true, reload: 2.2,
    bodyDamage: 1, headDamage: 4, range: 80, pierce: false,
    hipSpread: 0.028, adsSpread: 0.008, adsFov: 52, scope: false, kick: 0.009,
    hip: [0.22, -0.2, -0.46], aim: [0, -0.128, -0.38], muzzle: [0, 0.015, -0.52],
    price: 5500, reserve: 150, ammoPrice: 300,
  },
  sniper: {
    id: 'sniper', name: 'sniper rifle', slot: 6, mag: 5, interval: 1.15, auto: false, reload: 2.6,
    bodyDamage: 99, headDamage: 99, range: 150, pierce: true,
    hipSpread: 0.06, adsSpread: 0, adsFov: 12, scope: true, kick: 0.05,
    hip: [0.22, -0.2, -0.45], aim: [0, -0.15, -0.3], muzzle: [0, 0.012, -0.78],
    price: 7500, reserve: 25, ammoPrice: 300,
  },
}

export const WEAPON_ORDER: WeaponId[] = ['knife', 'pistol', 'magnum', 'shotgun', 'mg', 'sniper']

/** Cape Town perk drinks (original names): effects are applied in the controller / store. */
export type PerkId = 'rooibos' | 'tonic'
export const PERKS: Record<PerkId, { name: string; blurb: string; price: number; color: string; label: string }> = {
  rooibos: { name: 'Rooibos Rush', blurb: '+50% fire rate, +25% damage', price: 2000, color: '#c0392b', label: '#f5c26b' },
  tonic: { name: 'Table Mountain Tonic', blurb: 'one free self-revive', price: 1500, color: '#2e86c1', label: '#e8f6ff' },
}

export const GRENADE_START = 3
export const GRENADE_MAX = 5

const noRaycast = (o: THREE.Object3D) => {
  o.traverse((c) => {
    c.raycast = () => {}
  })
  return o
}

function mats() {
  return {
    metal: new THREE.MeshStandardMaterial({ color: '#121317', metalness: 0.6, roughness: 0.45, envMapIntensity: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1b1d22', metalness: 0.3, roughness: 0.7, envMapIntensity: 0.3 }),
    wood: new THREE.MeshStandardMaterial({ color: '#3a2618', roughness: 0.8, envMapIntensity: 0.3 }),
    grip: new THREE.MeshStandardMaterial({ color: '#1c1512', roughness: 0.85, envMapIntensity: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: '#0d1a2a', metalness: 0.9, roughness: 0.1, emissive: '#06101c' }),
    blade: new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.95, roughness: 0.22 }),
    olive: new THREE.MeshStandardMaterial({ color: '#3b4428', roughness: 0.7 }),
  }
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  mesh.position.set(x, y, z)
  return mesh
}

function cyl(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m)
  mesh.rotation.x = Math.PI / 2
  mesh.position.set(x, y, z)
  return mesh
}

export function buildPistol() {
  const m = mats()
  const g = new THREE.Group()
  g.add(
    box(0.034, 0.038, 0.18, m.metal, 0, 0.015, -0.045),
    cyl(0.008, 0.04, m.metal, 0, 0.017, -0.15),
    box(0.03, 0.09, 0.042, m.grip, 0, -0.035, 0.022),
    box(0.006, 0.009, 0.008, m.metal, 0, 0.038, -0.125),
    box(0.012, 0.009, 0.008, m.metal, 0, 0.038, 0.035),
  )
  ;(g.children[2] as THREE.Mesh).rotation.x = -0.25
  return noRaycast(g)
}

export function buildMachineGun() {
  const m = mats()
  const g = new THREE.Group()
  g.add(
    box(0.05, 0.07, 0.34, m.dark, 0, 0, -0.12), // receiver
    cyl(0.013, 0.22, m.metal, 0, 0.012, -0.4), // barrel
    box(0.055, 0.05, 0.16, m.metal, 0, 0.006, -0.32), // handguard
    box(0.035, 0.13, 0.05, m.metal, 0, -0.1, -0.12), // magazine
    box(0.032, 0.09, 0.04, m.grip, 0, -0.07, 0.02), // grip
    box(0.045, 0.06, 0.18, m.dark, 0, -0.01, 0.13), // stock
    box(0.008, 0.02, 0.012, m.metal, 0, 0.045, -0.27), // front sight
    box(0.02, 0.016, 0.012, m.metal, 0, 0.042, 0.0), // rear sight
  )
  ;(g.children[3] as THREE.Mesh).rotation.x = 0.15
  ;(g.children[4] as THREE.Mesh).rotation.x = -0.3
  return noRaycast(g)
}

export function buildSniper() {
  const m = mats()
  const g = new THREE.Group()
  g.add(
    box(0.045, 0.06, 0.4, m.wood, 0, -0.01, -0.12), // stock/body
    cyl(0.011, 0.42, m.metal, 0, 0.012, -0.55), // long barrel
    cyl(0.022, 0.24, m.dark, 0, 0.07, -0.1), // scope tube
    cyl(0.03, 0.05, m.dark, 0, 0.07, -0.24), // objective bell
    cyl(0.026, 0.035, m.dark, 0, 0.07, 0.03), // eyepiece
    box(0.012, 0.03, 0.02, m.metal, 0, 0.04, -0.15), // mounts
    box(0.012, 0.03, 0.02, m.metal, 0, 0.04, -0.04),
    box(0.04, 0.07, 0.16, m.wood, 0, -0.035, 0.16), // butt
    cyl(0.006, 0.05, m.metal, 0.035, 0.02, 0.0, 6), // bolt
  )
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 16), m.glass)
  lens.position.set(0, 0.07, -0.266)
  lens.rotation.y = Math.PI
  g.add(lens)
  ;(g.children[8] as THREE.Mesh).rotation.set(0, 0, Math.PI / 2)
  return noRaycast(g)
}

export function buildKnife() {
  const m = mats()
  const g = new THREE.Group()
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.17), m.blade)
  blade.position.set(0, 0.008, -0.12)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.04, 4), m.blade)
  tip.rotation.x = -Math.PI / 2
  tip.scale.set(0.4, 1, 1)
  tip.position.set(0, 0.008, -0.225)
  g.add(blade, tip, box(0.04, 0.012, 0.012, m.metal, 0, 0.004, -0.03), box(0.022, 0.028, 0.1, m.grip, 0, 0, 0.03))
  return noRaycast(g)
}

export function buildGrenade() {
  const m = mats()
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), m.olive)
  body.scale.set(1, 1.2, 1)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.03, 10), m.metal)
  cap.position.y = 0.06
  const lever = box(0.01, 0.06, 0.012, m.metal, 0.03, 0.03, 0)
  g.add(body, cap, lever)
  return noRaycast(g)
}

export function buildViewmodel(id: WeaponId) {
  switch (id) {
    case 'pistol': return buildPistol()
    case 'magnum': return buildPistol()
    case 'shotgun': return buildMachineGun()
    case 'mg': return buildMachineGun()
    case 'sniper': return buildSniper()
    case 'knife': return buildKnife()
  }
}

/** Perk bottle for the drinking animation. */
export function buildBottle(color: string, label: string) {
  const g = new THREE.Group()
  const glass = new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92, emissive: color, emissiveIntensity: 0.35 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, 0.14, 14), glass)
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.032, 0.05, 14), glass)
  shoulder.position.y = 0.095
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 10), glass)
  neck.position.y = 0.14
  const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 0.06, 14, 1, true), new THREE.MeshStandardMaterial({ color: label, roughness: 0.6 }))
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10), new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.9, roughness: 0.3 }))
  cap.position.y = 0.17
  g.add(body, shoulder, neck, lab, cap)
  return noRaycast(g)
}
