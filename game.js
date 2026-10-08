'use strict';
/* Voxel Paws — a tiny voxel dog game. Uses three.js r128 (loaded in index.html). */
(function () {
  // =====================================================================
  // Utilities
  // =====================================================================
  const TAU = Math.PI * 2;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const damp = (k, dt) => 1 - Math.pow(k, dt); // frame-rate independent smoothing
  function angleLerp(a, b, t) {
    const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    return a + d * t;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Shared geometry + material caches keep draw setup cheap on phones
  const geoCache = new Map();
  const matCache = new Map();
  function geo(w, h, d) {
    const k = w + '|' + h + '|' + d;
    let g = geoCache.get(k);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
    return g;
  }
  function mat(color) {
    let m = matCache.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
    return m;
  }
  function box(parent, w, h, d, color, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo(w, h, d), typeof color === 'string' ? mat(color) : color);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function pivot(parent, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  const shadowGeo = new THREE.CircleGeometry(0.5, 18);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false });
  function blob(sx, sz) {
    const m = new THREE.Mesh(shadowGeo, shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.05;
    m.scale.set(sx, sz, 1);
    m.renderOrder = 1;
    return m;
  }

  // Emoji + text sprites
  const emojiTex = new Map();
  function emojiTexture(e) {
    if (emojiTex.has(e)) return emojiTex.get(e);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.font = '50px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(e, 32, 36);
    const t = new THREE.CanvasTexture(c);
    emojiTex.set(e, t);
    return t;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function textSprite(text, height = 0.6) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = 'bold 40px -apple-system, "Segoe UI", sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 44;
    c.width = w; c.height = 72;
    ctx.font = font;
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(ctx, 0, 0, w, 72, 22);
    ctx.fill();
    ctx.fillStyle = '#3a2f45';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, 38);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    s.scale.set(height * w / 72, height, 1);
    return s;
  }

  // =====================================================================
  // Renderer, scene, camera
  // =====================================================================
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const SKY = 0xcfe6f2;
  const world = new THREE.Scene();
  world.background = new THREE.Color(SKY);
  const parkFog = new THREE.Fog(SKY, 24, 50);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  world.add(new THREE.HemisphereLight(0xffffff, 0xb9a88a, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(6, 12, 8);
  world.add(sun);

  const homeRoot = pivot(world);
  const roomGroup = pivot(homeRoot);
  const furnGroup = pivot(homeRoot);
  const parkRoot = pivot(world);
  parkRoot.visible = false;

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // =====================================================================
  // Game data
  // =====================================================================
  const SAVE_KEY = 'voxelpaws-save-v1';
  const MAX_ROOM = 14;
  const EXPAND_PRICE = { 6: 60, 8: 120, 10: 200, 12: 320 };

  const ITEMS = {
    bed:    { name: 'Dog bed',   icon: '🛏️', price: 35, solid: false },
    bowl:   { name: 'Food bowl', icon: '🥣', price: 20, solid: false },
    rug:    { name: 'Rug',       icon: '🧶', price: 15, solid: false },
    plant:  { name: 'Plant',     icon: '🪴', price: 20, solid: true },
    lamp:   { name: 'Lamp',      icon: '💡', price: 25, solid: true },
    table:  { name: 'Table',     icon: '🍽️', price: 30, solid: true },
    toybox: { name: 'Toy box',   icon: '🧸', price: 30, solid: true },
    shelf:  { name: 'Bookshelf', icon: '📚', price: 40, solid: true },
    sofa:   { name: 'Sofa',      icon: '🛋️', price: 45, solid: true },
  };

  const BREEDS = [
    { name: 'Golden', body: '#d9a441', dark: '#a8762a', light: '#f3d595' },
    { name: 'Choco',  body: '#7a4a2a', dark: '#4e2c16', light: '#b07a52' },
    { name: 'Shadow', body: '#34343a', dark: '#1d1d22', light: '#c27a3e' },
    { name: 'Snow',   body: '#f2efe8', dark: '#d6ccbb', light: '#ffffff' },
    { name: 'Pebble', body: '#8d939c', dark: '#5d626b', light: '#d3d6db' },
    { name: 'Ginger', body: '#d2652d', dark: '#9c4519', light: '#f4c9a2' },
  ];
  const DOG_NAMES = ['Biscuit', 'Pixel', 'Mochi', 'Pepper', 'Waffles', 'Nugget', 'Luna', 'Bean', 'Ziggy', 'Noodle', 'Maple', 'Cosmo', 'Pretzel', 'Juno', 'Toast'];

  function defaultState() {
    return {
      coins: 20,
      roomSize: 6,
      furniture: [
        { type: 'bed', i: 0, j: 3, rot: 1 },
        { type: 'bowl', i: 3, j: 0, rot: 0, filled: true },
        { type: 'rug', i: 3, j: 3, rot: 0 },
      ],
      inventory: { plant: 1 },
      dogs: [],
    };
  }
  let state = defaultState();

  let place = 'home';      // 'home' | 'park'
  let mode = 'normal';     // 'normal' | 'decorate'
  const dogs = [];
  let selected = null;
  let selectedInv = null;
  let placeRot = 0;
  let walkDist = 0;
  let walkEarn = 0;
  let tiredWarned = false;
  let zoom = 1;

  // =====================================================================
  // Furniture builders (each item fits in one 1×1 tile, facing +z)
  // =====================================================================
  const lampMat = new THREE.MeshLambertMaterial({ color: '#fff0c4', emissive: '#ffcf6b', emissiveIntensity: 0.65 });
  const BUILDERS = {
    bed(g) {
      box(g, 0.86, 0.1, 0.86, '#7b5ea7', 0, 0.05, 0);
      box(g, 0.64, 0.07, 0.62, '#d7c6ee', 0, 0.12, 0.05);
      box(g, 0.86, 0.26, 0.14, '#6a4f94', 0, 0.18, -0.36);
      box(g, 0.13, 0.2, 0.72, '#6a4f94', -0.365, 0.15, 0.07);
      box(g, 0.13, 0.2, 0.72, '#6a4f94', 0.365, 0.15, 0.07);
    },
    bowl(g) {
      box(g, 0.42, 0.12, 0.42, '#d64545', 0, 0.06, 0);
      box(g, 0.3, 0.02, 0.3, '#7d2323', 0, 0.115, 0);
      const food = pivot(g);
      box(food, 0.3, 0.05, 0.3, '#b0703a', 0, 0.13, 0);
      box(food, 0.08, 0.05, 0.08, '#8f5428', 0.06, 0.165, -0.05);
      box(food, 0.07, 0.05, 0.07, '#c98a4e', -0.07, 0.165, 0.06);
      g.userData.food = food;
    },
    rug(g) {
      box(g, 0.98, 0.03, 0.98, '#b84a5a', 0, 0.015, 0);
      box(g, 0.74, 0.035, 0.74, '#f0c27b', 0, 0.018, 0);
      box(g, 0.42, 0.04, 0.42, '#b84a5a', 0, 0.02, 0);
    },
    plant(g) {
      box(g, 0.36, 0.32, 0.36, '#c0693f', 0, 0.16, 0);
      box(g, 0.4, 0.06, 0.4, '#a6532f', 0, 0.33, 0);
      box(g, 0.3, 0.03, 0.3, '#5b3b25', 0, 0.36, 0);
      [[0, 0.6, 0, 0.3, 0.42, 0.3, '#4caf50'], [0.14, 0.76, 0.05, 0.22, 0.3, 0.22, '#66bb6a'],
       [-0.13, 0.8, -0.04, 0.2, 0.34, 0.2, '#43a047'], [0.02, 1.0, -0.02, 0.18, 0.22, 0.18, '#81c784'],
       [-0.05, 0.55, 0.15, 0.2, 0.2, 0.2, '#388e3c']]
        .forEach(([x, y, z, w, h, d, c]) => box(g, w, h, d, c, x, y, z));
    },
    lamp(g) {
      box(g, 0.32, 0.06, 0.32, '#3d3a40', 0, 0.03, 0);
      box(g, 0.06, 1.1, 0.06, '#3d3a40', 0, 0.6, 0);
      box(g, 0.42, 0.3, 0.42, lampMat, 0, 1.25, 0);
    },
    table(g) {
      box(g, 0.88, 0.08, 0.88, '#a67c52', 0, 0.62, 0);
      for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) box(g, 0.08, 0.58, 0.08, '#8a6440', x, 0.29, z);
      box(g, 0.12, 0.2, 0.12, '#5c8fd6', 0.15, 0.76, -0.1);
      box(g, 0.12, 0.1, 0.12, '#f06292', 0.15, 0.91, -0.1);
      box(g, 0.22, 0.05, 0.16, '#e57373', -0.18, 0.685, 0.12);
    },
    toybox(g) {
      box(g, 0.76, 0.42, 0.52, '#e8b84a', 0, 0.21, 0);
      box(g, 0.78, 0.08, 0.54, '#d0763c', 0, 0.3, 0);
      box(g, 0.18, 0.18, 0.18, '#d64545', -0.17, 0.5, 0);
      box(g, 0.3, 0.07, 0.08, '#f5f0e6', 0.13, 0.46, 0.05);
      box(g, 0.08, 0.12, 0.13, '#f5f0e6', -0.02, 0.46, 0.05);
      box(g, 0.08, 0.12, 0.13, '#f5f0e6', 0.28, 0.46, 0.05);
    },
    shelf(g) {
      const wood = '#7a5232';
      box(g, 0.06, 1.6, 0.36, wood, -0.43, 0.8, -0.27);
      box(g, 0.06, 1.6, 0.36, wood, 0.43, 0.8, -0.27);
      box(g, 0.92, 0.06, 0.36, wood, 0, 1.57, -0.27);
      box(g, 0.92, 0.06, 0.36, wood, 0, 0.03, -0.27);
      box(g, 0.8, 0.05, 0.34, wood, 0, 0.55, -0.27);
      box(g, 0.8, 0.05, 0.34, wood, 0, 1.06, -0.27);
      box(g, 0.8, 1.56, 0.03, '#5e3e25', 0, 0.8, -0.43);
      const r = mulberry32(7);
      const cols = ['#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4db6ac', '#ff8a65'];
      for (const base of [0.06, 0.575, 1.085]) {
        let x = -0.38;
        while (x < 0.33) {
          const w = 0.07 + r() * 0.05, h = 0.28 + r() * 0.14;
          if (x + w > 0.39) break;
          box(g, w, h, 0.24, cols[Math.floor(r() * cols.length)], x + w / 2, base + h / 2, -0.28);
          x += w + 0.01;
        }
      }
    },
    sofa(g) {
      box(g, 0.94, 0.3, 0.62, '#4f8a8b', 0, 0.2, 0.04);
      box(g, 0.72, 0.08, 0.5, '#6aa6a7', 0, 0.39, 0.08);
      box(g, 0.94, 0.44, 0.16, '#3f7273', 0, 0.53, -0.3);
      box(g, 0.12, 0.24, 0.62, '#3f7273', -0.41, 0.46, 0.04);
      box(g, 0.12, 0.24, 0.62, '#3f7273', 0.41, 0.46, 0.04);
      box(g, 0.22, 0.2, 0.08, '#f2c14e', -0.25, 0.54, -0.18);
    },
  };
  function buildItem(type) {
    const g = new THREE.Group();
    (BUILDERS[type] || BUILDERS.plant)(g);
    return g;
  }

  // =====================================================================
  // Home: room + furniture
  // =====================================================================
  let floorMat = null;
  let grid = null;
  function makeFloorMaterial(N) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const x = c.getContext('2d');
    x.fillStyle = '#d8b689'; x.fillRect(0, 0, 2, 2);
    x.fillStyle = '#cba579'; x.fillRect(0, 0, 1, 1); x.fillRect(1, 1, 1, 1);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(N / 2, N / 2);
    return new THREE.MeshLambertMaterial({ map: t });
  }

  function buildRoom() {
    roomGroup.clear();
    const N = state.roomSize;
    if (floorMat) { floorMat.map.dispose(); floorMat.dispose(); }
    floorMat = makeFloorMaterial(N);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(N, 0.12, N), floorMat);
    floor.position.set(N / 2, -0.06, N / 2);
    roomGroup.add(floor);

    const wall = '#f3dfc1', trim = '#c99f72';
    // back wall (z = 0) and left wall (x = 0); the front stays open toward the camera
    box(roomGroup, N + 0.2, 2.4, 0.2, wall, N / 2 - 0.1, 1.2, -0.1);
    box(roomGroup, 0.2, 2.4, N, wall, -0.1, 1.2, N / 2);
    box(roomGroup, N + 0.2, 0.16, 0.26, trim, N / 2 - 0.1, 0.08, -0.1);
    box(roomGroup, 0.26, 0.16, N, trim, -0.1, 0.08, N / 2);
    box(roomGroup, N + 0.24, 0.1, 0.26, trim, N / 2 - 0.12, 2.43, -0.1);
    box(roomGroup, 0.26, 0.1, N, trim, -0.1, 2.43, N / 2);
    box(roomGroup, N, 0.14, 0.08, '#b98d5f', N / 2, -0.06, N + 0.04);
    box(roomGroup, 0.08, 0.14, N + 0.08, '#b98d5f', N + 0.04, -0.06, N / 2 + 0.04);

    // windows on the back wall
    for (let x = 2; x <= N - 1; x += 4) {
      box(roomGroup, 1.2, 0.95, 0.06, '#ffffff', x, 1.45, 0.02);
      box(roomGroup, 1.02, 0.77, 0.07, '#a9d8f5', x, 1.45, 0.03);
      box(roomGroup, 0.06, 0.77, 0.08, '#ffffff', x, 1.45, 0.035);
      box(roomGroup, 1.02, 0.06, 0.08, '#ffffff', x, 1.45, 0.035);
    }
    // pictures on the left wall
    const arts = ['#f6a5c0', '#9ad0a7', '#ffd27a', '#a7b8f5'];
    let n = 0;
    for (let z = 2; z <= N - 1; z += 4) {
      box(roomGroup, 0.06, 0.66, 0.86, '#8a5a3b', 0.03, 1.5, z);
      box(roomGroup, 0.07, 0.5, 0.7, arts[n++ % arts.length], 0.035, 1.5, z);
      box(roomGroup, 0.08, 0.16, 0.16, '#ffffff', 0.04, 1.58, z + 0.15);
    }

    if (grid) { homeRoot.remove(grid); grid.geometry.dispose(); }
    grid = new THREE.GridHelper(N, N, 0x7a5a3a, 0x7a5a3a);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.position.set(N / 2, 0.012, N / 2);
    grid.visible = mode === 'decorate';
    homeRoot.add(grid);
  }

  const furnRT = new Map(); // furniture entry -> { group, claim }
  function rebuildFurniture() {
    furnGroup.clear();
    furnRT.clear();
    for (const f of state.furniture) {
      const g = buildItem(f.type);
      g.position.set(f.i + 0.5, 0, f.j + 0.5);
      g.rotation.y = (f.rot || 0) * Math.PI / 2;
      furnGroup.add(g);
      furnRT.set(f, { group: g, claim: null });
      if (f.type === 'bowl') g.userData.food.visible = !!f.filled;
    }
  }
  function refreshBowl(f) {
    const r = furnRT.get(f);
    if (r) r.group.userData.food.visible = !!f.filled;
  }
  const furnitureAt = (i, j) => state.furniture.find((f) => f.i === i && f.j === j);
  const tileCenter = (f) => new V3(f.i + 0.5, 0, f.j + 0.5);

  // =====================================================================
  // Park
  // =====================================================================
  const parkColliders = [];
  const sniffSpots = [];
  function onPath(x, z) {
    return (Math.abs(Math.abs(x) - 11) < 1.3 && Math.abs(z) < 12.3) ||
           (Math.abs(Math.abs(z) - 11) < 1.3 && Math.abs(x) < 12.3) ||
           (Math.abs(x) < 1.3 && z > 10);
  }
  const POND = { x0: 3, x1: 9, z0: -7, z1: -2 };

  function buildPark() {
    const r = mulberry32(42);
    box(parkRoot, 100, 0.1, 100, '#86c06c', 0, -0.05, 0);
    box(parkRoot, 39, 0.1, 39, '#8ccb72', 0, -0.045, 0);

    // path loop + entry path
    const pc = '#dcc694';
    box(parkRoot, 23.6, 0.04, 1.6, pc, 0, 0.02, -11);
    box(parkRoot, 23.6, 0.04, 1.6, pc, 0, 0.02, 11);
    box(parkRoot, 1.6, 0.04, 23.6, pc, -11, 0.021, 0);
    box(parkRoot, 1.6, 0.04, 23.6, pc, 11, 0.021, 0);
    box(parkRoot, 1.6, 0.04, 8.6, pc, 0, 0.022, 15.3);

    // pond
    box(parkRoot, 6.6, 0.06, 5.6, '#cdb88d', 6, 0.02, -4.5);
    box(parkRoot, 6, 0.07, 5, '#5aa7d6', 6, 0.03, -4.5);
    box(parkRoot, 0.5, 0.08, 0.5, '#7fbf5a', 4.5, 0.07, -3.5);
    box(parkRoot, 0.4, 0.08, 0.4, '#7fbf5a', 7.6, 0.07, -5.8);
    parkColliders.push({ x0: POND.x0, x1: POND.x1, z0: POND.z0, z1: POND.z1 });

    // fence with a gate at the front
    const fence = '#f4efe6';
    for (const y of [0.35, 0.65]) {
      box(parkRoot, 39.2, 0.1, 0.08, fence, 0, y, -19.6);
      box(parkRoot, 0.08, 0.1, 39.2, fence, -19.6, y, 0);
      box(parkRoot, 0.08, 0.1, 39.2, fence, 19.6, y, 0);
      box(parkRoot, 18.1, 0.1, 0.08, fence, -10.55, y, 19.6);
      box(parkRoot, 18.1, 0.1, 0.08, fence, 10.55, y, 19.6);
    }
    const posts = [];
    for (let t = -19.6; t <= 19.61; t += 1.96) {
      posts.push([t, -19.6], [-19.6, t], [19.6, t]);
      if (Math.abs(t) > 1.6) posts.push([t, 19.6]);
    }
    const postMesh = new THREE.InstancedMesh(geo(0.16, 0.85, 0.16), mat(fence), posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach(([x, z], i) => { m4.makeTranslation(x, 0.42, z); postMesh.setMatrixAt(i, m4); });
    parkRoot.add(postMesh);
    box(parkRoot, 0.3, 1.5, 0.3, '#a0703f', -1.6, 0.75, 19.6);
    box(parkRoot, 0.3, 1.5, 0.3, '#a0703f', 1.6, 0.75, 19.6);
    const sign = textSprite('🏠 Home', 0.7);
    sign.position.set(0, 1.9, 19.6);
    parkRoot.add(sign);

    // sniff spots: bushes and hydrants with a sparkle when there's something to find
    const spotPos = [[-12.6, -4], [-6, -12.6], [5, -9.4], [12.6, 3], [9.6, -8.5], [-9.4, 7], [6, 12.6], [-3, 9.4]];
    spotPos.forEach(([x, z], i) => {
      const g = pivot(parkRoot, x, 0, z);
      if (i % 2 === 0) {
        box(g, 0.7, 0.5, 0.7, '#4f9a45', 0, 0.25, 0);
        box(g, 0.5, 0.3, 0.5, '#5fae54', 0.05, 0.6, -0.03);
        box(g, 0.1, 0.1, 0.1, '#e94f6a', 0.2, 0.55, 0.3);
      } else {
        box(g, 0.3, 0.5, 0.3, '#d63c3c', 0, 0.25, 0);
        box(g, 0.36, 0.08, 0.36, '#b52e2e', 0, 0.52, 0);
        box(g, 0.2, 0.12, 0.2, '#d63c3c', 0, 0.62, 0);
        box(g, 0.44, 0.1, 0.1, '#b52e2e', 0, 0.32, 0);
      }
      const sparkle = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('✨'), transparent: true, depthWrite: false }));
      sparkle.scale.set(0.5, 0.5, 1);
      sparkle.position.set(0, 1.15, 0);
      g.add(sparkle);
      parkColliders.push({ x, z, r: 0.42 });
      sniffSpots.push({ pos: new V3(x, 0, z), cooldown: 0, sparkle, taken: null, phase: r() * 6 });
    });

    // trees
    const trees = [];
    for (let tries = 0; tries < 400 && trees.length < 34; tries++) {
      const x = (r() * 2 - 1) * 18, z = (r() * 2 - 1) * 18;
      if (onPath(x, z)) continue;
      if (x > POND.x0 - 1.5 && x < POND.x1 + 1.5 && z > POND.z0 - 1.5 && z < POND.z1 + 1.5) continue;
      if (Math.abs(x) < 3.5 && z > 12) continue;
      if (spotPos.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 2.2)) continue;
      if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 2.6)) continue;
      trees.push([x, z]);
      const h = 0.9 + r() * 0.6;
      const greens = [['#4caf50', '#66bb6a'], ['#3e8e41', '#58a85c'], ['#6aa84f', '#8bc34a']][Math.floor(r() * 3)];
      box(parkRoot, 0.32, h, 0.32, '#7a5232', x, h / 2, z);
      box(parkRoot, 1.5, 1.0, 1.5, greens[0], x, h + 0.4, z);
      box(parkRoot, 1.05, 0.75, 1.05, greens[1], x, h + 1.2, z);
      box(parkRoot, 0.5, 0.4, 0.5, greens[1], x + 0.55, h + 0.35, z + 0.4);
      parkColliders.push({ x, z, r: 0.45 });
    }

    // benches
    for (const [x, z, ry] of [[-4, -12.6, 0], [3.5, 12.6, Math.PI], [12.6, -3, -Math.PI / 2]]) {
      const g = pivot(parkRoot, x, 0, z);
      g.rotation.y = ry;
      box(g, 1.6, 0.08, 0.45, '#a0703f', 0, 0.42, 0);
      box(g, 1.6, 0.35, 0.08, '#a0703f', 0, 0.68, -0.2);
      box(g, 0.1, 0.4, 0.4, '#555', -0.65, 0.2, 0);
      box(g, 0.1, 0.4, 0.4, '#555', 0.65, 0.2, 0);
    }
    // lamp posts at path corners
    for (const [x, z] of [[-12.4, -12.4], [12.4, -12.4], [-12.4, 12.4], [12.4, 12.4]]) {
      box(parkRoot, 0.14, 2.2, 0.14, '#3d3a40', x, 1.1, z);
      box(parkRoot, 0.36, 0.3, 0.36, lampMat, x, 2.3, z);
    }

    // grass tufts and flowers as instanced meshes (one draw call each)
    const tuft = new THREE.InstancedMesh(geo(0.12, 0.16, 0.12), mat('#6ba95a'), 260);
    const flower = new THREE.InstancedMesh(geo(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: '#ffffff' }), 140);
    const fcols = ['#f06292', '#ffd54f', '#ffffff', '#ba68c8', '#ff8a65'].map((c) => new THREE.Color(c));
    let ti = 0, fi = 0;
    while (ti < 260 || fi < 140) {
      const x = (r() * 2 - 1) * 19, z = (r() * 2 - 1) * 19;
      if (onPath(x, z) || (x > POND.x0 - 0.4 && x < POND.x1 + 0.4 && z > POND.z0 - 0.4 && z < POND.z1 + 0.4)) continue;
      if (ti < 260) { m4.makeTranslation(x, 0.07, z); tuft.setMatrixAt(ti++, m4); }
      else { m4.makeTranslation(x, 0.07, z); flower.setMatrixAt(fi, m4); flower.setColorAt(fi, fcols[fi % fcols.length]); fi++; }
    }
    parkRoot.add(tuft, flower);
  }

  // =====================================================================
  // Collision helpers (shared by the player and dogs)
  // =====================================================================
  function isSolid(x, z) {
    if (place === 'home') {
      const f = furnitureAt(Math.floor(x), Math.floor(z));
      return !!(f && ITEMS[f.type].solid);
    }
    for (const c of parkColliders) {
      if (c.r !== undefined) { if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true; }
      else if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
    }
    return false;
  }
  function bounds() {
    if (place === 'home') return [0.3, state.roomSize - 0.3];
    return [-19.2, 19.2];
  }
  function inBounds(x, z, m = 0) {
    const [a, b] = bounds();
    return x >= a + m && x <= b - m && z >= a + m && z <= b - m;
  }
  // Move separately along x and z so characters slide along obstacles
  function moveWithCollision(pos, dx, dz, r) {
    if (dx) {
      const s = Math.sign(dx);
      if (!(isSolid(pos.x + dx + s * r, pos.z) && !isSolid(pos.x + s * r, pos.z))) pos.x += dx;
    }
    if (dz) {
      const s = Math.sign(dz);
      if (!(isSolid(pos.x, pos.z + dz + s * r) && !isSolid(pos.x, pos.z + s * r))) pos.z += dz;
    }
    const [a, b] = bounds();
    pos.x = clamp(pos.x, a, b);
    pos.z = clamp(pos.z, a, b);
  }

  // =====================================================================
  // Particles & small effects
  // =====================================================================
  const particles = [];
  function spawnEmoji(e, pos, opts = {}) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(e), transparent: true, depthWrite: false }));
    s.position.copy(pos);
    const size = opts.size || 0.45;
    s.scale.set(size, size, 1);
    world.add(s);
    const life = opts.life || 1.2;
    particles.push({ s, life, max: life, vy: opts.vy ?? 0.9, vx: rand(-0.25, 0.25) });
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.s.position.y += p.vy * dt;
      p.s.position.x += p.vx * dt;
      p.s.material.opacity = clamp(p.life / p.max * 1.6, 0, 1);
      if (p.life <= 0) {
        world.remove(p.s);
        p.s.material.dispose();
        particles.splice(i, 1);
      }
    }
  }

  const tapRing = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.27, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  tapRing.rotation.x = -Math.PI / 2;
  world.add(tapRing);
  let tapT = 0;
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.6, 28),
    new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthWrite: false }));
  selRing.rotation.x = -Math.PI / 2;
  world.add(selRing);

  function addCoins(n, pos) {
    state.coins += n;
    if (place === 'park') walkEarn += n;
    if (pos) spawnEmoji('🪙', pos.clone().add(new V3(0, 1.2, 0)), { size: 0.45, vy: 1.1 });
    updateHud();
  }

  // =====================================================================
  // Player
  // =====================================================================
  function makePlayer() {
    const root = new THREE.Group();
    const body = pivot(root);
    const shirt = '#5b7cfa', pants = '#3a3f5c', skin = '#f1c8a0', hair = '#5a3a22', shoe = '#2a2a2a';
    const legL = pivot(body, -0.11, 0.5, 0), legR = pivot(body, 0.11, 0.5, 0);
    for (const l of [legL, legR]) {
      box(l, 0.16, 0.42, 0.18, pants, 0, -0.21, 0);
      box(l, 0.17, 0.08, 0.24, shoe, 0, -0.46, 0.03);
    }
    box(body, 0.42, 0.46, 0.24, shirt, 0, 0.73, 0);
    const armL = pivot(body, -0.28, 0.92, 0), armR = pivot(body, 0.28, 0.92, 0);
    for (const a of [armL, armR]) {
      box(a, 0.13, 0.4, 0.14, shirt, 0, -0.18, 0);
      box(a, 0.12, 0.1, 0.13, skin, 0, -0.43, 0);
    }
    const hand = pivot(armR, 0, -0.48, 0.04);
    box(body, 0.36, 0.36, 0.34, skin, 0, 1.15, 0);
    box(body, 0.38, 0.12, 0.36, hair, 0, 1.36, -0.01);
    box(body, 0.38, 0.26, 0.08, hair, 0, 1.24, -0.16);
    box(body, 0.05, 0.07, 0.02, '#222', -0.08, 1.17, 0.171);
    box(body, 0.05, 0.07, 0.02, '#222', 0.08, 1.17, 0.171);
    box(body, 0.08, 0.03, 0.02, '#e2958a', 0, 1.07, 0.171);
    root.add(blob(0.8, 0.8));
    world.add(root);
    return { root, body, legL, legR, armL, armR, hand, moveTarget: null, phase: 0, blend: 0, face: 0, throwT: 0 };
  }
  const player = makePlayer();

  const keys = {};
  window.addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  const joy = { active: false, x: 0, y: 0 };
  const camOffsetDir = new V3(0.42, 1.15, 1).normalize();
  const camFwd = new V3(-camOffsetDir.x, 0, -camOffsetDir.z).normalize();
  const camRight = new V3().crossVectors(camFwd, new V3(0, 1, 0)).normalize();

  function updatePlayer(dt) {
    const pos = player.root.position;
    let ix = 0, iy = 0;
    if (joy.active) { ix = joy.x; iy = joy.y; }
    const kx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    const ky = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    if (kx || ky) { ix = kx; iy = ky; }

    let mx = 0, mz = 0, mag = 0;
    if (ix || iy) {
      player.moveTarget = null;
      mag = Math.min(1, Math.hypot(ix, iy));
      mx = camRight.x * ix - camFwd.x * iy;
      mz = camRight.z * ix - camFwd.z * iy;
      const l = Math.hypot(mx, mz) || 1;
      mx /= l; mz /= l;
    } else if (player.moveTarget) {
      const dx = player.moveTarget.x - pos.x, dz = player.moveTarget.z - pos.z, d = Math.hypot(dx, dz);
      if (d < 0.12) player.moveTarget = null;
      else { mx = dx / d; mz = dz / d; mag = 1; }
    }

    let moved = 0;
    if (mag > 0.05) {
      const ox = pos.x, oz = pos.z;
      const sp = 3.3 * mag;
      moveWithCollision(pos, mx * sp * dt, mz * sp * dt, 0.25);
      moved = Math.hypot(pos.x - ox, pos.z - oz);
      if (moved < 0.0005 && player.moveTarget) player.moveTarget = null;
      player.face = Math.atan2(mx, mz);
    }
    player.root.rotation.y = angleLerp(player.root.rotation.y, player.face, damp(0.0002, dt));

    if (place === 'park') {
      walkDist += moved;
      while (walkDist >= 10) { walkDist -= 10; addCoins(1, pos); }
      if (pos.z > 18.5 && Math.abs(pos.x) < 1.3) { goHome(); return; }
    }

    // walk animation
    player.phase += moved * 4.2;
    player.blend = lerp(player.blend, moved > 0 ? 1 : 0, damp(0.0005, dt));
    const s = Math.sin(player.phase) * 0.7 * player.blend;
    player.legL.rotation.x = s;
    player.legR.rotation.x = -s;
    player.armL.rotation.x = -s * 0.8;
    player.body.position.y = Math.abs(Math.sin(player.phase)) * 0.04 * player.blend;
    if (player.throwT > 0) { player.throwT -= dt; player.armR.rotation.x = -2.4; }
    else if (place === 'park') player.armR.rotation.x = lerp(player.armR.rotation.x, -0.45 + s * 0.2, damp(0.001, dt));
    else player.armR.rotation.x = s * 0.8;
  }

  // =====================================================================
  // Dogs
  // =====================================================================
  const tmpA = new V3(), tmpB = new V3(), tmpC = new V3();

  class Dog {
    constructor(data) {
      this.name = data.name || 'Pup';
      this.breed = clamp(data.breed | 0, 0, BREEDS.length - 1);
      this.hunger = data.hunger ?? 85;
      this.energy = data.energy ?? 85;
      this.happy = data.happy ?? 75;
      this.state = 'idle';
      this.timer = rand(1, 3);
      this.stateTime = 0;
      this.t = Math.random() * 10;
      this.phase = 0;
      this.walkBlend = 0;
      this.poseY = 0;
      this.moving = false;
      this.curSpeed = 0;
      this.face = 0;
      this.target = null;
      this.onArrive = null;
      this.claim = null;
      this.spot = null;
      this.zTimer = 0;
      this.sniffCheck = 2;
      this.lastBubble = '';
      this.build();
    }

    build() {
      const b = BREEDS[this.breed];
      const root = new THREE.Group();
      const body = pivot(root);
      box(body, 0.46, 0.32, 0.72, b.body, 0, 0.44, 0);
      box(body, 0.3, 0.06, 0.5, b.light, 0, 0.27, 0.02);
      box(body, 0.4, 0.1, 0.12, '#d93a3a', 0, 0.58, 0.32);       // collar
      box(body, 0.08, 0.08, 0.04, '#ffd54f', 0, 0.5, 0.39);        // tag

      const head = pivot(body, 0, 0.66, 0.42);
      box(head, 0.36, 0.32, 0.34, b.body, 0, 0, 0);
      box(head, 0.22, 0.15, 0.18, b.light, 0, -0.07, 0.24);
      box(head, 0.09, 0.07, 0.05, '#1a1a1a', 0, -0.02, 0.34);
      box(head, 0.06, 0.07, 0.02, '#1a1a1a', -0.09, 0.05, 0.172);
      box(head, 0.06, 0.07, 0.02, '#1a1a1a', 0.09, 0.05, 0.172);
      box(head, 0.02, 0.02, 0.01, '#ffffff', -0.075, 0.07, 0.184);
      box(head, 0.02, 0.02, 0.01, '#ffffff', 0.105, 0.07, 0.184);
      const earL = pivot(head, -0.17, 0.14, -0.02), earR = pivot(head, 0.17, 0.14, -0.02);
      box(earL, 0.08, 0.22, 0.15, b.dark, -0.02, -0.09, 0);
      box(earR, 0.08, 0.22, 0.15, b.dark, 0.02, -0.09, 0);
      this.tongue = box(head, 0.08, 0.02, 0.1, '#f07f8f', 0, -0.155, 0.28);
      this.tongue.visible = false;
      this.mouth = pivot(head, 0, -0.14, 0.38);

      const legs = [];
      for (const [x, z] of [[-0.14, 0.24], [0.14, 0.24], [-0.14, -0.24], [0.14, -0.24]]) {
        const p = pivot(body, x, 0.3, z);
        box(p, 0.12, 0.26, 0.12, b.body, 0, -0.12, 0);
        box(p, 0.13, 0.06, 0.15, b.light, 0, -0.26, 0.01);
        legs.push(p);
      }
      const tail = pivot(body, 0, 0.54, -0.36);
      box(tail, 0.08, 0.08, 0.22, b.body, 0, 0, -0.1);
      box(tail, 0.09, 0.09, 0.1, b.dark, 0, 0, -0.25);
      tail.rotation.x = 0.75;

      const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      bubble.scale.set(0.42, 0.42, 1);
      bubble.position.y = 1.25;
      bubble.visible = false;
      root.add(bubble);
      root.add(blob(0.75, 1.25));
      root.userData.dog = this;

      // leash: chain of thin boxes from the player's hand to the collar
      this.leash = new THREE.Group();
      this.leashSegs = [];
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(geo(0.035, 0.035, 1), mat('#c0392b'));
        this.leash.add(s);
        this.leashSegs.push(s);
      }
      this.leash.visible = false;
      world.add(this.leash);
      this.collar = pivot(body, 0, 0.58, 0.4);

      Object.assign(this, { root, body, head, earL, earR, legs, tail, bubble });
    }

    serialize() {
      return { name: this.name, breed: this.breed, hunger: Math.round(this.hunger), energy: Math.round(this.energy), happy: Math.round(this.happy) };
    }

    headWorld(up = 0) {
      return this.head.getWorldPosition(new V3()).add(new V3(0, up, 0));
    }
    faceTo(p) {
      this.face = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z);
    }

    // ----- state helpers -----
    setState(s, timer = 0) {
      this.state = s;
      this.timer = timer;
      this.stateTime = 0;
    }
    idle(t) {
      if (place === 'park') this.setState('follow');
      else this.setState('idle', t ?? rand(1.5, 4));
    }
    goTo(target, speed, onArrive, arriveDist = 0.2) {
      this.setState('move');
      this.target = target;
      this.moveSpeed = speed;
      this.onArrive = onArrive;
      this.arriveDist = arriveDist;
      this.stuckT = 0;
      this.stuckN = 0;
      this.lastD = Infinity;
    }
    claimItem(f) {
      this.releaseClaim();
      const r = furnRT.get(f);
      if (r) r.claim = this;
      this.claim = f;
    }
    releaseClaim() {
      if (this.claim) {
        const r = furnRT.get(this.claim);
        if (r && r.claim === this) r.claim = null;
        this.claim = null;
      }
    }
    dropSpot() {
      if (this.spot && this.spot.taken === this) this.spot.taken = null;
      this.spot = null;
    }
    reset() {
      if (this.state === 'fetch' || this.state === 'return') resetBall();
      this.releaseClaim();
      this.dropSpot();
      this.root.position.y = 0;
      this.onArrive = null;
      this.idle(0.5);
    }
    wake() {
      this.releaseClaim();
      this.root.position.y = 0;
      this.idle(0.5);
    }

    // ----- needs -----
    tickNeeds(dt) {
      if (place === 'park') {
        this.hunger -= 0.18 * dt;
        this.energy -= 0.22 * dt;
        if (this.energy > 10) this.happy += 0.15 * dt;
      } else {
        this.hunger -= 0.1 * dt;
        if (this.state === 'sleep') this.energy += 4 * dt;
        else this.energy -= 0.05 * dt;
        this.happy -= (this.hunger < 25 || this.energy < 10 ? 0.25 : 0.07) * dt;
      }
      this.hunger = clamp(this.hunger, 0, 100);
      this.energy = clamp(this.energy, 0, 100);
      this.happy = clamp(this.happy, 0, 100);
    }

    statusText() {
      switch (this.state) {
        case 'sleep': return 'Sleeping 💤';
        case 'eat': return 'Eating 😋';
        case 'fetch': case 'return': return 'Playing fetch 🎾';
        case 'sniff': return 'Sniffing around 👃';
        case 'happy': return 'So happy! 💕';
      }
      if (this.hunger < 30) return 'Hungry';
      if (this.energy < 20) return 'Tired';
      if (this.happy < 30) return 'Wants attention';
      if (place === 'park') return 'Enjoying the walk';
      if (this.happy > 80) return 'Very happy';
      return 'Content';
    }

    // ----- movement -----
    moveTowards(tx, tz, speed, dt) {
      const pos = this.root.position;
      const dx = tx - pos.x, dz = tz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) return 0;
      const step = Math.min(d, speed * dt);
      moveWithCollision(pos, (dx / d) * step, (dz / d) * step, 0.22);
      this.face = Math.atan2(dx, dz);
      this.moving = true;
      this.curSpeed = speed;
      return Math.hypot(tx - pos.x, tz - pos.z);
    }

    // ----- main update -----
    update(dt) {
      this.stateTime += dt;
      this.moving = false;
      this.tickNeeds(dt);
      switch (this.state) {
        case 'idle':
          this.timer -= dt;
          if (this.timer <= 0) this.decide();
          else if (player.root.position.distanceTo(this.root.position) < 3) this.faceTo(player.root.position);
          break;
        case 'follow': this.updateFollow(dt); break;
        case 'move': this.updateMove(dt); break;
        case 'sit':
          this.timer -= dt;
          if (this.timer <= 0) this.idle();
          break;
        case 'sleep':
          this.zTimer -= dt;
          if (this.zTimer <= 0) { this.zTimer = 1.6; spawnEmoji('💤', this.headWorld(0.3), { size: 0.35, life: 1.6, vy: 0.5 }); }
          if (this.energy >= 99) this.wake();
          break;
        case 'eat':
          this.timer -= dt;
          if (this.timer <= 0) this.finishEat();
          break;
        case 'sniff':
          this.timer -= dt;
          if (this.timer <= 0) this.finishSniff();
          break;
        case 'happy':
          this.timer -= dt;
          if (this.timer <= 0) this.idle();
          break;
        case 'fetch': this.updateFetch(dt); break;
        case 'return': this.updateReturn(dt); break;
        default: this.idle();
      }
      if (place === 'park') this.applyLeash();
      this.root.rotation.y = angleLerp(this.root.rotation.y, this.face, damp(0.0004, dt));
      this.animate(dt);
      this.updateBubble();
    }

    decide() {
      if (place === 'park') { this.setState('follow'); return; }
      if (this.energy < 25) {
        const bed = findFurniture('bed', this, false, this.root.position);
        if (bed) {
          this.claimItem(bed);
          this.goTo(tileCenter(bed), 1.8, () => {
            const c = tileCenter(bed);
            this.root.position.set(c.x, 0.1, c.z);
            this.claim = bed;
            this.setState('sleep');
            this.zTimer = 0.5;
          }, 0.15);
          return;
        }
        if (this.energy < 12) { this.setState('sleep'); return; }
      }
      if (this.hunger < 60) {
        const bowl = findFurniture('bowl', this, true, this.root.position);
        if (bowl) {
          this.claimItem(bowl);
          this.goTo(tileCenter(bowl), 2.4, () => {
            this.claim = bowl;
            this.faceTo(tileCenter(bowl));
            this.setState('eat', 2.6);
          }, 0.5);
          return;
        }
      }
      const r = Math.random();
      if (r < 0.4) this.goTo(randomFreePoint(), 1.4, null, 0.2);
      else if (r < 0.6) this.goTo(() => player.root.position, 2.4, () => { this.faceTo(player.root.position); this.idle(rand(2, 4)); }, 1.2);
      else if (r < 0.8) this.setState('sit', rand(3, 6));
      else this.idle(rand(2, 4));
    }

    updateMove(dt) {
      const t = typeof this.target === 'function' ? this.target() : this.target;
      if (!t) { this.idle(); return; }
      const d = this.moveTowards(t.x, t.z, this.moveSpeed, dt);
      if (d <= this.arriveDist) {
        const cb = this.onArrive;
        this.onArrive = null;
        this.target = null;
        this.idle();
        if (cb) cb();
        return;
      }
      this.stuckT += dt;
      if (this.stuckT > 1) {
        this.stuckN = this.lastD - d < 0.15 ? this.stuckN + 1 : 0;
        this.lastD = d;
        this.stuckT = 0;
        if (this.stuckN >= 2 || this.stateTime > 15) {
          this.onArrive = null;
          this.releaseClaim();
          this.dropSpot();
          this.idle();
        }
      }
    }

    updateFollow(dt) {
      const pp = player.root.position, pos = this.root.position;
      const n = dogs.length, idx = dogs.indexOf(this);
      const a = player.root.rotation.y + Math.PI + (idx - (n - 1) / 2) * 0.75;
      const tx = pp.x + Math.sin(a) * 1.5, tz = pp.z + Math.cos(a) * 1.5;
      const d = Math.hypot(tx - pos.x, tz - pos.z);
      const tired = this.energy < 10 ? 0.6 : 1;
      if (d > 0.35) this.moveTowards(tx, tz, (d > 2.2 ? 4.2 : 2.4) * tired, dt);
      this.sniffCheck -= dt;
      if (this.sniffCheck <= 0) {
        this.sniffCheck = rand(1, 2.5);
        const spot = nearestSpot(pos, 4.5);
        if (spot && Math.random() < 0.6) {
          spot.taken = this;
          this.spot = spot;
          this.goTo(spot.pos, 3, () => {
            this.spot = spot;
            this.faceTo(spot.pos);
            this.setState('sniff', 2.2);
          }, 0.65);
        }
      }
    }

    applyLeash() {
      if (this.state === 'fetch' || this.state === 'return') return;
      const pp = player.root.position, pos = this.root.position;
      const dx = pos.x - pp.x, dz = pos.z - pp.z, d = Math.hypot(dx, dz), L = 3.2;
      if (d > L) {
        pos.x = pp.x + (dx / d) * L;
        pos.z = pp.z + (dz / d) * L;
        this.face = Math.atan2(-dx, -dz);
        this.moving = true;
        this.curSpeed = 3;
        if (this.state !== 'follow' && d > L + 0.3) {
          this.dropSpot();
          this.onArrive = null;
          this.setState('follow');
        }
      }
    }

    finishEat() {
      const bowl = this.claim;
      if (bowl && bowl.filled) {
        bowl.filled = false;
        refreshBowl(bowl);
        this.hunger = 100;
        this.happy = Math.min(100, this.happy + 5);
        spawnEmoji('😋', this.headWorld(0.4), { size: 0.4 });
      }
      this.releaseClaim();
      this.idle();
    }

    finishSniff() {
      const spot = this.spot;
      if (spot && spot.cooldown <= 0) {
        spot.cooldown = 45;
        this.happy = Math.min(100, this.happy + 10);
        addCoins(2, this.root.position);
        spawnEmoji('✨', this.headWorld(0.3), { size: 0.4 });
      }
      this.dropSpot();
      this.setState('follow');
    }

    startFetch() {
      this.releaseClaim();
      this.dropSpot();
      this.root.position.y = 0;
      this.onArrive = null;
      this.setState('fetch');
    }

    updateFetch(dt) {
      if (!ball.active || (ball.held && ball.held !== this)) { this.idle(); return; }
      const bp = ball.flying ? ball.to : ball.mesh.position;
      const d = this.moveTowards(bp.x, bp.z, 4.3 * (this.energy < 10 ? 0.6 : 1), dt);
      if (!ball.flying && d < 0.35) { ball.held = this; this.setState('return'); }
      else if (this.stateTime > 12) { resetBall(); this.idle(); }
    }

    updateReturn(dt) {
      const pp = player.root.position;
      const d = this.moveTowards(pp.x, pp.z, 3.6, dt);
      if (d < 1.0 || this.stateTime > 15) {
        resetBall();
        this.happy = Math.min(100, this.happy + 15);
        this.energy = Math.max(0, this.energy - 4);
        this.faceTo(pp);
        spawnEmoji('❤️', this.headWorld(0.4), { size: 0.4 });
        if (place === 'park') addCoins(1, this.root.position);
        this.setState('happy', 1.4);
      }
    }

    pet() {
      this.happy = Math.min(100, this.happy + 12);
      this.faceTo(player.root.position);
      this.setState('happy', 1.5);
      for (let i = 0; i < 3; i++) setTimeout(() => spawnEmoji('❤️', this.headWorld(0.35), { size: 0.4 }), i * 180);
    }

    // ----- animation -----
    animate(dt) {
      this.t += dt;
      this.walkBlend = lerp(this.walkBlend, this.moving ? 1 : 0, damp(0.0005, dt));
      if (this.moving) this.phase += dt * (4 + this.curSpeed * 3.2);
      const s = Math.sin(this.phase) * 0.75 * this.walkBlend;
      const st = this.state;
      const k = damp(0.003, dt);

      let poseY = 0, bodyRX = 0, headRX = 0, headY = 0.66, hop = 0;
      let legT = [s, -s, -s, s];
      let posed = false;
      if (st === 'sleep') { poseY = -0.21; legT = [-1.45, -1.45, 1.45, 1.45]; headRX = 0.15; headY = 0.6; posed = true; }
      else if (st === 'sit') { poseY = -0.06; bodyRX = -0.5; legT = [0.5, 0.5, -1.1, -1.1]; headRX = 0.45; posed = true; }
      else if (st === 'eat') { headRX = 0.75 + Math.sin(this.t * 14) * 0.12; headY = 0.6; }
      else if (st === 'sniff') { headRX = 0.6 + Math.sin(this.t * 22) * 0.06; }
      else if (st === 'happy') { hop = Math.abs(Math.sin(this.t * 9)) * 0.18; headRX = -0.25; }

      this.poseY = lerp(this.poseY, poseY, k);
      this.body.position.y = this.poseY + Math.abs(Math.sin(this.phase)) * 0.05 * this.walkBlend + hop;
      this.body.rotation.x = lerp(this.body.rotation.x, bodyRX, k);
      this.legs.forEach((l, i) => { l.rotation.x = posed ? lerp(l.rotation.x, legT[i], k) : lerp(l.rotation.x, legT[i], 0.5); });
      this.head.rotation.x = lerp(this.head.rotation.x, headRX, k * 1.5);
      this.head.position.y = lerp(this.head.position.y, headY, k);

      const wag = st === 'sleep' ? 1 : 5 + (this.happy / 100) * 14 + (st === 'happy' ? 8 : 0);
      this.tail.rotation.y = Math.sin(this.t * wag) * (st === 'sleep' ? 0.1 : 0.55);
      this.tail.rotation.x = lerp(this.tail.rotation.x, this.happy < 25 ? 0.1 : 0.75, k);
      const flap = Math.sin(this.phase * 2) * 0.22 * this.walkBlend + (st === 'happy' ? Math.sin(this.t * 18) * 0.2 : 0);
      this.earL.rotation.z = -0.12 + flap;
      this.earR.rotation.z = 0.12 - flap;
      this.tongue.visible = st === 'happy' || (this.moving && this.curSpeed > 3 && st !== 'return');
    }

    updateBubble() {
      let e = '';
      if (this.state !== 'sleep') {
        if (this.hunger < 30) e = '🍖';
        else if (this.energy < 15) e = '😴';
        else if (this.happy < 25) e = '💔';
      }
      if (e !== this.lastBubble) {
        this.lastBubble = e;
        this.bubble.visible = !!e;
        if (e) { this.bubble.material.map = emojiTexture(e); this.bubble.material.needsUpdate = true; }
      }
      if (e) this.bubble.position.y = 1.25 + Math.sin(this.t * 3) * 0.05;
    }

    updateLeash() {
      const show = place === 'park' && this.state !== 'fetch' && this.state !== 'return';
      this.leash.visible = show;
      if (!show) return;
      const A = player.hand.getWorldPosition(tmpA);
      const B = this.collar.getWorldPosition(tmpB);
      const dist = Math.hypot(A.x - B.x, A.z - B.z);
      const sag = clamp(3.2 - dist, 0, 3) * 0.28 + 0.05;
      const C = tmpC.set((A.x + B.x) / 2, (A.y + B.y) / 2 - sag * 2, (A.z + B.z) / 2);
      const n = this.leashSegs.length;
      let prev = new V3().copy(A);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const p = new V3(
          u * u * A.x + 2 * u * t * C.x + t * t * B.x,
          u * u * A.y + 2 * u * t * C.y + t * t * B.y,
          u * u * A.z + 2 * u * t * C.z + t * t * B.z);
        const seg = this.leashSegs[i - 1];
        seg.position.copy(prev).add(p).multiplyScalar(0.5);
        seg.scale.z = Math.max(0.001, prev.distanceTo(p));
        seg.lookAt(p);
        prev = p;
      }
    }
  }

  function findFurniture(type, dog, needFilled, from) {
    let best = null, bd = Infinity;
    for (const f of state.furniture) {
      if (f.type !== type) continue;
      if (needFilled && !f.filled) continue;
      const r = furnRT.get(f);
      if (r && r.claim && r.claim !== dog) continue;
      const d = from.distanceTo(tileCenter(f));
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function randomFreePoint() {
    const N = state.roomSize;
    for (let i = 0; i < 30; i++) {
      const x = rand(0.5, N - 0.5), z = rand(0.5, N - 0.5);
      if (!isSolid(x, z)) return new V3(x, 0, z);
    }
    return new V3(N / 2, 0, N / 2);
  }
  function nearestSpot(pos, maxD) {
    let best = null, bd = maxD;
    for (const s of sniffSpots) {
      if (s.cooldown > 0 || s.taken) continue;
      const d = pos.distanceTo(s.pos);
      if (d < bd && s.pos.distanceTo(player.root.position) < 4.2) { bd = d; best = s; }
    }
    return best;
  }
  function separateDogs() {
    for (let i = 0; i < dogs.length; i++) {
      for (let j = i + 1; j < dogs.length; j++) {
        const a = dogs[i].root.position, b = dogs[j].root.position;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 0.6 && d > 1e-4) {
          const p = (0.6 - d) / 2;
          a.x -= (dx / d) * p; a.z -= (dz / d) * p;
          b.x += (dx / d) * p; b.z += (dz / d) * p;
        }
      }
    }
  }

  function addDog(data, nearPlayer) {
    const d = new Dog(data);
    const p = player.root.position;
    if (nearPlayer) d.root.position.set(clamp(p.x + rand(-1, 1), 0.5, state.roomSize - 0.5), 0, clamp(p.z - 1, 0.5, state.roomSize - 0.5));
    else d.root.position.copy(randomFreePoint());
    d.root.rotation.y = d.face = rand(0, TAU);
    world.add(d.root);
    dogs.push(d);
    return d;
  }

  // =====================================================================
  // Ball
  // =====================================================================
  const ball = { mesh: new THREE.Group(), active: false, flying: false, t: 0, from: new V3(), to: new V3(), held: null, bounce: 0 };
  box(ball.mesh, 0.2, 0.2, 0.2, '#c9e04a');
  box(ball.mesh, 0.21, 0.04, 0.21, '#f4f7e6');
  ball.mesh.visible = false;
  world.add(ball.mesh);

  function resetBall() {
    ball.active = false;
    ball.flying = false;
    ball.held = null;
    ball.mesh.visible = false;
  }
  const canPlay = (d) => d.energy > 8 && !['sleep', 'eat', 'fetch', 'return'].includes(d.state);

  function throwBall() {
    if (ball.active) { toast('The ball is already out!'); return; }
    let dog = selected && canPlay(selected) ? selected : null;
    if (!dog) {
      const pp = player.root.position;
      dog = dogs.filter(canPlay).sort((a, b) => a.root.position.distanceTo(pp) - b.root.position.distanceTo(pp))[0];
    }
    if (!dog) { toast(dogs.some((d) => d.state === 'sleep') ? 'Shh… your dog is napping 💤' : 'Too tired to play right now 😴'); return; }
    const p = player.root.position, a = player.root.rotation.y;
    let dist = rand(3.5, 5.5), tx = 0, tz = 0, ok = false;
    for (; dist > 0.9; dist -= 0.4) {
      tx = p.x + Math.sin(a) * dist;
      tz = p.z + Math.cos(a) * dist;
      if (inBounds(tx, tz, 0.3) && !isSolid(tx, tz)) { ok = true; break; }
    }
    if (!ok) { toast('No room to throw — turn around!'); return; }
    player.hand.getWorldPosition(ball.from);
    ball.to.set(tx, 0.1, tz);
    ball.t = 0;
    ball.flying = true;
    ball.active = true;
    ball.held = null;
    ball.mesh.visible = true;
    ball.mesh.position.copy(ball.from);
    player.throwT = 0.3;
    dog.startFetch();
  }

  function updateBall(dt) {
    if (!ball.active) return;
    if (ball.flying) {
      ball.t += dt / 0.75;
      const t = Math.min(1, ball.t);
      ball.mesh.position.set(
        lerp(ball.from.x, ball.to.x, t),
        lerp(ball.from.y, 0.1, t) + Math.sin(Math.PI * t) * 1.6,
        lerp(ball.from.z, ball.to.z, t));
      ball.mesh.rotation.x += dt * 10;
      if (ball.t >= 1) { ball.flying = false; ball.bounce = 0; }
    } else if (ball.held) {
      ball.held.mouth.getWorldPosition(ball.mesh.position);
    } else {
      ball.bounce += dt;
      ball.mesh.position.y = 0.1 + Math.abs(Math.sin(ball.bounce * 8)) * 0.3 * Math.max(0, 1 - ball.bounce * 2);
    }
  }

  // =====================================================================
  // Scenes: home <-> park
  // =====================================================================
  function goWalk() {
    if (!dogs.length) return;
    place = 'park';
    homeRoot.visible = false;
    parkRoot.visible = true;
    world.fog = parkFog;
    resetBall();
    player.moveTarget = null;
    player.root.position.set(0, 0, 16);
    player.root.rotation.y = player.face = Math.PI;
    dogs.forEach((d, i) => {
      d.releaseClaim();
      d.dropSpot();
      d.onArrive = null;
      d.root.position.set(-0.6 * (dogs.length - 1) / 2 + i * 0.6, 0, 17.3);
      d.root.rotation.y = d.face = Math.PI;
      d.setState('follow');
    });
    walkDist = 0;
    walkEarn = 0;
    tiredWarned = false;
    refreshUI();
    updateCamera(0, true);
    toast('Walk time! Let your dog sniff the ✨ spots');
  }

  function goHome() {
    place = 'home';
    homeRoot.visible = true;
    parkRoot.visible = false;
    world.fog = null;
    resetBall();
    const N = state.roomSize;
    player.moveTarget = null;
    player.root.position.set(N / 2, 0, N - 0.8);
    player.root.rotation.y = player.face = Math.PI;
    dogs.forEach((d, i) => {
      d.dropSpot();
      d.leash.visible = false;
      d.root.position.set(clamp(N / 2 - 0.7 + i * 0.5, 0.5, N - 0.5), 0, N - 1.6);
      d.idle(rand(1, 3));
    });
    sniffSpots.forEach((s) => { s.taken = null; });
    refreshUI();
    updateCamera(0, true);
    toast(walkEarn > 0 ? `Great walk! You earned 🪙 ${walkEarn}` : 'Back home 🏠');
    save();
  }

  function updateSniffSpots(dt) {
    for (const s of sniffSpots) {
      if (s.cooldown > 0) s.cooldown -= dt;
      s.sparkle.visible = s.cooldown <= 0;
      s.phase += dt;
      s.sparkle.position.y = 1.15 + Math.sin(s.phase * 2.5) * 0.08;
    }
  }

  // =====================================================================
  // Camera
  // =====================================================================
  const camLook = new V3();
  let camDist = 12;
  function updateCamera(dt, snap) {
    const p = player.root.position;
    let tx, tz, dist;
    if (place === 'home') {
      const N = state.roomSize;
      tx = lerp(N / 2, p.x, 0.45);
      tz = lerp(N / 2, p.z, 0.45);
      dist = 5.5 + N * 0.85;
    } else {
      tx = p.x; tz = p.z;
      dist = 11;
    }
    dist *= clamp(0.8 / camera.aspect, 1, 1.6) * zoom;
    const k = snap ? 1 : damp(0.02, dt);
    camLook.set(lerp(camLook.x, tx, k), 0.5, lerp(camLook.z, tz, k));
    camDist = lerp(camDist, dist, snap ? 1 : damp(0.05, dt));
    camera.position.set(camLook.x + camOffsetDir.x * camDist, camLook.y + camOffsetDir.y * camDist, camLook.z + camOffsetDir.z * camDist);
    camera.lookAt(camLook);
  }

  // =====================================================================
  // Input: drag = joystick, tap = interact, pinch / wheel = zoom
  // =====================================================================
  const ptrs = new Map();
  let primary = null;
  let pinch = null;
  const joyBase = $('joyBase'), joyKnob = $('joyKnob');
  const modalOpen = () => !$('shop').classList.contains('hidden') || !$('start').classList.contains('hidden');

  canvas.addEventListener('pointerdown', (e) => {
    if (modalOpen()) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom };
      if (primary) primary.dragging = true; // a pinch is never a tap
      joy.active = false;
      joyBase.style.display = 'none';
    } else if (ptrs.size === 1) {
      primary = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dragging: false };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      zoom = clamp(pinch.z * pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 0.55, 1.8);
      return;
    }
    if (!primary || e.pointerId !== primary.id || pinch) return;
    const dx = e.clientX - primary.sx, dy = e.clientY - primary.sy;
    if (!primary.dragging && Math.hypot(dx, dy) > 12) {
      primary.dragging = true;
      joyBase.style.display = 'block';
      joyBase.style.left = primary.sx + 'px';
      joyBase.style.top = primary.sy + 'px';
      hideHint();
    }
    if (primary.dragging) {
      const R = 55, len = Math.hypot(dx, dy), k = len > R ? R / len : 1;
      joy.x = (dx * k) / R;
      joy.y = (dy * k) / R;
      joy.active = true;
      joyKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  });
  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (primary && e.pointerId === primary.id) {
      if (!primary.dragging && e.type === 'pointerup' && !pinch) handleTap(e.clientX, e.clientY);
      primary = null;
      joy.active = false;
      joy.x = joy.y = 0;
      joyBase.style.display = 'none';
      joyKnob.style.transform = '';
    }
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) primary = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => { zoom = clamp(zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.55, 1.8); e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new V3(0, 1, 0), 0);

  function handleTap(cx, cy) {
    ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const gp = new V3();
    const hitGround = raycaster.ray.intersectPlane(groundPlane, gp);

    if (mode === 'decorate') { if (hitGround) decorateTap(gp); return; }

    let dog = null;
    const hits = raycaster.intersectObjects(dogs.map((d) => d.root), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.dog) o = o.parent;
      if (o) { dog = o.userData.dog; break; }
    }
    if (!dog && hitGround) {
      let best = 0.85;
      for (const d of dogs) {
        const dd = Math.hypot(d.root.position.x - gp.x, d.root.position.z - gp.z);
        if (dd < best) { best = dd; dog = d; }
      }
    }
    if (dog) { interactDog(dog); return; }

    if (hitGround) {
      const [a, b] = bounds();
      player.moveTarget = new V3(clamp(gp.x, a, b), 0, clamp(gp.z, a, b));
      tapRing.position.set(player.moveTarget.x, 0.06, player.moveTarget.z);
      tapT = 0.5;
      hideHint();
    }
  }

  function interactDog(d) {
    selected = d;
    updateHud();
    if (d.state === 'fetch' || d.state === 'return') return;
    if (d.state === 'sleep') d.wake();
    d.releaseClaim();
    d.dropSpot();
    const near = d.root.position.distanceTo(player.root.position) < 1.9;
    if (near || place === 'park') d.pet();
    else d.goTo(() => player.root.position, 3.2, () => d.pet(), 1.1);
    hideHint();
  }

  // =====================================================================
  // Decorating
  // =====================================================================
  const firstInv = () => Object.keys(ITEMS).find((t) => state.inventory[t] > 0) || null;
  const rotNames = ['Facing you', 'Facing right', 'Facing back', 'Facing left'];

  function enterDecorate() {
    mode = 'decorate';
    grid.visible = true;
    if (!selectedInv || !(state.inventory[selectedInv] > 0)) selectedInv = firstInv();
    renderInv();
    refreshUI();
  }
  function exitDecorate() {
    mode = 'normal';
    grid.visible = false;
    refreshUI();
    save();
  }
  function renderInv() {
    const list = $('invList');
    list.innerHTML = '';
    $('rotLabel').textContent = rotNames[placeRot];
    const types = Object.keys(ITEMS).filter((t) => state.inventory[t] > 0);
    if (!types.length) {
      list.innerHTML = '<div class="empty">Nothing to place. Tap an item in the room to pick it up, or buy more in the 🛒 Shop.</div>';
      return;
    }
    for (const t of types) {
      const b = document.createElement('button');
      b.className = 'inv' + (t === selectedInv ? ' sel' : '');
      b.innerHTML = `<span>${ITEMS[t].icon}</span><small>${ITEMS[t].name}</small><b>×${state.inventory[t]}</b>`;
      b.addEventListener('click', () => { selectedInv = t; renderInv(); });
      list.appendChild(b);
    }
  }
  function decorateTap(gp) {
    const N = state.roomSize;
    const i = Math.floor(gp.x), j = Math.floor(gp.z);
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const ex = furnitureAt(i, j);
    if (ex) {
      state.furniture.splice(state.furniture.indexOf(ex), 1);
      state.inventory[ex.type] = (state.inventory[ex.type] || 0) + 1;
      selectedInv = ex.type;
      placeRot = ex.rot || 0;
      afterFurnitureChange();
      toast(`Picked up ${ITEMS[ex.type].name}`);
      return;
    }
    if (!selectedInv || !(state.inventory[selectedInv] > 0)) { toast('Pick an item from the bar first'); return; }
    if (ITEMS[selectedInv].solid && Math.floor(player.root.position.x) === i && Math.floor(player.root.position.z) === j) {
      toast("You're standing there!");
      return;
    }
    state.furniture.push({ type: selectedInv, i, j, rot: placeRot, filled: false });
    state.inventory[selectedInv]--;
    if (state.inventory[selectedInv] <= 0) selectedInv = firstInv();
    afterFurnitureChange();
    spawnEmoji('✨', new V3(i + 0.5, 0.6, j + 0.5), { size: 0.45, life: 0.8 });
  }
  function afterFurnitureChange() {
    dogs.forEach((d) => d.reset());
    rebuildFurniture();
    renderInv();
    save();
  }

  // =====================================================================
  // Feeding
  // =====================================================================
  function feed() {
    const bowls = state.furniture.filter((f) => f.type === 'bowl');
    if (!bowls.length) { toast('Place a food bowl first (🎨 Decorate)'); return; }
    bowls.forEach((b) => { b.filled = true; refreshBowl(b); });
    dogs.forEach((d) => { if ((d.state === 'idle' || d.state === 'sit') && d.hunger < 85) d.setState('idle', 0.2); });
    // make sure hungry-ish dogs actually go eat
    dogs.forEach((d) => {
      if (d.hunger < 85 && (d.state === 'idle')) {
        const bowl = findFurniture('bowl', d, true, d.root.position);
        if (bowl) {
          d.claimItem(bowl);
          d.goTo(tileCenter(bowl), 2.6, () => { d.claim = bowl; d.faceTo(tileCenter(bowl)); d.setState('eat', 2.6); }, 0.5);
        }
      }
    });
    toast(bowls.length > 1 ? 'Bowls filled 🥣' : 'Bowl filled 🥣');
    save();
  }

  // =====================================================================
  // Shop & adoption
  // =====================================================================
  const capacity = () => state.roomSize / 2 - 2;
  const adoptPrice = () => 50 * dogs.length;

  function openShop() {
    renderShop();
    $('shop').classList.remove('hidden');
  }
  function closeShop() {
    $('shop').classList.add('hidden');
    if (mode === 'decorate') renderInv();
  }
  function renderShop() {
    const L = $('shopList');
    L.innerHTML = '';
    $('shopCoins').textContent = state.coins;
    const section = (t) => { const d = document.createElement('div'); d.className = 'section'; d.textContent = t; L.appendChild(d); };
    const row = (icon, title, sub, price, onBuy, disabled) => {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = `<div class="ic">${icon}</div><div class="txt"><b>${title}</b><small>${sub}</small></div>`;
      const b = document.createElement('button');
      b.className = 'buy';
      b.textContent = price == null ? '—' : `🪙 ${price}`;
      b.disabled = !!disabled || price == null || state.coins < price;
      b.addEventListener('click', () => { if (price != null && state.coins >= price) onBuy(price); });
      r.appendChild(b);
      L.appendChild(r);
    };

    section('Home');
    const N = state.roomSize;
    if (N < MAX_ROOM) {
      row('📐', 'Bigger room', `${N}×${N} → ${N + 2}×${N + 2} · fits ${N / 2 - 1} dogs`, EXPAND_PRICE[N], (p) => {
        state.coins -= p;
        state.roomSize += 2;
        buildRoom();
        rebuildFurniture();
        toast('Your home got bigger! 🎉');
        updateHud();
        save();
        renderShop();
      });
    } else {
      row('📐', 'Bigger room', 'Your home is as big as it gets', null, null, true);
    }
    const cap = capacity();
    const full = dogs.length >= cap;
    row('🐶', 'Adopt a dog', full ? `Home is full (${dogs.length}/${cap}) — get a bigger room` : `${dogs.length}/${cap} dogs`, adoptPrice(), () => {
      closeShop();
      openStart(true);
    }, full);

    section('Furniture');
    for (const [t, it] of Object.entries(ITEMS)) {
      const owned = (state.inventory[t] || 0) + state.furniture.filter((f) => f.type === t).length;
      row(it.icon, it.name, owned ? `You have ${owned}` : (it.solid ? 'Decoration' : 'Dogs can walk on it'), it.price, (p) => {
        state.coins -= p;
        state.inventory[t] = (state.inventory[t] || 0) + 1;
        selectedInv = t;
        toast(`${it.name} added — place it in 🎨 Decorate`);
        updateHud();
        save();
        renderShop();
      });
    }
  }

  let adoptMode = false;
  let chosenBreed = 0;
  function randomName() {
    const used = new Set(dogs.map((d) => d.name));
    const free = DOG_NAMES.filter((n) => !used.has(n));
    return pick(free.length ? free : DOG_NAMES);
  }
  function renderBreeds() {
    const el = $('breeds');
    el.innerHTML = '';
    BREEDS.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.className = 'breed' + (i === chosenBreed ? ' sel' : '');
      btn.innerHTML = `<div class="swatch" style="background:linear-gradient(135deg, ${b.body} 0 58%, ${b.light} 58% 78%, ${b.dark} 78%)"></div>${b.name}`;
      btn.addEventListener('click', () => { chosenBreed = i; renderBreeds(); });
      el.appendChild(btn);
    });
  }
  function openStart(adopt) {
    adoptMode = adopt;
    $('startTitle').textContent = adopt ? 'Adopt a new dog' : '🐾 Voxel Paws';
    $('startSub').textContent = adopt ? `Adoption costs 🪙 ${adoptPrice()}` : 'Pick your first dog and give it a name.';
    $('startBtn').textContent = adopt ? `Adopt for 🪙 ${adoptPrice()}` : "Let's go!";
    $('cancelBtn').classList.toggle('hidden', !adopt);
    chosenBreed = Math.floor(Math.random() * BREEDS.length);
    renderBreeds();
    $('nameInput').value = randomName();
    $('start').classList.remove('hidden');
  }
  $('startBtn').addEventListener('click', () => {
    const name = ($('nameInput').value || '').trim().slice(0, 14) || randomName();
    if (adoptMode) {
      const price = adoptPrice();
      if (state.coins < price) { toast('Not enough coins yet'); return; }
      state.coins -= price;
    }
    $('nameInput').blur();
    const d = addDog({ name, breed: chosenBreed, hunger: 90, energy: 90, happy: 80 }, true);
    selected = d;
    $('start').classList.add('hidden');
    d.pet();
    toast(`Say hi to ${name}! Tap them to pet 💕`);
    updateHud();
    save();
  });
  $('cancelBtn').addEventListener('click', () => $('start').classList.add('hidden'));

  // =====================================================================
  // HUD
  // =====================================================================
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  let hintHidden = false;
  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    $('hint').classList.add('gone');
  }

  function refreshUI() {
    $('actions').classList.toggle('hidden', !(place === 'home' && mode === 'normal'));
    $('parkActions').classList.toggle('hidden', place !== 'park');
    $('decoBar').classList.toggle('hidden', mode !== 'decorate');
    $('dogPanel').classList.toggle('hidden', !selected || mode === 'decorate');
    $('sceneLabel').textContent = place === 'park' ? '🌳 Park' : mode === 'decorate' ? '🎨 Decorating' : '🏠 Home';
    if (mode === 'decorate' || place === 'park') hideHint();
  }

  function updateHud() {
    $('coinCount').textContent = state.coins;
    if (!$('shop').classList.contains('hidden')) $('shopCoins').textContent = state.coins;
    const d = selected;
    $('dogPanel').classList.toggle('hidden', !d || mode === 'decorate');
    if (!d) return;
    $('dogName').textContent = d.name + (dogs.length > 1 ? '  ›' : '');
    $('dogStatus').textContent = d.statusText();
    $('barHunger').style.width = d.hunger + '%';
    $('barEnergy').style.width = d.energy + '%';
    $('barHappy').style.width = d.happy + '%';
  }
  $('dogPanel').addEventListener('click', () => {
    if (dogs.length < 2) return;
    selected = dogs[(dogs.indexOf(selected) + 1) % dogs.length];
    updateHud();
  });

  $('hud').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'feed') feed();
    else if (act === 'ball') throwBall();
    else if (act === 'walk') goWalk();
    else if (act === 'home') goHome();
    else if (act === 'decorate') enterDecorate();
    else if (act === 'done') exitDecorate();
    else if (act === 'shop') openShop();
    else if (act === 'rotate') { placeRot = (placeRot + 1) % 4; renderInv(); toast(`Next item: ${rotNames[placeRot].toLowerCase()}`); }
  });
  $('shop').addEventListener('click', (e) => {
    if (e.target.id === 'shop' || e.target.closest('[data-act="closeShop"]')) closeShop();
  });

  // =====================================================================
  // Saving
  // =====================================================================
  function save() {
    state.dogs = dogs.map((d) => d.serialize());
    state.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      state = Object.assign(defaultState(), s);
      if (!state.inventory) state.inventory = {};
      if (!Array.isArray(state.furniture)) state.furniture = [];
      // time passes while you're away: dogs rest, but get a bit hungry and miss you
      const hours = clamp((Date.now() - (s.savedAt || Date.now())) / 3600000, 0, 24);
      for (const d of state.dogs || []) {
        d.hunger = Math.max(10, (d.hunger ?? 80) - hours * 15);
        d.energy = Math.min(100, (d.energy ?? 80) + hours * 25);
        d.happy = Math.max(15, (d.happy ?? 70) - hours * 8);
      }
      return true;
    } catch (_) {
      return false;
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  // =====================================================================
  // Main loop
  // =====================================================================
  const clock = new THREE.Clock();
  let hudTimer = 0, saveTimer = 5;

  function update(dt) {
    updatePlayer(dt);
    for (const d of dogs) d.update(dt);
    separateDogs();
    updateBall(dt);
    if (place === 'park') {
      updateSniffSpots(dt);
      if (!tiredWarned && dogs.some((d) => d.energy < 10)) { tiredWarned = true; toast('Your dog is getting tired — time to head home 🏠'); }
    }
    for (const d of dogs) d.updateLeash();
    updateParticles(dt);

    if (tapT > 0) {
      tapT -= dt;
      tapRing.material.opacity = Math.max(0, tapT * 1.6);
      tapRing.scale.setScalar(1 + (0.5 - tapT) * 1.5);
    }
    selRing.visible = !!selected && dogs.length > 1 && mode === 'normal';
    if (selRing.visible) selRing.position.set(selected.root.position.x, 0.055, selected.root.position.z);

    updateCamera(dt, false);
    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.25; updateHud(); }
    saveTimer -= dt;
    if (saveTimer <= 0) { saveTimer = 5; save(); }
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    renderer.render(world, camera);
  }

  // =====================================================================
  // Start
  // =====================================================================
  function init() {
    load();
    buildRoom();
    rebuildFurniture();
    buildPark();
    const N = state.roomSize;
    player.root.position.set(N / 2, 0, N - 1.2);
    player.root.rotation.y = player.face = Math.PI;
    for (const dd of state.dogs || []) addDog(dd, false);
    selected = dogs[0] || null;
    if (!dogs.length) openStart(false);
    else toast(`Welcome back! ${dogs[0].name} missed you 🐾`);
    refreshUI();
    updateHud();
    updateCamera(0, true);
    loop();
  }
  init();
})();
