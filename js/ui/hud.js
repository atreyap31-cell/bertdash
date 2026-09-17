// In-game HUD. Reads live values from the engine each animation frame and
// writes them straight into existing nodes — no re-render, no diffing.

import { el, formatTime } from './dom.js';

export class Hud {
  /**
   * @param {object} options { levelLabel, levelTitle, parTime, best, onRestart, onMenu, onPause }
   */
  constructor(options) {
    this.options = options;
    this.values = {};

    const stat = (label, key, extraClass = '') => {
      const value = el(`span.stat__value${extraClass}`, '—');
      this.values[key] = value;
      return el('div.stat', [el('span.stat__label', label), value]);
    };

    this.chargeFill = el('div.charge-bar__fill');
    this.flowValue = el('span.flow__value', '0');
    this.flowMult = el('span.flow__mult', '');
    this.flowFill = el('div.flow__fill');
    this.flowEl = el('div.flow', [
      el('div.flow__head', [el('span.flow__label', 'FLOW'), this.flowValue, this.flowMult]),
      el('div.flow__bar', [this.flowFill]),
    ]);
    this.flowEl.hidden = true;

    // Ability readouts. These exist so the new moves are discoverable: you can
    // see at a glance whether the air jump is banked or the dive is cooling.
    this.pips = {
      air: el('div.pip.pip--air', 'AIR'),
      dive: el('div.pip.pip--dive', 'DIVE'),
      slide: el('div.pip.pip--slide', 'SLIDE'),
      boost: el('div.pip.pip--boost', 'BOOST'),
    };
    this.pips.boost.hidden = true;

    this.root = el('div.hud', [
      el('div.hud__left', [
        el('div.hud__panel', [
          stat('Level', 'level'),
          el('div.stat__divider'),
          stat('Time', 'time', '.stat__value--time'),
          el('div.stat__divider'),
          stat('Par', 'par'),
          el('div.stat__divider'),
          stat('Best', 'best'),
        ]),
        el('div.hud__panel.hud__panel--status', [
          el('div', [
            el('span.hud__title', options.levelTitle ?? ''),
            (this.foodEl = el('span.food-status', 'IN HAND')),
            el('div.charge-bar', [this.chargeFill]),
          ]),
        ]),
        this.flowEl,
        el('div.hud__abilities', Object.values(this.pips)),
        (this.buffsEl = el('div.hud__buffs')),
      ]),
      el('div.hud__right', [
        el('button.btn.btn--sm.btn--ghost',
          { onclick: () => options.onPause?.(), title: 'Pause (Esc)' }, 'Pause'),
        el('button.btn.btn--sm.btn--warn',
          { onclick: () => options.onRestart?.(), title: 'Restart (R)' }, 'Restart'),
        el('button.btn.btn--sm.btn--ghost',
          { onclick: () => options.onMenu?.() }, 'Menu'),
      ]),
    ]);

    // Speedrun: a second clock showing the whole run, not just this level.
    if (options.runTotalMs != null) {
      this.runBase = options.runTotalMs;
      this.runEl = el('div.hud__panel.hud__panel--run', [
        el('div.stat', [
          el('span.stat__label', 'Run total'),
          (this.runValue = el('span.stat__value.stat__value--time', formatTime(options.runTotalMs))),
        ]),
      ]);
      this.root.querySelector('.hud__left').prepend(this.runEl);
    }

    this.values.level.textContent = options.levelLabel ?? '';
    // The clock is held until the first input, so say so before the first frame.
    this.values.time.textContent = 'READY';
    this.values.time.classList.add('is-waiting');
    this.values.par.textContent = options.parTime != null ? `${options.parTime.toFixed(1)}s` : '—';
    this.values.best.textContent = options.best != null ? formatTime(options.best) : '—';
  }

  /** @param {object} state from Game#getHudState */
  update(state) {
    const time = this.values.time;
    // The clock is held until the first input, so the time shown is time you
    // actually spent playing rather than time spent reading the level.
    time.textContent = state.started ? formatTime(state.elapsed) : 'READY';
    time.classList.toggle('is-waiting', !state.started);
    time.classList.toggle('is-over-par', state.started && state.elapsed / 1000 > state.parTime);

    const status = state.dead ? 'LOST'
      : state.foodAirborne
        ? (state.bagWallBouncesLeft === 0 ? 'FRAGILE!' : 'AIRBORNE')
      : state.hasFood ? 'IN HAND'
      : 'DROPPING';
    if (this.foodEl.textContent !== status) {
      this.foodEl.textContent = status;
      this.foodEl.dataset.status = status.toLowerCase();
    }

    if (this.runValue) this.runValue.textContent = formatTime(this.runBase + state.elapsed);

    // Throw charge.
    this.chargeFill.style.width = `${Math.round(state.charge * 100)}%`;
    this.chargeFill.classList.toggle('is-full', state.charge >= 1);

    // Flow chain.
    const showFlow = state.flow > 0;
    if (this.flowEl.hidden === showFlow) this.flowEl.hidden = !showFlow;
    if (showFlow) {
      this.flowValue.textContent = String(Math.round(state.flow));
      this.flowMult.textContent = `×${state.flowMultiplier.toFixed(2)}`;
      this.flowFill.style.width = `${Math.round(state.flowTimeLeft * 100)}%`;
      this.flowEl.classList.toggle('is-hot', state.flowRatio >= 0.999);
    }

    // Ability availability.
    this.pips.air.classList.toggle('is-ready', state.airJumps > 0);
    this.pips.air.textContent = state.maxAirJumps > 1
      ? `AIR ${state.airJumps}/${state.maxAirJumps}`
      : 'AIR';
    this.pips.dive.classList.toggle('is-ready', state.diveReady);
    this.pips.slide.classList.toggle('is-ready', state.slideReady);

    const inVehicle = Boolean(state.vehicle);
    this.pips.boost.hidden = !inVehicle;
    this.pips.boost.classList.toggle('is-ready', state.boostReady || state.boost > 0);

    // Only the buffs actually running are shown; the old HUD displayed its
    // badges permanently whether or not you had the pickup.
    const badges = [];
    if (state.buffs.speed > 0) badges.push(['speed', 'SPEED']);
    if (state.buffs.jump > 0) badges.push(['jump', 'JUMP']);
    if (state.buffs.shield > 0) badges.push(['shield', 'SHIELD']);
    if (state.buffs.magnet > 0) badges.push(['magnet', 'MAGNET']);
    if (state.vehicle) badges.push(['vehicle', state.vehicle.toUpperCase()]);

    const signature = badges.map(b => b[0]).join(',');
    if (signature !== this._badgeSignature) {
      this._badgeSignature = signature;
      this.buffsEl.replaceChildren(
        ...badges.map(([kind, label]) => el(`span.badge.badge--${kind}`, label)));
    }
  }

  destroy() {
    this.root.remove();
  }
}
