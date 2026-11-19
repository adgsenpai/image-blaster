import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

/** Quaternius "Zombie" (CC0): 50-bone rig with Walk / Run / Punch / HitReact / Death / Crawl. */
export const ZOMBIE_URL = '/game/zombie.glb'
const HEIGHT = 1.8

interface Template {
  scene: THREE.Object3D
  clips: THREE.AnimationClip[]
  scale: number
  lift: number
}

let template: Template | null = null
let loading: Promise<Template | null> | null = null

export function loadZombieTemplate() {
  if (template) return Promise.resolve(template)
  if (!loading) {
    loading = new GLTFLoader().loadAsync(ZOMBIE_URL).then((gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene)
      const size = box.getSize(new THREE.Vector3())
      const scale = HEIGHT / Math.max(size.y, 1e-6)
      template = { scene: gltf.scene, clips: gltf.animations, scale, lift: -box.min.y * scale }
      return template
    }).catch((err) => {
      console.warn('zombie model failed to load, using procedural zombies', err)
      return null
    })
  }
  return loading
}

export function zombieTemplateReady() {
  return template
}

export type ZombieClip = 'walk' | 'run' | 'attack' | 'hit' | 'death' | 'crawl'

export interface ModelZombie {
  root: THREE.Group
  model: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Partial<Record<ZombieClip, THREE.AnimationAction>>
  current: ZombieClip | null
  mats: THREE.MeshStandardMaterial[]
  bones: Record<string, THREE.Bone>
  headBox: THREE.Mesh
  bodyBox: THREE.Mesh
  /** Bone-driven capsule hitboxes (rebuilt from the animated skeleton every frame). */
  limbBoxes: { mesh: THREE.Mesh; a: string; b: string; radius: number; part: HitPart }[]
  /** Bones collapsed by dismemberment (re-applied after every mixer update). */
  severed: Set<string>
}

const CLIP_NAMES: Record<ZombieClip, string> = {
  walk: 'Walk', run: 'Run', attack: 'Punch', hit: 'HitReact', death: 'Death', crawl: 'Crawl',
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false })
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8)

/** Dev: draw hitboxes as red wireframes. */
export function setHitboxDebug(on: boolean) {
  hitMat.visible = on
  hitMat.wireframe = true
  hitMat.color.set('#ff2020')
}

export type HitPart = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR'

/** [from bone, to bone, radius (m), part] */
const LIMBS: [string, string, number, HitPart][] = [
  ['UpperArmL', 'LowerArmL', 0.085, 'armL'],
  ['LowerArmL', 'Middle1L', 0.075, 'armL'],
  ['UpperArmR', 'LowerArmR', 0.085, 'armR'],
  ['LowerArmR', 'Middle1R', 0.075, 'armR'],
  ['UpperLegL', 'LowerLegL', 0.11, 'legL'],
  ['LowerLegL', 'FootL', 0.09, 'legL'],
  ['UpperLegR', 'LowerLegR', 0.11, 'legR'],
  ['LowerLegR', 'FootR', 0.09, 'legR'],
]

/** Bone each part hangs from (for severing). */
export const PART_BONE: Partial<Record<HitPart, string>> = {
  armL: 'UpperArmL', armR: 'UpperArmR', legL: 'UpperLegL', legR: 'UpperLegR', head: 'Head',
}
const _v = new THREE.Vector3()

export function createModelZombie(t: Template, id: number): ModelZombie {
  const root = new THREE.Group()
  const model = cloneSkeleton(t.scene)
  model.scale.multiplyScalar(t.scale * (0.92 + Math.random() * 0.16))
  model.position.y = t.lift
  root.add(model)

  const mats: THREE.MeshStandardMaterial[] = []
  const bones: Record<string, THREE.Bone> = {}
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.frustumCulled = false
      mesh.raycast = () => {}
      const m = (mesh.material as THREE.MeshStandardMaterial).clone()
      m.emissive = new THREE.Color(0, 0, 0)
      // Grittier than the cartoon atlas: desaturate, darken, grime + blood blotches.
      m.roughness = 0.95
      m.metalness = 0
      const seed = Math.random() * 100
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uSeed = { value: seed }
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vObjPos;
            uniform float uSeed;
            float gHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164)) + uSeed) * 43758.5453); }
            float gNoise(vec3 p) {
              vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
                         mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
            }`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            {
              float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.92, 0.95, 0.85), 0.55) * 0.62;
              vec3 q = vObjPos * 900.0;
              float grime = gNoise(q * 0.9) * 0.6 + gNoise(q * 2.3) * 0.4;
              diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.25, 0.7, grime));
              float blood = smoothstep(0.62, 0.8, gNoise(q * 0.6 + 7.0));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.015, 0.02), blood * 0.85);
            }`)
      }
      m.customProgramCacheKey = () => 'zombie-grit'
      mesh.material = m
      mats.push(m)
    }
  })

  // Hitboxes live on the root (unscaled) and are re-fitted to the animated bones every frame.
  const bodyBox = new THREE.Mesh(unitCyl, hitMat)
  bodyBox.userData.part = 'torso'
  const headBox = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), hitMat)
  headBox.userData.head = true
  headBox.userData.part = 'head'
  root.add(bodyBox, headBox)
  const limbBoxes: ModelZombie['limbBoxes'] = []
  for (const [a, b, radius, part] of LIMBS) {
    if (!bones[a] || !bones[b]) continue
    const mesh = new THREE.Mesh(unitCyl, hitMat)
    mesh.userData.part = part
    root.add(mesh)
    limbBoxes.push({ mesh, a, b, radius, part })
  }
  root.traverse((o) => {
    o.userData.zombieId = id
  })

  const mixer = new THREE.AnimationMixer(model)
  const actions: ModelZombie['actions'] = {}
  for (const [key, name] of Object.entries(CLIP_NAMES) as [ZombieClip, string][]) {
    const clip = THREE.AnimationClip.findByName(t.clips, name) ?? THREE.AnimationClip.findByName(t.clips, `CharacterArmature|${name}`)
    if (!clip) continue
    const a = mixer.clipAction(clip)
    if (key === 'death' || key === 'hit') {
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = key === 'death'
    }
    actions[key] = a
  }
  return { root, model, mixer, actions, current: null, mats, bones, headBox, bodyBox, limbBoxes, severed: new Set() }
}

/** Crossfade to a looping/one-shot clip. */
export function playClip(z: ModelZombie, clip: ZombieClip, fade = 0.25, timeScale = 1) {
  const next = z.actions[clip]
  if (!next) return
  next.timeScale = timeScale
  if (z.current === clip) return
  const prev = z.current ? z.actions[z.current] : undefined
  next.reset().setEffectiveWeight(1).fadeIn(fade).play()
  prev?.fadeOut(fade)
  z.current = clip
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
const _rootInv = new THREE.Quaternion()

/** Fit a capsule-ish cylinder between two root-local points. */
function fitSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  const dir = _v.copy(b).sub(a)
  const len = dir.length()
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(_up, len > 1e-5 ? dir.divideScalar(len) : _up)
  mesh.scale.set(radius, len + radius * 1.6, radius)
}

/** Re-fit every hitbox to the animated skeleton (call after mixer.update). */
export function syncHitboxes(z: ModelZombie) {
  z.root.updateMatrixWorld(true)
  const local = (bone: string, out: THREE.Vector3) => {
    const b = z.bones[bone]
    if (!b) return null
    b.getWorldPosition(out)
    return z.root.worldToLocal(out)
  }
  // Torso: hips to neck.
  if (local('Hips', _a) && local('Neck', _b)) fitSegment(z.bodyBox, _a, _b, 0.24)
  // Head: sphere one head-radius past the neck along the neck->head direction.
  if (!z.severed.has('Head') && local('Neck', _a) && local('Head', _b)) {
    const d = _v.copy(_b).sub(_a).normalize()
    // Big cartoon head: the Head bone sits at the neck, the skull spans ~0.5 m above it.
    z.headBox.position.copy(_b).addScaledVector(d, 0.3)
    z.headBox.scale.setScalar(0.27)
  } else {
    z.headBox.scale.setScalar(1e-4)
  }
  for (const l of z.limbBoxes) {
    const gone = z.severed.has(PART_BONE[l.part] ?? '')
    if (gone || !local(l.a, _a) || !local(l.b, _b)) {
      l.mesh.scale.setScalar(1e-4)
      continue
    }
    fitSegment(l.mesh, _a, _b, l.radius)
  }
  void _q
  void _rootInv
}

/** Collapse a bone (and everything skinned to its children) to remove that body part. */
export function sever(z: ModelZombie, bone: string) {
  if (!z.bones[bone]) return false
  if (z.severed.has(bone)) return false
  z.severed.add(bone)
  return true
}

export function applySevered(z: ModelZombie) {
  for (const name of z.severed) z.bones[name]?.scale.setScalar(0.0001)
}

/** World position of a bone (e.g. the neck stump after a head pop). */
export function boneWorld(z: ModelZombie, bone: string, out = new THREE.Vector3()) {
  const b = z.bones[bone]
  return b ? b.getWorldPosition(out) : z.root.getWorldPosition(out).setY(out.y + 1.5)
}
