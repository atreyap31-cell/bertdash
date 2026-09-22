# tools

Development scripts. Not part of the deployed site.

- **`measure.mjs`** — drives the real engine to measure what the player can
  actually do: how high each move rises and how wide a gap it clears. The
  numbers in `tests/reachability.test.mjs` and the table in the main README
  come from here. Re-run it after changing any physics constant.

  ```bash
  node tools/measure.mjs
  ```

- **`build-levels.mjs`** — generates the campaign's newest act (levels 34+) and
  rewrites `js/data/levels.js`. Levels below 34 are hand-authored and left
  untouched, so the script is safe to re-run.

  ```bash
  node tools/build-levels.mjs && npm test
  ```

- **`motion-audit.mjs`** — drives every level with random input and reports
  frames where the player moved further than their velocity accounts for,
  moved barely at all despite having speed, or resized their hitbox mid-air.
  This is how the fixed-timestep stutter was found: at a perfect 60Hz, the
  floating-point representation of `1000/60` made roughly one frame in 120 run
  no simulation step at all.

  ```bash
  node tools/motion-audit.mjs
  ```

- **`camera-audit.mjs`** — measures camera jerk (frame-to-frame change in
  camera velocity) under a steady run, repeated start/stop, and rapid weaving.
  This is how the look-ahead lurch was found: ground friction snaps the
  player's speed to zero on key release, and feeding that straight to the
  camera moved its target ~110px in a single frame.

  ```bash
  node tools/camera-audit.mjs
  ```

- **`spawn-audit.mjs`** — checks every level's spawn: not inside spikes, a
  laser or a door, something to land on below it, and the spot it falls onto is
  not itself lethal. Found STARBASE DELTA spawning the player directly on the
  spike strip that runs down the middle of each tier.

  ```bash
  node tools/spawn-audit.mjs
  ```

- **`build-training.mjs`** — generates the eight training lessons into the
  `TRAINING` export. Safe to re-run; it replaces only its own block, and
  `build-levels.mjs` likewise replaces only `LEVELS`, so the two never clobber
  each other.

  ```bash
  node tools/build-training.mjs && npm test
  ```

- **`throw-range.mjs`** — measures how far a charged throw actually carries.
  The reachability analyser uses this to decide whether a level is solvable by
  throwing the bag to Bert rather than carrying it there.

  ```bash
  node tools/throw-range.mjs
  ```

## `reach.mjs`

The movement model: which surfaces can reach which, and can the spawn reach
Bert. Shared by `tests/reachability.test.mjs` and `bag-audit.mjs` so the test
and the audit cannot drift apart about what the player can do.

It only counts a surface you can actually stand on. Stacked wall segments look
like a row of ledges, but their tops are buried inside the segment above them —
THE SHAFT was nine 300px segments a side, which read as a staircase and was
really one unbroken 2,580px wall climb against a measured limit of about 847px.
The level was impossible and the analyser said it was fine.

## `bag-audit.mjs`

Runs the search twice per level: once with every move, once with the bag
removed. A level that still finishes on the second run can be cleared on legs
alone, so the throw is decoration there.

```bash
node tools/bag-audit.mjs --verbose
```

## `bag-gate.mjs`

Lowers the platforms that reach Bert on foot until a level can only be finished
with a bag bounce, using the analyser as the oracle: it refuses any change that
would also make the level unsolvable, and re-checks the whole campaign before
writing. Levels 0-9 are left alone — they are still teaching you to run.

```bash
node tools/bag-gate.mjs          # dry run
node tools/bag-gate.mjs --write
```

## `run-tests.mjs`

What `npm test` runs. Each suite gets its own process; a suite that *crashes*
is retried, a suite that fails an assertion is not.

The distinction matters because of a V8 access violation on this machine — see
the comment at the top of the file for the evidence, including how the crash
rate scales with how much work one process does. That measurement is why the
fuzzing is split across two files.

## `unoverlap.mjs`

Separates solid platforms embedded in each other. A ledge buried in the side of
a wall makes the collision resolver fight itself — it pushes the player out of
the wall while the ledge holds them up, so standing there jitters. That is what
PENTHOUSE RUN felt like.

It trims the smaller piece back rather than moving it, because most of these
are shelves deliberately anchored into a wall and sliding the shelf would
change the level. A piece buried entirely inside another is redundant and is
removed. It re-checks every level is still solvable before writing.

```bash
node tools/unoverlap.mjs          # dry run
node tools/unoverlap.mjs --write
```

## `difficulty.mjs`

Scores every campaign level so "too easy" and "too hard" become numbers you can
act on. It combines four things: how close the hardest move on the route is to
the limit of what that move can do, whether the route needs the bag or a wall
climb, hazard and timing pressure, and par time.

It then reports which levels sit furthest from the curve their position in the
campaign implies.

```bash
node tools/difficulty.mjs --verbose
node tools/difficulty.mjs --csv
```

Its blind spot is worth knowing: it reasons about rises and gaps between
landing surfaces, so it cannot see the difficulty of steering through a moving
slot on the way down. DOWN THE WELL scores 20 and plays a good deal harder
than that.

## `unspike.mjs`

Leaves somewhere to land on platforms that are entirely covered in spikes.

FREE FALL had eleven of them — every surface for 3,100px was lethal, so the
level was one unbroken fall threading twelve alternating slots. Measured in the
engine, the 260px between its rows buys about 430px of sideways reach, and it
asked for 520. It was not hard, it was impossible, and the route search never
noticed because it treats hazards as thin air.

The repair computes where each platform sits under the opening in the row
above — which is where you actually arrive, having walked off that row's lip —
and leaves that zone clear.

```bash
node tools/unspike.mjs          # dry run
node tools/unspike.mjs --write
```
