import { useEffect, useState } from 'react'
import * as THREE from 'three'

/**
 * Per-world play area, read from `/worlds/<slug>/game.json`.
 *
 * Single-image worlds only reconstruct cleanly near the camera; further out the
 * splats smear. The arena is a street-aligned box: fog walls close off both ends
 * (hiding the smear) and invisible side walls keep players on the street.
 */
export interface ArenaConfig {
  /** Street centre at the player's spawn, world units. */
  origin: [number, number, number]
  /** Direction down the street (normalised on load, y ignored). */
  forward: [number, number, number]
  /** Half of the walkable width across the street. */
  halfWidth: number
  /** Distance from origin to the far fog wall. */
  front: number
  /** Distance from origin to the near (behind-spawn) fog wall. */
  back: number
  /** Visible fog wall height. */
  wallHeight?: number
  /** How far the fog walls extend past the street edges to cover the houses. */
  wallOverhang?: number
  fogColor?: string
  mistColor?: string
  /** Equirect panorama painted on the end walls, path relative to the world folder. */
  backdrop?: string
  /** Yaw (radians) aligning the backdrop pano with the world. */
  backdropYaw?: number
  backdropExposure?: number
  /** Height (m) of the rolling mist that hides the street/backdrop seam. */
  mistHeight?: number
  /** Below this elevation (deg) the backdrop is fog, above it the pano skyline shows. */
  skylineMinElevation?: number
  /** Half-angle (deg) around the street direction where the pano skyline shows. */
  skylineHalfAngle?: number
  /** Where zombies emerge (defaults to the arena ends). */
  spawnFront?: number
  spawnBack?: number
  /**
   * Spawn points outside the arena in street space [u, v], each with an optional
   * waypoint [u, v] they walk to first (e.g. round the corner of a cross street).
   */
  spawnPoints?: { at: [number, number]; via?: [number, number] }[]
  /** Draw the fog/backdrop walls (off when a procedural stage extends the world). */
  fogWalls?: boolean
  /** Enterable doors in street space: E opens them into a room. */
  doors?: { u: number; v: number; label?: string }[]
  /**
   * Interior world behind the doors (an IMAGE-BLASTER World Labs world). When set, it replaces
   * the placeholder cube room: you enter at its photo camera, facing the photo's view.
   */
  room?: { splat: string; collider?: string; metricScale: number; groundOffset: number; props?: unknown }
  /** Shop / perk hotspots inside the room, in room-local metres [x, y, z]. */
  shop?: { kind: 'weapon' | 'ammo' | 'perk' | 'rack'; id?: string; at: [number, number, number] }[]
}

export interface GameConfig {
  arena: ArenaConfig
  stage?: import('../stage/stage').StageConfig
}

export interface ArenaFrame {
  config: Required<ArenaConfig>
  origin: THREE.Vector3
  forward: THREE.Vector3
  right: THREE.Vector3
  /** Camera yaw that looks down the street. */
  yaw: number
}

const DEFAULTS = {
  wallHeight: 14,
  wallOverhang: 14,
  fogColor: '#070a14',
  mistColor: '#1b2030',
  backdrop: '',
  backdropYaw: Math.PI / 2,
  backdropExposure: 1,
  mistHeight: 3,
  skylineMinElevation: 3,
  skylineHalfAngle: 32,
  spawnPoints: [],
  spawnFront: NaN,
  spawnBack: NaN,
  fogWalls: true,
  doors: [],
  shop: [],
}

export function arenaFrame(config: ArenaConfig): ArenaFrame {
  const full = { ...DEFAULTS, ...config } as Required<ArenaConfig>
  const forward = new THREE.Vector3(config.forward[0], 0, config.forward[2]).normalize()
  const right = new THREE.Vector3(-forward.z, 0, forward.x)
  return {
    config: full,
    origin: new THREE.Vector3(...config.origin),
    forward,
    right,
    yaw: Math.atan2(-forward.x, -forward.z),
  }
}

/** Street coordinates (u along, v across) to world position at height y. */
export function arenaPoint(frame: ArenaFrame, u: number, v: number, y = frame.origin.y, out = new THREE.Vector3()) {
  return out.copy(frame.origin).addScaledVector(frame.forward, u).addScaledVector(frame.right, v).setY(y)
}

/** World position to street coordinates. */
export function arenaLocal(frame: ArenaFrame, p: THREE.Vector3) {
  const dx = p.x - frame.origin.x
  const dz = p.z - frame.origin.z
  return {
    u: dx * frame.forward.x + dz * frame.forward.z,
    v: dx * frame.right.x + dz * frame.right.z,
  }
}

export function useGameConfig(slug: string) {
  const [config, setConfig] = useState<GameConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    setConfig(null)
    fetch(`/worlds/${slug}/game.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.arena) setConfig(json as GameConfig)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug])
  return config
}
