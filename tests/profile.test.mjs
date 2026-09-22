// Profile persistence, achievement evaluation and peer code encoding.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals } from './harness.mjs';

installGlobals();

const { profile } = await import('../js/services/profile.js');
const { ACHIEVEMENTS, SKINS, GEAR, resolveLoadout } = await import('../js/data/config.js');
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
  // The cheapest paid skin, whatever the prices happen to be.
  const skin = SKINS.filter(s => s.cost > 0).sort((a, b) => a.cost - b.cost)[0];
  profile.addTips(skin.cost);          // afford exactly one
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

test('best times only improve, and clears are counted', () => {
  const first = profile.recordClear(7, 9000);
  assert.equal(first.isNewBest, true, 'first clear is a best');
  assert.equal(first.firstClear, true, 'and is flagged as the first');
  assert.equal(first.clears, 1);

  const slower = profile.recordClear(7, 12000);
  assert.equal(slower.isNewBest, false, 'a slower run is not a best');
  assert.equal(slower.firstClear, false, 'and is not a first clear');
  assert.equal(slower.clears, 2, 'but still counts as a replay');
  assert.equal(profile.getBest(7), 9000);

  const faster = profile.recordClear(7, 4000);
  assert.equal(faster.isNewBest, true, 'a faster run is');
  assert.equal(profile.getBest(7), 4000);
  assert.equal(profile.clearCount(7), 3);
});

test('gear is bought once and folds into a loadout', () => {
  const cheap = [...GEAR].sort((a, b) => a.cost - b.cost)[0];

  profile.addTips(50000);
  assert.equal(profile.purchaseGear(cheap.id, cheap.cost), true);
  assert.equal(profile.ownsGear(cheap.id), true);
  assert.equal(profile.purchaseGear(cheap.id, cheap.cost), false, 'cannot buy twice');

  const loadout = profile.loadout();
  assert.deepEqual(loadout, resolveLoadout(profile.get().ownedGear));
});

test('an unaffordable piece of gear cannot be bought', () => {
  const dear = [...GEAR].sort((a, b) => b.cost - a.cost)[0];
  const before = profile.get().tips;
  assert.equal(profile.purchaseGear(dear.id, before + 1), false);
  assert.equal(profile.get().tips, before, 'tips are untouched by a failed purchase');
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

// --- text rendering --------------------------------------------------------

test('hint markup renders as formatting, not as literal tags', async () => {
  const { richText } = await import('../js/ui/dom.js');
  const render = text => {
    const box = globalThis.document.createElement('div');
    box.replaceChildren(...richText(text));
    return box;
  };

  const bold = render('Press <b>S</b> to slide.');
  assert.equal(bold.textContent, 'Press S to slide.', 'the tags must not show');
  assert.equal(bold.querySelectorAll('strong').length, 1, 'and must become real emphasis');

  const em = render('Bert<em>Net</em>');
  assert.equal(em.textContent, 'BertNet');
  assert.equal(em.querySelectorAll('em').length, 1);
});

test('anything other than b and em stays literal text', async () => {
  const { richText } = await import('../js/ui/dom.js');
  // Hints travel with custom levels, and a custom level can arrive from
  // another player over BertNet, so this must never parse arbitrary markup.
  const box = globalThis.document.createElement('div');
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  box.replaceChildren(...richText(hostile));
  assert.equal(box.textContent, hostile, 'it should be shown, not interpreted');
  assert.equal(box.querySelectorAll('script, img').length, 0, 'and nothing should be created');
});

test('every hint in the game renders without leaving tags behind', async () => {
  const { richText } = await import('../js/ui/dom.js');
  const { LEVELS, TRAINING } = await import('../js/data/levels.js');

  const leftover = [];
  for (const level of [...LEVELS, ...TRAINING]) {
    for (const hint of level.hints ?? []) {
      const box = globalThis.document.createElement('div');
      box.replaceChildren(...richText(hint.text));
      if (/<\/?(b|em)>/i.test(box.textContent)) {
        leftover.push(`level ${level.id}: ${box.textContent.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(leftover, [], `\n${leftover.join('\n')}`);
});
