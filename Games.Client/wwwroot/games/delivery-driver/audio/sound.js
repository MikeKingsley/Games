// Synthesized WebAudio: an engine note that follows RPM and load (each vehicle has its own voice), horn,
// indicator ticks, loading clunks, the pay "ka-ching", bumps, reversing beeper, air brakes and ambience.
// No audio files. Nothing is created until the first user gesture unlocks the AudioContext.

export function createSound(enabled = true) {
    let ctx = null;
    let on = enabled;
    let suspended = false;
    let master = null;
    let engine = null;
    let horn = null;
    let noiseBuffer = null;
    let ambience = null;
    let beeper = null;
    let lastTick = 0;

    function ensure() {
        if (!on || ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.6;
        master.connect(ctx.destination);
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return ctx;
    }

    function noise() {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        return src;
    }

    function blip(freq, dur, type = 'square', vol = 0.15, slide = 0) {
        if (!ensure() || suspended) return;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    function thump(vol = 0.4, dur = 0.18, freq = 160) {
        if (!ensure() || suspended) return;
        const t = ctx.currentTime;
        const src = noise();
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(master);
        src.start(t);
        src.stop(t + dur + 0.02);
    }

    function startEngine(voice) {
        const o1 = ctx.createOscillator();
        o1.type = voice.wave ?? 'sawtooth';
        const o2 = ctx.createOscillator();
        o2.type = 'square';
        const rough = noise();
        const roughFilter = ctx.createBiquadFilter();
        roughFilter.type = 'bandpass';
        roughFilter.Q.value = 1.2;
        const roughGain = ctx.createGain();
        roughGain.gain.value = (voice.roughness ?? 0.4) * 0.08;
        const sub = ctx.createGain();
        sub.gain.value = 0.35;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        o1.connect(filter);
        o2.connect(sub).connect(filter);
        rough.connect(roughFilter).connect(roughGain).connect(filter);
        filter.connect(gain).connect(master);
        o1.start(); o2.start(); rough.start();
        return { o1, o2, rough, roughFilter, filter, gain, voice, stop() { try { o1.stop(); o2.stop(); rough.stop(); } catch { /* already stopped */ } } };
    }

    return {
        unlock() {
            if (!ensure()) return;
            if (ctx.state === 'suspended' && !suspended) ctx.resume?.();
        },
        setEnabled(next) {
            on = next;
            if (!ctx) return;
            if (on && !suspended) ctx.resume?.(); else ctx.suspend?.();
        },
        setSuspended(s) {
            suspended = s;
            if (!ctx) return;
            if (s) ctx.suspend?.(); else if (on) ctx.resume?.();
        },
        /**
         * Engine note: rpm and load (0..1) from the gearbox; voice from the vehicle spec. running=false fades it out.
         * The fundamental is the firing frequency of a four-cylinder engine (rpm/60 x 2), scaled by voice.base.
         */
        engine(rpm, load, voice, running = true) {
            if (!ctx || !on || suspended) return;
            if (!engine || engine.voice !== voice) { engine?.stop(); engine = startEngine(voice ?? {}); }
            const t = ctx.currentTime;
            const f = Math.max(18, (rpm / 60) * 2 * ((voice?.base ?? 40) / 40));
            engine.o1.frequency.setTargetAtTime(f, t, 0.05);
            engine.o2.frequency.setTargetAtTime(f / 2, t, 0.05);
            engine.roughFilter.frequency.setTargetAtTime(f * 3, t, 0.05);
            engine.filter.frequency.setTargetAtTime(220 + f * (2 + (voice?.harmonics ?? 3)) * (0.5 + load), t, 0.08);
            engine.gain.gain.setTargetAtTime(running ? 0.05 + 0.07 * load : 0, t, 0.1);
        },
        horn(down) {
            if (!ensure() || suspended) return;
            if (down && !horn) {
                const t = ctx.currentTime;
                const a = ctx.createOscillator(), b = ctx.createOscillator(), g = ctx.createGain();
                a.type = b.type = 'square';
                a.frequency.value = 392; b.frequency.value = 494;
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
                a.connect(g); b.connect(g); g.connect(master);
                a.start(); b.start();
                horn = { a, b, g };
            } else if (!down && horn) {
                const t = ctx.currentTime;
                horn.g.gain.setTargetAtTime(0.0001, t, 0.03);
                horn.a.stop(t + 0.15); horn.b.stop(t + 0.15);
                horn = null;
            }
        },
        /** Called every frame while an indicator is on: ticks twice per flash. */
        indicator(onNow) {
            const now = performance.now();
            if (!onNow || now - lastTick < 400) return;
            lastTick = now;
            blip(1800, 0.03, 'square', 0.05);
        },
        clunk() { thump(0.5, 0.25, 140); },
        bump(impact) { thump(Math.min(0.9, 0.2 + impact * 0.08), 0.3, 220); },
        kaching() { blip(1320, 0.12, 'triangle', 0.18); setTimeout(() => blip(1760, 0.35, 'triangle', 0.18), 110); },
        airBrake() {
            if (!ensure() || suspended) return;
            const t = ctx.currentTime;
            const src = noise();
            const f = ctx.createBiquadFilter();
            f.type = 'highpass';
            f.frequency.value = 2500;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.18, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
            src.connect(f).connect(g).connect(master);
            src.start(t);
            src.stop(t + 0.65);
        },
        ferryHorn() { blip(110, 1.6, 'sawtooth', 0.15); },
        coupling() { thump(0.7, 0.35, 120); setTimeout(() => blip(900, 0.05, 'square', 0.06), 120); },
        /** Reversing beeper (vehicles from the 1980s): on while reversing. */
        beeper(onNow) {
            if (!ctx || !on || suspended) return;
            if (onNow && !beeper) beeper = setInterval(() => blip(1050, 0.35, 'square', 0.06), 900);
            else if (!onNow && beeper) { clearInterval(beeper); beeper = null; }
        },
        /** Rain/wind ambience level 0..1. */
        ambience(level) {
            if (!ctx || !on || suspended) return;
            if (!ambience) {
                const src = noise();
                const f = ctx.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.value = 1400;
                const g = ctx.createGain();
                g.gain.value = 0;
                src.connect(f).connect(g).connect(master);
                src.start();
                ambience = { src, g };
            }
            ambience.g.gain.setTargetAtTime(level * 0.08, ctx.currentTime, 0.5);
        },
        dispose() {
            if (beeper) clearInterval(beeper);
            engine?.stop();
            ctx?.close?.();
            ctx = null;
            engine = null;
        },
    };
}
