// scene.js - the 3D farm in Three.js.
//
// 32 raised soil plots in the same 8 x 4 layout as the console (row 0 at the
// back). Each crop is the firmware's pixel sprite, built from small boxes
// ("voxels") in one InstancedMesh per plot. Mouse: hover selects a plot,
// click acts on it, drag orbits the camera, wheel zooms.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID_COLS, TILE_COUNT, Stage } from './game.js';
import { spriteFor } from './sprites.js';

const PX = 0.1;                           // one sprite pixel, in world units
const PLOT_W = 1.5, PLOT_D = 1.3, PLOT_H = 0.22;
const PITCH_X = PLOT_W + 0.25, PITCH_Z = PLOT_D + 0.35;
const BAR_W = PLOT_W - 0.3;
const CLICK_SLOP_PX = 6;                  // pointer travel that still counts as a click

const COLORS = {
  background: '#0E1411',
  ground: '#1D2E1F',
  soil: '#5A4030',
  soilTop: '#46301F',
  barBack: '#2E2519',
  ripe: '#F2C14E',
};

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const barFillGeo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0);  // grows from its left edge
const voxelMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });

function plotCenter(i) {
  const col = i % GRID_COLS;
  const row = Math.floor(i / GRID_COLS);
  return new THREE.Vector3((col - (GRID_COLS - 1) / 2) * PITCH_X, 0, (row - 1.5) * PITCH_Z);
}

// A thin rectangular outline lying on a plot's top face.
function makeFrame(color, thickness, emissiveIntensity) {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity });
  const g = new THREE.Group();
  const w = PLOT_W + thickness, d = PLOT_D + thickness, h = 0.04;
  const sides = [
    [w, h, thickness, 0, -d / 2], [w, h, thickness, 0, d / 2],
    [thickness, h, d, -w / 2, 0], [thickness, h, d, w / 2, 0],
  ];
  for (const [sx, sy, sz, x, z] of sides) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, PLOT_H + h / 2, z);
    g.add(m);
  }
  return g;
}

function makePlantMesh(pixels) {
  const mesh = new THREE.InstancedMesh(boxGeo, voxelMat, Math.max(1, pixels.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const c = new THREE.Color();
  pixels.forEach((px, k) => {
    // Pixel (x, y) -> centred on the plot, soil line (y = 12) at the surface.
    p.set((px.x + 0.5 - 8) * PX, (12.5 - px.y) * PX, 0);
    s.set(PX, PX, px.depth * PX);
    mesh.setMatrixAt(k, m.compose(p, q, s));
    mesh.setColorAt(k, c.set(px.color));
  });
  mesh.count = pixels.length;
  mesh.castShadow = true;
  return mesh;
}

export function createScene(container, { onHover, onPress, accent }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return null; // no WebGL: main.js shows a message instead
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.Fog(COLORS.background, 22, 45);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 10.5, 12.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.3);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 8;
  controls.maxDistance = 24;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.2;   // never below the ground
  controls.update();

  addLights(scene);
  addGround(scene);

  const plots = buildPlots(scene);
  const cursorFrame = makeFrame(accent, 0.09, 0.6);
  cursorFrame.position.y = 0.005;  // sits just above the ripe ring
  scene.add(cursorFrame);

  wirePointer(renderer.domElement, camera, plots, onHover, onPress);
  watchSize(container, renderer, camera, controls);

  const clock = new THREE.Clock();
  return {
    setCursor(i) {
      cursorFrame.position.x = plots[i].center.x;
      cursorFrame.position.z = plots[i].center.z;
    },
    syncTile(i, stage, crop, percent) { syncTile(plots[i], stage, crop, percent); },
    floatText(i, text, kind) { floatText(container, camera, plots[i].center, text, kind); },
    render() {
      const t = clock.getElapsedTime();
      for (const plot of plots) {
        // Ripe crops bob gently so they read as "ready" from any angle.
        plot.plant.position.y = PLOT_H + (plot.ripe ? 0.04 * (1 + Math.sin(t * 3 + plot.index)) : 0);
      }
      controls.update();
      renderer.render(scene, camera);
    },
  };
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight('#D6ECFF', '#2A3A2E', 1.2));
  const sun = new THREE.DirectionalLight('#FFF1D6', 2.2);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
}

function addGround(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildPlots(scene) {
  const soilMat = new THREE.MeshStandardMaterial({ color: COLORS.soil, roughness: 1 });
  const topMat = new THREE.MeshStandardMaterial({ color: COLORS.soilTop, roughness: 1 });
  const barBackMat = new THREE.MeshStandardMaterial({ color: COLORS.barBack });
  const barFillMat = new THREE.MeshStandardMaterial({ color: '#A6E35F', emissive: '#A6E35F', emissiveIntensity: 0.4 });
  const plots = [];

  for (let i = 0; i < TILE_COUNT; i++) {
    const center = plotCenter(i);
    const group = new THREE.Group();
    group.position.copy(center);

    const soil = new THREE.Mesh(boxGeo, soilMat);
    soil.scale.set(PLOT_W, PLOT_H, PLOT_D);
    soil.position.y = PLOT_H / 2;
    soil.receiveShadow = true;
    soil.userData.index = i;
    const top = new THREE.Mesh(boxGeo, topMat);   // darker tilled inset
    top.scale.set(PLOT_W - 0.16, 0.02, PLOT_D - 0.16);
    top.position.y = PLOT_H + 0.005;
    top.receiveShadow = true;
    top.userData.index = i;

    const ripeRing = makeFrame(COLORS.ripe, 0.05, 0.45);
    ripeRing.visible = false;

    const bar = new THREE.Group();   // progress bar along the plot's front edge
    bar.position.set(0, 0.08, PLOT_D / 2 + 0.08);
    const barBack = new THREE.Mesh(boxGeo, barBackMat);
    barBack.scale.set(BAR_W, 0.06, 0.06);
    const fill = new THREE.Mesh(barFillGeo, barFillMat);
    fill.position.set(-BAR_W / 2, 0, 0.01);
    fill.scale.set(0.001, 0.07, 0.07);
    bar.add(barBack, fill);
    bar.visible = false;

    const plant = new THREE.Group();
    plant.position.y = PLOT_H;

    group.add(soil, top, ripeRing, bar, plant);
    scene.add(group);
    plots.push({ index: i, center, soil, top, ripeRing, bar, fill, plant, mesh: null, key: '', ripe: false });
  }
  return plots;
}

// Rebuilds a plot's voxels only when its stage or crop changes.
function syncTile(plot, stage, crop, percent) {
  const key = `${stage}:${crop}`;
  if (key !== plot.key) {
    plot.key = key;
    if (plot.mesh) {
      plot.plant.remove(plot.mesh);
      plot.mesh.dispose();
      plot.mesh = null;
    }
    const pixels = spriteFor(stage, crop);
    if (pixels.length) {
      plot.mesh = makePlantMesh(pixels);
      plot.mesh.userData.index = plot.index;
      plot.plant.add(plot.mesh);
    }
    plot.ripe = stage === Stage.Ripe;
    plot.ripeRing.visible = plot.ripe;
  }
  const growing = stage !== Stage.Empty && stage !== Stage.Ripe;
  plot.bar.visible = growing;
  if (growing) plot.fill.scale.x = Math.max(0.001, (BAR_W * percent) / 100);
}

// Hover moves the cursor; a click (press and release without dragging)
// presses the plot under the pointer. Plants are pickable too, so clicking a
// tall crop hits its own plot, not the one behind it.
function wirePointer(canvas, camera, plots, onHover, onPress) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0, down = false;

  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets = [];
    for (const p of plots) {
      targets.push(p.soil, p.top);
      if (p.mesh) targets.push(p.mesh);
    }
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.index : -1;
  };

  canvas.addEventListener('pointermove', (e) => {
    if (down && e.buttons) return;  // dragging the camera
    const i = pick(e);
    canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    if (i >= 0) onHover(i);
  });
  canvas.addEventListener('pointerdown', (e) => {
    down = true;
    downX = e.clientX;
    downY = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = down && Math.hypot(e.clientX - downX, e.clientY - downY) < CLICK_SLOP_PX;
    down = false;
    if (!wasClick || e.button !== 0) return;
    const i = pick(e);
    if (i >= 0) onPress(i);
  });
}

// Keeps the canvas sized to its box and moves the camera back far enough
// that all 8 columns fit across, whatever the window shape.
function watchSize(container, renderer, camera, controls) {
  const farmWidth = GRID_COLS * PITCH_X + 1;
  const fit = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1.2 ? 50 : 35;
    camera.updateProjectionMatrix();

    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const dist = ((farmWidth / 2) / Math.tan(halfH)) * 1.2;   // 1.2: room for the nearer front row
    controls.maxDistance = Math.max(24, dist * 1.4);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, Math.max(controls.minDistance, dist));
    controls.update();
  };
  new ResizeObserver(fit).observe(container);
  fit();
}

// "+$2" / "-$1" text that rises from a plot and fades out.
function floatText(container, camera, center, text, kind) {
  const p = center.clone();
  p.y = PLOT_H + 1.3;
  p.project(camera);
  const el = document.createElement('span');
  el.className = `float-text float-text--${kind}`;
  el.textContent = text;
  el.style.left = `${((p.x + 1) / 2) * 100}%`;
  el.style.top = `${((1 - p.y) / 2) * 100}%`;
  el.addEventListener('animationend', () => el.remove());
  container.appendChild(el);
}
