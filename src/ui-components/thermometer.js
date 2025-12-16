/**
 * Thermometer Component - Progress/status indicator
 * Modes: progress (sequential, collapsible) | status (toggleable steps)
 */
import { $ } from "../utils/dom-helpers.js";
const instances = new Map();

const MODES = {
    progress: { hasFill: true, collapsible: true, sequential: true, tick: '✓' },
    status: { hasFill: false, collapsible: false, sequential: false }
};

class ThermoInstance {
    constructor(el) {
        this.el = el;
        this.mode = MODES[el.dataset.mode] || MODES.progress;
        this.steps = el.querySelectorAll('.thermo__step');
        this.fill = this.mode.hasFill ? el.querySelector('.thermo__fill') : null;
        this.collapsedEl = this.mode.collapsible ? el.querySelector('.thermo__collapsed') : null;
        this.completedSteps = new Set();
        this.toggleable = new Set();
        this.enabled = new Map();
        this.onToggle = null;
        this._currentStep = 1;

        this.el.addEventListener('click', e => {
            const step = e.target.closest('.thermo__step');
            if (step) {
                const key = step.dataset.key;
                if (this.toggleable.has(key)) this._toggle(key);
                else if (this.mode.sequential) this.setStep(+step.dataset.step);
            }
            if (this.mode.collapsible && e.target.closest('.thermo__collapsed')) this.expand();
        });
    }

    // Status mode: toggle on/off
    setToggleable(key, on = true) {
        this.toggleable.add(key);
        this.enabled.set(key, on);
        this._updateToggle(key);
    }

    _toggle(key) {
        const on = !this.enabled.get(key);
        this.enabled.set(key, on);
        this._updateToggle(key);
        this.onToggle?.(key, on);
    }

    _updateToggle(key) {
        const step = this.el.querySelector(`[data-key="${key}"]`);
        if (!step) return;
        const on = this.enabled.get(key);
        step.classList.toggle('thermo__step--disabled', !on);
        const bubble = step.querySelector('.thermo__bubble');
        if (bubble) bubble.innerHTML = `<span class="thermo__status">${on ? 'on' : 'off'}</span>`;
    }

    // Status mode: set step state
    setStepState(key, state) {
        const step = this.el.querySelector(`[data-key="${key}"]`);
        if (!step) return;
        ['on', 'off', 'active', 'error'].forEach(s => step.classList.remove(`thermo__step--${s}`));
        step.classList.add(`thermo__step--${state}`);
    }

    // Progress mode: navigate/complete steps
    setStep(num) {
        if (!this.mode.sequential) return;
        this._currentStep = Math.max(1, Math.min(num, this.steps.length));
        this.steps.forEach(s => {
            const n = +s.dataset.step;
            const done = n < this._currentStep || this.completedSteps.has(n);
            s.classList.toggle('thermo__step--completed', done && n !== this._currentStep);
            s.classList.toggle('thermo__step--active', n === this._currentStep);
            if (done && n !== this._currentStep) {
                const b = s.querySelector('.thermo__bubble');
                if (b && !b.textContent.includes(this.mode.tick)) b.textContent = this.mode.tick;
            }
        });
        this._updateFill();
    }

    completeAll() {
        if (!this.mode.sequential) return;
        this.steps.forEach((s, i) => {
            this.completedSteps.add(i + 1);
            s.classList.add('thermo__step--completed');
            s.classList.remove('thermo__step--active');
            const b = s.querySelector('.thermo__bubble');
            if (b) b.textContent = this.mode.tick;
        });
        this.el.classList.add('thermo--complete');
        this._updateFill();
    }

    collapse() {
        if (!this.mode.collapsible) return;
        this.el.classList.add('thermo--collapsed');
        const b = this.collapsedEl?.querySelector('.thermo__bubble');
        if (b) b.textContent = `${this.mode.tick}${this.steps.length}`;
    }

    expand() {
        if (this.mode.collapsible) this.el.classList.remove('thermo--collapsed');
    }

    reset() {
        this._currentStep = 1;
        this.completedSteps.clear();
        this.el.classList.remove('thermo--complete', 'thermo--collapsed');
        this.steps.forEach((s, i) => {
            s.className = 'thermo__step' + (this.mode.sequential && i === 0 ? ' thermo__step--active' : '');
            if (this.mode.sequential) {
                const b = s.querySelector('.thermo__bubble');
                if (b) b.textContent = i + 1;
            }
        });
        this._updateFill();
    }

    _updateFill() {
        if (this.fill) this.fill.style.width = `${(this.completedSteps.size / this.steps.length) * 100}%`;
    }
}

export const Thermometer = {
    init(id) {
        const el = $(id);
        if (!el) return null;
        if (instances.has(id)) return instances.get(id);
        const inst = new ThermoInstance(el);
        instances.set(id, inst);
        return inst;
    }
};
