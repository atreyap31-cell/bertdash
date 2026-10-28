// Music, synthesised the same way the sound effects are.
//
// No audio files: the whole soundtrack is oscillators scheduled at play time,
// so the Pages deploy stays a few hundred kilobytes of text and there is
// nothing to download before the game is playable.
//
// It is a small tracker. A track is a key, a chord progression and a handful
// of sixteen-step patterns written as strings, and #scheduleStep turns one
// step into voices. Patterns being readable in source is the point — you can
// see what a track plays without running it.
//
// Scheduling uses the standard WebAudio lookahead: a timer wakes often and
// queues every step falling inside the next fifth of a second, against
// ctx.currentTime rather than wall time. setInterval drifts and stalls under
// load; the audio clock does not.

import { profile } from './profile.js';
import { audio } from './audio.js';

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** Semitones above the root for a scale degree, wrapping into octaves. */
function degree(scale, n) {
  const octave = Math.floor(n / scale.length);
  const index = ((n % scale.length) + scale.length) % scale.length;
  return scale[index] + octave * 12;
}

const freq = midi => 440 * 2 ** ((midi - 69) / 12);

/** 'x' plays, anything else rests. Sixteen steps to the bar. */
const hit = (pattern, step) => pattern[step % 16] === 'x';

/**
 * One track per backdrop, so what you hear matches what you are looking at.
 *
 *   root   midi note the bass sits on
 *   prog   chord root per bar, as a scale degree
 *   lead   sixteen slots of scale degrees above the bar's chord, or null
 *   arp    step interval for the arpeggio, or 0 for none
 */
export const TRACKS = {
  menu: {
    name: 'Shift Start', bpm: 96, root: 41, scale: DORIAN, prog: [0, 5, 3, 4],
    kick: 'x.......x.......', snare: '................', hat: '..x...x...x...x.',
    bass: 'x.......x...x...', arp: 4, pad: 0.10, leadGain: 0.07,
    lead: [4, null, null, 2, null, null, 1, null, 2, null, null, null, 0, null, null, null],
  },
  city: {
    name: 'Street Level', bpm: 140, root: 45, scale: MINOR, prog: [0, 0, 5, 4],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    bass: 'x..x..x.x..x..x.', arp: 2, pad: 0.06, leadGain: 0.09,
    lead: [0, null, 2, null, 4, null, 2, null, 3, null, 2, null, 0, null, null, null],
  },
  industrial: {
    name: 'Night Shift', bpm: 126, root: 40, scale: MINOR, prog: [0, 0, 3, 2],
    kick: 'x.....x.x.......', snare: '....x.......x...', hat: '..x...x...x...xx',
    bass: 'x...x.x.x...x.x.', arp: 0, pad: 0.08, leadGain: 0.08,
    lead: [0, null, null, null, 1, null, 0, null, null, null, 4, null, 2, null, null, null],
  },
  tower: {
    name: 'Up And Up', bpm: 132, root: 43, scale: DORIAN, prog: [0, 4, 5, 6],
    kick: 'x.......x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    bass: 'x...x...x...x...', arp: 2, pad: 0.07, leadGain: 0.08,
    lead: [0, null, 1, null, 2, null, 3, null, 4, null, 3, null, 2, null, null, null],
  },
  sky: {
    name: 'Open Air', bpm: 118, root: 48, scale: MAJOR, prog: [0, 3, 4, 3],
    kick: 'x.......x.......', snare: '............x...', hat: '....x.......x...',
    bass: 'x.....x.x.....x.', arp: 4, pad: 0.11, leadGain: 0.07,
    lead: [4, null, null, null, 2, null, 3, null, null, null, 1, null, 0, null, null, null],
  },
  space: {
    name: 'No Gravity', bpm: 108, root: 38, scale: MINOR, prog: [0, 6, 5, 6],
    kick: 'x...............', snare: '........x.......', hat: '..............x.',
    bass: 'x.......x.......', arp: 8, pad: 0.13, leadGain: 0.06,
    lead: [null, null, 4, null, null, null, null, null, 2, null, null, null, 1, null, null, null],
  },
  cyber: {
    name: 'Overclock', bpm: 152, root: 45, scale: DORIAN, prog: [0, 0, 2, 5],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx',
    bass: 'x.x.x.x.x.x.x.x.', arp: 1, pad: 0.05, leadGain: 0.09,
    lead: [0, null, 4, null, 3, null, 4, null, 2, null, 4, null, 1, null, 0, null],
  },
};

const LOOKAHEAD = 0.22;   // seconds of music queued ahead of the audio clock
const TICK_MS = 50;
// Set by measurement, not by ear: rendered offline, a track peaks near 0.07
// of full scale at 0.14, against about 0.11 for a jump effect. 0.18 brings the
// music close to the effects without ever coming over the top of them.
const FULL = 0.18;
const DUCKED = 0.035;
const SILENT = 0.0001;    // exponential ramps cannot reach zero

class MusicService {
  #ctx = null;
  #bus = null;
  #timer = null;
  #trackId = null;
  #step = 0;
  #nextTime = 0;
  #ducked = false;

  get enabled() {
    return profile.get().settings.music !== false;
  }

  /** The name of the track playing, for anything that wants to show it. */
  get nowPlaying() {
    return this.#trackId ? TRACKS[this.#trackId].name : null;
  }

  #ensure() {
    if (this.#bus) return true;
    // Share the sound effects' AudioContext: browsers cap how many a page may
    // open, and two would mean two clocks to keep in step.
    const handle = audio.bus(SILENT);
    if (!handle) return false;
    this.#ctx = handle.ctx;
    this.#bus = handle.node;
    return true;
  }

  #target() {
    if (!this.enabled || !this.#trackId) return SILENT;
    return this.#ducked ? DUCKED : FULL;
  }

  #fade(seconds = 0.4) {
    if (!this.#bus) return;
    const now = this.#ctx.currentTime;
    const gain = this.#bus.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(SILENT, gain.value), now);
    gain.exponentialRampToValueAtTime(this.#target(), now + seconds);
  }

  /**
   * Starts a track, or does nothing if it is already the one playing — so a
   * screen that re-renders does not restart the music under you.
   */
  play(id) {
    const trackId = TRACKS[id] ? id : 'city';
    if (this.#trackId === trackId && this.#timer) { this.#fade(); return; }
    if (!this.#ensure()) return;

    const changing = this.#trackId !== null && this.#trackId !== trackId;
    this.#trackId = trackId;
    this.#ducked = false;
    if (changing) this.#step = 0;      // a new track starts at the top of a bar
    this.#nextTime = Math.max(this.#nextTime, this.#ctx.currentTime + 0.08);
    this.#fade(changing ? 0.5 : 0.8);

    if (!this.#timer) {
      this.#timer = setInterval(() => this.#schedule(), TICK_MS);
      this.#schedule();
    }
  }

  /** The track a level plays, matched to its backdrop. */
  playForBackdrop(name) { this.play(TRACKS[name] ? name : 'city'); }

  menu() { this.play('menu'); }

  /** Pausing drops the music back rather than cutting it, which reads better. */
  setDucked(ducked) {
    if (this.#ducked === ducked) return;
    this.#ducked = ducked;
    this.#fade(0.25);
  }

  stop() {
    this.#trackId = null;
    this.#fade(0.35);
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null; }
  }

  /** Called when the setting changes, so it takes effect without a reload. */
  refresh() {
    if (this.enabled && this.#trackId && !this.#timer) {
      this.#timer = setInterval(() => this.#schedule(), TICK_MS);
    }
    this.#fade(0.3);
  }

  #schedule() {
    if (!this.#bus || !this.#trackId) return;
    const ctx = this.#ctx;
    // The context starts suspended until a gesture. Keep the timer alive and
    // idle rather than giving up, so music begins the moment it resumes.
    if (ctx.state !== 'running' || !this.enabled) {
      this.#nextTime = ctx.currentTime;
      return;
    }

    const track = TRACKS[this.#trackId];
    const stepLength = 60 / track.bpm / 4;

    // A hidden tab throttles timers to about once a second, which would leave
    // a gap; skip forward rather than frantically scheduling the past.
    if (this.#nextTime < ctx.currentTime - 0.5) this.#nextTime = ctx.currentTime + 0.05;

    while (this.#nextTime < ctx.currentTime + LOOKAHEAD) {
      this.#scheduleStep(track, this.#step, this.#nextTime, stepLength);
      this.#step = (this.#step + 1) % (16 * track.prog.length);
      this.#nextTime += stepLength;
    }
  }

  #scheduleStep(track, step, when, stepLength) {
    const bar = Math.floor(step / 16) % track.prog.length;
    const s = step % 16;
    const chord = track.prog[bar];
    const rootMidi = track.root + degree(track.scale, chord);
    // A chord tone, as semitones above this bar's root.
    const above = offset => degree(track.scale, chord + offset) - degree(track.scale, chord);

    if (hit(track.bass, s)) {
      this.#voice(rootMidi, when, stepLength * 1.6, 'triangle', 0.34);
    }

    // The pad lands once a bar and holds under everything else.
    if (s === 0 && track.pad) {
      for (const offset of [0, 2, 4]) {
        this.#voice(rootMidi + 12 + above(offset), when, stepLength * 15, 'sine', track.pad);
      }
    }

    if (track.arp && s % track.arp === 0) {
      const tone = [0, 2, 4, 2][Math.floor(s / track.arp) % 4];
      this.#voice(rootMidi + 24 + above(tone), when, stepLength * 0.8, 'square', 0.05);
    }

    const note = track.lead[s];
    if (note != null) {
      this.#voice(rootMidi + 24 + above(note), when, stepLength * 1.8, 'square', track.leadGain);
    }

    if (hit(track.kick, s)) this.#kick(when);
    if (hit(track.snare, s)) this.#snare(when);
    if (hit(track.hat, s)) this.#hat(when);
  }

  #voice(midi, when, duration, type, gain) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq(midi), when);
    env.gain.setValueAtTime(SILENT, when);
    env.gain.exponentialRampToValueAtTime(gain, when + 0.012);
    env.gain.exponentialRampToValueAtTime(SILENT, when + duration);
    osc.connect(env).connect(this.#bus);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  #kick(when) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.11);
    env.gain.setValueAtTime(0.5, when);
    env.gain.exponentialRampToValueAtTime(SILENT, when + 0.14);
    osc.connect(env).connect(this.#bus);
    osc.start(when);
    osc.stop(when + 0.16);
  }

  #snare(when) { this.#noise(when, 0.14, 0.22, 1800); }
  #hat(when) { this.#noise(when, 0.035, 0.08, 7000); }

  #noise(when, duration, gain, highpass) {
    const ctx = this.#ctx;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    env.gain.value = gain;
    source.connect(filter).connect(env).connect(this.#bus);
    source.start(when);
  }
}

export const music = new MusicService();
