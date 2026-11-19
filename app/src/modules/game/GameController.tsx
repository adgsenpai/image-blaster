import { useEffect, useMemo, useRef } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { useDebugStore } from '../../store/debug'
import { useGameStore } from '../../store/game'
import { CAMERA_EYE_OFFSET, CHARACTER_HEIGHT } from '../character/spawn'
import { arenaFrame, arenaLocal, arenaPoint, type ArenaConfig } from './arena'
import { gameRuntime, goreApi, grenadeApi, zombieApi } from './runtime'
import { sfx } from './sfx'
import { WEAPONS, WEAPON_ORDER, buildViewmodel, type WeaponId } from './weapons'
import { upgradeViewmodel } from './gunModels'
import { roomFrame } from './DoorRoom'

const WALK_SPEED = 4
const SPRINT_MULT = 1.6
const ADS_SPEED_MULT = 0.55
const JUMP_VELOCITY = 3.2
const RADIUS = 0.25
const HALF_SEGMENT = CHARACTER_HEIGHT / 2 - RADIUS
const BASE_FOV = 75
const SWITCH_TIME = 0.28
const GRENADE_COOLDOWN = 0.8

const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _euler = new THREE.Euler(0, 0, 0, 'YXZ')

function makeFlash() {
  const sprite = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  sprite.raycast = () => {}
  return sprite
}

export function GameController({ arena, street }: { arena: ArenaConfig; street?: { left: number; right: number } }) {
  const bodyRef = useRef<React.ComponentRef<typeof RigidBody>>(null)
  const { camera, gl, scene } = useThree()
  const { rapier, world } = useRapier()
  const frame = useMemo(() => arenaFrame(arena), [arena])
  const sensitivity = useDebugStore((s) => s.flyMouseSensitivity)
  const runToken = useGameStore((s) => s.runToken)

  const keys = useRef(new Set<string>())
  const yaw = useRef(frame.yaw)
  const pitch = useRef(0)
  const jumpQueued = useRef(false)
  const triggerHeld = useRef(false)
  const aimHeld = useRef(false)
  const noLock = useRef(false)
  const cooldown = useRef(0)
  const grenadeCooldown = useRef(0)
  const reloadLeft = useRef(0)
  const recoil = useRef(0)
  const flash = useRef(0)
  const bob = useRef(0)
  const swing = useRef(0)
  const adsBlend = useRef(0)
  const switchLeft = useRef(0)
  const throwAnim = useRef(0)
  const shownWeapon = useRef<WeaponId>('pistol')
  const raycaster = useMemo(() => new THREE.Raycaster(), [])

  const spawn = useMemo(() => arenaPoint(frame, 0, 0, frame.origin.y + CHARACTER_HEIGHT / 2 + 0.3), [frame])
  const room = useMemo(() => roomFrame(frame), [frame])
  const doors = useMemo(() => (frame.config.doors ?? []).map((d) => ({
    ...d,
    // Stand on the sidewalk just in front of the door.
    stand: arenaPoint(frame, d.u, d.v + (d.v < 0 ? 0.9 : -0.9), frame.origin.y),
  })), [frame])
  const activeDoor = useRef<(typeof doors)[number] | null>(null)
  const transitioning = useRef(false)

  const yawToward = (dir: THREE.Vector3) => Math.atan2(-dir.x, -dir.z)
  const doorTransition = () => {
    const s = useGameStore.getState()
    if (transitioning.current || s.phase !== 'playing' || !s.prompt) return
    transitioning.current = true
    s.setFade(1)
    sfx.door()
    setTimeout(() => {
      const st = useGameStore.getState()
      const body = bodyRef.current
      if (body) {
        if (!st.indoors && activeDoor.current) {
          body.setTranslation({ x: room.spawn.x, y: room.spawn.y, z: room.spawn.z }, true)
          yaw.current = yawToward(new THREE.Vector3(Math.sin(room.yaw), 0, Math.cos(room.yaw)))
          st.setIndoors(true)
        } else if (st.indoors && activeDoor.current) {
          const d = activeDoor.current
          body.setTranslation({ x: d.stand.x, y: d.stand.y + CHARACTER_HEIGHT / 2 + 0.3, z: d.stand.z }, true)
          const out = arenaPoint(frame, d.u, 0, 0).sub(arenaPoint(frame, d.u, d.v, 0)).setY(0).normalize()
          yaw.current = yawToward(out)
          st.setIndoors(false)
        }
        body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        pitch.current = 0
      }
      useGameStore.getState().setFade(0)
      transitioning.current = false
    }, 330)
  }

  // Viewmodels + lights ride on the camera.
  const rig = useMemo(() => {
    const group = new THREE.Group()
    const holder = new THREE.Group()
    group.add(holder)
    const models = {} as Record<WeaponId, { root: THREE.Group; flash: THREE.Mesh }>
    for (const id of WEAPON_ORDER) {
      const root = new THREE.Group()
      const model = buildViewmodel(id)
      root.add(model)
      void upgradeViewmodel(id, root, model)
      const f = makeFlash()
      f.position.set(...WEAPONS[id].muzzle)
      f.position.z -= 0.02
      root.add(f)
      root.visible = id === 'pistol'
      holder.add(root)
      models[id] = { root, flash: f }
    }
    const torch = new THREE.SpotLight('#fff2d6', 18, 32, Math.PI / 7, 0.45, 1.4)
    torch.position.set(-0.25, 0.05, 0.1)
    torch.target.position.set(0.05, -0.1, -6)
    group.add(torch, torch.target)
    const muzzle = new THREE.PointLight('#ffb35c', 0, 8, 2)
    group.add(muzzle)
    return { group, holder, models, muzzle }
  }, [])

  useEffect(() => {
    scene.add(camera)
    return () => {
      scene.remove(camera)
      const cam = camera as THREE.PerspectiveCamera
      cam.fov = BASE_FOV
      cam.updateProjectionMatrix()
    }
  }, [camera, scene])

  const reset = () => {
    const body = bodyRef.current
    if (body) {
      body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }
    yaw.current = frame.yaw
    pitch.current = 0
    reloadLeft.current = 0
    triggerHeld.current = false
    aimHeld.current = false
    useGameStore.getState().setReloading(false)
  }

  useEffect(reset, [runToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const startReload = () => {
    const s = useGameStore.getState()
    const def = WEAPONS[s.weapon]
    if (!def.mag || s.reloading || s.ammo[s.weapon] === def.mag || switchLeft.current > 0) return
    reloadLeft.current = def.reload
    s.setReloading(true)
    sfx.reload(def.id)
  }

  const switchTo = (id: WeaponId) => {
    const s = useGameStore.getState()
    if (s.weapon === id || s.phase !== 'playing') return
    reloadLeft.current = 0
    s.setWeapon(id)
    switchLeft.current = SWITCH_TIME
    cooldown.current = Math.max(cooldown.current, SWITCH_TIME * 0.8)
    sfx.reload()
  }

  const throwGrenade = () => {
    const s = useGameStore.getState()
    if (s.phase !== 'playing' || grenadeCooldown.current > 0 || !grenadeApi.throw) return
    if (!s.consumeGrenade()) {
      sfx.dryFire()
      return
    }
    grenadeCooldown.current = GRENADE_COOLDOWN
    throwAnim.current = 1
    camera.getWorldDirection(_dir)
    const origin = camera.position.clone().addScaledVector(_dir, 0.4).add(_tmp.set(0, -0.1, 0))
    const velocity = _dir.clone().multiplyScalar(14).add(_tmp.set(0, 3.5, 0))
    grenadeApi.throw(origin, velocity)
  }

  const fire = () => {
    const s = useGameStore.getState()
    const def = WEAPONS[s.weapon]
    if (s.phase !== 'playing' || s.reloading || cooldown.current > 0 || switchLeft.current > 0) return

    if (def.mag) {
      const ammo = s.ammo[s.weapon]
      if (ammo <= 0) {
        sfx.dryFire()
        startReload()
        return
      }
      s.setAmmo(s.weapon, ammo - 1)
      recoil.current = 1
      flash.current = 1
      const kick = def.kick * (aimHeld.current ? 0.6 : 1)
      pitch.current = Math.min(Math.PI / 2.2, pitch.current + kick)
      if (def.auto) yaw.current += (Math.random() - 0.5) * kick * 0.8
      gameRuntime.shake = Math.max(gameRuntime.shake, def.id === 'sniper' ? 0.6 : 0.15)
      sfx.shot(def.id)
      // Brass out to the right, smoke at the muzzle.
      const vmRoot = rig.models[s.weapon].root
      const eject = camera.localToWorld(vmRoot.position.clone().add(new THREE.Vector3(0.03, 0.03, 0)))
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
      goreApi.casing?.(eject, right.multiplyScalar(1.6 + Math.random() * 0.8).add(new THREE.Vector3(0, 1.8 + Math.random(), 0)))
      goreApi.smoke?.(camera.localToWorld(vmRoot.position.clone().add(new THREE.Vector3(...def.muzzle))))
      if (ammo - 1 === 0) setTimeout(startReload, 120)
    } else {
      swing.current = 1
      sfx.swing()
    }
    cooldown.current = def.interval

    // Hitscan with a spread cone.
    const spread = THREE.MathUtils.lerp(def.hipSpread, def.adsSpread, adsBlend.current)
    camera.getWorldDirection(_dir)
    if (spread > 0) {
      _dir.x += (Math.random() - 0.5) * 2 * spread
      _dir.y += (Math.random() - 0.5) * 2 * spread
      _dir.z += (Math.random() - 0.5) * 2 * spread
      _dir.normalize()
    }
    raycaster.set(camera.position, _dir)
    raycaster.far = def.range
    const hits = raycaster.intersectObjects(gameRuntime.targets, true)

    // Bullet impact on the world: analytic street geometry (ground + both facade lines),
    // which lines up with the scanned walls better than the coarse collider mesh.
    if (def.mag) {
      const firstZombie = hits.find((h) => h.object.userData.zombieId !== undefined)
      const o = camera.position
      let bestT = def.range
      let normal: THREE.Vector3 | null = null
      if (_dir.y < -1e-4) {
        const t = (frame.origin.y - o.y) / _dir.y
        if (t > 0 && t < bestT) {
          bestT = t
          normal = new THREE.Vector3(0, 1, 0)
        }
      }
      const ov = (o.x - frame.origin.x) * frame.right.x + (o.z - frame.origin.z) * frame.right.z
      const dv = _dir.x * frame.right.x + _dir.z * frame.right.z
      for (const line of street ? [street.left, street.right] : []) {
        if (Math.abs(dv) < 1e-4) continue
        const t = (line - ov) / dv
        if (t <= 0 || t >= bestT) continue
        const y = o.y + _dir.y * t
        if (y < frame.origin.y || y > frame.origin.y + 6) continue
        bestT = t
        normal = frame.right.clone().multiplyScalar(line < 0 ? 1 : -1)
      }
      if (normal && (!firstZombie || bestT < firstZombie.distance || def.pierce)) {
        goreApi.impact?.(o.clone().addScaledVector(_dir, bestT), normal)
      }
    }

    const seen = new Set<number>()
    let landed = false
    let headshotLanded = false
    for (const h of hits) {
      const id = h.object.userData.zombieId
      if (id === undefined || seen.has(id)) continue
      seen.add(id)
      const headshot = Boolean(h.object.userData.head)
      zombieApi.damage?.({ zombieId: id, headshot, point: h.point }, headshot ? def.headDamage : def.bodyDamage)
      landed = true
      headshotLanded ||= headshot
      if (!def.pierce) break
    }
    if (landed) {
      s.markHit(headshotLanded)
      sfx.hit(headshotLanded)
      sfx.hitmarker()
    }
  }

  useEffect(() => {
    const el = gl.domElement
    const locked = () => document.pointerLockElement === el
    const requestLock = () => {
      try {
        const result = el.requestPointerLock() as unknown as Promise<void> | undefined
        result?.catch?.(() => {
          noLock.current = true
        })
      } catch {
        noLock.current = true
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keyup') {
        keys.current.delete(e.code)
        return
      }
      keys.current.add(e.code)
      if (e.repeat) return
      const s = useGameStore.getState()
      if (e.code === 'Space') jumpQueued.current = true
      else if (e.code === 'KeyR') {
        if (s.phase === 'dead') s.start()
        else startReload()
      } else if (e.code === 'KeyG') throwGrenade()
      else if (e.code === 'KeyE') doorTransition()
      else if (e.code === 'KeyV') switchTo('knife')
      else if (e.code.startsWith('Digit') && !e.shiftKey && !e.altKey) {
        const id = WEAPON_ORDER[Number(e.code.slice(5)) - 1]
        if (id) switchTo(id)
      }
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault()
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!locked()) return
      if ((e.buttons & 1) === 0) triggerHeld.current = false
      if ((e.buttons & 2) === 0) aimHeld.current = false
      const cam = camera as THREE.PerspectiveCamera
      const scale = (cam.fov / BASE_FOV) * sensitivity
      yaw.current -= e.movementX * scale
      pitch.current -= e.movementY * scale
      pitch.current = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch.current))
    }
    const onMouseDown = (e: MouseEvent) => {
      const s = useGameStore.getState()
      if (!locked()) {
        if (e.target !== el) return
        if (s.phase === 'ready' || s.phase === 'dead') {
          s.start()
          requestLock()
          return
        }
        if (s.phase === 'paused') {
          s.resume()
          requestLock()
          return
        }
        // Pointer lock unavailable (embedded/automated browsers): clicks still work.
        if (!noLock.current) {
          requestLock()
          return
        }
      }
      if (e.button === 0) {
        triggerHeld.current = true
        fire()
      } else if (e.button === 2) {
        aimHeld.current = true
      }
    }
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) triggerHeld.current = false
      if (e.button === 2) aimHeld.current = false
    }
    const onWheel = (e: WheelEvent) => {
      if (!locked() && !noLock.current) return
      const s = useGameStore.getState()
      const i = WEAPON_ORDER.indexOf(s.weapon)
      const next = WEAPON_ORDER[(i + (e.deltaY > 0 ? 1 : -1) + WEAPON_ORDER.length) % WEAPON_ORDER.length]
      switchTo(next)
    }
    const onContextMenu = (e: MouseEvent) => {
      if (e.target === el) e.preventDefault()
    }
    const onLockChange = () => {
      if (!locked() && !noLock.current) {
        triggerHeld.current = false
        aimHeld.current = false
        keys.current.clear()
        useGameStore.getState().pause()
      }
    }
    const onBlur = () => {
      triggerHeld.current = false
      aimHeld.current = false
      keys.current.clear()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('blur', onBlur)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('pointerlockchange', onLockChange)
      if (locked()) document.exitPointerLock()
    }
  }, [gl.domElement, sensitivity, camera]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dev-only hook for automated visual checks (no pointer lock in automation).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__fps = {
      look: (yawDeg: number, pitchDeg = 0) => {
        yaw.current = frame.yaw + THREE.MathUtils.degToRad(yawDeg)
        pitch.current = THREE.MathUtils.degToRad(pitchDeg)
      },
      teleport: (u: number, v: number) => {
        const p = arenaPoint(frame, u, v, frame.origin.y + CHARACTER_HEIGHT / 2 + 0.3)
        bodyRef.current?.setTranslation({ x: p.x, y: p.y, z: p.z }, true)
      },
    }
    return () => {
      delete w.__fps
    }
  }, [frame])

  // Taking damage jolts the camera.
  useEffect(() => useGameStore.subscribe((st, prev) => {
    if (st.hurtToken !== prev.hurtToken) {
      gameRuntime.shake = Math.max(gameRuntime.shake, 0.55)
      pitch.current = Math.min(Math.PI / 2.2, pitch.current + 0.035)
      yaw.current += (Math.random() - 0.5) * 0.05
    }
  }), [])
  const heartbeat = useRef(0)

  // Release the mouse when the player dies so the HUD buttons are clickable.
  const phase = useGameStore((s) => s.phase)
  useEffect(() => {
    if (phase === 'dead' && document.pointerLockElement) document.exitPointerLock()
  }, [phase])

  useFrame((_state, rawDelta) => {
    const body = bodyRef.current
    if (!body) return
    const delta = Math.min(rawDelta, 0.05)
    const s = useGameStore.getState()
    const active = s.phase === 'playing'
    const def = WEAPONS[s.weapon]

    cooldown.current = Math.max(0, cooldown.current - delta)
    // Heartbeat when badly hurt, faster the closer to death.
    if (active && s.health <= 30) {
      heartbeat.current -= delta
      if (heartbeat.current <= 0) {
        sfx.heartbeat()
        heartbeat.current = 0.55 + (s.health / 30) * 0.5
      }
    }
    grenadeCooldown.current = Math.max(0, grenadeCooldown.current - delta)
    switchLeft.current = Math.max(0, switchLeft.current - delta)
    if (reloadLeft.current > 0) {
      reloadLeft.current -= delta
      if (reloadLeft.current <= 0) {
        s.setAmmo(s.weapon, def.mag)
        s.setReloading(false)
      }
    }
    if (active && def.auto && triggerHeld.current) fire()

    // Aim down sights.
    const wantAds = active && aimHeld.current && !s.reloading && switchLeft.current === 0 && def.id !== 'knife'
    adsBlend.current = THREE.MathUtils.damp(adsBlend.current, wantAds ? 1 : 0, 14, delta)
    if (wantAds !== s.ads && (wantAds ? adsBlend.current > 0.85 : true)) s.setAds(wantAds)
    const cam = camera as THREE.PerspectiveCamera
    const fov = THREE.MathUtils.lerp(BASE_FOV, def.adsFov, adsBlend.current)
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }

    _euler.set(pitch.current, yaw.current, 0)
    camera.quaternion.setFromEuler(_euler)
    gameRuntime.camYaw = yaw.current

    let fwd = 0
    let strafe = 0
    if (active) {
      const k = keys.current
      if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1
      if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1
      if (k.has('KeyA') || k.has('ArrowLeft')) strafe -= 1
      if (k.has('KeyD') || k.has('ArrowRight')) strafe += 1
    }
    _forward.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
    _right.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current))
    _move.set(0, 0, 0).addScaledVector(_forward, fwd).addScaledVector(_right, strafe)
    if (_move.lengthSq() > 1) _move.normalize()
    const sprint = (keys.current.has('ShiftLeft') || keys.current.has('ShiftRight')) && adsBlend.current < 0.2
    const speed = WALK_SPEED * (sprint ? SPRINT_MULT : 1) * THREE.MathUtils.lerp(1, ADS_SPEED_MULT, adsBlend.current)

    const vel = body.linvel()
    let vy = vel.y
    if (jumpQueued.current) {
      jumpQueued.current = false
      const p = body.translation()
      const ray = new rapier.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 })
      if (active && world.castRay(ray, CAMERA_EYE_OFFSET + 0.1, true, undefined, undefined, undefined, body)) vy = JUMP_VELOCITY
    }
    body.setLinvel({ x: _move.x * speed, y: vy, z: _move.z * speed }, true)

    const p = body.translation()
    if (p.y < frame.origin.y - 10 && !s.indoors) reset()
    if (s.indoors && p.y < room.center.y - 5) body.setTranslation({ x: room.spawn.x, y: room.spawn.y, z: room.spawn.z }, true)

    // Door interaction prompt.
    if (active && !transitioning.current) {
      let prompt = ''
      if (s.indoors) {
        if (Math.hypot(p.x - room.exit.x, p.z - room.exit.z) < 1.8) prompt = 'E · leave'
      } else {
        let best = 2.3
        activeDoor.current = null
        for (const d of doors) {
          const dist = Math.hypot(p.x - d.stand.x, p.z - d.stand.z)
          if (dist < best) {
            best = dist
            activeDoor.current = d
          }
        }
        if (activeDoor.current) prompt = `E · open door${activeDoor.current.label ? ` (${activeDoor.current.label})` : ''}`
      }
      s.setPrompt(prompt)
    }

    const moving = _move.lengthSq() > 0.01 && active
    bob.current += delta * (moving ? (sprint ? 13 : 9) : 0)
    const bobAmt = (moving ? 1 : 0) * (1 - adsBlend.current * 0.85)
    gameRuntime.shake = Math.max(0, gameRuntime.shake - delta * 3)
    const sh = gameRuntime.shake * 0.04
    camera.position.set(
      p.x + (Math.random() - 0.5) * sh,
      p.y + CAMERA_EYE_OFFSET + Math.sin(bob.current) * 0.035 * bobAmt + (Math.random() - 0.5) * sh,
      p.z + (Math.random() - 0.5) * sh,
    )
    gameRuntime.playerPos.set(p.x, p.y, p.z)
    const local = arenaLocal(frame, gameRuntime.playerPos)
    gameRuntime.playerU = local.u
    gameRuntime.playerV = local.v

    // Viewmodel: show the equipped weapon, lerp hip -> sights, animate.
    if (shownWeapon.current !== s.weapon && switchLeft.current < SWITCH_TIME / 2) {
      rig.models[shownWeapon.current].root.visible = false
      shownWeapon.current = s.weapon
    }
    const shown = WEAPONS[shownWeapon.current]
    const vm = rig.models[shownWeapon.current]
    vm.root.visible = !(shown.scope && adsBlend.current > 0.8)
    recoil.current = Math.max(0, recoil.current - delta * 9)
    flash.current = Math.max(0, flash.current - delta * 22)
    swing.current = Math.max(0, swing.current - delta * 3.2)
    throwAnim.current = Math.max(0, throwAnim.current - delta * 3)

    const a = adsBlend.current
    const switchDip = Math.sin((switchLeft.current / SWITCH_TIME) * Math.PI) * 0.25
    const reloadT = s.reloading ? 1 - reloadLeft.current / def.reload : 0
    const reloadDip = s.reloading ? Math.sin(Math.min(1, reloadT) * Math.PI) * 0.18 : 0
    const sway = bobAmt
    vm.root.position.set(
      THREE.MathUtils.lerp(shown.hip[0], shown.aim[0], a) + Math.cos(bob.current * 0.5) * 0.008 * sway,
      THREE.MathUtils.lerp(shown.hip[1], shown.aim[1], a) - reloadDip - switchDip - throwAnim.current * 0.15
        + Math.abs(Math.sin(bob.current * 0.5)) * 0.01 * sway,
      THREE.MathUtils.lerp(shown.hip[2], shown.aim[2], a) + recoil.current * (shown.id === 'sniper' ? 0.09 : 0.04),
    )
    if (shown.id === 'knife') {
      // Slash: sweep across and stab forward.
      const t = 1 - swing.current
      const arc = swing.current > 0 ? Math.sin(t * Math.PI) : 0
      vm.root.rotation.set(-0.3 - arc * 0.9, 0.5 - arc * 1.2, -0.6 + arc * 0.6)
      vm.root.position.z -= arc * 0.12
      vm.root.position.x -= arc * 0.12
    } else {
      vm.root.rotation.set(
        recoil.current * (shown.id === 'sniper' ? 0.35 : 0.2) - reloadDip * 2,
        THREE.MathUtils.lerp(0.1, 0, a),
        reloadDip * 1.5 - THREE.MathUtils.lerp(0.04, 0, a),
      )
    }
    const flashMat = vm.flash.material as THREE.MeshBasicMaterial
    flashMat.opacity = shown.mag ? flash.current : 0
    vm.flash.rotation.z = Math.random() * Math.PI
    rig.muzzle.position.copy(vm.root.position).add(_tmp.set(...shown.muzzle))
    rig.muzzle.intensity = shown.mag ? flash.current * 6 : 0
  })

  return (
    <>
      {createPortal(<primitive object={rig.group} />, camera)}
      <RigidBody
        ref={bodyRef}
        position={spawn.toArray()}
        enabledRotations={[false, false, false]}
        linearDamping={0}
        colliders={false}
      >
        <CapsuleCollider args={[HALF_SEGMENT, RADIUS]} />
      </RigidBody>
    </>
  )
}
