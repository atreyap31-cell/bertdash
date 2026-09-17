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
