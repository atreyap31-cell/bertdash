// The post-level replay.
//
// The whole run played back from the view you played it in: the camera follows
// the player and leans towards the bag while it is loose, and that is all.
//
// It used to cut a cinematic — the best few moments, slow motion across each,
// hard cuts between them. It looked like a trailer, and you could not follow
// what you had actually done. Watching your own run back is more useful.
//
// It still names each move as it goes past, because the recorder marks them
// anyway and a label costs nothing.

import { el, formatTime } from './dom.js';
import { Game } from '../engine/game.js';
import { VIEW_W, VIEW_H } from '../data/config.js';

export class ReplayReel {
  /**
   * @param {object} options { level, skin, reel, result, reducedFlash, onDone }
   */
  constructor({ level, skin, reel, result, reducedFlash, onDone }) {
    this.reel = { ...reel, index: 0 };
    this.result = result;
    this.onDone = onDone;
    this.finished = false;

    this.canvas = el('canvas.stage__canvas.stage__canvas--reel', {
      width: VIEW_W, height: VIEW_H, 'aria-label': 'Replay',
    });

    this.label = el('div.reel__label');
    this.progressFill = el('div.reel__progress-fill');

    this.root = el('div.reel', [
      this.canvas,
      el('div.reel__title', [
        el('span.reel__level', level.title),
        el('span.reel__time', formatTime(result.timeMs)),
      ]),
      this.label,
      el('div.reel__progress', [this.progressFill]),
      el('button.reel__skip', { onclick: () => this.#end() }, 'Skip →'),
    ]);

    this.game = new Game(this.canvas, level, {
      skin,
      reducedFlash,
      replay: this.reel,
      shakeScale: reducedFlash ? 0.3 : 0.7,
      onReplayEnd: () => this.#end(),
      onWin: () => {}, onLose: () => {}, onStats: () => {},
    });

    // Any key skips, the way a cutscene should.
    this.onKey = event => {
      if (event.repeat) return;
      event.preventDefault();
      this.#end();
    };
  }

  start() {
    addEventListener('keydown', this.onKey);
    // Played back as it happened: no slow motion, no push-in.
    this.game.replaySpeed = 1;
    this.game.replayZoom = 1;
    this.game.start();
    this.game.snapCamera();
    this.#tick();
  }

  #tick = () => {
    if (this.finished) return;
    this.raf = requestAnimationFrame(this.#tick);

    const clip = this.reel.clips[this.reel.index];
    if (!clip) return;

    const shown = this.game.replayLabel ?? '';
    if (this.label.textContent !== shown) {
      this.label.textContent = shown;
      this.label.classList.toggle('is-in', shown !== '');
    }

    const span = Math.max(1, clip.to - clip.from);
    const done = Math.min(1, this.game.replayCursor / span);
    this.progressFill.style.width = `${(done * 100).toFixed(1)}%`;
  };

  #end() {
    if (this.finished) return;
    this.finished = true;
    this.destroy();
    this.onDone();
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    removeEventListener('keydown', this.onKey);
    this.game?.destroy();
    this.root.remove();
  }
}
