// App shell: owns the current screen, the running game and the transitions
// between them.

import { el, toast, formatTime } from './ui/dom.js';
import { renderMenu, renderLevelSelect, renderWorkshop, renderResult, openPause } from './ui/screens.js';
import { Hud } from './ui/hud.js';
import { Editor } from './ui/editor.js';
import { Game } from './engine/game.js';
import { computeParTime, starsForTime } from './engine/level.js';
import { LEVELS } from './data/levels.js';
import { SKINS, VIEW_W, VIEW_H } from './data/config.js';
import { profile } from './services/profile.js';
import { audio } from './services/audio.js';

class App {
  constructor(root) {
    this.root = root;
    this.screen = 'menu';
    this.game = null;
    this.hud = null;
    this.editor = null;
    this.pauseDialog = null;
    this.current = null;   // { level, index, isCustom }
    this.lastResult = null;
    this.hudRaf = null;
    this.sessionStart = performance.now();

    profile.onAchievement(ach => {
      audio.achievement();
      toast(ach.title, { icon: ach.icon, tone: 'good', duration: 3200 });
    });

    // R restarts, but only while a level is actually running.
    addEventListener('keydown', event => {
      if (event.code === 'KeyR' && this.game && !this.pauseDialog && !event.repeat) {
        const typing = document.activeElement?.matches('input, textarea');
        if (!typing) this.retry();
      }
    });

    // Bank play time when the tab goes away.
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.#bankPlayTime();
      else this.sessionStart = performance.now();
    });
    addEventListener('pagehide', () => this.#bankPlayTime());
  }

  #bankPlayTime() {
    const now = performance.now();
    const delta = now - this.sessionStart;
    this.sessionStart = now;
    if (delta > 1000) profile.bump('playTimeMs', Math.round(delta));
  }

  // --- screen management ---------------------------------------------------

  show(screen) {
    this.#teardownGame();
    this.#teardownEditor();
    this.screen = screen;
    this.#paint();
  }

  refreshIfMenu() {
    if (this.screen === 'menu') this.#paint();
  }

  #paint() {
    let view;
    if (this.screen === 'menu') view = renderMenu(this);
    else if (this.screen === 'levels') view = renderLevelSelect(this);
    else if (this.screen === 'workshop') view = renderWorkshop(this);
    else if (this.screen === 'result') view = renderResult(this, this.lastResult);
    else view = renderMenu(this);

    this.root.replaceChildren(view);
  }

  // --- playing -------------------------------------------------------------

  startCampaign() {
    const p = profile.get();
    // Resume at the first level you haven't cleared.
    let next = 1;
    while (next < LEVELS.length && p.bestLevelTimes[String(next)] != null) next++;
    this.play(next >= LEVELS.length ? 1 : next);
  }

  play(index) {
    const level = LEVELS[index];
    if (!level) { this.show('menu'); return; }
    this.#launch({ level, index, isCustom: false });
  }

  playCustom(level) {
    this.#launch({ level, index: null, isCustom: true });
  }

  playNext() {
    if (!this.current || this.current.isCustom) return this.show('menu');
    this.play(this.current.index + 1);
  }

  retry() {
    if (!this.current) return this.show('menu');
    this.#launch(this.current);
  }

  #launch(target) {
    this.#teardownGame();
    this.#teardownEditor();
    this.current = target;
    this.screen = 'playing';

    const p = profile.get();
    const skin = SKINS.find(s => s.id === p.equippedSkin) ?? SKINS[0];
    const levelId = target.isCustom ? target.level.id : target.index;

    profile.recordAttempt(levelId);

    const canvas = el('canvas.stage__canvas', {
      width: VIEW_W,
      height: VIEW_H,
      tabIndex: 0,
      'aria-label': `${target.level.title} play area`,
    });

    const game = new Game(canvas, target.level, {
      skin,
      reducedFlash: p.settings.reducedFlash === true,
      onWin: result => this.#handleWin(result),
      onLose: reason => this.#handleLose(reason),
      onStats: batch => batch.forEach((amount, key) => profile.bump(key, amount)),
      onPauseRequest: () => this.togglePause(),
    });

    const hud = new Hud({
      levelLabel: target.isCustom ? 'Custom' : `${target.index}/33`,
      levelTitle: target.level.title,
      parTime: game.level.parTime,
      best: profile.getBest(levelId),
      onRestart: () => this.retry(),
      onMenu: () => this.show('menu'),
      onPause: () => this.togglePause(),
    });

    this.game = game;
    this.hud = hud;

    this.root.replaceChildren(el('div.screen.screen--play', [
      el('div.stage', [canvas, hud.root]),
    ]));

    canvas.focus();
    game.start();

    // HUD updates ride their own rAF so the engine never touches the DOM.
    const tick = () => {
      if (this.game !== game) return;
      hud.update(game.getHudState());
      this.hudRaf = requestAnimationFrame(tick);
    };
    this.hudRaf = requestAnimationFrame(tick);
  }

  togglePause() {
    if (!this.game) return;
    if (this.pauseDialog) { this.pauseDialog.close(); return; }

    this.game.setPaused(true);
    this.pauseDialog = openPause({
      onResume: () => {
        this.pauseDialog = null;
        this.game?.setPaused(false);
      },
      onRestart: () => { this.pauseDialog = null; this.retry(); },
      onMenu: () => { this.pauseDialog = null; this.show('menu'); },
    });
  }

  #handleWin({ timeMs, clutch }) {
    const target = this.current;
    const parTime = this.game.level.parTime;
    const stars = starsForTime(timeMs / 1000, parTime);
    const levelId = target.isCustom ? target.level.id : target.index;

    const reward = stars * 10 + (target.isCustom ? 0 : target.index * 2);
    profile.addTips(reward);

    const isNewBest = profile.recordClear(levelId, timeMs);

    if (target.isCustom) {
      profile.bump('customCleared');
    } else {
      // Only count a level towards "cleared" the first time.
      if (profile.getAttempts(levelId) >= 1 && isNewBest && profile.getBest(levelId) === timeMs) {
        profile.bump('levelsCleared');
      }
      if (this.game.level.theme === 'vertical') profile.bump('verticalCleared');
    }
    if (stars === 5) profile.bump('fiveStars');
    if (clutch) profile.bump('clutchDeliveries');
    if (profile.getAttempts(levelId) >= 6) profile.bump('comebacks');

    this.lastResult = {
      outcome: 'win',
      stars,
      timeMs,
      parTime,
      reward,
      isNewBest,
      hasNext: !target.isCustom && target.index + 1 < LEVELS.length,
    };

    if (isNewBest) toast(`New best: ${formatTime(timeMs)}`, { icon: '★', tone: 'good' });

    this.#teardownGame();
    this.screen = 'result';
    this.#paint();
  }

  #handleLose(reason) {
    this.lastResult = {
      outcome: 'lose',
      reason,
      timeMs: this.game?.elapsed ?? 0,
      parTime: this.game?.level.parTime ?? 0,
    };
    this.#teardownGame();
    this.screen = 'result';
    this.#paint();
  }

  // --- editor --------------------------------------------------------------

  openEditor(existing) {
    this.#teardownGame();
    this.#teardownEditor();
    this.screen = 'editor';

    this.editor = new Editor(existing, {
      onClose: () => this.show('workshop'),
      onTest: level => this.playCustom(level),
    });
    this.root.replaceChildren(this.editor.root);
  }

  // --- teardown ------------------------------------------------------------

  #teardownGame() {
    if (this.hudRaf !== null) cancelAnimationFrame(this.hudRaf);
    this.hudRaf = null;
    this.pauseDialog?.close();
    this.pauseDialog = null;
    this.game?.destroy();
    this.game = null;
    this.hud?.destroy();
    this.hud = null;
    this.#bankPlayTime();
  }

  #teardownEditor() {
    this.editor?.destroy();
    this.editor = null;
  }
}

// --- boot ------------------------------------------------------------------

const root = document.getElementById('app');
const app = new App(root);

// Par times are derived from level geometry; warn in dev if any level is
// mis-authored badly enough to produce a nonsense target.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  const broken = LEVELS.filter(level => !Number.isFinite(computeParTime(level)));
  if (broken.length) console.warn('Levels with invalid par time:', broken.map(l => l.id));
}

app.show('menu');
document.body.classList.remove('is-booting');

// Any click anywhere is enough of a gesture to let WebAudio start.
addEventListener('pointerdown', () => audio.unlock(), { once: true });
