import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../../store/game'
import { goreApi } from './runtime'

const MAX_PARTICLES = 2400
const MAX_POOLS = 70
const MAX_GIBS = 24
const GRAVITY = -9.81

function bloodTexture(seed: number) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  // Irregular splat: overlapping blobs + droplets.
  for (let i = 0; i < 14; i++) {
    const r = 10 + rnd() * 26
    const x = 64 + (rnd() - 0.5) * 50
    const y = 64 + (rnd() - 0.5) * 50
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(70,0,4,0.95)')
    g.addColorStop(0.7, 'rgba(95,4,8,0.85)')
    g.addColorStop(1, 'rgba(95,4,8,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = 'rgba(80,0,6,0.9)'
    ctx.beginPath()
    ctx.arc(64 + (rnd() - 0.5) * 120, 64 + (rnd() - 0.5) * 120, 1 + rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface Pool { mesh: THREE.Mesh; age: number; grow: number; size: number }

const MAX_HOLES = 80

function holeTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30)
  g.addColorStop(0, 'rgba(5,5,5,1)')
  g.addColorStop(0.24, "rgba(10,8,8,1)")
  g.addColorStop(0.35, 'rgba(60,55,50,0.6)')
  g.addColorStop(1, 'rgba(60,55,50,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  // Cracks / chipped plaster.
  ctx.strokeStyle = 'rgba(20,18,16,0.7)'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5)
    ctx.lineTo(32 + Math.cos(a + 0.2) * (12 + Math.random() * 14), 32 + Math.sin(a + 0.2) * (12 + Math.random() * 14))
    ctx.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
interface Gib { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; age: number; bleed: number }

export function Gore() {
  const group = useRef<THREE.Group>(null)
  const runToken = useGameStore((s) => s.runToken)

  const particles = useMemo(() => {
    const pos = new Float32Array(MAX_PARTICLES * 3).fill(-9999)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ color: '#7a0408', size: 0.045, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    points.raycast = () => {}
    return { points, pos, vel: new Float32Array(MAX_PARTICLES * 3), life: new Float32Array(MAX_PARTICLES), next: 0 }
  }, [])

  const splats = useMemo(() => [1, 7, 13, 29].map((s) => new THREE.MeshBasicMaterial({
    map: bloodTexture(s * 7919), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true,
  })), [])
  const pools = useRef<Pool[]>([])
  const holes = useRef<THREE.Mesh[]>([])
  const holeMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, fog: true,
  }), [])
  const dust = useMemo(() => {
    const n = 600
    const pos = new Float32Array(n * 3).fill(-9999)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#9c948a', size: 0.035, transparent: true, opacity: 0.8, depthWrite: false }))
    points.frustumCulled = false
    points.raycast = () => {}
    return { points, pos, vel: new Float32Array(n * 3), life: new Float32Array(n), next: 0, n }
  }, [])
  const gibs = useRef<Gib[]>([])

  const clear = () => {
    for (const p of pools.current) p.mesh.removeFromParent()
    for (const g of gibs.current) g.obj.removeFromParent()
    for (const h of holes.current) h.removeFromParent()
    holes.current = []
    pools.current = []
    gibs.current = []
    particles.life.fill(0)
    particles.pos.fill(-9999)
  }
  useEffect(clear, [runToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const spray = (point: THREE.Vector3, dir: THREE.Vector3, count: number, force = 2.5) => {
      const { pos, vel, life } = particles
      for (let k = 0; k < count; k++) {
        const i = particles.next
        particles.next = (particles.next + 1) % MAX_PARTICLES
        pos[i * 3] = point.x
        pos[i * 3 + 1] = point.y
        pos[i * 3 + 2] = point.z
        const f = force * (0.3 + Math.random())
        vel[i * 3] = dir.x * f + (Math.random() - 0.5) * 1.6
        vel[i * 3 + 1] = dir.y * f + Math.random() * 1.8
        vel[i * 3 + 2] = dir.z * f + (Math.random() - 0.5) * 1.6
        life[i] = 1.2 + Math.random() * 0.8
      }
    }
    const pool = (point: THREE.Vector3, size: number) => {
      if (!group.current) return
      if (pools.current.length >= MAX_POOLS) {
        const old = pools.current.shift()
        old?.mesh.removeFromParent()
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), splats[Math.floor(Math.random() * splats.length)].clone())
      mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2)
      mesh.position.set(point.x, goreApi.floorY + 0.03 + Math.random() * 0.01, point.z)
      mesh.scale.setScalar(0.05)
      mesh.raycast = () => {}
      mesh.renderOrder = 2
      group.current.add(mesh)
      pools.current.push({ mesh, age: 0, grow: 0.6 + Math.random() * 0.8, size })
    }
    const gib = (kind: 'head' | 'arm' | 'leg', point: THREE.Vector3, velocity: THREE.Vector3, skin: THREE.Color) => {
      if (!group.current) return
      if (gibs.current.length >= MAX_GIBS) gibs.current.shift()?.obj.removeFromParent()
      const flesh = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85 })
      const gore = new THREE.MeshStandardMaterial({ color: '#5a0207', roughness: 0.4, emissive: '#1a0000' })
      const obj = new THREE.Group()
      if (kind === 'head') {
        const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), flesh)
        head.scale.set(1, 1.15, 1.05)
        const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 8), gore)
        stump.position.y = -0.15
        const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: '#d7c300' }))
        eyes.position.set(0, 0.02, 0.13)
        obj.add(head, stump, eyes)
      } else {
        const len = kind === 'leg' ? 0.8 : 0.6
        const limb = new THREE.Mesh(new THREE.CapsuleGeometry(kind === 'leg' ? 0.07 : 0.05, len, 4, 8), flesh)
        const stump = new THREE.Mesh(new THREE.CylinderGeometry(kind === 'leg' ? 0.075 : 0.055, 0.06, 0.04, 8), gore)
        stump.position.y = len / 2 + 0.05
        obj.add(limb, stump)
      }
      obj.position.copy(point)
      obj.traverse((o) => {
        o.raycast = () => {}
      })
      group.current.add(obj)
      gibs.current.push({
        obj, vel: velocity.clone(), age: 0, bleed: 1.6,
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
      })
    }
    const _n = new THREE.Vector3()
    const impact = (point: THREE.Vector3, normal: THREE.Vector3) => {
      if (!group.current) return
      if (holes.current.length >= MAX_HOLES) holes.current.shift()?.removeFromParent()
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), holeMat)
      _n.copy(normal).normalize()
      hole.position.copy(point).addScaledVector(_n, 0.012)
      hole.lookAt(point.clone().add(_n))
      hole.rotateZ(Math.random() * Math.PI * 2)
      hole.raycast = () => {}
      hole.renderOrder = 3
      group.current.add(hole)
      holes.current.push(hole)
      // Dust / plaster chips kicked off the surface.
      for (let k = 0; k < 10; k++) {
        const i = dust.next
        dust.next = (dust.next + 1) % dust.n
        dust.pos[i * 3] = point.x
        dust.pos[i * 3 + 1] = point.y
        dust.pos[i * 3 + 2] = point.z
        dust.vel[i * 3] = _n.x * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8
        dust.vel[i * 3 + 1] = _n.y * (0.6 + Math.random()) + Math.random() * 0.9
        dust.vel[i * 3 + 2] = _n.z * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.8
        dust.life[i] = 0.4 + Math.random() * 0.5
      }
    }
    goreApi.spray = spray
    goreApi.pool = pool
    goreApi.gib = gib
    goreApi.impact = impact
    return () => {
      goreApi.spray = null
      goreApi.pool = null
      goreApi.gib = null
      goreApi.impact = null
      clear()
    }
  }, [particles, splats, holeMat, dust]) // eslint-disable-line react-hooks/exhaustive-deps

  const _d = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  useFrame((_s, raw) => {
    const dt = Math.min(raw, 0.05)
    const floor = goreApi.floorY
    const { pos, vel, life } = particles
    let landed = 0
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      vel[i * 3 + 1] += GRAVITY * dt
      pos[i * 3] += vel[i * 3] * dt
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt
      if (pos[i * 3 + 1] < floor + 0.02) {
        // Droplet hits the street: occasionally leave a small splat.
        if (landed < 2 && Math.random() < 0.04) {
          landed++
          goreApi.pool?.(new THREE.Vector3(pos[i * 3], floor, pos[i * 3 + 2]), 0.25 + Math.random() * 0.25)
        }
        life[i] = 0
      }
      if (life[i] <= 0) pos[i * 3 + 1] = -9999
    }
    particles.points.geometry.attributes.position.needsUpdate = true

    for (let i = 0; i < dust.n; i++) {
      if (dust.life[i] <= 0) continue
      dust.life[i] -= dt
      dust.vel[i * 3 + 1] += GRAVITY * 0.35 * dt
      dust.pos[i * 3] += dust.vel[i * 3] * dt
      dust.pos[i * 3 + 1] += dust.vel[i * 3 + 1] * dt
      dust.pos[i * 3 + 2] += dust.vel[i * 3 + 2] * dt
      if (dust.life[i] <= 0) dust.pos[i * 3 + 1] = -9999
    }
    dust.points.geometry.attributes.position.needsUpdate = true

    for (const p of pools.current) {
      p.age += dt
      const target = p.size
      const cur = p.mesh.scale.x
      if (cur < target) p.mesh.scale.setScalar(Math.min(target, cur + dt * p.grow))
      const m = p.mesh.material as THREE.MeshBasicMaterial
      m.opacity = p.age < 40 ? 0.92 : Math.max(0, 0.92 - (p.age - 40) / 20)
    }
    pools.current = pools.current.filter((p) => {
      if (p.age > 60) {
        p.mesh.removeFromParent()
        return false
      }
      return true
    })

    for (const g of gibs.current) {
      g.age += dt
      const o = g.obj
      if (o.position.y > floor + 0.08 || g.vel.y > 0) {
        g.vel.y += GRAVITY * dt
        o.position.addScaledVector(g.vel, dt)
        o.rotation.x += g.spin.x * dt
        o.rotation.y += g.spin.y * dt
        o.rotation.z += g.spin.z * dt
        if (g.bleed > 0) {
          goreApi.spray?.(o.position, _d.set(0, 0.2, 0), 1, 0.4)
          g.bleed -= dt
        }
      }
      if (o.position.y < floor + 0.08) {
        o.position.y = floor + 0.08
        if (Math.abs(g.vel.y) > 1.2) {
          g.vel.y = -g.vel.y * 0.35
          g.vel.x *= 0.6
          g.vel.z *= 0.6
          g.spin.multiplyScalar(0.5)
          goreApi.pool?.(o.position, 0.35)
        } else {
          g.vel.set(0, 0, 0)
          g.spin.set(0, 0, 0)
        }
      }
    }
    gibs.current = gibs.current.filter((g) => {
      if (g.age > 25) {
        g.obj.removeFromParent()
        return false
      }
      return true
    })
  })

  return (
    <group ref={group}>
      <primitive object={particles.points} />
      <primitive object={dust.points} />
    </group>
  )
}
