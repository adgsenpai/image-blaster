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
}

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
