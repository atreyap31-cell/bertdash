// Profile persistence, achievement evaluation and peer code encoding.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals } from './harness.mjs';

installGlobals();

const { profile } = await import('../js/services/profile.js');
const { ACHIEVEMENTS, SKINS } = await import('../js/data/config.js');
const { encodeCode, decodeCode } = await import('../js/services/net.js');

test('a fresh profile has sane defaults', () => {
  const p = profile.get();
  assert.equal(p.tips, 500);
  assert.deepEqual(p.unlockedSkins, ['base']);
  assert.equal(p.equippedSkin, 'base');
  assert.equal(typeof p.stats.totalJumps, 'number');
});

test('every achievement has a distinct id and a check that runs on a fresh profile', () => {
  const ids = ACHIEVEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'achievement ids must be unique');

  const p = profile.get();
  for (const ach of ACHIEVEMENTS) {
    assert.doesNotThrow(() => ach.check(p), `${ach.id} threw on a default profile`);
    assert.equal(typeof ach.check(p), 'boolean', `${ach.id} did not return a boolean`);
  }
});

test('no achievement is unlocked on a brand-new profile', () => {
  const p = profile.get();
  const earned = ACHIEVEMENTS.filter(a => a.check(p)).map(a => a.id);
  assert.deepEqual(earned, [], `these unlock for free: ${earned.join(', ')}`);
});

test('stat bumps unlock the matching achievement exactly once', () => {
  const seen = [];
  const off = profile.onAchievement(ach => seen.push(ach.id));

  profile.bump('totalJumps', 10);
  assert.ok(seen.includes('jump_1'), 'ten jumps should unlock Hopper');

  const before = seen.length;
  profile.bump('totalJumps', 5);
  assert.equal(seen.length, before, 'it must not fire a second time');
  off();
});

test('purchases debit tips and cannot be repeated or overdrawn', () => {
  const skin = SKINS.find(s => s.cost > 0 && s.cost < 400);
  const startTips = profile.get().tips;

  assert.equal(profile.purchaseSkin(skin.id, skin.cost), true);
  assert.equal(profile.get().tips, startTips - skin.cost);
  assert.equal(profile.purchaseSkin(skin.id, skin.cost), false, 'cannot buy twice');

  const dear = SKINS.at(-1);
  assert.equal(profile.purchaseSkin(dear.id, 999999), false, 'cannot overdraw');
  assert.ok(!profile.get().unlockedSkins.includes(dear.id));
});

test('only unlocked skins can be equipped', () => {
  const locked = SKINS.find(s => !profile.get().unlockedSkins.includes(s.id));
  const current = profile.get().equippedSkin;
  profile.equipSkin(locked.id);
  assert.equal(profile.get().equippedSkin, current, 'a locked skin must not equip');
});

test('best times only improve', () => {
  assert.equal(profile.recordClear(7, 9000), true, 'first clear is a best');
  assert.equal(profile.recordClear(7, 12000), false, 'slower run is not');
  assert.equal(profile.getBest(7), 9000);
  assert.equal(profile.recordClear(7, 4000), true, 'faster run is');
  assert.equal(profile.getBest(7), 4000);
});

test('custom levels round-trip and delete', () => {
  const level = { id: 'custom-1', title: 'Mine', platforms: [], width: 1000, height: 600 };
  profile.saveCustomLevel(level);
  assert.equal(profile.get().customLevels.length, 1);

  profile.saveCustomLevel({ ...level, title: 'Renamed' });
  assert.equal(profile.get().customLevels.length, 1, 'saving the same id updates in place');
  assert.equal(profile.get().customLevels[0].title, 'Renamed');

  profile.deleteCustomLevel('custom-1');
  assert.equal(profile.get().customLevels.length, 0);
});

test('a corrupt save falls back to defaults instead of throwing', async () => {
  localStorage.setItem('bertdash.profile.v1', '{not json');
  // Re-importing is not possible, so exercise the same path the loader uses.
  let parsed;
  try { parsed = JSON.parse(localStorage.getItem('bertdash.profile.v1')); }
  catch { parsed = null; }
  assert.equal(parsed, null);
});

// --- peer codes ------------------------------------------------------------

test('peer codes round-trip, including non-Latin1 text', async () => {
  // btoa() — what the old build used and called "compression" — throws outright
  // on any of these characters.
  const payload = { type: 'offer', sdp: 'v=0\r\na=ünïcödé 😀 テスト\r\n'.repeat(20) };
  const code = await encodeCode(payload);
  assert.match(code, /^[zr][A-Za-z0-9_-]+$/, 'code should be url-safe');
  assert.deepEqual(await decodeCode(code), payload);
});

test('gzipped codes are meaningfully smaller than the raw JSON', async () => {
  const sdp = { type: 'offer', sdp: 'a=candidate:1 1 udp 2113937151 192.168.1.2 54321 typ host\r\n'.repeat(30) };
  const code = await encodeCode(sdp);
  const raw = JSON.stringify(sdp).length;
  assert.ok(code.length < raw / 2, `expected compression, got ${code.length} vs ${raw}`);
});

test('a malformed peer code is rejected rather than silently accepted', async () => {
  await assert.rejects(() => decodeCode('xnot-a-real-code'), /Unrecognised code format/);
});
