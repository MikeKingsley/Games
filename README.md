# Games

Games written in JavaScript, hosted in a static Blazor WebAssembly shell (.NET 10). The shell is built for toddlers (2-4) on touch tablets: big targets, no reading, no fail states. Games:

- **Feed the Animals** (toddlers): drag each food to the animal that eats it.
- **Delivery Driver** (older kids and adults): run a haulage company in Devon and Cornwall from 1919. It has its own rules, text UI and save slots (see [Delivery Driver](#delivery-driver)).

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
| `Games.Client/wwwroot/games/delivery-driver/` | Delivery Driver (see its section below for the folder layout) |
| `tests/js/`, `tests/e2e/` | Node logic tests, Playwright tests |
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
3. Add an entry to `registry.json`: `{ "id", "title", "icon" (emoji), "module": "games/<id>/index.js" }`. A game with its own save system can switch off shell features with `"features": { "hardcore": false, "levels": false }` (both default `true`): `hardcore: false` hides the Hardcore Mode button in the grown-ups panel, `levels: false` hides the game's "Level N / Reset levels" row on the Options page.
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

## Parent corner

A small gear in the top-left of the home screen and of every game. Tap it. On the home screen it opens the Options page; in a game it opens a panel with sound, speech, fullscreen, Hardcore Mode (unless the game switches it off in `registry.json`), Options and exit. The Options page (`/options`) has the sound/speech/fullscreen switches and, per game, its current level with a two-tap "Reset levels".

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

## Delivery Driver

A 3D haulage game (hand-written WebGL2 with a Canvas 2D fallback, no dependencies): a chase camera over real hills, sun and shadows, night lights and weather. You start on 1 January 1919 at an Exeter depot with a Tamar T-Ton van and £400, and grow a company across Devon and Cornwall: bigger vehicles, articulated lorries with trailers, hired drivers and more depots. All makes are fictional.

### Controls

| Keys | Touch | What |
|---|---|---|
| W / ↑ | GO pedal | Accelerate. Hold S at a standstill to select reverse (W at a standstill goes forward again) |
| S / ↓ | BRAKE pedal | Brake |
| A D / ← → | slider or wheel | Steer |
| Space | | Handbrake |
| F / Enter | 📦 | Depot office, garage (fuel and repairs), ferry, tow; in the practice yard its menu |
| C | 🔗 | Couple / uncouple a trailer (tractor units) |
| Q / E, H | 📯 | Indicators, horn |
| M, J | 🗺️ | Map, current job |
| V, Z / X, [ / ] | 🎥 | Camera (behind / north up), zoom, tilt |
| G, Shift / Ctrl | | Manual gearbox on/off, gear up / down |
| Esc | ☰ | Game menu: save, save slots, settings, controls, skip the tutorial |

A gamepad works too (left stick, triggers, A for the handbrake). Phones show the touch controls (`pointer: coarse`); landscape is best.

### How it plays

- **Contracts** come from the depot office's board, one per owned depot, new each game day: multi-drop parcels, farm collections, point-to-point haulage, special cargo (china clay, granite, milk, fish, timber, petrol, livestock, frozen food, machinery) that needs the right vehicle or trailer tag, and trailer jobs (collect a client's trailer, or a drop-and-swap) for tractor units. Reverse the **rear** of the vehicle (or trailer) onto a bay marker within 1.5 m and 15°, stop, and loading runs on a timer; kerbside drops need you stopped by the ring. Late deliveries lose 10% per game hour (down to 40%), early undamaged ones earn a 15% bonus, cargo damage is deducted.
- **Time:** 1 real minute = 15 game minutes, only while driving (menus pause the clock). Days bring new offers, Mondays bring wages, loan interest and depot upkeep, and new years bring new vehicles and road changes (Exeter bypass 1938, Tamar Bridge 1961 replacing the Saltash ferry, the M5 to Exeter in 1977, A30/A38 dualling...).
- **Money:** fuel, wear and damage (repairs at depots and town garages), loans from the bank, a used market and part-exchange. Below £0 on a Monday the bank forces a bailout loan, then sells your cheapest vehicle; with no vehicles and no credit the company goes bust (kept as a read-only record).
- **Reputation** from on-time, undamaged jobs moves you from Local Carrier to National Haulage, unlocking haulage and special work, longer routes and depot purchases.
- **Fleet:** buy vehicles and trailers at the dealer, hire drivers (skill and wage) and give them jobs or let them auto-take work; they run off-screen on route time and show as dots on the map. Buy depots in other towns (Regional Haulier and up).
- **Articulated lorries** pivot on the fifth wheel and reverse like the real thing (unstable; they can jack-knife past 85°). Reverse the fifth wheel under the kingpin (0.4 m, 10°) and press C. The depot office has a **reversing practice yard** (any year, any vehicle).
- **World:** a stylised Devon and Cornwall at a 1:4 map scale (Exeter to Penzance is about 30 real minutes at 50 mph once the economy and timing are rebalanced): the real road network (motorway to residential streets, with one-way streets, roundabouts, bridges and signals), coastline and hills, baked offline from OpenStreetMap and open elevation data (`world/seed/baked/`, see Road data below); towns, depots, industry sites and ferries come from `world/seed/sw-england.json`, and buildings, farms, fields, woods and street furniture are generated from the roads and the seed. Day and night follow the season; the weather is seeded per day (rain lowers grip, fog is common on the moors). The ground has real slopes: hills slow heavy loads, long descents heat the brakes (use a low gear), parked trailers need their brake on a hill, and climbing burns more fuel; routes and pay allow for the hills.

### Saves and settings

Three save slots in `localStorage` (`games.dd.slot1` to `slot3`, versioned and migrated), with an index in the shell's progress store (`games.progress.delivery-driver`). Autosave after every completed delivery, every 3 real minutes and on exit; export and import from the slot menu. Device settings (quality, graphics, camera and tilt, gearbox, touch steering, units) are in `games.dd.settings`. Saves from before version 4 (the real-roads update) can't be loaded.

**Graphics:** Auto uses 3D (WebGL2) when the browser supports it and falls back to Compatibility (Canvas 2D) when it doesn't, when a shader fails or when the GPU context keeps being lost (with a "Switched to compatibility graphics" note). On Auto a device that stays under about 25 fps drops one quality level (never raises it). Both renderers play identically; Canvas 2D shows no relief apart from a shaded hint on the maps.

### Road data (OpenStreetMap)

Roads, coastline and elevation are baked offline by `scripts/bake-roads/` (fetch Overpass and terrain tiles into the gitignored `.cache/`, then `node scripts/bake-roads/bake.mjs` writes `world/seed/baked/`). The bake projects at a plain 1:4 scale (no town lens), collapses dual carriageways and roundabouts, dates every road for 1919-2025 (`scripts/bake-roads/history.json`) and fails if a town is cut off in any sample year. The runtime graph, furniture rules and rendering are described in [_docs/road-system.md](_docs/road-system.md). Check tools: `scripts/validate-roads.mjs`, `scripts/terrain-stats.mjs`, `scripts/traffic-soak.mjs`.

**Map data © OpenStreetMap contributors**, available under the [Open Database Licence](https://www.openstreetmap.org/copyright). Elevation from the AWS/Mapzen terrain tiles (SRTM and other public sources). Licence notes: `scripts/bake-roads/NOTICE.md`.

### Code

| Folder | What |
|---|---|
| `index.js`, `config.js`, `styles.css` | Mount/unmount and wiring; tuning constants (`WORLD_SCALE`, `TIME_SCALE`, quality presets); overlays |
| `engine/` | Fixed 60 Hz loop, input (keyboard, touch, gamepad), camera, seeded RNG |
| `sim/` | Vehicle (bicycle model + gearbox), trailer kinematics, coupling, OBB collision |
| `world/` | Region seed + projection, road graph, generator, chunks, A* routes, road history |
| `traffic/` | Era traffic: lane following, junction claims, signals |
| `game/` | Session, career, calendar, contracts, economy, catalogue, dealer, fleet, reputation, environment, save, tutorial |
| `render/` | `index.js` renderer factory (Auto / WebGL / Canvas), the Canvas 2D renderer, and `render/gl/`: pure mesh, camera, sun, shadow and map-mesh modules plus the WebGL2 drawing code (see plan 0007) |
| `ui/`, `audio/` | DOM menus and HUD, WebAudio synth |

Logic in `sim/`, `world/`, `traffic/` and most of `game/` is DOM-free and tested in Node (`tests/js/delivery-driver.*.test.mjs`); `tests/e2e/delivery-driver.spec.mjs` drives the real game.

**Debug hook** (Development environment only): `window.__dd` exposes `state` (the session), `teleport(x, y, heading)`, `setControls({throttle, brake, steer, handbrake, reverse} | null)`, `completeDrop()`, `advanceClock(hours)`, `setWeather({kind, intensity})`, `newGame(opts)` (an unsaved game, skipping the slot menu), `spawnAtDepot()`, `stats()`, `resetPerf()`, and for the renderers `renderer` (`kind`, `stats`, `loseContext()`), `setRenderer(kind)`, `setSettings(patch)`, `camera`, `map()`, `terrainHeight`, `groundZ`, `slopeAt`.
