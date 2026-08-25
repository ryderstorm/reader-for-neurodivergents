/** Thin client for the local TTS server. */
export class Api {
  constructor(base = '') {
    this.base = base;
  }

  async health() {
    const r = await fetch(`${this.base}/api/health`);
    if (!r.ok) throw new Error(`server not reachable (${r.status})`);
    return r.json();
  }

  async voices() {
    const r = await fetch(`${this.base}/api/voices`);
    if (!r.ok) throw new Error(`could not list voices (${r.status})`);
    return r.json();
  }

  async speak(text, voice, lang, speed = 1.0) {
    const r = await fetch(`${this.base}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, lang, speed }),
    });
    if (!r.ok) {
      let detail = `${r.status}`;
      try { detail = (await r.json()).detail || detail; } catch { /* ignore */ }
      throw new Error(`synthesis failed: ${detail}`);
    }
    return r.json();
  }
}
