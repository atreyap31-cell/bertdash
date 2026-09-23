// The BertDash simulation and renderer.
//
// Runs a fixed-timestep loop: physics always advance in SIM_STEP increments no
// matter what the display refresh rate is, so a 144Hz monitor no longer makes
// the player move 2.4x faster than a 60Hz one.

import { PHYSICS, resolveLoadout, COLORS, FLOW, POWERUP_BY_ID, DEFAULT_BINDINGS, AIM_ACTIONS, SIM_STEP, STEP_EPSILON, MAX_FRAME_MS, VIEW_W, VIEW_H } from '../data/config.js';
import { prepareLevel, isSolidType, clamp } from './level.js';
import { audio } from '../services/audio.js';
import { backdropFor } from './backdrop.js';

/**
 * Used when no gear is supplied, e.g. in tests.
 *
 * Derived from the real resolver rather than written out again, so a new piece
 * of gear cannot add a field the ungeared default silently lacks.
 */
const DEFAULT_LOADOUT = resolveLoadout();

const PLAYER_W = 32;
const PLAYER_H = 48;
const SLIDE_H = 26;
const FOOD_SIZE = 26;
const GOAL_RADIUS = 78;

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} levelSource raw level data
   * @param {object} options { skin, onWin, onLose, onStats, onPauseRequest }
   */
  constructor(canvas, levelSource, options = {}) {
    this.canvas = canvas;
    this.renderScale = 1;
    this.#sizeCanvas();
    this.ctx = canvas.getContext('2d');
    this.level = prepareLevel(levelSource);
    this.backdrop = backdropFor(this.level);
    this.#markFloating();
    this.skin = options.skin ?? { color: COLORS.player, textColor: '#fff' };
    this.onWin = options.onWin ?? (() => {});
    this.onLose = options.onLose ?? (() => {});
    this.onStats = options.onStats ?? (() => {});
    this.onPauseRequest = options.onPauseRequest ?? (() => {});
    this.reducedFlash = Boolean(options.reducedFlash);
    // Replay mode: the loop stops simulating and plays a recorded track back
    // instead, so a reel shows exactly what happened rather than a
    // re-simulation that can drift.
    this.replay = options.replay ?? null;
    this.replayCursor = 0;
    this.replaySpeed = 1;
    this.replayZoom = 1;
    this.onReplayEnd = options.onReplayEnd ?? (() => {});
    // The ghost of the best run on this level, if there is one and the player
    // wants to see it. Purely decorative: it never touches the simulation.
    this.ghost = options.ghost ?? null;
    this.ghostPose = null;

    // Optional run recorder, for the post-level highlight reel.
    this.recorder = options.recorder ?? null;
    // 0 disables screen shake entirely; reduced-flash damps it.
    this.shakeScale = options.shakeScale ?? (this.reducedFlash ? 0.4 : 1);
    // Gear bought in the store folds into a single set of modifiers, so the
    // engine reads one object rather than knowing about individual items.
    this.loadout = { ...DEFAULT_LOADOUT, ...(options.loadout ?? {}) };
    // Controls are rebindable, so the engine asks for actions rather than keys.
    this.binds = { ...DEFAULT_BINDINGS, ...(options.bindings ?? {}) };

    this.keys = new Set();
    this.pressed = new Set();   // keys that went down since the last step
    this.paused = false;
    this.finished = false;      // latches so win/lose can only fire once
    this.destroyed = false;

    this.elapsed = 0;           // ms of gameplay, excludes pause time
    this.deathReason = null;
    this.deathTimer = 0;
    this.shake = 0;
    this.particles = [];
    this.accumulator = 0;
    this.lastFrame = 0;
    this.worldTime = 0;         // drives laser/door cycles
    this.rafId = null;

    // Batched stat counters, flushed once a second instead of on every event.
    this.pendingStats = new Map();
    this.statFlushAt = 0;

    // Aim is a direction, not a screen position: the arrow keys choose it.
    this.aimDir = { x: 1, y: 0 };
    this.aiming = false;
    this.hint = null;
    this.nearMissCooldown = 0;
    // Frames left on each aim direction after it is released, so a diagonal
    // survives the keys coming up on different frames.
    this.aimGrace = Object.fromEntries(AIM_ACTIONS.map(d => [d.id, 0]));
    // Expanding rings left behind by an air jump. They stay where the jump
    // happened while the player rises away from them.
    this.rings = [];
    // Whether the bag is on course to be caught or to be lost, recomputed
    // periodically and shown as a glow round the edge of the screen.
    this.bagOutlook = { state: 'none', urgency: 0, impactIn: Infinity, landing: null };
    this.outlookAge = 0;
    this.catchGlow = 0;
    this.lastSteer = 1;   // which direction key was pressed most recently
    this.recentCatchAt = -Infinity; // gameplay ms of the last mid-air catch
    this.charging = false;          // mouse held: winding up a throw
    this.charge = 0;                // frames of wind-up so far

    // The clock does not run until you actually do something, so reading the
    // level costs nothing and the time shown is time you spent playing.
    this.started = false;

    // Flow chain.
    this.flow = 0;                  // current chain value
    this.flowTimer = 0;             // frames left before it lapses
    this.bestFlow = 0;
    this.lastMove = null;
    this.flowEvents = 0;

    this.#resetEntities();
    this.#bindInput();
  }

  #resetEntities() {
    const start = this.level.startPos;
    this.player = {
      x: start.x,
      y: start.y,
      vx: 0,
      vy: 0,
      width: PLAYER_W,
      height: PLAYER_H,
      grounded: false,
      groundPlatform: null,
      facingRight: true,
      hasFood: true,
      sliding: false,
      slideTimer: 0,
      slideCooldown: 0,
      diving: false,
      spin: 0,            // frames left of the air-jump flip
      spinDir: 1,         // which way it rotates, from the steer at take-off
      diveAge: 0,         // frames since the dive began, for the bounce guard
      diveArmed: false,   // a dive is "live" until you land, even after the
                          // speed window expires — that is what the bounce reads
      diveTimer: 0,
      diveCooldown: 0,
      wallSliding: false,
      wallDir: 0,
      wallStick: 0,
      wallLock: 0,
      coyote: 0,
      jumpBuffer: 0,
      airTime: 0,
      airJumps: this.loadout.airJumps,
      crouching: false,
      vehicle: null,
      boost: 0,
      boostCharge: 0,
      invuln: 0,
      buffs: { speed: 0, jump: 0, shield: 0, magnet: 0 },
      wallSlideCredited: false,
    };
    this.food = {
      x: this.level.foodPos.x,
      y: this.level.foodPos.y,
      vx: 0,
      vy: 0,
      size: FOOD_SIZE,
      airborne: false,
      catchCooldown: 0,
      magnetised: false,
      wallBouncesLeft: this.loadout.bagWallBounces,
      floorSavesLeft: this.loadout.floorSaves,
    };
    this.camera = {
      x: clamp(start.x - VIEW_W / 2, 0, Math.max(0, this.level.width - VIEW_W)),
      y: clamp(start.y - VIEW_H / 2, 0, Math.max(0, this.level.height - VIEW_H)),
    };
    this.cameraLead = { x: 0, y: 0 };
  }

  // --- lifecycle -----------------------------------------------------------

  start() {
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.#frame);
  }

  destroy() {
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.#unbindInput();
    this.#flushStats();
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    // Reset the frame clock so time spent paused isn't simulated in one lurch.
    this.lastFrame = performance.now();
    this.accumulator = 0;
    if (paused) this.keys.clear();
  }

  // --- input ---------------------------------------------------------------

  #bindInput() {
    // Keys that would otherwise scroll the page while playing. Derived from the
    // live bindings, so a rebound control still gets its default suppressed.
    const scrolls = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
    const swallow = new Set([
      ...scrolls,
      ...Object.values(this.binds).flat().filter(code => scrolls.has(code)),
    ]);

    this.onKeyDown = event => {
      if (event.repeat) {
        if (swallow.has(event.code)) event.preventDefault();
        return;
      }
      if (this.#isBound('pause', event.code)) {
        this.onPauseRequest();
        return;
      }
      if (swallow.has(event.code)) event.preventDefault();
      // Remember which way was asked for most recently, so rolling from one
      // direction key to the other reads as a turn rather than a stop.
      if (this.#isBound('left', event.code)) this.lastSteer = -1;
      if (this.#isBound('right', event.code)) this.lastSteer = 1;
      this.keys.add(event.code);
      this.pressed.add(event.code);
      audio.unlock();
    };
    this.onKeyUp = event => {
      this.keys.delete(event.code);
    };
    // A dropped keyup (alt-tab mid-jump) used to leave the key stuck down.
    this.onBlur = () => this.keys.clear();

    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('contextmenu', this.#preventDefault);
  }

  #preventDefault = event => event.preventDefault();

  #unbindInput() {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('contextmenu', this.#preventDefault);
  }

  #held(action) {
    return this.binds[action].some(code => this.keys.has(code));
  }

  #justPressed(action) {
    return this.binds[action].some(code => this.pressed.has(code));
  }

  /** Whether a raw key code is bound to an action (used by the pause hook). */
  #isBound(action, code) {
    return this.binds[action].includes(code);
  }

  /** Live key state, for the on-screen input display. */
  getHeldKeys() {
    return this.keys;
  }

  // --- main loop -----------------------------------------------------------

  #frame = now => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.#frame);

    // Clamping stops a backgrounded tab from simulating minutes in one frame.
    const delta = Math.min(now - this.lastFrame, MAX_FRAME_MS);
    this.lastFrame = now;

    if (this.replay) {
      this.#stepReplay(delta);
      this.#render();
      return;
    }

    if (!this.paused) {
      this.accumulator += delta;
      let steps = 0;
      // The epsilon matters: without it a frame a fraction of a microsecond
      // short of SIM_STEP runs nothing, and the player visibly stutters.
      while (this.accumulator + STEP_EPSILON >= SIM_STEP && steps < 5) {
        this.#step();
        this.accumulator = Math.max(0, this.accumulator - SIM_STEP);
        steps++;
      }
      if (steps === 5) this.accumulator = 0; // give up rather than spiral
      this.#flushStatsIfDue(now);
    }

    this.#render();
  };

  #step() {
    this.worldTime += SIM_STEP;
    if (this.started && !this.finished) this.elapsed += SIM_STEP;
    this.#decayFlow();

    this.#stepPlatforms();

    if (this.deathReason) {
      this.deathTimer -= SIM_STEP;
      this.shake *= PHYSICS.shake.decay;
      this.#stepParticles();
      if (this.deathTimer <= 0 && !this.finished) {
        this.finished = true;
        this.onLose(this.deathReason);
      }
      this.pressed.clear();
      return;
    }

    if (this.finished) { this.pressed.clear(); return; }

    this.#stepPlayer();
    this.#stepFood();
    this.#stepPickups();
    this.#stepHazards();
    // The look-ahead walks the bag's whole arc against every platform, so it
    // runs a few times a second rather than every frame.
    if (--this.outlookAge <= 0) {
      this.#assessBag();
      this.outlookAge = 4;
    }
    if (this.catchGlow > 0) this.catchGlow--;

    this.#stepHint();
    this.#stepGoal();
    this.#stepParticles();
    this.#stepRings();
    this.#stepCamera();
    this.recorder?.record(this);
    this.shake *= PHYSICS.shake.decay;
    if (this.shake < PHYSICS.shake.cutoff) this.shake = 0;
    this.pressed.clear();
  }

  // --- platforms -----------------------------------------------------------

  #stepPlatforms() {
    for (const p of this.level.platforms) {
      p.deltaX = 0;
      p.deltaY = 0;

      if (p.type === 'moving' && p.range > 0) {
        if (p.velX) {
          const next = p.x + p.velX * p.dir;
          if (next <= p.minX || next >= p.maxX) p.dir *= -1;
          const moved = p.velX * p.dir;
          p.x = clamp(p.x + moved, p.minX, p.maxX);
          p.deltaX = moved;
        }
        if (p.velY) {
          const next = p.y + p.velY * p.dir;
          if (next <= p.minY || next >= p.maxY) p.dir *= -1;
          const moved = p.velY * p.dir;
          p.y = clamp(p.y + moved, p.minY, p.maxY);
          p.deltaY = moved;
        }
      }

      if (p.type === 'laser' || p.type === 'door') {
        // Square wave: on for the first half of each interval.
        const phase = (this.worldTime + p.offset) % Math.max(200, p.interval);
        p.active = phase < p.interval / 2;
      }

      if (p.type === 'vanishing') {
        if (p.respawnAt > 0) {
          p.respawnAt -= SIM_STEP;
          p.opacity = Math.min(1, Math.max(0, 1 - p.respawnAt / 1400));
          if (p.respawnAt <= 0) { p.opacity = 1; p.touchedAt = 0; }
        } else if (p.touchedAt > 0) {
          p.touchedAt -= SIM_STEP;
          p.opacity = Math.max(0, p.touchedAt / 550);
          if (p.touchedAt <= 0) { p.respawnAt = 1400; p.opacity = 0; }
        }
      }
    }
  }

  /** Is this platform currently something you can stand on / bump into? */
  #isSolidNow(p) {
    if (!isSolidType(p.type)) return false;
    if (p.type === 'door') return p.active;                       // closed = solid
    if (p.type === 'vanishing') return p.opacity > 0.05 && p.respawnAt <= 0;
    return true;
  }

  #solidPlatforms() {
    return this.level.platforms.filter(p => this.#isSolidNow(p));
  }

  // --- player --------------------------------------------------------------

  #stepPlayer() {
    const p = this.player;
    const phys = this.level.physics;
    const buffSpeed = p.buffs.speed > 0 ? PHYSICS.speedBuff : 1;
    const buffJump = p.buffs.jump > 0 ? PHYSICS.jumpBuff : 1;

    // --- timers ---
    for (const key of ['speed', 'jump', 'shield', 'magnet']) {
      if (p.buffs[key] > 0) p.buffs[key]--;
    }
    if (p.slideCooldown > 0) p.slideCooldown--;
    if (p.diveCooldown > 0) p.diveCooldown--;
    if (p.coyote > 0) p.coyote--;
    if (p.jumpBuffer > 0) p.jumpBuffer--;
    if (p.wallLock > 0) p.wallLock--;
    if (p.invuln > 0) p.invuln--;
    if (p.boost > 0) p.boost--;
    if (p.boostCharge > 0) p.boostCharge--;
    if (p.diveTimer > 0 && --p.diveTimer === 0) p.diving = false;
    // --- aiming and throwing, on the arrow keys ---
    //
    // A direction keeps counting for a few frames after it is let go. Nobody
    // releases two keys on the same frame, and without this the last one still
    // down decided the throw: let go of Right a frame before Up and a careful
    // diagonal went straight up instead.
    const aim = { x: 0, y: 0 };
    let aiming = false;
    for (const dir of AIM_ACTIONS) {
      if (this.#held(dir.id)) {
        this.aimGrace[dir.id] = PHYSICS.aimGraceFrames;
        aiming = true;
      } else if (this.aimGrace[dir.id] > 0) {
        this.aimGrace[dir.id]--;
      }
      if (this.aimGrace[dir.id] > 0) {
        aim.x += dir.x;
        aim.y += dir.y;
      }
    }
    this.aiming = aiming;
    if (aiming && (aim.x || aim.y)) {
      const length = Math.hypot(aim.x, aim.y);
      this.aimDir = { x: aim.x / length, y: aim.y / length };
      this.#beginRun();
    }

    if (aiming && p.hasFood) {
      this.charging = true;
      this.charge = Math.min(this.loadout.chargeFrames, this.charge + 1);
    } else if (this.charging) {
      // Every aim key released: let it go.
      this.charging = false;
      this.#throwFood();
      this.charge = 0;
    }

    const vehicle = p.vehicle;
    const tuning = vehicle ? PHYSICS[vehicle.type] : null;
    const boosting = p.boost > 0;

    // Empty hands are faster — that is the reward for risking the throw.
    const handsBonus = p.hasFood ? 1 : this.loadout.emptyHandBonus;
    const baseSpeed = (tuning?.speed ?? PHYSICS.moveSpeed)
      * phys.moveSpeedScale * buffSpeed * handsBonus * this.loadout.moveSpeed
      * (boosting ? (tuning?.boost ?? 1.4) : 1);

    const left = this.#held('left');
    const right = this.#held('right');
    // Holding both directions used to cancel out and stop the player dead,
    // which punishes the very normal habit of rolling from one key to the
    // other. The most recent press wins instead.
    const steer = (left && right) ? this.lastSteer : (right ? 1 : 0) - (left ? 1 : 0);
    if (steer !== 0) this.#beginRun();
    const jumpHeld = this.#held('jump');

    // --- vehicle boost ---
    if (this.#justPressed('boost') && vehicle
        && p.boost <= 0 && p.boostCharge <= 0) {
      p.boost = PHYSICS.boostFrames;
      p.boostCharge = this.loadout.boostRecharge;
      this.#bump('boosts');
      this.#addFlow('boost');
      audio.vehicle();
      this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 14, COLORS.car);
    }

    // --- horizontal movement ---
    if (p.sliding) {
      p.slideTimer--;
      p.vx *= PHYSICS.slideDecay;
      // Steering against a slide cuts it short; with it, it rides out.
      if (steer !== 0 && Math.sign(steer) !== Math.sign(p.vx)) p.slideTimer -= 2;
      if (p.slideTimer <= 0 || !p.grounded) this.#tryStandUp(baseSpeed);
    } else if (!p.diving) {
      const lock = p.wallLock > 0 ? 0.25 : 1; // don't cancel a wall kick instantly
      if (steer !== 0) {
        const target = steer * baseSpeed;
        const turning = p.vx !== 0 && Math.sign(p.vx) !== steer;
        const control = (p.grounded ? PHYSICS.groundAccel : PHYSICS.airAccel)
          * (turning ? PHYSICS.turnAccel : 1);
        const faster = Math.sign(p.vx) === steer && Math.abs(p.vx) > Math.abs(target);
        if (faster) {
          // Steering must never scrub speed you already have in that
          // direction. Without this, holding forward out of a long jump or a
          // dive drags you straight back to running pace and the move covers
          // less ground than an ordinary jump.
          p.vx *= p.grounded ? PHYSICS.groundMomentumBleed : PHYSICS.airMomentumBleed;
        } else {
          p.vx += (target - p.vx) * control * lock;
        }
        p.facingRight = steer > 0;
      } else if (p.grounded) {
        p.vx *= phys.friction;
        // Snap to a stop instead of creeping. Without this the tail of the
        // friction curve reads as a slide every time you land.
        if (Math.abs(p.vx) < PHYSICS.stopThreshold) p.vx = 0;
      } else {
        p.vx *= 0.985; // air momentum is kept; only the ground really slows you
      }
    }

    p.vx += phys.windX;
    p.vx = clamp(p.vx, -PHYSICS.maxSpeedX, PHYSICS.maxSpeedX);
    if (Math.abs(p.vx) < 0.05) p.vx = 0;

    // --- start a slide ---
    if (this.#justPressed('slide') && p.grounded && !p.sliding
        && p.slideCooldown <= 0 && !vehicle) {
      p.sliding = true;
      p.slideTimer = this.loadout.slideFrames;
      p.slideCooldown = PHYSICS.slideCooldown;
      const dir = steer !== 0 ? steer : (p.facingRight ? 1 : -1);
      const launch = PHYSICS.slideSpeed * phys.moveSpeedScale * buffSpeed;
      // A slide keeps whichever is faster: your run-up or the slide's own kick.
      p.vx = dir * Math.max(launch, Math.abs(p.vx) * 1.15);
      p.facingRight = dir > 0;
      p.y += PLAYER_H - SLIDE_H;
      p.height = SLIDE_H;
      this.#bump('totalSlides');
      this.#addFlow('slide');
      audio.slide();
      this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 6, '#94a3b8');
    }

    // --- jump, in priority order: wall kick, long jump, ground, air ---
    if (this.#justPressed('jump')) p.jumpBuffer = this.loadout.jumpBufferFrames;

    const jumpForce = (tuning?.jump ?? PHYSICS.jumpForce)
      * phys.jumpForceScale * buffJump * this.loadout.jumpForce;

    if (p.jumpBuffer > 0) {
      if ((p.wallSliding || p.wallStick > 0) && phys.wallSlideEnabled && !vehicle) {
        // Wall kick, which also refunds the air jump — a wall is a renewable
        // source of height.
        p.vy = this.loadout.wallJumpY * phys.jumpForceScale * buffJump;
        p.vx = -p.wallDir * this.loadout.wallJumpX;
        p.facingRight = p.wallDir < 0;
        p.wallSliding = false;
        p.wallStick = 0;
        p.wallLock = PHYSICS.wallJumpLockFrames;
        p.airJumps = this.loadout.airJumps;
        p.jumpBuffer = 0;
        this.#bump('totalJumps');
        this.#bump('wallJumps');
        this.#addFlow('wallKick');
        audio.wallJump();
        this.#spawnParticles(p.x + (p.wallDir > 0 ? p.width : 0), p.y + p.height / 2, 8, '#cbd5e1');
      } else if (p.sliding && p.grounded) {
        // Long jump: trade the slide's momentum for distance.
        p.vx *= PHYSICS.longJump.x;
        p.vy = PHYSICS.longJump.y * phys.jumpForceScale * buffJump;
        this.#endSlide();
        p.grounded = false;
        p.groundPlatform = null;
        p.jumpBuffer = 0;
        this.#bump('totalJumps');
        this.#bump('longJumps');
        this.#addFlow('longJump');
        audio.jump();
        this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 10, this.skin.color);
      } else if (p.grounded || p.coyote > 0) {
        p.vy = jumpForce;
        p.grounded = false;
        p.coyote = 0;
        p.jumpBuffer = 0;
        p.groundPlatform = null;
        this.#bump('totalJumps');
        this.#addFlow('jump');
        audio.jump();
      } else if (p.airJumps > 0 && !vehicle) {
        // Air jump. Steering while using it redirects you rather than only
        // adding height, which is what makes it good for course correction.
        p.airJumps--;
        p.vy = PHYSICS.airJumpForce * phys.jumpForceScale * buffJump * this.loadout.jumpForce;
        if (steer !== 0) p.vx += steer * PHYSICS.airJumpSteer;
        p.jumpBuffer = 0;
        p.diving = false;
        this.#bump('totalJumps');
        this.#bump('airJumps');
        this.#addFlow('airJump');
        audio.jump();
        this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 12, '#e2e8f0');

        // A full flip, so the second jump is unmistakable in the air. It turns
        // the way you are steering, or the way you are already facing.
        p.spin = PHYSICS.airJumpSpinFrames;
        p.spinDir = steer !== 0 ? Math.sign(steer) : (p.facingRight ? 1 : -1);
        this.rings.push({ x: p.x + p.width / 2, y: p.y + p.height / 2, age: 0 });
      }
    }

    // Variable jump height: releasing early cuts the arc short.
    if (p.vy < 0 && !jumpHeld) p.vy *= 0.86;

    // --- dive (now usable from the ground too) ---
    if (this.#justPressed('dive') && p.diveCooldown <= 0 && !vehicle) {
      // The dive aims itself. With the bag loose it goes straight at the bag,
      // which makes it the recovery tool for a throw that went wrong; with the
      // bag in hand it is a flat dash the way you are already facing. The
      // cursor is only ever used for throwing.
      const target = this.diveTarget();
      const dx = target.x - (p.x + p.width / 2);
      const dy = target.y - (p.y + p.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        if (p.sliding) this.#endSlide();
        p.vx = (dx / dist) * this.loadout.diveSpeed;
        p.vy = (dy / dist) * this.loadout.diveSpeed;
        // A near-level dive started on the ground would re-land on the very
        // next frame and cancel itself, so those get just enough lift to skim.
        //
        // A dive aimed clearly downward keeps its line. Lifting every grounded
        // dive pinned them all to the same shallow angle whatever the bag was
        // doing, so chasing a bag over the lip of a ledge sailed you straight
        // over the top of it.
        const nearLevel = Math.abs(dy) < dist * PHYSICS.diveLiftMaxSlope;
        if (p.grounded && p.vy >= 0 && nearLevel) p.vy = PHYSICS.diveGroundLift;
        p.facingRight = dx > 0;
        p.diving = true;
        p.diveArmed = true;
        p.diveAge = 0;
        p.diveTimer = PHYSICS.diveFrames;
        p.diveCooldown = PHYSICS.diveCooldown;
        p.grounded = false;
        p.coyote = 0;
        this.#bump('totalDives');
        this.#addFlow('dive');
        audio.dive();
        this.#spawnParticles(p.x + p.width / 2, p.y + p.height / 2, 10, this.skin.color);
      }
    }

    if (this.#justPressed('exit') && vehicle) this.#exitVehicle();

    // --- gravity ---
    // A dive holds its line; full gravity would turn every dive into a dud.
    const gravityScale = p.diving ? PHYSICS.diveGravityScale : 1;
    p.vy += PHYSICS.gravity * phys.gravityScale * gravityScale;

    const terminal = p.wallSliding ? this.loadout.wallSlideSpeed : this.loadout.terminalVelocity;
    if (p.vy > terminal) p.vy = terminal;

    this.#steerDive();

    // The dive's speed window is short, but a dive off a height takes far
    // longer than that to land. The bounce reads `diveArmed`, which survives
    // until the player actually touches down.
    if (p.spin > 0) p.spin--;
    if (p.diveArmed) p.diveAge++;

    const wasDiving = p.diveArmed;
    const impactSpeed = Math.hypot(p.vx, p.vy);
    const wasAirborne = !p.grounded;

    this.#moveAndCollide(p);

    // Dive bounce: land a fast dive and rebound instead of splatting.
    // The dive must have actually travelled before it can rebound. Starting a
    // dive clears `grounded`, so without this a dive aimed downward satisfies
    // "was airborne, now landed" on its own first frame: it hit the floor
    // under your feet and flung you back the opposite way. Aiming at a bag
    // below you sent you straight up.
    const travelled = p.diveAge >= PHYSICS.diveBounceMinAge;
    if (wasDiving && travelled && p.grounded && wasAirborne
        && impactSpeed >= this.loadout.diveBounceMinSpeed) {
      p.vy = this.loadout.diveBounce * phys.jumpForceScale;
      p.grounded = false;
      p.groundPlatform = null;
      p.diving = false;
      p.diveArmed = false;
      p.diveTimer = 0;
      p.diveCooldown = Math.min(p.diveCooldown, 10); // reward the read
      this.#bump('diveBounces');
      this.#addFlow('diveBounce');
      audio.wallJump();
      this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 14, this.skin.color);
      this.#addShake(PHYSICS.shake.diveBounce);
    }

    // Landing refills the air jump and disarms any dive that did not bounce.
    if (p.grounded) { p.airJumps = this.loadout.airJumps; p.airTime = 0; p.diveArmed = false; }
    else p.airTime++;

    // Ride moving platforms and conveyors.
    if (p.grounded && p.groundPlatform) {
      p.x += p.groundPlatform.deltaX;
      p.y += p.groundPlatform.deltaY;
      if (p.groundPlatform.conveyorVel) p.x += p.groundPlatform.conveyorVel;
      if (p.groundPlatform.type === 'vanishing' && p.groundPlatform.touchedAt === 0
          && p.groundPlatform.respawnAt <= 0) {
        p.groundPlatform.touchedAt = 550;
      }
    }

    p.x = clamp(p.x, 0, this.level.width - p.width);

    // Re-read p.vehicle rather than the snapshot above: pressing Q earlier in
    // this same step may already have dismounted.
    if (p.vehicle) {
      p.vehicle.x = p.x - (p.vehicle.width - p.width) / 2;
      p.vehicle.y = p.y + p.height - p.vehicle.height;
    }

    if (p.y > this.level.height + 400) this.#kill('FELL');
  }

  /**
   * Ends a slide, restoring full height only when there is headroom. Without
   * this the player grows into any low ceiling and gets shoved back out by
   * collision, which makes crawl tunnels unusable as level geometry.
   */
  #tryStandUp(speedCap = PHYSICS.moveSpeed) {
    const p = this.player;
    const standing = { x: p.x, y: p.y - (PLAYER_H - SLIDE_H), width: p.width, height: PLAYER_H };
    const blocked = this.#solidPlatforms().some(plat => !plat.oneWay && overlaps(standing, plat));

    if (blocked) {
      p.crouching = true;
      p.slideTimer = Math.max(p.slideTimer, 1); // stay crouched, keep crawling
      p.vx = clamp(p.vx, -speedCap, speedCap);
      return false;
    }
    this.#endSlide();
    p.vx = clamp(p.vx, -speedCap * 1.4, speedCap * 1.4);
    return true;
  }

  #endSlide() {
    const p = this.player;
    if (!p.sliding) return;
    p.sliding = false;
    p.crouching = false;
    p.slideTimer = 0;
    p.y -= PLAYER_H - SLIDE_H; // grow back upward from the same feet position
    p.height = PLAYER_H;
  }

  /**
   * Axis-separated collision with sub-stepping, so fast movement can't tunnel
   * through a 20px ledge.
   */
  #moveAndCollide(p) {
    const solids = this.#solidPlatforms();

    // --- X ---
    const maxX = Math.max(0, this.level.width - p.width);
    const stepsX = Math.max(1, Math.ceil(Math.abs(p.vx) / 8));
    const incX = p.vx / stepsX;

    for (let i = 0; i < stepsX; i++) {
      p.x += incX;
      for (const plat of solids) {
        if (plat.oneWay) continue; // ledges never block horizontally
        if (!overlaps(p, plat)) continue;

        // Step-up: a lip you could obviously walk over should not stop you.
        // Only on the ground, and only if there is headroom above the step.
        if (p.grounded || p.coyote > 0) {
          const lip = (p.y + p.height) - plat.y;
          if (lip > 0 && lip <= PHYSICS.stepUpHeight) {
            const stepped = { x: p.x, y: p.y - lip, width: p.width, height: p.height };
            const blocked = solids.some(other => other !== plat && !other.oneWay
              && overlaps(stepped, other));
            if (!blocked) { p.y -= lip; continue; }
          }
        }

        if (incX > 0) p.x = plat.x - p.width;
        else if (incX < 0) p.x = plat.x + plat.width;
        p.vx = 0;
        break;
      }
    }

    // Keep the player inside the world *before* resolving Y. Pushed far enough
    // out by wind or a conveyor, they would otherwise spend the vertical pass
    // beyond the end of the floor and fall straight through it.
    if (p.x < 0 || p.x > maxX) {
      p.x = clamp(p.x, 0, maxX);
      p.vx = 0;
    }

    // --- Y ---
    const prevBottom = p.y + p.height;
    const stepsY = Math.max(1, Math.ceil(Math.abs(p.vy) / 8));
    const incY = p.vy / stepsY;
    const wasGrounded = p.grounded;
    p.grounded = false;
    p.groundPlatform = null;

    for (let i = 0; i < stepsY; i++) {
      p.y += incY;
      for (const plat of solids) {
        if (!overlaps(p, plat)) continue;

        if (incY > 0) {
          // Landing. One-way ledges only catch you if your feet were above them.
          if (plat.oneWay && prevBottom > plat.y + Math.abs(p.vy) + 4) continue;
          p.y = plat.y - p.height;
          p.vy = 0;
          p.grounded = true;
          p.groundPlatform = plat;
          if (!wasGrounded) audio.land();
        } else if (incY < 0 && !plat.oneWay) {
          // Head bump, with corner correction: if only a sliver of the player
          // is under the ceiling, slide them clear of it and let the jump
          // continue. This is the difference between "I made that" and "the
          // game clipped me".
          const overlapLeft = (p.x + p.width) - plat.x;   // sliver on the left edge
          const overlapRight = (plat.x + plat.width) - p.x; // sliver on the right edge
          const nudge = overlapLeft < overlapRight ? -overlapLeft : overlapRight;

          if (Math.abs(nudge) <= PHYSICS.cornerCorrection) {
            const shifted = { x: p.x + nudge, y: p.y, width: p.width, height: p.height };
            const blocked = solids.some(other => !other.oneWay && overlaps(shifted, other));
            if (!blocked) { p.x += nudge; continue; }
          }

          p.y = plat.y + plat.height;
          p.vy = 0;
        }
      }
      if (p.grounded) break;
    }

    // Ledge assist: falling just past the lip of a platform, with the feet
    // barely below its surface, pulls you onto it instead of scraping down.
    if (!p.grounded && p.vy > 0 && !p.wallSliding) {
      const feet = p.y + p.height;
      for (const plat of solids) {
        if (feet < plat.y || feet > plat.y + PHYSICS.ledgeAssist) continue;
        const pastLeft = plat.x - (p.x + p.width);   // >0 when just left of it
        const pastRight = p.x - (plat.x + plat.width); // >0 when just right of it
        const gap = Math.max(pastLeft, pastRight);
        if (gap < 0 || gap > PHYSICS.ledgeAssist) continue;
        // Only help if the player is heading towards the ledge.
        if (pastLeft > 0 && p.vx <= 0) continue;
        if (pastRight > 0 && p.vx >= 0) continue;

        const nudge = pastLeft > 0 ? gap + 1 : -(gap + 1);
        const shifted = { x: p.x + nudge, y: plat.y - p.height, width: p.width, height: p.height };
        if (solids.some(other => other !== plat && !other.oneWay && overlaps(shifted, other))) continue;

        p.x += nudge;
        p.y = plat.y - p.height;
        p.vy = 0;
        p.grounded = true;
        p.groundPlatform = plat;
        if (!wasGrounded) audio.land();
        break;
      }
    }

    if (p.grounded) {
      p.coyote = this.loadout.coyoteFrames;
      p.diving = false;
      p.wallSlideCredited = false;
    } else if (wasGrounded) {
      p.coyote = this.loadout.coyoteFrames;
    }

    this.#updateWallSlide(p, solids);
  }

  #updateWallSlide(p, solids) {
    const wasWallSliding = p.wallSliding;
    p.wallSliding = false;

    if (p.wallStick > 0) p.wallStick--;

    if (!this.level.physics.wallSlideEnabled || p.grounded || p.vehicle || p.sliding) {
      p.wallStick = 0;
      p.wallDir = 0;
      return;
    }

    // Detect a wall on either side without requiring the player to hold into
    // it. Holding still biases the choice, so a deliberate press wins when
    // there are walls on both sides of a shaft.
    const pressingRight = this.#held('right');
    const pressingLeft = this.#held('left');
    const order = pressingRight ? [1, -1] : pressingLeft ? [-1, 1] : [p.facingRight ? 1 : -1, p.facingRight ? -1 : 1];

    for (const dir of order) {
      const probe = { x: p.x + dir * 4, y: p.y, width: p.width, height: p.height };
      const touching = solids.some(plat => !plat.oneWay && overlaps(probe, plat));
      if (!touching) continue;

      p.wallDir = dir;
      // Pushing away from the wall lets go of it, so you can always leave.
      const pushingAway = (dir > 0 && pressingLeft) || (dir < 0 && pressingRight);
      if (pushingAway) { p.wallStick = 0; return; }

      p.wallSliding = true;
      p.facingRight = dir > 0;
      // A short stick at the apex gives you time to aim the kick.
      if (!wasWallSliding) p.wallStick = PHYSICS.wallStickFrames;
      if (p.vy > this.loadout.wallSlideSpeed) p.vy = this.loadout.wallSlideSpeed;
      if (p.wallStick > 0 && p.vy > 0) p.vy = 0;

      if (!p.wallSlideCredited) {
        p.wallSlideCredited = true;
        this.#bump('wallSlides');
      }
      if (!this.reducedFlash && Math.random() < 0.35) {
        this.#spawnParticles(p.x + (dir > 0 ? p.width : 0), p.y + p.height * 0.6, 1, '#94a3b8');
      }
      return;
    }

    p.wallDir = 0;
  }

  // --- food ----------------------------------------------------------------

  #throwFood() {
    const p = this.player;
    if (!p.hasFood || this.deathReason || this.finished || this.paused) return;

    const originX = p.x + p.width / 2;
    const originY = p.y + p.height / 2;
    const dx = this.aimDir.x;
    const dy = this.aimDir.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;

    const launch = this.launchVelocity();
    p.hasFood = false;
    this.food.airborne = true;
    this.food.magnetised = false;
    this.food.x = originX - FOOD_SIZE / 2;
    this.food.y = originY - FOOD_SIZE / 2;
    this.food.vx = launch.x;
    this.food.vy = launch.y;
    this.food.catchCooldown = PHYSICS.catchCooldown;
    this.food.wallBouncesLeft = this.loadout.bagWallBounces;
    // Spent: the next throw starts from whatever is held then.
    for (const key of Object.keys(this.aimGrace)) this.aimGrace[key] = 0;

    // Judge the throw the instant it leaves your hands: a bad one should be
    // red before the bag has travelled, not four frames later.
    this.#assessBag();
    this.outlookAge = 4;
    this.#bump('foodThrown');
    this.#addFlow('throw');
    if (this.charge >= this.loadout.chargeFrames) this.#bump('chargedThrows');
    audio.throwFood();
    this.#spawnParticles(originX, originY, 4 + Math.round(this.chargeRatio() * 8), COLORS.food);
  }

  /**
   * Where a dive would send the player: at the bag when it is in the air,
   * otherwise a flat dash in the direction they are facing.
   */
  /**
   * Keeps a dive pointed at the bag while it is in the air.
   *
   * Aiming once at the moment of the dive is not a chase. The bag accelerates
   * downward the whole time, so a dive locked to its opening line sails over
   * the top of it: measured from a 329px gap, diving used to close it to
   * 325px, which is to say not at all.
   *
   * The turn is capped per frame, so it reads as tracking rather than the bag
   * dragging you around, and speed is preserved so steering never slows the
   * dive down.
   */
  #steerDive() {
    const p = this.player;
    const f = this.food;
    if (!p.diving || p.hasFood || !f.airborne) return;

    const speed = Math.hypot(p.vx, p.vy);
    if (speed < 0.01) return;

    const dx = (f.x + f.size / 2) - (p.x + p.width / 2);
    const dy = (f.y + f.size / 2) - (p.y + p.height / 2);
    if (Math.hypot(dx, dy) < 1) return;

    const heading = Math.atan2(p.vy, p.vx);
    let delta = Math.atan2(dy, dx) - heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    const turned = heading + clamp(delta, -PHYSICS.diveTurnRate, PHYSICS.diveTurnRate);
    p.vx = Math.cos(turned) * speed;
    p.vy = Math.sin(turned) * speed;
    p.facingRight = p.vx > 0;
  }

  diveTarget() {
    const p = this.player;
    const f = this.food;
    const originX = p.x + p.width / 2;
    const originY = p.y + p.height / 2;

    // The dive aims itself at the bag whenever the bag is in the air. Throw
    // up and right, then dive, and you follow it up and right — the throw
    // chooses the direction, the dive just chases.
    if (!p.hasFood && f.airborne) {
      return { x: f.x + f.size / 2, y: f.y + f.size / 2 };
    }
    // With the bag in hand it is a flat dash the way you are already facing.
    return { x: originX + (p.facingRight ? 360 : -360), y: originY };
  }

  /**
   * The velocity the bag would leave with right now, momentum included.
   *
   * The throw inherits the player's speed, so the bag does not travel along
   * the raw aim direction — running right and aiming straight up sends it up
   * and to the right. The aim indicator has to be drawn from this, or it
   * points somewhere the bag will never go.
   */
  launchVelocity() {
    const p = this.player;
    const power = this.throwPower();
    const aim = this.aimDir;

    // Momentum is projected onto the aim before it is used, so it can only
    // change how hard a throw is, never which way it goes. The bag leaves your
    // hand along the line you pointed, every time.
    //
    // Adding momentum as a vector instead bent every throw off its aim: up to
    // 37 degrees at a sprint, and 22 degrees standing still, because a grounded
    // player still carries a frame of gravity at the moment of release.
    const carried = p.vx * PHYSICS.throwInherit * PHYSICS.emptyHandBonus * aim.x
                  + p.vy * PHYSICS.throwInheritY * aim.y;

    // Momentum against the aim can take the edge off a throw but never stall
    // it, so throwing back down your own line still leaves properly.
    const speed = power + Math.max(carried, -power * PHYSICS.throwOpposeMax);
    return { x: aim.x * speed, y: aim.y * speed };
  }

  /** 0..1 — how far the current throw charge has wound up. */
  chargeRatio() {
    return Math.min(1, this.charge / this.loadout.chargeFrames);
  }

  throwPower() {
    const p = this.player;
    // Winding up on the move throws harder than standing still.
    const speed = Math.hypot(p.vx, p.vy);
    const speedBonus = Math.min(
      PHYSICS.throwSpeedBonusMax, speed * PHYSICS.throwSpeedBonus);
    return this.loadout.throwStrength
      * (1 + this.chargeRatio() * PHYSICS.throwChargeBonus)
      * (1 + speedBonus);
  }

  #stepFood() {
    const p = this.player;
    const f = this.food;

    if (p.hasFood) {
      f.x = p.x + (p.facingRight ? p.width - 8 : -FOOD_SIZE + 8);
      f.y = p.y - 16 + (p.sliding ? 18 : 0);
      f.vx = 0;
      f.vy = 0;
      f.airborne = false;
      return;
    }

    f.vy += PHYSICS.foodGravity * this.level.physics.gravityScale * this.loadout.foodGravity;
    f.x += f.vx;
    f.y += f.vy;

    if (f.catchCooldown > 0) {
      f.catchCooldown--;
    } else {
      const dx = (p.x + p.width / 2) - (f.x + f.size / 2);
      const dy = (p.y + p.height / 2) - (f.y + f.size / 2);
      const distance = Math.hypot(dx, dy);

      // A magnet reels the bag in from much further out, which turns a
      // botched throw into a recoverable one.
      const magnetActive = p.buffs.magnet > 0;
      const reach = magnetActive ? this.loadout.magnetRadius : this.loadout.catchRadius;
      f.magnetised = magnetActive && distance < reach;
      if (f.magnetised && distance > this.loadout.catchRadius) {
        const pull = 0.9;
        f.vx += (dx / distance) * pull;
        f.vy += (dy / distance) * pull;
      }

      if (distance < this.loadout.catchRadius) {
        p.hasFood = true;
        f.airborne = false;
        f.magnetised = false;
        this.recentCatchAt = this.elapsed;
        this.catchGlow = 34;
        this.bagOutlook = { state: 'good', urgency: 1, impactIn: Infinity, landing: null };
        this.#bump('foodCaught');
        if (magnetActive) this.#bump('magnetCatches');
        this.#addFlow(p.grounded ? 'catch' : 'bagBounce');
        audio.catchFood();
        this.#spawnParticles(f.x + f.size / 2, f.y + f.size / 2, 6, COLORS.food);

        // The bag bounce. Catching it in mid-air launches you well above jump
        // height and hands the air jump back, so a throw is a way to travel.
        if (!p.grounded && p.airTime >= PHYSICS.catchBoostMinAir) {
          p.vy = this.loadout.catchBoost * this.level.physics.jumpForceScale * this.loadout.jumpForce;
          p.vx *= PHYSICS.catchBoostForward;
          p.airJumps = this.loadout.airJumps;
          p.diving = false;
          p.diveArmed = false;
          p.diveTimer = 0;
          this.#bump('bagBounces');
          audio.win(3);
          this.#addShake(PHYSICS.shake.bagBounce);
          this.#spawnParticles(p.x + p.width / 2, p.y + p.height / 2, 18, COLORS.food);
        }
        return;
      }
    }

    // Landing the bag on Bert finishes the level from range. This is checked
    // before any collision, so a throw that would clip scenery on the way in
    // still counts if it gets there first.
    const toGoalX = (f.x + f.size / 2) - this.level.goalPos.x;
    const toGoalY = (f.y + f.size / 2) - this.level.goalPos.y;
    if (Math.hypot(toGoalX, toGoalY) < this.loadout.goalCatchRadius) {
      this.#deliver({ byThrow: true });
      return;
    }

    // What a hit does depends on which face the bag caught.
    const box = { x: f.x, y: f.y, width: f.size, height: f.size };
    for (const plat of this.level.platforms) {
      if (!this.#isSolidNow(plat)) continue;
      if (!overlaps(box, plat)) continue;

      // Work out the shallowest axis of overlap: that is the face it hit.
      const fromTop = (f.y + f.size) - plat.y;
      const fromBottom = (plat.y + plat.height) - f.y;
      const fromLeft = (f.x + f.size) - plat.x;
      const fromRight = (plat.x + plat.width) - f.x;
      const sideways = Math.min(fromLeft, fromRight) < Math.min(fromTop, fromBottom);

      // Floors and ceilings break it. Throwing the bag at the ground ends the
      // delivery — that is the risk that makes the throw a decision.
      if (!sideways) {
        // Cold Chain absorbs exactly one of these per level.
        if (f.floorSavesLeft > 0) {
          f.floorSavesLeft--;
          const hitTop = fromTop < fromBottom;
          f.y = hitTop ? plat.y - f.size : plat.y + plat.height;
          f.vy = (hitTop ? -1 : 1) * Math.abs(f.vy) * 0.45;
          f.vx *= 0.7;
          this.#addShake(PHYSICS.shake.bagGlance);
          audio.catchFood();
          this.#spawnParticles(f.x + f.size / 2, f.y + f.size / 2, 12, COLORS.buffShield);
          return;
        }
        this.#kill('DROPPED');
        return;
      }
      if (f.wallBouncesLeft <= 0) { this.#kill('DROPPED'); return; }

      // A wall only glances it. Most of the sideways speed is gone and some of
      // the fall speed with it, so the bag hangs by the wall long enough to
      // dive up and catch.
      f.wallBouncesLeft--;
      if (fromLeft < fromRight) f.x = plat.x - f.size;
      else f.x = plat.x + plat.width;
      f.vx = (fromLeft < fromRight ? -1 : 1) * Math.abs(f.vx) * PHYSICS.bagWallBounceDamp;
      f.vy *= PHYSICS.bagWallLift;

      this.#addShake(PHYSICS.shake.bagGlance);
      audio.land();
      this.#spawnParticles(f.x + f.size / 2, f.y + f.size / 2, 5, COLORS.food);
      return;
    }
    if (f.y > this.level.height + 400) this.#kill('DROPPED');
  }

  /** Predicted arc for the aim assist, so the throw is a read and not a prayer. */
  predictThrow() {
    const p = this.player;
    const originX = p.x + p.width / 2;
    const originY = p.y + p.height / 2;
    const dx = this.aimDir.x;
    const dy = this.aimDir.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return [];

    let x = originX;
    let y = originY;
    const launch = this.launchVelocity();
    let vx = launch.x;
    let vy = launch.y;
    const gravity = PHYSICS.foodGravity * this.level.physics.gravityScale * this.loadout.foodGravity;
    const points = [];

    for (let i = 0; i < 70; i++) {
      vy += gravity;
      x += vx;
      y += vy;
      if (i % 3 === 0) points.push({ x, y });
      const box = { x: x - FOOD_SIZE / 2, y: y - FOOD_SIZE / 2, width: FOOD_SIZE, height: FOOD_SIZE };
      if (this.level.platforms.some(plat => this.#isSolidNow(plat) && overlaps(box, plat))) break;
      if (y > this.level.height + 200) break;
    }
    return points;
  }

  /**
   * Looks ahead along the bag's arc and decides whether it is going to be
   * caught or lost.
   *
   * Only the parts that are actually knowable are treated as certain: the bag
   * already inside the catch radius, a magnet pulling it in, or an arc that
   * ends on a floor with the player nowhere near it. Everything in between is
   * left as "in the air", which is a warning rather than a verdict.
   */
  #assessBag() {
    const p = this.player;
    const f = this.food;

    if (p.hasFood || !f.airborne) {
      this.bagOutlook = { state: 'none', urgency: 0, impactIn: Infinity, landing: null };
      return;
    }

    const gravity = PHYSICS.foodGravity * this.level.physics.gravityScale * this.loadout.foodGravity;
    const catchRadius = this.loadout.catchRadius;
    const magnetActive = p.buffs.magnet > 0;

    let x = f.x + f.size / 2;
    let y = f.y + f.size / 2;
    let vx = f.vx;
    let vy = f.vy;

    // The player cannot teleport, but they can chase. Rather than guessing
    // where they will be, allow a window around where they are now that widens
    // with time: roughly run speed sideways, roughly jump speed vertically.
    // Guessing a trajectory was worse than useless — assuming they fall meant a
    // bag lobbed straight over their own head read as unreachable.
    const px = p.x + p.width / 2;
    const py = p.y + p.height / 2;
    const reachX = this.loadout.moveSpeed * PHYSICS.moveSpeed * this.loadout.emptyHandBonus;
    const reachY = 3.5;

    let closest = Infinity;
    let impactIn = Infinity;
    let landing = null;
    let fatal = false;

    for (let t = 1; t <= 150; t++) {
      vy += gravity;
      x += vx;
      y += vy;

      // How near the bag comes to anywhere the player could plausibly get to.
      // Only frames past the catch cooldown count: for that first moment after
      // a throw the bag is passing through your hands and cannot be taken back,
      // so a bag lobbed at your own feet is a loss however close it gets.
      if (t > f.catchCooldown) {
        const dx = Math.max(0, Math.abs(x - px) - reachX * t * 0.6);
        const dy = Math.max(0, Math.abs(y - py) - reachY * t);
        closest = Math.min(closest, Math.hypot(dx, dy));
      }

      const box = { x: x - f.size / 2, y: y - f.size / 2, width: f.size, height: f.size };
      const hit = this.level.platforms.find(plat => this.#isSolidNow(plat) && overlaps(box, plat));
      if (hit) {
        // A wall only glances it; a floor or ceiling ends the delivery.
        const fromTop = (box.y + f.size) - hit.y;
        const fromBottom = (hit.y + hit.height) - box.y;
        const fromLeft = (box.x + f.size) - hit.x;
        const fromRight = (hit.x + hit.width) - box.x;
        const sideways = Math.min(fromLeft, fromRight) < Math.min(fromTop, fromBottom);
        impactIn = t;
        landing = { x, y };
        fatal = !sideways && f.floorSavesLeft <= 0;
        break;
      }
      if (y > this.level.height + 200) { impactIn = t; fatal = true; landing = { x, y }; break; }
    }

    // Certain good: it is already in reach, or a magnet has hold of it.
    const distanceNow = Math.hypot(px - (f.x + f.size / 2), py - (f.y + f.size / 2));
    const inHand = distanceNow < catchRadius * 1.25 && f.catchCooldown <= 0;
    const good = inHand || f.magnetised || (magnetActive && distanceNow < this.loadout.magnetRadius);

    // A near pass counts even when the arc ends on a floor: the floor is only
    // what happens if the catch is missed, and saying "lost" about a bag that
    // is about to sail through your hands is exactly backwards.
    if (good || closest < catchRadius * 1.1) {
      this.bagOutlook = { state: 'good', urgency: 0.5, impactIn, landing };
      return;
    }

    // Urgency rises as the impact approaches, and is worst when the arc ends
    // somewhere the player plainly cannot get to.
    const doomed = fatal && closest > catchRadius * 2.2;
    const urgency = impactIn === Infinity ? 0.3
      : Math.min(1, 1 - impactIn / 150) * (doomed ? 1 : 0.7);
    this.bagOutlook = { state: 'bad', urgency: Math.max(0.25, urgency), impactIn, landing };
  }

  #stepRings() {
    for (const ring of this.rings) ring.age++;
    if (this.rings.length) {
      this.rings = this.rings.filter(r => r.age < PHYSICS.airJumpRingFrames);
    }
  }

  // --- pickups & vehicles --------------------------------------------------

  #stepPickups() {
    const p = this.player;
    const box = { x: p.x, y: p.y, width: p.width, height: p.height };

    for (const pu of this.level.powerups) {
      if (pu.collected) continue;
      if (!overlaps(box, pu)) continue;
      pu.collected = true;
      this.#applyPowerup(pu.type);
      const meta = POWERUP_BY_ID[pu.type];
      audio.pickup();
      this.#spawnParticles(pu.x + pu.width / 2, pu.y + pu.height / 2, 14, meta?.color ?? COLORS.food);
    }

    if (p.vehicle) return;
    for (const v of this.level.vehicles) {
      if (v.inUse) continue;
      if (v.cooldown > 0) { v.cooldown--; continue; } // don't re-board instantly
      if (!overlaps(box, v)) continue;
      v.inUse = true;
      p.vehicle = v;
      p.boost = 0;
      p.boostCharge = 0;
      this.#bump(v.type === 'car' ? 'carRides' : 'bikeRides');
      audio.vehicle();
      this.#spawnParticles(v.x + v.width / 2, v.y, 10, v.type === 'car' ? COLORS.car : COLORS.bike);
      return;
    }
  }

  #applyPowerup(type) {
    const p = this.player;
    switch (type) {
      case 'speed':  p.buffs.speed = PHYSICS.buffFrames; break;
      case 'jump':   p.buffs.jump = PHYSICS.buffFrames; break;
      case 'shield': p.buffs.shield = this.loadout.shieldDuration; break;
      case 'magnet': p.buffs.magnet = this.loadout.magnetDuration; break;
      default: return;
    }
    const meta = POWERUP_BY_ID[type];
    if (meta?.stat) this.#bump(meta.stat);
  }

  #exitVehicle() {
    const p = this.player;
    if (!p.vehicle) return;
    p.vehicle.inUse = false;
    // Left where you abandoned it, and boardable again after a moment. The
    // old build burned a vehicle permanently the first time you got off.
    p.vehicle.cooldown = 45;
    p.vehicle = null;
    p.boost = 0;
    p.vy = Math.min(p.vy, -8); // hop out
    audio.jump();
  }

  // --- hazards, goal, particles -------------------------------------------

  #stepHazards() {
    const p = this.player;
    const box = { x: p.x, y: p.y, width: p.width, height: p.height };

    // A hazard skimmed at speed is the most watchable thing in a run that
    // never actually goes wrong, so flag it for the reel.
    if (this.recorder && this.nearMissCooldown <= 0 && Math.hypot(p.vx, p.vy) > 9) {
      const grazed = this.level.platforms.some(plat => {
        if (plat.type !== 'spike' && !(plat.type === 'laser' && plat.active)) return false;
        const dx = Math.max(plat.x - (p.x + p.width), p.x - (plat.x + plat.width), 0);
        const dy = Math.max(plat.y - (p.y + p.height), p.y - (plat.y + plat.height), 0);
        return Math.hypot(dx, dy) < 26;
      });
      if (grazed) {
        this.recorder.mark('nearMiss', 5);
        this.nearMissCooldown = 60;
      }
    }
    if (this.nearMissCooldown > 0) this.nearMissCooldown--;

    for (const plat of this.level.platforms) {
      if (plat.type === 'spike') {
        if (overlaps(box, plat)) return this.#kill('SPIKE');
      } else if (plat.type === 'laser' && plat.active) {
        if (overlaps(box, plat)) return this.#kill('LASER');
        // Audible warning when you're in the beam's lane but not in it yet.
        if (Math.abs((plat.x + plat.width / 2) - (p.x + p.width / 2)) < 90) audio.laser();
      } else if (plat.type === 'door' && plat.active) {
        // A door that closed on top of you.
        if (overlaps(box, plat) && plat.height > 24) return this.#kill('CRUSHED');
      }
    }
  }

  /** The prompt for whichever teaching zone the player is standing in. */
  #stepHint() {
    const p = this.player;
    const box = { x: p.x, y: p.y, width: p.width, height: p.height };
    const zone = this.level.hints.find(h => overlaps(box, h));
    this.hint = zone?.text ?? null;
  }

  #stepGoal() {
    const p = this.player;
    if (!p.hasFood) return;

    const dx = (p.x + p.width / 2) - this.level.goalPos.x;
    const dy = (p.y + p.height / 2) - this.level.goalPos.y;
    if (Math.hypot(dx, dy) > GOAL_RADIUS) return;

    this.#deliver({ byThrow: false });
  }

  /**
   * Completes the level, by hand or by throw. Latched: the old build called
   * onWin every frame you stood on the goal, paying out tips over and over.
   */
  #deliver({ byThrow }) {
    if (this.finished || this.deathReason) return;
    this.finished = true;

    this.recorder?.mark('finish', 99);
    if (byThrow) {
      this.#addFlow('airDelivery');
      this.#bump('airDeliveries');
      this.food.airborne = false;
    }

    audio.win();
    this.#spawnParticles(this.level.goalPos.x, this.level.goalPos.y, byThrow ? 40 : 26, COLORS.food);
    this.#flushStats();
    this.onWin({
      timeMs: this.elapsed,
      byThrow,
      // "Clutch" means you caught the bag on the way in rather than walking it
      // over — the food was still in the air moments before you arrived.
      clutch: byThrow || this.food.catchCooldown > 0 || this.recentCatchAt > this.elapsed - 900,
      bestFlow: this.bestFlow,
      flowMultiplier: this.flowMultiplier(),
      flowEvents: this.flowEvents,
    });
  }

  #kill(reason) {
    if (this.deathReason || this.finished) return; // only the first cause counts
    const p = this.player;

    // Brief grace after a shield pops, so one spike does not eat two charges.
    if (p.invuln > 0) return;

    // A shield absorbs anything except losing the bag — that is the one
    // failure the delivery cannot come back from.
    if (p.buffs.shield > 0 && reason !== 'DROPPED') {
      p.buffs.shield = 0;
      p.invuln = 48;
      p.vy = Math.min(p.vy, -9);
      p.vx = (p.facingRight ? -1 : 1) * 7; // knocked back out of the hazard
      p.diving = false;
      if (p.sliding) this.#endSlide();
      this.#addShake(PHYSICS.shake.shield);
      this.#bump('shieldsUsed');
      audio.wallJump();
      this.#spawnParticles(p.x + p.width / 2, p.y + p.height / 2, 20, COLORS.buffShield);
      return;
    }

    this.deathReason = reason;
    this.deathTimer = 520;
    this.#addShake(PHYSICS.shake.death);
    this.#bump('totalDeaths');
    this.#bump({
      DROPPED: 'deathsByDrop',
      SPIKE: 'deathsBySpike',
      LASER: 'deathsByLaser',
      FELL: 'deathsByFall',
      CRUSHED: 'deathsByCrush',
    }[reason] ?? 'deathsByFall');
    audio.death();
    this.#spawnParticles(p.x + PLAYER_W / 2, p.y + PLAYER_H / 2, 24, this.skin.color);
    this.#flushStats();
  }

  /** Adds screen shake, capped and scaled by the player's settings. */
  #addShake(amount) {
    if (this.shakeScale <= 0) return;
    this.shake = Math.min(PHYSICS.shake.max, this.shake + amount * this.shakeScale);
  }

  #spawnParticles(x, y, count, color) {
    if (this.reducedFlash) count = Math.ceil(count / 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 26 + Math.random() * 18,
        maxLife: 44,
        color,
        size: 2 + Math.random() * 3,
      });
    }
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  #stepParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.vy += 0.22;
      q.x += q.vx;
      q.y += q.vy;
      q.life--;
      if (q.life <= 0) this.particles.splice(i, 1);
    }
  }

  #stepCamera() {
    const p = this.player;
    const maxX = Math.max(0, this.level.width - VIEW_W);
    const maxY = Math.max(0, this.level.height - VIEW_H);

    // Look ahead along the direction of travel, but ease the look-ahead itself
    // rather than reading velocity straight off the player. The player's speed
    // can change by its full amount in a single frame — that is what stopping
    // dead means — and feeding that to the camera makes it lurch every time.
    const wantX = clamp(p.vx * PHYSICS.cameraLeadX, -PHYSICS.cameraLeadMaxX, PHYSICS.cameraLeadMaxX);
    const wantY = clamp(p.vy * PHYSICS.cameraLeadY, -PHYSICS.cameraLeadMaxY, PHYSICS.cameraLeadMaxY);
    this.cameraLead.x += (wantX - this.cameraLead.x) * PHYSICS.cameraLeadEase;
    this.cameraLead.y += (wantY - this.cameraLead.y) * PHYSICS.cameraLeadEase;

    const targetX = clamp(p.x + p.width / 2 + this.cameraLead.x - VIEW_W / 2, 0, maxX);
    const targetY = clamp(p.y + p.height / 2 + this.cameraLead.y - VIEW_H / 2, 0, maxY);

    this.camera.x += (targetX - this.camera.x) * PHYSICS.cameraEase;
    this.camera.y += (targetY - this.camera.y) * PHYSICS.cameraEase;

    // Settle exactly rather than easing towards the target forever.
    if (Math.abs(targetX - this.camera.x) < 0.2) this.camera.x = targetX;
    if (Math.abs(targetY - this.camera.y) < 0.2) this.camera.y = targetY;
  }

  // --- replay --------------------------------------------------------------

  /**
   * Advances the reel. Clips are played in order at whatever speed the caller
   * has set, and the player and bag are placed from the recording rather than
   * simulated, so nothing can diverge from the run that actually happened.
   */
  #stepReplay(deltaMs) {
    const reel = this.replay;
    const clip = reel.clips[reel.index];
    if (!clip) { this.onReplayEnd(); return; }

    this.replayCursor += (deltaMs / SIM_STEP) * this.replaySpeed;
    let cursor = clip.from + this.replayCursor;
    let cut = false;

    if (cursor > clip.to) {
      reel.index++;
      this.replayCursor = 0;
      if (reel.index >= reel.clips.length) { this.onReplayEnd(); return; }
      cursor = reel.clips[reel.index].from;
      cut = true;
    }

    // The recording is 60Hz but slow motion asks to see it at a fraction of
    // that, so show the position between two recorded frames rather than the
    // nearer one. Without this the same frame is held for three or four
    // displayed frames and then jumps, which is what makes slow motion judder.
    const last = reel.frames.length - 1;
    const i = Math.min(Math.floor(cursor), last);
    const a = reel.frames[i];
    const b = reel.frames[Math.min(i + 1, last)];
    if (a) this.#applyFrame(a, b, cursor - i);

    // Platforms, lasers and doors keep cycling so the world is alive behind
    // the action, and particles keep settling.
    this.worldTime += deltaMs * this.replaySpeed;
    this.#stepPlatforms();
    this.#stepParticles();
    this.#stepRings();

    // The move being shown, if the cursor has just gone past a mark.
    const absolute = Math.floor(cursor) + (reel.dropped ?? 0);
    const recent = (reel.marks ?? []).filter(m =>
      m.frame <= absolute && m.frame > absolute - 40);
    this.replayLabel = recent.length ? recent[recent.length - 1].label : '';

    if (cut) {
      // A reel is one continuous take now, so this only runs if something ever
      // hands the engine several clips again. Place the camera rather than
      // easing it: sliding across the level between two unrelated moments is a
      // swoop, not an edit.
      this.snapCamera();
    } else {
      this.#frameCamera();
    }
  }

  /**
   * Places the world from a recorded frame, optionally `t` of the way towards
   * the next one. Only continuous values are blended; flags and facing come
   * from the frame actually being shown.
   */
  #applyFrame(f, next, t = 0) {
    if (next && t > 0) {
      // A gap this large is a teleport, not motion, so do not slide through it.
      const jumped = Math.abs(next.x - f.x) > 200 || Math.abs(next.y - f.y) > 200;
      if (!jumped) {
        const mix = (from, to) => from + (to - from) * t;
        f = {
          ...f,
          x: mix(f.x, next.x), y: mix(f.y, next.y),
          vx: mix(f.vx, next.vx), vy: mix(f.vy, next.vy),
          fx: mix(f.fx, next.fx), fy: mix(f.fy, next.fy),
          t: mix(f.t, next.t), flow: mix(f.flow, next.flow),
        };
      }
    }
    this.#placeFrame(f);
  }

  /** Writes one frame's values straight into the world. */
  #placeFrame(f) {
    const p = this.player;
    p.x = f.x; p.y = f.y; p.width = f.w; p.height = f.h;
    p.vx = f.vx; p.vy = f.vy;
    p.facingRight = f.face;
    p.sliding = f.slide;
    p.diving = f.dive;
    p.wallSliding = f.wall;
    p.wallDir = f.wallDir;
    p.hasFood = f.hasFood;
    p.buffs.shield = f.shield ? 1 : 0;
    p.buffs.magnet = f.magnet ? 1 : 0;
    p.buffs.speed = f.speed ? 1 : 0;
    p.buffs.jump = f.jump ? 1 : 0;
    // A run that used a bike or a car has to replay on it; without this the
    // courier glided along at vehicle speed with nothing under them.
    p.vehicle = f.veh ? { type: f.veh } : null;
    this.food.x = f.fx;
    this.food.y = f.fy;
    this.food.airborne = f.fair;
    this.elapsed = f.t;
    this.flow = f.flow;
  }

  /**
   * The replay camera: the same view you played with, leaning towards the bag
   * while it is loose.
   *
   * It used to push in tight on each moment, which is fine for a trailer and
   * useless for watching what you did. This keeps the player framed as in
   * play, and drifts part of the way towards the bag when it is in the air so
   * a throw and its catch are both on screen.
   */
  #frameCamera() {
    const p = this.player;
    const f = this.food;
    const view = { w: VIEW_W / this.replayZoom, h: VIEW_H / this.replayZoom };
    const maxX = Math.max(0, this.level.width - view.w);
    const maxY = Math.max(0, this.level.height - view.h);

    let focusX = p.x + p.width / 2;
    let focusY = p.y + p.height / 2;
    if (!p.hasFood && f.airborne) {
      // Part of the way, not all: the player stays the subject.
      focusX += ((f.x + f.size / 2) - focusX) * PHYSICS.replayBagBias;
      focusY += ((f.y + f.size / 2) - focusY) * PHYSICS.replayBagBias;
    }

    const targetX = clamp(focusX - view.w / 2, 0, maxX);
    const targetY = clamp(focusY - view.h / 2, 0, maxY);
    this.camera.x += (targetX - this.camera.x) * PHYSICS.replayCameraEase;
    this.camera.y += (targetY - this.camera.y) * PHYSICS.replayCameraEase;
  }

  /** Places the camera on the player without easing, for the first frame. */
  snapCamera() {
    const p = this.player;
    const view = { w: VIEW_W / this.replayZoom, h: VIEW_H / this.replayZoom };
    this.camera.x = clamp(p.x + p.width / 2 - view.w / 2, 0,
      Math.max(0, this.level.width - view.w));
    this.camera.y = clamp(p.y + p.height / 2 - view.h / 2, 0,
      Math.max(0, this.level.height - view.h));
  }

  // --- flow ----------------------------------------------------------------

  /**
   * Records a move into the chain. Repeating the same move straight away is
   * worth less, so holding one button does not build flow.
   */
  #addFlow(move) {
    const base = FLOW.values[move] ?? 1;
    // The flow weight doubles as "how worth watching is this".
    this.recorder?.mark(move, base);
    const value = move === this.lastMove ? base * FLOW.repeatFalloff : base;
    this.lastMove = move;
    this.flow = Math.min(FLOW.max, this.flow + value);
    this.flowTimer = this.loadout.flowWindow;
    this.flowEvents++;
    this.bestFlow = Math.max(this.bestFlow, this.flow);
    this.#beginRun();
  }

  #decayFlow() {
    if (this.flowTimer > 0) {
      this.flowTimer -= 1;
      if (this.flowTimer <= 0) {
        this.flow = 0;
        this.lastMove = null;
      }
    }
  }

  /** Starts the clock on the player's first real input. */
  #beginRun() {
    if (this.started || this.finished) return;
    this.started = true;
  }

  /** 1..the loadout's cap, from the best chain held this run. */
  flowMultiplier() {
    const ratio = Math.min(1, this.bestFlow / FLOW.max);
    return 1 + ratio * (this.loadout.flowMaxMultiplier - 1);
  }

  // --- stats batching ------------------------------------------------------

  #bump(key, amount = 1) {
    this.pendingStats.set(key, (this.pendingStats.get(key) ?? 0) + amount);
  }

  #flushStatsIfDue(now) {
    if (now - this.statFlushAt < 1000) return;
    this.statFlushAt = now;
    this.#flushStats();
  }

  #flushStats() {
    if (this.pendingStats.size === 0) return;
    const batch = new Map(this.pendingStats);
    this.pendingStats.clear();
    this.onStats(batch);
  }

  /** Live values for the HUD; read once per animation frame by the UI. */
  getHudState() {
    const p = this.player;
    return {
      elapsed: this.elapsed,
      parTime: this.level.parTime,
      hasFood: p.hasFood,
      foodAirborne: this.food.airborne,
      dead: Boolean(this.deathReason),
      buffs: {
        speed: p.buffs.speed,
        jump: p.buffs.jump,
        shield: p.buffs.shield,
        magnet: p.buffs.magnet,
      },
      vehicle: p.vehicle?.type ?? null,
      boost: p.boost,
      boostReady: Boolean(p.vehicle) && p.boost <= 0 && p.boostCharge <= 0,
      airJumps: p.airJumps,
      maxAirJumps: this.loadout.airJumps,
      diveReady: p.diveCooldown <= 0,
      slideReady: p.slideCooldown <= 0,
      charge: this.chargeRatio(),
      charging: this.charging,
      aiming: this.aiming,
      aimDir: this.aimDir,
      hint: this.hint,
      // How far ahead of the best run you are, in pixels of progress. Null
      // when there is no ghost to compare against.
      ghostLead: this.ghostPose
        ? (this.player.x - this.ghostPose.x)
        : null,
      bag: this.catchGlow > 0
        ? { state: 'good', urgency: this.catchGlow / 34 }
        : { state: this.bagOutlook.state, urgency: this.bagOutlook.urgency },
      started: this.started,
      flow: this.flow,
      flowRatio: Math.min(1, this.flow / FLOW.max),
      flowTimeLeft: this.flowTimer / this.loadout.flowWindow,
      flowMultiplier: this.flowMultiplier(),
      bagWallBouncesLeft: this.food.airborne ? this.food.wallBouncesLeft : null,
      paused: this.paused,
    };
  }

  /**
   * Where the ghost is at the current clock reading.
   *
   * Indexed by elapsed time rather than by frame, because the clock does not
   * start until the first input: a ghost indexed by frame would set off while
   * you were still reading the level.
   */
  #ghostPoseNow() {
    const g = this.ghost;
    if (!g?.samples?.length) return null;

    const cursor = (this.elapsed / 1000) * g.rate;
    const last = g.samples.length - 1;
    if (cursor >= last) return { ...g.samples[last], done: true };

    const i = Math.max(0, Math.floor(cursor));
    const a = g.samples[i];
    const b = g.samples[Math.min(i + 1, last)];
    const t = cursor - i;
    const mix = (from, to) => from + (to - from) * t;
    return {
      ...a,
      x: mix(a.x, b.x), y: mix(a.y, b.y),
      fx: mix(a.fx, b.fx), fy: mix(a.fy, b.fy),
      done: false,
    };
  }

  /**
   * Flags the thin platforms with nothing under them.
   *
   * A 100x20 bar alone in a tall shaft is drawn exactly like a slab of ground,
   * so it reads as a stray rectangle rather than as somewhere to stand. These
   * get struts and a shadow instead, which is the difference between debris and
   * a catwalk someone bolted there.
   *
   * Done once, not per frame: it only depends on the level's fixed geometry.
   */
  #markFloating() {
    const solid = this.level.platforms.filter(p => isSolidType(p.type));
    for (const plat of solid) {
      if (plat.height > 34) continue;
      const under = solid.some(q => q !== plat
        && q.x < plat.x + plat.width && q.x + q.width > plat.x
        && q.y >= plat.y + plat.height && q.y < plat.y + plat.height + 130);
      plat.floating = !under;
    }
  }

  // --- rendering -----------------------------------------------------------

  /**
   * Matches the backing store to the display's real pixels.
   *
   * Everything downstream keeps drawing in a fixed 800x600 space; the base
   * transform does the scaling. Capped at 3x because past that the extra
   * pixels cost more than they show.
   */
  #sizeCanvas() {
    const dpr = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 3);
    this.renderScale = dpr;
    const w = Math.round(VIEW_W * dpr);
    const h = Math.round(VIEW_H * dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  #render() {
    const ctx = this.ctx;
    const cam = this.camera;

    // Cheap, and it picks up a window dragged onto a different monitor.
    this.#sizeCanvas();
    ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);

    ctx.save();
    if (this.shake > PHYSICS.shake.cutoff) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this.#drawBackground(ctx);

    ctx.save();
    // Replays push in on the action; normal play is always 1:1.
    if (this.replayZoom !== 1) ctx.scale(this.replayZoom, this.replayZoom);
    // Snap the camera to whole device pixels, not whole world units: under a
    // push-in the two are not the same, and rounding the world position makes
    // the view jump in zoom-sized steps.
    const snap = this.renderScale * this.replayZoom;
    ctx.translate(-Math.round(cam.x * snap) / snap, -Math.round(cam.y * snap) / snap);

    this.#drawGoal(ctx);
    this.#drawPlatforms(ctx);
    // Behind everything that matters: the ghost must never hide a hazard or
    // be mistaken for the bag.
    this.#drawGhost(ctx);
    this.#drawPowerups(ctx);
    this.#drawVehicles(ctx);
    if (!this.deathReason && !this.replay) this.#drawAim(ctx);
    this.#drawFood(ctx);
    if (!this.deathReason) this.#drawPlayer(ctx);
    this.#drawRings(ctx);
    this.#drawParticles(ctx);

    ctx.restore();
    ctx.restore();

    if (this.deathReason) this.#drawDeathOverlay(ctx);
  }

  #drawBackground(ctx) {
    // Backdrops live in their own module and draw in screen space with the
    // camera passed in as parallax, so none of this can touch the simulation.
    this.backdrop(ctx, {
      cam: this.camera,
      time: this.worldTime,
      base: this.level.background,
      shadeColor: shade,
      reducedFlash: this.reducedFlash,
    });
  }

  #drawPlatforms(ctx) {
    const cam = this.camera;
    for (const plat of this.level.platforms) {
      // Cull anything off-screen; big levels have 70+ platforms.
      if (plat.x + plat.width < cam.x - 60 || plat.x > cam.x + VIEW_W + 60) continue;
      if (plat.y + plat.height < cam.y - 60 || plat.y > cam.y + VIEW_H + 60) continue;

      switch (plat.type) {
        case 'spike': this.#drawSpikes(ctx, plat); break;
        case 'laser': this.#drawLaser(ctx, plat); break;
        case 'door': this.#drawDoor(ctx, plat); break;
        case 'vanishing': this.#drawVanishing(ctx, plat); break;
        case 'moving': this.#drawBlock(ctx, plat, COLORS.moving); break;
        default: this.#drawBlock(ctx, plat, COLORS.platform);
      }

      if (plat.conveyorVel) this.#drawConveyorArrows(ctx, plat);
    }
  }

  #drawBlock(ctx, plat, color) {
    const { x, y, width: w, height: h } = plat;

    // A bar hanging in space gets struts and a shadow so it reads as installed
    // rather than as a rectangle someone forgot to finish.
    if (plat.floating) {
      const inset = Math.min(14, w * 0.18);
      const drop = 16;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x + inset, y + h, 6, drop);
      ctx.fillRect(x + w - inset - 6, y + h, 6, drop);
      // A soft shadow under the whole span, so it sits in the space rather
      // than floating on top of it.
      const shadow = ctx.createLinearGradient(0, y + h, 0, y + h + drop + 10);
      shadow.addColorStop(0, 'rgba(0,0,0,0.22)');
      shadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadow;
      ctx.fillRect(x, y + h, w, drop + 10);
      ctx.restore();
    }

    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    // Lit top edge reads as a surface you can land on.
    ctx.fillStyle = shade(color, 38);
    ctx.fillRect(x, y, w, Math.min(5, h));
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x, y + h - Math.min(4, h), w, Math.min(4, h));
  }

  #drawVanishing(ctx, plat) {
    if (plat.opacity <= 0.02) {
      // Ghost outline so you know it's coming back.
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = COLORS.vanishing;
      ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalAlpha = plat.opacity;
    this.#drawBlock(ctx, plat, COLORS.vanishing);
    ctx.restore();
  }

  #drawSpikes(ctx, plat) {
    ctx.fillStyle = COLORS.spike;
    ctx.beginPath();
    const teeth = Math.max(1, Math.floor(plat.width / 20));
    const step = plat.width / teeth;
    for (let i = 0; i < teeth; i++) {
      const x = plat.x + i * step;
      ctx.moveTo(x, plat.y + plat.height);
      ctx.lineTo(x + step / 2, plat.y);
      ctx.lineTo(x + step, plat.y + plat.height);
    }
    ctx.fill();
  }

  #drawLaser(ctx, plat) {
    if (plat.active) {
      ctx.save();
      if (!this.reducedFlash) {
        ctx.shadowColor = COLORS.laserOn;
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = COLORS.laserOn;
      ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(plat.x + plat.width * 0.3, plat.y, plat.width * 0.4, plat.height);
      ctx.restore();
    } else {
      ctx.fillStyle = COLORS.laserOff;
      ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
    }
    // Emitters at both ends make the beam readable when it's off.
    ctx.fillStyle = '#334155';
    ctx.fillRect(plat.x - 4, plat.y - 8, plat.width + 8, 8);
    ctx.fillRect(plat.x - 4, plat.y + plat.height, plat.width + 8, 8);
  }

  #drawDoor(ctx, plat) {
    if (plat.active) {
      this.#drawBlock(ctx, plat, COLORS.door);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        const y = plat.y + (plat.height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(plat.x, y);
        ctx.lineTo(plat.x + plat.width, y);
        ctx.stroke();
      }
    } else {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = COLORS.door;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);
      ctx.restore();
    }
  }

  #drawConveyorArrows(ctx, plat) {
    const dir = Math.sign(plat.conveyorVel);
    const offset = (this.worldTime * 0.03 * dir) % 40;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plat.x, plat.y, plat.width, plat.height);
    ctx.clip();
    ctx.fillStyle = COLORS.conveyor;
    ctx.globalAlpha = 0.55;
    for (let x = plat.x - 40; x < plat.x + plat.width + 40; x += 40) {
      const ax = x + offset;
      ctx.beginPath();
      ctx.moveTo(ax, plat.y + 4);
      ctx.lineTo(ax + 12 * dir, plat.y + plat.height / 2);
      ctx.lineTo(ax, plat.y + plat.height - 4);
      ctx.fill();
    }
    ctx.restore();
  }

  #drawPowerups(ctx) {
    for (const pu of this.level.powerups) {
      if (pu.collected) continue;
      const meta = POWERUP_BY_ID[pu.type] ?? POWERUP_BY_ID.speed;
      const bob = Math.sin(this.worldTime / 260 + pu.x) * 5;
      const cx = pu.x + pu.width / 2;
      const cy = pu.y + pu.height / 2 + bob;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.worldTime / 700);
      if (!this.reducedFlash) { ctx.shadowColor = meta.color; ctx.shadowBlur = 14; }
      ctx.fillStyle = meta.color;
      ctx.fillRect(-pu.width / 2, -pu.height / 2, pu.width, pu.height);
      ctx.restore();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(meta.glyph, cx, cy);
      ctx.textBaseline = 'alphabetic';
    }
  }

  #drawVehicles(ctx) {
    for (const v of this.level.vehicles) {
      const color = v.type === 'car' ? COLORS.car : COLORS.bike;
      if (v.inUse && this.player.boost > 0 && !this.reducedFlash) {
        // Exhaust plume behind a boosting vehicle.
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#fb923c';
        const back = this.player.facingRight ? v.x - 18 : v.x + v.width;
        ctx.fillRect(back, v.y + v.height * 0.3, 18, v.height * 0.4);
        ctx.restore();
      }
      ctx.fillStyle = v.inUse ? shade(color, 30) : color;
      ctx.fillRect(v.x, v.y, v.width, v.height);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(v.x + 4, v.y + 4, v.width - 8, v.height * 0.4);
      // Wheels
      ctx.fillStyle = '#0f172a';
      const r = v.height * 0.28;
      ctx.beginPath();
      ctx.arc(v.x + v.width * 0.22, v.y + v.height, r, 0, Math.PI * 2);
      ctx.arc(v.x + v.width * 0.78, v.y + v.height, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawGoal(ctx) {
    const { x, y } = this.level.goalPos;
    const bob = Math.sin(this.worldTime / 260) * 6;

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(x, y + bob, GOAL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Bert: a simple figure rather than an emoji, which rendered as a box on
    // any machine without the emoji font.
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, -26, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-16, -12, 32, 40);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-24, -8, 8, 26);
    ctx.fillRect(16, -8, 8, 26);
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BERT', x, y + bob + 46);
  }

  #drawAim(ctx) {
    const p = this.player;
    const originX = p.x + p.width / 2;
    const originY = p.y + p.height / 2;

    if (p.hasFood) {
      const arc = this.predictThrow();
      ctx.save();
      ctx.fillStyle = COLORS.aim;
      for (let i = 0; i < arc.length; i++) {
        const fade = 1 - i / arc.length;
        ctx.globalAlpha = 0.5 * fade;
        ctx.beginPath();
        ctx.arc(arc[i].x, arc[i].y, 3 * fade + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Aim indicator: an arrow out of the player showing the throw direction,
    // growing as the charge winds up. There is no cursor any more — the arrow
    // keys choose this.
    if (p.hasFood) {
      const charge = this.chargeRatio();
      // Drawn along the velocity the bag will actually leave with, so the
      // arrow and the dotted arc always agree with each other.
      const launch = this.launchVelocity();
      const speed = Math.hypot(launch.x, launch.y) || 1;
      const dirX = launch.x / speed;
      const dirY = launch.y / speed;
      const length = 46 + charge * 54;
      const tipX = originX + dirX * length;
      const tipY = originY + dirY * length;

      ctx.save();
      ctx.globalAlpha = this.charging ? 0.95 : 0.4;
      ctx.strokeStyle = charge >= 1 ? '#fbbf24' : '#ffffff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(originX + dirX * 20, originY + dirY * 20);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(dirY, dirX);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle - 0.4) * 13, tipY - Math.sin(angle - 0.4) * 13);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle + 0.4) * 13, tipY - Math.sin(angle + 0.4) * 13);
      ctx.stroke();
      ctx.restore();

      // Charge ring around the player while winding up.
      if (charge > 0.01) {
        ctx.save();
        ctx.strokeStyle = charge >= 1 ? '#fbbf24' : '#ffffff';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(originX, originY, 34, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Dive target: shows where E will send you, which is the bag when it is
    // loose. Only drawn when a dive is actually available.
    if (p.diveCooldown <= 0 && !p.vehicle) {
      const target = this.diveTarget();
      ctx.save();
      ctx.globalAlpha = p.hasFood ? 0.18 : 0.45;
      ctx.strokeStyle = this.skin.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(target.x, target.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Where the bag is going to come down, for anyone carrying the marker.
    if (this.loadout.landingMarker && !p.hasFood && this.bagOutlook.landing) {
      const mark = this.bagOutlook.landing;
      const bad = this.bagOutlook.state === 'bad';
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = bad ? '#ef4444' : '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mark.x - 14, mark.y);
      ctx.lineTo(mark.x + 14, mark.y);
      ctx.moveTo(mark.x, mark.y - 14);
      ctx.lineTo(mark.x, mark.y + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Line to the loose food so you never lose track of it off-screen.
    if (!p.hasFood) {
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(251,191,36,0.35)';
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(this.food.x + this.food.size / 2, this.food.y + this.food.size / 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #drawFood(ctx) {
    const f = this.food;
    const bob = f.airborne ? 0 : Math.sin(this.worldTime / 200) * 2;

    ctx.save();
    ctx.translate(f.x + f.size / 2, f.y + f.size / 2 + bob);
    if (f.airborne) ctx.rotate(this.worldTime / 120);

    // Takeaway bag
    ctx.fillStyle = '#d97706';
    ctx.fillRect(-f.size / 2, -f.size / 2, f.size, f.size);
    ctx.fillStyle = '#b45309';
    ctx.fillRect(-f.size / 2, -f.size / 2, f.size, 6);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(-5, -2, 10, 9);
    ctx.restore();

    if (f.airborne) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = COLORS.food;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x + f.size / 2, f.y + f.size / 2, this.loadout.catchRadius, 0, Math.PI * 2);
      ctx.setLineDash([4, 8]);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draws the best run's ghost: a translucent outline of where you were at
   * this point in your best time, so you can see whether you are ahead.
   */
  #drawGhost(ctx) {
    if (!this.ghost || this.replay) return;
    const pose = this.#ghostPoseNow();
    this.ghostPose = pose;
    if (!pose) return;

    const cam = this.camera;
    const h = pose.slide ? SLIDE_H : PLAYER_H;
    const y = pose.y;
    // Cull: big levels are several thousand pixels wide.
    if (pose.x + PLAYER_W < cam.x - 40 || pose.x > cam.x + VIEW_W + 40) return;
    if (y + h < cam.y - 40 || y > cam.y + VIEW_H + 40) return;

    ctx.save();
    // It fades out once the ghost has finished, rather than standing on the
    // goal for the rest of your attempt.
    ctx.globalAlpha = pose.done ? 0.12 : 0.34;

    if (pose.dive) {
      ctx.fillStyle = 'rgba(148,163,184,0.35)';
      ctx.fillRect(pose.x - 6, y, PLAYER_W + 12, h);
    }

    ctx.fillStyle = this.skin.color;
    ctx.fillRect(pose.x, y, PLAYER_W, h);

    // Enough detail to read which way it is facing and what it is doing,
    // without becoming a second player you might track by mistake.
    ctx.fillStyle = 'rgba(2,6,23,0.55)';
    ctx.fillRect(pose.x + (pose.face ? PLAYER_W - 12 : 4), y + 6, 8, 6);
    ctx.fillStyle = shade(this.skin.color, -30);
    ctx.fillRect(pose.x + (pose.face ? -6 : PLAYER_W), y + 8, 6, Math.max(10, h - 22));

    if (pose.wall) {
      ctx.fillStyle = 'rgba(148,163,184,0.4)';
      ctx.fillRect(pose.x + (pose.wallDir > 0 ? PLAYER_W : -4), y + 6, 4, h - 12);
    }

    // The ghost's bag, but only while it is in the air: a bag drawn in its
    // hand every frame is noise.
    if (pose.fair) {
      ctx.globalAlpha = pose.done ? 0.1 : 0.3;
      ctx.fillStyle = COLORS.food;
      ctx.fillRect(pose.fx, pose.fy, FOOD_SIZE, FOOD_SIZE);
    }

    ctx.restore();
  }

  /** The shockwave an air jump leaves behind it. */
  #drawRings(ctx) {
    if (this.reducedFlash) return;
    for (const ring of this.rings) {
      const t = ring.age / PHYSICS.airJumpRingFrames;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.55;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2.5 * (1 - t) + 0.5;
      ctx.beginPath();
      // Flattened: it reads as a puff pushed off underfoot rather than a
      // bubble the player is sitting inside.
      ctx.ellipse(ring.x, ring.y, 10 + t * 46, 5 + t * 20, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #drawPlayer(ctx) {
    const p = this.player;
    const x = p.x;
    const y = p.y;
    const w = p.width;
    const h = p.height;

    // The air-jump flip. Rotating about the player's own centre keeps the
    // collision box exactly where it was: this is animation, nothing else.
    const spinning = p.spin > 0 && !p.vehicle;
    if (spinning) {
      const t = 1 - p.spin / PHYSICS.airJumpSpinFrames;
      // Eased so it whips round at the start and settles level, rather than
      // stopping dead at whatever angle the last frame happened to land on.
      const turn = (1 - Math.pow(1 - t, 3)) * Math.PI * 2 * p.spinDir;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(turn);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }

    if (p.vehicle) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = this.skin.color;
      ctx.fillRect(x + 6, y - 4, w - 12, h * 0.6);
      ctx.restore();
      return;
    }

    // Trail while diving
    if (p.diving && !this.reducedFlash) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = this.skin.color;
      ctx.fillRect(x - p.vx * 1.5, y - p.vy * 1.5, w, h);
      ctx.restore();
    }

    // Flicker while briefly invulnerable after a shield pops.
    if (p.invuln > 0 && Math.floor(this.worldTime / 60) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.45;
    }

    ctx.fillStyle = this.skin.color;
    ctx.fillRect(x, y, w, h);

    // Backpack
    ctx.fillStyle = shade(this.skin.color, -30);
    ctx.fillRect(x + (p.facingRight ? -6 : w), y + 8, 6, Math.max(10, h - 22));

    // Visor
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + (p.facingRight ? w - 12 : 4), y + 6, 8, 6);

    if (h > SLIDE_H + 4) {
      ctx.fillStyle = this.skin.textColor;
      ctx.font = 'bold 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BERT', x + w / 2, y + 26);
      ctx.fillText('DASH', x + w / 2, y + 35);
    }

    if (p.invuln > 0 && Math.floor(this.worldTime / 60) % 2 === 0) ctx.restore();

    // The flip turns the courier, not the readouts: the buff ring and the
    // banked-air-jump pip below stay the right way up.
    if (spinning) ctx.restore();

    if (p.wallSliding) {
      ctx.fillStyle = 'rgba(148,163,184,0.5)';
      ctx.fillRect(x + (p.wallDir > 0 ? w : -4), y + 6, 4, h - 12);
      // Scrape marks so a wall cling reads at a glance.
      ctx.fillStyle = 'rgba(226,232,240,0.28)';
      ctx.fillRect(x + (p.wallDir > 0 ? w : -7), y + h * 0.75, 7, 3);
    }

    // Active buff ring
    if (p.buffs.speed > 0 || p.buffs.jump > 0) {
      ctx.save();
      ctx.strokeStyle = p.buffs.speed > 0 ? COLORS.buffSpeed : COLORS.buffJump;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6 + Math.sin(this.worldTime / 120) * 0.25;
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
      ctx.restore();
    }

    // Shield bubble
    if (p.buffs.shield > 0) {
      ctx.save();
      ctx.strokeStyle = COLORS.buffShield;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + Math.sin(this.worldTime / 150) * 0.25;
      if (!this.reducedFlash) { ctx.shadowColor = COLORS.buffShield; ctx.shadowBlur = 12; }
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.max(w, h) * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Magnet reach, drawn only while the bag is loose and being pulled.
    if (p.buffs.magnet > 0 && !p.hasFood) {
      ctx.save();
      ctx.strokeStyle = COLORS.buffMagnet;
      ctx.globalAlpha = 0.16;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, this.loadout.magnetRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Air-jump pip: a small mark above the head while one is banked.
    if (p.airJumps > 0 && !p.grounded && !p.vehicle) {
      ctx.save();
      ctx.fillStyle = '#e2e8f0';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y - 12);
      ctx.lineTo(x + w / 2 - 5, y - 5);
      ctx.lineTo(x + w / 2 + 5, y - 5);
      ctx.fill();
      ctx.restore();
    }
  }

  #drawParticles(ctx) {
    for (const q of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, q.life / q.maxLife);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x, q.y, q.size, q.size);
      ctx.restore();
    }
  }

  #drawDeathOverlay(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(2,2,4,0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }
}

// --- helpers ---------------------------------------------------------------

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
function shade(hex, amount) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  if (!match) return hex ?? '#1e293b';
  const channels = match.slice(1).map(part => clamp(parseInt(part, 16) + amount, 0, 255));
  return `rgb(${channels.join(',')})`;
}
