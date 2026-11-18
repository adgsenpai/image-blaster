import * as THREE from 'three'

/** Per-frame game state shared between scene components without React re-renders. */
export const gameRuntime = {
  playerPos: new THREE.Vector3(),
  /** Player street coordinates, for the dev readout. */
  playerU: 0,
  playerV: 0,
  /** Root objects that bullets can hit (zombie bodies). */
  targets: [] as THREE.Object3D[],
  /** Camera shake intensity, decays in the controller. */
  shake: 0,
}

export interface ZombieHit {
  zombieId: number
  headshot: boolean
  point: THREE.Vector3
}

/** Implemented by <Zombies>, called by weapons. */
export const zombieApi = {
  damage: null as ((hit: ZombieHit, amount: number) => void) | null,
  /** Splash damage; returns the number of zombies hit. */
  radius: null as ((point: THREE.Vector3, radius: number, maxDamage: number) => number) | null,
}

/** Implemented by <Grenades>, called by the controller. */
export const grenadeApi = {
  throw: null as ((origin: THREE.Vector3, velocity: THREE.Vector3) => void) | null,
}
