import { create } from 'zustand'
import type { GameConfig } from '../modules/game/arena'
import { itemsFromConfig, machineFront, type RoomItem, type RoomItemType } from '../modules/game/roomItems'

/**
 * In-game room editor (F2 while indoors). Holds the editable item list for the room,
 * the selection and gizmo mode, and saves back to the world's game.json through the
 * dev server. The game config object is mutated in place on save/move so gameplay
 * (shop hotspots) follows immediately.
 */
type Mode = 'translate' | 'rotate'

interface RoomEditorState {
  on: boolean
  slug: string
  config: GameConfig | null
  items: RoomItem[]
  selected: string | null
  mode: Mode
  snap: boolean
  dirty: boolean
  status: string
  assets: string[]
  /** Room-local camera pose, updated every frame by the editor, used to drop new items. */
  cam: { x: number; z: number; fx: number; fz: number }
  undo: RoomItem[][]
  version: number
  init: (slug: string, config: GameConfig) => void
  toggle: (on?: boolean) => void
  select: (id: string | null) => void
  setMode: (m: Mode) => void
  setSnap: (s: boolean) => void
  update: (id: string, patch: Partial<RoomItem>) => void
  add: (type: RoomItemType, extra?: Partial<RoomItem>) => void
  duplicate: () => void
  remove: () => void
  undoLast: () => void
  save: () => Promise<void>
  loadAssets: () => Promise<void>
  /** Local GPU generation (prompt and/or a screen capture of the scan). */
  gen: { status: 'idle' | 'running' | 'done' | 'error'; stage: string; error?: string; started?: number }
  /** Waiting for a drag-rectangle on the scan to capture. */
  pick: boolean
  prompt: string
  setPrompt: (p: string) => void
  setPick: (on: boolean) => void
  generate: (prompt: string, opts: { image?: string; target?: GenTarget; strength?: number }) => Promise<void>
  /** Bumped when the room splat file changes (scan cut). */
  splatVersion: number
  cutScan: () => Promise<void>
}

export interface GenTarget {
  /** Replace this item in place (keeps transform), or drop a new one at `at`. */
  replaceId?: string
  at?: [number, number, number]
  rotY?: number
  scale?: number
  /** Room-local axis-aligned box [x0,x1,y0,y1,z0,z1] to cut out of the scan for this asset. */
  cut?: number[]
}

const roomWorld = (config: GameConfig | null) => /\/worlds\/([a-z0-9-]+)\//.exec(config?.arena.room?.splat ?? '')?.[1] ?? ''

let counter = 0
const newId = (t: string) => `${t}-${Date.now().toString(36)}-${++counter}`

function syncShop(config: GameConfig | null, items: RoomItem[]) {
  const shop = config?.arena.shop
  if (!shop) return
  for (const it of items) {
    if (it.type !== 'machine') continue
    const spot = shop.find((s) => s.kind === 'perk' && s.id === it.perk)
    if (spot) spot.at = machineFront(it)
  }
}

export const useRoomEditor = create<RoomEditorState>()((set, get) => ({
  on: false,
  slug: '',
  config: null,
  items: [],
  selected: null,
  mode: 'translate',
  snap: true,
  dirty: false,
  status: '',
  assets: [],
  cam: { x: 0, z: 0, fx: 0, fz: -1 },
  undo: [],
  version: 0,
  init: (slug, config) => {
    const props = (config.arena.room?.props ?? {}) as Record<string, unknown>
    const items = itemsFromConfig(props)
    syncShop(config, items)
    set({ slug, config, items, selected: null, dirty: false, undo: [], version: get().version + 1 })
  },
  toggle: (on) => {
    const next = on ?? !get().on
    set({ on: next, selected: next ? get().selected : null, status: next ? 'editing room' : '' })
    if (next && !get().assets.length) void get().loadAssets()
  },
  select: (selected) => set({ selected }),
  setMode: (mode) => set({ mode }),
  setSnap: (snap) => set({ snap }),
  update: (id, patch) => {
    const { items, undo, config } = get()
    const next = items.map((it) => (it.id === id ? { ...it, ...patch } : it))
    syncShop(config, next)
    set({ items: next, dirty: true, undo: [...undo.slice(-40), items], version: get().version + 1 })
  },
  add: (type, extra) => {
    const { items, undo, cam } = get()
    const d = 2.2
    const it: RoomItem = {
      id: newId(type), type,
      at: [+(cam.x + cam.fx * d).toFixed(2), type === 'sign' ? 2.6 : type === 'board' ? 1.8 : 0, +(cam.z + cam.fz * d).toFixed(2)],
      rotY: Math.atan2(-cam.fx, -cam.fz),
      ...extra,
    }
    set({ items: [...items, it], selected: it.id, dirty: true, undo: [...undo.slice(-40), items], version: get().version + 1 })
  },
  duplicate: () => {
    const { items, selected, undo } = get()
    const src = items.find((i) => i.id === selected)
    if (!src) return
    const it = { ...src, id: newId(src.type), at: [src.at[0] + 0.6, src.at[1], src.at[2] + 0.6] as [number, number, number] }
    set({ items: [...items, it], selected: it.id, dirty: true, undo: [...undo.slice(-40), items], version: get().version + 1 })
  },
  remove: () => {
    const { items, selected, undo } = get()
    if (!selected) return
    set({ items: items.filter((i) => i.id !== selected), selected: null, dirty: true, undo: [...undo.slice(-40), items], version: get().version + 1 })
  },
  undoLast: () => {
    const { undo, config } = get()
    const prev = undo[undo.length - 1]
    if (!prev) return
    syncShop(config, prev)
    set({ items: prev, undo: undo.slice(0, -1), dirty: true, version: get().version + 1 })
  },
  save: async () => {
    const { config, items, slug } = get()
    if (!config?.arena.room) return
    const props = (config.arena.room.props ?? {}) as Record<string, unknown>
    const next: Record<string, unknown> = { items }
    if (props.bounds) next.bounds = props.bounds
    config.arena.room.props = next
    syncShop(config, items)
    set({ status: 'saving…' })
    try {
      const r = await fetch(`/__game-config?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config, null, 2),
      })
      set({ status: r.ok ? 'saved to game.json' : `save failed (${r.status})`, dirty: !r.ok })
    } catch {
      set({ status: 'save failed (dev server?)' })
    }
  },
  gen: { status: 'idle', stage: '' },
  pick: false,
  prompt: "",
  setPrompt: (prompt) => set({ prompt }),
  setPick: (pick) => set({ pick }),
  splatVersion: 0,
  generate: async (prompt, { image, target, strength }) => {
    const world = roomWorld(get().config)
    if (!world || get().gen.status === 'running') return
    const started = Date.now()
    set({ gen: { status: 'running', stage: 'queued', started }, status: 'generating on the GPU…' })
    try {
      const r = await fetch('/__gen-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world, prompt, image, strength }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      for (;;) {
        await new Promise((res) => setTimeout(res, 2000))
        const s = await (await fetch(`/__gen-asset?job=${encodeURIComponent(j.job)}`, { cache: 'no-store' })).json()
        set({ gen: { status: 'running', stage: s.stage, started } })
        if (s.status === 'error') throw new Error(s.error ?? 'generation failed')
        if (s.status === 'done') {
          const url = s.glb as string
          const t = target ?? {}
          const { items, cam } = get()
          const src = t.replaceId ? items.find((i) => i.id === t.replaceId) : undefined
          if (src) {
            get().update(src.id, { type: 'glb', url, name: prompt || undefined, cut: t.cut ?? src.cut })
            set({ selected: src.id })
          } else {
            get().add('glb', {
              url, name: prompt || undefined, cut: t.cut, scale: t.scale ?? 1,
              ...(t.at ? { at: t.at } : {}),
              rotY: t.rotY ?? Math.atan2(-cam.fx, -cam.fz),
            })
          }
          set({ gen: { status: 'done', stage: `done in ${Math.round((Date.now() - started) / 1000)} s` }, status: 'asset ready · unsaved' })
          get().loadAssets()
          return
        }
      }
    } catch (err) {
      set({ gen: { status: 'error', stage: '', error: String((err as Error).message ?? err) }, status: 'generation failed' })
    }
  },
  cutScan: async () => {
    const { config, items } = get()
    const world = roomWorld(config)
    const boxes = items.map((i) => i.cut).filter((b): b is number[] => Array.isArray(b) && b.length === 6)
    if (!world || !config?.arena.room) return
    set({ status: `cutting ${boxes.length} region(s) out of the scan…` })
    try {
      const r = await fetch('/__room-cut', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ world, boxes }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      config.arena.room.splat = j.splat
      set({ splatVersion: get().splatVersion + 1 })
      await get().save()
      set({ status: 'scan cut + saved' })
    } catch (err) {
      set({ status: `cut failed: ${String((err as Error).message ?? err).slice(0, 120)}` })
    }
  },
  loadAssets: async () => {
    try {
      const r = await fetch('/__game-assets', { cache: 'no-store' })
      if (r.ok) set({ assets: (await r.json()) as string[] })
    } catch {
      /* palette still has the built-in props */
    }
  },
}))

// Dev hook for automated checks.
if (typeof window !== "undefined") (window as unknown as { __roomEditor: typeof useRoomEditor }).__roomEditor = useRoomEditor
