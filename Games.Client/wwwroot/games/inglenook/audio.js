// Inglenook sound: everything is synthesised with WebAudio (no audio files). The context is created lazily on the first gesture.
export function createAudio(enabled = true) {
    let ctx = null;
    let master = null;
    let engine = null; // { osc, osc2, gain, filter }
    let on = enabled;

    function ensure() {
        if (!on) return null;
        if (!ctx) {
            const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!AC) return null;
            try {
                ctx = new AC();
                master = ctx.createGain();
                master.gain.value = 0.6;
                master.connect(ctx.destination);
            } catch { ctx = null; return null; }
        }
        if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
        return ctx;
    }

    function startEngine() {
        const c = ensure();
        if (!c || engine) return;
        const osc = c.createOscillator();
        const osc2 = c.createOscillator();
        const filter = c.createBiquadFilter();
        const gain = c.createGain();
        osc.type = 'sawtooth';
        osc2.type = 'square';
        osc.frequency.value = 38;
        osc2.frequency.value = 19;
        filter.type = 'lowpass';
        filter.frequency.value = 220;
        gain.gain.value = 0;
        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        osc.start();
        osc2.start();
        engine = { osc, osc2, gain, filter };
    }

    function tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null, delay = 0) {
        const c = ensure();
        if (!c) return;
        const t = c.currentTime + delay;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    function noise(dur, vol = 0.3, freq = 1200) {
        const c = ensure();
        if (!c) return;
        const len = Math.max(1, Math.floor(c.sampleRate * dur));
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = c.createBufferSource();
        const f = c.createBiquadFilter();
        const g = c.createGain();
        f.type = 'bandpass';
        f.frequency.value = freq;
        g.gain.value = vol;
        src.buffer = buf;
        src.connect(f);
        f.connect(g);
        g.connect(master);
        src.start();
    }

    const sounds = {
        coupled() { noise(0.12, 0.5, 900); tone(160, 0.18, 'square', 0.25, 70); tone(95, 0.25, 'sine', 0.3, 50, 0.05); },
        uncoupled() { tone(320, 0.08, 'square', 0.2, 180); noise(0.06, 0.3, 2400); },
        buffer() { tone(80, 0.2, 'sine', 0.45, 40); noise(0.1, 0.35, 500); },
        pointThrown() { noise(0.04, 0.4, 3000); tone(900, 0.04, 'square', 0.1, 600, 0.05); },
        pointLocked() { tone(140, 0.12, 'sawtooth', 0.15, 100); },
        uncoupleBlocked() { tone(140, 0.12, 'sawtooth', 0.15, 100); },
        bumped() { tone(110, 0.15, 'square', 0.25, 60); },
        win() { tone(523, 0.5, 'triangle', 0.25, 520); tone(659, 0.5, 'triangle', 0.22, 655, 0.04); tone(784, 0.9, 'triangle', 0.25, 780, 0.08); },
    };

    return {
        /** Call on the first user gesture (browsers keep audio suspended until then). */
        resume() { startEngine(); },
        play(type) { sounds[type]?.(); },
        /** speed: loco speed in wagon-lengths per second (signed). Drives the diesel idle to a working note. */
        setSpeed(speed) {
            if (!engine || !ctx) return;
            const s = Math.min(1, Math.abs(speed) / 1.2);
            const t = ctx.currentTime;
            engine.osc.frequency.setTargetAtTime(38 + 22 * s, t, 0.1);
            engine.osc2.frequency.setTargetAtTime(19 + 11 * s, t, 0.1);
            engine.filter.frequency.setTargetAtTime(200 + 500 * s, t, 0.1);
            engine.gain.gain.setTargetAtTime(on ? 0.08 + 0.12 * s : 0, t, 0.1);
        },
        setEnabled(v) {
            on = v;
            if (!on && engine && ctx) engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
            if (on) startEngine();
        },
        destroy() {
            try { engine?.osc.stop(); engine?.osc2.stop(); } catch { /* already stopped */ }
            engine = null;
            ctx?.close?.().catch(() => {});
            ctx = null;
        },
    };
}
