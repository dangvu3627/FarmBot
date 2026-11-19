// ui.js - the HTML side: header (coins, game time, console status, shop
// button), the info bar for the selected plot, the seed shop dialog, toasts
// and the demo overlay.
// render() runs every frame but only touches the DOM when a value changes.
import { CROPS, GROW_MODE } from './crops.js';
import { Stage, STAGE_NAMES, tileStage, tilePercent, tileSecondsLeft, canAfford } from './game.js';
import { RIPE_SPRITES } from './sprites.js';

const $ = (id) => document.getElementById(id);

// Non-breaking spaces keep a number and its unit on one line.
export function formatDuration(s) {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return sec ? `${m}m ${sec}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
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

// Small inline SVG of a crop's ripe pixel sprite.
function spriteSvg(pixels, size) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 14');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(Math.round((size * 14) / 16)));
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

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// The console has one sprite per crop in crops.h; extra crops reuse the last.
const ripeSprite = (i) => RIPE_SPRITES[Math.min(i, RIPE_SPRITES.length - 1)];

// One button per crop. Clicking selects that seed and closes the shop.
function buildSeedList(container, onPick) {
  container.replaceChildren();
  return CROPS.map((crop, i) => {
    const button = el('button', 'seed');
    button.type = 'button';
    const text = el('span', 'seed__text');
    text.append(el('span', 'seed__name', crop.name),
                el('span', 'seed__detail', `Ripe in ${formatDuration(crop.growSeconds)}`));
    const note = el('span', 'seed__note');
    const right = el('span', 'seed__right');
    right.append(el('span', 'seed__price', `$${crop.seedCost} → $${crop.sellPrice}`), note);
    button.append(spriteSvg(ripeSprite(i), 40), text, right);
    button.addEventListener('click', () => onPick(i));
    container.appendChild(button);
    return { button, note };
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

function wireShop(dialog, onPick) {
  $('shop-open').addEventListener('click', () => dialog.showModal());
  $('shop-close').addEventListener('click', () => dialog.close());
  // A click on the dim backdrop (the dialog element itself) closes it.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  return (i) => {
    onPick(i);
    dialog.close();
  };
}

// Header pill text for each view mode (see main.js viewMode()).
function linkLabel(mode, lastSeen) {
  switch (mode) {
    case 'live': return 'Console live';
    case 'demo': return 'Demo · join FarmBot Wi-Fi';
    case 'busy': return 'Console busy';
    case 'mismatch': return 'Update needed';
    default:
      return lastSeen
        ? `Offline · last seen ${new Date(lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Offline';
  }
}

const LINK_HELP = {
  live: 'Connected to the console. It runs the game; this page shows it and sends your clicks.',
  demo: 'No console yet. This farm is a demo that plays itself.',
  busy: 'Another browser is connected to the console. Only one can play at a time.',
  mismatch: "The console's firmware and this page speak different protocol versions. Update one of them.",
  connecting: 'The console is off or out of reach. This is the last farm it sent; crops grow again when it is back.',
  paused: 'This tab was hidden, so it let go of the console. It reconnects now.',
};

// What the action button says when the page can't play.
const READONLY_ACTION = {
  demo: 'Join FarmBot Wi-Fi to play',
  busy: 'Console busy',
  mismatch: 'Update needed',
  connecting: 'Console offline',
  paused: 'Console offline',
};

export function createUi({ onSelectSeed, onAction }) {
  const set = setter();
  const dialog = $('shop');
  const pickSeed = wireShop(dialog, onSelectSeed);
  let seeds = buildSeedList($('seed-list'), pickSeed);
  $('info-action').addEventListener('click', onAction);
  let shownSeed = -1;
  let shownMode = '';

  const toasts = $('toasts');

  return {
    isShopOpen: () => dialog.open,

    // The console sent its crop table: rebuild the shop from it.
    setCrops() {
      seeds = buildSeedList($('seed-list'), pickSeed);
      shownSeed = -1;
      $('grow-mode').textContent = GROW_MODE === 'real' ? 'Real grow times' : 'Dev grow times';
    },

    // Shows or hides the demo instructions. `address` is set when the page
    // looks for a console somewhere other than the hotspot (mock, Wokwi).
    setDemo(on, address) {
      $('demo').hidden = !on;
      if (on && address) $('demo-steps').replaceChildren(el('li', '', `Waiting for a console at ${address}.`));
    },

    // A short message in the corner of the farm. kind: info, earn, error.
    toast(text, kind = 'info') {
      const t = el('div', `toast toast--${kind}`, text);
      toasts.appendChild(t);
      while (toasts.children.length > 3) toasts.firstChild.remove();
      setTimeout(() => {
        t.classList.add('toast--out');
        t.addEventListener('animationend', () => t.remove());
      }, 2600);
    },

    render(game, cursor, now, link) {
      const live = link.mode === 'live';
      set($('coins'), 'textContent', `$${game.coins}`);
      set($('game-time'), 'textContent', `Game time ${formatDuration(now)}`);

      set($('link'), 'textContent', linkLabel(link.mode, link.lastSeen));
      if (shownMode !== link.mode) {
        shownMode = link.mode;
        $('link').dataset.mode = link.mode;
        $('link').title = LINK_HELP[link.mode] ?? '';
        $('shop-open').disabled = !live;
        if (!live && dialog.open) dialog.close();
        // Dim the field when it shows a frozen farm (not in the demo).
        $('viewport').classList.toggle('viewport--readonly', !live && link.mode !== 'demo');
      }

      const info = describeTile(game, game.tiles[cursor], now);
      set($('info-plot'), 'textContent', `Plot ${cursor + 1}`);
      set($('info-name'), 'textContent', info.name);
      set($('info-detail'), 'textContent', live ? info.detail : LINK_HELP[link.mode] ?? '');
      set($('info-progress'), 'width', `${info.percent}%`);
      set($('info-action'), 'textContent', live ? info.action : READONLY_ACTION[link.mode] ?? 'Console offline');
      set($('info-action'), 'disabled', !live || !info.enabled);

      if (shownSeed !== game.selected) {   // shop button shows the current seed
        shownSeed = game.selected;
        $('shop-icon').replaceChildren(spriteSvg(ripeSprite(game.selected), 28));
        $('shop-seed').textContent = CROPS[game.selected].name;
        $('shop-open').setAttribute('aria-label', `Shop, current seed ${CROPS[game.selected].name}`);
      }
      seeds.forEach(({ button, note }, i) => {
        const current = i === game.selected;
        if (button.getAttribute('aria-pressed') !== String(current)) button.setAttribute('aria-pressed', String(current));
        const text = current ? 'Selected' : (canAfford(game, i) ? '' : `Need $${CROPS[i].seedCost}`);
        if (note.textContent !== text) note.textContent = text;
      });
    },
  };
}
