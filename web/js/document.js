/**
 * Markdown -> readable document model.
 *
 * Renders Markdown to HTML, then walks the result and rebuilds every text node
 * out of per-word <span> elements. Those spans are what we highlight later, so
 * the split done here has to agree, character for character, with the split the
 * server does before it hands back timings.
 */

// Same definition of "a word" as server/tts.py: WORD_RE. Note that JS \w is
// ASCII-only even with the /u flag, so the classes are spelled out to keep
// "café" and "मुझे" whole the way the Python side does.
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:['’\-.,][\p{L}\p{N}\p{M}]+)*/gu;

// Block-level tags that become their own readable unit.
const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
  'TD', 'TH', 'DT', 'DD', 'FIGCAPTION',
]);

// Abbreviations that must not end a sentence.
const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'eg', 'ie',
  'fig', 'no', 'vol', 'approx', 'inc', 'ltd', 'dept', 'est', 'al',
]);

// One synthesis unit should stay short: it is the seek granularity, the retry
// granularity, and the delay before playback can start. A sentence longer than
// this is broken at clause boundaries.
const MAX_BLOCK_CHARS = 420;

/**
 * Break an over-long span at clause punctuation, then at spaces, then — only
 * if there is nothing else — at the cap itself. Appends [start, end) pairs.
 */
function subdivide(text, from, to, out) {
  if (to - from <= MAX_BLOCK_CHARS) { out.push([from, to]); return; }

  const breaks = [];
  for (let i = from; i < to - 1; i++) {
    if (/[,;:—–]/.test(text[i]) && /\s/.test(text[i + 1])) breaks.push(i + 1);
  }
  if (!breaks.length) {
    for (let i = from; i < to - 1; i++) if (/\s/.test(text[i])) breaks.push(i + 1);
  }
  breaks.push(to);

  let start = from;
  let last = from;
  for (const b of breaks) {
    if (b - start > MAX_BLOCK_CHARS && last > start) {
      out.push([start, last]);
      start = last;
    }
    last = b;
  }
  while (to - start > MAX_BLOCK_CHARS) {   // no break points at all
    out.push([start, start + MAX_BLOCK_CHARS]);
    start += MAX_BLOCK_CHARS;
  }
  if (to > start) out.push([start, to]);
}

/**
 * Split a paragraph into sentences, returning [start, end) offsets.
 * Kept deliberately conservative: a wrong split costs a slightly long or short
 * audio chunk, never a wrong highlight, because timings are per word.
 */
export function splitSentences(text) {
  const spans = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '\n') continue;

    if (c === '.') {
      // Decimal point, ellipsis, or a known abbreviation -> not a boundary.
      const prev = text[i - 1];
      const next = text[i + 1];
      if (/\d/.test(prev || '') && /\d/.test(next || '')) continue;
      if (next === '.' || prev === '.') continue;
      const before = text.slice(Math.max(0, i - 12), i);
      const lastWord = (before.match(/[A-Za-z]+$/) || [''])[0].toLowerCase();
      if (ABBREV.has(lastWord)) continue;
      if (lastWord.length === 1) continue; // initials: "J. R. R. Tolkien"
    }

    // Absorb trailing quotes/brackets and closing punctuation.
    let end = i + 1;
    while (end < text.length && /["'”’)\]]/.test(text[end])) end++;
    // Must be followed by whitespace or end of text.
    if (end < text.length && !/\s/.test(text[end])) continue;

    if (text.slice(start, end).trim()) subdivide(text, start, end, spans);
    start = end;
  }
  if (text.slice(start).trim()) subdivide(text, start, text.length, spans);
  return spans.length ? spans : [[0, text.length]];
}

let uid = 0;

/**
 * Build the document model from Markdown source.
 * Returns { root, blocks } where each block is one synthesis unit.
 */
export function buildDocument(markdown, options = {}) {
  const { skipCode = true } = options;

  marked.setOptions({ gfm: true, breaks: false });
  const dirty = marked.parse(markdown);
  const html = DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });

  const root = document.createElement('article');
  root.className = 'doc';
  root.innerHTML = html;

  root.querySelectorAll('pre').forEach((pre) => {
    pre.dataset.readable = skipCode ? 'false' : 'true';
  });

  const blocks = [];
  uid = 0;
  walk(root, blocks, skipCode);

  blocks.forEach((b, i) => {
    b.index = i;
    b.el.dataset.block = String(i);
  });
  return { root, blocks };
}

function walk(node, blocks, skipCode) {
  for (const child of Array.from(node.children || [])) {
    const tag = child.tagName;
    if (tag === 'PRE') {
      if (!skipCode) collectBlocks(child, blocks);
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      // A <li> may contain nested lists; read the li's own text, then recurse.
      collectBlocks(child, blocks, true);
      walk(child, blocks, skipCode);
      continue;
    }
    walk(child, blocks, skipCode);
  }
}

/**
 * Turn one block element's direct text into sentence blocks of word spans.
 * `ownTextOnly` skips text that lives inside a nested block element, so a list
 * item with a sub-list is not read twice.
 */
function collectBlocks(el, blocks, ownTextOnly = false) {
  const textNodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (ownTextOnly) {
        for (let p = n.parentElement; p && p !== el; p = p.parentElement) {
          if (BLOCK_TAGS.has(p.tagName) || p.tagName === 'PRE') {
            return NodeFilter.FILTER_REJECT;
          }
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);
  if (!textNodes.length) return;

  // Flatten to one string with a map back to (node, offset).
  let flat = '';
  const pieces = [];
  for (const tn of textNodes) {
    let value = tn.nodeValue.replace(/\s+/g, ' ');
    if (flat.endsWith(' ') && value.startsWith(' ')) value = value.slice(1);
    if (!value) continue;
    pieces.push({ node: tn, at: flat.length, text: value });
    flat += value;
  }
  if (!flat.trim()) return;

  // Replace each text node with word spans, recording global word entries.
  const words = [];
  for (const piece of pieces) {
    const frag = document.createDocumentFragment();
    let last = 0;
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(piece.text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(piece.text.slice(last, m.index)));
      }
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = m[0];
      span.dataset.w = String(uid++);
      frag.appendChild(span);
      words.push({ el: span, from: piece.at + m.index, to: piece.at + m.index + m[0].length });
      last = m.index + m[0].length;
    }
    if (last < piece.text.length) {
      frag.appendChild(document.createTextNode(piece.text.slice(last)));
    }
    piece.node.parentNode.replaceChild(frag, piece.node);
  }
  if (!words.length) return;

  // Slice the block into sentences and hand each its share of the words.
  const isHeading = /^H[1-6]$/.test(el.tagName);
  for (const span of splitSentences(flat)) {
    // Tighten the bounds rather than trimming the slice: word offsets are
    // relative to `s`, so trimming afterwards would shift every one of them.
    let [s, e] = span;
    while (s < e && /\s/.test(flat[s])) s++;
    while (e > s && /\s/.test(flat[e - 1])) e--;
    const inSentence = words.filter((w) => w.from >= s && w.from < e);
    if (!inSentence.length) continue;
    const text = flat.slice(s, e);
    if (!/[^\W_]/u.test(text)) continue;
    blocks.push({
      index: -1,
      el,
      text,
      // Char offset of each word inside `text`, used to match server timings.
      words: inSentence.map((w) => ({ el: w.el, cs: w.from - s, ce: w.to - s })),
      // A heading gets a beat of silence after it, like a page turn.
      pauseAfter: isHeading ? 0.45 : 0.12,
    });
  }
}

/** Estimated reading time in seconds at 1x, for the progress readout. */
export function estimateDuration(blocks) {
  const words = blocks.reduce((n, b) => n + b.words.length, 0);
  return (words / 165) * 60; // Kokoro's default pace is ~165 wpm
}
