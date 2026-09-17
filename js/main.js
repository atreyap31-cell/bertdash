// App shell: owns the current screen, the running game and the transitions
// between them.

import { el, toast, formatTime } from './ui/dom.js';
import { renderMenu, renderLevelSelect, renderWorkshop, renderResult, openPause } from './ui/screens.js';
import { Hud } from './ui/hud.js';
import { InputDisplay } from './ui/inputs.js';
import { Editor } from './ui/editor.js';
import { Game } from './engine/game.js';
import { computeParTime, starsForTime } from './engine/level.js';
import { LEVELS, CAMPAIGN_LENGTH } from './data/levels.js';
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

    // Speedrun state. A run is a single attempt at the whole campaign: it
    // starts on level 1, accumulates each level's clock, and ends when you
    // finish the last level or leave the campaign.
    this.run = null;

    profile.onAchievement(ach => {
      audio.achievement();
      toast(ach.title, { icon: ach.icon, tone: 'good', duration: 3200 });
    });

    // R restarts, but only while a level is actually running.
    addEventListener('keydown', event => {
      if (profile.bindings().restart.includes(event.code)
          && this.game && !this.pauseDialog && !event.repeat) {
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
    // Leaving the game for anywhere but the results ends a run.
    if (this.run && screen !== 'result') this.endRun('Speedrun ended \u2014 you left the campaign');
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
    if (p.settings.speedrun) {
      // A speedrun always starts from the top, whatever you have cleared.
      this.startRun();
      return;
    }
    // Otherwise resume at the first level you haven't cleared.
    let next = 1;
    while (next < LEVELS.length && p.bestLevelTimes[String(next)] != null) next++;
    this.play(next >= LEVELS.length ? 1 : next);
  }

  /** Begins a fresh timed run of the whole campaign. */
  startRun() {
    this.run = { totalMs: 0, levels: 0, startedAt: Date.now() };
    toast('Speedrun started \u2014 level 1 to ' + CAMPAIGN_LENGTH, { icon: '\u23F1', duration: 2600 });
    this.play(1);
  }

  endRun(reason) {
    if (!this.run) return;
    this.run = null;
    if (reason) toast(reason, { duration: 2200 });
  }

  play(index) {
    const level = LEVELS[index];
    if (!level) { this.show('menu'); return; }
    // Jumping to an arbitrary level abandons any run in progress.
    if (this.run && index !== (this.current ? this.current.index + 1 : 1)) {
      this.endRun('Speedrun ended \u2014 you left the run order');
    }
    this.#launch({ level, index, isCustom: false });
  }

  playCustom(level) {
    this.endRun();
    this.#launch({ level, index: null, isCustom: true });
  }

  playNext() {
    if (!this.current || this.current.isCustom) return this.show('menu');
    this.play(this.current.index + 1);
  }

  retry() {
    if (!this.current) return this.show('menu');
    if (this.run) this.endRun('Speedrun ended \u2014 level restarted');
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
      loadout: profile.loadout(),
      bindings: profile.bindings(),
      reducedFlash: p.settings.reducedFlash === true,
      onWin: result => this.#handleWin(result),
      onLose: reason => this.#handleLose(reason),
      onStats: batch => batch.forEach((amount, key) => profile.bump(key, amount)),
      onPauseRequest: () => this.togglePause(),
    });

    const hud = new Hud({
      runTotalMs: this.run ? this.run.totalMs : null,
      levelLabel: target.isCustom ? 'Custom' : `${target.index}/${CAMPAIGN_LENGTH}`,
      levelTitle: target.level.title,
      parTime: game.level.parTime,
      best: profile.getBest(levelId),
      onRestart: () => this.retry(),
      onMenu: () => this.show('menu'),
      onPause: () => this.togglePause(),
    });

    this.game = game;
    this.hud = hud;

    // Optional on-screen input display.
    const inputs = p.settings.showInputs ? new InputDisplay(profile.bindings()) : null;
    this.inputs = inputs;

    this.root.replaceChildren(el('div.screen.screen--play', [
      el('div.stage', [canvas, hud.root, inputs?.root].filter(Boolean)),
    ]));

    canvas.focus();
    game.start();

    // HUD updates ride their own rAF so the engine never touches the DOM.
    const tick = () => {
      if (this.game !== game) return;
      const state = game.getHudState();
      hud.update(state);
      inputs?.update(game.getHeldKeys());
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

  #handleWin({ timeMs, clutch, bestFlow, flowMultiplier, flowEvents }) {
    const target = this.current;
    const parTime = this.game.level.parTime;
    const stars = starsForTime(timeMs / 1000, parTime);
    const levelId = target.isCustom ? target.level.id : target.index;
    const loadout = profile.loadout();

    const { isNewBest, firstClear, clears } = profile.recordClear(levelId, timeMs);

    // --- payout -------------------------------------------------------------
    // Tips are a first-clear reward that scales with how far into the campaign
    // you are. Replays pay a small fraction, so grinding level 1 cannot fund
    // the store — beating your own time is the only reason to go back.
    const difficulty = target.isCustom ? 6 : 4 + target.index * 1.6;
    const base = stars * difficulty;

    let reward;
    let payoutNote;
    if (target.isCustom) {
      reward = Math.round(base * 0.25);
      payoutNote = 'Custom level';
    } else if (firstClear) {
      reward = Math.round(base);
      payoutNote = 'First delivery';
    } else {
      // Repeat runs taper off further the more you have replayed a level.
      const taper = Math.max(0.05, 0.3 / Math.sqrt(clears));
      reward = Math.round(base * taper) + (isNewBest ? Math.round(base * 0.35) : 0);
      payoutNote = isNewBest ? 'New record bonus' : `Repeat run (×${taper.toFixed(2)})`;
    }

    // Flow multiplies whatever you earned, so moving well pays more than
    // grinding does.
    const flowBonus = Math.round(reward * (flowMultiplier - 1));
    reward = Math.round((reward + flowBonus) * loadout.tips);
    profile.addTips(reward);
    profile.recordFlow(bestFlow);

    if (target.isCustom) {
      profile.bump('customCleared');
    } else {
      if (firstClear) profile.bump('levelsCleared');
      if (this.game.level.theme === 'vertical') profile.bump('verticalCleared');
    }
    if (stars === 5) profile.bump('fiveStars');
    if (clutch) profile.bump('clutchDeliveries');
    if (profile.getAttempts(levelId) >= 6) profile.bump('comebacks');

    // --- speedrun bookkeeping ----------------------------------------------
    let runSplit = null;
    if (this.run && !target.isCustom) {
      this.run.totalMs += timeMs;
      this.run.levels++;
      const isLast = target.index >= LEVELS.length - 1;
      runSplit = {
        totalMs: this.run.totalMs,
        levels: this.run.levels,
        complete: isLast,
        isRecord: false,
        previousBest: profile.bestRun,
      };
      if (isLast) {
        runSplit.isRecord = profile.recordRun(this.run.totalMs);
        this.run = null;
      }
    }

    this.lastResult = {
      outcome: 'win',
      stars,
      timeMs,
      parTime,
      runSplit,
      reward,
      flowBonus,
      bestFlow,
      flowMultiplier,
      flowEvents,
      payoutNote,
      isNewBest,
      firstClear,
      hasNext: !target.isCustom && target.index + 1 < LEVELS.length,
    };

    if (isNewBest && !firstClear) toast(`New best: ${formatTime(timeMs)}`, { icon: '★', tone: 'good' });

    this.#teardownGame();
    this.screen = 'result';
    this.#paint();
  }

  #handleLose(reason) {
    // A death ends the run: a speedrun is a single clean attempt.
    if (this.run) this.endRun('Speedrun ended \u2014 delivery failed');
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
    this.inputs?.destroy();
    this.inputs = null;
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
