/**
 * End-to-end test that boots the real FastAPI server with --no-warm, verifies
 * HTTP endpoints and Prometheus metrics, fetches the sample document from the
 * running server, and parses it through the real front-end document pipeline.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = process.env.E2E_PORT || '18765';
const BASE = `http://127.0.0.1:${PORT}`;
const PYTHON = existsSync(join(ROOT, '.venv/bin/python'))
  ? join(ROOT, '.venv/bin/python')
  : 'python3';

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return await res.json();
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server failed to become healthy within ${timeoutMs}ms: ${lastError}`);
}

const server = spawn(
  PYTHON,
  ['server/app.py', '--host', '127.0.0.1', '--port', PORT, '--no-warm'],
  {
    cwd: ROOT,
    env: { ...process.env, HF_HUB_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stderrLog = '';
server.stderr.on('data', (chunk) => {
  stderrLog += chunk.toString();
});

try {
  const health = await waitForHealth();
  assert.equal(health.ok, true);
  assert.equal(health.model, 'hexgrad/Kokoro-82M');
  assert.ok(health.threads >= 1);

  const metricsRes = await fetch(`${BASE}/api/metrics`);
  assert.equal(metricsRes.status, 200);
  const metricsText = await metricsRes.text();
  assert.match(metricsText, /read_aloud_speak_requests_total/);

  const voicesRes = await fetch(`${BASE}/api/voices`);
  assert.equal(voicesRes.status, 200);
  const voices = await voicesRes.json();
  assert.ok(voices.languages.a);

  const indexRes = await fetch(`${BASE}/`);
  assert.equal(indexRes.status, 200);
  assert.match(await indexRes.text(), /manifest\.webmanifest/);

  const swRes = await fetch(`${BASE}/sw.js`);
  assert.equal(swRes.status, 200);
  assert.equal(swRes.headers.get('service-worker-allowed'), '/');

  const sampleRes = await fetch(`${BASE}/samples/welcome.md`);
  assert.equal(sampleRes.status, 200);
  const sampleMd = await sampleRes.text();

  const dom = new JSDOM('<!doctype html><body></body>', { url: BASE });
  for (const k of ['window', 'document', 'Node', 'NodeFilter', 'DocumentFragment', 'Element']) {
    globalThis[k] = k === 'window' ? dom.window : dom.window[k];
  }
  globalThis.marked = require(join(ROOT, 'web/vendor/marked.min.js'));
  const createDOMPurify = require(join(ROOT, 'web/vendor/purify.min.js'));
  globalThis.DOMPurify = createDOMPurify(dom.window);

  const { buildDocument } = await import(`file://${join(ROOT, 'web/js/document.js')}`);
  const doc = buildDocument(sampleMd, { skipCode: true });
  assert.ok(doc.blocks.length > 20, 'sample document should build readable blocks');

  // Verify structured JSON logging landed on stderr
  const jsonLines = stderrLog
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('{'));
  assert.ok(jsonLines.length >= 1, 'server should emit structured JSON logs');
  const firstLog = JSON.parse(jsonLines[0]);
  assert.ok(firstLog.levelname);

  console.log(
    `E2E PASS: ${BASE} healthy, metrics exposed, ${doc.blocks.length} sample blocks built.`,
  );
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
}
