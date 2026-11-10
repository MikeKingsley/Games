// Inglenook sound: everything is synthesised with WebAudio (no audio files). The context is created lazily on the first gesture.
export function createAudio(enabled = true) {
    let ctx = null;
    let master = null;
    let engine = null; // hiss loop: { src, gain, filter }
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

    // Steam voice. The hiss is one looped filtered-noise source; chuffs are short noise bursts plus a low thump.
    const PUFF_DISTANCE = 0.22; // same rule as PUFF_DISTANCE in effects.js: one chuff per 0.22 wagon lengths travelled
    const MAX_CHUFFS = 8; // simultaneous chuff sources; extra chuffs are dropped rather than piling up nodes
    let noiseBuf = null;
    let chuffDist = 0; // distance accumulated towards the next chuff
    let chuffIndex = 0; // position in the group of four
    let chuffsLive = 0;
    let level = 0; // 0..1 loco speed, set by setSpeed

    function noiseBuffer(c) {
        if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
            const len = Math.floor(c.sampleRate * 1.5);
            noiseBuf = c.createBuffer(1, len, c.sampleRate);
            const data = noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        return noiseBuf;
    }

    function startEngine() {
        const c = ensure();
        if (!c || engine) return;
        try {
            const src = c.createBufferSource();
            const filter = c.createBiquadFilter();
            const gain = c.createGain();
            src.buffer = noiseBuffer(c);
            src.loop = true;
            filter.type = 'bandpass';
            filter.frequency.value = 3200;
            filter.Q.value = 0.5;
            gain.gain.value = 0;
            src.connect(filter);
            filter.connect(gain);
            gain.connect(master);
            src.start();
            engine = { src, gain, filter };
            engine.gain.gain.setTargetAtTime(0.025, c.currentTime, 0.1);
        } catch { engine = null; }
    }

    function chuff(strong) {
        const c = ensure();
        if (!c || !engine || chuffsLive >= MAX_CHUFFS) return;
        const soft = 0.45 + 0.55 * level; // softer as the loco settles to a crawl
        const vol = (strong ? 0.5 : 0.32) * soft;
        const t = c.currentTime;
        const src = c.createBufferSource();
        const f = c.createBiquadFilter();
        const g = c.createGain();
        src.buffer = noiseBuffer(c);
        f.type = 'bandpass';
        f.frequency.value = 700 + 500 * level;
        f.Q.value = 0.9;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        src.connect(f);
        f.connect(g);
        g.connect(master);
        chuffsLive++;
        src.onended = () => { chuffsLive = Math.max(0, chuffsLive - 1); };
        src.start(t, Math.random());
        src.stop(t + 0.11);
        const o = c.createOscillator();
        const og = c.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(75, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
        og.gain.setValueAtTime(vol * 0.7, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(og);
        og.connect(master);
        o.start(t);
        o.stop(t + 0.12);
    }

    function moved(distance) {
        chuffDist += Math.abs(distance);
        let n = 0;
        while (chuffDist >= PUFF_DISTANCE && n < 3) {
            chuffDist -= PUFF_DISTANCE;
            chuff(chuffIndex % 4 === 0);
            chuffIndex++;
            n++;
        }
        if (chuffDist > PUFF_DISTANCE) chuffDist = 0;
    }

    function stopped() { chuffDist = 0; chuffIndex = 0; }

    function whistle(freq, dur, delay, vol) {
        const c = ensure();
        if (!c) return;
        const t = c.currentTime + delay;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
        g.gain.setValueAtTime(vol, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        g.connect(master);
        for (const detune of [0, 7]) { // two slightly detuned tones, with a small pitch rise at the start
            const o = c.createOscillator();
            o.type = 'triangle';
            o.frequency.setValueAtTime(freq * 0.96, t);
            o.frequency.exponentialRampToValueAtTime(freq, t + 0.1);
            o.detune.value = detune;
            o.connect(g);
            o.start(t);
            o.stop(t + dur + 0.02);
        }
        const src = c.createBufferSource(); // breath noise
        const f = c.createBiquadFilter();
        const ng = c.createGain();
        src.buffer = noiseBuffer(c);
        f.type = 'bandpass';
        f.frequency.value = freq * 2;
        f.Q.value = 1.5;
        ng.gain.setValueAtTime(vol * 0.5, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f);
        f.connect(ng);
        ng.connect(master);
        src.start(t, Math.random());
        src.stop(t + dur + 0.02);
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
        win() { whistle(587, 0.55, 0, 0.16); whistle(784, 0.95, 0.5, 0.16); },
    };

    return {
        /** Call on the first user gesture (browsers keep audio suspended until then). */
        resume() { startEngine(); },
        /** event is the simulation event; `moved` events drive the chuffs. */
        play(type, event) {
            if (type === 'moved') { if (on) moved(event?.distance ?? 0); return; }
            sounds[type]?.();
        },
        /** speed: loco speed in wagon-lengths per second (signed). Sets the hiss level; a stop cuts the chuffs. */
        setSpeed(speed) {
            const s = Math.min(1, Math.abs(speed) / 1.2);
            if (s === 0 && level > 0) stopped();
            level = s;
            if (!engine || !ctx) return;
            const t = ctx.currentTime;
            engine.filter.frequency.setTargetAtTime(3200 + 1500 * s, t, 0.1);
            engine.gain.gain.setTargetAtTime(on ? 0.025 + 0.03 * s : 0, t, 0.1);
        },
        setEnabled(v) {
            on = v;
            if (!on && engine && ctx) engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
            if (on) { startEngine(); if (engine && ctx) engine.gain.gain.setTargetAtTime(0.025, ctx.currentTime, 0.05); }
        },
        destroy() {
            try { engine?.src.stop(); } catch { /* already stopped */ }
            engine = null;
            noiseBuf = null;
            ctx?.close?.().catch(() => {});
            ctx = null;
        },
    };
}
