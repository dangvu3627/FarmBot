// net.js - the WebSocket link to the console (protocol v1, see
// .plans/console-web-link-spec.md). No DOM besides the visibility events,
// no game rules: it moves messages and reports one status.
//
// Status:
//   'connecting' - trying to reach the console (also between retries)
//   'live'       - hello received, messages flowing
//   'busy'       - another browser has the console; retried slowly
//   'mismatch'   - the console speaks a different protocol version; stops
//   'paused'     - this tab was hidden for a while and let go of the console
//
// Liveness: the console sends state at least every 2 s. Six silent seconds
// mean it's gone. We ping every 3 s so the console knows we're here (it drops
// a browser that's silent for 10 s).
export const PROTO = 1;
const PING_MS = 3000;
const SILENCE_MS = 6000;
const CONNECT_TIMEOUT_MS = 4000;   // an unreachable IP can hang for a minute otherwise
const BACKOFF_MS = [1000, 2000, 4000, 8000];
const HIDDEN_RELEASE_MS = 60000;
export const DEFAULT_ADDRESS = '192.168.4.1';

// The console's address from ?console=host[:port], or the hotspot default.
export function consoleAddress() {
  const value = new URLSearchParams(location.search).get('console');
  return value && /^[\w.-]+(:\d{1,5})?$/.test(value) ? value : DEFAULT_ADDRESS;
}

export function createLink(address, { onHello, onState, onEvent, onResult, onStatus }) {
  let ws = null;
  let status = '';
  let attempt = 0;
  let nextId = 1;
  let retryTimer = 0, pingTimer = 0, silenceTimer = 0, connectTimer = 0, hiddenTimer = 0;

  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    onStatus(s);
  };

  const clearTimers = () => {
    clearInterval(pingTimer);
    clearTimeout(silenceTimer);
    clearTimeout(connectTimer);
    clearTimeout(retryTimer);
  };

  // Closes the current socket without triggering its handlers.
  const drop = () => {
    clearTimers();
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch { /* already closed */ }
    ws = null;
  };

  const scheduleRetry = () => {
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt++;
    retryTimer = setTimeout(connect, delay);
  };

  const lost = () => {
    drop();
    if (status === 'live') setStatus('connecting');
    if (status !== 'mismatch' && status !== 'paused') scheduleRetry();
  };

  const heard = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(lost, SILENCE_MS);
  };

  function onMessage(e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    heard();
    switch (msg.t) {
      case 'hello':
        if (msg.proto !== PROTO) {
          drop();
          setStatus('mismatch');
          return;
        }
        attempt = 0;
        onHello(msg);
        setStatus('live');
        break;
      case 'busy':
        drop();
        setStatus('busy');
        attempt = BACKOFF_MS.length - 1;   // the slowest retry: it'll take a while
        scheduleRetry();
        break;
      case 'state': if (status === 'live') onState(msg); break;
      case 'event': if (status === 'live') onEvent(msg); break;
      case 'result': if (status === 'live') onResult(msg); break;
      default: break;   // unknown types are ignored (forward compatible)
    }
  }

  function connect() {
    drop();
    if (status !== 'busy') setStatus('connecting');
    try {
      ws = new WebSocket(`ws://${address}/ws`);
    } catch {
      scheduleRetry();
      return;
    }
    connectTimer = setTimeout(lost, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(connectTimer);
      heard();   // hello must follow within the silence window
      pingTimer = setInterval(() => ws && ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), PING_MS);
    };
    ws.onmessage = onMessage;
    ws.onclose = lost;
    ws.onerror = () => {};   // onclose follows and handles it
  }

  // A hidden tab lets go of the console after a minute, so a forgotten tab
  // can't keep another browser out. It reconnects when it's shown again.
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) {
      hiddenTimer = setTimeout(() => {
        if (status === 'mismatch') return;
        drop();
        setStatus('paused');
      }, HIDDEN_RELEASE_MS);
    } else if (status === 'paused') {
      attempt = 0;
      connect();
    }
  });

  connect();

  return {
    status: () => status,
    // Sends a press/select with a fresh id. Returns the id, or 0 if not live.
    send(cmd) {
      if (status !== 'live' || !ws || ws.readyState !== WebSocket.OPEN) return 0;
      const id = nextId++;
      ws.send(JSON.stringify({ ...cmd, id }));
      return id;
    },
  };
}
