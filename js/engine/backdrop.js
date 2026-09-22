// Level backdrops.
//
// Every level used to draw the same thing: a vertical gradient, one parallax
// skyline and a scatter of static dots, recoloured per level. Sixty-two levels
// looked like one level in sixty-two colours.
//
// These are six distinct backdrops that move, chosen by where a level sits in
// the campaign. They are drawn in screen space with the camera fed in as
// parallax, so nothing here depends on level geometry and none of it can
// affect the simulation.
//
// Everything is deterministic from an index — no stored particles, no
// allocation per frame — so a backdrop costs the same on frame 10,000 as on
// frame one, and a replay of a run looks exactly like the run did.

import { VIEW_W, VIEW_H } from '../data/config.js';

/** Cheap, stable pseudo-random in [0,1) from an integer. */
const rand = i => ((i * 9301 + 49297) % 233280) / 233280;
const rand2 = i => ((i * 4177 + 7919) % 10007) / 10007;

/** Wraps a value into [0, span) so a layer scrolls forever. */
const wrap = (v, span) => ((v % span) + span) % span;

function sky(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// --- city ------------------------------------------------------------------
// Two skylines at different depths, with windows that light and go dark.

function city(ctx, { cam, time, shadeColor, base, reducedFlash }) {
  sky(ctx, shadeColor(base, 22), shadeColor(base, -18));

  for (const layer of [{ depth: 0.2, tint: 'rgba(0,0,0,0.18)', step: 190, tall: 300, lit: false },
                       { depth: 0.42, tint: 'rgba(0,0,0,0.45)', step: 150, tall: 230, lit: true }]) {
    const shift = cam.x * layer.depth;
    ctx.fillStyle = layer.tint;
    for (let i = 0; i < 24; i++) {
      const seed = rand(i + layer.step);
      const w = 60 + seed * 70;
      const h = 90 + seed * layer.tall;
      const x = wrap(i * layer.step - shift, VIEW_W + 400) - 200;
      const y = VIEW_H - h;
      ctx.fillRect(x, y, w, h);

      if (!layer.lit) continue;
      // Windows. Each one keeps its own slow on/off cycle.
      //
      // Kept sparse and dim on purpose: at full strength the grid of lights
      // competed with the platforms and the level got lost in its own skyline.
      ctx.fillStyle = 'rgba(253, 224, 71, 0.26)';
      for (let wx = 10; wx < w - 12; wx += 24) {
        for (let wy = 16; wy < h - 12; wy += 30) {
          const k = i * 97 + wx * 7 + wy;
          const phase = rand2(k);
          const on = reducedFlash
            ? phase > 0.55
            : ((time / 1000) * (0.09 + phase * 0.14) + phase) % 1 > 0.45;
          if (on) ctx.fillRect(x + wx, y + wy, 6, 8);
        }
      }
      ctx.fillStyle = layer.tint;
    }
  }
}

// --- industrial ------------------------------------------------------------
// Pipework and chimneys pushing out smoke that rises and spreads.

function industrial(ctx, { cam, time, shadeColor, base, reducedFlash }) {
  sky(ctx, shadeColor(base, 14), shadeColor(base, -22));

  const shift = cam.x * 0.35;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let i = 0; i < 10; i++) {
    const seed = rand(i * 13 + 3);
    const x = wrap(i * 260 - shift, VIEW_W + 520) - 260;
    const h = 150 + seed * 220;
    ctx.fillRect(x, VIEW_H - h, 54, h);
    ctx.fillRect(x - 10, VIEW_H - h, 74, 16);
  }

  // Smoke: each puff climbs, widens and fades on its own loop.
  for (let i = 0; i < 10; i++) {
    const seed = rand(i * 13 + 3);
    const x = wrap(i * 260 - shift, VIEW_W + 520) - 260 + 27;
    const h = 150 + seed * 220;
    for (let p = 0; p < 4; p++) {
      const t = wrap((time / 1000) * (0.07 + seed * 0.05) + p * 0.25, 1);
      const rise = t * 190;
      const alpha = (1 - t) * (reducedFlash ? 0.1 : 0.2);
      if (alpha <= 0.01) continue;
      ctx.fillStyle = `rgba(226,232,240,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(t * 3 + i) * 18, VIEW_H - h - rise, 10 + t * 26, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Furnace glow along the floor.
  const pulse = reducedFlash ? 0.5 : 0.5 + Math.sin(time / 1600) * 0.12;
  const glow = ctx.createLinearGradient(0, VIEW_H - 120, 0, VIEW_H);
  glow.addColorStop(0, 'rgba(249,115,22,0)');
  glow.addColorStop(1, `rgba(249,115,22,${(0.2 * pulse).toFixed(3)})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, VIEW_H - 120, VIEW_W, 120);
}

// --- tower -----------------------------------------------------------------
// Inside the building: floor bands sliding past as you climb, and strip lights.

function tower(ctx, { cam, time, shadeColor, base }) {
  sky(ctx, shadeColor(base, 16), shadeColor(base, -16));

  const shift = cam.y * 0.45;
  const step = 120;
  for (let i = 0; i < 8; i++) {
    const y = wrap(i * step - shift, VIEW_H + step) - step;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, y, VIEW_W, 46);
    ctx.fillStyle = 'rgba(148,163,184,0.12)';
    ctx.fillRect(0, y + 46, VIEW_W, 2);
  }

  // Structural columns, moving with horizontal parallax.
  const sideShift = cam.x * 0.3;
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (let i = 0; i < 8; i++) {
    const x = wrap(i * 180 - sideShift, VIEW_W + 360) - 180;
    ctx.fillRect(x, 0, 26, VIEW_H);
  }

  // Two lifts travelling in the background, offset so one is nearly always in
  // shot. Without them a tower level is completely still whenever the camera
  // is, which is exactly what made every backdrop feel like wallpaper.
  for (let i = 0; i < 2; i++) {
    const shaftX = i === 0 ? VIEW_W - 150 : 60;
    const dir = i === 0 ? -1 : 1;
    const liftY = wrap(dir * time / 55 + i * 420, VIEW_H + 220) - 110;
    ctx.fillStyle = 'rgba(56,189,248,0.16)';
    ctx.fillRect(shaftX, liftY, 70, 96);
    ctx.fillStyle = 'rgba(56,189,248,0.32)';
    ctx.fillRect(shaftX, liftY, 70, 4);
    ctx.fillRect(shaftX, liftY + 92, 70, 4);
  }

  // A light running down each column, so the structure itself has a pulse.
  for (let i = 0; i < 8; i++) {
    const x = wrap(i * 180 - sideShift, VIEW_W + 360) - 180;
    const t = wrap(time / 6500 + rand(i * 7), 1);
    const y = t * (VIEW_H + 120) - 60;
    const g = ctx.createLinearGradient(0, y - 50, 0, y + 50);
    g.addColorStop(0, 'rgba(56,189,248,0)');
    g.addColorStop(0.5, 'rgba(56,189,248,0.16)');
    g.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y - 50, 26, 100);
  }
}

// --- sky -------------------------------------------------------------------
// Above the clouds: layered banks drifting at different speeds.

function clouds(ctx, { cam, time, shadeColor, base }) {
  sky(ctx, shadeColor(base, 30), shadeColor(base, -10));

  for (const layer of [{ depth: 0.08, drift: 0.005, y: 120, scale: 1.4, alpha: 0.10 },
                       { depth: 0.18, drift: 0.012, y: 260, scale: 1.0, alpha: 0.16 },
                       { depth: 0.34, drift: 0.024, y: 420, scale: 0.7, alpha: 0.22 }]) {
    ctx.fillStyle = `rgba(255,255,255,${layer.alpha})`;
    const shift = cam.x * layer.depth + time * layer.drift;
    for (let i = 0; i < 9; i++) {
      const seed = rand(i * 31 + Math.round(layer.y));
      const x = wrap(i * 230 - shift, VIEW_W + 460) - 230;
      const y = layer.y + seed * 90 - cam.y * layer.depth * 0.5;
      const w = (90 + seed * 110) * layer.scale;
      const h = (26 + seed * 18) * layer.scale;
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.6, y + h * 0.3, w * 0.6, h * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// --- space -----------------------------------------------------------------
// Parallax starfield, a slow nebula and a planet on the horizon.

function space(ctx, { cam, time, shadeColor, base, reducedFlash }) {
  sky(ctx, shadeColor(base, 8), shadeColor(base, -26));

  // Nebula: a couple of very soft blobs that drift.
  for (let i = 0; i < 3; i++) {
    const seed = rand(i * 71 + 11);
    const x = wrap(i * 380 - cam.x * 0.06 + time * 0.004, VIEW_W + 760) - 380;
    const y = 120 + seed * 260 - cam.y * 0.04;
    const r = 180 + seed * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(129,140,248,${(0.14 - i * 0.03).toFixed(3)})`);
    g.addColorStop(1, 'rgba(129,140,248,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // A planet, far enough back that it barely moves.
  const px = wrap(600 - cam.x * 0.05, VIEW_W + 900) - 200;
  const py = 180 - cam.y * 0.04;
  const pg = ctx.createRadialGradient(px - 40, py - 40, 10, px, py, 130);
  pg.addColorStop(0, 'rgba(56,189,248,0.22)');
  pg.addColorStop(1, 'rgba(30,58,138,0.05)');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(px, py, 130, 0, Math.PI * 2);
  ctx.fill();

  // Three star layers. The near ones twinkle unless that has been turned off.
  for (const layer of [{ depth: 0.05, count: 44, size: 1, alpha: 0.35 },
                       { depth: 0.14, count: 30, size: 2, alpha: 0.55 },
                       { depth: 0.28, count: 16, size: 3, alpha: 0.8 }]) {
    for (let i = 0; i < layer.count; i++) {
      const seed = rand2(i * 17 + layer.count);
      const x = wrap(seed * VIEW_W * 3 - cam.x * layer.depth, VIEW_W + 40) - 20;
      const y = wrap(rand(i * 29 + layer.count) * VIEW_H * 3 - cam.y * layer.depth, VIEW_H + 40) - 20;
      const twinkle = reducedFlash ? 1 : 0.76 + Math.sin(time / 700 + seed * 30) * 0.24;
      ctx.fillStyle = `rgba(255,255,255,${(layer.alpha * twinkle).toFixed(3)})`;
      ctx.fillRect(x, y, layer.size, layer.size);
    }
  }
}

// --- cyber -----------------------------------------------------------------
// Neon perspective grid, drifting signage and falling code.

function cyber(ctx, { cam, time, shadeColor, base, reducedFlash }) {
  sky(ctx, shadeColor(base, 10), shadeColor(base, -28));

  // Horizon grid. Lines converge on a vanishing point and scroll towards you.
  const horizon = VIEW_H * 0.55 - cam.y * 0.05;
  ctx.strokeStyle = 'rgba(236,72,153,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -10; i <= 10; i++) {
    const x = VIEW_W / 2 + i * 90 - wrap(cam.x * 0.25, 90);
    ctx.moveTo(VIEW_W / 2, horizon);
    ctx.lineTo(x, VIEW_H);
  }
  for (let i = 1; i < 10; i++) {
    // Slow. A grid rushing at you fills the screen with motion you cannot look
    // away from, and this sits behind the part you actually need to read.
    const t = wrap(i / 10 + (time / 8000), 1);
    const y = horizon + (VIEW_H - horizon) * t * t;
    ctx.moveTo(0, y);
    ctx.lineTo(VIEW_W, y);
  }
  ctx.stroke();

  // Signage slabs at two depths.
  for (const layer of [{ depth: 0.18, step: 240, alpha: 0.1 },
                       { depth: 0.4, step: 170, alpha: 0.16 }]) {
    const shift = cam.x * layer.depth;
    for (let i = 0; i < 10; i++) {
      const seed = rand(i * 19 + layer.step);
      const x = wrap(i * layer.step - shift, VIEW_W + 340) - 170;
      const h = 60 + seed * 160;
      const hue = seed > 0.5 ? '56,189,248' : '236,72,153';
      ctx.fillStyle = `rgba(${hue},${layer.alpha})`;
      ctx.fillRect(x, horizon - h, 30 + seed * 20, h);
    }
  }

  // Falling code. Fewer strands, slower, and dimmer than the first cut, which
  // had twenty-six of them racing down the screen and was tiring to look at.
  if (!reducedFlash) {
    ctx.fillStyle = 'rgba(74,222,128,0.18)';
    for (let i = 0; i < 10; i++) {
      const seed = rand2(i * 23 + 5);
      const x = wrap(seed * VIEW_W * 2 - cam.x * 0.12, VIEW_W + 20) - 10;
      const y = wrap(time * (0.018 + seed * 0.035) + seed * VIEW_H, VIEW_H + 90) - 45;
      for (let k = 0; k < 4; k++) {
        ctx.globalAlpha = 0.18 * (1 - k / 4);
        ctx.fillRect(x, y - k * 14, 2, 8);
      }
    }
    ctx.globalAlpha = 1;
  }
}

const BACKDROPS = { city, industrial, tower, sky: clouds, space, cyber };

/**
 * Which backdrop a level gets.
 *
 * A level may name one; otherwise it follows the campaign's arc — streets,
 * then the factory, the tower, the sky, space, and the city again at night.
 * Anything past the authored run cycles through the same set so a custom level
 * still gets something with movement in it.
 */
export function backdropFor(level) {
  if (level.backdrop && BACKDROPS[level.backdrop]) return BACKDROPS[level.backdrop];

  const id = typeof level.id === 'number' ? level.id : null;
  if (id == null) return level.theme === 'vertical' ? tower : city;

  if (id <= 9) return city;
  if (id <= 15) return industrial;
  if (id <= 21) return tower;
  if (id <= 23) return clouds;
  if (id <= 30) return space;
  if (id <= 33) return cyber;

  // The later run mixes acts, so pick by shape and position rather than
  // pretending the ordering still tells a story.
  const order = [city, industrial, tower, clouds, space, cyber];
  return order[id % order.length];
}

export { BACKDROPS };
