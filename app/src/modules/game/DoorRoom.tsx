import { useMemo } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { arenaFrame, arenaPoint, type ArenaConfig, type ArenaFrame } from './arena'

/**
 * Placeholder interior behind every door: an enclosed plastered room far below
 * the street. A real interior can replace it later; the door / teleport / pause
 * flow is what matters now.
 */
export const ROOM = { width: 5, depth: 6, height: 3, drop: 60 }

export function roomFrame(frame: ArenaFrame) {
  const center = arenaPoint(frame, 0, 0, frame.origin.y - ROOM.drop)
  const yaw = Math.atan2(frame.forward.x, frame.forward.z)
  const toWorld = (x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(center)
  return {
    center,
    yaw,
    toWorld,
    /** Where you stand after walking in (just inside the door, facing in). */
    spawn: toWorld(0, 1.1, -ROOM.depth / 2 + 1.2),
    /** Exit door position (on the -z wall). */
    exit: toWorld(0, 1.1, -ROOM.depth / 2 + 0.2),
  }
}

export function DoorRoom({ arena }: { arena: ArenaConfig }) {
  const frame = useMemo(() => arenaFrame(arena), [arena])
  const room = useMemo(() => roomFrame(frame), [frame])
  const { width: W, depth: D, height: H } = ROOM

  const mats = useMemo(() => ({
    wall: new THREE.MeshStandardMaterial({ color: '#d9cbb3', roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 0.6 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#efe7da', roughness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.7 }),
    door: new THREE.MeshStandardMaterial({ color: '#4a2c1c', roughness: 0.55 }),
    wood: new THREE.MeshStandardMaterial({ color: '#5b3b26', roughness: 0.5 }),
    bulb: new THREE.MeshStandardMaterial({ color: '#fff1d0', emissive: '#ffcf86', emissiveIntensity: 3 }),
  }), [])

  const t = 0.2
  const parts: { size: [number, number, number]; pos: [number, number, number]; mat: THREE.Material; collide?: boolean }[] = [
    { size: [W, t, D], pos: [0, -t / 2, 0], mat: mats.floor, collide: true },
    { size: [W, t, D], pos: [0, H + t / 2, 0], mat: mats.ceiling, collide: true },
    { size: [t, H, D], pos: [-W / 2 - t / 2, H / 2, 0], mat: mats.wall, collide: true },
    { size: [t, H, D], pos: [W / 2 + t / 2, H / 2, 0], mat: mats.wall, collide: true },
    { size: [W, H, t], pos: [0, H / 2, D / 2 + t / 2], mat: mats.wall, collide: true },
    { size: [W, H, t], pos: [0, H / 2, -D / 2 - t / 2], mat: mats.wall, collide: true },
    // Skirting, the way-out door and a little furniture.
    { size: [W, 0.12, 0.03], pos: [0, 0.06, D / 2 - 0.015], mat: mats.trim },
    { size: [1.0, 2.1, 0.06], pos: [0, 1.05, -D / 2 + 0.03], mat: mats.door },
    { size: [1.2, 2.25, 0.04], pos: [0, 1.12, -D / 2 + 0.01], mat: mats.trim },
    { size: [1.4, 0.06, 0.8], pos: [1.1, 0.76, 1.2], mat: mats.wood, collide: true },
    { size: [0.06, 0.74, 0.06], pos: [0.45, 0.37, 0.85], mat: mats.wood },
    { size: [0.06, 0.74, 0.06], pos: [1.75, 0.37, 0.85], mat: mats.wood },
    { size: [0.06, 0.74, 0.06], pos: [0.45, 0.37, 1.55], mat: mats.wood },
    { size: [0.06, 0.74, 0.06], pos: [1.75, 0.37, 1.55], mat: mats.wood },
    { size: [0.18, 0.12, 0.18], pos: [0, H - 0.06, 0], mat: mats.bulb },
  ]

  return (
    <group position={room.center} rotation={[0, room.yaw, 0]}>
      <RigidBody type="fixed" colliders={false} userData={{ noDecal: true }}>
        {parts.filter((p) => p.collide).map((p, i) => (
          <CuboidCollider key={i} args={[p.size[0] / 2, p.size[1] / 2, p.size[2] / 2]} position={p.pos} />
        ))}
      </RigidBody>
      {parts.map((p, i) => (
        <mesh key={i} position={p.pos} material={p.mat} raycast={() => {}}>
          <boxGeometry args={p.size} />
        </mesh>
      ))}
      <pointLight position={[0, H - 0.35, 0]} color="#ffcf86" intensity={9} distance={9} decay={1.6} />
      <pointLight position={[0, 1.6, -D / 2 + 0.8]} color="#ffd9a8" intensity={2} distance={4} decay={2} />
    </group>
  )
}
