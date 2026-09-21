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
