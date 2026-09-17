import io

# ---------------- config ----------------
p = 'js/data/config.js'
s = io.open(p, encoding='utf-8').read()

old = """  // Camera. It leads the direction of travel rather than sitting dead-centre,
  // so fast movement shows you where you are going instead of where you were.
  cameraEase: 0.16,
  cameraLeadX: 16,     // frames of horizontal velocity to look ahead by
  cameraLeadY: 10,
  cameraLeadMaxX: 190,
  cameraLeadMaxY: 130,"""
new = """  // Camera. It leads the direction of travel rather than sitting dead-centre,
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
  },"""
assert old in s
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# ---------------- engine ----------------
p = 'js/engine/game.js'
s = io.open(p, encoding='utf-8').read()

# Eased look-ahead.
old = """  #stepCamera() {
    const p = this.player;
    const maxX = Math.max(0, this.level.width - VIEW_W);
    const maxY = Math.max(0, this.level.height - VIEW_H);

    // Look ahead along the direction of travel. Centring exactly on the player
    // means at speed you are always looking at where you have just been.
    const leadX = clamp(p.vx * PHYSICS.cameraLeadX, -PHYSICS.cameraLeadMaxX, PHYSICS.cameraLeadMaxX);
    const leadY = clamp(p.vy * PHYSICS.cameraLeadY, -PHYSICS.cameraLeadMaxY, PHYSICS.cameraLeadMaxY);

    const targetX = clamp(p.x + p.width / 2 + leadX - VIEW_W / 2, 0, maxX);
    const targetY = clamp(p.y + p.height / 2 + leadY - VIEW_H / 2, 0, maxY);"""
new = """  #stepCamera() {
    const p = this.player;
    const maxX = Math.max(0, this.level.width - VIEW_W);
    const maxY = Math.max(0, this.level.height - VIEW_H);

    // Look ahead along the direction of travel, but ease the look-ahead itself
    // rather than reading velocity straight off the player. The player's speed
    // can change by its full amount in a single frame — that is what stopping
    // dead means — and feeding that directly to the camera makes it lurch.
    const wantX = clamp(p.vx * PHYSICS.cameraLeadX, -PHYSICS.cameraLeadMaxX, PHYSICS.cameraLeadMaxX);
    const wantY = clamp(p.vy * PHYSICS.cameraLeadY, -PHYSICS.cameraLeadMaxY, PHYSICS.cameraLeadMaxY);
    this.cameraLead.x += (wantX - this.cameraLead.x) * PHYSICS.cameraLeadEase;
    this.cameraLead.y += (wantY - this.cameraLead.y) * PHYSICS.cameraLeadEase;

    const targetX = clamp(p.x + p.width / 2 + this.cameraLead.x - VIEW_W / 2, 0, maxX);
    const targetY = clamp(p.y + p.height / 2 + this.cameraLead.y - VIEW_H / 2, 0, maxY);"""
assert old in s
s = s.replace(old, new)

old = """    this.camera = {
      x: clamp(start.x - VIEW_W / 2, 0, Math.max(0, this.level.width - VIEW_W)),
      y: clamp(start.y - VIEW_H / 2, 0, Math.max(0, this.level.height - VIEW_H)),
    };"""
new = """    this.camera = {
      x: clamp(start.x - VIEW_W / 2, 0, Math.max(0, this.level.width - VIEW_W)),
      y: clamp(start.y - VIEW_H / 2, 0, Math.max(0, this.level.height - VIEW_H)),
    };
    this.cameraLead = { x: 0, y: 0 };"""
assert old in s
s = s.replace(old, new)

# One place decides how hard the screen kicks, and it respects the setting.
old = """  #spawnParticles(x, y, count, color) {"""
new = """  /** Adds screen shake, capped and scaled by the player's settings. */
  #addShake(amount) {
    if (this.shakeScale <= 0) return;
    this.shake = Math.min(PHYSICS.shake.max, this.shake + amount * this.shakeScale);
  }

  #spawnParticles(x, y, count, color) {"""
assert old in s
s = s.replace(old, new)

old = """    this.reducedFlash = Boolean(options.reducedFlash);"""
new = """    this.reducedFlash = Boolean(options.reducedFlash);
    // 0 disables screen shake entirely; reduced-flash halves it.
    this.shakeScale = options.shakeScale ?? (this.reducedFlash ? 0.4 : 1);"""
assert old in s
s = s.replace(old, new)

# Route every shake through it.
shakes = [
    ("      this.shake = this.reducedFlash ? 2 : 6;\n      this.#bump('diveBounces');",
     "      this.#addShake(PHYSICS.shake.diveBounce);\n      this.#bump('diveBounces');"),
    ("          this.shake = this.reducedFlash ? 2 : 7;\n          this.#spawnParticles(p.x + p.width / 2, p.y + p.height / 2, 18, COLORS.food);",
     "          this.#addShake(PHYSICS.shake.bagBounce);\n          this.#spawnParticles(p.x + p.width / 2, p.y + p.height / 2, 18, COLORS.food);"),
    ("      this.shake = this.reducedFlash ? 3 : 10;\n      this.#bump('shieldsUsed');",
     "      this.#addShake(PHYSICS.shake.shield);\n      this.#bump('shieldsUsed');"),
    ("      this.shake = this.reducedFlash ? 1 : 3;\n      audio.land();",
     "      this.#addShake(PHYSICS.shake.bagGlance);\n      audio.land();"),
    ("    this.shake = this.reducedFlash ? 4 : 18;\n    this.#bump('totalDeaths');",
     "    this.#addShake(PHYSICS.shake.death);\n    this.#bump('totalDeaths');"),
]
for old_frag, new_frag in shakes:
    assert old_frag in s, old_frag[:60]
    s = s.replace(old_frag, new_frag)

# Decay and threshold from config.
s = s.replace("      this.shake *= 0.88;\n      this.#stepParticles();",
              "      this.shake *= PHYSICS.shake.decay;\n      this.#stepParticles();")
s = s.replace("    this.shake *= 0.86;\n    this.pressed.clear();",
              "    this.shake *= PHYSICS.shake.decay;\n    if (this.shake < PHYSICS.shake.cutoff) this.shake = 0;\n    this.pressed.clear();")
old = """    if (this.shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }"""
new = """    if (this.shake > PHYSICS.shake.cutoff) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }"""
assert old in s
s = s.replace(old, new)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('camera lead eased, shake tamed')
