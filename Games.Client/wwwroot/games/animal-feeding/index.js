// Animal feeding game: drag each food to the animal that eats it. No fail state; wrong drops just wobble and return.
import { FOODS, animalById } from './data.js';
import { createRound, feed, checkFeed, eat as eatFor, bitesTaken, eatenFraction, isRoundComplete, nextDifficulty, shouldReward, roundTimeSeconds, levelFor, animalPool, rareAnimalFor } from './logic.js';
import { createSound } from './sound.js';

const HINT_AFTER_MS = 8000;
const NEXT_ROUND_MS = 1700;
const REWARD_MS = 2600;
const CONFETTI = ['🎉', '⭐', '🎈', '✨', '🌟', '🎊'];

export function mount(container, options = {}) {
    let soundEnabled = options.soundEnabled ?? true;
    let speechEnabled = options.speechEnabled ?? true;
    const progress = { rounds: 0, stars: 0, ...(options.loadProgress?.() ?? {}) };

    const abort = new AbortController();
    const { signal } = abort;
    const timers = new Set();
    const sound = createSound(soundEnabled);

    let round = null;
    let previousAnimals = [];
    let locked = false;
    let drag = null;
    let hintTimer = null;
    let frame = 0;
    let timerFrame = 0;
    let deadline = 0;
    let timeLimitMs = 0;

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./styles.css', import.meta.url).href;
    document.head.appendChild(stylesheet);

    const root = el('div', 'af-root');
    const animalsEl = el('div', 'af-animals');
    const trayEl = el('div', 'af-tray');
    const starsEl = el('div', 'af-stars');
    const levelEl = el('div', 'af-level');
    const timerEl = el('div', 'af-timer');
    const timerBar = el('div', 'af-timer-bar');
    const timerText = el('div', 'af-timer-text');
    timerEl.append(timerBar, timerText);
    timerEl.hidden = true;
    root.append(animalsEl, trayEl, starsEl, levelEl, timerEl);
    container.appendChild(root);

    function el(tag, className) {
        const node = document.createElement(tag);
        node.className = className;
        return node;
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

    function renderStars() {
        starsEl.textContent = progress.stars > 0 ? `⭐ ${progress.stars}` : '';
    }

    // ---- rounds -------------------------------------------------------------------------------

    function startRound() {
        locked = false;
        round = createRound(Math.random, { ...nextDifficulty(progress.rounds), previousAnimalIds: previousAnimals, pool: animalPool(progress.rounds), rare: rareAnimalFor(progress.rounds) });
        previousAnimals = round.animals;
        root.dataset.round = String(progress.rounds + 1);

        trayEl.style.setProperty('--n', String(round.items.length));
        animalsEl.replaceChildren(...round.animals.map(id => {
            const animal = animalById(id);
            const card = el('div', 'af-animal');
            if (animal.rare) card.classList.add('rare');
            card.dataset.animal = id;
            const face = el('div', 'af-emoji');
            face.textContent = animal.emoji;
            card.append(face);
            return card;
        }));

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
        const seconds = roundTimeSeconds(progress.rounds);
        if (seconds === null) return;
        timeLimitMs = seconds * 1000;
        deadline = performance.now() + timeLimitMs;
        timerEl.hidden = false;
        timerFrame = requestAnimationFrame(updateTimer);
    }

    function updateTimer(now) {
        const left = Math.max(0, deadline - now);
        timerBar.style.width = `${(left / timeLimitMs) * 100}%`;
        timerText.textContent = String(Math.ceil(left / 1000));
        timerEl.classList.toggle('low', left <= 5000);
        if (left <= 0) { timeUp(); return; }
        timerFrame = requestAnimationFrame(updateTimer);
    }

    /** Out of time: a gentle "oh no", then a fresh round at the same level. Nothing is lost. */
    function timeUp() {
        if (locked) return;
        locked = true;
        timerEl.classList.add('up');
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
        const rewarded = shouldReward(progress.rounds);
        if (rewarded) progress.stars++;
        options.saveProgress?.({ rounds: progress.rounds, stars: progress.stars });
        renderStars();
        confetti();
        sound.success();
        say('Hooray!');
        if (rewarded) later(showReward, 900);
        else later(startRound, NEXT_ROUND_MS);
    }

    function showReward() {
        const overlay = el('div', 'af-reward');
        const star = el('div', 'af-big-star');
        star.textContent = '⭐';
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
        const item = round.items.find(i => !i.fed && !i.distractor);
        if (!item) return;
        const animal = round.animals.find(id => checkFeed(round, item.uid, id));
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
            if (next.speechEnabled !== undefined) {
                speechEnabled = next.speechEnabled;
                if (!speechEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
            }
        },
        unmount() {
            abort.abort();
            cancelAnimationFrame(frame);
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
