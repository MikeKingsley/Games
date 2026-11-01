# Games

Kids' games written in JavaScript, hosted in a static Blazor WebAssembly shell (.NET 10). Built for toddlers (2-4) on touch tablets: big targets, no reading, no fail states. First game: **Feed the Animals** (drag each food to the animal that eats it).

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

   `options` = `{ soundEnabled, speechEnabled, onExit(), onReward(stars), loadProgress(), saveProgress(obj) }`.
   `setOptions({ soundEnabled, speechEnabled })` is called when a parent changes settings mid-game.
2. Keep game rules in a DOM-free `logic.js` so they can be tested in Node; inject your own stylesheet from `mount` and remove it in `unmount`.
3. Add an entry to `registry.json`: `{ "id", "title", "icon" (emoji), "module": "games/<id>/index.js" }`.
4. Add tests under `tests/js/`.

## Parent corner

A small gear in the top-left of the home screen and of every game. Hold it for 2 seconds (a tap does nothing). On the home screen it opens the Options page; in a game it opens a panel with sound, speech, Options and exit. The Options page (`/options`) has sound/speech switches and, per game, its current level with a two-tap "Reset levels".

## Deploy

Static hosting only, **over HTTPS** (browsers only allow the offline cache and "Install app" on a secure address).

```
powershell scripts/build-static-site.ps1   # builds ./dist and ./Games-site.zip
```

Upload `dist` (or the zip) to any static host: Netlify Drop (app.netlify.com/drop), Cloudflare Pages, GitHub Pages, Azure Static Web Apps. The site is built for a domain root; deep links fall back to index.html via the included `_redirects` / `404.html`. On the phone: open the URL once while online, then Add to Home Screen / Install app; it then runs offline. See the Deployment Plan in `_docs/plans/0001-games-app-animal-feeding.md` for sub-path hosting.
