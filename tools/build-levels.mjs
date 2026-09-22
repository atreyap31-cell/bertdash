// Generates the campaign's new act (levels 34-45) and rewrites js/data/levels.js.
//
// Every gap and rise is sized against the movement envelope that
// tools/measure.mjs reports from the real engine, so nothing asks for a jump
// the player cannot make:
//
//   move                rise   gap
//   running jump         179   329
//   + air jump           223   531
//   long jump            112   712
//   long jump + air      135  1139
//   dive                 148   816
//   bag bounce           320   416
//   bag bounce + air     320   695
//   wall shaft climb     847     -
//
// The important consequence: nothing except the bag bounce clears a rise above
// ~230px without a wall. Ledges placed 250-310px up are therefore bag-bounce
// gates, and several levels here are built on exactly that.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// --- piece helpers ---------------------------------------------------------

const solid = (x, y, width, height = 200) => ({ x, y, width, height, type: 'static' });
const ledge = (x, y, width = 160) => ({ x, y, width, height: 20, type: 'static' });
const wall = (x, y, height, width = 40) => ({ x, y, width, height, type: 'static' });
const spikes = (x, y, width) => ({ x, y, width, height: 20, type: 'spike' });
const vanish = (x, y, width = 140) => ({ x, y, width, height: 20, type: 'vanishing', opacity: 1 });
const belt = (x, y, width, conveyorVel) => ({ x, y, width, height: 20, type: 'static', conveyorVel });

const mover = (x, y, width, { velX = 0, velY = 0, range = 240 } = {}) => ({
  x, y, width, height: 20, type: 'moving', velX, velY, range, startPos: { x, y },
});

const laser = (x, y, height, { interval = 2000, offset = 0 } = {}) => ({
  x, y, width: 10, height, type: 'laser', interval, offset,
});

const door = (x, y, height, { width = 40, interval = 3000, offset = 0 } = {}) => ({
  x, y, width, height, type: 'door', interval, offset,
});

const pickup = (type, x, y) => ({
  id: `pu-${type}-${x}-${y}`, type, pos: { x, y }, width: 30, height: 30,
});

const ride = (type, x, y) => ({
  id: `v-${type}-${x}`, type, pos: { x, y },
  width: type === 'car' ? 80 : 56, height: type === 'car' ? 40 : 34,
});

function level(id, title, description, body) {
  return {
    id, title, description, isFinalLevel: false,
    vehicles: [], powerups: [], physics: {}, ...body,
  };
}

const NEW = [];

// 34 — the air jump, on gaps a single jump cannot clear.
NEW.push(level(34, 'DOUBLE SHIFT', 'Two jumps. You will need both.', {
  width: 4600, height: 700, theme: 'horizontal', background: '#111827',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 },
  goalPos: { x: 4400, y: 450 },
  platforms: [
    solid(0, 500, 560),
    ledge(1000, 470, 200),   // 440 gap: past a plain jump
    ledge(1640, 440, 200),
    ledge(2280, 470, 200),
    solid(2900, 500, 300),
    ledge(3600, 430, 200),
    solid(4180, 500, 420),
    spikes(3220, 680, 340),
  ],
}));

// 35 — a shaft climbed on wall kicks alone.
NEW.push(level(35, 'THE SHAFT', 'Kick off the walls. Do not look down.', {
  width: 800, height: 3000, theme: 'vertical', background: '#0f172a',
  startPos: { x: 360, y: 2870 }, foodPos: { x: 400, y: 2870 },
  goalPos: { x: 400, y: 200 },
  platforms: [
    solid(0, 2920, 800, 80),
    wall(150, 300, 2620, 60),
    wall(590, 300, 2620, 60),
    ledge(250, 2300, 300),
    ledge(250, 1500, 300),
    ledge(250, 700, 300),
    solid(200, 250, 400, 40),
  ],
  physics: { wallSlideEnabled: true },
}));

// 36 — long jumps only. Plain jumps fall short of every gap.
NEW.push(level(36, 'LONG HAUL', 'Slide first. A standing jump will not reach.', {
  width: 5200, height: 700, theme: 'horizontal', background: '#1e1b4b',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 },
  goalPos: { x: 5020, y: 450 },
  platforms: [
    solid(0, 500, 640),
    solid(1240, 500, 640),   // 600 gaps: long-jump range
    solid(2480, 500, 640),
    solid(3720, 500, 640),
    solid(4880, 500, 320),
    spikes(700, 680, 480),
    spikes(1940, 680, 480),
    spikes(3180, 680, 480),
    spikes(4420, 680, 400),
  ],
}));

// 37 — THE BAG BOUNCE. Every shelf is too high for any jump; the only way up
//      is to throw the bag, jump after it and catch it. Magnets soften the
//      learning curve, and the last one is removed.
NEW.push(level(37, 'UP AND OVER', 'Throw the bag up. Jump. Catch it. Ride it.', {
  width: 4400, height: 1100, theme: 'horizontal', background: '#312e81',
  startPos: { x: 90, y: 852 }, foodPos: { x: 130, y: 852 },
  goalPos: { x: 4230, y: 220 },
  platforms: [
    solid(0, 900, 640),
    ledge(760, 620, 240),    // 280 up: above an air jump, inside a bag bounce
    ledge(1300, 620, 240),
    ledge(1300, 340, 240),   // another 280 up
    ledge(1900, 620, 240),
    ledge(2480, 340, 240),
    ledge(3060, 620, 240),
    ledge(3620, 340, 240),
    solid(4120, 280, 280, 820),
    spikes(660, 1080, 3440),
  ],
  powerups: [
    pickup('magnet', 300, 840),
    pickup('magnet', 1360, 560),
    pickup('magnet', 2540, 280),
  ],
}));

// 38 — bag bounce chained with the air jump, over real drops.
NEW.push(level(38, 'AIR MAIL', 'Bounce, then jump again at the top.', {
  width: 5000, height: 1300, theme: 'horizontal', background: '#0c4a6e',
  startPos: { x: 90, y: 1052 }, foodPos: { x: 130, y: 1052 },
  goalPos: { x: 4820, y: 260 },
  platforms: [
    solid(0, 1100, 560),
    ledge(900, 820, 220),
    ledge(1560, 540, 220),   // 280 rises, stacked
    ledge(2220, 820, 220),
    ledge(2880, 540, 220),
    ledge(3540, 300, 220),   // 240 up from the last, needs the air jump on top
    solid(4180, 320, 820, 980),
    spikes(600, 1280, 3520),
  ],
  powerups: [pickup('magnet', 300, 1040), pickup('magnet', 2280, 760)],
}));

// 39 — laser corridor, with shields as the margin for error.
NEW.push(level(39, 'SHIELDED', 'A shield buys you exactly one mistake.', {
  width: 4600, height: 700, theme: 'horizontal', background: '#450a0a',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 },
  goalPos: { x: 4420, y: 450 },
  platforms: [
    solid(0, 500, 4600),
    ...Array.from({ length: 9 }, (_, i) =>
      laser(720 + i * 420, 220, 280, { interval: 2000, offset: i * 220 })),
  ],
  powerups: [
    pickup('shield', 420, 440),
    pickup('shield', 2120, 440),
    pickup('shield', 3500, 440),
    pickup('speed', 1320, 440),
  ],
}));

// 40 — a car, a long straight, and the boost.
NEW.push(level(40, 'BOOST ALLEY', 'Shift to boost. Mind the gaps.', {
  width: 6000, height: 700, theme: 'horizontal', background: '#172554',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 },
  goalPos: { x: 5840, y: 450 },
  platforms: [
    solid(0, 500, 1400),
    solid(1780, 500, 1220),
    solid(3380, 500, 1220),
    solid(4980, 500, 1020),
    spikes(1420, 680, 340),
    spikes(3020, 680, 340),
    spikes(4620, 680, 340),
  ],
  vehicles: [ride('car', 420, 460), ride('car', 2100, 460), ride('car', 3700, 460)],
}));

// 41 — crawl tunnels and belts. Slide, or stop.
NEW.push(level(41, 'CRAWLSPACE', 'Some of this is too low to stand up in.', {
  width: 4800, height: 700, theme: 'horizontal', background: '#1c1917',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 },
  goalPos: { x: 4620, y: 450 },
  platforms: [
    solid(0, 500, 4800),
    solid(700, 380, 520, 90),    // 30px crawl space above the floor
    solid(1760, 380, 520, 90),
    solid(2960, 380, 520, 90),
    belt(1320, 480, 380, 4),
    belt(2420, 480, 440, -3),
    belt(3620, 480, 420, 5),
    spikes(4120, 480, 200),
  ],
}));

// 42 — vanishing steps up a shaft, with walls to recover on.
NEW.push(level(42, 'THE GAUNTLET', 'Nothing you stand on stays.', {
  width: 800, height: 3400, theme: 'vertical', background: '#134e4a',
  startPos: { x: 360, y: 3270 }, foodPos: { x: 400, y: 3270 },
  goalPos: { x: 400, y: 210 },
  platforms: [
    solid(0, 3320, 800, 80),
    wall(70, 400, 2800, 50),
    wall(680, 400, 2800, 50),
    ...Array.from({ length: 15 }, (_, i) =>
      vanish(i % 2 === 0 ? 190 : 430, 3060 - i * 195, 180)),
    solid(250, 260, 300, 40),
  ],
  physics: { wallSlideEnabled: true },
}));

// 43 — low gravity: long floaty arcs, and the bag hangs longer too.
NEW.push(level(43, 'SKY COURIER', 'Low gravity. Everything hangs.', {
  width: 5400, height: 1100, theme: 'horizontal', background: '#1e3a8a',
  startPos: { x: 90, y: 852 }, foodPos: { x: 130, y: 852 },
  goalPos: { x: 5220, y: 300 },
  platforms: [
    solid(0, 900, 540),
    ledge(920, 800, 200),
    ledge(1520, 680, 200),
    ledge(2120, 560, 200),
    ledge(2720, 460, 200),
    ledge(3320, 560, 200),
    ledge(3920, 440, 200),
    ledge(4520, 360, 200),
    solid(5040, 340, 360, 760),
    mover(1200, 620, 160, { velX: 2.5, range: 240 }),
    mover(3720, 300, 160, { velY: 2, range: 200 }),
  ],
  powerups: [pickup('jump', 960, 740), pickup('speed', 3360, 500)],
  physics: { gravityScale: 0.55 },
}));

// 44 — timed doors and shuttles. Read the rhythm.
NEW.push(level(44, 'RUSH HOUR', 'Everything here is on a timer.', {
  width: 5200, height: 800, theme: 'horizontal', background: '#3f3f46',
  startPos: { x: 90, y: 552 }, foodPos: { x: 130, y: 552 },
  goalPos: { x: 5020, y: 550 },
  platforms: [
    solid(0, 600, 720),
    solid(1520, 600, 520),
    solid(2920, 600, 520),
    solid(4320, 600, 880),
    mover(840, 540, 220, { velX: 3.2, range: 420 }),
    mover(2140, 540, 220, { velX: -3.2, range: 420 }),
    mover(3540, 540, 220, { velX: 3.2, range: 420 }),
    door(1720, 380, 220, { interval: 2600, offset: 0 }),
    door(3120, 380, 220, { interval: 2600, offset: 1300 }),
    door(4520, 380, 220, { interval: 2600, offset: 650 }),
    spikes(740, 780, 760),
    spikes(2060, 780, 840),
    spikes(3460, 780, 840),
  ],
}));

// 45 — the closer: long jumps, a wall, bag bounces and a laser run.
NEW.push(level(45, 'LAST DELIVERY', 'Everything Bert taught you, in one shift.', {
  width: 6600, height: 1200, theme: 'horizontal', background: '#0b0b12',
  startPos: { x: 90, y: 952 }, foodPos: { x: 130, y: 952 },
  goalPos: { x: 6400, y: 300 },
  platforms: [
    solid(0, 1000, 580),
    // Long-jump stretch
    solid(1180, 1000, 480),
    solid(2260, 1000, 480),
    spikes(620, 1180, 540),
    spikes(1700, 1180, 540),
    // Wall kick section
    wall(2820, 460, 540),
    wall(3260, 460, 540),
    ledge(2900, 960, 320),
    solid(3340, 1000, 420),
    // Bag-bounce steps: 280 up each, nothing else reaches
    ledge(3980, 720, 200),
    ledge(4520, 440, 200),
    // Laser run to the finish
    solid(5000, 380, 1600, 820),
    laser(5240, 100, 280, { interval: 1800, offset: 0 }),
    laser(5580, 100, 280, { interval: 1800, offset: 600 }),
    laser(5920, 100, 280, { interval: 1800, offset: 1200 }),
    laser(6220, 100, 280, { interval: 1800, offset: 300 }),
  ],
  powerups: [
    pickup('shield', 300, 940),
    pickup('magnet', 3400, 940),
    pickup('speed', 5060, 320),
  ],
  physics: { wallSlideEnabled: true },
}));

// --- the vertical act ------------------------------------------------------
//
// Everything above is mostly horizontal. These are climbs, where height is the
// problem and the whole moveset is the answer: shelves 260-300px apart can only
// be taken with a bag bounce, shafts are climbed on wall kicks, and the gaps in
// between are air jumps.

/** Alternating shelves up a shaft, at a fixed vertical spacing. */
function climb(count, { top, spacing, left = 120, right = 480, width = 200, startSide = 0 }) {
  return Array.from({ length: count }, (_, i) =>
    ledge((i + startSide) % 2 === 0 ? left : right, top + i * spacing, width));
}

// 46 — a pure bag-bounce climb. 270px between shelves: nothing else reaches.
NEW.push(level(46, 'TOWER BLOCK', 'Throw the bag up. Follow it. Every floor.', {
  width: 800, height: 3200, theme: 'vertical', background: '#1e1b4b',
  startPos: { x: 360, y: 3060 }, foodPos: { x: 400, y: 3060 },
  goalPos: { x: 400, y: 240 },
  platforms: [
    solid(0, 3110, 800, 90),
    ...climb(10, { top: 380, spacing: 270 }),
    solid(280, 300, 240, 40),
  ],
  powerups: [
    pickup('magnet', 150, 2790),
    pickup('magnet', 510, 1980),
    pickup('magnet', 150, 1170),
  ],
}));

// 47 — a stairwell of wall kicks. Each shaft is a 620px climb, comfortably
//      inside the 847px a wall climb measures, with a landing between them.
NEW.push(level(47, 'STAIRWELL', 'Up the walls, across the landings.', {
  width: 800, height: 3600, theme: 'vertical', background: '#0f172a',
  startPos: { x: 360, y: 3470 }, foodPos: { x: 400, y: 3470 },
  goalPos: { x: 400, y: 260 },
  platforms: [
    solid(0, 3520, 800, 80),
    ...Array.from({ length: 5 }, (_, i) => {
      const landing = 2900 - i * 620;       // 3520 -> 2900 -> 2280 -> ...
      return [
        wall(120, landing + 60, 560, 50),
        wall(560, landing + 60, 560, 50),
        ledge(240, landing, 320),
      ];
    }).flat(),
    solid(280, 320, 240, 40),
  ],
  physics: { wallSlideEnabled: true },
}));

// 48 — lifts and bag bounces together.
NEW.push(level(48, 'THE ATRIUM', 'Ride what moves. Throw for the rest.', {
  width: 800, height: 3400, theme: 'vertical', background: '#134e4a',
  startPos: { x: 360, y: 3270 }, foodPos: { x: 400, y: 3270 },
  goalPos: { x: 400, y: 230 },
  platforms: [
    solid(0, 3320, 800, 80),
    mover(300, 3200, 200, { velY: -2.5, range: 900 }),
    ledge(100, 2260, 200),
    ledge(500, 1990, 200),
    mover(300, 1900, 200, { velY: -2.5, range: 800 }),
    ledge(100, 1060, 200),
    ledge(500, 790, 200),
    mover(300, 700, 200, { velY: -2, range: 400 }),
    solid(280, 280, 240, 40),
  ],
}));

// 49 — a vent shaft: slide through the low gaps, kick up between them.
NEW.push(level(49, 'VENT SHAFT', 'Too low to stand. Too high to walk.', {
  width: 800, height: 2800, theme: 'vertical', background: '#1c1917',
  startPos: { x: 360, y: 2670 }, foodPos: { x: 400, y: 2670 },
  goalPos: { x: 400, y: 240 },
  platforms: [
    solid(0, 2720, 800, 80),
    ...Array.from({ length: 6 }, (_, i) => {
      const y = 2380 - i * 400;
      const holeLeft = i % 2 === 0;
      const x = holeLeft ? 220 : 0;
      return [ledge(x, y, 580), solid(x, y - 120, 580, 90)];
    }).flat(),
    wall(0, 300, 2100, 40),
    wall(760, 300, 2100, 40),
    solid(280, 300, 240, 40),
  ],
  physics: { wallSlideEnabled: true },
}));

// 50 — scaffolding that disappears under you, climbed on bounces and kicks.
NEW.push(level(50, 'SCAFFOLD', 'Keep moving. None of it holds.', {
  width: 800, height: 3400, theme: 'vertical', background: '#3f3f46',
  startPos: { x: 360, y: 3270 }, foodPos: { x: 400, y: 3270 },
  goalPos: { x: 400, y: 230 },
  platforms: [
    solid(0, 3320, 800, 80),
    wall(40, 500, 2700, 40),
    wall(720, 500, 2700, 40),
    ...Array.from({ length: 12 }, (_, i) =>
      vanish(i % 2 === 0 ? 160 : 460, 3060 - i * 240, 180)),
    solid(280, 280, 240, 40),
  ],
  powerups: [pickup('magnet', 200, 2980), pickup('shield', 500, 1620)],
  physics: { wallSlideEnabled: true },
}));

// 51 — a descent instead of a climb.
NEW.push(level(51, 'FREE FALL', 'Down is the easy direction. Mind the edges.', {
  width: 900, height: 3600, theme: 'vertical', background: '#450a0a',
  startPos: { x: 420, y: 280 }, foodPos: { x: 460, y: 280 },
  goalPos: { x: 450, y: 3420 },
  platforms: [
    solid(300, 340, 300, 40),
    ...Array.from({ length: 11 }, (_, i) => {
      const y = 600 + i * 260;
      return i % 2 === 0
        ? [ledge(0, y, 520), spikes(0, y - 20, 520)]
        : [ledge(380, y, 520), spikes(380, y - 20, 520)];
    }).flat(),
    solid(0, 3470, 900, 130),
  ],
  powerups: [pickup('shield', 420, 540), pickup('shield', 120, 1840)],
}));

// 52 — the long climb: every mechanic, one shaft. Each section is sized to the
//      move it is asking for — 600px shafts for kicks, 270px steps for bounces.
NEW.push(level(52, 'THE SPIRE', 'The whole job, straight up.', {
  width: 800, height: 4600, theme: 'vertical', background: '#312e81',
  startPos: { x: 360, y: 4470 }, foodPos: { x: 400, y: 4470 },
  goalPos: { x: 400, y: 260 },
  platforms: [
    solid(0, 4520, 800, 80),
    // 1: two wall-kick shafts, 600px each
    wall(120, 3980, 540, 50),
    wall(560, 3980, 540, 50),
    ledge(240, 3920, 320),
    wall(120, 3380, 540, 50),
    wall(560, 3380, 540, 50),
    ledge(240, 3320, 320),
    // 2: bag-bounce steps, 270px apart
    ledge(120, 3050, 200),
    ledge(480, 2780, 200),
    ledge(120, 2510, 200),
    // 3: a lift up the middle
    mover(300, 2420, 200, { velY: -3, range: 700 }),
    ledge(480, 1660, 200),
    // 4: vanishing steps, 200px apart so an air jump carries them
    ...Array.from({ length: 5 }, (_, i) => vanish(i % 2 === 0 ? 150 : 470, 1460 - i * 200, 180)),
    // 5: a last shaft to the roof
    wall(120, 400, 480, 50),
    wall(560, 400, 480, 50),
    solid(280, 320, 240, 40),
  ],
  powerups: [
    pickup('magnet', 200, 3840),
    pickup('shield', 520, 2700),
    pickup('jump', 200, 1380),
  ],
  physics: { wallSlideEnabled: true },
}));

// 53 — the closer. Bounce steps at 270px, a 600px shaft, lifts past the
//      lasers, a vanishing run, and one last bounce onto the roof.
NEW.push(level(53, 'PENTHOUSE RUN', 'Top floor. He is waiting.', {
  width: 900, height: 5000, theme: 'vertical', background: '#0b0b12',
  startPos: { x: 420, y: 4870 }, foodPos: { x: 460, y: 4870 },
  goalPos: { x: 450, y: 300 },
  platforms: [
    solid(0, 4920, 900, 80),
    // Opening climb on bag bounces
    ledge(160, 4650, 220),
    ledge(540, 4380, 220),
    ledge(160, 4110, 220),
    // Wall shaft
    wall(160, 3560, 560, 50),
    wall(680, 3560, 560, 50),
    ledge(280, 3500, 380),
    // Lift past the lasers
    mover(360, 3400, 220, { velY: -3, range: 900 }),
    laser(220, 2800, 300, { interval: 1800, offset: 0 }),
    laser(700, 2800, 300, { interval: 1800, offset: 900 }),
    ledge(160, 2440, 220),
    // Vanishing run, 210px steps
    ...Array.from({ length: 6 }, (_, i) => vanish(i % 2 === 0 ? 520 : 180, 2230 - i * 210, 200)),
    // Final bounce onto the roof
    ledge(520, 900, 220),
    ledge(180, 630, 220),
    solid(300, 360, 300, 40),
  ],
  powerups: [
    pickup('magnet', 220, 4570),
    pickup('shield', 320, 3420),
    pickup('magnet', 560, 2150),
  ],
  physics: { wallSlideEnabled: true },
  isFinalLevel: true,
}));

// 54 — ice. Normal platforms grip hard; these do not, which is the whole
//      obstacle. Stopping is the difficulty, not moving.
NEW.push(level(54, 'COLD STORAGE', 'Nothing here grips. Plan your stops.', {
  width: 5200, height: 800, theme: 'horizontal', background: '#0e7490',
  startPos: { x: 90, y: 552 }, foodPos: { x: 130, y: 552 },
  goalPos: { x: 5020, y: 550 },
  platforms: [
    solid(0, 600, 900),
    solid(1180, 600, 620),
    solid(2080, 600, 620),
    solid(2980, 600, 620),
    solid(3880, 600, 520),
    solid(4680, 600, 520),
    spikes(940, 780, 200),
    spikes(1840, 780, 200),
    spikes(2740, 780, 200),
    spikes(3640, 780, 200),
    spikes(4440, 780, 200),
    // Narrow shelves you have to stop on, which is the hard part on ice.
    ledge(1360, 420, 140),
    ledge(2260, 420, 140),
    ledge(3160, 420, 140),
  ],
  powerups: [pickup('magnet', 300, 540), pickup('shield', 2180, 540)],
  physics: { friction: 0.985 },
}));

// --- the hard act ----------------------------------------------------------
//
// These force the moves rather than offering them. A bag-bounce gate is a shelf
// 280px up with no wall and no alternative route: nothing else in the moveset
// reaches it. A kick chain is a shaft with no ledges in it. An air delivery is
// Bert on an island you cannot stand on.
//
// The reachability test is what keeps them honest — each one is only solvable
// through the move it is built around.

const hintZone = (x, y, text, width = 460, height = 340) => ({ x, y, width, height, text });

// 55 — bag bounce, over and over, with nothing else that reaches.
NEW.push(level(55, 'THE STACK', 'Every floor needs the bag.', {
  width: 800, height: 3600, theme: 'vertical', background: '#1e1b4b',
  startPos: { x: 340, y: 3452 }, foodPos: { x: 380, y: 3452 },
  goalPos: { x: 400, y: 260 },
  platforms: [
    solid(0, 3500, 800, 100),
    // Twelve shelves at 270: the bag bounce, twelve times, with no walls to
    // kick off and no ledges in between.
    ...Array.from({ length: 12 }, (_, i) =>
      ledge(i % 2 === 0 ? 120 : 460, 3230 - i * 270, 220)),
    solid(280, 320, 240, 40),
  ],
  hints: [
    hintZone(60, 3150, 'No walls, no shortcuts. Throw, jump, catch — twelve times.', 700, 300),
  ],
}));

// 56 — a kick chain with nothing to stand on for the whole climb.
NEW.push(level(56, 'NO HANDHOLDS', 'There is nowhere to stop.', {
  width: 800, height: 3000, theme: 'vertical', background: '#0f172a',
  startPos: { x: 360, y: 2852 }, foodPos: { x: 400, y: 2852 },
  goalPos: { x: 400, y: 260 },
  platforms: [
    solid(0, 2900, 800, 100),
    // Four shafts, each a 640px climb, separated by the thinnest landings.
    ...Array.from({ length: 4 }, (_, i) => {
      const landing = 2260 - i * 640;
      return [
        wall(120, landing + 60, 580, 50),
        wall(600, landing + 60, 580, 50),
        ledge(330, landing, 140),
      ];
    }).flat(),
    solid(300, 320, 200, 40),
    // Falling the whole way down is fatal, but leave the spawn itself clear.
    spikes(0, 2880, 280),
    spikes(560, 2880, 240),
  ],
  physics: { wallSlideEnabled: true },
  hints: [
    hintZone(60, 2600, 'The landings are barely wider than you are. Keep the chain going.', 700, 280),
  ],
}));

// 57 — Bert on an island. The only way to reach him is to throw.
NEW.push(level(57, 'SPECIAL DELIVERY', 'You cannot get there. The bag can.', {
  width: 5200, height: 900, theme: 'horizontal', background: '#0c4a6e',
  startPos: { x: 90, y: 652 }, foodPos: { x: 130, y: 652 },
  goalPos: { x: 4560, y: 400 },
  platforms: [
    solid(0, 700, 900),
    solid(1300, 700, 600),
    solid(2300, 700, 600),
    solid(3300, 640, 600, 260),
    // Bert's island: too far to jump to, comfortably inside a charged throw.
    solid(4500, 440, 400, 460),
    spikes(920, 880, 360),
    spikes(1920, 880, 360),
    spikes(2920, 880, 360),
    spikes(3920, 880, 560),
  ],
  powerups: [pickup('speed', 3400, 580)],
  hints: [
    hintZone(3280, 300, 'That gap is not crossable. Charge a throw and land the bag on Bert instead.', 620, 400),
  ],
}));

// 58 — long jumps and bounces alternating, no safe ground between.
NEW.push(level(58, 'PIECEWORK', 'Slide, launch, throw, catch. Repeat.', {
  width: 6000, height: 1200, theme: 'horizontal', background: '#312e81',
  startPos: { x: 90, y: 952 }, foodPos: { x: 130, y: 952 },
  goalPos: { x: 5800, y: 340 },
  platforms: [
    solid(0, 1000, 700),
    // Long jump...
    solid(1320, 1000, 420),
    // ...then a bounce up...
    ledge(1900, 720, 220),
    // ...then a long jump from height...
    solid(2500, 720, 420),
    ledge(3100, 440, 220),
    solid(3700, 440, 420),
    ledge(4300, 720, 220),
    solid(4900, 720, 420),
    solid(5600, 400, 400, 800),
    spikes(720, 1180, 580),
    spikes(1760, 1180, 720),
    spikes(2940, 1180, 1340),
    spikes(4340, 1180, 540),
  ],
  powerups: [pickup('magnet', 300, 940), pickup('magnet', 2560, 660)],
  hints: [
    hintZone(60, 620, 'Nothing here is a plain jump. Slide into the long ones, throw for the high ones.', 640, 380),
  ],
}));

// 59 — a descent where the only brakes are dives.
NEW.push(level(59, 'TERMINAL VELOCITY', 'Down, fast, through all of it.', {
  width: 1000, height: 4200, theme: 'vertical', background: '#450a0a',
  startPos: { x: 440, y: 292 }, foodPos: { x: 480, y: 292 },
  goalPos: { x: 500, y: 4020 },
  platforms: [
    solid(340, 340, 320, 40),
    ...Array.from({ length: 13 }, (_, i) => {
      const y = 620 + i * 260;
      const left = i % 2 === 0;
      return [
        ledge(left ? 0 : 560, y, 440),
        spikes(left ? 0 : 560, y - 20, 440),
        ...(i % 3 === 2
          ? [laser(left ? 520 : 440, y - 260, 240, { interval: 1700, offset: i * 240 })]
          : []),
      ];
    }).flat(),
    solid(0, 4070, 1000, 130),
  ],
  powerups: [pickup('shield', 460, 560), pickup('shield', 120, 2180), pickup('shield', 640, 3220)],
  hints: [
    hintZone(60, 420, 'Every shelf is spiked on top. Fall through the gaps, and dive to steer.', 880, 220),
  ],
}));

// 60 — vanishing steps with bag bounces between them.
NEW.push(level(60, 'NOTHING HOLDS', 'The floor leaves before you do.', {
  width: 800, height: 3800, theme: 'vertical', background: '#134e4a',
  startPos: { x: 340, y: 3652 }, foodPos: { x: 380, y: 3652 },
  goalPos: { x: 400, y: 280 },
  platforms: [
    solid(0, 3700, 800, 100),
    // Vanishing pairs at 250, so you bounce off one before it goes.
    ...Array.from({ length: 13 }, (_, i) =>
      vanish(i % 2 === 0 ? 130 : 470, 3450 - i * 250, 200)),
    solid(280, 340, 240, 40),
  ],
  powerups: [pickup('magnet', 200, 3600), pickup('magnet', 520, 1950)],
  hints: [
    hintZone(60, 3350, 'Each step fades the moment you touch it. Do not stop.', 700, 280),
  ],
}));

// 61 — the gauntlet: every move, in sequence, no margin.
NEW.push(level(61, 'DOUBLE SHIFT OVERTIME', 'All of it, back to back.', {
  width: 7000, height: 1400, theme: 'horizontal', background: '#0b0b12',
  startPos: { x: 90, y: 1152 }, foodPos: { x: 130, y: 1152 },
  goalPos: { x: 6750, y: 380 },
  platforms: [
    solid(0, 1200, 600),
    // 1: long jumps
    solid(1220, 1200, 400),
    solid(2240, 1200, 400),
    spikes(640, 1380, 560),
    spikes(1660, 1380, 540),
    // 2: a kick shaft
    wall(2760, 620, 580),
    wall(3200, 620, 580),
    ledge(2880, 1160, 280),
    ledge(2900, 580, 260),
    // 3: bounce steps
    ledge(3500, 580, 200),
    ledge(4060, 310, 200),
    // 4: a long drop onto a dive bounce
    solid(4600, 1200, 500),
    spikes(4160, 1380, 420),
    // 5: laser run to Bert
    solid(5400, 460, 1600, 940),
    laser(5620, 180, 280, { interval: 1600, offset: 0 }),
    laser(5960, 180, 280, { interval: 1600, offset: 530 }),
    laser(6300, 180, 280, { interval: 1600, offset: 1060 }),
    laser(6560, 180, 280, { interval: 1600, offset: 260 }),
  ],
  powerups: [
    pickup('shield', 300, 1140),
    pickup('magnet', 2940, 1100),
    pickup('speed', 5460, 400),
  ],
  physics: { wallSlideEnabled: true },
  hints: [
    hintZone(60, 820, 'Last shift. Nothing here is optional.', 560, 340),
  ],
}));

// --- overtime --------------------------------------------------------------
//
// Six levels past what used to be the finale, for when the campaign has stopped
// asking anything. The difficulty pass (tools/difficulty.mjs) put the old run
// at an average of 54 across its last eight levels while the hardest single
// level in the game scored 83; these are built to sit up at that end rather
// than tail off.
//
// Every rise here is deliberately 85-92% of the move that clears it, not 99%.
// Tight is hard; frame-perfect is just unfair.

// 62 — bag bounces strung together over a spike field, on a clock.
NEW.push(level(62, 'NIGHT SHIFT', 'Throw, chase, catch. Do not stop.', {
  width: 4200, height: 1300, theme: 'horizontal', background: '#0c0a1f',
  startPos: { x: 90, y: 1052 }, foodPos: { x: 130, y: 1052 },
  goalPos: { x: 4020, y: 360 },
  platforms: [
    solid(0, 1100, 620),
    ledge(900, 820, 220),       // 280 up: bag bounce
    ledge(1560, 820, 220),
    ledge(2220, 540, 220),      // another 280
    ledge(2880, 540, 220),
    solid(3500, 440, 700, 860),
    spikes(640, 1280, 240),
    spikes(1140, 1280, 400),
    spikes(1800, 1280, 400),
    spikes(2460, 1280, 400),
    spikes(3120, 1280, 360),
    laser(1340, 560, 260, { interval: 1700, offset: 0 }),
    laser(2000, 560, 260, { interval: 1700, offset: 560 }),
    laser(2660, 280, 260, { interval: 1700, offset: 1120 }),
  ],
  powerups: [pickup('magnet', 960, 760), pickup('magnet', 2280, 480)],
  hints: [hintZone(60, 700, 'Every shelf here is a bag bounce. The lasers do not wait.', 540, 320)],
}));

// 63 — a shaft climbed on kicks, with the landings crumbling under you.
NEW.push(level(63, 'THE CHIMNEY', 'Kick up. Do not stand still.', {
  width: 900, height: 3400, theme: 'vertical', background: '#140c0c',
  startPos: { x: 420, y: 3232 }, foodPos: { x: 460, y: 3232 },
  goalPos: { x: 450, y: 240 },
  platforms: [
    solid(0, 3280, 900, 120),
    wall(120, 420, 2860, 60),
    wall(720, 420, 2860, 60),
    ...Array.from({ length: 6 }, (_, i) => vanish(i % 2 === 0 ? 220 : 480, 2900 - i * 470, 200)),
    ledge(300, 380, 300),
    solid(340, 300, 220, 40),
  ],
  physics: { wallSlideEnabled: true },
  powerups: [pickup('shield', 440, 3200), pickup('magnet', 440, 1500)],
  hints: [hintZone(80, 2900, 'The landings give way. Keep the climb going.', 640, 300)],
}));

// 64 — long jumps into a crosswind, which is the only level that makes you
//      account for being pushed mid-flight.
NEW.push(level(64, 'CROSSWIND', 'The wind takes a third of every jump.', {
  width: 5200, height: 1100, theme: 'horizontal', background: '#07283a',
  startPos: { x: 90, y: 852 }, foodPos: { x: 130, y: 852 },
  goalPos: { x: 5020, y: 700 },
  platforms: [
    solid(0, 900, 700),
    // Landings are 200 wide, not 320, and the gaps run to 640 — a long jump
    // manages 712 with nothing pushing back, and the wind takes a chunk of it.
    solid(1340, 900, 200),
    solid(2180, 900, 200),
    solid(3020, 900, 200),
    solid(3860, 900, 1340),
    solid(760, 680, 520, 60),     // low ceilings: slide into the long jump
    solid(1600, 680, 520, 60),
    solid(2440, 680, 520, 60),
    spikes(720, 1080, 600),
    spikes(1560, 1080, 600),
    spikes(2400, 1080, 600),
    spikes(3240, 1080, 600),
    laser(1440, 620, 280, { interval: 1800, offset: 0 }),
    laser(2280, 620, 280, { interval: 1800, offset: 600 }),
    laser(3120, 620, 280, { interval: 1800, offset: 1200 }),
  ],
  physics: { windX: -1.6 },
  powerups: [pickup('speed', 400, 840), pickup('shield', 2340, 840)],
  hints: [hintZone(60, 540, 'Slide, then jump. The wind is against you the whole way.', 560, 320)],
}));

// 65 — doors on a cycle over conveyors, so the floor moves as well as the gaps.
NEW.push(level(65, 'THE GRINDER', 'Timed doors, moving floor.', {
  width: 4600, height: 1000, theme: 'horizontal', background: '#1a1206',
  startPos: { x: 90, y: 752 }, foodPos: { x: 130, y: 752 },
  goalPos: { x: 4420, y: 600 },
  platforms: [
    solid(0, 800, 640),
    // Belts with holes in them: the floor moves and it runs out.
    belt(760, 800, 520, 3.2),
    belt(1460, 800, 520, -3.6),
    belt(2160, 800, 520, 3.8),
    solid(2860, 800, 1740),
    door(1000, 520, 280, { interval: 2200, offset: 0 }),
    door(1700, 520, 280, { interval: 2200, offset: 730 }),
    door(2400, 520, 280, { interval: 2200, offset: 1460 }),
    laser(3060, 520, 280, { interval: 1400, offset: 0 }),
    laser(3400, 520, 280, { interval: 1400, offset: 350 }),
    laser(3740, 520, 280, { interval: 1400, offset: 700 }),
    laser(4080, 520, 280, { interval: 1400, offset: 1050 }),
    spikes(640, 980, 2220),
  ],
  powerups: [pickup('shield', 400, 740), pickup('speed', 2900, 740)],
  hints: [hintZone(60, 440, 'The belts fight you. Read the doors before you commit.', 560, 300)],
}));

// 66 — a descent, which the campaign otherwise barely uses: narrow landings
//      with spikes either side and nothing to grab.
NEW.push(level(66, 'DOWN THE WELL', 'Fall well, or not at all.', {
  width: 1000, height: 3600, theme: 'vertical', background: '#04121c',
  startPos: { x: 470, y: 232 }, foodPos: { x: 510, y: 232 },
  goalPos: { x: 500, y: 3380 },
  platforms: [
    solid(300, 280, 400, 40),
    // Each floor spans the shaft bar a 180px slot, alternating sides, so the
    // way down is a steered weave rather than letting go. Spikes line the slot,
    // which is what makes taking it at speed a decision.
    ...Array.from({ length: 8 }, (_, i) => {
      const y = 620 + i * 340;
      const left = i % 2 === 0;
      return left
        ? [solid(240, y, 760, 30), spikes(60, y + 30, 180),
           laser(190, y - 260, 250, { interval: 1600, offset: i * 380 })]
        : [solid(0, y, 760, 30), spikes(760, y + 30, 180),
           laser(810, y - 260, 250, { interval: 1600, offset: i * 380 })];
    }).flat(),
    solid(0, 3420, 1000, 180),
  ],
  powerups: [pickup('shield', 500, 560), pickup('magnet', 500, 1980)],
  hints: [hintZone(80, 340, 'Down, not up. Every floor has one slot, and it moves.', 640, 300)],
}));

// 67 — the finale: one section of each of the five above, then Bert.
NEW.push(level(67, 'DOUBLE OVERTIME', 'All of it, once more.', {
  width: 7600, height: 1500, theme: 'horizontal', background: '#08060e',
  startPos: { x: 90, y: 1252 }, foodPos: { x: 130, y: 1252 },
  goalPos: { x: 7400, y: 420 },
  platforms: [
    solid(0, 1300, 640),
    // bag bounce steps
    ledge(920, 1020, 200),
    ledge(1500, 740, 200),
    spikes(660, 1480, 820),
    // a kick shaft
    wall(2100, 540, 700),
    wall(2560, 540, 700),
    ledge(2200, 1240, 320),
    ledge(2220, 500, 300),
    // wind crossing
    solid(2960, 900, 300),
    solid(3620, 900, 300),
    solid(4280, 900, 300),
    spikes(3280, 1480, 320),
    spikes(3940, 1480, 320),
    // belts and doors
    belt(4700, 900, 620, 3.4),
    belt(5320, 900, 620, -3.4),
    door(4980, 620, 280, { interval: 2200, offset: 0 }),
    door(5600, 620, 280, { interval: 2200, offset: 730 }),
    // laser run to Bert
    solid(6000, 500, 1600, 1000),
    laser(6240, 220, 280, { interval: 1500, offset: 0 }),
    laser(6620, 220, 280, { interval: 1500, offset: 500 }),
    laser(7000, 220, 280, { interval: 1500, offset: 1000 }),
  ],
  physics: { wallSlideEnabled: true, windX: -1.2 },
  powerups: [
    pickup('magnet', 980, 960),
    pickup('shield', 2260, 1180),
    pickup('speed', 4740, 840),
  ],
  hints: [hintZone(60, 920, 'Overtime. Everything you have learned, back to back.', 560, 340)],
  isFinalLevel: true,
}));

// --- rewrite levels.js -----------------------------------------------------

const levelsPath = join(ROOT, 'js/data/levels.js');
const source = readFileSync(levelsPath, 'utf8');

const marker = 'export const LEVELS = ';
const start = source.indexOf(marker) + marker.length;
// Tolerant of CRLF: git rewrites this file with Windows line endings on
// checkout, and slicing on a bare newline then cut the array short, leaving
// JSON that would not parse.
const crlfEnd = source.indexOf(';' + String.fromCharCode(13,10), start);
const lfEnd = source.indexOf(';' + String.fromCharCode(10), start);
const end = crlfEnd >= 0 && (lfEnd < 0 || crlfEnd < lfEnd) ? crlfEnd : lfEnd;
const existing = JSON.parse(source.slice(start, end));

// Drop anything this script generated before, so it can be re-run.
const base = existing.filter(l => l.id < 34);
const combined = [...base, ...NEW];

// Replace only the LEVELS literal. Everything after it — the TRAINING block,
// CAMPAIGN_LENGTH, anything added later — is preserved verbatim, so running
// this never clobbers what another generator wrote.
const header = source.slice(0, source.indexOf(marker));
const tail = source.slice(end);   // from the ';' that closes the array
writeFileSync(levelsPath, `${header}${marker}${JSON.stringify(combined)}${tail}`);

console.log(`levels.js: ${combined.length} levels (${base.length} existing + ${NEW.length} new)\n`);
for (const l of NEW) {
  console.log(`  ${String(l.id).padStart(2)}  ${l.title.padEnd(16)} ${l.theme.padEnd(10)} `
    + `${String(l.width).padStart(4)}x${String(l.height).padStart(4)}  `
    + `${String(l.platforms.length).padStart(3)} pieces`);
}
