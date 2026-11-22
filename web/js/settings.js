/**
 * Reading preferences.
 *
 * Every one of these exists because it is a documented accommodation for
 * dyslexia or ADHD: adjustable type and spacing, tinted backgrounds for
 * visual stress, a narrow measure, a focus mask, and a reading ruler.
 * They persist to localStorage so the reader opens the way you left it.
 */

const KEY = 't2s.settings.v1';

export const DEFAULTS = {
  // Typography
  font: 'atkinson', // atkinson | opendyslexic | serif | sans
  fontSize: 21, // px
  lineHeight: 1.75,
  letterSpacing: 0.02, // em
  wordSpacing: 0.16, // em
  measure: 62, // characters per line
  align: 'left', // left | justify  (left is recommended for dyslexia)
  bionic: false,

  // Colour
  theme: 'cream', // cream | peach | blue | mint | grey | paper | night

  // Reading aids
  focus: 'sentence', // off | sentence | paragraph
  ruler: false,
  autoScroll: true,
  highlightWord: true,
  // Phones dim the screen after ~30s, which hides the highlight. On by
  // default; ignored where the Wake Lock API is unavailable.
  keepAwake: true,

  // Voice
  voice: 'af_heart',
  lang: 'a',
  rate: 1.0,
  skipCode: true,
};

export function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private browsing, quota - not worth failing over */
  }
}

/** Push settings onto the document as CSS custom properties + data attributes. */
export function apply(settings, root = document.documentElement) {
  const s = settings;
  root.dataset.theme = s.theme;
  root.dataset.font = s.font;
  root.dataset.focus = s.focus;
  root.dataset.align = s.align;
  root.dataset.ruler = s.ruler ? 'on' : 'off';
  root.dataset.bionic = s.bionic ? 'on' : 'off';
  root.dataset.wordHl = s.highlightWord ? 'on' : 'off';
  root.style.setProperty('--font-size', `${s.fontSize}px`);
  root.style.setProperty('--line-height', String(s.lineHeight));
  root.style.setProperty('--letter-spacing', `${s.letterSpacing}em`);
  root.style.setProperty('--word-spacing', `${s.wordSpacing}em`);
  root.style.setProperty('--measure', `${s.measure}ch`);
}
