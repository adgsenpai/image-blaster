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
  /** Bones collapsed by dismemberment (re-applied after every mixer update). */
  severed: Set<string>
}

const CLIP_NAMES: Record<ZombieClip, string> = {
  walk: 'Walk', run: 'Run', attack: 'Punch', hit: 'HitReact', death: 'Death', crawl: 'Crawl',
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false })
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

  // Hitboxes live on the root (unscaled); the head box tracks the Head bone each frame.
  const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.25, 0.45), hitMat)
  bodyBox.position.y = 0.72
  const headBox = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hitMat)
  headBox.position.y = 1.62
  headBox.userData.head = true
  root.add(bodyBox, headBox)
  root.traverse((o) => {
    o.userData.zombieId = id
  })
  headBox.userData.head = true

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
  return { root, model, mixer, actions, current: null, mats, bones, headBox, bodyBox, severed: new Set() }
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

/** Keep the head hitbox on the animated head. */
export function syncHitboxes(z: ModelZombie) {
  const head = z.bones.Head
  if (!head) return
  head.getWorldPosition(_v)
  z.root.worldToLocal(_v)
  z.headBox.position.copy(_v).add(new THREE.Vector3(0, 0.08, 0))
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
