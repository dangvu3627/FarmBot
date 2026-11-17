// ui.js - the HTML side of design B: header, tile info bar and seed panel.
// render() runs every frame but only touches the DOM when a value changes.
import { CROPS } from './crops.js';
import { Stage, STAGE_NAMES, tileStage, tilePercent, tileSecondsLeft, canAfford } from './game.js';
import { RIPE_SPRITES } from './sprites.js';

const $ = (id) => document.getElementById(id);

// Non-breaking spaces keep a number and its unit on one line.
export function formatDuration(s) {
  if (s < 60) return `${s}\u00A0s`;
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return sec ? `${m}m\u00A0${sec}s` : `${m}m`;
  return `${Math.floor(m / 60)}h\u00A0${String(m % 60).padStart(2, '0')}m`;
}

// Writes a property only when it differs from what we last wrote.
function setter() {
  const last = new Map();
  return (el, prop, value) => {
    const key = el.id + '.' + prop;
    if (last.get(key) === value) return;
    last.set(key, value);
    if (prop === 'width') el.style.width = value;
    else el[prop] = value;
  };
}

// Small inline SVG of a crop's ripe pixel sprite, for the seed panel.
function spriteSvg(pixels) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 14');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '35');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  for (const p of pixels) {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', p.x);
    r.setAttribute('y', p.y);
    r.setAttribute('width', 1);
    r.setAttribute('height', 1);
    r.setAttribute('fill', p.color);
    svg.appendChild(r);
  }
  return svg;
}

function buildSeedList(container, onSelectSeed) {
  return CROPS.map((crop, i) => {
    const label = document.createElement('label');
    label.className = 'seed';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'seed';
    input.value = String(i);
    input.addEventListener('change', () => onSelectSeed(i));

    const text = document.createElement('span');
    text.className = 'seed__text';
    const name = document.createElement('span');
    name.className = 'seed__name';
    name.textContent = `${crop.name}`;
    const detail = document.createElement('span');
    detail.className = 'seed__detail';
    detail.textContent = `Ripe in ${formatDuration(crop.growSeconds)}`;
    text.append(name, detail);

    const price = document.createElement('span');
    price.className = 'seed__price';
    price.textContent = `$${crop.seedCost} → $${crop.sellPrice}`;

    label.append(input, spriteSvg(RIPE_SPRITES[i]), text, price);
    container.appendChild(label);
    return input;
  });
}

// What the info bar says about the plot under the cursor.
function describeTile(game, tile, now) {
  const stage = tileStage(tile, now);
  const seed = CROPS[game.selected];
  if (stage === Stage.Empty) {
    const ok = canAfford(game, game.selected);
    return {
      name: 'Empty plot',
      detail: ok ? `Click to plant ${seed.name.toLowerCase()} for $${seed.seedCost}`
                 : `${seed.name} costs $${seed.seedCost}, you have $${game.coins}`,
      percent: 0,
      action: ok ? `Plant ${seed.name} · $${seed.seedCost}` : `Need $${seed.seedCost}`,
      enabled: ok,
    };
  }
  const crop = CROPS[tile.crop];
  if (stage === Stage.Ripe) {
    return { name: crop.name, detail: `Ripe · sells for $${crop.sellPrice}`, percent: 100,
             action: `Harvest · +$${crop.sellPrice}`, enabled: true };
  }
  const pct = tilePercent(tile, now);
  return {
    name: crop.name,
    detail: `${STAGE_NAMES[stage]} · ${pct}% · ripe in ${formatDuration(tileSecondsLeft(tile, now))}`,
    percent: pct,
    action: 'Harvest when ripe',
    enabled: false,
  };
}

export function createUi({ onSelectSeed, onAction, onNewFarm }) {
  const set = setter();
  const seedInputs = buildSeedList($('seed-list'), onSelectSeed);
  $('info-action').addEventListener('click', onAction);
  $('new-farm').addEventListener('click', onNewFarm);

  return {
    render(game, cursor, now) {
      set($('coins'), 'textContent', `$${game.coins}`);
      set($('game-time'), 'textContent', `Game time ${formatDuration(now)}`);

      const info = describeTile(game, game.tiles[cursor], now);
      set($('info-plot'), 'textContent', `Plot ${cursor + 1}`);
      set($('info-name'), 'textContent', info.name);
      set($('info-detail'), 'textContent', info.detail);
      set($('info-progress'), 'width', `${info.percent}%`);
      set($('info-action'), 'textContent', info.action);
      set($('info-action'), 'disabled', !info.enabled);

      seedInputs.forEach((input, i) => {
        if (input.checked !== (i === game.selected)) input.checked = i === game.selected;
      });
    },
  };
}
