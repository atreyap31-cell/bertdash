import io

AIM_KEYS = {
    'up': 'ArrowUp', 'down': 'ArrowDown', 'left': 'ArrowLeft', 'right': 'ArrowRight',
}

HELPER = '''/**
 * Throws the bag. Aiming is on the arrow keys now: hold one or more to aim and
 * charge, release to let go. `dirs` is any of 'up' 'down' 'left' 'right';
 * two together throw on the diagonal.
 */
function throwDir(dirs, charge = 1) {
  const codes = [].concat(dirs).map(d => ({
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  }[d]));
  codes.forEach(keys.down);
  advance(Math.max(1, charge));
  codes.forEach(keys.up);
  advance(1);                 // the release frame is when the bag leaves
}

'''

# ---------------- engine tests ----------------
p = 'tests/engine.test.mjs'
s = io.open(p, encoding='utf-8').read()

old = s[s.index("/**\n * Throws the bag at a world point"):s.index("test('throwing releases the bag and hitting a surface loses the run'")]
s = s[:s.index("/**\n * Throws the bag at a world point")] + HELPER + s[s.index("test('throwing releases the bag and hitting a surface loses the run'"):]

s = s.replace("""  throwAt(game, canvas, game.player.x + 300, game.player.y);""",
              """  throwDir('right', 1);""")
s = s.replace("""  throwAt(game, canvas, game.player.x + 16, game.player.y - 400);""",
              """  throwDir('up', 1);""")

# The aim-preview test no longer needs a cursor.
s = s.replace("""  game.aim = { x: game.player.x + 400, y: game.player.y };
  const arc = game.predictThrow();""",
              """  keys.down('ArrowRight');
  advance(1);
  const arc = game.predictThrow();
  keys.up('ArrowRight');""")

# The "cannot win without the bag" test parks the food manually; fine.
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------------- ability tests ----------------
p = 'tests/abilities.test.mjs'
s = io.open(p, encoding='utf-8').read()

# Replace the old pointer helper with the keyboard one.
old = s[s.index("/**\n * Throws the bag at a world point"):s.index("test('a thrown bag that reaches Bert completes the delivery'")]
keep_from = s.index("/** Bert on a shelf across a gap far too wide to jump with the bag in hand. */")
s = (s[:s.index("/**\n * Throws the bag at a world point")]
     + HELPER
     + s[keep_from:])

# bagBounce helper: aim up with the arrow keys.
s = s.replace("""function bagBounce(game, canvas, { spendAirJump = false } = {}) {
  throwAt(game, canvas, game.player.x + 40, game.player.y - 500);""",
"""function bagBounce(game, canvas, { spendAirJump = false } = {}) {
  throwDir('up', 1);""")

# Charged-throw comparison.
s = s.replace("""  short.canvas.dispatch('pointermove', { clientX: 400, clientY: 200, preventDefault() {} });
  short.canvas.dispatch('pointerdown', { clientX: 400, clientY: 200, preventDefault() {} });
  short.canvas.dispatch('pointerup', { clientX: 400, clientY: 200, preventDefault() {} });""",
"""  throwDir('right', 1);""")
s = s.replace("""  long.canvas.dispatch('pointermove', { clientX: 400, clientY: 200, preventDefault() {} });
  long.canvas.dispatch('pointerdown', { clientX: 400, clientY: 200, preventDefault() {} });
  advance(PHYSICS.throwChargeFrames + 5);       // wind all the way up
  assert.equal(long.game.chargeRatio(), 1, 'charge should reach full');
  long.canvas.dispatch('pointerup', { clientX: 400, clientY: 200, preventDefault() {} });""",
"""  keys.down('ArrowRight');
  advance(PHYSICS.throwChargeFrames + 5);       // wind all the way up
  assert.equal(long.game.chargeRatio(), 1, 'charge should reach full');
  keys.up('ArrowRight');
  advance(1);""")

s = s.replace("""  canvas.dispatch('pointerdown', { clientX: 400, clientY: 200, preventDefault() {} });
  advance(20);
  canvas.dispatch('pointerup', { clientX: 400, clientY: 200, preventDefault() {} });""",
"""  throwDir('right', 20);""")

# Shield / magnet tests.
s = s.replace("""  const event = { clientX: 700, clientY: 100, preventDefault() {} };
  canvas.dispatch('pointermove', event);
  canvas.dispatch('pointerdown', event);
  canvas.dispatch('pointerup', event);""",
"""  throwDir('right', 1);""")
s = s.replace("""  // Lob it up and slightly away — outside the normal catch radius.
  const event = { clientX: 300, clientY: 120, preventDefault() {} };
  canvas.dispatch('pointermove', event);
  canvas.dispatch('pointerdown', event);
  canvas.dispatch('pointerup', event);""",
"""  // Lob it up and away — outside the normal catch radius.
  throwDir(['up', 'right'], 1);""")

# Long throw at Bert.
s = s.replace("""  throwAt(game, canvas, game.player.x + 700, game.player.y - 700,
    PHYSICS.throwChargeFrames + 2);""",
"""  // Charged and lofted: up+right throws on the diagonal.
  throwDir(['up', 'right'], PHYSICS.throwChargeFrames + 2);""")

# Momentum tests.
s = s.replace("""  throwAt(still.game, still.canvas, still.game.player.x + 400, still.game.player.y - 100);""",
              """  throwDir('right', 1);""")
s = s.replace("""  throwAt(running.game, running.canvas, running.game.player.x + 400, running.game.player.y - 100);""",
              """  throwDir('right', 1);""")
s = s.replace("""  throwAt(ground.game, ground.canvas, ground.game.player.x + 300, ground.game.player.y - 300);""",
              """  throwDir(['up', 'right'], 1);""")
s = s.replace("""  throwAt(rising.game, rising.canvas, rising.game.player.x + 300, rising.game.player.y - 300);""",
              """  throwDir(['up', 'right'], 1);""")

# Bag-survives-hits tests.
s = s.replace("""  throwAt(game, canvas, game.player.x + 260, game.player.y + 60);  // into the floor""",
              """  throwDir(['down', 'right'], 1);   // into the floor""")
s = s.replace("""  throwAt(game, canvas, game.player.x + 260, game.player.y + 60);""",
              """  throwDir(['down', 'right'], 1);""")

# Aim-preview test.
s = s.replace("""  game.aim = { x: game.player.x + 400, y: game.player.y - 200 };
  const arc = game.predictThrow();
  assert.ok(arc.length > 2, 'there should be a trajectory to compare against');
  const predicted = arc[0];

  throwAt(game, canvas, game.player.x + 400, game.player.y - 200);
  advance(1);
  keys.up('KeyD');""",
"""  keys.down('ArrowUp');
  keys.down('ArrowRight');
  advance(1);
  const arc = game.predictThrow();
  assert.ok(arc.length > 2, 'there should be a trajectory to compare against');
  const predicted = arc[0];

  keys.up('ArrowUp');
  keys.up('ArrowRight');
  advance(1);
  keys.up('KeyD');""")

# Dive tests set game.aim; the dive aims itself now.
s = s.replace("""  game.aim = { x: game.player.x + 400, y: game.player.y };
  tap('KeyE');
  assert.equal(game.player.diving, true, 'should dive from standing');""",
"""  tap('KeyE');
  assert.equal(game.player.diving, true, 'should dive from standing');""")
s = s.replace("""  game.aim = { x: game.player.x + 120, y: game.player.y + 400 }; // dive down-forward
  tap('KeyE');""",
"""  // Steer the dive down and forward with the aim keys.
  keys.down('ArrowDown');
  keys.down('ArrowRight');
  tap('KeyE');
  keys.up('ArrowDown');
  keys.up('ArrowRight');""")
s = s.replace("""  varied.game.aim = { x: varied.game.player.x + 300, y: varied.game.player.y };
  tap('KeyE');                         // dive""",
"""  tap('KeyE');                         // dive""")

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------------- fuzz: arrows are aim keys now ----------------
p = 'tests/fuzz.test.mjs'
s = io.open(p, encoding='utf-8').read()
s = s.replace(
    "const KEYS = ['KeyA', 'KeyD', 'Space', 'KeyS', 'KeyE', 'KeyQ', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];",
    "// Movement is WASD; the arrows aim and throw the bag.\nconst KEYS = ['KeyA', 'KeyD', 'Space', 'KeyS', 'KeyE', 'KeyQ', 'ShiftLeft',\n  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];")
old = """    // Occasionally fling the bag somewhere.
    if (frame % 120 === 60) {
      game.aim = {
        x: game.player.x + (random() - 0.5) * 600,
        y: game.player.y + (random() - 0.5) * 400,
      };
      canvas.dispatch('pointerdown', {
        clientX: 400, clientY: 300, preventDefault() {},
      });
    }
"""
assert old in s
s = s.replace(old, "")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

print('tests moved to keyboard aiming')
