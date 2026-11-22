/**
 * Settings panel, theme swatches, keyboard shortcuts, reading ruler.
 * Everything the reader can tune lives here; nothing in this file knows
 * about audio.
 */

import { DEFAULTS, apply, save } from './settings.js';

const THEMES = [
  ['cream', '#faf3e3', 'Warm cream'],
  ['peach', '#fdeee6', 'Soft peach'],
  ['blue', '#e8f1f8', 'Pale blue'],
  ['mint', '#e7f4ec', 'Pale mint'],
  ['grey', '#eceae7', 'Warm grey'],
  ['paper', '#f7f7f5', 'Paper white'],
  ['night', '#14171c', 'Night'],
];

const RANGES = ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'measure'];
const CHECKS = ['bionic', 'ruler', 'highlightWord', 'autoScroll', 'skipCode', 'keepAwake'];
const SELECTS = ['font', 'focus'];

const FORMAT = {
  fontSize: (v) => `${v}px`,
  lineHeight: (v) => Number(v).toFixed(2),
  letterSpacing: (v) => `${Number(v).toFixed(3)}em`,
  wordSpacing: (v) => `${Number(v).toFixed(2)}em`,
  measure: (v) => `${v} chars`,
};

export class Ui extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.$ = (id) => document.getElementById(id);
    this._buildThemes();
    this._bindPanel();
    this._bindKeys();
    this.sync();
  }

  set(key, value) {
    this.settings[key] = value;
    apply(this.settings);
    save(this.settings);
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
  }

  /** Reflect current settings back into every control. */
  sync() {
    const s = this.settings;
    for (const id of RANGES) {
      const el = this.$(id);
      if (el) el.value = s[id];
      const out = this.$(`${id}-out`);
      if (out) out.textContent = (FORMAT[id] || String)(s[id]);
    }
    for (const id of CHECKS) {
      const el = this.$(id);
      if (el) el.checked = !!s[id];
    }
    for (const id of SELECTS) {
      const el = this.$(id);
      if (el) el.value = s[id];
    }
    for (const sw of this.$('themes').children) {
      sw.setAttribute('aria-checked', String(sw.dataset.theme === s.theme));
    }
    this.$('rate').value = s.rate;
    this.$('rate-out').textContent = `${Number(s.rate).toFixed(2)}×`;
    apply(s);
  }

  _buildThemes() {
    const host = this.$('themes');
    host.innerHTML = '';
    for (const [id, colour, label] of THEMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.theme = id;
      b.style.background = colour;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('click', () => {
        this.set('theme', id);
        this.sync();
      });
      host.appendChild(b);
    }
  }

  _bindPanel() {
    const panel = this.$('panel');
    const scrim = this.$('scrim');
    const open = (yes) => {
      panel.hidden = !yes;
      if (scrim) scrim.hidden = !yes;
      this.$('settings-btn').setAttribute('aria-expanded', String(yes));
      // Behind a bottom sheet the page must not scroll under the thumb.
      document.body.classList.toggle('sheet-open', yes);
      if (yes) panel.querySelector('select, input, button').focus();
    };
    this.openPanel = open;
    this.$('settings-btn').addEventListener('click', () => open(panel.hidden));
    this.$('panel-close').addEventListener('click', () => {
      open(false);
      this.$('settings-btn').focus();
    });
    if (scrim) scrim.addEventListener('click', () => open(false));

    for (const id of RANGES) {
      this.$(id).addEventListener('input', (e) => {
        const v =
          id === 'fontSize' || id === 'measure'
            ? parseInt(e.target.value, 10)
            : parseFloat(e.target.value);
        this.set(id, v);
        this.$(`${id}-out`).textContent = (FORMAT[id] || String)(v);
      });
    }
    for (const id of CHECKS) {
      this.$(id).addEventListener('change', (e) => this.set(id, e.target.checked));
    }
    for (const id of SELECTS) {
      this.$(id).addEventListener('change', (e) => this.set(id, e.target.value));
    }

    this.$('reset-btn').addEventListener('click', () => {
      Object.assign(this.settings, DEFAULTS);
      save(this.settings);
      this.sync();
      this.dispatchEvent(new CustomEvent('change', { detail: { key: '*', value: null } }));
    });
  }

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      const fire = (action, detail = {}) => {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('action', { detail: { action, ...detail } }));
      };

      switch (e.key) {
        case ' ':
          fire('toggle');
          break;
        case 'ArrowRight':
          fire('next');
          break;
        case 'ArrowLeft':
          fire('prev');
          break;
        case 'ArrowUp':
          fire('rate', { delta: +0.1 });
          break;
        case 'ArrowDown':
          fire('rate', { delta: -0.1 });
          break;
        case 'r':
        case 'R':
          fire('repeat');
          break;
        case 'f':
        case 'F':
          fire('focus-cycle');
          break;
        case 'Escape':
          fire('escape');
          break;
        default:
          break;
      }
    });
  }
}

/**
 * Rewrite each word span as <b class="bio">stem</b>rest.
 * The fixation-point rule is the one bionic-reading uses: roughly the first
 * 40% of the word, minimum one letter, maximum four.
 */
export function applyBionic(root, on) {
  for (const w of root.querySelectorAll('.w')) {
    const text = w.dataset.text || w.textContent;
    if (!w.dataset.text) w.dataset.text = text;
    if (!on) {
      if (w.firstElementChild) w.textContent = text;
      continue;
    }
    if (w.firstElementChild) continue; // already split
    const n = Math.min(4, Math.max(1, Math.round(text.length * 0.4)));
    w.textContent = '';
    const b = document.createElement('b');
    b.className = 'bio';
    b.textContent = text.slice(0, n);
    w.append(b, document.createTextNode(text.slice(n)));
  }
}

/** Keep the spoken line comfortably in view without yanking the page around. */
export function keepInView(el, enabled) {
  if (!enabled || !el) return;
  const r = el.getBoundingClientRect();
  const top = window.innerHeight * 0.25;
  const bottom = window.innerHeight * 0.62;
  if (r.top >= top && r.bottom <= bottom) return;
  const target = window.scrollY + r.top - window.innerHeight * 0.38;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
}

/** Park the reading ruler under the line containing `el`. */
export function moveRuler(rulerEl, el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  rulerEl.style.top = `${r.bottom}px`;
  rulerEl.style.height = `${Math.max(10, r.height * 0.55)}px`;
}
