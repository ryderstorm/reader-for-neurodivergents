/**
 * Everything that makes this behave like an app on a phone rather than a page:
 * service worker registration, install prompts, lock-screen transport
 * controls, keeping the screen awake while reading, and receiving shared text.
 *
 * Each capability degrades to nothing if the browser lacks it. iOS in
 * particular supports none of the install or media APIs the same way, so the
 * install path there is a short instruction rather than a button.
 */

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: minimal-ui)').matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ------------------------------------------------------------------ service worker */

/**
 * Register the service worker and report updates.
 * Requires a secure context: https, or localhost. Over plain http on a LAN
 * address the browser refuses, which is why the app tells the user so.
 */
export function registerServiceWorker({ onUpdate, onUnavailable } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  if (!window.isSecureContext) {
    if (onUnavailable) onUnavailable('insecure');
    return null;
  }

  const ready = navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then((reg) => {
      // Something is already waiting from a previous visit.
      if (reg.waiting && navigator.serviceWorker.controller && onUpdate) {
        onUpdate(() => reg.waiting.postMessage({ type: 'SKIP_WAITING' }));
      }
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // "installed" with an existing controller means an update, not a
          // first install — only then is a reload worth offering.
          if (sw.state === 'installed' && navigator.serviceWorker.controller && onUpdate) {
            onUpdate(() => sw.postMessage({ type: 'SKIP_WAITING' }));
          }
        });
      });
      return reg;
    })
    .catch((err) => {
      console.warn('[pwa] service worker registration failed', err);
      if (onUnavailable) onUnavailable('error');
      return null;
    });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  return ready;
}

/* ---------------------------------------------------------------- install prompt */

/**
 * Wires an install button. Chromium fires beforeinstallprompt and we can show
 * a real button; iOS never fires it, so we hand back instructions instead.
 */
export function setupInstall(button, { onInstructions } = {}) {
  if (!button) return;
  let deferred = null;

  const hide = () => { button.hidden = true; };
  const show = () => { button.hidden = false; };

  if (isStandalone()) { hide(); return; }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    show();
  });

  window.addEventListener('appinstalled', () => { deferred = null; hide(); });

  button.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') hide();
      deferred = null;
      return;
    }
    if (onInstructions) {
      onInstructions(isIOS()
        ? 'In Safari: tap Share, then “Add to Home Screen”.'
        : 'In your browser menu, choose “Install app” or “Add to Home screen”.');
    }
  });

  // iOS gives no event, so offer the instructions path unconditionally there.
  if (isIOS()) show();
}

/* ------------------------------------------------------------- lock-screen controls */

/**
 * Publish the current sentence to the OS media controls, so the phone's lock
 * screen, notification shade and headset buttons drive the reader.
 *
 * The player hands us one clip per sentence. Reporting each clip's own
 * duration would make the lock-screen scrubber jump every few seconds, so we
 * report the position within the sentence and let the title carry the
 * progress through the document.
 */
export function setupMediaSession(player, { title = 'Read Aloud' } = {}) {
  if (!('mediaSession' in navigator)) return () => {};

  const ms = navigator.mediaSession;
  try {
    ms.setActionHandler('play', () => player.play());
    ms.setActionHandler('pause', () => player.pause());
    ms.setActionHandler('stop', () => player.pause());
    ms.setActionHandler('nexttrack', () => player.next());
    ms.setActionHandler('previoustrack', () => player.prev());
    ms.setActionHandler('seekforward', () => player.next());
    ms.setActionHandler('seekbackward', () => player.prev());
  } catch { /* older browsers reject unknown actions */ }

  let docTitle = title;

  const update = ({ index, total, text }) => {
    try {
      ms.metadata = new MediaMetadata({
        title: text ? text.slice(0, 90) : docTitle,
        artist: `Sentence ${index + 1} of ${total}`,
        album: docTitle,
        artwork: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    } catch { /* MediaMetadata unavailable */ }
  };

  return {
    setDocumentTitle(t) { docTitle = t || title; },
    update,
    setPlaybackState(state) { try { ms.playbackState = state; } catch { /* noop */ } },
    setPosition(duration, position, rate) {
      if (!ms.setPositionState) return;
      try {
        ms.setPositionState({
          duration: Math.max(0, duration || 0),
          position: Math.min(Math.max(0, position || 0), Math.max(0, duration || 0)),
          playbackRate: rate || 1,
        });
      } catch { /* Safari throws on odd values */ }
    },
  };
}

/* -------------------------------------------------------------------- wake lock */

/**
 * Keep the screen on while reading. Phones dim after ~30 s, which hides the
 * highlight — the one thing this application exists to show.
 * The lock is dropped automatically when the tab is hidden, so it has to be
 * re-acquired when the user comes back.
 */
export function createWakeLock() {
  let sentinel = null;
  let wanted = false;

  const acquire = async () => {
    if (!('wakeLock' in navigator) || !wanted || sentinel) return;
    if (document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => { sentinel = null; });
    } catch { /* denied, low battery, or unsupported */ }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });

  return {
    async enable() { wanted = true; await acquire(); },
    async disable() {
      wanted = false;
      if (sentinel) { try { await sentinel.release(); } catch { /* noop */ } }
      sentinel = null;
    },
    get supported() { return 'wakeLock' in navigator; },
  };
}

/* ------------------------------------------------------- shared and opened files */

/**
 * Content can arrive three ways besides the file picker:
 *  - the Web Share Target ("share to Read Aloud" on Android) as ?text=/?title=
 *  - the File Handling API (opening a .md with the installed app)
 *  - ?action=paste from the manifest shortcut
 * Returns the query action so the caller can open the paste dialog.
 */
export function receiveIncoming({ onText, onFile, onPaste }) {
  const params = new URLSearchParams(window.location.search);

  const shared = params.get('text') || params.get('url');
  if (shared && onText) {
    const title = params.get('title');
    onText(title ? `# ${title}\n\n${shared}` : shared);
    history.replaceState(null, '', window.location.pathname);
  } else if (params.get('action') === 'paste' && onPaste) {
    onPaste();
    history.replaceState(null, '', window.location.pathname);
  }

  if ('launchQueue' in window && 'files' in LaunchParams.prototype) {
    window.launchQueue.setConsumer(async (launch) => {
      if (!launch.files || !launch.files.length) return;
      try {
        const file = await launch.files[0].getFile();
        if (onFile) onFile(file);
      } catch { /* permission withdrawn */ }
    });
  }
}

export { isStandalone, isIOS };
