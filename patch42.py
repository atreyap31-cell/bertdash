import io

# ---------------------------------------------------------------- ghost.js
p = 'js/services/ghost.js'
s = io.open(p, encoding='utf-8').read()

old = "export function clearGhosts() {"
new = '''/** Every level with a saved best run, as its level id. */
export function listGhosts() {
  return ghostKeys().map(key => key.slice(KEY_PREFIX.length));
}

/**
 * Turns a saved best run into something the replay player can show.
 *
 * The ghost track already holds everything a replay needs to draw — where you
 * and the bag were, which way you faced, whether you were sliding, diving or
 * on a wall — so best runs are stored once and used for both. The fields the
 * ghost leaves out are either derivable (the player's height follows from
 * sliding) or purely cosmetic (buffs, flow), and a replay is decoration.
 *
 * @returns {{frames: Array, clips: Array, marks: Array, rate: number}|null}
 */
export function ghostToReel(ghost) {
  if (!ghost?.samples?.length) return null;
  const step = 1000 / ghost.rate;

  const frames = ghost.samples.map((s, i) => ({
    x: s.x, y: s.y, w: 32, h: s.slide ? 26 : 48,
    face: s.face, slide: s.slide, dive: s.dive, wall: s.wall, wallDir: s.wallDir,
    // Velocity only feeds the dive trail, and the recording does not carry it.
    vx: 0, vy: 0, veh: null,
    shield: false, magnet: false, speed: false, jump: false,
    hasFood: s.hasFood,
    fx: s.fx, fy: s.fy, fair: s.fair,
    t: i * step, flow: 0,
  }));

  return {
    frames,
    dropped: 0,
    marks: [],
    rate: ghost.rate,
    clips: [{ label: '', kind: 'run', at: 0, from: 0, to: frames.length - 1 }],
  };
}

export function clearGhosts() {'''
assert old in s
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------------------------------------------------------------- replay.js
p = 'js/ui/replay.js'
s = io.open(p, encoding='utf-8').read()

old = "  constructor({ level, skin, reel, result, reducedFlash, onDone }) {"
new = "  constructor({ level, skin, reel, result, reducedFlash, onDone, speed = 1, label = null }) {"
assert old in s
s = s.replace(old, new, 1)

old = """    this.reel = { ...reel, index: 0 };
    this.result = result;"""
new = """    this.reel = { ...reel, index: 0 };
    this.result = result;
    // A saved best run is stored at 30Hz, so it plays at half a frame per
    // frame. Live reels are recorded at 60 and play at one.
    this.speed = speed;
    this.caption = label;"""
assert old in s
s = s.replace(old, new, 1)

old = """    this.game.replaySpeed = 1;"""
new = """    this.game.replaySpeed = this.speed;"""
assert old in s
s = s.replace(old, new, 1)

old = """    const shown = this.game.replayLabel ?? '';"""
new = """    const shown = this.caption ?? this.game.replayLabel ?? '';"""
assert old in s
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('replay playback from saved runs')
