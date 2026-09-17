# BertDash

A browser platformer about delivering a takeaway bag across 34 hand-built levels.
Run, slide, dive and wall-jump to Bert before the food goes cold — and whatever
you do, don't drop the bag.

**Play it: https://atreyap31-cell.github.io/bertdash/**

No install, no build step, no accounts. Progress is saved in your browser.

## Controls

| Key | Action |
| --- | --- |
| `A` `D` / `←` `→` | Move |
| `Space` / `W` / `↑` | Jump. Hold for height |
| `Space` again in mid-air | **Air jump** — one per landing, steer while using it to redirect |
| `Space` against a wall | **Wall kick** — launches you off and refunds the air jump |
| `S` / `↓` | **Slide** — keeps your run-up speed and ducks under low ceilings |
| `S` then `Space` | **Long jump** — trades the slide's momentum for distance |
| `E` | **Dive** toward the cursor, from the ground or mid-air. Land one fast and it rebounds |
| Hold click | **Charge a throw**, release to let the bag go. A dotted arc previews the landing |
| `Shift` | **Boost** while riding a vehicle |
| `Q` | Leave a vehicle (it stays where you left it, and can be re-boarded) |
| `R` | Restart the level |
| `Esc` / `P` | Pause |

Throwing the bag is the risk/reward mechanic: your hands are free so you move
faster, but if the bag touches anything before you catch it, the delivery fails.

### Pickups

| Pickup | Effect |
| --- | --- |
| Speed | Faster movement for a while |
| Jump | Higher jumps for a while |
| Shield | Absorbs one lethal hazard — but never a dropped bag |
| Magnet | Reels a loose bag back in from three times the usual range |

## Running it locally

Any static file server works — the site is plain ES modules with no bundler.

```bash
npx http-server . -p 8080 -c-1
```

Then open http://localhost:8080. Opening `index.html` directly from disk will
not work, because ES modules are blocked on `file://` URLs.

## Tests

```bash
npm test
```

58 tests across four suites:

- `engine` — the physics loop, every platform type, win/lose latching
- `abilities` — one test per move, checking both that it works and that it
  cannot be abused (no infinite air jumps, no free shields, no stuck crouch)
- `fuzz` — drives all 34 levels with pseudo-random input across three seeds
  (~61k simulated frames) and asserts the simulation never breaks its own
  rules: no NaN, no escaping the level, no clipping into solid geometry
- `profile` — save data, achievement rules, peer-code encoding

They run in plain Node against a small DOM stub in `tests/harness.mjs` — no
browser or test framework needed. Each file is run as its own process because
running them together intermittently trips a V8 crash in the Node 24 test
runner's child processes.

## Layout

```
index.html            page shell
css/style.css         all styling
js/
  main.js             app shell: screens, transitions, scoring
  data/
    levels.js         34 authored levels
    config.js         tuning constants, skins, achievements, quotes
  engine/
    game.js           simulation + canvas renderer
    level.js          level preparation, par times, star thresholds
  services/
    profile.js        save data, stats, achievement evaluation
    audio.js          synthesised sound effects
    net.js            WebRTC peer chat
  ui/
    dom.js            element helpers, dialogs, toasts
    screens.js        menu, level select, store, trophies, results
    hud.js            in-game HUD
    editor.js         level editor
tests/                node --test suites
```

## The editor

The workshop is a real level editor, not just a block stamper:

- **Select** anything, shift-click to add, or drag a marquee over a region
- **Edit properties** of the selection — position and size for everything, plus
  speed and range for moving platforms, cycle and offset for lasers and doors,
  belt speed for conveyors, and the kind of a powerup
- **Undo/redo** (`Ctrl+Z` / `Ctrl+Shift+Z`), **copy/paste** (`Ctrl+C` / `Ctrl+V`),
  **duplicate** (`Ctrl+D`), **select all** (`Ctrl+A`), `Delete` to remove
- **Arrow keys** nudge by a grid cell, or by one pixel with `Shift`
- **Drag out a rectangle** for terrain instead of clicking a hundred cells
- **Zoom** with `Ctrl`+wheel, pan with the wheel or a right-drag, and a minimap
  shows where you are in the level
- **Place vehicles and powerups**, which the old editor could not do at all
- **Tune the level's physics** — gravity, run speed, jump height, wind and wall
  sliding — and these are now actually read by the engine
- Levels are **validated** before saving, including a check that the start
  marker is not buried inside a platform

## Notes on the rewrite

This started as a single 160KB HTML file that loaded React, ReactDOM, Babel,
Tailwind and Font Awesome from CDNs and transpiled itself in the browser on
every page load. It is now a dependency-free static site — nothing is fetched
from a third party at runtime, so it loads instantly and works offline.

The engine changed more than the rendering did. The authored level data always
described moving platforms, vanishing platforms, lasers, doors, conveyors,
vehicles, powerups and per-level physics; the old engine ignored all of it and
drew those pieces as ordinary blocks. It now simulates them.

Substantive fixes:

- **Frame-rate independence.** Physics ran once per `requestAnimationFrame`, so
  the player moved more than twice as fast on a 144Hz display. The loop now
  steps a fixed timestep.
- **The listener leak.** The input effect re-ran on every mouse move, re-adding
  `keydown`/`keyup` handlers without removing them and restarting the animation
  loop each time.
- **Win and loss fired repeatedly.** Standing on the goal paid out tips every
  frame; a single death could schedule several game-over transitions. Both now
  latch.
- **Jumping was not edge-triggered.** Holding the jump key bounced you
  continuously. Jumps now trigger on press, with coyote time and an input
  buffer.
- **Wall sliding never activated,** so wall jumps were unreachable. It now
  engages without having to hold into the wall.
- **The player could fall through the world.** A sustained sideways force could
  push them outside the level bounds *during* the collision pass, where no floor
  exists; the bounds clamp only ran afterwards.
- **Standing up from a slide clipped through low ceilings.** The player now
  stays crouched when there is no headroom, which is what makes crawl tunnels
  usable as level geometry.
- **The editor's Test button always crashed** — it called `onPlay`, which was
  never passed. The editor also could not scroll vertically, leaving everything
  below the top 600px of a 6000px level unreachable, and its physics sliders
  were saved but never read by the engine.
- **`LZString` was `btoa`,** despite the name: no compression, not URL-safe, and
  it threw on any non-Latin1 character. Peer codes are now genuinely gzipped.
- **Achievements were never awarded.** All 50 were unreachable; there are now 61,
  each with a rule that is actually evaluated.
- Clicking a HUD button also threw the food, because pointer handlers were bound
  to the window rather than the canvas.
- Progress was written to `localStorage` synchronously on every jump; it is now
  debounced, and on a timer rather than `requestAnimationFrame`, which is paused
  outright in a background tab.

Saves from the old build are migrated automatically on first load.

## Licence

MIT — see [LICENSE](LICENSE).
