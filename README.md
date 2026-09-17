# BertDash

A browser platformer about delivering a takeaway bag across 55 hand-built levels.
Run, slide, dive and wall-jump to Bert before the food goes cold — and whatever
you do, don't drop the bag.

**Play it: https://atreyap31-cell.github.io/bertdash/**

No install, no build step, no accounts. Progress is saved in your browser.

## Controls

Keyboard only — there is no mouse.

**Left hand: moving.**

| Key | Action |
| --- | --- |
| `A` `D` | Move |
| `Space` / `W` | Jump. Hold for height |
| `Space` again mid-air | **Air jump** — one per landing; steer while using it to redirect |
| `Space` against a wall | **Wall kick** — launches you off and refunds the air jump |
| `S` | **Slide** — keeps your run-up speed and ducks under low ceilings |
| `S` then `Space` | **Long jump** — trades the slide's momentum for distance |
| `E` | **Dive** — a flat dash, or a chase if the bag is in the air |
| `Shift` | **Boost** while riding a vehicle |
| `Q` | Leave a vehicle (it stays put and can be re-boarded) |
| `R` / `Esc` | Restart / pause |

**Right hand: the bag.**

| Key | Action |
| --- | --- |
| `←` `↑` `→` `↓` | Aim. Hold to charge, release to throw |
| Two arrows together | Throw on the diagonal |

Every control is rebindable in Settings, and an optional on-screen input
overlay shows exactly what the engine is registering.

### The bag is the whole game

Your hands are free once it is thrown, so you move faster — but where the bag
lands decides the run:

- **A floor or ceiling breaks it.** Throw it at the ground and the delivery is
  over. That is the risk that keeps the throw a decision.
- **A wall only glances it.** It barely rebounds, sheds some fall speed and
  hangs by the wall, so a throw into a wall is something you can dive up and
  catch rather than a loss. Two glances before it gives out.

- **Bag bounce.** Throw it straight up while running, jump after it, catch it in
  mid-air. The catch launches you ~320px, nearly double a jump, and hands back
  your air jump. Several levels have shelves out of reach any other way.
- **Dive to recover.** With the bag loose, `E` dives straight at it — so a throw
  that went wrong is a scramble, not a loss.
- **Deliver by throw.** Land the bag on Bert from range and the level is done.
  It is the fastest finish available and the hardest to pull off.
- **Momentum carries.** The bag inherits your full speed, so a throw made at a
  sprint or off the top of a bounce goes far further than a standing toss.

### Movement assists

The controls read what you were obviously trying to do rather than stopping you
on a pixel:

- **Corner correction** — clip the edge of a ceiling by up to 11px on the way up
  and you are nudged around it instead of bonking.
- **Step-up** — a lip 14px or shorter is walked over, not walked into.
- **Ledge assist** — land just past the lip of a platform and you are pulled
  onto it rather than scraping down the side.
- **Last input wins** — holding both direction keys turns you the way you
  pressed most recently instead of cancelling to a dead stop.
- **Coyote time and jump buffering**, and a camera that leads the direction of
  travel instead of sitting dead-centre. The look-ahead is eased separately
  from the camera, so stopping does not lurch the view.

Screen shake is small by design and can be turned off completely in Settings.

### Flow

Every distinct move adds to a chain that decays if you stand still. Repeating
one move is worth less than varying them, and the chain multiplies your tips at
the end of the level — so the fastest route and the most stylish one are the
same route. Throwing is worth the most, because it is the biggest risk.

### Speedrun mode

Turn it on in Settings and **Start Shift** runs the whole campaign against one
clock, with a cumulative timer in the HUD and splits on the results screen. A
death, a restart or leaving the campaign ends the run. The clock does not start
until your first input, so reading a level is free.

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

94 tests across five suites:

- `engine` — the physics loop, every platform type, win/lose latching
- `abilities` — one test per move, checking both that it works and that it
  cannot be abused (no infinite air jumps, no free shields, no stuck crouch)
- `fuzz` — drives all 55 levels with pseudo-random input across three seeds
  (~61k simulated frames) and asserts the simulation never breaks its own
  rules: no NaN, no escaping the level, no clipping into solid geometry
- `reachability` — builds a graph of every standable surface in all 46 levels
  and breadth-first searches from spawn to goal, so no level can ship with a
  shelf nothing can reach
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
