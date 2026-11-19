import { useAudioStore } from '../../store/audio'
import { gameRuntime } from './runtime'

type VoiceKind = 'hit' | 'attack' | 'groan' | 'death'
const voices: Partial<Record<VoiceKind, AudioBuffer[]>> = {}
let voicesRequested = false

function loadVoices(ac: AudioContext) {
  if (voicesRequested) return
  voicesRequested = true
  fetch('/game/sfx/zombie/groups.json')
    .then((r) => r.json())
    .then((groups: Record<VoiceKind, string[]>) => {
      for (const [kind, files] of Object.entries(groups) as [VoiceKind, string[]][]) {
        for (const f of files) {
          fetch(`/game/sfx/zombie/${f}`)
            .then((r) => r.arrayBuffer())
            .then((b) => ac.decodeAudioData(b))
            .then((buf) => {
              ;(voices[kind] ??= []).push(buf)
            })
            .catch(() => {})
        }
      }
    })
    .catch(() => {})
}

/** Tiny WebAudio synth so the demo needs no audio files. */
let ctx: AudioContext | null = null
let noiseBuffer: AudioBuffer | null = null

function audio() {
  if (useAudioStore.getState().muted) return null
  if (!ctx) {
    ctx = new AudioContext()
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') void ctx.resume()
  loadSamples(ctx)
  loadVoices(ctx)
  return ctx
}

/** Recorded samples (see public/game/CREDITS.txt); synth is the fallback. */
const SAMPLE_URLS = {
  pistol: '/game/sfx/pistol.ogg',
  mg: '/game/sfx/rifle.ogg',
  sniper: '/game/sfx/sniper.ogg',
  reloadPistol: '/game/sfx/reload_pistol.ogg',
  reloadRifle: '/game/sfx/reload_rifle.ogg',
} as const
type SampleId = keyof typeof SAMPLE_URLS
const samples: Partial<Record<SampleId, AudioBuffer>> = {}
let samplesRequested = false

function loadSamples(ac: AudioContext) {
  if (samplesRequested) return
  samplesRequested = true
  for (const [id, url] of Object.entries(SAMPLE_URLS) as [SampleId, string][]) {
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ac.decodeAudioData(b))
      .then((buf) => {
        samples[id] = buf
      })
      .catch(() => {})
  }
}

function playSample(ac: AudioContext, id: SampleId, gain = 0.8, rate = 1) {
  const buf = samples[id]
  if (!buf) return false
  const src = ac.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate * (0.96 + Math.random() * 0.08)
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(g).connect(ac.destination)
  src.start()
  return true
}

function noise(ac: AudioContext, duration: number, filterHz: number, gain: number, type: BiquadFilterType = 'lowpass') {
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ac.createBiquadFilter()
  filter.type = type
  filter.frequency.value = filterHz
  const g = ac.createGain()
  const t = ac.currentTime
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter).connect(g).connect(ac.destination)
  src.start(t, Math.random() * 0.5)
  src.stop(t + duration)
}

function tone(ac: AudioContext, type: OscillatorType, from: number, to: number, duration: number, gain: number, delay = 0) {
  const osc = ac.createOscillator()
  osc.type = type
  const g = ac.createGain()
  const t = ac.currentTime + delay
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(g).connect(ac.destination)
  osc.start(t)
  osc.stop(t + duration)
}

/** Play a recorded zombie voice panned/attenuated by its position relative to the player. */
function zombieVoice(ac: AudioContext, kind: VoiceKind, x: number, z: number) {
  const pool = voices[kind]
  if (!pool?.length) return false
  const buf = pool[Math.floor(Math.random() * pool.length)]
  const dx = x - gameRuntime.playerPos.x
  const dz = z - gameRuntime.playerPos.z
  const dist = Math.hypot(dx, dz)
  const yaw = gameRuntime.camYaw
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)
  const pan = dist > 0.01 ? Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / dist)) : 0
  const src = ac.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = 0.85 + Math.random() * 0.3
  const g = ac.createGain()
  g.gain.value = Math.min(1, 1.6 / (1 + dist * 0.35)) * (kind === 'death' ? 0.9 : 0.7)
  const p = ac.createStereoPanner()
  p.pan.value = pan * 0.85
  src.connect(g).connect(p).connect(ac.destination)
  src.start()
  return true
}

export const sfx = {
  zombie(kind: VoiceKind, x: number, z: number) {
    const ac = audio()
    if (!ac) return
    if (!zombieVoice(ac, kind, x, z) && kind === 'groan') sfx.groan()
  },
  shot(kind: 'pistol' | 'mg' | 'sniper' | 'knife' = 'pistol') {
    const ac = audio()
    if (!ac) return
    if (kind !== 'knife' && playSample(ac, kind, kind === 'mg' ? 0.55 : 0.8)) return
    if (kind === 'sniper') {
      noise(ac, 0.6, 1800, 0.8)
      noise(ac, 0.12, 8000, 0.35, 'highpass')
      tone(ac, 'sine', 110, 30, 0.45, 0.7)
      tone(ac, 'square', 900, 500, 0.04, 0.05, 0.55) // bolt cycle
      tone(ac, 'square', 600, 900, 0.04, 0.05, 0.75)
    } else if (kind === 'mg') {
      noise(ac, 0.12, 3200, 0.4)
      noise(ac, 0.05, 7000, 0.18, 'highpass')
      tone(ac, 'sine', 160, 60, 0.1, 0.35)
    } else {
      noise(ac, 0.22, 2600, 0.55)
      noise(ac, 0.08, 7000, 0.25, 'highpass')
      tone(ac, 'sine', 140, 40, 0.18, 0.5)
    }
  },
  swing() {
    const ac = audio()
    if (!ac) return
    noise(ac, 0.16, 3500, 0.18, 'bandpass')
  },
  explosion() {
    const ac = audio()
    if (!ac) return
    noise(ac, 1.4, 900, 1.0)
    noise(ac, 0.35, 4000, 0.4)
    tone(ac, 'sine', 90, 25, 1.0, 0.9)
  },
  door() {
    const ac = audio()
    if (!ac) return
    noise(ac, 0.35, 500, 0.25)
    tone(ac, 'triangle', 180, 90, 0.4, 0.12)
    tone(ac, 'square', 1200, 900, 0.05, 0.05, 0.05)
  },
  pin() {
    const ac = audio()
    if (!ac) return
    tone(ac, 'triangle', 2400, 1800, 0.05, 0.08)
  },
  dryFire() {
    const ac = audio()
    if (!ac) return
    tone(ac, 'square', 1800, 1200, 0.03, 0.08)
  },
  reload(kind: 'pistol' | 'mg' | 'sniper' | 'knife' = 'pistol') {
    const ac = audio()
    if (!ac) return
    if (kind !== 'knife' && playSample(ac, kind === 'pistol' ? 'reloadPistol' : 'reloadRifle', 0.7)) return
    tone(ac, 'square', 900, 600, 0.04, 0.07)
    tone(ac, 'square', 700, 1100, 0.05, 0.07, 0.9)
  },
  hit(headshot: boolean) {
    const ac = audio()
    if (!ac) return
    noise(ac, 0.09, headshot ? 1800 : 600, 0.35)
    if (headshot) tone(ac, 'triangle', 1400, 900, 0.08, 0.12)
  },
  hurt() {
    const ac = audio()
    if (!ac) return
    tone(ac, 'sawtooth', 160, 70, 0.25, 0.18)
    noise(ac, 0.15, 400, 0.25)
  },
  groan() {
    const ac = audio()
    if (!ac) return
    const osc = ac.createOscillator()
    osc.type = 'sawtooth'
    const base = 70 + Math.random() * 40
    const lfo = ac.createOscillator()
    lfo.frequency.value = 5 + Math.random() * 4
    const lfoGain = ac.createGain()
    lfoGain.gain.value = 12
    lfo.connect(lfoGain).connect(osc.frequency)
    const filter = ac.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 500
    filter.Q.value = 2
    const g = ac.createGain()
    const t = ac.currentTime
    const d = 0.9 + Math.random() * 0.6
    osc.frequency.setValueAtTime(base, t)
    osc.frequency.linearRampToValueAtTime(base * 0.75, t + d)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.09, t + 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, t + d)
    osc.connect(filter).connect(g).connect(ac.destination)
    osc.start(t)
    lfo.start(t)
    osc.stop(t + d)
    lfo.stop(t + d)
  },
}
