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
  // tricks: the 15 visible ones plus the unscrambled secret ones
  const SECRETS = (() => {
    try { return JSON.parse(atob(D.SECRET_TRICKS).split('').reverse().join('')); } catch (_) { return []; }
  })();
  const ALL_TRICKS = Object.assign({}, D.TRICKS, Object.fromEntries(SECRETS.map((s) => [s.id, Object.assign({ secret: true }, s)])));
  function trickLevelOf(xp) {
    let l = 0;
    for (let i = 1; i < D.TRICK_XP.length; i++) if (xp >= D.TRICK_XP[i]) l = i;
    return l;
  }
  const pairKey = (a, b) => [a, b].sort().join('|');
  const GLYPH = { T: 'tap', H: 'hold', S: 'press', u: 'up', d: 'down', l: 'left', r: 'right', O: 'circle' };
  const seqGlyphs = (seq) => `<span class="seq">${seq.split('').map((c) => IC(GLYPH[c] || 'sparkle')).join('')}</span>`;

  // =====================================================================
  // UI kit: drawn icons, model thumbnails, no stray emoji in menus
  // =====================================================================
  const IC = (n, c) => ART.icon(n, c);
  function fillIcons(root) {
    (root || document).querySelectorAll('i[data-i]').forEach((el) => {
      const svg = document.createElement('span');
      svg.innerHTML = IC(el.dataset.i);
      const node = svg.firstChild;
      if (el.className) node.classList.add(...el.className.split(/\s+/).filter(Boolean));
      el.replaceWith(node);
    });
  }
  // <img> for a model thumbnail; drawn a few per frame so menus open instantly
  const thumbWait = new Set();
  function TH(kind, id, cls) {
    const key = kind + ':' + id;
    const ready = ART.hasThumb(kind, id);
    const url = ready ? ART.thumbURL(kind, id) : null;
    if (!ready) thumbWait.add(key);
    return `<img class="th${cls ? ' ' + cls : ''}" data-th="${esc(key)}" alt=""${url ? ` src="${url}"` : ''}>`;
  }
  function pumpThumbs() {
    if (!thumbWait.size) return;
    // only pictures that are on the page, the ones you can see first
    const imgs = [...document.querySelectorAll('img.th[data-th]:not([src]):not(.none)')];
    if (!imgs.length) { thumbWait.clear(); return; }
    const vis = imgs.filter((im) => im.offsetParent !== null);
    const t0 = performance.now();
    for (const im of vis.length ? vis : imgs) {
      if (im.getAttribute('src') || im.classList.contains('none')) continue;
      const key = im.dataset.th, i = key.indexOf(':');
      const url = ART.thumbURL(key.slice(0, i), key.slice(i + 1));
      document.querySelectorAll(`img[data-th="${CSS.escape(key)}"]`).forEach((el) => { if (url) el.src = url; else el.classList.add('none'); });
      if (performance.now() - t0 > 12) return;
    }
    if (!vis.length) thumbWait.clear();
  }
  // which thumbnail shows a thing from data.js
  const thumbOf = {
    item: (id) => TH('item', id),
    toy: (id) => TH('toy', id),
    acc: (id) => TH('acc', id),
    ing: (id) => TH('ing', id),
    shampoo: (id) => TH('shampoo', id),
    meal: (id) => TH('dish', id),
    find: (id) => TH('pic', (D.FINDS[id] || {}).icon || '?'),
    pic: (ch) => TH('pic', ch),
  };
  // Menus show drawn icons and models instead of emoji. Text from data.js still carries
  // emoji (handy in the 3D world), so they are taken out of any text shown in a menu.
  const EMOJI_RE = /(?:[#*0-9]\uFE0F?\u20E3)|(?:(?![\u2605\u00A9\u00AE\u2122\u2192\u2190])[\p{Extended_Pictographic}\p{Regional_Indicator}])(?:\uFE0F|\u200D[\p{Extended_Pictographic}\u2640\u2642\u2695]\uFE0F?|[\u{1F3FB}-\u{1F3FF}])*\uFE0F?/gu;
  const MONEY = { '🪙': 'coin', '🎟️': 'ticket', '🎟': 'ticket' };
  const EMOJI_SP = new RegExp(EMOJI_RE.source + ' ?', 'gu');
  const plain = (t) => {
    const src = String(t);
    let out = src.replace(EMOJI_SP, (m) => (MONEY[m.trim()] ? m : '')).replace(/ {2,}/g, ' ').replace(/\( +/g, '(').replace(/ +([),.!?:;])/g, '$1').replace(/\(\)/g, '');
    if (!/ $/.test(src)) out = out.replace(/ +$/, '');
    return out;
  };
  function scrubText(node) {
    const t = node.nodeValue;
    if (!t || !EMOJI_RE.test(t)) return;
    EMOJI_RE.lastIndex = 0;
    const p = node.parentNode;
    if (!p || p.closest && p.closest('textarea, input, [data-keep]')) return;
    if (!/[🪙🎟]/u.test(t)) { node.nodeValue = plain(t); return; }
    // money becomes a drawn coin or ticket
    const frag = document.createDocumentFragment();
    plain(t).split(/(🪙|🎟️|🎟)/u).forEach((part) => {
      if (!part) return;
      if (MONEY[part]) { const s = document.createElement('span'); s.innerHTML = IC(MONEY[part], 'inl'); frag.appendChild(s.firstChild); } else frag.appendChild(document.createTextNode(part));
    });
    p.replaceChild(frag, node);
  }
  function scrubTree(root) {
    if (root.nodeType === 3) { scrubText(root); return; }
    if (root.nodeType !== 1 || root.closest('textarea, input, [data-keep]')) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(scrubText);
  }
  const scrubber = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') scrubText(m.target);
      else m.addedNodes.forEach(scrubTree);
    }
  });
  fillIcons();
  scrubTree(document.body);
  scrubber.observe(document.body, { childList: true, subtree: true, characterData: true });
  const WX_ICON = { sun: 'sun', clouds: 'cloud', rain: 'rain', storm: 'storm', fog: 'fog', snow: 'snow' };
  const setIcon = (el, name, cls) => { if (el.dataset.icon !== name) { el.dataset.icon = name; el.innerHTML = IC(name, cls); } };
  const pawsHTML = (n, of = 5) => Array.from({ length: of }, (_, i) => IC('paw', i < n ? 'on' : 'off')).join('');

  // ----- sheets: the header is the top edge; drag it down to tuck the sheet back into the dock -----
  const dockTarget = () => {
    const el = [...document.querySelectorAll('.dock:not(.hidden) .menuBtn, .dock:not(.hidden)')].find((e) => e.offsetParent !== null);
    const r = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2 - 20, top: window.innerHeight - 60, width: 40, height: 40 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  // a copy of the sheet that shrinks into the dock while the real one is already gone
  function ghostClose(modal, fromY = 0) {
    const sheet = modal.querySelector('.sheet');
    if (!sheet || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = sheet.getBoundingClientRect();
    const g = sheet.cloneNode(true);
    g.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    g.removeAttribute('id');
    g.classList.add('sheetGhost');
    Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, maxHeight: 'none', transform: `translateY(${fromY}px)`, zIndex: 45 });
    const shade = document.createElement('div');
    shade.className = 'ghostShade';
    document.body.append(shade, g);
    const t = dockTarget();
    const sx = 56 / r.width, sy = 56 / r.height;
    const dx = t.x - (r.left + r.width / 2), dy = t.y - (r.top + r.height / 2);
    requestAnimationFrame(() => {
      g.style.transition = 'transform .42s cubic-bezier(.5,0,.2,1), opacity .42s ease-in, border-radius .42s';
      g.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      g.style.opacity = '0';
      g.style.borderRadius = '40%';
      shade.style.opacity = '0';
    });
    setTimeout(() => { g.remove(); shade.remove(); }, 460);
  }
  // closing a sheet the normal way: its own close button does the work
  function dismissSheet(modal, fromY) {
    const x = modal.querySelector('.sheetHead .x');
    if (!x) return false;
    ghostClose(modal, fromY);
    x.click();
    if (!modal.classList.contains('hidden')) { document.querySelectorAll('.sheetGhost, .ghostShade').forEach((n) => n.remove()); return false; }
    return true;
  }
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const m = e.target.classList && e.target.classList.contains('modal') ? e.target : null;
    const x = e.target.closest && e.target.closest('.sheetHead .x');
    const modal = m || (x && x.closest('.modal'));
    if (!modal || modal.classList.contains('hidden') || !modal.querySelector('.sheetHead .x')) return;
    ghostClose(modal);
    setTimeout(() => { if (!modal.classList.contains('hidden')) document.querySelectorAll('.sheetGhost, .ghostShade').forEach((n) => n.remove()); }, 0);
  }, true);
  (function sheetDrag() {
    let drag = null;
    document.addEventListener('pointerdown', (e) => {
      const head = e.target.closest('.sheetHead');
      if (!head || e.target.closest('button, input, textarea, .headRow')) return;
      const sheet = head.closest('.sheet'), modal = head.closest('.modal');
      drag = { id: e.pointerId, y0: e.clientY, sheet, modal, dy: 0, t: performance.now(), v: 0, ly: e.clientY };
      sheet.style.transition = 'none';
      try { head.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    document.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const raw = e.clientY - drag.y0;
      drag.dy = raw > 0 ? raw : raw / 4;            // a little give upwards, free downwards
      const now = performance.now();
      drag.v = (e.clientY - drag.ly) / Math.max(1, now - drag.t);
      drag.t = now; drag.ly = e.clientY;
      drag.sheet.style.transform = `translateY(${drag.dy}px)`;
      drag.modal.style.setProperty('--shade', String(Math.max(0, 1 - drag.dy / 400)));
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      d.modal.style.removeProperty('--shade');
      const go = d.dy > Math.min(140, d.sheet.offsetHeight * 0.3) || (d.dy > 30 && d.v > 0.6);
      if (go && dismissSheet(d.modal, d.dy)) { d.sheet.style.transform = ''; d.sheet.style.transition = ''; return; }
      d.sheet.style.transition = 'transform .3s cubic-bezier(.2,.9,.3,1.2)';
      d.sheet.style.transform = '';
      setTimeout(() => { d.sheet.style.transition = ''; }, 320);
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  })();
  // the glass turns darker when the world behind it is dark, like iOS does
  let dusk = false;
  function updateDusk(level) {
    const want = dusk ? level > 0.38 : level > 0.55;
    if (want !== dusk) { dusk = want; document.body.classList.toggle('dusk', dusk); }
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
  let fogPush = 0;   // fog distances follow the camera, so zooming out never fogs the view

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
  let parkRoot = null;     // the place you are walking in (set by useScene)
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
      friends: {},
      secrets: [],
      gardens: {},
      clutter: [],
      pantry: { carrot: 2, apple: 2, egg: 1 },
      meals: [],
      shampoos: { gentle: 2 },
      accessories: [],
      claimedGifts: [],
      uid: newId(),
      stats: { walks: 0, rainWalks: 0 },
      unlocked: [],                    // places you can walk to (the park always)
      locWalks: {},                    // walks per place
      glades: [],                      // hidden forest glades found
      treasures: 0,
      summits: 0,
      finds: {},                       // 📒 book finds: id -> how many
      seen: { toys: [], coats: [], rares: [] },
      learned: [],                     // tricks any dog has learned
      daily: null,                     // today's challenges
      tickets: 0,                      // carnival tickets
      portal: false,                   // fairy portal opened
      rocket: false,                   // rocket fueled for the moon
      puzzles: 0,                      // fairy statue puzzles solved
    };
  }
  let state = defaultState();
  let visit = null;                       // a friend's home being visited (read-only)
  const home = () => visit || state;      // the home that is shown on screen

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
  let walkTotal = 0;       // meters walked on this walk (for the records page)
  let tiredWarned = false;
  let zoom = 1;
  let animT = 0;
  let camFocus = null;
  let towelTask = null;
  let noSave = false;
  let tm = null;           // Trick Mode session
  const walkers = [];
  const encCooldown = new Map();

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
  // weather where you are: caves, the moon and the fairy realm have none
  const CALM = { name: 'Calm', icon: '✨', light: 1 };
  const localWeather = () => (place === 'park' && S && S.env && S.env.noWeather ? CALM : curWeather());
  const envColor = new THREE.Color();
  function applyEnvironment() {
    const W = localWeather();
    const L = ART.daylight(clockNow.hour, curWeather());
    nightLevel = L.night;
    const E = place === 'park' && S && S.env ? S.env : null;
    world.background.copy(L.sky);
    if (E && E.sky) world.background.copy(envColor.set(E.sky)).lerp(L.sky, E.dark ? 0 : 0.15 * L.night);
    if (lightning) world.background.lerp(new THREE.Color('#ffffff'), 0.5);
    hemiLight.intensity = (E && E.hemi != null ? E.hemi * (E.dark ? 1 : 1 - 0.4 * L.night) : L.hemi) + lightning * 0.8;
    sunLight.intensity = (E && E.sun != null ? E.sun * (E.dark ? 1 : 1 - 0.5 * L.night) : L.sun) + lightning * 1.2;
    ART.M.lamp.emissiveIntensity = 0.65 + (E && E.dark ? 1 : L.night) * 0.9;
    ART.M.window.color.copy(dayWindow).lerp(nightWindow, L.night);
    playerLight.visible = !!(E && E.dark);
    if (place === 'park') {
      fog.color.copy(world.background);
      if (E && E.fog) { fog.near = E.fog[0]; fog.far = E.fog[1]; }
      else {
        fog.near = W.fog ? 4 : (S.fog ? S.fog.near : 24);
        fog.far = W.fog ? 20 : (S.fog ? S.fog.far : 50);
      }
      fog.near += fogPush; fog.far += fogPush;
      world.fog = fog;
    } else if (W.fog) {
      fog.color.copy(L.sky);
      fog.near = 10 + fogPush;
      fog.far = 32 + fogPush;
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
    chunkSet = new Set(home().chunks.map(([x, z]) => chunkKey(x, z)));
    homeBounds = extentOf(home().chunks);
  }
  const hasChunk = (cx, cz) => chunkSet.has(chunkKey(cx, cz));
  const isHomeTile = (i, j) => hasChunk(Math.floor(i / CHUNK), Math.floor(j / CHUNK));
  const roomStyle = (cx, cz) => Object.assign({}, D.DEFAULT_ROOM, home().rooms[chunkKey(cx, cz)]);
  const isGardenChunk = (cx, cz) => !!(home().gardens || {})[chunkKey(cx, cz)];
  const isGardenTile = (i, j) => isGardenChunk(Math.floor(i / CHUNK), Math.floor(j / CHUNK));
  const gardensUnlocked = () => state.chunks.length >= D.GARDEN_UNLOCK_SECTIONS;
  const ARTS = ['#f6a5c0', '#9ad0a7', '#ffd27a', '#a7b8f5'];

  function buildRoom() {
    roomGroup.clear();
    gridGroup.clear();
    const C = CHUNK, h = C / 2;
    home().chunks.forEach(([cx, cz], n) => {
      const x0 = cx * C, z0 = cz * C;
      if (isGardenChunk(cx, cz)) { buildGardenChunk(cx, cz); return; }
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

  // gardens: grass, an open sky and a low picket fence on the outside edges
  function buildGardenChunk(cx, cz) {
    const C = CHUNK, h = C / 2, x0 = cx * C, z0 = cz * C;
    const floor = new THREE.Mesh(geo(C, 0.12, C), ART.gardenFloorMaterial());
    floor.position.set(x0 + h, -0.06, z0 + h);
    roomGroup.add(floor);
    const grid = new THREE.GridHelper(C, C, 0x3f6b2f, 0x3f6b2f);
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    grid.position.set(x0 + h, 0.012, z0 + h);
    gridGroup.add(grid);
    const fence = '#f4efe6';
    const sides = [
      [!hasChunk(cx, cz - 1), (k) => [x0 + k, z0], [C, 0.06, 0.06], [x0 + h, z0]],
      [!hasChunk(cx, cz + 1), (k) => [x0 + k, z0 + C], [C, 0.06, 0.06], [x0 + h, z0 + C]],
      [!hasChunk(cx - 1, cz), (k) => [x0, z0 + k], [0.06, 0.06, C], [x0, z0 + h]],
      [!hasChunk(cx + 1, cz), (k) => [x0 + C, z0 + k], [0.06, 0.06, C], [x0 + C, z0 + h]],
    ];
    for (const [open, at, [w, hh, d], [mx, mz]] of sides) {
      if (!open) continue;
      for (let k = 0; k <= C; k += 0.75) { const [x, z] = at(k); box(roomGroup, 0.09, 0.5, 0.09, fence, x, 0.25, z); }
      box(roomGroup, w, hh, d, fence, mx, 0.35, mz);
      box(roomGroup, w, hh, d, fence, mx, 0.18, mz);
    }
    for (let k = 0; k < 6; k++) {
      const r = ART.mulberry32(cx * 31 + cz * 17 + k)();
      box(roomGroup, 0.1, 0.12, 0.1, '#6ba95a', x0 + 0.3 + r * (C - 0.6), 0.06, z0 + 0.3 + ((r * 7) % 1) * (C - 0.6));
    }
  }

  const furnRT = new Map();
  let furnMap = new Map();
  function rebuildFurniture() {
    furnGroup.clear();
    furnRT.clear();
    furnMap = new Map();
    for (const f of home().furniture) {
      const g = ART.buildItem(f.type);
      g.position.set(f.i + 0.5, 0, f.j + 0.5);
      g.rotation.y = (f.rot || 0) * Math.PI / 2;
      g.userData.f = f;
      g.userData.on = f.on;
      g.userData.filled = !!f.gift;
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
    const b = home().build;
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
  // Places to walk: the park and the places that unlock later.
  // Each place is built the first time you go there. place === 'park' means "out on a walk";
  // loc says where.
  // =====================================================================
  const scenes = {};
  function sceneOf(id) {
    if (!scenes[id]) {
      const root = pivot(world);
      root.visible = false;
      scenes[id] = Object.assign({ id, root }, ART.buildLocation(id, root));
    }
    return scenes[id];
  }
  let loc = 'park';
  let S = null, parkColliders = [], sniffSpots = [], parkWater = null;
  function useScene(id) {
    if (S) S.root.visible = false;
    loc = D.LOCATIONS[id] ? id : 'park';
    S = sceneOf(loc);
    parkRoot = S.root;
    parkColliders = S.colliders;
    sniffSpots = S.spots;
    parkWater = S.water;
  }
  useScene('park');
  const LOC = () => D.LOCATIONS[loc] || D.LOCATIONS.park;
  const inPond = (x, z, m = 0) => S.ponds.some((p) => x > p.x0 - m && x < p.x1 + m && z > p.z0 - m && z < p.z1 + m);
  const onPath = (x, z) => S.onPath(x, z);
  const locUnlocked = (id) => id === 'park' || (state.unlocked || []).includes(id);
  // what kind of dirt a walk here gives right now
  function walkDirt() {
    const W = localWeather(), Dd = LOC().dirt;
    if (W.precip === 'snow' && Dd.snow) return Dd.snow;
    return W.muddy ? Dd.wet : Dd.dry;
  }
  function addDirt(d, kind, n) {
    d.clean = Math.max(0, d.clean - n);
    d.dirt[kind] = (d.dirt[kind] || 0) + n;
  }
  function mainDirt(d) {
    let best = 'mud', bv = 0;
    for (const [k, v] of Object.entries(d.dirt)) if (v > bv && D.DIRT[k]) { bv = v; best = k; }
    return best;
  }

  let parkLoot = null;
  // toys that can turn up here: the place's own find-only toys plus ordinary shop toys
  function rollToy(where = loc) {
    const list = Object.entries(D.TOYS).filter(([, t]) => t.weight && (t.loc ? t.loc.includes(where) : !t.vendor));
    let r = Math.random() * list.reduce((s, [, t]) => s + t.weight, 0);
    for (const [k, t] of list) { r -= t.weight; if (r <= 0) return k; }
    return list.length ? list[0][0] : 'tennis';
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
    if (S.solid && S.solid(x, z)) return true;
    for (const c of parkColliders) {
      if (c.r !== undefined) { if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true; }
      else if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
    }
    return quirkSolid(x, z);
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
      const [cx, cz] = pick(home().chunks);
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
    if (place === 'park') { walkEarn += n; progress('walkcoins', n); }
    if (pos) spawnEmoji('🪙', pos.clone().add(new V3(0, 1.2, 0)), { size: 0.45, vy: 1.1 });
    updateHud();
  }

  // =====================================================================
  // Player
  // =====================================================================
  const player = Object.assign(ART.buildPlayer(), { moveTarget: null, phase: 0, blend: 0, face: 0, throwT: 0 });
  world.add(player.root);
  // a lantern glow around you in dark places
  const playerLight = new THREE.PointLight(0xffe2b0, 2.2, 16, 1.2);
  playerLight.position.set(0, 1.8, 0.4);
  playerLight.visible = false;
  player.root.add(playerLight);

  const keys = {};
  window.addEventListener('keydown', (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  const joy = { active: false, x: 0, y: 0 };
  const camOffsetDir = new V3(0.42, 1.15, 1).normalize();
  const camFwd = new V3(-camOffsetDir.x, 0, -camOffsetDir.z).normalize();
  const camRight = new V3().crossVectors(camFwd, new V3(0, 1, 0)).normalize();

  function updatePlayer(dt) {
    if (quirk.sled) return; // sledding moves you
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
      const goal = player.moveTarget;
      let tgt = goal;
      if (place === 'home') {
        // walk around furniture instead of bumping into it
        if (player.pathFor !== goal) { player.path = findPath(pos, goal); player.pathFor = goal; }
        while (player.path.length > 1 && Math.hypot(player.path[0].x - pos.x, player.path[0].z - pos.z) < 0.25) player.path.shift();
        tgt = player.path[0] || goal;
      }
      const d = Math.hypot(goal.x - pos.x, goal.z - pos.z);
      const dx = tgt.x - pos.x, dz = tgt.z - pos.z, dt2 = Math.hypot(dx, dz) || 1;
      if (d < 0.12) player.moveTarget = null;
      else { mx = dx / dt2; mz = dz / dt2; mag = 1; }
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
      walkTotal += moved;
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
      this.dirt = { mud: 0, grass: 0 };
      for (const [k, v] of Object.entries(data.dirt || {})) if (D.DIRT[k] && v > 0) this.dirt[k] = v;
      this.favToy = D.TOYS[data.favToy] ? data.favToy : null;
      this.favLast = data.favLast || 0;
      this.othersSince = data.othersSince || 0;
      this.toyPlays = Object.assign({}, data.toyPlays);
      this.recentPlays = Object.assign({}, data.recentPlays);
      this.lastToys = Array.isArray(data.lastToys) ? data.lastToys.slice(-3) : [];
      this.rest = Object.assign({}, data.rest);
      this.favSpot = data.favSpot || null;
      this.acc = {};
      for (const [slot, id] of Object.entries(data.acc || {})) if (D.ACCESSORIES[id] && D.ACCESSORIES[id].slot === slot) this.acc[slot] = id;
      this.accParts = [];
      this.tricks = {};
      for (const [k, v] of Object.entries(data.tricks || {})) if (ALL_TRICKS[k] && v > 0) this.tricks[k] = v;
      this.offLeash = false;
      this.returning = false;
      this.partner = null;
      this.trickId = null;
      this.spinY = undefined;

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
      this.applyAccessories();
    }
    applyAccessories() {
      for (const g of this.accParts) if (g.parent) g.parent.remove(g);
      this.accParts = [];
      for (const id of Object.values(this.acc)) this.accParts.push(...ART.buildAccessory(id, this));
    }

    serialize() {
      const r = (v) => Math.round(v * 10) / 10;
      return {
        id: this.id, name: this.name, breed: this.breed, coat: this.coat, traits: this.traits, revealed: this.revealed, bond: this.bond,
        born: this.born, grown: this.grown,
        hunger: r(this.hunger), thirst: r(this.thirst), energy: r(this.energy), happy: r(this.happy), clean: r(this.clean),
        dirt: Object.fromEntries(Object.entries(this.dirt).filter(([, v]) => v >= 0.05).map(([k, v]) => [k, r(v)])),
        favToy: this.favToy, favLast: this.favLast, othersSince: this.othersSince, toyPlays: this.toyPlays, recentPlays: this.recentPlays,
        lastToys: this.lastToys, rest: this.rest, favSpot: this.favSpot, tricks: this.tricks, acc: this.acc,
      };
    }

    // ----- tricks & leash -----
    trickLvl(id) { return trickLevelOf(this.tricks[id] || 0); }
    obedience() { return Object.keys(ALL_TRICKS).reduce((s, id) => s + this.trickLvl(id), 0); }
    leashHand() { return player.hand; }
    onLeash() { return place === 'park' && !this.offLeash && !this.returning && this.state !== 'fetch' && this.state !== 'return'; }

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
      const W = place === 'park' ? localWeather() : curWeather();
      const pup = this.isPuppy();
      if (place === 'park') {
        const R = D.NEEDS.park, X = LOC().needs || {};
        this.hunger -= R.hunger * this.mod('hunger') * (X.hunger || 1) * dt;
        this.thirst -= R.thirst * (X.thirst || 1) * dt;
        this.energy -= R.energy * this.mod('energy') * this.mod('walkEnergy') * (pup ? 1.3 : 1) * (X.energy || 1) * dt;
        const coat = this.acc.body && D.ACCESSORIES[this.acc.body].rainproof && W.precip ? 0.5 : 1;
        const rate = R.clean * this.mod('dirt') * (W.muddy ? D.NEEDS.rainDirt : 1) * (W.precip === 'snow' ? 1.3 : 1) * coat * dt;
        this.clean -= rate;
        const k = walkDirt();
        this.dirt[k] = (this.dirt[k] || 0) + rate;
        let joy = this.energy > CRITICAL ? R.happyGain * this.mod('walkJoy') : 0;
        if (W.precip === 'rain' && this.flag('rainJoy')) joy += 0.15;
        if (W.lightning && this.flag('stormFear')) joy -= 0.25;
        this.happy += joy * dt;
      } else {
        const R = D.NEEDS.home;
        this.hunger -= R.hunger * this.mod('hunger') * dt;
        this.thirst -= R.thirst * dt;
        const cozy = (this.claim && D.ITEMS[this.claim.type] && D.ITEMS[this.claim.type].regen || 1) * (nearLitFire(this.root.position) ? 1.5 : 1);
        if (this.state === 'sleep') this.energy += R.sleepRegen * cozy * dt;
        else if (this.state === 'lounge' || this.state === 'hide') this.energy += R.loungeRegen * cozy * dt;
        else this.energy -= R.energy * this.mod('energy') * (pup ? 1.4 : 1) * dt;
        this.clean -= R.clean * dt;
        const pos = this.root.position;
        if (W.precip && isGardenTile(Math.floor(pos.x), Math.floor(pos.z))) {
          const g = 0.03 * dt * (this.acc.body && D.ACCESSORIES[this.acc.body].rainproof ? 0.5 : 1);
          this.clean -= g;
          this.dirt[W.muddy ? 'mud' : 'grass'] += g;
        }
        const needy = this.hunger < LOW || this.thirst < LOW || this.energy < CRITICAL;
        let decay = needy ? R.needyDecay : R.happyDecay;
        if (this.clean < 50) decay += 0.04 * this.mod('dirtMood');
        if (this.flag('lonely')) decay += dogs.length === 1 ? 0.05 : -0.04;
        if (this.state === 'hide') decay += 0.05;
        if (this.state === 'lounge') decay -= 0.05;
        if (W.precip === 'rain' && this.flag('rainJoy')) decay -= 0.03;
        decay -= D.COMFORT_BONUS * (comfort.paws - 1);
        if (musicOn()) decay -= 0.03;
        if (this.state === 'watch') decay -= 0.04 * (this.flag('lounges') ? 2 : 1);
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
      const m = ART.dirtMaterial(mainDirt(this));
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
        case 'attend': return 'Watching you closely 👀';
        case 'watch': return 'Watching TV 📺';
        case 'bath': return 'Splish splash 🛁';
        case 'playtoy': return 'Playing with a toy 🧸';
        case 'trick': return `Doing ${ALL_TRICKS[this.trickId] ? ALL_TRICKS[this.trickId].name : 'a trick'}`;
        case 'confused': return 'Confused ❓';
        case 'roam': return 'Exploring off-leash 🐾';
        case 'play': return `Playing with ${this.partner ? this.partner.name : 'a friend'} 💕`;
        case 'greet': return `Saying hi to ${this.partner ? this.partner.name : 'a dog'}`;
        case 'scuffle': return `Grumbling at ${this.partner ? this.partner.name : 'a dog'} 💢`;
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
      if (this.spinY !== undefined) this.root.rotation.y = this.spinY;
      else this.root.rotation.y = angleLerp(this.root.rotation.y, this.face, damp(0.0004, dt));
      this.animate(dt);
      this.updateBubble();
    }

    updateState(dt) {
      switch (this.state) {
        case 'idle':
          if (tm && tm.dog === this) { this.setState('attend'); break; }
          this.timer -= dt;
          if (this.timer <= 0) this.decide();
          else if (player.root.position.distanceTo(this.root.position) < 3) this.faceTo(player.root.position);
          break;
        case 'follow': this.updateFollow(dt); break;
        case 'roam': this.updateRoam(dt); break;
        case 'attend':
          this.faceTo(player.root.position);
          if (!tm || tm.dog !== this) this.idle();
          break;
        case 'trick': this.updateTrick(dt); break;
        case 'confused':
          this.timer -= dt;
          if (this.timer <= 0) this.afterTrick();
          break;
        case 'play': this.updatePlay(dt); break;
        case 'greet':
        case 'scuffle':
          this.timer -= dt;
          if (this.partner) this.faceTo(this.partner.root.position);
          if (this.state === 'scuffle' && Math.random() < dt * 3) spawnEmoji('💢', this.headWorld(0.35), { size: 0.3, life: 0.7 });
          if (this.timer <= 0) this.finishEncounter();
          break;
        case 'move': this.updateMove(dt); break;
        case 'sit':
        case 'lounge':
        case 'watch':
        case 'playtoy':
          this.timer -= dt;
          if (this.state === 'watch' && !home().furniture.some((f) => f.type === 'tv' && f.on)) this.timer = 0;
          if (this.state === 'playtoy' && Math.random() < dt * 1.2) spawnEmoji('🧸', this.headWorld(0.3), { size: 0.3, life: 0.8 });
          if (this.timer <= 0) this.idle();
          break;
        case 'bath':
          this.faceTo(player.root.position);
          break;
        case 'stay': // waiting at a red light
          this.faceTo(player.root.position);
          if (this.stateTime > 25 || place !== 'park') this.idle();
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
        // friends nap side by side
        const buddy = dogs.find((o) => o !== this && o.state === 'sleep' && friendship(this.id, o.id) >= D.FRIEND_LEVEL);
        const beside = buddy && besideTile(buddy.root.position);
        if (beside) {
          this.goTo(beside, 1.8, () => { this.setState('sleep'); this.zTimer = 0.5; spawnEmoji('💕', this.headWorld(0.3), { size: 0.35 }); }, 0.25);
          return;
        }
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
      const tv = home().furniture.find((f) => f.type === 'tv' && f.on);
      if (tv && Math.random() < (this.flag('lounges') ? 0.4 : 0.12)) {
        const spot = frontOf(tv);
        if (spot) { this.goTo(spot, 1.6, () => { this.faceTo(tileCenter(tv)); this.setState('watch', rand(10, 18)); }, 0.3); return; }
      }
      const tb = home().furniture.find((f) => f.type === 'toybox');
      if (tb && !visit && state.clutter.filter((c) => c.kind === 'toy').length < D.CLUTTER_MAX && Math.random() < 0.07) {
        const spot = frontOf(tb);
        if (spot) { this.goTo(spot, 2, () => pullToyOut(this, tb), 0.45); return; }
      }
      if (this.flag('digs') && !visit && Object.keys(state.gardens).length && Math.random() < 0.12) {
        const t = randomGardenPoint();
        if (t) { this.goTo(t, 2, () => this.setState('dig', 2), 0.3); return; }
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
      if (this.offLeash) { this.setState('roam'); return; }
      const pp = player.root.position, pos = this.root.position;
      if (this.returning && pos.distanceTo(pp) < 2.4) this.returning = false;
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
          this.goTo(edge, 3.2, () => { this.faceTo(edge.center); this.setState('splash', 1.8); }, 0.5);
          return;
        }
      }
      if (this.flag('digs') && Math.random() < 0.18 && !onPath(pos.x, pos.z) && !inPond(pos.x, pos.z, 1)) {
        this.spot = null;
        this.setState('dig', 2);
        return;
      }
      if (this.flag('zooms') && this.energy > 30 && Math.random() < 0.1) {
        this.zoomAngle = Math.atan2(pos.x - pp.x, pos.z - pp.z);
        this.setState('zoom', 3);
        return;
      }
      const spot = nearestSpot(pos, 4.5);
      if (spot && Math.random() < 0.6) this.visitSpot(spot, 3);
    }
    visitSpot(spot, speed) {
      spot.taken = this;
      this.spot = spot;
      this.goTo(spot.pos, speed, () => { this.spot = spot; this.faceTo(spot.pos); this.setState(spot.kind === 'dig' ? 'dig' : 'sniff', 2.2); }, 0.65);
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

    // ----- off-leash -----
    updateRoam(dt) {
      const pos = this.root.position, pp = player.root.position;
      const far = pos.distanceTo(pp);
      this.roamTimer = (this.roamTimer || 0) - dt;
      const t = this.roamTarget;
      if (!t || this.roamTimer <= 0 || Math.hypot(t.x - pos.x, t.z - pos.z) < 0.4 || far > 11) {
        this.roamTimer = rand(3, 6);
        this.roamTarget = null;
        if (far > 11) this.roamTarget = pp.clone();
        else {
          for (let k = 0; k < 12 && !this.roamTarget; k++) {
            const a = rand(0, TAU), r = rand(2, 7), x = pp.x + Math.sin(a) * r, z = pp.z + Math.cos(a) * r;
            if (inBounds(x, z, 0.5) && !isSolid(x, z) && !inPond(x, z, 0.6)) this.roamTarget = new V3(x, 0, z);
          }
        }
      }
      if (this.roamTarget) this.moveTowards(this.roamTarget.x, this.roamTarget.z, far > 11 ? 4 : 2.2, dt);
      this.sniffCheck -= dt;
      if (this.sniffCheck > 0) return;
      this.sniffCheck = rand(1.5, 3);
      const wb = parkWater.bowl;
      if (this.thirst < 65 && !parkWater.taken && pos.distanceTo(wb) < 9) {
        parkWater.taken = this;
        this.spot = parkWater;
        this.goTo(wb, 3, () => { this.spot = parkWater; this.faceTo(wb); this.setState('drink', 2.4); }, 0.45);
        return;
      }
      if (this.flag('splashes') && Math.random() < 0.35) {
        const edge = pondEdge(pos);
        if (edge && edge.distanceTo(pos) < 6) {
          this.goTo(edge, 3.2, () => { this.faceTo(edge.center); this.setState('splash', 1.8); }, 0.5);
          return;
        }
      }
      if (this.flag('digs') && Math.random() < 0.15 && !onPath(pos.x, pos.z) && !inPond(pos.x, pos.z, 1)) { this.spot = null; this.setState('dig', 2); return; }
      if (this.flag('zooms') && this.energy > 30 && Math.random() < 0.08) {
        this.zoomAngle = Math.atan2(pos.x - pp.x, pos.z - pp.z);
        this.setState('zoom', 3);
        return;
      }
      const spot = nearestSpot(pos, 6, true);
      if (spot && Math.random() < 0.5) this.visitSpot(spot, 2.6);
    }

    // ----- meeting other dogs -----
    updatePlay(dt) {
      this.timer -= dt;
      const c = this.encCenter;
      this.encAngle += dt * 3.4;
      if (c) this.moveTowards(c.x + Math.sin(this.encAngle) * 0.75, c.z + Math.cos(this.encAngle) * 0.75, 3.6, dt);
      if (Math.random() < dt * 1.5) spawnEmoji('💕', this.headWorld(0.3), { size: 0.3, life: 0.8 });
      if (this.timer <= 0) this.finishEncounter();
    }
    finishEncounter() {
      const was = this.state;
      this.partner = null;
      this.encCenter = null;
      if (was === 'scuffle' && this.flag('stormFear') && !this.npc) {
        if (place === 'home') { this.goTo(randomFreePoint(), 2.8, null, 0.3); return; }
        this.offLeash = false;
        this.returning = true;
      }
      this.idle();
    }

    // ----- tricks -----
    updateTrick(dt) {
      this.timer -= dt;
      const T = ALL_TRICKS[this.trickId];
      if (!T) { this.afterTrick(); return; }
      const p = clamp(1 - Math.max(0, this.timer) / T.dur, 0, 1);
      const pos = this.root.position;
      switch (this.trickId) {
        case 'come': {
          const pp = player.root.position;
          if (pos.distanceTo(pp) > 0.95) this.moveTowards(pp.x, pp.z, 3, dt);
          break;
        }
        case 'moonwalk': {
          const f = this.trickFace;
          moveWithCollision(pos, -Math.sin(f) * 0.6 * dt, -Math.cos(f) * 0.6 * dt, 0.22);
          this.moving = true;
          this.curSpeed = 1.2;
          this.spinY = f;
          break;
        }
        case 'spin': this.spinY = this.trickFace + p * TAU; break;
        case 'chase': this.spinY = this.trickFace + p * 3 * TAU; break;
        case 'dance': this.spinY = this.trickFace + Math.sin(p * TAU * 2) * 0.9; break;
        default: break;
      }
      if (this.timer <= 0) this.afterTrick();
    }
    afterTrick() {
      if (this.trickId && this.spinY !== undefined && this.trickId !== 'moonwalk') this.face = this.trickFace;
      this.trickId = null;
      this.spinY = undefined;
      if (tm && tm.dog === this) this.setState('attend');
      else this.idle();
    }

    applyLeash() {
      if (this.offLeash || this.returning || this.state === 'fetch' || this.state === 'return') return;
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
        if (D.ITEMS[bowl.type].auto) bowl.emptiedAt = Date.now();
        if (bowl.gourmet && roleOf(bowl) === 'food') {
          this.happy = Math.min(100, this.happy + 10 * bowl.gourmet * this.mod('mealJoy'));
          spawnEmoji('⭐', this.headWorld(0.5), { size: 0.4 });
          bowl.gourmet = 0;
        }
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
        walkLoot(this, spot);
        if (spot.kind === 'pine') addDirt(this, 'sap', 6);
        progress('sniff');
      }
      this.dropSpot();
      this.setState('follow');
    }
    finishDig() {
      if (place === 'home') { homeDig(this); return; }
      const spot = this.spot;
      if (spot && spot.kind === 'dig') { this.dropSpot(); (loc === 'moon' ? craterDig : beachDig)(this, spot); this.setState('follow'); return; }
      const pos = this.root.position;
      addDirt(this, walkDirt(), 5);
      this.happy = Math.min(100, this.happy + 6);
      const r = Math.random();
      if (r < D.RARE_FIND) findRare(pos);
      else if (r < 0.1) findIngredient(pos, LOC().ingredients);
      else if (r < 0.18) { const f = rollFind(loc); if (f) grantFind(f, pos); else addCoins(1, pos); }
      else if (r < 0.22) grantToy(rollToy(), pos);
      else if (r < 0.5) addCoins(1 + Math.floor(Math.random() * 2), pos);
      else spawnEmoji('🕳️', this.headWorld(-0.2), { size: 0.35, life: 0.9 });
      this.setState('follow');
    }
    finishSplash() {
      this.happy = Math.min(100, this.happy + 8);
      if (loc === 'beach') {
        addDirt(this, 'salt', 4);
        if (Math.random() < 0.35) addDirt(this, 'seaweed', 3);
      } else if (loc !== 'oldtown') addDirt(this, 'mud', 4);
      this.setState('follow');
    }
    finishTowel() {
      const before = this.clean;
      this.clean = Math.max(this.clean, Math.min(CONFIG.TOWEL_MAX, this.clean + CONFIG.TOWEL_AMOUNT));
      const keep = before < 100 ? (100 - this.clean) / Math.max(1, 100 - before) : 1;
      for (const k of Object.keys(this.dirt)) this.dirt[k] *= keep;
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
        const type = ball.type, snow = ball.snow;
        const def = D.TOYS[type] || D.TOYS.tennis;
        resetBall();
        this.path = null;
        const joy = snow ? 16 : this.playedWith(type);
        if (snow) addDirt(this, 'frost', 2);
        this.happy = Math.min(this.missing() ? CONFIG.MISS_CAP : 100, this.happy + joy);
        this.energy = Math.max(0, this.energy - 4);
        this.addBond(1);
        this.faceTo(pp);
        spawnEmoji(type === this.favToy && !snow ? '💞' : '❤️', this.headWorld(0.4), { size: 0.4 });
        const bonus = (place === 'park' ? 1 : 0) + (def.coins || 0);
        if (bonus) addCoins(bonus, this.root.position);
        progress('fetch');
        if (place === 'park') progress('fetch:' + loc);
        this.setState('happy', 1.4);
      }
    }

    pet() {
      this.happy = Math.min(this.missing() ? CONFIG.MISS_CAP : 100, this.happy + 12 * this.mod('petJoy'));
      this.addBond(1);
      progress('pet');
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
      if (st === 'sleep' || st === 'lounge' || st === 'hide' || st === 'watch') {
        poseY = -0.21; legT = [-1.45, -1.45, 1.45, 1.45]; headRX = 0.15; headY = hb - 0.06; posed = true;
        if (st === 'hide') bodyRZ = Math.sin(this.t * 40) * 0.03;
      } else if (st === 'sit' || st === 'bath' || st === 'stay') { poseY = -0.06; bodyRX = -0.5; legT = [0.5, 0.5, -1.1, -1.1]; headRX = 0.45; posed = true; }
      else if (st === 'eat') { headRX = 0.75 + Math.sin(this.t * 14) * 0.12; headY = hb - 0.06; }
      else if (st === 'drink') { headRX = 0.8 + Math.sin(this.t * 22) * 0.08; headY = hb - 0.06; }
      else if (st === 'sniff') { headRX = 0.6 + Math.sin(this.t * 22) * 0.06; }
      else if (st === 'dig') { headRX = 0.55; bodyRX = 0.2; legT = [Math.sin(this.t * 24) * 1.1, -Math.sin(this.t * 24) * 1.1, 0, 0]; posed = true; }
      else if (st === 'splash' || st === 'happy' || st === 'playtoy') { hop = Math.abs(Math.sin(this.t * 9)) * 0.18; headRX = -0.25; }
      else if (st === 'towel') { bodyRZ = Math.sin(this.t * 18) * 0.12; headRX = -0.15; }
      else if (st === 'attend') { poseY = -0.06; bodyRX = -0.5; legT = [0.5, 0.5, -1.1, -1.1]; headRX = 0.25 + Math.sin(this.t * 2) * 0.05; posed = true; }
      else if (st === 'confused') { poseY = -0.06; bodyRX = -0.5; legT = [0.5, 0.5, -1.1, -1.1]; headRX = 0.3; bodyRZ = Math.sin(this.t * 3) * 0.12; posed = true; }
      else if (st === 'greet') { headRX = 0.5 + Math.sin(this.t * 20) * 0.05; }
      else if (st === 'scuffle') { bodyRZ = Math.sin(this.t * 30) * 0.08; headRX = -0.2; hop = Math.abs(Math.sin(this.t * 12)) * 0.05; }
      else if (st === 'play') { hop = Math.abs(Math.sin(this.t * 10)) * 0.1; }
      else if (st === 'trick' && this.trickId) {
        const T = ALL_TRICKS[this.trickId];
        const p = clamp(1 - Math.max(0, this.timer) / T.dur, 0, 1);
        const SIT = () => { poseY = -0.06; bodyRX = -0.5; legT = [0.5, 0.5, -1.1, -1.1]; headRX = 0.15; posed = true; };
        const LIE = () => { poseY = -0.21; legT = [-1.45, -1.45, 1.45, 1.45]; headRX = -0.05; headY = hb - 0.04; posed = true; };
        const up = Math.sin(clamp(p * 1.25, 0, 1) * Math.PI);
        switch (this.trickId) {
          case 'sit': case 'stay': SIT(); break;
          case 'down': LIE(); break;
          case 'paw': SIT(); legT[1] = -1.5 * up; break;
          case 'highfive': SIT(); legT[1] = -2.5 * up; hop = 0.08 * up; break;
          case 'wave': SIT(); legT[1] = -2.1 + Math.sin(this.t * 14) * 0.45; break;
          case 'beg': poseY = -0.04; bodyRX = -1.05 * up; legT = [-1.4, -1.4, -1.3, -1.3]; headRX = 0.2; posed = true; break;
          case 'bow': bodyRX = 0.45 * up; legT = [-1.2 * up, -1.2 * up, 0, 0]; headRX = 0.25; headY = hb - 0.12 * up; posed = true; break;
          case 'jump': hop = Math.sin(p * Math.PI) * 0.75; bodyRX = -0.35 * Math.cos(p * Math.PI); legT = [-0.8, -0.8, 0.8, 0.8]; posed = true; break;
          case 'speak': headRX = -0.45 + Math.abs(Math.sin(this.t * 16)) * 0.25; break;
          case 'spin': case 'chase': hop = Math.abs(Math.sin(this.t * 14)) * 0.06; break;
          case 'shake': bodyRZ = Math.sin(this.t * 42) * 0.32 * (1 - p); break;
          case 'roll': LIE(); bodyRZ = p * TAU; break;
          case 'dead': LIE(); bodyRZ = clamp(p * 3, 0, 1) * Math.PI / 2; legT = [-0.2, -0.2, 0.2, 0.2]; headRX = 0.3; break;
          case 'handstand': bodyRX = 1.15 * up; legT = [-1.1 * up, -1.1 * up, 0.6 * up, 0.6 * up]; poseY = 0.12 * up; posed = true; break;
          case 'howl': SIT(); headRX = -1.0 * up; break;
          case 'dance': hop = Math.abs(Math.sin(this.t * 9)) * 0.22; legT = [Math.sin(this.t * 9) * 0.9, -Math.sin(this.t * 9) * 0.9, 0, 0]; bodyRX = -0.35; posed = true; break;
          default: break;
        }
      }
      if (this.tumbleT > 0) bodyRZ = Math.sin((0.7 - this.tumbleT) / 0.7 * Math.PI) * 1.3;

      this.poseY = lerp(this.poseY, poseY, k);
      if (place === 'park' && LOC().lowGravity) hop += Math.abs(Math.sin(this.phase * 0.5)) * 0.3 * this.walkBlend; // bouncy moon steps
      this.body.position.y = this.poseY + Math.abs(Math.sin(this.phase)) * 0.05 * this.walkBlend + hop;
      this.body.rotation.x = lerp(this.body.rotation.x, bodyRX, k);
      const snapZ = this.tumbleT > 0 || ['towel', 'hide', 'confused', 'scuffle'].includes(st) || (st === 'trick' && ['shake', 'roll', 'dead'].includes(this.trickId));
      this.body.rotation.z = snapZ ? bodyRZ : lerp(this.body.rotation.z, 0, k * 2);
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
      this.tongue.visible = st === 'happy' || st === 'drink' || st === 'zoom' || st === 'play' || st === 'attend' || this.zoomLeft > 0 || (this.moving && this.curSpeed > 3 && st !== 'return');
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
      const show = this.onLeash();
      this.leash.visible = show;
      if (!show) return;
      const A = this.leashHand().getWorldPosition(tmpA);
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
    for (const f of home().furniture) {
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
    for (const f of home().furniture) {
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
  function nearestSpot(pos, maxD, anywhere) {
    let best = null, bd = maxD;
    for (const s of sniffSpots) {
      if (s.cooldown > 0 || s.taken || s.active === false) continue;
      const d = pos.distanceTo(s.pos);
      if (d < bd && (anywhere || s.pos.distanceTo(player.root.position) < 4.2)) { bd = d; best = s; }
    }
    return best;
  }
  function besideTile(pos) {
    const i = Math.floor(pos.x), j = Math.floor(pos.z);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (!passable(ni, nj)) continue;
      if (dogs.some((d) => Math.floor(d.root.position.x) === ni && Math.floor(d.root.position.z) === nj)) continue;
      return new V3(ni + 0.5, 0, nj + 0.5);
    }
    return null;
  }
  // the closest point at the edge of any water to splash in (with .center = the water just beyond)
  function pondEdge(pos) {
    let best = null, bd = Infinity;
    for (const P of S.ponds) {
      const ex = clamp(pos.x, P.x0, P.x1), ez = clamp(pos.z, P.z0, P.z1);
      const dx = pos.x - ex, dz = pos.z - ez, d = Math.hypot(dx, dz);
      if (d < 1e-3 || d >= bd) continue;
      bd = d;
      best = new V3(ex + (dx / d) * 0.35, 0, ez + (dz / d) * 0.35);
      best.center = new V3(ex - (dx / d) * 0.5, 0, ez - (dz / d) * 0.5);
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
  function newDogData(name, breed, coat, primary) {
    return { id: newId(), name, breed, coat, traits: randomTraits(primary), revealed: false, bond: 0, born: Date.now(), grown: false,
      hunger: 90, thirst: 90, energy: 90, happy: 80, clean: 95, tricks: {} };
  }

  // =====================================================================
  // Friendships
  // =====================================================================
  const friendship = (a, b) => state.friends[pairKey(a, b)] || 0;
  function addFriendship(a, b, n) {
    const k = pairKey(a.id, b.id);
    const before = state.friends[k] || 0;
    const v = clamp(before + n, 0, 100);
    state.friends[k] = Math.round(v * 10) / 10;
    if (before < D.FRIEND_LEVEL && v >= D.FRIEND_LEVEL) {
      toast(`💕 ${a.name} and ${b.name} are friends now!`);
      for (const d of [a, b]) if (d.ui) refreshCardStatic(d);
    }
  }
  // how well two personalities click (can be negative, never blocks a friendship)
  function compat(a, b) {
    let s = 0;
    a.traits.forEach((ta, i) => b.traits.forEach((tb, j) => {
      const w = (i ? 0.5 : 1) * (j ? 0.5 : 1);
      let v = D.COMPAT[[ta, tb].sort().join('|')];
      if (v === undefined) v = (D.COMPAT[ta + '|*'] || 0) + (D.COMPAT[tb + '|*'] || 0);
      s += v * w;
    }));
    return s;
  }
  function dogNameById(id) {
    const own = dogs.find((d) => d.id === id);
    if (own) return own.name;
    const n = D.NEIGHBORS.find((x) => 'n:' + x.dog.name === id);
    return n ? `${n.dog.name} (${n.owner}'s dog)` : null;
  }
  function bestFriend(d) {
    let best = null, bv = 0;
    for (const [k, v] of Object.entries(state.friends)) {
      const ids = k.split('|');
      if (!ids.includes(d.id) || v <= bv) continue;
      const other = ids[0] === d.id ? ids[1] : ids[0];
      const name = dogNameById(other);
      if (name) { best = name; bv = v; }
    }
    return best ? { name: best, value: bv } : null;
  }
  const FREE_FOR_MEETING = ['follow', 'roam', 'idle', 'sit'];
  function startEncounter(a, b) {
    const fr = friendship(a.id, b.id);
    let s = compat(a, b) + fr / 25 + rand(-1.5, 1.5);
    if (a.flag('social') || b.flag('social')) s += 0.5;
    const kind = s >= 1 ? 'play' : s >= -0.8 ? 'greet' : 'scuffle';
    const dur = kind === 'play' ? 3 : kind === 'greet' ? 2 : 1.6;
    const pa = a.root.position, pb = b.root.position;
    const center = new V3((pa.x + pb.x) / 2, 0, (pa.z + pb.z) / 2);
    const ang = Math.atan2(pa.x - center.x, pa.z - center.z);
    [[a, b, ang], [b, a, ang + Math.PI]].forEach(([d, o, an]) => {
      d.releaseClaim();
      d.dropSpot();
      d.onArrive = null;
      d.path = null;
      d.zoomLeft = 0;
      d.partner = o;
      d.encCenter = center;
      d.encAngle = an;
      d.setState(kind, dur);
      if (d.walker) d.walker.pause = Math.max(d.walker.pause, dur + 0.6);
    });
    encCooldown.set(pairKey(a.id, b.id), animT + 25);
    const mine = [a, b].filter((d) => !d.npc);
    if (kind === 'play') {
      addFriendship(a, b, 8);
      mine.forEach((d) => { d.happy = Math.min(100, d.happy + 10); });
      if (mine.length) progress('play');
    } else if (kind === 'greet') {
      addFriendship(a, b, 3);
      mine.forEach((d) => { d.happy = Math.min(100, d.happy + 3); });
      spawnEmoji('👃', center.clone().add(new V3(0, 1, 0)), { size: 0.4 });
    } else {
      addFriendship(a, b, -4);
      mine.forEach((d) => {
        d.happy = Math.max(0, d.happy - 8);
        if (place === 'park') addDirt(d, walkDirt(), 4);
      });
    }
  }
  function checkEncounters() {
    if (mode === 'trick') return;
    const ready = (a, b) => (encCooldown.get(pairKey(a.id, b.id)) || 0) < animT;
    if (place === 'park') {
      for (const d of dogs) {
        if (!['follow', 'roam'].includes(d.state) || d.returning) continue;
        for (const w of walkers) {
          const n = w.dog;
          if (n.state !== 'follow' || !ready(d, n)) continue;
          const dist = d.root.position.distanceTo(n.root.position);
          if (dist < (d.offLeash ? 2.0 : 1.4) && Math.random() < (d.offLeash ? 0.6 : 0.35)) { startEncounter(d, n); return; }
        }
      }
    } else if (mode === 'normal') {
      for (let i = 0; i < dogs.length; i++) {
        for (let j = i + 1; j < dogs.length; j++) {
          const a = dogs[i], b = dogs[j];
          if (!FREE_FOR_MEETING.includes(a.state) || !FREE_FOR_MEETING.includes(b.state) || !ready(a, b)) continue;
          if (a.root.position.distanceTo(b.root.position) < 3 && Math.random() < 0.08) { startEncounter(a, b); return; }
        }
      }
    }
  }

  // =====================================================================
  // Neighbors walking their dogs in the park
  // =====================================================================
  class NPCDog extends Dog {
    constructor(data, walker) {
      super(Object.assign({ born: Date.now() - 400 * DAY, grown: true, revealed: true, happy: 85, hunger: 90, thirst: 90, energy: 90, clean: 90 }, data));
      this.walker = walker;
      this.npc = true;
      const label = textSprite(this.name, 0.3);
      label.position.y = this.headBaseY + 0.62;
      this.root.add(label);
    }
    tickNeeds() { /* neighbors' dogs are always fine */ }
    addBond() { /* not yours */ }
    updateBubble() { /* no need bubbles */ }
    leashHand() { return this.walker.parts.hand; }
    onLeash() { return place === 'park'; }
    applyLeash() {
      const wp = this.walker.parts.root.position, pos = this.root.position;
      const dx = pos.x - wp.x, dz = pos.z - wp.z, d = Math.hypot(dx, dz), L = 2.8;
      if (d > L) { pos.x = wp.x + (dx / d) * L; pos.z = wp.z + (dz / d) * L; this.moving = true; this.curSpeed = 2.5; }
    }
    updateState(dt) {
      if (this.state === 'play') { this.updatePlay(dt); return; }
      if (this.state === 'greet' || this.state === 'scuffle') { super.updateState(dt); return; }
      if (this.state !== 'follow') this.setState('follow');
      const w = this.walker.parts.root;
      const a = w.rotation.y + Math.PI + 0.5;
      const tx = w.position.x + Math.sin(a) * 1.2, tz = w.position.z + Math.cos(a) * 1.2;
      const d = Math.hypot(tx - this.root.position.x, tz - this.root.position.z);
      if (d > 0.35) this.moveTowards(tx, tz, d > 1.8 ? 3.2 : 1.6, dt);
    }
  }
  // neighbors walk around the place's square path (S.loop: half width x, north z0, south z1)
  function loopPoint(t) {
    const Lp = S.loop, w = 2 * Lp.x, h = Lp.z1 - Lp.z0, per = 2 * (w + h);
    t = ((t % per) + per) % per;
    if (t < w) return [-Lp.x + t, Lp.z0];
    if (t < w + h) return [Lp.x, Lp.z0 + (t - w)];
    if (t < 2 * w + h) return [Lp.x - (t - w - h), Lp.z1];
    return [-Lp.x, Lp.z1 - (t - 2 * w - h)];
  }
  const loopLength = () => 2 * (2 * S.loop.x + S.loop.z1 - S.loop.z0);
  function clearWalkers() {
    for (const w of walkers) {
      parkRoot.remove(w.parts.root);
      parkRoot.remove(w.dog.root);
      world.remove(w.dog.leash);
    }
    walkers.length = 0;
  }
  function spawnWalkers() {
    clearWalkers();
    const [lo, hi] = LOC().walkers || [3, 5];
    const W = curWeather();
    // fewer neighbors are out in bad weather or at night
    const fewer = (W.lightning ? 3 : W.precip ? 1 : 0) + (nightLevel > 0.5 ? 1 : 0);
    const count = Math.max(W.lightning ? 0 : 1, lo + Math.floor(Math.random() * (hi - lo + 1)) - fewer);
    for (const info of shuffle(D.NEIGHBORS).slice(0, count)) {
      const parts = ART.buildPlayer({ shirt: info.shirt, hair: info.hair });
      parkRoot.add(parts.root);
      const w = { info, parts, t: rand(0, loopLength()), dir: pick([1, -1]), speed: rand(0.9, 1.3), pause: 0, met: false, phase: 0 };
      const [x, z] = loopPoint(w.t);
      parts.root.position.set(x, 0, z);
      const dog = new NPCDog(Object.assign({ id: 'n:' + info.dog.name }, info.dog), w);
      dog.root.position.set(x + 0.8, 0, z + 0.8);
      dog.setState('follow');
      parkRoot.add(dog.root);
      w.dog = dog;
      walkers.push(w);
    }
  }
  function updateWalkers(dt) {
    const pp = player.root.position;
    for (const w of walkers) {
      const pos = w.parts.root.position;
      let moved = 0;
      const [ax, az] = loopPoint(w.t + w.dir * w.speed * dt * 8);
      if (w.pause > 0) w.pause -= dt;
      else if (quirkSolid(ax, az) && !quirkSolid(pos.x, pos.z)) { /* neighbors wait for green too */ }
      else {
        w.t += w.dir * w.speed * dt;
        const [x, z] = loopPoint(w.t);
        moved = Math.hypot(x - pos.x, z - pos.z);
        pos.set(x, 0, z);
        const [nx, nz] = loopPoint(w.t + w.dir * 0.6);
        w.parts.root.rotation.y = angleLerp(w.parts.root.rotation.y, Math.atan2(nx - x, nz - z), damp(0.002, dt));
      }
      w.phase += moved * 4.2;
      const s = Math.sin(w.phase) * 0.6 * (moved > 0 ? 1 : 0);
      w.parts.legL.rotation.x = s;
      w.parts.legR.rotation.x = -s;
      w.parts.armL.rotation.x = -s * 0.8;
      w.parts.armR.rotation.x = -0.45;
      if (!w.met && pos.distanceTo(pp) < 2.2) { w.met = true; neighborGift(w); }
      w.dog.update(dt);
      w.dog.updateLeash();
    }
  }
  function neighborGift(w) {
    const friends = dogs.some((d) => friendship(d.id, w.dog.id) >= D.FRIEND_LEVEL);
    if (Math.random() > D.GIFT_CHANCE + (friends ? D.GIFT_FRIEND_BONUS : 0)) return;
    w.pause = Math.max(w.pause, 2.5);
    const at = w.parts.root.position.clone();
    let r = Math.random() * D.GIFTS.reduce((s, g) => s + g.weight, 0);
    let g = D.GIFTS[0];
    for (const x of D.GIFTS) { r -= x.weight; if (r <= 0) { g = x; break; } }
    const who = w.info.owner;
    spawnEmoji('🎁', at.clone().add(new V3(0, 1.8, 0)), { size: 0.55, life: 1.6, vy: 0.5 });
    if (g.kind === 'toy') {
      const type = rollToy();
      toast(`🎁 ${who} has a present for you…`);
      setTimeout(() => grantToy(type, at), 900);
      return;
    }
    if (g.kind === 'item') {
      const t = pick(Object.keys(D.ITEMS));
      state.inventory[t] = (state.inventory[t] || 0) + 1;
      toast(`🎁 ${who} gave you a ${D.ITEMS[t].icon} ${D.ITEMS[t].name}! Place it in 🎨 Decorate`);
      save();
      return;
    }
    if (g.kind === 'ingredient') {
      const k = rollWeighted(D.INGREDIENTS), I = D.INGREDIENTS[k];
      state.pantry[k] = (state.pantry[k] || 0) + 1;
      toast(`🎁 ${who} gave you ${I.icon} ${I.name} from their garden!`);
      save();
      return;
    }
    if (g.kind === 'meal') {
      const id = pick(Object.keys(D.RECIPES).filter((r) => r !== 'gourmet')), R = D.RECIPES[id];
      state.meals.push({ id, q: 2 });
      toast(`🎁 ${who} baked ${R.icon} ${R.name} for your dogs!`);
      save();
      return;
    }
    if (g.kind === 'souvenir') {
      // a find from any place, even one you haven't been to yet
      const opts = Object.keys(D.FINDS).filter((k) => !D.FINDS[k].secret && D.FINDS[k].weight > 0);
      const k = pick(opts), F = D.FINDS[k], P = D.LOCATIONS[F.loc];
      toast(`🎁 ${who} brought you a souvenir from ${P.name}…`);
      setTimeout(() => grantFind(k, at), 900);
      return;
    }
    if (g.kind === 'vendor') {
      // something a vendor somewhere else sells
      const opts = [];
      for (const V of Object.values(D.VENDORS)) for (const [kind, key] of V.stock) if (kind === 'shampoo' || kind === 'meal' || (kind === 'acc' && !state.accessories.includes(key))) opts.push([kind, key, V]);
      const [kind, key, V] = pick(opts);
      if (kind === 'shampoo') { state.shampoos[key] = (state.shampoos[key] || 0) + 1; toast(`🎁 ${who} gave you ${D.SHAMPOOS[key].icon} ${D.SHAMPOOS[key].name} from the ${V.name}!`); }
      else if (kind === 'meal') { state.meals.push({ id: key, q: 2 }); toast(`🎁 ${who} brought ${D.RECIPES[key].icon} ${D.RECIPES[key].name} from the ${V.name}!`); }
      else { state.accessories.push(key); toast(`🎁 ${who} gave you a ${D.ACCESSORIES[key].icon} ${D.ACCESSORIES[key].name} from the ${V.name}! Dress up via 👒 Style`); }
      save();
      return;
    }
    if (g.kind === 'luxury' || g.kind === 'rare') {
      const k = pick(Object.keys(D.ITEMS).filter((t) => D.ITEMS[t][g.kind]));
      state.inventory[k] = (state.inventory[k] || 0) + 1;
      if (g.kind === 'rare') seeRare(k);
      toast(`🎁 Wow! ${who} gave you a ${g.kind === 'rare' ? 'rare ' : ''}${D.ITEMS[k].icon} ${D.ITEMS[k].name}!`);
      confetti(at.clone().add(new V3(0, 1, 0)));
      save();
      return;
    }
    if (g.kind === 'style') {
      const options = [...Object.keys(D.WALLS), ...Object.keys(D.FLOORS)].filter((id) => !state.styles.includes(id));
      if (options.length) {
        const id = pick(options), def = D.WALLS[id] || D.FLOORS[id];
        state.styles.push(id);
        toast(`🎁 ${who} gave you their old ${def.name} ${D.WALLS[id] ? 'wallpaper' : 'floor'}!`);
        save();
        return;
      }
    }
    const n = (g.min || 5) + Math.floor(Math.random() * ((g.max || 15) - (g.min || 5) + 1));
    addCoins(n, at);
    toast(`🎁 ${who} slipped you 🪙 ${n} for treats!`);
  }

  // =====================================================================
  // Off-leash
  // =====================================================================
  function leashButton() {
    if (dogs.some((d) => d.offLeash)) recallDogs();
    else unleashDogs();
    refreshLeashBtn();
  }
  function unleashDogs() {
    const ok = dogs.filter((d) => d.trickLvl('come') >= CONFIG.OFFLEASH_COME_LEVEL);
    if (!ok.length) {
      toast(`Teach 📣 Come up to level ${CONFIG.OFFLEASH_COME_LEVEL} in 🎓 Trick Mode first`);
      return;
    }
    for (const d of ok) {
      if (d.state === 'fetch' || d.state === 'return') continue;
      d.offLeash = true;
      d.returning = false;
      if (d.state === 'follow') d.setState('roam');
    }
    const names = ok.map((d) => d.name).join(' & ');
    const left = dogs.length - ok.length;
    toast(`🔓 ${names} ${ok.length > 1 ? 'are' : 'is'} off the leash!${left ? ' (The others need to learn 📣 Come first.)' : ''} Tap 📣 Come to call them back.`);
  }
  function recallDogs() {
    const out = dogs.filter((d) => d.offLeash);
    const stay = [];
    for (const d of out) {
      const lvl = d.trickLvl('come');
      if (Math.random() < D.RECALL[lvl]) {
        d.offLeash = false;
        d.returning = true;
        d.tricks.come = (d.tricks.come || 0) + 0.5;
        progress('recall');
        if (!['fetch', 'return', 'eat', 'drink'].includes(d.state)) { d.dropSpot(); d.onArrive = null; d.setState('follow'); }
        spawnEmoji('📣', d.headWorld(0.4), { size: 0.4 });
      } else stay.push(d.name);
    }
    if (stay.length) toast(`${stay.join(' & ')} ${stay.length > 1 ? 'are' : 'is'} too busy sniffing — try again!`);
    else toast('Good dog! Back on the leash 🦮');
  }
  function refreshLeashBtn() {
    const any = dogs.some((d) => d.offLeash);
    const want = any ? 'come' : 'unleash';
    if ($('leashBtn').dataset.k === want) return;
    $('leashBtn').dataset.k = want;
    $('leashBtn').innerHTML = any ? `${IC('call', 'dIc')}<small>Come</small>` : `${IC('unleash', 'dIc')}<small>Unleash</small>`;
  }

  // =====================================================================
  // Trick Mode
  // =====================================================================
  const TF = D.TRICK_FOCUS;
  function enterTrickMode(d) {
    d = d || selected || dogs[0];
    if (!d || mode !== 'normal') return;
    if (d.state === 'hide') { toast(`${d.name} is too scared of the storm to focus ⛈️`); return; }
    if (d.energy < 8) { toast(`${d.name} is too tired for tricks 😴`); return; }
    if (d.state === 'fetch' || d.state === 'return') { toast('Wait until the game of fetch is over'); return; }
    if (d.state === 'sleep') d.wake();
    d.releaseClaim();
    d.dropSpot();
    d.zoomLeft = 0;
    d.onArrive = null;
    d.path = null;
    d.partner = null;
    if (d.offLeash) { d.offLeash = false; d.returning = true; }
    mode = 'trick';
    selected = d;
    towelTask = null;
    camFocus = null;
    player.moveTarget = null;
    let focus = TF.start;
    if (d.isPuppy()) focus *= 0.75;
    if (d.energy < 30) focus *= 0.7;
    if (place === 'park' && d.flag('stormFear')) focus *= 0.85;
    tm = { dog: d, focus, seq: [], taps: [], lastUp: 0, ptr: null };
    const pp = player.root.position;
    if (d.root.position.distanceTo(pp) > 1.9) {
      d.goTo(() => {
        const f = player.root.rotation.y;
        return new V3(pp.x + Math.sin(f) * 1.3, 0, pp.z + Math.cos(f) * 1.3);
      }, 3, () => d.setState('attend'), 0.5);
    } else d.setState('attend');
    $('tmPortrait').src = ART.portraitURL(d.breed, d.coat);
    $('tmName').textContent = d.name;
    $('tmSeq').textContent = ''; $('tmSeq').dataset.seq = '';
    $('tmHint').textContent = d.obedience() ? 'Swipe, tap, hold or draw a circle · the book lists every trick' : 'Try swiping down to ask for Sit · the book lists every trick';
    $('trickMode').classList.remove('hidden');
    refreshUI();
    if (place === 'park') refreshLeashBtn();
  }
  function exitTrickMode() {
    if (!tm) return;
    const d = tm.dog;
    tm = null;
    mode = 'normal';
    $('trickMode').classList.add('hidden');
    $('tmRing').className = '';
    if (['attend', 'trick', 'confused'].includes(d.state)) { d.trickId = null; d.spinY = undefined; d.idle(); }
    refreshUI();
    save();
  }
  function snapOut() {
    const d = tm.dog;
    exitTrickMode();
    toast(`${d.name} lost focus and wandered off 🦋`);
    spawnEmoji('💭', d.headWorld(0.4), { size: 0.45 });
    if (place === 'home') d.goTo(randomFreePoint(), 1.6, null, 0.3);
    else d.setState('follow');
  }
  function updateTrickMode(dt) {
    const d = tm.dog;
    let drain = TF.drain;
    if (d.flag('zooms')) drain *= 1.6;
    if (d.flag('quick')) drain *= 0.6;
    if (d.isPuppy()) drain *= 1.3;
    tm.focus -= drain * dt;
    $('focusFill').style.width = clamp(tm.focus, 0, 100) + '%';
    $('focusFill').className = tm.focus < 25 ? 'low' : '';
    const pp = player.root.position, dp = d.root.position;
    player.face = Math.atan2(dp.x - pp.x, dp.z - pp.z);
    if (tm.focus <= 0) { snapOut(); return; }
    if (!$('trickBook').classList.contains('hidden')) tm.focus += drain * dt; // reading the book pauses the clock
    if (tm.seq.length && !tm.ptr && performance.now() - tm.lastUp > 650) evaluateTrick();
  }
  function reqMet(d, req) {
    return Object.entries(req || {}).every(([id, lvl]) => d.trickLvl(id) >= lvl);
  }
  function evenRhythm(taps) {
    if (taps.length < 4) return false;
    const t = taps.slice(-4), gaps = [t[1] - t[0], t[2] - t[1], t[3] - t[2]];
    const mean = (gaps[0] + gaps[1] + gaps[2]) / 3;
    return mean > 120 && gaps.every((g) => Math.abs(g - mean) < mean * 0.25);
  }
  function evaluateTrick() {
    const d = tm.dog;
    const seq = tm.seq.join('');
    const taps = tm.taps.slice();
    tm.seq = [];
    tm.taps = [];
    setTimeout(() => { if (tm) $('tmSeq').textContent = ''; $('tmSeq').dataset.seq = ''; }, 500);
    if (d.state !== 'attend') return;
    const night = clockNow.hour >= 21 || clockNow.hour < 5;
    let id = null;
    for (const [k, T] of Object.entries(ALL_TRICKS)) {
      if (T.seq !== seq) continue;
      if (T.secret && ((T.night && !night) || (T.rhythm && !evenRhythm(taps)) || !reqMet(d, T.req))) continue;
      id = k;
      break;
    }
    if (!id) { confuse(d, TF.unknown); toast(`🤔 ${d.name} doesn't know what you mean`); return; }
    const T = ALL_TRICKS[id];
    const missing = (T.needs || []).filter((n) => d.trickLvl(n) < 1);
    if (missing.length) {
      confuse(d, TF.unknown);
      toast(`${d.name} needs to learn ${missing.map((n) => `${ALL_TRICKS[n].icon} ${ALL_TRICKS[n].name}`).join(' and ')} first`);
      return;
    }
    const lvl = d.trickLvl(id);
    let p = D.TRICK_SUCCESS[lvl] * (0.7 + 0.3 * clamp(tm.focus, 0, 100) / 100);
    if (d.isPuppy()) p *= 0.8;
    if (d.energy < 25) p *= 0.8;
    if (d.flag('quick')) p += 0.08;
    if (d.flag('stormFear')) p += place === 'home' ? 0.05 : -0.08;
    p = clamp(p, 0.05, 0.99);
    if (Math.random() < p) { performTrick(d, id); return; }
    if (lvl === 0) d.tricks[id] = (d.tricks[id] || 0) + 0.35;
    confuse(d, TF.fail);
    toast(lvl === 0 ? `${d.name} is trying to figure out ${T.secret ? 'what you want' : T.name}… keep practicing!` : `${d.name} almost got it — try again!`);
    if (Math.random() < D.TRICK_SNAP[lvl] * (d.isPuppy() ? 1.6 : 1)) setTimeout(() => { if (tm && tm.dog === d) snapOut(); }, 700);
  }
  function confuse(d, cost) {
    d.setState('confused', 1.1);
    tm.focus -= cost;
    spawnEmoji('❓', d.headWorld(0.4), { size: 0.4, life: 1 });
  }
  function performTrick(d, id) {
    const T = ALL_TRICKS[id];
    const before = d.trickLvl(id);
    d.tricks[id] = (d.tricks[id] || 0) + (d.flag('quick') ? 1.5 : 1);
    const after = d.trickLvl(id);
    d.trickId = id;
    d.trickFace = d.root.rotation.y;
    d.setState('trick', T.dur);
    d.happy = Math.min(100, d.happy + 3);
    d.energy = Math.max(0, d.energy - 1.2);
    d.addBond(1);
    tm.focus = Math.min(100, tm.focus + TF.success);
    const head = d.headWorld(0.45);
    const fx = { speak: '💬', shake: '💦', howl: '🌕', dance: '🎶', chase: '🌀', dead: '💫' }[id];
    if (fx) spawnEmoji(fx, head, { size: 0.45, life: 1.4 });
    if (after >= 1 && !state.learned.includes(id)) state.learned.push(id);
    progress('trick');
    progress('trick:' + id);
    if (T.secret && !state.secrets.includes(id)) {
      state.secrets.push(id);
      toast(`✨ Secret trick discovered: ${T.icon} ${T.name}!`);
      confetti(head);
    } else if (after > before) {
      toast(after === 1 ? `🎓 ${d.name} learned ${T.icon} ${T.name}!` : `⭐ ${T.name} is now ${D.TRICK_LEVELS[after]} (Lv ${after})`);
      if (after === 5) confetti(head);
      else spawnEmoji('⭐', head, { size: 0.45 });
      if (d.ui) refreshCardStatic(d);
    } else spawnEmoji('👏', head, { size: 0.4 });
    if (place === 'park' && loc === 'caves' && id === 'speak') setTimeout(() => doEcho(d), 600);
    if (place === 'park' && loc === 'carnival') carnivalTrick(d, id, after);
    else if (place === 'park' && loc === 'oldtown' && inPlaza(player.root.position)) plazaPerformance(d, after);
    else if (place === 'park' && after >= 3) {
      const fan = walkers.find((w) => w.parts.root.position.distanceTo(d.root.position) < 5);
      if (fan && Math.random() < 0.3) setTimeout(() => { addCoins(1 + Math.floor(Math.random() * 3), fan.parts.root.position); toast(`👏 ${fan.info.owner} loved that trick!`); }, 900);
    }
    if (id === 'come' && after >= CONFIG.OFFLEASH_COME_LEVEL && before < CONFIG.OFFLEASH_COME_LEVEL) {
      setTimeout(() => toast(`🔓 ${d.name} can go off-leash on walks now!`), 1600);
    }
  }
  function renderBook() {
    const d = tm ? tm.dog : selected || dogs[0];
    if (!d) return;
    $('bookSub').textContent = `${d.name} · Obedience ${d.obedience()} · ${state.secrets.length}/${SECRETS.length} secret tricks found`;
    const L = $('bookList');
    L.innerHTML = '';
    const stars = (l) => '★'.repeat(l) + '☆'.repeat(5 - l);
    for (const [id, T] of Object.entries(ALL_TRICKS)) {
      const lvl = d.trickLvl(id);
      const r = document.createElement('div');
      r.className = 'row trickRow' + (lvl ? '' : ' untrained');
      if (T.secret && !state.secrets.includes(id)) {
        r.innerHTML = `<div class="ic q">${IC('question')}</div><div class="txt"><b>Secret trick</b><small>Discover it yourself…</small></div>`;
      } else {
        const needs = (T.needs || []).filter((n) => d.trickLvl(n) < 1).map((n) => ALL_TRICKS[n].name);
        const sub = needs.length ? `Learn ${needs.join(' & ')} first` : T.secret ? T.hint : D.TRICK_LEVELS[lvl];
        r.innerHTML = `<div class="ic">${TH('pic', T.icon)}</div><div class="txt"><b></b><small></small></div><div class="gest">${seqGlyphs(T.seq)}<span class="stars">${stars(lvl)}</span></div>`;
        r.querySelector('b').textContent = T.name;
        r.querySelector('small').textContent = sub;
      }
      L.appendChild(r);
    }
  }

  // gestures
  const tmEl = $('trickMode'), ringEl = $('tmRing');
  let holdTimers = [];
  function pushToken(tok) {
    if (!tm) return;
    tm.seq.push(tok);
    if (tok === 'T') tm.taps.push(performance.now());
    $('tmSeq').innerHTML = tm.seq.map((c) => IC(GLYPH[c])).join('');
    $('tmSeq').dataset.seq = tm.seq.join('');
  }
  tmEl.addEventListener('pointerdown', (e) => {
    if (!tm || e.target.closest('button')) return;
    e.preventDefault();
    if (tm.dog.state !== 'attend' && !tm.seq.length) { if (tm.dog.state === 'move') toast(`${tm.dog.name} is still coming over…`); return; }
    tm.ptr = { id: e.pointerId, t0: performance.now(), pts: [[e.clientX, e.clientY]], moved: false, holdFirst: false, moveStart: 0 };
    try { tmEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    ringEl.style.left = e.clientX + 'px';
    ringEl.style.top = e.clientY + 'px';
    ringEl.className = 'on';
    holdTimers.forEach(clearTimeout);
    holdTimers = [
      setTimeout(() => { if (tm && tm.ptr && !tm.ptr.moved) ringEl.className = 'on h1'; }, 450),
      setTimeout(() => { if (tm && tm.ptr && !tm.ptr.moved) ringEl.className = 'on h2'; }, 2500),
    ];
  });
  tmEl.addEventListener('pointermove', (e) => {
    const P = tm && tm.ptr;
    if (!P || e.pointerId !== P.id) return;
    P.pts.push([e.clientX, e.clientY]);
    const [x0, y0] = P.pts[0];
    if (!P.moved && Math.hypot(e.clientX - x0, e.clientY - y0) > 16) {
      P.moved = true;
      P.moveStart = P.pts.length - 2;
      if (performance.now() - P.t0 >= 450) P.holdFirst = true;
      ringEl.className = '';
    }
  });
  function endGesture(e) {
    const P = tm && tm.ptr;
    if (!P || e.pointerId !== P.id) return;
    tm.ptr = null;
    tm.lastUp = performance.now();
    holdTimers.forEach(clearTimeout);
    ringEl.className = '';
    if (e.type === 'pointercancel') return;
    const dur = (performance.now() - P.t0) / 1000;
    if (!P.moved) { pushToken(dur < 0.4 ? 'T' : dur < 2.4 ? 'H' : 'S'); return; }
    if (P.holdFirst) pushToken('H');
    const pts = P.pts.slice(Math.max(0, P.moveStart));
    let turn = 0, len = 0, px = null, py = null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let lastAng = null;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      const l = Math.hypot(dx, dy);
      minX = Math.min(minX, pts[i][0]); maxX = Math.max(maxX, pts[i][0]); minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1]);
      if (l < 3) continue;
      len += l;
      const ang = Math.atan2(dy, dx);
      if (lastAng !== null) { let da = ang - lastAng; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; turn += da; }
      lastAng = ang;
      px = pts[i][0]; py = pts[i][1];
    }
    const [sx, sy] = pts[0], ex = px ?? sx, ey = py ?? sy;
    const size = Math.max(maxX - minX, maxY - minY, 1);
    if (Math.abs(turn) > 4.4 && Math.hypot(ex - sx, ey - sy) < size * 0.6) {
      const loops = Math.max(1, Math.round(Math.abs(turn) / TAU));
      for (let k = 0; k < loops; k++) pushToken('O');
      return;
    }
    const dx = ex - sx, dy = ey - sy;
    pushToken(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u'));
  }
  tmEl.addEventListener('pointerup', endGesture);
  tmEl.addEventListener('pointercancel', endGesture);
  $('tmExit').addEventListener('click', () => { const d = tm && tm.dog; exitTrickMode(); if (d) toast(`Good session, ${d.name}! 🎓`); });
  $('tmBook').addEventListener('click', () => { renderBook(); $('trickBook').classList.remove('hidden'); });
  $('trickBook').addEventListener('click', (e) => {
    if (e.target.id === 'trickBook' || e.target.closest('[data-act="closeBook"]')) $('trickBook').classList.add('hidden');
  });

  // =====================================================================
  // Dog status bubbles (top left)
  // =====================================================================
  const levelClass = (v) => (v < CRITICAL ? 'red' : v < LOW ? 'on' : '');
  const STAT_IC = { hunger: 'food', thirst: 'drop', energy: 'bolt', happy: 'heart', clean: 'bubbles' };
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
        D.STATS.map((s) => `<div class="bar ${s.k}"><span class="bic">${IC(STAT_IC[s.k])}<i class="badge">!</i></span><div class="track"><div class="fill ${s.k}"></div></div></div>`).join('') +
        '<div class="favs"></div>' +
        `<div class="cardBtns"><button class="mini" data-dact="tricks">${IC('cap')}Tricks</button><button class="mini" data-dact="treat">${IC('treat')}Treat</button><button class="mini" data-dact="style">${IC('hat')}Style</button><button class="mini" data-dact="bath">${IC('bath')}Bath</button><button class="mini" data-dact="towel">${IC('towel')}Towel</button></div>` +
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
      if (btn) {
        if (btn.dataset.dact === 'towel') startTowel(d);
        else if (btn.dataset.dact === 'tricks') { d.ui.open = false; el.classList.remove('open'); enterTrickMode(d); }
        else if (btn.dataset.dact === 'treat') openMeals(d);
        else if (btn.dataset.dact === 'style') openWardrobe(d);
        else if (btn.dataset.dact === 'bath') { if (place !== 'home') toast('Baths happen at home 🛁'); else openBath(d); }
        return;
      }
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
    const age = g < 1 ? `Puppy · grown in ${fmtDuration((1 - g) * CONFIG.PUPPY_DAYS * DAY)}` : `${D.BREEDS[d.breed].name}`;
    const T1 = D.TRAITS[d.traits[0]], T2 = D.TRAITS[d.traits[1]];
    const chip = (txt, tip) => `<span class="chip" data-tip="${esc(tip)}">${esc(txt)}</span>`;
    u.chips.innerHTML =
      `<span class="chip age">${esc(age)}</span>` +
      chip(T1.name, `${T1.name}: ${T1.desc}`) +
      (d.revealed ? chip(T2.name, `${T2.name}: ${T2.desc}`) : chip('???', 'Bond more with your dog to discover its second trait')) +
      chip(`Obedience ${d.obedience()}`, `Obedience grows with every trick level. Teach tricks in Trick Mode.${d.trickLvl('come') >= CONFIG.OFFLEASH_COME_LEVEL ? ' Can go off-leash on walks.' : ''}`);
    const fav = d.favToy ? `${D.TOYS[d.favToy].icon} ${D.TOYS[d.favToy].name}${d.missing() ? ' (misses it!)' : ''}` : 'not yet';
    let spot = '';
    if (d.favSpot) {
      const [i, j] = d.favSpot.split(',').map(Number);
      let near = null, nd = 2.5;
      for (const f of state.furniture) { const dd = Math.hypot(f.i - i, f.j - j); if (dd < nd) { nd = dd; near = f; } }
      spot = `<div>Favorite spot: ${near ? `by the ${esc(D.ITEMS[near.type].icon)} ${esc(D.ITEMS[near.type].name)}` : 'a cozy corner'}</div>`;
    }
    const bf = bestFriend(d);
    const friendLine = bf && bf.value >= 15 ? `<div>${bf.value >= D.FRIEND_LEVEL ? 'Best friend' : 'Getting to know'}: ${esc(bf.name)} 💕</div>` : '';
    u.favs.innerHTML = `<div>Favorite toy: ${esc(fav)}</div>${spot}${friendLine}`;
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
        u.alerts.innerHTML = lows.map((s) => `<span class="al ${s.k}" data-k="${s.k}">${IC(STAT_IC[s.k])}<i class="badge ${levelClass(d[s.k])}">!</i></span>`).join('');
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
    if (mode !== 'normal') return;
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
  // Home life: comfort, using furniture, clutter, gardens
  // =====================================================================
  const clutterGroup = pivot(homeRoot);
  const nearLitFire = (pos) => home().furniture.some((f) => f.type === 'fireplace' && f.on !== false && Math.hypot(f.i + 0.5 - pos.x, f.j + 0.5 - pos.z) < 2.6);
  const musicOn = () => place === 'home' && home().furniture.some((f) => f.type === 'jukebox' && f.on);

  let comfort = { paws: 1, points: 0, parts: [], found: [], missing: 0 };
  function computeComfort() {
    const F = state.furniture;
    const parts = [];
    const variety = Math.min(30, new Set(F.map((f) => f.type)).size * 2);
    parts.push(['Variety of furniture', variety]);
    let rooms = 0, styled = 0;
    for (const [cx, cz] of state.chunks) {
      const n = F.filter((f) => Math.floor(f.i / CHUNK) === cx && Math.floor(f.j / CHUNK) === cz).length;
      if (n >= 4) rooms += 5;
      const r = state.rooms[chunkKey(cx, cz)];
      if (r && !state.gardens[chunkKey(cx, cz)] && (r.wall !== D.DEFAULT_ROOM.wall || r.floor !== D.DEFAULT_ROOM.floor)) styled += 3;
    }
    parts.push(['Furnished rooms', Math.min(20, rooms)]);
    parts.push(['Decorated walls & floors', Math.min(12, styled)]);
    const special = Math.min(40, F.reduce((s, f) => s + (D.ITEMS[f.type].comfort || 0), 0));
    parts.push(['Special pieces', special]);
    const match = (f, key) => (key.startsWith('role:') ? roleOf(f) === key.slice(5) : f.type === key);
    const found = [];
    let syn = 0;
    for (const S of D.SYNERGIES) {
      const ok = F.some((a) => match(a, S.a) && F.some((b) => b !== a && match(b, S.b) && Math.hypot(a.i - b.i, a.j - b.j) <= S.r));
      if (ok) { syn += S.pts; found.push(S.name); }
    }
    parts.push(['Combos', syn]);
    const toys = state.clutter.filter((c) => c.kind === 'toy').length, holes = state.clutter.filter((c) => c.kind === 'hole').length;
    if (toys || holes) parts.push(['Mess (toys & holes)', -(toys * 4 + holes * 5)]);
    const points = parts.reduce((s, p) => s + p[1], 0);
    let paws = 1;
    D.COMFORT_PAWS.forEach((t, i) => { if (points >= t) paws = i + 1; });
    comfort = { paws: clamp(paws, 1, 5), points, parts, found, missing: D.SYNERGIES.length - found.length };
    return comfort;
  }
  const COMFORT_WORDS = ['Bare', 'Basic', 'Cozy', 'Snug', 'Dreamy'];
  function renderComfortChip() {
    $('comfortPawsMini').innerHTML = pawsHTML(comfort.paws);
    $('comfortWord').textContent = COMFORT_WORDS[comfort.paws - 1] || 'Cozy';
  }
  function openComfort() {
    computeComfort();
    $('comfortPaws').innerHTML = pawsHTML(comfort.paws);
    $('comfortSub').textContent = `${comfort.points} comfort points · next paw at ${D.COMFORT_PAWS[comfort.paws] ?? '—'}. Higher comfort keeps your dogs happier at home.`;
    $('comfortList').innerHTML = comfort.parts.map(([n, v]) => `<div class="row"><div class="txt"><b>${esc(n)}</b></div><b class="${v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v}</b></div>`).join('') +
      `<div class="section">Combos found</div><p class="sub">${comfort.found.length ? comfort.found.map(esc).join(' · ') : 'None yet — try placing things that belong together near each other.'}${comfort.missing ? ` · ${comfort.missing} more to discover` : ''}</p>`;
    $('comfort').classList.remove('hidden');
  }

  function renderClutter() {
    clutterGroup.clear();
    if (visit) return;
    for (const c of state.clutter) {
      const g = c.kind === 'hole' ? ART.buildHole() : ART.buildToy(c.type);
      g.position.set(c.i + 0.5 + (c.ox || 0), c.kind === 'hole' ? 0 : (D.TOYS[c.type] ? D.TOYS[c.type].restY : 0.1), c.j + 0.5 + (c.oz || 0));
      g.rotation.y = c.rot || 0;
      g.userData.clutter = c;
      clutterGroup.add(g);
    }
  }
  function randomGardenPoint() {
    const gs = state.chunks.filter(([cx, cz]) => state.gardens[chunkKey(cx, cz)]);
    for (let k = 0; k < 30 && gs.length; k++) {
      const [cx, cz] = pick(gs);
      const i = cx * CHUNK + Math.floor(Math.random() * CHUNK), j = cz * CHUNK + Math.floor(Math.random() * CHUNK);
      if (!passable(i, j) || state.clutter.some((c) => c.i === i && c.j === j)) continue;
      const pit = furnitureAt(i, j);
      if (pit && !D.ITEMS[pit.type].digSpot) continue;
      return new V3(i + 0.5, 0, j + 0.5);
    }
    return null;
  }
  function pullToyOut(d, tb) {
    const types = state.toys;
    for (let k = 0; k < 12; k++) {
      const i = tb.i + Math.round(rand(-2, 2)), j = tb.j + Math.round(rand(-2, 2));
      if (!passable(i, j) || furnitureAt(i, j) || state.clutter.some((c) => c.i === i && c.j === j)) continue;
      state.clutter.push({ kind: 'toy', type: pick(types), i, j, ox: rand(-0.2, 0.2), oz: rand(-0.2, 0.2), rot: rand(0, TAU) });
      renderClutter();
      computeComfort();
      d.happy = Math.min(100, d.happy + 6);
      d.setState('playtoy', rand(3, 5));
      return;
    }
    d.idle();
  }
  function homeDig(d) {
    const i = Math.floor(d.root.position.x), j = Math.floor(d.root.position.z);
    const f = furnitureAt(i, j);
    const inPit = f && D.ITEMS[f.type].digSpot;
    const W = curWeather();
    d.clean -= inPit ? 1.5 : 3;
    d.dirt[W.muddy ? 'mud' : 'grass'] += 3;
    d.happy = Math.min(100, d.happy + (inPit ? 9 : 6));
    if (!inPit && isGardenTile(i, j) && state.clutter.filter((c) => c.kind === 'hole').length < D.HOLES_MAX && !state.clutter.some((c) => c.i === i && c.j === j)) {
      state.clutter.push({ kind: 'hole', i, j, rot: rand(0, TAU) });
      renderClutter();
      computeComfort();
    }
    const r = Math.random();
    if (r < D.RARE_FIND) findRare(d.root.position);
    else if (r < 0.1) findIngredient(d.root.position);
    else if (r < 0.25) addCoins(1, d.root.position);
    else spawnEmoji('🕳️', d.headWorld(-0.2), { size: 0.35, life: 0.9 });
    d.idle();
  }
  function rollWeighted(obj) {
    const list = Object.entries(obj).filter(([, v]) => v.weight);
    let r = Math.random() * list.reduce((s, [, v]) => s + v.weight, 0);
    for (const [k, v] of list) { r -= v.weight; if (r <= 0) return k; }
    return list[0][0];
  }
  function findIngredient(pos, from) {
    const k = from && from.length ? pick(from) : rollWeighted(D.INGREDIENTS), I = D.INGREDIENTS[k];
    state.pantry[k] = (state.pantry[k] || 0) + 1;
    toast(`Found ${I.icon} ${I.name}! It's in your pantry for cooking`);
    if (pos) spawnEmoji(I.icon, pos.clone().add(new V3(0, 1, 0)), { size: 0.5, life: 1.4 });
  }
  function seeRare(k) { if (!state.seen.rares.includes(k)) state.seen.rares.push(k); }
  function findRare(pos) {
    const k = pick(Object.keys(D.ITEMS).filter((t) => D.ITEMS[t].rare));
    state.inventory[k] = (state.inventory[k] || 0) + 1;
    seeRare(k);
    toast(`💎 Incredible — a rare ${D.ITEMS[k].icon} ${D.ITEMS[k].name}! Place it in 🎨 Decorate`);
    if (pos) confetti(pos.clone().add(new V3(0, 1, 0)));
    save();
  }
  function autoRefill() {
    const mins = CONFIG.AUTO_REFILL_MINUTES * 60000;
    for (const f of state.furniture) {
      if (!D.ITEMS[f.type].auto || f.filled) continue;
      if (!f.emptiedAt) f.emptiedAt = Date.now();
      if (Date.now() - f.emptiedAt >= mins) { f.filled = true; f.emptiedAt = 0; refreshBowl(f); }
    }
  }

  // ----- tapping furniture: walk over and use it -----
  let useTask = null;
  function startUse(f) {
    const it = D.ITEMS[f.type];
    if (visit) { if (it.use === 'gift') claimVisitGift(f); return; }
    const spot = frontOf(f) || tileCenter(f);
    useTask = { f, spot };
    player.moveTarget = spot.clone();
    towelTask = null;
  }
  function startTidy(c) {
    useTask = { clutter: c, spot: new V3(c.i + 0.5, 0, c.j + 0.5) };
    player.moveTarget = useTask.spot.clone();
    towelTask = null;
  }
  function updateUseTask() {
    if (!useTask) return;
    const pp = player.root.position;
    if (pp.distanceTo(useTask.spot) > (useTask.clutter ? 1.0 : 0.8)) {
      if (!player.moveTarget) useTask = null; // blocked or cancelled
      return;
    }
    const task = useTask;
    useTask = null;
    player.moveTarget = null;
    if (task.clutter) {
      const c = task.clutter;
      state.clutter = state.clutter.filter((x) => x !== c);
      renderClutter();
      computeComfort();
      spawnEmoji(c.kind === 'hole' ? '🌱' : '✨', new V3(c.i + 0.5, 0.6, c.j + 0.5), { size: 0.45 });
      toast(c.kind === 'hole' ? 'Hole filled in 🌱' : 'Tidied up a toy ✨');
      progress('tidy');
      save();
      return;
    }
    const f = task.f;
    player.face = Math.atan2(f.i + 0.5 - pp.x, f.j + 0.5 - pp.z);
    doUse(f);
  }
  const pianoCooldown = new WeakMap();
  function doUse(f) {
    const it = D.ITEMS[f.type];
    const at = tileCenter(f).add(new V3(0, 1.2, 0));
    const toggle = (label, onMsg, offMsg) => {
      f.on = !(f.on ?? label);
      const r = furnRT.get(f);
      if (r) r.group.userData.on = f.on;
      toast(f.on ? onMsg : offMsg);
      save();
    };
    switch (it.use) {
      case 'tv': toggle(false, '📺 TV on — Couch Potatoes will come and watch', '📺 TV off'); break;
      case 'fire': toggle(true, '🔥 Fire lit — dogs rest faster nearby', 'Fire out'); break;
      case 'lamp': toggle(true, '💡 Light on', 'Light off'); break;
      case 'music': toggle(false, '🎶 Music on — everyone feels a little happier', 'Music off'); if (f.on) spawnEmoji('🎶', at, { size: 0.5 }); break;
      case 'piano': {
        if ((pianoCooldown.get(f) || 0) > animT) { toast('🎹 Your fingers need a little rest'); break; }
        pianoCooldown.set(f, animT + 30);
        for (let k = 0; k < 6; k++) setTimeout(() => spawnEmoji(pick(['🎵', '🎶']), at.clone().add(new V3(rand(-0.4, 0.4), 0, rand(-0.4, 0.4))), { size: 0.4 }), k * 250);
        dogs.forEach((d) => { if (d.root.position.distanceTo(tileCenter(f)) < 5) d.happy = Math.min(100, d.happy + 5); });
        toast('🎹 You play a little tune — the dogs love it');
        break;
      }
      case 'toybox': {
        const toys = state.clutter.filter((c) => c.kind === 'toy');
        if (!toys.length) { toast('🧸 All tidy! The dogs will drag toys out again soon'); break; }
        state.clutter = state.clutter.filter((c) => c.kind !== 'toy');
        renderClutter();
        computeComfort();
        toast(`🧸 Tidied up ${toys.length} toy${toys.length > 1 ? 's' : ''} ✨`);
        progress('tidy');
        save();
        break;
      }
      case 'cook': openKitchen(); break;
      case 'bath': openBath(selected && dogs.includes(selected) ? selected : dogs[0]); break;
      case 'gift': openGiftBox(f); break;
      default: break;
    }
  }

  // =====================================================================
  // Bath time (mini game)
  // =====================================================================
  let bath = null;
  function dirtEfficiency(d, shampoo) {
    const S = D.SHAMPOOS[shampoo];
    const total = Object.values(d.dirt).reduce((a, b) => a + b, 0);
    if (!S) return D.WATER_ONLY;
    if (total < 0.5) return Object.values(S.eff).reduce((a, b) => Math.max(a, b), S.other);
    let e = 0;
    for (const [k, v] of Object.entries(d.dirt)) e += (S.eff[k] ?? S.other) * (v / total);
    return e;
  }
  function openBath(d) {
    if (!d) return;
    const tub = state.furniture.find((f) => f.type === 'bathtub');
    if (!tub) { toast('Place a 🛁 Bathtub first (🐾 Menu → 🛒 Shop → Dog stuff)'); return; }
    if (['fetch', 'return', 'trick', 'attend'].includes(d.state)) { toast('Wait a moment — they are busy'); return; }
    if (d.state === 'sleep' || d.state === 'hide') d.wake();
    d.releaseClaim();
    d.dropSpot();
    d.onArrive = null;
    d.path = null;
    d.root.position.set(tub.i + 0.5, 0.18, tub.j + 0.5);
    d.setState('bath');
    const pos = frontOf(tub);
    if (pos) player.root.position.copy(pos);
    bath = { dog: d, tub, step: 'pick', shampoo: null, spots: [], foam: [], meter: 0, last: null };
    $('bathTitle').textContent = `Bath time with ${d.name}`;
    renderBathPick();
    $('bath').classList.remove('hidden');
  }
  function renderBathPick() {
    $('bathStep').textContent = 'Pick a shampoo';
    $('bathCanvasWrap').classList.add('hidden');
    $('bathDone').classList.add('hidden');
    const L = $('bathShampoos');
    L.classList.remove('hidden');
    L.innerHTML = '';
    const d = bath.dog;
    const opts = Object.entries(D.SHAMPOOS).filter(([k]) => (state.shampoos[k] || 0) > 0).map(([k, S]) => [k, S, state.shampoos[k]]);
    const DD = D.DIRT[mainDirt(d)];
    $('bathHint').textContent = d.clean > 95 ? `${d.name} is already clean — a bath just for fun?` : `${d.name} is mostly covered in ${DD.name.toLowerCase()}. The right shampoo cleans better.`;
    for (const [k, S, n] of opts) {
      const b = document.createElement('button');
      b.className = 'toyCard';
      b.innerHTML = `${thumbOf.shampoo(k)}<b>${esc(S.name)}</b><small>×${n} · ${Math.round(dirtEfficiency(d, k) * 100)}% for ${esc(d.name)}</small>`;
      b.addEventListener('click', () => startScrub(k));
      L.appendChild(b);
    }
    const w = document.createElement('button');
    w.className = 'toyCard';
    w.innerHTML = `<span class="big">${IC('drop')}</span><b>Just water</b><small>${Math.round(D.WATER_ONLY * 100)}% · free</small>`;
    w.addEventListener('click', () => startScrub(null));
    L.appendChild(w);
  }
  const bathImg = new Image();
  function startScrub(shampoo) {
    const d = bath.dog;
    bath.shampoo = shampoo;
    bath.step = 'scrub';
    bath.meter = 0;
    const n = clamp(Math.ceil((100 - d.clean) / 12), 2, 8);
    // dirt spots in the colors of the dirt the dog actually has
    const kinds = Object.entries(d.dirt).filter(([k, v]) => v > 0.5 && D.DIRT[k]);
    const total = kinds.reduce((a, [, v]) => a + v, 0);
    const dirtCol = () => {
      if (!total) return D.DIRT.mud.color;
      let x = Math.random() * total;
      for (const [k, v] of kinds) { x -= v; if (x <= 0) return D.DIRT[k].color; }
      return D.DIRT[kinds[0][0]].color;
    };
    bath.spots = Array.from({ length: n }, () => ({ x: rand(60, 220), y: rand(70, 230), r: rand(16, 26), hp: 1, col: dirtCol() }));
    bath.foam = [];
    bathImg.src = ART.portraitURL(d.breed, d.coat);
    $('bathShampoos').classList.add('hidden');
    $('bathCanvasWrap').classList.remove('hidden');
    $('bathStep').textContent = '1 · Scrub away the dirt';
    $('bathHint').textContent = 'Rub over the dirty spots with your finger';
    drawBath();
  }
  function drawBath() {
    const c = $('bathCanvas'), x = c.getContext('2d');
    x.clearRect(0, 0, 280, 280);
    x.fillStyle = '#d7efff';
    x.fillRect(0, 0, 280, 280);
    x.imageSmoothingEnabled = false;
    if (bathImg.complete) x.drawImage(bathImg, 12, 12, 256, 256);
    for (const s of bath.spots) {
      if (s.hp <= 0) continue;
      x.globalAlpha = 0.25 + 0.7 * s.hp;
      x.fillStyle = s.col;
      x.beginPath(); x.arc(s.x, s.y, s.r, 0, TAU); x.fill();
    }
    x.globalAlpha = 1;
    for (const f of bath.foam) {
      x.fillStyle = bath.step === 'dry' ? 'rgba(120,180,255,0.6)' : 'rgba(255,255,255,0.85)';
      x.beginPath(); x.arc(f.x, f.y, f.r, 0, TAU); x.fill();
    }
    $('bathFill').style.width = Math.round(bath.meter * 100) + '%';
  }
  function bathRub(x, y, dist) {
    if (!bath || bath.step === 'pick' || bath.step === 'done') return;
    const eff = dirtEfficiency(bath.dog, bath.shampoo);
    if (bath.step === 'scrub') {
      if (Math.random() < 0.6 && bath.foam.length < 90) bath.foam.push({ x: x + rand(-8, 8), y: y + rand(-8, 8), r: rand(6, 12) });
      for (const s of bath.spots) if (s.hp > 0 && Math.hypot(s.x - x, s.y - y) < s.r + 18) s.hp -= dist * 0.006 * (0.5 + eff);
      const left = bath.spots.reduce((a, s) => a + Math.max(0, s.hp), 0);
      bath.meter = 1 - left / bath.spots.length;
      if (left <= 0.001) { bath.step = 'rinse'; bath.meter = 0; $('bathStep').textContent = '2 · Rinse off the foam'; $('bathHint').textContent = 'Rub to wash the bubbles away'; }
    } else if (bath.step === 'rinse') {
      bath.foam = bath.foam.filter((f) => Math.hypot(f.x - x, f.y - y) > 26);
      if (Math.random() < 0.3) spawnEmoji('💦', bath.dog.headWorld(0.2), { size: 0.3, life: 0.6 });
      bath.meter = clamp(bath.meter + dist / 1600, 0, 1);
      if (!bath.foam.length && bath.meter > 0.4) {
        bath.step = 'dry';
        bath.meter = 0;
        bath.foam = Array.from({ length: 40 }, () => ({ x: rand(30, 250), y: rand(40, 260), r: rand(3, 6) }));
        $('bathStep').textContent = '3 · Towel dry';
        $('bathHint').textContent = 'Rub to dry off all the drops';
      }
    } else if (bath.step === 'dry') {
      bath.foam = bath.foam.filter((f) => Math.hypot(f.x - x, f.y - y) > 24);
      bath.meter = 1 - bath.foam.length / 40;
      if (!bath.foam.length) finishBath();
    }
    drawBath();
  }
  function finishBath() {
    const d = bath.dog, S = D.SHAMPOOS[bath.shampoo];
    const e = dirtEfficiency(d, bath.shampoo);
    if (S) state.shampoos[bath.shampoo] = Math.max(0, (state.shampoos[bath.shampoo] || 0) - 1);
    d.clean = Math.max(d.clean, e >= 0.95 ? 100 : Math.round(70 + 30 * e));
    for (const k of Object.keys(d.dirt)) d.dirt[k] *= 1 - e;
    let joy = 5;
    if (d.flag('splashes')) joy += 15;
    joy += 8 * (d.mod('cleanJoy') - 1) * 2;
    if (S && S.fancy && d.mod('cleanJoy') > 1) joy += 15;
    d.happy = Math.min(100, d.happy + joy);
    d.energy = Math.max(0, d.energy - 5);
    d.addBond(2);
    d.updateDirtLook();
    progress('bath');
    bath.step = 'done';
    $('bathStep').textContent = d.clean >= 100 ? `✨ ${d.name} is sparkling clean!` : `${d.name} is ${Math.round(d.clean)}% clean`;
    $('bathHint').textContent = e < 0.95 ? 'A shampoo that matches the dirt cleans completely.' : (d.flag('splashes') ? 'Water Lovers adore bath time! 💦' : 'All done!');
    $('bathDone').classList.remove('hidden');
    save();
  }
  function closeBath() {
    if (!bath) return;
    const d = bath.dog, tub = bath.tub;
    const out = frontOf(tub);
    d.root.position.set(out ? out.x : tub.i + 0.5, 0, out ? out.z : tub.j + 1.5);
    d.idle(1);
    if (bath.step === 'done') { spawnEmoji('✨', d.headWorld(0.4), { size: 0.5 }); if (d.flag('splashes')) d.setState('happy', 1.5); }
    bath = null;
    $('bath').classList.add('hidden');
  }
  (function bathInput() {
    const c = $('bathCanvas');
    let last = null;
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (280 / r.width), (e.clientY - r.top) * (280 / r.height)]; };
    c.addEventListener('pointerdown', (e) => { e.preventDefault(); last = pt(e); try { c.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } });
    c.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pt(e);
      bathRub(p[0], p[1], Math.hypot(p[0] - last[0], p[1] - last[1]));
      last = p;
    });
    const up = () => { last = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  })();
  $('bathClose').addEventListener('click', closeBath);
  $('bathDone').addEventListener('click', closeBath);

  // =====================================================================
  // Cooking (stove mini game) and treats
  // =====================================================================
  let cook = null;
  function openKitchen() {
    renderKitchen();
    $('kitchen').classList.remove('hidden');
  }
  function haveFor(R) { return !!R.needs && Object.entries(R.needs).every(([k, n]) => (state.pantry[k] || 0) >= n); }
  function renderKitchen() {
    $('cookGame').classList.add('hidden');
    const L = $('recipeList');
    L.classList.remove('hidden');
    const have = Object.entries(state.pantry).filter(([, n]) => n > 0);
    $('pantryLine').innerHTML = have.length ? `<span class="lbl">Pantry</span>${have.map(([k, n]) => `<span class="ingr" title="${esc(D.INGREDIENTS[k].name)}">${thumbOf.ing(k)}<b>${n}</b></span>`).join('')}` : 'Your pantry is empty. Buy basics in the Shop or find ingredients on walks.';
    L.innerHTML = '';
    for (const [id, R] of Object.entries(D.RECIPES)) {
      if (!R.needs) continue; // treats from vendors can't be cooked
      const ok = haveFor(R);
      const r = document.createElement('div');
      r.className = 'row';
      const needs = Object.entries(R.needs).map(([k, n]) => `<span class="ingr${(state.pantry[k] || 0) < n ? ' miss' : ''}" title="${esc(D.INGREDIENTS[k].name)}">${thumbOf.ing(k)}${n > 1 ? `<b>×${n}</b>` : ''}</span>`).join('');
      r.innerHTML = `<div class="ic">${thumbOf.meal(id)}</div><div class="txt"><b>${esc(R.name)}</b><small>${esc(R.desc)}</small><span class="needs">${needs}</span></div>`;
      const b = document.createElement('button');
      b.className = 'buy';
      b.textContent = 'Cook';
      b.disabled = !ok;
      b.addEventListener('click', () => startCooking(id));
      r.appendChild(b);
      L.appendChild(r);
    }
  }
  const COOK_ROUNDS = ['Chop', 'Stir', 'Season'];
  function startCooking(id) {
    const R = D.RECIPES[id];
    if (!haveFor(R)) return;
    for (const [k, n] of Object.entries(R.needs)) state.pantry[k] -= n;
    cook = { id, round: 0, score: 0, pos: 0, dir: 1, speed: 0.9, zone: 0, running: true };
    $('recipeList').classList.add('hidden');
    $('cookGame').classList.remove('hidden');
    nextCookRound();
  }
  function nextCookRound() {
    cook.zone = rand(0.15, 0.75);
    cook.pos = 0;
    cook.dir = 1;
    cook.speed = 0.8 + cook.round * 0.25;
    cook.running = true;
    $('cookRound').textContent = `${COOK_ROUNDS[cook.round]} — tap when the marker is in the green`;
    $('cookZone').style.left = cook.zone * 100 + '%';
    $('cookResult').textContent = '★'.repeat(cook.score) || '';
  }
  function cookTick(dt) {
    if (!cook || !cook.running) return;
    cook.pos += cook.dir * cook.speed * dt;
    if (cook.pos >= 1) { cook.pos = 1; cook.dir = -1; }
    if (cook.pos <= 0) { cook.pos = 0; cook.dir = 1; }
    $('cookMarker').style.left = cook.pos * 100 + '%';
  }
  function cookTap() {
    if (!cook || !cook.running) return;
    cook.running = false;
    const center = cook.zone + 0.09;
    const off = Math.abs(cook.pos - center);
    const pts = off < 0.03 ? 2 : off < 0.09 ? 1 : 0;
    cook.score += pts;
    $('cookRound').textContent = pts === 2 ? 'Perfect! ✨' : pts === 1 ? 'Nice!' : 'Oops!';
    spawnEmoji(pts ? '♨️' : '💨', player.root.position.clone().add(new V3(0, 1.6, 0)), { size: 0.45 });
    setTimeout(() => {
      if (!cook) return;
      cook.round++;
      if (cook.round < COOK_ROUNDS.length) nextCookRound();
      else finishCooking();
    }, 700);
  }
  function finishCooking() {
    const R = D.RECIPES[cook.id];
    const stars = cook.score >= 5 ? 3 : cook.score >= 2 ? 2 : 1;
    const q = D.COOK_QUALITY[stars - 1];
    if (R.effect.bowls) {
      const bowls = state.furniture.filter((f) => roleOf(f) === 'food');
      bowls.forEach((b) => { b.filled = true; b.gourmet = q; refreshBowl(b); });
      toast(bowls.length ? `${R.icon} ${'★'.repeat(stars)} Gourmet kibble served in ${bowls.length} bowl${bowls.length > 1 ? 's' : ''}!` : `${R.icon} Made gourmet kibble — but you have no food bowl!`);
    } else {
      state.meals.push({ id: cook.id, q: stars });
      toast(`${R.icon} ${'★'.repeat(stars)} ${R.name} is ready! Give it from a dog's bubble → 🍲 Treat`);
    }
    progress('cook');
    cook = null;
    save();
    renderKitchen();
  }
  $('cookTap').addEventListener('click', cookTap);
  $('kitchen').addEventListener('click', (e) => {
    if (e.target.id === 'kitchen' || e.target.closest('[data-act="closeKitchen"]')) { if (cook) return; $('kitchen').classList.add('hidden'); }
  });

  let mealDog = null;
  function openMeals(d) {
    mealDog = d;
    const L = $('mealList');
    L.innerHTML = '';
    $('mealSub').textContent = state.meals.length ? `Pick a treat for ${d.name}` : 'No treats yet — cook some at a 🍳 Stove, or buy some from vendors on walks.';
    const groups = {};
    state.meals.forEach((m, idx) => { const k = m.id + '|' + m.q; (groups[k] = groups[k] || []).push(idx); });
    for (const [k, idxs] of Object.entries(groups)) {
      const [id, q] = k.split('|');
      const R = D.RECIPES[id];
      if (!R) continue;
      const b = document.createElement('button');
      b.className = 'toyCard';
      b.innerHTML = `${thumbOf.meal(id)}<b>${esc(R.name)}</b><small><span class="stars">${'★'.repeat(+q)}</span> ×${idxs.length}</small>`;
      b.addEventListener('click', () => giveMeal(d, idxs[0]));
      L.appendChild(b);
    }
    $('meals').classList.remove('hidden');
  }
  function giveMeal(d, idx) {
    const m = state.meals[idx];
    if (!m) return;
    const R = D.RECIPES[m.id], q = D.COOK_QUALITY[m.q - 1] || 1;
    state.meals.splice(idx, 1);
    const E = R.effect;
    if (E.hunger) d.hunger = E.hunger >= 100 ? 100 : Math.min(100, d.hunger + E.hunger * q);
    if (E.messy) addDirt(d, E.messy, 6);
    progress('treat');
    if (E.thirst) d.thirst = Math.min(100, d.thirst + E.thirst * q);
    if (E.energy) d.energy = Math.min(100, d.energy + E.energy * q);
    if (E.clean) d.clean = Math.min(100, d.clean + E.clean * q);
    if (E.happy) d.happy = Math.min(d.missing() ? CONFIG.MISS_CAP : 100, d.happy + E.happy * q * d.mod('mealJoy'));
    d.addBond(E.bond || 1);
    spawnEmoji('😋', d.headWorld(0.4), { size: 0.45 });
    toast(`${d.name} loved the ${R.name}! ${d.flag('lounges') && E.energy ? '' : ''}`);
    $('meals').classList.add('hidden');
    save();
  }
  $('meals').addEventListener('click', (e) => { if (e.target.id === 'meals' || e.target.closest('[data-act="closeMeals"]')) $('meals').classList.add('hidden'); });

  // =====================================================================
  // Wardrobe (accessories)
  // =====================================================================
  let wardDog = null;
  function openWardrobe(d) {
    wardDog = d;
    renderWardrobe();
    $('wardrobe').classList.remove('hidden');
  }
  function renderWardrobe() {
    const d = wardDog;
    $('wardSub').textContent = `Dress up ${d.name}. One item per spot.`;
    const L = $('wardList');
    L.innerHTML = '';
    for (const [slot, label] of [['head', 'Head'], ['face', 'Face'], ['neck', 'Neck'], ['body', 'Body']]) {
      const sec = document.createElement('div');
      sec.className = 'section';
      sec.textContent = label;
      L.appendChild(sec);
      const grid = document.createElement('div');
      grid.className = 'wardGrid';
      for (const [id, A] of Object.entries(D.ACCESSORIES)) {
        if (A.slot !== slot) continue;
        const owned = state.accessories.includes(id);
        const on = d.acc[slot] === id;
        const b = document.createElement('button');
        b.className = 'toyCard' + (owned ? '' : ' locked') + (on ? ' eq' : '');
        const vloc = A.vendor ? D.VENDORS[A.vendor].loc : null;
        const where = A.vendor ? (locUnlocked(vloc) ? D.VENDORS[A.vendor].name : 'A faraway shop') : 'Boutique';
        const sub = on ? 'Wearing' : owned ? 'Tap to wear' : A.unlock ? D.UNLOCKS[A.unlock] : A.find ? (locUnlocked(A.find) ? `Found somewhere in ${D.LOCATIONS[A.find].name}` : 'Found somewhere new') : A.tickets ? `${where} · 🎟️ ${A.tickets}` : `${where} · 🪙 ${A.price}`;
        b.innerHTML = `${thumbOf.acc(id)}<b></b><small></small>`;
        b.querySelector('b').textContent = A.name;
        b.querySelector('small').textContent = sub;
        b.addEventListener('click', () => {
          if (!owned) { toast(A.unlock ? `Unlock it: ${D.UNLOCKS[A.unlock]}` : A.find ? (locUnlocked(A.find) ? `Keep exploring ${D.LOCATIONS[A.find].name}…` : 'Found somewhere you haven’t been yet…') : A.vendor ? (locUnlocked(D.VENDORS[A.vendor].loc) ? `Sold at the ${D.VENDORS[A.vendor].name} in ${D.LOCATIONS[D.VENDORS[A.vendor].loc].name}` : 'Sold somewhere you haven’t been yet…') : 'Buy it in Menu → Shop → Boutique'); return; }
          if (on) delete d.acc[slot];
          else d.acc[slot] = id;
          d.applyAccessories();
          renderWardrobe();
          save();
        });
        grid.appendChild(b);
      }
      L.appendChild(grid);
    }
  }
  $('wardrobe').addEventListener('click', (e) => { if (e.target.id === 'wardrobe' || e.target.closest('[data-act="closeWardrobe"]')) $('wardrobe').classList.add('hidden'); });

  const UNLOCK_CHECKS = {
    obedience15: () => dogs.some((d) => d.obedience() >= 15),
    alltricks: () => dogs.some((d) => Object.keys(D.TRICKS).every((id) => d.trickLvl(id) >= 1)),
    walks50: () => (state.stats.walks || 0) >= 50,
    goldenball: () => state.toys.includes('golden'),
    friends3: () => Object.values(state.friends).filter((v) => v >= D.FRIEND_LEVEL).length >= 3,
    secret1: () => state.secrets.length >= 1,
    comfort5: () => comfort.paws >= 5,
    rainwalks5: () => (state.stats.rainWalks || 0) >= 5,
    crosswalk10: () => (state.stats.crosswalks || 0) >= 10,
    summit3: () => (state.summits || 0) >= 3,
    daily10: () => (state.stats.challengesDone || 0) >= 10,
  };
  for (const id of ['toys', 'park', 'oldtown', 'forest', 'beach', 'alpine', 'caves', 'snowy', 'carnival', 'fairy', 'moon', 'rare', 'tricks', 'breeds', 'records']) {
    UNLOCK_CHECKS['page_' + id] = () => { const p = bookPage(id); return p.done === p.total; };
  }
  function checkUnlocks() {
    for (const [id, A] of Object.entries(D.ACCESSORIES)) {
      if (!A.unlock || state.accessories.includes(id)) continue;
      const fn = UNLOCK_CHECKS[A.unlock];
      if (fn && fn()) {
        state.accessories.push(id);
        toast(`👒 Unlocked: ${A.icon} ${A.name}! Dress up in a dog's bubble → 👒 Style`);
        save();
      }
    }
  }

  // =====================================================================
  // Gift boxes & visit links
  // =====================================================================
  let giftFurn = null;
  function giftLabel(g) {
    if (!g) return '';
    if (g.kind === 'item') return `${D.ITEMS[g.key].icon} ${D.ITEMS[g.key].name}`;
    if (g.kind === 'toy') return `${D.TOYS[g.key].icon} ${D.TOYS[g.key].name}`;
    if (g.kind === 'ingredient') return `${D.INGREDIENTS[g.key].icon} ${D.INGREDIENTS[g.key].name}`;
    if (g.kind === 'shampoo') return `${D.SHAMPOOS[g.key].icon} ${D.SHAMPOOS[g.key].name}`;
    if (g.kind === 'meal') return `${D.RECIPES[g.key].icon} ${D.RECIPES[g.key].name} ${'★'.repeat(g.q || 1)}`;
    return '?';
  }
  const giftThumb = (g) => (g.kind === 'item' ? thumbOf.item(g.key) : g.kind === 'toy' ? thumbOf.toy(g.key) : g.kind === 'ingredient' ? thumbOf.ing(g.key) : g.kind === 'shampoo' ? thumbOf.shampoo(g.key) : thumbOf.meal(g.key));
  function openGiftBox(f) {
    giftFurn = f;
    const L = $('giftList');
    L.innerHTML = '';
    if (f.gift) {
      $('giftSub').textContent = `Inside: ${giftLabel(f.gift)}. Friends who visit through your visit link can open it once each.`;
      const b = document.createElement('button');
      b.className = 'soft';
      b.textContent = 'Take it back out';
      b.addEventListener('click', () => { returnGift(f.gift); f.gift = null; afterGiftChange(); });
      L.appendChild(b);
    } else {
      $('giftSub').textContent = 'Pack something for friends who visit. It leaves your inventory while it is in the box.';
      const opts = [];
      for (const [k, n] of Object.entries(state.inventory)) if (n > 0) opts.push({ kind: 'item', key: k, n });
      for (const k of state.toys) if (k !== 'tennis' && k !== state.toy) opts.push({ kind: 'toy', key: k, n: 1 });
      for (const [k, n] of Object.entries(state.pantry)) if (n > 0) opts.push({ kind: 'ingredient', key: k, n });
      for (const [k, n] of Object.entries(state.shampoos)) if (n > 0) opts.push({ kind: 'shampoo', key: k, n });
      state.meals.forEach((m) => opts.push({ kind: 'meal', key: m.id, q: m.q, n: 1 }));
      if (!opts.length) L.innerHTML = '<p class="sub">Nothing to pack yet.</p>';
      const grid = document.createElement('div');
      grid.className = 'wardGrid';
      const seen = new Set();
      for (const o of opts) {
        const k = o.kind + o.key + (o.q || '');
        if (seen.has(k)) continue;
        seen.add(k);
        const b = document.createElement('button');
        b.className = 'toyCard';
        b.innerHTML = `${giftThumb(o)}<b></b><small>${o.kind}${o.n > 1 ? ' ×' + o.n : ''}</small>`;
        b.querySelector('b').textContent = plain(giftLabel(o));
        b.addEventListener('click', () => { if (takeForGift(o)) { f.gift = { id: newId(), kind: o.kind, key: o.key, q: o.q }; afterGiftChange(); toast(`🎁 Packed ${giftLabel(f.gift)} — share your home from 🐾 Menu → ⚙️ Settings`); } });
        grid.appendChild(b);
      }
      L.appendChild(grid);
    }
    $('giftModal').classList.remove('hidden');
  }
  function takeForGift(o) {
    if (o.kind === 'item') { if (!(state.inventory[o.key] > 0)) return false; state.inventory[o.key]--; }
    else if (o.kind === 'toy') { state.toys = state.toys.filter((t) => t !== o.key); }
    else if (o.kind === 'ingredient') { if (!(state.pantry[o.key] > 0)) return false; state.pantry[o.key]--; }
    else if (o.kind === 'shampoo') { if (!(state.shampoos[o.key] > 0)) return false; state.shampoos[o.key]--; }
    else if (o.kind === 'meal') { const i = state.meals.findIndex((m) => m.id === o.key && m.q === o.q); if (i < 0) return false; state.meals.splice(i, 1); }
    return true;
  }
  // put a gift into a save object (yours, or your own save while visiting)
  function applyGift(st, g) {
    if (g.kind === 'item') st.inventory[g.key] = (st.inventory[g.key] || 0) + 1;
    else if (g.kind === 'toy') { if (!st.toys.includes(g.key)) st.toys.push(g.key); else st.coins += 5; }
    else if (g.kind === 'ingredient') st.pantry[g.key] = (st.pantry[g.key] || 0) + 1;
    else if (g.kind === 'shampoo') st.shampoos[g.key] = (st.shampoos[g.key] || 0) + 1;
    else if (g.kind === 'meal') st.meals.push({ id: g.key, q: g.q || 2 });
  }
  function returnGift(g) { applyGift(state, g); }
  function afterGiftChange() {
    const r = furnRT.get(giftFurn);
    if (r) r.group.userData.filled = !!giftFurn.gift;
    $('giftModal').classList.add('hidden');
    save();
  }
  $('giftModal').addEventListener('click', (e) => { if (e.target.id === 'giftModal' || e.target.closest('[data-act="closeGift"]')) $('giftModal').classList.add('hidden'); });

  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(str) { return decodeURIComponent(escape(atob(str))); }
  function makeVisitCode() {
    const name = dogs[0] ? dogs[0].name : 'A friend';
    const payload = {
      k: 1, uid: state.uid, name: `${name}${dogs.length > 1 ? ' & friends' : ''}`,
      chunks: state.chunks, gardens: Object.keys(state.gardens), rooms: state.rooms,
      f: state.furniture.map((f) => [f.type, f.i, f.j, f.rot || 0, f.on ? 1 : 0, f.gift || 0]),
      dogs: dogs.map((d) => [d.name, d.breed, d.coat, d.acc]),
    };
    const b = b64enc(JSON.stringify(payload));
    return 'VPV:' + b + '.' + hashStr(b).toString(36);
  }
  function parseVisitCode(code) {
    let c = decodeURIComponent(String(code || '').trim());
    const m = c.match(/VPV:([A-Za-z0-9+/=]+)\.([a-z0-9]+)/);
    if (!m || hashStr(m[1]).toString(36) !== m[2]) return null;
    const p = JSON.parse(b64dec(m[1]));
    if (!p || p.k !== 1 || !Array.isArray(p.chunks)) return null;
    return {
      uid: p.uid, name: p.name, build: null, clutter: [],
      chunks: p.chunks, rooms: p.rooms || {}, gardens: Object.fromEntries((p.gardens || []).map((k) => [k, true])),
      furniture: (p.f || []).filter((x) => D.ITEMS[x[0]]).map(([type, i, j, rot, on, gift]) => ({ type, i, j, rot, on: !!on, gift: gift || null, filled: true })),
      dogs: (p.dogs || []).map(([name, breed, coat, acc]) => ({ name, breed, coat, acc })),
    };
  }
  function visitLink() {
    return location.origin + location.pathname + '#visit=' + encodeURIComponent(makeVisitCode());
  }
  function claimVisitGift(f) {
    if (!f.gift) { toast('This gift box is empty'); return; }
    let own = null;
    try { own = JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY)); } catch (_) { own = null; }
    if (!own) { toast('Start your own game first to keep gifts 🐾'); return; }
    own = normalize(migrate(own));
    if (own.uid && own.uid === visit.uid) { toast("This is your own home — gifts are for visitors 🎁"); return; }
    if (own.claimedGifts.includes(f.gift.id)) { toast('You already opened this gift 🎁'); return; }
    applyGift(own, f.gift);
    own.claimedGifts.push(f.gift.id);
    try { localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(own)); } catch (_) { toast('Could not save the gift'); return; }
    confetti(tileCenter(f).add(new V3(0, 1, 0)));
    toast(`🎁 You got ${giftLabel(f.gift)}! It's waiting in your own game`);
  }

  // Visiting: show a friend's home with their dogs wandering around
  class GuestDog extends Dog {
    constructor(data) {
      super(Object.assign({ born: Date.now() - 400 * DAY, grown: true, revealed: true, happy: 90, hunger: 95, thirst: 95, energy: 90, clean: 95 }, data));
      this.npc = true;
      const label = textSprite(this.name, 0.3);
      label.position.y = this.headBaseY + 0.62;
      this.root.add(label);
    }
    tickNeeds() { /* guests are always fine */ }
    addBond() { /* not yours */ }
    updateBubble() { /* no need bubbles */ }
    decide() {
      const r = Math.random();
      if (r < 0.45) this.goTo(randomFreePoint(), 1.4, null, 0.2);
      else if (r < 0.65) this.goTo(() => player.root.position, 2.4, () => { this.faceTo(player.root.position); this.idle(rand(2, 4)); }, 1.2);
      else this.setState(r < 0.85 ? 'sit' : 'lounge', rand(3, 6));
    }
  }
  const guests = [];

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
  const canPlay = (d) => d.energy > 8 && !['sleep', 'eat', 'drink', 'fetch', 'return', 'towel', 'wait', 'hide', 'attend', 'trick', 'confused', 'play', 'greet', 'scuffle', 'bath', 'stay'].includes(d.state);

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
    const snow = place === 'park' && !!LOC().snowy;           // snowball fetch in the Snowy Village
    const toyId = snow ? 'snowball' : state.toy;
    const def = D.TOYS[toyId] || D.TOYS.tennis;
    const grav = place === 'park' && LOC().lowGravity ? D.LOW_GRAVITY : null;  // fetch on the moon
    const p = player.root.position, a = player.root.rotation.y;
    let dist = rand(3.5, 5.5) * def.dist * windBoost() * (grav ? grav.dist : 1), tx = 0, tz = 0, ok = false;
    for (; dist > 0.9; dist -= 0.4) {
      tx = p.x + Math.sin(a) * dist;
      tz = p.z + Math.cos(a) * dist;
      if (inBounds(tx, tz, 0.3) && !isSolid(tx, tz) && (place === 'home' || !inPond(tx, tz, 0.3))) { ok = true; break; }
    }
    if (!ok) { toast('No room to throw — turn around!'); return; }
    setBallToy(toyId);
    ball.snow = snow;
    ball.arcK = grav ? grav.arc : 1;
    ball.timeK = grav ? grav.time : 1;
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
      ball.t += dt / ((def.time || 0.75) * (ball.timeK || 1));
      const t = Math.min(1, ball.t);
      ball.mesh.position.set(
        lerp(ball.from.x, ball.to.x, t),
        lerp(ball.from.y, def.restY, t) + Math.sin(Math.PI * t) * def.arc * (ball.arcK || 1),
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
        if (ball.snow && Math.random() < 0.25) {
          // snowballs don't always survive the landing
          spawnEmoji('❄️', ball.mesh.position.clone().add(new V3(0, 0.4, 0)), { size: 0.5 });
          const d = dogs.find((x) => x.state === 'fetch');
          resetBall();
          if (d) { d.setState('confused', 1.2); d.happy = Math.min(100, d.happy + 5); toast(`The snowball burst! ❄️ ${d.name} looks puzzled`); }
          return;
        }
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
    const k = D.TOYS[state.toy] ? state.toy : 'tennis';
    document.querySelectorAll('.toyIcon').forEach((el) => { if (el.dataset.toy !== k) { el.dataset.toy = k; el.innerHTML = TH('toy', k); } });
  }

  // =====================================================================
  // Scenes: home <-> walks
  // =====================================================================
  let walkInfo = null;     // what the walk was like when it started (for records)
  function recordWalk(wasAt) {
    const st = state.stats;
    st.walks = (st.walks || 0) + 1;
    if (curWeather().precip === 'rain' && !(S.env && S.env.noWeather)) st.rainWalks = (st.rainWalks || 0) + 1;
    state.locWalks[wasAt] = (state.locWalks[wasAt] || 0) + 1;
    st.longestWalk = Math.max(st.longestWalk || 0, Math.round(walkTotal));
    st.bestWalkCoins = Math.max(st.bestWalkCoins || 0, walkEarn);
    if (walkInfo && walkInfo.night) st.nightWalks = (st.nightWalks || 0) + 1;
    if (walkInfo && walkInfo.storm) st.stormWalks = (st.stormWalks || 0) + 1;
    progress('walk');
    progress('walk:' + wasAt);
  }
  function goWalk(id = 'park') {
    if (!dogs.length) return;
    if (!locUnlocked(id)) { toast('That place is still locked 🔒'); return; }
    if (!canVisitNow(id)) { toast(`${D.LOCATIONS[id].icon} ${D.LOCATIONS[id].name} is closed right now — it opens at ${D.LOCATIONS[id].hours[0]}:00`); return; }
    useScene(id);
    place = 'park';
    homeRoot.visible = false;
    parkRoot.visible = true;
    resetBall();
    towelTask = null;
    useTask = null;
    vendorTask = null;
    camFocus = null;
    player.moveTarget = null;
    player.root.position.set(0, 0, 16);
    player.root.rotation.y = player.face = Math.PI;
    walkTotal = 0;
    walkInfo = { night: nightLevel > 0.5, storm: !!curWeather().lightning, rain: curWeather().precip === 'rain' };
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
    sniffSpots.forEach((s) => { s.taken = null; s.cooldown = 0; });
    walkDist = 0;
    walkEarn = 0;
    tiredWarned = false;
    spawnParkLoot();
    spawnWalkers();
    startQuirks();
    refreshLeashBtn();
    refreshUI();
    applyEnvironment();
    updateCamera(0, true);
    const W = curWeather();
    const intro = {
      oldtown: 'Welcome to Old Town! 🚦 Wait for green at the crosswalks · tap a stall to shop',
      forest: 'The Whispering Forest… 🌲 Faint side trails lead to hidden glades',
      beach: tideLevel() > 0.6 ? 'Sunny Beach — it’s low tide! 🦀 Tide pools are open' : 'Sunny Beach! 🏖️ Look for ❌ — something is buried there',
      alpine: 'Alpine Meadow! ⛳ Touch all 4 checkpoints to reach the summit',
      caves: 'Crystal Caves… 🔦 It’s dark down here. Listen for echoes',
      snowy: clockNow.month === 12 ? 'Snowy Village — so festive in December! 🎄' : 'Snowy Village! ❄️ Throws turn into snowballs here',
      carnival: 'Moonlight Carnival! 🎡 Do the trick a booth asks for to win 🎟️ tickets',
      fairy: 'The Fairy Realm… ✨ The animals here can talk!',
      moon: 'Moon Base! 🌕 Everything is bouncy up here — try a throw',
    }[loc];
    toast(intro || (parkLoot ? 'Walk time! Something is glinting in the grass… ✨' : W.muddy ? `Walk time! It's ${W.name.toLowerCase()} — expect muddy paws 🐾` : 'Walk time! Let your dog sniff the ✨ spots'));
  }

  function goHome() {
    if (tm) exitTrickMode();
    const wasAt = loc;
    place = 'home';
    homeRoot.visible = true;
    parkRoot.visible = false;
    resetBall();
    clearParkLoot();
    clearWalkers();
    endQuirks();
    vendorTask = null;
    setCtx(null);
    for (let i = 0; i < dogs.length; i++) for (let j = i + 1; j < dogs.length; j++) addFriendship(dogs[i], dogs[j], 1);
    towelTask = null;
    player.moveTarget = null;
    player.root.position.copy(freeNear(CHUNK / 2, CHUNK - 1.2));
    player.root.rotation.y = player.face = Math.PI;
    dogs.forEach((d, i) => {
      d.dropSpot();
      d.offLeash = false;
      d.returning = false;
      d.partner = null;
      d.leash.visible = false;
      d.root.position.copy(freeNear(clamp(CHUNK / 2 - 0.7 + i * 0.5, 0.5, CHUNK - 0.5), CHUNK - 2));
      d.idle(rand(1, 3));
      d.addBond(2);
      d.updateDirtLook();
    });
    sniffSpots.forEach((s) => { s.taken = null; });
    parkWater.taken = null;
    recordWalk(wasAt);
    refreshUI();
    applyEnvironment();
    updateCamera(0, true);
    toast(walkEarn > 0 ? `Great walk! You earned 🪙 ${walkEarn}` : 'Back home 🏠');
    save();
  }

  function updateSniffSpots(dt) {
    for (const s of sniffSpots) {
      if (s.cooldown > 0) s.cooldown -= dt;
      s.sparkle.visible = s.cooldown <= 0 && s.active !== false;
      s.phase += dt;
      s.sparkle.position.y = 1.15 + Math.sin(s.phase * 2.5) * 0.08;
    }
  }

  // =====================================================================
  // Finds for the 📒 book, and loot from sniff spots and digging
  // =====================================================================
  function findOk(F) {
    const W = localWeather(), night = nightLevel > 0.5;
    switch (F.when) {
      case 'december': return clockNow.month === 12;
      case 'night': return night;
      case 'day': return !night;
      case 'rain': return W.precip === 'rain';
      case 'snow': return W.precip === 'snow';
      case 'sun': return weatherId === 'sun' && !night;
      default: return true;
    }
  }
  // a find from this place that fits the time and weather (glade finds only in glades)
  function rollFind(where, kind) {
    const list = Object.entries(D.FINDS).filter(([, F]) => F.loc === where && F.weight > 0 && findOk(F) && (!F.glade || kind === 'glade') && (!F.where || F.where === kind));
    if (!list.length) return null;
    const w = (F) => F.weight * (F.glade ? 4 : 1) * (F.when ? 1.5 : 1);
    let r = Math.random() * list.reduce((s, [, F]) => s + w(F), 0);
    for (const [k, F] of list) { r -= w(F); if (r <= 0) return k; }
    return list[0][0];
  }
  function grantFind(id, pos) {
    const F = D.FINDS[id];
    if (!F) return;
    const had = state.finds[id] || 0;
    state.finds[id] = had + 1;
    const at = pos ? pos.clone().add(new V3(0, 1.1, 0)) : null;
    if (had) {
      addCoins(D.FIND_DUPLICATE_COINS, null);
      toast(`Another ${F.icon} ${F.name} — traded it for 🪙 ${D.FIND_DUPLICATE_COINS}`);
    } else {
      toast(`📒 New for your book: ${F.icon} ${F.name}!`);
      if (at) confetti(at, 4);
    }
    if (at) spawnEmoji(F.icon, at, { size: 0.55, life: 1.6, vy: 0.7 });
    progress('find');
    save();
  }
  function walkLoot(d, spot) {
    const pos = d.root.position;
    const kind = spot && spot.kind;
    if (Math.random() < D.RARE_FIND * (kind === 'glade' ? 4 : 1)) { findRare(pos); return; }
    if (kind === 'pool' && Math.random() < 0.7) { grantFind(pick(['starfish', 'crabclaw']), pos); return; }
    if (kind === 'crystal') {
      const c = S.q.crystals.find((x) => x.spot === spot);
      if (c) { c.lit = 0; c.mat.emissiveIntensity = 0.04; }
      spot.active = false;
      spot.cooldown = 9999;
      progress('crystal');
      grantFind(rollFind(loc, 'crystal') || 'amethyst', pos);
      return;
    }
    if (kind === 'glade' && Math.random() < 0.5) { const f = rollFind(loc, 'glade'); if (f) { grantFind(f, pos); return; } }
    if (loc === 'oldtown' && Math.random() < 0.1) {
      addDirt(d, 'icecream', 8);
      d.happy = Math.min(100, d.happy + 6);
      toast(`${d.name} licked up some dropped ice cream 🍦 — sticky!`);
      spawnEmoji('🍦', d.headWorld(0.3), { size: 0.4 });
      return;
    }
    const L = LOC().loot;
    const opts = [['coins', L.coins], ['find', L.find], ['ingredient', L.ingredient], ['toy', L.toy]];
    let r = Math.random() * opts.reduce((s, o) => s + o[1], 0), what = 'coins';
    for (const [k, w] of opts) { r -= w; if (r <= 0) { what = k; break; } }
    if (what === 'find') { const f = rollFind(loc, kind); if (f) { grantFind(f, pos); return; } what = 'coins'; }
    if (what === 'ingredient') { findIngredient(pos, LOC().ingredients); return; }
    if (what === 'toy') { grantToy(rollToy(), pos); return; }
    addCoins(Math.round(2 * d.mod('sniffCoins')), pos);
    spawnEmoji('✨', d.headWorld(0.3), { size: 0.4 });
  }
  // sandy dig spots on the beach (one hides a treasure chest on every walk)
  function beachDig(d, spot) {
    spot.cooldown = 9999;
    const pos = spot.pos.clone();
    addDirt(d, 'sand', 5);
    d.happy = Math.min(100, d.happy + 8);
    progress('beachdig');
    if (spot.treasure) {
      spot.treasure = false;
      if (spot.mark) spot.mark.visible = false;
      const T = D.TREASURE, n = T.min + Math.floor(Math.random() * (T.max - T.min + 1));
      state.treasures = (state.treasures || 0) + 1;
      addCoins(n, pos);
      toast(`🏴‍☠️ ${d.name} dug up a treasure chest! 🪙 ${n}`);
      confetti(pos.clone().add(new V3(0, 1, 0)), 8);
      setTimeout(() => grantFind('piratecoin', pos), 1400);
      if (Math.random() < T.rareChance) setTimeout(() => findRare(pos), 3000);
      save();
      return;
    }
    const r = Math.random();
    if (r < 0.35) { const f = rollFind('beach'); if (f) { grantFind(f, pos); return; } }
    if (r < 0.45) { grantToy(rollToy(), pos); return; }
    if (r < 0.75) { addCoins(1 + Math.floor(Math.random() * 3), pos); return; }
    spawnEmoji('🕳️', d.headWorld(-0.2), { size: 0.35, life: 0.9 });
  }

  // =====================================================================
  // What makes each place special: traffic lights, pigeons, squirrels, glades,
  // tides, crabs, treasure, cows, checkpoints and wind
  // =====================================================================
  let quirk = {};
  let tideOverride = null;
  const isNight = () => nightLevel > 0.5;
  const isWinter = () => clockNow.month === 12 || clockNow.month <= 2;
  // 0 = high tide, 1 = low tide. A real 12.42-hour tide clock, the same for everyone.
  function tideLevel() {
    if (tideOverride !== null) return tideOverride;
    return (1 - Math.cos((Date.now() / 3600000 / 12.42) * TAU)) / 2;
  }
  const tideFalling = () => Math.sin((Date.now() / 3600000 / 12.42) * TAU) > 0;
  const windBoost = () => (place === 'park' && loc === 'alpine' && quirk.gust > 0 ? 1.35 : 1);
  function inPlaza(p) {
    const P = S.q && S.q.plaza;
    return !!P && loc === 'oldtown' && Math.abs(p.x - P.x) < P.r && Math.abs(p.z - P.z) < P.r;
  }
  // red light: nobody may step onto the crosswalks
  function quirkSolid(x, z) {
    if (place !== 'park' || loc !== 'oldtown' || !quirk.light || quirk.light.green) return false;
    return S.q.crosswalks.some((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1);
  }
  function startQuirks() {
    quirk = { t: 0, gladeSeen: new Set(), flags: [false, false, false, false], plazaCoins: 0, gust: 0, nextGust: rand(12, 25) };
    const q = S.q;
    if (loc === 'oldtown') { quirk.light = { green: false, t: D.CROSSWALK.red }; q.setPed(false); }
    if (loc === 'beach') {
      q.digs.forEach((s) => { s.treasure = false; s.mark.visible = false; });
      const t = pick(q.digs);
      t.treasure = true;
      t.mark.visible = true;
      q.crabs.forEach((c) => { c.met = false; c.hide = 0; c.g.position.y = 0; });
    }
    if (loc === 'alpine') {
      q.flags.forEach((f) => { f.flag.material = mat('#e53935'); });
      q.cows.forEach((c) => { c.met = false; });
    }
    if (loc === 'forest') q.squirrels.forEach((s) => { s.spotted = false; s.state = 'ground'; s.g.position.y = 0; s.g.visible = true; });
    if (loc === 'caves') q.crystals.forEach((c) => { c.lit = 0; c.spot.active = false; c.mat.emissiveIntensity = 0.04; });
    if (loc === 'carnival') {
      quirk.tickets = 0;
      quirk.booths = [];
      q.booths.forEach((b, k) => { quirk.booths[k] = boothTrick(quirk.booths[k - 1]); boothSign(k); });
    }
    if (loc === 'fairy') {
      q.statues.forEach((st) => { st.rot = Math.floor(Math.random() * 4); st.group.rotation.y = st.rot * Math.PI / 2; });
      if (q.statues.every((st) => st.rot === st.target)) { q.statues[0].rot = (q.statues[0].rot + 1) % 4; q.statues[0].group.rotation.y = q.statues[0].rot * Math.PI / 2; }
      q.floaters.forEach((f) => { f.away = 0; f.g.visible = true; });
      q.animals.forEach((a) => { a.t = 0; a.bubble.visible = false; });
    }
    if (loc === 'moon') {
      q.craters.forEach((c) => { c.treasure = false; c.mark.visible = false; });
      const t = pick(q.craters);
      t.treasure = true;
      t.mark.visible = true;
    }
    updateLocChip();
  }
  function endQuirks() {
    quirk = {};
    $('locChip').classList.add('hidden');
  }
  function updateLocChip() {
    const el = $('locChip');
    let ic = '', txt = '', cls = '';
    if (place === 'park') {
      if (loc === 'oldtown' && quirk.light) { ic = 'dot'; txt = quirk.light.green ? 'Walk' : 'Wait'; cls = quirk.light.green ? 'go' : 'stop'; }
      else if (loc === 'forest') { ic = 'sprout'; txt = `${state.glades.length}/3 glades`; }
      else if (loc === 'beach') { const t = tideLevel(); ic = 'wave'; txt = t > 0.6 ? 'Low tide' : t < 0.3 ? 'High tide' : tideFalling() ? 'Tide going out' : 'Tide coming in'; }
      else if (loc === 'alpine') { ic = 'flag'; txt = `${quirk.flags ? quirk.flags.filter(Boolean).length : 0}/4`; }
      else if (loc === 'caves') { ic = 'lamp'; txt = 'Dark caves'; }
      else if (loc === 'snowy') { ic = 'snow'; txt = clockNow.month === 12 ? 'Festive!' : 'Snowy'; }
      else if (loc === 'carnival') { ic = 'ticket'; txt = String(state.tickets); }
      else if (loc === 'fairy') { ic = 'sparkle'; txt = 'Magic'; }
      else if (loc === 'moon') { ic = 'moon'; txt = 'Low gravity'; }
    }
    el.classList.toggle('hidden', !txt);
    const key = ic + '|' + txt + '|' + cls;
    if (el.dataset.k !== key) { el.dataset.k = key; el.className = 'chip glass' + (txt ? '' : ' hidden') + (cls ? ' ' + cls : ''); el.innerHTML = `${IC(ic)}<span>${esc(txt)}</span>`; }
  }
  function locChipInfo() {
    const msg = {
      oldtown: quirk.light && !quirk.light.green ? '🔴 Red light at the crosswalks — wait for green. Tap ✋ Stay while you wait.' : '🟢 Green — you can cross the street now',
      forest: `🌿 You found ${state.glades.length} of 3 hidden glades. Look for faint side trails!`,
      beach: `${tideLevel() > 0.6 ? 'Low tide: tide pools are open' : 'Tide pools open at low tide'} · real tide times, about every 12½ hours`,
      alpine: 'Touch all 4 numbered checkpoints on the trail to reach the summit ⛰️',
      caves: canEcho() ? 'Tap 💬 Speak: the echo lights up hidden crystals nearby. Sniff them before they fade!' : 'Teach a dog 💬 Speak — echoes reveal hidden crystals here',
      snowy: 'Sled from the 🛷 sign by the hill · throws become snowballs · the 🚀 rocket by the observatory needs moonstones',
      carnival: `You have ${state.tickets} 🎟️. Stand at a game booth and do the trick on its sign. Trade tickets at the 🎪 Prize booth`,
      fairy: 'Turn the four stone dogs (tap them) until they all face the glowing orb · catch floating toys · say hi to the animals',
      moon: 'Low gravity: throws fly high and far · dig in craters — one ❌ hides a space capsule',
    }[loc];
    if (msg) toast(msg);
  }
  function updateQuirks(dt) {
    quirk.t = (quirk.t || 0) + dt;
    const q = S.q, pp = player.root.position;
    let want = null;
    switch (loc) {
      case 'oldtown': want = updateOldTown(dt, q, pp); break;
      case 'forest': want = updateForest(dt, q, pp); break;
      case 'beach': updateBeach(dt, q, pp); break;
      case 'alpine': updateAlpine(dt, q, pp); break;
      case 'caves': want = updateCaves(dt, q, pp); break;
      case 'snowy': want = updateSnowy(dt, q, pp); break;
      case 'carnival': want = updateCarnival(dt, q, pp); break;
      case 'fairy': updateFairy(dt, q, pp); break;
      case 'moon': updateMoon(dt, q, pp); break;
      default: break;
    }
    setCtx(mode === 'normal' && place === 'park' ? want : null);
  }
  // the extra button in the walk bar changes with what's nearby
  const CTX = { stay: ['hand', 'Stay'], echo: ['echo', 'Speak'], sled: ['sled', 'Sled'], ferris: ['ferris', 'Ride'], portal: ['portal', 'Portal'], rocket: ['rocket', 'Rocket'] };
  let ctxKind = null;
  function setCtx(k) {
    if (k === ctxKind) return;
    ctxKind = k;
    const b = $('ctxBtn');
    b.classList.toggle('hidden', !k);
    if (k) b.innerHTML = `${IC(CTX[k][0], 'dIc')}<small>${CTX[k][1]}</small>`;
    placeToast();
  }
  function ctxAction() {
    switch (ctxKind) {
      case 'stay': askStay(); break;
      case 'echo': doEcho(); break;
      case 'sled': startSled(); break;
      case 'ferris': rideWheel(); break;
      case 'portal': usePortal(); break;
      case 'rocket': useRocket(); break;
      default: break;
    }
  }
  const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // ----- Old Town -----
  function updateOldTown(dt, q, pp) {
    const L = quirk.light;
    L.t -= dt;
    if (L.t <= 0) {
      L.green = !L.green;
      L.t = L.green ? D.CROSSWALK.green : D.CROSSWALK.red;
      q.setPed(L.green);
      quirk.warned = false;
      if (L.green) {
        const stayed = dogs.filter((d) => d.state === 'stay');
        if (stayed.length) {
          stayed.forEach((d) => {
            d.tricks.stay = (d.tricks.stay || 0) + 0.5;
            d.happy = Math.min(100, d.happy + 4);
            d.addBond(1);
            spawnEmoji('⭐', d.headWorld(0.4), { size: 0.4 });
            d.setState('follow');
          });
          const n = D.CROSSWALK.coins * stayed.length;
          addCoins(n, pp);
          state.stats.crosswalks = (state.stats.crosswalks || 0) + 1;
          progress('crosswalk');
          toast(`🟢 Green! ${stayed.map((d) => d.name).join(' & ')} waited perfectly ✋ +🪙 ${n}`);
        }
      }
      updateLocChip();
    }
    // waiting next to a crosswalk on red
    const cw = q.crosswalks.find((c) => Math.hypot(pp.x - c.cx, pp.z - c.cz) < 3.4);
    const inside = cw && pp.x > cw.x0 && pp.x < cw.x1 && pp.z > cw.z0 && pp.z < cw.z1;
    const ready = dogs.some((d) => d.onLeash() && d.state !== 'stay');
    const show = !L.green && !!cw && !inside && ready && mode === 'normal';
    const want = show ? 'stay' : null;
    if (!L.green && cw && !inside && !quirk.warned && pp.x > cw.x0 - 0.8 && pp.x < cw.x1 + 0.8 && pp.z > cw.z0 - 0.8 && pp.z < cw.z1 + 0.8) {
      quirk.warned = true;
      toast('🔴 Red light! Wait for green — tap ✋ Stay so your dog waits nicely');
    }
    if (!cw) dogs.forEach((d) => { if (d.state === 'stay') d.setState('follow'); });
    // cars stop for people when the light is green for them
    for (const c of q.cars) {
      const x = c.g.position.x, nx = x + c.dir * c.speed * dt;
      const front = (v) => v + c.dir * 0.9;
      let stop = L.green && q.crosswalks.some((w) => {
        const lo = w.x0 - 0.4, hi = w.x1 + 0.4, a = front(x), b = front(nx);
        return !(a > lo && a < hi) && b > lo && b < hi;
      });
      if (!stop) stop = q.cars.some((o) => o !== c && o.dir === c.dir && (o.g.position.x - x) * c.dir > 0 && (o.g.position.x - x) * c.dir < 2.3);
      if (!stop) c.g.position.x = nx > 26 ? -26 : nx < -26 ? 26 : nx;
    }
    // pigeons flutter off when someone comes close
    const P = q.plaza;
    for (const p of q.pigeons) {
      p.t += dt;
      const g = p.g;
      const scare = flatDist(pp, g.position) < 1.6 || dogs.some((d) => flatDist(d.root.position, g.position) < 1.8);
      if (p.fly <= 0 && scare) {
        p.fly = rand(2.5, 4);
        const a = rand(0, TAU), rr = rand(2, 4);
        p.to = new V3(P.x + Math.sin(a) * rr, 0, P.z + Math.cos(a) * rr);
        dogs.forEach((d) => { if (flatDist(d.root.position, g.position) < 2.5) d.happy = Math.min(100, d.happy + (d.flag('zooms') ? 3 : 1)); });
        if (!quirk.pigeonToast) { quirk.pigeonToast = true; spawnEmoji('🕊️', g.position.clone().add(new V3(0, 1, 0)), { size: 0.45 }); }
      }
      if (p.fly > 0) {
        p.fly -= dt;
        const dx = p.to.x - g.position.x, dz = p.to.z - g.position.z, dd = Math.hypot(dx, dz);
        if (dd > 0.05) { const st = Math.min(dd, 3 * dt); g.position.x += (dx / dd) * st; g.position.z += (dz / dd) * st; g.rotation.y = Math.atan2(dx, dz); }
        g.position.y = p.fly > 0.6 ? Math.min(1.8, g.position.y + dt * 3) : Math.max(0, g.position.y - dt * 3);
        g.rotation.x = 0;
      } else {
        g.position.y = 0;
        g.rotation.x = Math.max(0, Math.sin(p.t * 6)) * 0.35;
      }
    }
    // night: a cat on the wall · rain: puddles
    const night = isNight();
    q.cat.visible = night;
    if (night) {
      quirk.catT = (quirk.catT || 0) - dt;
      const d = dogs.find((x) => flatDist(x.root.position, q.cat.position) < 3.5);
      if (d && quirk.catT <= 0) {
        quirk.catT = 8;
        spawnEmoji('😾', q.cat.position.clone().add(new V3(0, 0.8, 0)), { size: 0.45 });
        spawnEmoji('💬', d.headWorld(0.4), { size: 0.4 });
        d.happy = Math.min(100, d.happy + 2);
      }
    }
    q.puddles.visible = curWeather().precip === 'rain';
    return want;
  }
  // ✋ Stay at a red light
  function askStay() {
    if (!(place === 'park' && loc === 'oldtown' && quirk.light && !quirk.light.green)) return;
    const ok = [], no = [];
    for (const d of dogs) {
      if (!d.onLeash() || d.state === 'stay' || ['trick', 'attend', 'play', 'greet', 'scuffle'].includes(d.state)) continue;
      const lvl = d.trickLvl('stay');
      if (Math.random() < (lvl ? D.TRICK_SUCCESS[lvl] : 0.25)) {
        d.dropSpot();
        d.onArrive = null;
        d.faceTo(player.root.position);
        d.setState('stay');
        spawnEmoji('✋', d.headWorld(0.4), { size: 0.4 });
        ok.push(d.name);
      } else {
        d.tricks.stay = (d.tricks.stay || 0) + 0.2;
        spawnEmoji('❓', d.headWorld(0.4), { size: 0.4 });
        no.push(d.name);
      }
    }
    const fail = no.length ? `${no.join(' & ')} can't sit still — practice ✋ Stay in 🎓 Trick Mode` : '';
    toast(ok.length ? `✋ ${ok.join(' & ')} ${ok.length > 1 ? 'are' : 'is'} waiting nicely${fail ? ' · ' + fail : ''}` : fail || 'Everyone is already waiting');
    setCtx(null);
  }
  // tricks on the Old Town plaza earn coins from the crowd
  function plazaPerformance(d, lvl) {
    progress('plaza');
    const cap = LOC().plazaCap || 40;
    if (quirk.plazaCoins >= cap) {
      if (!quirk.plazaTired) { quirk.plazaTired = true; setTimeout(() => toast('The crowd has seen enough tricks for today 👏'), 900); }
      return;
    }
    const n = Math.min(cap - quirk.plazaCoins, D.PLAZA_COINS[lvl] || 1);
    quirk.plazaCoins += n;
    const first = !quirk.plazaToast;
    quirk.plazaToast = true;
    setTimeout(() => {
      addCoins(n, d.root.position);
      spawnEmoji('👏', d.headWorld(0.7), { size: 0.45 });
      if (first) toast(`👏 A crowd gathers on the plaza! +🪙 ${n} for every trick`);
    }, 800);
  }

  // ----- Whispering Forest -----
  const fm4 = new THREE.Matrix4();
  function updateForest(dt, q, pp) {
    for (const g of q.glades) {
      g.beam.material.opacity = 0.1 + Math.sin(quirk.t * 1.3 + g.x) * 0.04;
      if (quirk.gladeSeen.has(g.id) || Math.hypot(pp.x - g.x, pp.z - g.z) > g.r) continue;
      quirk.gladeSeen.add(g.id);
      progress('glade');
      dogs.forEach((d) => { d.happy = Math.min(100, d.happy + 5); });
      if (!state.glades.includes(g.id)) {
        state.glades.push(g.id);
        toast(`🌿 You found a hidden glade! (${state.glades.length}/3)`);
        confetti(new V3(g.x, 1, g.z));
        save();
      } else toast('🌿 A quiet hidden glade. The dogs love it here');
      updateLocChip();
    }
    for (const s of q.squirrels) updateSquirrel(s, dt, pp);
    const night = isNight();
    const ff = q.fireflies;
    ff.mesh.visible = night;
    if (night) {
      ff.base.forEach(([x, y, z, ph], i) => {
        fm4.makeTranslation(x + Math.sin(quirk.t * 0.7 + ph) * 0.6, y + Math.sin(quirk.t * 1.3 + ph * 2) * 0.3, z + Math.cos(quirk.t * 0.6 + ph) * 0.6);
        ff.mesh.setMatrixAt(i, fm4);
      });
      ff.mesh.instanceMatrix.needsUpdate = true;
    }
    q.owl.visible = night;
    q.snails.visible = curWeather().precip === 'rain';
    // the fairy portal shows up once you own a fairy ring stone
    const P = q.portal;
    P.group.visible = !!state.finds.fairystone || state.portal;
    if (!P.group.visible) return null;
    P.ring.rotation.z += dt * 0.8;
    if (!quirk.portalToast && flatDist(pp, P.pos) < 7) { quirk.portalToast = true; toast('✨ Something shimmers in the north glade…'); }
    return flatDist(pp, P.pos) < 2.4 ? 'portal' : null;
  }
  function updateSquirrel(s, dt, pp) {
    const g = s.g;
    s.t += dt;
    const dogNear = dogs.find((d) => flatDist(d.root.position, g.position) < 2.6);
    if (s.state === 'ground') {
      if (!s.spotted && flatDist(pp, g.position) < 7) {
        s.spotted = true;
        progress('squirrel');
        if (!quirk.sqToast) { quirk.sqToast = true; toast('🐿️ A squirrel! Don’t let your dog see it…'); }
      }
      if (dogNear || flatDist(pp, g.position) < 1.5) {
        s.state = 'flee';
        spawnEmoji('❗', g.position.clone().add(new V3(0, 0.7, 0)), { size: 0.35, life: 0.8 });
        if (dogNear) {
          dogNear.happy = Math.min(100, dogNear.happy + 3);
          if (dogNear.offLeash && dogNear.state === 'roam') { dogNear.roamTarget = s.tree.clone(); dogNear.roamTimer = 2; }
        }
        return;
      }
      if (!s.target || s.t > 2.5) {
        s.t = 0;
        const a = rand(0, TAU), r = rand(0.8, 2.2);
        s.target = new V3(s.tree.x + Math.sin(a) * r, 0, s.tree.z + Math.cos(a) * r);
      }
      const dx = s.target.x - g.position.x, dz = s.target.z - g.position.z, dd = Math.hypot(dx, dz);
      if (dd > 0.05) {
        const st = Math.min(dd, 1.3 * dt);
        g.position.x += (dx / dd) * st;
        g.position.z += (dz / dd) * st;
        g.rotation.y = Math.atan2(dx, dz);
        g.position.y = Math.abs(Math.sin(s.t * 12)) * 0.07;
      } else g.position.y = 0;
      // zoomies dogs off the leash give chase
      for (const d of dogs) {
        if (d.offLeash && d.state === 'roam' && d.flag('zooms') && flatDist(d.root.position, g.position) < 6 && Math.random() < dt) { d.roamTarget = g.position.clone(); d.roamTimer = 2.5; }
      }
    } else if (s.state === 'flee') {
      const tx = s.tree.x + 0.22, tz = s.tree.z + 0.22;
      const dx = tx - g.position.x, dz = tz - g.position.z, dd = Math.hypot(dx, dz);
      if (dd > 0.1) {
        const st = Math.min(dd, 4 * dt);
        g.position.x += (dx / dd) * st;
        g.position.z += (dz / dd) * st;
        g.rotation.y = Math.atan2(dx, dz);
      } else s.state = 'up';
    } else if (s.state === 'up') {
      g.position.y += dt * 2.5;
      g.rotation.x = -Math.PI / 2;
      if (g.position.y > 2.4) { g.visible = false; s.state = 'hidden'; s.hideT = rand(8, 14); }
    } else if (s.state === 'hidden') {
      s.hideT -= dt;
      if (s.hideT <= 0 && !dogNear) {
        g.visible = true;
        g.position.set(s.tree.x + 0.6, 0, s.tree.z + 0.5);
        g.rotation.x = 0;
        s.state = 'ground';
        s.target = null;
      }
    }
  }

  // ----- Sunny Beach -----
  function updateBeach(dt, q, pp) {
    const lvl = tideLevel();
    const edge = q.high + (q.low - q.high) * lvl;
    q.setEdge(edge, Math.sin(quirk.t * 1.3) * 0.35);
    for (const p of q.pools) {
      const open = edge < p.z - 1.6;
      if (p.g.visible !== open) { p.g.visible = open; p.spot.active = open; p.spot.group.visible = open; }
    }
    const open = lvl > 0.6;
    if (quirk.tideOpen !== open) { quirk.tideOpen = open; updateLocChip(); }
    ART.M.sea.emissiveIntensity = 0.1 + nightLevel * 0.6;
    for (const c of q.crabs) {
      c.t += dt;
      const g = c.g;
      if (c.hide > 0) {
        c.hide -= dt;
        g.position.y = Math.max(-0.3, g.position.y - dt);
        if (c.hide <= 0) g.position.y = 0;
        continue;
      }
      g.position.x = c.home.x + Math.sin(c.t * 0.6) * 1.8;
      g.rotation.z = Math.sin(c.t * 14) * 0.05;
      const dn = dogs.find((d) => flatDist(d.root.position, g.position) < 1.6);
      if (dn || flatDist(pp, g.position) < 1.4) {
        c.hide = 4;
        spawnEmoji('🦀', g.position.clone().add(new V3(0, 0.6, 0)), { size: 0.4 });
        if (dn) dn.happy = Math.min(100, dn.happy + 3);
        if (!c.met) {
          c.met = true;
          progress('crab');
          if (!quirk.crabToast) { quirk.crabToast = true; toast('🦀 A crab says hi… and digs itself in!'); }
        }
      }
    }
  }

  // ----- Alpine Meadow -----
  const pm4 = new THREE.Matrix4();
  function updateAlpine(dt, q, pp) {
    for (const c of q.cows) {
      const g = c.g;
      c.t -= dt;
      if (c.target) {
        const dx = c.target.x - g.position.x, dz = c.target.z - g.position.z, dd = Math.hypot(dx, dz);
        if (dd < 0.2) { c.target = null; c.t = rand(4, 9); }
        else {
          g.position.x += (dx / dd) * 0.45 * dt;
          g.position.z += (dz / dd) * 0.45 * dt;
          g.rotation.y = angleLerp(g.rotation.y, Math.atan2(dx, dz), damp(0.05, dt));
        }
      } else if (c.t <= 0) {
        for (let k = 0; k < 10; k++) {
          const x = rand(-9, 9), z = rand(-9, 9);
          if (inPond(x, z, 1.5) || Math.hypot(x - pp.x, z - pp.z) < 2.5 || sniffSpots.some((s) => flatDist(s.pos, { x, z }) < 1.6)) continue;
          if (q.cows.some((o) => o !== c && Math.hypot(o.g.position.x - x, o.g.position.z - z) < 2.2)) continue;
          c.target = new V3(x, 0, z);
          break;
        }
        if (!c.target) c.t = 2;
      }
      c.col.x = g.position.x;
      c.col.z = g.position.z;
      if (Math.random() < dt * 0.12) spawnEmoji('🔔', g.position.clone().add(new V3(0, 1.8, 0)), { size: 0.35, life: 1 });
      if (!c.met && flatDist(pp, g.position) < 2.7) {
        c.met = true;
        progress('cow');
        spawnEmoji('💬', g.position.clone().add(new V3(0, 1.9, 0)), { size: 0.45 });
        dogs.forEach((d) => { if (flatDist(d.root.position, g.position) < 4) d.happy = Math.min(100, d.happy + 3); });
        if (!quirk.cowToast) { quirk.cowToast = true; toast('🐄 Moo! 🔔 The cows say hello'); }
      }
    }
    q.flags.forEach((f, i) => {
      f.flag.rotation.y = Math.sin(quirk.t * 3 + i) * 0.25;
      if (quirk.flags[i] || flatDist(pp, f.pos) > 2.3) return;
      quirk.flags[i] = true;
      f.flag.material = mat('#43a047');
      spawnEmoji('⛳', f.pos.clone().add(new V3(0, 2.8, 0)), { size: 0.5 });
      const n = quirk.flags.filter(Boolean).length;
      updateLocChip();
      if (n === 4) {
        state.summits = (state.summits || 0) + 1;
        addCoins(D.SUMMIT_COINS, pp);
        progress('summit');
        confetti(pp.clone().add(new V3(0, 1.4, 0)), 8);
        dogs.forEach((d) => { d.happy = Math.min(100, d.happy + 8); });
        toast(`⛰️ Summit reached! All 4 checkpoints · +🪙 ${D.SUMMIT_COINS}`);
        save();
      } else toast(`⛳ Checkpoint ${f.n} · ${n}/4`);
    });
    // wind: drifting petals and the odd gust that carries toys farther
    quirk.nextGust -= dt;
    if (quirk.gust > 0) quirk.gust -= dt;
    else if (quirk.nextGust <= 0) {
      quirk.gust = 5;
      quirk.nextGust = rand(25, 45);
      if (!quirk.gustToast) { quirk.gustToast = true; toast('🌬️ A gust of wind! Toys fly farther right now'); }
      else spawnEmoji('🌬️', pp.clone().add(new V3(0, 2.2, 0)), { size: 0.5 });
    }
    const wind = quirk.gust > 0 ? 3.2 : 0.8, P = q.petals;
    P.data.forEach((p, i) => {
      p[0] += wind * dt;
      p[3] += dt;
      if (p[0] > 15) p[0] = -15;
      pm4.makeTranslation(pp.x + p[0], p[1] + Math.sin(p[3] * 2) * 0.3, pp.z + p[2]);
      P.mesh.setMatrixAt(i, pm4);
    });
    P.mesh.instanceMatrix.needsUpdate = true;
    q.snow.visible = isWinter() || curWeather().precip === 'snow';
  }


  // ----- Crystal Caves -----
  const canEcho = () => dogs.some((d) => d.trickLvl('speak') >= 1);
  function updateCaves(dt, q, pp) {
    quirk.echoCd = Math.max(0, (quirk.echoCd || 0) - dt);
    for (const c of q.crystals) {
      if (c.lit <= 0) continue;
      c.lit -= dt;
      c.mat.emissiveIntensity = 0.9 + Math.sin(quirk.t * 4 + c.spot.pos.x) * 0.3;
      if (c.lit <= 0) { c.spot.active = false; c.mat.emissiveIntensity = 0.04; }
    }
    for (const b of q.bats) {
      const sc = b.scatter > 0;
      if (sc) b.scatter -= dt;
      b.ph += dt * b.sp * (sc ? 3 : 1);
      const rad = b.rad + (sc ? 4 : 0);
      b.g.position.set(b.c.x + Math.sin(b.ph) * rad, b.h + Math.sin(b.ph * 3) * 0.2 + (sc ? 1 : 0), b.c.z + Math.cos(b.ph) * rad);
      b.g.rotation.y = b.ph + Math.PI / 2;
      const f = Math.sin(quirk.t * 18 + b.ph) * 0.6;
      b.g.userData.wl.rotation.z = f;
      b.g.userData.wr.rotation.z = -f;
    }
    for (const d of dogs) {
      const p = d.root.position;
      if (!q.slime.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.r)) continue;
      addDirt(d, 'slime', dt * 3);
      if (!quirk.slimeToast) { quirk.slimeToast = true; toast(`${d.name} stepped in glowing slime 🟢`); }
    }
    if (!quirk.hinted) {
      quirk.hinted = true;
      setTimeout(() => place === 'park' && loc === 'caves' && toast(canEcho() ? '💬 Tap Speak: the echo makes hidden crystals glow' : 'Teach 💬 Speak in 🎓 Trick Mode — echoes reveal crystals down here'), 3200);
    }
    return canEcho() && quirk.echoCd <= 0 ? 'echo' : null;
  }
  // a dog barks, the cave echoes, nearby crystals light up and the bats scatter
  function doEcho(d) {
    if (place !== 'park' || loc !== 'caves' || quirk.echoCd > 0) return;
    const q = S.q, pp = player.root.position;
    d = d || dogs.filter((x) => x.trickLvl('speak') >= 1).sort((a, b) => flatDist(a.root.position, pp) - flatDist(b.root.position, pp))[0];
    if (!d) { toast('Teach 💬 Speak in 🎓 Trick Mode first'); return; }
    quirk.echoCd = D.ECHO.cooldown;
    spawnEmoji('💬', d.headWorld(0.4), { size: 0.45 });
    for (let k = 0; k < 3; k++) setTimeout(() => spawnEmoji('🔊', pp.clone().add(new V3(rand(-2, 2), 1.5 + k * 0.4, rand(-2, 2))), { size: 0.4 - k * 0.08, life: 1 }), k * 300);
    let n = 0;
    for (const c of q.crystals) {
      if (c.spot.cooldown > 0 || flatDist(c.spot.pos, pp) > D.ECHO.radius) continue;
      c.lit = D.ECHO.glow;
      c.spot.active = true;
      n++;
      spawnEmoji('✨', c.spot.pos.clone().add(new V3(0, 1, 0)), { size: 0.5 });
    }
    q.bats.forEach((b) => { if (flatDist(b.g.position, pp) < 11) b.scatter = 3; });
    d.happy = Math.min(100, d.happy + 2);
    d.tricks.speak = (d.tricks.speak || 0) + 0.25;
    state.stats.echoes = (state.stats.echoes || 0) + 1;
    progress('echo');
    toast(n ? `🔊 Echo… echo… ${n} crystal${n > 1 ? 's' : ''} light up! Let your dog sniff ${n > 1 ? 'them' : 'it'}` : '🔊 Echo… echo… no hidden crystals close by');
  }

  // ----- Snowy Village -----
  const sledHeight = (L, z) => (z >= L.hz1 ? 0 : clamp((L.hz1 - z) / (L.hz1 + 18.8), 0, 1) * L.top);
  function updateSnowy(dt, q, pp) {
    q.festive.visible = clockNow.month === 12;
    if (quirk.sled) { updateSled(dt, q); return null; }
    if (flatDist(pp, q.rocket.pos) < 2.6) {
      if (!quirk.rocketToast && !locUnlocked('moon')) {
        quirk.rocketToast = true;
        const m = Math.min(state.finds.moonstone || 0, D.LOCATIONS.moon.unlock.n);
        toast(m >= D.LOCATIONS.moon.unlock.n ? '🚀 You have enough moonstones — tap 🚀 Rocket to fuel it!' : `🚀 The rocket needs ${D.LOCATIONS.moon.unlock.n} 🌕 moonstones from the Crystal Caves (${m}/${D.LOCATIONS.moon.unlock.n})`);
      }
      return 'rocket';
    }
    return flatDist(pp, q.sled.pad) < 1.9 ? 'sled' : null;
  }
  function startSled() {
    if (place !== 'park' || loc !== 'snowy' || quirk.sled) return;
    resetBall();
    player.moveTarget = null;
    quirk.sled = { t: 0 };
    dogs.forEach((d) => { if (!d.offLeash) { d.dropSpot(); d.onArrive = null; d.setState('sit', 9); } });
    toast('🛷 Up the hill… and down we go!');
  }
  function updateSled(dt, q) {
    const s = quirk.sled, L = q.sled;
    s.t += dt / 2.8;
    const t = Math.min(1, s.t), e = Math.pow(t, 1.5);
    const z = lerp(L.z0, L.z1, e), y = sledHeight(L, z);
    player.root.position.set(L.x, y + 0.12, z);
    player.root.rotation.y = player.face = 0;
    L.mesh.position.set(L.x, y, z - 0.15);
    L.mesh.rotation.x = z < L.hz1 ? -0.24 : 0;
    let i = 0;
    for (const d of dogs) {
      if (d.offLeash) continue;
      d.root.position.set(L.x + (i % 2 ? 0.32 : -0.32), y + 0.08, z - 0.55 - Math.floor(i / 2) * 0.45);
      d.root.rotation.y = d.face = 0;
      i++;
    }
    if (Math.random() < dt * 8) spawnEmoji('❄️', new V3(L.x + rand(-0.5, 0.5), y + 0.2, z - 0.8), { size: 0.3, life: 0.6, vy: 0.3 });
    if (t < 1) return;
    quirk.sled = null;
    player.root.position.y = 0;
    L.mesh.position.set(L.pad.x, 0, L.pad.z - 0.5);
    L.mesh.rotation.x = 0;
    dogs.forEach((d) => { d.root.position.y = 0; if (!d.offLeash) { d.happy = Math.min(100, d.happy + 8); d.setState('happy', 1.2); } });
    state.stats.sleds = (state.stats.sleds || 0) + 1;
    addCoins(D.SLED_COINS, player.root.position);
    progress('sled');
    toast('🛷 Wheee! The dogs want to go again');
  }
  function useRocket() {
    if (place !== 'park' || loc !== 'snowy') return;
    const need = D.LOCATIONS.moon.unlock.n, have = state.finds.moonstone || 0;
    if (!state.rocket) {
      if (have < need) { toast(`🚀 Not enough fuel: bring ${need} 🌕 moonstones from the Crystal Caves (${have}/${need})`); return; }
      state.rocket = true;
      checkLocUnlocks();
      confetti(S.q.rocket.pos.clone().add(new V3(0, 2, 0)), 8);
      save();
    }
    toast('🚀 3… 2… 1… liftoff!');
    setTimeout(() => { if (place === 'park' && loc === 'snowy') travel('moon'); }, 1600);
  }
  function usePortal() {
    if (place !== 'park' || loc !== 'forest') return;
    if (!state.portal) {
      state.portal = true;
      checkLocUnlocks();
      save();
    }
    confetti(S.q.portal.pos.clone().add(new V3(0, 1.5, 0)), 8);
    toast('✨ Whoosh — through the portal!');
    setTimeout(() => { if (place === 'park' && loc === 'forest') travel('fairy'); }, 1200);
  }

  // ----- Moonlight Carnival -----
  const canVisitNow = (id) => { const H = D.LOCATIONS[id].hours; return !H || (clockNow.hour >= H[0] && clockNow.hour < H[1]); };
  function boothSign(k) {
    const T = ALL_TRICKS[quirk.booths[k]];
    setSpriteText(S.q.booths[k].sign, `🎯 ${T.icon} ${T.name} → 🎟️`);
  }
  function boothTrick(exclude) {
    const known = Object.keys(D.TRICKS).filter((id) => dogs.some((d) => d.trickLvl(id) >= 1) && id !== exclude);
    return pick(known.length ? known : ['sit', 'paw', 'jump'].filter((x) => x !== exclude));
  }
  function updateCarnival(dt, q, pp) {
    const W = q.wheel;
    W.group.rotation.z += dt * (quirk.ride ? 0.45 : W.speed);
    for (const g of W.gondolas) g.rotation.z = -W.group.rotation.z;
    q.carousel.rotation.y += dt * 0.6;
    if (quirk.ride) {
      quirk.ride.t -= dt;
      if (Math.random() < dt * 2) spawnEmoji(pick(['💕', '✨', '🎶']), pp.clone().add(new V3(rand(-1, 1), 2, rand(-1, 1))), { size: 0.4 });
      if (quirk.ride.t <= 0) {
        zoom = quirk.ride.zoom;
        quirk.ride = null;
        dogs.forEach((d) => { d.happy = Math.min(100, d.happy + 10); });
        progress('ferris');
        toast('🎡 What a view! Everyone is happy');
      }
      return null;
    }
    if (!canVisitNow('carnival') && !quirk.closeToast) { quirk.closeToast = true; toast('🌙 The carnival is closing for tonight — come back tomorrow evening'); }
    return flatDist(pp, W.spot) < 2.2 ? 'ferris' : null;
  }
  function rideWheel() {
    if (place !== 'park' || loc !== 'carnival' || quirk.ride) return;
    quirk.ride = { t: 6, zoom };
    zoom = 1.75;
    toast('🎡 Round and round you go…');
  }
  // tricks at a game booth win tickets
  function carnivalTrick(d, id, lvl) {
    const pp = player.root.position, q = S.q;
    const k = q.booths.findIndex((b) => flatDist(b.front, pp) < 2.6);
    if (k < 0) return;
    const want = quirk.booths[k];
    if (want !== id) { setTimeout(() => toast(`This booth wants ${ALL_TRICKS[want].icon} ${ALL_TRICKS[want].name}!`), 900); return; }
    const cap = LOC().ticketCap || 40;
    if (quirk.tickets >= cap) { setTimeout(() => toast('The booths are out of tickets for tonight 🎟️'), 900); return; }
    const n = Math.min(cap - quirk.tickets, 2 + lvl);
    quirk.tickets += n;
    state.tickets += n;
    state.stats.ticketsWon = (state.stats.ticketsWon || 0) + n;
    progress('tickets', n);
    quirk.booths[k] = boothTrick(want);
    setTimeout(() => {
      spawnEmoji('🎟️', d.headWorld(0.6), { size: 0.5 });
      toast(`🎟️ +${n} tickets! You have ${state.tickets} · trade them at the 🎪 Prize booth`);
      boothSign(k);
      updateLocChip();
    }, 800);
  }

  // ----- Fairy Realm -----
  const FAIRY_LINES = ['Hello, little paws! ✨', 'The stone dogs long to look at the glowing orb 👀', 'Tap a statue to turn it 🔄', 'Catch the floating toys before they drift off!',
    'On the moon, balls fly sooo high 🌕', 'Caves echo when dogs speak 💬', 'The carnival only opens in the evening 🎡', 'They say moonstones can fuel a rocket 🚀'];
  function updateFairy(dt, q, pp) {
    q.orb.mesh.position.y = 1.4 + Math.sin(quirk.t * 2) * 0.12;
    q.orb.mesh.rotation.y += dt;
    ART.M.orb.emissiveIntensity = quirk.solved ? 1.2 : 0.5 + Math.sin(quirk.t * 3) * 0.15;
    for (const s of q.statues) s.group.rotation.y = angleLerp(s.group.rotation.y, s.rot * Math.PI / 2, damp(0.002, dt));
    if (quirk.statueTask) {
      const s = quirk.statueTask;
      if (flatDist(pp, s.pos) < 2) { quirk.statueTask = null; player.moveTarget = null; turnStatue(s); }
      else if (!player.moveTarget) quirk.statueTask = null;
    }
    for (const f of q.floaters) {
      if (f.away > 0) { f.away -= dt; if (f.away <= 0) f.g.visible = true; continue; }
      f.a += f.sp * dt;
      f.g.position.set(Math.sin(f.a) * f.rad, 1.3 + Math.sin(quirk.t * 2 + f.ph) * 0.3, Math.cos(f.a) * f.rad);
      f.g.rotation.y += dt;
      const who = flatDist(pp, f.g.position) < 1.2 ? null : dogs.find((d) => flatDist(d.root.position, f.g.position) < 1.2);
      if (who || flatDist(pp, f.g.position) < 1.2) catchFloater(f, who);
    }
    for (const a of q.animals) {
      if (a.t > 0) { a.t -= dt; if (a.t < 7.5) a.bubble.visible = false; continue; }
      if (flatDist(pp, a.g.position) > 2.8) continue;
      a.t = 12;
      setSpriteText(a.bubble, FAIRY_LINES[quirk.line = ((quirk.line ?? Math.floor(Math.random() * FAIRY_LINES.length)) + 1) % FAIRY_LINES.length]);
      a.bubble.visible = true;
      spawnEmoji('💬', a.g.position.clone().add(new V3(0, 1.2, 0)), { size: 0.35, life: 0.8 });
    }
    const M = q.motes;
    M.data.forEach((p, i) => {
      p[3] += dt;
      pm4.makeTranslation(pp.x + p[0] + Math.sin(p[3] * 0.5) * 0.8, p[1] + Math.sin(p[3]) * 0.3, pp.z + p[2] + Math.cos(p[3] * 0.4) * 0.8);
      M.mesh.setMatrixAt(i, pm4);
    });
    M.mesh.instanceMatrix.needsUpdate = true;
  }
  function catchFloater(f, d) {
    f.away = 25;
    f.g.visible = false;
    const at = f.g.position.clone();
    progress('floattoy');
    if (d) d.happy = Math.min(100, d.happy + 6);
    if (!quirk.floatToast) { quirk.floatToast = true; toast(`✨ ${d ? d.name + ' caught' : 'You caught'} a floating toy!`); }
    if (Math.random() < 0.5) { const k = rollFind('fairy'); if (k) { grantFind(k, at); return; } }
    addCoins(3, at);
    spawnEmoji('✨', at, { size: 0.5 });
  }
  function tapStatue(gp) {
    if (place !== 'park' || loc !== 'fairy' || !gp) return null;
    return S.q.statues.find((s) => flatDist(s.pos, gp) < 1.3) || null;
  }
  function turnStatue(s) {
    s.rot = (s.rot + 1) % 4;
    spawnEmoji('🔄', s.pos.clone().add(new V3(0, 2, 0)), { size: 0.4, life: 0.8 });
    if (quirk.solved || !S.q.statues.every((x) => x.rot === x.target)) return;
    quirk.solved = true;
    const P = D.PUZZLE, n = P.min + Math.floor(Math.random() * (P.max - P.min + 1));
    const at = S.q.orb.pos.clone().add(new V3(0, 1.5, 0));
    confetti(at, 10);
    addCoins(n, at);
    state.puzzles = (state.puzzles || 0) + 1;
    state.stats.puzzles = state.puzzles;
    progress('statue');
    toast(`✨ All four statues face the orb… it glows! +🪙 ${n}`);
    setTimeout(() => grantFind('chime', at), 1600);
    save();
  }

  // ----- Moon Base -----
  function updateMoon(dt, q, pp) {
    const R = q.rover, side = 8.5, per = side * 8;
    R.t = (R.t + dt * 1.1) % per;
    const u = R.t, seg = Math.floor(u / (side * 2)), v = (u % (side * 2)) - side;
    const [x, z, ry] = seg === 0 ? [v, -side, Math.PI / 2] : seg === 1 ? [side, v, 0] : seg === 2 ? [-v, side, -Math.PI / 2] : [-side, -v, Math.PI];
    R.g.position.set(x, 0, z);
    R.g.rotation.y = angleLerp(R.g.rotation.y, ry - Math.PI / 2, damp(0.01, dt));
    R.col.x = x;
    R.col.z = z;
  }
  function craterDig(d, spot) {
    spot.cooldown = 9999;
    const pos = spot.pos.clone();
    addDirt(d, 'moondust', 5);
    d.happy = Math.min(100, d.happy + 8);
    progress('crater');
    if (spot.treasure) {
      spot.treasure = false;
      if (spot.mark) spot.mark.visible = false;
      const C = D.CAPSULE, n = C.min + Math.floor(Math.random() * (C.max - C.min + 1));
      addCoins(n, pos);
      toast(`🛰️ ${d.name} dug up a space capsule! 🪙 ${n}`);
      confetti(pos.clone().add(new V3(0, 1, 0)), 8);
      setTimeout(() => grantFind('patch', pos), 1400);
      if (Math.random() < C.rareChance) setTimeout(() => findRare(pos), 3000);
      save();
      return;
    }
    if (!state.accessories.includes('spacehelmet') && Math.random() < D.HELMET_CHANCE) {
      state.accessories.push('spacehelmet');
      toast('🧑‍🚀 An astronaut helmet in the moon dust! Try it on via 👒 Style');
      confetti(pos.clone().add(new V3(0, 1, 0)));
      save();
      return;
    }
    const r = Math.random();
    if (r < 0.4) { const f = rollFind('moon'); if (f) { grantFind(f, pos); return; } }
    if (r < 0.5) { grantToy(rollToy(), pos); return; }
    if (r < 0.8) { addCoins(1 + Math.floor(Math.random() * 3), pos); return; }
    spawnEmoji('🕳️', d.headWorld(-0.2), { size: 0.35, life: 0.9 });
  }

  // going straight from one place to another (portal, rocket)
  function travel(id) {
    clearParkLoot();
    clearWalkers();
    endQuirks();
    recordWalk(loc);
    goWalk(id);
  }

  // =====================================================================
  // Vendors on walks: tap a stall, walk over and shop
  // =====================================================================
  let vendorTask = null;
  function tapVendor(ray, gp) {
    if (place !== 'park' || !S.vendors.length) return null;
    const hits = ray.intersectObjects(S.vendors.map((v) => v.group), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.vendor) o = o.parent;
      if (o) return S.vendors.find((v) => v.id === o.userData.vendor);
    }
    if (!gp) return null;
    return S.vendors.find((v) => Math.hypot(v.group.position.x - gp.x, v.group.position.z - gp.z) < 1.7) || null;
  }
  function startVendor(v) {
    vendorTask = v;
    towelTask = null;
    player.moveTarget = v.front.clone();
  }
  function updateVendorTask() {
    if (!vendorTask) return;
    const pp = player.root.position;
    if (flatDist(pp, vendorTask.front) < 0.9) {
      const v = vendorTask;
      vendorTask = null;
      player.moveTarget = null;
      player.face = Math.atan2(v.group.position.x - pp.x, v.group.position.z - pp.z);
      openShop(v.id);
    } else if (!player.moveTarget) vendorTask = null;
  }

  // =====================================================================
  // Map: where to walk today
  // =====================================================================
  function locProgress(id) {
    const U = D.LOCATIONS[id].unlock;
    if (!U) return null;
    switch (U.kind) {
      case 'obedience': return [Math.max(0, ...dogs.map((d) => d.obedience())), U.n];
      case 'locWalks': return [state.locWalks[U.loc] || 0, U.n];
      case 'glades': return [state.glades.length, U.n];
      case 'treasure': return [state.treasures || 0, U.n];
      case 'acc': return [state.accessories.includes(U.id) ? 1 : 0, 1];
      case 'summits': return [state.summits || 0, U.n];
      case 'loc': return [locUnlocked(U.loc) ? 1 : 0, 1];
      case 'portal': return [state.portal ? 1 : 0, 1];
      case 'rocket': return [Math.min(state.finds.moonstone || 0, U.n), U.n];
      default: return null;
    }
  }
  function locReady(id) {
    const U = D.LOCATIONS[id].unlock;
    if (U && U.kind === 'rocket') return !!state.rocket;
    const p = locProgress(id);
    return !!p && p[0] >= p[1];
  }
  function checkLocUnlocks() {
    const fresh = [];
    for (let again = true; again;) {   // one unlock can open the next (Old Town -> carnival)
      again = false;
      for (const id of Object.keys(D.LOCATIONS)) {
        if (locUnlocked(id) || !locReady(id)) continue;
        state.unlocked.push(id);
        fresh.push(D.LOCATIONS[id]);
        again = true;
      }
    }
    if (!fresh.length) return;
    toast(`🗺️ New place${fresh.length > 1 ? 's' : ''} unlocked: ${fresh.map((P) => `${P.icon} ${P.name}`).join(' & ')}! Tap 🦮 Walk to go there`);
    save();
  }
  function locNote(id) {
    const parts = [];
    const W = curWeather(), night = isNight();
    if (id === 'beach') { const t = tideLevel(); parts.push(t > 0.6 ? '🏝️ Low tide now — tide pools are open' : t < 0.3 ? '🌊 High tide right now' : `🌊 The tide is ${tideFalling() ? 'going out' : 'coming in'}`); }
    if (id === 'forest') parts.push(`🌿 Glades found: ${state.glades.length}/3`);
    if (id === 'alpine' && state.summits) parts.push(`⛰️ Summits: ${state.summits}`);
    const has = (w) => Object.values(D.FINDS).some((F) => F.loc === id && F.when === w);
    if (night && has('night')) parts.push('🌙 Night finds are out');
    if (W.precip === 'rain' && has('rain')) parts.push('🌧️ Rainy-day finds');
    if (W.precip === 'snow' && has('snow')) parts.push('❄️ Snow finds');
    const ids = Object.keys(D.FINDS).filter((k) => D.FINDS[k].loc === id);
    parts.push(`Collectibles ${ids.filter((k) => state.finds[k]).length}/${ids.length}`);
    return parts.join(' · ');
  }
  function openMap() {
    if (!dogs.length) return;
    renderMap();
    $('map').classList.remove('hidden');
  }
  // places a locked place depends on: until you have been there, its hint stays hidden
  function locNeeds(id) {
    const U = D.LOCATIONS[id].unlock;
    if (!U) return [];
    switch (U.kind) {
      case 'locWalks': case 'loc': return [U.loc];
      case 'glades': case 'portal': return ['forest'];
      case 'treasure': return ['beach'];
      case 'summits': return ['alpine'];
      case 'acc': { const A = D.ACCESSORIES[U.id]; return A && A.vendor ? [D.VENDORS[A.vendor].loc] : []; }
      case 'rocket': return ['snowy', 'caves'];
      default: return [];
    }
  }
  // locked, but everything it needs is already open: the very next things to unlock
  const locNext = (id) => !locUnlocked(id) && locNeeds(id).every(locUnlocked);
  function renderMap() {
    const L = $('mapList');
    L.innerHTML = '';
    let hidden = 0;
    for (const [id, P] of Object.entries(D.LOCATIONS)) {
      const open = locUnlocked(id);
      if (!open && !locNext(id)) { hidden++; continue; }
      const card = document.createElement('div');
      card.className = 'locCard' + (open ? '' : ' locked');
      card.dataset.loc = id;
      if (open) {
        const closed = !canVisitNow(id);
        const note = closed ? `Closed now · opens at ${P.hours[0]}:00 (German time)` : locNote(id);
        card.innerHTML = `<div class="lcIc">${TH('loc', id)}</div><div class="txt"><b></b><small class="desc"></small><small class="note"></small></div>`;
        card.querySelector('b').textContent = P.name;
        card.querySelector('.desc').textContent = P.desc;
        card.querySelector('.note').textContent = note;
        if (!closed) {
          const go = document.createElement('button');
          go.className = 'buy';
          go.textContent = 'Go';
          go.addEventListener('click', () => { $('map').classList.add('hidden'); goWalk(id); });
          card.appendChild(go);
        } else card.classList.add('closed');
      } else {
        // not named yet: only how to get there
        const p = P.unlock.kind === 'portal' ? null : locProgress(id);
        const frac = p ? Math.min(1, p[0] / p[1]) : 0;
        card.innerHTML = `<div class="lcIc">${TH('locx', id)}<span class="lockMark">${IC('lock')}</span></div><div class="txt"><b>Undiscovered place</b><small class="note"></small>${p && p[1] > 1 ? `<div class="track"><div class="fill" style="width:${Math.round(frac * 100)}%"></div></div><small class="prog">${Math.min(p[0], p[1])} of ${p[1]}</small>` : ''}</div>`;
        card.querySelector('.note').textContent = plain(P.hint);
      }
      L.appendChild(card);
    }
    if (hidden) {
      const more = document.createElement('p');
      more.className = 'sub moreSoon';
      more.innerHTML = `${IC('sparkle')}<span>${hidden === 1 ? 'One more place is' : `${hidden} more places are`} still hidden. Keep exploring.</span>`;
      L.appendChild(more);
    }
  }
  $('map').addEventListener('click', (e) => { if (e.target.id === 'map' || e.target.closest('[data-act="closeMap"]')) $('map').classList.add('hidden'); });

  // =====================================================================
  // Daily challenges (3 a day, new ones at Berlin midnight)
  // =====================================================================
  const hasItem = (t) => state.furniture.some((f) => f.type === t) || (state.inventory[t] || 0) > 0;
  function challengeFrom(C, rr) {
    const need = C.needs || '';
    const places = Object.keys(D.LOCATIONS).filter(locUnlocked);
    if (need.startsWith('loc:') && !locUnlocked(need.slice(4))) return null;
    if ((need === 'stove' || need === 'bathtub' || need === 'toybox') && !hasItem(need)) return null;
    if (need === 'offleash' && !dogs.some((d) => d.trickLvl('come') >= CONFIG.OFFLEASH_COME_LEVEL)) return null;
    if (need === 'treats' && !hasItem('stove') && places.length < 2) return null;
    let n = Array.isArray(C.n) ? C.n[0] + Math.floor(rr() * (C.n[1] - C.n[0] + 1)) : C.n;
    let text = C.text, ev = C.ev;
    if (need === 'trick') {
      const known = Object.keys(D.TRICKS).filter((id) => dogs.some((d) => d.trickLvl(id) >= 1));
      if (!known.length) return null;
      const t = known[Math.floor(rr() * known.length)];
      text = text.replace('{trick}', `${D.TRICKS[t].icon} ${D.TRICKS[t].name}`);
      ev = ev.replace('{trick}', t);
    }
    if (need === 'loc') {
      const l = places[Math.floor(rr() * places.length)];
      text = text.replace('{loc}', `${D.LOCATIONS[l].icon} ${D.LOCATIONS[l].name}`);
      ev = ev.replace('{loc}', l);
    }
    return { id: C.id, text: text.replace('{n}', n), ev, n, got: 0, reward: C.reward, done: false };
  }
  function ensureDaily() {
    if (visit || !dogs.length) return;
    const key = clockNow.dateKey;
    if (state.daily && state.daily.date === key) return;
    const rr = ART.mulberry32(hashStr(key + '|' + state.uid));
    const pool = D.CHALLENGES.map((C) => challengeFrom(C, rr)).filter(Boolean);
    const items = [];
    while (items.length < 3 && pool.length) items.push(pool.splice(Math.floor(rr() * pool.length), 1)[0]);
    const fresh = !!state.daily;
    state.daily = { date: key, items, bonus: false };
    if (fresh) toast('📋 New daily challenges are here!');
    renderDailyBadge();
    save();
  }
  function progress(ev, amt = 1) {
    if (visit || !state.daily) return;
    let changed = false;
    for (const c of state.daily.items) {
      if (c.done || c.ev !== ev) continue;
      c.got = Math.min(c.n, c.got + amt);
      changed = true;
      if (c.got >= c.n) {
        c.done = true;
        state.coins += c.reward;
        state.stats.challengesDone = (state.stats.challengesDone || 0) + 1;
        setTimeout(() => toast(`📋 Challenge done: ${c.text} · +🪙 ${c.reward}`), 700);
      }
    }
    if (!changed) return;
    if (!state.daily.bonus && state.daily.items.every((c) => c.done)) {
      state.daily.bonus = true;
      state.coins += D.CHALLENGE_BONUS.coins;
      const rare = Math.random() < D.CHALLENGE_BONUS.rareChance;
      setTimeout(() => {
        toast(`🎉 All of today's challenges done! Bonus 🪙 ${D.CHALLENGE_BONUS.coins}`);
        if (rare) setTimeout(() => findRare(null), 2800);
      }, 3600);
    }
    updateHud();
    renderDailyBadge();
    if (!$('daily').classList.contains('hidden')) renderDaily();
  }
  function renderDailyBadge() {
    const left = state.daily ? state.daily.items.filter((c) => !c.done).length : 0;
    const b = $('dailyBadge');
    b.textContent = left;
    b.classList.toggle('hidden', !left);
    document.querySelectorAll('.menuBtn .dot').forEach((d) => d.classList.toggle('hidden', !left));
  }
  function openDaily() {
    ensureDaily();
    renderDaily();
    $('daily').classList.remove('hidden');
  }
  function renderDaily() {
    const L = $('dailyList');
    L.innerHTML = '';
    const h = Math.max(0, 24 - clockNow.hour);
    $('dailySub').textContent = `New challenges in ${Math.floor(h)}h ${Math.floor((h % 1) * 60)}m (midnight, German time). Finish all three for a bonus!`;
    if (!state.daily || !state.daily.items.length) { L.innerHTML = '<p class="sub">Adopt a dog to get daily challenges.</p>'; return; }
    for (const c of state.daily.items) {
      const r = document.createElement('div');
      r.className = 'row challenge' + (c.done ? ' done' : '');
      r.innerHTML = `<div class="ic chk">${IC(c.done ? 'check' : 'list')}</div><div class="txt"><b></b><div class="track"><div class="fill happy"></div></div><small></small></div><b class="rw">🪙 ${c.reward}</b>`;
      r.querySelector('b').textContent = c.text;
      r.querySelector('.fill').style.width = Math.round((c.got / c.n) * 100) + '%';
      r.querySelector('small').textContent = `${c.got}/${c.n}`;
      L.appendChild(r);
    }
    const bonus = document.createElement('p');
    bonus.className = 'sub';
    bonus.textContent = state.daily.bonus ? 'Bonus collected. See you tomorrow!' : `Bonus for all three: 🪙 ${D.CHALLENGE_BONUS.coins}, sometimes a rare item`;
    L.appendChild(bonus);
  }
  $('daily').addEventListener('click', (e) => { if (e.target.id === 'daily' || e.target.closest('[data-act="closeDaily"]')) $('daily').classList.add('hidden'); });

  // =====================================================================
  // 📒 Collectibles book. Known entries show as silhouettes, secret ones stay hidden until found.
  // A completed page unlocks an accessory.
  // =====================================================================
  const BOOK_PAGES = [['toys', ['toy', 'tennis'], 'Toys'], ['park', null, 'Park'], ['oldtown', null, 'Old Town'], ['forest', null, 'Forest'], ['beach', null, 'Beach'],
    ['alpine', null, 'Alpine'], ['caves', null, 'Caves'], ['snowy', null, 'Snowy'], ['carnival', null, 'Carnival'], ['fairy', null, 'Fairy'], ['moon', null, 'Moon'],
    ['rare', ['item', 'goldstatue'], 'Rare'], ['tricks', ['pic', '🎓'], 'Tricks'], ['breeds', ['dog', 'retriever|golden'], 'Breeds'], ['records', ['pic', '🏆'], 'Records']];
  const WHEN_TEXT = { night: 'Only at night', rain: 'Only in the rain', snow: 'Only when it snows', sun: 'Only on sunny days', day: 'Only by day', december: 'Only in December' };
  function recordValue(stat) {
    const st = state.stats;
    switch (stat) {
      case 'friendships': return Object.values(state.friends).filter((v) => v >= D.FRIEND_LEVEL).length;
      case 'comfort': return comfort.paws;
      case 'treasures': return state.treasures || 0;
      case 'summits': return state.summits || 0;
      case 'dogs': return Math.max(dogs.length, st.maxDogs || 0);
      case 'placesVisited': return Object.keys(D.LOCATIONS).filter((k) => (state.locWalks[k] || 0) > 0).length;
      case 'puzzles': return state.puzzles || 0;
      default: return st[stat] || 0;
    }
  }
  function bookPage(id) {
    const E = [];
    if (id === 'toys') {
      for (const [k, t] of Object.entries(D.TOYS)) E.push({ thk: ['toy', k], name: t.name, got: state.seen.toys.includes(k) || state.toys.includes(k), secret: !!t.secret, sub: t.price == null ? 'Found on walks' : t.vendor ? D.VENDORS[t.vendor].name : 'Shop' });
    } else if (D.LOCATIONS[id]) {
      for (const [k, F] of Object.entries(D.FINDS)) {
        if (F.loc !== id) continue;
        E.push({ thk: ['pic', F.icon], name: F.name, got: !!state.finds[k], secret: !!F.secret, sub: state.finds[k] > 1 ? `×${state.finds[k]}` : F.where === 'pool' ? 'In tide pools' : F.where === 'treasure' ? (F.loc === 'moon' ? 'In a space capsule' : 'In buried treasure') : F.where === 'crystal' ? 'In glowing crystals' : F.where === 'prize' ? 'Prize booth' : F.where === 'puzzle' ? 'A puzzle reward' : F.glade ? 'In a hidden glade' : WHEN_TEXT[F.when] || '' });
      }
    } else if (id === 'rare') {
      for (const [k, it] of Object.entries(D.ITEMS)) if (it.rare) E.push({ thk: ['item', k], name: it.name, got: state.seen.rares.includes(k), secret: false, sub: 'Found or gifted' });
    } else if (id === 'tricks') {
      for (const [k, T] of Object.entries(ALL_TRICKS)) E.push({ thk: ['pic', T.icon], name: T.name, got: state.learned.includes(k) || dogs.some((d) => d.trickLvl(k) >= 1), secret: !!T.secret, sub: T.secret ? 'Secret trick' : '', subHTML: T.secret ? '' : seqGlyphs(T.seq) });
    } else if (id === 'breeds') {
      for (const [b, B] of Object.entries(D.BREEDS)) for (const c of B.coats) if (!c.legacy) E.push({ img: ART.portraitURL(b, c.id), name: `${c.name} ${B.name}`, got: state.seen.coats.includes(b + ':' + c.id), secret: false, sub: 'Adopt one' });
    } else if (id === 'records') {
      for (const R of D.RECORDS) { const v = recordValue(R.stat); E.push({ thk: ['pic', R.icon], name: R.name, got: v >= R.n, secret: !!R.secret, sub: v >= R.n ? R.text : `${R.text} · ${Math.min(v, R.n)}/${R.n}` }); }
    }
    return { entries: E, done: E.filter((e) => e.got).length, total: E.length };
  }
  let albumPage = 'toys';
  function openAlbum() {
    renderAlbum();
    $('album').classList.remove('hidden');
  }
  function renderAlbum() {
    const tabs = $('albumTabs');
    tabs.innerHTML = '';
    let all = 0, got = 0;
    for (const [id, icon, name] of BOOK_PAGES) {
      const p = bookPage(id);
      all += p.total;
      got += p.done;
      const b = document.createElement('button');
      b.className = 'pageTab' + (id === albumPage ? ' sel' : '') + (p.done === p.total ? ' full' : '');
      const isLoc = !!D.LOCATIONS[id], known = !isLoc || locUnlocked(id);
      b.innerHTML = `${isLoc ? TH(known ? 'loc' : 'locx', id) : TH(icon[0], icon[1])}<small></small>`;
      b.querySelector('small').textContent = `${known ? name : '???'} ${p.done}/${p.total}`;
      b.addEventListener('click', () => { albumPage = id; renderAlbum(); });
      tabs.appendChild(b);
    }
    $('albumSub').textContent = `${got} of ${all} collected. Complete a page to unlock a special outfit.`;
    const page = bookPage(albumPage);
    const reward = Object.entries(D.ACCESSORIES).find(([, A]) => A.unlock === 'page_' + albumPage);
    const head = $('albumHead');
    const owned = reward && state.accessories.includes(reward[0]);
    head.innerHTML = reward ? `<span class="rwd">${thumbOf.acc(reward[0])}</span><span>${owned ? `Page reward unlocked: ${esc(reward[1].name)}` : `Complete this page for the ${esc(reward[1].name)} (${page.done}/${page.total})`}</span>` : '';
    if (D.LOCATIONS[albumPage] && !locUnlocked(albumPage)) head.insertAdjacentText('beforeend', ' · A place you haven’t found yet. Neighbors sometimes bring souvenirs.');
    const G = $('albumGrid');
    G.innerHTML = '';
    for (const e of page.entries) {
      const c = document.createElement('div');
      c.className = 'toyCard' + (e.got ? '' : e.secret ? ' secret' : ' sil');
      const pic = e.img ? `<img class="bkImg" src="${e.img}" alt="">` : TH(e.thk[0], e.thk[1]);
      if (!e.got && e.secret) c.innerHTML = `<span class="big q">${IC('question')}</span><b>Secret</b><small>Keep exploring…</small>`;
      else {
        c.innerHTML = `${pic}<b></b><small></small>`;
        c.querySelector('b').textContent = e.got ? e.name : '???';
        if (e.subHTML) c.querySelector('small').innerHTML = e.subHTML;
        else c.querySelector('small').textContent = e.sub;
      }
      G.appendChild(c);
    }
  }
  $('album').addEventListener('click', (e) => { if (e.target.id === 'album' || e.target.closest('[data-act="closeAlbum"]')) $('album').classList.add('hidden'); });
  // remember what you've had, so giving things away never un-ticks the book
  function noteSeen() {
    const sn = state.seen;
    for (const t of state.toys) if (!sn.toys.includes(t)) sn.toys.push(t);
    for (const d of dogs) { const k = d.breed + ':' + d.coat; if (!sn.coats.includes(k)) sn.coats.push(k); }
    for (const [k, n] of Object.entries(state.inventory)) if (n > 0 && D.ITEMS[k].rare) seeRare(k);
    for (const f of state.furniture) if (D.ITEMS[f.type].rare) seeRare(f.type);
    for (const d of dogs) for (const id of Object.keys(d.tricks)) if (d.trickLvl(id) >= 1 && !state.learned.includes(id)) state.learned.push(id);
    state.stats.maxDogs = Math.max(state.stats.maxDogs || 0, dogs.length);
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
    } else if (mode === 'trick' && tm) {
      const dp = tm.dog.root.position;
      tx = (p.x + dp.x) / 2;
      tz = (p.z + dp.z) / 2;
      dist = 6;
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
    fogPush = Math.max(0, camDist - 12);
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
  const MODALS = ['hub', 'shop', 'start', 'bag', 'confirm', 'litter', 'settings', 'trickBook', 'bath', 'kitchen', 'meals', 'wardrobe', 'comfort', 'giftModal', 'map', 'daily', 'album'];
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

    const statue = tapStatue(hitGround ? gp : null);
    if (statue) {
      if (flatDist(player.root.position, statue.pos) < 2.4) turnStatue(statue);
      else { quirk.statueTask = statue; player.moveTarget = statue.pos.clone().add(new V3(0, 0, 1.4)); }
      return;
    }
    const vend = tapVendor(raycaster, hitGround ? gp : null);
    if (vend) {
      startVendor(vend);
      tapRing.position.set(vend.front.x, 0.06, vend.front.z);
      tapT = 0.5;
      return;
    }

    const thing = tapFurniture(raycaster, hitGround ? gp : null);
    if (thing) {
      if (thing.clutter) startTidy(thing.clutter);
      else startUse(thing.f);
      tapRing.position.set(thing.at.x, 0.06, thing.at.z);
      tapT = 0.5;
      return;
    }

    if (hitGround) {
      towelTask = null;
      useTask = null;
      vendorTask = null;
      const b = bounds();
      player.moveTarget = new V3(clamp(gp.x, b.x0, b.x1), 0, clamp(gp.z, b.z0, b.z1));
      tapRing.position.set(player.moveTarget.x, 0.06, player.moveTarget.z);
      tapT = 0.5;
      hideHint();
    }
  }
  // what furniture (with a use) or clutter did the tap hit?
  function tapFurniture(ray, gp) {
    if (place !== 'home') return null;
    const hits = ray.intersectObjects(clutterGroup.children.concat(furnGroup.children), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.f && !o.userData.clutter) o = o.parent;
      if (!o) continue;
      if (o.userData.clutter) return { clutter: o.userData.clutter, at: o.position };
      if (D.ITEMS[o.userData.f.type].use) return { f: o.userData.f, at: o.position };
    }
    if (!gp) return null;
    const i = Math.floor(gp.x), j = Math.floor(gp.z);
    const c = !visit && state.clutter.find((x) => x.i === i && x.j === j);
    if (c) return { clutter: c, at: new V3(i + 0.5, 0, j + 0.5) };
    const f = furnitureAt(i, j);
    if (f && D.ITEMS[f.type].use) return { f, at: tileCenter(f) };
    return null;
  }
  function interactDog(d) {
    selected = d;
    updatePack();
    if (['fetch', 'return', 'towel', 'wait', 'play', 'greet', 'scuffle', 'bath'].includes(d.state)) return;
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
          b.innerHTML = `${TH(kind, id)}<small>${esc(defs[id].name)}</small><em>${kind === 'wall' ? 'Wall' : 'Floor'}</em>`;
          b.addEventListener('click', () => { selStyle = { kind, id }; renderInv(); });
          list.appendChild(b);
        }
      }
      return;
    }
    $('rotLabel').textContent = rotNames[placeRot];
    const types = Object.keys(D.ITEMS).filter((t) => state.inventory[t] > 0);
    if (!types.length) {
      list.innerHTML = '<div class="empty">Nothing to place. Tap an item in the room to pick it up, or buy more in the Shop.</div>';
      return;
    }
    for (const t of types) {
      const b = document.createElement('button');
      b.className = 'inv' + (t === selectedInv ? ' sel' : '');
      b.innerHTML = `${thumbOf.item(t)}<small>${esc(D.ITEMS[t].name)}</small><b>×${state.inventory[t]}</b>`;
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
      if (isGardenChunk(cx, cz)) { toast('Gardens keep their grass 🌷'); return; }
      state.rooms[k] = Object.assign(roomStyle(cx, cz), { [selStyle.kind]: selStyle.id });
      buildRoom();
      computeComfort();
      save();
      spawnEmoji('✨', new V3(cx * CHUNK + CHUNK / 2, 1, cz * CHUNK + CHUNK / 2), { size: 0.6, life: 0.9 });
      return;
    }
    const ex = furnitureAt(i, j);
    if (ex) {
      if (ex.gift) { returnGift(ex.gift); ex.gift = null; toast('The gift inside went back to your inventory'); }
      state.furniture.splice(state.furniture.indexOf(ex), 1);
      state.inventory[ex.type] = (state.inventory[ex.type] || 0) + 1;
      selectedInv = ex.type;
      placeRot = ex.rot || 0;
      afterFurnitureChange();
      toast(`Picked up ${D.ITEMS[ex.type].name}`);
      return;
    }
    if (!selectedInv || !(state.inventory[selectedInv] > 0)) { toast('Pick an item from the bar first'); return; }
    if (D.ITEMS[selectedInv].garden && !isGardenTile(i, j)) { toast(`${D.ITEMS[selectedInv].name} only fits in a 🌷 garden`); return; }
    if (state.clutter.some((c) => c.i === i && c.j === j)) { toast('Tidy that spot up first'); return; }
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
    computeComfort();
    renderComfortChip();
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
    const go = (kind) => {
      if (state.coins < price) { toast('Not enough coins yet'); return; }
      state.coins -= price;
      state.build = { cx, cz, kind, readyAt: Date.now() + CONFIG.BUILD_MINUTES * 60000 };
      exitBuildMode();
      rebuildSite();
      updateHud();
      toast(`${kind === 'garden' ? '🌷 Garden' : '🏠 Room'} under construction! Ready in ${CONFIG.BUILD_MINUTES} minutes 🏗️`);
      save();
    };
    const garden = gardensUnlocked();
    confirmBox('Build here?', `Costs 🪙 ${price} · ready in ${CONFIG.BUILD_MINUTES} minutes${garden ? ' · a room, or an open garden with grass and a fence' : ''}`,
      `🏠 Room for 🪙 ${price}`, state.coins >= price, () => go('room'), () => { buildPick = null; showCandidates(); },
      garden ? { label: `🌷 Garden for 🪙 ${price}`, enabled: state.coins >= price, fn: () => go('garden') } : null);
  }
  function checkBuild() {
    const b = state.build;
    if (!b || Date.now() < b.readyAt) return;
    state.chunks.push([b.cx, b.cz]);
    if (b.kind === 'garden') state.gardens[chunkKey(b.cx, b.cz)] = true;
    state.build = null;
    syncChunkSet();
    buildRoom();
    rebuildSite();
    if (place === 'home') confetti(new V3(b.cx * CHUNK + CHUNK / 2, 1.5, b.cz * CHUNK + CHUNK / 2));
    toast(b.kind === 'garden' ? '🌷 Your new garden is ready! Garden items are in the 🛒 Shop.' : '🎉 Your new room is finished! Room for one more dog.');
    updateHud();
    save();
  }

  // =====================================================================
  // Feeding & water
  // =====================================================================
  function fillBowls(role, quiet) {
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
    if (!quiet) toast(role === 'food' ? (bowls.length > 1 ? 'Food bowls filled 🥣' : 'Food bowl filled 🥣') : (bowls.length > 1 ? 'Water bowls filled 💧' : 'Water bowl filled 💧'));
    save();
  }

  // =====================================================================
  // Shop, toy bag, confirm
  // =====================================================================
  const capacity = () => state.chunks.length;
  const adoptPrice = () => CONFIG.ADOPT_BASE * dogs.length;

  let shopVendor = null;   // a vendor on a walk, or null for the home shop
  function openShop(vendorId) {
    shopVendor = typeof vendorId === 'string' && D.VENDORS[vendorId] ? vendorId : null;
    renderShop();
    $('shop').classList.remove('hidden');
  }
  function closeShop() {
    $('shop').classList.add('hidden');
    if (mode === 'decorate') renderInv();
  }
  function shampooBlurb(id) {
    const S = D.SHAMPOOS[id];
    const best = Object.entries(S.eff).filter(([, v]) => v >= 0.99).map(([k]) => D.DIRT[k].name.toLowerCase());
    return `${state.shampoos[id] ? `You have ${state.shampoos[id]} · ` : ''}${best.length ? `Best for ${best.join(' & ')}` : S.fancy ? 'Good on everything · Pampered dogs adore it' : 'Mild, works on anything'} · 1 per bath`;
  }
  let shopTab = 'all';
  // every shop is a grid of cards; the home shop also has tabs, one of them for everything
  function renderShop() {
    const L = $('shopList');
    const body = L.parentElement;
    const scroll = body.scrollTop;
    const V = shopVendor && D.VENDORS[shopVendor];
    const tix = !!(V && V.currency === 'tickets');
    $('shopPurse').innerHTML = `${IC(tix ? 'ticket' : 'coin')}<span id="shopCoins">${tix ? state.tickets : state.coins}</span>`;
    $('shopTitle').textContent = V ? V.name : 'Shop';
    const secs = [];
    let cur = null;
    const section = (id, label) => { cur = { id, label, cards: [] }; secs.push(cur); };
    // one card: picture, name, a short line, and the price button
    const card = (th, title, sub, price, onBuy, opts = {}) => cur.cards.push({ th, title, sub, price, onBuy, ...opts });
    const done = () => { updateHud(); save(); renderShop(); };
    const pay = (price) => { if (tix) state.tickets -= price; else state.coins -= price; };

    if (V) {
      section('stock', V.name);
      for (const [kind, key, p0] of V.stock) {
        if (kind === 'meal') {
          const R = D.RECIPES[key], have = state.meals.filter((m) => m.id === key).length;
          const price = tix ? R.tickets : R.price;
          card(thumbOf.meal(key), R.name, `${R.desc}${have ? ` · you have ${have}` : ''}`, price, () => { pay(price); state.meals.push({ id: key, q: 2 }); toast(`${R.name} — give it from a dog's bubble → Treat`); done(); });
        } else if (kind === 'shampoo') {
          const Sh = D.SHAMPOOS[key], price = tix ? Sh.tickets : Sh.price;
          card(thumbOf.shampoo(key), Sh.name, shampooBlurb(key), price, () => { pay(price); state.shampoos[key] = (state.shampoos[key] || 0) + 1; done(); });
        } else if (kind === 'acc') {
          const A = D.ACCESSORIES[key], owned = state.accessories.includes(key), price = tix ? A.tickets : A.price;
          card(thumbOf.acc(key), A.name, owned ? 'In your wardrobe' : `For the ${A.slot}${A.rainproof ? ' · keeps rain dirt off' : ''}`, price, () => { pay(price); state.accessories.push(key); toast(`${A.name} ${tix ? 'won' : 'bought'}! Open a dog bubble → Style`); done(); }, { owned });
        } else if (kind === 'toy') {
          const t = D.TOYS[key], owned = state.toys.includes(key), price = tix ? t.tickets : t.price;
          card(thumbOf.toy(key), t.name, owned ? 'In your bag' : toyBlurb(t), price, () => { pay(price); state.toys.push(key); state.toy = key; updateToyIcons(); toast(`${t.name} is ready to throw!`); done(); }, { owned });
        } else if (kind === 'ingredient') {
          const I = D.INGREDIENTS[key];
          card(thumbOf.ing(key), I.name, `You have ${state.pantry[key] || 0} · cook at a Stove`, p0, () => { pay(p0); state.pantry[key] = (state.pantry[key] || 0) + 1; done(); });
        } else if (kind === 'find') {
          const F = D.FINDS[key], owned = !!state.finds[key];
          card(thumbOf.find(key), F.name, 'A prize for your book', p0, () => { pay(p0); grantFind(key, null); done(); }, { owned });
        }
      }
    } else {
      section('home', 'Home');
      const n = state.chunks.length;
      if (state.build) card(TH('loc', 'room'), 'Add a room', `Building… ready in ${fmtTime(state.build.readyAt - Date.now())}`, null, null, { label: 'Busy' });
      else if (n >= CONFIG.MAX_CHUNKS) card(TH('loc', 'room'), 'Add a room', 'Your home is as big as it gets', null, null, { label: 'Max' });
      else card(TH('loc', 'room'), 'Add a room', `You have ${n} · +1 dog · ${CONFIG.BUILD_MINUTES} min to build`, expandPrice(n), () => { closeShop(); enterBuildMode(); }, { keep: true });
      const cap = capacity(), full = dogs.length >= cap;
      const pup = todayLitter().pups.find((x) => !x.taken) || todayLitter().pups[0];
      card(TH('dog', `${pup.breed}|${pup.coat}`), 'Adopt a puppy', full ? `Home is full (${dogs.length}/${cap}). Add a room first` : `${dogs.length}/${cap} dogs · a new litter every day`, adoptPrice(), () => { closeShop(); openLitter(); }, { keep: true, disabled: full, label: full ? null : 'See litter' });

      section('toys', 'Toys');
      for (const [k, t] of Object.entries(D.TOYS)) {
        if (t.price == null || k === 'tennis' || t.vendor) continue;
        const owned = state.toys.includes(k);
        card(thumbOf.toy(k), t.name, owned ? 'In your bag' : toyBlurb(t), t.price, () => { pay(t.price); state.toys.push(k); state.toy = k; updateToyIcons(); toast(`${t.name} is ready to throw!`); done(); }, { owned });
      }
      section('styles', 'Walls & floors');
      for (const kind of ['wall', 'floor']) {
        const defs = kind === 'wall' ? D.WALLS : D.FLOORS;
        for (const [id, st] of Object.entries(defs)) {
          if (!st.price) continue;
          const owned = state.styles.includes(id);
          card(TH(kind, id), st.name, kind === 'wall' ? 'Wallpaper' : 'Floor', st.price, () => { pay(st.price); state.styles.push(id); selStyle = { kind, id }; toast(`${st.name} unlocked. Apply it in Decorate → Walls & floors`); done(); }, { owned });
        }
      }
      section('boutique', 'Boutique');
      for (const [id, A] of Object.entries(D.ACCESSORIES)) {
        if (A.unlock || A.vendor) continue;
        const owned = state.accessories.includes(id);
        card(thumbOf.acc(id), A.name, owned ? 'In your wardrobe' : `For the ${A.slot}${A.rainproof ? ' · keeps rain dirt off' : ''}`, A.price, () => { pay(A.price); state.accessories.push(id); toast(`${A.name} bought! Open a dog bubble → Style`); done(); }, { owned });
      }
      section('bath', 'Shampoo');
      for (const [id, Sh] of Object.entries(D.SHAMPOOS)) {
        if (Sh.vendor) continue;
        card(thumbOf.shampoo(id), Sh.name, shampooBlurb(id), Sh.price, () => { pay(Sh.price); state.shampoos[id] = (state.shampoos[id] || 0) + 1; done(); });
      }
      cur.note = 'More shampoos are sold by vendors on walks.';
      section('pantry', 'Pantry');
      for (const [id, I] of Object.entries(D.INGREDIENTS)) {
        if (I.price == null) continue;
        card(thumbOf.ing(id), I.name, `You have ${state.pantry[id] || 0} · cook at a Stove`, I.price, () => { pay(I.price); state.pantry[id] = (state.pantry[id] || 0) + 1; done(); });
      }
      for (const [cat, title] of D.CATS) {
        section(cat, plain(title));
        const locked = cat === 'garden' && !gardensUnlocked();
        if (locked) cur.note = `Unlocks with gardens: a home with ${D.GARDEN_UNLOCK_SECTIONS} rooms.`;
        for (const [t, it] of Object.entries(D.ITEMS)) {
          if (it.cat !== cat || it.price == null) continue;
          const owned = (state.inventory[t] || 0) + state.furniture.filter((f) => f.type === t).length;
          const kind = locked ? 'Needs gardens' : it.use === 'bath' ? 'Tap it for bath time' : it.use === 'cook' ? 'Tap it to cook' : it.use === 'gift' ? 'Pack gifts for visitors' : it.auto ? 'Refills itself' : it.role === 'bed' ? (it.regen ? 'Dogs rest extra fast' : 'Dogs nap on it') : it.role === 'food' ? 'Fill it with Bowls' : it.role === 'water' ? 'Fill it with Bowls' : it.use ? 'Tap it to use' : it.lounge ? 'Couch Potatoes love it' : it.garden ? 'For gardens' : it.solid ? 'Decoration' : 'Dogs can walk on it';
          card(thumbOf.item(t), it.name, owned ? `You have ${owned} · ${kind}` : kind, it.price, () => { pay(it.price); state.inventory[t] = (state.inventory[t] || 0) + 1; selectedInv = t; toast(`${it.name} added. Place it in Decorate`); done(); }, { disabled: locked, label: locked ? 'Locked' : null, count: owned });
        }
      }
    }

    // tabs (home shop only): All first, then each section
    const nav = $('shopNav');
    const tabbed = !V;
    if (tabbed && !secs.some((x) => x.id === shopTab)) shopTab = 'all';
    nav.classList.toggle('hidden', !tabbed);
    if (tabbed) {
      const tabs = [['all', 'All'], ...secs.map((x) => [x.id, x.label])];
      if (nav.dataset.built !== tabs.map((t) => t[0]).join()) {
        nav.dataset.built = tabs.map((t) => t[0]).join();
        nav.innerHTML = tabs.map(([id, label]) => `<button class="seg" data-tab="${id}">${esc(label)}</button>`).join('');
      }
      nav.querySelectorAll('.seg').forEach((b) => b.classList.toggle('sel', b.dataset.tab === shopTab));
    }
    const show = !tabbed || shopTab === 'all' ? secs : secs.filter((x) => x.id === shopTab);
    const money = tix ? state.tickets : state.coins;
    L.innerHTML = '';
    if (V && V.greet) { const g = document.createElement('p'); g.className = 'sub greet'; g.textContent = plain(V.greet); L.appendChild(g); }
    for (const sec of show) {
      if (show.length > 1) { const h = document.createElement('div'); h.className = 'section'; h.textContent = sec.label; L.appendChild(h); }
      if (sec.note) { const nn = document.createElement('p'); nn.className = 'sub'; nn.textContent = sec.note; L.appendChild(nn); }
      const grid = document.createElement('div');
      grid.className = 'shopGrid';
      for (const c of sec.cards) {
        const el = document.createElement('div');
        el.className = 'card' + (c.owned ? ' owned' : '');
        el.innerHTML = `<div class="cardPic">${c.th}${c.count ? `<i class="cnt">${c.count}</i>` : ''}</div><b></b><small></small>`;
        el.querySelector('b').textContent = c.title;
        el.querySelector('small').textContent = c.sub;
        const b = document.createElement('button');
        b.className = 'buy';
        if (c.owned) b.textContent = 'Owned';
        else if (c.label) b.textContent = c.label;
        else if (c.price == null) b.textContent = '—';
        else b.innerHTML = `${IC(tix ? 'ticket' : 'coin')}<span>${c.price}</span>`;
        b.disabled = !!c.owned || !!c.disabled || c.price == null || money < c.price;
        b.addEventListener('click', () => { if (!b.disabled && (tix ? state.tickets : state.coins) >= c.price) c.onBuy(c.price); });
        el.appendChild(b);
        grid.appendChild(el);
      }
      L.appendChild(grid);
    }
    body.scrollTop = scroll;
  }
  $('shopNav').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    shopTab = b.dataset.tab;
    renderShop();
    $('shopList').parentElement.scrollTop = 0;
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  });
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
      const vKnown = t.vendor && locUnlocked(D.VENDORS[t.vendor].loc);
      const sub = owned ? (favOf.length ? `Favorite of ${favOf.join(', ')}` : k === state.toy ? 'Throwing next' : 'Tap to use') : t.price == null ? 'Found on walks' : t.vendor ? (vKnown ? `${D.VENDORS[t.vendor].name} · 🪙 ${t.price}` : 'Sold somewhere new') : `Shop · 🪙 ${t.price}`;
      b.innerHTML = owned || t.price != null ? `${thumbOf.toy(k)}<b></b><small></small>` : `<span class="big q">${IC('question')}</span><b></b><small></small>`;
      b.querySelector('b').textContent = owned || t.price != null ? t.name : '???';
      b.querySelector('small').textContent = sub;
      b.addEventListener('click', () => {
        if (!owned) { toast(t.price == null ? 'Keep walking — maybe you’ll find one!' : t.vendor ? (vKnown ? `Sold at the ${D.VENDORS[t.vendor].name}` : 'Sold somewhere you haven’t been yet…') : 'You can buy this in the Shop'); return; }
        state.toy = k;
        updateToyIcons();
        renderBag();
        save();
      });
      G.appendChild(b);
    }
  }

  let cfYes = null, cfNo = null, cfAlt = null;
  function confirmBox(title, text, yesLabel, yesEnabled, onYes, onNo, alt) {
    $('cfTitle').textContent = title;
    $('cfText').textContent = text;
    $('cfYes').textContent = yesLabel;
    $('cfYes').disabled = !yesEnabled;
    cfYes = onYes;
    cfNo = onNo || null;
    cfAlt = alt ? alt.fn : null;
    $('cfAlt').classList.toggle('hidden', !alt);
    if (alt) { $('cfAlt').textContent = alt.label; $('cfAlt').disabled = !alt.enabled; }
    $('confirm').classList.remove('hidden');
  }
  $('cfAlt').addEventListener('click', () => {
    $('confirm').classList.add('hidden');
    const f = cfAlt; cfYes = null; cfNo = null; cfAlt = null;
    if (f) f();
  });
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
      b.title = B.name;
      b.setAttribute('aria-label', B.name);
      b.innerHTML = `<img src="${ART.portraitURL(id, coat)}" alt="">`;
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
      b.innerHTML = `${thumbOf.pic(T.icon)}<small>${esc(T.name)}</small>`;
      b.addEventListener('click', () => { pickState.trait = id; renderStart(); });
      tg.appendChild(b);
    }
    $('traitDesc').textContent = D.TRAITS[pickState.trait].desc;
    $('startBreed').textContent = D.BREEDS[pickState.breed].name;
    $('startCoat').textContent = ART.coatOf(pickState.breed, pickState.coat).name;
    const url = ART.thumbURL('dog', `${pickState.breed}|${pickState.coat}`);
    if (url) $('startDog').src = url;
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
      b.innerHTML = `${TH('dog', `${p.breed}|${p.coat}`)}<b>${esc(B.name)}</b><small>${esc(C.name)}</small><span class="chip">${esc(T.name)}</span>${p.taken ? '<em>Adopted</em>' : ''}`;
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
    if (P) $('pupDesc').textContent = `${D.TRAITS[P.trait].name}: ${D.TRAITS[P.trait].desc}`;
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
    } else if (b.id === 'visitBtn') {
      $('visitCode').value = visitLink();
      $('visitBox').classList.remove('hidden');
      const n = state.furniture.filter((f) => f.gift).length;
      $('visitInfo').textContent = n ? `Your link includes ${n} gift box${n > 1 ? 'es' : ''} 🎁` : 'Tip: place a 🎁 Gift box and pack something for your friends.';
    } else if (b.id === 'copyVisitBtn') {
      const ta = $('visitCode');
      try { await navigator.clipboard.writeText(ta.value); toast('Visit link copied 📋'); }
      catch (_) { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('Visit link copied 📋'); } catch (__) { toast('Select the link and copy it manually'); } }
    } else if (b.id === 'shareVisitBtn') {
      if (navigator.share) { try { await navigator.share({ title: 'Visit my Voxel Paws home', url: $('visitCode').value }); } catch (_) { /* cancelled */ } }
      else toast('Sharing is not available here — copy the link instead');
    } else if (b.id === 'openVisitBtn') {
      const txt = $('openVisitCode').value.trim();
      const m = txt.match(/VPV:[^\s#&]+/) || txt.match(/visit=([^\s&]+)/);
      const code = m ? (m[1] ? decodeURIComponent(m[1]) : m[0]) : '';
      let v = null;
      try { v = parseVisitCode(code); } catch (_) { v = null; }
      if (!v) { toast("That doesn't look like a visit link"); return; }
      save();
      location.hash = 'visit=' + encodeURIComponent(code);
      location.reload();
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
    const top = mode === 'trick' ? window.innerHeight - 100 : bars.length ? Math.min(...bars.map((e) => e.getBoundingClientRect().top)) : window.innerHeight - 20;
    $('toast').style.bottom = Math.max(20, window.innerHeight - top + 12) + 'px';
  }
  function toast(msg) {
    const t = $('toast');
    t.dataset.raw = msg;
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
    document.body.classList.toggle('visiting', !!visit);
    $('hud').classList.toggle('hidden', mode === 'trick' || !!visit);
    $('actions').classList.toggle('hidden', !(place === 'home' && mode === 'normal'));
    $('parkActions').classList.toggle('hidden', place !== 'park' || mode === 'trick');
    if (place !== 'park' || mode !== 'normal') setCtx(null);
    updateLocChip();
    $('decoBar').classList.toggle('hidden', mode !== 'decorate');
    $('buildBar').classList.toggle('hidden', mode !== 'build');
    gridGroup.visible = mode === 'decorate';
    candGroup.visible = mode === 'build';
    if (mode !== 'normal' || place === 'park') hideHint();
    placeToast();
  }
  function updateHud() {
    $('coinCount').textContent = state.coins;
    $('ticketCount').textContent = state.tickets || 0;
    $('ticketStat').classList.toggle('hidden', !state.tickets);
    if (!$('shop').classList.contains('hidden')) $('shopCoins').textContent = shopVendor && D.VENDORS[shopVendor].currency === 'tickets' ? state.tickets : state.coins;
    const b = state.build;
    $('buildPill').classList.toggle('hidden', !b);
    if (b) {
      const left = fmtTime(b.readyAt - Date.now());
      $('buildTime').textContent = left;
      if (siteLabel) setSpriteText(siteLabel, '🏗️ ' + left);
    }
    const W = curWeather();
    const night = weatherId === 'sun' && nightLevel > 0.5;
    setIcon($('clockIc'), night ? 'moon' : WX_ICON[weatherId] || 'sun');
    $('clockTime').textContent = clockNow.hm;
    $('clockWx').textContent = night ? 'Clear night' : W.name;
    updatePack();
  }

  // ----- wallet: hidden until your coins or tickets change, then it pops in and counts -----
  const wallet = {};
  for (const el of document.querySelectorAll('#wallet .wRow')) wallet[el.dataset.k] = { el, num: el.querySelector('.wNum'), delta: el.querySelector('.wDelta'), shown: null, from: 0, to: 0, t: 1, hold: 0, sum: 0 };
  const walletValue = (k) => (k === 'tickets' ? state.tickets || 0 : state.coins);
  function updateWallet(dt) {
    for (const [k, w] of Object.entries(wallet)) {
      const v = walletValue(k);
      if (w.shown === null || visit) { w.shown = w.to = v; continue; }
      if (v !== w.to) {
        if (w.hold <= 0) w.sum = 0;
        w.sum += v - w.to;
        w.from = w.shown;
        w.to = v;
        w.t = 0;
        w.hold = 2.2;
        w.delta.textContent = (w.sum > 0 ? '+' : '−') + Math.abs(w.sum);
        w.delta.className = 'wDelta ' + (w.sum > 0 ? 'up' : 'down');
        w.el.classList.add('show');
        w.el.classList.remove('bump');
        void w.el.offsetWidth;
        w.el.classList.add('bump');
      }
      if (w.t < 1) {
        w.t = Math.min(1, w.t + dt / 0.7);
        const e = 1 - Math.pow(1 - w.t, 3);
        w.shown = Math.round(w.from + (w.to - w.from) * e);
        w.num.textContent = w.shown;
      } else if (w.hold > 0) {
        w.hold -= dt;
        if (w.hold <= 0) w.el.classList.remove('show');
      }
    }
  }

  $('hud').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) doAct(b.dataset.act, b);
  });
  // the menu: stats on top, a grid of places to go below
  function openHub() {
    const home = place === 'home' && !visit;
    $('tileDecorate').classList.toggle('hidden', !home);
    $('hubTitle').textContent = place === 'park' ? LOC().name : 'Menu';
    $('tileBagSub').textContent = `${state.toys.length} toys · throwing the ${(D.TOYS[state.toy] || D.TOYS.tennis).name.toLowerCase()}`;
    let all = 0, got = 0;
    for (const [id] of BOOK_PAGES) { const pg = bookPage(id); all += pg.total; got += pg.done; }
    $('tileAlbumSub').textContent = `${got} of ${all} collected`;
    const left = state.daily ? state.daily.items.filter((c) => !c.done).length : 0;
    $('tileDailySub').textContent = !state.daily ? "Today's goals" : left ? `${left} left today` : 'All done today';
    computeComfort();
    renderComfortChip();
    updateHud();
    $('hub').classList.remove('hidden');
  }
  const closeHub = () => $('hub').classList.add('hidden');
  $('hub').addEventListener('click', (e) => {
    if (e.target.id === 'hub' || e.target.closest('[data-act="closeHub"]')) { closeHub(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act !== 'clock') closeHub();
    doAct(b.dataset.act, b);
  });
  // food and water at once (bowls are free to fill)
  function fillAll() {
    const has = (role) => state.furniture.some((f) => roleOf(f) === role);
    if (!has('food') && !has('water')) { toast('Place a food or water bowl first (🐾 Menu → 🎨 Decorate)'); return; }
    if (has('food')) fillBowls('food', true);
    if (has('water')) fillBowls('water', true);
    toast(has('food') && has('water') ? 'Bowls filled with food and water' : has('food') ? 'Food bowls filled' : 'Water bowls filled');
  }
  function doAct(act, b) {
    if (act === 'menu') openHub();
    else if (act === 'bowls') fillAll();
    else if (act === 'feed') fillBowls('food');
    else if (act === 'water') fillBowls('water');
    else if (act === 'ball') throwBall();
    else if (act === 'walk') openMap();
    else if (act === 'daily') openDaily();
    else if (act === 'album') openAlbum();
    else if (act === 'ctx') ctxAction();
    else if (act === 'locinfo') locChipInfo();
    else if (act === 'home') goHome();
    else if (act === 'decorate') enterDecorate();
    else if (act === 'done') exitDecorate();
    else if (act === 'shop') openShop();
    else if (act === 'bag') openBag();
    else if (act === 'settings') openSettings();
    else if (act === 'cancelBuild') exitBuildMode();
    else if (act === 'tricks') enterTrickMode(selected && dogs.includes(selected) ? selected : dogs[0]);
    else if (act === 'comfort') openComfort();
    else if (act === 'leaveVisit') leaveVisit();
    else if (act === 'leash') leashButton();
    else if (act === 'tab') { decoTab = b.dataset.tab; renderInv(); }
    else if (act === 'clock') {
      const W = curWeather();
      toast(`${W.name} in Germany, ${clockNow.hm}${W.muddy ? ' · walks get muddy' : ''}${W.lightning ? ' · shy dogs get scared' : ''}`);
    } else if (act === 'rotate') { placeRot = (placeRot + 1) % 4; renderInv(); toast(`Next item: ${rotNames[placeRot].toLowerCase()}`); }
  }
  $('shop').addEventListener('click', (e) => {
    if (e.target.id === 'shop' || e.target.closest('[data-act="closeShop"]')) closeShop();
  });
  $('comfort').addEventListener('click', (e) => { if (e.target.id === 'comfort' || e.target.closest('[data-act="closeComfort"]')) $('comfort').classList.add('hidden'); });
  $('visitLeave').addEventListener('click', leaveVisit);
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
    3(s) { // v3 -> v4: tricks, friendships, secret tricks found
      s.dogs = (s.dogs || []).map((d) => Object.assign({ tricks: {} }, d));
      s.friends = s.friends || {};
      s.secrets = s.secrets || [];
      notes.add('v4');
      return s;
    },
    4(s) { // v4 -> v5: home life (gardens, clutter, pantry, meals, shampoos, accessories, visit gifts)
      s.gardens = s.gardens || {};
      s.clutter = s.clutter || [];
      s.pantry = s.pantry || { carrot: 2, apple: 2, egg: 1 };
      s.meals = s.meals || [];
      s.shampoos = s.shampoos || { gentle: 2 };
      s.accessories = s.accessories || [];
      s.claimedGifts = s.claimedGifts || [];
      s.uid = s.uid || newId();
      s.dogs = (s.dogs || []).map((d) => Object.assign({ acc: {} }, d));
      notes.add('v5');
      return s;
    },
    5(s) { // v5 -> v6: places to walk, finds, daily challenges, the collectibles book
      s.unlocked = s.unlocked || [];
      s.locWalks = s.locWalks || { park: (s.stats && s.stats.walks) || 0 };
      s.glades = s.glades || [];
      s.treasures = s.treasures || 0;
      s.summits = s.summits || 0;
      s.finds = s.finds || {};
      s.seen = s.seen || { toys: (s.toys || []).slice(), coats: [], rares: [] };
      s.learned = s.learned || [];
      s.daily = null;
      notes.add('v6');
      return s;
    },
    6(s) { // v6 -> v7: the fantastical places (tickets, portal, rocket, puzzles)
      s.tickets = s.tickets || 0;
      s.portal = !!s.portal;
      s.rocket = !!s.rocket;
      s.puzzles = s.puzzles || 0;
      notes.add('v7');
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
    if (!st.friends || typeof st.friends !== 'object') st.friends = {};
    if (!Array.isArray(st.secrets)) st.secrets = [];
    st.secrets = st.secrets.filter((id) => ALL_TRICKS[id] && ALL_TRICKS[id].secret);
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    st.gardens = obj(st.gardens);
    st.pantry = obj(st.pantry);
    for (const k of Object.keys(st.pantry)) if (!D.INGREDIENTS[k]) delete st.pantry[k];
    st.shampoos = obj(st.shampoos);
    for (const k of Object.keys(st.shampoos)) if (!D.SHAMPOOS[k]) delete st.shampoos[k];
    st.clutter = Array.isArray(st.clutter) ? st.clutter.filter((c) => c && (c.kind === 'hole' || (c.kind === 'toy' && D.TOYS[c.type]))) : [];
    st.meals = Array.isArray(st.meals) ? st.meals.filter((m) => m && D.RECIPES[m.id]) : [];
    st.accessories = Array.isArray(st.accessories) ? st.accessories.filter((a) => D.ACCESSORIES[a]) : [];
    st.claimedGifts = Array.isArray(st.claimedGifts) ? st.claimedGifts : [];
    if (!st.uid) st.uid = newId();
    if (st.stats.rainWalks == null) st.stats.rainWalks = 0;
    st.unlocked = Array.isArray(st.unlocked) ? st.unlocked.filter((id) => D.LOCATIONS[id]) : [];
    st.locWalks = obj(st.locWalks);
    st.glades = Array.isArray(st.glades) ? st.glades.filter((g) => typeof g === 'string') : [];
    st.treasures = +st.treasures || 0;
    st.summits = +st.summits || 0;
    st.finds = obj(st.finds);
    for (const k of Object.keys(st.finds)) if (!D.FINDS[k]) delete st.finds[k];
    const sn = obj(st.seen), arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    st.seen = { toys: arr(sn.toys), coats: arr(sn.coats), rares: arr(sn.rares) };
    st.learned = arr(st.learned).filter((id) => ALL_TRICKS[id]);
    const dl = st.daily;
    st.daily = dl && typeof dl.date === 'string' && Array.isArray(dl.items) ? dl : null;
    st.tickets = Math.max(0, +st.tickets || 0);
    st.portal = !!st.portal;
    st.rocket = !!st.rocket;
    st.puzzles = +st.puzzles || 0;
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
  let hudTimer = 0, saveTimer = 5, slowTimer = 0, encTimer = 1;

  function update(dt) {
    animT += dt;
    updatePlayer(dt);
    updateTowelTask();
    updateUseTask();
    cookTick(dt);
    for (const g of guests) g.update(dt);
    for (const d of dogs) d.update(dt);
    separateDogs();
    updateBall(dt);
    if (tm) updateTrickMode(dt);
    encTimer -= dt;
    if (encTimer <= 0) { encTimer = 0.5; checkEncounters(); }
    if (place === 'park') {
      updateWalkers(dt);
      updateSniffSpots(dt);
      updateParkLoot(dt);
      updateQuirks(dt);
      updateVendorTask();
      if (!tiredWarned && dogs.some((d) => d.energy < CRITICAL)) { tiredWarned = true; toast('Your dog is getting tired — time to head home 🏠'); }
    } else {
      for (const r of furnRT.values()) if (r.group.userData.anim) r.group.userData.anim(animT);
    }
    for (const d of dogs) d.updateLeash();
    updateParticles(dt);
    updateWallet(dt);
    pumpThumbs();
    let fxW = localWeather();
    if (place === 'park' && S.env && S.env.snowFall && !fxW.precip) fxW = D.WEATHER.snow;
    lightning = weatherFX.update(dt, fxW, camLook, (x, z) => place === 'home' && isHomeTile(Math.floor(x), Math.floor(z)) && !isGardenTile(Math.floor(x), Math.floor(z)));
    applyEnvironment();
    updateDusk(Math.max(nightLevel, place === 'park' && S && S.env && S.env.dark ? 1 : 0));

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
    if (hudTimer <= 0) { hudTimer = 0.25; if (!visit) checkBuild(); updateHud(); }
    slowTimer -= dt;
    if (slowTimer <= 0) {
      slowTimer = 1;
      tickClock();
      for (const d of dogs) { d.applyGrowth(); d.updateDirtLook(); d.checkFavSwitch(); }
      if (!visit) { autoRefill(); computeComfort(); noteSeen(); checkUnlocks(); renderComfortChip(); checkLocUnlocks(); ensureDaily(); updateLocChip(); }
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
  function leaveVisit() {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }
  function initVisit(v) {
    load();
    visit = v;
    noSave = true;
    syncChunkSet();
    buildRoom();
    rebuildFurniture();
    rebuildSite();
    renderClutter();
    player.root.position.copy(freeNear(CHUNK / 2, CHUNK - 1.2));
    player.root.rotation.y = player.face = Math.PI;
    for (const dd of v.dogs) {
      const g = new GuestDog(dd);
      g.root.position.copy(randomFreePoint());
      world.add(g.root);
      guests.push(g);
    }
    $('visitName').textContent = `Visiting ${v.name}'s home`;
    const gifts = v.furniture.filter((f) => f.gift).length;
    $('visitHint').textContent = gifts ? `There ${gifts > 1 ? 'are' : 'is'} ${gifts} 🎁 gift box${gifts > 1 ? 'es' : ''} here — tap to open` : 'Have a look around!';
    $('visitBar').classList.remove('hidden');
    refreshUI();
    tickClock();
    applyEnvironment();
    updateCamera(0, true);
    loop();
  }
  window.addEventListener('hashchange', () => location.reload());
  function init() {
    const vm = location.hash.match(/^#visit=(.+)$/);
    if (vm) {
      let v = null;
      try { v = parseVisitCode(vm[1]); } catch (_) { v = null; }
      if (v) { initVisit(v); return; }
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => toast("That visit link seems broken — showing your own home"), 600);
    }
    const hadSave = load();
    syncChunkSet();
    buildRoom();
    rebuildFurniture();
    if (hadSave && notes.has('water')) giveWaterBowl();
    rebuildSite();
    renderClutter();
    computeComfort();
    renderComfortChip();
    player.root.position.copy(freeNear(CHUNK / 2, CHUNK - 1.2));
    player.root.rotation.y = player.face = Math.PI;
    for (const dd of state.dogs) addDog(dd, false);
    selected = dogs[0] || null;
    updateToyIcons();
    refreshLeashBtn();
    refreshUI();
    tickClock();
    applyEnvironment();
    if (!dogs.length) openStart();
    else if (notes.has('v3')) toast('New: breeds, personalities, weather & more! Tap a dog bubble to meet them 🐾');
    else if (notes.has('v4')) toast('New: Trick Mode, neighbors on walks & friendships! Open a dog bubble → Tricks');
    else if (notes.has('v5')) toast('New: baths, cooking, outfits, gardens, comfort & visit links! 🏡');
    else if (notes.has('v6')) toast('New: new places to walk, daily challenges & a collectibles book!');
    else if (notes.has('v7')) toast('New: new places to discover, and a fresh new look!');
    else toast(`Welcome back! ${dogs[0].name} missed you 🐾`);
    noteSeen();
    ensureDaily();
    renderDailyBadge();
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
      dogs, player, ball, grantToy, save, migrate, walkers, ALL_TRICKS,
      get tm() { return tm; }, get mode() { return mode; },
      pushToken, startEncounter, friendship, neighborGift, enterTrickMode, exitTrickMode,
      get comfort() { return comfort; }, computeComfort, openBath, bathRub, get bath() { return bath; }, openKitchen, startCooking, cookTap, get cook() { return cook; },
      openMeals, giveMeal, openWardrobe, checkUnlocks, makeVisitCode, visitLink, parseVisitCode, guests, get visit() { return visit; },
      doUse, startUse, startTidy, renderClutter, homeDig, pullToyOut, findRare, findIngredient, autoRefill, openGiftBox, takeForGift,
      setTime(h) { timeOverride = h; tickClock(); }, setWeather(w) { weatherOverride = w; tickClock(); },
      get loc() { return loc; }, get S() { return S; }, get quirk() { return quirk; }, goWalk, goHome, openMap, renderMap, checkLocUnlocks, locProgress,
      grantFind, rollFind, walkLoot, beachDig, askStay, tideLevel, setTide(v) { tideOverride = v; }, openShop, get shopVendor() { return shopVendor; },
      startVendor, tapVendor, ensureDaily, progress, openDaily, openAlbum, bookPage, get albumPage() { return albumPage; }, set albumPage(v) { albumPage = v; },
      noteSeen, mainDirt, addDirt, walkDirt, isSolid, quirkSolid, inPlaza, plazaPerformance, performTrick, spawnWalkers,
      setZoom(z) { zoom = z; }, snapCam() { updateCamera(0, true); }, get thumbWait() { return [...thumbWait]; }, pumpThumbs,
      doEcho, startSled, useRocket, usePortal, rideWheel, carnivalTrick, turnStatue, catchFloater, craterDig, travel, canVisitNow, ctxAction, get ctxKind() { return ctxKind; },
    };
  }
  init();
})();
