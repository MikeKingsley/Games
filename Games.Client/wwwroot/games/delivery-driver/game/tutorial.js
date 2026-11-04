// The guided first job (1919): controls, the depot office, taking a job, reversing onto the bay, loading,
// following the route line, the drop and getting paid. Each step waits for its own game event and nothing else,
// so the tutorial can't skip ahead. Skippable at any time.

export const STEPS = [
    { id: 'drive', on: 'moved', text: 'Welcome to Exeter, 1919! Drive with W/S or the arrow keys (or the pedals on screen) and steer with A/D. Have a little drive round the yard.' },
    { id: 'office', on: 'officeOpened', text: 'Stop in the depot yard and press F (or the 📦 button) to open the depot office.' },
    { id: 'accept', on: 'accepted', text: 'Pick a job from the Contracts board and press Accept. Multi-drop parcels are a good start.' },
    { id: 'bay', on: 'loadStarted', text: 'Reverse onto the loading bay: the rear of the van on the marker line, straight, and stop. Hold S to reverse.' },
    { id: 'loading', on: 'loaded', text: 'Loading… stay put until it’s done.' },
    { id: 'route', on: 'dropStarted', text: 'Follow the pink line on the map to the ring at the customer’s door, and stop beside it.' },
    { id: 'drop', on: 'delivered', text: 'Unloading… then on to the next drop.' },
    { id: 'paid', on: 'paid', text: 'Finish the last drop to get paid.' },
];

export function createTutorial(active = true) {
    return { step: active ? 0 : STEPS.length, done: !active, skipped: false };
}

export const tutorialStep = t => (t.done ? null : STEPS[t.step]);
export const tutorialText = t => tutorialStep(t)?.text ?? null;

/** Feeds a game event; advances only when it is the current step's event. Returns true if it advanced. */
export function tutorialEvent(t, event) {
    const step = tutorialStep(t);
    if (!step || step.on !== event) return false;
    t.step++;
    if (t.step >= STEPS.length) t.done = true;
    return true;
}

export function skipTutorial(t) {
    t.done = true;
    t.skipped = true;
    t.step = STEPS.length;
}

/**
 * Maps session events to tutorial events: drive (moved 15 m), office, accepted, the first load starting and
 * finishing, a drop starting and finishing, and the final payment.
 */
export function attachTutorial(t, session) {
    let start = null;
    const feed = e => tutorialEvent(t, e) && session.emit('tutorial', t);
    const offs = [
        session.on('step', p => {
            if (tutorialStep(t)?.on !== 'moved') return;
            start ??= { x: p.x, y: p.y };
            if (Math.hypot(p.x - start.x, p.y - start.y) > 15) feed('moved');
        }),
        session.on('officeOpened', () => feed('officeOpened')),
        session.on('accepted', () => feed('accepted')),
        session.on('startWork', stop => feed(stop.action === 'load' ? 'loadStarted' : 'dropStarted')),
        session.on('stopDone', job => {
            const last = job.contract.stops[job.stop - 1];
            feed(last.action === 'load' ? 'loaded' : 'delivered');
        }),
        session.on('complete', () => { feed('delivered'); feed('paid'); }),
    ];
    return () => offs.forEach(off => off());
}

// ---- Hill tips -------------------------------------------------------------------------------------------------

/**
 * One-off tips for driving in the hills, each shown once per company (remembered in career.tips) the first time the
 * situation comes up, whether or not the guided first job is running.
 */
export const HILL_TIPS = {
    descent: 'Steep hill down: ease off the throttle and let the engine brake for you in gear. Riding the brakes all the way down gets them hot, and hot brakes fade.',
    hotBrakes: 'Your brakes are getting hot! Brake less and let the engine hold you back (a lower gear helps) until they cool down.',
    parkBrake: 'A trailer dropped on a hill can roll away: stop beside it and hold Space (handbrake) to set its parking brake. On level ground it goes on by itself.',
};

/**
 * Which hill tip the moment calls for, if one hasn't been shown: `grade` along the direction of travel, `speed`
 * (m/s), `brakeHeat` (sim/slope.js). Returns a HILL_TIPS key or null.
 */
export function hillTipFor({ grade = 0, speed = 0, brakeHeat = 0 }, shown = []) {
    const due = [];
    if (brakeHeat >= 0.8) due.push('hotBrakes');
    if (grade <= -0.05 && Math.abs(speed) > 5) due.push('descent');
    return due.find(id => !shown.includes(id)) ?? null;
}

/**
 * Watches the session for hill situations (a few times a second) and dropping a trailer without its parking brake,
 * and emits 'tip' with the text the first time for this company. Returns a detach function.
 */
export function attachHillTips(session) {
    let steps = 0;
    const show = id => {
        const c = session.career;
        if (!c) return;
        c.tips ??= [];
        if (c.tips.includes(id)) return;
        c.tips.push(id);
        session.emit('tip', HILL_TIPS[id]);
    };
    const offs = [
        session.on('step', p => {
            if (++steps % 15) return;
            const grade = (session.slope?.grade ?? 0) * (p.speed < 0 ? -1 : 1);
            const id = hillTipFor({ grade, speed: p.speed, brakeHeat: p.brakeHeat ?? 0 }, session.career?.tips ?? []);
            if (id) show(id);
        }),
        session.on('uncoupled', t => { if (!t.parkBrake) show('parkBrake'); }),
    ];
    return () => offs.forEach(off => off());
}
