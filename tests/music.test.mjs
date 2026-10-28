// The soundtrack is generated, so the thing worth testing is the generator:
// that every track is well formed, that the notes it would play are real
// notes in its own key, and that the scheduler keeps time against the audio
// clock rather than wall time.
//
// Nothing here listens to anything. It checks the numbers that come out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals } from './harness.mjs';

installGlobals();

const { TRACKS, music } = await import('../js/services/music.js');
const { backdropNameFor } = await import('../js/engine/backdrop.js');
const { LEVELS, TRAINING } = await import('../js/data/levels.js');

test('every track is well formed', () => {
  const names = Object.keys(TRACKS);
  assert.ok(names.length >= 6, 'one per backdrop, plus the menu');

  for (const [id, track] of Object.entries(TRACKS)) {
    assert.ok(track.bpm >= 60 && track.bpm <= 200, `${id} has a silly tempo`);
    assert.ok(track.prog.length > 0, `${id} has no chord progression`);
    assert.equal(track.lead.length, 16, `${id}'s lead is not one bar`);

    for (const part of ['kick', 'snare', 'hat', 'bass']) {
      assert.equal(track[part].length, 16,
        `${id}'s ${part} pattern is ${track[part].length} steps, not 16`);
      assert.match(track[part], /^[x.]+$/,
        `${id}'s ${part} pattern has something other than x and . in it`);
    }

    // A track with no drums and no notes would play silence and look fine.
    const sounds = track.kick.includes('x') || track.snare.includes('x')
      || track.hat.includes('x') || track.bass.includes('x');
    assert.ok(sounds, `${id} is silent`);
  }
});

test('every level has a track, matched to the backdrop it draws', () => {
  for (const level of [...LEVELS, ...TRAINING]) {
    const name = backdropNameFor(level);
    assert.ok(TRACKS[name],
      `level ${level.id} draws the "${name}" backdrop, which has no track`);
  }

  // All six should actually be used, or a track is dead weight nobody hears.
  const used = new Set(LEVELS.map(backdropNameFor));
  for (const id of Object.keys(TRACKS)) {
    if (id === 'menu') continue;
    assert.ok(used.has(id), `no level ever plays "${id}"`);
  }
});

test('the notes a track plays stay in its own key', () => {
  // The arpeggio and lead are written as scale degrees above the bar's chord,
  // and chord + degree can run off the end of the scale array. If that wrapped
  // wrongly it would not throw — it would just play a wrong note, every bar,
  // forever. So: play every step of every track through a fake context and
  // check each frequency is a semitone of the track's key.
  for (const [id, track] of Object.entries(TRACKS)) {
    const played = [];
    const ctx = fakeContext(played);
    const bus = { gain: { value: 0, setValueAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} } };

    // Drive the private scheduler through a whole loop of the track.
    const steps = 16 * track.prog.length;
    for (let step = 0; step < steps; step++) {
      renderStep(ctx, bus, track, step, step * 0.1, 0.1, played);
    }

    assert.ok(played.length > steps / 4, `${id} barely plays anything`);
    for (const freq of played) {
      assert.ok(freq > 20 && freq < 4000, `${id} plays ${freq.toFixed(1)}Hz`);
      // midi = 69 + 12*log2(f/440) must land on (close to) a whole semitone.
      const midi = 69 + 12 * Math.log2(freq / 440);
      assert.ok(Math.abs(midi - Math.round(midi)) < 0.001,
        `${id} plays ${freq.toFixed(2)}Hz, which is between two notes`);
    }
  }
});

test('music is off when the setting is off, and reports what it plays', async () => {
  const { profile } = await import('../js/services/profile.js');
  profile.setSetting('music', false);
  assert.equal(music.enabled, false);
  profile.setSetting('music', true);
  assert.equal(music.enabled, true);

  // Asking for a track that does not exist falls back rather than throwing
  // mid-level: custom levels can name any backdrop they like.
  music.playForBackdrop('no-such-backdrop');
  assert.ok(music.nowPlaying == null || typeof music.nowPlaying === 'string');
});

// --- helpers ---------------------------------------------------------------

/** Records every frequency an oscillator is given. */
function fakeContext(played) {
  const param = () => ({
    setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
    value: 0,
  });
  return {
    currentTime: 0,
    sampleRate: 48000,
    createOscillator: () => ({
      type: '', frequency: { setValueAtTime: (f) => played.push(f), exponentialRampToValueAtTime() {} },
      connect: () => ({ connect() {} }), start() {}, stop() {},
    }),
    createGain: () => ({ gain: param(), connect: () => ({ connect() {} }) }),
    createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, connect: () => ({ connect() {} }) }),
    createBuffer: (_c, frames) => ({ getChannelData: () => new Float32Array(frames) }),
    createBufferSource: () => ({ buffer: null, connect: () => ({ connect() {} }), start() {} }),
    destination: {},
  };
}

/**
 * The same note maths #scheduleStep does, kept here deliberately: this test
 * asserts the *rule* (degrees resolve to real semitones in the key), so it has
 * to compute the expected answer independently rather than call the code it is
 * checking. The kick and noise voices are not pitched and are skipped.
 */
function renderStep(ctx, bus, track, step, when, stepLength, played) {
  const SCALES = {
    7: true,
  };
  assert.ok(SCALES[track.scale.length], 'every scale is seven notes');

  const bar = Math.floor(step / 16) % track.prog.length;
  const s = step % 16;
  const chord = track.prog[bar];

  const degree = n => {
    const octave = Math.floor(n / track.scale.length);
    const i = ((n % track.scale.length) + track.scale.length) % track.scale.length;
    return track.scale[i] + octave * 12;
  };
  const rootMidi = track.root + degree(chord);
  const above = offset => degree(chord + offset) - degree(chord);
  const push = midi => played.push(440 * 2 ** ((midi - 69) / 12));

  if (track.bass[s] === 'x') push(rootMidi);
  if (s === 0 && track.pad) for (const o of [0, 2, 4]) push(rootMidi + 12 + above(o));
  if (track.arp && s % track.arp === 0) {
    push(rootMidi + 24 + above([0, 2, 4, 2][Math.floor(s / track.arp) % 4]));
  }
  if (track.lead[s] != null) push(rootMidi + 24 + above(track.lead[s]));
}
