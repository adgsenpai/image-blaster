import { create } from 'zustand'
import { GRENADE_MAX, GRENADE_START, WEAPONS, WEAPON_ORDER, type WeaponId } from '../modules/game/weapons'

export type GamePhase = 'off' | 'ready' | 'playing' | 'paused' | 'dead'

export const MAX_HEALTH = 100

type Ammo = Record<WeaponId, number>

const fullAmmo = (): Ammo =>
  Object.fromEntries(WEAPON_ORDER.map((id) => [id, WEAPONS[id].mag])) as Ammo

interface GameStore {
  /** True when the current world ships a game.json arena. */
  available: boolean
  setAvailable: (available: boolean) => void
  phase: GamePhase
  health: number
  weapon: WeaponId
  ammo: Ammo
  reloading: boolean
  ads: boolean
  grenades: number
  wave: number
  score: number
  kills: number
  alive: number
  banner: string
  bannerToken: number
  hurtToken: number
  hitToken: number
  headshotToken: number
  /** Increments on every (re)start so scene components can reset. */
  runToken: number
  enter: () => void
  exit: () => void
  start: () => void
  pause: () => void
  resume: () => void
  damage: (amount: number) => void
  setWeapon: (weapon: WeaponId) => void
  setAmmo: (weapon: WeaponId, ammo: number) => void
  setReloading: (reloading: boolean) => void
  setAds: (ads: boolean) => void
  consumeGrenade: () => boolean
  addKill: (points: number) => void
  setWave: (wave: number) => void
  setAlive: (alive: number) => void
  showBanner: (text: string) => void
  markHit: (headshot: boolean) => void
}

const freshRun = () => ({
  health: MAX_HEALTH,
  weapon: 'pistol' as WeaponId,
  ammo: fullAmmo(),
  reloading: false,
  ads: false,
  grenades: GRENADE_START,
  wave: 0,
  score: 0,
  kills: 0,
  alive: 0,
})

export const useGameStore = create<GameStore>()((set, get) => ({
  available: false,
  setAvailable: (available) => set(available ? { available } : { available, phase: 'off' }),
  phase: 'off',
  ...freshRun(),
  banner: '',
  bannerToken: 0,
  hurtToken: 0,
  hitToken: 0,
  headshotToken: 0,
  runToken: 0,
  enter: () => set((s) => ({ phase: 'ready', ...freshRun(), runToken: s.runToken + 1 })),
  exit: () => set({ phase: 'off', banner: '', ads: false }),
  start: () => set((s) => (s.phase === 'dead' || s.phase === 'ready'
    ? { phase: 'playing', ...freshRun(), runToken: s.runToken + 1 }
    : { phase: 'playing' })),
  pause: () => set((s) => (s.phase === 'playing' ? { phase: 'paused', ads: false } : {})),
  resume: () => set((s) => (s.phase === 'paused' ? { phase: 'playing' } : {})),
  damage: (amount) => set((s) => {
    if (s.phase !== 'playing') return {}
    const health = Math.max(0, s.health - amount)
    return { health, hurtToken: s.hurtToken + 1, ...(health === 0 ? { phase: 'dead' as const, ads: false } : {}) }
  }),
  setWeapon: (weapon) => set((s) => (s.weapon === weapon ? {} : { weapon, reloading: false, ads: false })),
  setAmmo: (weapon, ammo) => set((s) => ({ ammo: { ...s.ammo, [weapon]: ammo } })),
  setReloading: (reloading) => set({ reloading }),
  setAds: (ads) => set({ ads }),
  consumeGrenade: () => {
    if (get().grenades <= 0) return false
    set((s) => ({ grenades: s.grenades - 1 }))
    return true
  },
  addKill: (points) => set((s) => ({ kills: s.kills + 1, score: s.score + points })),
  setWave: (wave) => set((s) => ({ wave, grenades: wave > 1 ? Math.min(GRENADE_MAX, s.grenades + 1) : s.grenades })),
  setAlive: (alive) => set({ alive }),
  showBanner: (text) => set((s) => ({ banner: text, bannerToken: s.bannerToken + 1 })),
  markHit: (headshot) => set((s) => (headshot
    ? { hitToken: s.hitToken + 1, headshotToken: s.headshotToken + 1 }
    : { hitToken: s.hitToken + 1 })),
}))
