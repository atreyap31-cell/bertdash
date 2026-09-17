// Synthesised sound effects.
//
// The game previously had no audio at all. Rather than ship binary assets
// (which would need fetching, and would bloat the Pages deploy), every effect
// is generated with WebAudio oscillators at call time.

import { profile } from './profile.js';

class AudioService {
  #ctx = null;
  #master = null;
  #lastPlayed = new Map(); // throttles effects the engine can fire every frame

  #ensure() {
    if (this.#ctx === false) return null; // already determined to be unavailable
    if (this.#ctx) return this.#ctx;
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) { this.#ctx = false; return null; }
    this.#ctx = new Ctx();
    this.#master = this.#ctx.createGain();
    this.#master.gain.value = 0.22;
    this.#master.connect(this.#ctx.destination);
    return this.#ctx;
  }

  /** Browsers start the context suspended until a user gesture. */
  unlock() {
    const ctx = this.#ensure();
    if (ctx?.state === 'suspended') ctx.resume();
  }

  get enabled() {
    return profile.get().settings.sound !== false;
  }

  #tone({ freq, endFreq, type = 'square', duration = 0.12, gain = 0.6, delay = 0 }) {
    if (!this.enabled) return;
    const ctx = this.#ensure();
    if (!ctx || ctx.state === 'suspended') return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + duration);

    // Short attack, exponential decay — reads as a chiptune blip.
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env).connect(this.#master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  #noise({ duration = 0.2, gain = 0.4 }) {
    if (!this.enabled) return;
    const ctx = this.#ensure();
    if (!ctx || ctx.state === 'suspended') return;

    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames); // decaying white noise
    }

    const source = ctx.createBufferSource();
    const env = ctx.createGain();
    env.gain.value = gain;
    source.buffer = buffer;
    source.connect(env).connect(this.#master);
    source.start();
  }

  /** Rate-limit an effect so a per-frame trigger doesn't machine-gun. */
  #throttled(key, ms, fn) {
    const now = performance.now();
    if (now - (this.#lastPlayed.get(key) ?? -Infinity) < ms) return;
    this.#lastPlayed.set(key, now);
    fn();
  }

  jump()      { this.#tone({ freq: 380, endFreq: 720, duration: 0.11, gain: 0.5 }); }
  wallJump()  { this.#tone({ freq: 300, endFreq: 640, type: 'sawtooth', duration: 0.12, gain: 0.45 }); }
  land()      { this.#throttled('land', 90, () => this.#tone({ freq: 160, endFreq: 90, type: 'triangle', duration: 0.07, gain: 0.35 })); }
  slide()     { this.#noise({ duration: 0.22, gain: 0.18 }); }
  dive()      { this.#tone({ freq: 620, endFreq: 180, type: 'sawtooth', duration: 0.18, gain: 0.4 }); }
  throwFood() { this.#tone({ freq: 520, endFreq: 880, type: 'triangle', duration: 0.1, gain: 0.4 }); }
  catchFood() { this.#tone({ freq: 700, endFreq: 1040, type: 'sine', duration: 0.12, gain: 0.45 }); }
  pickup()    { this.#tone({ freq: 660, duration: 0.07, gain: 0.4 }); this.#tone({ freq: 990, duration: 0.09, gain: 0.4, delay: 0.07 }); }
  vehicle()   { this.#tone({ freq: 140, endFreq: 260, type: 'sawtooth', duration: 0.25, gain: 0.35 }); }
  death()     { this.#tone({ freq: 240, endFreq: 60, type: 'sawtooth', duration: 0.45, gain: 0.5 }); this.#noise({ duration: 0.3, gain: 0.25 }); }
  laser()     { this.#throttled('laser', 260, () => this.#tone({ freq: 1200, endFreq: 400, type: 'sawtooth', duration: 0.16, gain: 0.3 })); }

  win(stars = 3) {
    const scale = [523, 659, 784, 1046, 1318];
    for (let i = 0; i < Math.max(3, stars); i++) {
      this.#tone({ freq: scale[Math.min(i, scale.length - 1)], type: 'triangle', duration: 0.16, gain: 0.45, delay: i * 0.09 });
    }
  }

  achievement() {
    this.#tone({ freq: 880, type: 'triangle', duration: 0.1, gain: 0.4 });
    this.#tone({ freq: 1320, type: 'triangle', duration: 0.18, gain: 0.4, delay: 0.1 });
  }

  click() { this.#tone({ freq: 440, duration: 0.04, gain: 0.25, type: 'sine' }); }
}

export const audio = new AudioService();
