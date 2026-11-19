import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { WeaponId } from './weapons'

/** CC0 Quaternius gun models (see public/game/CREDITS.txt). */
const GUNS: Partial<Record<WeaponId, { url: string; rotY: number }>> = {
  pistol: { url: '/game/guns/pistol.glb', rotY: 0 },
  mg: { url: '/game/guns/rifle.glb', rotY: Math.PI / 2 },
  shotgun: { url: '/game/guns/shotgun.glb', rotY: Math.PI / 2 },
  sniper: { url: '/game/guns/sniper.glb', rotY: Math.PI / 2 },
}

/**
 * Replace a procedural viewmodel with the real gun model, fitted into the
 * procedural model's bounds (same length along -Z, same front/centre), so all
 * hip / aim / muzzle tuning keeps lining up.
 */
export async function upgradeViewmodel(id: WeaponId, root: THREE.Group, procedural: THREE.Object3D) {
  // Measure the procedural model now, while its root still sits at the origin.
  procedural.updateMatrixWorld(true)
  const target = new THREE.Box3().setFromObject(procedural)
  const spec = GUNS[id]
  if (!spec) return
  try {
    const gltf = await new GLTFLoader().loadAsync(spec.url)
    const gun = gltf.scene
    gun.rotation.y = spec.rotY
    gun.updateMatrixWorld(true)

    const tSize = target.getSize(new THREE.Vector3())
    const tCenter = target.getCenter(new THREE.Vector3())

    const holder = new THREE.Group()
    holder.add(gun)
    let box = new THREE.Box3().setFromObject(holder)
    const size = box.getSize(new THREE.Vector3())
    holder.scale.setScalar(tSize.z / Math.max(size.z, 1e-6))
    holder.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(holder)
    const center = box.getCenter(new THREE.Vector3())
    // Align front (muzzle end, min z) and horizontal centre; sit at the same height.
    holder.position.set(tCenter.x - center.x, tCenter.y - center.y, target.min.z - box.min.z)

    holder.traverse((o) => {
      o.raycast = () => {}
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.frustumCulled = false
        const m = mesh.material as THREE.MeshStandardMaterial
        if (m && 'envMapIntensity' in m) {
          m.envMapIntensity = 0.5
          m.roughness = Math.min(1, (m.roughness ?? 0.6) * 0.9)
        }
      }
    })
    procedural.visible = false
    root.add(holder)
  } catch (err) {
    console.warn(`gun model for ${id} failed to load, keeping procedural`, err)
  }
}
