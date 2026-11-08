# Games

Kids' games written in JavaScript, hosted in a static Blazor WebAssembly shell (.NET 10). Built for toddlers (2-4) on touch tablets: big targets, no reading, no fail states. First game: **Feed the Animals** (drag each food to the animal that eats it).

- **Inglenook** (older kids and adults): a 1960s UK goods-yard shunting puzzle (`games/inglenook/`, 2D SVG).

Installable as an offline PWA. No accounts or backend; settings and progress live in `localStorage`.

## Run

```
dotnet run --project Games.Client
```

If you add new files under `wwwroot` while it is running, restart it: the dev server builds its asset manifest at start-up and new files 404 until then.

## Test

```
dotnet test Games.slnx     # C# shell (settings, registry)
npm install && npm test    # pure game logic (node:test)
npm run test:e2e           # Playwright drag test; starts the app on :5211, uses installed Microsoft Edge
```

## Layout

| Path | What |
|---|---|
| `Games.Client/` | Blazor shell: home menu, `/play/{id}` page, `GameHost`, parent corner, settings |
| `Games.Client/wwwroot/games/registry.json` | List of games shown on the home menu |
| `Games.Client/wwwroot/games/<id>/` | One folder per game (JS ES module + CSS) |
| `Games.Client/wwwroot/js/host.js` | Loads a game module and passes it its options |
| `tests/Games.Tests/` | xUnit tests for the shell |
| `tests/js/`, `tests/e2e/` | Node logic tests, Playwright test |
| `_docs/plans/`, `_docs/code-docs/` | Build plan and class docs |

## Adding a game

1. Create `Games.Client/wwwroot/games/<id>/index.js` exporting:

   ```js
   export function mount(container, options) {
       // render into container
       return { unmount() { /* remove DOM, listeners, timers, audio */ }, setOptions(next) { /* optional */ } };
   }
   ```

   `options` = `{ soundEnabled, speechEnabled, showFoods, debug (true in the Development environment), onExit(), onReward(stars), loadProgress(), saveProgress(obj) }`.
   `setOptions({ soundEnabled, speechEnabled, showFoods, paused })` (`paused` is true while the grown-ups panel is open) is called when a parent changes settings mid-game.
2. Keep game rules in a DOM-free `logic.js` so they can be tested in Node; inject your own stylesheet from `mount` and remove it in `unmount`.
3. Add an entry to `registry.json`: `{ "id", "title", "icon" (emoji), "module": "games/<id>/index.js" }`.
4. Add tests under `tests/js/`.

## Feed the Animals: worlds

The background and the animals change with the level (defined in `WORLDS` in `animal-feeding/data.js`, scenery in `scenery.js`). Entering a new world fades the new background in; the world's name is always shown bottom left. Past level 100 the last world stays. Mythical worlds (31+) favour their own creatures: at least two of the three animals come from the current world.

| Levels | World | Levels | World |
|---|---|---|---|
| 1-5 | Farm | 41-50 | Crystal Caves |
| 6-10 | Woodland | 51-60 | Cloud Kingdom |
| 11-15 | Savannah | 61-70 | Dragon Volcano |
| 16-20 | Ocean | 71-80 | Fairy Tale Castle |
| 21-30 | Dinosaur Land | 81-90 | Outer Space |
| 31-40 | Enchanted Forest | 91+ | Unicorn Rainbow Land |

## Inglenook

A top-down 2D SVG shunting puzzle set in a UK goods yard in the 1960s: a small diesel shunter, 16-ton mineral wagons, vans and tank wagons (generic period styling, no real logos). Make up the train shown in the goal strip on the long siding, nearest the points first. For older kids and adults. Levels are endless: level N is always the same level (seeded) and is always solvable.

### Controls

| Input | What |
|---|---|
| Forward / Reverse buttons, W / S, arrow keys | Latching drive: press once and the loco eases up to a slow speed; it stops itself at a buffer stop and when it couples to wagons |
| Stop button, Space | Stop |
| Tap a point lever (or keys 1-9) | Throw that point. Locked while any vehicle is on it |
| Tap a coupling hook between vehicles | Uncouple there (only when stopped, and not if the wagons left behind would stand beside a point) |
| Undo (U), Reset (R), Skip, Mute (M) | Undo the last action, restart the level, skip it, sound on/off |

### How it plays

- **Moves** are uncouplings. Par comes from a solver: 3 stars at par or better, 2 within 1.5x par, otherwise 1. There is no fail state; Undo and Reset are free.
- **Pull and push:** the loco drives into a siding and couples to its wagons (taking all of them is free), brings them out, then pushes them into another siding and uncouples. A pull then a push keeps the wagons' order along the siding. Taking only part of a siding needs an extra uncoupling.
- **Difficulty:** level 1-3 a small 5/3/3 inglenook with 4 wagons; 4-14 classic inglenook with up to 8 wagons and a longer goal; 15+ fixed wagons that cannot be moved; 25+ a longer inglenook or a 4-5 siding ladder with longer goals. Tuning is `levelParams` in `levels.js`.
- **Layouts** (`layouts.js`): `classic`, `classic-long`, `ladder4`, `ladder5`. A `loop` layout (run-round loop) exists and is validated but is not used by the generator yet.
- **Save:** `{ level, best: { [level]: { stars, moves } }, muted }` in the shell's progress store (`games.progress.inglenook`).

### Code (`Games.Client/wwwroot/games/inglenook/`)

| File | What |
|---|---|
| `index.js`, `ui.js`, `styles.css` | Mount/unmount, game loop, undo, HUD and controls |
| `render.js` | SVG board: track, scenery, wagons, shunter, point levers, coupling hooks |
| `track.js`, `layouts.js` | Track graph, points, walking along tracks, foul zones, layout templates and validation |
| `sim.js` | Train simulation: rakes, easing, buffers, auto-couple, uncouple, points |
| `solver.js`, `levels.js`, `logic.js` | Abstract solver (par), seeded level generator, win check, stars, progress |
| `autoplay.js`, `audio.js`, `config.js` | Plays solver moves through the sim (tests/debug), WebAudio synth, constants |

Logic is DOM-free and tested in Node (`tests/js/inglenook.*.test.mjs`); `tests/e2e/inglenook.spec.mjs` drives the real game. **Debug hook** (Development environment only): `window.__ig` exposes `sim`, `level`, `won`, `start(n)`, `solve()` (plays the solver's moves through the sim) and `onEvent(fn)`.

## Parent corner

A small gear in the top-left of the home screen and of every game. Tap it. On the home screen it opens the Options page; in a game it opens a panel with sound, speech, fullscreen, Hardcore Mode, Options and exit. The Options page (`/options`) has the sound/speech/fullscreen switches and, per game, its current level with a two-tap "Reset levels".

## Deploy

**Live:** https://mikekingsley.github.io/Games/ . Every push to `main` runs `.github/workflows/pages.yml` (tests, then publish, then GitHub Pages). The workflow sets the base path to `/Games/` at build time; local runs stay at `/`.

Static hosting only, **over HTTPS** (browsers only allow the offline cache and "Install app" on a secure address).

```
powershell scripts/build-static-site.ps1   # builds ./dist and ./Games-site.zip
```

Upload `dist` (or the zip) to any static host: Netlify Drop (app.netlify.com/drop), Cloudflare Pages, GitHub Pages, Azure Static Web Apps. The site is built for a domain root; deep links fall back to index.html via the included `_redirects` / `404.html`. On the phone: open the URL once while online, then Add to Home Screen / Install app; it then runs offline. See the Deployment Plan in `_docs/plans/0001-games-app-animal-feeding.md` for sub-path hosting.

### Updates

Every publish changes the service worker's assets version. Open apps notice this (on load, when the app returns to the foreground, and every 30 minutes) and show a small "New version ready" pill in the top-right corner. Tapping **🔄 Update** switches to the new version and reloads the page once (if the browser doesn't report the switch within 3 seconds, the stuck worker and offline caches are cleared before reloading). The pill has no close button, and the new version never replaces the running one without that tap.

To see it locally: `dotnet publish Games.Client -c Release -o publish`, serve `publish/wwwroot` over http://localhost, open it, change any asset (e.g. a text in `index.html`), publish again, and wait for the open tab to re-check (switch away from the tab and back). The dev server (`dotnet run`) has a no-op service worker, so no banner appears there.

## Feed the Animals: stars

Every finished round earns 0-3 stars (added to the running total), whichever is lower of two ratings:

- **Speed:** within the "par" time = 3, within 1.75x par = 2, slower = 1 (slowness alone never gives 0). Par is, per animal, the eating time plus thinking time that shrinks from 6s (level 1) to 1.5s (level 100); on timed levels it is capped at 80% of the countdown.
- **Wrong guesses** (every rejected drop or hover): level 1 allows 1 for three stars, 3 for two, and 6 or more earns none; by level 100 that tightens to 0 / 1 / 3.

The targets stop tightening at level 100. Difficulty, worlds and the countdown still follow the level, so earning no stars never blocks progress; running out of time still costs one star. Logic: `starsForRound`, `starParMs`, `mistakeLimits` in `wwwroot/games/animal-feeding/logic.js`.

### Hardcore Mode

A grown-up can switch Feed the Animals into Hardcore Mode from the in-game panel (tap the gear, then **🔥 Hardcore Mode**, then tap again to confirm). Switching it on restarts the game from level 1 (the warning says so). It cannot be switched off again, except by **Reset levels** for that game on the Options page, which also turns it off. In Hardcore Mode:

- the game restarts from level 1 and every level has a countdown (15s at level 1, shrinking evenly to a 5s minimum at level 100);
- from level 11 every round has 3-5 animals at random (each animal beyond three adds 3s to the countdown so a crowded round stays possible), drawn smaller to fit;
- past level 100 the animals bounce around the screen, off the edges and each other;
- every world is shown at night (dark sky, twinkling stars, a moon, dimmed scenery);
- the foods hint under each animal is off (in normal mode it is always shown);
- stars become 🔥 flames, the star count restarts from 0 when the mode is switched on, and a "Hardcore Mode" title shows beside the count (top right);
- running out of time costs one flame, and running out of time with no flames left sends the player back to level 1 (the mode stays on).

The mode is stored as `hardcore: true` in the game's saved progress. In the Development environment the debug bar (bottom right) has a **🍽️ Fed counts** switch for the per-animal fed counters (off by default).

### Increasing time with stars

In both modes, tap the star (or flame) count to open an **Increase time** dialog (it opens only when there is a countdown to add to and you can afford at least 5 stars; otherwise the count just shakes). The countdown, and any bouncing animals, stand still while it is open. Each tap of **+1 second** spends 5 stars on +1 second of countdown time; **Increase as much as I can** spends everything it can; **OK** closes the dialog and play carries on. The bonus shows next to the count (⏱️ +2s), is added to every countdown (and to the round in play) and is saved with the game's progress. Each time the countdown runs out the bonus wears down by 0.5s (never below zero), on top of the usual loss of one star. Time can only be bought once there is a countdown: in normal mode that starts at level 16, in Hardcore Mode it is always. Resetting the levels clears the bonus.

### Fullscreen

Off by default. **Fullscreen** (Options page, or the in-game grown-ups panel) makes the app go fullscreen on the first tap of each page load (browsers need a tap), and switching it on goes fullscreen straight away; switching it off leaves fullscreen. The installed app opens in `standalone` mode (the manifest no longer asks for `fullscreen`). The setting is `fullscreen` in `games.settings`, read by `wwwroot/js/kiosk.js`.
