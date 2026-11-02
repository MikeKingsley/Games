# UI Fit on Phone Screens

Make the whole app (animal-feeding game HUD, shop dialog, Home/Options pages, corner button, parent panel, update banner) fit and not overlap on phones in both portrait and landscape, down to 360x640. CSS-only; no game-logic changes.

## Decisions & Answers

- **Q:** What is the main problem on phones? — **A:** Landscape: things overlap/cramped; Portrait: layout broken.
- **Q:** Which orientations must be supported? — **A:** Both, fully usable.
- **Q:** Smallest target device? — **A:** ~360x640 (small Android); also covers iPhone SE 375x667.
- **Q:** How to verify? — **A:** Playwright viewport e2e tests (emulate several phone sizes/orientations, assert no overlap/overflow, plus screenshots).
- **Q:** Which screens are in scope? — **A:** Animal-feeding game HUD; Increase-time shop dialog; Home + Options pages; Corner buttons / parent corner / update banner.
- **Q:** May shell buttons shrink below the 96px minimum on phones? — **A:** Yes, scale down to ~64px on small screens (game stays toddler-friendly).
- **Q:** Sizing approach? — **A:** CSS-only: media queries + clamp/dvh/safe-area. No game-logic changes (no `index.js` edits).
- **Q (user, 2026-11-02):** "can you test with all sounds muted" — **A:** All Playwright runs must have audio muted. The app has no in-app mute (`sound.js` lazily creates a WebAudio `AudioContext`), so mute at the browser level: pass `launchOptions: { args: ['--mute-audio'] }` in `playwright.config.mjs`. Manual/MCP browser checks must also use a muted browser.
- **Q:** Confirm the scope summary? — **A:** The user interrupted the confirmation prompt and instead added the mute requirement above; scope is otherwise as summarised.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per
phase) and flip it to `- ✅` when it completes; when a phase is done,
set its status to `Complete` and write its **Phase Summary** (what was done, key
decisions, anything needed to continue with zero context); run the phase's
**Verification Plan** and record the result before moving on. When all phases are
done, fill in **Final Recap** and **Deployment Plan**.

Key facts: Blazor WASM (net10.0) in `Games.Client/`. Global CSS: `wwwroot/css/app.css` (`html, body { height: 100% }`, `button { min-width/min-height: 96px }`). Game CSS: `wwwroot/games/animal-feeding/styles.css` (uses `vh`/`vw`, fixed `px`/`rem` sizes such as `.af-stars` 3rem, `.af-level` 2rem, `.af-timer` top 64px/height 44px, `.af-tray` bottom `calc(3vh + 40px)`). Scoped CSS: `Pages/Home.razor.css` (260px tiles, 9rem icons), `Pages/Options.razor.css`, `Components/CornerButton.razor.css` (72px), `ParentCorner.razor.css`, `UpdateBanner.razor.css` (already uses `env(safe-area-inset-*)`), `GameHost.razor.css`. Viewport meta in `wwwroot/index.html` already has `viewport-fit=cover`. e2e: `npm run test:e2e` (`playwright.config.mjs`, Edge channel, dev server on :5211, existing specs in `tests/e2e/`). Do not edit game JS. Run everything with audio muted.

## Phase 1: Test harness and baseline
Status: Complete

- ✅ Add `launchOptions: { args: ['--mute-audio'] }` to `use` in `playwright.config.mjs`.
- ✅ Create `tests/e2e/phone-fit.spec.mjs` parametrised over viewports: 360x640, 640x360, 375x667, 667x375, 412x915, 915x412, 390x844, 844x390.
- ✅ Per viewport and screen (Home, Options, game, shop dialog, parent panel), assert: no horizontal/vertical document scroll (`scrollWidth <= innerWidth`, same for height), every HUD/button element's bounding box lies inside the viewport, and no pair of HUD elements overlaps (level, timer, stars, corner button, update banner, world name, animals, tray). Update banner is forced visible by the existing test approach in `update-banner.spec.mjs`.
- ✅ Save per-viewport screenshots to `test-results/phone-fit/` (git-ignored) so layout can be inspected visually.
- ✅ Run the new spec before any CSS change and record which cases fail (baseline) in the Phase Summary.

### Verification Plan
- `npm run test:e2e -- phone-fit` runs and the baseline failures are listed; existing specs still pass; Edge launches with `--mute-audio` (no audible output).

### Phase Summary
Added `--mute-audio` to `playwright.config.mjs` and `tests/e2e/phone-fit.spec.mjs` (8 viewports x 6 screens = 48 cases; seeds `games.progress.animal-feeding` in localStorage for a timed level and a hardcore level; fake service worker forces the update banner visible as the worst case). Checks: no document scroll, listed boxes inside the viewport, no pairwise overlap among HUD boxes, shop card not clipped; screenshots go to `test-results/phone-fit/`. The shop-dialog stars click uses `dispatchEvent('click')` so an overlapping banner can't block it (the game tests report that overlap instead).

Baseline (before any CSS change): 32 of 48 fail, 16 pass; the 3 existing specs pass. Failures: Home (banner overlaps corner button in portrait / first tile in landscape), Options (initially failing only because the test wrongly required scrolled-off buttons inside the viewport; the check was changed to document-scroll + banner + button width, so re-record Options baseline in Phase 2), game timed + hardcore at every viewport (corner button overlaps update banner / stars / hardcore title / timer; banner overlaps level/timer in landscape), parent panel (top edge off-screen in landscape and 360x640). Shop dialog passes at all 8 sizes already. No audio check is automatable; the launch flag is the mute.

## Phase 2: Shell, Home and Options
Status: Complete

- ✅ In `app.css` use `height: 100dvh` (with `100%` fallback) for `html, body`/`#app`, and add safe-area padding handling.
- ✅ Add a small-screen rule (`@media (max-height: 520px), (max-width: 480px)`) scaling the global `button` min size from 96px to 64px.
- ✅ `Home.razor.css`: make tiles and icons responsive (`clamp`/`vmin`), reduce padding/gap, allow scroll-free fit of all tiles at 360x640 and 640x360.
- ✅ `Options.razor.css`: reduce padding/heading sizes on small screens, keep `overflow-y: auto`, ensure `.game-row` wraps cleanly.
- ✅ `CornerButton.razor.css`: 72px -> ~64px on small screens, offset by safe-area insets.
- ✅ `ParentCorner.razor.css`: panel fits short landscape (scrollable `max-height: 100dvh`, tighter padding, 64px buttons).
- ✅ `UpdateBanner.razor.css`: shrink text/button on small screens so it does not collide with the stars display.

### Verification Plan
- `npm run test:e2e -- phone-fit` passes for Home, Options, corner button, parent panel and update banner cases across all viewports.

### Phase Summary
`app.css`: `100dvh` heights and a `(max-width: 480px), (max-height: 520px)` rule dropping global buttons to 64px. Home tiles are `min(260px, 58vmin)` with proportional icon/title and a scrollable container. Options gets tighter padding/headings and bottom space for the banner. Corner button is 64px on phones with safe-area offsets. Parent panel scrolls within `100dvh` and uses two columns on short landscape. The update banner moves to the bottom-right on phones as a compact pill (text hidden, 48px button - a deliberate exception to the 64px rule since it is a grown-up control) so it no longer collides with the top HUD (this decision also drives Phase 3: top HUD must leave the bottom-right free). Verification: `phone-fit` home/options/parent-panel cases pass at all 8 viewports (24/24). No C# classes changed, so no code-doc refresh.

## Phase 3: Game HUD and shop dialog
Status: Complete

- ✅ `styles.css`: replace fixed sizes with `clamp()`/`vmin` for `.af-level`, `.af-stars`, `.af-lost-star`, `.af-timer` (position/height/width), `.af-score`, `.af-hardcore`, and keep stars/level/timer from overlapping the corner button and update banner.
- ✅ Re-flow `.af-animals` and `.af-tray` for short landscape (`max-height: 520px`) and narrow portrait (`max-width: 480px`): use `dvh`, derive heights from remaining space below the HUD, keep `--animal-size`/`--food-size` caps so nothing clips.
- ✅ `.af-world-name` and `.af-footer`: smaller on small screens, avoid the tray; account for safe-area insets.
- ✅ `.af-reward`: ensure big star and sticker fit at all test viewports.
- ✅ `.af-shop-card`/`.af-shop-*`: scale fonts and buttons, add `max-height: 94dvh; overflow-y: auto` so it fits 640x360.
- ✅ Check `crowded` (many animals) and Hardcore bouncing modes still render inside bounds at 360x640 and 640x360 (CSS only).

### Verification Plan
- `npm run test:e2e -- phone-fit` fully passes (no overflow, no HUD overlaps, all elements in viewport) at every viewport.
- `npm run test:e2e` passes in full (existing animal-feeding, fullscreen, update-banner specs unaffected at 1024x768).
- `npm test` passes.
- Review screenshots in `test-results/phone-fit/` for 360x640 and 640x360.

### Phase Summary
All game CSS lives in one `@media (max-width: 480px), (max-height: 520px)` block (plus a `(max-width: 480px)` portrait override) at the end of `wwwroot/games/animal-feeding/styles.css`: the score column is right-aligned and stacked (hardcore title over stars); short landscape keeps one top row (gear left, level + 30vw timer centred, stars right); narrow portrait puts level at top 76px and timer at 110px below the gear/stars row; the tray is raised 8px so the bottom-right update banner never covers a slot; world name and shop card are scaled and the shop card scrolls within `94dvh`. The reward overlay and crowded row needed no change (they already use vmin-style sizing). New test `game, hardcore bouncing animals stay on screen` (rounds 105) checks containment only. Test tweak: emoji are compared by glyph square (the font's advance makes the box wider than the glyph). Verification results: `npx playwright test` 74 passed (56 phone-fit incl. bouncing, plus the existing specs), `npm test` 58 pass / 0 fail; screenshots reviewed at 360x640 and 640x360. The dev-only debug buttons (Back/Next/Fed counts/Pause) still crowd the bottom edge in Development; they are not mounted in production and were excluded from the checks. No C# classes changed, so no code-doc refresh.

## Final Recap
The app now fits phones in portrait and landscape down to 360x640. A shared small-screen breakpoint (`max-width: 480px` or `max-height: 520px`) drives the changes: `100dvh` page height, 64px buttons, responsive Home tiles, tighter Options, a scrollable/two-column parent panel, a compact bottom-right update banner, and a re-laid-out game HUD and shop dialog. CSS only, no game logic changes. Audio is muted for all Playwright runs via `--mute-audio`. `tests/e2e/phone-fit.spec.mjs` (8 viewports x 7 screens) guards against regressions.

## Deployment Plan
1. `npm test` and `npm run test:e2e` (both must pass; the browser runs muted).
2. Commit and push to `main`; the GitHub Pages workflow (`.github/workflows/pages.yml`) publishes the site.
3. Installed apps get the change through the existing update banner (tap "Update").
4. Spot-check on a real phone in both orientations.
