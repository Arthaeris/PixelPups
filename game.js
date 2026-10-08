'use strict';
/* Voxel Paws — game logic and UI. Needs three.js, data.js and art.js (loaded in index.html). */
(function () {
  const D = window.VP_DATA;
  const ART = window.VP_ART;
  const CONFIG = D.CONFIG;
  const { CHUNK, LOW, CRITICAL } = CONFIG;
  const { geo, mat, box, pivot, emojiTexture, emojiSprite, textSprite, setSpriteText } = ART;

  // =====================================================================
  // Utilities
  // =====================================================================
  const TAU = Math.PI * 2;
  const DAY = 86400000;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const damp = (k, dt) => 1 - Math.pow(k, dt);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function angleLerp(a, b, t) {
    const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    return a + d * t;
  }
  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtDuration(ms) {
    const h = Math.max(0, Math.ceil(ms / 3600000));
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const newId = () => 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const standardCoats = (b) => (D.BREEDS[b] || D.BREEDS.retriever).coats.filter((c) => !c.legacy);
  const expandPrice = (n) => Math.round((CONFIG.EXPAND_BASE * Math.pow(CONFIG.EXPAND_GROWTH, n - 1)) / 5) * 5;
  const traitList = () => Object.keys(D.TRAITS);
  function randomTraits(primary) {
    const p = primary && D.TRAITS[primary] ? primary : pick(traitList());
    return [p, pick(traitList().filter((t) => t !== p))];
  }

  // =====================================================================
  // Renderer, scene, camera, lights
  // =====================================================================
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const world = new THREE.Scene();
  world.background = new THREE.Color(0xcfe6f2);
  const fog = new THREE.Fog(0xcfe6f2, 24, 50);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb9a88a, 0.85);
  world.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.55);
  sunLight.position.set(6, 12, 8);
  world.add(sunLight);

  const homeRoot = pivot(world);
  const roomGroup = pivot(homeRoot);
  const gridGroup = pivot(homeRoot);
  const furnGroup = pivot(homeRoot);
  const siteGroup = pivot(homeRoot);
  const candGroup = pivot(homeRoot);
  const parkRoot = pivot(world);
  parkRoot.visible = false;
  gridGroup.visible = false;
  box(homeRoot, 260, 0.1, 260, '#a3d18b', 0, -0.17, 0);
  const weatherFX = ART.createWeatherFX(world);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    placeToast();
  });

  // =====================================================================
  // State
  // =====================================================================
  const freeStyles = () => [
    ...Object.keys(D.WALLS).filter((k) => !D.WALLS[k].price),
    ...Object.keys(D.FLOORS).filter((k) => !D.FLOORS[k].price),
  ];
  function defaultState() {
    return {
      v: CONFIG.SAVE_VERSION,
      coins: 20,
      chunks: [[0, 0]],
      build: null,
      rooms: {},
      styles: freeStyles(),
      furniture: [
        { type: 'bed', i: 0, j: 3, rot: 1 },
        { type: 'bowl', i: 3, j: 0, rot: 0, filled: true },
        { type: 'water', i: 2, j: 0, rot: 0, filled: true },
        { type: 'rug', i: 3, j: 3, rot: 0 },
      ],
      inventory: { plant: 1 },
      toys: ['tennis'],
      toy: 'tennis',
      litter: null,
      dogs: [],
      stats: { walks: 0 },
    };
  }
  let state = defaultState();

  let place = 'home';      // 'home' | 'park'
  let mode = 'normal';     // 'normal' | 'decorate' | 'build'
  const dogs = [];
  let selected = null;
  let selectedInv = null;
  let decoTab = 'furn';
  let selStyle = null;     // { kind: 'wall'|'floor', id }
  let placeRot = 0;
  let walkDist = 0;
  let walkEarn = 0;
  let tiredWarned = false;
  let zoom = 1;
  let animT = 0;
  let camFocus = null;
  let towelTask = null;
  let noSave = false;

  // =====================================================================
  // Time & weather (always German time)
  // =====================================================================
  const berlinFmt = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    } catch (_) { return null; }
  })();
  let timeOverride = null, weatherOverride = null;
  function berlinNow() {
    let p = {};
    if (berlinFmt) {
      for (const x of berlinFmt.formatToParts(new Date())) p[x.type] = x.value;
    } else {
      const d = new Date(), pad = (n) => String(n).padStart(2, '0');
      p = { year: d.getFullYear(), month: pad(d.getMonth() + 1), day: pad(d.getDate()), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
    }
    let hour = (+p.hour % 24) + +p.minute / 60 + +p.second / 3600;
    if (timeOverride !== null) hour = timeOverride;
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    return { dateKey: `${p.year}-${p.month}-${p.day}`, month: +p.month, hour, hm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
  }
  function weatherFor(now) {
    if (weatherOverride && D.WEATHER[weatherOverride]) return weatherOverride;
    const m = now.month;
    const season = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
    const odds = D.WEATHER_ODDS[season];
    let x = ART.mulberry32(hashStr(now.dateKey + '#' + Math.floor(now.hour / 3)))() * Object.values(odds).reduce((a, b) => a + b, 0);
    for (const [k, v] of Object.entries(odds)) { x -= v; if (x <= 0) return k; }
    return 'sun';
  }
  let clockNow = berlinNow();
  let weatherId = weatherFor(clockNow);
  const curWeather = () => D.WEATHER[weatherId] || D.WEATHER.sun;
  let lightning = 0;
  let nightLevel = 0;
  const dayWindow = new THREE.Color('#a9d8f5'), nightWindow = new THREE.Color('#2a3a6b');

  function tickClock() {
    clockNow = berlinNow();
    const w = weatherFor(clockNow);
    if (w !== weatherId) {
      weatherId = w;
      const W = curWeather();
      toast(`The weather changed: ${W.icon} ${W.name}${W.muddy ? ' — walks get muddy' : ''}`);
      if (W.lightning) dogs.forEach((d) => { if (d.flag('stormFear') && (d.state === 'idle' || d.state === 'sit')) d.timer = 0; });
    }
  }
  function applyEnvironment() {
    const W = curWeather();
    const L = ART.daylight(clockNow.hour, W);
    nightLevel = L.night;
    world.background.copy(L.sky);
    if (lightning) world.background.lerp(new THREE.Color('#ffffff'), 0.5);
    hemiLight.intensity = L.hemi + lightning * 0.8;
    sunLight.intensity = L.sun + lightning * 1.2;
    ART.M.lamp.emissiveIntensity = 0.65 + L.night * 0.9;
    ART.M.window.color.copy(dayWindow).lerp(nightWindow, L.night);
    if (place === 'park') {
      fog.color.copy(L.sky);
      fog.near = W.fog ? 4 : 24;
      fog.far = W.fog ? 20 : 50;
      world.fog = fog;
    } else if (W.fog) {
      fog.color.copy(L.sky);
      fog.near = 10;
      fog.far = 32;
      world.fog = fog;
    } else {
      world.fog = null;
    }
  }

  // =====================================================================
  // Home: sections, walls, floors, furniture
  // =====================================================================
  const chunkKey = (cx, cz) => cx + ',' + cz;
  let chunkSet = new Set();
  let homeBounds = { x0: 0, x1: CHUNK, z0: 0, z1: CHUNK };
  function extentOf(list) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [cx, cz] of list) {
      x0 = Math.min(x0, cx * CHUNK); x1 = Math.max(x1, (cx + 1) * CHUNK);
      z0 = Math.min(z0, cz * CHUNK); z1 = Math.max(z1, (cz + 1) * CHUNK);
    }
    return { x0, x1, z0, z1 };
  }
  function syncChunkSet() {
    chunkSet = new Set(state.chunks.map(([x, z]) => chunkKey(x, z)));
    homeBounds = extentOf(state.chunks);
  }
  const hasChunk = (cx, cz) => chunkSet.has(chunkKey(cx, cz));
  const isHomeTile = (i, j) => hasChunk(Math.floor(i / CHUNK), Math.floor(j / CHUNK));
  const roomStyle = (cx, cz) => Object.assign({}, D.DEFAULT_ROOM, state.rooms[chunkKey(cx, cz)]);
  const ARTS = ['#f6a5c0', '#9ad0a7', '#ffd27a', '#a7b8f5'];

  function buildRoom() {
    roomGroup.clear();
    gridGroup.clear();
    const C = CHUNK, h = C / 2;
    state.chunks.forEach(([cx, cz], n) => {
      const x0 = cx * C, z0 = cz * C;
      const st = roomStyle(cx, cz);
      const W = D.WALLS[st.wall] || D.WALLS.cream;
      const floor = new THREE.Mesh(geo(C, 0.12, C), ART.floorMaterial(st.floor));
      floor.position.set(x0 + h, -0.06, z0 + h);
      roomGroup.add(floor);

      const grid = new THREE.GridHelper(C, C, 0x7a5a3a, 0x7a5a3a);
      grid.material.transparent = true;
      grid.material.opacity = 0.35;
      grid.position.set(x0 + h, 0.012, z0 + h);
      gridGroup.add(grid);

      const westOpen = hasChunk(cx - 1, cz);
      if (!hasChunk(cx, cz - 1)) {
        const xs = westOpen ? x0 : x0 - 0.2, len = x0 + C - xs, mid = xs + len / 2;
        box(roomGroup, len, 2.4, 0.2, ART.wallMaterial(st.wall, len), mid, 1.2, z0 - 0.1);
        box(roomGroup, len, 0.16, 0.26, W.trim, mid, 0.08, z0 - 0.1);
        box(roomGroup, len + 0.04, 0.1, 0.26, W.trim, mid, 2.43, z0 - 0.1);
        box(roomGroup, 1.2, 0.95, 0.06, '#ffffff', x0 + h, 1.45, z0 + 0.02);
        box(roomGroup, 1.02, 0.77, 0.07, ART.M.window, x0 + h, 1.45, z0 + 0.03);
        box(roomGroup, 0.06, 0.77, 0.08, '#ffffff', x0 + h, 1.45, z0 + 0.035);
        box(roomGroup, 1.02, 0.06, 0.08, '#ffffff', x0 + h, 1.45, z0 + 0.035);
      }
      if (!westOpen) {
        box(roomGroup, 0.2, 2.4, C, ART.wallMaterial(st.wall, C), x0 - 0.1, 1.2, z0 + h);
        box(roomGroup, 0.26, 0.16, C, W.trim, x0 - 0.1, 0.08, z0 + h);
        box(roomGroup, 0.26, 0.1, C, W.trim, x0 - 0.1, 2.43, z0 + h);
        box(roomGroup, 0.06, 0.66, 0.86, '#8a5a3b', x0 + 0.03, 1.5, z0 + h);
        box(roomGroup, 0.07, 0.5, 0.7, ARTS[(n + cx + cz + 8) % ARTS.length], x0 + 0.035, 1.5, z0 + h);
        box(roomGroup, 0.08, 0.16, 0.16, '#ffffff', x0 + 0.04, 1.58, z0 + h + 0.15);
      }
      if (!hasChunk(cx, cz + 1)) box(roomGroup, C, 0.14, 0.08, W.trim, x0 + h, -0.06, z0 + C + 0.04);
      if (!hasChunk(cx + 1, cz)) box(roomGroup, 0.08, 0.14, C + 0.08, W.trim, x0 + C + 0.04, -0.06, z0 + h + 0.04);
    });
  }

  const furnRT = new Map();
  let furnMap = new Map();
  function rebuildFurniture() {
    furnGroup.clear();
    furnRT.clear();
    furnMap = new Map();
    for (const f of state.furniture) {
      const g = ART.buildItem(f.type);
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
  const roleOf = (f) => D.ITEMS[f.type] && D.ITEMS[f.type].role;

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
  const PARK = ART.buildPark(parkRoot);
  const parkColliders = PARK.colliders;
  const sniffSpots = PARK.spots;
  const parkWater = PARK.water;
  const POND = PARK.pond;
  const inPond = PARK.inPond;
  const onPath = PARK.onPath;

  let parkLoot = null;
  function rollToy() {
    const list = Object.entries(D.TOYS);
    let r = Math.random() * list.reduce((s, [, t]) => s + t.weight, 0);
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
      const toy = ART.buildToy(type);
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
      const type = parkLoot.type, pos = g.clone();
      clearParkLoot();
      grantToy(type, pos);
    }
  }
  function grantToy(type, pos) {
    const t = D.TOYS[type];
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
  // Collision + pathfinding
  // =====================================================================
  function isSolid(x, z) {
    if (place === 'home') {
      const i = Math.floor(x), j = Math.floor(z);
      if (!isHomeTile(i, j)) return true;
      const f = furnitureAt(i, j);
      return !!(f && D.ITEMS[f.type].solid);
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
    return !(f && D.ITEMS[f.type].solid);
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
  const freeNear = (x, z) => (isSolid(x, z) ? randomFreePoint() : new V3(x, 0, z));
  // a free tile next to a piece of furniture, preferring the side it faces
  function frontOf(f) {
    const r = f.rot || 0;
    const order = [[[0, 1], [1, 0], [0, -1], [-1, 0]][r]].concat([[0, 1], [1, 0], [-1, 0], [0, -1]]);
    for (const [di, dj] of order) if (passable(f.i + di, f.j + dj)) return new V3(f.i + di + 0.5, 0, f.j + dj + 0.5);
    return null;
  }

  // =====================================================================
  // Particles & small effects
  // =====================================================================
  const particles = [];
  function spawnEmoji(e, pos, opts = {}) {
    const s = emojiSprite(e, opts.size || 0.45);
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
  function confetti(pos, n = 6) {
    for (let k = 0; k < n; k++) setTimeout(() => spawnEmoji(pick(['🎉', '✨', '🎊']), pos.clone().add(new V3(rand(-1, 1), rand(0, 0.6), rand(-1, 1))), { size: 0.55, life: 1.5 }), k * 110);
  }

  const ringGeo = (a, b) => new THREE.RingGeometry(a, b, 28);
  const tapRing = new THREE.Mesh(ringGeo(0.18, 0.27), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  tapRing.rotation.x = -Math.PI / 2;
  world.add(tapRing);
  let tapT = 0;
  const selRing = new THREE.Mesh(ringGeo(0.52, 0.6), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthWrite: false }));
  selRing.rotation.x = -Math.PI / 2;
  world.add(selRing);
  const hlRing = new THREE.Mesh(ringGeo(0.38, 0.5), new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, depthWrite: false }));
  hlRing.rotation.x = -Math.PI / 2;
  world.add(hlRing);
  let hlT = 0;
  function highlight(pos) {
    hlRing.position.set(pos.x, 0.07, pos.z);
    hlT = 3.5;
  }

  function addCoins(n, pos) {
    state.coins += n;
    if (place === 'park') walkEarn += n;
    if (pos) spawnEmoji('🪙', pos.clone().add(new V3(0, 1.2, 0)), { size: 0.45, vy: 1.1 });
    updateHud();
  }

  // =====================================================================
  // Player
  // =====================================================================
  const player = Object.assign(ART.buildPlayer(), { moveTarget: null, phase: 0, blend: 0, face: 0, throwT: 0 });
  world.add(player.root);

  const keys = {};
  window.addEventListener('keydown', (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) keys[e.key.toLowerCase()] = true; });
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
      if (towelTask) towelTask = null;
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
      moveWithCollision(pos, mx * 3.3 * mag * dt, mz * 3.3 * mag * dt, 0.25);
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
  const BUBBLE_ICON = { hunger: '🍖', thirst: '💧', energy: '😴', happy: '💔', clean: '🧼' };
  const RESTING = ['idle', 'sit', 'sleep', 'lounge'];

  class Dog {
    constructor(data) {
      this.id = data.id || newId();
      this.name = data.name || 'Pup';
      this.breed = D.BREEDS[data.breed] ? data.breed : 'retriever';
      this.coat = ART.coatOf(this.breed, data.coat).id;
      this.traits = Array.isArray(data.traits) && data.traits.every((t) => D.TRAITS[t]) && data.traits.length === 2 ? data.traits.slice() : randomTraits();
      this.revealed = !!data.revealed;
      this.bond = data.bond || 0;
      this.born = data.born || Date.now();
      this.grown = !!data.grown;
      this.hunger = data.hunger ?? 85;
      this.thirst = data.thirst ?? 85;
      this.energy = data.energy ?? 85;
      this.happy = data.happy ?? 75;
      this.clean = data.clean ?? 90;
      this.dirt = Object.assign({ mud: 0, grass: 0 }, data.dirt);
      this.favToy = D.TOYS[data.favToy] ? data.favToy : null;
      this.favLast = data.favLast || 0;
      this.othersSince = data.othersSince || 0;
      this.toyPlays = Object.assign({}, data.toyPlays);
      this.recentPlays = Object.assign({}, data.recentPlays);
      this.lastToys = Array.isArray(data.lastToys) ? data.lastToys.slice(-3) : [];
      this.rest = Object.assign({}, data.rest);
      this.favSpot = data.favSpot || null;

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
      this.tumbleT = 0;
      this.zoomLeft = 0;
      this.restTimer = 0;
      this.ui = null;
      this.build();
    }

    build() {
      Object.assign(this, ART.buildDog(this.breed, this.coat));
      const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      bubble.scale.set(0.42, 0.42, 1);
      bubble.position.y = this.headBaseY + 0.6;
      bubble.visible = false;
      this.root.add(bubble);
      this.bubble = bubble;
      this.root.userData.dog = this;
      this.leash = new THREE.Group();
      this.leashSegs = [];
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(geo(0.035, 0.035, 1), mat('#c0392b'));
        this.leash.add(s);
        this.leashSegs.push(s);
      }
      this.leash.visible = false;
      world.add(this.leash);
      this.applyGrowth();
      this.updateDirtLook();
    }

    serialize() {
      const r = (v) => Math.round(v * 10) / 10;
      return {
        id: this.id, name: this.name, breed: this.breed, coat: this.coat, traits: this.traits, revealed: this.revealed, bond: this.bond,
        born: this.born, grown: this.grown,
        hunger: r(this.hunger), thirst: r(this.thirst), energy: r(this.energy), happy: r(this.happy), clean: r(this.clean),
        dirt: { mud: r(this.dirt.mud), grass: r(this.dirt.grass) },
        favToy: this.favToy, favLast: this.favLast, othersSince: this.othersSince, toyPlays: this.toyPlays, recentPlays: this.recentPlays,
        lastToys: this.lastToys, rest: this.rest, favSpot: this.favSpot,
      };
    }

    // ----- personality -----
    mod(key) {
      let m = 1;
      this.traits.forEach((t, i) => {
        const v = D.TRAITS[t] && D.TRAITS[t].mods[key];
        if (v !== undefined) m *= i === 0 ? v : 1 + (v - 1) * 0.5;
      });
      return m;
    }
    flag(f) { return this.traits.some((t) => D.TRAITS[t] && D.TRAITS[t].flags.includes(f)); }
    addBond(n) {
      this.bond += n;
      if (!this.revealed && this.bond >= CONFIG.BOND_REVEAL) {
        this.revealed = true;
        const T = D.TRAITS[this.traits[1]];
        toast(`You know ${this.name} better now — they're also ${T.icon} ${T.name}!`);
        if (this.ui) refreshCardStatic(this);
      }
    }

    // ----- growing up -----
    growth() { return clamp((Date.now() - this.born) / (CONFIG.PUPPY_DAYS * DAY), 0, 1); }
    isPuppy() { return this.growth() < 1; }
    applyGrowth() {
      const g = this.growth();
      this.root.scale.setScalar(this.scale * lerp(CONFIG.PUPPY_START_SCALE, 1, g));
      this.head.scale.setScalar(lerp(1.35, 1, g));
      if (!this.grown && g >= 1) {
        this.grown = true;
        if (this.ui) {
          toast(`🎉 ${this.name} is all grown up!`);
          confetti(this.root.position.clone().add(new V3(0, 1, 0)));
          refreshCardStatic(this);
          save();
        }
      }
    }

    // ----- favorites -----
    missing() {
      return !!this.favToy && (Date.now() - this.favLast > CONFIG.FAV_MISS_DAYS * DAY || this.othersSince >= CONFIG.FAV_MISS_THROWS);
    }
    checkFavSwitch() {
      if (!this.favToy) return;
      if (Date.now() - this.favLast < CONFIG.FAV_SWITCH_DAYS * DAY && this.othersSince < CONFIG.FAV_SWITCH_THROWS) return;
      let best = null, bc = 0;
      for (const [k, c] of Object.entries(this.recentPlays)) if (k !== this.favToy && c > bc && state.toys.includes(k)) { best = k; bc = c; }
      if (!best) return;
      this.favToy = best;
      this.favLast = Date.now();
      this.othersSince = 0;
      this.recentPlays = {};
      this.happy = Math.min(100, this.happy + 10);
      toast(`${this.name} found a new favorite: ${D.TOYS[best].icon} ${D.TOYS[best].name}!`);
      if (this.ui) refreshCardStatic(this);
    }
    playedWith(type) {
      const def = D.TOYS[type] || D.TOYS.tennis;
      const first = !this.toyPlays[type];
      this.toyPlays[type] = (this.toyPlays[type] || 0) + 1;
      this.recentPlays[type] = (this.recentPlays[type] || 0) + 1;
      let joy = def.happy || 15;
      if (this.flag('bored')) {
        if (this.lastToys.length >= 3 && this.lastToys.slice(-3).every((t) => t === type)) {
          joy *= 0.4;
          if (Math.random() < 0.5) toast(`${this.name} is getting bored of the ${def.name} 🥱`);
        }
        if (first) joy += 10;
      }
      this.lastToys = this.lastToys.concat(type).slice(-3);
      if (!this.favToy) {
        if (this.toyPlays[type] >= CONFIG.FAV_TOY_PLAYS) {
          this.favToy = type;
          this.favLast = Date.now();
          this.othersSince = 0;
          this.recentPlays = {};
          toast(`${def.icon} The ${def.name} is ${this.name}'s favorite toy now!`);
          if (this.ui) refreshCardStatic(this);
        }
      } else if (type === this.favToy) {
        if (this.missing()) {
          joy += 20;
          toast(`${this.name} is so happy to play with the ${def.name} again! 💞`);
        }
        joy += 8;
        this.favLast = Date.now();
        this.othersSince = 0;
      } else {
        this.othersSince++;
      }
      this.checkFavSwitch();
      return joy;
    }
    trackRest(dt) {
      if (place !== 'home' || !RESTING.includes(this.state)) return;
      const k = Math.floor(this.root.position.x) + ',' + Math.floor(this.root.position.z);
      this.rest[k] = (this.rest[k] || 0) + dt;
      this.restTimer += dt;
      if (this.restTimer < 20) return;
      this.restTimer = 0;
      const entries = Object.entries(this.rest).sort((a, b) => b[1] - a[1]);
      if (entries.length > 24) this.rest = Object.fromEntries(entries.slice(0, 24));
      const [bestK, bestV] = entries[0] || [];
      if (bestK && bestV > 90 && bestK !== this.favSpot) {
        const had = this.favSpot;
        this.favSpot = bestK;
        if (!had) toast(`${this.name} picked a favorite spot to relax 🐾`);
        if (this.ui) refreshCardStatic(this);
      }
    }
    favSpotTarget() {
      if (!this.favSpot) return null;
      const [i, j] = this.favSpot.split(',').map(Number);
      return passable(i, j) ? new V3(i + 0.5, 0, j + 0.5) : null;
    }

    // ----- helpers -----
    headWorld(up = 0) { return this.head.getWorldPosition(new V3()).add(new V3(0, up, 0)); }
    faceTo(p) { this.face = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z); }
    setState(s, timer = 0) { this.state = s; this.timer = timer; this.stateTime = 0; }
    idle(t) {
      if (place === 'park') this.setState('follow');
      else this.setState('idle', t ?? rand(1.5, 4));
    }
    goTo(target, speed, onArrive, arriveDist = 0.2) {
      this.setState('move');
      this.target = target;
      this.moveSpeed = speed * (this.isPuppy() ? 0.85 : 1);
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
      this.zoomLeft = 0;
      this.idle(0.5);
    }
    wake() {
      this.releaseClaim();
      this.root.position.y = 0;
      this.idle(0.5);
    }

    // ----- needs -----
    tickNeeds(dt) {
      const W = curWeather();
      const pup = this.isPuppy();
      if (place === 'park') {
        const R = D.NEEDS.park;
        this.hunger -= R.hunger * this.mod('hunger') * dt;
        this.thirst -= R.thirst * dt;
        this.energy -= R.energy * this.mod('energy') * this.mod('walkEnergy') * (pup ? 1.3 : 1) * dt;
        const rate = R.clean * this.mod('dirt') * (W.muddy ? D.NEEDS.rainDirt : 1) * (W.precip === 'snow' ? 1.3 : 1) * dt;
        this.clean -= rate;
        this.dirt[W.muddy ? 'mud' : 'grass'] += rate;
        let joy = this.energy > CRITICAL ? R.happyGain * this.mod('walkJoy') : 0;
        if (W.precip === 'rain' && this.flag('rainJoy')) joy += 0.15;
        if (W.lightning && this.flag('stormFear')) joy -= 0.25;
        this.happy += joy * dt;
      } else {
        const R = D.NEEDS.home;
        this.hunger -= R.hunger * this.mod('hunger') * dt;
        this.thirst -= R.thirst * dt;
        if (this.state === 'sleep') this.energy += R.sleepRegen * dt;
        else if (this.state === 'lounge' || this.state === 'hide') this.energy += R.loungeRegen * dt;
        else this.energy -= R.energy * this.mod('energy') * (pup ? 1.4 : 1) * dt;
        this.clean -= R.clean * dt;
        const needy = this.hunger < LOW || this.thirst < LOW || this.energy < CRITICAL;
        let decay = needy ? R.needyDecay : R.happyDecay;
        if (this.clean < 50) decay += 0.04 * this.mod('dirtMood');
        if (this.flag('lonely')) decay += dogs.length === 1 ? 0.05 : -0.04;
        if (this.state === 'hide') decay += 0.05;
        if (this.state === 'lounge') decay -= 0.05;
        if (W.precip === 'rain' && this.flag('rainJoy')) decay -= 0.03;
        this.happy -= decay * dt;
      }
      this.hunger = clamp(this.hunger, 0, 100);
      this.thirst = clamp(this.thirst, 0, 100);
      this.energy = clamp(this.energy, 0, 100);
      this.clean = clamp(this.clean, 0, 100);
      this.happy = clamp(this.happy, 0, this.missing() ? CONFIG.MISS_CAP : 100);
    }
    updateDirtLook() {
      const n = this.clean < 50 ? Math.ceil(((50 - this.clean) / 50) * this.patches.length) : 0;
      const m = this.dirt.mud >= this.dirt.grass ? ART.M.mud : ART.M.grass;
      this.patches.forEach((p, i) => { p.visible = i < n; p.material = m; });
    }

    statusText() {
      switch (this.state) {
        case 'sleep': return 'Sleeping 💤';
        case 'eat': return 'Eating 😋';
        case 'drink': return 'Drinking 💧';
        case 'fetch': case 'return': return 'Playing fetch ' + (D.TOYS[ball.type] ? D.TOYS[ball.type].icon : '');
        case 'sniff': return 'Sniffing around 👃';
        case 'dig': return 'Digging ⛏️';
        case 'splash': return 'Splashing 💦';
        case 'happy': return 'So happy! 💕';
        case 'lounge': return 'Lounging 😌';
        case 'hide': return 'Scared of the storm ⛈️';
        case 'zoom': return 'Zoomies! 🌀';
        case 'towel': return 'Getting toweled off 🫧';
        case 'wait': return 'Waiting for you';
      }
      if (this.zoomLeft > 0) return 'Zoomies! 🌀';
      const needs = [['hunger', 'Hungry'], ['thirst', 'Thirsty'], ['energy', 'Tired'], ['clean', 'Dirty'], ['happy', 'Wants attention']]
        .filter(([k]) => this[k] < 30).sort((a, b) => this[a[0]] - this[b[0]]);
      if (needs.length) return needs[0][1];
      if (this.missing()) return `Misses its ${D.TOYS[this.favToy].icon}`;
      if (this.flag('lonely') && dogs.length === 1 && place === 'home') return 'A bit lonely';
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
      if (this.tumbleT > 0) {
        this.tumbleT -= dt;
      } else {
        this.updateState(dt);
        if (this.moving && this.isPuppy() && Math.random() < dt * 0.06 && this.state !== 'return') {
          this.tumbleT = 0.7;
          spawnEmoji('💫', this.headWorld(0.3), { size: 0.35, life: 0.9 });
        }
      }
      if (place === 'park') this.applyLeash();
      this.trackRest(dt);
      this.root.rotation.y = angleLerp(this.root.rotation.y, this.face, damp(0.0004, dt));
      this.animate(dt);
      this.updateBubble();
    }

    updateState(dt) {
      switch (this.state) {
        case 'idle':
          this.timer -= dt;
          if (this.timer <= 0) this.decide();
          else if (player.root.position.distanceTo(this.root.position) < 3) this.faceTo(player.root.position);
          break;
        case 'follow': this.updateFollow(dt); break;
        case 'move': this.updateMove(dt); break;
        case 'sit':
        case 'lounge':
          this.timer -= dt;
          if (this.timer <= 0) this.idle();
          break;
        case 'hide':
          if (!curWeather().lightning || place !== 'home') this.idle(0.5);
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
        case 'dig':
          this.timer -= dt;
          if (Math.random() < dt * 6) spawnEmoji('🟫', this.headWorld(-0.4), { size: 0.18, life: 0.5, vy: 1.2 });
          if (this.timer <= 0) this.finishDig();
          break;
        case 'splash':
          this.timer -= dt;
          if (Math.random() < dt * 4) spawnEmoji('💦', this.headWorld(0), { size: 0.3, life: 0.7 });
          if (this.timer <= 0) this.finishSplash();
          break;
        case 'zoom': this.updateZoom(dt); break;
        case 'happy':
          this.timer -= dt;
          if (this.timer <= 0) this.idle();
          break;
        case 'wait':
          this.timer -= dt;
          this.faceTo(player.root.position);
          if (this.timer <= 0) { if (towelTask && towelTask.dog === this) towelTask = null; this.idle(); }
          break;
        case 'towel':
          this.timer -= dt;
          if (Math.random() < dt * 5) spawnEmoji('🫧', this.headWorld(-0.1), { size: 0.3, life: 0.8 });
          if (this.timer <= 0) this.finishTowel();
          break;
        case 'fetch': this.updateFetch(dt); break;
        case 'return': this.updateReturn(dt); break;
        default: this.idle();
      }
    }

    decide() {
      if (place === 'park') { this.setState('follow'); return; }
      const W = curWeather();
      if (W.lightning && this.flag('stormFear')) {
        const bed = findFurniture('bed', this, false, this.root.position);
        const spot = bed ? tileCenter(bed) : randomFreePoint();
        if (bed) this.claimItem(bed);
        this.goTo(spot, 2.6, () => { this.setState('hide'); }, 0.3);
        return;
      }
      const tiredAt = this.isPuppy() ? 45 : 25;
      if (this.energy < tiredAt) {
        const bed = findFurniture('bed', this, false, this.root.position);
        if (bed) {
          this.claimItem(bed);
          this.goTo(tileCenter(bed), 1.8, () => {
            const c = tileCenter(bed);
            this.root.position.set(c.x, D.ITEMS[bed.type].sleepY || 0.1, c.z);
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
      if (this.flag('lounges') && this.energy < 90 && r < 0.35) {
        const spot = loungeSpot(this);
        if (spot) { this.goTo(spot, 1.6, () => this.setState('lounge', rand(8, 14)), 0.25); return; }
      }
      if (this.flag('zooms') && this.energy > 40 && r < 0.18) {
        this.zoomLeft = 3;
        this.energy -= 3;
        this.nextZoom();
        return;
      }
      if (r < 0.15) {
        const fav = this.favSpotTarget();
        if (fav) { this.goTo(fav, 1.5, () => this.setState(Math.random() < 0.5 ? 'sit' : 'lounge', rand(5, 9)), 0.25); return; }
      }
      const q = Math.random();
      if (q < 0.4) this.goTo(randomFreePoint(), 1.4, null, 0.2);
      else if (q < 0.6) this.goTo(() => player.root.position, 2.4, () => { this.faceTo(player.root.position); this.idle(rand(2, 4)); }, 1.2);
      else if (q < 0.8) this.setState('sit', rand(3, 6));
      else this.idle(rand(2, 4));
    }
    nextZoom() {
      if (this.zoomLeft <= 0) { this.idle(); return; }
      this.zoomLeft--;
      this.goTo(randomFreePoint(), 4.6, () => this.nextZoom(), 0.4);
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
          this.zoomLeft = 0;
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
      if (d > 0.35) this.moveTowards(tx, tz, (d > 2.2 ? 4.2 : 2.4) * tired * (this.isPuppy() ? 0.9 : 1), dt);
      this.sniffCheck -= dt;
      if (this.sniffCheck > 0) return;
      this.sniffCheck = rand(1, 2.5);
      const wb = parkWater.bowl;
      if (this.thirst < 65 && !parkWater.taken && pos.distanceTo(wb) < 6 && pp.distanceTo(wb) < 5) {
        parkWater.taken = this;
        this.spot = parkWater;
        this.goTo(wb, 3, () => { this.spot = parkWater; this.faceTo(wb); this.setState('drink', 2.4); }, 0.45);
        return;
      }
      if (this.flag('splashes') && Math.random() < 0.4) {
        const edge = pondEdge(pos);
        if (edge && edge.distanceTo(pos) < 4 && edge.distanceTo(pp) < 3) {
          this.goTo(edge, 3.2, () => { this.faceTo(new V3((POND.x0 + POND.x1) / 2, 0, (POND.z0 + POND.z1) / 2)); this.setState('splash', 1.8); }, 0.5);
          return;
        }
      }
      if (this.flag('digs') && Math.random() < 0.18 && !onPath(pos.x, pos.z) && !inPond(pos.x, pos.z, 1)) {
        this.setState('dig', 2);
        return;
      }
      if (this.flag('zooms') && this.energy > 30 && Math.random() < 0.1) {
        this.zoomAngle = Math.atan2(pos.x - pp.x, pos.z - pp.z);
        this.setState('zoom', 3);
        return;
      }
      const spot = nearestSpot(pos, 4.5);
      if (spot && Math.random() < 0.6) {
        spot.taken = this;
        this.spot = spot;
        this.goTo(spot.pos, 3, () => { this.spot = spot; this.faceTo(spot.pos); this.setState('sniff', 2.2); }, 0.65);
      }
    }
    updateZoom(dt) {
      this.timer -= dt;
      if (place === 'park') {
        const pp = player.root.position;
        this.zoomAngle += dt * 2.6;
        this.moveTowards(pp.x + Math.sin(this.zoomAngle) * 2.2, pp.z + Math.cos(this.zoomAngle) * 2.2, 5, dt);
      }
      if (this.timer <= 0) { this.energy -= 2; this.idle(); }
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
        if (this.state !== 'follow' && this.state !== 'zoom' && d > L + 0.3) {
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
        this.happy = Math.min(100, this.happy + 5 * (roleOf(bowl) === 'food' ? this.mod('mealJoy') : 1));
        this.addBond(1);
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
          addCoins(Math.round(2 * this.mod('sniffCoins')), this.root.position);
          spawnEmoji('✨', this.headWorld(0.3), { size: 0.4 });
        }
      }
      this.dropSpot();
      this.setState('follow');
    }
    finishDig() {
      const r = Math.random();
      const muddy = curWeather().muddy;
      this.clean -= 5;
      this.dirt[muddy ? 'mud' : 'grass'] += 5;
      this.happy = Math.min(100, this.happy + 6);
      if (r < 0.04) grantToy(rollToy(), this.root.position);
      else if (r < 0.34) { addCoins(1 + Math.floor(Math.random() * 2), this.root.position); }
      else spawnEmoji('🕳️', this.headWorld(-0.2), { size: 0.35, life: 0.9 });
      this.setState('follow');
    }
    finishSplash() {
      this.happy = Math.min(100, this.happy + 8);
      this.clean -= 4;
      this.dirt.mud += 4;
      this.setState('follow');
    }
    finishTowel() {
      const before = this.clean;
      this.clean = Math.max(this.clean, Math.min(CONFIG.TOWEL_MAX, this.clean + CONFIG.TOWEL_AMOUNT));
      const keep = before < 100 ? (100 - this.clean) / Math.max(1, 100 - before) : 1;
      this.dirt.mud *= keep;
      this.dirt.grass *= keep;
      this.happy = Math.min(100, this.happy + 6 * this.mod('cleanJoy'));
      this.addBond(1);
      this.updateDirtLook();
      spawnEmoji('✨', this.headWorld(0.3), { size: 0.4 });
      this.idle();
    }

    startFetch() {
      this.releaseClaim();
      this.dropSpot();
      this.root.position.y = 0;
      this.onArrive = null;
      this.path = null;
      this.zoomLeft = 0;
      this.setState('fetch');
    }
    updateFetch(dt) {
      if (!ball.active || (ball.held && ball.held !== this)) { this.idle(); return; }
      const bp = ball.flying ? ball.to : ball.mesh.position;
      const sp = 4.3 * this.mod('fetchSpeed') * (this.energy < CRITICAL ? 0.6 : 1) * (this.isPuppy() ? 0.85 : 1);
      const d = this.moveTowards(bp.x, bp.z, sp, dt);
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
        const type = ball.type;
        const def = D.TOYS[type] || D.TOYS.tennis;
        resetBall();
        this.path = null;
        const joy = this.playedWith(type);
        this.happy = Math.min(this.missing() ? CONFIG.MISS_CAP : 100, this.happy + joy);
        this.energy = Math.max(0, this.energy - 4);
        this.addBond(1);
        this.faceTo(pp);
        spawnEmoji(type === this.favToy ? '💞' : '❤️', this.headWorld(0.4), { size: 0.4 });
        const bonus = (place === 'park' ? 1 : 0) + (def.coins || 0);
        if (bonus) addCoins(bonus, this.root.position);
        this.setState('happy', 1.4);
      }
    }

    pet() {
      this.happy = Math.min(this.missing() ? CONFIG.MISS_CAP : 100, this.happy + 12 * this.mod('petJoy'));
      this.addBond(1);
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
      const hb = this.headBaseY;

      let poseY = 0, bodyRX = 0, bodyRZ = 0, headRX = 0, headY = hb, hop = 0;
      let legT = [s, -s, -s, s];
      let posed = false;
      if (st === 'sleep' || st === 'lounge' || st === 'hide') {
        poseY = -0.21; legT = [-1.45, -1.45, 1.45, 1.45]; headRX = 0.15; headY = hb - 0.06; posed = true;
        if (st === 'hide') bodyRZ = Math.sin(this.t * 40) * 0.03;
      } else if (st === 'sit') { poseY = -0.06; bodyRX = -0.5; legT = [0.5, 0.5, -1.1, -1.1]; headRX = 0.45; posed = true; }
      else if (st === 'eat') { headRX = 0.75 + Math.sin(this.t * 14) * 0.12; headY = hb - 0.06; }
      else if (st === 'drink') { headRX = 0.8 + Math.sin(this.t * 22) * 0.08; headY = hb - 0.06; }
      else if (st === 'sniff') { headRX = 0.6 + Math.sin(this.t * 22) * 0.06; }
      else if (st === 'dig') { headRX = 0.55; bodyRX = 0.2; legT = [Math.sin(this.t * 24) * 1.1, -Math.sin(this.t * 24) * 1.1, 0, 0]; posed = true; }
      else if (st === 'splash' || st === 'happy') { hop = Math.abs(Math.sin(this.t * 9)) * 0.18; headRX = -0.25; }
      else if (st === 'towel') { bodyRZ = Math.sin(this.t * 18) * 0.12; headRX = -0.15; }
      if (this.tumbleT > 0) bodyRZ = Math.sin((0.7 - this.tumbleT) / 0.7 * Math.PI) * 1.3;

      this.poseY = lerp(this.poseY, poseY, k);
      this.body.position.y = this.poseY + Math.abs(Math.sin(this.phase)) * 0.05 * this.walkBlend + hop;
      this.body.rotation.x = lerp(this.body.rotation.x, bodyRX, k);
      this.body.rotation.z = this.tumbleT > 0 || st === 'towel' || st === 'hide' ? bodyRZ : lerp(this.body.rotation.z, 0, k);
      this.legs.forEach((l, i) => { l.rotation.x = posed ? lerp(l.rotation.x, legT[i], k * (st === 'dig' ? 4 : 1)) : lerp(l.rotation.x, legT[i], 0.5); });
      this.head.rotation.x = lerp(this.head.rotation.x, headRX, k * 1.5);
      this.head.position.y = lerp(this.head.position.y, headY, k);

      const resting = st === 'sleep' || st === 'hide';
      const wag = resting ? 1 : 5 + (this.happy / 100) * 14 + (st === 'happy' ? 8 : 0);
      this.tail.rotation[this.wagAxis] = Math.sin(this.t * wag) * (resting ? 0.1 : 0.55);
      this.tail.rotation.x = lerp(this.tail.rotation.x, this.happy < LOW || st === 'hide' ? this.tailDown : this.tailUp, k);
      const flap = (Math.sin(this.phase * 2) * 0.22 * this.walkBlend + (st === 'happy' ? Math.sin(this.t * 18) * 0.2 : 0)) * this.earFlap;
      this.earL.rotation.z = -0.12 + flap;
      this.earR.rotation.z = 0.12 - flap;
      this.tongue.visible = st === 'happy' || st === 'drink' || st === 'zoom' || this.zoomLeft > 0 || (this.moving && this.curSpeed > 3 && st !== 'return');
    }

    updateBubble() {
      let e = '';
      if (this.state !== 'sleep') {
        let low = null;
        for (const s of D.STATS) if (this[s.k] < LOW && (!low || this[s.k] < this[low])) low = s.k;
        if (low) e = BUBBLE_ICON[low];
      }
      if (e !== this.lastBubble) {
        this.lastBubble = e;
        this.bubble.visible = !!e;
        if (e) { this.bubble.material.map = emojiTexture(e); this.bubble.material.needsUpdate = true; }
      }
      if (e) this.bubble.position.y = this.headBaseY + 0.6 + Math.sin(this.t * 3) * 0.05;
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
  function loungeSpot(dog) {
    const opts = [];
    for (const f of state.furniture) {
      const it = D.ITEMS[f.type];
      if (it.lounge) { const p = frontOf(f); if (p) opts.push(p); }
      else if (it.role === 'bed') { const r = furnRT.get(f); if (!r || !r.claim || r.claim === dog) opts.push(tileCenter(f)); }
    }
    return opts.length ? pick(opts) : null;
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
  function pondEdge(pos) {
    const ex = clamp(pos.x, POND.x0, POND.x1), ez = clamp(pos.z, POND.z0, POND.z1);
    const dx = pos.x - ex, dz = pos.z - ez, d = Math.hypot(dx, dz);
    if (d < 1e-3) return null;
    return new V3(ex + (dx / d) * 0.35, 0, ez + (dz / d) * 0.35);
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
  function newDogData(name, breed, coat, primary) {
    return { id: newId(), name, breed, coat, traits: randomTraits(primary), revealed: false, bond: 0, born: Date.now(), grown: false,
      hunger: 90, thirst: 90, energy: 90, happy: 80, clean: 95 };
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
        `<img class="portrait" src="${ART.portraitURL(d.breed, d.coat)}" alt="">` +
        '<div class="pInfo"><div class="pName"></div><div class="pStatus"></div></div>' +
        '<div class="alerts"></div>' +
      '</div>' +
      '<div class="details">' +
        '<div class="chips"></div>' +
        D.STATS.map((s) => `<div class="bar"><span class="bic">${s.ic}<i class="badge">!</i></span><div class="track"><div class="fill ${s.k}"></div></div></div>`).join('') +
        '<div class="favs"></div>' +
        '<div class="cardBtns"><button class="mini" data-dact="towel">🧽 Towel off</button></div>' +
      '</div>';
    el.querySelector('.pName').textContent = d.name;
    d.ui = {
      el, open: false, alertKey: null,
      status: el.querySelector('.pStatus'),
      alerts: el.querySelector('.alerts'),
      chips: el.querySelector('.chips'),
      favs: el.querySelector('.favs'),
      fills: [...el.querySelectorAll('.fill')],
      badges: [...el.querySelectorAll('.bic .badge')],
    };
    el.addEventListener('click', (e) => {
      const al = e.target.closest('.al');
      if (al) { focusDog(d, al.dataset.k); return; }
      const chip = e.target.closest('.chip[data-tip]');
      if (chip) { toast(chip.dataset.tip); return; }
      const btn = e.target.closest('[data-dact]');
      if (btn) { if (btn.dataset.dact === 'towel') startTowel(d); return; }
      selected = d;
      d.ui.open = !d.ui.open;
      el.classList.toggle('open', d.ui.open);
      if (d.ui.open) refreshCardStatic(d);
      updatePack();
    });
    $('pack').appendChild(el);
    refreshCardStatic(d);
  }
  // parts of the card that only change now and then
  function refreshCardStatic(d) {
    const u = d.ui;
    if (!u) return;
    const g = d.growth();
    const age = g < 1 ? `🐣 Puppy · grown in ${fmtDuration((1 - g) * CONFIG.PUPPY_DAYS * DAY)}` : `${D.BREEDS[d.breed].name}`;
    const T1 = D.TRAITS[d.traits[0]], T2 = D.TRAITS[d.traits[1]];
    const chip = (txt, tip) => `<span class="chip" data-tip="${esc(tip)}">${esc(txt)}</span>`;
    u.chips.innerHTML =
      `<span class="chip age">${esc(age)}</span>` +
      chip(`${T1.icon} ${T1.name}`, `${T1.name}: ${T1.desc}`) +
      (d.revealed ? chip(`${T2.icon} ${T2.name}`, `${T2.name}: ${T2.desc}`) : chip('❔ ???', 'Bond more with your dog to discover its second trait'));
    const fav = d.favToy ? `${D.TOYS[d.favToy].icon} ${D.TOYS[d.favToy].name}${d.missing() ? ' (misses it!)' : ''}` : 'not yet';
    let spot = '';
    if (d.favSpot) {
      const [i, j] = d.favSpot.split(',').map(Number);
      let near = null, nd = 2.5;
      for (const f of state.furniture) { const dd = Math.hypot(f.i - i, f.j - j); if (dd < nd) { nd = dd; near = f; } }
      spot = `<div>Favorite spot: ${near ? `by the ${esc(D.ITEMS[near.type].icon)} ${esc(D.ITEMS[near.type].name)}` : 'a cozy corner'}</div>`;
    }
    u.favs.innerHTML = `<div>Favorite toy: ${esc(fav)}</div>${spot}`;
  }
  function updatePack() {
    for (const d of dogs) {
      const u = d.ui;
      if (!u) continue;
      u.el.classList.toggle('sel', d === selected && dogs.length > 1);
      const lows = D.STATS.filter((s) => d[s.k] < LOW);
      const key = lows.map((s) => s.k + levelClass(d[s.k])).join(',');
      if (key !== u.alertKey) {
        u.alertKey = key;
        u.alerts.innerHTML = lows.map((s) => `<span class="al" data-k="${s.k}">${s.ic}<i class="badge ${levelClass(d[s.k])}">!</i></span>`).join('');
      }
      if (u.open) {
        D.STATS.forEach((s, i) => {
          u.fills[i].style.width = Math.round(d[s.k]) + '%';
          u.badges[i].className = 'badge ' + levelClass(d[s.k]);
        });
        u.status.textContent = d.statusText();
      }
    }
  }
  // Tapping an alert icon: glide to the dog and point at what it needs
  function focusDog(d, k) {
    selected = d;
    camFocus = { dog: d, t: 3.5 };
    let target = null, msg = '';
    const home = place === 'home';
    if (k === 'hunger' || k === 'thirst') {
      const role = k === 'hunger' ? 'food' : 'water';
      const bowls = state.furniture.filter((f) => roleOf(f) === role);
      target = bowls.find((f) => !f.filled) || bowls[0];
      const btn = k === 'hunger' ? '🥣 Feed' : '💧 Water';
      if (!home) msg = `${d.name} is ${k === 'hunger' ? 'hungry' : 'thirsty'}${k === 'thirst' ? ' — the fountain by the gate helps' : ' — time to head home'}`;
      else if (!bowls.length) msg = `Place a ${role === 'food' ? 'food' : 'water'} bowl in 🎨 Decorate`;
      else msg = target.filled ? `${d.name} will ${k === 'hunger' ? 'eat' : 'drink'} soon` : `${d.name} is ${k === 'hunger' ? 'hungry' : 'thirsty'} — tap ${btn}`;
    } else if (k === 'energy') {
      target = state.furniture.find((f) => roleOf(f) === 'bed');
      msg = home ? (target ? `${d.name} needs a nap` : `${d.name} needs a bed to nap in`) : `${d.name} is tired — time to head home`;
    } else if (k === 'clean') {
      msg = `${d.name} is dirty — open their bubble and tap 🧽 Towel off`;
    } else {
      msg = `${d.name} wants attention — pet them or throw a toy`;
    }
    if (target && home) highlight(tileCenter(target));
    toast(msg);
    updatePack();
  }
  function startTowel(d) {
    if (d.clean >= CONFIG.TOWEL_MAX - 1) { toast(`${d.name} is already pretty clean — baths for the rest are coming soon 🛁`); return; }
    if (d.state === 'fetch' || d.state === 'return') { toast('Wait until the game of fetch is over'); return; }
    if (d.state === 'sleep') d.wake();
    d.releaseClaim();
    d.dropSpot();
    d.onArrive = null;
    d.setState('wait', 10);
    towelTask = { dog: d };
  }
  function updateTowelTask() {
    if (!towelTask) return;
    const d = towelTask.dog;
    if (d.state !== 'wait') { towelTask = null; return; }
    const pp = player.root.position, dp = d.root.position;
    const dist = Math.hypot(pp.x - dp.x, pp.z - dp.z);
    if (dist < 1.1) {
      player.moveTarget = null;
      player.face = Math.atan2(dp.x - pp.x, dp.z - pp.z);
      d.faceTo(pp);
      d.setState('towel', 1.6);
      towelTask = null;
    } else if (!player.moveTarget || player.moveTarget.distanceTo(dp) > 0.8) {
      const dx = pp.x - dp.x, dz = pp.z - dp.z, l = dist || 1;
      player.moveTarget = new V3(dp.x + (dx / l) * 0.8, 0, dp.z + (dz / l) * 0.8);
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
    ball.mesh.add(ART.buildToy(type));
    ball.type = type;
  }
  function resetBall() {
    ball.active = false;
    ball.flying = false;
    ball.held = null;
    ball.mesh.visible = false;
  }
  const canPlay = (d) => d.energy > 8 && !['sleep', 'eat', 'drink', 'fetch', 'return', 'towel', 'wait', 'hide'].includes(d.state);

  function throwBall() {
    if (ball.active) { toast('A toy is already out!'); return; }
    let dog = selected && canPlay(selected) ? selected : null;
    if (!dog) {
      const pp = player.root.position;
      dog = dogs.filter(canPlay).sort((a, b) => a.root.position.distanceTo(pp) - b.root.position.distanceTo(pp))[0];
    }
    if (!dog) {
      toast(dogs.some((d) => d.state === 'hide') ? 'Too scared of the storm to play ⛈️' : dogs.some((d) => d.state === 'sleep') ? 'Shh… your dog is napping 💤' : 'Too tired to play right now 😴');
      return;
    }
    const def = D.TOYS[state.toy] || D.TOYS.tennis;
    const p = player.root.position, a = player.root.rotation.y;
    let dist = rand(3.5, 5.5) * def.dist, tx = 0, tz = 0, ok = false;
    for (; dist > 0.9; dist -= 0.4) {
      tx = p.x + Math.sin(a) * dist;
      tz = p.z + Math.cos(a) * dist;
      if (inBounds(tx, tz, 0.3) && !isSolid(tx, tz) && (place === 'home' || !inPond(tx, tz, 0.3))) { ok = true; break; }
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
  function updateBall(dt) {
    if (!ball.active) return;
    const def = D.TOYS[ball.type] || D.TOYS.tennis;
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
    const icon = (D.TOYS[state.toy] || D.TOYS.tennis).icon;
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
    resetBall();
    towelTask = null;
    camFocus = null;
    player.moveTarget = null;
    player.root.position.set(0, 0, 16);
    player.root.rotation.y = player.face = Math.PI;
    dogs.forEach((d, i) => {
      d.releaseClaim();
      d.dropSpot();
      d.onArrive = null;
      d.path = null;
      d.zoomLeft = 0;
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
    applyEnvironment();
    updateCamera(0, true);
    const W = curWeather();
    toast(parkLoot ? 'Walk time! Something is glinting in the grass… ✨' : W.muddy ? `Walk time! It's ${W.name.toLowerCase()} — expect muddy paws 🐾` : 'Walk time! Let your dog sniff the ✨ spots');
  }

  function goHome() {
    place = 'home';
    homeRoot.visible = true;
    parkRoot.visible = false;
    resetBall();
    clearParkLoot();
    towelTask = null;
    player.moveTarget = null;
    player.root.position.copy(freeNear(CHUNK / 2, CHUNK - 1.2));
    player.root.rotation.y = player.face = Math.PI;
    dogs.forEach((d, i) => {
      d.dropSpot();
      d.leash.visible = false;
      d.root.position.copy(freeNear(clamp(CHUNK / 2 - 0.7 + i * 0.5, 0.5, CHUNK - 0.5), CHUNK - 2));
      d.idle(rand(1, 3));
      d.addBond(2);
      d.updateDirtLook();
    });
    sniffSpots.forEach((s) => { s.taken = null; });
    parkWater.taken = null;
    state.stats.walks = (state.stats.walks || 0) + 1;
    refreshUI();
    applyEnvironment();
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
    } else if (camFocus) {
      tx = camFocus.dog.root.position.x;
      tz = camFocus.dog.root.position.z;
      dist = place === 'home' ? 5.5 + CHUNK * 0.75 : 9;
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
    const k = snap ? 1 : damp(camFocus ? 0.005 : 0.02, dt);
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
  const MODALS = ['shop', 'start', 'bag', 'confirm', 'litter', 'settings'];
  const modalOpen = () => MODALS.some((id) => !$(id).classList.contains('hidden'));

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
      camFocus = null;
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
    camFocus = null;

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
      towelTask = null;
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
    if (['fetch', 'return', 'towel', 'wait'].includes(d.state)) return;
    if (d.state === 'sleep' || d.state === 'hide') d.wake();
    d.releaseClaim();
    d.dropSpot();
    d.zoomLeft = 0;
    const near = d.root.position.distanceTo(player.root.position) < 1.9;
    if (near || place === 'park') d.pet();
    else d.goTo(() => player.root.position, 3.2, () => d.pet(), 1.1);
    hideHint();
  }

  // =====================================================================
  // Decorating (furniture + walls & floors)
  // =====================================================================
  const firstInv = () => Object.keys(D.ITEMS).find((t) => state.inventory[t] > 0) || null;
  const rotNames = ['Facing you', 'Facing right', 'Facing back', 'Facing left'];

  function enterDecorate() {
    mode = 'decorate';
    camFocus = null;
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
    document.querySelectorAll('.decoTab').forEach((b) => b.classList.toggle('sel', b.dataset.tab === decoTab));
    $('rotBtn').classList.toggle('hidden', decoTab !== 'furn');
    $('decoHelp').textContent = decoTab === 'furn' ? 'Tap a floor tile to place · Tap an item to pick it up' : 'Pick a wallpaper or floor, then tap a room to apply it';
    if (decoTab === 'style') {
      for (const kind of ['wall', 'floor']) {
        const defs = kind === 'wall' ? D.WALLS : D.FLOORS;
        for (const id of Object.keys(defs)) {
          if (!state.styles.includes(id)) continue;
          const b = document.createElement('button');
          const isSel = selStyle && selStyle.kind === kind && selStyle.id === id;
          b.className = 'inv sw' + (isSel ? ' sel' : '');
          b.innerHTML = `<img src="${ART.swatchURL(kind, id)}" alt=""><small>${kind === 'wall' ? '🧱' : '🟫'} ${esc(defs[id].name)}</small>`;
          b.addEventListener('click', () => { selStyle = { kind, id }; renderInv(); });
          list.appendChild(b);
        }
      }
      return;
    }
    $('rotLabel').textContent = rotNames[placeRot];
    const types = Object.keys(D.ITEMS).filter((t) => state.inventory[t] > 0);
    if (!types.length) {
      list.innerHTML = '<div class="empty">Nothing to place. Tap an item in the room to pick it up, or buy more in the 🛒 Shop.</div>';
      return;
    }
    for (const t of types) {
      const b = document.createElement('button');
      b.className = 'inv' + (t === selectedInv ? ' sel' : '');
      b.innerHTML = `<span>${D.ITEMS[t].icon}</span><small>${esc(D.ITEMS[t].name)}</small><b>×${state.inventory[t]}</b>`;
      b.addEventListener('click', () => { selectedInv = t; renderInv(); });
      list.appendChild(b);
    }
  }
  function decorateTap(gp) {
    const i = Math.floor(gp.x), j = Math.floor(gp.z);
    if (!isHomeTile(i, j)) return;
    if (decoTab === 'style') {
      if (!selStyle) { toast('Pick a wallpaper or floor first'); return; }
      const cx = Math.floor(i / CHUNK), cz = Math.floor(j / CHUNK), k = chunkKey(cx, cz);
      state.rooms[k] = Object.assign(roomStyle(cx, cz), { [selStyle.kind]: selStyle.id });
      buildRoom();
      save();
      spawnEmoji('✨', new V3(cx * CHUNK + CHUNK / 2, 1, cz * CHUNK + CHUNK / 2), { size: 0.6, life: 0.9 });
      return;
    }
    const ex = furnitureAt(i, j);
    if (ex) {
      state.furniture.splice(state.furniture.indexOf(ex), 1);
      state.inventory[ex.type] = (state.inventory[ex.type] || 0) + 1;
      selectedInv = ex.type;
      placeRot = ex.rot || 0;
      afterFurnitureChange();
      toast(`Picked up ${D.ITEMS[ex.type].name}`);
      return;
    }
    if (!selectedInv || !(state.inventory[selectedInv] > 0)) { toast('Pick an item from the bar first'); return; }
    if (D.ITEMS[selectedInv].solid && Math.floor(player.root.position.x) === i && Math.floor(player.root.position.z) === j) {
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
    camFocus = null;
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
    confirmBox('Build a new room here?', `Costs 🪙 ${price} · ready in ${CONFIG.BUILD_MINUTES} minutes`, `Build for 🪙 ${price}`, state.coins >= price, () => {
      if (state.coins < price) { toast('Not enough coins yet'); return; }
      state.coins -= price;
      state.build = { cx, cz, readyAt: Date.now() + CONFIG.BUILD_MINUTES * 60000 };
      exitBuildMode();
      rebuildSite();
      updateHud();
      toast(`Construction started! Ready in ${CONFIG.BUILD_MINUTES} minutes 🏗️`);
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
    if (place === 'home') confetti(new V3(b.cx * CHUNK + CHUNK / 2, 1.5, b.cz * CHUNK + CHUNK / 2));
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
      if (need < 85 && (d.state === 'idle' || d.state === 'sit' || d.state === 'lounge')) {
        const b = findFurniture(role, d, true, d.root.position);
        if (b) sendToBowl(d, b);
      }
    });
    toast(role === 'food' ? (bowls.length > 1 ? 'Food bowls filled 🥣' : 'Food bowl filled 🥣') : (bowls.length > 1 ? 'Water bowls filled 💧' : 'Water bowl filled 💧'));
    save();
  }

  // =====================================================================
  // Shop, toy bag, confirm
  // =====================================================================
  const capacity = () => state.chunks.length;
  const adoptPrice = () => CONFIG.ADOPT_BASE * dogs.length;

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
    const row = (iconHTML, title, sub, price, onBuy, disabled, label) => {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = `<div class="ic">${iconHTML}</div><div class="txt"><b></b><small></small></div>`;
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
    else if (n >= CONFIG.MAX_CHUNKS) row('📐', 'Add a room', 'Your home is as big as it gets', null, null, true, 'Max');
    else row('📐', 'Add a room', `You have ${n} · +1 dog space · ${CONFIG.BUILD_MINUTES} min to build`, expandPrice(n), () => { closeShop(); enterBuildMode(); });
    const cap = capacity(), full = dogs.length >= cap;
    row('🐶', 'Adopt a puppy', full ? `Home is full (${dogs.length}/${cap}) — add a room first` : `${dogs.length}/${cap} dogs · a new litter every day`, adoptPrice(), () => {
      closeShop();
      openLitter();
    }, full, full ? null : 'See litter');

    section('🎾 Toys');
    for (const [k, t] of Object.entries(D.TOYS)) {
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

    section('🎨 Walls & floors');
    for (const kind of ['wall', 'floor']) {
      const defs = kind === 'wall' ? D.WALLS : D.FLOORS;
      for (const [id, s] of Object.entries(defs)) {
        if (!s.price) continue;
        const owned = state.styles.includes(id);
        row(`<img class="sw" src="${ART.swatchURL(kind, id)}" alt="">`, s.name, `${kind === 'wall' ? 'Wallpaper' : 'Floor'}${owned ? ' · apply it in 🎨 Decorate' : ''}`, s.price, (p) => {
          state.coins -= p;
          state.styles.push(id);
          selStyle = { kind, id };
          toast(`${s.name} unlocked — apply it in 🎨 Decorate → Walls & floors`);
          updateHud();
          save();
          renderShop();
        }, owned, owned ? 'Owned' : null);
      }
    }

    for (const [cat, title] of D.CATS) {
      section(title);
      for (const [t, it] of Object.entries(D.ITEMS)) {
        if (it.cat !== cat) continue;
        const owned = (state.inventory[t] || 0) + state.furniture.filter((f) => f.type === t).length;
        const kind = it.role === 'bed' ? 'Dogs nap on it' : it.role === 'food' ? 'Fill it with 🥣 Feed' : it.role === 'water' ? 'Fill it with 💧 Water' : it.lounge ? 'Couch Potatoes love it' : it.solid ? 'Decoration' : 'Dogs can walk on it';
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
    const all = Object.entries(D.TOYS);
    $('bagCount').textContent = `${state.toys.length}/${all.length}`;
    for (const [k, t] of all) {
      const owned = state.toys.includes(k);
      const favOf = dogs.filter((d) => d.favToy === k).map((d) => d.name);
      const b = document.createElement('button');
      b.className = 'toyCard' + (owned ? '' : ' locked') + (k === state.toy ? ' eq' : '');
      const sub = owned ? (favOf.length ? `💞 ${favOf.join(', ')}` : k === state.toy ? 'Throwing next' : 'Tap to use') : t.price == null ? 'Found on walks' : `Shop · 🪙 ${t.price}`;
      b.innerHTML = `<span class="big">${owned || t.price != null ? t.icon : '❓'}</span><b></b><small></small>`;
      b.querySelector('b').textContent = owned || t.price != null ? t.name : '???';
      b.querySelector('small').textContent = sub;
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

  // =====================================================================
  // First dog (free choice) & the daily litter
  // =====================================================================
  function randomName() {
    const used = new Set(dogs.map((d) => d.name));
    const free = D.DOG_NAMES.filter((n) => !used.has(n));
    return pick(free.length ? free : D.DOG_NAMES);
  }
  const pickState = { breed: 'retriever', coat: 'golden', trait: 'zoomies' };
  function renderStart() {
    const bg = $('breedGrid');
    bg.innerHTML = '';
    for (const [id, B] of Object.entries(D.BREEDS)) {
      const b = document.createElement('button');
      b.className = 'breed' + (id === pickState.breed ? ' sel' : '');
      const coat = id === pickState.breed ? pickState.coat : standardCoats(id)[0].id;
      b.innerHTML = `<img src="${ART.portraitURL(id, coat)}" alt="">${esc(B.name)}`;
      b.addEventListener('click', () => { pickState.breed = id; pickState.coat = standardCoats(id)[0].id; renderStart(); });
      bg.appendChild(b);
    }
    const cr = $('coatRow');
    cr.innerHTML = '';
    for (const c of standardCoats(pickState.breed)) {
      const b = document.createElement('button');
      b.className = 'coat' + (c.id === pickState.coat ? ' sel' : '');
      b.innerHTML = `<img src="${ART.portraitURL(pickState.breed, c.id)}" alt=""><small>${esc(c.name)}</small>`;
      b.addEventListener('click', () => { pickState.coat = c.id; renderStart(); });
      cr.appendChild(b);
    }
    const tg = $('traitGrid');
    tg.innerHTML = '';
    for (const [id, T] of Object.entries(D.TRAITS)) {
      const b = document.createElement('button');
      b.className = 'trait' + (id === pickState.trait ? ' sel' : '');
      b.innerHTML = `<span>${T.icon}</span><small>${esc(T.name)}</small>`;
      b.addEventListener('click', () => { pickState.trait = id; renderStart(); });
      tg.appendChild(b);
    }
    $('traitDesc').textContent = D.TRAITS[pickState.trait].desc;
  }
  function openStart() {
    pickState.breed = pick(Object.keys(D.BREEDS));
    pickState.coat = pick(standardCoats(pickState.breed)).id;
    pickState.trait = pick(traitList());
    renderStart();
    $('nameInput').value = randomName();
    $('start').classList.remove('hidden');
  }
  $('startBtn').addEventListener('click', () => {
    const name = ($('nameInput').value || '').trim().slice(0, 14) || randomName();
    $('nameInput').blur();
    const d = addDog(newDogData(name, pickState.breed, pickState.coat, pickState.trait), true);
    selected = d;
    $('start').classList.add('hidden');
    d.pet();
    toast(`Say hi to ${name}! Tap their bubble to see their personality 💕`);
    updateHud();
    save();
  });

  let litterPick = -1;
  function todayLitter() {
    const day = clockNow.dateKey;
    if (!state.litter || state.litter.day !== day) {
      const breeds = shuffle(Object.keys(D.BREEDS)).slice(0, 3);
      state.litter = { day, pups: breeds.map((b) => ({ breed: b, coat: pick(standardCoats(b)).id, trait: pick(traitList()), taken: false })) };
      save();
    }
    return state.litter;
  }
  function openLitter() {
    litterPick = -1;
    renderLitter();
    $('litter').classList.remove('hidden');
  }
  function renderLitter() {
    const L = todayLitter();
    const grid = $('pups');
    grid.innerHTML = '';
    L.pups.forEach((p, i) => {
      const B = D.BREEDS[p.breed], C = ART.coatOf(p.breed, p.coat), T = D.TRAITS[p.trait];
      const b = document.createElement('button');
      b.className = 'pup' + (i === litterPick ? ' sel' : '') + (p.taken ? ' taken' : '');
      b.innerHTML = `<img src="${ART.portraitURL(p.breed, p.coat)}" alt=""><b>${esc(B.name)}</b><small>${esc(C.name)}</small><span class="chip">${T.icon} ${esc(T.name)}</span>${p.taken ? '<em>Adopted ❤️</em>' : ''}`;
      b.addEventListener('click', () => {
        if (p.taken) return;
        litterPick = i;
        renderLitter();
        $('pupName').value = randomName();
      });
      grid.appendChild(b);
    });
    const P = L.pups[litterPick];
    $('pupPick').classList.toggle('hidden', !P);
    if (P) $('pupDesc').textContent = `${D.TRAITS[P.trait].icon} ${D.TRAITS[P.trait].name}: ${D.TRAITS[P.trait].desc}`;
    const price = adoptPrice();
    $('adoptBtn').textContent = `Adopt for 🪙 ${price}`;
    $('adoptBtn').disabled = !P || state.coins < price || dogs.length >= capacity();
    $('litterSub').textContent = dogs.length >= capacity() ? 'Your home is full — add a room first.' : state.coins < price ? `Adoption costs 🪙 ${price}. Come back when you've saved up!` : 'Pick a puppy, or come back tomorrow for a new litter.';
  }
  $('adoptBtn').addEventListener('click', () => {
    const L = todayLitter(), P = L.pups[litterPick];
    if (!P || P.taken) return;
    const price = adoptPrice();
    if (state.coins < price || dogs.length >= capacity()) return;
    state.coins -= price;
    P.taken = true;
    const name = ($('pupName').value || '').trim().slice(0, 14) || randomName();
    $('pupName').blur();
    const d = addDog(newDogData(name, P.breed, P.coat, P.trait), true);
    selected = d;
    $('litter').classList.add('hidden');
    d.pet();
    toast(`Welcome home, ${name}! 🐾`);
    updateHud();
    save();
  });
  $('litterClose').addEventListener('click', () => $('litter').classList.add('hidden'));

  // =====================================================================
  // Settings: export / import / backup / new game
  // =====================================================================
  function encodeSave(obj) { return 'VP:' + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
  function decodeSave(text) {
    let t = String(text || '').trim();
    if (t.startsWith('{')) return JSON.parse(t);
    if (t.startsWith('VP:')) t = t.slice(3);
    return JSON.parse(decodeURIComponent(escape(atob(t.replace(/\s+/g, '')))));
  }
  function currentSaveObject() {
    save();
    try { return JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY)) || state; } catch (_) { return state; }
  }
  function openSettings() {
    $('saveCode').value = '';
    $('codeBox').classList.add('hidden');
    $('importCode').value = '';
    let backup = null;
    try { backup = JSON.parse(localStorage.getItem(CONFIG.BACKUP_KEY)); } catch (_) { /* none */ }
    $('restoreBtn').disabled = !backup;
    $('restoreInfo').textContent = backup && backup.at ? `Backup from ${new Date(backup.at).toLocaleString()}` : 'No backup yet — one is made automatically before every import or new game.';
    $('verInfo').textContent = `Voxel Paws · save format v${CONFIG.SAVE_VERSION} · ${dogs.length} dog${dogs.length === 1 ? '' : 's'} · 🪙 ${state.coins}`;
    $('settings').classList.remove('hidden');
  }
  function backupCurrent() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (raw) localStorage.setItem(CONFIG.BACKUP_KEY, JSON.stringify({ at: Date.now(), data: JSON.parse(raw) }));
    } catch (_) { /* storage full or unavailable */ }
  }
  function replaceSave(obj) {
    save();
    backupCurrent();
    noSave = true;
    try {
      if (obj) localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(obj));
      else localStorage.removeItem(CONFIG.SAVE_KEY);
    } catch (_) { toast('Could not write the save — storage unavailable'); noSave = false; return; }
    location.reload();
  }
  function importText(text) {
    let obj;
    try { obj = decodeSave(text); } catch (_) { toast("That code doesn't look like a Voxel Paws save"); return; }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.dogs)) { toast("That code doesn't look like a Voxel Paws save"); return; }
    const n = obj.dogs.length;
    confirmBox('Import this save?', `It has ${n} dog${n === 1 ? '' : 's'} and 🪙 ${obj.coins || 0}. Your current game is backed up first and can be restored from Settings.`, 'Import and restart', true, () => replaceSave(obj));
  }
  $('settings').addEventListener('click', async (e) => {
    if (e.target.id === 'settings' || e.target.closest('[data-act="closeSettings"]')) { $('settings').classList.add('hidden'); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'exportBtn') {
      $('saveCode').value = encodeSave(currentSaveObject());
      $('codeBox').classList.remove('hidden');
    } else if (b.id === 'copyBtn') {
      const ta = $('saveCode');
      try { await navigator.clipboard.writeText(ta.value); toast('Save code copied 📋'); }
      catch (_) { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('Save code copied 📋'); } catch (__) { toast('Select the code and copy it manually'); } }
    } else if (b.id === 'downloadBtn') {
      const blob = new Blob([JSON.stringify(currentSaveObject(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `voxel-paws-save-${clockNow.dateKey}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } else if (b.id === 'importBtn') {
      importText($('importCode').value);
    } else if (b.id === 'restoreBtn') {
      let backup = null;
      try { backup = JSON.parse(localStorage.getItem(CONFIG.BACKUP_KEY)); } catch (_) { /* none */ }
      if (!backup || !backup.data) return;
      confirmBox('Restore the backup?', 'Your current game becomes the new backup, so you can switch back.', 'Restore and restart', true, () => replaceSave(backup.data));
    } else if (b.id === 'newGameBtn') {
      confirmBox('Start a new game?', 'Your current game is backed up first and can be restored from Settings.', 'Start over', true, () => replaceSave(null));
    }
  });
  $('importFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importText(r.result);
    r.readAsText(f);
    e.target.value = '';
  });

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
    const W = curWeather();
    const icon = weatherId === 'sun' && nightLevel > 0.5 ? '🌙' : W.icon;
    $('clockChip').textContent = `${icon} ${clockNow.hm}`;
    updatePack();
  }

  $('hud').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
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
    else if (act === 'settings') openSettings();
    else if (act === 'cancelBuild') exitBuildMode();
    else if (act === 'tab') { decoTab = b.dataset.tab; renderInv(); }
    else if (act === 'clock') {
      const W = curWeather();
      toast(`${W.icon} ${W.name} in Germany, ${clockNow.hm}${W.muddy ? ' · walks get muddy' : ''}${W.lightning ? ' · shy dogs get scared' : ''}`);
    } else if (act === 'rotate') { placeRot = (placeRot + 1) % 4; renderInv(); toast(`Next item: ${rotNames[placeRot].toLowerCase()}`); }
  });
  $('shop').addEventListener('click', (e) => {
    if (e.target.id === 'shop' || e.target.closest('[data-act="closeShop"]')) closeShop();
  });
  $('bag').addEventListener('click', (e) => {
    if (e.target.id === 'bag' || e.target.closest('[data-act="closeBag"]')) $('bag').classList.add('hidden');
  });
  $('litter').addEventListener('click', (e) => { if (e.target.id === 'litter') $('litter').classList.add('hidden'); });

  // =====================================================================
  // Saving, loading and converting old saves
  // =====================================================================
  const notes = new Set();
  function save() {
    if (noSave) return;
    state.dogs = dogs.map((d) => d.serialize());
    state.savedAt = Date.now();
    state.v = CONFIG.SAVE_VERSION;
    try { localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
  }
  // Each step converts one save format to the next. Never edit old steps; add a new one.
  const MIGRATIONS = {
    1(s) { // v1: one square room -> v2: sections, toys
      if (!Array.isArray(s.chunks) || !s.chunks.length) {
        const n = Math.max(1, Math.ceil((s.roomSize || CHUNK) / CHUNK));
        s.chunks = [];
        for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) s.chunks.push([cx, cz]);
      }
      delete s.roomSize;
      if (!Array.isArray(s.toys)) s.toys = ['tennis'];
      if (!s.toy) s.toy = 'tennis';
      notes.add('water');
      return s;
    },
    2(s) { // v2 -> v3: breeds, coats, traits, cleanliness, room styles
      s.dogs = (s.dogs || []).map((d) => {
        const n = Object.assign({}, d);
        if (typeof d.breed === 'number' || !D.BREEDS[d.breed]) {
          n.coat = D.LEGACY_COATS[(d.breed | 0)] || 'golden';
          n.breed = 'retriever';
        }
        if (!Array.isArray(n.traits)) n.traits = randomTraits();
        n.revealed = !!n.revealed;
        n.bond = n.bond || 0;
        n.born = n.born || Date.now() - 30 * DAY;
        n.grown = true;
        n.id = n.id || newId();
        if (n.clean == null) n.clean = 85;
        if (n.thirst == null) n.thirst = 80;
        return n;
      });
      s.rooms = s.rooms || {};
      s.styles = Array.isArray(s.styles) ? s.styles : freeStyles();
      s.litter = null;
      notes.add('v3');
      return s;
    },
  };
  function migrate(raw) {
    let s = JSON.parse(JSON.stringify(raw));
    let v = s.v || 1;
    while (v < CONFIG.SAVE_VERSION) {
      if (!MIGRATIONS[v]) break;
      s = MIGRATIONS[v](s);
      v++;
      s.v = v;
    }
    return s;
  }
  function normalize(s) {
    const st = Object.assign(defaultState(), s);
    if (!st.inventory || typeof st.inventory !== 'object') st.inventory = {};
    for (const k of Object.keys(st.inventory)) if (!D.ITEMS[k]) delete st.inventory[k];
    if (!Array.isArray(st.furniture)) st.furniture = [];
    st.furniture = st.furniture.filter((f) => f && D.ITEMS[f.type]);
    if (!Array.isArray(st.chunks) || !st.chunks.length) st.chunks = [[0, 0]];
    if (!Array.isArray(st.toys)) st.toys = [];
    st.toys = st.toys.filter((t) => D.TOYS[t]);
    if (!st.toys.includes('tennis')) st.toys.unshift('tennis');
    if (!st.toys.includes(st.toy)) st.toy = 'tennis';
    if (st.build && !(st.build.readyAt > 0)) st.build = null;
    if (!st.rooms || typeof st.rooms !== 'object') st.rooms = {};
    if (!Array.isArray(st.styles)) st.styles = freeStyles();
    for (const f of freeStyles()) if (!st.styles.includes(f)) st.styles.push(f);
    if (!Array.isArray(st.dogs)) st.dogs = [];
    if (!st.stats || typeof st.stats !== 'object') st.stats = { walks: 0 };
    return st;
  }
  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY)); } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object') return false;
    try {
      state = normalize(migrate(raw));
    } catch (_) {
      state = defaultState();
      return false;
    }
    // time passes while you're away
    const hours = clamp((Date.now() - (raw.savedAt || Date.now())) / 3600000, 0, 24);
    const O = D.NEEDS.offlinePerHour;
    for (const d of state.dogs) {
      d.hunger = Math.max(10, (d.hunger ?? 80) - hours * O.hunger);
      d.thirst = Math.max(10, (d.thirst ?? 80) - hours * O.thirst);
      d.energy = clamp((d.energy ?? 80) - hours * O.energy, 0, 100);
      d.happy = Math.max(15, (d.happy ?? 70) - hours * O.happy);
      d.clean = Math.max(10, (d.clean ?? 85) - hours * O.clean);
    }
    return true;
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
  let hudTimer = 0, saveTimer = 5, slowTimer = 0;

  function update(dt) {
    animT += dt;
    updatePlayer(dt);
    updateTowelTask();
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
    lightning = weatherFX.update(dt, curWeather(), camLook, (x, z) => place === 'home' && isHomeTile(Math.floor(x), Math.floor(z)));
    applyEnvironment();

    if (tapT > 0) {
      tapT -= dt;
      tapRing.material.opacity = Math.max(0, tapT * 1.6);
      tapRing.scale.setScalar(1 + (0.5 - tapT) * 1.5);
    }
    if (hlT > 0) {
      hlT -= dt;
      hlRing.visible = place === 'home';
      hlRing.material.opacity = Math.min(1, hlT) * (0.55 + Math.sin(animT * 8) * 0.35);
      hlRing.scale.setScalar(1 + Math.sin(animT * 8) * 0.1);
    } else hlRing.visible = false;
    if (camFocus) { camFocus.t -= dt; if (camFocus.t <= 0) camFocus = null; }
    selRing.visible = !!selected && dogs.length > 1 && mode === 'normal';
    if (selRing.visible) selRing.position.set(selected.root.position.x, 0.055, selected.root.position.z);

    updateCamera(dt, false);
    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.25; checkBuild(); updateHud(); }
    slowTimer -= dt;
    if (slowTimer <= 0) {
      slowTimer = 1;
      tickClock();
      for (const d of dogs) { d.applyGrowth(); d.updateDirtLook(); d.checkFavSwitch(); }
    }
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
    if (hadSave && notes.has('water')) giveWaterBowl();
    rebuildSite();
    player.root.position.copy(freeNear(CHUNK / 2, CHUNK - 1.2));
    player.root.rotation.y = player.face = Math.PI;
    for (const dd of state.dogs) addDog(dd, false);
    selected = dogs[0] || null;
    updateToyIcons();
    refreshUI();
    tickClock();
    applyEnvironment();
    if (!dogs.length) openStart();
    else if (notes.has('v3')) toast('New: breeds, personalities, weather & more! Tap a dog bubble to meet them 🐾');
    else toast(`Welcome back! ${dogs[0].name} missed you 🐾`);
    checkBuild();
    updateHud();
    updateCamera(0, true);
    save();
    loop();
  }
  // Add ?debug to the game link to poke at the game from the browser console
  if (/[?&]debug\b/.test(location.search)) {
    window.VP = {
      get state() { return state; }, get place() { return place; }, get parkLoot() { return parkLoot; }, get weather() { return weatherId; },
      dogs, player, ball, grantToy, save, migrate,
      setTime(h) { timeOverride = h; tickClock(); }, setWeather(w) { weatherOverride = w; tickClock(); },
    };
  }
  init();
})();
