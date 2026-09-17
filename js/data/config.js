// Tuning constants, cosmetics and achievement definitions.

// Physics are expressed per-frame at SIM_FPS; the engine steps a fixed
// timestep so behaviour is identical on 60Hz and 144Hz displays.
export const SIM_FPS = 60;
export const SIM_STEP = 1000 / SIM_FPS;
export const MAX_FRAME_MS = 100; // never simulate more than this per rAF tick

export const VIEW_W = 800;
export const VIEW_H = 600;

export const PHYSICS = {
  gravity: 0.55,
  friction: 0.85,
  jumpForce: -15,
  moveSpeed: 7,
  terminalVelocity: 16,
  coyoteFrames: 6,        // grace period after walking off an edge
  jumpBufferFrames: 6,    // remembers a jump pressed just before landing
  wallSlideSpeed: 2,
  wallJump: { x: 10, y: -14 },
  slideSpeed: 14,
  slideFrames: 22,
  slideCooldown: 55,
  diveSpeed: 19,
  diveCooldown: 45,
  throwStrength: 9,
  foodGravity: 0.28,
  catchRadius: 46,
  catchCooldown: 14,
  emptyHandBonus: 1.3,    // you move faster once the food is out of your hands
  bike: { speed: 12, jump: -16 },
  car: { speed: 17, jump: -11 },
  buffFrames: 420,
  speedBuff: 1.5,
  jumpBuff: 1.28,
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
  aim: 'rgba(255, 255, 255, 0.32)',
};

export const SKINS = [
  { id: 'base',     name: 'The Trainee',       cost: 0,     color: '#06C167', textColor: '#FFFFFF' },
  { id: 'soggy',    name: 'Soggy Fries',       cost: 150,   color: '#d97706', textColor: '#fde047' },
  { id: 'straw',    name: 'Missing Straw',     cost: 300,   color: '#ef4444', textColor: '#FFFFFF' },
  { id: 'parked',   name: 'Double Parked',     cost: 600,   color: '#eab308', textColor: '#000000' },
  { id: 'beggar',   name: '5-Star Beggar',     cost: 1000,  color: '#78350f', textColor: '#cd7f32' },
  { id: 'surge',    name: 'Surge Pricing',     cost: 2000,  color: '#9333ea', textColor: '#e879f9' },
  { id: 'address',  name: 'Wrong Address',     cost: 3500,  color: '#64748b', textColor: '#cbd5e1' },
  { id: 'cold',     name: 'Cold Pizza',        cost: 5000,  color: '#3b82f6', textColor: '#93c5fd' },
  { id: 'employee', name: 'Employee of Month', cost: 8000,  color: '#e2e8f0', textColor: '#0f172a' },
  { id: 'amir',     name: 'AMIR',              cost: 25000, color: '#f59e0b', textColor: '#4c1d95' },
];

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
  { id: 'legend',       title: 'Legend',         description: 'Complete every campaign level', icon: '♛', check: p => p.stats.levelsCleared >= 33 },
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
