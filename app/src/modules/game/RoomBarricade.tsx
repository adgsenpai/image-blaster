import { useMemo } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { arenaFrame, type ArenaConfig } from './arena'
import { roomFrame } from './DoorRoom'

/**
 * Barricaded back wall for a scanned interior. The photo never saw behind its own
 * camera, so that side of the splat room is unreconstructed: board it up, apocalypse
 * style, with the way out in the middle.
 */
export function RoomBarricade({ arena }: { arena: ArenaConfig }) {
  const room = useMemo(() => roomFrame(arenaFrame(arena)), [arena])
  const parts = useMemo(() => {
    const rnd = (() => {
      let s = 7
      return () => ((s = (s * 16807) % 2147483647) / 2147483647)
    })()
    const plaster = new THREE.MeshStandardMaterial({ color: '#3a2a24', roughness: 0.95 })
    const plankMats = ['#5a3d26', '#6b4a2e', '#4a3220', '#7a5634'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }))
    const sack = new THREE.MeshStandardMaterial({ color: '#8b7a5a', roughness: 1 })
    const door = new THREE.MeshStandardMaterial({ color: '#2b1d14', roughness: 0.6 })
    const metal = new THREE.MeshStandardMaterial({ color: '#2d2f33', metalness: 0.7, roughness: 0.4 })
    const meshes: { geo: THREE.BufferGeometry; mat: THREE.Material; pos: [number, number, number]; rot?: [number, number, number] }[] = []
    const Z = 1.9
    // Back wall with a door gap.
    meshes.push({ geo: new THREE.BoxGeometry(5, 4.2, 0.3), mat: plaster, pos: [-3.1, 2.1, Z + 0.2] })
    meshes.push({ geo: new THREE.BoxGeometry(5, 4.2, 0.3), mat: plaster, pos: [3.1, 2.1, Z + 0.2] })
    meshes.push({ geo: new THREE.BoxGeometry(1.2, 1.9, 0.3), mat: plaster, pos: [0, 3.25, Z + 0.2] })
    meshes.push({ geo: new THREE.BoxGeometry(1.1, 2.25, 0.08), mat: door, pos: [0, 1.12, Z + 0.1] })
    meshes.push({ geo: new THREE.BoxGeometry(0.08, 0.04, 0.12), mat: metal, pos: [0.4, 1.05, Z] })
    // Planks nailed across both sides, at angles.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const len = 1.6 + rnd() * 1.6
        meshes.push({
          geo: new THREE.BoxGeometry(len, 0.18 + rnd() * 0.06, 0.05),
          mat: plankMats[i % plankMats.length],
          pos: [side * (1.4 + rnd() * 3), 0.5 + rnd() * 3.2, Z - 0.02 - rnd() * 0.04],
          rot: [0, 0, (rnd() - 0.5) * 1.3],
        })
      }
    }
    // Sandbag walls either side of the door.
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 4; k++) {
          meshes.push({
            geo: new THREE.CapsuleGeometry(0.16, 0.38, 4, 8),
            mat: sack,
            pos: [side * (1.0 + k * 0.52 + (row % 2) * 0.26), 0.16 + row * 0.28, Z - 0.35],
            rot: [0, 0, Math.PI / 2],
          })
        }
      }
    }
    return meshes
  }, [])

  return (
    <group position={room.center}>
      <RigidBody type="fixed" colliders={false} userData={{ noDecal: true }}>
        <CuboidCollider args={[6, 2.2, 0.3]} position={[0, 2.1, 2.3]} />
      </RigidBody>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geo} material={p.mat} position={p.pos} rotation={p.rot} raycast={() => {}} />
      ))}
      <pointLight position={[0, 2.4, 1.2]} color="#ffb070" intensity={3} distance={5} decay={2} />
    </group>
  )
}
