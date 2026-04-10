// Shared AudioContext — created once on first user gesture so Safari allows audio playback.
// Safari blocks AudioContext created outside a direct user gesture handler; reusing one that
// was unlocked by a prior gesture works fine. Chrome/Firefox are more lenient but also benefit.
let sharedCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext()
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume()
  }
  return sharedCtx
}

// Call this once on any early user interaction (click, keydown, etc.) to unlock audio in Safari.
export function unlockAudio() {
  try {
    getCtx()
  } catch {
    // Ignore — will retry on next call
  }
}

// Warm two-tone chime for friend coming online — lower and softer than the message chirp
export function playFriendOnline() {
  try {
    const ctx = getCtx()

    // A warm major third: C5 → E5
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.type = 'triangle'
    osc1.frequency.value = 523 // C5
    gain1.gain.setValueAtTime(0.06, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.25)

    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.type = 'triangle'
    osc2.frequency.value = 659 // E5
    gain2.gain.setValueAtTime(0.06, ctx.currentTime + 0.18)
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc2.start(ctx.currentTime + 0.18)
    osc2.stop(ctx.currentTime + 0.5)
  } catch {
    // AudioContext unavailable or blocked
  }
}

// Gentle double-knock for friend requests — like someone tapping at the door asking to be let in
export function playFriendRequest() {
  try {
    const ctx = getCtx()

    // Two soft knocks: low sine bursts with fast decay, spaced 220ms apart
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 0.22
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = 320
      gain.gain.setValueAtTime(0.0, t)
      gain.gain.linearRampToValueAtTime(0.12, t + 0.012) // quick tap attack
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11) // soft decay
      osc.start(t)
      osc.stop(t + 0.11)
    }
  } catch {
    // AudioContext unavailable or blocked
  }
}

// Sharp two-tone chirp for incoming messages
export function playNotification() {
  try {
    const ctx = getCtx()

    // First note
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.type = 'sine'
    osc1.frequency.value = 660
    gain1.gain.setValueAtTime(0.08, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.15)

    // Second note, slightly higher and delayed
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.type = 'sine'
    osc2.frequency.value = 880
    gain2.gain.setValueAtTime(0.08, ctx.currentTime + 0.12)
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38)
    osc2.start(ctx.currentTime + 0.12)
    osc2.stop(ctx.currentTime + 0.38)
  } catch {
    // AudioContext unavailable or blocked
  }
}
