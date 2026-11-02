// Animal feeding game: drag each food to the animal that eats it. No fail state; wrong drops just wobble and return.
import { FOODS, animalById } from './data.js';
import { SCENERY } from './scenery.js';
import { createRound, feed, checkFeed, eat as eatFor, bitesTaken, eatenFraction, isRoundComplete, foodsEatenBy, paletteFor, nextDifficulty, starsForRound, buyTimeBuff, wearBuff, STARS_PER_BUFF, roundTimeSeconds, difficultyFor, animalsBounce, levelFor, animalPool, favouredAnimals, rareAnimalFor, loseStar, worldFor } from './logic.js';
import { createSound } from './sound.js';

const HINT_AFTER_MS = 8000;
const NEXT_ROUND_MS = 1700;
const REWARD_MS = 2600;
const BUFF_MS = 1000;
const WORLD_FADE_MS = 1600;
const CONFETTI = ['🎉', '⭐', '🎈', '✨', '🌟', '🎊'];

export function mount(container, options = {}) {
    let soundEnabled = options.soundEnabled ?? true;
    let speechEnabled = options.speechEnabled ?? true;
    const progress = { rounds: 0, stars: 0, buff: 0, hardcore: false, ...(options.loadProgress?.() ?? {}) };

    const abort = new AbortController();
    const { signal } = abort;
    const timers = new Set();
    const sound = createSound(soundEnabled);

    let round = null;
    let currentWorld = null;
    let currentNight = false; // whether the world on screen is the Hardcore night version
    let previousAnimals = [];
    let locked = false;
    let drag = null;
    let hintTimer = null;
    let frame = 0;
    let timerFrame = 0;
    let deadline = 0;
    let timeLimitMs = 0;
    let timerPaused = false; // debug: freeze the countdown
    let roundStartedAt = 0; // for the star rating: when the round began, minus time spent paused
    let pausedSince = null;
    let mistakes = 0; // wrong guesses this round
    let shopOpen = false; // the increase-time dialog is open: the countdown and bouncing animals stand still
    let shopSince = 0;
    let menuOpen = false; // the grown-ups menu is open over the game: the countdown stands still too
    let lastTimerFrame = 0;

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./styles.css', import.meta.url).href;
    document.head.appendChild(stylesheet);

    const root = el('div', 'af-root');
    const animalsEl = el('div', 'af-animals');
    const trayEl = el('div', 'af-tray');
    const starsEl = el('button', 'af-stars'); // tap to spend stars on countdown time
    starsEl.type = 'button';
    const hardcoreEl = el('div', 'af-hardcore');
    hardcoreEl.textContent = 'Hardcore Mode';
    hardcoreEl.hidden = true;
    const scoreEl = el('div', 'af-score'); // top right: Hardcore title beside the star count
    scoreEl.append(hardcoreEl, starsEl);
    const levelEl = el('div', 'af-level');
    const footerEl = el('div', 'af-footer'); // bottom right: debug tools (Development only)
    const worldNameEl = el('div', 'af-world-name'); // bottom left
    const timerEl = el('div', 'af-timer');
    const timerBar = el('div', 'af-timer-bar');
    const timerText = el('div', 'af-timer-text');
    timerEl.append(timerBar, timerText);
    timerEl.hidden = true;
    if (options.debug) footerEl.append(buildDebugBar());
    root.classList.add('hide-fed'); // the debug fed counters are off until switched on from the bar
    root.append(animalsEl, trayEl, scoreEl, levelEl, timerEl, worldNameEl, footerEl);
    container.appendChild(root);

    function el(tag, className) {
        const node = document.createElement(tag);
        node.className = className;
        return node;
    }

    // ---- debug: step between levels (only when the shell reports the Development environment) ------

    function buildDebugBar() {
        const bar = el('div', 'af-debug');
        const add = (label, name, onClick) => {
            const button = el('button', 'af-debug-button');
            button.type = 'button';
            button.textContent = label;
            button.dataset.debug = name;
            button.addEventListener('click', () => onClick(button), { signal });
            bar.appendChild(button);
        };
        add('◀ Back', 'back', () => goToLevel(progress.rounds - 1));
        add('Next ▶', 'next', () => goToLevel(progress.rounds + 1));
        add('🍽️ Fed counts', 'fed', button => {
            const hidden = root.classList.toggle('hide-fed');
            button.classList.toggle('on', !hidden);
        });
        add('⏸ Pause timer', 'pause', button => {
            timerPaused = !timerPaused;
            button.classList.toggle('on', timerPaused);
            button.textContent = timerPaused ? '▶ Resume timer' : '⏸ Pause timer';
        });
        return bar;
    }

    /** An animal that has eaten shrinks to half size (the `fed` class). */
    function renderFed() {
        for (const card of animalsEl.children) card.classList.toggle('fed', foodsEatenBy(round, card.dataset.animal) > 0);
    }

    /** Debug: how many pieces each animal has eaten this round, shown above it. */
    function renderFedCounts() {
        if (!options.debug) return;
        for (const card of animalsEl.children) {
            const count = foodsEatenBy(round, card.dataset.animal);
            card.querySelector('.af-fed-count').textContent = `🍽️ fed: ${count}`;
        }
    }

    /**
     * The foods in the tray each animal accepts (favourite first) shown underneath it. A food that
     * can't be given to this animal right now (feeding it would leave another animal with nothing) is faded; a pig, which
     * eats anything, gets a plate that fades the same way.
     */
    function renderPalettes() {
        for (const card of animalsEl.children) {
            card.querySelector('.af-palette')?.remove();
            if (progress.hardcore) continue; // Hardcore Mode: no hints
            const animal = animalById(card.dataset.animal);
            const entries = paletteFor(round, animal.id);
            const palette = el('div', 'af-palette');
            if (animal.eatsAnything) {
                const plate = el('span', 'af-palette-food');
                plate.textContent = '🍽️';
                plate.classList.toggle('blocked', entries.length > 0 && !entries.some(e => e.available));
                palette.append(plate);
            } else {
                for (const { foodId, available } of entries) {
                    const food = el('span', 'af-palette-food');
                    food.textContent = FOODS[foodId].emoji;
                    food.dataset.food = foodId;
                    food.classList.toggle('blocked', !available);
                    palette.append(food);
                }
            }
            palette.title = entries.map(e => FOODS[e.foodId].name).join(', ');
            card.appendChild(palette);
        }
    }

    /** Hardcore Mode starts from level 1: levels and stars begin again from zero, hints go away and every level gets a countdown. It stays until the levels are reset. */
    function enterHardcore() {
        progress.hardcore = true;
        progress.rounds = 0;
        progress.stars = 0;
        progress.buff = 0;
        previousAnimals = [];
        hardcoreEl.hidden = false;
        saveProgress();
        renderStars();
        if (!locked) startRound(); // the round in play restarts at level 1 with a countdown and no hints (if one is already about to start, it reads the reset progress)
    }

    /** Jumps straight to a level (rounds completed = level - 1, never below level 1) and saves it like normal progress. */
    function goToLevel(rounds) {
        progress.rounds = Math.max(0, rounds);
        saveProgress();
        if (drag) finishDrag();
        timers.forEach(clearTimeout);
        timers.clear();
        hintTimer = null;
        root.querySelectorAll('.af-confetti, .af-reward, .af-lost-star').forEach(n => n.remove());
        previousAnimals = [];
        startRound();
    }

    function later(fn, ms) {
        const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
        timers.add(id);
        return id;
    }

    function say(text) {
        if (!speechEnabled || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1.3;
        window.speechSynthesis.speak(utterance);
    }

    /** Stars are flames in Hardcore Mode. */
    const starIcon = () => (progress.hardcore ? '🔥' : '⭐');

    function saveProgress() {
        options.saveProgress?.({ rounds: progress.rounds, stars: progress.stars, buff: progress.buff, hardcore: progress.hardcore });
    }

    /** Whether the round in play has a countdown (normal mode: from level 16; Hardcore Mode: always). */
    const isTimed = () => roundTimeSeconds(progress.rounds, progress.hardcore, round?.animals.length) !== null;

    function renderStars() {
        const parts = [];
        if (progress.stars > 0) parts.push(`${starIcon()} ${progress.stars}`);
        if (progress.buff > 0) parts.push(`⏱️ +${progress.buff}s`);
        starsEl.textContent = parts.join('  ');
        starsEl.classList.toggle('can-buy', isTimed() && buyTimeBuff(progress.stars, 0) !== null);
        starsEl.setAttribute('aria-label', `${isTimed() ? 'Spend 5 stars for 1 more second of time. ' : 'Stars. '}${progress.stars} stars, time bonus ${progress.buff} seconds`);
    }

    /**
     * Tapping the stars (once there is a countdown to add to) opens a dialog where each tap of "+1 second" spends 5 stars on
     * +1s of countdown time, or "Increase as much as I can" spends what it can. The countdown stands still until OK.
     */
    function openShop() {
        sound.unlock();
        if (locked || shopOpen) return;
        if (!isTimed() || buyTimeBuff(progress.stars, 0) === null) { flash(starsEl, 'shake'); sound.boop(); return; }
        shopOpen = true;
        shopSince = performance.now();
        const overlay = el('div', 'af-shop');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Increase time');
        const card = el('div', 'af-shop-card');
        overlay.appendChild(card);
        root.appendChild(overlay);
        renderShop(card, overlay);
        card.querySelector('[data-shop="ok"]').focus();
    }

    function renderShop(card, overlay) {
        const affordable = Math.floor(progress.stars / STARS_PER_BUFF);
        const button = (label, name, onClick, disabled = false) => {
            const b = el('button', 'af-shop-button');
            b.type = 'button';
            b.textContent = label;
            b.dataset.shop = name;
            b.disabled = disabled;
            b.addEventListener('click', onClick, { signal });
            return b;
        };
        const title = el('div', 'af-shop-title');
        title.textContent = '⏱️ Increase time';
        const have = el('div', 'af-shop-line');
        have.textContent = `${starIcon()} ${progress.stars}   ⏱️ +${progress.buff}s`;
        have.dataset.shop = 'have';
        const note = el('div', 'af-shop-note');
        note.textContent = `${STARS_PER_BUFF} ${starIcon()} = +1 second`;
        card.replaceChildren(
            title, have, note,
            button(`+1 second (${STARS_PER_BUFF} ${starIcon()})`, 'one', () => { buyTime(1); renderShop(card, overlay); }, affordable < 1),
            button(`Increase as much as I can${affordable > 0 ? ` (+${affordable}s)` : ''}`, 'max', () => { buyTime(affordable); renderShop(card, overlay); }, affordable < 1),
            button('OK', 'ok', () => closeShop(overlay)),
        );
    }

    /** Spends stars on `count` seconds of time buff (the timer is standing still, so the round in play gets it too). */
    function buyTime(count) {
        for (let i = 0; i < count; i++) {
            const bought = buyTimeBuff(progress.stars, progress.buff);
            if (!bought) break;
            progress.stars = bought.stars;
            progress.buff = bought.buff;
            deadline += BUFF_MS;
            timeLimitMs += BUFF_MS;
        }
        saveProgress();
        renderStars();
        sound.pop();
    }

    /** OK: the dialog closes, the time spent in it doesn't count against the round, and play (and the countdown) carries on. */
    function closeShop(overlay) {
        overlay.remove();
        roundStartedAt += performance.now() - shopSince;
        shopOpen = false;
        armHint();
    }
    starsEl.addEventListener('click', openShop, { signal });


    // ---- worlds (background) ----------------------------------------------------------------------

    function buildWorld(world) {
        const layer = el('div', 'af-world');
        layer.dataset.world = world.id;
        if (progress.hardcore) { // Hardcore Mode: every world at night
            layer.classList.add('night');
            const moon = el('div', 'af-moon');
            moon.textContent = '🌙';
            layer.appendChild(moon);
        }
        for (const [emoji, left, top, size] of SCENERY[world.id] ?? []) {
            const item = el('div', 'af-scene');
            item.textContent = emoji;
            item.style.cssText = `left:${left}%;top:${top}%;font-size:${size}vh`;
            layer.appendChild(item);
        }
        return layer;
    }

    /** Shows the world's background (its night version in Hardcore Mode) and name (bottom left). When the world changes mid-game the new one fades in over the old. */
    function showWorld(world) {
        if (currentWorld?.id === world.id && currentNight === progress.hardcore) return;
        const announce = currentWorld !== null;
        currentWorld = world;
        currentNight = progress.hardcore;
        root.dataset.world = world.id;
        worldNameEl.textContent = `${world.emoji} ${world.name}`;
        const layer = buildWorld(world);
        if (announce) layer.classList.add('entering');
        root.insertBefore(layer, animalsEl);
        if (!announce) return;
        void layer.offsetWidth;
        layer.classList.remove('entering');
        later(() => root.querySelectorAll('.af-world').forEach(n => { if (n !== layer) n.remove(); }), WORLD_FADE_MS);
    }

    // ---- bouncing animals (Hardcore Mode past level 100) ----------------------------------------------

    const BOUNCE_SPEED = 0.3; // fraction of the play area's shorter side per second
    let bounceFrame = 0;

    function stopBouncing() {
        cancelAnimationFrame(bounceFrame);
        animalsEl.classList.remove('bouncing');
        for (const card of animalsEl.children) { card.style.left = ''; card.style.top = ''; }
    }

    /** The animals leave their row and drift around the area above the tray, bouncing off its edges and each other. */
    function startBouncing() {
        stopBouncing();
        if (!animalsBounce(progress.rounds, progress.hardcore)) return;
        animalsEl.classList.add('bouncing');
        const area = { w: animalsEl.clientWidth, h: animalsEl.clientHeight };
        const speed = BOUNCE_SPEED * Math.min(area.w, area.h);
        const movers = [...animalsEl.children].map(card => {
            const angle = Math.random() * Math.PI * 2;
            const m = { card, w: card.offsetWidth, h: card.offsetHeight, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, x: 0, y: 0 };
            m.x = Math.random() * Math.max(1, area.w - m.w);
            m.y = Math.random() * Math.max(1, area.h - m.h);
            return m;
        });
        let last = performance.now();
        const step = now => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (!menuOpen && !shopOpen && !locked) {
                for (const m of movers) {
                    m.x += m.vx * dt;
                    m.y += m.vy * dt;
                    if (m.x < 0) { m.x = 0; m.vx = Math.abs(m.vx); }
                    if (m.x > area.w - m.w) { m.x = area.w - m.w; m.vx = -Math.abs(m.vx); }
                    if (m.y < 0) { m.y = 0; m.vy = Math.abs(m.vy); }
                    if (m.y > area.h - m.h) { m.y = area.h - m.h; m.vy = -Math.abs(m.vy); }
                }
                for (let i = 0; i < movers.length; i++) for (let j = i + 1; j < movers.length; j++) collide(movers[i], movers[j]);
                for (const m of movers) { m.card.style.left = `${m.x}px`; m.card.style.top = `${m.y}px`; }
            }
            bounceFrame = requestAnimationFrame(step);
        };
        bounceFrame = requestAnimationFrame(step);
    }

    /** Two overlapping animals push apart along the axis they overlap least, and swap direction on it. */
    function collide(a, b) {
        const dx = (a.x + a.w / 2) - (b.x + b.w / 2);
        const dy = (a.y + a.h / 2) - (b.y + b.h / 2);
        const overlapX = (a.w + b.w) / 2 - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) return;
        if (overlapX < overlapY) {
            const push = (overlapX / 2) * Math.sign(dx || 1);
            a.x += push; b.x -= push;
            [a.vx, b.vx] = [Math.abs(a.vx) * Math.sign(dx || 1), -Math.abs(b.vx) * Math.sign(dx || 1)];
        } else {
            const push = (overlapY / 2) * Math.sign(dy || 1);
            a.y += push; b.y -= push;
            [a.vy, b.vy] = [Math.abs(a.vy) * Math.sign(dy || 1), -Math.abs(b.vy) * Math.sign(dy || 1)];
        }
    }

    // ---- rounds -------------------------------------------------------------------------------

    function startRound() {
        locked = false;
        showWorld(worldFor(progress.rounds));
        round = createRound(Math.random, { ...difficultyFor(progress.rounds, progress.hardcore), previousAnimalIds: previousAnimals, pool: animalPool(progress.rounds), rare: rareAnimalFor(progress.rounds), favoured: favouredAnimals(progress.rounds) });
        previousAnimals = round.animals;
        root.dataset.round = String(progress.rounds + 1);
        root.dataset.hardcore = String(progress.hardcore);
        hardcoreEl.hidden = !progress.hardcore;

        trayEl.style.setProperty('--n', String(round.items.length));
        animalsEl.replaceChildren(...round.animals.map(id => {
            const animal = animalById(id);
            const card = el('div', 'af-animal');
            if (animal.rare) card.classList.add('rare');
            card.dataset.animal = id;
            if (options.debug) card.append(el('div', 'af-fed-count'));
            const face = el('div', 'af-emoji');
            face.textContent = animal.emoji;
            card.append(face);
            return card;
        }));

        animalsEl.classList.toggle('crowded', round.animals.length > 3); // 4-5 animals are drawn smaller to fit
        animalsEl.style.setProperty('--na', String(round.animals.length));
        startBouncing();
        renderPalettes();
        renderFedCounts();

        trayEl.replaceChildren(...round.items.map(item => {
            const slot = el('div', 'af-slot');
            const food = el('div', 'af-food');
            food.dataset.uid = item.uid;
            food.dataset.food = item.foodId;
            food.textContent = FOODS[item.foodId].emoji;
            slot.appendChild(food);
            return slot;
        }));

        if (round.animals.some(id => animalById(id).rare)) {
            sound.sparkle();
            say('A unicorn!');
        }
        renderStars();
        levelEl.textContent = `Level ${levelFor(progress.rounds)}`;
        sound.pop();
        mistakes = 0;
        roundStartedAt = performance.now();
        pausedSince = null;
        armHint();
        startTimer();
    }

    // ---- countdown (level 16 onwards) -------------------------------------------------------------

    function stopTimer() {
        cancelAnimationFrame(timerFrame);
        timerEl.hidden = true;
        timerEl.classList.remove('low', 'up');
    }

    function startTimer() {
        stopTimer();
        const seconds = roundTimeSeconds(progress.rounds, progress.hardcore, round.animals.length);
        if (seconds === null) { timeLimitMs = 0; return; }
        timeLimitMs = (seconds + progress.buff) * 1000; // the bought time buff adds to every countdown
        deadline = performance.now() + timeLimitMs;
        lastTimerFrame = performance.now();
        timerEl.hidden = false;
        timerFrame = requestAnimationFrame(updateTimer);
    }

    function updateTimer(now) {
        if (timerPaused || menuOpen || shopOpen) deadline += now - lastTimerFrame; // the clock stands still while paused
        lastTimerFrame = now;
        const left = Math.max(0, deadline - now);
        timerBar.style.width = `${(left / timeLimitMs) * 100}%`;
        timerText.textContent = String(Math.ceil(left / 1000));
        timerEl.classList.toggle('low', left <= 5000);
        if (left <= 0) { timeUp(); return; }
        timerFrame = requestAnimationFrame(updateTimer);
    }

    /** A star drops off the counter and fades away. */
    function starLostEffect() {
        const star = el('div', 'af-lost-star');
        star.textContent = starIcon();
        root.appendChild(star);
        starsEl.classList.remove('lost');
        void starsEl.offsetWidth;
        starsEl.classList.add('lost');
        later(() => { star.remove(); starsEl.classList.remove('lost'); }, 1500);
    }

    /** Out of time: a gentle "oh no", she loses a star (a life, never below zero), then a fresh round at the same level. */
    function timeUp() {
        if (locked) return;
        locked = true;
        timerEl.classList.add('up');
        progress.buff = wearBuff(progress.buff); // the time buff wears off a little each time the countdown runs out
        if (progress.hardcore && progress.stars === 0) {
            // Hardcore Mode: out of time with no stars left sends her back to the very start (the mode itself stays on).
            progress.rounds = 0;
            previousAnimals = [];
            saveProgress();
            say('Back to level 1!');
        } else if (progress.stars > 0) {
            progress.stars = loseStar(progress.stars);
            saveProgress();
            renderStars();
            starLostEffect();
        }
        saveProgress();
        renderStars();
        if (drag) finishDrag();
        for (const card of animalsEl.children) flash(card, 'shake');
        trayEl.querySelectorAll('.af-food:not(.eaten)').forEach(f => f.classList.add('leftover'));
        sound.boop();
        later(startRound, 1400);
    }

    function finishRound() {
        locked = true;
        stopTimer();
        trayEl.querySelectorAll('.af-food:not(.eaten)').forEach(f => f.classList.add('leftover'));
        progress.rounds++;
        const earned = starsForRound({
            level: levelFor(progress.rounds - 1),
            animalCount: round.animals.length,
            mistakes,
            elapsedMs: performance.now() - roundStartedAt,
            timeLimitMs: timeLimitMs || null,
        });
        progress.stars += earned;
        root.dataset.earned = String(earned);
        saveProgress();
        renderStars();
        confetti();
        sound.success();
        say('Hooray!');
        if (earned > 0) later(() => showReward(earned), 900);
        else later(startRound, NEXT_ROUND_MS);
    }

    /** The stars just earned for the round pop up in the middle of the screen. */
    function showReward(earned) {
        const overlay = el('div', 'af-reward');
        const star = el('div', 'af-big-star');
        star.textContent = starIcon().repeat(earned);
        star.style.setProperty('--n', String(earned));
        const sticker = el('div', 'af-sticker');
        sticker.textContent = animalById(previousAnimals[0]).emoji;
        overlay.append(star, sticker);
        root.appendChild(overlay);
        sound.reward();
        options.onReward?.(progress.stars);
        later(() => { overlay.remove(); startRound(); }, REWARD_MS);
    }

    function confetti() {
        for (let i = 0; i < 24; i++) {
            const piece = el('div', 'af-confetti');
            piece.textContent = CONFETTI[i % CONFETTI.length];
            piece.style.left = `${Math.random() * 95}%`;
            piece.style.animationDelay = `${Math.random() * 0.5}s`;
            root.appendChild(piece);
            later(() => piece.remove(), 2400);
        }
    }

    // ---- hints --------------------------------------------------------------------------------

    function clearHint() {
        root.querySelectorAll('.hint').forEach(n => n.classList.remove('hint'));
    }

    function armHint() {
        clearHint();
        if (hintTimer) { clearTimeout(hintTimer); timers.delete(hintTimer); }
        hintTimer = later(showHint, HINT_AFTER_MS);
    }

    function showHint() {
        if (locked || drag || !round) return;
        let animal = null;
        const item = round.items.find(i => {
            if (i.fed || i.distractor) return false;
            animal = round.animals.find(id => checkFeed(round, i.uid, id));
            return animal !== undefined;
        });
        if (!item) return;
        trayEl.querySelector(`[data-uid="${item.uid}"]`)?.classList.add('hint');
        animalsEl.querySelector(`[data-animal="${animal}"]`)?.classList.add('hint');
    }

    // ---- interaction --------------------------------------------------------------------------

    function center(node) {
        const r = node.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function animalAt(point) {
        for (const card of animalsEl.children) {
            const r = card.getBoundingClientRect();
            const pad = 24;
            if (point.x >= r.left - pad && point.x <= r.right + pad && point.y >= r.top - pad && point.y <= r.bottom + pad) return card;
        }
        return null;
    }

    const REJECT_AFTER_MS = 500;
    const REJECT_PHRASES = ['Yuck!', 'No thank you!', 'Eww!', 'Not that!'];
    let rejectCount = 0;

    /** The animal pulls a face: it shakes its head, makes a "yuck" noise and says so. */
    function reject(card) {
        mistakes++;
        flash(card, 'shake');
        sound.yuck();
        say(REJECT_PHRASES[rejectCount++ % REJECT_PHRASES.length]);
    }

    function flash(card, className) {
        card.classList.remove(className);
        void card.offsetWidth;
        card.classList.add(className);
        later(() => card.classList.remove(className), 600);
    }

    root.addEventListener('pointerdown', e => {
        sound.unlock();
        armHint();
        const food = e.target.closest('.af-food');
        if (food && !locked && !drag && !food.classList.contains('eaten')) {
            e.preventDefault();
            food.setPointerCapture(e.pointerId);
            food.classList.add('dragging');
            drag = { food, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, lift: -Math.round(food.offsetHeight * 0.5), lastTime: performance.now(), shownBites: bitesTaken(itemOf(food)) };
            moveDrag(e);
            say(FOODS[food.dataset.food].name);
            frame = requestAnimationFrame(tick);
            return;
        }
        const card = e.target.closest('.af-animal');
        if (card && !locked) {
            flash(card, 'tap');
            sound.pop();
            say(animalById(card.dataset.animal).name);
        }
    }, { signal });

    function itemOf(food) {
        return round.items.find(i => i.uid === food.dataset.uid);
    }

    /** Eaten food shrinks as it is eaten; a lifted (dragged) food is also scaled up so it shows under the finger. */
    function place(food, dx, dy, lifted) {
        const shrink = 1 - 0.5 * eatenFraction(itemOf(food));
        food.style.transform = `translate(${dx}px, ${dy}px) scale(${(lifted ? 1.25 : 1) * shrink})`;
    }

    function paintBites(food) {
        food.classList.remove('bites-1', 'bites-2', 'bites-3');
        const bites = bitesTaken(itemOf(food));
        if (bites > 0) food.classList.add(`bites-${Math.min(bites, 3)}`);
    }

    function moveDrag(e) {
        drag.dx = e.clientX - drag.startX;
        drag.dy = e.clientY - drag.startY + drag.lift;
        place(drag.food, drag.dx, drag.dy, true);
        const over = animalAt(center(drag.food));
        for (const card of animalsEl.children) card.classList.toggle('hover', card === over);
    }

    /** Runs every frame while dragging: a food held over the animal that eats it is eaten bite by bite, straight away. */
    function tick(now) {
        if (!drag) return;
        const { food } = drag;
        const dt = Math.min(now - drag.lastTime, 100);
        drag.lastTime = now;

        const card = animalAt(center(food));
        for (const c of animalsEl.children) c.classList.toggle('munching', c === card && checkFeed(round, food.dataset.uid, c.dataset.animal));

        // Held over an animal that does not eat this food: after a moment it spits it back out (once per visit).
        const wrong = card && !checkFeed(round, food.dataset.uid, card.dataset.animal) ? card : null;
        if (wrong !== drag.wrongCard) { drag.wrongCard = wrong; drag.wrongSince = now; drag.rejected = false; }
        if (wrong && !drag.rejected && now - drag.wrongSince >= REJECT_AFTER_MS) { drag.rejected = true; reject(wrong); }

        if (card) {
            const result = eatFor(round, food.dataset.uid, card.dataset.animal, dt);
            if (result.ok) {
                if (result.bites !== drag.shownBites) {
                    drag.shownBites = result.bites;
                    paintBites(food);
                    sound.crunch();
                }
                place(food, drag.dx, drag.dy, true);
                if (result.done) { finishDrag(); swallow(food, card); return; }
            }
        }
        frame = requestAnimationFrame(tick);
    }

    /** Ends the drag state (not the food): stops the loop, clears highlights, releases the pointer. */
    function finishDrag() {
        const { food, pointerId } = drag;
        drag = null;
        cancelAnimationFrame(frame);
        for (const card of animalsEl.children) card.classList.remove('hover', 'munching');
        try { food.releasePointerCapture(pointerId); } catch { /* already released */ }
        food.classList.remove('dragging');
        void food.offsetWidth;
    }

    root.addEventListener('pointermove', e => {
        if (drag && e.pointerId === drag.pointerId) moveDrag(e);
    }, { signal });

    function endDrag(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const { food, wrongCard, rejected } = drag;
        const target = animalAt(center(food));
        finishDrag();

        if (e.type === 'pointerup' && target && feed(round, food.dataset.uid, target.dataset.animal)) {
            swallow(food, target);
        } else {
            // Already rejected while hovering? Don't make the same noise a second time on release.
            if (e.type === 'pointerup' && target && !(rejected && wrongCard === target)) reject(target);
            place(food, 0, 0, false); // glides home, keeping any bites already taken
        }
        armHint();
    }

    /** The last mouthful: the food flies into the animal's mouth. */
    function swallow(food, card) {
        paintBites(food);
        const slotCenter = center(food.parentElement);
        const mouth = center(card);
        food.classList.add('eaten');
        food.style.transform = `translate(${mouth.x - slotCenter.x}px, ${mouth.y - slotCenter.y}px) scale(.2)`;
        flash(card, 'eat');
        sound.chomp();
        renderFed();
        renderFedCounts();
        renderPalettes();
        armHint();
        if (isRoundComplete(round)) finishRound();
    }

    root.addEventListener('pointerup', endDrag, { signal });
    root.addEventListener('pointercancel', endDrag, { signal });
    root.addEventListener('contextmenu', e => e.preventDefault(), { signal });
    root.addEventListener('dragstart', e => e.preventDefault(), { signal });

    startRound();

    return {
        setOptions(next) {
            if (next.soundEnabled !== undefined) { soundEnabled = next.soundEnabled; sound.setEnabled(soundEnabled); }
            if (next.paused !== undefined) {
                menuOpen = next.paused;
                if (menuOpen) pausedSince ??= performance.now();
                else if (pausedSince !== null) { roundStartedAt += performance.now() - pausedSince; pausedSince = null; } // the menu's time doesn't count against the player
            }
            if (next.hardcore && !progress.hardcore) enterHardcore();
            if (next.speechEnabled !== undefined) {
                speechEnabled = next.speechEnabled;
                if (!speechEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
            }
        },
        unmount() {
            abort.abort();
            cancelAnimationFrame(frame);
            cancelAnimationFrame(bounceFrame);
            cancelAnimationFrame(timerFrame);
            timers.forEach(clearTimeout);
            timers.clear();
            sound.dispose();
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            root.remove();
            stylesheet.remove();
        },
    };
}
