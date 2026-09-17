// The BertDash simulation and renderer.
//
// Runs a fixed-timestep loop: physics always advance in SIM_STEP increments no
// matter what the display refresh rate is, so a 144Hz monitor no longer makes
// the player move 2.4x faster than a 60Hz one.

import { PHYSICS, COLORS, POWERUP_BY_ID, SIM_STEP, MAX_FRAME_MS, VIEW_W, VIEW_H } from '../data/config.js';
import { prepareLevel, isSolidType, clamp } from './level.js';
import { audio } from '../services/audio.js';

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
    this.ctx = canvas.getContext('2d');
    this.level = prepareLevel(levelSource);
    this.skin = options.skin ?? { color: COLORS.player, textColor: '#fff' };
    this.onWin = options.onWin ?? (() => {});
    this.onLose = options.onLose ?? (() => {});
    this.onStats = options.onStats ?? (() => {});
    this.onPauseRequest = options.onPauseRequest ?? (() => {});
    this.reducedFlash = Boolean(options.reducedFlash);

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

    this.aim = { x: this.level.startPos.x + 160, y: this.level.startPos.y };
    this.pointerInside = false;
    this.recentCatchAt = -Infinity; // gameplay ms of the last mid-air catch
    this.charging = false;          // mouse held: winding up a throw
    this.charge = 0;                // frames of wind-up so far

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
      diveTimer: 0,
      diveCooldown: 0,
      wallSliding: false,
      wallDir: 0,
      wallStick: 0,
      wallLock: 0,
      coyote: 0,
      jumpBuffer: 0,
      airJumps: PHYSICS.airJumps,
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
    };
    this.camera = {
      x: clamp(start.x - VIEW_W / 2, 0, Math.max(0, this.level.width - VIEW_W)),
      y: clamp(start.y - VIEW_H / 2, 0, Math.max(0, this.level.height - VIEW_H)),
    };
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
    // Keys that would otherwise scroll the page while playing.
    const swallow = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

    this.onKeyDown = event => {
      if (event.repeat) {
        if (swallow.has(event.code)) event.preventDefault();
        return;
      }
      if (event.code === 'Escape' || event.code === 'KeyP') {
        this.onPauseRequest();
        return;
      }
      if (swallow.has(event.code)) event.preventDefault();
      this.keys.add(event.code);
      this.pressed.add(event.code);
      audio.unlock();
    };
    this.onKeyUp = event => {
      this.keys.delete(event.code);
    };
    // A dropped keyup (alt-tab mid-jump) used to leave the key stuck down.
    this.onBlur = () => this.keys.clear();

    // Pointer listeners live on the canvas, not the window, so clicking a HUD
    // button no longer also hurls the food across the level.
    this.onPointerMove = event => {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointerInside = true;
      this.aim = {
        x: (event.clientX - rect.left) * (VIEW_W / rect.width) + this.camera.x,
        y: (event.clientY - rect.top) * (VIEW_H / rect.height) + this.camera.y,
      };
    };
    // Press and hold charges the throw; releasing lets it go. A quick click is
    // simply a zero-charge throw, so the old one-click behaviour still works.
    this.onPointerDown = event => {
      event.preventDefault();
      audio.unlock();
      this.onPointerMove(event);
      if (this.player.hasFood) this.charging = true;
    };
    this.onPointerUp = event => {
      if (!this.charging) return;
      this.onPointerMove(event);
      this.#throwFood();
      this.charging = false;
      this.charge = 0;
    };
    this.onPointerLeave = () => { this.pointerInside = false; };

    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    // Releasing outside the canvas must still fire the throw, or the bag would
    // stay stuck to your hand with the charge ring spinning.
    addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', this.#preventDefault);
  }

  #preventDefault = event => event.preventDefault();

  #unbindInput() {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.#preventDefault);
  }

  #held(...codes) {
    return codes.some(code => this.keys.has(code));
  }

  #justPressed(...codes) {
    return codes.some(code => this.pressed.has(code));
  }

  // --- main loop -----------------------------------------------------------

  #frame = now => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.#frame);

    // Clamping stops a backgrounded tab from simulating minutes in one frame.
    const delta = Math.min(now - this.lastFrame, MAX_FRAME_MS);
    this.lastFrame = now;

    if (!this.paused) {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= SIM_STEP && steps < 5) {
        this.#step();
        this.accumulator -= SIM_STEP;
        steps++;
      }
      if (steps === 5) this.accumulator = 0; // give up rather than spiral
      this.#flushStatsIfDue(now);
    }

    this.#render();
  };

  #step() {
    this.worldTime += SIM_STEP;
    if (!this.finished) this.elapsed += SIM_STEP;

    this.#stepPlatforms();

    if (this.deathReason) {
      this.deathTimer -= SIM_STEP;
      this.shake *= 0.88;
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
    this.#stepGoal();
    this.#stepParticles();
    this.#stepCamera();
    this.shake *= 0.86;
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
          if (next <= p.anchorX || next >= p.anchorX + p.range) p.dir *= -1;
          const moved = p.velX * p.dir;
          p.x += moved;
          p.deltaX = moved;
        }
        if (p.velY) {
          const next = p.y + p.velY * p.dir;
          if (next <= p.anchorY || next >= p.anchorY + p.range) p.dir *= -1;
          const moved = p.velY * p.dir;
          p.y += moved;
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
    if (this.charging && p.hasFood) {
      this.charge = Math.min(PHYSICS.throwChargeFrames, this.charge + 1);
    }

    const vehicle = p.vehicle;
    const tuning = vehicle ? PHYSICS[vehicle.type] : null;
    const boosting = p.boost > 0;

    // Empty hands are faster — that is the reward for risking the throw.
    const handsBonus = p.hasFood ? 1 : PHYSICS.emptyHandBonus;
    const baseSpeed = (tuning?.speed ?? PHYSICS.moveSpeed)
      * phys.moveSpeedScale * buffSpeed * handsBonus
      * (boosting ? (tuning?.boost ?? 1.4) : 1);

    const left = this.#held('ArrowLeft', 'KeyA');
    const right = this.#held('ArrowRight', 'KeyD');
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const jumpHeld = this.#held('Space', 'ArrowUp', 'KeyW');

    // --- vehicle boost ---
    if (this.#justPressed('ShiftLeft', 'ShiftRight') && vehicle
        && p.boost <= 0 && p.boostCharge <= 0) {
      p.boost = PHYSICS.boostFrames;
      p.boostCharge = PHYSICS.boostRecharge;
      this.#bump('boosts');
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
      const control = p.grounded ? 1 : PHYSICS.airControl;
      const lock = p.wallLock > 0 ? 0.25 : 1; // don't cancel a wall kick instantly
      if (steer !== 0) {
        const target = steer * baseSpeed;
        p.vx += (target - p.vx) * control * lock;
        p.facingRight = steer > 0;
      } else if (p.grounded) {
        p.vx *= phys.friction;
      } else {
        p.vx *= 0.985; // air momentum is kept; only the ground really slows you
      }
    }

    p.vx += phys.windX;
    p.vx = clamp(p.vx, -PHYSICS.maxSpeedX, PHYSICS.maxSpeedX);
    if (Math.abs(p.vx) < 0.05) p.vx = 0;

    // --- start a slide ---
    if (this.#justPressed('ArrowDown', 'KeyS') && p.grounded && !p.sliding
        && p.slideCooldown <= 0 && !vehicle) {
      p.sliding = true;
      p.slideTimer = PHYSICS.slideFrames;
      p.slideCooldown = PHYSICS.slideCooldown;
      const dir = steer !== 0 ? steer : (p.facingRight ? 1 : -1);
      const launch = PHYSICS.slideSpeed * phys.moveSpeedScale * buffSpeed;
      // A slide keeps whichever is faster: your run-up or the slide's own kick.
      p.vx = dir * Math.max(launch, Math.abs(p.vx) * 1.15);
      p.facingRight = dir > 0;
      p.y += PLAYER_H - SLIDE_H;
      p.height = SLIDE_H;
      this.#bump('totalSlides');
      audio.slide();
      this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 6, '#94a3b8');
    }

    // --- jump, in priority order: wall kick, long jump, ground, air ---
    if (this.#justPressed('Space', 'ArrowUp', 'KeyW')) p.jumpBuffer = PHYSICS.jumpBufferFrames;

    const jumpForce = (tuning?.jump ?? PHYSICS.jumpForce) * phys.jumpForceScale * buffJump;

    if (p.jumpBuffer > 0) {
      if ((p.wallSliding || p.wallStick > 0) && phys.wallSlideEnabled && !vehicle) {
        // Wall kick, which also refunds the air jump — a wall is a renewable
        // source of height.
        p.vy = PHYSICS.wallJump.y * phys.jumpForceScale * buffJump;
        p.vx = -p.wallDir * PHYSICS.wallJump.x;
        p.facingRight = p.wallDir < 0;
        p.wallSliding = false;
        p.wallStick = 0;
        p.wallLock = PHYSICS.wallJumpLockFrames;
        p.airJumps = PHYSICS.airJumps;
        p.jumpBuffer = 0;
        this.#bump('totalJumps');
        this.#bump('wallJumps');
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
        audio.jump();
        this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 10, this.skin.color);
      } else if (p.grounded || p.coyote > 0) {
        p.vy = jumpForce;
        p.grounded = false;
        p.coyote = 0;
        p.jumpBuffer = 0;
        p.groundPlatform = null;
        this.#bump('totalJumps');
        audio.jump();
      } else if (p.airJumps > 0 && !vehicle) {
        // Air jump. Steering while using it redirects you rather than only
        // adding height, which is what makes it good for course correction.
        p.airJumps--;
        p.vy = PHYSICS.airJumpForce * phys.jumpForceScale * buffJump;
        if (steer !== 0) p.vx += steer * PHYSICS.airJumpSteer;
        p.jumpBuffer = 0;
        p.diving = false;
        this.#bump('totalJumps');
        this.#bump('airJumps');
        audio.jump();
        this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 12, '#e2e8f0');
      }
    }

    // Variable jump height: releasing early cuts the arc short.
    if (p.vy < 0 && !jumpHeld) p.vy *= 0.86;

    // --- dive (now usable from the ground too) ---
    if (this.#justPressed('KeyE') && p.diveCooldown <= 0 && !vehicle) {
      const dx = this.aim.x - (p.x + p.width / 2);
      const dy = this.aim.y - (p.y + p.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        if (p.sliding) this.#endSlide();
        p.vx = (dx / dist) * PHYSICS.diveSpeed;
        p.vy = (dy / dist) * PHYSICS.diveSpeed;
        p.facingRight = dx > 0;
        p.diving = true;
        p.diveTimer = PHYSICS.diveFrames;
        p.diveCooldown = PHYSICS.diveCooldown;
        p.grounded = false;
        p.coyote = 0;
        this.#bump('totalDives');
        audio.dive();
        this.#spawnParticles(p.x + p.width / 2, p.y + p.height / 2, 10, this.skin.color);
      }
    }

    if (this.#justPressed('KeyQ') && vehicle) this.#exitVehicle();

    // --- gravity ---
    // A dive holds its line; full gravity would turn every dive into a dud.
    const gravityScale = p.diving ? PHYSICS.diveGravityScale : 1;
    p.vy += PHYSICS.gravity * phys.gravityScale * gravityScale;

    const terminal = p.wallSliding ? PHYSICS.wallSlideSpeed : PHYSICS.terminalVelocity;
    if (p.vy > terminal) p.vy = terminal;

    const wasDiving = p.diving;
    const impactSpeed = Math.hypot(p.vx, p.vy);
    const wasAirborne = !p.grounded;

    this.#moveAndCollide(p);

    // Dive bounce: land a fast dive and rebound instead of splatting.
    if (wasDiving && p.grounded && wasAirborne && impactSpeed >= PHYSICS.diveBounceMinSpeed) {
      p.vy = PHYSICS.diveBounce * phys.jumpForceScale;
      p.grounded = false;
      p.groundPlatform = null;
      p.diving = false;
      p.diveTimer = 0;
      p.diveCooldown = Math.min(p.diveCooldown, 10); // reward the read
      this.#bump('diveBounces');
      audio.wallJump();
      this.#spawnParticles(p.x + p.width / 2, p.y + p.height, 14, this.skin.color);
      this.shake = this.reducedFlash ? 2 : 6;
    }

    // Landing refills the air jump.
    if (p.grounded) p.airJumps = PHYSICS.airJumps;

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
          // Head bump
          p.y = plat.y + plat.height;
          p.vy = 0;
        }
      }
      if (p.grounded) break;
    }

    if (p.grounded) {
      p.coyote = PHYSICS.coyoteFrames;
      p.diving = false;
      p.wallSlideCredited = false;
    } else if (wasGrounded) {
      p.coyote = PHYSICS.coyoteFrames;
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
    const pressingRight = this.#held('ArrowRight', 'KeyD');
    const pressingLeft = this.#held('ArrowLeft', 'KeyA');
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
      if (p.vy > PHYSICS.wallSlideSpeed) p.vy = PHYSICS.wallSlideSpeed;
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
    const dx = this.aim.x - originX;
    const dy = this.aim.y - originY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;

    const power = this.throwPower();
    p.hasFood = false;
    this.food.airborne = true;
    this.food.magnetised = false;
    this.food.x = originX - FOOD_SIZE / 2;
    this.food.y = originY - FOOD_SIZE / 2;
    this.food.vx = (dx / dist) * power + p.vx * 0.4;
    this.food.vy = (dy / dist) * power;
    this.food.catchCooldown = PHYSICS.catchCooldown;

    this.#bump('foodThrown');
    if (this.charge >= PHYSICS.throwChargeFrames) this.#bump('chargedThrows');
    audio.throwFood();
    this.#spawnParticles(originX, originY, 4 + Math.round(this.chargeRatio() * 8), COLORS.food);
  }

  /** 0..1 — how far the current throw charge has wound up. */
  chargeRatio() {
    return Math.min(1, this.charge / PHYSICS.throwChargeFrames);
  }

  throwPower() {
    return PHYSICS.throwStrength * (1 + this.chargeRatio() * PHYSICS.throwChargeBonus);
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

    f.vy += PHYSICS.foodGravity * this.level.physics.gravityScale;
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
      const reach = magnetActive ? PHYSICS.magnetCatchRadius : PHYSICS.catchRadius;
      f.magnetised = magnetActive && distance < reach;
      if (f.magnetised && distance > PHYSICS.catchRadius) {
        const pull = 0.9;
        f.vx += (dx / distance) * pull;
        f.vy += (dy / distance) * pull;
      }

      if (distance < PHYSICS.catchRadius) {
        p.hasFood = true;
        f.airborne = false;
        f.magnetised = false;
        this.recentCatchAt = this.elapsed;
        this.#bump('foodCaught');
        if (magnetActive) this.#bump('magnetCatches');
        audio.catchFood();
        this.#spawnParticles(f.x + f.size / 2, f.y + f.size / 2, 6, COLORS.food);
        return;
      }
    }

    // The food hitting anything is a failed delivery — that is the whole risk
    // of throwing it. Spikes are excluded only because they already kill you.
    const box = { x: f.x, y: f.y, width: f.size, height: f.size };
    for (const plat of this.level.platforms) {
      if (!this.#isSolidNow(plat)) continue;
      if (overlaps(box, plat)) { this.#kill('DROPPED'); return; }
    }
    if (f.y > this.level.height + 400) this.#kill('DROPPED');
  }

  /** Predicted arc for the aim assist, so the throw is a read and not a prayer. */
  predictThrow() {
    const p = this.player;
    const originX = p.x + p.width / 2;
    const originY = p.y + p.height / 2;
    const dx = this.aim.x - originX;
    const dy = this.aim.y - originY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return [];

    let x = originX;
    let y = originY;
    const power = this.throwPower();
    let vx = (dx / dist) * power + p.vx * 0.4;
    let vy = (dy / dist) * power;
    const gravity = PHYSICS.foodGravity * this.level.physics.gravityScale;
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
      case 'shield': p.buffs.shield = PHYSICS.shieldFrames; break;
      case 'magnet': p.buffs.magnet = PHYSICS.magnetFrames; break;
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

  #stepGoal() {
    const p = this.player;
    if (!p.hasFood) return;

    const dx = (p.x + p.width / 2) - this.level.goalPos.x;
    const dy = (p.y + p.height / 2) - this.level.goalPos.y;
    if (Math.hypot(dx, dy) > GOAL_RADIUS) return;

    // Latched: the old build called onWin every frame you stood on the goal,
    // paying out tips over and over.
    this.finished = true;
    audio.win();
    this.#spawnParticles(this.level.goalPos.x, this.level.goalPos.y, 26, COLORS.food);
    this.#flushStats();
    this.onWin({
      timeMs: this.elapsed,
      // "Clutch" means you caught the bag on the way in rather than walking it
      // over — the food was still in the air moments before you arrived.
      clutch: this.food.catchCooldown > 0 || this.recentCatchAt > this.elapsed - 900,
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
      this.shake = this.reducedFlash ? 3 : 10;
      this.#bump('shieldsUsed');
      audio.wallJump();
      this.#spawnParticles(p.x + p.width / 2, p.y + p.height / 2, 20, COLORS.buffShield);
      return;
    }

    this.deathReason = reason;
    this.deathTimer = 520;
    this.shake = this.reducedFlash ? 4 : 18;
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
    const targetX = clamp(p.x + p.width / 2 - VIEW_W / 2, 0, Math.max(0, this.level.width - VIEW_W));
    const targetY = clamp(p.y + p.height / 2 - VIEW_H / 2, 0, Math.max(0, this.level.height - VIEW_H));
    this.camera.x += (targetX - this.camera.x) * 0.12;
    this.camera.y += (targetY - this.camera.y) * 0.12;
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
      maxAirJumps: PHYSICS.airJumps,
      diveReady: p.diveCooldown <= 0,
      slideReady: p.slideCooldown <= 0,
      charge: this.chargeRatio(),
      charging: this.charging,
      paused: this.paused,
    };
  }

  // --- rendering -----------------------------------------------------------

  #render() {
    const ctx = this.ctx;
    const cam = this.camera;

    ctx.save();
    if (this.shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this.#drawBackground(ctx);

    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

    this.#drawGoal(ctx);
    this.#drawPlatforms(ctx);
    this.#drawPowerups(ctx);
    this.#drawVehicles(ctx);
    if (!this.deathReason) this.#drawAim(ctx);
    this.#drawFood(ctx);
    if (!this.deathReason) this.#drawPlayer(ctx);
    this.#drawParticles(ctx);

    ctx.restore();
    ctx.restore();

    if (this.deathReason) this.#drawDeathOverlay(ctx);
  }

  #drawBackground(ctx) {
    const cam = this.camera;
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    gradient.addColorStop(0, shade(this.level.background, 18));
    gradient.addColorStop(1, shade(this.level.background, -14));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Parallax skyline. Deterministic from the column index, so it doesn't
    // shimmer as the camera moves.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    const parallax = cam.x * 0.35;
    for (let i = 0; i < 26; i++) {
      const seed = (i * 9301 + 49297) % 233280 / 233280;
      const w = 60 + seed * 70;
      const h = 90 + seed * 230;
      const x = ((i * 150 - parallax) % (VIEW_W + 400) + VIEW_W + 400) % (VIEW_W + 400) - 200;
      ctx.fillRect(x, VIEW_H - h, w, h);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    const starParallax = cam.y * 0.2;
    for (let i = 0; i < 40; i++) {
      const seed = (i * 4177 + 7919) % 10007 / 10007;
      const x = (i * 97) % VIEW_W;
      const y = ((seed * VIEW_H * 2 - starParallax) % VIEW_H + VIEW_H) % VIEW_H;
      ctx.fillRect(x, y, 2, 2);
    }
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

    ctx.save();
    ctx.strokeStyle = p.hasFood ? 'rgba(255,255,255,0.5)' : 'rgba(74,222,128,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.aim.x, this.aim.y, 12, 0, Math.PI * 2);
    ctx.moveTo(this.aim.x - 18, this.aim.y);
    ctx.lineTo(this.aim.x - 6, this.aim.y);
    ctx.moveTo(this.aim.x + 6, this.aim.y);
    ctx.lineTo(this.aim.x + 18, this.aim.y);
    ctx.stroke();
    ctx.restore();

    // Charge ring: fills as the throw winds up.
    const charge = this.chargeRatio();
    if (charge > 0.01) {
      ctx.save();
      ctx.strokeStyle = charge >= 1 ? '#fbbf24' : '#ffffff';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(this.aim.x, this.aim.y, 18, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
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
      ctx.arc(f.x + f.size / 2, f.y + f.size / 2, PHYSICS.catchRadius, 0, Math.PI * 2);
      ctx.setLineDash([4, 8]);
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
      ctx.arc(x + w / 2, y + h / 2, PHYSICS.magnetCatchRadius, 0, Math.PI * 2);
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
