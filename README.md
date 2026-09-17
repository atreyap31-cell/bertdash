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
| `Space` / `W` / `↑` | Jump (hold for height, press into a wall to wall-jump) |
| `S` / `↓` | Slide |
| `E` | Aimed dive, toward the cursor |
| Click | Throw the bag toward the cursor — then catch it |
| `Q` | Leave a bike or car |
| `R` | Restart the level |
| `Esc` / `P` | Pause |

Throwing the bag is the risk/reward mechanic: your hands are free so you move
faster, but if the bag touches anything before you catch it, the delivery fails.
A dotted arc previews where it will land.

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

37 tests covering the physics loop, every platform type, win/lose latching,
profile persistence, achievement rules and the peer-code encoding. They run in
plain Node against a small DOM stub in `tests/harness.mjs` — no browser or test
framework needed.

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

## Notes on the rewrite

This started as a single 160KB HTML file that loaded React, ReactDOM, Babel,
Tailwind and Font Awesome from CDNs and transpiled itself in the browser on
every page load. It is now a dependency-free static site — nothing is fetched
from a third party at runtime, so it loads instantly and works offline.

The engine changed more than the rendering did. The authored level data always
described moving platforms, vanishing platforms, lasers, doors, conveyors,
vehicles, powerups and per-level physics; the old engine ignored all of it and
drew those pieces as ordinary blocks. It now simulates them.

Other substantive fixes:

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
- **Wall sliding never activated,** so wall jumps were unreachable.
- **The editor's Test button always crashed** — it called `onPlay`, which was
  never passed. The editor also could not scroll vertically, leaving everything
  below the top 600px of a 6000px level unreachable, and its physics sliders
  were saved but never read by the engine.
- **`LZString` was `btoa`,** despite the name: no compression, not URL-safe, and
  it threw on any non-Latin1 character. Peer codes are now genuinely gzipped.
- **Achievements were never awarded.** All 50 were unreachable. Every one now
  has a rule that is actually evaluated, and the handful that referenced
  features the game does not have were replaced.
- Clicking a HUD button also threw the food, because pointer handlers were bound
  to the window rather than the canvas.
- Progress was written to `localStorage` synchronously on every jump; it is now
  debounced and flushed when the page is hidden.

Saves from the old build are migrated automatically on first load.

## Licence

MIT — see [LICENSE](LICENSE).
