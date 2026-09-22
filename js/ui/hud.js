// In-game HUD. Reads live values from the engine each animation frame and
// writes them straight into existing nodes — no re-render, no diffing.

import { el, formatTime, richText } from './dom.js';

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

    // Reads "you are ahead of / behind your best run right here", which is the
    // only question a ghost actually raises.
    this.ghostEl = el('div.ghost-gap', { hidden: true });

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

    // A glow round the edge of the screen for the state of the bag: red while
    // it is loose, green once it is coming back to you. It sits behind
    // everything else and ignores pointer events, so it reads as lighting
    // rather than as another panel to look at.
    this.glowEl = el('div.bag-glow', { 'data-state': 'none' });
    this.steady = options.reducedFlash === true
      || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    this.root = el('div.hud', [
      this.glowEl,
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
        this.ghostEl,
        this.flowEl,
        el('div.hud__abilities', Object.values(this.pips)),
        (this.buffsEl = el('div.hud__buffs')),
        (this.hintEl = el('div.hud__hint', { hidden: true })),
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

  /**
   * Drives the screen-edge glow from the engine's read on the bag.
   *
   * Intensity is written as a custom property rather than by swapping classes
   * so it can ramp smoothly as an outcome becomes certain, and the whole thing
   * is muted for anyone who has asked for less flashing.
   */
  #updateGlow(state) {
    const bag = state.bag ?? { state: 'none', urgency: 0 };
    if (this.glowEl.dataset.state !== bag.state) this.glowEl.dataset.state = bag.state;

    const scale = this.options.reducedFlash ? 0.45 : 1;
    // A slow pulse while the bag is loose, so a bad throw nags at you. Anyone
    // who has asked for less motion gets the steady glow instead.
    const pulse = bag.state === 'bad' && !this.steady
      ? 0.82 + 0.18 * Math.sin(performance.now() / 150)
      : 1;
    const strength = (bag.state === 'none' ? 0 : bag.urgency * pulse * scale).toFixed(3);
    if (this._glow !== strength) {
      this._glow = strength;
      this.glowEl.style.setProperty('--glow', strength);
    }
  }

  /**
   * Says how far ahead of the best run you are.
   *
   * Measured in horizontal distance rather than seconds, because a time gap
   * would need the ghost's clock at your position, and this reads the same at
   * a glance: ahead is ahead.
   */
  #updateGhost(state) {
    const lead = state.ghostLead;
    const show = lead != null && state.started;
    if (this.ghostEl.hidden === show) this.ghostEl.hidden = !show;
    if (!show) return;

    // A dead band, so standing level with the ghost does not flicker between
    // ahead and behind.
    const tone = lead > 40 ? 'ahead' : lead < -40 ? 'behind' : 'level';
    if (this.ghostEl.dataset.tone !== tone) this.ghostEl.dataset.tone = tone;

    const text = tone === 'level' ? 'LEVEL WITH BEST'
      : `${lead > 0 ? '+' : '−'}${Math.abs(Math.round(lead))} vs BEST`;
    if (this.ghostEl.textContent !== text) this.ghostEl.textContent = text;
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

    this.#updateGlow(state);
    this.#updateGhost(state);

    if (this.runValue) this.runValue.textContent = formatTime(this.runBase + state.elapsed);

    // Throw charge.
    this.chargeFill.style.width = `${Math.round(state.charge * 100)}%`;
    this.chargeFill.classList.toggle('is-full', state.charge >= 1);

    // Teaching prompt for whatever the player is standing in.
    if (state.hint !== this._hint) {
      this._hint = state.hint;
      this.hintEl.hidden = !state.hint;
      // Hints mark the key to press with <b>; textContent printed the tags.
      if (state.hint) this.hintEl.replaceChildren(...richText(state.hint));
    }

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
