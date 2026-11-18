import * as THREE from 'three'

/**
 * Procedural street furniture. Thin, structural props (poles, boards) are where
 * single-image 3D reconstruction breaks down, so these are modelled directly.
 */

const metal = () => new THREE.MeshStandardMaterial({ color: '#1a1f1c', metalness: 0.7, roughness: 0.38, envMapIntensity: 1.2 })

/** Cast-iron Cape Town street lamp: fluted base, tapered pole, swan-neck arm, lantern head. */
export function buildLampPost() {
  const g = new THREE.Group()
  const iron = metal()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.7, 12), iron)
  base.position.y = 0.35
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.18, 12), iron)
  collar.position.y = 0.79
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 3.6, 10), iron)
  pole.position.y = 2.6
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 14), iron)
  ring.rotation.x = Math.PI / 2
  ring.position.y = 3.6
  // Swan-neck arm: quarter torus reaching over the street (+z).
  const arm = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 20, Math.PI / 2), iron)
  arm.rotation.y = -Math.PI / 2
  arm.position.set(0, 4.4 - 0.55, 0)
  // Lantern head.
  const head = new THREE.Group()
  head.position.set(0, 4.4 - 0.12, 0.55)
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 6), iron)
  cap.position.y = 0.06
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.11, 0.28, 6, 1, true),
    new THREE.MeshStandardMaterial({ color: '#ffdca8', emissive: '#ffb45e', emissiveIntensity: 3.2, roughness: 0.2, side: THREE.DoubleSide }),
  )
  glass.position.y = -0.18
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.06, 0.06, 6), iron)
  bottom.position.y = -0.35
  head.add(cap, glass, bottom)
  g.add(base, collar, pole, ring, arm, head)
  return { group: g, lightPos: new THREE.Vector3(0, 4.4 - 0.32, 0.55) }
}

let stripeTex: THREE.CanvasTexture | null = null
function stripes() {
  if (stripeTex) return stripeTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 32
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#f2f0ea'
  ctx.fillRect(0, 0, 256, 32)
  ctx.fillStyle = '#e8541c'
  for (let x = -32; x < 256 + 32; x += 48) {
    ctx.beginPath()
    ctx.moveTo(x, 32)
    ctx.lineTo(x + 24, 0)
    ctx.lineTo(x + 48, 0)
    ctx.lineTo(x + 24, 32)
    ctx.fill()
  }
  // Grime along the edges.
  const grime = ctx.createLinearGradient(0, 0, 0, 32)
  grime.addColorStop(0, 'rgba(0,0,0,0.15)')
  grime.addColorStop(0.2, 'rgba(0,0,0,0)')
  grime.addColorStop(0.8, 'rgba(0,0,0,0)')
  grime.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.fillStyle = grime
  ctx.fillRect(0, 0, 256, 32)
  stripeTex = new THREE.CanvasTexture(c)
  stripeTex.colorSpace = THREE.SRGBColorSpace
  stripeTex.anisotropy = 8
  return stripeTex
}

/** Free-standing A-frame road barrier, ~1.2 m wide, ~1.05 m tall. */
export function buildBarrier() {
  const g = new THREE.Group()
  const board = new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.45, metalness: 0.05, envMapIntensity: 1.1 })
  const leg = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.6, metalness: 0.5 })
  for (const [y, h] of [[0.92, 0.2], [0.55, 0.16]] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.25, h, 0.03), board)
    b.position.set(0, y, 0.18)
    const b2 = b.clone()
    b2.position.z = -0.18
    g.add(b, b2)
  }
  for (const x of [-0.56, 0.56]) {
    for (const s of [1, -1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.1, 0.04), leg)
      l.position.set(x, 0.53, 0.14 * s)
      l.rotation.x = -0.2 * s
      g.add(l)
    }
  }
  return g
}
