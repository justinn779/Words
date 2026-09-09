// Placeholder sound effects (spec section 52): simple generated tones via the Web
// Audio API rather than shipped audio files, since no art/audio assets exist yet.
// Swap this module's internals for real samples later without touching call sites —
// every UI trigger goes through play(name), gated by playerStore's settings.soundOn.

export type SfxName = 'cardFlip' | 'cardMove' | 'invalid' | 'categoryComplete' | 'levelComplete' | 'coin' | 'unlock'

let ctx: AudioContext | null = null
// Tones currently scheduled but not yet ended. While a single AudioContext stays
// in the "running" state the browser marks the whole tab as playing audio (tab
// speaker icon) even in total silence, so we suspend it once every tone finishes
// and resume on the next play.
let activeTones = 0
let suspendTimer: ReturnType<typeof setTimeout> | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return null
  if (!ctx) ctx = new AudioCtx()
  if (suspendTimer !== null) {
    clearTimeout(suspendTimer)
    suspendTimer = null
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function releaseTone() {
  activeTones = Math.max(0, activeTones - 1)
  if (activeTones > 0 || !ctx) return
  // Small grace period so a burst of tones (e.g. a chord) doesn't thrash resume/suspend.
  if (suspendTimer !== null) clearTimeout(suspendTimer)
  suspendTimer = setTimeout(() => {
    suspendTimer = null
    if (activeTones === 0 && ctx && ctx.state === 'running') ctx.suspend().catch(() => {})
  }, 200)
}

function tone(freq: number, startOffset: number, duration: number, type: OscillatorType, gain: number, audio: AudioContext) {
  const osc = audio.createOscillator()
  const gainNode = audio.createGain()
  osc.type = type
  osc.frequency.value = freq
  const start = audio.currentTime + startOffset
  gainNode.gain.setValueAtTime(0, start)
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.01)
  gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration)
  osc.connect(gainNode).connect(audio.destination)
  osc.onended = releaseTone
  osc.start(start)
  activeTones++ // only after start() succeeds, so a throw here can't strand the counter above 0
  osc.stop(start + duration + 0.02)
}

const RECIPES: Record<SfxName, (audio: AudioContext) => void> = {
  cardFlip: (a) => tone(520, 0, 0.08, 'triangle', 0.05, a),
  cardMove: (a) => tone(360, 0, 0.06, 'sine', 0.05, a),
  invalid: (a) => tone(160, 0, 0.15, 'sawtooth', 0.06, a),
  categoryComplete: (a) => {
    tone(523, 0, 0.12, 'triangle', 0.07, a)
    tone(659, 0.08, 0.14, 'triangle', 0.07, a)
    tone(784, 0.16, 0.2, 'triangle', 0.07, a)
  },
  levelComplete: (a) => {
    tone(523, 0, 0.14, 'triangle', 0.08, a)
    tone(659, 0.12, 0.14, 'triangle', 0.08, a)
    tone(784, 0.24, 0.14, 'triangle', 0.08, a)
    tone(1047, 0.36, 0.3, 'triangle', 0.08, a)
  },
  coin: (a) => {
    tone(988, 0, 0.06, 'square', 0.04, a)
    tone(1319, 0.05, 0.08, 'square', 0.04, a)
  },
  unlock: (a) => {
    tone(440, 0, 0.1, 'sine', 0.06, a)
    tone(660, 0.08, 0.16, 'sine', 0.06, a)
  },
}

export function playSfx(name: SfxName, enabled: boolean): void {
  if (!enabled) return
  const audio = getContext()
  if (!audio) return
  try {
    RECIPES[name](audio)
  } catch {
    // audio can fail in odd environments (autoplay policies, headless tests) — never break gameplay for it
  }
}
