'use strict';
/* Voxel Paws — a cozy voxel dog game. Uses three.js r128 (loaded in index.html). */
(function () {
  // =====================================================================
  // Settings (easy to tweak later)
  // =====================================================================
  const CHUNK = 6;            // one home section is CHUNK × CHUNK tiles
  const BUILD_MINUTES = 10;   // how long a new section takes to build
  const MAX_CHUNKS = 16;      // the biggest a home can get
  const LOW = 25;             // a need below this shows a yellow badge
  const CRITICAL = 10;        // … and below this a red one
  const expandPrice = (n) => Math.round((80 * Math.pow(1.6, n - 1)) / 5) * 5; // n = sections you already own
  const SAVE_KEY = 'voxelpaws-save-v1';

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
  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Shared geometry + material caches keep things cheap on phones
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
  function emojiSprite(e, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(e), transparent: true, depthWrite: false }));
    s.scale.set(size, size, 1);
    return s;
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    s.userData.h = height;
    setSpriteText(s, text);
    return s;
  }
  function setSpriteText(s, text) {
    if (s.userData.text === text) return;
    s.userData.text = text;
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
    if (s.material.map) s.material.map.dispose();
    s.material.map = new THREE.CanvasTexture(c);
    s.material.needsUpdate = true;
    s.scale.set((s.userData.h * w) / 72, s.userData.h, 1);
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

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
  world.add(new THREE.HemisphereLight(0xffffff, 0xb9a88a, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(6, 12, 8);
  world.add(sun);

  const homeRoot = pivot(world);
  const roomGroup = pivot(homeRoot);
  const gridGroup = pivot(homeRoot);
  const furnGroup = pivot(homeRoot);
  const siteGroup = pivot(homeRoot);
  const candGroup = pivot(homeRoot);
  const parkRoot = pivot(world);
  parkRoot.visible = false;
  gridGroup.visible = false;
  box(homeRoot, 260, 0.1, 260, '#a3d18b', 0, -0.17, 0); // the yard around the house

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    placeToast();
  });

  // Special materials
  const lampMat = new THREE.MeshLambertMaterial({ color: '#fff0c4', emissive: '#ffcf6b', emissiveIntensity: 0.65 });
  const waterMat = new THREE.MeshLambertMaterial({ color: '#7cc8f0', emissive: '#3a8fd0', emissiveIntensity: 0.25 });
  const screenMat = new THREE.MeshLambertMaterial({ color: '#8fc4ff', emissive: '#4a90e2', emissiveIntensity: 0.6 });
  const fireMat = new THREE.MeshLambertMaterial({ color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 0.9 });
  const fireMat2 = new THREE.MeshLambertMaterial({ color: '#ffe066', emissive: '#ffcc33', emissiveIntensity: 0.9 });
  const glassMat = new THREE.MeshLambertMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.35, depthWrite: false });
  const goldMat = new THREE.MeshLambertMaterial({ color: '#ffd34d', emissive: '#c99a00', emissiveIntensity: 0.35 });

  // =====================================================================
  // Game data
  // =====================================================================
  // role: 'bed' = dogs sleep there, 'food' / 'water' = bowls that can be filled
  const ITEMS = {
    // Dog stuff
    bed:       { name: 'Dog bed',        icon: '🛏️', price: 35, cat: 'dog', solid: false, role: 'bed', sleepY: 0.1 },
    bowl:      { name: 'Food bowl',      icon: '🥣', price: 20, cat: 'dog', solid: false, role: 'food' },
    water:     { name: 'Water bowl',     icon: '💧', price: 20, cat: 'dog', solid: false, role: 'water' },
    cushion:   { name: 'Floor cushion',  icon: '🟪', price: 25, cat: 'dog', solid: false, role: 'bed', sleepY: 0.08 },
    kennel:    { name: 'Dog house',      icon: '🏠', price: 70, cat: 'dog', solid: true },
    toybox:    { name: 'Toy box',        icon: '🧸', price: 30, cat: 'dog', solid: true },
    hurdle:    { name: 'Agility hurdle', icon: '🚧', price: 40, cat: 'dog', solid: true },
    // Living room
    sofa:      { name: 'Sofa',           icon: '🛋️', price: 45, cat: 'living', solid: true },
    armchair:  { name: 'Armchair',       icon: '💺', price: 40, cat: 'living', solid: true },
    beanbag:   { name: 'Bean bag',       icon: '🟠', price: 30, cat: 'living', solid: true },
    tv:        { name: 'TV stand',       icon: '📺', price: 60, cat: 'living', solid: true },
    shelf:     { name: 'Bookshelf',      icon: '📚', price: 40, cat: 'living', solid: true },
    lamp:      { name: 'Floor lamp',     icon: '💡', price: 25, cat: 'living', solid: true },
    rug:       { name: 'Rug',            icon: '🧶', price: 15, cat: 'living', solid: false },
    fireplace: { name: 'Fireplace',      icon: '🔥', price: 90, cat: 'living', solid: true },
    piano:     { name: 'Piano',          icon: '🎹', price: 85, cat: 'living', solid: true },
    // Kitchen
    table:     { name: 'Table',          icon: '🍽️', price: 30, cat: 'kitchen', solid: true },
    chair:     { name: 'Chair',          icon: '🪑', price: 15, cat: 'kitchen', solid: true },
    fridge:    { name: 'Fridge',         icon: '🧊', price: 55, cat: 'kitchen', solid: true },
    stove:     { name: 'Stove',          icon: '🍳', price: 50, cat: 'kitchen', solid: true },
    // Decor
    plant:     { name: 'Plant',          icon: '🪴', price: 20, cat: 'decor', solid: true },
    cactus:    { name: 'Cactus',         icon: '🌵', price: 15, cat: 'decor', solid: true },
    sunflower: { name: 'Sunflower',      icon: '🌻', price: 18, cat: 'decor', solid: true },
    aquarium:  { name: 'Aquarium',       icon: '🐠', price: 65, cat: 'decor', solid: true },
    clock:     { name: 'Grandfather clock', icon: '🕰️', price: 50, cat: 'decor', solid: true },
    dresser:   { name: 'Dresser',        icon: '🗄️', price: 40, cat: 'decor', solid: true },
    desk:      { name: 'Desk',           icon: '💻', price: 45, cat: 'decor', solid: true },
  };
  const CATS = [['dog', '🐶 Dog stuff'], ['living', '🛋️ Living room'], ['kitchen', '🍳 Kitchen'], ['decor', '🪴 Decor']];

  // price: null = can only be found on walks. weight = how often it's found.
  const TOYS = {
    tennis:  { name: 'Tennis ball',  icon: '🎾', price: 0,    dist: 1,    arc: 1.6, bounce: 0.3,  spin: 'roll',   restY: 0.1,  weight: 10 },
    redball: { name: 'Rubber ball',  icon: '🔴', price: 25,   dist: 1.1,  arc: 1.7, bounce: 0.45, spin: 'roll',   restY: 0.11, weight: 8 },
    bouncy:  { name: 'Bouncy ball',  icon: '🟣', price: 40,   dist: 1,    arc: 1.9, bounce: 0.9,  spin: 'roll',   restY: 0.1,  weight: 6, decay: 0.9 },
    bone:    { name: 'Squishy bone', icon: '🦴', price: 35,   dist: 0.8,  arc: 1.3, bounce: 0.1,  spin: 'tumble', restY: 0.05, weight: 8, happy: 22, squeak: true },
    duck:    { name: 'Rubber duck',  icon: '🐤', price: 30,   dist: 0.85, arc: 1.4, bounce: 0.15, spin: 'tumble', restY: 0.08, weight: 8, squeak: true },
    rope:    { name: 'Rope toy',     icon: '🪢', price: 30,   dist: 0.9,  arc: 1.3, bounce: 0,    spin: 'tumble', restY: 0.05, weight: 8, happy: 18 },
    donut:   { name: 'Plush donut',  icon: '🍩', price: 45,   dist: 0.85, arc: 1.4, bounce: 0.05, spin: 'tumble', restY: 0.05, weight: 6, happy: 20 },
    frisbee: { name: 'Flying disc',  icon: '🥏', price: 60,   dist: 1.5,  arc: 1.0, bounce: 0,    spin: 'flat',   restY: 0.03, weight: 6, time: 1.1, happy: 20 },
    stick:   { name: 'Stick',        icon: '🪵', price: null, dist: 1,    arc: 1.5, bounce: 0.05, spin: 'tumble', restY: 0.04, weight: 40 },
    golden:  { name: 'Golden ball',  icon: '🌟', price: null, dist: 1.1,  arc: 1.7, bounce: 0.4,  spin: 'roll',   restY: 0.11, weight: 2, happy: 25, coins: 2 },
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
  const STATS = [
    { k: 'hunger', ic: '🍖' },
    { k: 'thirst', ic: '💧' },
    { k: 'energy', ic: '⚡' },
    { k: 'happy', ic: '❤️' },
  ];

  function defaultState() {
    return {
      v: 2,
      coins: 20,
      chunks: [[0, 0]],
      build: null,
      furniture: [
        { type: 'bed', i: 0, j: 3, rot: 1 },
        { type: 'bowl', i: 3, j: 0, rot: 0, filled: true },
        { type: 'water', i: 2, j: 0, rot: 0, filled: true },
        { type: 'rug', i: 3, j: 3, rot: 0 },
      ],
      inventory: { plant: 1 },
      toys: ['tennis'],
      toy: 'tennis',
      dogs: [],
    };
  }
  let state = defaultState();

  let place = 'home';      // 'home' | 'park'
  let mode = 'normal';     // 'normal' | 'decorate' | 'build'
  const dogs = [];
  let selected = null;
  let selectedInv = null;
  let placeRot = 0;
  let walkDist = 0;
  let walkEarn = 0;
  let tiredWarned = false;
  let zoom = 1;
  let animT = 0;

  // =====================================================================
  // Furniture builders (each item fits in one 1×1 tile, front faces +z)
  // =====================================================================
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
      const c = pivot(g);
      box(c, 0.3, 0.05, 0.3, '#b0703a', 0, 0.13, 0);
      box(c, 0.08, 0.05, 0.08, '#8f5428', 0.06, 0.165, -0.05);
      box(c, 0.07, 0.05, 0.07, '#c98a4e', -0.07, 0.165, 0.06);
      g.userData.content = c;
    },
    water(g) {
      box(g, 0.42, 0.12, 0.42, '#3d7fd6', 0, 0.06, 0);
      box(g, 0.3, 0.02, 0.3, '#1f4f8f', 0, 0.115, 0);
      box(g, 0.08, 0.06, 0.02, '#ffffff', 0, 0.06, 0.215);
      const c = pivot(g);
      box(c, 0.3, 0.03, 0.3, waterMat, 0, 0.125, 0);
      g.userData.content = c;
    },
    cushion(g) {
      box(g, 0.82, 0.12, 0.82, '#e98aa8', 0, 0.06, 0);
      box(g, 0.62, 0.05, 0.62, '#f6b9cc', 0, 0.135, 0);
      for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) box(g, 0.12, 0.08, 0.12, '#d46f90', x, 0.12, z);
    },
    kennel(g) {
      const wall = '#d9a066', roof = '#c0392b';
      box(g, 0.92, 0.06, 0.92, '#8a6440', 0, 0.03, 0);
      box(g, 0.8, 0.6, 0.08, wall, 0, 0.36, -0.36);
      box(g, 0.08, 0.6, 0.72, wall, -0.36, 0.36, 0);
      box(g, 0.08, 0.6, 0.72, wall, 0.36, 0.36, 0);
      box(g, 0.22, 0.6, 0.08, wall, -0.29, 0.36, 0.36);
      box(g, 0.22, 0.6, 0.08, wall, 0.29, 0.36, 0.36);
      box(g, 0.36, 0.16, 0.08, wall, 0, 0.58, 0.36);
      box(g, 0.64, 0.5, 0.02, '#3b2a1e', 0, 0.31, 0.3);
      box(g, 0.98, 0.1, 0.98, roof, 0, 0.71, 0);
      box(g, 0.74, 0.1, 0.98, roof, 0, 0.81, 0);
      box(g, 0.5, 0.1, 0.98, '#a93226', 0, 0.91, 0);
      box(g, 0.26, 0.1, 0.98, roof, 0, 1.01, 0);
      box(g, 0.28, 0.08, 0.02, '#f4efe6', 0, 0.58, 0.405);
    },
    toybox(g) {
      box(g, 0.76, 0.42, 0.52, '#e8b84a', 0, 0.21, 0);
      box(g, 0.78, 0.08, 0.54, '#d0763c', 0, 0.3, 0);
      box(g, 0.18, 0.18, 0.18, '#d64545', -0.17, 0.5, 0);
      box(g, 0.3, 0.07, 0.08, '#f5f0e6', 0.13, 0.46, 0.05);
      box(g, 0.08, 0.12, 0.13, '#f5f0e6', -0.02, 0.46, 0.05);
      box(g, 0.08, 0.12, 0.13, '#f5f0e6', 0.28, 0.46, 0.05);
    },
    hurdle(g) {
      for (const x of [-0.4, 0.4]) {
        box(g, 0.08, 0.62, 0.08, '#f4efe6', x, 0.31, 0);
        box(g, 0.1, 0.04, 0.42, '#3d3a40', x, 0.02, 0);
      }
      for (let k = 0; k < 4; k++) {
        box(g, 0.18, 0.06, 0.06, k % 2 ? '#f4efe6' : '#e2453c', -0.27 + k * 0.18, 0.42, 0);
        box(g, 0.18, 0.05, 0.05, k % 2 ? '#e2453c' : '#f4efe6', -0.27 + k * 0.18, 0.2, 0);
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
    armchair(g) {
      box(g, 0.74, 0.28, 0.66, '#c96f53', 0, 0.2, 0.02);
      box(g, 0.5, 0.08, 0.5, '#e08b6f', 0, 0.38, 0.07);
      box(g, 0.74, 0.5, 0.16, '#a8573f', 0, 0.55, -0.3);
      box(g, 0.12, 0.24, 0.62, '#a8573f', -0.31, 0.46, 0.02);
      box(g, 0.12, 0.24, 0.62, '#a8573f', 0.31, 0.46, 0.02);
      for (const [x, z] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.3], [0.3, 0.3]]) box(g, 0.07, 0.06, 0.07, '#5a3620', x, 0.03, z);
    },
    beanbag(g) {
      box(g, 0.8, 0.24, 0.8, '#f2a541', 0, 0.12, 0);
      box(g, 0.66, 0.16, 0.66, '#f4b55f', 0, 0.3, 0.04);
      box(g, 0.64, 0.34, 0.22, '#e8952b', 0, 0.4, -0.28);
      box(g, 0.4, 0.08, 0.4, '#f6c27a', 0, 0.41, 0.08);
    },
    tv(g) {
      box(g, 0.92, 0.36, 0.42, '#6d4c33', 0, 0.18, -0.2);
      box(g, 0.4, 0.26, 0.02, '#5a3d28', -0.21, 0.18, 0.015);
      box(g, 0.4, 0.26, 0.02, '#5a3d28', 0.21, 0.18, 0.015);
      box(g, 0.12, 0.06, 0.1, '#333333', 0, 0.39, -0.25);
      box(g, 0.84, 0.5, 0.06, '#26242b', 0, 0.67, -0.27);
      box(g, 0.76, 0.42, 0.02, screenMat, 0, 0.67, -0.235);
      box(g, 0.12, 0.1, 0.1, '#f2c14e', 0.36, 0.41, -0.1);
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
    lamp(g) {
      box(g, 0.32, 0.06, 0.32, '#3d3a40', 0, 0.03, 0);
      box(g, 0.06, 1.1, 0.06, '#3d3a40', 0, 0.6, 0);
      box(g, 0.42, 0.3, 0.42, lampMat, 0, 1.25, 0);
    },
    rug(g) {
      box(g, 0.98, 0.03, 0.98, '#b84a5a', 0, 0.015, 0);
      box(g, 0.74, 0.035, 0.74, '#f0c27b', 0, 0.018, 0);
      box(g, 0.42, 0.04, 0.42, '#b84a5a', 0, 0.02, 0);
    },
    fireplace(g) {
      const stone = '#a29d96';
      box(g, 0.96, 0.86, 0.36, stone, 0, 0.43, -0.3);
      box(g, 0.52, 0.42, 0.06, '#2b2220', 0, 0.27, -0.1);
      box(g, 1.02, 0.08, 0.46, '#7a5232', 0, 0.9, -0.26);
      box(g, 0.56, 0.6, 0.3, stone, 0, 1.24, -0.33);
      box(g, 0.98, 0.06, 0.24, '#8c877f', 0, 0.03, 0.0);
      const fire = pivot(g, 0, 0, -0.04);
      box(fire, 0.36, 0.06, 0.08, '#5a3a22', 0, 0.09, 0);
      box(fire, 0.16, 0.18, 0.05, fireMat, -0.07, 0.2, 0.01);
      box(fire, 0.14, 0.26, 0.05, fireMat, 0.07, 0.24, 0);
      box(fire, 0.08, 0.12, 0.05, fireMat2, 0, 0.18, 0.03);
      g.userData.anim = (t) => { fire.scale.y = 1 + Math.sin(t * 11) * 0.08 + Math.sin(t * 17) * 0.05; };
    },
    piano(g) {
      const wood = '#2b2730';
      box(g, 0.96, 0.92, 0.36, wood, 0, 0.46, -0.3);
      box(g, 0.96, 0.06, 0.26, wood, 0, 0.62, -0.02);
      box(g, 0.88, 0.04, 0.16, '#f5f5f5', 0, 0.66, 0.0);
      for (const x of [-0.33, -0.21, -0.03, 0.09, 0.21, 0.37]) box(g, 0.05, 0.03, 0.09, '#111111', x, 0.69, -0.03);
      box(g, 0.07, 0.6, 0.07, wood, -0.42, 0.3, 0.06);
      box(g, 0.07, 0.6, 0.07, wood, 0.42, 0.3, 0.06);
      box(g, 0.3, 0.22, 0.02, '#f7f1e3', 0, 0.82, -0.11);
      box(g, 0.08, 0.1, 0.08, '#ffd54f', 0.36, 0.97, -0.3);
    },
    table(g) {
      box(g, 0.88, 0.08, 0.88, '#a67c52', 0, 0.62, 0);
      for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) box(g, 0.08, 0.58, 0.08, '#8a6440', x, 0.29, z);
      box(g, 0.12, 0.2, 0.12, '#5c8fd6', 0.15, 0.76, -0.1);
      box(g, 0.12, 0.1, 0.12, '#f06292', 0.15, 0.91, -0.1);
      box(g, 0.22, 0.05, 0.16, '#e57373', -0.18, 0.685, 0.12);
    },
    chair(g) {
      const w = '#b98a5a', leg = '#9a6f45';
      box(g, 0.5, 0.06, 0.5, w, 0, 0.42, 0.04);
      for (const [x, z] of [[-0.2, -0.17], [0.2, -0.17], [-0.2, 0.25], [0.2, 0.25]]) box(g, 0.06, 0.42, 0.06, leg, x, 0.21, z);
      box(g, 0.06, 0.48, 0.06, leg, -0.2, 0.69, -0.18);
      box(g, 0.06, 0.48, 0.06, leg, 0.2, 0.69, -0.18);
      box(g, 0.46, 0.2, 0.05, w, 0, 0.82, -0.18);
      box(g, 0.4, 0.05, 0.4, '#e57373', 0, 0.47, 0.05);
    },
    fridge(g) {
      box(g, 0.72, 1.56, 0.62, '#e9eff3', 0, 0.78, -0.16);
      box(g, 0.73, 0.02, 0.02, '#b8c2c9', 0, 1.06, 0.155);
      box(g, 0.04, 0.3, 0.04, '#9aa5ad', 0.28, 1.28, 0.17);
      box(g, 0.04, 0.4, 0.04, '#9aa5ad', 0.28, 0.7, 0.17);
      box(g, 0.08, 0.08, 0.02, '#e57373', -0.18, 1.3, 0.155);
      box(g, 0.08, 0.08, 0.02, '#64b5f6', -0.05, 1.22, 0.155);
      box(g, 0.14, 0.18, 0.02, '#fff8e1', -0.12, 0.8, 0.155);
    },
    stove(g) {
      box(g, 0.94, 0.82, 0.6, '#f2efe9', 0, 0.41, -0.18);
      box(g, 0.98, 0.06, 0.64, '#5a5560', 0, 0.85, -0.18);
      for (const [x, z] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, -0.05], [0.22, -0.05]]) box(g, 0.2, 0.02, 0.2, '#222222', x, 0.89, z);
      box(g, 0.6, 0.42, 0.02, '#3d3a40', 0, 0.36, 0.125);
      box(g, 0.4, 0.18, 0.02, '#ffb06b', 0, 0.4, 0.135);
      box(g, 0.5, 0.04, 0.04, '#9aa5ad', 0, 0.62, 0.14);
      for (const x of [-0.3, -0.1, 0.1, 0.3]) box(g, 0.06, 0.06, 0.03, '#333333', x, 0.74, 0.13);
      box(g, 0.24, 0.16, 0.24, '#d64545', 0.22, 0.98, -0.05);
      box(g, 0.26, 0.03, 0.26, '#b83b3b', 0.22, 1.07, -0.05);
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
    cactus(g) {
      const c = '#5c9e4f';
      box(g, 0.32, 0.26, 0.32, '#d9825b', 0, 0.13, 0);
      box(g, 0.26, 0.03, 0.26, '#5b3b25', 0, 0.27, 0);
      box(g, 0.16, 0.62, 0.16, c, 0, 0.58, 0);
      box(g, 0.12, 0.1, 0.1, c, 0.13, 0.52, 0);
      box(g, 0.1, 0.22, 0.1, c, 0.2, 0.62, 0);
      box(g, 0.12, 0.1, 0.1, c, -0.13, 0.66, 0);
      box(g, 0.1, 0.18, 0.1, c, -0.2, 0.74, 0);
      box(g, 0.1, 0.06, 0.1, '#f06292', 0, 0.92, 0);
    },
    sunflower(g) {
      box(g, 0.34, 0.3, 0.34, '#5c8fd6', 0, 0.15, 0);
      box(g, 0.28, 0.03, 0.28, '#5b3b25', 0, 0.31, 0);
      box(g, 0.06, 0.8, 0.06, '#4caf50', 0, 0.72, 0);
      box(g, 0.2, 0.05, 0.1, '#66bb6a', 0.1, 0.6, 0);
      box(g, 0.2, 0.05, 0.1, '#66bb6a', -0.1, 0.8, 0);
      box(g, 0.42, 0.42, 0.06, '#ffcc33', 0, 1.18, 0.05);
      box(g, 0.2, 0.2, 0.08, '#6b4226', 0, 1.18, 0.07);
    },
    aquarium(g) {
      box(g, 0.92, 0.42, 0.5, '#4a3a2c', 0, 0.21, -0.2);
      box(g, 0.84, 0.05, 0.44, '#d9c38f', 0, 0.445, -0.2);
      box(g, 0.05, 0.24, 0.05, '#43a047', -0.28, 0.58, -0.28);
      box(g, 0.05, 0.16, 0.05, '#66bb6a', -0.22, 0.54, -0.3);
      box(g, 0.14, 0.1, 0.12, '#9e9e9e', 0.25, 0.52, -0.3);
      const fish = [['#ff8c42', 0.66, -0.15], ['#ffd54f', 0.76, -0.25], ['#64b5f6', 0.58, -0.1]].map(([c, y, z]) => {
        const f = pivot(g, 0, y, z);
        box(f, 0.11, 0.07, 0.04, c, 0, 0, 0);
        box(f, 0.04, 0.06, 0.03, c, -0.07, 0, 0);
        return f;
      });
      box(g, 0.9, 0.5, 0.48, glassMat, 0, 0.67, -0.2);
      box(g, 0.94, 0.04, 0.5, '#333333', 0, 0.94, -0.2);
      g.userData.anim = (t) => fish.forEach((f, k) => {
        const p = t * (0.5 + k * 0.17) + k * 2;
        f.position.x = Math.sin(p) * 0.3;
        f.rotation.y = Math.cos(p) > 0 ? 0 : Math.PI;
      });
    },
    clock(g) {
      const w = '#6b4226';
      box(g, 0.5, 0.26, 0.36, w, 0, 0.13, -0.28);
      box(g, 0.4, 1.0, 0.3, w, 0, 0.76, -0.28);
      box(g, 0.52, 0.46, 0.38, w, 0, 1.49, -0.28);
      box(g, 0.56, 0.08, 0.4, '#5a3620', 0, 1.75, -0.28);
      box(g, 0.34, 0.34, 0.02, '#f7f1e3', 0, 1.49, -0.08);
      box(g, 0.03, 0.13, 0.01, '#222222', 0, 1.53, -0.065);
      box(g, 0.1, 0.03, 0.01, '#222222', 0.04, 1.49, -0.065);
      box(g, 0.24, 0.6, 0.02, '#3a2a1a', 0, 0.78, -0.125);
      const pend = pivot(g, 0, 1.04, -0.11);
      box(pend, 0.03, 0.4, 0.02, '#c9a227', 0, -0.2, 0);
      box(pend, 0.12, 0.12, 0.03, '#ffd34d', 0, -0.42, 0);
      g.userData.anim = (t) => { pend.rotation.z = Math.sin(t * 3) * 0.28; };
    },
    dresser(g) {
      box(g, 0.92, 0.72, 0.46, '#b07d4f', 0, 0.4, -0.24);
      for (const y of [0.18, 0.4, 0.62]) {
        box(g, 0.84, 0.18, 0.02, '#c48f5e', 0, y, -0.005);
        box(g, 0.1, 0.04, 0.03, '#ffd54f', 0, y, 0.01);
      }
      for (const x of [-0.4, 0.4]) box(g, 0.08, 0.06, 0.08, '#6b4226', x, 0.03, -0.06);
      box(g, 0.22, 0.28, 0.04, '#8a5a3b', -0.22, 0.92, -0.38);
      box(g, 0.17, 0.22, 0.02, '#a7b8f5', -0.22, 0.92, -0.355);
      box(g, 0.14, 0.16, 0.14, '#ba68c8', 0.24, 0.84, -0.26);
      box(g, 0.08, 0.12, 0.08, '#ef6f8e', 0.24, 0.98, -0.26);
    },
    desk(g) {
      box(g, 0.94, 0.06, 0.56, '#c49a6c', 0, 0.72, -0.18);
      box(g, 0.06, 0.69, 0.5, '#a67c52', -0.42, 0.345, -0.18);
      box(g, 0.3, 0.6, 0.5, '#a67c52', 0.29, 0.39, -0.18);
      box(g, 0.24, 0.02, 0.02, '#7a5232', 0.29, 0.55, 0.075);
      box(g, 0.24, 0.02, 0.02, '#7a5232', 0.29, 0.35, 0.075);
      box(g, 0.42, 0.03, 0.28, '#9aa0a8', -0.1, 0.765, -0.12);
      box(g, 0.42, 0.28, 0.03, '#9aa0a8', -0.1, 0.92, -0.27);
      box(g, 0.38, 0.24, 0.01, screenMat, -0.1, 0.92, -0.25);
      box(g, 0.08, 0.1, 0.08, '#ef6f8e', 0.3, 0.8, -0.05);
    },
  };
  function buildItem(type) {
    const g = new THREE.Group();
    (BUILDERS[type] || BUILDERS.plant)(g);
    return g;
  }

  // Toy builders (centered on their middle, long axis along x)
  const TOY_BUILD = {
    tennis(g) { box(g, 0.2, 0.2, 0.2, '#c9e04a'); box(g, 0.21, 0.04, 0.21, '#f4f7e6'); },
    redball(g) { box(g, 0.22, 0.22, 0.22, '#e2453c'); box(g, 0.23, 0.05, 0.23, '#ffd54f'); },
    bouncy(g) { box(g, 0.2, 0.2, 0.2, '#9b59d0'); box(g, 0.21, 0.21, 0.06, '#f06292'); box(g, 0.06, 0.21, 0.21, '#64b5f6'); },
    bone(g) {
      const c = '#8fd3f4';
      box(g, 0.3, 0.08, 0.08, c);
      for (const x of [-0.16, 0.16]) for (const z of [-0.05, 0.05]) box(g, 0.09, 0.09, 0.09, c, x, 0, z);
    },
    duck(g) {
      box(g, 0.2, 0.14, 0.24, '#ffd93b');
      box(g, 0.13, 0.13, 0.13, '#ffd93b', 0, 0.11, 0.07);
      box(g, 0.08, 0.04, 0.07, '#ff8c1a', 0, 0.1, 0.16);
      box(g, 0.03, 0.03, 0.01, '#222222', 0.04, 0.14, 0.136);
      box(g, 0.03, 0.03, 0.01, '#222222', -0.04, 0.14, 0.136);
      box(g, 0.08, 0.06, 0.06, '#f5c400', 0, 0.05, -0.13);
    },
    rope(g) {
      for (let k = 0; k < 5; k++) box(g, 0.07, 0.07, 0.07, k % 2 ? '#f4efe6' : '#4f8fe6', -0.14 + k * 0.07, 0, 0);
      box(g, 0.1, 0.1, 0.1, '#e2453c', -0.2, 0, 0);
      box(g, 0.1, 0.1, 0.1, '#e2453c', 0.2, 0, 0);
    },
    donut(g) {
      for (const [x, z, w, d] of [[0, -0.1, 0.28, 0.08], [0, 0.1, 0.28, 0.08], [-0.1, 0, 0.08, 0.12], [0.1, 0, 0.08, 0.12]]) {
        box(g, w, 0.06, d, '#d9a066', x, -0.02, z);
        box(g, w, 0.04, d, '#f48fb1', x, 0.03, z);
      }
      box(g, 0.03, 0.02, 0.03, '#64b5f6', 0.08, 0.06, -0.1);
      box(g, 0.03, 0.02, 0.03, '#ffd54f', -0.1, 0.06, 0.05);
    },
    frisbee(g) {
      box(g, 0.34, 0.04, 0.34, '#ff7043');
      box(g, 0.38, 0.05, 0.06, '#ff5722', 0, 0, 0.16);
      box(g, 0.38, 0.05, 0.06, '#ff5722', 0, 0, -0.16);
      box(g, 0.06, 0.05, 0.38, '#ff5722', 0.16, 0, 0);
      box(g, 0.06, 0.05, 0.38, '#ff5722', -0.16, 0, 0);
      box(g, 0.12, 0.05, 0.12, '#ffd54f', 0, 0.005, 0);
    },
    stick(g) {
      box(g, 0.46, 0.06, 0.06, '#8a5a3b');
      box(g, 0.12, 0.05, 0.05, '#7a4e33', 0.08, 0.04, 0.04);
      box(g, 0.04, 0.06, 0.04, '#7cb342', -0.2, 0.05, 0);
    },
    golden(g) { box(g, 0.22, 0.22, 0.22, goldMat); box(g, 0.23, 0.04, 0.23, '#fff3c4'); },
  };
  function buildToy(type) {
    const g = new THREE.Group();
    (TOY_BUILD[type] || TOY_BUILD.tennis)(g);
    return g;
  }

  // =====================================================================
  // Dog portraits (little pixel-art faces for the status bubbles)
  // =====================================================================
  const portraitCache = new Map();
  function portraitURL(bi) {
    if (portraitCache.has(bi)) return portraitCache.get(bi);
    const b = BREEDS[bi] || BREEDS[0];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const px = (col, X, Y, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(X * 4, Y * 4, w * 4, h * 4); };
    px(b.body, 4, 3, 8, 1);
    px(b.body, 3, 4, 10, 10);
    px(b.dark, 1, 3, 3, 8);
    px(b.dark, 12, 3, 3, 8);
    px(b.dark, 2, 11, 2, 1);
    px(b.dark, 12, 11, 2, 1);
    px(b.light, 5, 9, 6, 5);
    px('#1a1a1a', 5, 6, 2, 2);
    px('#1a1a1a', 9, 6, 2, 2);
    px('#ffffff', 5, 6);
    px('#ffffff', 9, 6);
    px('#1a1a1a', 7, 9, 2, 2);
    px('#f07f8f', 7, 12, 2, 2);
    const url = c.toDataURL();
    portraitCache.set(bi, url);
    return url;
  }

  // =====================================================================
  // Home: sections ("chunks"), walls, furniture
  // =====================================================================
  const chunkKey = (cx, cz) => cx + ',' + cz;
  let chunkSet = new Set();
  let homeBounds = { x0: 0, x1: CHUNK, z0: 0, z1: CHUNK };
  function syncChunkSet() {
    chunkSet = new Set(state.chunks.map(([x, z]) => chunkKey(x, z)));
    homeBounds = extentOf(state.chunks);
  }
  function extentOf(list) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [cx, cz] of list) {
      x0 = Math.min(x0, cx * CHUNK); x1 = Math.max(x1, (cx + 1) * CHUNK);
      z0 = Math.min(z0, cz * CHUNK); z1 = Math.max(z1, (cz + 1) * CHUNK);
    }
    return { x0, x1, z0, z1 };
  }
  const hasChunk = (cx, cz) => chunkSet.has(chunkKey(cx, cz));
  const isHomeTile = (i, j) => hasChunk(Math.floor(i / CHUNK), Math.floor(j / CHUNK));

  function makeFloorMaterial() {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const x = c.getContext('2d');
    x.fillStyle = '#d8b689'; x.fillRect(0, 0, 2, 2);
    x.fillStyle = '#cba579'; x.fillRect(0, 0, 1, 1); x.fillRect(1, 1, 1, 1);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(CHUNK / 2, CHUNK / 2);
    return new THREE.MeshLambertMaterial({ map: t });
  }
  const floorMat = makeFloorMaterial();
  const ARTS = ['#f6a5c0', '#9ad0a7', '#ffd27a', '#a7b8f5'];

  function buildRoom() {
    roomGroup.clear();
    gridGroup.clear();
    const wall = '#f3dfc1', trim = '#c99f72', lip = '#b98d5f', C = CHUNK, h = C / 2;
    state.chunks.forEach(([cx, cz], n) => {
      const x0 = cx * C, z0 = cz * C;
      const floor = new THREE.Mesh(geo(C, 0.12, C), floorMat);
      floor.position.set(x0 + h, -0.06, z0 + h);
      roomGroup.add(floor);

      const grid = new THREE.GridHelper(C, C, 0x7a5a3a, 0x7a5a3a);
      grid.material.transparent = true;
      grid.material.opacity = 0.35;
      grid.position.set(x0 + h, 0.012, z0 + h);
      gridGroup.add(grid);

      const westOpen = hasChunk(cx - 1, cz);
      // Walls only on the sides facing away from the camera (north = -z, west = -x)
      if (!hasChunk(cx, cz - 1)) {
        const xs = westOpen ? x0 : x0 - 0.2, len = x0 + C - xs, mid = xs + len / 2;
        box(roomGroup, len, 2.4, 0.2, wall, mid, 1.2, z0 - 0.1);
        box(roomGroup, len, 0.16, 0.26, trim, mid, 0.08, z0 - 0.1);
        box(roomGroup, len + 0.04, 0.1, 0.26, trim, mid, 2.43, z0 - 0.1);
        box(roomGroup, 1.2, 0.95, 0.06, '#ffffff', x0 + h, 1.45, z0 + 0.02);
        box(roomGroup, 1.02, 0.77, 0.07, '#a9d8f5', x0 + h, 1.45, z0 + 0.03);
        box(roomGroup, 0.06, 0.77, 0.08, '#ffffff', x0 + h, 1.45, z0 + 0.035);
        box(roomGroup, 1.02, 0.06, 0.08, '#ffffff', x0 + h, 1.45, z0 + 0.035);
      }
      if (!westOpen) {
        box(roomGroup, 0.2, 2.4, C, wall, x0 - 0.1, 1.2, z0 + h);
        box(roomGroup, 0.26, 0.16, C, trim, x0 - 0.1, 0.08, z0 + h);
        box(roomGroup, 0.26, 0.1, C, trim, x0 - 0.1, 2.43, z0 + h);
        box(roomGroup, 0.06, 0.66, 0.86, '#8a5a3b', x0 + 0.03, 1.5, z0 + h);
        box(roomGroup, 0.07, 0.5, 0.7, ARTS[(n + cx + cz + 8) % ARTS.length], x0 + 0.035, 1.5, z0 + h);
        box(roomGroup, 0.08, 0.16, 0.16, '#ffffff', x0 + 0.04, 1.58, z0 + h + 0.15);
      }
      // Low edges on the open sides
      if (!hasChunk(cx, cz + 1)) box(roomGroup, C, 0.14, 0.08, lip, x0 + h, -0.06, z0 + C + 0.04);
      if (!hasChunk(cx + 1, cz)) box(roomGroup, 0.08, 0.14, C + 0.08, lip, x0 + C + 0.04, -0.06, z0 + h + 0.04);
    });
  }

  const furnRT = new Map();   // furniture entry -> { group, claim }
  let furnMap = new Map();    // 'i,j' -> furniture entry
  function rebuildFurniture() {
    furnGroup.clear();
    furnRT.clear();
    furnMap = new Map();
    for (const f of state.furniture) {
      const g = buildItem(f.type);
      g.position.set(f.i + 0.5, 0, f.j + 0.5);
      g.rotation.y = (f.rot || 0) * Math.PI / 2;
      furnGroup.add(g);
      furnRT.set(f, { group: g, claim: null });
      furnMap.set(f.i + ',' + f.j, f);
      if (g.userData.content) g.userData.content.visible = !!f.filled;
    }
  }
  function refreshBowl(f) {
    const r = furnRT.get(f);
    if (r && r.group.userData.content) r.group.userData.content.visible = !!f.filled;
  }
  const furnitureAt = (i, j) => furnMap.get(i + ',' + j);
  const tileCenter = (f) => new V3(f.i + 0.5, 0, f.j + 0.5);
  const roleOf = (f) => ITEMS[f.type] && ITEMS[f.type].role;

  // ----- construction site -----
  let siteLabel = null;
  function rebuildSite() {
    siteGroup.clear();
    siteLabel = null;
    const b = state.build;
    if (!b) return;
    const C = CHUNK, x0 = b.cx * C, z0 = b.cz * C, h = C / 2;
    box(siteGroup, C, 0.08, C, '#b8956a', x0 + h, -0.06, z0 + h);
    for (let k = 0; k <= C; k += 1.5) {
      for (const [x, z] of [[x0 + k, z0], [x0 + k, z0 + C], [x0, z0 + k], [x0 + C, z0 + k]]) box(siteGroup, 0.1, 0.55, 0.1, '#ff8c1a', x, 0.27, z);
    }
    for (const [x, z, w, d] of [[x0 + h, z0, C, 0.05], [x0 + h, z0 + C, C, 0.05], [x0, z0 + h, 0.05, C], [x0 + C, z0 + h, 0.05, C]]) {
      box(siteGroup, w, 0.08, d, '#ff8c1a', x, 0.42, z);
      box(siteGroup, w, 0.06, d, '#ffffff', x, 0.28, z);
    }
    for (const [x, z] of [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]]) box(siteGroup, 0.1, 2.1, 0.1, '#9aa5ad', x0 + x, 1.05, z0 + z);
    box(siteGroup, 3.1, 0.08, 0.1, '#9aa5ad', x0 + 3, 2.05, z0 + 1.5);
    box(siteGroup, 3.1, 0.08, 0.1, '#9aa5ad', x0 + 3, 2.05, z0 + 4.5);
    box(siteGroup, 0.1, 0.08, 3.1, '#9aa5ad', x0 + 1.5, 2.05, z0 + 3);
    box(siteGroup, 0.1, 0.08, 3.1, '#9aa5ad', x0 + 4.5, 2.05, z0 + 3);
    box(siteGroup, 3.0, 0.06, 0.6, '#c8a165', x0 + 3, 1.2, z0 + 1.5);
    for (let k = 0; k < 3; k++) box(siteGroup, 1.3, 0.08, 0.3, '#c8a165', x0 + 4.3, 0.04 + k * 0.08, z0 + 3.3 + (k % 2) * 0.05);
    for (const [x, z] of [[1.2, 3.6], [1.45, 3.6], [1.32, 3.85]]) box(siteGroup, 0.22, 0.12, 0.12, '#c0694f', x0 + x, 0.06, z0 + z);
    box(siteGroup, 0.24, 0.32, 0.24, '#ff8c1a', x0 + 2.6, 0.16, z0 + 4.8);
    box(siteGroup, 0.26, 0.06, 0.26, '#ffffff', x0 + 2.6, 0.2, z0 + 4.8);
    siteLabel = textSprite('🏗️ ' + fmtTime(b.readyAt - Date.now()), 0.8);
    siteLabel.material.depthTest = false;
    siteLabel.renderOrder = 10;
    siteLabel.position.set(x0 + h, 2.7, z0 + h);
    siteGroup.add(siteLabel);
  }

  // ----- choosing where to build -----
  let buildCands = [];
  let buildPick = null;
  const candMat = new THREE.MeshBasicMaterial({ color: 0x6ccf6c, transparent: true, opacity: 0.4, depthWrite: false });
  const candSelMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.6, depthWrite: false });
  const plusMat = new THREE.SpriteMaterial({ map: emojiTexture('➕'), transparent: true, depthWrite: false });
  function findCandidates() {
    const out = [], seen = new Set();
    for (const [cx, cz] of state.chunks) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = chunkKey(cx + dx, cz + dz);
        if (!chunkSet.has(k) && !seen.has(k)) { seen.add(k); out.push([cx + dx, cz + dz]); }
      }
    }
    return out;
  }
  function showCandidates() {
    candGroup.clear();
    for (const [cx, cz] of buildCands) {
      const isPick = buildPick && buildPick[0] === cx && buildPick[1] === cz;
      const m = new THREE.Mesh(geo(CHUNK - 0.3, 0.04, CHUNK - 0.3), isPick ? candSelMat : candMat);
      m.position.set(cx * CHUNK + CHUNK / 2, 0.03, cz * CHUNK + CHUNK / 2);
      candGroup.add(m);
      const s = new THREE.Sprite(plusMat);
      s.scale.set(1.3, 1.3, 1);
      s.position.set(cx * CHUNK + CHUNK / 2, 0.9, cz * CHUNK + CHUNK / 2);
      candGroup.add(s);
    }
  }

  // =====================================================================
  // Park
  // =====================================================================
  const parkColliders = [];
  const sniffSpots = [];
  const parkWater = { pos: new V3(-2.4, 0, 13.6), bowl: new V3(-2.4, 0, 14.25), taken: null };
  function onPath(x, z) {
    return (Math.abs(Math.abs(x) - 11) < 1.3 && Math.abs(z) < 12.3) ||
           (Math.abs(Math.abs(z) - 11) < 1.3 && Math.abs(x) < 12.3) ||
           (Math.abs(x) < 1.3 && z > 10);
  }
  const POND = { x0: 3, x1: 9, z0: -7, z1: -2 };
  const inPond = (x, z, m = 0) => x > POND.x0 - m && x < POND.x1 + m && z > POND.z0 - m && z < POND.z1 + m;

  function buildPark() {
    const r = mulberry32(42);
    box(parkRoot, 100, 0.1, 100, '#86c06c', 0, -0.05, 0);
    box(parkRoot, 39, 0.1, 39, '#8ccb72', 0, -0.045, 0);

    const pc = '#dcc694';
    box(parkRoot, 23.6, 0.04, 1.6, pc, 0, 0.02, -11);
    box(parkRoot, 23.6, 0.04, 1.6, pc, 0, 0.02, 11);
    box(parkRoot, 1.6, 0.04, 23.6, pc, -11, 0.021, 0);
    box(parkRoot, 1.6, 0.04, 23.6, pc, 11, 0.021, 0);
    box(parkRoot, 1.6, 0.04, 8.6, pc, 0, 0.022, 15.3);

    box(parkRoot, 6.6, 0.06, 5.6, '#cdb88d', 6, 0.02, -4.5);
    box(parkRoot, 6, 0.07, 5, '#5aa7d6', 6, 0.03, -4.5);
    box(parkRoot, 0.5, 0.08, 0.5, '#7fbf5a', 4.5, 0.07, -3.5);
    box(parkRoot, 0.4, 0.08, 0.4, '#7fbf5a', 7.6, 0.07, -5.8);
    parkColliders.push({ x0: POND.x0, x1: POND.x1, z0: POND.z0, z1: POND.z1 });

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

    // dog water fountain near the gate
    const wp = parkWater.pos, wb = parkWater.bowl;
    box(parkRoot, 0.6, 0.5, 0.6, '#a7a39c', wp.x, 0.25, wp.z);
    box(parkRoot, 0.7, 0.1, 0.7, '#8c8780', wp.x, 0.55, wp.z);
    box(parkRoot, 0.5, 0.04, 0.5, waterMat, wp.x, 0.61, wp.z);
    box(parkRoot, 0.1, 0.5, 0.1, '#7d8a94', wp.x, 0.85, wp.z - 0.2);
    box(parkRoot, 0.1, 0.08, 0.24, '#7d8a94', wp.x, 1.08, wp.z - 0.1);
    box(parkRoot, 0.44, 0.1, 0.44, '#3d7fd6', wb.x, 0.05, wb.z);
    box(parkRoot, 0.32, 0.03, 0.32, waterMat, wb.x, 0.1, wb.z);
    const drop = emojiSprite('💧', 0.45);
    drop.position.set(wp.x, 1.55, wp.z);
    parkRoot.add(drop);
    parkColliders.push({ x: wp.x, z: wp.z, r: 0.4 });

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
      const sparkle = emojiSprite('✨', 0.5);
      sparkle.position.set(0, 1.15, 0);
      g.add(sparkle);
      parkColliders.push({ x, z, r: 0.42 });
      sniffSpots.push({ pos: new V3(x, 0, z), cooldown: 0, sparkle, taken: null, phase: r() * 6 });
    });

    const trees = [];
    for (let tries = 0; tries < 400 && trees.length < 34; tries++) {
      const x = (r() * 2 - 1) * 18, z = (r() * 2 - 1) * 18;
      if (onPath(x, z) || inPond(x, z, 1.5)) continue;
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

    for (const [x, z, ry] of [[-4, -12.6, 0], [3.5, 12.6, Math.PI], [12.6, -3, -Math.PI / 2]]) {
      const g = pivot(parkRoot, x, 0, z);
      g.rotation.y = ry;
      box(g, 1.6, 0.08, 0.45, '#a0703f', 0, 0.42, 0);
      box(g, 1.6, 0.35, 0.08, '#a0703f', 0, 0.68, -0.2);
      box(g, 0.1, 0.4, 0.4, '#555555', -0.65, 0.2, 0);
      box(g, 0.1, 0.4, 0.4, '#555555', 0.65, 0.2, 0);
    }
    for (const [x, z] of [[-12.4, -12.4], [12.4, -12.4], [-12.4, 12.4], [12.4, 12.4]]) {
      box(parkRoot, 0.14, 2.2, 0.14, '#3d3a40', x, 1.1, z);
      box(parkRoot, 0.36, 0.3, 0.36, lampMat, x, 2.3, z);
    }

    const tuft = new THREE.InstancedMesh(geo(0.12, 0.16, 0.12), mat('#6ba95a'), 260);
    const flower = new THREE.InstancedMesh(geo(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: '#ffffff' }), 140);
    const fcols = ['#f06292', '#ffd54f', '#ffffff', '#ba68c8', '#ff8a65'].map((c) => new THREE.Color(c));
    let ti = 0, fi = 0;
    while (ti < 260 || fi < 140) {
      const x = (r() * 2 - 1) * 19, z = (r() * 2 - 1) * 19;
      if (onPath(x, z) || inPond(x, z, 0.4)) continue;
      m4.makeTranslation(x, 0.07, z);
      if (ti < 260) tuft.setMatrixAt(ti++, m4);
      else { flower.setMatrixAt(fi, m4); flower.setColorAt(fi, fcols[fi % fcols.length]); fi++; }
    }
    parkRoot.add(tuft, flower);
  }

  // Toys lying around in the park (rare)
  let parkLoot = null;
  function rollToy() {
    const list = Object.entries(TOYS);
    let total = list.reduce((s, [, t]) => s + t.weight, 0), r = Math.random() * total;
    for (const [k, t] of list) { r -= t.weight; if (r <= 0) return k; }
    return 'stick';
  }
  function clearParkLoot() {
    if (parkLoot) { parkRoot.remove(parkLoot.group); parkLoot = null; }
  }
  function spawnParkLoot() {
    clearParkLoot();
    if (Math.random() > 0.3) return;
    for (let tries = 0; tries < 60; tries++) {
      const x = rand(-16, 16), z = rand(-16, 11);
      if (isSolid(x, z) || inPond(x, z, 0.6) || Math.hypot(x, z - 16) < 6) continue;
      const type = rollToy();
      const group = pivot(parkRoot, x, 0, z);
      const toy = buildToy(type);
      toy.position.y = 0.16;
      toy.scale.setScalar(1.3);
      group.add(toy);
      const sparkle = emojiSprite('✨', 0.45);
      sparkle.position.y = 0.75;
      group.add(sparkle);
      parkLoot = { type, group, toy, sparkle, t: 0 };
      return;
    }
  }
  function updateParkLoot(dt) {
    if (!parkLoot) return;
    parkLoot.t += dt;
    parkLoot.toy.rotation.y += dt * 1.5;
    parkLoot.sparkle.position.y = 0.75 + Math.sin(parkLoot.t * 3) * 0.08;
    const p = player.root.position, g = parkLoot.group.position;
    if (Math.hypot(p.x - g.x, p.z - g.z) < 0.9) {
      const type = parkLoot.type;
      const pos = g.clone();
      clearParkLoot();
      grantToy(type, pos);
    }
  }
  function grantToy(type, pos) {
    const t = TOYS[type];
    if (state.toys.includes(type)) {
      addCoins(5, pos);
      toast(`You found another ${t.name} ${t.icon} — traded it for 🪙 5`);
    } else {
      state.toys.push(type);
      toast(`You found a ${t.name} ${t.icon}! It's in your 🎒 bag`);
      save();
    }
    if (pos) spawnEmoji(t.icon, pos.clone().add(new V3(0, 1, 0)), { size: 0.6, life: 1.6, vy: 0.8 });
  }

  // =====================================================================
  // Collision + pathfinding (shared by the player and dogs)
  // =====================================================================
  function isSolid(x, z) {
    if (place === 'home') {
      const i = Math.floor(x), j = Math.floor(z);
      if (!isHomeTile(i, j)) return true;
      const f = furnitureAt(i, j);
      return !!(f && ITEMS[f.type].solid);
    }
    for (const c of parkColliders) {
      if (c.r !== undefined) { if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true; }
      else if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
    }
    return false;
  }
  function bounds() {
    if (place === 'home') return { x0: homeBounds.x0 + 0.25, x1: homeBounds.x1 - 0.25, z0: homeBounds.z0 + 0.25, z1: homeBounds.z1 - 0.25 };
    return { x0: -19.2, x1: 19.2, z0: -19.2, z1: 19.2 };
  }
  function inBounds(x, z, m = 0) {
    const b = bounds();
    return x >= b.x0 + m && x <= b.x1 - m && z >= b.z0 + m && z <= b.z1 - m;
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
    const b = bounds();
    pos.x = clamp(pos.x, b.x0, b.x1);
    pos.z = clamp(pos.z, b.z0, b.z1);
  }

  function passable(i, j) {
    if (!isHomeTile(i, j)) return false;
    const f = furnitureAt(i, j);
    return !(f && ITEMS[f.type].solid);
  }
  function lineClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-3) return true;
    const px = (-dz / d) * 0.2, pz = (dx / d) * 0.2;
    const n = Math.ceil(d / 0.2);
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = ax + dx * t, z = az + dz * t;
      if (isSolid(x, z) || isSolid(x + px, z + pz) || isSolid(x - px, z - pz)) return false;
    }
    return true;
  }
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  // Tile-based path through the home, smoothed so dogs walk in straight lines where they can
  function findPath(from, to) {
    const goal = new V3(to.x, 0, to.z);
    if (lineClear(from.x, from.z, to.x, to.z)) return [goal];
    const si = Math.floor(from.x), sj = Math.floor(from.z), ti = Math.floor(to.x), tj = Math.floor(to.z);
    const key = (i, j) => i + ',' + j;
    const prev = new Map([[key(si, sj), null]]);
    const queue = [[si, sj]];
    let found = false;
    for (let h = 0; h < queue.length && h < 5000; h++) {
      const [i, j] = queue[h];
      if (i === ti && j === tj) { found = true; break; }
      for (const [di, dj] of DIRS8) {
        const ni = i + di, nj = j + dj, k = key(ni, nj);
        if (prev.has(k)) continue;
        const isGoal = ni === ti && nj === tj;
        if (isGoal ? !isHomeTile(ni, nj) : !passable(ni, nj)) continue;
        if (di && dj && (!passable(i + di, j) || !passable(i, j + dj))) continue;
        prev.set(k, [i, j]);
        queue.push([ni, nj]);
      }
    }
    if (!found) return [goal];
    const tiles = [];
    let cur = [ti, tj];
    while (cur && !(cur[0] === si && cur[1] === sj)) { tiles.push(cur); cur = prev.get(key(cur[0], cur[1])); }
    tiles.reverse();
    if (!tiles.length) return [goal];
    const pts = tiles.map(([i, j]) => new V3(i + 0.5, 0, j + 0.5));
    pts[pts.length - 1] = goal;
    const out = [];
    let cx = from.x, cz = from.z, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !lineClear(cx, cz, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      cx = pts[j].x; cz = pts[j].z;
      i = j + 1;
    }
    return out;
  }

  function randomFreePoint() {
    for (let k = 0; k < 40; k++) {
      const [cx, cz] = pick(state.chunks);
      const x = cx * CHUNK + rand(0.5, CHUNK - 0.5), z = cz * CHUNK + rand(0.5, CHUNK - 0.5);
      if (!isSolid(x, z)) return new V3(x, 0, z);
    }
    return new V3(CHUNK / 2, 0, CHUNK / 2);
  }
  function freeNear(x, z) {
    return isSolid(x, z) ? randomFreePoint() : new V3(x, 0, z);
  }

  // =====================================================================
  // Particles & small effects
  // =====================================================================
  const particles = [];
  function spawnEmoji(e, pos, opts = {}) {
    const size = opts.size || 0.45;
    const s = emojiSprite(e, size);
    s.position.copy(pos);
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
      p.s.material.opacity = clamp((p.life / p.max) * 1.6, 0, 1);
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
    box(body, 0.05, 0.07, 0.02, '#222222', -0.08, 1.17, 0.171);
    box(body, 0.05, 0.07, 0.02, '#222222', 0.08, 1.17, 0.171);
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
      this.thirst = data.thirst ?? 85;
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
      this.path = null;
      this.claim = null;
      this.spot = null;
      this.zTimer = 0;
      this.sniffCheck = 2;
      this.lastBubble = '';
      this.ui = null;
      this.build();
    }

    build() {
      const b = BREEDS[this.breed];
      const root = new THREE.Group();
      const body = pivot(root);
      box(body, 0.46, 0.32, 0.72, b.body, 0, 0.44, 0);
      box(body, 0.3, 0.06, 0.5, b.light, 0, 0.27, 0.02);
      box(body, 0.4, 0.1, 0.12, '#d93a3a', 0, 0.58, 0.32);
      box(body, 0.08, 0.08, 0.04, '#ffd54f', 0, 0.5, 0.39);

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
      return {
        name: this.name, breed: this.breed,
        hunger: Math.round(this.hunger), thirst: Math.round(this.thirst),
        energy: Math.round(this.energy), happy: Math.round(this.happy),
      };
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
      this.path = null;
      this.repath = 0;
      this.replanned = false;
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
      this.path = null;
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
        this.thirst -= 0.32 * dt;
        this.energy -= 0.22 * dt;
        if (this.energy > CRITICAL) this.happy += 0.15 * dt;
      } else {
        this.hunger -= 0.1 * dt;
        this.thirst -= 0.13 * dt;
        if (this.state === 'sleep') this.energy += 4 * dt;
        else this.energy -= 0.05 * dt;
        const needy = this.hunger < LOW || this.thirst < LOW || this.energy < CRITICAL;
        this.happy -= (needy ? 0.25 : 0.07) * dt;
      }
      this.hunger = clamp(this.hunger, 0, 100);
      this.thirst = clamp(this.thirst, 0, 100);
      this.energy = clamp(this.energy, 0, 100);
      this.happy = clamp(this.happy, 0, 100);
    }

    statusText() {
      switch (this.state) {
        case 'sleep': return 'Sleeping 💤';
        case 'eat': return 'Eating 😋';
        case 'drink': return 'Drinking 💧';
        case 'fetch': case 'return': return 'Playing fetch ' + (TOYS[ball.type] ? TOYS[ball.type].icon : '');
        case 'sniff': return 'Sniffing around 👃';
        case 'happy': return 'So happy! 💕';
      }
      const needs = [['hunger', 'Hungry'], ['thirst', 'Thirsty'], ['energy', 'Tired'], ['happy', 'Wants attention']]
        .filter(([k]) => this[k] < 30).sort((a, b) => this[a[0]] - this[b[0]]);
      if (needs.length) return needs[0][1];
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
        case 'drink':
          this.timer -= dt;
          if (this.timer <= 0) this.finishConsume();
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
            this.root.position.set(c.x, ITEMS[bed.type].sleepY || 0.1, c.z);
            this.claim = bed;
            this.setState('sleep');
            this.zTimer = 0.5;
          }, 0.15);
          return;
        }
        if (this.energy < 12) { this.setState('sleep'); return; }
      }
      if (this.thirst < 60) {
        const w = findFurniture('water', this, true, this.root.position);
        if (w) { sendToBowl(this, w); return; }
      }
      if (this.hunger < 60) {
        const b = findFurniture('food', this, true, this.root.position);
        if (b) { sendToBowl(this, b); return; }
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
      const pos = this.root.position;
      let wx = t.x, wz = t.z;
      if (place === 'home') {
        this.repath -= dt;
        if (!this.path || this.repath <= 0) {
          this.path = findPath(pos, t);
          this.repath = typeof this.target === 'function' ? 0.8 : 1e9;
        }
        while (this.path.length > 1 && Math.hypot(this.path[0].x - pos.x, this.path[0].z - pos.z) < 0.3) this.path.shift();
        if (this.path.length > 1) { wx = this.path[0].x; wz = this.path[0].z; }
      }
      this.moveTowards(wx, wz, this.moveSpeed, dt);
      const d = Math.hypot(t.x - pos.x, t.z - pos.z);
      if (d <= this.arriveDist) {
        const cb = this.onArrive;
        this.onArrive = null;
        this.target = null;
        this.path = null;
        this.idle();
        if (cb) cb();
        return;
      }
      this.stuckT += dt;
      if (this.stuckT > 1) {
        this.stuckN = this.lastD - d < 0.15 ? this.stuckN + 1 : 0;
        this.lastD = d;
        this.stuckT = 0;
        if (this.stuckN >= 2 && place === 'home' && !this.replanned) {
          this.replanned = true;
          this.path = null;
          this.stuckN = 0;
        } else if (this.stuckN >= 2 || this.stateTime > 20) {
          this.onArrive = null;
          this.path = null;
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
      const tired = this.energy < CRITICAL ? 0.6 : 1;
      if (d > 0.35) this.moveTowards(tx, tz, (d > 2.2 ? 4.2 : 2.4) * tired, dt);
      this.sniffCheck -= dt;
      if (this.sniffCheck > 0) return;
      this.sniffCheck = rand(1, 2.5);
      const wb = parkWater.bowl;
      if (this.thirst < 65 && !parkWater.taken && pos.distanceTo(wb) < 6 && pp.distanceTo(wb) < 5) {
        parkWater.taken = this;
        this.spot = parkWater;
        this.goTo(wb, 3, () => {
          this.spot = parkWater;
          this.faceTo(wb);
          this.setState('drink', 2.4);
        }, 0.45);
        return;
      }
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

    finishConsume() {
      if (this.spot === parkWater) {
        this.thirst = 100;
        this.happy = Math.min(100, this.happy + 3);
        spawnEmoji('💦', this.headWorld(0.3), { size: 0.4 });
        this.dropSpot();
        this.setState('follow');
        return;
      }
      const bowl = this.claim;
      if (bowl && bowl.filled) {
        bowl.filled = false;
        refreshBowl(bowl);
        if (roleOf(bowl) === 'water') { this.thirst = 100; spawnEmoji('💦', this.headWorld(0.4), { size: 0.4 }); }
        else { this.hunger = 100; spawnEmoji('😋', this.headWorld(0.4), { size: 0.4 }); }
        this.happy = Math.min(100, this.happy + 5);
      }
      this.releaseClaim();
      this.idle();
    }

    finishSniff() {
      const spot = this.spot;
      if (spot && spot.cooldown <= 0) {
        spot.cooldown = 45;
        this.happy = Math.min(100, this.happy + 10);
        if (Math.random() < 0.08) grantToy(rollToy(), this.root.position);
        else {
          addCoins(2, this.root.position);
          spawnEmoji('✨', this.headWorld(0.3), { size: 0.4 });
        }
      }
      this.dropSpot();
      this.setState('follow');
    }

    startFetch() {
      this.releaseClaim();
      this.dropSpot();
      this.root.position.y = 0;
      this.onArrive = null;
      this.path = null;
      this.setState('fetch');
    }

    updateFetch(dt) {
      if (!ball.active || (ball.held && ball.held !== this)) { this.idle(); return; }
      const bp = ball.flying ? ball.to : ball.mesh.position;
      const d = this.moveTowards(bp.x, bp.z, 4.3 * (this.energy < CRITICAL ? 0.6 : 1), dt);
      if (!ball.flying && d < 0.35) { ball.held = this; this.setState('return'); }
      else if (this.stateTime > 12) { resetBall(); this.idle(); }
    }

    updateReturn(dt) {
      const pp = player.root.position;
      let tx = pp.x, tz = pp.z;
      if (place === 'home') {
        this.repath = (this.repath || 0) - dt;
        if (!this.path || this.repath <= 0) { this.path = findPath(this.root.position, pp); this.repath = 0.8; }
        while (this.path.length > 1 && this.path[0].distanceTo(this.root.position) < 0.3) this.path.shift();
        if (this.path.length > 1) { tx = this.path[0].x; tz = this.path[0].z; }
      }
      this.moveTowards(tx, tz, 3.6, dt);
      const d = this.root.position.distanceTo(pp);
      if (d < 1.0 || this.stateTime > 15) {
        const def = TOYS[ball.type] || TOYS.tennis;
        resetBall();
        this.path = null;
        this.happy = Math.min(100, this.happy + (def.happy || 15));
        this.energy = Math.max(0, this.energy - 4);
        this.faceTo(pp);
        spawnEmoji('❤️', this.headWorld(0.4), { size: 0.4 });
        const bonus = (place === 'park' ? 1 : 0) + (def.coins || 0);
        if (bonus) addCoins(bonus, this.root.position);
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
      else if (st === 'drink') { headRX = 0.8 + Math.sin(this.t * 22) * 0.08; headY = 0.6; }
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
      this.tail.rotation.x = lerp(this.tail.rotation.x, this.happy < LOW ? 0.1 : 0.75, k);
      const flap = Math.sin(this.phase * 2) * 0.22 * this.walkBlend + (st === 'happy' ? Math.sin(this.t * 18) * 0.2 : 0);
      this.earL.rotation.z = -0.12 + flap;
      this.earR.rotation.z = 0.12 - flap;
      this.tongue.visible = st === 'happy' || st === 'drink' || (this.moving && this.curSpeed > 3 && st !== 'return');
    }

    updateBubble() {
      let e = '';
      if (this.state !== 'sleep') {
        const ICON = { hunger: '🍖', thirst: '💧', energy: '😴', happy: '💔' };
        let low = null;
        for (const k of ['hunger', 'thirst', 'energy', 'happy']) {
          if (this[k] < LOW && (!low || this[k] < this[low])) low = k;
        }
        if (low) e = ICON[low];
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

  function findFurniture(role, dog, needFilled, from) {
    let best = null, bd = Infinity;
    for (const f of state.furniture) {
      if (roleOf(f) !== role) continue;
      if (needFilled && !f.filled) continue;
      const r = furnRT.get(f);
      if (r && r.claim && r.claim !== dog) continue;
      const d = from.distanceTo(tileCenter(f));
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function sendToBowl(d, bowl) {
    d.claimItem(bowl);
    const c = tileCenter(bowl);
    d.goTo(c, 2.4, () => {
      d.claim = bowl;
      d.faceTo(c);
      d.setState(roleOf(bowl) === 'water' ? 'drink' : 'eat', 2.6);
    }, 0.5);
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
    d.root.position.copy(nearPlayer ? freeNear(p.x + rand(-0.8, 0.8), p.z - 1) : randomFreePoint());
    d.root.rotation.y = d.face = rand(0, TAU);
    world.add(d.root);
    dogs.push(d);
    makePill(d);
    return d;
  }

  // =====================================================================
  // Dog status bubbles (top left)
  // =====================================================================
  const levelClass = (v) => (v < CRITICAL ? 'red' : v < LOW ? 'on' : '');
  function makePill(d) {
    const el = document.createElement('div');
    el.className = 'dogPill';
    el.innerHTML =
      '<div class="pRow">' +
        `<img class="portrait" src="${portraitURL(d.breed)}" alt="">` +
        '<div class="pInfo"><div class="pName"></div><div class="pStatus"></div></div>' +
        '<div class="alerts"></div>' +
      '</div>' +
      '<div class="details">' +
        STATS.map((s) => `<div class="bar"><span class="bic">${s.ic}<i class="badge">!</i></span><div class="track"><div class="fill ${s.k}"></div></div></div>`).join('') +
      '</div>';
    el.querySelector('.pName').textContent = d.name;
    d.ui = {
      el,
      open: false,
      alertKey: null,
      status: el.querySelector('.pStatus'),
      alerts: el.querySelector('.alerts'),
      fills: [...el.querySelectorAll('.fill')],
      badges: [...el.querySelectorAll('.bic .badge')],
    };
    el.addEventListener('click', () => {
      selected = d;
      d.ui.open = !d.ui.open;
      el.classList.toggle('open', d.ui.open);
      updatePack();
    });
    $('pack').appendChild(el);
  }
  function updatePack() {
    for (const d of dogs) {
      const u = d.ui;
      if (!u) continue;
      u.el.classList.toggle('sel', d === selected && dogs.length > 1);
      const lows = STATS.filter((s) => d[s.k] < LOW);
      const key = lows.map((s) => s.k + levelClass(d[s.k])).join(',');
      if (key !== u.alertKey) {
        u.alertKey = key;
        u.alerts.innerHTML = lows.map((s) => `<span class="al">${s.ic}<i class="badge ${levelClass(d[s.k])}">!</i></span>`).join('');
      }
      if (u.open) {
        STATS.forEach((s, i) => {
          u.fills[i].style.width = Math.round(d[s.k]) + '%';
          u.badges[i].className = 'badge ' + levelClass(d[s.k]);
        });
        u.status.textContent = d.statusText();
      }
    }
  }

  // =====================================================================
  // Throwing toys
  // =====================================================================
  const ball = { mesh: new THREE.Group(), type: null, active: false, flying: false, t: 0, from: new V3(), to: new V3(), held: null, bounce: 0 };
  ball.mesh.visible = false;
  world.add(ball.mesh);
  function setBallToy(type) {
    if (ball.type === type) return;
    ball.mesh.clear();
    ball.mesh.add(buildToy(type));
    ball.type = type;
  }

  function resetBall() {
    ball.active = false;
    ball.flying = false;
    ball.held = null;
    ball.mesh.visible = false;
  }
  const canPlay = (d) => d.energy > 8 && !['sleep', 'eat', 'drink', 'fetch', 'return'].includes(d.state);

  function throwBall() {
    if (ball.active) { toast('A toy is already out!'); return; }
    let dog = selected && canPlay(selected) ? selected : null;
    if (!dog) {
      const pp = player.root.position;
      dog = dogs.filter(canPlay).sort((a, b) => a.root.position.distanceTo(pp) - b.root.position.distanceTo(pp))[0];
    }
    if (!dog) { toast(dogs.some((d) => d.state === 'sleep') ? 'Shh… your dog is napping 💤' : 'Too tired to play right now 😴'); return; }
    const def = TOYS[state.toy] || TOYS.tennis;
    const p = player.root.position, a = player.root.rotation.y;
    let dist = rand(3.5, 5.5) * def.dist, tx = 0, tz = 0, ok = false;
    for (; dist > 0.9; dist -= 0.4) {
      tx = p.x + Math.sin(a) * dist;
      tz = p.z + Math.cos(a) * dist;
      if (inBounds(tx, tz, 0.3) && !isSolid(tx, tz) && (place === 'home' || lineClearPark(p, tx, tz))) { ok = true; break; }
    }
    if (!ok) { toast('No room to throw — turn around!'); return; }
    setBallToy(state.toy);
    player.hand.getWorldPosition(ball.from);
    ball.to.set(tx, def.restY, tz);
    ball.t = 0;
    ball.flying = true;
    ball.active = true;
    ball.held = null;
    ball.mesh.visible = true;
    ball.mesh.position.copy(ball.from);
    ball.mesh.rotation.set(0, a, 0);
    player.throwT = 0.3;
    dog.startFetch();
  }
  function lineClearPark(p, tx, tz) {
    // don't let toys land in the pond
    return !inPond(tx, tz, 0.3);
  }

  function updateBall(dt) {
    if (!ball.active) return;
    const def = TOYS[ball.type] || TOYS.tennis;
    if (ball.flying) {
      ball.t += dt / (def.time || 0.75);
      const t = Math.min(1, ball.t);
      ball.mesh.position.set(
        lerp(ball.from.x, ball.to.x, t),
        lerp(ball.from.y, def.restY, t) + Math.sin(Math.PI * t) * def.arc,
        lerp(ball.from.z, ball.to.z, t));
      if (def.spin === 'flat') { ball.mesh.rotation.x = 0; ball.mesh.rotation.z = 0; ball.mesh.rotation.y += dt * 15; }
      else if (def.spin === 'tumble') { ball.mesh.rotation.x += dt * 9; ball.mesh.rotation.z += dt * 6; }
      else ball.mesh.rotation.x += dt * 10;
      if (ball.t >= 1) {
        ball.flying = false;
        ball.bounce = 0;
        ball.mesh.rotation.x = 0;
        ball.mesh.rotation.z = 0;
        if (def.squeak) spawnEmoji('🎵', ball.mesh.position.clone().add(new V3(0, 0.4, 0)), { size: 0.35, life: 0.9 });
      }
    } else if (ball.held) {
      ball.held.mouth.getWorldPosition(ball.mesh.position);
      ball.mesh.rotation.set(0, ball.held.root.rotation.y, 0);
    } else {
      ball.bounce += dt;
      const fade = Math.max(0, 1 - ball.bounce / (def.decay ? def.decay * 2 : 0.5));
      ball.mesh.position.y = def.restY + Math.abs(Math.sin(ball.bounce * 8)) * def.bounce * fade;
    }
  }

  function updateToyIcons() {
    const icon = (TOYS[state.toy] || TOYS.tennis).icon;
    document.querySelectorAll('.toyIcon').forEach((el) => { el.textContent = icon; });
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
      d.path = null;
      d.root.position.set(-0.6 * (dogs.length - 1) / 2 + i * 0.6, 0, 17.3);
      d.root.rotation.y = d.face = Math.PI;
      d.setState('follow');
    });
    parkWater.taken = null;
    walkDist = 0;
    walkEarn = 0;
    tiredWarned = false;
    spawnParkLoot();
    refreshUI();
    updateCamera(0, true);
    toast(parkLoot ? 'Walk time! Something is glinting in the grass… ✨' : 'Walk time! Let your dog sniff the ✨ spots');
  }

  function goHome() {
    place = 'home';
    homeRoot.visible = true;
    parkRoot.visible = false;
    world.fog = null;
    resetBall();
    clearParkLoot();
    player.moveTarget = null;
    const sp = freeNear(CHUNK / 2, CHUNK - 1.2);
    player.root.position.copy(sp);
    player.root.rotation.y = player.face = Math.PI;
    dogs.forEach((d, i) => {
      d.dropSpot();
      d.leash.visible = false;
      d.root.position.copy(freeNear(clamp(CHUNK / 2 - 0.7 + i * 0.5, 0.5, CHUNK - 0.5), CHUNK - 2));
      d.idle(rand(1, 3));
    });
    sniffSpots.forEach((s) => { s.taken = null; });
    parkWater.taken = null;
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
    if (place === 'home' && mode === 'build') {
      const e = extentOf(state.chunks.concat(buildCands));
      tx = (e.x0 + e.x1) / 2;
      tz = (e.z0 + e.z1) / 2;
      dist = 5.5 + Math.max(e.x1 - e.x0, e.z1 - e.z0) * 0.8;
    } else if (place === 'home') {
      const cx = (Math.floor(p.x / CHUNK) + 0.5) * CHUNK, cz = (Math.floor(p.z / CHUNK) + 0.5) * CHUNK;
      tx = lerp(cx, p.x, 0.5);
      tz = lerp(cz, p.z, 0.5);
      dist = 5.5 + CHUNK * 0.85;
    } else {
      tx = p.x; tz = p.z;
      dist = 11;
    }
    dist *= clamp(0.8 / camera.aspect, 1, 1.6) * (mode === 'build' ? 1 : zoom);
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
  const modalOpen = () => ['shop', 'start', 'bag', 'confirm'].some((id) => !$(id).classList.contains('hidden'));

  canvas.addEventListener('pointerdown', (e) => {
    if (modalOpen()) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom };
      if (primary) primary.dragging = true;
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
      zoom = clamp((pinch.z * pinch.d) / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 0.55, 1.8);
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
    if (mode === 'build') { if (hitGround) buildTap(gp); return; }

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
      const b = bounds();
      player.moveTarget = new V3(clamp(gp.x, b.x0, b.x1), 0, clamp(gp.z, b.z0, b.z1));
      tapRing.position.set(player.moveTarget.x, 0.06, player.moveTarget.z);
      tapT = 0.5;
      hideHint();
    }
  }

  function interactDog(d) {
    selected = d;
    updatePack();
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
    if (!selectedInv || !(state.inventory[selectedInv] > 0)) selectedInv = firstInv();
    renderInv();
    refreshUI();
  }
  function exitDecorate() {
    mode = 'normal';
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
    const i = Math.floor(gp.x), j = Math.floor(gp.z);
    if (!isHomeTile(i, j)) return;
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
    rebuildFurniture();
    dogs.forEach((d) => d.reset());
    renderInv();
    save();
  }

  // =====================================================================
  // Home expansion
  // =====================================================================
  function enterBuildMode() {
    if (state.build) { toast('Already building — wait for it to finish 🏗️'); return; }
    mode = 'build';
    buildCands = findCandidates();
    buildPick = null;
    showCandidates();
    refreshUI();
  }
  function exitBuildMode() {
    mode = 'normal';
    buildPick = null;
    buildCands = [];
    candGroup.clear();
    refreshUI();
  }
  function buildTap(gp) {
    const cx = Math.floor(gp.x / CHUNK), cz = Math.floor(gp.z / CHUNK);
    if (!buildCands.some(([x, z]) => x === cx && z === cz)) return;
    buildPick = [cx, cz];
    showCandidates();
    const price = expandPrice(state.chunks.length);
    confirmBox('Build a new room here?', `Costs 🪙 ${price} · ready in ${BUILD_MINUTES} minutes`, `Build for 🪙 ${price}`, state.coins >= price, () => {
      if (state.coins < price) { toast('Not enough coins yet'); return; }
      state.coins -= price;
      state.build = { cx, cz, readyAt: Date.now() + BUILD_MINUTES * 60000 };
      exitBuildMode();
      rebuildSite();
      updateHud();
      toast(`Construction started! Ready in ${BUILD_MINUTES} minutes 🏗️`);
      save();
    }, () => { buildPick = null; showCandidates(); });
  }
  function checkBuild() {
    const b = state.build;
    if (!b || Date.now() < b.readyAt) return;
    state.chunks.push([b.cx, b.cz]);
    state.build = null;
    syncChunkSet();
    buildRoom();
    rebuildSite();
    if (place === 'home') {
      const c = new V3(b.cx * CHUNK + CHUNK / 2, 1.5, b.cz * CHUNK + CHUNK / 2);
      for (let k = 0; k < 6; k++) setTimeout(() => spawnEmoji(pick(['🎉', '✨', '🎊']), c.clone().add(new V3(rand(-2, 2), 0, rand(-2, 2))), { size: 0.6, life: 1.6 }), k * 120);
    }
    toast('🎉 Your new room is finished! Room for one more dog.');
    updateHud();
    save();
  }

  // =====================================================================
  // Feeding & water
  // =====================================================================
  function fillBowls(role) {
    const bowls = state.furniture.filter((f) => roleOf(f) === role);
    const label = role === 'food' ? 'food bowl' : 'water bowl';
    if (!bowls.length) { toast(`Place a ${label} first (🎨 Decorate)`); return; }
    bowls.forEach((b) => { b.filled = true; refreshBowl(b); });
    dogs.forEach((d) => {
      const need = role === 'food' ? d.hunger : d.thirst;
      if (need < 85 && (d.state === 'idle' || d.state === 'sit')) {
        const b = findFurniture(role, d, true, d.root.position);
        if (b) sendToBowl(d, b);
      }
    });
    toast(role === 'food' ? (bowls.length > 1 ? 'Food bowls filled 🥣' : 'Food bowl filled 🥣') : (bowls.length > 1 ? 'Water bowls filled 💧' : 'Water bowl filled 💧'));
    save();
  }

  // =====================================================================
  // Shop, toy bag, adoption, confirm
  // =====================================================================
  const capacity = () => state.chunks.length;
  const adoptPrice = () => 50 * dogs.length;

  function openShop() { renderShop(); $('shop').classList.remove('hidden'); }
  function closeShop() {
    $('shop').classList.add('hidden');
    if (mode === 'decorate') renderInv();
  }
  function renderShop() {
    const L = $('shopList');
    const scroll = L.parentElement.scrollTop;
    L.innerHTML = '';
    $('shopCoins').textContent = state.coins;
    const section = (t) => { const d = document.createElement('div'); d.className = 'section'; d.textContent = t; L.appendChild(d); };
    const row = (icon, title, sub, price, onBuy, disabled, label) => {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = `<div class="ic">${icon}</div><div class="txt"><b></b><small></small></div>`;
      r.querySelector('b').textContent = title;
      r.querySelector('small').textContent = sub;
      const b = document.createElement('button');
      b.className = 'buy';
      b.textContent = label || (price == null ? '—' : `🪙 ${price}`);
      b.disabled = !!disabled || price == null || state.coins < price;
      b.addEventListener('click', () => { if (!b.disabled && state.coins >= price) onBuy(price); });
      r.appendChild(b);
      L.appendChild(r);
    };

    section('🏡 Home');
    const n = state.chunks.length;
    if (state.build) row('🏗️', 'Add a room', `Building… ready in ${fmtTime(state.build.readyAt - Date.now())}`, null, null, true, 'Busy');
    else if (n >= MAX_CHUNKS) row('📐', 'Add a room', 'Your home is as big as it gets', null, null, true, 'Max');
    else row('📐', 'Add a room', `You have ${n} · +1 dog space · ${BUILD_MINUTES} min to build`, expandPrice(n), () => { closeShop(); enterBuildMode(); });
    const cap = capacity(), full = dogs.length >= cap;
    row('🐶', 'Adopt a dog', full ? `Home is full (${dogs.length}/${cap}) — add a room first` : `${dogs.length}/${cap} dogs`, adoptPrice(), () => {
      closeShop();
      openStart(true);
    }, full);

    section('🎾 Toys');
    for (const [k, t] of Object.entries(TOYS)) {
      if (t.price == null || k === 'tennis') continue;
      const owned = state.toys.includes(k);
      row(t.icon, t.name, owned ? 'In your 🎒 bag' : toyBlurb(t), t.price, (p) => {
        state.coins -= p;
        state.toys.push(k);
        state.toy = k;
        updateToyIcons();
        toast(`${t.name} ${t.icon} is ready to throw!`);
        updateHud();
        save();
        renderShop();
      }, owned, owned ? 'Owned' : null);
    }

    for (const [cat, title] of CATS) {
      section(title);
      for (const [t, it] of Object.entries(ITEMS)) {
        if (it.cat !== cat) continue;
        const owned = (state.inventory[t] || 0) + state.furniture.filter((f) => f.type === t).length;
        const kind = it.role === 'bed' ? 'Dogs nap on it' : it.role === 'food' ? 'Fill it with 🥣 Feed' : it.role === 'water' ? 'Fill it with 💧 Water' : it.solid ? 'Decoration' : 'Dogs can walk on it';
        row(it.icon, it.name, owned ? `You have ${owned} · ${kind}` : kind, it.price, (p) => {
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
    L.parentElement.scrollTop = scroll;
  }
  function toyBlurb(t) {
    if (t.spin === 'flat') return 'Flies extra far';
    if ((t.bounce || 0) > 0.6) return 'Super bouncy';
    if (t.squeak) return 'Squeaks when it lands';
    if (t.happy) return 'Dogs love it';
    return 'A classic';
  }

  function openBag() { renderBag(); $('bag').classList.remove('hidden'); }
  function renderBag() {
    const G = $('toyGrid');
    G.innerHTML = '';
    const all = Object.entries(TOYS);
    $('bagCount').textContent = `${state.toys.length}/${all.length}`;
    for (const [k, t] of all) {
      const owned = state.toys.includes(k);
      const b = document.createElement('button');
      b.className = 'toyCard' + (owned ? '' : ' locked') + (k === state.toy ? ' eq' : '');
      const sub = owned ? (k === state.toy ? 'Throwing next' : 'Tap to use') : t.price == null ? 'Found on walks' : `Shop · 🪙 ${t.price}`;
      b.innerHTML = `<span class="big">${owned || t.price != null ? t.icon : '❓'}</span><b></b><small>${sub}</small>`;
      b.querySelector('b').textContent = owned || t.price != null ? t.name : '???';
      b.addEventListener('click', () => {
        if (!owned) { toast(t.price == null ? 'Keep walking — maybe you’ll find one!' : 'You can buy this in the 🛒 Shop'); return; }
        state.toy = k;
        updateToyIcons();
        renderBag();
        save();
      });
      G.appendChild(b);
    }
  }

  let cfYes = null, cfNo = null;
  function confirmBox(title, text, yesLabel, yesEnabled, onYes, onNo) {
    $('cfTitle').textContent = title;
    $('cfText').textContent = text;
    $('cfYes').textContent = yesLabel;
    $('cfYes').disabled = !yesEnabled;
    cfYes = onYes;
    cfNo = onNo || null;
    $('confirm').classList.remove('hidden');
  }
  $('cfYes').addEventListener('click', () => {
    $('confirm').classList.add('hidden');
    const f = cfYes; cfYes = null; cfNo = null;
    if (f) f();
  });
  $('cfNo').addEventListener('click', () => {
    $('confirm').classList.add('hidden');
    const f = cfNo; cfYes = null; cfNo = null;
    if (f) f();
  });

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
      btn.innerHTML = `<img src="${portraitURL(i)}" alt="">${b.name}`;
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
      if (dogs.length >= capacity()) { toast('Your home is full — add a room first'); return; }
      state.coins -= price;
    }
    $('nameInput').blur();
    const d = addDog({ name, breed: chosenBreed, hunger: 90, thirst: 90, energy: 90, happy: 80 }, true);
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
  function placeToast() {
    const bars = ['actions', 'parkActions', 'decoBar', 'buildBar'].map($).filter((e) => !e.classList.contains('hidden'));
    const top = bars.length ? Math.min(...bars.map((e) => e.getBoundingClientRect().top)) : window.innerHeight - 20;
    $('toast').style.bottom = Math.max(20, window.innerHeight - top + 12) + 'px';
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    placeToast();
    t.classList.add('show');
    $('hint').classList.add('under');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); $('hint').classList.remove('under'); }, 2800);
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
    $('buildBar').classList.toggle('hidden', mode !== 'build');
    gridGroup.visible = mode === 'decorate';
    candGroup.visible = mode === 'build';
    if (mode !== 'normal' || place === 'park') hideHint();
    placeToast();
  }

  function updateHud() {
    $('coinCount').textContent = state.coins;
    if (!$('shop').classList.contains('hidden')) $('shopCoins').textContent = state.coins;
    const b = state.build;
    $('buildPill').classList.toggle('hidden', !b);
    if (b) {
      const left = fmtTime(b.readyAt - Date.now());
      $('buildTime').textContent = left;
      if (siteLabel) setSpriteText(siteLabel, '🏗️ ' + left);
    }
    updatePack();
  }

  $('hud').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'feed') fillBowls('food');
    else if (act === 'water') fillBowls('water');
    else if (act === 'ball') throwBall();
    else if (act === 'walk') goWalk();
    else if (act === 'home') goHome();
    else if (act === 'decorate') enterDecorate();
    else if (act === 'done') exitDecorate();
    else if (act === 'shop') openShop();
    else if (act === 'bag') openBag();
    else if (act === 'cancelBuild') exitBuildMode();
    else if (act === 'rotate') { placeRot = (placeRot + 1) % 4; renderInv(); toast(`Next item: ${rotNames[placeRot].toLowerCase()}`); }
  });
  $('shop').addEventListener('click', (e) => {
    if (e.target.id === 'shop' || e.target.closest('[data-act="closeShop"]')) closeShop();
  });
  $('bag').addEventListener('click', (e) => {
    if (e.target.id === 'bag' || e.target.closest('[data-act="closeBag"]')) $('bag').classList.add('hidden');
  });

  // =====================================================================
  // Saving
  // =====================================================================
  let migratedOldSave = false;
  function save() {
    state.dogs = dogs.map((d) => d.serialize());
    state.savedAt = Date.now();
    state.v = 2;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      state = Object.assign(defaultState(), s);
      if (!state.inventory || typeof state.inventory !== 'object') state.inventory = {};
      for (const k of Object.keys(state.inventory)) if (!ITEMS[k]) delete state.inventory[k];
      if (!Array.isArray(state.furniture)) state.furniture = [];
      state.furniture = state.furniture.filter((f) => f && ITEMS[f.type]);
      // Older saves had one square room that could grow; turn it into sections
      if (!Array.isArray(s.chunks) || !s.chunks.length) {
        const n = Math.max(1, Math.ceil((s.roomSize || CHUNK) / CHUNK));
        state.chunks = [];
        for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) state.chunks.push([cx, cz]);
      }
      delete state.roomSize;
      if (!Array.isArray(state.toys)) state.toys = [];
      state.toys = state.toys.filter((t) => TOYS[t]);
      if (!state.toys.includes('tennis')) state.toys.unshift('tennis');
      if (!state.toys.includes(state.toy)) state.toy = 'tennis';
      if (state.build && !(state.build.readyAt > 0)) state.build = null;
      migratedOldSave = !s.v;
      // Time passes while you're away: dogs rest, but get hungry, thirsty and miss you
      const hours = clamp((Date.now() - (s.savedAt || Date.now())) / 3600000, 0, 24);
      for (const d of state.dogs || []) {
        d.hunger = Math.max(10, (d.hunger ?? 80) - hours * 15);
        d.thirst = Math.max(10, (d.thirst ?? 80) - hours * 18);
        d.energy = Math.min(100, (d.energy ?? 80) + hours * 25);
        d.happy = Math.max(15, (d.happy ?? 70) - hours * 8);
      }
      return true;
    } catch (_) {
      return false;
    }
  }
  function giveWaterBowl() {
    if (state.furniture.some((f) => f.type === 'water') || state.inventory.water > 0) return;
    const prefer = [[2, 0], [4, 0], [1, 0], [5, 0], [0, 1], [5, 1]];
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) prefer.push([i, j]);
    for (const [i, j] of prefer) {
      if (!furnitureAt(i, j) && isHomeTile(i, j)) {
        state.furniture.push({ type: 'water', i, j, rot: 0, filled: true });
        rebuildFurniture();
        return;
      }
    }
    state.inventory.water = 1;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  // =====================================================================
  // Main loop
  // =====================================================================
  const clock = new THREE.Clock();
  let hudTimer = 0, saveTimer = 5;

  function update(dt) {
    animT += dt;
    updatePlayer(dt);
    for (const d of dogs) d.update(dt);
    separateDogs();
    updateBall(dt);
    if (place === 'park') {
      updateSniffSpots(dt);
      updateParkLoot(dt);
      if (!tiredWarned && dogs.some((d) => d.energy < CRITICAL)) { tiredWarned = true; toast('Your dog is getting tired — time to head home 🏠'); }
    } else {
      for (const r of furnRT.values()) if (r.group.userData.anim) r.group.userData.anim(animT);
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
    if (hudTimer <= 0) { hudTimer = 0.25; checkBuild(); updateHud(); }
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
    const hadSave = load();
    syncChunkSet();
    buildRoom();
    rebuildFurniture();
    if (hadSave && migratedOldSave) giveWaterBowl();
    rebuildSite();
    buildPark();
    player.root.position.copy(freeNear(CHUNK / 2, CHUNK - 1.2));
    player.root.rotation.y = player.face = Math.PI;
    for (const dd of state.dogs || []) addDog(dd, false);
    selected = dogs[0] || null;
    updateToyIcons();
    refreshUI();
    if (!dogs.length) openStart(false);
    else if (migratedOldSave) toast('New: your dogs get thirsty now — keep the 💧 water bowl filled!');
    else toast(`Welcome back! ${dogs[0].name} missed you 🐾`);
    checkBuild();
    updateHud();
    updateCamera(0, true);
    loop();
  }
  // Open the game with ?debug at the end of the URL to poke at it from the browser console
  if (/[?&]debug\b/.test(location.search)) {
    window.VP = { get state() { return state; }, get place() { return place; }, get parkLoot() { return parkLoot; }, dogs, player, ball, grantToy, save };
  }
  init();
})();
