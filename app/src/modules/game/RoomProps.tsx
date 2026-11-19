import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { CuboidCollider, RigidBody, useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { arenaFrame, type GameConfig } from './arena'
import { roomFrame } from './DoorRoom'
import { buildItem, SOLID, type RoomItem } from './roomItems'
import { useRoomEditor } from '../../store/roomEditor'

/**
 * Crisp props placed in a scanned room (vending machines, signs, barricades, crates, GLBs…)
 * plus the in-game room editor (F2): click to select, G/R gizmo, Delete, Ctrl+D, Ctrl+Z, Ctrl+S.
 * Item positions are room-local (photo camera at origin, looking down -z).
 */
export interface RoomBounds { yaw: number; u: [number, number]; v: [number, number]; height: number }

/** Local-space bounding box of an item group (ignores floor glows / lights). */
function localBox(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true)
  const inv = obj.matrixWorld.clone().invert()
  const rel = new THREE.Matrix4()
  const box = new THREE.Box3()
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || o.userData.noBounds || o.userData.helper) return
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld)))
  })
  return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.6, 0.3)) : box
}

function ItemView({ it, register }: { it: RoomItem; register: (id: string, o: THREE.Object3D | null, box: THREE.Box3 | null) => void }) {
  const obj = useMemo(() => buildItem(it), [it.type, it.perk, it.url, it.size?.[0], it.size?.[1], it.width, it.height]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const report = () => register(it.id, obj, localBox(obj))
    report()
    obj.addEventListener('loaded' as never, report)
    return () => {
      obj.removeEventListener('loaded' as never, report)
      register(it.id, null, null)
    }
  }, [obj, it.id, register])
  useEffect(() => {
    obj.position.set(...it.at)
    obj.rotation.set(0, it.rotY, 0)
    obj.scale.setScalar(it.scale ?? 1)
  }, [obj, it.at, it.rotY, it.scale])
  return <primitive object={obj} />
}

function BoundsColliders({ b }: { b: RoomBounds }) {
  const { yaw, u: [u0, u1], v: [v0, v1], height } = b
  const f = [Math.sin(yaw), -Math.cos(yaw)]
  const r = [Math.cos(yaw), Math.sin(yaw)]
  const at = (u: number, v: number, y = height / 2): [number, number, number] => [u * f[0] + v * r[0], y, u * f[1] + v * r[1]]
  const L = u1 - u0
  const W = v1 - v0
  const rot: [number, number, number] = [0, -yaw, 0]
  return (
    <>
      <CuboidCollider args={[0.2, height / 2, L / 2 + 0.4]} rotation={rot} position={at((u0 + u1) / 2, v0 - 0.2)} />
      <CuboidCollider args={[0.2, height / 2, L / 2 + 0.4]} rotation={rot} position={at((u0 + u1) / 2, v1 + 0.2)} />
      <CuboidCollider args={[W / 2 + 0.4, height / 2, 0.2]} rotation={rot} position={at(u0 - 0.2, (v0 + v1) / 2)} />
      <CuboidCollider args={[W / 2 + 0.4, height / 2, 0.2]} rotation={rot} position={at(u1 + 0.2, (v0 + v1) / 2)} />
      <CuboidCollider args={[W / 2 + 0.4, 0.2, L / 2 + 0.4]} rotation={rot} position={at((u0 + u1) / 2, (v0 + v1) / 2, height + 0.2)} />
    </>
  )
}

export function RoomProps({ slug, config }: { slug: string; config: GameConfig }) {
  const room = useMemo(() => roomFrame(arenaFrame(config.arena)), [config.arena])
  const items = useRoomEditor((s) => s.items)
  const on = useRoomEditor((s) => s.on)
  const selected = useRoomEditor((s) => s.selected)
  const mode = useRoomEditor((s) => s.mode)
  const snap = useRoomEditor((s) => s.snap)
  const bounds = (config.arena.room?.props as { bounds?: RoomBounds } | undefined)?.bounds
  const objects = useRef(new Map<string, { o: THREE.Object3D; box: THREE.Box3 }>())
  const [boxes, setBoxes] = useState<Record<string, THREE.Box3>>({})
  const { camera, gl } = useThree()
  const tcRef = useRef<{ axis: string | null } | null>(null)
  const helper = useRef<THREE.Box3Helper | null>(null)

  useEffect(() => {
    useRoomEditor.getState().init(slug, config)
    ;(window as unknown as { __roomObjects: unknown }).__roomObjects = { objects: objects.current, camera, center: room.center }
  }, [slug, config, camera, room.center])

  const register = useMemo(
    () => (id: string, o: THREE.Object3D | null, box: THREE.Box3 | null) => {
      if (o && box) objects.current.set(id, { o, box })
      else objects.current.delete(id)
      setBoxes((prev) => {
        const next = { ...prev }
        if (box) next[id] = box
        else delete next[id]
        return next
      })
    },
    [],
  )

  // Camera pose (room-local) for dropping new items in front of the player.
  const fwd = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    if (!useRoomEditor.getState().on) return
    camera.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    const cam = useRoomEditor.getState().cam
    cam.x = camera.position.x - room.center.x
    cam.z = camera.position.z - room.center.z
    cam.fx = fwd.x
    cam.fz = fwd.z
  })

  // Click-to-select: nearest item whose oriented bounding box the mouse ray hits.
  useEffect(() => {
    if (!on) return
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const inv = new THREE.Matrix4()
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || e.target !== gl.domElement) return
      if (tcRef.current?.axis) return // dragging the gizmo
      if (useRoomEditor.getState().pick) return // drag-capturing a region of the scan
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      let best: string | null = null
      let bestD = Infinity
      const hit = new THREE.Vector3()
      for (const [id, { o, box }] of objects.current) {
        o.updateMatrixWorld()
        inv.copy(o.matrixWorld).invert()
        const local = ray.ray.clone().applyMatrix4(inv)
        if (local.intersectBox(box, hit)) {
          const d = hit.applyMatrix4(o.matrixWorld).distanceTo(ray.ray.origin)
          if (d < bestD) {
            bestD = d
            best = id
          }
        }
      }
      useRoomEditor.getState().select(best)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [on, camera, gl.domElement])

  // Editor shortcuts.
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const s = useRoomEditor.getState()
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.code === 'KeyS') { e.preventDefault(); void s.save() }
      else if (ctrl && e.code === 'KeyZ') { e.preventDefault(); s.undoLast() }
      else if (ctrl && e.code === 'KeyD') { e.preventDefault(); s.duplicate() }
      else if (e.code === 'Delete' || e.code === 'Backspace') s.remove()
      else if (e.code === 'KeyG') s.setMode('translate')
      else if (e.code === 'KeyR') s.setMode('rotate')
      else if (e.code === 'KeyX') s.setSnap(!s.snap)
      else if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
        const it = s.items.find((i) => i.id === s.selected)
        if (it) s.update(it.id, { scale: +Math.max(0.2, (it.scale ?? 1) * (e.code === 'BracketRight' ? 1.1 : 1 / 1.1)).toFixed(3) })
      }
    }
    // Scroll wheel rotates the selection (15° steps with snap, 3° without, Shift = 1°).
    let wheelCommit: ReturnType<typeof setTimeout> | undefined
    const onWheel = (e: WheelEvent) => {
      const s = useRoomEditor.getState()
      const it = s.items.find((i) => i.id === s.selected)
      if (!it || e.target !== gl.domElement) return
      e.preventDefault()
      const step = ((e.shiftKey ? 1 : s.snap ? 15 : 3) * Math.PI) / 180
      const o = objects.current.get(it.id)?.o
      if (!o) return
      o.rotation.y += e.deltaY > 0 ? -step : step
      clearTimeout(wheelCommit)
      wheelCommit = setTimeout(() => useRoomEditor.getState().update(it.id, { rotY: +o.rotation.y.toFixed(4) }), 180)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
      clearTimeout(wheelCommit)
    }
  }, [on, gl.domElement])

  // "From the map": drag a rectangle over the scan -> capture that region of the frame, find where it is
  // in 3D with a physics ray, and generate a clean movable asset there (optionally cutting the scan).
  const pick = useRoomEditor((s) => s.pick)
  const { world, rapier } = useRapier()
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    if (!on || !pick) return
    const el = gl.domElement
    const rectEl = document.createElement('div')
    Object.assign(rectEl.style, { position: 'fixed', border: '2px dashed #ffd23f', background: 'rgba(255,210,63,0.08)', pointerEvents: 'none', zIndex: '40', display: 'none' })
    document.body.appendChild(rectEl)
    el.style.cursor = 'crosshair'
    let start: { x: number; y: number } | null = null
    const box = (e: MouseEvent) => {
      const x0 = Math.min(start!.x, e.clientX)
      const y0 = Math.min(start!.y, e.clientY)
      return { x0, y0, w: Math.abs(e.clientX - start!.x), h: Math.abs(e.clientY - start!.y) }
    }
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || e.target !== el) return
      start = { x: e.clientX, y: e.clientY }
      rectEl.style.display = 'block'
    }
    const move = (e: MouseEvent) => {
      if (!start) return
      const b = box(e)
      Object.assign(rectEl.style, { left: `${b.x0}px`, top: `${b.y0}px`, width: `${b.w}px`, height: `${b.h}px` })
    }
    const up = (e: MouseEvent) => {
      if (!start) return
      const b = box(e)
      start = null
      rectEl.style.display = 'none'
      const s = useRoomEditor.getState()
      if (b.w < 16 || b.h < 16) return
      const r = el.getBoundingClientRect()
      // Capture: render now and copy the pixels before the buffer is cleared.
      gl.render(scene, camera)
      const kx = el.width / r.width
      const ky = el.height / r.height
      const pad = 0.1
      const sx = Math.max(0, (b.x0 - r.left - b.w * pad) * kx)
      const sy = Math.max(0, (b.y0 - r.top - b.h * pad) * ky)
      const sw = Math.min(el.width - sx, b.w * (1 + 2 * pad) * kx)
      const sh = Math.min(el.height - sy, b.h * (1 + 2 * pad) * ky)
      const c = document.createElement('canvas')
      c.width = Math.round(sw)
      c.height = Math.round(sh)
      c.getContext('2d')!.drawImage(el, sx, sy, sw, sh, 0, 0, c.width, c.height)
      const image = c.toDataURL('image/png')
      // Where is it? Ray through the rectangle centre against the room colliders.
      const cam = camera as THREE.PerspectiveCamera
      const ndc = new THREE.Vector2(((b.x0 + b.w / 2 - r.left) / r.width) * 2 - 1, -((b.y0 + b.h / 2 - r.top) / r.height) * 2 + 1)
      const rc = new THREE.Raycaster()
      rc.setFromCamera(ndc, cam)
      const origin = rc.ray.origin.clone().addScaledVector(rc.ray.direction, 0.5)
      const hit = world.castRay(new rapier.Ray(origin, rc.ray.direction), 60, true)
      const dist = 0.5 + (hit ? hit.timeOfImpact : 3)
      const p = rc.ray.origin.clone().addScaledVector(rc.ray.direction, dist).sub(room.center)
      const span = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
      const wH = (b.h / r.height) * span
      const wW = (b.w / r.width) * span * cam.aspect
      const bottom = Math.max(0, p.y - wH / 2)
      const half = Math.max(wW, 0.3) / 2 * 1.1
      const fwd = rc.ray.direction
      s.setPick(false)
      void s.generate(s.prompt, {
        image,
        strength: s.prompt.trim() ? 0.5 : 0.3,
        target: {
          at: [+p.x.toFixed(3), +bottom.toFixed(3), +p.z.toFixed(3)],
          rotY: Math.atan2(-fwd.x, -fwd.z),
          scale: +Math.max(wW, wH, 0.2).toFixed(3),
          cut: [p.x - half, p.x + half, bottom - 0.03, bottom + wH * 1.08, p.z - half, p.z + half].map((v) => +v.toFixed(3)),
        },
      })
    }
    const esc = (e: KeyboardEvent) => e.code === 'Escape' && useRoomEditor.getState().setPick(false)
    window.addEventListener('mousedown', down, true)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('keydown', esc)
      rectEl.remove()
      el.style.cursor = ''
    }
  }, [on, pick, gl, scene, camera, world, rapier, room.center])

  const selObj = on && selected ? objects.current.get(selected)?.o : undefined

  // Outline the selection.
  useEffect(() => {
    if (helper.current) {
      helper.current.parent?.remove(helper.current)
      helper.current = null
    }
    const entry = on && selected ? objects.current.get(selected) : undefined
    if (!entry) return
    const h = new THREE.Box3Helper(entry.box.clone().expandByScalar(0.03), new THREE.Color('#ffd23f'))
    h.userData.helper = true
    entry.o.add(h)
    helper.current = h
  }, [on, selected, boxes])

  const commit = () => {
    if (!selObj || !selected) return
    useRoomEditor.getState().update(selected, {
      at: [+selObj.position.x.toFixed(3), +selObj.position.y.toFixed(3), +selObj.position.z.toFixed(3)],
      rotY: +selObj.rotation.y.toFixed(4),
    })
  }

  return (
    <>
    {selObj && (
        <TransformControls
          ref={tcRef as never}
          object={selObj}
          mode={mode}
          showX={mode === 'translate'}
          showZ={mode === 'translate'}
          showY
          translationSnap={snap ? 0.05 : null}
          rotationSnap={snap ? Math.PI / 24 : null}
          size={0.8}
          onMouseUp={commit}
        />
      )}
    <group position={room.center}>
      {items.map((it) => <ItemView key={it.id} it={it} register={register} />)}
      <RigidBody type="fixed" colliders={false} userData={{ noDecal: true }}>
        {items.filter((it) => SOLID[it.type] && boxes[it.id]).map((it) => {
          const b = boxes[it.id]
          const s = it.scale ?? 1
          const c = b.getCenter(new THREE.Vector3()).multiplyScalar(s).applyAxisAngle(new THREE.Vector3(0, 1, 0), it.rotY)
          const h = b.getSize(new THREE.Vector3()).multiplyScalar(s / 2)
          return (
            <CuboidCollider key={`${it.id}-${it.at.join()}-${it.rotY}-${s}`} args={[Math.max(h.x, 0.02), Math.max(h.y, 0.02), Math.max(h.z, 0.02)]}
              rotation={[0, it.rotY, 0]} position={[it.at[0] + c.x, it.at[1] + c.y, it.at[2] + c.z]} />
          )
        })}
        {bounds && <BoundsColliders b={bounds} />}
      </RigidBody>
    </group>
    </>
  )
}
