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
  };

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
      box(g, 0.76, 0.42, 0.02, M.screen, 0, 0.67, -0.235);
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
      box(g, 0.42, 0.3, 0.42, M.lamp, 0, 1.25, 0);
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
    return { root, body, head, earL, earR, legs, tail, tongue, mouth, collar, patches,
      headBaseY: headY, tailUp, tailDown, wagAxis, earFlap: (S.ears === 'upright' || S.ears === 'pointed') ? 0.25 : 1, scale: S.scale };
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
  function buildPlayer() {
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
    return { colliders, spots, water, pond: POND, onPath, inPond };
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
    buildItem, buildToy, buildDog, coatOf, portraitURL, buildPlayer,
    wallMaterial, floorMaterial, swatchURL, buildPark, daylight, createWeatherFX,
  };
})();
