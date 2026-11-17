// save.js - versioned save in localStorage.
//
// Unlike the console's flash, localStorage has no wear limit, so the web
// version saves right after every event (plant, harvest, seed change), every
// 5 seconds, and when the page is hidden or closed.
import { createGame, gameIsValid, TILE_COUNT } from './game.js';

const KEY = 'farmbot.save';
const VERSION = 1; // bump when the saved shape or meaning changes

// Returns { game, gameSeconds }, or null for a missing, old or invalid save
// (the caller then starts a fresh farm).
export function loadSave() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
  if (!data || data.version !== VERSION) return null;
  if (!Number.isInteger(data.gameSeconds) || data.gameSeconds < 0) return null;
  if (!Array.isArray(data.tiles) || data.tiles.length !== TILE_COUNT) return null;

  const game = createGame();
  game.coins = data.coins;
  game.selected = data.selected;
  data.tiles.forEach((pair, i) => {
    if (!Array.isArray(pair)) return;
    game.tiles[i].crop = pair[0];
    game.tiles[i].plantedAt = pair[1];
  });
  return gameIsValid(game) ? { game, gameSeconds: data.gameSeconds } : null;
}

export function writeSave(game, gameSeconds) {
  const data = {
    version: VERSION,
    gameSeconds,
    coins: game.coins,
    selected: game.selected,
    tiles: game.tiles.map((t) => [t.crop, t.plantedAt]),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked (private mode): the game keeps running unsaved.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
