// crops.js - the crop table. Same numbers as the firmware's crops.h.
//
// Grow times: dev times by default. Open the page with ?real to use the
// real times (e.g. http://localhost:8000/?real).
const REAL_TIMES =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('real');

const grow = (devSeconds, realSeconds) => (REAL_TIMES ? realSeconds : devSeconds);

export const GROW_MODE = REAL_TIMES ? 'real' : 'dev';

export const CROPS = Object.freeze([
  //            name        seed  sell  grow (dev, real)
  Object.freeze({ name: 'Wheat',   seedCost: 1, sellPrice: 2, growSeconds: grow(10, 60) }),
  Object.freeze({ name: 'Carrot',  seedCost: 2, sellPrice: 4, growSeconds: grow(20, 180) }),
  Object.freeze({ name: 'Pumpkin', seedCost: 4, sellPrice: 8, growSeconds: grow(30, 600) }),
]);

export const CROP_COUNT = CROPS.length;
