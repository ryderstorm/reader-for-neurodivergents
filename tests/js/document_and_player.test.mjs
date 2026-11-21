import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:8765' });
dom.window.matchMedia = () => ({ matches: false });
for (const k of [
  'window',
  'document',
  'Node',
  'NodeFilter',
  'DocumentFragment',
  'Element',
  'localStorage',
]) {
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];
}
globalThis.marked = require(join(ROOT, 'web/vendor/marked.min.js'));
const createDOMPurify = require(join(ROOT, 'web/vendor/purify.min.js'));
globalThis.DOMPurify = createDOMPurify(dom.window);

import { Api } from '../../web/js/api.js';
import { buildDocument, splitSentences } from '../../web/js/document.js';
import { isIOS, isStandalone } from '../../web/js/platform.js';
import { mapTimings } from '../../web/js/player.js';
import { DEFAULTS, apply, load, save } from '../../web/js/settings.js';

test('splitSentences breaks long runs, preserves abbreviations, and tiles input exactly', () => {
  const cases = [
    ['One. Two. Three.', 3],
    ['Costs 3.5 kg and no more.', 1],
    ['Dr. Wilson arrived. He left.', 2],
    ['Wait... really? Yes!', 2],
    ['J. R. R. Tolkien wrote it.', 1],
    ['No terminal punctuation here', 1],
  ];
  for (const [text, expected] of cases) {
    assert.equal(splitSentences(text).length, expected, `unexpected split for ${text}`);
  }

  const longRun = 'word '.repeat(400).trim();
  const parts = splitSentences(longRun);
  assert.ok(parts.length > 1, 'long run should be subdivided');
  assert.ok(
    parts.every(([a, b]) => b - a <= 420),
    'each chunk must stay within the 420-char cap',
  );
  assert.equal(parts[0][0], 0);
  assert.equal(parts[parts.length - 1][1], longRun.length);
  assert.ok(parts.every(([a], i) => i === 0 || a === parts[i - 1][1]));

  const clauses = 'a clause here, '.repeat(60).trim();
  assert.ok(splitSentences(clauses).every(([a, b]) => b - a <= 420));
});

test('buildDocument skips code blocks, keeps tables readable, and aligns every word span', () => {
  const md = readFileSync(join(ROOT, 'samples/welcome.md'), 'utf8');
  const doc = buildDocument(md, { skipCode: true });

  assert.ok(doc.blocks.length > 20);
  assert.ok(doc.blocks.every((b) => b.words.length > 0));
  assert.equal(doc.root.querySelectorAll('pre .w').length, 0);
  assert.ok(doc.root.querySelectorAll('table .w').length > 0);

  const seen = new Set();
  for (const b of doc.blocks) {
    for (const w of b.words) {
      assert.ok(!seen.has(w.el), 'word span must belong to only one block');
      seen.add(w.el);
      assert.equal(b.text.slice(w.cs, w.ce), w.el.textContent);
    }
  }
});

test('buildDocument preserves accented Latin words and Devanagari combining marks', () => {
  const es = buildDocument('El niño leyó «Cien años de soledad» — muy despacio.\n');
  const words = [...es.root.querySelectorAll('.w')].map((w) => w.textContent);
  assert.ok(words.includes('niño'));
  assert.ok(words.includes('leyó'));
  assert.ok(words.includes('años'));
  assert.ok(!words.includes('«'));

  const hi = buildDocument('मुझे यह पसंद है।\n');
  const hiWords = [...hi.root.querySelectorAll('.w')].map((w) => w.textContent);
  assert.equal(hiWords.length, 4);
});

test('mapTimings sweeps every word span once in reading order', () => {
  const md = readFileSync(join(ROOT, 'samples/welcome.md'), 'utf8');
  const doc = buildDocument(md, { skipCode: true });
  const block = doc.blocks.find((b) => b.words.length >= 8);
  assert.ok(block);

  const duration = block.words.length * 0.4;
  const fakeTimings = block.words.map((w, i) => ({
    cs: w.cs,
    ce: w.ce,
    s: i * 0.4,
    e: i * 0.4 + 0.34,
  }));
  const timeline = mapTimings(block, fakeTimings);
  assert.equal(timeline.length, block.words.length);

  const visited = [];
  for (let t = 0; t <= duration; t += 0.02) {
    let hit = null;
    for (let i = 0; i < timeline.length; i++) {
      if (t >= timeline[i].s && t < timeline[i].e) {
        hit = timeline[i];
        break;
      }
      if (timeline[i].s > t) break;
    }
    if (hit && visited[visited.length - 1] !== hit.el) visited.push(hit.el);
  }
  assert.deepEqual(
    visited,
    block.words.map((w) => w.el),
  );
});

test('settings load, save, and apply CSS custom properties and data attributes', () => {
  localStorage.clear();
  assert.deepEqual(load(), DEFAULTS);

  const custom = { ...DEFAULTS, theme: 'night', fontSize: 26, ruler: true, bionic: true };
  save(custom);
  assert.deepEqual(load(), custom);

  apply(custom, document.documentElement);
  assert.equal(document.documentElement.dataset.theme, 'night');
  assert.equal(document.documentElement.dataset.ruler, 'on');
  assert.equal(document.documentElement.dataset.bionic, 'on');
  assert.equal(document.documentElement.style.getPropertyValue('--font-size'), '26px');
});

test('Api client handles health, voices, speak, and HTTP error payloads', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      if (String(url).endsWith('/api/health')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (String(url).endsWith('/api/voices')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ languages: { a: 'EN' }, voices: {} }),
        };
      }
      if (String(url).endsWith('/api/speak') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        if (body.text === 'fail') {
          return { ok: false, status: 500, json: async () => ({ detail: 'engine error' }) };
        }
        return { ok: true, status: 200, json: async () => ({ duration: 1.0, words: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const api = new Api('http://127.0.0.1:8765');
    assert.deepEqual(await api.health(), { ok: true });
    assert.deepEqual((await api.voices()).languages, { a: 'EN' });
    assert.equal((await api.speak('Hello', 'af_heart', 'a', 1.0)).duration, 1.0);
    await assert.rejects(() => api.speak('fail', 'af_heart', 'a', 1.0), /engine error/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('PWA manifest, service worker precache list, and HTML DOM contract stay valid', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'web/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(ROOT, 'web', icon.src)), `missing icon ${icon.src}`);
  }

  const sw = readFileSync(join(ROOT, 'web/sw.js'), 'utf8');
  const precacheBlock = sw.slice(
    sw.indexOf('const PRECACHE'),
    sw.indexOf('];', sw.indexOf('const PRECACHE')),
  );
  const urls = [...precacheBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(urls.length > 10);
  for (const u of urls) {
    if (u === '/') continue;
    assert.ok(
      existsSync(join(ROOT, 'web', u)) || existsSync(join(ROOT, u.replace(/^\//, ''))),
      `missing precached file ${u}`,
    );
  }
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);

  const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
  const present = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const f of ['app.js', 'ui.js', 'settings.js', 'player.js', 'platform.js']) {
    const src = readFileSync(join(ROOT, 'web/js', f), 'utf8');
    for (const m of src.matchAll(/\$\('([a-zA-Z][\w-]*)'\)/g)) {
      assert.ok(present.has(m[1]), `missing DOM id ${m[1]} referenced by ${f}`);
    }
  }

  assert.equal(typeof isIOS(), 'boolean');
  assert.equal(typeof isStandalone(), 'boolean');
});
