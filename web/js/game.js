// game.js - pure game rules, a direct port of the firmware's game.cpp.
// No DOM, no Three.js, no clock reads: everything time-dependent takes `now`
// (game seconds), so the rules match the console exactly.
//
// When a console is connected it applies the rules and the web only draws
// its state; these functions then serve the display (stages, percentages)
// and demo mode.
import { CROPS } from './crops.js';

export const GRID_COLS = 8;
export const GRID_ROWS = 4;
export const TILE_COUNT = GRID_COLS * GRID_ROWS;
export const NO_CROP = -1;
export const START_COINS = 12;
export const START_CROP = 0; // wheat

export const Stage = Object.freeze({ Empty: 0, Seed: 1, Sprout: 2, Growing: 3, Ripe: 4 });
export const STAGE_NAMES = ['Empty', 'Seed', 'Sprout', 'Growing', 'Ripe'];

export const PressResult = Object.freeze({ None: 0, Planted: 1, Harvested: 2 });

const validCrop = (c) => Number.isInteger(c) && c >= 0 && c < CROPS.length;

// Seconds since planting, as uint32 subtraction like the firmware, so it
// stays correct if `now` ever wraps past 2^32.
const elapsed = (tile, now) => (now - tile.plantedAt) >>> 0;

export function createGame() {
  const game = { coins: 0, selected: 0, tiles: [] };
  for (let i = 0; i < TILE_COUNT; i++) game.tiles.push({ crop: NO_CROP, plantedAt: 0 });
  resetGame(game);
  return game;
}

export function resetGame(game) {
  game.coins = START_COINS;
  game.selected = START_CROP;
  for (const t of game.tiles) {
    t.crop = NO_CROP;
    t.plantedAt = 0;
  }
}

export function gameIsValid(game) {
  if (!validCrop(game.selected)) return false;
  if (!Number.isInteger(game.coins) || game.coins < 0) return false;
  if (!Array.isArray(game.tiles) || game.tiles.length !== TILE_COUNT) return false;
  return game.tiles.every(
    (t) =>
      (t.crop === NO_CROP || validCrop(t.crop)) &&
      Number.isInteger(t.plantedAt) && t.plantedAt >= 0 && t.plantedAt <= 0xffffffff,
  );
}

// Stage changes at grow/3, 2*grow/3 and grow, compared as e*3 >= grow*k so
// there is no rounding.
export function tileStage(tile, now) {
  if (!validCrop(tile.crop)) return Stage.Empty;
  const grow = CROPS[tile.crop].growSeconds;
  const e = elapsed(tile, now);
  if (e >= grow) return Stage.Ripe;
  if (e * 3 >= grow * 2) return Stage.Growing;
  if (e * 3 >= grow) return Stage.Sprout;
  return Stage.Seed;
}

export function tilePercent(tile, now) {
  if (!validCrop(tile.crop)) return 0;
  const grow = CROPS[tile.crop].growSeconds;
  const e = elapsed(tile, now);
  return e >= grow ? 100 : Math.floor((e * 100) / grow);
}

// Seconds until ripe (0 when ripe or empty).
export function tileSecondsLeft(tile, now) {
  if (!validCrop(tile.crop)) return 0;
  return Math.max(0, CROPS[tile.crop].growSeconds - elapsed(tile, now));
}

export function canAfford(game, crop) {
  return validCrop(crop) && game.coins >= CROPS[crop].seedCost;
}

export function plant(game, idx, crop, now) {
  if (idx < 0 || idx >= TILE_COUNT || !canAfford(game, crop)) return false;
  const t = game.tiles[idx];
  if (t.crop !== NO_CROP) return false;
  game.coins -= CROPS[crop].seedCost;
  t.crop = crop;
  t.plantedAt = now >>> 0;
  return true;
}

export function harvest(game, idx, now) {
  if (idx < 0 || idx >= TILE_COUNT) return false;
  const t = game.tiles[idx];
  if (tileStage(t, now) !== Stage.Ripe) return false;
  game.coins += CROPS[t.crop].sellPrice;
  t.crop = NO_CROP;
  t.plantedAt = 0;
  return true;
}

// Click rule: plant the selected seed on an empty plot, harvest a ripe one,
// otherwise nothing.
export function pressTile(game, idx, now) {
  if (idx < 0 || idx >= TILE_COUNT) return PressResult.None;
  switch (tileStage(game.tiles[idx], now)) {
    case Stage.Empty:
      return plant(game, idx, game.selected, now) ? PressResult.Planted : PressResult.None;
    case Stage.Ripe:
      return harvest(game, idx, now) ? PressResult.Harvested : PressResult.None;
    default:
      return PressResult.None;
  }
}

// Builds a game from a console `state` message ({coins, selected, tiles:
// [[crop, plantedAt], ...]}). Returns null if it doesn't pass gameIsValid().
export function gameFromState(msg) {
  if (!msg || !Array.isArray(msg.tiles)) return null;
  const game = {
    coins: msg.coins,
    selected: msg.selected,
    tiles: msg.tiles.map((t) => (Array.isArray(t) ? { crop: t[0], plantedAt: t[1] } : null)),
  };
  return game.tiles.every(Boolean) && gameIsValid(game) ? game : null;
}

// (cur + steps) wrapped into [0, n).
export function wrapIndex(cur, steps, n) {
  return n > 0 ? (((cur + steps) % n) + n) % n : 0;
}
