// plot-bars.js - a small growth bar floating above each planted plot.
// The bars are HTML laid over the canvas: each frame we project a point above
// the plot into screen space and move the bar there. They stay crisp at any
// zoom and always face the viewer. Green while growing, full gold when ripe.
import * as THREE from 'three';
import { Stage } from './game.js';

const ABOVE_PLOT = 1.4;            // world units above the plot surface (tallest crop is ~1.15)
const MIN_W = 18, MAX_W = 56;      // bar width in CSS px

export function createPlotBars(container, plots, plotWidth) {
  const layer = document.createElement('div');
  layer.className = 'plot-bars';
  layer.setAttribute('aria-hidden', 'true');
  container.appendChild(layer);

  const bars = plots.map(() => {
    const bar = document.createElement('span');
    bar.className = 'plot-bar';
    const fill = document.createElement('span');
    fill.className = 'plot-bar__fill';
    bar.appendChild(fill);
    layer.appendChild(bar);
    return { bar, fill, shown: false, ripe: false, pct: -1 };
  });

  const v = new THREE.Vector3();
  const toScreen = (x, y, z, camera, w, h) => {
    v.set(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 };
  };

  return {
    update(camera, surfaceY) {
      const w = container.clientWidth, h = container.clientHeight;
      plots.forEach((plot, i) => {
        const b = bars[i];
        const show = plot.stage !== Stage.Empty;
        const c = plot.center, y = surfaceY + ABOVE_PLOT;
        const mid = show ? toScreen(c.x, y, c.z, camera, w, h) : null;
        const visible = show && !mid.behind;
        if (visible !== b.shown) {
          b.shown = visible;
          b.bar.style.display = visible ? 'block' : 'none';
        }
        if (!visible) return;

        // Width follows the plot's size on screen, so bars never overlap.
        const left = toScreen(c.x - plotWidth / 2, y, c.z, camera, w, h);
        const right = toScreen(c.x + plotWidth / 2, y, c.z, camera, w, h);
        const bw = Math.min(MAX_W, Math.max(MIN_W, (right.x - left.x) * 0.6));
        b.bar.style.width = `${bw}px`;
        b.bar.style.transform = `translate(${mid.x - bw / 2}px, ${mid.y}px)`;

        const ripe = plot.stage === Stage.Ripe;
        if (ripe !== b.ripe) {
          b.ripe = ripe;
          b.bar.classList.toggle('plot-bar--ripe', ripe);
        }
        const pct = ripe ? 100 : plot.percent;
        if (pct !== b.pct) {
          b.pct = pct;
          b.fill.style.width = `${pct}%`;
        }
      });
    },
  };
}
