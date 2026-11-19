import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../../store/game'
import { arenaFrame, arenaLocal, arenaPoint, type ArenaConfig, type ArenaFrame } from './arena'
import { gameRuntime, goreApi, zombieApi, type ZombieHit } from './runtime'
import { sfx } from './sfx'
import { setHitboxDebug, applySevered, boneWorld, createModelZombie, loadZombieTemplate, playClip, sever, syncHitboxes, zombieTemplateReady, type ModelZombie } from './zombieModel'

const SKIN = ['#7f8f6a', '#8c9774', '#6e7c5c', '#8a8a6a']
const SHIRT = ['#3a2f2c', '#2d3a4a', '#4a3a28', '#5a2626', '#3c4a34', '#55504a']
const PANTS = ['#1e232e', '#2a2622', '#232a22']
const ATTACK_RANGE = 1.05
const ATTACK_INTERVAL = 0.9
const ATTACK_DAMAGE = 10
const BREAK_SECONDS = 4

interface Zombie {
  id: number
  root: THREE.Group
  parts: { legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; torso: THREE.Object3D; head: THREE.Object3D }
  mats: THREE.MeshStandardMaterial[]
  hp: number
  speed: number
  phase: number
  attackCooldown: number
  hitFlash: number
  dying: number
  groanIn: number
  lurch: number
  /** Walk here first (street corner), then chase the player. */
  waypoint: THREE.Vector3 | null
  /** Clamped to the arena once it has walked into it. */
  inside: boolean
  /** Rigged model (null = procedural fallback). */
  anim: ModelZombie | null
  /** Seconds of hit-react stagger left. */
  stagger: number
  limbDmg: Record<string, number>
  crawling: boolean
  neckBleed: number
  /** Knockback slide while dying (decays). */
  deathVel: THREE.Vector3
}

let nextId = 1

function mat(color: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 })
}

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function buildZombie(id: number): Zombie {
  const root = new THREE.Group()
  const skin = mat(pick(SKIN))
  const shirt = mat(pick(SHIRT))
  const pants = mat(pick(PANTS))
  const eye = new THREE.MeshBasicMaterial({ color: '#ff3b1f' })
  const scale = 0.92 + Math.random() * 0.16

  const limb = (w: number, h: number, d: number, m: THREE.Material, pivotY: number) => {
    const pivot = new THREE.Group()
    pivot.position.y = pivotY
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    mesh.position.y = -h / 2
    pivot.add(mesh)
    return pivot
  }

  const legL = limb(0.16, 0.82, 0.17, pants, 0.84)
  legL.position.x = -0.1
  const legR = limb(0.16, 0.82, 0.17, pants, 0.84)
  legR.position.x = 0.1

  const torso = new THREE.Group()
  torso.position.y = 0.84
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.24), shirt)
  chest.position.y = 0.3
  torso.add(chest)

  const head = new THREE.Group()
  head.position.y = 0.66
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.28, 0.25), skin)
  skull.position.y = 0.14
  skull.userData.head = true
  const eyeL = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.025), eye)
  eyeL.position.set(-0.06, 0.17, 0.126)
  const eyeR = eyeL.clone()
  eyeR.position.x = 0.06
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.05), mat('#3b1414'))
  jaw.position.set(0, 0.05, 0.115)
  head.add(skull, eyeL, eyeR, jaw)
  head.rotation.z = (Math.random() - 0.5) * 0.4
  torso.add(head)

  const armL = limb(0.12, 0.62, 0.12, skin, 0.56)
  armL.position.x = -0.29
  const armR = limb(0.12, 0.62, 0.12, skin, 0.56)
  armR.position.x = 0.29
  // Sleeves
  for (const arm of [armL, armR]) {
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.22, 0.135), shirt)
    sleeve.position.y = -0.1
    arm.add(sleeve)
  }
  torso.add(armL, armR)

  root.add(legL, legR, torso)
  root.scale.setScalar(scale)
  root.traverse((o) => {
    o.userData.zombieId = id
    if (o instanceof THREE.Mesh) o.castShadow = false
  })
  skull.userData.head = true

  return {
    id,
    root,
    parts: { legL, legR, armL, armR, torso, head },
    mats: [skin, shirt, pants],
    hp: 3,
    speed: 1,
    phase: Math.random() * Math.PI * 2,
    attackCooldown: 0,
    hitFlash: 0,
    dying: 0,
    groanIn: 1 + Math.random() * 4,
    lurch: Math.random() * Math.PI * 2,
    waypoint: null,
    inside: true,
    anim: null,
    stagger: 0,
    limbDmg: {},
    crawling: false,
    neckBleed: 0,
    deathVel: new THREE.Vector3(),
  }
}

/** Rigged CC0 zombie when the model has loaded, procedural box zombie otherwise. */
function makeZombie(id: number): Zombie {
  const t = zombieTemplateReady()
  const z = buildZombie(id)
  if (!t) return z
  const anim = createModelZombie(t, id)
  z.mats.forEach((m) => m.dispose())
  return { ...z, root: anim.root, mats: anim.mats, anim }
}

function waveSize(wave: number) {
  return 4 + wave * 3
}

const _toPlayer = new THREE.Vector3()
const _sep = new THREE.Vector3()

export function Zombies({ arena }: { arena: ArenaConfig }) {
  const frame: ArenaFrame = useMemo(() => arenaFrame(arena), [arena])
  const group = useRef<THREE.Group>(null)
  const zombies = useRef<Zombie[]>([])
  const wave = useRef({ number: 0, toSpawn: 0, spawnIn: 0, breakIn: 1.5 })
  const runToken = useGameStore((s) => s.runToken)

  const clear = () => {
    for (const z of zombies.current) {
      z.root.removeFromParent()
      z.anim?.mixer.stopAllAction()
      if (!z.anim) {
        z.root.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose()
        })
      }
      z.mats.forEach((m) => m.dispose())
    }
    zombies.current = []
    gameRuntime.targets = []
  }

  useEffect(() => {
    void loadZombieTemplate()
    goreApi.floorY = frame.origin.y
  }, [frame])

  useEffect(() => {
    clear()
    wave.current = { number: 0, toSpawn: 0, spawnIn: 0, breakIn: 1.5 }
    useGameStore.getState().setAlive(0)
    return clear
  }, [runToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const SKIN = new THREE.Color('#6f7d5a')
    const _dir = new THREE.Vector3()
    const kill = (z: Zombie, points: number, push?: THREE.Vector3) => {
      z.dying = 0.0001
      if (push) z.deathVel.copy(push)
      gameRuntime.targets = gameRuntime.targets.filter((t) => t !== z.root)
      useGameStore.getState().addKill(points)
      sfx.zombie('death', z.root.position.x, z.root.position.z)
      goreApi.pool?.(z.root.position, 1.1 + Math.random() * 0.6)
    }
    const away = (from: THREE.Vector3) => _dir.copy(from).sub(gameRuntime.playerPos).setY(0).normalize()
    const popHead = (z: Zombie, dir: THREE.Vector3) => {
      if (!z.anim || !sever(z.anim, 'Head')) return
      const neck = boneWorld(z.anim, 'Head')
      goreApi.gib?.('head', neck.clone().add(new THREE.Vector3(0, 0.12, 0)), dir.clone().multiplyScalar(3 + Math.random() * 2).add(new THREE.Vector3(0, 3.5, 0)), SKIN)
      goreApi.spray?.(neck, new THREE.Vector3(0, 1, 0), 60, 3.5)
      z.neckBleed = 1.6
    }
    const severLimb = (z: Zombie, bone: string, kind: 'arm' | 'leg', dir: THREE.Vector3) => {
      if (!z.anim || !sever(z.anim, bone)) return
      const at = boneWorld(z.anim, bone)
      goreApi.gib?.(kind, at, dir.clone().multiplyScalar(2.2).add(new THREE.Vector3(0, 2.2, 0)), SKIN)
      goreApi.spray?.(at, dir, 40, 2.5)
      goreApi.pool?.(at, 0.6)
      if (kind === 'leg' && !z.crawling) {
        // Lost a leg: drop and crawl, RE2 style.
        z.crawling = true
        z.speed *= 0.45
      }
    }
    zombieApi.damage = (hit: ZombieHit, amount: number) => {
      const z = zombies.current.find((zz) => zz.id === hit.zombieId)
      if (!z || z.dying > 0) return
      z.hp -= amount
      z.hitFlash = 1
      if (z.hp > 0 && Math.random() < 0.6) sfx.zombie('hit', z.root.position.x, z.root.position.z)
      const dir = away(hit.point).clone()
      goreApi.spray?.(hit.point, dir, hit.headshot ? 34 : 14, hit.headshot ? 3 : 2)
      if (z.anim) {
        if (z.hp > 0 && !z.crawling) z.stagger = 0.3
        const part = hit.part ?? (hit.headshot ? 'head' : 'torso')
        if (hit.headshot && z.hp <= 0) popHead(z, dir)
        else if (part === 'legL' || part === 'legR' || part === 'armL' || part === 'armR') {
          z.limbDmg[part] = (z.limbDmg[part] ?? 0) + amount
          const side = part.endsWith('L') ? 'L' : 'R'
          const isLeg = part.startsWith('leg')
          if (z.limbDmg[part] >= 1.5) severLimb(z, `${isLeg ? "UpperLeg" : "UpperArm"}${side}`, isLeg ? 'leg' : 'arm', dir)
        }
      }
      // Knock back a little along the shot.
      z.root.position.addScaledVector(dir, 0.12)
      if (z.hp <= 0) kill(z, hit.headshot ? 150 : 100, dir.clone().multiplyScalar(amount >= 50 ? 3.2 : 1.8))
    }
    zombieApi.radius = (point, radius, maxDamage) => {
      let n = 0
      for (const z of zombies.current) {
        if (z.dying > 0) continue
        const d = z.root.position.distanceTo(point)
        if (d > radius) continue
        n += 1
        z.hp -= maxDamage * (1 - (d / radius) * 0.7)
        z.hitFlash = 1
        _sep.copy(z.root.position).sub(point).setY(0).normalize()
        z.root.position.addScaledVector(_sep, (1 - d / radius) * 1.2)
        const dir = _sep.clone()
        goreApi.spray?.(z.root.position.clone().setY(z.root.position.y + 1), dir, 40, 4)
        if (z.anim && d < radius * 0.7) {
          // Close to the blast: tear limbs off.
          for (const [bone, kind] of [['UpperArmL', 'arm'], ['UpperArmR', 'arm'], ['UpperLegL', 'leg'], ['UpperLegR', 'leg']] as const) {
            if (Math.random() < 0.45) severLimb(z, bone, kind, dir)
          }
          if (z.hp <= 0 && Math.random() < 0.5) popHead(z, dir)
        }
        if (z.hp <= 0) kill(z, 120, dir.clone().multiplyScalar(5 * (1 - d / radius) + 1.5))
      }
      return n
    }
    return () => {
      zombieApi.damage = null
      zombieApi.radius = null
    }
  }, [])

  const spawnZombie = (number: number) => {
    const z = makeZombie(nextId++)
    // Tougher every round.
    z.hp = 2 + number * 0.6
    z.speed = Math.min(2.7, 0.9 + number * 0.14 + Math.random() * 0.35)
    const points = frame.config.spawnPoints
    if (points.length) {
      // Come out of the surrounding city: cross streets and the far blocks.
      const sp = points[Math.floor(Math.random() * points.length)]
      const jitter = (Math.random() - 0.5) * 2.4
      arenaPoint(frame, sp.at[0] + jitter, sp.at[1] + jitter, frame.origin.y, z.root.position)
      z.waypoint = sp.via ? arenaPoint(frame, sp.via[0] + jitter * 0.5, sp.via[1] + jitter * 0.5, frame.origin.y) : null
      z.inside = false
    } else {
      // Emerge from whichever end is further from the player, sometimes the other.
      const { u: pu } = arenaLocal(frame, gameRuntime.playerPos)
      const front = Number.isFinite(frame.config.spawnFront) ? frame.config.spawnFront : frame.config.front - 0.6
      const back = Number.isFinite(frame.config.spawnBack) ? -frame.config.spawnBack : -frame.config.back + 0.6
      const farFront = Math.abs(front - pu) > Math.abs(back - pu)
      const fromFront = Math.random() < (farFront ? 0.75 : 0.25)
      const u = fromFront ? front : back
      const v = (Math.random() * 2 - 1) * (frame.config.halfWidth - 0.6)
      arenaPoint(frame, u, v, frame.origin.y, z.root.position)
    }
    group.current?.add(z.root)
    zombies.current.push(z)
    gameRuntime.targets.push(z.root)
  }

  // Dev-only: place a zombie at street coords for automated visual checks.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__zombies = {
      spawn: (u: number, v: number, hp = 6) => {
        const z = makeZombie(nextId++)
        z.hp = hp
        z.speed = 0.6
        arenaPoint(frame, u, v, frame.origin.y, z.root.position)
        group.current?.add(z.root)
        zombies.current.push(z)
        gameRuntime.targets.push(z.root)
        return z.id
      },
      count: () => zombies.current.filter((z) => z.dying === 0).length,
      hitboxes: (on: boolean) => setHitboxDebug(on),
      debug: () => {
        const z = zombies.current.find((zz) => zz.anim && zz.dying === 0)
        if (!z?.anim) return null
        const w = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).toArray().map((n) => +n.toFixed(2))
        return {
          root: w(z.root), head: w(z.anim.headBox), headScale: z.anim.headBox.scale.x, body: w(z.anim.bodyBox), bodyScale: z.anim.bodyBox.scale.toArray().map((n) => +n.toFixed(2)),
          limbs: z.anim.limbBoxes.map((l) => [l.part, w(l.mesh), +l.mesh.scale.y.toFixed(2)]),
          bones: Object.keys(z.anim.bones).length,
          headBone: z.anim.bones.Head ? w(z.anim.bones.Head) : null,
        }
      },
    }
    return () => {
      delete w.__zombies
    }
  }, [frame])

  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const s = useGameStore.getState()
    if (s.phase !== 'playing' && s.phase !== 'dead') return
    if (s.indoors) return // the street holds its breath while you're inside
    const playing = s.phase === 'playing'

    // Wave director.
    const w = wave.current
    if (playing) {
      if (w.toSpawn === 0 && zombies.current.every((z) => z.dying > 0)) {
        w.breakIn -= delta
        if (w.breakIn <= 0) {
          w.number += 1
          w.toSpawn = waveSize(w.number)
          w.spawnIn = 0.5
          w.breakIn = BREAK_SECONDS
          s.setWave(w.number)
          s.showBanner(`wave ${w.number}`)
        }
      }
      if (w.toSpawn > 0) {
        w.spawnIn -= delta
        if (w.spawnIn <= 0) {
          spawnZombie(w.number)
          w.toSpawn -= 1
          w.spawnIn = Math.max(0.45, 1.4 - w.number * 0.1) * (0.6 + Math.random() * 0.8)
        }
      }
    }

    const player = gameRuntime.playerPos
    let alive = 0
    for (const z of zombies.current) {
      const r = z.root
      if (z.dying > 0) {
        z.dying += delta
        // Thrown back along the shot, sliding to a stop on the wet street.
        r.position.addScaledVector(z.deathVel, delta)
        z.deathVel.multiplyScalar(Math.pow(0.04, delta))
        if (z.anim) {
          // Death clip, then sink into the street.
          if (!z.crawling) playClip(z.anim, 'death', 0.12)
          z.anim.mixer.update(delta)
          applySevered(z.anim)
          if (z.neckBleed > 0) {
            z.neckBleed -= delta
            goreApi.spray?.(boneWorld(z.anim, 'Head'), new THREE.Vector3(0, 1, 0), 4, 2.6)
          }
          if (z.dying > 2.4) r.position.y -= delta * 0.4
        } else {
          // Topple backwards, then sink into the street.
          const t = Math.min(1, z.dying / 0.45)
          r.rotation.x = -t * (Math.PI / 2) * 0.95
          if (z.dying > 1.6) r.position.y -= delta * 0.5
        }
        continue
      }
      alive += 1

      if (z.waypoint && r.position.distanceTo(z.waypoint) < 1.2) z.waypoint = null
      const target = z.waypoint ?? player
      _toPlayer.copy(target).sub(r.position).setY(0)
      const targetDist = _toPlayer.length()
      if (targetDist > 0.0001) _toPlayer.divideScalar(targetDist)
      const dist = z.waypoint ? Infinity : targetDist

      // Keep a little space between zombies so they crowd instead of stacking.
      _sep.set(0, 0, 0)
      for (const o of zombies.current) {
        if (o === z || o.dying > 0) continue
        const dx = r.position.x - o.root.position.x
        const dz = r.position.z - o.root.position.z
        const d2 = dx * dx + dz * dz
        if (d2 < 0.36 && d2 > 0.0001) _sep.x += dx / d2, _sep.z += dz / d2
      }

      z.stagger = Math.max(0, z.stagger - delta)
      if (playing && dist > ATTACK_RANGE * 0.85 && z.stagger === 0) {
        z.lurch += delta * 2.3
        const surge = 0.75 + Math.sin(z.lurch) * 0.25
        r.position.addScaledVector(_toPlayer, z.speed * surge * delta)
        r.position.addScaledVector(_sep, delta * 0.08)
        z.phase += delta * z.speed * 5.2
      }
      // Clamp to the street once inside it (spawns start out in the side streets).
      const local = arenaLocal(frame, r.position)
      const cu = THREE.MathUtils.clamp(local.u, -frame.config.back + 0.3, frame.config.front - 0.3)
      const cv = THREE.MathUtils.clamp(local.v, -frame.config.halfWidth + 0.3, frame.config.halfWidth - 0.3)
      if (!z.inside && !z.waypoint && cu === local.u && cv === local.v) z.inside = true
      if (z.inside && (cu !== local.u || cv !== local.v)) arenaPoint(frame, cu, cv, r.position.y, r.position)
      r.position.y = frame.origin.y

      r.rotation.y = Math.atan2(_toPlayer.x, _toPlayer.z)
      if (z.anim) {
        const inReach = dist < ATTACK_RANGE * 1.1
        if (z.crawling) playClip(z.anim, 'crawl', 0.3, Math.max(0.6, z.speed / 0.6))
        else if (z.stagger > 0) playClip(z.anim, 'hit', 0.08)
        else if (inReach) playClip(z.anim, 'attack', 0.15)
        else if (z.speed > 1.7) playClip(z.anim, 'run', 0.25, z.speed / 3.2)
        else playClip(z.anim, 'walk', 0.25, z.speed / 1.1)
        z.anim.mixer.update(delta)
        applySevered(z.anim)
        syncHitboxes(z.anim)
      }
      const swing = Math.sin(z.phase) * 0.55
      z.parts.legL.rotation.x = swing
      z.parts.legR.rotation.x = -swing
      z.parts.torso.rotation.x = 0.18 + Math.sin(z.phase * 2) * 0.03
      z.parts.torso.rotation.z = Math.sin(z.phase) * 0.06
      z.parts.head.rotation.x = Math.sin(z.phase * 0.7 + z.id) * 0.12

      // Arms reach forward; claw when in range.
      z.attackCooldown = Math.max(0, z.attackCooldown - delta)
      const inRange = dist < ATTACK_RANGE
      const claw = inRange ? Math.sin((1 - z.attackCooldown / ATTACK_INTERVAL) * Math.PI) * 0.6 : 0
      z.parts.armL.rotation.x = -1.35 + Math.sin(z.phase + 1) * 0.12 - claw
      z.parts.armR.rotation.x = -1.45 + Math.sin(z.phase) * 0.12 - claw * 0.8
      if (playing && inRange && z.attackCooldown === 0) {
        z.attackCooldown = ATTACK_INTERVAL
        // Hits harder every round.
        s.damage(Math.min(40, ATTACK_DAMAGE + (s.wave - 1) * 2))
        sfx.hurt()
        sfx.zombie('attack', r.position.x, r.position.z)
      }

      z.groanIn -= delta
      if (z.groanIn <= 0) {
        z.groanIn = 3 + Math.random() * 6
        if (dist < 18) sfx.zombie('groan', r.position.x, r.position.z)
      }

      if (z.hitFlash > 0) {
        z.hitFlash = Math.max(0, z.hitFlash - delta * 6)
        for (const m of z.mats) m.emissive.setRGB(z.hitFlash * 0.6, 0, 0)
      }
    }

    // Remove corpses once they have sunk.
    const keep = zombies.current.filter((z) => {
      if (z.dying > (z.anim ? 4.2 : 3)) {
        z.root.removeFromParent()
        z.anim?.mixer.stopAllAction()
        z.mats.forEach((m) => m.dispose())
        return false
      }
      return true
    })
    if (keep.length !== zombies.current.length) zombies.current = keep
    if (alive + w.toSpawn !== s.alive) s.setAlive(alive + w.toSpawn)
  })

  return <group ref={group} />
}
