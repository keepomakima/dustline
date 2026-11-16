// Synthesised audio only — no audio files. Every sound is a small WebAudio graph built
// on first user gesture (pointer lock), so autoplay rules never block it.
export function createAudio() {
  let ctx = null; let muted = false;
  function ensure() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, gain, slideTo) {
    if (muted) return;
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }
  function noise(dur, gain, lowpass) {
    if (muted) return;
    const c = ensure(); if (!c) return;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  }
  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    shot(kind) {
      if (kind === 'shotgun') { noise(0.22, 0.5, 900); tone(90, 0.18, 'square', 0.25, 40); }
      else if (kind === 'dmr') { noise(0.2, 0.45, 1400); tone(140, 0.16, 'sawtooth', 0.2, 50); }
      else { noise(0.12, 0.35, 2200); tone(180, 0.08, 'square', 0.14, 70); }
    },
    enemyShot() { noise(0.1, 0.12, 1600); },
    reload() { tone(500, 0.07, 'square', 0.08); setTimeout(() => tone(700, 0.07, 'square', 0.08), 350); },
    step(sprint) { noise(0.05, sprint ? 0.09 : 0.045, 500); },
    hit() { tone(1200, 0.05, 'sine', 0.12); },
    kill() { tone(880, 0.09, 'sine', 0.14); setTimeout(() => tone(1320, 0.12, 'sine', 0.14), 80); },
    hurt() { tone(160, 0.18, 'sawtooth', 0.2, 80); },
    plant() { tone(660, 0.1, 'sine', 0.12); },
    beep() { tone(990, 0.12, 'sine', 0.12); },
    explode() { noise(0.7, 0.6, 300); tone(60, 0.6, 'sine', 0.4, 28); },
    round() { tone(523, 0.15, 'sine', 0.14); setTimeout(() => tone(784, 0.25, 'sine', 0.14), 150); },
    buy() { tone(1046, 0.08, 'sine', 0.1); },
  };
}
