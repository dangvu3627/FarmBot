// demo.js - the cold-start attract mode. It runs only when no console has
// ever been seen by this browser (nothing cached): a local farm with the
// built-in dev crop table plays itself behind the "join the FarmBot Wi-Fi"
// instructions. Nothing here ever reaches a console.
import { CROPS } from './crops.js';
import {
  createGame, plant, harvest, canAfford, tileStage, Stage, TILE_COUNT,
} from './game.js';

const STEP_MS = 1500;

export function createDemo() {
  const game = createGame();
  let lastStepMs = 0;

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // One bot move: harvest something ripe, otherwise plant a random
  // affordable seed on a random empty plot. Returns {tile, text, kind} for
  // the float text, or null.
  function step(now) {
    const ripe = [], empty = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      const stage = tileStage(game.tiles[i], now);
      if (stage === Stage.Ripe) ripe.push(i);
      else if (stage === Stage.Empty) empty.push(i);
    }
    if (ripe.length) {
      const i = pick(ripe);
      const price = CROPS[game.tiles[i].crop].sellPrice;
      harvest(game, i, now);
      return { tile: i, text: `+$${price}`, kind: 'earn' };
    }
    const seeds = CROPS.map((_, c) => c).filter((c) => canAfford(game, c));
    if (empty.length && seeds.length) {
      const i = pick(empty);
      game.selected = pick(seeds);
      plant(game, i, game.selected, now);
      return { tile: i, text: `-$${CROPS[game.selected].seedCost}`, kind: 'spend' };
    }
    return null;
  }

  return {
    game,
    // Call every frame; makes a move every STEP_MS.
    tick(now, ms) {
      if (ms - lastStepMs < STEP_MS) return null;
      lastStepMs = ms;
      return step(now);
    },
  };
}
