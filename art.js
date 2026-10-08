'use strict';
/* Voxel Paws — everything visual: voxel models, portraits, scenes, sky and weather. Needs three.js + data.js. */
window.VP_ART = (function () {
  const D = window.VP_DATA;
  const V3 = THREE.Vector3;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ===================================================================
  // Building blocks (shared geometry + material caches keep phones happy)
  // ===================================================================
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

  // ----- emoji + text sprites -----
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

  // ===================================================================
  // Special materials (some change with time of day)
  // ===================================================================
  const M = {
    lamp: new THREE.MeshLambertMaterial({ color: '#fff0c4', emissive: '#ffcf6b', emissiveIntensity: 0.65 }),
    water: new THREE.MeshLambertMaterial({ color: '#7cc8f0', emissive: '#3a8fd0', emissiveIntensity: 0.25 }),
    screen: new THREE.MeshLambertMaterial({ color: '#8fc4ff', emissive: '#4a90e2', emissiveIntensity: 0.6 }),
    fire: new THREE.MeshLambertMaterial({ color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 0.9 }),
    fire2: new THREE.MeshLambertMaterial({ color: '#ffe066', emissive: '#ffcc33', emissiveIntensity: 0.9 }),
    glass: new THREE.MeshLambertMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.35, depthWrite: false }),
    gold: new THREE.MeshLambertMaterial({ color: '#ffd34d', emissive: '#c99a00', emissiveIntensity: 0.35 }),
    window: new THREE.MeshLambertMaterial({ color: '#a9d8f5', emissive: '#1d2a55', emissiveIntensity: 0 }),
    mud: new THREE.MeshLambertMaterial({ color: '#6b4a2b' }),
    grass: new THREE.MeshLambertMaterial({ color: '#5e8c3a' }),
    firefly: new THREE.MeshLambertMaterial({ color: '#fff59d', emissive: '#ffee58', emissiveIntensity: 1 }),
    sea: new THREE.MeshLambertMaterial({ color: '#3a95c8', emissive: '#1f6f9a', emissiveIntensity: 0.1 }),
    redOn: new THREE.MeshLambertMaterial({ color: '#ff5252', emissive: '#ff1744', emissiveIntensity: 0.9 }),
    greenOn: new THREE.MeshLambertMaterial({ color: '#69f0ae', emissive: '#00e676', emissiveIntensity: 0.9 }),
    lightOff: new THREE.MeshLambertMaterial({ color: '#3a3a3a' }),
    crystal: new THREE.MeshLambertMaterial({ color: '#b388ff', emissive: '#7c4dff', emissiveIntensity: 0.6 }),
    slime: new THREE.MeshLambertMaterial({ color: '#69f0ae', emissive: '#00e676', emissiveIntensity: 0.7 }),
    orb: new THREE.MeshLambertMaterial({ color: '#e1f5fe', emissive: '#80d8ff', emissiveIntensity: 0.5 }),
    bulbs: ['#ff5252', '#ffeb3b', '#69f0ae', '#40c4ff', '#e040fb'].map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 })),
  };
  // the dirt patches on a dog take the color of their main kind of dirt
  const dirtMats = new Map();
  function dirtMaterial(kind) {
    if (kind === 'mud') return M.mud;
    if (kind === 'grass') return M.grass;
    if (!dirtMats.has(kind)) dirtMats.set(kind, new THREE.MeshLambertMaterial({ color: (D.DIRT[kind] || D.DIRT.mud).color }));
    return dirtMats.get(kind);
  }

  // ===================================================================
  // Furniture (each fits one 1x1 tile, front faces +z)
  // ===================================================================
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
      box(c, 0.3, 0.03, 0.3, M.water, 0, 0.125, 0);
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
      const scr = new THREE.MeshLambertMaterial({ color: '#1b1b22', emissive: '#000000', emissiveIntensity: 0 });
      box(g, 0.76, 0.42, 0.02, scr, 0, 0.67, -0.235);
      box(g, 0.12, 0.1, 0.1, '#f2c14e', 0.36, 0.41, -0.1);
      const cols = ['#8fc4ff', '#ffd27a', '#a7f3c0', '#f6a5c0', '#ffffff'];
      g.userData.anim = (t) => {
        if (g.userData.on) {
          if (Math.random() < 0.15) { scr.color.set(cols[Math.floor(Math.random() * cols.length)]); scr.emissive.copy(scr.color); }
          scr.emissiveIntensity = 0.55 + Math.sin(t * 40) * 0.12 + Math.random() * 0.15;
        } else { scr.color.set('#1b1b22'); scr.emissiveIntensity = 0; }
      };
    },
    bathtub(g) {
      box(g, 0.94, 0.12, 0.7, '#e9eff3', 0, 0.12, 0);
      box(g, 0.94, 0.4, 0.08, '#ffffff', 0, 0.36, -0.31);
      box(g, 0.94, 0.4, 0.08, '#ffffff', 0, 0.36, 0.31);
      box(g, 0.08, 0.4, 0.62, '#ffffff', -0.43, 0.36, 0);
      box(g, 0.08, 0.4, 0.62, '#ffffff', 0.43, 0.36, 0);
      box(g, 0.78, 0.04, 0.54, M.water, 0, 0.42, 0);
      for (const [x, z] of [[-0.38, -0.27], [0.38, -0.27], [-0.38, 0.27], [0.38, 0.27]]) box(g, 0.08, 0.08, 0.08, '#c9a227', x, 0.04, z);
      box(g, 0.05, 0.3, 0.05, '#b8c2c9', -0.4, 0.66, -0.3);
      box(g, 0.05, 0.05, 0.16, '#b8c2c9', -0.4, 0.8, -0.24);
      for (const [x, z, s] of [[0.2, 0.05, 0.1], [0.28, -0.1, 0.08], [0.1, -0.12, 0.07]]) box(g, s, s, s, '#ffffff', x, 0.47, z);
      box(g, 0.1, 0.1, 0.08, '#ffd93b', -0.15, 0.48, 0.1);
    },
    giftbox(g) {
      box(g, 0.56, 0.42, 0.56, '#e2453c', 0, 0.21, 0);
      box(g, 0.6, 0.08, 0.6, '#c0392b', 0, 0.44, 0);
      box(g, 0.1, 0.43, 0.58, '#ffd54f', 0, 0.215, 0);
      box(g, 0.58, 0.43, 0.1, '#ffd54f', 0, 0.215, 0);
      box(g, 0.12, 0.1, 0.62, '#ffd54f', 0, 0.48, 0);
      box(g, 0.16, 0.12, 0.08, '#ffca28', -0.09, 0.56, 0);
      box(g, 0.16, 0.12, 0.08, '#ffca28', 0.09, 0.56, 0);
      const spark = emojiSprite('✨', 0.4);
      spark.position.y = 0.95;
      spark.visible = false;
      g.add(spark);
      g.userData.anim = (t) => { spark.visible = !!g.userData.filled; spark.position.y = 0.95 + Math.sin(t * 3) * 0.06; };
    },
    flowerbed(g) {
      box(g, 0.92, 0.18, 0.92, '#8a5f3c', 0, 0.09, 0);
      box(g, 0.82, 0.04, 0.82, '#5b3b25', 0, 0.19, 0);
      const cols = ['#f06292', '#ffd54f', '#ba68c8', '#ff8a65', '#ffffff', '#64b5f6'];
      const r = mulberry32(5);
      for (let k = 0; k < 9; k++) {
        const x = -0.28 + (k % 3) * 0.28, z = -0.28 + Math.floor(k / 3) * 0.28;
        box(g, 0.04, 0.2, 0.04, '#4caf50', x, 0.3, z);
        box(g, 0.12, 0.08, 0.12, cols[Math.floor(r() * cols.length)], x, 0.43, z);
      }
    },
    hedge(g) {
      box(g, 0.96, 0.62, 0.62, '#4f8a3f', 0, 0.31, 0);
      box(g, 0.86, 0.14, 0.52, '#5fa04d', 0, 0.68, 0);
      box(g, 0.1, 0.1, 0.1, '#e94f6a', 0.25, 0.5, 0.31);
    },
    birdbath(g) {
      box(g, 0.3, 0.08, 0.3, '#a7a39c', 0, 0.04, 0);
      box(g, 0.14, 0.5, 0.14, '#b4b0a8', 0, 0.33, 0);
      box(g, 0.56, 0.08, 0.56, '#a7a39c', 0, 0.62, 0);
      box(g, 0.44, 0.03, 0.44, M.water, 0, 0.67, 0);
      const bird = pivot(g, 0.16, 0.72, 0.1);
      box(bird, 0.1, 0.08, 0.14, '#64b5f6');
      box(bird, 0.07, 0.07, 0.07, '#64b5f6', 0, 0.06, 0.06);
      box(bird, 0.03, 0.02, 0.04, '#ffb020', 0, 0.06, 0.11);
      g.userData.anim = (t) => { bird.position.y = 0.72 + Math.abs(Math.sin(t * 2.2)) * 0.03; bird.rotation.y = Math.sin(t * 0.7) * 1.2; };
    },
    gardentree(g) {
      box(g, 0.24, 1.0, 0.24, '#7a5232', 0, 0.5, 0);
      box(g, 0.96, 0.7, 0.96, '#4caf50', 0, 1.25, 0);
      box(g, 0.7, 0.4, 0.7, '#66bb6a', 0, 1.75, 0);
      for (const [x, y, z] of [[0.3, 1.1, 0.49], [-0.25, 1.35, 0.49], [0.49, 1.3, -0.1], [-0.49, 1.15, 0.2]]) box(g, 0.1, 0.1, 0.06, '#e53935', x, y, z);
    },
    gardenpond(g) {
      box(g, 0.96, 0.1, 0.96, '#9a968e', 0, 0.05, 0);
      box(g, 0.8, 0.06, 0.8, M.water, 0, 0.09, 0);
      box(g, 0.2, 0.04, 0.2, '#7fbf5a', -0.18, 0.13, 0.15);
      box(g, 0.08, 0.06, 0.08, '#f48fb1', -0.18, 0.17, 0.15);
      const fish = pivot(g, 0, 0.1, 0);
      box(fish, 0.1, 0.03, 0.05, '#ff8c42', 0.2, 0, 0);
      g.userData.anim = (t) => { fish.rotation.y = t * 0.8; };
    },
    digpit(g) {
      box(g, 0.98, 0.06, 0.98, '#c9a66b', 0, 0.03, 0);
      box(g, 0.8, 0.07, 0.8, '#e8d29a', 0, 0.035, 0);
      for (const [x, z] of [[-0.45, 0], [0.45, 0]]) box(g, 0.08, 0.12, 0.98, '#a0703f', x, 0.06, z);
      for (const [x, z] of [[0, -0.45], [0, 0.45]]) box(g, 0.98, 0.12, 0.08, '#a0703f', x, 0.06, z);
      box(g, 0.14, 0.1, 0.1, '#e53935', 0.2, 0.1, 0.15);
      box(g, 0.05, 0.16, 0.05, '#3d7fd6', 0.2, 0.2, 0.15);
    },
    jukebox(g) {
      box(g, 0.74, 1.0, 0.5, '#7b3f1d', 0, 0.5, -0.2);
      box(g, 0.74, 0.3, 0.5, '#9a5228', 0, 1.15, -0.2);
      box(g, 0.6, 0.26, 0.02, '#ffcf6b', 0, 1.15, 0.055);
      box(g, 0.56, 0.42, 0.02, '#2b2730', 0, 0.62, 0.055);
      const lights = new THREE.MeshLambertMaterial({ color: '#ff7ab6', emissive: '#ff3d8b', emissiveIntensity: 0.3 });
      box(g, 0.06, 0.9, 0.06, lights, -0.34, 0.6, 0.06);
      box(g, 0.06, 0.9, 0.06, lights, 0.34, 0.6, 0.06);
      for (let k = 0; k < 4; k++) box(g, 0.1, 0.04, 0.02, '#c9a227', -0.18 + k * 0.12, 0.35, 0.06);
      g.userData.anim = (t) => { lights.emissiveIntensity = g.userData.on ? 0.6 + Math.sin(t * 8) * 0.35 : 0.15; lights.emissive.setHSL((t * 0.2) % 1, 0.8, 0.55); };
    },
    autofeeder(g) {
      box(g, 0.5, 0.12, 0.42, '#9aa5ad', 0, 0.06, 0.08);
      box(g, 0.3, 0.02, 0.26, '#5d646d', 0, 0.125, 0.1);
      box(g, 0.34, 0.5, 0.26, '#e9eff3', 0, 0.37, -0.18);
      box(g, 0.24, 0.3, 0.02, M.glass, 0, 0.42, -0.045);
      box(g, 0.08, 0.06, 0.02, '#4caf50', 0.1, 0.18, -0.045);
      box(g, 0.3, 0.06, 0.24, '#5d646d', 0, 0.65, -0.18);
      const c = pivot(g);
      box(c, 0.28, 0.04, 0.24, '#b0703a', 0, 0.14, 0.1);
      g.userData.content = c;
    },
    fountain(g) {
      box(g, 0.56, 0.14, 0.56, '#3d7fd6', 0, 0.07, 0);
      box(g, 0.12, 0.34, 0.12, '#e9eff3', 0, 0.3, 0);
      box(g, 0.24, 0.06, 0.24, '#3d7fd6', 0, 0.48, 0);
      const c = pivot(g);
      box(c, 0.44, 0.03, 0.44, M.water, 0, 0.14, 0);
      box(c, 0.04, 0.12, 0.04, M.water, 0, 0.56, 0);
      g.userData.content = c;
    },
    heatedbed(g) {
      box(g, 0.88, 0.12, 0.88, '#c0392b', 0, 0.06, 0);
      box(g, 0.66, 0.08, 0.64, '#ffcc80', 0, 0.14, 0.05);
      box(g, 0.88, 0.3, 0.14, '#a93226', 0, 0.2, -0.37);
      box(g, 0.13, 0.22, 0.72, '#a93226', -0.375, 0.16, 0.07);
      box(g, 0.13, 0.22, 0.72, '#a93226', 0.375, 0.16, 0.07);
      box(g, 0.1, 0.06, 0.03, M.fire2, 0.3, 0.2, -0.29);
    },
    rainbowrug(g) {
      const cols = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
      cols.forEach((c, k) => box(g, 0.98 - k * 0.14, 0.02 + k * 0.003, 0.98 - k * 0.14, c, 0, 0.012 + k * 0.003, 0));
    },
    crystallamp(g) {
      const cr = new THREE.MeshLambertMaterial({ color: '#c6b4ff', emissive: '#8a5cf6', emissiveIntensity: 0.7 });
      box(g, 0.34, 0.08, 0.34, '#6a5d7b', 0, 0.04, 0);
      box(g, 0.2, 0.5, 0.2, cr, 0, 0.33, 0);
      box(g, 0.12, 0.3, 0.12, cr, 0.14, 0.24, 0.06);
      box(g, 0.1, 0.24, 0.1, cr, -0.13, 0.2, -0.05);
      box(g, 0.1, 0.16, 0.1, cr, 0, 0.64, 0);
      g.userData.anim = (t) => { cr.emissiveIntensity = 0.6 + Math.sin(t * 1.5) * 0.2; };
    },
    goldstatue(g) {
      box(g, 0.5, 0.24, 0.5, '#8c877f', 0, 0.12, 0);
      const d = pivot(g, 0, 0.24, 0);
      box(d, 0.22, 0.2, 0.36, M.gold, 0, 0.22, 0);
      box(d, 0.2, 0.2, 0.2, M.gold, 0, 0.4, 0.16);
      box(d, 0.1, 0.07, 0.1, M.gold, 0, 0.36, 0.3);
      for (const [x, z] of [[-0.07, 0.12], [0.07, 0.12], [-0.07, -0.12], [0.07, -0.12]]) box(d, 0.06, 0.14, 0.06, M.gold, x, 0.07, z);
      box(d, 0.05, 0.05, 0.16, M.gold, 0, 0.3, -0.22);
      box(d, 0.05, 0.12, 0.08, M.gold, -0.1, 0.46, 0.14);
      box(d, 0.05, 0.12, 0.08, M.gold, 0.1, 0.46, 0.14);
    },
    cloudbed(g) {
      for (const [x, y, z, s] of [[0, 0.12, 0, 0.8], [-0.25, 0.2, -0.25, 0.4], [0.25, 0.22, -0.22, 0.42], [-0.28, 0.18, 0.25, 0.36], [0.28, 0.16, 0.26, 0.34]]) box(g, s, 0.2, s, '#f5f7ff', x, y, z);
      box(g, 0.56, 0.06, 0.56, '#e3e8ff', 0, 0.23, 0.02);
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
      const shade = M.lamp.clone();
      box(g, 0.42, 0.3, 0.42, shade, 0, 1.25, 0);
      g.userData.anim = () => { shade.emissiveIntensity = g.userData.on === false ? 0 : M.lamp.emissiveIntensity; };
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
      box(fire, 0.16, 0.18, 0.05, M.fire, -0.07, 0.2, 0.01);
      box(fire, 0.14, 0.26, 0.05, M.fire, 0.07, 0.24, 0);
      box(fire, 0.08, 0.12, 0.05, M.fire2, 0, 0.18, 0.03);
      g.userData.anim = (t) => {
        fire.visible = g.userData.on !== false;
        fire.scale.y = 1 + Math.sin(t * 11) * 0.08 + Math.sin(t * 17) * 0.05;
      };
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
      box(g, 0.9, 0.5, 0.48, M.glass, 0, 0.67, -0.2);
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
      box(g, 0.38, 0.24, 0.01, M.screen, -0.1, 0.92, -0.25);
      box(g, 0.08, 0.1, 0.08, '#ef6f8e', 0.3, 0.8, -0.05);
    },
  };
  function buildItem(type) {
    const g = new THREE.Group();
    (BUILDERS[type] || BUILDERS.plant)(g);
    return g;
  }

  // ===================================================================
  // Toys (centered, long axis along x)
  // ===================================================================
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
    golden(g) { box(g, 0.22, 0.22, 0.22, M.gold); box(g, 0.23, 0.04, 0.23, '#fff3c4'); },
    beachball(g) {
      box(g, 0.3, 0.3, 0.3, '#ffffff');
      box(g, 0.31, 0.31, 0.1, '#e53935');
      box(g, 0.1, 0.31, 0.31, '#1e88e5');
      box(g, 0.31, 0.1, 0.31, '#fdd835');
    },
    pinecone(g) {
      box(g, 0.14, 0.14, 0.2, '#8d5a2b');
      box(g, 0.18, 0.1, 0.12, '#a86b34', 0, 0, -0.02);
      box(g, 0.08, 0.08, 0.08, '#6d4320', 0, 0, 0.12);
    },
    plushball(g) {
      box(g, 0.22, 0.22, 0.22, '#f48fb1');
      box(g, 0.23, 0.06, 0.23, '#ce93d8');
      box(g, 0.06, 0.23, 0.23, '#81d4fa');
    },
    ufo(g) {
      box(g, 0.36, 0.04, 0.36, '#b0bec5');
      box(g, 0.2, 0.08, 0.2, M.glass, 0, 0.05, 0);
      for (const [x, z] of [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]]) box(g, 0.05, 0.03, 0.05, M.greenOn, x, -0.02, z);
    },
    wand(g) {
      box(g, 0.4, 0.04, 0.04, '#f8bbd0');
      box(g, 0.1, 0.1, 0.03, M.gold, 0.22, 0, 0);
      box(g, 0.04, 0.04, 0.05, '#ffffff', 0.22, 0, 0);
    },
    crystalball(g) {
      box(g, 0.22, 0.22, 0.22, M.crystal);
      box(g, 0.12, 0.12, 0.12, '#ede7f6', 0.03, 0.03, 0.03);
    },
    snowball(g) { box(g, 0.22, 0.2, 0.22, '#f7fbff'); box(g, 0.16, 0.24, 0.16, '#ffffff'); },
    oldstick(g) {
      box(g, 0.5, 0.06, 0.06, '#6d4c41');
      box(g, 0.06, 0.06, 0.06, '#b388ff', 0.25, 0.02, 0);
      box(g, 0.1, 0.05, 0.05, '#5d4037', -0.1, 0.04, 0.04);
      box(g, 0.04, 0.04, 0.04, '#ffd54f', 0.27, 0.07, 0);
    },
  };
  function buildToy(type) {
    const g = new THREE.Group();
    (TOY_BUILD[type] || TOY_BUILD.tennis)(g);
    return g;
  }

  // ===================================================================
  // Dogs: one builder for every breed, driven by the shape in data.js
  // ===================================================================
  function coatOf(breedId, coatId) {
    const B = D.BREEDS[breedId] || D.BREEDS.retriever;
    return B.coats.find((c) => c.id === coatId) || B.coats[0];
  }

  function buildDog(breedId, coatId) {
    const B = D.BREEDS[breedId] || D.BREEDS.retriever;
    const C = coatOf(breedId, coatId);
    const S = B.shape, X = S.extras || [];
    const tW = S.torsoW, tH = S.torsoH, tL = S.torsoL;
    const root = new THREE.Group();
    const body = pivot(root);
    const bodyY = S.legH + 0.02 + tH / 2;

    // torso
    box(body, tW, tH, tL, C.body, 0, bodyY, 0);
    box(body, tW * 0.65, 0.06, tL * 0.7, C.light, 0, bodyY - tH / 2 - 0.01, 0.02);
    if (X.includes('bib')) box(body, tW * 0.72, tH * 0.75, 0.05, C.light, 0, bodyY - tH * 0.08, tL / 2 + 0.01);
    if (X.includes('fluffyRear')) {
      box(body, tW + 0.04, tH * 0.85, 0.12, C.body, 0, bodyY + 0.01, -tL / 2 - 0.03);
      box(body, tW * 0.8, tH * 0.45, 0.06, C.light, 0, bodyY - tH * 0.2, -tL / 2 - 0.1);
    }
    if (X.includes('mane')) box(body, tW + 0.1, tH + 0.1, tL * 0.45, C.body, 0, bodyY + 0.02, tL * 0.22);
    if (C.spots) {
      for (const [y, z, w] of [[0.05, 0.25, 0.1], [-0.04, 0.02, 0.12], [0.06, -0.2, 0.09], [-0.02, -0.36, 0.08]]) {
        box(body, 0.012, 0.07, w, C.spots, tW / 2 + 0.006, bodyY + y, z);
        box(body, 0.012, 0.07, w, C.spots, -tW / 2 - 0.006, bodyY - y, z + 0.08);
      }
      box(body, 0.1, 0.012, 0.09, C.spots, 0.05, bodyY + tH / 2 + 0.006, -0.1);
    }
    const collarY = bodyY + tH * 0.44;
    box(body, tW * 0.88, 0.1, 0.12, '#d93a3a', 0, collarY, tL / 2 - 0.04);
    box(body, 0.08, 0.08, 0.04, '#ffd54f', 0, collarY - 0.08, tL / 2 + 0.03);
    const collar = pivot(body, 0, collarY, tL / 2 + 0.04);

    // head
    const hW = S.headW, hH = S.headH, hD = S.headD;
    const headY = bodyY + tH * 0.69;
    const head = pivot(body, 0, headY, tL / 2 + 0.06);
    box(head, hW, hH, hD, C.body, 0, 0, 0);
    if (X.includes('mask')) {
      box(head, hW + 0.01, hH * 0.45, hD * 0.6, C.light, 0, -hH * 0.28, hD * 0.21);
      box(head, 0.06, 0.04, 0.02, C.light, -hW * 0.25, hH * 0.33, hD / 2 + 0.005);
      box(head, 0.06, 0.04, 0.02, C.light, hW * 0.25, hH * 0.33, hD / 2 + 0.005);
    }
    if (X.includes('blaze')) box(head, 0.07, hH * 0.55, 0.02, C.light, 0, hH * 0.08, hD / 2 + 0.004);
    if (C.accent) {
      box(head, 0.05, 0.04, 0.02, C.accent, -hW * 0.25, hH * 0.32, hD / 2 + 0.006);
      box(head, 0.05, 0.04, 0.02, C.accent, hW * 0.25, hH * 0.32, hD / 2 + 0.006);
    }
    if (X.includes('topknot')) {
      box(head, hW * 0.86, 0.16, hD * 0.8, C.light, 0, hH / 2 + 0.06, -0.02);
      box(head, hW * 0.6, 0.08, hD * 0.6, C.light, 0, hH / 2 + 0.17, -0.02);
    }
    const muzY = -hH * 0.22;
    box(head, S.muzW, S.muzH, S.muzD, C.light, 0, muzY, hD / 2 + S.muzD / 2 - 0.02);
    box(head, 0.09, 0.07, 0.05, '#1a1a1a', 0, muzY + S.muzH * 0.33, hD / 2 + S.muzD - 0.01);
    const ex = hW * 0.25, ey = hH * 0.15, ez = hD / 2 + 0.002;
    for (const s of [-1, 1]) {
      if (S.eyes) {
        box(head, 0.07, 0.07, 0.02, S.eyes, s * ex, ey, ez);
        box(head, 0.03, 0.04, 0.01, '#1a1a1a', s * ex, ey, ez + 0.012);
      } else {
        box(head, 0.06, 0.07, 0.02, '#1a1a1a', s * ex, ey, ez);
      }
      box(head, 0.02, 0.02, 0.01, '#ffffff', s * ex + 0.015, ey + 0.02, ez + 0.014);
    }
    const mkEar = (side) => {
      let p;
      switch (S.ears) {
        case 'upright':
          p = pivot(head, side * hW * 0.3, hH / 2 - 0.02, -0.03);
          box(p, S.earW, S.earLen, 0.06, C.body, 0, S.earLen / 2, 0);
          box(p, S.earW * 0.55, S.earLen * 0.65, 0.02, '#f2b5b5', 0, S.earLen * 0.42, 0.035);
          break;
        case 'pointed':
          p = pivot(head, side * hW * 0.3, hH / 2 - 0.02, -0.03);
          box(p, S.earW, S.earLen * 0.65, 0.06, C.body, 0, S.earLen * 0.32, 0);
          box(p, S.earW * 0.55, S.earLen * 0.45, 0.06, C.body, 0, S.earLen * 0.8, 0);
          box(p, S.earW * 0.5, S.earLen * 0.5, 0.02, C.light, 0, S.earLen * 0.35, 0.035);
          break;
        case 'fluffy':
          p = pivot(head, side * (hW / 2 + 0.02), hH * 0.3, -0.02);
          box(p, 0.11, S.earLen, 0.15, C.body, 0, -S.earLen * 0.42, 0);
          break;
        case 'long':
          p = pivot(head, side * hW / 2, hH * 0.35, -0.02);
          box(p, 0.06, S.earLen, 0.14, C.dark, side * 0.01, -S.earLen * 0.42, 0);
          break;
        default:
          p = pivot(head, side * hW * 0.47, hH * 0.44, -0.02);
          box(p, 0.08, S.earLen, 0.15, C.dark, side * 0.02, -S.earLen * 0.41, 0);
      }
      return p;
    };
    const earL = mkEar(-1), earR = mkEar(1);
    const tongue = box(head, 0.08, 0.02, 0.1, '#f07f8f', 0, muzY - S.muzH / 2 - 0.01, hD / 2 + S.muzD * 0.55);
    tongue.visible = false;
    const mouth = pivot(head, 0, muzY - S.muzH * 0.45, hD / 2 + S.muzD + 0.02);

    // legs
    const legs = [];
    const lx = tW / 2 - S.legW / 2 - 0.02, lz = tL / 2 - 0.12;
    for (const [x, z] of [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]]) {
      const p = pivot(body, x, S.legH + 0.04, z);
      box(p, S.legW, S.legH, S.legW, C.body, 0, -S.legH / 2 + 0.01, 0);
      if (X.includes('pompaws')) box(p, 0.15, 0.12, 0.15, C.body, 0, -S.legH + 0.04, 0.005);
      else box(p, S.legW + 0.01, 0.06, S.legW + 0.03, C.light, 0, -S.legH, 0.01);
      legs.push(p);
    }

    // tail
    const tail = pivot(body, 0, bodyY + tH * 0.31, -tL / 2);
    let tailUp = 0.75, tailDown = 0.1, wagAxis = 'y';
    switch (S.tail) {
      case 'stub':
        box(tail, 0.1, 0.09, 0.08, C.body, 0, 0, -0.03);
        tailUp = 0.5; tailDown = 0;
        break;
      case 'thin':
        box(tail, 0.05, 0.05, 0.3, C.body, 0, 0, -0.15);
        box(tail, 0.05, 0.05, 0.08, C.dark, 0, 0, -0.32);
        tailUp = 0.45; tailDown = 0.05;
        break;
      case 'curl':
        box(tail, 0.11, 0.24, 0.11, C.body, 0, 0.12, -0.02);
        box(tail, 0.11, 0.11, 0.2, C.light, 0, 0.25, 0.06);
        tailUp = -0.15; tailDown = -1.2; wagAxis = 'z';
        break;
      case 'pom':
        box(tail, 0.05, 0.2, 0.05, C.body, 0, 0.1, 0);
        box(tail, 0.15, 0.15, 0.15, C.body, 0, 0.24, 0);
        tailUp = -0.35; tailDown = -1.25; wagAxis = 'z';
        break;
      default:
        box(tail, 0.08, 0.08, 0.22, C.body, 0, 0, -0.1);
        box(tail, 0.09, 0.09, 0.1, C.dark, 0, 0, -0.25);
    }
    tail.rotation.x = tailUp;

    // dirt patches (shown when the dog gets dirty)
    const patches = [];
    const sx = tW / 2 + 0.007, sy = tH / 2 + 0.007;
    for (const [x, y, z, top] of [[sx, 0.05, 0.1, 0], [-sx, -0.04, -0.15, 0], [0, sy, -0.05, 1], [sx, -0.06, -0.24, 0], [-sx, 0.07, 0.2, 0], [0.06, sy, 0.18, 1]]) {
      const m = top ? box(body, 0.12, 0.012, 0.1, M.mud, x, bodyY + y, z) : box(body, 0.012, 0.09, 0.12, M.mud, x, bodyY + y, z);
      m.visible = false;
      patches.push(m);
    }
    for (const leg of legs) {
      const m = box(leg, S.legW + 0.025, 0.07, S.legW + 0.045, M.mud, 0, -S.legH + 0.05, 0.01);
      m.visible = false;
      patches.push(m);
    }

    root.add(blob(tW * 1.65, tL * 1.75));
    const dims = { hW, hH, hD, tW, tH, tL, bodyY, collarY, headTop: hH / 2 + (X.includes('topknot') ? 0.21 : 0), eyeY: ey, ears: S.ears };
    return { root, body, head, earL, earR, legs, tail, tongue, mouth, collar, patches, dims,
      headBaseY: headY, tailUp, tailDown, wagAxis, earFlap: (S.ears === 'upright' || S.ears === 'pointed') ? 0.25 : 1, scale: S.scale };
  }

  // Accessories: returns the groups it added so they can be removed again
  function buildAccessory(id, dog) {
    const A = D.ACCESSORIES[id];
    if (!A) return [];
    const { hW, hH, hD, tW, tH, tL, bodyY, collarY, headTop, eyeY } = dog.dims;
    const onHead = new THREE.Group(), onBody = new THREE.Group();
    const c = A.color || '#ffffff';
    const cm = A.gold ? M.gold : c;
    const fz = tL / 2;
    switch (A.model) {
      case 'bandana':
        box(onBody, tW * 0.92, 0.1, 0.14, c, 0, collarY, fz - 0.04);
        box(onBody, 0.22, 0.13, 0.04, c, 0, collarY - 0.1, fz + 0.04);
        box(onBody, 0.1, 0.07, 0.04, c, 0, collarY - 0.19, fz + 0.05);
        box(onBody, 0.03, 0.03, 0.01, '#ffffff', 0.05, collarY - 0.08, fz + 0.065);
        break;
      case 'bowtie':
        box(onBody, 0.12, 0.1, 0.05, c, -0.07, collarY - 0.05, fz + 0.06);
        box(onBody, 0.12, 0.1, 0.05, c, 0.07, collarY - 0.05, fz + 0.06);
        box(onBody, 0.05, 0.06, 0.06, '#5b3fb0', 0, collarY - 0.05, fz + 0.065);
        break;
      case 'collar':
        box(onBody, tW * 0.92, 0.11, 0.14, cm, 0, collarY, fz - 0.04);
        box(onBody, 0.09, 0.09, 0.03, A.gold ? '#fff3c4' : '#ffffff', 0, collarY - 0.09, fz + 0.04);
        break;
      case 'scarf':
        box(onBody, tW * 0.95, 0.13, 0.16, c, 0, collarY, fz - 0.04);
        box(onBody, 0.09, 0.24, 0.04, c, tW * 0.3, collarY - 0.14, fz + 0.04);
        box(onBody, 0.09, 0.03, 0.045, '#ffffff', tW * 0.3, collarY - 0.2, fz + 0.04);
        break;
      case 'raincoat':
        box(onBody, tW + 0.05, tH * 0.7, tL * 0.82, c, 0, bodyY + tH * 0.2, -0.02);
        box(onBody, tW + 0.06, 0.04, tL * 0.84, '#e0b800', 0, bodyY - tH * 0.15, -0.02);
        break;
      case 'partyhat':
        box(onHead, 0.2, 0.08, 0.2, c, 0, headTop + 0.04, -0.02);
        box(onHead, 0.14, 0.08, 0.14, '#ffd54f', 0, headTop + 0.12, -0.02);
        box(onHead, 0.08, 0.08, 0.08, c, 0, headTop + 0.2, -0.02);
        box(onHead, 0.06, 0.06, 0.06, '#ffffff', 0, headTop + 0.27, -0.02);
        break;
      case 'beanie':
        box(onHead, hW * 0.96, 0.12, hD * 0.9, c, 0, headTop + 0.04, -0.02);
        box(onHead, hW + 0.02, 0.05, hD * 0.92, '#ffffff', 0, headTop - 0.01, -0.02);
        box(onHead, 0.09, 0.09, 0.09, '#ffffff', 0, headTop + 0.13, -0.02);
        break;
      case 'flowercrown': {
        const cols = ['#f06292', '#ffd54f', '#ba68c8', '#ff8a65', '#64b5f6', '#ffffff'];
        box(onHead, hW * 0.9, 0.03, hD * 0.8, '#66bb6a', 0, headTop + 0.01, -0.02);
        [[-0.4, 0.35], [0, 0.42], [0.4, 0.35], [-0.42, -0.1], [0.42, -0.1], [0, -0.38]].forEach(([x, z], k) => box(onHead, 0.07, 0.06, 0.07, cols[k], x * hW, headTop + 0.04, z * hD));
        break;
      }
      case 'gradcap':
        box(onHead, hW * 0.8, 0.08, hD * 0.8, '#222222', 0, headTop + 0.04, -0.02);
        box(onHead, 0.42, 0.025, 0.42, '#222222', 0, headTop + 0.095, -0.02);
        box(onHead, 0.02, 0.12, 0.02, '#ffd54f', 0.17, headTop + 0.04, 0.17);
        break;
      case 'crown':
        for (const [x, z, w, d] of [[0, hD * 0.32, hW * 0.7, 0.04], [0, -hD * 0.32, hW * 0.7, 0.04], [hW * 0.33, 0, 0.04, hD * 0.66], [-hW * 0.33, 0, 0.04, hD * 0.66]]) box(onHead, w, 0.07, d, M.gold, x, headTop + 0.035, z - 0.02);
        for (const [x, z] of [[0, hD * 0.32], [hW * 0.25, hD * 0.32], [-hW * 0.25, hD * 0.32], [hW * 0.33, 0], [-hW * 0.33, 0]]) box(onHead, 0.04, 0.06, 0.04, M.gold, x, headTop + 0.1, z - 0.02);
        box(onHead, 0.04, 0.04, 0.02, '#e53935', 0, headTop + 0.04, hD * 0.32 + 0.0);
        break;
      case 'rainhat':
        box(onHead, hW + 0.16, 0.03, hD + 0.16, c, 0, headTop + 0.02, -0.02);
        box(onHead, hW * 0.8, 0.1, hD * 0.8, c, 0, headTop + 0.08, -0.02);
        break;
      case 'sunglasses': {
        const ex = hW * 0.25, z = hD / 2 + 0.02;
        box(onHead, 0.11, 0.07, 0.02, c, -ex, eyeY, z);
        box(onHead, 0.11, 0.07, 0.02, c, ex, eyeY, z);
        box(onHead, 0.08, 0.02, 0.02, c, 0, eyeY + 0.02, z);
        box(onHead, 0.02, 0.02, hD * 0.5, c, -hW / 2 - 0.005, eyeY + 0.02, hD * 0.2);
        box(onHead, 0.02, 0.02, hD * 0.5, c, hW / 2 + 0.005, eyeY + 0.02, hD * 0.2);
        break;
      }
      case 'beret':
        box(onHead, hW * 0.95, 0.07, hD * 0.9, cm, 0.03, headTop + 0.03, -0.03);
        box(onHead, hW * 0.7, 0.05, hD * 0.6, cm, 0.05, headTop + 0.08, -0.03);
        box(onHead, 0.03, 0.05, 0.03, A.gold ? '#fff3c4' : '#222222', 0.05, headTop + 0.12, -0.03);
        break;
      case 'pearls':
        for (let k = 0; k < 7; k++) {
          const a = (k / 6 - 0.5) * 2.2;
          box(onBody, 0.06, 0.06, 0.06, '#fbf7ef', Math.sin(a) * tW * 0.5, collarY - 0.04 - Math.cos(a) * 0.05, fz + 0.02 + Math.cos(a) * 0.04);
        }
        break;
      case 'headlamp':
        box(onHead, hW + 0.02, 0.06, hD + 0.02, c, 0, headTop - 0.06, -0.01);
        box(onHead, 0.12, 0.1, 0.06, '#424242', 0, headTop - 0.04, hD / 2 + 0.03);
        box(onHead, 0.08, 0.07, 0.02, M.lamp, 0, headTop - 0.04, hD / 2 + 0.065);
        break;
      case 'sunhat':
        box(onHead, hW + 0.28, 0.03, hD + 0.28, c, 0, headTop + 0.02, -0.02);
        box(onHead, hW * 0.75, 0.12, hD * 0.75, c, 0, headTop + 0.09, -0.02);
        box(onHead, hW * 0.77, 0.04, hD * 0.77, '#e57373', 0, headTop + 0.05, -0.02);
        break;
      case 'alpinehat':
        box(onHead, hW + 0.1, 0.03, hD + 0.08, c, 0, headTop + 0.02, -0.02);
        box(onHead, hW * 0.7, 0.13, hD * 0.6, c, 0, headTop + 0.1, -0.02);
        box(onHead, hW * 0.72, 0.03, hD * 0.62, '#795548', 0, headTop + 0.05, -0.02);
        box(onHead, 0.02, 0.16, 0.02, '#f5f5f5', hW * 0.3, headTop + 0.15, -0.06);
        box(onHead, 0.02, 0.1, 0.03, '#9e9e9e', hW * 0.3, headTop + 0.22, -0.08);
        break;
      case 'vest':
        box(onBody, tW + 0.04, tH * 0.65, tL * 0.55, c, 0, bodyY + tH * 0.22, fz * 0.25);
        box(onBody, tW + 0.05, 0.04, tL * 0.56, '#e0e0e0', 0, bodyY + tH * 0.1, fz * 0.25);
        box(onBody, tW + 0.05, 0.04, tL * 0.56, '#e0e0e0', 0, bodyY + tH * 0.32, fz * 0.25);
        break;
      case 'cape':
        box(onBody, tW + 0.06, 0.03, tL * 0.75, c, 0, bodyY + tH / 2 + 0.02, -0.06);
        box(onBody, tW + 0.08, tH * 0.55, 0.03, c, 0, bodyY + tH * 0.2, -tL * 0.44);
        box(onBody, 0.12, 0.08, 0.04, '#ffd54f', 0, collarY, fz - 0.02);
        break;
      case 'wreath': {
        box(onHead, hW * 0.92, 0.04, hD * 0.82, c, 0, headTop + 0.01, -0.02);
        [[-0.42, 0.3], [0, 0.42], [0.42, 0.3], [-0.44, -0.15], [0.44, -0.15]].forEach(([x, z], k) => box(onHead, 0.07, 0.05, 0.07, k % 2 ? '#ffffff' : '#7cb342', x * hW, headTop + 0.04, z * hD));
        break;
      }
      case 'antlers':
        for (const s of [-1, 1]) {
          box(onHead, 0.04, 0.16, 0.04, '#8d6e63', s * hW * 0.28, headTop + 0.08, -0.04);
          box(onHead, 0.12, 0.04, 0.04, '#8d6e63', s * (hW * 0.28 + 0.05), headTop + 0.15, -0.04);
          box(onHead, 0.04, 0.09, 0.04, '#8d6e63', s * (hW * 0.28 + 0.1), headTop + 0.2, -0.04);
          box(onHead, 0.04, 0.07, 0.04, '#8d6e63', s * hW * 0.28, headTop + 0.2, -0.04);
        }
        break;
      case 'pirate':
        box(onHead, hW + 0.12, 0.12, hD * 0.6, '#212121', 0, headTop + 0.06, -0.02);
        box(onHead, hW + 0.2, 0.05, 0.08, '#212121', 0, headTop + 0.13, -0.02);
        box(onHead, 0.08, 0.07, 0.02, '#ffffff', 0, headTop + 0.07, hD * 0.3 + 0.0);
        box(onHead, hW + 0.13, 0.025, hD * 0.62, '#ffd54f', 0, headTop + 0.005, -0.02);
        break;
      case 'bell':
        box(onBody, tW * 0.92, 0.1, 0.14, c, 0, collarY, fz - 0.04);
        box(onBody, 0.12, 0.12, 0.1, M.gold, 0, collarY - 0.12, fz + 0.03);
        box(onBody, 0.08, 0.04, 0.08, M.gold, 0, collarY - 0.05, fz + 0.03);
        break;
      case 'wizard':
        box(onHead, hW + 0.12, 0.03, hD + 0.1, c, 0, headTop + 0.015, -0.02);
        box(onHead, hW * 0.7, 0.1, hD * 0.7, c, 0, headTop + 0.08, -0.02);
        box(onHead, hW * 0.45, 0.1, hD * 0.45, c, 0.02, headTop + 0.17, -0.04);
        box(onHead, 0.08, 0.1, 0.08, c, 0.05, headTop + 0.26, -0.07);
        box(onHead, 0.05, 0.05, 0.02, '#ffd54f', 0, headTop + 0.1, hD * 0.35);
        break;
      case 'rosette':
        box(onBody, tW * 0.92, 0.1, 0.14, '#1565c0', 0, collarY, fz - 0.04);
        box(onBody, 0.18, 0.18, 0.03, c, 0, collarY - 0.1, fz + 0.05);
        box(onBody, 0.09, 0.09, 0.035, '#ffd54f', 0, collarY - 0.1, fz + 0.06);
        box(onBody, 0.05, 0.12, 0.03, c, -0.04, collarY - 0.24, fz + 0.05);
        box(onBody, 0.05, 0.12, 0.03, c, 0.04, collarY - 0.24, fz + 0.05);
        break;
      case 'coat':
        box(onBody, tW + 0.06, tH * 0.75, tL * 0.84, c, 0, bodyY + tH * 0.18, -0.02);
        box(onBody, tW + 0.08, 0.06, tL * 0.86, '#fafafa', 0, bodyY - tH * 0.2, -0.02);
        box(onBody, tW * 0.95, 0.12, 0.16, '#fafafa', 0, collarY, fz - 0.04);
        for (const z of [-0.12, 0.08]) box(onBody, 0.05, 0.05, 0.04, '#ffd54f', 0, bodyY + tH * 0.5 + 0.03, z);
        break;
      case 'santa':
        box(onHead, hW + 0.04, 0.08, hD + 0.02, '#fafafa', 0, headTop + 0.02, -0.02);
        box(onHead, hW * 0.8, 0.12, hD * 0.75, c, 0, headTop + 0.12, -0.03);
        box(onHead, hW * 0.5, 0.1, hD * 0.45, c, 0.04, headTop + 0.22, -0.06);
        box(onHead, 0.1, 0.1, 0.1, c, 0.1, headTop + 0.28, -0.1);
        box(onHead, 0.09, 0.09, 0.09, '#fafafa', 0.16, headTop + 0.24, -0.12);
        break;
      case 'jester':
        box(onHead, hW * 0.9, 0.08, hD * 0.85, '#7b1fa2', 0, headTop + 0.04, -0.02);
        for (const [sx, col] of [[-1, '#7b1fa2'], [1, '#fbc02d']]) {
          box(onHead, 0.08, 0.16, 0.08, col, sx * hW * 0.32, headTop + 0.14, -0.02);
          box(onHead, 0.07, 0.07, 0.07, col, sx * hW * 0.48, headTop + 0.24, -0.02);
          box(onHead, 0.06, 0.06, 0.06, M.gold, sx * hW * 0.58, headTop + 0.2, -0.02);
        }
        box(onHead, 0.08, 0.14, 0.08, '#e53935', 0, headTop + 0.15, -0.02);
        box(onHead, 0.06, 0.06, 0.06, M.gold, 0, headTop + 0.25, -0.02);
        break;
      case 'wings':
        for (const sx of [-1, 1]) {
          box(onBody, 0.04, 0.3, 0.26, c, sx * (tW / 2 + 0.06), bodyY + tH * 0.65, -0.02);
          box(onBody, 0.04, 0.2, 0.18, '#f3e5f5', sx * (tW / 2 + 0.1), bodyY + tH * 0.85, -0.12);
          box(onBody, 0.035, 0.08, 0.08, '#ffffff', sx * (tW / 2 + 0.07), bodyY + tH * 0.7, 0.04);
        }
        break;
      case 'spacesuit':
        box(onBody, tW + 0.06, tH + 0.04, tL * 0.86, '#eceff1', 0, bodyY, -0.02);
        box(onBody, tW * 0.5, tH * 0.5, 0.12, '#90a4ae', 0, bodyY + tH * 0.45, -tL * 0.45);
        box(onBody, 0.12, 0.08, 0.04, '#ef5350', -tW * 0.22, bodyY + tH * 0.2, tL * 0.43);
        box(onBody, 0.08, 0.08, 0.04, '#42a5f5', tW * 0.2, bodyY + tH * 0.2, tL * 0.43);
        break;
      case 'helmet': {
        const g2 = new THREE.MeshLambertMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.35, depthWrite: false });
        box(onHead, hW + 0.18, hH + 0.18, hD + 0.2, g2, 0, 0, 0.02);
        box(onHead, hW + 0.2, 0.06, hD + 0.22, '#eceff1', 0, -hH / 2 - 0.08, 0.02);
        box(onHead, 0.04, 0.12, 0.04, '#b0bec5', hW / 2 + 0.06, headTop + 0.06, -0.06);
        break;
      }
      case 'tiara':
        box(onHead, hW * 0.8, 0.04, 0.04, M.gold, 0, headTop + 0.02, hD * 0.25);
        for (const [x, h] of [[-0.1, 0.08], [0, 0.13], [0.1, 0.08]]) box(onHead, 0.05, h, 0.04, M.crystal, x, headTop + 0.04 + h / 2, hD * 0.25);
        break;
      case 'earmuffs':
        box(onHead, hW + 0.04, 0.04, 0.05, '#9e9e9e', 0, headTop + 0.02, -0.02);
        for (const sx of [-1, 1]) box(onHead, 0.09, 0.14, 0.14, c, sx * (hW / 2 + 0.04), headTop - 0.06, -0.02);
        break;
      case 'balloon':
        box(onHead, 0.02, 0.4, 0.02, '#eeeeee', 0.08, headTop + 0.2, -0.05);
        box(onHead, 0.2, 0.24, 0.2, c, 0.08, headTop + 0.5, -0.05);
        box(onHead, 0.14, 0.06, 0.14, c, 0.08, headTop + 0.36, -0.05);
        box(onHead, 0.05, 0.05, 0.02, '#ffffff', 0.04, headTop + 0.56, 0.06);
        break;
      case 'halo':
        for (const [x, z, w, d] of [[0, 0.12, 0.26, 0.04], [0, -0.12, 0.26, 0.04], [0.12, 0, 0.04, 0.26], [-0.12, 0, 0.04, 0.26]]) box(onHead, w, 0.04, d, M.gold, x, headTop + 0.18, z - 0.02);
        break;
      case 'antenna':
        for (const sx of [-1, 1]) {
          box(onHead, 0.03, 0.2, 0.03, '#424242', sx * hW * 0.25, headTop + 0.1, -0.02);
          box(onHead, 0.08, 0.08, 0.08, c, sx * hW * 0.25, headTop + 0.23, -0.02);
        }
        break;
      case 'sash':
        for (let k = 0; k < 5; k++) box(onBody, tW + 0.05, 0.08, 0.09, c, 0, bodyY + tH * 0.4 - k * 0.07, fz * 0.6 - k * 0.1);
        box(onBody, 0.1, 0.1, 0.03, '#ffd54f', tW / 2 + 0.03, bodyY + tH * 0.2, fz * 0.4);
        break;
      default: break;
    }
    dog.head.add(onHead);
    dog.body.add(onBody);
    return [onHead, onBody];
  }

  // Garden ground and garden clutter
  let grassMat = null;
  function gardenFloorMaterial() {
    if (grassMat) return grassMat;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    drawPattern(c.getContext('2d'), { pattern: 'carpet', c1: '#8fcb6f', c2: '#7dbb5f' }, 32);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(D.CONFIG.CHUNK / 2, D.CONFIG.CHUNK / 2);
    grassMat = new THREE.MeshLambertMaterial({ map: t });
    return grassMat;
  }
  function buildHole() {
    const g = new THREE.Group();
    box(g, 0.5, 0.02, 0.5, '#4a3424', 0, 0.012, 0);
    box(g, 0.14, 0.06, 0.14, '#6b4a2b', 0.3, 0.03, 0.1);
    box(g, 0.1, 0.05, 0.1, '#6b4a2b', -0.26, 0.025, -0.2);
    return g;
  }

  // Little pixel-art faces for the status bubbles and pickers
  const portraitCache = new Map();
  function portraitURL(breedId, coatId) {
    const key = breedId + '|' + coatId;
    if (portraitCache.has(key)) return portraitCache.get(key);
    const B = D.BREEDS[breedId] || D.BREEDS.retriever;
    const C = coatOf(breedId, coatId);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const px = (col, X, Y, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(X * 4, Y * 4, w * 4, h * 4); };
    let eyeY = 6, noseY = 9;
    const kind = B.shape.ears;
    if (kind === 'upright') { // corgi
      px(C.body, 2, 1, 3, 4); px(C.body, 11, 1, 3, 4); px('#f2b5b5', 3, 2, 1, 2); px('#f2b5b5', 12, 2, 1, 2);
      px(C.body, 4, 4, 8, 1); px(C.body, 3, 5, 10, 9);
      px(C.light, 7, 4, 2, 5); px(C.light, 5, 10, 6, 4);
      eyeY = 7; noseY = 10;
    } else if (kind === 'pointed') { // husky
      px(C.body, 3, 1, 3, 3); px(C.body, 4, 0, 1, 1); px(C.body, 10, 1, 3, 3); px(C.body, 11, 0, 1, 1);
      px(C.light, 4, 2, 1, 2); px(C.light, 11, 2, 1, 2);
      px(C.body, 3, 4, 10, 10);
      px(C.light, 3, 9, 10, 5); px(C.light, 7, 4, 2, 4); px(C.light, 5, 5, 2, 1); px(C.light, 9, 5, 2, 1);
      eyeY = 7; noseY = 10;
    } else if (kind === 'fluffy') { // poodle
      px(C.light, 4, 0, 8, 1); px(C.light, 3, 1, 10, 4);
      px(C.body, 4, 5, 8, 9); px(C.body, 1, 5, 3, 8); px(C.body, 12, 5, 3, 8); px(C.body, 2, 13, 2, 1); px(C.body, 12, 13, 2, 1);
      px(C.light, 6, 10, 4, 4);
      eyeY = 7; noseY = 10;
    } else if (kind === 'long') { // dachshund
      px(C.body, 5, 2, 6, 1); px(C.body, 4, 3, 8, 11);
      px(C.dark, 1, 4, 3, 10); px(C.dark, 12, 4, 3, 10);
      px(C.light, 5, 10, 6, 4);
    } else { // retriever
      px(C.body, 4, 3, 8, 1); px(C.body, 3, 4, 10, 10);
      px(C.dark, 1, 3, 3, 8); px(C.dark, 12, 3, 3, 8); px(C.dark, 2, 11, 2, 1); px(C.dark, 12, 11, 2, 1);
      px(C.light, 5, 9, 6, 5);
    }
    if (C.accent) { px(C.accent, 5, eyeY - 1, 2, 1); px(C.accent, 9, eyeY - 1, 2, 1); }
    const eye = B.shape.eyes || '#1a1a1a';
    px(eye, 5, eyeY, 2, 2); px(eye, 9, eyeY, 2, 2);
    if (B.shape.eyes) { px('#1a1a1a', 6, eyeY + 1); px('#1a1a1a', 10, eyeY + 1); }
    px('#ffffff', 5, eyeY); px('#ffffff', 9, eyeY);
    px('#1a1a1a', 7, noseY, 2, 2);
    px('#f07f8f', 7, noseY + 3, 2, 1);
    const url = c.toDataURL();
    portraitCache.set(key, url);
    return url;
  }

  // ===================================================================
  // Player
  // ===================================================================
  function buildPlayer(look = {}) {
    const root = new THREE.Group();
    const body = pivot(root);
    const shirt = look.shirt || '#5b7cfa', pants = look.pants || '#3a3f5c', skin = look.skin || '#f1c8a0', hair = look.hair || '#5a3a22', shoe = '#2a2a2a';
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
    return { root, body, legL, legR, armL, armR, hand };
  }

  // ===================================================================
  // Wallpaper & floor textures
  // ===================================================================
  function drawPattern(ctx, def, n) {
    const u = n / 32; // pattern drawn on a 32-unit grid
    const r = (col, x, y, w, h) => { ctx.fillStyle = col; ctx.fillRect(x * u, y * u, w * u, h * u); };
    const c1 = def.c1, c2 = def.c2 || def.c1;
    const rnd = mulberry32(11);
    switch (def.pattern) {
      case 'stripes':
        r(c1, 0, 0, 32, 32);
        for (let x = 0; x < 32; x += 8) r(c2, x, 0, 4, 32);
        break;
      case 'dots':
        r(c1, 0, 0, 32, 32);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) r(c2, x * 8 + (y % 2) * 4 + 2, y * 8 + 2, 3, 3);
        break;
      case 'check':
        r(c1, 0, 0, 32, 32); r(c2, 0, 0, 16, 16); r(c2, 16, 16, 16, 16);
        break;
      case 'brick':
        r(c2, 0, 0, 32, 32);
        for (let y = 0; y < 4; y++) for (let x = -1; x < 3; x++) r(c1, x * 16 + (y % 2) * 8 + 1, y * 8 + 1, 14, 6);
        break;
      case 'planksV':
        r(c1, 0, 0, 32, 32);
        for (let x = 0; x < 32; x += 8) { r(c2, x, 0, 1, 32); r(c2, x + 3, (x * 7) % 28, 2, 2); }
        break;
      case 'planks':
        for (let y = 0; y < 4; y++) {
          r(y % 2 ? c1 : c2, 0, y * 8, 32, 8);
          r('rgba(0,0,0,0.18)', 0, y * 8 + 7, 32, 1);
          r('rgba(0,0,0,0.18)', ((y * 11) % 24) + 4, y * 8, 1, 7);
        }
        break;
      case 'tiles':
        r(c2, 0, 0, 32, 32);
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) r(c1, x * 16 + 1, y * 16 + 1, 15, 15);
        break;
      case 'carpet':
        r(c1, 0, 0, 32, 32);
        for (let k = 0; k < 60; k++) r(c2, Math.floor(rnd() * 32), Math.floor(rnd() * 32), 1, 1);
        break;
      case 'marble':
        r(c1, 0, 0, 32, 32);
        for (let k = 0; k < 32; k++) { r(c2, k, (k * 0.6 + 4) % 32, 1, 1); r(c2, (k + 10) % 32, (32 - k * 0.8 + 20) % 32, 1, 1); }
        r('rgba(0,0,0,0.08)', 0, 15, 32, 1); r('rgba(0,0,0,0.08)', 15, 0, 1, 32);
        break;
      default:
        r(c1, 0, 0, 32, 32);
    }
  }
  const baseTex = new Map();
  function patternTexture(kind, id) {
    const key = kind + ':' + id;
    if (baseTex.has(key)) return baseTex.get(key);
    const def = (kind === 'wall' ? D.WALLS : D.FLOORS)[id] || (kind === 'wall' ? D.WALLS.cream : D.FLOORS.oak);
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    drawPattern(c.getContext('2d'), def, 32);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    baseTex.set(key, t);
    return t;
  }
  const surfMats = new Map();
  function wallMaterial(id, len) {
    const key = 'w:' + id + ':' + len.toFixed(2);
    if (surfMats.has(key)) return surfMats.get(key);
    const t = patternTexture('wall', id).clone();
    t.needsUpdate = true;
    t.repeat.set(len, 2.4);
    const m = new THREE.MeshLambertMaterial({ map: t });
    surfMats.set(key, m);
    return m;
  }
  function floorMaterial(id) {
    const key = 'f:' + id;
    if (surfMats.has(key)) return surfMats.get(key);
    const t = patternTexture('floor', id).clone();
    t.needsUpdate = true;
    t.repeat.set(D.CONFIG.CHUNK / 2, D.CONFIG.CHUNK / 2);
    const m = new THREE.MeshLambertMaterial({ map: t });
    surfMats.set(key, m);
    return m;
  }
  const swatchCache = new Map();
  function swatchURL(kind, id) {
    const key = kind + ':' + id;
    if (swatchCache.has(key)) return swatchCache.get(key);
    const def = (kind === 'wall' ? D.WALLS : D.FLOORS)[id];
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    drawPattern(c.getContext('2d'), def, 48);
    const url = c.toDataURL();
    swatchCache.set(key, url);
    return url;
  }

  // ===================================================================
  // Park
  // ===================================================================
  const POND = { x0: 3, x1: 9, z0: -7, z1: -2 };
  function onPath(x, z) {
    return (Math.abs(Math.abs(x) - 11) < 1.3 && Math.abs(z) < 12.3) ||
           (Math.abs(Math.abs(z) - 11) < 1.3 && Math.abs(x) < 12.3) ||
           (Math.abs(x) < 1.3 && z > 10);
  }
  const inPond = (x, z, m = 0) => x > POND.x0 - m && x < POND.x1 + m && z > POND.z0 - m && z < POND.z1 + m;

  function buildPark(parkRoot) {
    const colliders = [];
    const spots = [];
    const water = { pos: new V3(-2.4, 0, 13.6), bowl: new V3(-2.4, 0, 14.25), taken: null };
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
    colliders.push({ x0: POND.x0, x1: POND.x1, z0: POND.z0, z1: POND.z1 });

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
    const wp = water.pos, wb = water.bowl;
    box(parkRoot, 0.6, 0.5, 0.6, '#a7a39c', wp.x, 0.25, wp.z);
    box(parkRoot, 0.7, 0.1, 0.7, '#8c8780', wp.x, 0.55, wp.z);
    box(parkRoot, 0.5, 0.04, 0.5, M.water, wp.x, 0.61, wp.z);
    box(parkRoot, 0.1, 0.5, 0.1, '#7d8a94', wp.x, 0.85, wp.z - 0.2);
    box(parkRoot, 0.1, 0.08, 0.24, '#7d8a94', wp.x, 1.08, wp.z - 0.1);
    box(parkRoot, 0.44, 0.1, 0.44, '#3d7fd6', wb.x, 0.05, wb.z);
    box(parkRoot, 0.32, 0.03, 0.32, M.water, wb.x, 0.1, wb.z);
    const drop = emojiSprite('💧', 0.45);
    drop.position.set(wp.x, 1.55, wp.z);
    parkRoot.add(drop);
    colliders.push({ x: wp.x, z: wp.z, r: 0.4 });

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
      colliders.push({ x, z, r: 0.42 });
      spots.push({ pos: new V3(x, 0, z), cooldown: 0, sparkle, taken: null, phase: r() * 6 });
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
      colliders.push({ x, z, r: 0.45 });
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
      box(parkRoot, 0.36, 0.3, 0.36, M.lamp, x, 2.3, z);
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
    return { colliders, spots, water, ponds: [POND], onPath, loop: { x: 11, z0: -11, z1: 11 }, vendors: [], q: {} };
  }

  // ===================================================================
  // Phase 4 places. Every place is 39 x 39 with the gate home in the south (0, 19.6),
  // and returns the same kind of description as the park:
  // colliders, spots (✨ sniff spots; kind 'dig' / 'pool' / 'glade' / 'pine'), water (drinking),
  // ponds (water to splash in), onPath, loop (neighbors' walking square), vendors, q (moving bits for game.js)
  // ===================================================================
  const m4b = new THREE.Matrix4();
  const qtmp = new THREE.Quaternion(), stmp = new V3(), ptmp = new V3();
  function placeInst(mesh, i, x, y, z, s = 1, ry = 0, sy = s) {
    qtmp.setFromAxisAngle(new V3(0, 1, 0), ry);
    m4b.compose(ptmp.set(x, y, z), qtmp, stmp.set(s, sy, s));
    mesh.setMatrixAt(i, m4b);
  }
  function loopOnPath(L, w = 1.3) {
    return (x, z) => (Math.abs(Math.abs(x) - L.x) < w && z > L.z0 - w && z < L.z1 + w) ||
      ((Math.abs(z - L.z0) < w || Math.abs(z - L.z1) < w) && Math.abs(x) < L.x + w) ||
      (Math.abs(x) < w && z > L.z1 - 1);
  }
  function drawLoop(root, L, color, w = 1.6) {
    const len = 2 * L.x + w;
    box(root, len, 0.04, w, color, 0, 0.02, L.z0);
    box(root, len, 0.04, w, color, 0, 0.02, L.z1);
    box(root, w, 0.04, L.z1 - L.z0 + w, color, -L.x, 0.021, (L.z0 + L.z1) / 2);
    box(root, w, 0.04, L.z1 - L.z0 + w, color, L.x, 0.021, (L.z0 + L.z1) / 2);
    const z0 = L.z1, z1 = 19.6;
    box(root, w, 0.04, z1 - z0, color, 0, 0.022, (z0 + z1) / 2);
  }
  // a fence (or wall / rope) around the place with the gate home in the south
  function boundary(root, o = {}) {
    const col = o.color || '#f4efe6', post = o.post || col, h = o.height || 0.85;
    const north = o.north !== false;
    for (const y of o.rails || [0.35, 0.65]) {
      if (north) box(root, 39.2, 0.1, 0.08, col, 0, y, -19.6);
      box(root, 0.08, 0.1, 39.2, col, -19.6, y, 0);
      box(root, 0.08, 0.1, 39.2, col, 19.6, y, 0);
      box(root, 18.1, 0.1, 0.08, col, -10.55, y, 19.6);
      box(root, 18.1, 0.1, 0.08, col, 10.55, y, 19.6);
    }
    const posts = [];
    for (let t = -19.6; t <= 19.61; t += 1.96) {
      if (o.noPosts) break;
      if (north) posts.push([t, -19.6]);
      posts.push([-19.6, t], [19.6, t]);
      if (Math.abs(t) > 1.6) posts.push([t, 19.6]);
    }
    if (posts.length) {
      const pm = new THREE.InstancedMesh(geo(0.16, h, 0.16), mat(post), posts.length);
      posts.forEach(([x, z], i) => placeInst(pm, i, x, h / 2, z));
      root.add(pm);
    }
    box(root, 0.3, 1.5, 0.3, o.gate || '#a0703f', -1.6, 0.75, 19.6);
    box(root, 0.3, 1.5, 0.3, o.gate || '#a0703f', 1.6, 0.75, 19.6);
    const sign = textSprite(o.sign || '🏠 Home', 0.7);
    sign.position.set(0, 1.9, 19.6);
    root.add(sign);
  }
  // a drinking spot: a little fountain, trough or shower near the gate
  function drinkSpot(root, colliders, x, z, style = 'fountain') {
    const water = { pos: new V3(x, 0, z), bowl: new V3(x, 0, z + 0.65), taken: null };
    if (style === 'trough') {
      box(root, 1.2, 0.4, 0.6, '#8d6e4c', x, 0.2, z);
      box(root, 1.0, 0.04, 0.42, M.water, x, 0.39, z);
      box(root, 0.44, 0.1, 0.44, '#8d6e4c', x, 0.05, z + 0.65);
      box(root, 0.32, 0.03, 0.32, M.water, x, 0.1, z + 0.65);
    } else {
      box(root, 0.6, 0.5, 0.6, style === 'shower' ? '#e0e0e0' : '#a7a39c', x, 0.25, z);
      box(root, 0.7, 0.1, 0.7, '#8c8780', x, 0.55, z);
      box(root, 0.5, 0.04, 0.5, M.water, x, 0.61, z);
      box(root, 0.1, style === 'shower' ? 1.6 : 0.5, 0.1, '#7d8a94', x, style === 'shower' ? 1.4 : 0.85, z - 0.2);
      box(root, 0.44, 0.1, 0.44, '#3d7fd6', x, 0.05, z + 0.65);
      box(root, 0.32, 0.03, 0.32, M.water, x, 0.1, z + 0.65);
    }
    const drop = emojiSprite('💧', 0.45);
    drop.position.set(x, 1.55, z);
    root.add(drop);
    colliders.push({ x, z, r: 0.45 });
    return water;
  }
  function addSpot(root, spots, colliders, x, z, kind, build, r = 0.42) {
    const g = pivot(root, x, 0, z);
    if (build) build(g);
    const sparkle = emojiSprite(kind === 'pool' ? '🫧' : '✨', 0.5);
    sparkle.position.set(0, 1.15, 0);
    g.add(sparkle);
    if (r) colliders.push({ x, z, r });
    const s = { pos: new V3(x, 0, z), cooldown: 0, sparkle, taken: null, phase: Math.random() * 6, kind, group: g };
    spots.push(s);
    return s;
  }
  const spotLooks = {
    bush(g) { box(g, 0.7, 0.5, 0.7, '#4f9a45', 0, 0.25, 0); box(g, 0.5, 0.3, 0.5, '#5fae54', 0.05, 0.6, -0.03); box(g, 0.1, 0.1, 0.1, '#e94f6a', 0.2, 0.55, 0.3); },
    hydrant(g) { box(g, 0.3, 0.5, 0.3, '#d63c3c', 0, 0.25, 0); box(g, 0.36, 0.08, 0.36, '#b52e2e', 0, 0.52, 0); box(g, 0.2, 0.12, 0.2, '#d63c3c', 0, 0.62, 0); box(g, 0.44, 0.1, 0.1, '#b52e2e', 0, 0.32, 0); },
    planter(g) {
      box(g, 0.8, 0.4, 0.5, '#8d6e63', 0, 0.2, 0);
      box(g, 0.7, 0.08, 0.4, '#5d4037', 0, 0.41, 0);
      [['#f06292', -0.25], ['#ffd54f', 0], ['#ba68c8', 0.25]].forEach(([c, x]) => { box(g, 0.06, 0.2, 0.06, '#4caf50', x, 0.5, 0); box(g, 0.12, 0.1, 0.12, c, x, 0.62, 0); });
    },
    lamppost(g) { box(g, 0.14, 2.2, 0.14, '#37474f', 0, 1.1, 0); box(g, 0.3, 0.3, 0.3, M.lamp, 0, 2.3, 0); box(g, 0.36, 0.06, 0.36, '#37474f', 0, 2.48, 0); box(g, 0.3, 0.12, 0.3, '#37474f', 0, 0.06, 0); },
    stump(g) { box(g, 0.6, 0.35, 0.6, '#8d6e4c', 0, 0.17, 0); box(g, 0.52, 0.02, 0.52, '#d7b98c', 0, 0.355, 0); box(g, 0.1, 0.12, 0.1, '#e53935', 0.35, 0.06, 0.2); box(g, 0.14, 0.04, 0.14, '#ffffff', 0.35, 0.13, 0.2); },
    log(g) { box(g, 1.2, 0.32, 0.32, '#7b5a3c', 0, 0.16, 0); box(g, 0.04, 0.26, 0.26, '#cfae7e', 0.62, 0.16, 0); box(g, 0.2, 0.06, 0.2, '#7cb342', -0.2, 0.33, 0); },
    pine(g) { box(g, 0.3, 0.9, 0.3, '#6d4c33', 0, 0.45, 0); box(g, 1.2, 0.5, 1.2, '#2e6b3a', 0, 1.0, 0); box(g, 0.8, 0.5, 0.8, '#357a42', 0, 1.45, 0); box(g, 0.08, 0.1, 0.08, '#e0a030', 0.16, 0.6, 0.16); },
    mound(g) { box(g, 0.8, 0.12, 0.8, '#e4cc8c', 0, 0.06, 0); box(g, 0.5, 0.12, 0.5, '#dcc283', 0, 0.16, 0); box(g, 0.14, 0.06, 0.14, '#c8a96a', 0.1, 0.24, 0.05); },
    boulder(g) { box(g, 0.8, 0.5, 0.7, '#9e9e9e', 0, 0.25, 0); box(g, 0.5, 0.3, 0.5, '#b0b0b0', 0.1, 0.6, 0); box(g, 0.2, 0.06, 0.2, '#7cb342', -0.2, 0.52, 0.2); },
    flowers(g) { [['#e91e63', -0.2, 0], ['#ffeb3b', 0.15, 0.1], ['#ffffff', 0, -0.2], ['#8e24aa', 0.2, -0.15]].forEach(([c, x, z]) => { box(g, 0.05, 0.3, 0.05, '#558b2f', x, 0.15, z); box(g, 0.14, 0.1, 0.14, c, x, 0.34, z); }); },
    signpost(g) { box(g, 0.12, 1.3, 0.12, '#8d6e4c', 0, 0.65, 0); box(g, 0.8, 0.22, 0.06, '#c49a6c', 0.25, 1.1, 0); box(g, 0.7, 0.2, 0.06, '#c49a6c', -0.2, 0.8, 0.02); },
  };
  // vendors: a little stall with an awning, a sign and a shopkeeper behind the counter. Faces +z before rotating.
  function stall(root, colliders, id, x, z, rot, o) {
    const V = D.VENDORS[id];
    const g = pivot(root, x, 0, z);
    g.rotation.y = rot;
    box(g, 1.8, 0.9, 0.7, o.counter, 0, 0.45, 0.1);
    box(g, 1.9, 0.08, 0.8, o.top || '#efe6d8', 0, 0.94, 0.12);
    box(g, 1.8, 2.0, 0.12, o.wall, 0, 1.0, -0.75);
    for (const sx of [-0.85, 0.85]) box(g, 0.1, 2.1, 0.1, o.post || '#6d4c41', sx, 1.05, 0.4);
    for (let k = 0; k < 6; k++) box(g, 0.33, 0.08, 1.4, k % 2 ? o.awning : '#ffffff', -0.83 + k * 0.33, 2.15, -0.05);
    const keeper = buildPlayer({ shirt: o.shirt || '#ef5350', hair: o.hair || '#4e342e' });
    keeper.root.position.set(0, 0, -0.35);
    g.add(keeper.root);
    (o.goods || []).forEach((e, k) => { const sp = emojiSprite(e, 0.34); sp.position.set(-0.55 + k * 0.55, 1.15, 0.2); g.add(sp); });
    const sign = textSprite(`${V.icon} ${V.name}`, 0.48);
    sign.position.set(0, 2.7, 0);
    g.add(sign);
    g.userData.vendor = id;
    const side = Math.abs(Math.sin(rot)) > 0.5;
    const cx = x - Math.sin(rot) * 0.2, cz = z - Math.cos(rot) * 0.2;
    const hw = side ? 0.65 : 1.0, hd = side ? 1.0 : 0.65;
    colliders.push({ x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd });
    return { id, group: g, front: new V3(x + Math.sin(rot) * 1.35, 0, z + Math.cos(rot) * 1.35) };
  }
  function tufts(root, n, color, ok, rr, y = 0.07, size = 0.12) {
    const t = new THREE.InstancedMesh(geo(size, 0.16, size), mat(color), n);
    let i = 0;
    for (let k = 0; k < n * 20 && i < n; k++) {
      const x = (rr() * 2 - 1) * 19, z = (rr() * 2 - 1) * 19;
      if (!ok(x, z)) continue;
      placeInst(t, i++, x, y, z);
    }
    t.count = i;
    root.add(t);
  }
  function flowerField(root, n, cols, ok, rr) {
    const f = new THREE.InstancedMesh(geo(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
    const cc = cols.map((c) => new THREE.Color(c));
    let i = 0;
    for (let k = 0; k < n * 20 && i < n; k++) {
      const x = (rr() * 2 - 1) * 19, z = (rr() * 2 - 1) * 19;
      if (!ok(x, z)) continue;
      placeInst(f, i, x, 0.08, z);
      f.setColorAt(i, cc[i % cc.length]);
      i++;
    }
    f.count = i;
    root.add(f);
  }

  // ----- little animals and cars (they face +z; cars face +x) -----
  function buildCritter(kind, color) {
    const g = new THREE.Group();
    switch (kind) {
      case 'pigeon':
        box(g, 0.16, 0.14, 0.26, '#9ea7b3', 0, 0.15, 0);
        box(g, 0.17, 0.06, 0.2, '#8a93a0', 0, 0.19, -0.02);
        box(g, 0.13, 0.05, 0.13, '#6fae8f', 0, 0.22, 0.1);
        box(g, 0.12, 0.12, 0.12, '#7d8794', 0, 0.28, 0.13);
        box(g, 0.04, 0.03, 0.06, '#e0a040', 0, 0.27, 0.21);
        box(g, 0.1, 0.04, 0.12, '#6c7480', 0, 0.16, -0.18);
        for (const s of [-0.04, 0.04]) box(g, 0.025, 0.08, 0.025, '#e57373', s, 0.04, 0);
        break;
      case 'squirrel':
        box(g, 0.14, 0.15, 0.24, '#b5651d', 0, 0.12, 0);
        box(g, 0.1, 0.1, 0.14, '#f3d2a2', 0, 0.1, 0.03);
        box(g, 0.12, 0.12, 0.12, '#b5651d', 0, 0.21, 0.14);
        for (const s of [-0.035, 0.035]) box(g, 0.03, 0.06, 0.03, '#b5651d', s, 0.3, 0.13);
        box(g, 0.02, 0.02, 0.01, '#111111', 0.035, 0.23, 0.205);
        box(g, 0.02, 0.02, 0.01, '#111111', -0.035, 0.23, 0.205);
        box(g, 0.13, 0.3, 0.1, '#c97a35', 0, 0.26, -0.17);
        box(g, 0.13, 0.1, 0.14, '#d58a45', 0, 0.42, -0.12);
        break;
      case 'crab':
        box(g, 0.32, 0.1, 0.22, '#e53935', 0, 0.08, 0);
        for (const s of [-1, 1]) {
          box(g, 0.03, 0.08, 0.03, '#e53935', s * 0.06, 0.16, 0.08);
          box(g, 0.05, 0.05, 0.05, '#ffffff', s * 0.06, 0.21, 0.08);
          box(g, 0.025, 0.025, 0.01, '#111111', s * 0.06, 0.21, 0.106);
          box(g, 0.1, 0.07, 0.08, '#d32f2f', s * 0.2, 0.08, 0.13);
          for (const z of [-0.07, 0, 0.07]) box(g, 0.1, 0.03, 0.03, '#c62828', s * 0.2, 0.03, z);
        }
        break;
      case 'cow': {
        const w = '#f5f5f5', k = '#262626';
        box(g, 0.8, 0.6, 1.4, w, 0, 0.85, 0);
        box(g, 0.82, 0.3, 0.4, k, 0, 0.95, -0.25);
        box(g, 0.4, 0.35, 0.3, k, 0.21, 0.8, 0.35);
        box(g, 0.5, 0.45, 0.5, w, 0, 1.05, 0.88);
        box(g, 0.52, 0.2, 0.22, '#f4b4b4', 0, 0.92, 1.1);
        box(g, 0.52, 0.12, 0.2, k, 0, 1.2, 0.86);
        for (const s of [-1, 1]) {
          box(g, 0.08, 0.14, 0.08, '#f0e6c8', s * 0.22, 1.33, 0.82);
          box(g, 0.14, 0.08, 0.06, w, s * 0.3, 1.18, 0.78);
          box(g, 0.05, 0.05, 0.02, '#111111', s * 0.14, 1.1, 1.13);
        }
        for (const [x, z] of [[-0.27, 0.5], [0.27, 0.5], [-0.27, -0.5], [0.27, -0.5]]) box(g, 0.18, 0.56, 0.18, w, x, 0.28, z);
        box(g, 0.18, 0.08, 0.18, '#f4b4b4', 0, 0.52, -0.3);
        box(g, 0.06, 0.5, 0.06, w, 0, 0.75, -0.72);
        box(g, 0.1, 0.12, 0.1, k, 0, 0.48, -0.72);
        box(g, 0.32, 0.06, 0.1, '#795548', 0, 0.84, 1.02);
        box(g, 0.14, 0.16, 0.12, M.gold, 0, 0.72, 1.05);
        break;
      }
      case 'car': {
        const c = color || '#e53935';
        box(g, 1.6, 0.4, 0.8, c, 0, 0.35, 0);
        box(g, 0.9, 0.34, 0.74, c, -0.1, 0.72, 0);
        box(g, 0.92, 0.24, 0.76, M.window, -0.1, 0.74, 0);
        box(g, 0.06, 0.12, 0.2, M.lamp, 0.8, 0.4, 0.24);
        box(g, 0.06, 0.12, 0.2, M.lamp, 0.8, 0.4, -0.24);
        box(g, 0.05, 0.1, 0.18, '#ff5252', -0.8, 0.4, 0.26);
        box(g, 0.05, 0.1, 0.18, '#ff5252', -0.8, 0.4, -0.26);
        for (const [x, z] of [[-0.5, 0.4], [0.5, 0.4], [-0.5, -0.4], [0.5, -0.4]]) box(g, 0.32, 0.32, 0.12, '#212121', x, 0.16, z);
        break;
      }
      case 'bat':
        box(g, 0.12, 0.1, 0.16, '#2b2233', 0, 0, 0);
        box(g, 0.08, 0.08, 0.08, '#2b2233', 0, 0.03, 0.1);
        for (const s of [-1, 1]) {
          const w = pivot(g, s * 0.06, 0.02, 0);
          box(w, 0.26, 0.02, 0.14, '#3d3047', s * 0.13, 0, 0);
          box(w, 0.1, 0.02, 0.08, '#3d3047', s * 0.28, -0.02, -0.03);
          g.userData[s < 0 ? 'wl' : 'wr'] = w;
          box(g, 0.02, 0.02, 0.01, '#ff5252', s * 0.025, 0.05, 0.145);
        }
        break;
      case 'bunny':
        box(g, 0.2, 0.18, 0.28, '#f5f5f5', 0, 0.12, 0);
        box(g, 0.16, 0.15, 0.15, '#f5f5f5', 0, 0.26, 0.13);
        for (const s of [-1, 1]) box(g, 0.05, 0.2, 0.04, '#f5f5f5', s * 0.04, 0.42, 0.11), box(g, 0.025, 0.14, 0.01, '#f8bbd0', s * 0.04, 0.42, 0.135), box(g, 0.025, 0.025, 0.01, '#111111', s * 0.045, 0.28, 0.21);
        box(g, 0.08, 0.08, 0.06, '#ffffff', 0, 0.16, -0.16);
        break;
      case 'fox':
        box(g, 0.22, 0.2, 0.42, '#ef6c00', 0, 0.22, 0);
        box(g, 0.2, 0.18, 0.18, '#ef6c00', 0, 0.36, 0.24);
        box(g, 0.1, 0.08, 0.12, '#fafafa', 0, 0.31, 0.36);
        for (const s of [-1, 1]) { box(g, 0.06, 0.1, 0.04, '#ef6c00', s * 0.06, 0.49, 0.22); box(g, 0.03, 0.03, 0.01, '#111111', s * 0.05, 0.39, 0.335); }
        for (const [x, z] of [[-0.07, 0.15], [0.07, 0.15], [-0.07, -0.15], [0.07, -0.15]]) box(g, 0.06, 0.14, 0.06, '#3e2723', x, 0.07, z);
        box(g, 0.12, 0.12, 0.3, '#ef6c00', 0, 0.25, -0.3);
        box(g, 0.1, 0.1, 0.08, '#fafafa', 0, 0.25, -0.46);
        break;
      case 'deer':
        box(g, 0.3, 0.3, 0.6, '#a1887f', 0, 0.55, 0);
        box(g, 0.2, 0.22, 0.2, '#a1887f', 0, 0.82, 0.32);
        box(g, 0.12, 0.1, 0.12, '#d7ccc8', 0, 0.76, 0.44);
        for (const s of [-1, 1]) { box(g, 0.03, 0.2, 0.03, '#6d4c41', s * 0.07, 1.02, 0.3); box(g, 0.08, 0.03, 0.03, '#6d4c41', s * 0.11, 1.08, 0.3); box(g, 0.03, 0.03, 0.01, '#111111', s * 0.06, 0.86, 0.425); }
        for (const [x, z] of [[-0.1, 0.2], [0.1, 0.2], [-0.1, -0.2], [0.1, -0.2]]) box(g, 0.07, 0.42, 0.07, '#8d6e63', x, 0.21, z);
        for (const [x, z] of [[0.06, 0.05], [-0.07, -0.1], [0.05, -0.2]]) box(g, 0.05, 0.02, 0.05, '#fafafa', x, 0.71, z);
        break;
      case 'hedgehog':
        box(g, 0.26, 0.16, 0.3, '#5d4037', 0, 0.1, -0.02);
        for (let k = 0; k < 5; k++) box(g, 0.06, 0.06, 0.06, '#3e2723', -0.1 + k * 0.05, 0.2, -0.1 + (k % 2) * 0.08);
        box(g, 0.12, 0.1, 0.12, '#d7b98c', 0, 0.08, 0.15);
        box(g, 0.04, 0.04, 0.04, '#111111', 0, 0.08, 0.22);
        break;
      case 'rover':
        box(g, 1.0, 0.25, 0.7, '#eceff1', 0, 0.45, 0);
        box(g, 0.4, 0.3, 0.5, '#cfd8dc', -0.15, 0.72, 0);
        box(g, 0.05, 0.4, 0.05, '#90a4ae', 0.3, 0.8, 0.2);
        box(g, 0.3, 0.04, 0.3, '#b0bec5', 0.3, 1.02, 0.2);
        for (const x of [-0.38, 0, 0.38]) for (const z of [-0.4, 0.4]) box(g, 0.22, 0.22, 0.1, '#424242', x, 0.12, z);
        box(g, 0.08, 0.08, 0.3, M.lamp, 0.52, 0.48, 0);
        break;
      case 'cat':
        box(g, 0.18, 0.2, 0.32, color || '#2b2b2b', 0, 0.16, 0);
        box(g, 0.18, 0.18, 0.16, color || '#2b2b2b', 0, 0.32, 0.12);
        for (const s of [-1, 1]) {
          box(g, 0.05, 0.07, 0.04, color || '#2b2b2b', s * 0.06, 0.44, 0.12);
          box(g, 0.035, 0.035, 0.01, '#c6ff00', s * 0.045, 0.34, 0.205);
        }
        box(g, 0.04, 0.3, 0.04, color || '#2b2b2b', 0.06, 0.2, -0.18);
        break;
      default: break;
    }
    return g;
  }

  // ----- Old Town -----
  function buildOldTown(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(7);
    const q = { crosswalks: [], cars: [], pigeons: [], puddles: null, cat: null, plaza: { x: 0, z: 3, r: 4.4 }, red: [], green: [] };
    box(root, 100, 0.1, 100, '#a39887', 0, -0.05, 0);
    const cob = new THREE.Mesh(geo(39, 0.1, 39), floorTex({ pattern: 'tiles', c1: '#bfb29b', c2: '#b1a48d' }, 26));
    cob.position.set(0, -0.045, 0);
    root.add(cob);
    drawLoop(root, L, '#d6c7aa', 2.2);
    // the street with two crosswalks where the promenade crosses it
    const sz0 = -5.2, sz1 = -2.8;
    box(root, 60, 0.05, sz1 - sz0, '#5f6168', 0, 0.025, (sz0 + sz1) / 2);
    box(root, 60, 0.1, 0.16, '#a7a7a7', 0, 0.05, sz0 - 0.08);
    box(root, 60, 0.1, 0.16, '#a7a7a7', 0, 0.05, sz1 + 0.08);
    for (let x = -19; x <= 19; x += 2.4) if (Math.abs(Math.abs(x) - 11) > 2) box(root, 1.1, 0.055, 0.1, '#f5f5f5', x, 0.03, -4);
    for (const cx of [-11, 11]) {
      for (let k = 0; k < 6; k++) box(root, 2.4, 0.06, 0.22, '#f5f5f5', cx, 0.032, sz0 + 0.25 + k * 0.4);
      const cw = { x0: cx - 1.3, x1: cx + 1.3, z0: sz0, z1: sz1, cx, cz: (sz0 + sz1) / 2 };
      q.crosswalks.push(cw);
      for (const [px, pz] of [[cx - 1.55, sz1 + 0.35], [cx + 1.55, sz0 - 0.35]]) {
        box(root, 0.12, 1.9, 0.12, '#37474f', px, 0.95, pz);
        box(root, 0.3, 0.6, 0.24, '#263238', px, 1.95, pz);
        q.red.push(box(root, 0.2, 0.2, 0.26, M.redOn, px, 2.08, pz));
        q.green.push(box(root, 0.2, 0.2, 0.26, M.lightOff, px, 1.82, pz));
        colliders.push({ x: px, z: pz, r: 0.15 });
      }
    }
    colliders.push({ x0: -30, x1: -12.3, z0: sz0, z1: sz1 }, { x0: -9.7, x1: 9.7, z0: sz0, z1: sz1 }, { x0: 12.3, x1: 30, z0: sz0, z1: sz1 });
    q.street = { z0: sz0, z1: sz1 };
    q.setPed = (green) => {
      q.red.forEach((m) => { m.material = green ? M.lightOff : M.redOn; });
      q.green.forEach((m) => { m.material = green ? M.greenOn : M.lightOff; });
    };
    ['#e53935', '#1e88e5', '#fdd835', '#43a047'].forEach((c, k) => {
      const car = buildCritter('car', c);
      const dir = k % 2 ? -1 : 1;
      car.rotation.y = dir > 0 ? 0 : Math.PI;
      car.position.set(-18 + k * 11, 0, dir > 0 ? -4.6 : -3.4);
      root.add(car);
      q.cars.push({ g: car, dir, speed: 3 + r() * 1.5 });
    });
    // houses: a row along the north and one on each side, all facing the town
    const pal = ['#f8bbd0', '#ffe0b2', '#c5e1a5', '#b3e5fc', '#fff59d', '#d1c4e9', '#ffccbc', '#e6ee9c', '#b2dfdb'];
    const roofs = ['#8d4b3a', '#5d4037', '#6d4c41', '#7b3f2f'];
    function house(x, z, w, d, rot, k) {
      const g = pivot(root, x, 0, z);
      g.rotation.y = rot;
      const floors = 2 + (k % 2);
      const H = floors * 1.3 + 0.4;
      box(g, w, H, d, pal[k % pal.length], 0, H / 2, 0);
      box(g, w + 0.2, 0.3, d + 0.2, roofs[k % roofs.length], 0, H + 0.15, 0);
      box(g, w * 0.7, 0.4, d * 0.6, roofs[k % roofs.length], 0, H + 0.5, 0);
      box(g, w * 0.35, 0.35, d * 0.3, roofs[k % roofs.length], 0, H + 0.85, 0);
      box(g, 0.8, 1.2, 0.08, '#6d4c41', w * 0.25 * (k % 2 ? 1 : -1), 0.6, d / 2 + 0.03);
      box(g, 0.1, 0.1, 0.06, '#ffd54f', w * 0.25 * (k % 2 ? 1 : -1) + 0.25, 0.6, d / 2 + 0.08);
      for (let f = 0; f < floors; f++) {
        for (const wx of [-w * 0.28, w * 0.05, w * 0.32]) {
          if (f === 0 && Math.abs(wx - w * 0.25 * (k % 2 ? 1 : -1)) < 0.6) continue;
          box(g, 0.6, 0.65, 0.06, '#ffffff', wx, 1.0 + f * 1.3 + 0.2, d / 2 + 0.02);
          box(g, 0.48, 0.52, 0.07, M.window, wx, 1.0 + f * 1.3 + 0.2, d / 2 + 0.03);
          if ((f + k) % 3 === 0) box(g, 0.6, 0.12, 0.2, '#e57373', wx, 0.8 + f * 1.3, d / 2 + 0.1);
        }
      }
      return g;
    }
    for (let k = 0; k < 9; k++) house(-17.6 + k * 4.4, -17.05, 4.3, 5, 0, k);
    colliders.push({ x0: -22, x1: 22, z0: -22, z1: -14.5 });
    for (let k = 0; k < 4; k++) {
      house(17.3, 1.7 + k * 4.3, 4.2, 4.6, -Math.PI / 2, k + 3);
      house(-17.3, 1.7 + k * 4.3, 4.2, 4.6, Math.PI / 2, k + 5);
    }
    colliders.push({ x0: 15, x1: 22, z0: -0.5, z1: 17 }, { x0: -22, x1: -15, z0: -0.5, z1: 17 });
    // the plaza with a fountain
    const P = q.plaza;
    box(root, 8.8, 0.05, 8.8, '#d8c8aa', P.x, 0.025, P.z);
    box(root, 7.6, 0.055, 7.6, '#c9b896', P.x, 0.028, P.z);
    for (const [w, d, x, z] of [[2.8, 0.25, 0, -1.3], [2.8, 0.25, 0, 1.3], [0.25, 2.8, -1.3, 0], [0.25, 2.8, 1.3, 0]]) box(root, w, 0.5, d, '#bdb5a6', P.x + x, 0.25, P.z + z);
    box(root, 2.4, 0.06, 2.4, M.water, P.x, 0.4, P.z);
    box(root, 0.4, 1.2, 0.4, '#bdb5a6', P.x, 0.6, P.z);
    box(root, 1.0, 0.15, 1.0, '#bdb5a6', P.x, 1.25, P.z);
    box(root, 0.8, 0.05, 0.8, M.water, P.x, 1.34, P.z);
    box(root, 0.12, 0.45, 0.12, M.water, P.x, 1.55, P.z);
    const pond = { x0: P.x - 1.4, x1: P.x + 1.4, z0: P.z - 1.4, z1: P.z + 1.4 };
    colliders.push(Object.assign({}, pond));
    ponds.push(pond);
    const water = { pos: new V3(P.x, 0, P.z), bowl: new V3(P.x, 0, P.z + 1.75), taken: null };
    for (const [x, z, ry] of [[-3.3, 3, Math.PI / 2], [3.3, 3, -Math.PI / 2], [0, 6.6, Math.PI]]) {
      const g = pivot(root, P.x + x, 0, z);
      g.rotation.y = ry;
      box(g, 1.6, 0.08, 0.45, '#8d6e63', 0, 0.42, 0);
      box(g, 1.6, 0.35, 0.08, '#8d6e63', 0, 0.68, -0.2);
      box(g, 0.1, 0.4, 0.4, '#37474f', -0.65, 0.2, 0);
      box(g, 0.1, 0.4, 0.4, '#37474f', 0.65, 0.2, 0);
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.4, rad = 2.2 + r() * 1.5;
      const pg = buildCritter('pigeon');
      const home = new V3(P.x + Math.sin(a) * rad, 0, P.z + Math.cos(a) * rad);
      pg.position.copy(home);
      pg.rotation.y = r() * 6;
      root.add(pg);
      q.pigeons.push({ g: pg, home, fly: 0, t: r() * 5 });
    }
    // trees in planters and flower boxes in the open spaces
    for (const [x, z] of [[-6, -8.5], [6, -8.5], [-15.5, -8.5], [15.5, -8.5], [-7, 15.5], [7, 15.5], [-15.6, 18.3], [15.6, 18.3]]) {
      box(root, 0.9, 0.4, 0.9, '#9e9e9e', x, 0.2, z);
      box(root, 0.3, 1.0, 0.3, '#795548', x, 0.9, z);
      box(root, 1.3, 1.0, 1.3, '#558b2f', x, 1.8, z);
      box(root, 0.9, 0.6, 0.9, '#689f38', x, 2.5, z);
      colliders.push({ x, z, r: 0.55 });
    }
    for (const [x, z] of [[-16, -6.5], [16, -6.5], [-3, 18.6], [3, 18.6]]) {
      const g = pivot(root, x, 0, z);
      spotLooks.planter(g);
      colliders.push({ x, z, r: 0.45 });
    }
    // café tables
    for (const [x, z] of [[-13.6, 8.4], [-14.6, 10.4]]) {
      box(root, 0.7, 0.06, 0.7, '#ffffff', x, 0.72, z);
      box(root, 0.08, 0.7, 0.08, '#37474f', x, 0.36, z);
      box(root, 1.0, 0.06, 1.0, '#ef9a9a', x, 1.8, z);
      box(root, 0.05, 1.1, 0.05, '#bdbdbd', x, 1.25, z);
      colliders.push({ x, z, r: 0.4 });
    }
    const vendors = [
      stall(root, colliders, 'cafe', -13.6, 4.2, Math.PI / 2, { counter: '#8d6e63', wall: '#6d4c41', awning: '#43a047', shirt: '#fafafa', hair: '#3e2723', goods: ['☕', '🥨', '🥛'] }),
      stall(root, colliders, 'boutique', 13.6, 4.2, -Math.PI / 2, { counter: '#f8bbd0', wall: '#f48fb1', awning: '#ab47bc', shirt: '#8e24aa', hair: '#ffcc80', goods: ['🎀', '🎨', '🍋'] }),
    ];
    // sniff spots: hydrants, planters and lamp posts along the promenade
    const looks = ['hydrant', 'planter', 'lamppost'];
    [[-12.8, -8.5], [12.8, -8.5], [-6, -12.9], [6, -12.9], [-12.9, 13.2], [12.9, 13.2], [-5.6, 8.9], [5.6, 8.9]].forEach(([x, z], i) => addSpot(root, spots, colliders, x, z, 'sniff', spotLooks[looks[i % 3]], i % 3 === 2 ? 0.2 : 0.4));
    // night: a cat on the wall · rain: puddles
    const cat = buildCritter('cat', '#3a3a3a');
    cat.position.set(-8.6, 0.9, 19.6);
    cat.rotation.y = Math.PI;
    cat.visible = false;
    root.add(cat);
    box(root, 14, 0.9, 0.3, '#bdb5a6', -9.6, 0.45, 19.6);
    box(root, 14, 0.9, 0.3, '#bdb5a6', 9.6, 0.45, 19.6);
    q.cat = cat;
    q.puddles = pivot(root);
    for (let k = 0; k < 7; k++) {
      const x = (r() * 2 - 1) * 9, z = 8 + r() * 9;
      if (Math.abs(x) < 1.6) continue;
      box(q.puddles, 0.8 + r() * 0.6, 0.02, 0.6 + r() * 0.5, '#8fb3cf', x, 0.06, z);
    }
    q.puddles.visible = false;
    boundary(root, { color: '#cfc5b3', post: '#bdb5a6', rails: [], height: 0.9, north: false, gate: '#8d6e63' });
    const onPath = (x, z) => loopOnPath(L, 1.5)(x, z) || (z > q.street.z0 - 0.3 && z < q.street.z1 + 0.3);
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q };
  }

  // ----- Whispering Forest -----
  function buildForest(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(99);
    const q = { glades: [], squirrels: [], fireflies: null, owl: null, snails: null };
    box(root, 100, 0.1, 100, '#4f7d3c', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#679a4f', 0, -0.045, 0);
    const trail = '#a38660';
    drawLoop(root, L, trail, 1.8);
    box(root, 22, 0.04, 1.4, trail, 0, 0.02, 0);
    const branches = [
      { id: 'west', x: -16.6, z: 2, from: [-11, 2] },
      { id: 'north', x: 3, z: -16.6, from: [3, -11] },
      { id: 'east', x: 16.6, z: -6, from: [11, -6] },
    ];
    const faint = '#9a8a62';
    for (const b of branches) {
      const [fx, fz] = b.from;
      if (fz === b.z) box(root, Math.abs(b.x - fx), 0.035, 1.0, faint, (b.x + fx) / 2, 0.018, b.z);
      else box(root, 1.0, 0.035, Math.abs(b.z - fz), faint, b.x, 0.018, (b.z + fz) / 2);
      box(root, 4.6, 0.04, 4.6, '#86b866', b.x, 0.02, b.z);
      const beam = new THREE.Mesh(geo(2.2, 7, 2.2), new THREE.MeshBasicMaterial({ color: '#fff7c2', transparent: true, opacity: 0.12, depthWrite: false }));
      beam.position.set(b.x, 3.5, b.z);
      root.add(beam);
      q.glades.push({ id: b.id, x: b.x, z: b.z, r: 2.4, beam });
      [[-1.4, -1.2], [1.3, -1.4], [1.5, 1.1], [-1.2, 1.5]].forEach(([dx, dz], k) => {
        box(root, 0.08, 0.18, 0.08, '#efe6d8', b.x + dx, 0.09, b.z + dz);
        box(root, 0.2, 0.08, 0.2, k % 2 ? '#e53935' : '#8d6e63', b.x + dx, 0.2, b.z + dz);
      });
      addSpot(root, spots, colliders, b.x + 0.6, b.z - 0.4, 'glade', spotLooks.stump, 0.4);
    }
    const inGlade = (x, z, m = 0) => q.glades.some((g) => Math.hypot(g.x - x, g.z - z) < g.r + m);
    const onBranch = (x, z) => branches.some((b) => {
      const [fx, fz] = b.from;
      return fz === b.z ? Math.abs(z - b.z) < 1.1 && x > Math.min(fx, b.x) && x < Math.max(fx, b.x)
        : Math.abs(x - b.x) < 1.1 && z > Math.min(fz, b.z) && z < Math.max(fz, b.z);
    });
    const ringPath = loopOnPath(L, 1.4);
    const onPath = (x, z) => ringPath(x, z) || (Math.abs(z) < 1.1 && Math.abs(x) < 11.5) || onBranch(x, z) || inGlade(x, z);
    // pond with lily pads
    const pond = { x0: -7, x1: -3, z0: -6.5, z1: -3.5 };
    box(root, 4.6, 0.06, 3.6, '#7a6a4a', -5, 0.02, -5);
    box(root, 4.0, 0.07, 3.0, '#4f8fb0', -5, 0.03, -5);
    box(root, 0.4, 0.08, 0.4, '#66bb6a', -6.1, 0.07, -4.2);
    box(root, 0.3, 0.08, 0.3, '#66bb6a', -3.9, 0.07, -5.8);
    colliders.push(Object.assign({}, pond));
    ponds.push(pond);
    const water = drinkSpot(root, colliders, -2.4, 13.6, 'trough');
    const vendors = [stall(root, colliders, 'ranger', 13.9, 5, -Math.PI / 2, { counter: '#8d6e4c', wall: '#6d4c33', awning: '#2e7d32', top: '#c49a6c', shirt: '#558b2f', hair: '#5d4037', goods: ['🔦', '🧥', '🌲'] })];
    const spotDefs = [[-12.7, -6, 'pine'], [12.7, 8.5, 'sniff'], [-6, -12.7, 'sniff'], [7, -12.7, 'pine'], [-12.7, 8, 'sniff'], [6, 1.8, 'sniff'], [-6, -1.8, 'pine'], [2.2, 12.7, 'sniff']];
    spotDefs.forEach(([x, z, kind], i) => addSpot(root, spots, colliders, x, z, kind, kind === 'pine' ? spotLooks.pine : i % 2 ? spotLooks.log : spotLooks.stump, 0.45));
    // lots of pines, kept off the trails, glades, pond and stall
    const trees = [];
    const clear = (x, z, m) => !onPath(x, z) && !inGlade(x, z, 0.9) && !(x > pond.x0 - m && x < pond.x1 + m && z > pond.z0 - m && z < pond.z1 + m) &&
      !(x > 12 && x < 16 && z > 2 && z < 8) && !(Math.abs(x) < 3.5 && z > 12) && !spots.some((s) => s.pos.distanceTo(new V3(x, 0, z)) < 1.6) &&
      Math.hypot(x + 2.4, z - 13.6) > 1.5;
    // the camera looks from the south-east: a tall tree just south-east of a trail would hide you
    const hides = (x, z) => { for (let t = 0.8; t <= 3.6; t += 0.7) { const px = x - t * 0.39, pz = z - t * 0.92; if (onPath(px, pz) || inGlade(px, pz)) return true; } return false; };
    for (let tries = 0; tries < 3000 && trees.length < 95; tries++) {
      const x = (r() * 2 - 1) * 18.6, z = (r() * 2 - 1) * 18.6;
      if (!clear(x, z, 1.2) || onPath(x + 0.8, z) || onPath(x - 0.8, z) || onPath(x, z + 0.8) || onPath(x, z - 0.8) || hides(x, z)) continue;
      if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.8)) continue;
      trees.push([x, z, 0.8 + r() * 0.5]);
    }
    for (let k = 0; k < 160; k++) {
      const a = r() * 6.283, d = 21 + r() * 14, x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (z > 19 && Math.abs(x) < 8) continue;
      trees.push([x, z, 0.9 + r() * 0.6, true]);
    }
    const trunk = new THREE.InstancedMesh(geo(0.32, 1, 0.32), mat('#6d4c33'), trees.length);
    const l1 = new THREE.InstancedMesh(geo(1.7, 0.7, 1.7), mat('#2e6b3a'), trees.length);
    const l2 = new THREE.InstancedMesh(geo(1.2, 0.7, 1.2), mat('#357a42'), trees.length);
    const l3 = new THREE.InstancedMesh(geo(0.7, 0.6, 0.7), mat('#3f8a4c'), trees.length);
    trees.forEach(([x, z, s, far], i) => {
      const ry = r() * 1.5;
      placeInst(trunk, i, x, 0.5 * s, z, s, ry);
      placeInst(l1, i, x, 1.25 * s, z, s, ry);
      placeInst(l2, i, x, 1.85 * s, z, s, ry);
      placeInst(l3, i, x, 2.4 * s, z, s, ry);
      if (!far) colliders.push({ x, z, r: 0.45 });
    });
    root.add(trunk, l1, l2, l3);
    const near = trees.filter((t) => !t[3]);
    tufts(root, 220, '#4e8a3e', (x, z) => !onPath(x, z), r);
    tufts(root, 120, '#b5793a', (x, z) => !onPath(x, z), r, 0.04, 0.16);
    flowerField(root, 70, ['#ffffff', '#f8bbd0', '#fff59d'], (x, z) => !onPath(x, z) || inGlade(x, z), r);
    // squirrels live near trees by the trail
    for (const [px, pz] of [[-9, -9], [9, -9], [9, 9], [-9, 6]]) {
      let best = near[0], bd = Infinity;
      for (const t of near) { const d = Math.hypot(t[0] - px, t[1] - pz); if (d < bd) { bd = d; best = t; } }
      const sq = buildCritter('squirrel');
      const tree = new V3(best[0], 0, best[1]);
      sq.position.set(tree.x + 0.6, 0, tree.z + 0.4);
      root.add(sq);
      q.squirrels.push({ g: sq, tree, t: r() * 4, state: 'ground', target: null, spotted: false });
    }
    // night: fireflies and an owl · rain: snails
    const N = 46;
    const ff = new THREE.InstancedMesh(geo(0.07, 0.07, 0.07), M.firefly, N);
    const base = [];
    for (let k = 0; k < N; k++) {
      const a = r() * 6.283, d = 2 + r() * 14;
      base.push([Math.sin(a) * d, 0.5 + r() * 1.5, Math.cos(a) * d, r() * 6]);
    }
    ff.visible = false;
    ff.frustumCulled = false;
    root.add(ff);
    q.fireflies = { mesh: ff, base };
    const owlTree = near.reduce((a, t) => (Math.hypot(t[0] + 9, t[1] + 12.5) < Math.hypot(a[0] + 9, a[1] + 12.5) ? t : a), near[0]);
    q.owl = emojiSprite('🦉', 0.55);
    q.owl.position.set(owlTree[0], 3.2 * owlTree[2], owlTree[1]);
    q.owl.visible = false;
    root.add(q.owl);
    q.snails = pivot(root);
    for (let k = 0; k < 6; k++) {
      const s = emojiSprite('🐌', 0.3);
      const a = r();
      s.position.set(k % 2 ? -12.2 : 12.2, 0.18, -9 + a * 18);
      q.snails.add(s);
    }
    q.snails.visible = false;
    // the fairy portal (hidden until you find a fairy ring stone)
    const pg = pivot(root, 1.6, 0, -17.6);
    const ring = pivot(pg, 0, 1.3, 0);
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; box(ring, 0.2, 0.2, 0.2, k % 2 ? M.crystal : M.orb, Math.sin(a) * 1.0, Math.cos(a) * 1.0, 0); }
    const inner = new THREE.Mesh(geo(1.5, 1.5, 0.05), new THREE.MeshBasicMaterial({ color: '#e1bee7', transparent: true, opacity: 0.45, depthWrite: false }));
    inner.position.y = 1.3;
    pg.add(inner);
    pg.visible = false;
    q.portal = { group: pg, ring, pos: new V3(1.6, 0, -17.2) };
    boundary(root, { color: '#6d4c33', post: '#5d4037', gate: '#5d4037' });
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q };
  }

  // ----- Sunny Beach -----
  function buildBeach(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -5, z1: 11 };
    const r = mulberry32(5);
    const q = { sea: null, pools: [], digs: [], crabs: [], foam: null, high: -8, low: -15.5 };
    box(root, 100, 0.1, 100, '#d9bd78', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#e5ca88', 0, -0.045, 0);
    box(root, 60, 0.06, 9.5, '#c9a96a', 0, -0.01, -12.2);
    // the sea: its edge moves with the tide (game.js calls setEdge)
    const sea = new THREE.Mesh(geo(1, 1, 1), M.sea);
    root.add(sea);
    const foam = new THREE.Mesh(geo(60, 0.05, 0.45), new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
    root.add(foam);
    const seaRect = { x0: -40, x1: 40, z0: -80, z1: q.high };
    colliders.push(seaRect);
    ponds.push(seaRect);
    q.sea = { mesh: sea, rect: seaRect, foam };
    q.setEdge = (edge, wave) => {
      seaRect.z1 = edge;
      sea.scale.set(80, 0.12, edge + 80);
      sea.position.set(0, 0.01, (edge - 80) / 2);
      foam.position.set(0, 0.06, edge + 0.1 + (wave || 0));
    };
    q.setEdge(q.high);
    drawLoop(root, L, '#b0835a', 1.8);
    for (let x = -11; x <= 11; x += 0.6) box(root, 0.04, 0.045, 1.8, '#a57e52', x, 0.03, L.z1);
    // tide pools only show at low tide
    [[-7, -12.6], [2.5, -13.2], [9, -12]].forEach(([x, z]) => {
      const g = pivot(root, x, 0, z);
      for (const [dx, dz, w, d] of [[0, -0.75, 1.8, 0.35], [0, 0.75, 1.8, 0.35], [-0.75, 0, 0.35, 1.2], [0.75, 0, 0.35, 1.2]]) box(g, w, 0.22, d, '#8d8d8d', dx, 0.11, dz);
      box(g, 1.2, 0.05, 1.2, M.water, 0, 0.06, 0);
      box(g, 0.14, 0.05, 0.14, '#ff8a65', 0.25, 0.1, 0.2);
      g.visible = false;
      const s = addSpot(root, spots, colliders, x, z + 1.15, 'pool', null, 0);
      s.active = false;
      q.pools.push({ g, spot: s, z });
    });
    // sandy dig spots (one hides treasure on every walk)
    [[-15, -1], [-7, -6.9], [4, -6.9], [15.2, -2], [-5, 6], [6.5, 2.5]].forEach(([x, z]) => {
      const s = addSpot(root, spots, colliders, x, z, 'dig', spotLooks.mound, 0);
      const mark = emojiSprite('❌', 0.5);
      mark.position.set(0, 0.5, 0);
      mark.visible = false;
      s.group.add(mark);
      s.mark = mark;
      q.digs.push(s);
    });
    // umbrellas, towels, a sandcastle and palm trees
    const cols = [['#e53935', '#ffffff'], ['#1e88e5', '#fff59d'], ['#43a047', '#ffffff'], ['#8e24aa', '#f8bbd0']];
    [[-4, 1], [3.5, 7], [-8.5, 7.5], [8, -2.2]].forEach(([x, z], k) => {
      box(root, 0.08, 2, 0.08, '#eeeeee', x, 1, z);
      for (let i = 0; i < 4; i++) box(root, 1.6 - i * 0.3, 0.12, 1.6 - i * 0.3, cols[k][i % 2], x, 2 + i * 0.1, z);
      box(root, 0.8, 0.03, 1.5, cols[(k + 1) % 4][0], x + 0.8, 0.03, z + 0.4);
      colliders.push({ x, z, r: 0.2 });
    });
    const castle = pivot(root, 0.5, 0, -2);
    box(castle, 1, 0.4, 1, '#e2c98a', 0, 0.2, 0);
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) box(castle, 0.25, 0.65, 0.25, '#dcc283', x, 0.33, z);
    box(castle, 0.4, 0.4, 0.4, '#e2c98a', 0, 0.6, 0);
    box(castle, 0.04, 0.3, 0.02, '#795548', 0, 0.95, 0);
    box(castle, 0.16, 0.1, 0.02, '#e53935', 0.08, 1.05, 0);
    colliders.push({ x: 0.5, z: -2, r: 0.65 });
    for (const [x, z] of [[-16.5, 13], [16.5, 13], [-17, 3.5], [17, -1.5], [-12.5, 17.5], [12.5, 17.5]]) {
      for (let i = 0; i < 6; i++) box(root, 0.3, 0.5, 0.3, '#8d6e4c', x + i * 0.06, 0.25 + i * 0.5, z);
      for (const [dx, dz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) box(root, Math.abs(dx) ? 1.4 : 0.4, 0.12, Math.abs(dz) ? 1.4 : 0.4, '#43a047', x + 0.3 + dx * 0.7, 3.0, z + dz * 0.7);
      box(root, 0.5, 0.3, 0.5, '#2e7d32', x + 0.3, 3.15, z);
      colliders.push({ x: x + 0.15, z, r: 0.35 });
    }
    for (let k = 0; k < 4; k++) {
      const c = buildCritter('crab');
      c.position.set(-12 + k * 7 + r() * 2, 0, -7.2);
      root.add(c);
      q.crabs.push({ g: c, home: c.position.clone(), t: r() * 6, hide: 0, met: false });
    }
    tufts(root, 60, '#b7c86a', (x, z) => z > 12 && Math.abs(x) > 2, r);
    const water = drinkSpot(root, colliders, -2.4, 13.6, 'shower');
    const vendors = [stall(root, colliders, 'kiosk', -13.9, 5, Math.PI / 2, { counter: '#4fc3f7', wall: '#0288d1', awning: '#ff7043', top: '#fff8e1', shirt: '#ffca28', hair: '#6d4c41', goods: ['🍦', '🏐', '👒'] })];
    boundary(root, { color: '#c8a46a', post: '#a1784a', rails: [0.5], north: false, gate: '#a1784a' });
    const onPath = loopOnPath(L, 1.3);
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q };
  }

  // ----- Alpine Meadow -----
  function buildAlpine(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(31);
    const q = { flags: [], cows: [], petals: null, snow: null };
    box(root, 100, 0.1, 100, '#76a84e', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#84b85a', 0, -0.045, 0);
    // stepped hills with rocky, snowy tops just outside the fence (north and west)
    const hill = (x, z, w, d, h) => {
      const steps = Math.max(2, Math.round(h / 0.9));
      for (let k = 0; k < steps; k++) {
        const f = 1 - k / steps, top = k >= steps - 2;
        box(root, w * f, 0.9, d * f, top ? (k === steps - 1 && h > 3 ? '#eef2f7' : '#9aa0a6') : k % 2 ? '#6f9e48' : '#78a850', x, 0.45 + k * 0.9, z);
      }
    };
    for (let x = -26; x <= 26; x += 6.5) hill(x + (r() - 0.5) * 2, -24 - r() * 3, 7 + r() * 3, 6 + r() * 2, 2.5 + r() * 3.5);
    for (let z = -16; z <= 16; z += 7) hill(-24 - r() * 2, z, 6 + r() * 2, 7 + r() * 2, 1.8 + r() * 3);
    for (let z = -16; z <= 4; z += 8) hill(24 + r() * 2, z, 5, 6, 1.8);
    drawLoop(root, L, '#c4b28c', 1.6);
    // a little lake
    const pond = { x0: -7.5, x1: -2.5, z0: -6.7, z1: -3.3 };
    box(root, 5.6, 0.06, 4.0, '#a1887f', -5, 0.02, -5);
    box(root, 5.0, 0.07, 3.4, '#5aa7d6', -5, 0.03, -5);
    for (const [x, z] of [[-7.7, -6.2], [-7.6, -4], [-2.2, -6.5]]) box(root, 0.1, 0.6, 0.1, '#7cb342', x, 0.3, z);
    colliders.push(Object.assign({}, pond));
    ponds.push(pond);
    // hiking checkpoints in the four corners of the trail
    [[-12.2, -12.2], [12.2, -12.2], [12.2, 12.2], [-12.2, 12.2]].forEach(([x, z], k) => {
      const g = pivot(root, x, 0, z);
      box(g, 0.1, 2.2, 0.1, '#795548', 0, 1.1, 0);
      const flag = box(g, 0.7, 0.45, 0.04, '#e53935', 0.38, 1.9, 0);
      box(g, 0.6, 0.3, 0.6, '#9e9e9e', 0, 0.15, 0);
      const num = textSprite(String(k + 1), 0.4);
      num.position.set(0, 2.6, 0);
      g.add(num);
      colliders.push({ x, z, r: 0.3 });
      q.flags.push({ g, flag, pos: new V3(x, 0, z), n: k + 1 });
    });
    // rocks
    for (const [x, z, s] of [[-15.5, -15], [15.6, -14.5], [-16.5, 7], [7.5, -15.5], [-7.5, 15.5, 0.8], [16.5, 15]]) {
      box(root, 1.4 * (s || 1), 0.8, 1.1 * (s || 1), '#9e9e9e', x, 0.4, z);
      box(root, 0.9 * (s || 1), 0.5, 0.8 * (s || 1), '#b0b0b0', x + 0.2, 0.95, z);
      colliders.push({ x, z, r: 0.7 * (s || 1) });
    }
    const vendors = [stall(root, colliders, 'hut', 13.9, 5, -Math.PI / 2, { counter: '#a1785a', wall: '#8d5e3c', awning: '#c62828', top: '#d7b98c', shirt: '#2e7d32', hair: '#ffe082', goods: ['🧀', '🎩', '🌼'] })];
    const water = drinkSpot(root, colliders, -2.4, 13.6, 'trough');
    const looks = ['boulder', 'flowers', 'signpost'];
    [[-12.8, -6], [12.8, -6], [-6, -12.8], [6, -12.8], [-12.8, 6], [12.8, 9.2], [5, 5], [-4, 8]].forEach(([x, z], i) => addSpot(root, spots, colliders, x, z, 'sniff', spotLooks[looks[i % 3]], i % 3 === 1 ? 0 : 0.42));
    const onPath = loopOnPath(L, 1.3);
    const free = (x, z) => !onPath(x, z) && !(x > pond.x0 - 0.5 && x < pond.x1 + 0.5 && z > pond.z0 - 0.5 && z < pond.z1 + 0.5);
    flowerField(root, 420, ['#e91e63', '#ffeb3b', '#ffffff', '#8e24aa', '#29b6f6', '#ff7043'], free, r);
    tufts(root, 300, '#7cb342', free, r);
    // cows (they move: game.js updates their colliders)
    for (const [x, z] of [[-6, 4], [4, -6], [6, 7]]) {
      const c = buildCritter('cow');
      c.position.set(x, 0, z);
      c.rotation.y = r() * 6;
      root.add(c);
      const col = { x, z, r: 0.8 };
      colliders.push(col);
      q.cows.push({ g: c, col, target: null, t: r() * 5, met: false });
    }
    // drifting petals in the wind
    const P = 70;
    const pm = new THREE.InstancedMesh(geo(0.07, 0.03, 0.07), new THREE.MeshLambertMaterial({ color: '#ffffff' }), P);
    const pc = ['#f8bbd0', '#ffffff', '#fff59d'].map((c) => new THREE.Color(c));
    const pdata = [];
    for (let k = 0; k < P; k++) { pdata.push([(r() * 2 - 1) * 14, 0.3 + r() * 2, (r() * 2 - 1) * 14, r() * 6]); pm.setColorAt(k, pc[k % 3]); }
    pm.frustumCulled = false;
    root.add(pm);
    q.petals = { mesh: pm, data: pdata };
    q.snow = pivot(root);
    for (let k = 0; k < 40; k++) {
      const x = (r() * 2 - 1) * 18, z = (r() * 2 - 1) * 18;
      if (onPath(x, z)) continue;
      box(q.snow, 0.8 + r() * 1.5, 0.05, 0.6 + r() * 1.2, '#f5f8fc', x, 0.03, z);
    }
    q.snow.visible = false;
    boundary(root, { color: '#8d6e4c', post: '#6d4c33', gate: '#6d4c33' });
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q, fog: { near: 50, far: 160 } };
  }

  // ===================================================================
  // Phase 5 places
  // ===================================================================
  // a little carnival game booth whose sign game.js can change
  function gameBooth(root, colliders, x, z, rot, o) {
    const g = pivot(root, x, 0, z);
    g.rotation.y = rot;
    box(g, 1.8, 0.9, 0.6, o.counter, 0, 0.45, 0.1);
    box(g, 1.8, 2.0, 0.12, o.wall, 0, 1.0, -0.75);
    for (const sx of [-0.85, 0.85]) box(g, 0.1, 2.2, 0.1, '#5d4037', sx, 1.1, 0.4);
    for (let k = 0; k < 6; k++) box(g, 0.33, 0.08, 1.4, k % 2 ? o.awning : '#ffffff', -0.83 + k * 0.33, 2.2, -0.05);
    if (o.decor) o.decor(g);
    const sign = textSprite('🎯', 0.42);
    sign.position.set(0, 2.75, 0);
    g.add(sign);
    const side = Math.abs(Math.sin(rot)) > 0.5;
    const cx = x - Math.sin(rot) * 0.2, cz = z - Math.cos(rot) * 0.2;
    colliders.push({ x0: cx - (side ? 0.65 : 1.0), x1: cx + (side ? 0.65 : 1.0), z0: cz - (side ? 1.0 : 0.65), z1: cz + (side ? 1.0 : 0.65) });
    return { group: g, sign, front: new V3(x + Math.sin(rot) * 1.35, 0, z + Math.cos(rot) * 1.35) };
  }
  function bigPine(root, x, z, s = 1, snow = false) {
    box(root, 0.4 * s, 1.2 * s, 0.4 * s, '#6d4c33', x, 0.6 * s, z);
    [[2.4, 0.9, 1.4], [1.8, 0.8, 2.2], [1.2, 0.7, 2.9], [0.6, 0.6, 3.5]].forEach(([w, h, y]) => {
      box(root, w * s, h * s, w * s, '#2e6b3a', x, y * s, z);
      if (snow) box(root, w * s * 0.9, 0.08 * s, w * s * 0.9, '#f5f9ff', x, (y + h / 2) * s, z);
    });
  }

  // ----- Crystal Caves: tunnels in the rock, hidden crystals, bats, glowing slime -----
  function buildCaves(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(13);
    const q = { crystals: [], bats: [], slime: [] };
    const ring = loopOnPath(L, 1.9);
    const open = (x, z) => ring(x, z) || Math.hypot(x, z) < 5.6 || (Math.abs(x) < 1.4 && Math.abs(z) < 11) || (Math.abs(z) < 1.4 && Math.abs(x) < 11) ||
      (Math.abs(x) < 1.7 && z > 10) || Math.hypot(x + 15.5, z + 6) < 2.9 || (Math.abs(z + 6) < 1.2 && x > -15.5 && x < -11) ||
      Math.hypot(x - 15.5, z - 6) < 2.9 || (Math.abs(z - 6) < 1.2 && x < 15.5 && x > 11);
    box(root, 100, 0.1, 100, '#1f1b22', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#3a3440', 0, -0.045, 0);
    drawLoop(root, L, '#4a4350', 2.6);
    // rock everywhere the tunnels aren't
    const cells = [];
    for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) if (!open(i + 0.5, j + 0.5)) cells.push([i + 0.5, j + 0.5]);
    const rockA = new THREE.InstancedMesh(geo(1, 1, 1), mat('#5a5160'), cells.length);
    const rockB = new THREE.InstancedMesh(geo(0.7, 0.5, 0.7), mat('#6d6373'), cells.length);
    cells.forEach(([x, z], k) => {
      const h = 0.7 + r() * 0.7;
      placeInst(rockA, k, x, h / 2, z, 1, 0, h);
      placeInst(rockB, k, x + (r() - 0.5) * 0.3, h + 0.2, z + (r() - 0.5) * 0.3, 1, r() * 2);
    });
    root.add(rockA, rockB);
    // hidden crystals along the tunnel walls: a Speak echo lights them up (game.js)
    [[-12.6, -8], [12.6, -4], [-8, -12.6], [5, 12.6], [-15.5, -7.8], [15.5, 7.8], [3.6, -3.4], [-3.3, 3.8], [12.6, 9], [-12.6, 4], [8.5, -12.6], [-6, 12.6]].forEach(([x, z], k) => {
      const m = new THREE.MeshLambertMaterial({ color: k % 3 === 2 ? '#f8bbd0' : '#b39ddb', emissive: k % 3 === 2 ? '#ff4081' : '#7c4dff', emissiveIntensity: 0.04 });
      const s = addSpot(root, spots, colliders, x, z, 'crystal', (g) => {
        box(g, 0.16, 0.6, 0.16, m, 0, 0.3, 0);
        box(g, 0.12, 0.42, 0.12, m, 0.14, 0.21, 0.06);
        box(g, 0.1, 0.32, 0.1, m, -0.12, 0.16, -0.05);
        box(g, 0.4, 0.08, 0.4, '#4a4350', 0, 0.04, 0);
      }, 0.3);
      s.active = false;
      s.sparkle.visible = false;
      q.crystals.push({ spot: s, mat: m, lit: 0 });
    });
    [[-12.6, -2.5], [12.6, 2.5], [2.5, -12.6], [-2.5, 12.6], [-2, -4.4], [4.4, 1.6]].forEach(([x, z], i) => addSpot(root, spots, colliders, x, z, 'sniff', (g) => {
      if (i % 2) { box(g, 0.7, 0.4, 0.5, '#6d6373', 0, 0.2, 0); box(g, 0.4, 0.3, 0.4, '#7d7383', 0.1, 0.5, 0); }
      else { box(g, 0.8, 0.45, 0.5, '#6d4c41', 0, 0.35, 0); box(g, 0.7, 0.05, 0.4, '#9e9e9e', 0, 0.6, 0); for (const x2 of [-0.3, 0.3]) box(g, 0.14, 0.14, 0.52, '#424242', x2, 0.08, 0); }
    }, 0.42));
    // glowing slime puddles
    for (const [x, z] of [[-11, 6.5], [11, -6.5], [7, 0], [0, -7.5]]) {
      box(root, 1.4, 0.03, 1.0, M.slime, x, 0.03, z);
      q.slime.push({ x, z, r: 0.8 });
    }
    // torches
    for (const [x, z] of [[-9.1, -9.1], [9.1, -9.1], [9.1, 9.1], [-9.1, 9.1], [-5.3, 1.5], [5.3, -1.5]]) {
      box(root, 0.1, 1.2, 0.1, '#5d4037', x, 0.6, z);
      box(root, 0.18, 0.2, 0.18, M.fire, x, 1.3, z);
      box(root, 0.1, 0.14, 0.1, M.fire2, x, 1.46, z);
    }
    // an underground spring to drink from
    const pond = { x0: 1.6, x1: 3.6, z0: -3.2, z1: -1.4 };
    box(root, 2.4, 0.06, 2.2, '#4a4350', 2.6, 0.02, -2.3);
    box(root, 2.0, 0.07, 1.8, M.water, 2.6, 0.03, -2.3);
    colliders.push(Object.assign({}, pond));
    ponds.push(pond);
    const water = { pos: new V3(2.6, 0, -2.3), bowl: new V3(2.6, 0, -0.95), taken: null };
    // bats circle under the ceiling
    for (let k = 0; k < 8; k++) {
      const b = buildCritter('bat');
      const c = k < 4 ? new V3(0, 0, 0) : new V3(k < 6 ? -15.5 : 15.5, 0, k < 6 ? -6 : 6);
      b.position.set(c.x, 2.4, c.z);
      root.add(b);
      q.bats.push({ g: b, c, rad: 1.5 + r() * 2.5, sp: 0.6 + r() * 0.8, ph: r() * 6, h: 2 + r() * 0.8, scatter: 0 });
    }
    // mine cart on a short track
    for (let k = 0; k < 5; k++) box(root, 0.12, 0.05, 1.3, '#795548', -15.5 + k * 0.7 - 1.4, 0.03, -6);
    box(root, 2.8, 0.04, 0.08, '#9e9e9e', -15.5, 0.06, -6.45);
    box(root, 2.8, 0.04, 0.08, '#9e9e9e', -15.5, 0.06, -5.55);
    const vendors = [stall(root, colliders, 'miner', -3.7, 1.4, Math.PI / 2, { counter: '#6d4c41', wall: '#4e342e', awning: '#fbc02d', top: '#8d6e63', shirt: '#546e7a', hair: '#bdbdbd', goods: ['⛑️', '⛏️', '🔦'] })];
    boundary(root, { noPosts: true, rails: [], color: '#5a5160', gate: '#5d4037', sign: '🏠 Home' });
    const solid = (x, z) => !open(x, z);
    return { colliders, spots, water, ponds, onPath: (x, z) => !open(x, z) || ring(x, z), loop: L, vendors, q, solid,
      env: { sky: '#08070b', hemi: 0.34, sun: 0.08, fog: [20, 42], noWeather: true, dark: true } };
  }

  // ----- Snowy Village: snow, sledding, a rocket at the observatory, December lights -----
  function buildSnowy(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(21);
    const q = { sled: null, rocket: null, festive: null, tree: null };
    box(root, 100, 0.1, 100, '#c9d5e1', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#d4dfea', 0, -0.045, 0);
    drawLoop(root, L, '#b5c3d1', 1.8);
    const onPath = loopOnPath(L, 1.3);
    // wooden chalets with snowy roofs
    const woods = ['#a1785a', '#8d6e4c', '#b48a64', '#7b5a3e'];
    function chalet(x, z, rot, k) {
      const g = pivot(root, x, 0, z);
      g.rotation.y = rot;
      box(g, 4, 2.6, 4.2, woods[k % 4], 0, 1.3, 0);
      box(g, 4.4, 0.35, 4.6, '#f5f9ff', 0, 2.75, 0);
      box(g, 3.2, 0.4, 3.6, '#f5f9ff', 0, 3.1, 0);
      box(g, 1.8, 0.4, 2.4, '#f5f9ff', 0, 3.5, 0);
      box(g, 0.8, 1.3, 0.08, '#5d4037', 0.9, 0.65, 2.12);
      for (const wx of [-1.1, 0.1]) { box(g, 0.7, 0.7, 0.06, '#ffffff', wx, 1.6, 2.12); box(g, 0.56, 0.56, 0.07, M.window, wx, 1.6, 2.13); }
      box(g, 0.4, 0.9, 0.4, '#8d8d8d', 1.4, 3.3, -1);
      return g;
    }
    for (let k = 0; k < 6; k++) chalet(-17.6 + k * 4.4, -17, 0, k);
    colliders.push({ x0: -22, x1: 6.6, z0: -22, z1: -14.7 });
    for (let k = 0; k < 3; k++) chalet(17.4, 7.6 + k * 4.4, -Math.PI / 2, k + 2);
    colliders.push({ x0: 15.2, x1: 22, z0: 5.3, z1: 18.4 });
    // the sled hill: a stepped snowy ramp, ride down from the top (game.js)
    const hx0 = 13, hx1 = 18.6, hz0 = -18.8, hz1 = -9.2, top = 2.4;
    for (let k = 0; k < 10; k++) {
      const z0 = hz0 + k * ((hz1 - hz0) / 10), h = top * (1 - k / 10) + 0.08;
      box(root, hx1 - hx0, h, (hz1 - hz0) / 10 + 0.02, k % 2 ? '#eef4fa' : '#e3ecf5', (hx0 + hx1) / 2, h / 2, z0 + (hz1 - hz0) / 20);
    }
    box(root, 0.2, 0.04, hz1 - hz0, '#cfd9e3', 15.4, top * 0.5, (hz0 + hz1) / 2);
    colliders.push({ x0: hx0, x1: hx1, z0: hz0 - 0.5, z1: hz1 });
    const sledMesh = pivot(root, 15.8, 0, -7.9);
    box(sledMesh, 0.6, 0.08, 1.1, '#c62828', 0, 0.16, 0);
    for (const sx of [-0.26, 0.26]) box(sledMesh, 0.05, 0.06, 1.2, '#9e9e9e', sx, 0.06, 0.02);
    box(sledMesh, 0.6, 0.18, 0.06, '#c62828', 0, 0.26, 0.55);
    const ssign = textSprite('🛷 Sledding', 0.5);
    ssign.position.set(15.8, 1.6, -8.3);
    root.add(ssign);
    q.sled = { pad: new V3(15.8, 0, -7.4), x: 15.8, z0: -18.2, z1: -7.6, top, hz1, mesh: sledMesh };
    // the observatory and its rocket (fuel it with moonstones)
    const ox = -16.8, oz = -4;
    box(root, 3.2, 2.2, 3.2, '#eceff1', ox, 1.1, oz);
    [[2.8, 0.5], [2.3, 0.5], [1.6, 0.45], [0.9, 0.4]].forEach(([w, h], k) => box(root, w, h, w, '#cfd8dc', ox, 2.45 + k * 0.48, oz));
    box(root, 0.5, 0.5, 1.6, '#455a64', ox + 0.6, 3.3, oz + 0.6);
    colliders.push({ x0: ox - 1.7, x1: ox + 1.7, z0: oz - 1.7, z1: oz + 1.7 });
    const rk = pivot(root, -15.2, 0, 4);
    box(rk, 2, 0.2, 2, '#9e9e9e', 0, 0.1, 0);
    box(rk, 0.9, 2.6, 0.9, '#fafafa', 0, 1.6, 0);
    box(rk, 0.7, 0.6, 0.7, '#e53935', 0, 3.2, 0);
    box(rk, 0.4, 0.4, 0.4, '#e53935', 0, 3.7, 0);
    box(rk, 0.45, 0.45, 0.06, M.window, 0, 2.2, 0.46);
    for (const [x, z] of [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]]) box(rk, Math.abs(x) ? 0.25 : 0.1, 0.8, Math.abs(z) ? 0.25 : 0.1, '#e53935', x, 0.6, z);
    const rsign = textSprite('🚀', 0.5);
    rsign.position.set(0, 4.5, 0);
    rk.add(rsign);
    colliders.push({ x: -15.2, z: 4, r: 1.0 });
    q.rocket = { pos: new V3(-15.2, 0, 4), group: rk, sign: rsign };
    // the big tree on the square, with lights in December
    bigPine(root, 0, 2, 1.1, true);
    colliders.push({ x: 0, z: 2, r: 1.2 });
    const fest = pivot(root);
    for (let k = 0; k < 16; k++) {
      const a = k * 2.4, y = 1 + (k / 16) * 2.6, rad = 1.3 * (1 - k / 22);
      box(fest, 0.12, 0.12, 0.12, M.bulbs[k % 5], Math.sin(a) * rad, y * 1.1, 2 + Math.cos(a) * rad);
    }
    box(fest, 0.3, 0.3, 0.1, M.gold, 0, 4.4, 2);
    [[-1, 3.4, '#e53935'], [1.1, 3.2, '#1e88e5'], [0.3, 3.5, '#43a047']].forEach(([x, z, c]) => { box(fest, 0.4, 0.35, 0.4, c, x, 0.18, z); box(fest, 0.42, 0.06, 0.08, '#ffd54f', x, 0.3, z); });
    for (let k = 0; k < 6; k++) for (let i = 0; i < 8; i++) box(fest, 0.1, 0.1, 0.1, M.bulbs[(i + k) % 5], -17.6 + k * 4.4 - 1.6 + i * 0.45, 2.75, -14.8);
    fest.visible = false;
    q.festive = fest;
    // snowmen
    for (const [x, z] of [[-6, -6], [6.5, 7], [-7, 8]]) {
      box(root, 0.8, 0.7, 0.8, '#ffffff', x, 0.35, z);
      box(root, 0.6, 0.55, 0.6, '#ffffff', x, 0.95, z);
      box(root, 0.42, 0.42, 0.42, '#ffffff', x, 1.42, z);
      box(root, 0.08, 0.08, 0.25, '#ff9800', x, 1.42, z + 0.3);
      box(root, 0.46, 0.06, 0.46, '#e53935', x, 1.2, z);
      colliders.push({ x, z, r: 0.5 });
    }
    for (const [x, z] of [[-6, -9], [6, -9], [-9, 6], [9, 3]]) {
      box(root, 0.14, 2.2, 0.14, '#37474f', x, 1.1, z);
      box(root, 0.3, 0.3, 0.3, M.lamp, x, 2.3, z);
      colliders.push({ x, z, r: 0.15 });
    }
    const vendors = [stall(root, colliders, 'igloo', 13.9, 1.5, -Math.PI / 2, { counter: '#e3f2fd', wall: '#bbdefb', awning: '#1e88e5', top: '#ffffff', shirt: '#c62828', hair: '#fafafa', goods: ['🧥', '🎅', '🍵'] })];
    const water = drinkSpot(root, colliders, -2.4, 13.6, 'trough');
    const looks = [(g) => { box(g, 0.7, 0.45, 0.7, '#e8f0f8', 0, 0.22, 0); box(g, 0.5, 0.25, 0.5, '#2e6b3a', 0.05, 0.55, 0); box(g, 0.5, 0.06, 0.5, '#ffffff', 0.05, 0.69, 0); },
      (g) => { box(g, 0.4, 0.35, 0.4, '#e53935', 0, 0.18, 0); box(g, 0.42, 0.06, 0.1, '#ffd54f', 0, 0.3, 0); box(g, 0.3, 0.25, 0.3, '#1e88e5', 0.32, 0.12, 0.1); },
      spotLooks.signpost];
    [[-12.7, -6], [12.7, -3], [-6, -12.7], [5, -12.7], [-12.7, 8.5], [12.7, 13], [4.5, 4.5], [-4, 10]].forEach(([x, z], i) => addSpot(root, spots, colliders, x, z, 'sniff', looks[i % 3], 0.42));
    tufts(root, 120, '#ffffff', (x, z) => !onPath(x, z), r, 0.05, 0.2);
    boundary(root, { color: '#8d6e63', post: '#6d4c41', gate: '#6d4c41' });
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q, env: { snowFall: true } };
  }

  // ----- Moonlight Carnival: game booths, a Ferris wheel, a carousel and lights -----
  function buildCarnival(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(77);
    const q = { wheel: null, carousel: null, booths: [] };
    box(root, 100, 0.1, 100, '#4f5d3f', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#62704c', 0, -0.045, 0);
    drawLoop(root, L, '#b59c78', 2.0);
    const onPath = loopOnPath(L, 1.4);
    // Ferris wheel
    const wx = 0, wz = -15.6, hubY = 6.3, R = 5;
    for (const sx of [-1.5, 1.5]) {
      for (const lx of [-1, 1]) {
        const leg = pivot(root, wx + lx * 1.6, 0, wz + sx * 0.35);
        leg.rotation.z = -lx * 0.25;
        box(leg, 0.25, hubY + 0.4, 0.25, '#9e9e9e', 0, (hubY + 0.4) / 2, 0);
      }
    }
    box(root, 4.6, 0.3, 2.4, '#757575', wx, 0.15, wz);
    const wheel = pivot(root, wx, hubY, wz);
    box(wheel, 0.6, 0.6, 1.0, '#e0e0e0', 0, 0, 0);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const seg = box(wheel, 0.18, 2.0, 0.18, k % 2 ? '#e53935' : '#fdd835', Math.sin(a) * R, Math.cos(a) * R, 0);
      seg.rotation.z = -a + Math.PI / 2;
      const b = box(wheel, 0.14, 0.14, 0.14, M.bulbs[k % 5], Math.sin(a) * (R + 0.15), Math.cos(a) * (R + 0.15), 0.12);
      b.rotation.z = -a;
    }
    const gondolas = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sp = box(wheel, 0.1, R, 0.1, '#bdbdbd', Math.sin(a) * R / 2, Math.cos(a) * R / 2, 0);
      sp.rotation.z = -a;
      const gp = pivot(wheel, Math.sin(a) * R, Math.cos(a) * R, 0.5);
      box(gp, 0.08, 0.5, 0.08, '#9e9e9e', 0, -0.25, 0);
      box(gp, 0.9, 0.55, 0.7, ['#42a5f5', '#ef5350', '#66bb6a', '#ffca28'][k % 4], 0, -0.75, 0);
      box(gp, 0.95, 0.08, 0.75, '#fafafa', 0, -0.45, 0);
      gondolas.push(gp);
    }
    colliders.push({ x0: wx - 2.6, x1: wx + 2.6, z0: wz - 1.4, z1: wz + 1.4 });
    q.wheel = { group: wheel, gondolas, spot: new V3(wx, 0, wz + 3.2), speed: 0.12 };
    const wsign = textSprite('🎡 Ferris wheel', 0.5);
    wsign.position.set(wx, 1.6, wz + 1.9);
    root.add(wsign);
    // carousel
    const car = pivot(root, 0, 0, 2);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const b = box(car, 2.2, 0.25, 1.0, k % 2 ? '#f8bbd0' : '#fff59d', Math.sin(a) * 1.6, 0.12, Math.cos(a) * 1.6); b.rotation.y = a; }
    box(car, 0.25, 3, 0.25, M.gold, 0, 1.5, 0);
    for (let k = 0; k < 3; k++) box(car, 5.4 - k * 1.6, 0.35, 5.4 - k * 1.6, k % 2 ? '#ffffff' : '#e53935', 0, 3 + k * 0.35, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, hx = Math.sin(a) * 1.8, hz = Math.cos(a) * 1.8;
      box(car, 0.06, 2.6, 0.06, M.gold, hx, 1.6, hz);
      const horse = pivot(car, hx, 1.0, hz);
      horse.rotation.y = a + Math.PI / 2;
      box(horse, 0.24, 0.32, 0.6, ['#ffffff', '#ffe0b2', '#e1bee7'][k % 3], 0, 0, 0);
      box(horse, 0.2, 0.3, 0.22, ['#ffffff', '#ffe0b2', '#e1bee7'][k % 3], 0, 0.22, 0.3);
      box(horse, 0.08, 0.2, 0.3, '#8d6e63', 0, 0.28, 0.12);
    }
    colliders.push({ x: 0, z: 2, r: 2.9 });
    q.carousel = car;
    // game booths: do the trick the sign asks for
    const decor = [
      (g) => { for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; box(g, 0.1, 0.1, 0.1, '#ff7043', Math.sin(a) * 0.35, 1.5 + Math.cos(a) * 0.35, -0.5); } },
      (g) => { for (let k = 0; k < 5; k++) box(g, 0.1, 0.3, 0.1, ['#43a047', '#1e88e5', '#e53935'][k % 3], -0.6 + k * 0.3, 1.07, 0.1); },
      (g) => { box(g, 0.2, 1.6, 0.2, '#fafafa', 0.5, 1.7, -0.5); box(g, 0.3, 0.3, 0.3, M.gold, 0.5, 2.6, -0.5); },
    ];
    [[-13.9, -6, '#e53935'], [-13.9, 0, '#1e88e5'], [-13.9, 6, '#8e24aa']].forEach(([x, z, c], k) => {
      q.booths.push(gameBooth(root, colliders, x, z, Math.PI / 2, { counter: '#fff3e0', wall: c, awning: c, decor: decor[k] }));
    });
    // tents and carts
    for (const [x, z] of [[-14.5, -15.5], [14.5, -15.5]]) {
      for (let k = 0; k < 4; k++) box(root, 3.4 - k * 0.8, 0.6, 3.4 - k * 0.8, k % 2 ? '#e53935' : '#ffffff', x, 0.3 + k * 0.6, z);
      box(root, 0.1, 0.8, 0.1, M.gold, x, 2.8, z);
      colliders.push({ x, z, r: 1.8 });
    }
    for (const [x, z, c] of [[-5.5, 14.5, '#f48fb1'], [5.5, 14.5, '#ffd54f']]) {
      box(root, 1.2, 0.8, 0.8, c, x, 0.6, z);
      for (const sx of [-0.45, 0.45]) box(root, 0.3, 0.3, 0.1, '#424242', x + sx, 0.15, z + 0.42);
      box(root, 1.3, 0.1, 0.9, '#ffffff', x, 1.6, z);
      box(root, 0.06, 0.6, 0.06, '#eeeeee', x, 1.3, z);
      colliders.push({ x, z, r: 0.75 });
    }
    // string lights along the path
    for (const [x, z] of [[-12.4, -12.4], [12.4, -12.4], [12.4, 12.4], [-12.4, 12.4], [-3.2, 12.4], [3.2, 12.4]]) {
      box(root, 0.12, 2.6, 0.12, '#5d4037', x, 1.3, z);
      box(root, 0.26, 0.26, 0.26, M.bulbs[Math.floor(r() * 5)], x, 2.7, z);
      colliders.push({ x, z, r: 0.15 });
    }
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      box(root, 0.12, 0.12, 0.12, M.bulbs[k % 5], -12.4 + t * 24.8, 2.45 - Math.sin(t * Math.PI) * 0.5, -12.4);
      box(root, 0.12, 0.12, 0.12, M.bulbs[(k + 2) % 5], -12.4 + t * 24.8, 2.45 - Math.sin(t * Math.PI) * 0.5, 12.4);
    }
    const vendors = [stall(root, colliders, 'prizes', 13.9, 0, -Math.PI / 2, { counter: '#ffecb3', wall: '#ff7043', awning: '#7e57c2', top: '#fff8e1', shirt: '#7e57c2', hair: '#ff8a65', goods: ['🧸', '🦄', '🎟️'] })];
    const water = drinkSpot(root, colliders, -2.4, 13.6);
    const hay = (g) => { box(g, 0.9, 0.5, 0.6, '#e6c35c', 0, 0.25, 0); box(g, 0.92, 0.06, 0.62, '#c9a43c', 0, 0.3, 0); };
    const popcorn = (g) => { box(g, 0.35, 0.45, 0.35, '#e53935', 0, 0.22, 0); box(g, 0.36, 0.45, 0.1, '#ffffff', 0, 0.22, 0); box(g, 0.3, 0.12, 0.3, '#fff59d', 0, 0.5, 0); };
    [[-6, -12.7], [6, -12.7], [-12.7, -10], [12.7, -9], [12.7, 8], [-12.7, 10], [5.5, 7.5], [-5.5, 7.5]].forEach(([x, z], i) => addSpot(root, spots, colliders, x, z, 'sniff', i % 2 ? hay : popcorn, 0.42));
    flowerField(root, 120, ['#ff5252', '#ffeb3b', '#40c4ff', '#e040fb', '#69f0ae'], (x, z) => !onPath(x, z), r);
    boundary(root, { color: '#d7ccc8', post: '#8d6e63' });
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q };
  }

  // ----- Fairy Realm: talking animals, floating toys, the statue puzzle -----
  function buildFairy(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(55);
    const q = { statues: [], orb: null, floaters: [], animals: [], motes: null };
    box(root, 100, 0.1, 100, '#8fd0a2', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#a5e2b6', 0, -0.045, 0);
    drawLoop(root, L, '#e6d3f5', 1.8);
    const onPath = loopOnPath(L, 1.3);
    // the glowing orb and four stone dogs around it
    const O = new V3(0, 0, -2);
    box(root, 6.6, 0.05, 6.6, '#d9c8ef', O.x, 0.025, O.z);
    box(root, 0.8, 0.9, 0.8, '#e0e0e0', O.x, 0.45, O.z);
    const orb = box(root, 0.6, 0.6, 0.6, M.orb, O.x, 1.4, O.z);
    colliders.push({ x: O.x, z: O.z, r: 0.6 });
    q.orb = { mesh: orb, pos: O };
    const stone = new THREE.MeshLambertMaterial({ color: '#b8b8c2' });
    [[0, -3.4, 0], [3.4, 0, 3], [0, 3.4, 2], [-3.4, 0, 1]].forEach(([dx, dz, target]) => {
      const p = pivot(root, O.x + dx, 0, O.z + dz);
      box(p, 0.9, 0.5, 0.9, '#d6d6de', 0, 0.25, 0);
      const s = pivot(p, 0, 0.5, 0);
      const d = buildDog('husky', 'grey');
      d.root.traverse((m) => { if (m.isMesh) m.material = stone; });
      d.patches.forEach((pt) => { pt.visible = false; });
      d.root.scale.setScalar(1.3);
      s.add(d.root);
      colliders.push({ x: O.x + dx, z: O.z + dz, r: 0.6 });
      q.statues.push({ group: s, pos: new V3(O.x + dx, 0, O.z + dz), rot: 0, target, turn: 0 });
    });
    // giant mushrooms and candy trees
    const free = (x, z, m = 2) => !onPath(x, z) && Math.hypot(x - O.x, z - O.z) > 5 && !(x > 12 && x < 16 && z > 2 && z < 8) && !(Math.abs(x) < 3.5 && z > 11);
    let n = 0;
    for (let k = 0; k < 400 && n < 16; k++) {
      const x = (r() * 2 - 1) * 18, z = (r() * 2 - 1) * 18;
      if (!free(x, z) || onPath(x + 1.5, z) || onPath(x, z + 1.5) || onPath(x - 0.8, z - 0.8)) continue;
      const s = 0.8 + r() * 0.8, red = n % 3 !== 2;
      box(root, 0.4 * s, 1.4 * s, 0.4 * s, '#fff8e1', x, 0.7 * s, z);
      box(root, 1.6 * s, 0.5 * s, 1.6 * s, red ? '#e53935' : '#9575cd', x, 1.55 * s, z);
      box(root, 1.1 * s, 0.3 * s, 1.1 * s, red ? '#e53935' : '#9575cd', x, 1.9 * s, z);
      for (const [dx, dz] of [[0.4, 0.3], [-0.3, 0.5], [0.1, -0.5]]) box(root, 0.18 * s, 0.06, 0.18 * s, '#ffffff', x + dx * s, 2.06 * s, z + dz * s);
      colliders.push({ x, z, r: 0.35 * s + 0.1 });
      n++;
    }
    flowerField(root, 260, ['#f48fb1', '#ce93d8', '#80deea', '#fff59d', '#ffffff'], (x, z) => !onPath(x, z), r);
    // a glowing pond
    const pond = { x0: -9, x1: -5.5, z0: -9.5, z1: -7 };
    box(root, 4.0, 0.06, 3.0, '#d1c4e9', -7.25, 0.02, -8.25);
    box(root, 3.5, 0.07, 2.5, M.orb, -7.25, 0.03, -8.25);
    colliders.push(Object.assign({}, pond));
    ponds.push(pond);
    // floating toys drift around: catch them!
    ['bone', 'duck', 'donut', 'bouncy', 'rope'].forEach((t, k) => {
      const g = buildToy(t);
      g.scale.setScalar(1.5);
      const glow = emojiSprite('✨', 0.4);
      glow.position.y = 0.35;
      g.add(glow);
      const a = (k / 5) * Math.PI * 2;
      g.position.set(Math.sin(a) * 7, 1.3, Math.cos(a) * 7);
      root.add(g);
      q.floaters.push({ g, a, rad: 6 + r() * 2, sp: 0.08 + r() * 0.06, ph: r() * 6, away: 0 });
    });
    // talking animals
    [['bunny', -12.8, -5], ['fox', 12.8, -7], ['deer', -6, 12.8], ['hedgehog', 6, -12.8]].forEach(([kind, x, z], k) => {
      const g = buildCritter(kind);
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(-x, -z);
      root.add(g);
      const bubble = textSprite('…', 0.36);
      bubble.position.set(0, kind === 'deer' ? 1.5 : 0.9, 0);
      bubble.visible = false;
      g.add(bubble);
      colliders.push({ x, z, r: 0.35 });
      q.animals.push({ g, kind, bubble, t: 0, line: k });
    });
    // fairy dust in the air
    const N = 60;
    const mm = new THREE.InstancedMesh(geo(0.06, 0.06, 0.06), M.firefly, N);
    const data = [];
    for (let k = 0; k < N; k++) data.push([(r() * 2 - 1) * 14, 0.3 + r() * 2.2, (r() * 2 - 1) * 14, r() * 6]);
    mm.frustumCulled = false;
    root.add(mm);
    q.motes = { mesh: mm, data };
    // a portal arch over the way home
    for (const sx of [-1, 1]) box(root, 0.3, 2.6, 0.3, M.crystal, sx * 1.6, 1.3, 19.3);
    box(root, 3.5, 0.3, 0.3, M.crystal, 0, 2.7, 19.3);
    const vendors = [stall(root, colliders, 'fairyshop', 13.9, 5, -Math.PI / 2, { counter: '#f8bbd0', wall: '#ce93d8', awning: '#80deea', top: '#fff', shirt: '#81c784', hair: '#fff59d', goods: ['🦋', '🪄', '🧚'] })];
    const water = drinkSpot(root, colliders, -2.4, 13.6);
    const glowstone = (g) => { box(g, 0.5, 0.35, 0.5, '#e1bee7', 0, 0.17, 0); box(g, 0.25, 0.25, 0.25, M.orb, 0.05, 0.45, 0); };
    [[-12.7, -9], [12.7, -1], [-3, -12.7], [9.5, -12.7], [-12.7, 8], [12.7, 11], [-7, 6], [7, 6]].forEach(([x, z], i) => addSpot(root, spots, colliders, x, z, 'sniff', i % 2 ? glowstone : spotLooks.flowers, i % 2 ? 0.42 : 0));
    boundary(root, { color: '#f8bbd0', post: '#ce93d8', gate: '#ce93d8', sign: '🏠 Home' });
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q, env: { sky: '#f3dcff', hemi: 0.95, sun: 0.45, noWeather: true, fogColor: '#f3dcff' } };
  }

  // ----- Moon Base: low gravity, craters (one hides a capsule), a rover and domes -----
  function buildMoon(root) {
    const colliders = [], spots = [], ponds = [];
    const L = { x: 11, z0: -11, z1: 11 };
    const r = mulberry32(88);
    const q = { craters: [], rover: null };
    box(root, 100, 0.1, 100, '#6f7076', 0, -0.05, 0);
    box(root, 39, 0.1, 39, '#8b8c92', 0, -0.045, 0);
    drawLoop(root, L, '#a3a4aa', 1.6);
    const onPath = loopOnPath(L, 1.3);
    // little dents everywhere
    const dents = new THREE.InstancedMesh(geo(0.6, 0.03, 0.6), mat('#7a7b81'), 140);
    let n = 0;
    for (let k = 0; k < 2000 && n < 140; k++) {
      const x = (r() * 2 - 1) * 19, z = (r() * 2 - 1) * 19;
      if (onPath(x, z)) continue;
      placeInst(dents, n++, x, 0.01, z, 0.5 + r() * 1.4);
    }
    dents.count = n;
    root.add(dents);
    // domes
    function dome(x, z, s) {
      [[3.2, 0.8], [2.8, 0.7], [2.2, 0.6], [1.4, 0.5]].forEach(([w, h], k) => box(root, w * s, h * s, w * s, k % 2 ? '#eceff1' : '#cfd8dc', x, (0.4 + k * 0.7) * s, z));
      box(root, 0.8 * s, 0.6 * s, 0.1, M.window, x, 0.5 * s, z + 1.6 * s);
      colliders.push({ x, z, r: 1.6 * s });
    }
    dome(-6, -16.4, 1.1);
    dome(4, -16.6, 1.3);
    box(root, 6, 0.6, 0.8, '#b0bec5', -1, 0.3, -16.5);
    // antenna dish and a paw-print flag
    box(root, 0.3, 3, 0.3, '#90a4ae', 15, 1.5, -15);
    const dish = box(root, 2, 0.2, 2, '#eceff1', 15, 3.2, -15);
    dish.rotation.x = 0.5;
    colliders.push({ x: 15, z: -15, r: 0.5 });
    box(root, 0.08, 2, 0.08, '#eeeeee', -14, 1, -12);
    box(root, 1.0, 0.65, 0.04, '#ffffff', -13.45, 1.65, -12);
    box(root, 0.28, 0.24, 0.05, '#8a5cf6', -13.45, 1.58, -12);
    for (const [dx, dy] of [[-0.18, 0.18], [0, 0.24], [0.18, 0.18]]) box(root, 0.09, 0.09, 0.05, '#8a5cf6', -13.45 + dx, 1.58 + dy, -12);
    colliders.push({ x: -14, z: -12, r: 0.2 });
    // the rocket you arrived in
    const rk = pivot(root, 6, 0, 16.5);
    box(rk, 0.9, 2.6, 0.9, '#fafafa', 0, 1.6, 0);
    box(rk, 0.7, 0.6, 0.7, '#e53935', 0, 3.2, 0);
    box(rk, 0.4, 0.4, 0.4, '#e53935', 0, 3.7, 0);
    for (const [x, z] of [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]]) box(rk, Math.abs(x) ? 0.25 : 0.1, 0.8, Math.abs(z) ? 0.25 : 0.1, '#e53935', x, 0.6, z);
    colliders.push({ x: 6, z: 16.5, r: 0.9 });
    // craters: dig spots, one hides a space capsule on every walk
    [[-6, -6], [6, -4.5], [-4, 5], [5, 6], [-15, 0], [15.5, -4], [-14, 14], [14, 13]].forEach(([x, z]) => {
      const s = addSpot(root, spots, colliders, x, z, 'dig', (g) => {
        for (const [dx, dz, w, d] of [[0, -0.6, 1.4, 0.25], [0, 0.6, 1.4, 0.25], [-0.6, 0, 0.25, 1.0], [0.6, 0, 0.25, 1.0]]) box(g, w, 0.18, d, '#9fa0a6', dx, 0.09, dz);
        box(g, 1.0, 0.03, 1.0, '#5f6066', 0, 0.02, 0);
      }, 0);
      const mark = emojiSprite('❌', 0.5);
      mark.position.set(0, 0.5, 0);
      mark.visible = false;
      s.group.add(mark);
      s.mark = mark;
      q.craters.push(s);
    });
    // a rover driving around
    const rover = buildCritter('rover');
    root.add(rover);
    q.rover = { g: rover, t: 0, col: { x: 0, z: 0, r: 0.7 } };
    colliders.push(q.rover.col);
    const vendors = [stall(root, colliders, 'station', 13.9, 5, -Math.PI / 2, { counter: '#eceff1', wall: '#90a4ae', awning: '#3949ab', top: '#ffffff', shirt: '#eceff1', hair: '#5d4037', goods: ['🧑‍🚀', '🛸', '🧀'] })];
    const water = drinkSpot(root, colliders, -2.4, 13.6, 'shower');
    const boulder = (g) => { box(g, 0.8, 0.5, 0.7, '#9e9ea6', 0, 0.25, 0); box(g, 0.5, 0.3, 0.5, '#b0b0b8', 0.1, 0.6, 0); };
    const crate = (g) => { box(g, 0.7, 0.6, 0.7, '#eceff1', 0, 0.3, 0); box(g, 0.72, 0.1, 0.72, '#ff7043', 0, 0.4, 0); };
    [[-12.7, -6], [12.7, -8.5], [-12.7, 8], [12.7, 9.5], [3, 12.7], [-6, -12.7]].forEach(([x, z], i) => addSpot(root, spots, colliders, x, z, 'sniff', i % 2 ? crate : boulder, 0.42));
    boundary(root, { color: '#c0c4cc', post: '#90a4ae', gate: '#90a4ae', sign: '🚀 Home' });
    return { colliders, spots, water, ponds, onPath, loop: L, vendors, q, env: { sky: '#04040c', hemi: 0.55, sun: 1.0, noWeather: true, fogColor: '#04040c' } };
  }

  // a tiled ground texture for big areas
  function floorTex(def, repeat) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    drawPattern(c.getContext('2d'), def, 32);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    return new THREE.MeshLambertMaterial({ map: t });
  }

  function buildLocation(id, root) {
    switch (id) {
      case 'oldtown': return buildOldTown(root);
      case 'forest': return buildForest(root);
      case 'beach': return buildBeach(root);
      case 'alpine': return buildAlpine(root);
      case 'caves': return buildCaves(root);
      case 'snowy': return buildSnowy(root);
      case 'carnival': return buildCarnival(root);
      case 'fairy': return buildFairy(root);
      case 'moon': return buildMoon(root);
      default: return buildPark(root);
    }
  }

  // ===================================================================
  // Sky, daylight and weather effects
  // ===================================================================
  const cA = new THREE.Color(), cB = new THREE.Color(), GREY = new THREE.Color('#9aa4ad');
  // Returns sky color and light levels for an hour (0-24) and a weather type
  function daylight(hour, w) {
    const K = D.DAYLIGHT;
    let i = 0;
    while (i < K.length - 2 && hour >= K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1];
    const t = clamp((hour - a[0]) / (b[0] - a[0] || 1), 0, 1);
    cA.set(a[1]); cB.set(b[1]);
    const sky = cA.clone().lerp(cB, t);
    let hemi = a[2] + (b[2] - a[2]) * t;
    let sunI = a[3] + (b[3] - a[3]) * t;
    const night = clamp((0.8 - hemi) / 0.42, 0, 1);
    const light = w ? w.light : 1;
    sky.lerp(GREY, clamp((1 - light) * 1.6, 0, 0.8) * (1 - night * 0.7));
    hemi *= 0.55 + 0.45 * light;
    sunI *= light;
    return { sky, hemi, sun: sunI, night };
  }

  function createWeatherFX(scene) {
    const N = 700;
    const rainMat = new THREE.MeshBasicMaterial({ color: 0xa9c7e8, transparent: true, opacity: 0.55, depthWrite: false });
    const rain = new THREE.InstancedMesh(geo(0.03, 0.45, 0.03), rainMat, N);
    const snow = new THREE.InstancedMesh(geo(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
    rain.count = 0; snow.count = 0;
    rain.frustumCulled = false; snow.frustumCulled = false;
    scene.add(rain, snow);
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) { px[i] = rand(-14, 14); py[i] = rand(0, 12); pz[i] = rand(-14, 14); ph[i] = rand(0, 6); }
    const m4 = new THREE.Matrix4();
    let flash = 0, nextFlash = 6, t = 0;
    // hidden(x, z) -> true where precipitation should not show (inside the house)
    function update(dt, w, center, hidden) {
      t += dt;
      const kind = w.precip, count = kind ? w.amount : 0;
      const mesh = kind === 'snow' ? snow : rain, other = kind === 'snow' ? rain : snow;
      other.count = 0;
      mesh.count = count;
      if (count) {
        const sp = kind === 'snow' ? 1.4 : 14;
        for (let i = 0; i < count; i++) {
          py[i] -= sp * dt;
          if (py[i] < 0) { py[i] = rand(8, 12); px[i] = rand(-14, 14); pz[i] = rand(-14, 14); }
          const x = center.x + px[i] + (kind === 'snow' ? Math.sin(t + ph[i]) * 0.3 : 0), z = center.z + pz[i];
          m4.makeTranslation(x, hidden(x, z) ? -50 : py[i], z);
          mesh.setMatrixAt(i, m4);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (w.lightning) {
        nextFlash -= dt;
        if (nextFlash <= 0) { flash = 0.18; nextFlash = rand(6, 16); }
      }
      if (flash > 0) { flash -= dt; return 1; }
      return 0;
    }
    return { update };
  }

  return {
    mulberry32, geo, mat, box, pivot, blob, emojiTexture, emojiSprite, textSprite, setSpriteText, M,
    buildItem, buildToy, buildDog, coatOf, portraitURL, buildPlayer, buildAccessory, gardenFloorMaterial, buildHole,
    wallMaterial, floorMaterial, swatchURL, buildPark, daylight, createWeatherFX,
    buildLocation, buildCritter, dirtMaterial,
  };
})();
