import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body><button id="install" hidden></button></body>', {
  url: 'https://reader.local/?text=Hello+world&title=Greeting',
  pretendToBeVisual: true,
});
dom.window.matchMedia = () => ({ matches: false });
Object.defineProperty(dom.window, 'isSecureContext', { value: true, configurable: true });

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.src = '';
    this.preload = '';
    this.playbackRate = 1;
    this.currentTime = 0;
    this.paused = true;
    this.playShouldReject = false;
  }
  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
  load() {}
  pause() {
    this.paused = true;
  }
  play() {
    if (this.playShouldReject) return Promise.reject(new Error('autoplay blocked'));
    this.paused = false;
    return Promise.resolve();
  }
}

for (const k of ['window', 'document', 'Node', 'Element', 'history']) {
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];
}
globalThis.Audio = FakeAudio;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.URL.createObjectURL = () => 'blob:fake-wav';
globalThis.URL.revokeObjectURL = () => {};
globalThis.MediaMetadata = class MediaMetadata {
  constructor(init) {
    Object.assign(this, init);
  }
};

import {
  createWakeLock,
  receiveIncoming,
  registerServiceWorker,
  setupInstall,
  setupMediaSession,
} from '../../web/js/platform.js';
import { Player, mapTimings } from '../../web/js/player.js';

function makeBlock(text) {
  const el = document.createElement('span');
  el.textContent = text;
  return {
    text,
    pauseAfter: 0,
    words: [{ el, cs: 0, ce: text.length }],
  };
}

test('Player handles transport, rate, voice invalidation, highlighting, and errors', async () => {
  const fakeApi = {
    calls: 0,
    shouldFail: false,
    async speak(text) {
      this.calls += 1;
      if (this.shouldFail) throw new Error('server down');
      return {
        audio: Buffer.from('RIFF').toString('base64'),
        duration: 1.0,
        words: [{ cs: 0, ce: text.length, s: 0.0, e: 0.9 }],
      };
    },
  };

  const player = new Player(fakeApi);
  const events = [];
  for (const name of ['state', 'blockchange', 'word', 'progress', 'error', 'finished', 'rate']) {
    player.addEventListener(name, (e) => events.push([name, e.detail]));
  }

  const b0 = makeBlock('First');
  const b1 = makeBlock('Second');
  player.setBlocks([b0, b1]);
  player.setRate(1.5);
  assert.equal(player.rate, 1.5);

  await player.play();
  assert.equal(player.playing, true);
  assert.equal(fakeApi.calls >= 1, true);

  // Tick drives word highlight and progress event
  player.audio.currentTime = 0.2;
  player._tick();
  assert.ok(b0.words[0].el.classList.contains('is-speaking'));

  // Jump, next, prev, jumpToWord, pause, toggle
  player.next();
  assert.equal(player.index, 1);
  player.prev();
  assert.equal(player.index, 0);
  player.jumpToWord(b1.words[0].el);
  assert.equal(player.index, 1);

  player.setVoice('bm_george', 'b');
  assert.equal(player.voice, 'bm_george');

  player.pause();
  assert.equal(player.playing, false);
  player.toggle();
  assert.equal(player.playing, true);

  // Playback failure emits error state
  fakeApi.shouldFail = true;
  player.cache.clear();
  await player._playBlock(0);
  assert.ok(events.some(([name]) => name === 'error'));

  // Positional fallback in mapTimings when char ranges do not overlap
  const fallback = mapTimings(b0, [{ cs: 99, ce: 105, s: 0.1, e: 0.5 }]);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].s, 0.1);

  player.stop();
  assert.equal(player.playing, false);
});

test('platform helpers wire install button, media session, wake lock, and share params', async () => {
  const btn = document.getElementById('install');
  let instructions = '';
  setupInstall(btn, {
    onInstructions: (msg) => {
      instructions = msg;
    },
  });
  btn.click();
  assert.match(instructions, /Install app|Add to Home/i);

  const wakeLockCalls = [];
  let lastSentinel = null;
  const actions = {};
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: 'Mozilla/5.0 Linux',
      platform: 'Linux',
      maxTouchPoints: 0,
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setActionHandler(name, fn) {
          actions[name] = fn;
        },
        setPositionState(pos) {
          actions._pos = pos;
        },
      },
      wakeLock: {
        async request(type) {
          wakeLockCalls.push(type);
          lastSentinel = {
            released: false,
            addEventListener() {},
            async release() {
              this.released = true;
            },
          };
          return lastSentinel;
        },
      },
      serviceWorker: {
        controller: {},
        async register() {
          return {
            waiting: { postMessage() {} },
            addEventListener() {},
          };
        },
        addEventListener() {},
      },
    },
    configurable: true,
  });

  let updated = false;
  await registerServiceWorker({
    onUpdate: (applyUpdate) => {
      updated = true;
      applyUpdate();
    },
  });
  assert.equal(updated, true);

  const stubPlayer = { play() {}, pause() {}, next() {}, prev() {} };
  const ms = setupMediaSession(stubPlayer, { title: 'Doc' });
  ms.setDocumentTitle('My Book');
  ms.update({ index: 0, total: 3, text: 'Hello world' });
  ms.setPlaybackState('playing');
  ms.setPosition(2.0, 0.5, 1.0);
  assert.equal(typeof actions.play, 'function');
  assert.equal(actions._pos.position, 0.5);

  const wl = createWakeLock();
  assert.equal(wl.supported, true);
  await wl.enable();
  assert.deepEqual(wakeLockCalls, ['screen']);
  assert.ok(lastSentinel);
  assert.equal(lastSentinel.released, false);
  await wl.disable();
  assert.equal(lastSentinel.released, true);

  let received = '';
  receiveIncoming({
    onText: (t) => {
      received = t;
    },
  });
  assert.equal(received, '# Greeting\n\nHello world');
});
