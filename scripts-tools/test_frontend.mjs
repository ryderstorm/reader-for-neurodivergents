/**
 * Headless end-to-end test of the reading pipeline.
 *
 * Renders the sample Markdown through the real document builder, asks the
 * running server to synthesise every block, and checks that each block's word
 * spans get monotonic, in-range timings back. This is the part that would
 * silently drift out of sync in a browser, so it is worth testing directly.
 *
 *   node scripts-tools/test_frontend.mjs [http://127.0.0.1:8765]
 *
 * Requires jsdom (`npm i jsdom@24`); NODE_PATH may point at any install.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8765';

let failures = 0;
const check = (ok, label, extra = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
};

// --- a DOM for the document builder to work in ------------------------------
const dom = new JSDOM('<!doctype html><body></body>', { url: BASE });
for (const k of ['window', 'document', 'Node', 'NodeFilter', 'DocumentFragment', 'Element']) {
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];
}
globalThis.marked = require(join(ROOT, 'web/vendor/marked.min.js'));
const createDOMPurify = require(join(ROOT, 'web/vendor/purify.min.js'));
globalThis.DOMPurify = createDOMPurify(dom.window);

const { buildDocument, splitSentences } = await import(
  `file://${join(ROOT, 'web/js/document.js')}`
);
const { mapTimings } = await import(`file://${join(ROOT, 'web/js/player.js')}`);

// --- 1. sentence splitting --------------------------------------------------
console.log('\nsentence splitting');
{
  const cases = [
    ['One. Two. Three.', 3],
    ['Costs 3.5 kg and no more.', 1],
    ['Dr. Wilson arrived. He left.', 2],
    ['Wait... really? Yes!', 2],
    ['J. R. R. Tolkien wrote it.', 1],
    ['No terminal punctuation here', 1],
  ];
  // Long unpunctuated runs must be broken up, and the pieces must tile the
  // input exactly — a gap or overlap would drop or double-read words.
  const long = 'word '.repeat(400).trim();
  const parts = splitSentences(long);
  check(parts.length > 1, 'a 2000-char run is subdivided', `${parts.length} parts`);
  check(parts.every(([a, b]) => b - a <= 420), 'no part exceeds the cap');
  check(parts[0][0] === 0 && parts[parts.length - 1][1] === long.length
        && parts.every(([a], i) => i === 0 || a === parts[i - 1][1]),
    'parts tile the input with no gap or overlap');
  const clauses = ('a clause here, ').repeat(60).trim();
  check(splitSentences(clauses).every(([a, b]) => b - a <= 420),
    'clause-separated run is broken at commas');
  for (const [text, want] of cases) {
    const got = splitSentences(text).length;
    check(got === want, JSON.stringify(text), `expected ${want}, got ${got}`);
  }
}

// --- 2. document build ------------------------------------------------------
console.log('\ndocument build');
const md = readFileSync(join(ROOT, 'samples/welcome.md'), 'utf8');
const doc = buildDocument(md, { skipCode: true });
check(doc.blocks.length > 20, 'sample splits into many blocks', `${doc.blocks.length} blocks`);
check(
  doc.blocks.every((b) => b.words.length > 0),
  'every block has at least one word span',
);
check(
  doc.root.querySelectorAll('pre .w').length === 0,
  'code blocks contain no readable word spans',
);
check(
  doc.root.querySelectorAll('table .w').length > 0,
  'table cells are readable',
);
{
  // No word span may belong to two blocks, or the highlight would flicker.
  const seen = new Set();
  let dupes = 0;
  for (const b of doc.blocks) for (const w of b.words) {
    if (seen.has(w.el)) dupes++;
    seen.add(w.el);
  }
  check(dupes === 0, 'no word span is claimed by two blocks', `${dupes} duplicates`);
}
{
  // The block text and its word spans must agree, or timings map to the
  // wrong words.
  let bad = 0;
  for (const b of doc.blocks) {
    for (const w of b.words) {
      if (b.text.slice(w.cs, w.ce) !== w.el.textContent) bad++;
    }
  }
  check(bad === 0, 'word char offsets match the block text', `${bad} mismatches`);
}

// --- 3. non-ASCII text ------------------------------------------------------
// The client and the server must agree on what a word is, or accented and
// non-Latin scripts lose their highlight.
console.log('\nnon-ASCII words');
{
  const d = buildDocument('El niño leyó «Cien años de soledad» — muy despacio.\n');
  const words = [...d.root.querySelectorAll('.w')].map((w) => w.textContent);
  check(words.includes('niño'), 'accented word stays whole', words.join(' '));
  check(words.includes('leyó'), 'accented vowel stays whole');
  check(words.includes('años'), 'tilde stays whole');
  check(!words.includes('«'), 'guillemets are not words');
  const d2 = buildDocument('मुझे यह पसंद है।\n');
  const hi = [...d2.root.querySelectorAll('.w')].map((w) => w.textContent);
  check(hi.length === 4, 'devanagari splits into words', hi.join(' '));
}

// --- 4. highlight sweep -----------------------------------------------------
// Walk a synthetic clock across a block the way player.js does and confirm the
// highlight visits every word exactly once, in reading order.
console.log('\nhighlight sweep');
{
  const block = doc.blocks.find((b) => b.words.length >= 8);
  const duration = block.words.length * 0.4;
  const fake = block.words.map((w, i) => ({
    cs: w.cs, ce: w.ce, s: i * 0.4, e: i * 0.4 + 0.34,
  }));
  const timeline = mapTimings(block, fake);
  check(timeline.length === block.words.length, 'every word gets a timing',
    `${timeline.length}/${block.words.length}`);

  const visited = [];
  for (let t = 0; t <= duration; t += 0.02) {
    let hit = null;
    for (let i = 0; i < timeline.length; i++) {
      if (t >= timeline[i].s && t < timeline[i].e) { hit = timeline[i]; break; }
      if (timeline[i].s > t) break;
    }
    if (hit && visited[visited.length - 1] !== hit.el) visited.push(hit.el);
  }
  const order = block.words.map((w) => w.el);
  check(visited.length === order.length && visited.every((el, i) => el === order[i]),
    'highlight visits each word once, in order',
    `${visited.length} of ${order.length}`);
}

// --- 5. installability (PWA) ------------------------------------------------
// A manifest that parses but points at a missing icon, or a service worker
// that precaches a renamed file, both fail silently in the browser.
console.log('\ninstallable as an app');
{
  const manifest = JSON.parse(readFileSync(join(ROOT, 'web/manifest.webmanifest'), 'utf8'));
  for (const field of ['name', 'short_name', 'start_url', 'display', 'icons',
                       'background_color', 'theme_color']) {
    check(manifest[field] !== undefined, `manifest has ${field}`);
  }
  check(manifest.display === 'standalone', 'manifest display is standalone');

  const sizes = manifest.icons.map((i) => i.sizes);
  check(sizes.includes('192x192'), 'manifest declares a 192px icon');
  check(sizes.includes('512x512'), 'manifest declares a 512px icon');
  check(manifest.icons.some((i) => (i.purpose || '').includes('maskable')),
    'manifest declares a maskable icon');

  for (const icon of manifest.icons) {
    const file = join(ROOT, 'web', icon.src);
    check(existsSync(file), `icon file exists: ${icon.src}`);
  }

  const sw = readFileSync(join(ROOT, 'web/sw.js'), 'utf8');
  const list = sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf('];', sw.indexOf('const PRECACHE')));
  const urls = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check(urls.length > 10, 'service worker precaches the shell', `${urls.length} entries`);
  const missing = urls.filter((u) => {
    if (u === '/') return false;                       // served by the app, not a file
    return !existsSync(join(ROOT, 'web', u)) && !existsSync(join(ROOT, u.replace(/^\//, '')));
  });
  check(missing.length === 0, 'every precached URL resolves to a real file',
    missing.join(', '));
  check(!sw.includes("cache.put(request, res.clone())\n        return res\n      }\n    }).catch"),
    'api responses are never cached');
  check(/pathname\.startsWith\('\/api\/'\)/.test(sw), 'service worker bypasses /api/');

  const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
  check(html.includes('rel="manifest"'), 'index.html links the manifest');
  check(html.includes('apple-touch-icon'), 'index.html has an apple-touch-icon');
  check(html.includes('viewport-fit=cover'), 'index.html opts into the safe-area insets');
  check(/theme-color/.test(html), 'index.html sets a theme colour');
}

// --- 6. the JS and the HTML agree on element ids ----------------------------
// Rewriting index.html is the easiest way to silently break a control: the
// listener is attached to null and the button simply stops working.
console.log('\nDOM contract');
{
  const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
  const present = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

  const wanted = new Map();          // id -> file that asks for it
  for (const f of ['app.js', 'ui.js', 'settings.js', 'player.js', 'platform.js']) {
    const src = readFileSync(join(ROOT, 'web/js', f), 'utf8');
    for (const m of src.matchAll(/\$\('([a-zA-Z][\w-]*)'\)/g)) wanted.set(m[1], f);
    // ui.js drives controls from these arrays rather than by literal $() calls.
    for (const listName of ['RANGES', 'CHECKS', 'SELECTS']) {
      const arr = src.match(new RegExp(`const ${listName} = \\[([^\\]]*)\\]`));
      if (!arr) continue;
      for (const m of arr[1].matchAll(/'([^']+)'/g)) wanted.set(m[1], f);
    }
  }

  const missing = [...wanted].filter(([id]) => !present.has(id) && !present.has(`${id}-out`));
  check(missing.length === 0,
    `every id the JS reaches for exists in the HTML (${wanted.size} checked)`,
    missing.map(([id, f]) => `${id} (${f})`).join(', '));

  // The range controls each need a matching <output> to show their value.
  const ui = readFileSync(join(ROOT, 'web/js/ui.js'), 'utf8');
  const ranges = [...(ui.match(/const RANGES = \[([^\]]*)\]/) || ['', ''])[1]
    .matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const noOutput = ranges.filter((r) => !present.has(`${r}-out`));
  check(noOutput.length === 0, 'every range control has its output element',
    noOutput.join(', '));
}

// --- 7. round-trip against the live server ---------------------------------
console.log(`\nsynthesis round-trip against ${BASE}`);
let health;
try {
  health = await (await fetch(`${BASE}/api/health`)).json();
} catch {
  console.log('  SKIP  server not running; start ./scripts-tools/run.sh');
  process.exit(failures ? 1 : 0);
}
console.log(`  server: ${health.model} on ${health.device}`);

const sample = doc.blocks.filter((_, i) => i % 3 === 0).slice(0, 12);
let audioTotal = 0;
let wallTotal = 0;
for (const block of sample) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: block.text, voice: 'af_heart', lang: 'a' }),
  });
  const dt = (Date.now() - t0) / 1000;
  if (!r.ok) { check(false, `block ${block.index} synthesised`, `HTTP ${r.status}`); continue; }
  const res = await r.json();
  audioTotal += res.duration;
  wallTotal += dt;

  // Map timings onto spans exactly the way player.js does.
  const mapped = block.words.map((w) => {
    const t = res.words.find((t) => t.ce > w.cs && t.cs < w.ce);
    return t ? { word: w.el.textContent, s: t.s, e: t.e } : null;
  });
  const missing = mapped.filter((m) => !m).length;
  const inRange = mapped.every((m) => !m || (m.s >= -0.01 && m.e <= res.duration + 0.06));
  let monotonic = true;
  let prev = -1;
  for (const m of mapped) { if (m) { if (m.s < prev - 0.001) monotonic = false; prev = m.s; } }

  const label = `block ${String(block.index).padStart(3)} "${block.text.slice(0, 34)}…"`;
  check(missing === 0 && inRange && monotonic, label,
    `${block.words.length}w ${res.duration.toFixed(1)}s` +
    (missing ? ` MISSING=${missing}` : '') +
    (inRange ? '' : ' OUT-OF-RANGE') + (monotonic ? '' : ' NON-MONOTONIC'));
}

console.log(`\n  ${audioTotal.toFixed(1)}s of audio in ${wallTotal.toFixed(2)}s ` +
  `= ${(audioTotal / wallTotal).toFixed(0)}x real time`);
console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
