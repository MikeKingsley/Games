// Synthesized WebAudio cues. No audio files. The AudioContext is created lazily and unlocked by a user gesture.

export function createSound(enabled) {
    let ctx = null;
    let on = enabled;

    function context() {
        if (!on) return null;
        if (!ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            ctx = new Ctor();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    /** One enveloped oscillator note; `at` is seconds from now. */
    function note(freq, at, duration, { type = 'sine', gain = 0.18, slideTo = null } = {}) {
        const c = context();
        if (!c) return;
        const start = c.currentTime + at;
        const osc = c.createOscillator();
        const amp = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
        amp.gain.setValueAtTime(0.0001, start);
        amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
        amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(amp).connect(c.destination);
        osc.start(start);
        osc.stop(start + duration + 0.05);
    }

    /** A short filtered noise burst: the crunch of a bite. */
    function noise(at, duration, freq, gain) {
        const c = context();
        if (!c) return;
        const start = c.currentTime + at;
        const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource();
        const filter = c.createBiquadFilter();
        const amp = c.createGain();
        src.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = 0.9;
        amp.gain.setValueAtTime(gain, start);
        amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        src.connect(filter).connect(amp).connect(c.destination);
        src.start(start);
    }

    return {
        setEnabled(value) { on = value; },
        /** Call from a pointer gesture so mobile browsers allow audio. */
        unlock() { context(); },
        /** One bite: a crunch, a second smaller crunch and a soft thump. */
        crunch() {
            noise(0, 0.09, 2200, 0.5);
            noise(0.11, 0.08, 1500, 0.35);
            note(150, 0, 0.1, { type: 'sine', gain: 0.15, slideTo: 90 });
        },
        /** "Blech!": a wobbly falling buzz, then a spit. */
        yuck() {
            const c = context();
            if (!c) return;
            const start = c.currentTime;
            const osc = c.createOscillator();
            const wobble = c.createOscillator();
            const wobbleDepth = c.createGain();
            const amp = c.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(280, start);
            osc.frequency.exponentialRampToValueAtTime(95, start + 0.45);
            wobble.frequency.value = 22;
            wobbleDepth.gain.value = 18;
            wobble.connect(wobbleDepth).connect(osc.frequency);
            amp.gain.setValueAtTime(0.0001, start);
            amp.gain.exponentialRampToValueAtTime(0.14, start + 0.03);
            amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
            osc.connect(amp).connect(c.destination);
            osc.start(start); wobble.start(start);
            osc.stop(start + 0.55); wobble.stop(start + 0.55);
            noise(0.4, 0.12, 900, 0.5);
        },
        /** A rare visitor arrives: a quick glittery arpeggio. */
        sparkle() { [1319, 1568, 1976, 2349, 2637].forEach((f, i) => note(f, i * 0.07, 0.25, { type: 'sine', gain: 0.1 })); },
        pop() { note(520, 0, 0.12, { slideTo: 880 }); },
        chomp() {
            note(220, 0, 0.1, { type: 'square', gain: 0.1, slideTo: 120 });
            note(200, 0.14, 0.1, { type: 'square', gain: 0.1, slideTo: 110 });
        },
        success() { [523, 659, 784, 1047].forEach((f, i) => note(f, 0.18 + i * 0.1, 0.25, { type: 'triangle' })); },
        boop() { note(300, 0, 0.25, { type: 'sine', gain: 0.12, slideTo: 200 }); },
        reward() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => note(f, i * 0.12, 0.3, { type: 'triangle' })); },
        dispose() {
            on = false;
            if (ctx) ctx.close().catch(() => {});
            ctx = null;
        },
    };
}
