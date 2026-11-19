// main.js - wires the pieces together and runs the frame loop:
// link -> clock -> 3D scene -> HTML.
//
// The ESP32 console owns the farm. This page draws the console's state and
// sends it plant/harvest/seed commands; nothing changes here until the
// console says so. Three situations:
//   live     - connected: clicks become commands, state arrives every <= 2 s.
//   offline  - console off/unreachable/busy: the last farm we saw (kept in
//              localStorage), read-only, with growth frozen.
//   demo     - this browser has never seen a console: a local farm plays
//              itself behind instructions for joining the FarmBot Wi-Fi.
import { CROPS, setCrops } from './crops.js';
import { clockBegin, clockSync, clockFreeze, clockUpdate, now } from './clock.js';
import { gameFromState, tileStage, tilePercent, wrapIndex, TILE_COUNT, GRID_COLS } from './game.js';
import { createLink, consoleAddress, DEFAULT_ADDRESS } from './net.js';
import { createDemo } from './demo.js';
import { createScene } from './scene.js';
import { createUi } from './ui.js';

const ACCENT = '#A6E35F';
const address = consoleAddress();
const CACHE_KEY = `farmbot.console.${address}`;   // per address: the mock's farm isn't the console's

// ---- offline cache -----------------------------------------------------------

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!c || !setCrops(c.hello?.crops, c.hello?.growMode)) return null;
    const game = gameFromState(c.state);
    return game ? { game, now: c.state.now >>> 0, lastSeen: c.lastSeen } : null;
  } catch {
    return null;
  }
}

let cacheHello = null;
function saveCache(state, lastSeen) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ hello: cacheHello, state, lastSeen }));
  } catch { /* storage full or disabled: the offline view just won't survive a reload */ }
}

// ---- state -------------------------------------------------------------------

let game, demo = null, lastSeen = null;
let linkStatus = 'connecting';
let cursor = 0;
const pending = new Map();   // command id -> tile (for result messages)

const cached = loadCache();
if (cached) {
  game = cached.game;
  lastSeen = cached.lastSeen ?? null;
  clockFreeze(cached.now);
} else {
  demo = createDemo();
  game = demo.game;
  clockBegin(0);
}

const live = () => linkStatus === 'live';
// What the page is showing, for the UI: demo, live, or why it's read-only.
const viewMode = () => (demo ? 'demo' : linkStatus);

// ---- actions -------------------------------------------------------------------

function press(i) {
  cursor = i;
  if (!live()) return;
  const id = link.send({ t: 'press', tile: i });
  if (id) pending.set(id, i);
}

function selectSeed(i) {
  if (!live() || i < 0 || i >= CROPS.length || i === game.selected) return;
  link.send({ t: 'select', crop: i });
}

const ui = createUi({ onSelectSeed: selectSeed, onAction: () => press(cursor) });
if (cached) ui.setCrops();   // shop and grow-mode label from the cached console

const viewport = document.getElementById('viewport');
const scene = createScene(viewport, { accent: ACCENT, onHover: (i) => { cursor = i; }, onPress: press });
if (!scene) document.getElementById('webgl-fallback').hidden = false;

// ---- console messages ------------------------------------------------------------

const REASONS = {
  no_coins: 'Not enough coins',
  bad_tile: 'The console rejected that plot',
  bad_crop: 'The console rejected that seed',
  busy: 'The console is busy, try again',
};

const link = createLink(address, {
  onHello(msg) {
    if (!setCrops(msg.crops, msg.growMode)) return;
    cacheHello = { t: 'hello', proto: msg.proto, growMode: msg.growMode, crops: msg.crops };
    ui.setCrops();
  },
  onState(msg) {
    const next = gameFromState(msg);
    if (!next) return;
    if (demo) {   // the first real farm ends the demo for good
      demo = null;
      ui.setDemo(false, address);
    }
    game = next;
    clockSync(msg.now);
    lastSeen = Date.now();
    saveCache(msg, lastSeen);
  },
  onEvent(msg) {
    const crop = CROPS[msg.crop];
    if (!crop || !(msg.tile >= 0 && msg.tile < TILE_COUNT)) return;
    const harvested = msg.kind === 'harvested';
    const money = `${harvested ? '+' : '-'}$${msg.amount}`;
    if (scene) scene.floatText(msg.tile, money, harvested ? 'earn' : 'spend');
    if (msg.from === 'console') {
      ui.toast(`Console ${harvested ? 'harvested' : 'planted'} ${crop.name.toLowerCase()} · ${money}`, harvested ? 'earn' : 'info');
    }
  },
  onResult(msg) {
    pending.delete(msg.id);
    if (!msg.ok && REASONS[msg.reason]) ui.toast(REASONS[msg.reason], 'error');
    // not_ripe is the plain "nothing to do" click on a growing plot: silent.
  },
  onStatus(s) {
    if (linkStatus === 'live' && s !== 'live') clockFreeze();
    linkStatus = s;
    pending.clear();
  },
});

ui.setDemo(Boolean(demo), address === DEFAULT_ADDRESS ? null : address);

// Keyboard: arrows move the cursor (left/right wrap like the encoder, up/down
// jump a row), Enter or Space presses, 1-3 pick a seed.
window.addEventListener('keydown', (e) => {
  if (ui.isShopOpen()) return;   // the dialog handles its own keys (Tab, Esc)
  const inControl = e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement;
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -GRID_COLS, ArrowDown: GRID_COLS };
  if (e.key in moves && !inControl) {
    cursor = wrapIndex(cursor, moves[e.key], TILE_COUNT);
    e.preventDefault();
  } else if ((e.key === 'Enter' || e.key === ' ') && !inControl) {
    press(cursor);
    e.preventDefault();
  } else if (e.key >= '1' && e.key <= String(CROPS.length)) {
    selectSeed(Number(e.key) - 1);
  }
});

// ---- frame loop ------------------------------------------------------------------

function frame(ms) {
  clockUpdate();
  const t = now();
  if (demo) {
    const move = demo.tick(t, ms);
    if (move && scene) scene.floatText(move.tile, move.text, move.kind);
  }
  if (scene) {
    game.tiles.forEach((tile, i) => scene.syncTile(i, tileStage(tile, t), tile.crop, tilePercent(tile, t)));
    scene.setCursor(cursor);
    scene.render();
  }
  ui.render(game, cursor, t, { mode: viewMode(), lastSeen });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
