// Turns authored level JSON into the mutable runtime state the engine steps.
//
// The authored data has always described moving platforms, vanishing platforms,
// lasers, doors, conveyors, vehicles and powerups. Preparing them here is what
// lets the engine actually simulate them.

import { PHYSICS, POWERUP_BY_ID, VIEW_W, VIEW_H } from '../data/config.js';

// A horizontal shuttle that sweeps thousands of pixels is not something you can
// plan around — it is off-screen when you need it — so side-to-side travel is
// capped at a distance you can stand and wait for.
//
// Vertical travel is left alone: a lift that climbs the whole level is exactly
// what "ELEVATOR ACTION" and "SPACE ELEVATOR" are built around, and capping it
// left both levels impossible to finish.
const MAX_SHUTTLE_RANGE = 600;

// Platforms this thin are ledges you can jump up through; anything chunkier is
// treated as solid masonry. Vertical levels are built almost entirely from
// 20px ledges and are unclimbable without this.
const ONE_WAY_MAX_HEIGHT = 24;

export function isSolidType(type) {
  return type === 'static' || type === 'moving' || type === 'vanishing' || type === 'door';
}

export function isHazardType(type) {
  return type === 'spike' || type === 'laser';
}

/** Deep-copies the level and attaches per-entity runtime state. */
export function prepareLevel(source) {
  const level = {
    id: source.id,
    title: source.title ?? 'Untitled',
    description: source.description ?? '',
    width: source.width ?? 3000,
    height: source.height ?? VIEW_H,
    background: source.background ?? '#0f172a',
    theme: source.theme === 'vertical' ? 'vertical' : 'horizontal',
    isFinalLevel: Boolean(source.isFinalLevel),
    startPos: { ...source.startPos },
    goalPos: { ...source.goalPos },
    foodPos: { ...(source.foodPos ?? { x: source.startPos.x + 40, y: source.startPos.y }) },
    physics: normalisePhysics(source.physics),
    // Teaching prompts: zones that show a line of text while you stand in
    // them. Used by the training levels, and to flag the moves a hard section
    // expects in the campaign.
    hints: (source.hints ?? []).map(h => ({
      x: h.x, y: h.y, width: h.width ?? 400, height: h.height ?? 300, text: h.text,
    })),
    platforms: (source.platforms ?? []).map(preparePlatform),
    vehicles: (source.vehicles ?? []).map(prepareVehicle),
    powerups: (source.powerups ?? []).map(preparePowerup),
  };
  level.parTime = computeParTime(level);
  return level;
}

function normalisePhysics(physics = {}) {
  return {
    gravityScale: physics.gravityScale ?? 1,
    moveSpeedScale: physics.moveSpeedScale ?? 1,
    jumpForceScale: physics.jumpForceScale ?? 1,
    friction: physics.friction ?? PHYSICS.friction,
    windX: physics.windX ?? 0,
    wallSlideEnabled: physics.wallSlideEnabled !== false, // default on
  };
}

function preparePlatform(source) {
  const platform = {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    type: source.type ?? 'static',
    conveyorVel: source.conveyorVel ?? 0,
    // Motion
    velX: source.velX ?? 0,
    velY: source.velY ?? 0,
    // Movement is anchored to startPos when the author supplied one, otherwise
    // to wherever the platform was placed.
    anchorX: source.startPos?.x ?? source.x,
    anchorY: source.startPos?.y ?? source.y,
    range: source.velY
      ? (source.range ?? 0)
      : Math.min(source.range ?? 0, MAX_SHUTTLE_RANGE),
    dir: 1,
    // Travel bounds, filled in below.
    minX: 0, maxX: 0, minY: 0, maxY: 0,
    // Per-frame delta, used to carry riders along with the platform.
    deltaX: 0,
    deltaY: 0,
    // Cycling hazards / doors
    interval: source.interval ?? 2000,
    offset: source.offset ?? 0,
    active: true,
    // Vanishing platforms
    opacity: source.opacity ?? 1,
    respawnAt: 0,
    touchedAt: 0,
  };

  platform.oneWay = platform.type !== 'door' && platform.height <= ONE_WAY_MAX_HEIGHT;

  // A moving platform authored without a range still needs somewhere to go.
  if (platform.type === 'moving' && platform.range <= 0) {
    platform.range = 160;
  }

  if (platform.type === 'moving') {
    // Travel extends from the anchor in the direction the platform is heading.
    // Assuming it always extends towards +x/+y sends any platform authored
    // with a negative velocity the wrong way — which sank the lifts in
    // ELEVATOR ACTION and SPACE ELEVATOR straight out of the level.
    const spanX = platform.velX ? platform.range : 0;
    const spanY = platform.velY ? platform.range : 0;
    platform.minX = platform.velX >= 0 ? platform.anchorX : platform.anchorX - spanX;
    platform.maxX = platform.velX >= 0 ? platform.anchorX + spanX : platform.anchorX;
    platform.minY = platform.velY >= 0 ? platform.anchorY : platform.anchorY - spanY;
    platform.maxY = platform.velY >= 0 ? platform.anchorY + spanY : platform.anchorY;

    // Keep the starting position inside its own window so it cannot teleport
    // on the first frame.
    if (platform.velX) platform.x = clamp(platform.x, platform.minX, platform.maxX);
    if (platform.velY) platform.y = clamp(platform.y, platform.minY, platform.maxY);
  }
  return platform;
}

function prepareVehicle(source) {
  return {
    id: source.id,
    type: source.type === 'car' ? 'car' : 'bike',
    x: source.pos.x,
    y: source.pos.y,
    width: source.width ?? (source.type === 'car' ? 80 : 56),
    height: source.height ?? (source.type === 'car' ? 40 : 34),
    velY: 0,
    inUse: false,
    cooldown: 0, // brief lockout after dismounting, so Q doesn't re-board you
  };
}

function preparePowerup(source) {
  return {
    id: source.id,
    // Unknown kinds fall back to 'speed' so a hand-edited level cannot
    // produce a pickup the engine silently ignores.
    type: POWERUP_BY_ID[source.type] ? source.type : 'speed',
    x: source.pos.x,
    y: source.pos.y,
    width: source.width ?? 30,
    height: source.height ?? 30,
    collected: false,
  };
}

/**
 * Par is derived from the distance you actually have to cover, so the HUD's
 * target and the star thresholds agree with each other and hold up for
 * custom levels too (the old build hardcoded par 999 for those).
 */
export function computeParTime(level) {
  const travel = level.theme === 'vertical'
    ? Math.abs(level.startPos.y - level.goalPos.y) + level.width * 0.3
    : Math.abs(level.startPos.x - level.goalPos.x) + level.height * 0.3;
  const seconds = travel / 170;
  return Math.max(6, Math.round(seconds * 10) / 10);
}

/** Star thresholds as multiples of par. */
export function starsForTime(seconds, parTime) {
  if (seconds <= parTime) return 5;
  if (seconds <= parTime * 1.35) return 4;
  if (seconds <= parTime * 1.8) return 3;
  if (seconds <= parTime * 2.6) return 2;
  return 1;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export { VIEW_W, VIEW_H };
