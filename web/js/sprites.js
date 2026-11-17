// sprites.js - the firmware's 16x14 plant sprites (render.cpp) as pixel
// lists, with a colour and a depth per pixel so scene.js can build them as
// voxels. x: 0..15 left to right, y: 0..13 top to bottom, soil line at y = 12.
import { Stage } from './game.js';

// key -> [colour, depth in pixels]
const INK = {
  G: ['#7CC25A', 2],   // stem / leaf
  S: ['#C9A66B', 2],   // seed
  Y: ['#F2C14E', 3],   // wheat ear
  O: ['#F08A3C', 3],   // carrot root
  P: ['#E8743B', 7],   // pumpkin
  p: ['#A9502A', 5],   // pumpkin rib groove (shallower, so it reads as a dent)
};

function builder() {
  const px = new Map();
  const api = {
    dot(x, y, k) { px.set(`${x},${y}`, { x, y, k }); return api; },
    rect(x, y, w, h, k) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) api.dot(x + i, y + j, k);
      return api;
    },
    span(y, x0, x1, k) { return api.rect(x0, y, x1 - x0 + 1, 1, k); },
    done() {
      return [...px.values()].map(({ x, y, k }) => ({ x, y, color: INK[k][0], depth: INK[k][1] }));
    },
  };
  return api;
}

const SEED = builder().rect(7, 10, 2, 2, 'S').done();

const SPROUT = builder().rect(7, 8, 1, 4, 'G').dot(6, 8, 'G').dot(8, 7, 'G').done();

const GROWING = builder()
  .rect(7, 4, 1, 8, 'G')
  .dot(6, 8, 'G').dot(5, 7, 'G').dot(4, 6, 'G')
  .dot(8, 6, 'G').dot(9, 5, 'G').dot(10, 4, 'G')
  .done();

const WHEAT = builder()
  .rect(5, 6, 1, 6, 'G').rect(9, 6, 1, 6, 'G')
  .rect(4, 2, 3, 4, 'Y').rect(8, 2, 3, 4, 'Y')
  .done();

const CARROT = builder()
  .span(8, 4, 11, 'O').span(9, 5, 10, 'O').span(10, 5, 10, 'O').span(11, 6, 9, 'O').span(12, 7, 8, 'O')
  .rect(7, 2, 1, 6, 'G')
  .dot(6, 6, 'G').dot(6, 5, 'G').dot(5, 4, 'G').dot(4, 3, 'G')
  .dot(8, 6, 'G').dot(9, 5, 'G').dot(9, 4, 'G').dot(10, 3, 'G')
  .done();

const PUMPKIN = builder()
  .span(4, 6, 9, 'P').span(5, 4, 11, 'P')
  .rect(3, 6, 10, 5, 'P')
  .span(11, 4, 11, 'P').span(12, 6, 9, 'P')
  .rect(7, 5, 1, 6, 'p')
  .rect(7, 2, 1, 3, 'G')
  .done();

const RIPE = [WHEAT, CARROT, PUMPKIN];

// Pixels for a tile's stage and crop (empty array for an empty plot).
export function spriteFor(stage, crop) {
  switch (stage) {
    case Stage.Seed: return SEED;
    case Stage.Sprout: return SPROUT;
    case Stage.Growing: return GROWING;
    case Stage.Ripe: return RIPE[crop] ?? PUMPKIN;
    default: return [];
  }
}

// The ripe sprite of each crop, for the 2D seed icons.
export const RIPE_SPRITES = RIPE;
