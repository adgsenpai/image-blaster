import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import { SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as THREE from 'three'
import { arenaFrame, arenaPoint, type ArenaConfig, type ArenaFrame } from '../game/arena'
import { buildLayout, type HouseSpec, type StageConfig, type StageLayout, type StripSpec } from './stage'
import { facadeTextures } from './facades'
import { buildBarrier, buildLampPost } from './streetProps'

export interface StageAssets {
  lamp?: string
  lantern?: string
  planter?: string
  shrub?: string
  potted?: string
  barrier?: string
}

const noRaycast = (o: THREE.Object3D) => {
  o.traverse((c) => {
    c.raycast = () => {}
  })
}

/* ------------------------------------------------------------------ clip -- */

/** Hide every splat outside the cleanly reconstructed box (no smear, no splat sky). */
function SplatClip({ frame, clip }: { frame: ArenaFrame; clip: StageConfig['clip'] }) {
  const edit = useMemo(() => {
    const e = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, invert: true, softEdge: 0.35 })
    const sdf = new SplatEditSdf({ type: SplatEditSdfType.BOX, opacity: 0, color: new THREE.Color(1, 1, 1) })
    const uc = (clip.uMin + clip.uMax) / 2
    const vc = (clip.vMin + clip.vMax) / 2
    const y0 = frame.origin.y - 3
    sdf.position.copy(arenaPoint(frame, uc, vc, (y0 + clip.yMax) / 2))
    sdf.rotation.set(0, Math.atan2(frame.forward.x, frame.forward.z), 0)
    sdf.scale.set((clip.vMax - clip.vMin) / 2, (clip.yMax - y0) / 2, (clip.uMax - clip.uMin) / 2)
    e.add(sdf)
    return e
  }, [frame, clip])
  return <primitive object={edit} />
}

/* ------------------------------------------------------------------- sky -- */

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`

const skyFragment = /* glsl */ `
  uniform sampler2D uPano;
  uniform sampler2D uMask;
  uniform float uHasPano;
  uniform float uHasMask;
  uniform float uPanoYaw;
  uniform vec3 uForward;
  uniform vec3 uFog;
  uniform vec3 uZenith;
  uniform vec3 uGlow;
  uniform float uTime;
  varying vec3 vDir;
  #define PI 3.141592653589793

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { v += a * vnoise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
  vec3 samplePano(vec3 dir) {
    float c = cos(uPanoYaw), s = sin(uPanoYaw);
    dir = vec3(c * dir.x + s * dir.z, dir.y, -s * dir.x + c * dir.z);
    vec2 uv = vec2(atan(dir.z, dir.x) / (2.0 * PI) + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5);
    return texture2D(uPano, uv).rgb;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float elev = asin(clamp(dir.y, -1.0, 1.0));

    // Overcast rainy night: deep blue zenith, horizon lit by city light from below.
    float h = clamp(dir.y, 0.0, 1.0);
    vec3 sky = mix(uGlow, uZenith, pow(h, 0.55));
    vec2 cp = dir.xz / (dir.y + 0.18) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    float cloud = fbm(cp);
    float cover = smoothstep(0.35, 0.8, cloud);
    vec3 cloudCol = mix(uGlow * 1.25, uZenith * 1.6, h);
    sky = mix(sky, cloudCol, cover * 0.85);

    // Real sky from the World Labs pano wherever its sky mask says sky, plus the
    // photo-composited Table Mountain skyline down the street.
    if (uHasPano > 0.5) {
      float c = cos(uPanoYaw), s = sin(uPanoYaw);
      vec3 pd = vec3(c * dir.x + s * dir.z, dir.y, -s * dir.x + c * dir.z);
      vec2 puv = vec2(atan(pd.z, pd.x) / (2.0 * PI) + 0.5, asin(clamp(pd.y, -1.0, 1.0)) / PI + 0.5);
      float skyMask = uHasMask > 0.5 ? texture2D(uMask, puv).r : 0.0;
      float elevMask = smoothstep(0.03, 0.09, elev);
      float az = acos(clamp(dot(normalize(dir.xz), normalize(uForward.xz)), -1.0, 1.0));
      float azMask = 1.0 - smoothstep(0.5, 0.75, az);
      // World Labs' invented rear view has artefacts: use its sky only in front/sides.
      float front = 1.0 - smoothstep(1.55, 1.95, az);
      float w = max(skyMask * front, elevMask * azMask);
      vec3 pano = samplePano(dir) * 1.15;
      sky = mix(sky, pano, w);
    }

    // Distance haze at the horizon matches the scene fog, so buildings melt into it.
    float haze = 1.0 - smoothstep(-0.02, 0.16, elev);
    sky = mix(sky, uFog, haze * 0.85);
    if (elev < 0.0) sky = uFog;
    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`

function SkyDome({ frame, panoUrl, maskUrl, panoYaw, fog }: { frame: ArenaFrame; panoUrl?: string; maskUrl?: string; panoYaw: number; fog: string }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: {
      uPano: { value: null },
      uMask: { value: null },
      uHasPano: { value: 0 },
      uHasMask: { value: 0 },
      uPanoYaw: { value: panoYaw },
      uForward: { value: frame.forward.clone() },
      uFog: { value: new THREE.Color(fog) },
      uZenith: { value: new THREE.Color('#0a1222') },
      uGlow: { value: new THREE.Color('#3d3a44') },
      uTime: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }), [frame, panoYaw, fog])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    if (!panoUrl) return
    let dead = false
    new THREE.TextureLoader().load(panoUrl, (t) => {
      if (dead) return t.dispose()
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = THREE.RepeatWrapping
      t.generateMipmaps = false
      t.minFilter = THREE.LinearFilter
      material.uniforms.uPano.value = t
      material.uniforms.uHasPano.value = 1
    })
    return () => {
      dead = true
    }
  }, [panoUrl, material])

  useEffect(() => {
    if (!maskUrl) return
    let dead = false
    new THREE.TextureLoader().load(maskUrl, (t) => {
      if (dead) return t.dispose()
      t.wrapS = THREE.RepeatWrapping
      material.uniforms.uMask.value = t
      material.uniforms.uHasMask.value = 1
    })
    return () => {
      dead = true
    }
  }, [maskUrl, material])

  const mesh = useRef<THREE.Mesh>(null)
  useFrame(({ camera }, delta) => {
    material.uniforms.uTime.value += delta
    mesh.current?.position.copy(camera.position)
  })
  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[400, 48, 24]} />
    </mesh>
  )
}

/* ---------------------------------------------------------------- ground -- */

function quad(frame: ArenaFrame, s: StripSpec, tile: number) {
  const p = [
    arenaPoint(frame, s.u0, s.v0, s.y),
    arenaPoint(frame, s.u1, s.v0, s.y),
    arenaPoint(frame, s.u1, s.v1, s.y),
    arenaPoint(frame, s.u0, s.v1, s.y),
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => v.toArray()), 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([
    s.v0 / tile, s.u0 / tile, s.v0 / tile, s.u1 / tile, s.v1 / tile, s.u1 / tile, s.v1 / tile, s.u0 / tile,
  ], 2))
  g.setIndex([0, 2, 1, 0, 3, 2])
  g.computeVertexNormals()
  // Make sure the face points up regardless of winding.
  const n = g.getAttribute('normal')
  if (n.getY(0) < 0) {
    g.setIndex([0, 1, 2, 0, 2, 3])
    g.computeVertexNormals()
  }
  return g
}

/** Vertical curb faces around a raised strip. */
function curbSides(frame: ArenaFrame, s: StripSpec, tile: number) {
  const out: THREE.BufferGeometry[] = []
  const edges: [number, number, number, number][] = [
    [s.u0, s.v0, s.u1, s.v0], [s.u1, s.v0, s.u1, s.v1], [s.u1, s.v1, s.u0, s.v1], [s.u0, s.v1, s.u0, s.v0],
  ]
  for (const [ua, va, ub, vb] of edges) {
    const p = [
      arenaPoint(frame, ua, va, 0), arenaPoint(frame, ub, vb, 0),
      arenaPoint(frame, ub, vb, s.y), arenaPoint(frame, ua, va, s.y),
    ]
    const len = Math.hypot(ub - ua, vb - va)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => v.toArray()), 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len / tile, 0, len / tile, s.y / tile, 0, s.y / tile], 2))
    g.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2])
    g.computeVertexNormals()
    out.push(g)
  }
  return out
}

function useStageTextures() {
  const t = useTexture({
    cobbleMap: '/stage/cobble_albedo.jpg',
    cobbleNormal: '/stage/cobble_normal.png',
    cobbleRough: '/stage/cobble_rough.jpg',
    paverMap: '/stage/paver_albedo.jpg',
    paverNormal: '/stage/paver_normal.png',
    paverRough: '/stage/paver_rough.jpg',
    plasterMap: '/stage/plaster_albedo.jpg',
    plasterNormal: '/stage/plaster_normal.png',
  })
  useMemo(() => {
    for (const [k, tex] of Object.entries(t)) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = 8
      tex.colorSpace = k.endsWith('Map') ? THREE.SRGBColorSpace : THREE.NoColorSpace
      tex.needsUpdate = true
    }
  }, [t])
  return t
}

function Ground({ frame, layout, tex }: { frame: ArenaFrame; layout: StageLayout; tex: ReturnType<typeof useStageTextures> }) {
  const { road, walk } = useMemo(() => {
    const roads = layout.strips.filter((s) => s.kind === 'road').map((s) => quad(frame, s, 2.4))
    const walks = layout.strips.filter((s) => s.kind === 'sidewalk').flatMap((s) => [quad(frame, s, 2), ...curbSides(frame, s, 2)])
    return { road: mergeGeometries(roads), walk: mergeGeometries(walks) }
  }, [frame, layout])
  const roadMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    map: tex.cobbleMap,
    normalMap: tex.cobbleNormal,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughnessMap: tex.cobbleRough,
    roughness: 1,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.4,
    color: '#dcbba6',
  }), [tex])
  const walkMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    map: tex.paverMap,
    normalMap: tex.paverNormal,
    roughnessMap: tex.paverRough,
    roughness: 1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.2,
    color: '#e0c6b4',
  }), [tex])
  useEffect(() => () => {
    road?.dispose()
    walk?.dispose()
  }, [road, walk])
  return (
    <>
      {road && <mesh geometry={road} material={roadMat} receiveShadow />}
      {walk && <mesh geometry={walk} material={walkMat} receiveShadow />}
    </>
  )
}

/* ---------------------------------------------------------------- houses -- */

function boxWithMetricUV(w: number, h: number, d: number, tile: number) {
  const g = new THREE.BoxGeometry(w, h, d)
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  // Box faces in order: +x, -x, +y, -y, +z, -z (4 verts each).
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile)
    }
  }
  uv.needsUpdate = true
  return g
}

function houseTransform(frame: ArenaFrame, h: HouseSpec) {
  const half = h.depth / 2
  let bu = h.u
  let bv = h.v
  let normal: THREE.Vector3
  switch (h.face) {
    case 'v+': bv -= half; normal = frame.right.clone(); break
    case 'v-': bv += half; normal = frame.right.clone().negate(); break
    case 'u+': bu -= half; normal = frame.forward.clone(); break
    case 'u-': bu += half; normal = frame.forward.clone().negate(); break
  }
  return { pos: arenaPoint(frame, bu, bv, frame.origin.y), yaw: Math.atan2(normal.x, normal.z) }
}

function Houses({ frame, layout, tex, lanternUrl }: { frame: ArenaFrame; layout: StageLayout; tex: ReturnType<typeof useStageTextures>; lanternUrl?: string }) {
  const built = useMemo(() => {
    const group = new THREE.Group()
    const plaster = new Map<string, THREE.MeshStandardMaterial>()
    const trims = new Map<string, THREE.MeshStandardMaterial>()
    const plasterMat = (color: string) => {
      let m = plaster.get(color)
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color, map: tex.plasterMap, normalMap: tex.plasterNormal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.72, envMapIntensity: 1.0 })
        plaster.set(color, m)
      }
      return m
    }
    const trimMat = (color: string) => {
      let m = trims.get(color)
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color, map: tex.plasterMap, roughness: 0.8, envMapIntensity: 0.9 })
        trims.set(color, m)
      }
      return m
    }
    const facadeMats = new Map<string, THREE.MeshStandardMaterial>()
    const lanterns: { pos: THREE.Vector3; yaw: number }[] = []

    for (const h of layout.houses) {
      const { pos, yaw } = houseTransform(frame, h)
      const house = new THREE.Group()
      house.position.copy(pos)
      house.rotation.y = yaw
      const body = new THREE.Mesh(boxWithMetricUV(h.width, h.height, h.depth, 3), plasterMat(h.color))
      body.position.y = h.height / 2
      house.add(body)

      const ft = facadeTextures(h.width, h.height, h.stories, h.bays, h.door, h.trim, h.variant)
      const fkey = ft.map.uuid
      let fm = facadeMats.get(fkey)
      if (!fm) {
        fm = new THREE.MeshStandardMaterial({
          map: ft.map, emissiveMap: ft.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.6,
          transparent: true, alphaTest: 0.01, roughness: 0.55, metalness: 0.05, envMapIntensity: 1.2,
          polygonOffset: true, polygonOffsetFactor: -2,
        })
        facadeMats.set(fkey, fm)
      }
      const facade = new THREE.Mesh(new THREE.PlaneGeometry(h.width, h.height), fm)
      facade.position.set(0, h.height / 2, h.depth / 2 + 0.015)
      house.add(facade)

      // Projecting cornice + parapet cap give the roofline real depth.
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(h.width + 0.05, 0.24, 0.32), trimMat(h.trim))
      cornice.position.set(0, h.height - 0.2, h.depth / 2 + 0.12)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(h.width, 0.12, h.depth), trimMat(h.trim))
      cap.position.set(0, h.height + 0.06, 0)
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(h.width, 0.4, 0.12), trimMat('#6f6a64'))
      plinth.position.set(0, 0.2, h.depth / 2 + 0.05)
      house.add(cornice, cap, plinth)

      if (h.style === 'scan') {
        // Double moulded cornice like the scanned cottages.
        const band = new THREE.Mesh(new THREE.BoxGeometry(h.width + 0.02, 0.12, 0.2), trimMat(h.trim))
        band.position.set(0, h.height - 0.55, h.depth / 2 + 0.07)
        house.add(band)
        // Front steps at the door, and a low stoep wall either side.
        const doorX = -h.width / 2 + 0.26 + ((h.width - 0.52) / h.bays) * (h.door + 0.5)
        const stepMat = trimMat('#7a7570')
        for (const [k, sy, sz] of [[0, 0.21, 0.8], [1, 0.42, 0.42]] as const) {
          const step = new THREE.Mesh(boxWithMetricUV(1.4, sy, sz, 1), stepMat)
          step.position.set(doorX, sy / 2 + 0.14, h.depth / 2 + sz / 2)
          step.name = `step${k}`
          house.add(step)
        }
        if (h.stoep) {
          const wallMat = plasterMat(h.color)
          const z = h.depth / 2 + 0.95
          for (const [x0, x1] of [[-h.width / 2, doorX - 0.85], [doorX + 0.85, h.width / 2]]) {
            const w = x1 - x0
            if (w < 0.4) continue
            const wall = new THREE.Mesh(boxWithMetricUV(w, 0.85, 0.2, 3), wallMat)
            wall.position.set((x0 + x1) / 2, 0.14 + 0.425, z)
            const coping = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.06, 0.26), trimMat(h.trim))
            coping.position.set((x0 + x1) / 2, 0.14 + 0.88, z)
            house.add(wall, coping)
          }
        }
      }

      if (h.lantern) {
        const doorX = -h.width / 2 + 0.26 + ((h.width - 0.52) / h.bays) * (h.door + 0.5)
        house.updateMatrixWorld()
        const local = new THREE.Vector3(doorX + 0.85, 2.45, h.depth / 2 + 0.05)
        lanterns.push({ pos: local.applyMatrix4(house.matrixWorld), yaw })
      }
      group.add(house)
    }
    noRaycast(group)
    return { group, lanterns, dispose: () => {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
      for (const m of [...plaster.values(), ...trims.values(), ...facadeMats.values()]) m.dispose()
    } }
  }, [frame, layout, tex])
  useEffect(() => built.dispose, [built])

  return (
    <>
      <primitive object={built.group} />
      {lanternUrl && (
        <Suspense fallback={null}>
          <Lanterns url={lanternUrl} spots={built.lanterns} />
        </Suspense>
      )}
    </>
  )
}

/* ----------------------------------------------------------------- props -- */

function normalized(scene: THREE.Object3D, height: number) {
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const scale = height / Math.max(size.y, 0.001)
  return { scale, lift: -box.min.y * scale }
}

function makeGlow(color: string, size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  }))
  sprite.scale.setScalar(size)
  sprite.raycast = () => {}
  return sprite
}

function Lanterns({ url, spots }: { url: string; spots: { pos: THREE.Vector3; yaw: number }[] }) {
  const { scene } = useGLTF(url)
  const group = useMemo(() => {
    const g = new THREE.Group()
    const { scale, lift } = normalized(scene, 0.55)
    for (const s of spots) {
      const o = scene.clone(true)
      o.scale.setScalar(scale)
      o.position.copy(s.pos).add(new THREE.Vector3(0, lift - 0.3, 0))
      o.rotation.y = s.yaw
      g.add(o)
      const glow = makeGlow('#ffb35a', 1.1)
      glow.position.copy(s.pos)
      g.add(glow)
    }
    noRaycast(g)
    return g
  }, [scene, spots])
  return <primitive object={group} />
}

function PropSet({ url, frame, items, height, extra }: {
  url: string
  frame: ArenaFrame
  items: StageLayout['props']
  height: number
  extra?: (o: THREE.Group, at: THREE.Vector3, index: number) => void
}) {
  const { scene } = useGLTF(url)
  const group = useMemo(() => {
    const g = new THREE.Group()
    const { scale, lift } = normalized(scene, height)
    items.forEach((p, i) => {
      const holder = new THREE.Group()
      const base = arenaPoint(frame, p.u, p.v, frame.origin.y + (p.kind === 'lamp' || p.kind === 'barrier' ? 0 : 0.14))
      holder.position.copy(base)
      holder.rotation.y = Math.atan2(frame.forward.x, frame.forward.z) + p.rot
      const o = scene.clone(true)
      o.scale.setScalar(scale)
      o.position.y = lift
      holder.add(o)
      extra?.(holder, base, i)
      g.add(holder)
    })
    noRaycast(g)
    return g
  }, [scene, frame, items, height, extra])
  return <primitive object={group} />
}

const MAX_LAMP_LIGHTS = 20

function Lamps({ frame, items }: { frame: ArenaFrame; items: StageLayout['props'] }) {
  const group = useMemo(() => {
    const g = new THREE.Group()
    items.forEach((p, i) => {
      const { group: lamp, lightPos } = buildLampPost()
      lamp.position.copy(arenaPoint(frame, p.u, p.v, frame.origin.y))
      // Arm reaches over the road.
      // Main-street lamps (rot ±90°) reach across the street; cross-street lamps (0 / 180°) along u.
      const towardRoad = p.rot === 0 ? frame.forward.clone()
        : p.rot === Math.PI ? frame.forward.clone().negate()
          : p.v < 0 ? frame.right.clone() : frame.right.clone().negate()
      lamp.rotation.y = Math.atan2(towardRoad.x, towardRoad.z)
      const glow = makeGlow('#ffb866', 2.4)
      glow.position.copy(lightPos)
      lamp.add(glow)
      if (i < MAX_LAMP_LIGHTS) {
        const light = new THREE.PointLight('#ff9f45', 50, 24, 1.5)
        light.position.copy(lightPos)
        lamp.add(light)
      }
      g.add(lamp)
    })
    noRaycast(g)
    return g
  }, [frame, items])
  return <primitive object={group} />
}

function Barriers({ frame, items }: { frame: ArenaFrame; items: { u: number; v: number; rot: number }[] }) {
  const group = useMemo(() => {
    const g = new THREE.Group()
    for (const p of items) {
      const b = buildBarrier()
      b.position.copy(arenaPoint(frame, p.u, p.v, frame.origin.y))
      b.rotation.y = Math.atan2(frame.forward.x, frame.forward.z) + p.rot
      g.add(b)
    }
    noRaycast(g)
    return g
  }, [frame, items])
  return <primitive object={group} />
}

function Props({ frame, layout, assets }: { frame: ArenaFrame; layout: StageLayout; assets: StageAssets }) {
  const lamps = useMemo(() => {
    // Real lights only on the lamps nearest the playable street; glow sprites everywhere.
    return [...layout.props.filter((p) => p.kind === 'lamp')].sort((a, b) => Math.hypot(a.u - 10, a.v) - Math.hypot(b.u - 10, b.v))
  }, [layout])
  const planters = useMemo(() => layout.props.filter((p) => p.kind === 'planter'), [layout])
  const shrubExtra = useMemo(() => (h: THREE.Group) => {
    h.position.y += 0.55
  }, [])
  const potted = useMemo(() => layout.props.filter((p) => p.kind === 'potted'), [layout])
  const barriers = useMemo(() => layout.props.filter((p) => p.kind === 'barrier'), [layout])
  return (
    <Suspense fallback={null}>
      <Lamps frame={frame} items={lamps} />
      {assets.planter && <PropSet url={assets.planter} frame={frame} items={planters} height={0.75} />}
      {assets.shrub && <PropSet url={assets.shrub} frame={frame} items={planters} height={1.5} extra={shrubExtra} />}
      {assets.potted && <PropSet url={assets.potted} frame={frame} items={potted} height={0.7} />}
      <Barriers frame={frame} items={barriers} />
    </Suspense>
  )
}

/* ------------------------------------------------------------------ rain -- */

const rainVertex = /* glsl */ `
  attribute float aEnd;
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uBox;
  uniform float uHeight;
  varying float vFade;
  #include <fog_pars_vertex>
  void main() {
    vec3 p = position;
    float speed = 9.0 + fract(p.x * 13.1) * 3.0;
    float y = mod(p.y - uTime * speed, uHeight);
    vec3 wp = vec3(
      uCenter.x + mod(p.x - uCenter.x + uBox * 0.5, uBox) - uBox * 0.5,
      uCenter.y - 2.0 + y + aEnd * 0.42,
      uCenter.z + mod(p.z - uCenter.z + uBox * 0.5, uBox) - uBox * 0.5);
    wp.x += aEnd * 0.03; // slight wind slant
    vFade = 1.0 - aEnd * 0.8;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const rainFragment = /* glsl */ `
  varying float vFade;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(vec3(0.75, 0.8, 0.9), 0.32 * vFade);
    #include <fog_fragment>
  }
`

function Rain() {
  const COUNT = 6000
  const BOX = 36
  const HEIGHT = 16
  const { geometry, material } = useMemo(() => {
    const pos = new Float32Array(COUNT * 6)
    const end = new Float32Array(COUNT * 2)
    for (let i = 0; i < COUNT; i++) {
      const x = Math.random() * BOX
      const y = Math.random() * HEIGHT
      const z = Math.random() * BOX
      pos.set([x, y, z, x, y, z], i * 6)
      end.set([0, 1], i * 2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1))
    const m = new THREE.ShaderMaterial({
      vertexShader: rainVertex,
      fragmentShader: rainFragment,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: BOX }, uHeight: { value: HEIGHT },
      }]),
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    return { geometry: g, material: m }
  }, [])
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])
  useFrame(({ camera }, delta) => {
    material.uniforms.uTime.value += delta
    material.uniforms.uCenter.value.copy(camera.position)
  })
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
}

/* ----------------------------------------------------------- atmosphere -- */

function Atmosphere({ fog }: { fog: StageConfig['fog'] }) {
  const { scene } = useThree()
  useEffect(() => {
    const prev = scene.fog
    scene.fog = new THREE.FogExp2(fog.color, fog.density)
    return () => {
      scene.fog = prev
    }
  }, [scene, fog.color, fog.density])
  return (
    <>
      {/* City-glow ambient so pastel facades read at night (meshes only, splats are baked). */}
      <hemisphereLight args={['#a5826a', '#3d2b22', 0.5]} />
      <directionalLight position={[-30, 40, 20]} intensity={0.08} color="#8f9fc4" />
    </>
  )
}

/* ----------------------------------------------------------------- stage -- */

export function Stage({ arena, stage, assets, panoUrl, maskUrl }: { arena: ArenaConfig; stage: StageConfig; assets: StageAssets; panoUrl?: string; maskUrl?: string }) {
  const frame = useMemo(() => arenaFrame(arena), [arena])
  const layout = useMemo(() => {
    const l = buildLayout(stage)
    // Police line just outside the playable street at both ends.
    const { left, right } = stage.street
    for (const u of [frame.config.front + 0.8, -frame.config.back - 0.8]) {
      const n = Math.max(2, Math.round((right - left) / 1.6))
      for (let k = 0; k < n; k++) {
        l.props.push({ kind: 'barrier', u: u + (k % 2) * 0.25, v: left + 0.7 + (k * (right - left - 1.4)) / (n - 1), rot: (Math.random() - 0.5) * 0.25 })
      }
    }
    return l
  }, [stage, frame])
  return (
    <>
      {stage.clipSplats === true && <SplatClip frame={frame} clip={stage.clip} />}
      <Atmosphere fog={stage.fog} />
      <SkyDome frame={frame} panoUrl={panoUrl} maskUrl={maskUrl} panoYaw={frame.config.backdropYaw} fog={stage.fog.color} />
      <Suspense fallback={null}>
        <StageGeometry frame={frame} layout={layout} assets={assets} />
      </Suspense>
      {stage.rain !== false && <Rain />}
    </>
  )
}

function StageGeometry({ frame, layout, assets }: { frame: ArenaFrame; layout: StageLayout; assets: StageAssets }) {
  const tex = useStageTextures()
  return (
    <>
      <Ground frame={frame} layout={layout} tex={tex} />
      <Houses frame={frame} layout={layout} tex={tex} lanternUrl={assets.lantern} />
      <Props frame={frame} layout={layout} assets={assets} />
    </>
  )
}
