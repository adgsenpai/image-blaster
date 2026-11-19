import { create } from 'zustand'
import { GRENADE_MAX, GRENADE_START, PERKS, WEAPONS, WEAPON_ORDER, type PerkId, type WeaponId } from '../modules/game/weapons'

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
  /** Player is inside a door room (zombies pause). */
  indoors: boolean
  /** Interaction prompt shown in the HUD ('' = none). */
  prompt: string
  /** Screen fade 0..1 for door transitions. */
  fade: number
  setIndoors: (v: boolean) => void
  setPrompt: (v: string) => void
  setFade: (v: number) => void
  /** Rand in the wallet. */
  money: number
  /** Weapons the player owns (starts with the knife). */
  owned: WeaponId[]
  /** Spare rounds per weapon (reloads draw from this). */
  reserve: Ammo
  perks: PerkId[]
  /** Perk being drunk (drives the drinking animation). */
  drinking: PerkId | null
  addMoney: (n: number) => void
  /** Buy a weapon (or ammo if already owned). Returns a message. */
  buyWeapon: (id: WeaponId) => string
  buyAmmo: () => string
  buyPerk: (id: PerkId) => string
  finishDrink: () => void
  setReserve: (weapon: WeaponId, n: number) => void
  heal: (n: number) => void
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
  indoors: false,
  prompt: '',
  fade: 0,
  health: MAX_HEALTH,
  weapon: 'pistol' as WeaponId,
  ammo: fullAmmo(),
  money: 500,
  owned: ['knife', 'pistol'] as WeaponId[],
  reserve: Object.fromEntries(WEAPON_ORDER.map((id) => [id, id === 'pistol' ? WEAPONS.pistol.reserve : 0])) as Ammo,
  perks: [] as PerkId[],
  drinking: null as PerkId | null,
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
  indoors: false,
  prompt: '',
  fade: 0,
  setIndoors: (indoors) => set({ indoors }),
  setPrompt: (prompt) => set((s) => (s.prompt === prompt ? {} : { prompt })),
  setFade: (fade) => set({ fade }),
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
    if (health === 0 && s.perks.includes('tonic')) {
      // Table Mountain Tonic: back on your feet once, then it's gone.
      return {
        health: MAX_HEALTH, hurtToken: s.hurtToken + 1, perks: s.perks.filter((p) => p !== 'tonic'),
        banner: 'tonic kicked in', bannerToken: s.bannerToken + 1,
      }
    }
    return { health, hurtToken: s.hurtToken + 1, ...(health === 0 ? { phase: 'dead' as const, ads: false } : {}) }
  }),
  addMoney: (n) => set((s) => ({ money: s.money + n })),
  heal: (n) => set((s) => (s.phase === 'playing' && s.health < MAX_HEALTH ? { health: Math.min(MAX_HEALTH, s.health + n) } : {})),
  setReserve: (weapon, n) => set((s) => ({ reserve: { ...s.reserve, [weapon]: n } })),
  buyWeapon: (id) => {
    const s = get()
    const def = WEAPONS[id]
    if (s.owned.includes(id)) return get().buyAmmo()
    if (s.money < def.price) return `need R${def.price.toLocaleString('en-ZA')}`
    set({
      money: s.money - def.price, owned: [...s.owned, id], weapon: id, reloading: false, ads: false,
      ammo: { ...s.ammo, [id]: def.mag }, reserve: { ...s.reserve, [id]: def.reserve },
    })
    return `bought ${def.name}`
  },
  buyAmmo: () => {
    const s = get()
    const def = WEAPONS[s.weapon]
    if (!def.mag) return 'knives never run dry'
    if (s.reserve[s.weapon] >= def.reserve) return 'ammo full'
    if (s.money < def.ammoPrice) return `need R${def.ammoPrice}`
    set({ money: s.money - def.ammoPrice, reserve: { ...s.reserve, [s.weapon]: def.reserve } })
    return `${def.name} ammo refilled`
  },
  buyPerk: (id) => {
    const s = get()
    const perk = PERKS[id]
    if (s.perks.includes(id)) return `already had ${perk.name}`
    if (s.drinking) return ''
    if (s.money < perk.price) return `need R${perk.price.toLocaleString('en-ZA')}`
    set({ money: s.money - perk.price, drinking: id })
    return `${perk.name}!`
  },
  finishDrink: () => set((s) => (s.drinking ? { perks: [...s.perks, s.drinking], drinking: null } : {})),
  setWeapon: (weapon) => set((s) => (s.weapon === weapon ? {} : { weapon, reloading: false, ads: false })),
  setAmmo: (weapon, ammo) => set((s) => ({ ammo: { ...s.ammo, [weapon]: ammo } })),
  setReloading: (reloading) => set({ reloading }),
  setAds: (ads) => set({ ads }),
  consumeGrenade: () => {
    if (get().grenades <= 0) return false
    set((s) => ({ grenades: s.grenades - 1 }))
    return true
  },
  addKill: (points) => set((s) => ({ kills: s.kills + 1, score: s.score + points, money: s.money + points })),
  setWave: (wave) => set((s) => ({ wave, grenades: wave > 1 ? Math.min(GRENADE_MAX, s.grenades + 1) : s.grenades })),
  setAlive: (alive) => set({ alive }),
  showBanner: (text) => set((s) => ({ banner: text, bannerToken: s.bannerToken + 1 })),
  markHit: (headshot) => set((s) => (headshot
    ? { hitToken: s.hitToken + 1, headshotToken: s.headshotToken + 1 }
    : { hitToken: s.hitToken + 1 })),
}))
