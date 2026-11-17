// main.js - wires the pieces together and runs the frame loop:
// clock -> rules -> 3D scene -> HTML -> save.
import { CROPS, GROW_MODE } from './crops.js';
import { clockBegin, clockUpdate, now } from './clock.js';
import {
  createGame, resetGame, pressTile, tileStage, tilePercent, wrapIndex,
  PressResult, TILE_COUNT, GRID_COLS,
} from './game.js';
import { loadSave, writeSave, clearSave } from './save.js';
import { createScene } from './scene.js';
import { createUi } from './ui.js';

const ACCENT = '#A6E35F';
const SAVE_PERIOD_S = 5;

const loaded = loadSave();
const game = loaded ? loaded.game : createGame();
clockBegin(loaded ? loaded.gameSeconds : 0);

let cursor = 0;
let lastSaveAt = now();

function save() {
  writeSave(game, now());
  lastSaveAt = now();
}

// The one game action: plant on empty, harvest when ripe (same as the
// encoder's short press on the console).
function press(i) {
  cursor = i;
  const tile = game.tiles[i];
  const cropBefore = tile.crop;
  const result = pressTile(game, i, now());
  if (result === PressResult.None) return;
  if (scene) {
    if (result === PressResult.Planted) scene.floatText(i, `-$${CROPS[tile.crop].seedCost}`, 'spend');
    else scene.floatText(i, `+$${CROPS[cropBefore].sellPrice}`, 'earn');
  }
  save();
}

function selectSeed(i) {
  if (i < 0 || i >= CROPS.length || i === game.selected) return;
  game.selected = i;
  save();
}

function newFarm() {
  if (!window.confirm('Start a new farm? Your coins and crops will be lost.')) return;
  resetGame(game);
  clearSave();
  clockBegin(0);
  cursor = 0;
  save();
}

const ui = createUi({ onSelectSeed: selectSeed, onAction: () => press(cursor), onNewFarm: newFarm });

const viewport = document.getElementById('viewport');
const scene = createScene(viewport, { accent: ACCENT, onHover: (i) => { cursor = i; }, onPress: press });
if (!scene) document.getElementById('webgl-fallback').hidden = false;

document.getElementById('grow-mode').textContent =
  GROW_MODE === 'real' ? 'Real grow times' : 'Dev grow times';

// Keyboard: arrows move the cursor (left/right wrap like the encoder, up/down
// jump a row), Enter or Space presses, 1-3 pick a seed.
window.addEventListener('keydown', (e) => {
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

// Save when the tab is hidden or closed, so nothing is lost.
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

function frame() {
  clockUpdate();
  const t = now();
  if (scene) {
    game.tiles.forEach((tile, i) => scene.syncTile(i, tileStage(tile, t), tile.crop, tilePercent(tile, t)));
    scene.setCursor(cursor);
    scene.render();
  }
  ui.render(game, cursor, t);
  if (t - lastSaveAt >= SAVE_PERIOD_S) save();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
