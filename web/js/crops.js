// crops.js - the crop table. The console is the source of truth: its `hello`
// message carries the table (names, prices, grow times), and setCrops()
// replaces this one in place, so every module that imported CROPS sees the
// change. The built-in rows below match the firmware's crops.h with dev grow
// times and are used only until a console (or the cached copy of one) is
// known, i.e. in demo mode.
export const CROPS = [
  { name: 'Wheat',   seedCost: 1, sellPrice: 2, growSeconds: 10 },
  { name: 'Carrot',  seedCost: 2, sellPrice: 4, growSeconds: 20 },
  { name: 'Pumpkin', seedCost: 4, sellPrice: 8, growSeconds: 30 },
];

// 'dev' or 'real', as the console reports it.
export let GROW_MODE = 'dev';

// "PUMPKIN" (the OLED's upper case) -> "Pumpkin".
const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

const validRow = (c) =>
  c && typeof c.name === 'string' && c.name.length > 0 &&
  [c.seedCost, c.sellPrice, c.growSeconds].every((n) => Number.isInteger(n) && n >= 0) &&
  c.growSeconds > 0;

// Validates a hello message's crop list. Returns false (and changes nothing)
// if it is unusable.
export function setCrops(rows, growMode) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 127 || !rows.every(validRow)) return false;
  CROPS.length = 0;
  for (const c of rows) {
    CROPS.push({ name: titleCase(c.name), seedCost: c.seedCost, sellPrice: c.sellPrice, growSeconds: c.growSeconds });
  }
  GROW_MODE = growMode === 'real' ? 'real' : 'dev';
  return true;
}
