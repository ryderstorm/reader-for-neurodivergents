/**
 * Read Aloud — wiring.
 *
 * Loads a Markdown file, builds the word-span document, and connects the
 * player, the transport bar and the settings panel to each other.
 */

import { Api } from './api.js';
import { buildDocument, estimateDuration } from './document.js';
import { Player } from './player.js';
import { load as loadSettings, save as saveSettings, apply as applySettings } from './settings.js';
import { Ui, applyBionic, keepInView, moveRuler } from './ui.js';
import {
  registerServiceWorker, setupInstall, setupMediaSession, createWakeLock,
  receiveIncoming, isStandalone,
} from './platform.js';

const $ = (id) => document.getElementById(id);

const api = new Api('');
const settings = loadSettings();
applySettings(settings);

const player = new Player(api);
const ui = new Ui(settings);
const wakeLock = createWakeLock();
const media = setupMediaSession(player);

let doc = null;          // { root, blocks }
let source = '';         // raw markdown, kept so we can rebuild on setting change
let docTitle = 'Read Aloud';
let activeBlock = -1;
let totalWords = 0;
let wordsBefore = [];    // cumulative word count per block, for the progress bar

// --------------------------------------------------------------- server link

async function connect() {
  const status = $('status');
  try {
    const h = await api.health();
    status.dataset.kind = 'ok';
    status.textContent = h.loaded
      ? `Kokoro‑82M · ${h.device.toUpperCase()}`
      : `Kokoro‑82M · loading on ${h.device.toUpperCase()}…`;
    $('engine-info').textContent =
      `Voice engine: Kokoro‑82M (Apache‑2.0), running locally on ${h.device.toUpperCase()}. ` +
      `No text or audio leaves this machine.`;
    if (!h.loaded) setTimeout(connect, 2500);
  } catch {
    status.dataset.kind = 'error';
    status.textContent = 'Server not reachable — is it running?';
    toast('Cannot reach the local TTS server. Start it with ./scripts-tools/run.sh');
  }
}

async function loadVoices() {
  try {
    const { languages, voices } = await api.voices();
    const langSel = $('lang');
    langSel.innerHTML = '';
    for (const [code, label] of Object.entries(languages)) {
      if (!voices[code] || !voices[code].length) continue;
      langSel.add(new Option(label, code));
    }
    langSel.value = voices[settings.lang] ? settings.lang : langSel.options[0].value;

    const fillVoices = () => {
      const sel = $('voice');
      sel.innerHTML = '';
      for (const v of voices[langSel.value] || []) sel.add(new Option(prettyVoice(v), v));
      sel.value = (voices[langSel.value] || []).includes(settings.voice)
        ? settings.voice : sel.options[0].value;
      settings.voice = sel.value;
      settings.lang = langSel.value;
      saveSettings(settings);
      player.setVoice(settings.voice, settings.lang);
      showLangNote(settings.lang);
    };
    langSel.addEventListener('change', fillVoices);
    $('voice').addEventListener('change', (e) => {
      settings.voice = e.target.value;
      saveSettings(settings);
      player.setVoice(settings.voice, settings.lang);
    });
    fillVoices();
  } catch {
    toast('Could not list voices; using the default.');
  }
}

/**
 * Kokoro only reports per-token timings through its English front-end. Other
 * languages still highlight, but the timings are spread across the sentence in
 * proportion to word length rather than measured. Say so instead of letting it
 * look like a bug.
 */
function showLangNote(lang) {
  const el = $('lang-note');
  const native = lang === 'a' || lang === 'b';
  el.hidden = native;
  el.textContent = native ? '' :
    'In this language the highlight is estimated rather than measured, so it ' +
    'can drift slightly within a long sentence. English is exact.';
}

/** af_heart -> "Heart (US female)" */
function prettyVoice(id) {
  const [prefix, ...rest] = id.split('_');
  const name = rest.join(' ').replace(/^\w/, (c) => c.toUpperCase());
  const region = { a: 'US', b: 'UK', e: 'ES', f: 'FR', h: 'HI', i: 'IT', p: 'PT' }[prefix[0]] || '';
  const gender = prefix[1] === 'f' ? 'female' : prefix[1] === 'm' ? 'male' : '';
  return `${name} (${[region, gender].filter(Boolean).join(' ')})`;
}

// ------------------------------------------------------------ document load

function render(markdown) {
  source = markdown;
  doc = buildDocument(markdown, { skipCode: settings.skipCode });

  const host = $('doc');
  host.replaceChildren(doc.root);
  applyBionic(doc.root, settings.bionic);

  doc.root.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (w) player.jumpToWord(w);
  });

  totalWords = 0;
  wordsBefore = doc.blocks.map((b) => {
    const n = totalWords;
    totalWords += b.words.length;
    return n;
  });

  player.setBlocks(doc.blocks);
  player.setVoice(settings.voice, settings.lang);
  player.setRate(settings.rate);

  // First heading, or first few words, becomes the lock-screen album title.
  const heading = doc.root.querySelector('h1, h2');
  docTitle = (heading ? heading.textContent : markdown).trim().slice(0, 60) || 'Read Aloud';
  media.setDocumentTitle(docTitle);

  $('dropzone').hidden = true;
  $('reader').hidden = false;
  $('transport').hidden = false;
  document.body.classList.remove('no-doc');
  activeBlock = -1;
  markBlock(0);
  updateCounter(0);
  $('progress-bar').style.width = '0%';
  window.scrollTo({ top: 0 });
  $('doc').focus();

  const mins = Math.round(estimateDuration(doc.blocks) / 60);
  toast(`${doc.blocks.length} sentences · ${totalWords} words · about ${mins} min at 1×`);
}

async function openFile(file) {
  if (!file) return;
  try {
    render(await file.text());
  } catch (err) {
    toast(`Could not read that file: ${err.message}`);
  }
}

// ----------------------------------------------------------------- reactions

player.addEventListener('blockchange', (e) => markBlock(e.detail.index));
player.addEventListener('state', (e) => {
  const playing = e.detail.playing;
  const btn = $('play-btn');
  btn.textContent = playing ? '❚❚' : '▶';
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (doc) doc.root.classList.toggle('is-reading', playing);

  media.setPlaybackState(playing ? 'playing' : 'paused');
  // Only hold the screen awake while actually reading.
  if (playing && settings.keepAwake) wakeLock.enable();
  else wakeLock.disable();
});
player.addEventListener('buffering', (e) => {
  if (!e.detail.buffering) return;
  const s = $('status');
  if (s.dataset.kind !== 'error') s.textContent = 'Synthesising…';
  setTimeout(() => { if (s.textContent === 'Synthesising…') connect(); }, 400);
});
let lastWordEl = null;
player.addEventListener('word', (e) => {
  lastWordEl = e.detail.el;
  keepInView(lastWordEl, settings.autoScroll);
  if (settings.ruler) moveRuler($('ruler'), lastWordEl);
});
player.addEventListener('progress', (e) => {
  const { index, time, duration } = e.detail;
  const done = wordsBefore[index] + (duration ? (time / duration) * doc.blocks[index].words.length : 0);
  $('progress-bar').style.width = `${Math.min(100, (done / totalWords) * 100).toFixed(2)}%`;
  updateCounter(index);
  media.setPosition(duration, time, settings.rate);
});
player.addEventListener('finished', () => {
  $('progress-bar').style.width = '100%';
  toast('Finished reading.');
});
player.addEventListener('error', (e) => toast(e.detail.message));
player.addEventListener('needgesture', () =>
  toast('Your browser blocked autoplay — press play once to allow it.'));

function markBlock(index) {
  if (!doc || index === activeBlock) return;
  const prev = doc.blocks[activeBlock];
  if (prev) {
    prev.el.classList.remove('block-active');
    prev.words.forEach((w) => w.el.classList.remove('sentence-active'));
  }
  const next = doc.blocks[index];
  if (next) {
    next.el.classList.add('block-active');
    next.words.forEach((w) => w.el.classList.add('sentence-active'));
    if (!player.playing) keepInView(next.words[0].el, settings.autoScroll);
  }
  activeBlock = index;
  updateCounter(index);
  if (next) {
    media.update({ index, total: doc.blocks.length, text: next.text });
  }
}

function updateCounter(index) {
  if (!doc) return;
  const left = (totalWords - wordsBefore[index]) / (165 * settings.rate) * 60;
  $('counter').textContent =
    `sentence ${index + 1} / ${doc.blocks.length} · ${fmtTime(left)} left`;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  return m >= 60
    ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
    : `${m}:${String(sec % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ controls

$('play-btn').addEventListener('click', () => player.toggle());
$('next-btn').addEventListener('click', () => player.next());
$('prev-btn').addEventListener('click', () => player.prev());
$('repeat-btn').addEventListener('click', () => player.jumpTo(player.index, true));
$('focus-btn').addEventListener('click', () => cycleFocus());

$('rate').addEventListener('input', (e) => setRate(parseFloat(e.target.value)));
$('slower-btn').addEventListener('click', () => setRate(settings.rate - 0.1));
$('faster-btn').addEventListener('click', () => setRate(settings.rate + 0.1));

/* Scrubbing the progress bar jumps to the sentence at that position. The bar
   is 14 px tall on touch specifically so this is hittable with a thumb. */
const track = $('progress-track');
const seekTo = (clientX) => {
  if (!doc || !totalWords) return;
  const r = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  const targetWord = ratio * totalWords;
  let index = wordsBefore.findIndex((w, i) => targetWord < w + doc.blocks[i].words.length);
  if (index < 0) index = doc.blocks.length - 1;
  player.jumpTo(index, player.playing);
};
track.addEventListener('pointerdown', (e) => {
  track.setPointerCapture(e.pointerId);
  seekTo(e.clientX);
});
track.addEventListener('pointermove', (e) => {
  if (track.hasPointerCapture(e.pointerId)) seekTo(e.clientX);
});

function setRate(rate) {
  rate = Math.max(0.5, Math.min(3, Math.round(rate * 100) / 100));
  settings.rate = rate;
  saveSettings(settings);
  player.setRate(rate);
  $('rate').value = rate;
  $('rate-out').textContent = `${rate.toFixed(2)}×`;
  if (doc) updateCounter(player.index);
}

function cycleFocus() {
  const order = ['off', 'sentence', 'paragraph'];
  const next = order[(order.indexOf(settings.focus) + 1) % order.length];
  ui.set('focus', next);
  ui.sync();
  $('focus-btn').setAttribute('aria-pressed', String(next !== 'off'));
  toast(`Focus mask: ${next}`);
}

ui.addEventListener('action', (e) => {
  const { action, delta } = e.detail;
  if (!doc && action !== 'escape') return;
  switch (action) {
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'prev': player.prev(); break;
    case 'repeat': player.jumpTo(player.index, true); break;
    case 'rate': setRate(settings.rate + delta); toast(`${settings.rate.toFixed(2)}×`); break;
    case 'focus-cycle': cycleFocus(); break;
    case 'escape':
      if (!$('panel').hidden) { $('panel').hidden = true; $('settings-btn').focus(); }
      else player.pause();
      break;
    default: break;
  }
});

ui.addEventListener('change', (e) => {
  const key = e.detail.key;
  if (key === 'bionic' || key === '*') applyBionic(doc ? doc.root : document.createElement('div'), settings.bionic);
  if (key === 'skipCode' && source) {
    const at = player.index;
    render(source);
    player.jumpTo(Math.min(at, doc.blocks.length - 1), false);
  }
  if (key === 'ruler' && !settings.ruler) $('ruler').style.height = '0px';
  if (key === 'keepAwake' || key === '*') {
    if (settings.keepAwake && player.playing) wakeLock.enable();
    else wakeLock.disable();
  }
  if (key === '*') { setRate(settings.rate); if (source) render(source); }
});

// -------------------------------------------------------------- file loading

$('file').addEventListener('change', (e) => openFile(e.target.files[0]));
$('open-btn').addEventListener('click', () => $('file').click());

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === 'dragleave' && e.relatedTarget) return;
    document.body.classList.remove('dragging');
  });
}
document.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (file) openFile(file);
});

$('paste-btn').addEventListener('click', () => {
  $('paste-dialog').showModal();
  $('paste-text').focus();
});
$('paste-dialog').addEventListener('close', () => {
  const dlg = $('paste-dialog');
  if (dlg.returnValue === 'ok') {
    const text = $('paste-text').value.trim();
    if (text) render(text);
  }
});

$('sample-btn').addEventListener('click', async () => {
  try {
    const r = await fetch('/samples/welcome.md');
    if (!r.ok) throw new Error(String(r.status));
    render(await r.text());
  } catch {
    toast('Sample document not found.');
  }
});

// -------------------------------------------------------------------- toasts

let toastTimer = null;
/** `action` adds a button; the toast then stays until it is used or dismissed. */
function toast(message, action) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.hidden = true; action.run(); });
    el.appendChild(b);
    return;
  }
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

// ----------------------------------------------------------------- start-up

$('focus-btn').setAttribute('aria-pressed', String(settings.focus !== 'off'));
document.body.classList.add('no-doc');
setRate(settings.rate);
connect();
loadVoices();

/* ---------------------------------------------------------------- as an app */

// Hide the wake-lock setting where the API does not exist (notably iOS < 16.4).
if (!wakeLock.supported) $('wakeLock-row').hidden = true;

registerServiceWorker({
  onUpdate: (apply) => toast('A new version is ready.',
    { label: 'Reload', run: apply }),
  onUnavailable: (reason) => {
    // Installing and offline use need a secure context. Over plain http on a
    // LAN address the browser refuses, and saying so beats silent absence.
    if (reason !== 'insecure') return;
    const note = $('pwa-note');
    note.hidden = false;
    note.textContent =
      'Opening this over http://, so it cannot be installed or work offline. '
      + 'Serve it over https (see the README) to install it on a phone. '
      + 'Reading works either way.';
  },
});

setupInstall($('install-btn'), { onInstructions: (text) => toast(text) });

receiveIncoming({
  onText: (text) => render(text),
  onFile: (file) => openFile(file),
  onPaste: () => { $('paste-dialog').showModal(); $('paste-text').focus(); },
});

if (isStandalone()) document.documentElement.dataset.standalone = 'on';

// The ruler is positioned from viewport coordinates, so it has to be redrawn
// when the phone rotates or the browser chrome collapses.
window.addEventListener('orientationchange', () => {
  setTimeout(() => { if (settings.ruler && lastWordEl) moveRuler($('ruler'), lastWordEl); }, 250);
});

// Reposition the ruler when the layout moves under it.
const followRuler = () => {
  if (settings.ruler && lastWordEl) moveRuler($('ruler'), lastWordEl);
};
window.addEventListener('resize', followRuler);
window.addEventListener('scroll', followRuler, { passive: true });
