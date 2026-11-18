import { useAudioStore } from '../../store/audio'

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
  return ctx
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

export const sfx = {
  shot(kind: 'pistol' | 'mg' | 'sniper' | 'knife' = 'pistol') {
    const ac = audio()
    if (!ac) return
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
  reload() {
    const ac = audio()
    if (!ac) return
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
