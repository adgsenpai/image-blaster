import { useEffect, useState } from 'react'
import { MAX_HEALTH, useGameStore } from '../store/game'
import { GRENADE_MAX, WEAPONS, WEAPON_ORDER } from '../modules/game/weapons'
import { gameRuntime } from '../modules/game/runtime'

function useFlash(token: number, ms: number) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!token) return
    setOn(true)
    const t = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(t)
  }, [token, ms])
  return on
}

function DevReadout() {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const p = gameRuntime.playerPos
      setText(`u ${gameRuntime.playerU.toFixed(1)}  v ${gameRuntime.playerV.toFixed(1)}  xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`)
    }, 200)
    return () => clearInterval(id)
  }, [])
  return <div className="fixed left-3 top-3 z-40 font-mono text-[10px] text-white/40">{text}</div>
}

export function GameHUD() {
  const phase = useGameStore((s) => s.phase)
  const health = useGameStore((s) => s.health)
  const weapon = useGameStore((s) => s.weapon)
  const ammoByWeapon = useGameStore((s) => s.ammo)
  const ads = useGameStore((s) => s.ads)
  const grenades = useGameStore((s) => s.grenades)
  const def = WEAPONS[weapon]
  const ammo = ammoByWeapon[weapon]
  const scoped = ads && def.scope
  const reloading = useGameStore((s) => s.reloading)
  const wave = useGameStore((s) => s.wave)
  const score = useGameStore((s) => s.score)
  const kills = useGameStore((s) => s.kills)
  const alive = useGameStore((s) => s.alive)
  const banner = useGameStore((s) => s.banner)
  const bannerToken = useGameStore((s) => s.bannerToken)
  const hurtToken = useGameStore((s) => s.hurtToken)
  const hitToken = useGameStore((s) => s.hitToken)
  const headshotToken = useGameStore((s) => s.headshotToken)
  const exit = useGameStore((s) => s.exit)
  const prompt = useGameStore((s) => s.prompt)
  const fade = useGameStore((s) => s.fade)
  const start = useGameStore((s) => s.start)

  const showBanner = useFlash(bannerToken, 2200)
  const hurt = useFlash(hurtToken, 260)
  const hit = useFlash(hitToken, 120)
  const headshot = useFlash(headshotToken, 450)

  if (phase === 'off') return null
  const hpPct = (health / MAX_HEALTH) * 100
  const lowHp = health <= 30

  return (
    <div className="pointer-events-none fixed inset-0 z-40 select-none font-mono text-white">
      {/* damage + low health vignette */}
      <div
        className="absolute inset-0 transition-opacity duration-200"
        style={{
          opacity: hurt ? 0.9 : lowHp && phase === 'playing' ? 0.45 : 0,
          background: 'radial-gradient(ellipse at center, transparent 45%, rgba(170,0,0,0.75) 100%)',
        }}
      />

      {/* crosshair */}
      {/* sniper scope */}
      {phase === 'playing' && scoped && (
        <div className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at center, transparent 0, transparent 32vh, rgba(0,0,0,0.6) 32.5vh, #000 34vh)' }}
          />
          <div className="absolute left-1/2 top-1/2 h-[64vh] w-[1.5px] -translate-x-1/2 -translate-y-1/2 bg-black/85" />
          <div className="absolute left-1/2 top-1/2 h-[1.5px] w-[64vh] -translate-x-1/2 -translate-y-1/2 bg-black/85" />
          <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="absolute left-1/2 h-[1.5px] w-5 -translate-x-1/2 bg-black/85" style={{ top: `calc(50% + ${i * 4}vh)` }} />
          ))}
        </div>
      )}
      {phase === 'playing' && ads && !def.scope && (
        <div className={`absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${hit ? 'bg-red-400' : 'bg-white/80'}`} />
      )}
      {phase === 'playing' && !ads && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className={`relative h-6 w-6 transition-transform ${hit ? 'scale-125' : ''}`}>
            <span className={`absolute left-1/2 top-0 h-2 w-[2px] -translate-x-1/2 ${hit ? 'bg-red-400' : 'bg-white/85'}`} />
            <span className={`absolute left-1/2 bottom-0 h-2 w-[2px] -translate-x-1/2 ${hit ? 'bg-red-400' : 'bg-white/85'}`} />
            <span className={`absolute top-1/2 left-0 w-2 h-[2px] -translate-y-1/2 ${hit ? 'bg-red-400' : 'bg-white/85'}`} />
            <span className={`absolute top-1/2 right-0 w-2 h-[2px] -translate-y-1/2 ${hit ? 'bg-red-400' : 'bg-white/85'}`} />
          </div>
          {headshot && <div className="absolute left-1/2 top-8 -translate-x-1/2 whitespace-nowrap text-xs font-bold tracking-widest text-red-400">headshot</div>}
        </div>
      )}

      {/* top: wave / score */}
      {phase !== 'ready' && (
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-5 rounded bg-black/40 px-4 py-1.5 text-sm backdrop-blur-sm">
          <span>wave <b className="text-amber-300">{wave}</b></span>
          <span>score <b>{score}</b></span>
          <span>kills <b>{kills}</b></span>
          <span className="text-white/60">left {alive}</span>
        </div>
      )}

      {/* wave banner */}
      <div
        className="absolute left-1/2 top-[28%] -translate-x-1/2 text-5xl font-black uppercase tracking-[0.3em] text-red-500/90 transition-opacity duration-500"
        style={{ opacity: showBanner && phase === 'playing' ? 1 : 0, textShadow: '0 0 24px rgba(0,0,0,0.9)' }}
      >
        {banner}
      </div>

      {/* bottom: health + ammo */}
      {phase !== 'ready' && (
        <>
          <div className="absolute bottom-6 left-6 w-64">
            <div className="mb-1 text-xs text-white/70">health</div>
            <div className="h-3 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/20">
              <div
                className={`h-full transition-all duration-200 ${lowHp ? 'bg-red-500' : 'bg-emerald-400'}`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
          </div>
          <div className="absolute bottom-6 right-6 text-right">
            <div className="mb-2 text-sm uppercase tracking-widest text-white/70">{def.name}</div>
            <div className="text-4xl font-bold leading-none">
              {!def.mag ? <span className="text-2xl text-white/60">melee</span> : reloading ? <span className="text-xl text-amber-300">reloading…</span> : (
                <>
                  <span className={ammo <= Math.ceil(def.mag * 0.2) ? 'text-red-400' : ''}>{ammo}</span>
                  <span className="text-lg text-white/50"> / {def.mag}</span>
                </>
              )}
            </div>
            <div className="mt-2 flex items-center justify-end gap-1 text-xs text-white/60">
              <span>grenades</span>
              {Array.from({ length: GRENADE_MAX }, (_, i) => (
                <span key={i} className={`inline-block h-2.5 w-2.5 rounded-full ${i < grenades ? 'bg-lime-500' : 'bg-white/15'}`} />
              ))}
              <span className="ml-1 text-white/40">G</span>
            </div>
          </div>
          <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-1.5">
            {WEAPON_ORDER.map((id) => {
              const w = WEAPONS[id]
              const on = id === weapon
              return (
                <div key={id} className={`rounded px-2.5 py-1 text-xs ${on ? 'bg-white/20 text-white ring-1 ring-white/40' : 'bg-black/40 text-white/45'}`}>
                  <span className="mr-1 text-white/40">{w.slot}</span>{w.name}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* door prompt + fade */}
      {phase === 'playing' && prompt && (
        <div className="absolute left-1/2 top-[60%] -translate-x-1/2 rounded bg-black/55 px-3 py-1.5 text-sm tracking-wide text-white/90 ring-1 ring-white/20">
          {prompt}
        </div>
      )}
      <div className="absolute inset-0 bg-black transition-opacity duration-300" style={{ opacity: fade }} />

      {/* overlays */}
      {phase === 'ready' && (
        <Overlay>
          <h1 className="text-4xl font-black tracking-[0.2em] text-red-500">BO-KAAP: LAST NIGHT</h1>
          <p className="mt-3 text-sm text-white/70">they're coming out of the fog. hold the street.</p>
          <p className="mt-6 text-sm text-white/90">click to start</p>
          <Controls />
          <ExitButton onClick={exit} />
        </Overlay>
      )}
      {phase === 'paused' && (
        <Overlay>
          <h2 className="text-3xl font-bold tracking-widest">paused</h2>
          <p className="mt-4 text-sm text-white/80">click the street to resume</p>
          <Controls />
          <ExitButton onClick={exit} />
        </Overlay>
      )}
      {phase === 'dead' && (
        <Overlay>
          <h2 className="text-5xl font-black tracking-[0.25em] text-red-600">you died</h2>
          <p className="mt-4 text-lg">wave {wave} · {kills} kills · {score} pts</p>
          <div className="pointer-events-auto mt-6 flex justify-center gap-3">
            <button className="rounded bg-red-600 px-4 py-2 text-sm font-bold hover:bg-red-500" onClick={() => {
                start()
                void document.querySelector('canvas')?.requestPointerLock()
              }}>play again</button>
            <button className="rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/20" onClick={exit}>exit</button>
          </div>
        </Overlay>
      )}

      {import.meta.env.DEV && phase !== 'ready' && <DevReadout />}
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
      <div className="text-center">{children}</div>
    </div>
  )
}

function Controls() {
  return (
    <div className="mx-auto mt-6 grid w-[26rem] grid-cols-[8rem_1fr] gap-x-6 gap-y-1 text-left text-xs text-white/60">
      <span>WASD</span><span>move</span>
      <span>mouse</span><span>aim</span>
      <span>left click</span><span>shoot (hold: machine gun)</span>
      <span>right click</span><span>aim down sights / scope</span>
      <span>1 2 3 4 / wheel</span><span>pistol · mg · sniper · knife</span>
      <span>V</span><span>knife</span>
      <span>G</span><span>throw grenade</span>
      <span>R</span><span>reload</span>
      <span>shift</span><span>sprint</span>
      <span>space</span><span>jump</span>
      <span>esc</span><span>pause</span>
    </div>
  )
}

function ExitButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="pointer-events-auto mt-6 rounded bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20" onClick={onClick}>
      exit to viewer
    </button>
  )
}
