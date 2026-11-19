import * as THREE from 'three'

/**
 * Seamless colour textures generated locally (SD-Turbo + Real-ESRGAN, see local-gen/tex_gen.py)
 * in app/public/game/textures. Each call returns its own texture (own repeat) sharing the image.
 */
const loader = new THREE.TextureLoader()
const images = new Map<string, THREE.Texture>()

export type GameTex = 'plaster' | 'wood' | 'door' | 'sandbag' | 'crate' | 'rust'

export function gameTex(name: GameTex, repeat: [number, number] = [1, 1]) {
  let base = images.get(name)
  if (!base) {
    base = loader.load(`/game/textures/${name}.jpg`)
    base.colorSpace = THREE.SRGBColorSpace
    images.set(name, base)
  }
  const t = base.clone()
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 8
  // Clones share the image; flag an upload once it has arrived.
  if (base.image) t.needsUpdate = true
  else base.addEventListener?.('update' as never, () => (t.needsUpdate = true))
  const img = base.image as HTMLImageElement | undefined
  if (!img || !img.complete) {
    const poll = setInterval(() => {
      const im = base!.source.data as HTMLImageElement | undefined
      if (im && im.complete && im.naturalWidth) {
        t.needsUpdate = true
        clearInterval(poll)
      }
    }, 200)
  }
  return t
}
