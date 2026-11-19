import { Suspense, useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { arenaFrame, arenaPoint, type ArenaConfig, type ArenaFrame } from './arena'

/**
 * Backdrop walls that close off both ends of the street.
 *
 * Opaque and drawn in the opaque pass, so they write depth before Spark draws
 * the splats: anything behind a wall (the smeared, unreconstructed part of the
 * world) is depth-tested away while everything in front still renders.
 *
 * With a backdrop panorama the wall works as a matte painting: each pixel
 * samples the equirectangular pano along the view ray, exactly like a skybox,
 * so the street keeps going into the distance with Table Mountain behind it.
 * Low mist at street level hides the seam between the 3D street and the pano.
 */
const fogVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const fogFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFog;
  uniform vec3 uMist;
  uniform float uHeight;
  uniform sampler2D uPano;
  uniform float uHasPano;
  uniform float uPanoYaw;
  uniform float uPanoExposure;
  uniform float uMistHeight;
  uniform vec3 uForward;
  uniform float uPanoMinElev;
  uniform float uPanoElevFade;
  uniform float uPanoAzHalf;
  uniform float uPanoAzFade;
  varying vec2 vUv;
  varying vec3 vWorld;

  #define PI 3.141592653589793

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  vec3 samplePano(vec3 dir) {
    float c = cos(uPanoYaw), s = sin(uPanoYaw);
    dir = vec3(c * dir.x + s * dir.z, dir.y, -s * dir.x + c * dir.z);
    vec2 uv = vec2(atan(dir.z, dir.x) / (2.0 * PI) + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5);
    // Explicit LOD-0 sample avoids a mip seam where atan wraps around.
    return texture2D(uPano, uv).rgb * uPanoExposure;
  }

  void main() {
    vec2 p = vec2(vUv.x * 6.0, vUv.y * 3.0);
    float drift = fbm(p + vec2(uTime * 0.05, uTime * 0.015));
    float wisps = fbm(p * 2.2 - vec2(uTime * 0.09, 0.0));
    float density = clamp(drift * 0.75 + wisps * 0.45, 0.0, 1.0);

    // Height in metres above the street (wall bottom sits 1 m below ground).
    float h = vUv.y * uHeight - 1.0;
    float low = 1.0 - smoothstep(0.0, uMistHeight, h);

    // Fog bank: dense mist at street level thinning into night haze.
    float mid = 1.0 - smoothstep(3.0, 16.0, h);
    vec3 col = mix(uFog * 0.6, uFog, mid);
    col = mix(col, uMist, low * (0.55 + density * 0.45));
    col += (density - 0.5) * 0.035 * mid;

    if (uHasPano > 0.5) {
      // The pano's own street and houses never line up with the 3D street, so it
      // is only used for the far skyline: a cone above the horizon, down the street.
      vec3 dir = normalize(vWorld - cameraPosition);
      float elev = asin(clamp(dir.y, -1.0, 1.0));
      float elevMask = smoothstep(uPanoMinElev, uPanoMinElev + uPanoElevFade, elev + (drift - 0.5) * 0.03);
      vec2 hdir = normalize(dir.xz);
      float az = acos(clamp(dot(hdir, normalize(uForward.xz)), -1.0, 1.0));
      float azMask = 1.0 - smoothstep(uPanoAzHalf, uPanoAzHalf + uPanoAzFade, az);
      vec3 pano = mix(samplePano(dir), uMist, 0.1);
      col = mix(col, pano, elevMask * azMask);
    } else {
      // Only the very top dissolves; the wall is tall enough that this sits above
      // normal view angles, so it reads as fog meeting the night sky.
      float alpha = 1.0 - smoothstep(0.93, 1.0, vUv.y + (drift - 0.5) * 0.04);
      if (alpha < hash(gl_FragCoord.xy)) discard;
    }
    col += vec3(0.05, 0.032, 0.012) * low * density; // faint sodium glow in the mist
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function usePanoTexture(url?: string) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!url) {
      setTexture(null)
      return
    }
    let disposed = false
    new THREE.TextureLoader().load(url, (tex) => {
      if (disposed) {
        tex.dispose()
        return
      }
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.generateMipmaps = false
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.needsUpdate = true
      setTexture(tex)
    })
    return () => {
      disposed = true
    }
  }, [url])
  useEffect(() => () => texture?.dispose(), [texture])
  return texture
}

function FogWall({ frame, u, facing, pano }: { frame: ArenaFrame; u: number; facing: 1 | -1; pano: THREE.Texture | null }) {
  const { config } = frame
  const width = config.halfWidth * 2 + config.wallOverhang * 2
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: fogVertex,
    fragmentShader: fogFragment,
    uniforms: {
      uTime: { value: 0 },
      uFog: { value: new THREE.Color(config.fogColor) },
      uMist: { value: new THREE.Color(config.mistColor) },
      uHeight: { value: config.wallHeight },
      uPano: { value: null },
      uHasPano: { value: 0 },
      uPanoYaw: { value: config.backdropYaw },
      uPanoExposure: { value: config.backdropExposure },
      uMistHeight: { value: config.mistHeight },
      uForward: { value: frame.forward.clone() },
      uPanoMinElev: { value: THREE.MathUtils.degToRad(config.skylineMinElevation) },
      uPanoElevFade: { value: THREE.MathUtils.degToRad(5) },
      uPanoAzHalf: { value: THREE.MathUtils.degToRad(config.skylineHalfAngle) },
      uPanoAzFade: { value: THREE.MathUtils.degToRad(12) },
    },
    side: THREE.DoubleSide,
    fog: false,
  }), [config.fogColor, config.mistColor, config.wallHeight, config.backdropYaw, config.backdropExposure, config.mistHeight, config.skylineMinElevation, config.skylineHalfAngle, frame.forward])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    material.uniforms.uPano.value = pano
    material.uniforms.uHasPano.value = pano ? 1 : 0
  }, [material, pano])
  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta
  })

  const center = arenaPoint(frame, u, 0, frame.origin.y + config.wallHeight / 2 - 1)
  // Plane faces +Z by default; turn it to face back into the arena.
  const normal = frame.forward.clone().multiplyScalar(-facing)
  const yaw = Math.atan2(normal.x, normal.z)

  return (
    <mesh position={center} rotation={[0, yaw, 0]} material={material} renderOrder={-1}>
      <planeGeometry args={[width, config.wallHeight, 1, 1]} />
    </mesh>
  )
}

function BoundaryColliders({ frame }: { frame: ArenaFrame }) {
  const { config } = frame
  const length = config.front + config.back
  const midU = (config.front - config.back) / 2
  const yaw = Math.atan2(frame.forward.x, frame.forward.z)
  const h = 4
  const t = 0.25
  const y = frame.origin.y + h / 2 - 1
  const across = config.halfWidth + config.wallOverhang
  return (
    <RigidBody type="fixed" colliders={false} userData={{ noDecal: true }}>
      {/* end walls */}
      <CuboidCollider args={[across, h, t]} position={arenaPoint(frame, config.front, 0, y).toArray()} rotation={[0, yaw, 0]} />
      <CuboidCollider args={[across, h, t]} position={arenaPoint(frame, -config.back, 0, y).toArray()} rotation={[0, yaw, 0]} />
      {/* side walls along the street edges */}
      <CuboidCollider args={[t, h, length / 2]} position={arenaPoint(frame, midU, config.halfWidth + t, y).toArray()} rotation={[0, yaw, 0]} />
      <CuboidCollider args={[t, h, length / 2]} position={arenaPoint(frame, midU, -config.halfWidth - t, y).toArray()} rotation={[0, yaw, 0]} />
    </RigidBody>
  )
}

function BarrierRow({ frame, u, url }: { frame: ArenaFrame; u: number; url: string }) {
  const { scene } = useGLTF(url)
  const { config } = frame
  const yaw = Math.atan2(frame.forward.x, frame.forward.z)
  const count = Math.max(2, Math.round((config.halfWidth * 2) / 2.2))
  const placements = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const scale = 1.1 / Math.max(size.y, 0.001) // ~1.1 m tall barrier
    return Array.from({ length: count }, (_, i) => {
      const v = -config.halfWidth + 0.9 + (i * (config.halfWidth * 2 - 1.8)) / (count - 1)
      const object = scene.clone(true)
      const pos = arenaPoint(frame, u, v, frame.origin.y - box.min.y * scale)
      return { object, pos, scale, rot: yaw + (Math.random() - 0.5) * 0.3 }
    })
  }, [scene, count, config.halfWidth, frame, u, yaw])
  return (
    <>
      {placements.map((p, i) => (
        <primitive key={i} object={p.object} position={p.pos} rotation={[0, p.rot, 0]} scale={p.scale} />
      ))}
    </>
  )
}

export function ArenaWalls({ config, barrierUrl, backdropUrl, colliders = true }: { config: ArenaConfig; barrierUrl?: string; backdropUrl?: string; colliders?: boolean }) {
  const frame = useMemo(() => arenaFrame(config), [config])
  const pano = usePanoTexture(backdropUrl)
  return (
    <>
      {frame.config.fogWalls && <FogWall frame={frame} u={frame.config.front} facing={1} pano={pano} />}
      {frame.config.fogWalls && <FogWall frame={frame} u={-frame.config.back} facing={-1} pano={null} />}
      {colliders && <BoundaryColliders frame={frame} />}
      {barrierUrl && (
        <Suspense fallback={null}>
          <BarrierRow frame={frame} u={frame.config.fogWalls ? frame.config.front - 1.4 : frame.config.front + 0.8} url={barrierUrl} />
          <BarrierRow frame={frame} u={frame.config.fogWalls ? -frame.config.back + 1.4 : -frame.config.back - 0.8} url={barrierUrl} />
        </Suspense>
      )}
    </>
  )
}
