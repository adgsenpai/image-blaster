import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../../store/game'
import { arenaFrame, arenaLocal, arenaPoint, type ArenaConfig } from './arena'
import { gameRuntime, grenadeApi, zombieApi } from './runtime'
import { sfx } from './sfx'
import { buildGrenade } from './weapons'

const GRAVITY = -9.81
const FUSE = 1.8
const RADIUS = 5.5
const DAMAGE = 9
const PLAYER_SELF_DAMAGE = 35

interface Live {
  obj: THREE.Object3D
  vel: THREE.Vector3
  fuse: number
}

interface Blast {
  ball: THREE.Mesh
  ring: THREE.Mesh
  light: THREE.PointLight
  t: number
}

export function Grenades({ arena }: { arena: ArenaConfig }) {
  const frame = useMemo(() => arenaFrame(arena), [arena])
  const group = useRef<THREE.Group>(null)
  const live = useRef<Live[]>([])
  const blasts = useRef<Blast[]>([])
  const runToken = useGameStore((s) => s.runToken)

  const clear = () => {
    for (const g of live.current) g.obj.removeFromParent()
    for (const b of blasts.current) {
      b.ball.removeFromParent()
      b.ring.removeFromParent()
      b.light.removeFromParent()
    }
    live.current = []
    blasts.current = []
  }
  useEffect(clear, [runToken])

  useEffect(() => {
    grenadeApi.throw = (origin, velocity) => {
      const obj = buildGrenade()
      obj.position.copy(origin)
      group.current?.add(obj)
      live.current.push({ obj, vel: velocity.clone(), fuse: FUSE })
      sfx.pin()
    }
    return () => {
      grenadeApi.throw = null
      clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const explode = (at: THREE.Vector3) => {
    sfx.explosion()
    zombieApi.radius?.(at, RADIUS, DAMAGE)
    const d = at.distanceTo(gameRuntime.playerPos)
    gameRuntime.shake = Math.max(gameRuntime.shake, Math.max(0.4, 2.2 - d * 0.18))
    if (d < RADIUS * 0.6) useGameStore.getState().damage(PLAYER_SELF_DAMAGE * (1 - d / (RADIUS * 0.6)))

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    ball.position.copy(at).setY(at.y + 0.4)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 32),
      new THREE.MeshBasicMaterial({ color: '#ffd6a0', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(at).setY(frame.origin.y + 0.05)
    const light = new THREE.PointLight('#ff9a3c', 60, 18, 2)
    light.position.copy(ball.position)
    for (const o of [ball, ring]) o.raycast = () => {}
    group.current?.add(ball, ring, light)
    blasts.current.push({ ball, ring, light, t: 0 })
  }

  useFrame((_s, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const phase = useGameStore.getState().phase
    if (phase !== 'playing' && phase !== 'dead') return
    const floor = frame.origin.y + 0.06

    live.current = live.current.filter((g) => {
      g.vel.y += GRAVITY * delta
      g.obj.position.addScaledVector(g.vel, delta)
      g.obj.rotation.x += delta * 8
      g.obj.rotation.z += delta * 5
      // Bounce off the street.
      if (g.obj.position.y < floor) {
        g.obj.position.y = floor
        g.vel.y = Math.abs(g.vel.y) * 0.35
        g.vel.x *= 0.6
        g.vel.z *= 0.6
        if (g.vel.y < 0.4) g.vel.y = 0
      }
      // Bounce off the arena edges.
      const local = arenaLocal(frame, g.obj.position)
      const cu = THREE.MathUtils.clamp(local.u, -frame.config.back + 0.3, frame.config.front - 0.3)
      const cv = THREE.MathUtils.clamp(local.v, -frame.config.halfWidth + 0.2, frame.config.halfWidth - 0.2)
      if (cu !== local.u || cv !== local.v) {
        arenaPoint(frame, cu, cv, g.obj.position.y, g.obj.position)
        g.vel.multiplyScalar(-0.4)
      }
      g.fuse -= delta
      if (g.fuse <= 0) {
        explode(g.obj.position.clone())
        g.obj.removeFromParent()
        return false
      }
      return true
    })

    blasts.current = blasts.current.filter((b) => {
      b.t += delta
      const t = b.t / 0.7
      const s = 0.4 + Math.min(1, t) * 3.2
      b.ball.scale.setScalar(s)
      ;(b.ball.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t)
      ;(b.ball.material as THREE.MeshBasicMaterial).color.setHSL(0.08 - t * 0.06, 1, Math.max(0.2, 0.65 - t * 0.4))
      b.ring.scale.setScalar(0.5 + t * RADIUS)
      ;(b.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - t)
      b.light.intensity = Math.max(0, 60 * (1 - t * 1.4))
      if (t >= 1) {
        b.ball.removeFromParent()
        b.ring.removeFromParent()
        b.light.removeFromParent()
        b.ball.geometry.dispose()
        b.ring.geometry.dispose()
        return false
      }
      return true
    })
  })

  return <group ref={group} />
}
