import io

# ---------------------------------------------------------------- screens.js
p = 'js/ui/screens.js'
s = io.open(p, encoding='utf-8').read()

old = "// --- workshop --------------------------------------------------------------"
new = '''// --- replays ---------------------------------------------------------------

/**
 * Every best run you have saved, to watch back.
 *
 * These are the same tracks the in-level ghost races you against, so a best
 * time is recorded once and serves both.
 */
export function renderReplays(app) {
  const p = profile.get();
  const saved = listGhosts();

  const named = id => {
    const level = LEVELS.find(l => String(l.id) === id);
    if (level) return { title: level.title, label: `Level ${level.id}` };
    const lesson = TRAINING.find(t => t.id === id);
    if (lesson) return { title: lesson.title, label: 'Training' };
    const custom = p.customLevels.find(c => c.id === id);
    if (custom) return { title: custom.title || 'Untitled', label: 'Custom' };
    return null;
  };

  const rows = saved
    .map(id => ({ id, ...named(id), best: p.bestLevelTimes[id] }))
    .filter(row => row.title)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)) || a.title.localeCompare(b.title))
    .map(row => el('button.replay-row', {
      onclick: () => { audio.click(); app.watchReplay(row.id); },
    }, [
      el('div.replay-row__body', [
        el('span.replay-row__title', row.title),
        el('span.replay-row__where', row.label),
      ]),
      el('span.replay-row__time', row.best != null ? formatTime(row.best) : '—'),
      el('span.replay-row__play', '▶'),
    ]));

  return el('div.screen', [
    el('div.panel', [
      el('header.panel__head', [
        el('h2.panel__title', 'Replays'),
        el('button.btn.btn--ghost', { onclick: () => app.show('menu') }, 'Back'),
      ]),
      el('div.panel__body', [
        el('p.hub__note', rows.length
          ? 'Your best run on each level, saved as you set it. These are the same '
            + 'runs the ghost races you against while you play.'
          : 'Nothing here yet. Finish a level and your best run is kept, to watch '
            + 'back here and to race as a ghost while you play.'),
        rows.length ? el('div.replays', rows) : null,
      ]),
    ]),
  ]);
}

// --- workshop --------------------------------------------------------------'''
assert old in s
s = s.replace(old, new, 1)

old = "        tile('Training', `${TRAINING.length} lessons`, () => app.show('training')),"
new = """        tile('Training', `${TRAINING.length} lessons`, () => app.show('training')),
        tile('Replays', `${listGhosts().length} saved`, () => app.show('replays')),"""
assert old in s
s = s.replace(old, new, 1)

old = "import { profile } from '../services/profile.js';"
assert old in s
s = s.replace(old, old + "\nimport { listGhosts } from '../services/ghost.js';", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------------------------------------------------------------- main.js
p = 'js/main.js'
s = io.open(p, encoding='utf-8').read()

s = s.replace(
  "import { renderMenu, renderLevelSelect, renderTraining, renderWorkshop, renderResult, openPause } from './ui/screens.js';",
  "import { renderMenu, renderLevelSelect, renderTraining, renderWorkshop, renderReplays, renderResult, openPause } from './ui/screens.js';",
  1)
s = s.replace(
  "import { encodeGhost, saveGhost, loadGhost } from './services/ghost.js';",
  "import { encodeGhost, saveGhost, loadGhost, ghostToReel } from './services/ghost.js';",
  1)

old = "    else if (this.screen === 'training') view = renderTraining(this);"
new = """    else if (this.screen === 'training') view = renderTraining(this);
    else if (this.screen === 'replays') view = renderReplays(this);"""
assert old in s
s = s.replace(old, new, 1)

old = "  // --- editor --------------------------------------------------------------"
new = '''  /** Plays back the saved best run for a level. */
  watchReplay(levelId) {
    const ghost = loadGhost(levelId);
    const reel = ghostToReel(ghost);
    if (!reel) { toast('That replay could not be read', { tone: 'warn' }); return; }

    const level = LEVELS.find(l => String(l.id) === String(levelId))
      ?? TRAINING.find(t => t.id === levelId)
      ?? profile.get().customLevels.find(c => c.id === levelId);
    if (!level) { toast('That level is gone', { tone: 'warn' }); return; }

    this.#teardownGame();
    const p = profile.get();
    const skin = SKINS.find(s => s.id === p.equippedSkin) ?? SKINS[0];

    const player = new ReplayReel({
      level,
      skin,
      reel,
      result: { timeMs: p.bestLevelTimes[String(levelId)] ?? 0 },
      reducedFlash: p.settings.reducedFlash === true,
      // Saved runs are kept at 30Hz to fit in storage; playing them a frame at
      // a time would run the level at double speed.
      speed: (reel.rate ?? 30) / 60,
      label: 'BEST RUN',
      onDone: () => this.show('replays'),
    });
    this.reel = player;
    this.screen = 'replay';
    this.#unbindResultKeys();
    this.root.replaceChildren(el('div.screen.screen--play', [player.root]));
    player.start();
  }

  // --- editor --------------------------------------------------------------'''
assert old in s
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('replays screen wired')
