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
