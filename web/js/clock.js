// clock.js - game seconds; the only module that reads time.
//
// Two sources:
//  * demo mode: a local clock from 0, like before (clockBegin).
//  * console: the console owns game time. Each `state` message sets it
//    (clockSync) and the web counts on locally between messages so the
//    growth bars move smoothly. While the console is offline the clock is
//    frozen (clockFreeze): the console's time stops when it is off, so
//    crops must not appear to grow.
// Counting adds the time since the last update and carries whole seconds,
// keeping the fraction, so nothing is lost or rounded away.
let gameSeconds = 0;
let remainderMs = 0;
let lastMs = 0;
let running = false;

export function clockBegin(startSeconds) {
  gameSeconds = startSeconds >>> 0;
  remainderMs = 0;
  lastMs = performance.now();
  running = true;
}

// A console's `now`. The message is at most a second old, so starting the
// fraction at 0 keeps the web at or just behind the console, never ahead.
export const clockSync = clockBegin;

// Stops counting at the current second.
export function clockFreeze(atSeconds = gameSeconds) {
  gameSeconds = atSeconds >>> 0;
  remainderMs = 0;
  running = false;
}

export function clockUpdate() {
  const nowMs = performance.now();
  const delta = Math.max(0, nowMs - lastMs);
  lastMs = nowMs;
  if (!running) return;
  remainderMs += delta;
  const whole = Math.floor(remainderMs / 1000);
  if (whole > 0) {
    gameSeconds = (gameSeconds + whole) >>> 0; // uint32 wrap, like the firmware
    remainderMs -= whole * 1000;
  }
}

export const now = () => gameSeconds;
