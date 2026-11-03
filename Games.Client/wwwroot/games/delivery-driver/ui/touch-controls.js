// On-screen driving controls for tablets and phones: a steering slider (or wheel), pedals, reverse toggle and buttons.
// Shown when the primary pointer is coarse; writes into input.touch and fires input actions.

export function createTouchControls(root, input, signal) {
    const coarse = window.matchMedia?.('(pointer: coarse)');
    const wrap = el('div', 'dd-touch');
    const steer = el('div', 'dd-steer');
    const knob = el('div', 'dd-steer-knob');
    knob.textContent = '◀▶';
    steer.appendChild(knob);
    const pedals = el('div', 'dd-pedals');
    const brake = button('dd-pedal brake', 'BRAKE');
    const gas = button('dd-pedal gas', 'GO');
    pedals.append(brake, gas);
    const buttons = el('div', 'dd-touch-buttons');
    const reverse = button('dd-tbtn', 'R');
    reverse.title = 'Reverse';
    const actionButtons = [
        reverse,
        actionButton('📦', 'interact', 'Depot / load'),
        actionButton('🔗', 'couple', 'Couple / uncouple'),
        actionButton('📯', 'horn', 'Horn'),
        actionButton('🎥', 'camera', 'Camera'),
        actionButton('🗺️', 'map', 'Map'),
    ];
    buttons.append(...actionButtons);
    wrap.append(steer, pedals, buttons);
    root.appendChild(wrap);

    let layout = 'slider';

    function el(tag, className) {
        const n = document.createElement(tag);
        n.className = className;
        return n;
    }
    function button(className, label) {
        const b = el('button', className);
        b.type = 'button';
        b.textContent = label;
        return b;
    }
    function actionButton(label, action, title) {
        const b = button('dd-tbtn', label);
        b.title = title;
        b.dataset.action = action;
        b.addEventListener('pointerdown', e => { e.preventDefault(); input.emit(action, true); }, { signal });
        if (action === 'horn') b.addEventListener('pointerup', () => input.emit('horn', false), { signal });
        return b;
    }

    function setVisible(on) {
        input.touch.active = on;
        root.classList.toggle('touch', on);
    }
    setVisible(!!coarse?.matches);
    coarse?.addEventListener?.('change', e => setVisible(e.matches), { signal });

    // steering: the knob follows the finger; letting go self-centres
    let steerPointer = null;
    function steerFrom(e) {
        const r = steer.getBoundingClientRect();
        if (layout === 'wheel') {
            const angle = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
            input.touch.steer = Math.max(-1, Math.min(1, angle / (Math.PI * 0.6)));
        } else {
            input.touch.steer = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
        }
    }
    steer.addEventListener('pointerdown', e => { steerPointer = e.pointerId; steer.setPointerCapture?.(e.pointerId); steerFrom(e); }, { signal });
    steer.addEventListener('pointermove', e => { if (e.pointerId === steerPointer) steerFrom(e); }, { signal });
    const release = e => { if (e.pointerId === steerPointer) { steerPointer = null; input.touch.steer = 0; } };
    steer.addEventListener('pointerup', release, { signal });
    steer.addEventListener('pointercancel', release, { signal });

    function pedal(node, key) {
        const down = e => { e.preventDefault(); node.setPointerCapture?.(e.pointerId); input.touch[key] = 1; node.classList.add('down'); };
        const up = () => { input.touch[key] = 0; node.classList.remove('down'); };
        node.addEventListener('pointerdown', down, { signal });
        node.addEventListener('pointerup', up, { signal });
        node.addEventListener('pointercancel', up, { signal });
        node.addEventListener('lostpointercapture', up, { signal });
    }
    pedal(gas, 'throttle');
    pedal(brake, 'brake');
    reverse.addEventListener('pointerdown', e => {
        e.preventDefault();
        input.touch.reverse = !input.touch.reverse;
    }, { signal });

    return {
        element: wrap,
        setLayout(next) {
            layout = next === 'wheel' ? 'wheel' : 'slider';
            steer.classList.toggle('wheel', layout === 'wheel');
        },
        setVisible,
        update(session) {
            const s = input.touch.steer;
            if (layout === 'wheel') knob.style.transform = `rotate(${s * 108}deg)`;
            else knob.style.left = `calc(${(s + 1) * 50}% - 40px)`;
            reverse.classList.toggle('on', input.touch.reverse);
            const couple = actionButtons.find(b => b.dataset.action === 'couple');
            if (couple) couple.hidden = !session.player?.spec?.tags?.includes('tractor-unit');
        },
    };
}
