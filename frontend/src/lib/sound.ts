// Warm two-tone chime for friend coming online — lower and softer than the message chirp
export function playFriendOnline() {
  try {
    const ctx = new AudioContext()

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

// Sharp two-tone chirp for incoming messages
export function playNotification() {
  try {
    const ctx = new AudioContext()

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
