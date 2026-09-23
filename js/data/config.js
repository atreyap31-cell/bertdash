// Tuning constants, cosmetics and achievement definitions.

import { CAMPAIGN_LENGTH } from './levels.js';

// Physics are expressed per-frame at SIM_FPS; the engine steps a fixed
// timestep so behaviour is identical on 60Hz and 144Hz displays.
export const SIM_FPS = 60;
export const SIM_STEP = 1000 / SIM_FPS;
export const MAX_FRAME_MS = 100; // never simulate more than this per rAF tick

// Slack on the fixed-timestep accumulator, in milliseconds.
//
// A frame that arrives a hair under SIM_STEP would otherwise run no simulation
// step at all, and the next would run two. At a perfect 60Hz the floating-point
// representation of 1000/60 makes that happen about five times every six
// hundred frames — a visible hitch every couple of seconds, for no reason the
// player can see. This absorbs that noise without letting real slow frames
// through.
export const STEP_EPSILON = 0.25;

export const VIEW_W = 800;
export const VIEW_H = 600;

export const PHYSICS = {
  gravity: 0.55,
  // Ground friction, as a per-frame velocity multiplier. Zero means the player
  // stops dead the instant they stop steering: no drift, no skating after a
  // landing, nothing between "moving" and "stopped". Slipperiness is a level
  // mechanic, not a baseline — levels that want ice set `friction` themselves
  // (see COLD STORAGE and CORPORATE LOBBY).
  friction: 0,
  // Anything below this simply stops, so an icy level still settles eventually.
  stopThreshold: 0.6,
  jumpForce: -15,
  moveSpeed: 7,
  terminalVelocity: 16,
  // Hard ceiling on horizontal speed. Wind, conveyors and vehicle boost all
  // add to vx, and without a cap they can compound into speeds that tunnel
  // straight through a platform between two sub-steps.
  maxSpeedX: 34,
  // Camera. It leads the direction of travel rather than sitting dead-centre,
  // so fast movement shows you where you are going instead of where you were.
  cameraEase: 0.14,
  cameraLeadX: 9,      // frames of horizontal velocity to look ahead by
  cameraLeadY: 5,
  cameraLeadMaxX: 130,
  cameraLeadMaxY: 80,
  // The look-ahead is eased separately from the camera itself. Without this,
  // ground friction snapping the player's speed to zero moves the target a
  // hundred pixels in one frame and the camera visibly lurches every time you
  // stop — which reads as the whole screen shaking.
  cameraLeadEase: 0.05,
  // Replay framing. Looser than play because the recording has no input to
  // anticipate, and biased towards the bag so a throw and its catch share the
  // screen without the player leaving it.
  replayCameraEase: 0.12,
  replayBagBias: 0.35,

  // Screen shake, per event. Deliberately small: these fire often — every dive
  // bounce, every bag catch — and a big kick on each one makes the game look
  // like it is vibrating rather than reacting.
  shake: {
    death: 9,
    shield: 4,
    diveBounce: 2.5,
    bagBounce: 2.5,
    bagGlance: 1.5,
    decay: 0.78,      // how fast it settles; lower is snappier
    cutoff: 0.6,      // below this there is no shake at all
    max: 10,
  },

  // --- assists -------------------------------------------------------------
  // These read what the player was obviously trying to do and let it happen,
  // rather than stopping them dead on a pixel. Without them, clipping the
  // corner of a ledge by 2px cancels a jump you clearly made.

  // Clip a ceiling this close to its edge and you are nudged around it instead
  // of bonking. Classic corner correction.
  cornerCorrection: 11,
  // Run into a lip no taller than this and you step over it.
  stepUpHeight: 14,
  // Land within this of a ledge's edge and you are pulled onto it rather than
  // scraping down the side.
  ledgeAssist: 9,

  // Acceleration. These are per-frame lerp factors towards the target speed.
  // They exist because the ground value used to be 1 — velocity snapped to
  // full speed in a single frame, which gave movement no weight at all and
  // read as twitchy. 0.22 reaches full speed in roughly ten frames.
  groundAccel: 0.22,
  airAccel: 0.09,
  // Reversing is sharper than accelerating from a standstill, so the controls
  // stay responsive without the whole thing feeling frictionless.
  turnAccel: 2.4,
  // How fast speed above your normal run bleeds off while steering into it.
  // Close to 1 so a long jump or dive keeps the momentum that defines it.
  airMomentumBleed: 0.994,
  groundMomentumBleed: 0.97,
  coyoteFrames: 7,        // grace period after walking off an edge
  jumpBufferFrames: 7,    // remembers a jump pressed just before landing

  // Air jump. Refunded on landing and on every wall kick, so a wall hands you
  // a fresh one each time you push off it.
  airJumps: 1,
  airJumpForce: -13.2,
  airJumpSteer: 2.2,      // sideways kick when you air-jump while steering
  // The flip. Long enough to read as a deliberate move, short enough to be
  // level again well before you land.
  airJumpSpinFrames: 16,
  airJumpRingFrames: 18,

  // Wall work. You no longer have to hold into the wall to cling to it, and a
  // brief stick at the top gives you time to aim the kick.
  wallSlideSpeed: 2.2,
  wallStickFrames: 9,
  // Tuned against the measured shaft climb: enough outward push to cross a
  // shaft, little enough that you can steer back into the wall for the next
  // kick now that air acceleration is gradual rather than instant.
  wallJump: { x: 8, y: -15.5 },
  wallJumpLockFrames: 5,  // steering damped briefly so the kick actually lands

  // Slide, and the long jump that comes out of it.
  slideSpeed: 16,
  slideFrames: 26,
  slideCooldown: 32,
  slideDecay: 0.975,
  longJump: { x: 1.42, y: -11.5 }, // multipliers applied to a slide's momentum

  // Dive. Usable from the ground as well as the air; land one hard enough and
  // it rebounds you instead of killing your momentum.
  diveSpeed: 21,
  diveFrames: 16,
  diveCooldown: 32,
  diveBounce: -11.5,
  diveBounceMinSpeed: 8,
  diveGravityScale: 0.35, // dives stay flat instead of drooping
  diveGroundLift: -3.4,   // a ground dash skims rather than scraping
  // How far off level a grounded dive can be before it stops being given that
  // skim. Expressed as |dy| / distance, so 0.25 is about 15 degrees.
  diveLiftMaxSlope: 0.25,
  // How far a dive may turn per frame while tracking the bag, in radians.
  // About 7 degrees, so a dive can come round by roughly 110 degrees over its
  // length - enough to follow a falling bag, not enough to fly it for you.
  diveTurnRate: 0.12,
  // Frames a dive must have been going before it may rebound off a landing, so
  // it cannot bounce off the floor it launched from.
  diveBounceMinAge: 3,

  // Throwing. Hold to charge for a longer throw.
  throwStrength: 9,
  throwChargeFrames: 40,
  // How long a released aim direction keeps counting, so letting go of two
  // keys a frame or two apart still throws the diagonal you were aiming.
  // A tenth of a second: long enough to cover human release, short enough
  // that it cannot turn a deliberate straight throw into a diagonal.
  aimGraceFrames: 6,
  throwChargeBonus: 0.9,  // +90% strength at full charge
  foodGravity: 0.28,
  // Catching the bag out of the air launches you: throw it up and ahead, jump
  // after it, and the catch kicks you far higher than any jump can. This is a
  // traversal move, not a bonus, and several levels are built around it.
  catchBoost: -21.5,
  catchBoostForward: 1.25,  // horizontal momentum multiplier on the launch
  catchBoostMinAir: 4,      // frames off the ground before it counts
  // The bag keeps your full horizontal momentum. Toss it straight up while
  // running and it travels exactly alongside you, so jumping into it is a
  // reliable move rather than a timing trick — that is what makes the bag
  // bounce usable as traversal.
  throwInherit: 1,
  // Vertical momentum carries too, so a throw released at the top of a jump or
  // out of a bag bounce is launched much harder than one made standing still.
  throwInheritY: 0.75,
  // How much momentum working against your aim is allowed to take off a
  // throw, as a fraction of the throw's own strength. Without a cap, falling
  // at terminal velocity carried more downward speed than an uncharged upward
  // throw had going up, so aiming up while falling threw the bag at the floor.
  // A throw now always leaves your hand in the direction you aimed it.
  throwOpposeMax: 0.5,
  // Speed itself adds power: winding up on the run throws further than a
  // standing toss, which is what makes a running delivery worth setting up.
  throwSpeedBonus: 0.05,   // extra power per px/frame of player speed
  throwSpeedBonusMax: 0.6, // capped at +60%
  catchRadius: 58,
  // A thrown bag that reaches Bert completes the delivery. Landing one is the
  // fastest way to finish a level and the hardest to pull off.
  goalCatchRadius: 90,
  magnetCatchRadius: 132,
  catchCooldown: 12,
  emptyHandBonus: 1.3,    // you move faster once the food is out of your hands

  // Vehicles. Boost with Shift; dismounting leaves them re-boardable.
  bike: { speed: 13, jump: -16.5, boost: 1.5 },
  car: { speed: 18, jump: -11.5, boost: 1.65 },
  boostFrames: 80,
  boostRecharge: 200,

  // What happens when a thrown bag hits something depends on which way the
  // surface faces.
  //
  // A wall glances it off: the bag barely rebounds sideways, keeps whatever
  // vertical motion it had, and stays catchable — so a throw into a wall is a
  // scramble you can dive after, not a loss.
  //
  // A floor or a ceiling breaks it outright. Throwing the bag at the ground
  // ends the delivery, which is what keeps the throw a real decision.
  bagWallBounces: 2,      // how many wall glances before it gives out
  bagWallBounceDamp: 0.3, // barely bounces: most of the sideways speed is gone
  bagWallLift: 0.55,      // a wall glance sheds some fall speed, so it hangs

  buffFrames: 420,
  speedBuff: 1.5,
  jumpBuff: 1.28,
  shieldFrames: 900,      // a shield lasts until used, but not forever
  magnetFrames: 600,
};

/**
 * Control bindings. Every action the engine reads goes through here, so the
 * settings screen can rebind any of them without the engine knowing.
 */
export const ACTIONS = [
  // Movement is the left hand.
  { id: 'left',    label: 'Move left',     group: 'Move',  defaults: ['KeyA'] },
  { id: 'right',   label: 'Move right',    group: 'Move',  defaults: ['KeyD'] },
  { id: 'jump',    label: 'Jump',          group: 'Move',  defaults: ['Space', 'KeyW'] },
  { id: 'slide',   label: 'Slide',         group: 'Move',  defaults: ['KeyS'] },
  { id: 'dive',    label: 'Dive',          group: 'Move',  defaults: ['KeyE'] },
  { id: 'exit',    label: 'Leave vehicle', group: 'Move',  defaults: ['KeyQ'] },
  { id: 'boost',   label: 'Boost',         group: 'Move',  defaults: ['ShiftLeft', 'ShiftRight'] },

  // Throwing is the right hand. Holding an arrow winds the throw up and aims
  // it; letting go releases the bag. Two arrows together throw on the diagonal.
  { id: 'aimUp',    label: 'Throw up',     group: 'Throw', defaults: ['ArrowUp'] },
  { id: 'aimDown',  label: 'Throw down',   group: 'Throw', defaults: ['ArrowDown'] },
  { id: 'aimLeft',  label: 'Throw left',   group: 'Throw', defaults: ['ArrowLeft'] },
  { id: 'aimRight', label: 'Throw right',  group: 'Throw', defaults: ['ArrowRight'] },

  { id: 'restart', label: 'Restart level', group: 'System', defaults: ['KeyR'] },
  { id: 'pause',   label: 'Pause',         group: 'System', defaults: ['Escape', 'KeyP'] },
];

/** Aim directions, in the order the throw vector is summed. */
export const AIM_ACTIONS = [
  { id: 'aimUp',    x: 0,  y: -1 },
  { id: 'aimDown',  x: 0,  y: 1 },
  { id: 'aimLeft',  x: -1, y: 0 },
  { id: 'aimRight', x: 1,  y: 0 },
];

export const DEFAULT_BINDINGS = Object.fromEntries(
  ACTIONS.map(a => [a.id, [...a.defaults]]));

/** Merges saved bindings over the defaults, dropping anything unrecognised. */
export function resolveBindings(saved = {}) {
  const out = {};
  for (const action of ACTIONS) {
    const custom = saved[action.id];
    out[action.id] = Array.isArray(custom) && custom.length
      ? [...custom]
      : [...action.defaults];
  }
  return out;
}

/** Human-readable name for a KeyboardEvent.code. */
export function keyName(code) {
  if (!code) return '\u2014';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return {
    Space: 'Space', Escape: 'Esc',
    ArrowUp: '\u2191', ArrowDown: '\u2193', ArrowLeft: '\u2190', ArrowRight: '\u2192',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt',
    Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  }[code] ?? code;
}

/** Powerup kinds the engine understands, and how they are presented. */
export const POWERUP_TYPES = [
  { id: 'speed',  label: 'Speed',  color: '#3b82f6', glyph: '»', stat: 'speedPickups' },
  { id: 'jump',   label: 'Jump',   color: '#a855f7', glyph: '⇈', stat: 'jumpPickups' },
  { id: 'shield', label: 'Shield', color: '#22d3ee', glyph: '◇', stat: 'shieldPickups' },
  { id: 'magnet', label: 'Magnet', color: '#f97316', glyph: '◎', stat: 'magnetPickups' },
];

export const POWERUP_BY_ID = Object.fromEntries(POWERUP_TYPES.map(p => [p.id, p]));

/**
 * Flow: the chain you build by keeping moving. Every distinct move adds to it,
 * it decays if you stand still, and it pays out as a tip bonus at the end of
 * the level — so the fastest route and the most stylish one are the same
 * route. Throwing the bag is worth the most because it is the biggest risk.
 */
export const FLOW = {
  window: 150,            // frames a chain survives without a new move
  max: 40,                // chain length at which the multiplier caps
  maxMultiplier: 3,
  values: {
    jump: 1,
    slide: 1,
    dive: 2,
    wallKick: 2,
    airJump: 2,
    longJump: 3,
    diveBounce: 3,
    throw: 2,
    catch: 3,
    bagBounce: 6,         // throw it, chase it, catch it mid-air: the big one
    airDelivery: 10,      // landing the bag on Bert from range
    boost: 2,
  },
  // Repeating the same move immediately is worth less, so mashing one button
  // does not build a chain.
  repeatFalloff: 0.4,
};

export const COLORS = {
  player: '#06C167',
  food: '#fbbf24',
  platform: '#1e293b',
  platformTop: '#334155',
  moving: '#475569',
  vanishing: '#64748b',
  spike: '#f43f5e',
  laserOn: '#ef4444',
  laserOff: 'rgba(239, 68, 68, 0.12)',
  door: '#475569',
  conveyor: '#0ea5e9',
  bike: '#a855f7',
  car: '#38bdf8',
  buffSpeed: '#3b82f6',
  buffJump: '#a855f7',
  buffShield: '#22d3ee',
  buffMagnet: '#f97316',
  aim: 'rgba(255, 255, 255, 0.32)',
};

export const SKINS = [
  { id: 'base',     name: 'The Trainee',       cost: 0,     color: '#06C167', textColor: '#FFFFFF' },
  { id: 'soggy',    name: 'Soggy Fries',       cost: 600,   color: '#d97706', textColor: '#fde047' },
  { id: 'straw',    name: 'Missing Straw',     cost: 1100,  color: '#ef4444', textColor: '#FFFFFF' },
  { id: 'parked',   name: 'Double Parked',     cost: 2000,  color: '#eab308', textColor: '#000000' },
  { id: 'beggar',   name: '5-Star Beggar',     cost: 3200,  color: '#78350f', textColor: '#cd7f32' },
  { id: 'surge',    name: 'Surge Pricing',     cost: 6000,  color: '#9333ea', textColor: '#e879f9' },
  { id: 'address',  name: 'Wrong Address',     cost: 10000, color: '#64748b', textColor: '#cbd5e1' },
  { id: 'cold',     name: 'Cold Pizza',        cost: 15000, color: '#3b82f6', textColor: '#93c5fd' },
  { id: 'employee', name: 'Employee of Month', cost: 24000, color: '#e2e8f0', textColor: '#0f172a' },
  { id: 'amir',     name: 'AMIR',              cost: 75000, color: '#f59e0b', textColor: '#4c1d95' },
];

/**
 * Gear: permanent upgrades bought with tips. Unlike skins these change how the
 * game plays, which is what gives tips a purpose beyond cosmetics. Each one
 * resolves into the loadout below and is read by the engine.
 */
export const GEAR = [
  // --- handling ------------------------------------------------------------
  { id: 'grip_gloves',  name: 'Grip Gloves',    cost: 2200,  icon: '\u270B', tier: 'Handling',
    description: 'Catch the bag from 40% further away.',
    effect: { catchRadius: 1.4 } },
  { id: 'quick_hands',  name: 'Quick Hands',    cost: 2600,  icon: '\u25C9', tier: 'Handling',
    description: 'Throws charge twice as fast.',
    effect: { chargeSpeed: 2 } },
  { id: 'long_arms',    name: 'Long Arms',      cost: 4200,  icon: '\u27B6', tier: 'Handling',
    description: 'Throw the bag 25% harder. Longer range on an air delivery.',
    effect: { throwStrength: 1.25 } },
  { id: 'reinforced',   name: 'Reinforced Bag', cost: 3400,  icon: '\u2B13', tier: 'Handling',
    description: 'One more wall glance before the bag gives out. Floors still break it.',
    effect: { bagWallBounces: 1 } },
  { id: 'bulls_eye',    name: "Bert's Reach",   cost: 9000,  icon: '\u25CE', tier: 'Handling',
    description: 'Bert catches from 70% further out, so an air delivery is far more forgiving.',
    effect: { goalCatchRadius: 1.7 } },
  { id: 'spotter',      name: "Spotter's Monocle", cost: 6800, icon: '\u25CB', tier: 'Handling',
    description: 'Marks the exact spot a loose bag will come down — green if you can still get there.',
    effect: { landingMarker: true } },
  { id: 'air_brake',    name: 'Air Brake',      cost: 11000, icon: '\u2602', tier: 'Handling',
    description: 'The bag falls 25% slower, so there is far more time to chase it down.',
    effect: { foodGravity: 0.75 } },
  { id: 'cold_chain',   name: 'Cold Chain',     cost: 26000, icon: '\u2744', tier: 'Handling',
    description: 'The bag survives one hit on a floor per level. The only thing that does.',
    effect: { floorSaves: 1 } },

  // --- movement ------------------------------------------------------------
  { id: 'coyote_kit',   name: 'Coyote Kit',     cost: 3000,  icon: '\u23F1', tier: 'Movement',
    description: 'More grace after leaving a ledge, and a longer jump buffer.',
    effect: { graceFrames: 4 } },
  // The most powerful thing in the shop, and priced accordingly.
  //
  // Measured in the engine (a run-up into a full-height multi-jump), an extra
  // air jump takes the reachable envelope from 282px of rise and 595px of gap
  // to 401 and 822 -- it very nearly doubles the area of a level you can get
  // to. Spring Heels, the next best movement upgrade, buys 20%. At the old
  // $5,200 that was about $50 for each 1% of envelope against Spring Heels'
  // $450: eight times the value of anything else in the tier, so there was no
  // reason not to buy it first and little reason to buy much else after.
  //
  // At $28,000 it is the most expensive piece of gear in the game, about two
  // clean campaign runs' worth of tips, and works out near $290 per 1% -- still
  // the best value in the tier, so it stays worth saving for, but it is now
  // what you buy last rather than what you buy on level 30. No level is
  // designed around it: the route analysis assumes the one free air jump.
  { id: 'second_wind',  name: 'Second Wind',    cost: 28000,  icon: '\u2191', tier: 'Movement',
    description: 'A second air jump. Nearly doubles how much of a level you can reach.',
    effect: { airJumps: 1 } },
  { id: 'dust_brakes',  name: 'Dust Brakes',    cost: 5800,  icon: '\u21E5', tier: 'Movement',
    description: 'Slides run 40% longer, so long jumps carry further.',
    effect: { slideFrames: 1.4 } },
  { id: 'wall_boots',   name: 'Wall Boots',     cost: 6400,  icon: '\u23B7', tier: 'Movement',
    description: 'Wall kicks are 15% stronger and you cling more slowly.',
    effect: { wallJump: 1.15, wallSlide: 0.75 } },
  { id: 'track_shoes',  name: 'Track Shoes',    cost: 7400,  icon: '\u00BB', tier: 'Movement',
    description: '10% faster on foot.',
    effect: { moveSpeed: 1.1 } },
  { id: 'spring_heels', name: 'Spring Heels',   cost: 8600,  icon: '\u21C8', tier: 'Movement',
    description: '8% more jump height, on every kind of jump.',
    effect: { jumpForce: 1.08 } },
  { id: 'crash_pads',   name: 'Crash Pads',     cost: 9200,  icon: '\u21BB', tier: 'Movement',
    description: 'Dives rebound from much slower landings.',
    effect: { diveBounceThreshold: 0.6 } },
  { id: 'drag_chute',   name: 'Drag Chute',     cost: 6600,  icon: '\u2193', tier: 'Movement',
    description: 'You fall 20% slower at top speed, so a long drop stays steerable.',
    effect: { terminalVelocity: 0.8 } },
  { id: 'kick_plate',   name: 'Kick Plate',     cost: 10500, icon: '\u21AF', tier: 'Movement',
    description: 'Dive rebounds throw you 20% higher.',
    effect: { diveBounce: 1.2 } },
  { id: 'slipstream',   name: 'Slipstream Vest', cost: 12500, icon: '\u2248', tier: 'Movement',
    description: 'Once the bag leaves your hands you run 12% faster still.',
    effect: { emptyHandBonus: 1.12 } },
  { id: 'jet_soles',    name: 'Jet Soles',      cost: 13000, icon: '\u00BB', tier: 'Movement',
    description: 'Dives travel 12% faster, so the bag is easier to catch up with.',
    effect: { diveSpeed: 1.12 } },
  { id: 'deep_pockets', name: 'Deep Pockets',   cost: 14000, icon: '\u2B06', tier: 'Movement',
    description: 'Catching the bag in mid-air launches you 15% higher.',
    effect: { catchBoost: 1.15 } },

  // --- kit -----------------------------------------------------------------
  { id: 'wide_magnet',  name: 'Wide Magnet',    cost: 5000,  icon: '\u25CE', tier: 'Kit',
    description: 'Magnets reach 60% further and last half again as long.',
    effect: { magnetRadius: 1.6, magnetDuration: 1.5 } },
  { id: 'insulated',    name: 'Insulated Box',  cost: 6000,  icon: '\u25C7', tier: 'Kit',
    description: 'Shields last twice as long.',
    effect: { shieldDuration: 2 } },
  { id: 'turbo_kit',    name: 'Turbo Kit',      cost: 7800,  icon: '\u226B', tier: 'Kit',
    description: 'Vehicle boost recharges in a little over half the time.',
    effect: { boostRecharge: 0.55 } },

  // --- payroll -------------------------------------------------------------
  { id: 'flow_state',   name: 'Flow State',     cost: 12000, icon: '\u223F', tier: 'Payroll',
    description: 'Your flow chain takes 60% longer to lapse.',
    effect: { flowWindow: 1.6 } },
  { id: 'overtime',     name: 'Overtime',       cost: 24000, icon: '\u223F', tier: 'Payroll',
    description: 'A maxed flow chain is worth 4x instead of 3x. Only pays if you keep it alive.',
    effect: { flowMaxMultiplier: 1.5 } },
  { id: 'couriers_cut', name: "Courier's Cut",  cost: 18000, icon: '$',      tier: 'Payroll',
    description: '25% more tips from every delivery.',
    effect: { tips: 1.25 } },
];

export const GEAR_TIERS = ['Handling', 'Movement', 'Kit', 'Payroll'];

export const GEAR_BY_ID = Object.fromEntries(GEAR.map(g => [g.id, g]));

/** Folds a profile's owned gear into a single set of modifiers. */
export function resolveLoadout(ownedIds = []) {
  const loadout = {
    airJumps: PHYSICS.airJumps,
    bagWallBounces: PHYSICS.bagWallBounces,
    floorSaves: 0,
    catchRadius: PHYSICS.catchRadius,
    goalCatchRadius: PHYSICS.goalCatchRadius,
    catchBoost: PHYSICS.catchBoost,
    magnetRadius: PHYSICS.magnetCatchRadius,
    magnetDuration: PHYSICS.magnetFrames,
    shieldDuration: PHYSICS.shieldFrames,
    chargeFrames: PHYSICS.throwChargeFrames,
    throwStrength: PHYSICS.throwStrength,
    slideFrames: PHYSICS.slideFrames,
    coyoteFrames: PHYSICS.coyoteFrames,
    jumpBufferFrames: PHYSICS.jumpBufferFrames,
    wallJumpX: PHYSICS.wallJump.x,
    wallJumpY: PHYSICS.wallJump.y,
    wallSlideSpeed: PHYSICS.wallSlideSpeed,
    boostRecharge: PHYSICS.boostRecharge,
    flowWindow: FLOW.window,
    moveSpeed: 1,
    jumpForce: 1,
    foodGravity: 1,
    terminalVelocity: PHYSICS.terminalVelocity,
    emptyHandBonus: PHYSICS.emptyHandBonus,
    diveSpeed: PHYSICS.diveSpeed,
    diveBounce: PHYSICS.diveBounce,
    flowMaxMultiplier: FLOW.maxMultiplier,
    landingMarker: false,
    diveBounceMinSpeed: PHYSICS.diveBounceMinSpeed,
    tips: 1,
  };

  for (const id of ownedIds) {
    const effect = GEAR_BY_ID[id]?.effect;
    if (!effect) continue;
    // Counts add; everything else multiplies, so two pieces that touch the
    // same number stack rather than one silently overriding the other.
    if (effect.airJumps) loadout.airJumps += effect.airJumps;
    if (effect.bagWallBounces) loadout.bagWallBounces += effect.bagWallBounces;
    if (effect.floorSaves) loadout.floorSaves += effect.floorSaves;
    if (effect.graceFrames) {
      loadout.coyoteFrames += effect.graceFrames;
      loadout.jumpBufferFrames += effect.graceFrames;
    }
    if (effect.catchRadius) loadout.catchRadius *= effect.catchRadius;
    if (effect.goalCatchRadius) loadout.goalCatchRadius *= effect.goalCatchRadius;
    if (effect.catchBoost) loadout.catchBoost *= effect.catchBoost;
    if (effect.magnetRadius) loadout.magnetRadius *= effect.magnetRadius;
    if (effect.magnetDuration) loadout.magnetDuration *= effect.magnetDuration;
    if (effect.shieldDuration) loadout.shieldDuration *= effect.shieldDuration;
    if (effect.chargeSpeed) loadout.chargeFrames /= effect.chargeSpeed;
    if (effect.throwStrength) loadout.throwStrength *= effect.throwStrength;
    if (effect.slideFrames) loadout.slideFrames *= effect.slideFrames;
    if (effect.wallJump) {
      loadout.wallJumpX *= effect.wallJump;
      loadout.wallJumpY *= effect.wallJump;
    }
    if (effect.wallSlide) loadout.wallSlideSpeed *= effect.wallSlide;
    if (effect.boostRecharge) loadout.boostRecharge *= effect.boostRecharge;
    if (effect.flowWindow) loadout.flowWindow *= effect.flowWindow;
    if (effect.moveSpeed) loadout.moveSpeed *= effect.moveSpeed;
    if (effect.jumpForce) loadout.jumpForce *= effect.jumpForce;
    if (effect.diveBounceThreshold) loadout.diveBounceMinSpeed *= effect.diveBounceThreshold;
    if (effect.foodGravity) loadout.foodGravity *= effect.foodGravity;
    if (effect.terminalVelocity) loadout.terminalVelocity *= effect.terminalVelocity;
    if (effect.emptyHandBonus) loadout.emptyHandBonus *= effect.emptyHandBonus;
    if (effect.diveSpeed) loadout.diveSpeed *= effect.diveSpeed;
    if (effect.diveBounce) loadout.diveBounce *= effect.diveBounce;
    // The cap is a multiplier over 1x, so scaling the headroom rather than the
    // whole number keeps "no flow at all" worth exactly 1x.
    if (effect.flowMaxMultiplier) {
      loadout.flowMaxMultiplier = 1 + (loadout.flowMaxMultiplier - 1) * effect.flowMaxMultiplier;
    }
    if (effect.landingMarker) loadout.landingMarker = true;
    if (effect.tips) loadout.tips *= effect.tips;
  }
  return loadout;
}

// Every achievement here is reachable. `check` receives the live profile and
// returns true once earned; it is evaluated after any stat or progress change.
export const ACHIEVEMENTS = [
  { id: 'jump_1',       title: 'Hopper',         description: 'Jump 10 times',                 icon: '‸', check: p => p.stats.totalJumps >= 10 },
  { id: 'jump_100',     title: 'Kangaroo',       description: 'Jump 100 times',                icon: '‸', check: p => p.stats.totalJumps >= 100 },
  { id: 'jump_1000',    title: 'Moon Shoes',     description: 'Jump 1,000 times',              icon: '☾', check: p => p.stats.totalJumps >= 1000 },
  { id: 'die_1',        title: 'Ouch',           description: 'Die once',                      icon: '☠', check: p => p.stats.totalDeaths >= 1 },
  { id: 'die_10',       title: 'Clumsy',         description: 'Die 10 times',                  icon: '☠', check: p => p.stats.totalDeaths >= 10 },
  { id: 'die_50',       title: 'Respawn King',   description: 'Die 50 times',                  icon: '☠', check: p => p.stats.totalDeaths >= 50 },
  { id: 'die_100',      title: 'Determination',  description: 'Die 100 times',                 icon: '☠', check: p => p.stats.totalDeaths >= 100 },
  { id: 'tutorial',     title: 'Orientation',    description: 'Finish the tutorial',           icon: '✓', check: p => p.bestLevelTimes[0] != null },
  { id: 'level_1',      title: 'First Shift',    description: 'Complete Level 1',              icon: '✓', check: p => p.bestLevelTimes[1] != null },
  { id: 'level_5',      title: 'Rookie',         description: 'Complete Level 5',              icon: '✓', check: p => p.bestLevelTimes[5] != null },
  { id: 'level_10',     title: 'Pro',            description: 'Complete Level 10',             icon: '✓', check: p => p.bestLevelTimes[10] != null },
  { id: 'level_20',     title: 'Veteran',        description: 'Complete Level 20',             icon: '✓', check: p => p.bestLevelTimes[20] != null },
  { id: 'level_30',     title: 'Master',         description: 'Complete Level 30',             icon: '✓', check: p => p.bestLevelTimes[30] != null },
  { id: 'legend',       title: 'Legend',         description: 'Complete every campaign level', icon: '♛', check: p => p.stats.levelsCleared >= CAMPAIGN_LENGTH },
  { id: 'throw_1',      title: 'Yeet',           description: 'Throw the food',                icon: '➶', check: p => p.stats.foodThrown >= 1 },
  { id: 'throw_50',     title: 'Quarterback',    description: 'Throw food 50 times',           icon: '➶', check: p => p.stats.foodThrown >= 50 },
  { id: 'catch_1',      title: 'Safe Hands',     description: 'Catch the food mid-air',        icon: '✋', check: p => p.stats.foodCaught >= 1 },
  { id: 'catch_50',     title: 'Sticky Fingers', description: 'Catch the food 50 times',       icon: '✋', check: p => p.stats.foodCaught >= 50 },
  { id: 'dive_1',       title: 'Incoming!',      description: 'Perform a dive',                icon: '»', check: p => p.stats.totalDives >= 1 },
  { id: 'dive_50',      title: 'Superman',       description: 'Dive 50 times',                 icon: '»', check: p => p.stats.totalDives >= 50 },
  { id: 'slide_1',      title: 'Slick',          description: 'Perform a slide',               icon: '⇥', check: p => p.stats.totalSlides >= 1 },
  { id: 'slide_50',     title: 'Low Rider',      description: 'Slide 50 times',                icon: '⇥', check: p => p.stats.totalSlides >= 50 },
  { id: 'wall_1',       title: 'Spider-Bert',    description: 'Slide down a wall',             icon: '⎷', check: p => p.stats.wallSlides >= 1 },
  { id: 'wall_50',      title: 'Parkour',        description: 'Wall slide 50 times',           icon: '⎷', check: p => p.stats.wallSlides >= 50 },
  { id: 'walljump_1',   title: 'Kick Off',       description: 'Perform a wall jump',           icon: '⇱', check: p => p.stats.wallJumps >= 1 },
  { id: 'walljump_50',  title: 'Wall Rat',       description: 'Perform 50 wall jumps',         icon: '⇱', check: p => p.stats.wallJumps >= 50 },
  { id: 'airjump_1',    title: 'Second Wind',    description: 'Use an air jump',               icon: '↑', check: p => p.stats.airJumps >= 1 },
  { id: 'airjump_100',  title: 'Skywalker',      description: 'Use 100 air jumps',             icon: '↑', check: p => p.stats.airJumps >= 100 },
  { id: 'longjump_1',   title: 'Broad Jumper',   description: 'Launch a long jump from a slide', icon: '↗', check: p => p.stats.longJumps >= 1 },
  { id: 'longjump_25',  title: 'Triple Jumper',  description: 'Launch 25 long jumps',          icon: '↗', check: p => p.stats.longJumps >= 25 },
  { id: 'bounce_1',     title: 'Rebound',        description: 'Bounce out of a dive',          icon: '↻', check: p => p.stats.diveBounces >= 1 },
  { id: 'bounce_25',    title: 'Pinball',        description: 'Bounce out of 25 dives',        icon: '↻', check: p => p.stats.diveBounces >= 25 },
  { id: 'charge_1',     title: 'Wind-up',        description: 'Land a fully charged throw',    icon: '◉', check: p => p.stats.chargedThrows >= 1 },
  { id: 'shield_1',     title: 'Deflected',      description: 'Survive a hazard with a shield', icon: '◇', check: p => p.stats.shieldsUsed >= 1 },
  { id: 'magnet_1',     title: 'Tractor Beam',   description: 'Reel the bag in with a magnet', icon: '◎', check: p => p.stats.magnetCatches >= 1 },
  { id: 'boost_1',      title: 'Nitro',          description: 'Boost a vehicle',               icon: '≫', check: p => p.stats.boosts >= 1 },
  { id: 'speedrun_1',   title: 'Full Shift',     description: 'Finish a speedrun of the whole campaign', icon: '\u23F1', check: p => (p.stats.runsCompleted ?? 0) >= 1 },
  { id: 'gear_1',       title: 'Kitted Out',     description: 'Buy a piece of gear',           icon: '⚒', check: p => (p.ownedGear?.length ?? 0) >= 1 },
  { id: 'gear_5',       title: 'Well Equipped',  description: 'Own 5 pieces of gear',          icon: '⚒', check: p => (p.ownedGear?.length ?? 0) >= 5 },
  { id: 'gear_10',      title: 'Kitted To Death', description: 'Own 10 pieces of gear',        icon: '⚒', check: p => (p.ownedGear?.length ?? 0) >= 10 },
  { id: 'gear_all',     title: 'Fully Loaded',   description: 'Own every piece of gear',       icon: '⚒', check: p => (p.ownedGear?.length ?? 0) >= GEAR.length },
  { id: 'flow_20',      title: 'In The Zone',    description: 'Reach a flow chain of 20',      icon: '∿', check: p => p.stats.bestFlow >= 20 },
  { id: 'flow_max',     title: 'Untouchable',    description: 'Max out the flow chain',        icon: '∿', check: p => p.stats.bestFlow >= FLOW.max },
  { id: 'air_delivery_1', title: 'Special Delivery', description: 'Deliver by throwing the bag to Bert', icon: '\u27B6', check: p => p.stats.airDeliveries >= 1 },
  { id: 'air_delivery_10', title: 'Air Drop',        description: 'Land 10 thrown deliveries',    icon: '\u27B6', check: p => p.stats.airDeliveries >= 10 },
  { id: 'bounce_bag_1', title: 'Bag Bounce',     description: 'Catch the bag in mid-air for a launch', icon: '↥', check: p => p.stats.bagBounces >= 1 },
  { id: 'bounce_bag_25',title: 'Air Courier',    description: 'Launch off the bag 25 times',   icon: '↥', check: p => p.stats.bagBounces >= 25 },
  { id: 'bounce_bag_100',title: 'Bag Rider',     description: 'Launch off the bag 100 times',  icon: '↥', check: p => p.stats.bagBounces >= 100 },
  { id: 'skin_1',       title: 'Fashionista',    description: 'Buy a skin',                    icon: '◈', check: p => p.unlockedSkins.length >= 2 },
  { id: 'skin_5',       title: 'Wardrobe',       description: 'Unlock 5 skins',                icon: '◈', check: p => p.unlockedSkins.length >= 5 },
  { id: 'collector',    title: 'Collector',      description: 'Unlock every skin',             icon: '◈', check: p => p.unlockedSkins.length >= SKINS.length },
  { id: 'tips_100',     title: 'Minimum Wage',   description: 'Earn $100 in tips',             icon: '$',      check: p => p.stats.lifetimeTips >= 100 },
  { id: 'tips_1000',    title: 'Living Wage',    description: 'Earn $1,000 in tips',           icon: '$',      check: p => p.stats.lifetimeTips >= 1000 },
  { id: 'tips_10000',   title: 'High Roller',    description: 'Earn $10,000 in tips',          icon: '$',      check: p => p.stats.lifetimeTips >= 10000 },
  { id: 'rich',         title: 'Loaded',         description: 'Hold $5,000 at once',           icon: '$',      check: p => p.tips >= 5000 },
  { id: 'editor_1',     title: 'Architect',      description: 'Save a custom level',           icon: '⚒', check: p => p.customLevels.length >= 1 },
  { id: 'mechanic',     title: 'Mechanic',       description: 'Save 5 custom levels',          icon: '⚒', check: p => p.customLevels.length >= 5 },
  { id: 'custom_play',  title: 'Playtester',     description: 'Finish a custom level',         icon: '▶', check: p => p.stats.customCleared >= 1 },
  { id: 'chat_1',       title: 'Socialite',      description: 'Send a message',                icon: '✉', check: p => p.stats.messagesSent >= 1 },
  { id: 'friend_1',     title: 'Not Alone',      description: 'Connect to a peer',             icon: '⇄', check: p => p.stats.peersConnected >= 1 },
  { id: 'fail_drop',    title: 'Butterfingers',  description: 'Drop the food into the void',   icon: '⬓', check: p => p.stats.deathsByDrop >= 1 },
  { id: 'fail_laser',   title: 'Extra Crispy',   description: 'Die to a laser',                icon: '⚡', check: p => p.stats.deathsByLaser >= 1 },
  { id: 'fail_spike',   title: 'Tenderised',     description: 'Die on spikes',                 icon: '▲', check: p => p.stats.deathsBySpike >= 1 },
  { id: 'long_fall',    title: 'Long Way Down',  description: 'Fall out of the world',         icon: '↓', check: p => p.stats.deathsByFall >= 1 },
  { id: 'vehicle_bike', title: 'Biker',          description: 'Ride a bike',                   icon: '⊙', check: p => p.stats.bikeRides >= 1 },
  { id: 'vehicle_car',  title: 'Driver',         description: 'Drive a car',                   icon: '⊚', check: p => p.stats.carRides >= 1 },
  { id: 'speed_buff',   title: 'Zoom',           description: 'Grab a speed boost',            icon: '⚡', check: p => p.stats.speedPickups >= 1 },
  { id: 'jump_buff',    title: 'Springy',        description: 'Grab a jump boost',             icon: '⇧', check: p => p.stats.jumpPickups >= 1 },
  { id: 'close_call',   title: 'Close Call',     description: 'Deliver with the food airborne', icon: '!',     check: p => p.stats.clutchDeliveries >= 1 },
  { id: 'perfect',      title: 'Five Star',      description: 'Earn 5 stars on a level',       icon: '★', check: p => p.stats.fiveStars >= 1 },
  { id: 'survivor',     title: 'Survivor',       description: 'Clear a level you had died on 5+ times', icon: '♥', check: p => p.stats.comebacks >= 1 },
  { id: 'ceiling',      title: 'Skyscraper',     description: 'Clear a vertical level',        icon: '⇡', check: p => p.stats.verticalCleared >= 1 },
  { id: 'marathon',     title: 'Marathon',       description: 'Play for 30 minutes total',     icon: '⏱', check: p => p.stats.playTimeMs >= 30 * 60 * 1000 },
];

export const QUOTES = {
  5: ['LIGHTNING FAST! 5 Stars!', 'Did you use a teleporter?', 'Bert is incredibly happy.', 'Faster than a speeding bullet!', 'Godlike delivery.'],
  4: ['Great time! Just barely missed 5 stars.', 'Fast delivery. Bert approves.', 'Solid run.', 'Very efficient.'],
  3: ['A bit slow, but it got here.', '3 Stars. Average.', 'The soda is flat, but okay.', 'You made it.'],
  2: ['Too slow! Cold fries.', 'Were you sightseeing?', 'Bert is tapping his watch.', 'Grandma walks faster.'],
  1: ['DISASTER! Stone cold!', 'Did you crawl here?', 'Refund requested.', 'Why so slow?'],
};

// Keyed by the death reason the engine reports.
export const FAIL_QUOTES = {
  DROPPED: ['MY FOOD! NOOOOO!', "Dropped! It's ruined!", 'Gravity is a harsh mistress.'],
  SPIKE:   ['Well, that was pointed.', 'Straight onto the spikes.', 'Bert will not be reimbursing that.'],
  LASER:   ['Extra crispy.', 'Medium rare. And so are you.', 'You walked into the light.'],
  FELL:    ['Out of bounds, out of a job.', 'You fell off the map.', 'Down, down, down.'],
  CRUSHED: ['Squashed by the scenery.', 'That door had the right of way.'],
};

export const FAIL_LABELS = {
  DROPPED: 'FOOD DROPPED',
  SPIKE: 'IMPALED',
  LASER: 'VAPORISED',
  FELL: 'FELL OUT OF THE WORLD',
  CRUSHED: 'CRUSHED',
};
