/**
 * Playback engine: fetches audio block by block, plays it, and drives the
 * word highlight from the audio clock.
 *
 * Two things matter here for the reading experience:
 *  - The next block is synthesised while the current one plays, so there is
 *    no gap between sentences to lose your place in.
 *  - Highlighting is driven by `audio.currentTime`, which is media time, so
 *    the word timings stay correct at any playback rate without rescaling.
 */

const PREFETCH_AHEAD = 3;

// 50 ms of silence. Playing this synchronously inside the first click marks
// the <audio> element as user-activated, which Safari requires before it will
// honour any later programmatic play() that happens after an await.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

/** Keep the pitch steady when the rate changes; the property is still
 *  prefixed on older WebKit and Gecko. */
function keepPitch(audio) {
  audio.preservesPitch = true;
  audio.webkitPreservesPitch = true;
  audio.mozPreservesPitch = true;
}

export class Player extends EventTarget {
  constructor(api) {
    super();
    this.api = api;
    this.blocks = [];
    this.cache = new Map();   // block index -> Promise<{url, words, duration}>
    this.index = 0;
    this.playing = false;
    this.rate = 1.0;
    this.voice = 'af_heart';
    this.lang = 'a';
    this.gapTimer = null;
    this.generation = 0;      // bumped on every seek, to drop stale callbacks

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this._onBlockEnd());
    this.audio.addEventListener('error', () => {
      if (this.audio.src) this._fail(`audio playback error on block ${this.index}`);
    });

    this._tick = this._tick.bind(this);
    this._raf = null;
    this._lastWord = null;
    this._unlocked = false;
  }

  setBlocks(blocks) {
    this.stop();
    this.blocks = blocks;
    this.cache.clear();
    this.index = 0;
    this._emit('blockchange', { index: 0 });
  }

  setRate(rate) {
    this.rate = rate;
    this.audio.playbackRate = rate;
    // Without this, faster reading sounds shrill.
    keepPitch(this.audio);
    this._emit('rate', { rate });
  }

  /** Changing voice or language invalidates everything already synthesised. */
  setVoice(voice, lang) {
    const changed = voice !== this.voice || lang !== this.lang;
    this.voice = voice;
    this.lang = lang;
    if (changed) {
      const wasPlaying = this.playing;
      const at = this.index;
      this._revokeAll();
      this.cache.clear();
      if (wasPlaying) this.jumpTo(at, true);
    }
  }

  // ------------------------------------------------------------------ transport

  async play() {
    if (!this.blocks.length) return;
    this._unlock();          // must happen before the first await
    this.playing = true;
    this._emit('state', { playing: true });
    await this._playBlock(this.index);
  }

  pause() {
    this.playing = false;
    clearTimeout(this.gapTimer);
    this.audio.pause();
    this._stopTicking();
    this._emit('state', { playing: false });
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  stop() {
    this.playing = false;
    this.generation++;
    clearTimeout(this.gapTimer);
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this._stopTicking();
    this._clearHighlight();
    this._emit('state', { playing: false });
  }

  /** Jump to a block. `resume` keeps playing if we were playing. */
  jumpTo(index, resume = this.playing) {
    index = Math.max(0, Math.min(this.blocks.length - 1, index));
    this.generation++;
    clearTimeout(this.gapTimer);
    this.audio.pause();
    this._stopTicking();
    this.index = index;
    this._clearHighlight();
    this._emit('blockchange', { index });
    if (resume) {
      this.playing = true;
      this._emit('state', { playing: true });
      this._playBlock(index);
    }
  }

  next() { this.jumpTo(this.index + 1); }
  prev() { this.jumpTo(this.index - 1); }

  /** Start reading from the block containing a given word element. */
  jumpToWord(wordEl) {
    const idx = this.blocks.findIndex((b) => b.words.some((w) => w.el === wordEl));
    if (idx >= 0) this.jumpTo(idx, true);
  }

  // -------------------------------------------------------------------- engine

  async _playBlock(index) {
    const gen = this.generation;
    const block = this.blocks[index];
    if (!block) { this._finish(); return; }

    this._emit('buffering', { buffering: true, index });
    let data;
    try {
      data = await this._fetch(index);
    } catch (err) {
      if (gen !== this.generation) return;
      this._fail(err.message || String(err));
      return;
    }
    if (gen !== this.generation || !this.playing) {
      this._emit('buffering', { buffering: false, index });
      return;
    }
    this._emit('buffering', { buffering: false, index });

    // A voice change clears the cache, but a request already in flight can
    // still land here; drop it rather than speaking in the old voice.
    if (data.key !== `${this.voice}|${this.lang}`) { this._playBlock(index); return; }

    this.current = data;
    this.audio.src = data.url;
    this.audio.playbackRate = this.rate;
    keepPitch(this.audio);
    this._emit('blockchange', { index });

    try {
      await this.audio.play();
    } catch (err) {
      // Autoplay policy: needs a user gesture. Surface it rather than hanging.
      if (gen !== this.generation) return;
      this.playing = false;
      this._emit('state', { playing: false });
      this._emit('needgesture', {});
      return;
    }
    this._startTicking();
    this._prefetch(index + 1);
  }

  /** Called synchronously from within a user gesture; see SILENT_WAV. */
  _unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    this.audio.src = SILENT_WAV;
    const p = this.audio.play();
    if (p && p.catch) {
      p.then(() => this.audio.pause(), () => { this._unlocked = false; });
    }
  }

  _onBlockEnd() {
    if (!this.playing) return;
    this._stopTicking();
    const block = this.blocks[this.index];
    const gap = ((block && block.pauseAfter) || 0) * 1000 / this.rate;
    const gen = this.generation;
    this.gapTimer = setTimeout(() => {
      if (gen !== this.generation || !this.playing) return;
      if (this.index + 1 >= this.blocks.length) { this._finish(); return; }
      this.index += 1;
      this._playBlock(this.index);
    }, gap);
  }

  _finish() {
    this.playing = false;
    this._clearHighlight();
    this._emit('state', { playing: false });
    this._emit('finished', {});
  }

  _fail(message) {
    this.playing = false;
    this._stopTicking();
    this._emit('state', { playing: false });
    this._emit('error', { message });
  }

  // ------------------------------------------------------------------ fetching

  _fetch(index) {
    const block = this.blocks[index];
    if (!block) return Promise.reject(new Error('no such block'));
    if (this.cache.has(index)) return this.cache.get(index);

    const key = `${this.voice}|${this.lang}`;
    const promise = this.api
      .speak(block.text, this.voice, this.lang)
      .then((res) => {
        const bytes = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        return {
          url,
          key,
          duration: res.duration,
          // Attach each timing to the word span it covers, by char range.
          timeline: mapTimings(block, res.words),
        };
      })
      .catch((err) => {
        this.cache.delete(index);
        throw err;
      });

    this.cache.set(index, promise);
    this._trimCache();
    return promise;
  }

  _prefetch(from) {
    for (let i = from; i < Math.min(from + PREFETCH_AHEAD, this.blocks.length); i++) {
      this._fetch(i).catch(() => {}); // a failed prefetch retries on demand
    }
  }

  /** Keep a window of blocks around the playhead; free the rest. */
  _trimCache() {
    const keep = 24;
    if (this.cache.size <= keep) return;
    for (const idx of [...this.cache.keys()]) {
      if (this.cache.size <= keep) break;
      if (Math.abs(idx - this.index) < keep / 2) continue;
      const p = this.cache.get(idx);
      this.cache.delete(idx);
      Promise.resolve(p).then((d) => d && d.url && URL.revokeObjectURL(d.url), () => {});
    }
  }

  _revokeAll() {
    for (const p of this.cache.values()) {
      Promise.resolve(p).then((d) => d && d.url && URL.revokeObjectURL(d.url), () => {});
    }
  }

  // ---------------------------------------------------------------- highlight

  _startTicking() {
    this._stopTicking();
    this._raf = requestAnimationFrame(this._tick);
  }

  _stopTicking() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick() {
    if (!this.playing || !this.current) { this._raf = null; return; }
    const t = this.audio.currentTime;
    const tl = this.current.timeline;

    // Timeline is sorted; a short linear scan from the last hit is cheaper
    // than a binary search and handles the common forward case in O(1).
    let hit = null;
    for (let i = 0; i < tl.length; i++) {
      if (t >= tl[i].s && t < tl[i].e) { hit = tl[i]; break; }
      if (tl[i].s > t) break;
    }
    if (!hit && tl.length && t >= tl[tl.length - 1].e) hit = tl[tl.length - 1];

    if (hit && hit.el !== this._lastWord) {
      if (this._lastWord) this._lastWord.classList.remove('is-speaking');
      hit.el.classList.add('is-speaking');
      this._lastWord = hit.el;
      this._emit('word', { el: hit.el, index: this.index });
    }
    this._emit('progress', {
      index: this.index,
      time: t,
      duration: this.current.duration,
    });
    this._raf = requestAnimationFrame(this._tick);
  }

  _clearHighlight() {
    if (this._lastWord) this._lastWord.classList.remove('is-speaking');
    this._lastWord = null;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/**
 * Attach server word timings (char ranges into the block text) to the word
 * spans the renderer produced. Both sides use the same word regex, so this is
 * normally a straight zip; the char ranges make it self-correcting if the
 * server's G2P merged or split something unexpectedly.
 */
export function mapTimings(block, timings) {
  const out = [];
  for (const w of block.words) {
    let best = null;
    for (const t of timings) {
      // Any overlap between the span's char range and the timing's range.
      if (t.ce > w.cs && t.cs < w.ce) { best = t; break; }
    }
    if (best) out.push({ el: w.el, s: best.s, e: best.e });
  }
  // Fall back to positional zip if char ranges did not line up at all.
  if (!out.length && timings.length) {
    const n = Math.min(block.words.length, timings.length);
    for (let i = 0; i < n; i++) {
      out.push({ el: block.words[i].el, s: timings[i].s, e: timings[i].e });
    }
  }
  out.sort((a, b) => a.s - b.s);
  return out;
}
