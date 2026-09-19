// The post-level highlight reel.
//
// Not a replay of the whole run — a short cut of its best moments, chosen by
// the recorder. Each clip runs up to its moment at speed, drops into slow
// motion across it, then cuts to the next.

import { el, formatTime } from './dom.js';
import { Game } from '../engine/game.js';
import { VIEW_W, VIEW_H } from '../data/config.js';

/** How the camera and clock behave around a clip's key frame. */
const SHOT = {
  runUpSpeed: 1,
  slowSpeed: 0.28,
  slowWindow: 22,     // frames either side of the moment played slowly
  runUpZoom: 1.25,
  slowZoom: 1.75,
  zoomEase: 0.07,
};

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
    this.counter = el('div.reel__counter');

    this.root = el('div.reel', [
      this.canvas,
      el('div.reel__bar.reel__bar--top'),
      el('div.reel__bar.reel__bar--bottom'),
      el('div.reel__title', [
        el('span.reel__level', level.title),
        el('span.reel__time', formatTime(result.timeMs)),
      ]),
      this.label,
      this.counter,
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
    this.game.replayZoom = SHOT.runUpZoom;
    this.game.start();
    // Place the camera before the first frame so it does not fly in.
    this.#applyShot(true);
    this.#tick();
  }

  /** Per-frame direction: speed, zoom and the caption. */
  #tick = () => {
    if (this.finished) return;
    this.raf = requestAnimationFrame(this.#tick);

    const reel = this.reel;
    const clip = reel.clips[reel.index];
    if (!clip) return;

    this.#applyShot(false);

    if (this.label.textContent !== clip.label) {
      this.label.textContent = clip.label;
      // Restart the entry animation on each cut.
      this.label.classList.remove('is-in');
      void this.label.offsetWidth;
      this.label.classList.add('is-in');
    }
    const counter = `${reel.index + 1} / ${reel.clips.length}`;
    if (this.counter.textContent !== counter) this.counter.textContent = counter;
  };

  /** Slows down and pushes in as the clip reaches its moment. */
  #applyShot(immediate) {
    const game = this.game;
    const clip = this.reel.clips[this.reel.index];
    if (!clip) return;

    const frame = clip.from + game.replayCursor;
    const distance = Math.abs(frame - clip.at);
    const inSlowMo = distance <= SHOT.slowWindow;

    game.replaySpeed = inSlowMo ? SHOT.slowSpeed : SHOT.runUpSpeed;

    const targetZoom = inSlowMo ? SHOT.slowZoom : SHOT.runUpZoom;
    game.replayZoom += (targetZoom - game.replayZoom) * SHOT.zoomEase;

    if (immediate) {
      game.replayZoom = targetZoom;
      game.snapCamera();
    }
    this.root.classList.toggle('is-slow', inSlowMo);
  }

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
