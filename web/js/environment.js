// environment.js - everything around the plots that makes the field feel
// alive: lighting, patchy grass, tufts and flowers, a fence, voxel trees, a
// pond and drifting pollen. Positions come from a seeded random generator, so
// the scenery looks the same on every load.
import * as THREE from 'three';

const box = new THREE.BoxGeometry(1, 1, 1);

// Field extent (plots plus a margin); scenery stays outside it.
const FIELD_X = 7.4, FIELD_Z = 3.7;

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {   // mulberry32
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const outsideField = (x, z, margin) => Math.abs(x) > FIELD_X + margin || Math.abs(z) > FIELD_Z + margin;

export const SKY = '#24402C';   // background and fog: far grass fades into it

export function createEnvironment(scene) {
  const rand = seededRandom(20261117);
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 26, 58);

  addLights(scene);
  addGround(scene, rand);
  addFieldBed(scene);
  addFence(scene);
  addTufts(scene, rand);
  addFlowers(scene, rand);
  addTrees(scene, rand);
  addPond(scene);
  const pollen = addPollen(scene, rand);

  return { update: (t) => pollen.update(t) };
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight('#EAF4FF', '#4A5A35', 1.15));
  const sun = new THREE.DirectionalLight('#FFE2B0', 2.5);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 50 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
}

// A big plane whose vertices get one of several greens, in soft patches.
function addGround(scene, rand) {
  const geo = new THREE.PlaneGeometry(130, 130, 90, 90);
  geo.rotateX(-Math.PI / 2);
  const greens = ['#3D6A31', '#46773A', '#507F3C', '#3A6230', '#5A8A42'].map((c) => new THREE.Color(c));
  const colors = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // Low-frequency waves pick the patch colour; a little noise breaks it up.
    const n = Math.sin(x * 0.35) + Math.cos(z * 0.42) + Math.sin((x + z) * 0.21) + rand() * 0.8;
    const c = greens[Math.min(greens.length - 1, Math.max(0, Math.floor((n + 3) * 0.95)))];
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// Dark tilled earth under the whole plot grid.
function addFieldBed(scene) {
  const bed = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: '#3B2A1E', roughness: 1 }));
  bed.scale.set(FIELD_X * 2 + 0.4, 0.06, FIELD_Z * 2 + 0.6);
  bed.position.y = 0.03;
  bed.receiveShadow = true;
  scene.add(bed);
}

// Posts and two rails around the field, with a gate gap at the front.
function addFence(scene) {
  const wood = new THREE.MeshStandardMaterial({ color: '#8A6A45', roughness: 0.9 });
  const fx = FIELD_X + 0.6, fz = FIELD_Z + 0.7, gate = 1.4;
  const posts = [];
  for (let x = -fx; x <= fx + 0.01; x += 1.0) {
    posts.push([x, -fz]);
    if (Math.abs(x) > gate) posts.push([x, fz]);
  }
  for (let z = -fz + 1; z < fz - 0.01; z += 1.0) posts.push([-fx, z], [fx, z]);

  const postMesh = new THREE.InstancedMesh(box, wood, posts.length);
  const m = new THREE.Matrix4();
  posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m.compose(
    new THREE.Vector3(x, 0.32, z), new THREE.Quaternion(), new THREE.Vector3(0.14, 0.64, 0.14))));
  postMesh.castShadow = true;
  scene.add(postMesh);

  const rail = (x, z, lx, lz) => {
    for (const y of [0.24, 0.5]) {
      const r = new THREE.Mesh(box, wood);
      r.scale.set(lx, 0.07, lz);
      r.position.set(x, y, z);
      r.castShadow = true;
      scene.add(r);
    }
  };
  rail(0, -fz, fx * 2, 0.07);                          // back
  const half = fx - gate;                              // front, split by the gate
  rail(-(gate + half / 2), fz, half, 0.07);
  rail(gate + half / 2, fz, half, 0.07);
  rail(-fx, 0, 0.07, fz * 2);                          // sides
  rail(fx, 0, 0.07, fz * 2);
}

function scatter(rand, count, radius, margin) {
  const out = [];
  while (out.length < count) {
    const x = (rand() * 2 - 1) * radius, z = (rand() * 2 - 1) * radius * 0.8;
    if (outsideField(x, z, margin)) out.push([x, z]);
  }
  return out;
}

function addTufts(scene, rand) {
  const spots = scatter(rand, 700, 30, 1.2);
  const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 1 }), spots.length * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const shades = ['#5E9A45', '#6FAE4E', '#4F8A3B', '#82BC5A'];
  let k = 0;
  for (const [x, z] of spots) {
    for (let b = 0; b < 3; b++) {   // three blades per tuft
      const h = 0.14 + rand() * 0.26;
      m.compose(new THREE.Vector3(x + (rand() - 0.5) * 0.2, h / 2, z + (rand() - 0.5) * 0.2), q,
                new THREE.Vector3(0.05, h, 0.05));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k++, c.set(shades[Math.floor(rand() * shades.length)]));
    }
  }
  scene.add(mesh);
}

function addFlowers(scene, rand) {
  const spots = scatter(rand, 120, 22, 1.4);
  const stems = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: '#4F8A3B' }), spots.length);
  const heads = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.6 }), spots.length);
  const petals = ['#F4F1E8', '#F2C14E', '#E98BB0', '#8FB8F0', '#F08A3C'];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    stems.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(0.04, 0.2, 0.04)));
    heads.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.24, z), q, new THREE.Vector3(0.13, 0.1, 0.13)));
    heads.setColorAt(i, c.set(petals[Math.floor(rand() * petals.length)]));
  });
  scene.add(stems, heads);
}

// Voxel trees on the sides and behind the field, never in front of the camera.
function addTrees(scene, rand) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6B4A2E', roughness: 1 });
  const leafMats = ['#2F6B34', '#3B7D3A', '#4C8F42'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  const spots = [
    [-11, -7], [-14, -2], [-12.5, 3], [-16, -9], [-9, -10.5], [-4, -11.5], [2, -12],
    [7.5, -11], [11.5, -8], [15, -3], [12.5, 2.5], [16.5, -10],
  ];
  for (const [x, z] of spots) {
    const s = 0.8 + rand() * 0.6;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(box, trunkMat);
    trunk.scale.set(0.45, 1.4, 0.45);
    trunk.position.y = 0.7;
    tree.add(trunk);
    [[1.9, 1.7], [1.4, 2.5], [0.8, 3.15]].forEach(([w, y], i) => {
      const leaves = new THREE.Mesh(box, leafMats[(i + Math.floor(rand() * 3)) % 3]);
      leaves.scale.set(w, 0.8, w);
      leaves.position.y = y;
      leaves.rotation.y = rand() * Math.PI;
      tree.add(leaves);
    });
    tree.traverse((o) => { o.castShadow = true; });
    tree.position.set(x, 0, z);
    tree.scale.setScalar(s);
    scene.add(tree);
  }
}

function addPond(scene) {
  const rim = new THREE.Mesh(new THREE.CircleGeometry(2.5, 28), new THREE.MeshStandardMaterial({ color: '#7A6A52' }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(-12.5, 0.015, 7);
  rim.scale.set(1.3, 1, 1);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 28),
    new THREE.MeshStandardMaterial({ color: '#3F86B0', roughness: 0.15, metalness: 0.1, emissive: '#16405A', emissiveIntensity: 0.4 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-12.5, 0.03, 7);
  water.scale.set(1.3, 1, 1);
  water.receiveShadow = true;
  scene.add(rim, water);
}

// Soft glowing specks that drift and bob over the field.
function addPollen(scene, rand) {
  const count = 70;
  const base = [];
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    base.push({ x: (rand() * 2 - 1) * 16, y: 0.6 + rand() * 2.6, z: (rand() * 2 - 1) * 10, p: rand() * Math.PI * 2, s: 0.3 + rand() * 0.5 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: '#FFF1B0', size: 0.12, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(points);
  return {
    update(t) {
      base.forEach((b, i) => {
        positions[i * 3] = b.x + Math.sin(t * b.s + b.p) * 0.8;
        positions[i * 3 + 1] = b.y + Math.sin(t * b.s * 1.7 + b.p) * 0.25;
        positions[i * 3 + 2] = b.z + Math.cos(t * b.s * 0.8 + b.p) * 0.6;
      });
      geo.attributes.position.needsUpdate = true;
    },
  };
}
