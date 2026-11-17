// clock.js - game seconds, the web twin of the firmware's clock.cpp.
// The only module that reads time. It adds the time since the last update
// and carries whole seconds, keeping the fraction, so nothing is lost or
// rounded away. Game time runs while the page is open (a background tab
// counts too, once it wakes) and stops when the page is closed.
let gameSeconds = 0;
let remainderMs = 0;
let lastMs = 0;

export function clockBegin(startSeconds) {
  gameSeconds = startSeconds >>> 0;
  remainderMs = 0;
  lastMs = performance.now();
}

export function clockUpdate() {
  const nowMs = performance.now();
  const delta = Math.max(0, nowMs - lastMs);
  lastMs = nowMs;
  remainderMs += delta;
  const whole = Math.floor(remainderMs / 1000);
  if (whole > 0) {
    gameSeconds = (gameSeconds + whole) >>> 0; // uint32 wrap, like the firmware
    remainderMs -= whole * 1000;
  }
}

export const now = () => gameSeconds;
