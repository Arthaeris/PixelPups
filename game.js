'use strict';
/* PixelPups — game logic and UI. Needs three.js, data.js and art.js (loaded in index.html). */
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
  // each room costs a bit more than the last; past the first handful the price only grows gently
  const expandPrice = (n) => Math.round(Math.min(CONFIG.EXPAND_BASE * Math.pow(CONFIG.EXPAND_GROWTH, n - 1), 200 * n + 8 * n * n) / 5) * 5;
  const traitList = () => Object.keys(D.TRAITS);
  function randomTraits(primary) {
    const p = primary && D.TRAITS[primary] ? primary : pick(traitList());
    return [p, pick(traitList().filter((t) => t !== p))];
  }
  // tricks: the 15 visible ones plus the unscrambled secret ones
  const SECRETS = (() => {
    try { return JSON.parse(atob(D.SECRET_TRICKS).split('').reverse().join('')); } catch (_) { return []; }
  })();
  // tricks you teach in Trick Mode (Sing along is learned from music instead)
  const BASIC_TRICKS = Object.keys(D.TRICKS).filter((id) => !D.TRICKS[id].music);
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
  let thumbScan = 0;
  function pumpThumbs() {
    // pictures can arrive later inside cards that were queued (news, tips): look for them now and then
    if (!thumbWait.size) {
      if (++thumbScan % 10) return;
      if (!document.querySelector('img.th[data-th]:not([src]):not(.none)')) return;
      thumbWait.add('scan');
    }
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
  const EMOJI_RE = /(?:[#*0-9]\uFE0F?\u20E3)|(?:(?![\u2605\u2665\u00A9\u00AE\u2122\u2192\u2190])[\p{Extended_Pictographic}\p{Regional_Indicator}])(?:\uFE0F|\u200D[\p{Extended_Pictographic}\u2640\u2642\u2695]\uFE0F?|[\u{1F3FB}-\u{1F3FF}])*\uFE0F?/gu;
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

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 300);
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
    ...Object.keys(D.WALLS).filter((k) => !D.WALLS[k].price && !D.WALLS[k].earned),
    ...Object.keys(D.FLOORS).filter((k) => !D.FLOORS[k].price && !D.FLOORS[k].earned),
  ];
  function defaultState() {
    return {
      v: CONFIG.SAVE_VERSION,
      coins: 20,
      chunks: [[0, 0]],
      build: null,
      rooms: {},
      walls: {},
      stairs: null,
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
      hiddenFound: {},                 // place -> hidden spots found
      explored: {},                    // place -> bits of the map you have walked
      glades: [],                      // hidden forest glades found
      treasures: 0,
      summits: 0,
      finds: {},                       // 📒 book finds: id -> how many
      seen: { toys: [], coats: [], rares: [] },
      learned: [],                     // tricks any dog has learned
      seeds: {}, beds: [], bouquets: 0, paintings: [], playerName: '',   // the garden, paintings and your name
      treats: {}, caught: {}, catchBook: {}, exhibits: {}, snowmen: [], fishCaught: {}, rivals: {}, favorsFrom: {},
      daily: null,                     // today's challenges
      tickets: 0,                      // carnival tickets
      portal: false,                   // fairy portal opened
      rocket: false,                   // rocket fueled for the moon
      puzzles: 0,                      // fairy statue puzzles solved
      tips: [],                        // first-time tips already shown
      look: JSON.parse(JSON.stringify(D.DEFAULT_LOOK)),   // your character
      outfits: ['tee', 'jeans'],       // clothes you own
      lookDone: false,                 // new players make their character first
      tutorial: 'new',                 // the guided start: 'new' until done or skipped
      event: null,                     // today's little event
      xp: 0,                           // trainer XP: your rank comes from this
      rankSeen: 1,                     // the highest rank already celebrated
      mastery: {},                     // place -> mastery points (stars)
      xpDay: null,                     // how much of each activity counted today
      houseTier: 0,                    // 0 = cozy flat … 4 = dream estate
      stories: {},                     // neighbor -> { ch: chapters done, n: progress, day: game day of the last one }
      allowanceDay: '',
      critters: {},                    // critter guide: id -> times spotted
      gadgets: [],                     // things you carry: flashlight
      chats: {},                       // neighbor -> { n: chats, day: game day of the last gift }
      setsDone: [],                    // collection sets finished
      seasonsDone: [],                 // months whose set is finished
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
  // extra save copies (the main save key never changes)
  const TRANSFER_KEY = 'voxelpaws-transfer', BUST_KEY = 'voxelpaws-bust', RESCUE_KEY = 'voxelpaws-rescue', LAST_KEY = 'voxelpaws-lastgood';
  const boot = { updated: false, recovered: false, problem: false, blocked: false };
  let tm = null;           // Trick Mode session
  const walkers = [];
  const encCooldown = new Map();

  // =====================================================================
  // Time & weather. One in-game day lasts one real hour (German time):
  // :00 midnight, :15 sunrise, :30 midday, :45 sunset. Weather changes every half day.
  // =====================================================================
  const berlinFmt = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    } catch (_) { return null; }
  })();
  let timeOverride = null, weatherOverride = null, gdOverride = null;
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function berlinNow() {
    let p = {};
    if (berlinFmt) {
      for (const x of berlinFmt.formatToParts(new Date())) p[x.type] = x.value;
    } else {
      const d = new Date(), pad = (n) => String(n).padStart(2, '0');
      p = { year: d.getFullYear(), month: pad(d.getMonth() + 1), day: pad(d.getDate()), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
    }
    const realHour = (+p.hour % 24) + +p.minute / 60 + +p.second / 3600;
    // every real hour is one game day, counted from a fixed start
    const gameDay = gdOverride !== null ? gdOverride : Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24) / 3600000);
    let hour = ((+p.minute + +p.second / 60) / 60) * 24;
    if (timeOverride !== null) hour = timeOverride;
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    // the in-game calendar: 24 days a month, so seasons come and go every few real days
    const cal = calOf(gameDay);
    return { dateKey: `${p.year}-${p.month}-${p.day}`, month: cal.month, day: cal.day, year: cal.year, realMonth: +p.month, hour, realHour, gameDay, weekday: WEEKDAYS[((gameDay % 7) + 7) % 7], hm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
  }
  const CALD = D.CAL.monthDays, CALY = D.CAL.monthDays * 12;
  const CAL_BASE = Math.floor(Date.UTC(2026, 9, 1) / 3600000 / (D.CAL.monthDays * 12)) - 1;
  function calOf(gd) {
    const doy = ((gd % CALY) + CALY) % CALY;
    return { month: Math.floor(doy / CALD) + 1, day: (doy % CALD) + 1, year: Math.floor(gd / CALY) - CAL_BASE };
  }
  const gdOf = (y, m, d) => (y + CAL_BASE) * CALY + (m - 1) * CALD + (d - 1);
  const seasonOf = (m) => (m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn');
  // weather for one half day: slot = gameDay * 2 (+1 for the night half, from 18:00)
  function slotOf(now) { const h = now.hour; return now.gameDay * 2 + (h >= 18 ? 1 : 0) - (h < 6 ? 1 : 0); }
  function weatherAt(slot, month, depth = 0) {
    const r = ART.mulberry32(hashStr('wx#' + slot));
    // weather tends to hang around a little
    if (depth < 3 && r() < 0.35) return weatherAt(slot - 1, month, depth + 1);
    const odds = D.WEATHER_ODDS[seasonOf(month)];
    let x = r() * Object.values(odds).reduce((a, b) => a + b, 0);
    for (const [k, v] of Object.entries(odds)) { x -= v; if (x <= 0) return k; }
    return 'sun';
  }
  function weatherFor(now) {
    if (weatherOverride && D.WEATHER[weatherOverride]) return weatherOverride;
    return weatherAt(slotOf(now), now.month);
  }
  // the next in-game week: [{ name, day, night }]
  function forecast() {
    const now = clockNow, out = [];
    for (let k = 0; k < 7; k++) {
      const gd = now.gameDay + k;
      out.push({ name: k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : WEEKDAYS[((gd % 7) + 7) % 7], day: weatherAt(gd * 2, now.month), night: weatherAt(gd * 2 + 1, now.month) });
    }
    return out;
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
    // indoors, the weather outside doesn't dim or fog up your rooms; only the time of day shows
    const L = ART.daylight(clockNow.hour, place === 'home' ? D.WEATHER.sun : curWeather());
    nightLevel = L.night;
    const E = place === 'park' && S && S.env ? S.env : null;
    world.background.copy(L.sky);
    if (E && E.sky) world.background.copy(envColor.set(E.sky)).lerp(L.sky, E.dark ? 0 : 0.15 * L.night);
    if (lightning) world.background.lerp(new THREE.Color('#ffffff'), 0.5);
    // nights are properly dark, so lamps, lanterns and flashlights make a difference
    const deep = E && E.dark ? 0 : L.night * (place === 'home' ? 0.42 : 0.38);
    hemiLight.intensity = (E && E.hemi != null ? E.hemi * (E.dark ? 1 : 1 - 0.4 * L.night) : L.hemi) * (1 - deep) + lightning * 0.8;
    sunLight.intensity = (E && E.sun != null ? E.sun * (E.dark ? 1 : 1 - 0.5 * L.night) : L.sun) * (1 - deep) + lightning * 1.2;
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
    syncStairs();
  }
  const hasChunk = (cx, cz) => chunkSet.has(chunkKey(cx, cz));
  const isHomeTile = (i, j) => hasChunk(Math.floor(i / CHUNK), Math.floor(j / CHUNK));
  const roomStyle = (cx, cz) => Object.assign({}, D.DEFAULT_ROOM, home().rooms[chunkKey(cx, cz)]);
  const isGardenChunk = (cx, cz) => !!(home().gardens || {})[chunkKey(cx, cz)];
  const isGardenTile = (i, j) => isGardenChunk(Math.floor(i / CHUNK), Math.floor(j / CHUNK));
  const gardensUnlocked = () => state.chunks.length >= D.GARDEN_UNLOCK_SECTIONS && unlockedFeat('gardens');
  const ARTS = ['#f6a5c0', '#9ad0a7', '#ffd27a', '#a7b8f5'];

  // =====================================================================
  // Upstairs, the staircase and walls between rooms.
  // Upstairs rooms live in the same tile grid, shifted UPC chunks east (so paths, furniture and collisions just work);
  // when drawing, everything over there is lifted up by FH and slid back over the rooms below.
  // =====================================================================
  const UPC = 50, UPX = UPC * CHUNK, FH = 2.7, UP_LIM = (UPC - 20) * CHUNK;
  const isUpX = (x) => x >= UP_LIM;
  const isUpChunk = (cx) => cx >= UPC - 20;
  const floorOfX = (x) => (isUpX(x) ? 1 : 0);
  const chunkFloor = ([cx]) => (isUpChunk(cx) ? 1 : 0);
  const floorChunks = (fl, H = home()) => H.chunks.filter((c) => chunkFloor(c) === fl);
  const hasUpstairs = (H = home()) => H.chunks.some((c) => chunkFloor(c) === 1);
  const upCap = () => (D.HOUSE_TIERS[houseTier()].up || 0);
  const upOpen = () => !!state.upOK || hasUpstairs(state);
  // ascent directions for stairs: 0 = away from you (north), 1 = east, 2 = towards you, 3 = west
  const DIR4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const STAIR_NAMES = ['Going up away from you', 'Going up to the right', 'Going up towards you', 'Going up to the left'];
  // the tiles a staircase uses: steps (downstairs) = the stairwell (upstairs), the tile in front, the landing at the top
  function stairCells(st) {
    if (!st) return null;
    const [di, dj] = DIR4[st.rot];
    return {
      steps: [0, 1, 2].map((k) => [st.i + di * k, st.j + dj * k]),
      entry: [st.i - di, st.j - dj],
      landing: [st.i + di * 3 + UPX, st.j + dj * 3],
      di, dj,
    };
  }
  let stairSet = new Set();
  function syncStairs() {
    stairSet = new Set();
    const c = stairCells(home().stairs);
    if (c) for (const [i, j] of c.steps) { stairSet.add(i + ',' + j); stairSet.add((i + UPX) + ',' + j); }
  }
  const stairSolid = (i, j) => stairSet.has(i + ',' + j);
  const isStairEntry = (i, j) => { const c = stairCells(home().stairs); return !!c && c.entry[0] === i && c.entry[1] === j; };
  const isStairLanding = (i, j) => { const c = stairCells(home().stairs); return !!c && c.landing[0] === i && c.landing[1] === j; };
  // walls between rooms: key "cx,cz,e" is the east side of a room, "cx,cz,s" its south side. 'w' = wall, 'd' = doorway
  const inDoor = (a) => a > 2.05 && a < CHUNK - 2.05;
  function edgeKey(cx, cz, ncx, ncz) {
    if (ncx !== cx) return `${Math.min(cx, ncx)},${cz},e`;
    return `${cx},${Math.min(cz, ncz)},s`;
  }
  // stepping from one tile to the next (sideways or diagonal): does a wall stand in the way?
  function wallBlocks(i, j, ni, nj) {
    const W = home().walls;
    if (!W) return false;
    const cx = Math.floor(i / CHUNK), cz = Math.floor(j / CHUNK), ncx = Math.floor(ni / CHUNK), ncz = Math.floor(nj / CHUNK);
    if (cx === ncx && cz === ncz) return false;
    if (ncx !== cx && ncz !== cz) return true;   // corners: never squeeze past diagonally
    const w = W[edgeKey(cx, cz, ncx, ncz)];
    if (!w) return false;
    if (w === 'd') return !inDoor((ncx !== cx ? j : i) - (ncx !== cx ? cz : cx) * CHUNK + 0.5);
    return true;
  }
  // a point standing in a wall (thin walls sit right on the line between two rooms)
  function wallSolidAt(x, z) {
    const W = home().walls;
    if (!W) return false;
    const C = CHUNK, T = 0.14;
    const bx = Math.round(x / C) * C;
    if (Math.abs(x - bx) < T) {
      const cz = Math.floor(z / C), w = W[`${bx / C - 1},${cz},e`];
      if (w && !(w === 'd' && inDoor(z - cz * C))) return true;
    }
    const bz = Math.round(z / C) * C;
    if (Math.abs(z - bz) < T) {
      const cx = Math.floor(x / C), w = W[`${cx},${bz / C - 1},s`];
      if (w && !(w === 'd' && inDoor(x - cx * C))) return true;
    }
    return false;
  }
  // is every room reachable (through open sides, doorways and the stairs)?
  function homeConnected(chunks, walls, stairs) {
    if (!chunks.length) return true;
    const set = new Set(chunks.map(([x, z]) => chunkKey(x, z)));
    const seen = new Set([chunkKey(...chunks.find((c) => chunkFloor(c) === 0) || chunks[0])]);
    const q = [...seen].map((k) => k.split(',').map(Number));
    const sc = stairs && [Math.floor(stairs.i / CHUNK), Math.floor(stairs.j / CHUNK)];
    while (q.length) {
      const [cx, cz] = q.shift();
      const next = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (!set.has(chunkKey(nx, nz))) continue;
        if ((walls || {})[edgeKey(cx, cz, nx, nz)] === 'w') continue;
        next.push([nx, nz]);
      }
      if (sc && cx === sc[0] && cz === sc[1]) next.push([cx + UPC, cz]);
      if (sc && cx === sc[0] + UPC && cz === sc[1]) next.push([sc[0], sc[1]]);
      for (const n of next) { const k = chunkKey(...n); if (set.has(k) && !seen.has(k)) { seen.add(k); q.push(n); } }
    }
    return seen.size === set.size;
  }

  // ----- which floor is on screen -----
  let editFloor = 0;   // the floor you're arranging in Decorate / room building
  function viewFloor() {
    if (place !== 'home') return 0;
    if (mode === 'decorate' || mode === 'build') return editFloor;
    const p = player.root.position;
    return isUpX(p.x) || (player.climb && p.y > FH * 0.5) ? 1 : 0;
  }
  // slide everything upstairs into place for drawing or tapping (and back again afterwards)
  const shifted = [];
  function shiftWalk(o, hide) {
    for (const c of o.children) {
      if (c.position.x >= UP_LIM) {
        shifted.push(c, c.visible);
        c.position.x -= UPX;
        c.position.y += FH;
        if (hide && !c.userData.keepShown) c.visible = false;
      } else if (c.children.length) shiftWalk(c, hide);
    }
  }
  function shiftUp() {
    if (place !== 'home' || !hasUpstairs() && !(home().build && isUpChunk(home().build.cx))) return false;
    shiftWalk(world, viewFloor() === 0);
    return true;
  }
  function shiftBack() {
    for (let k = 0; k < shifted.length; k += 2) {
      const c = shifted[k];
      c.position.x += UPX;
      c.position.y -= FH;
      c.visible = shifted[k + 1];
    }
    shifted.length = 0;
  }
  function drawWorld() {
    const on = shiftUp();
    renderer.render(world, camera);
    if (on) shiftBack();
  }
  function withShift(fn) {
    const on = shiftUp();
    if (on) world.updateMatrixWorld(true);
    try { return fn(); } finally { if (on) { shiftBack(); world.updateMatrixWorld(true); } }
  }

  // ----- walking up and down the stairs -----
  function stairGeom() {
    const st = home().stairs, c = stairCells(st);
    if (!c) return null;
    const { di, dj } = c;
    const cx = st.i + 0.5, cz = st.j + 0.5;
    return {
      E: { x: c.entry[0] + 0.5, z: c.entry[1] + 0.5, y: 0 },
      B: { x: cx - di * 0.5, z: cz - dj * 0.5, y: 0 },
      T: { x: cx + di * 2.5, z: cz + dj * 2.5, y: FH },
      Tu: { x: cx + di * 2.5 + UPX, z: cz + dj * 2.5, y: 0 },
      L: { x: c.landing[0] + 0.5, z: c.landing[1] + 0.5, y: 0 },
      di, dj,
    };
  }
  function startClimb(a, up) {
    const G = stairGeom();
    if (!G) return false;
    const c = stairCells(home().stairs);
    if (!isHomeTile(c.landing[0], c.landing[1]) || !isHomeTile(c.entry[0], c.entry[1])) return false;
    a.climb = { pts: up ? [G.E, G.B, G.T, G.Tu, G.L] : [G.L, G.Tu, G.T, G.B, G.E], k: 1, up };
    if (a === player) player.moveTarget = player.moveTarget && floorOfX(player.moveTarget.x) === (up ? 1 : 0) ? player.moveTarget : null;
    return true;
  }
  // moves a climbing dog or you along the steps; returns how far it went
  function climbStep(a, dt, speed) {
    const C = a.climb, p = a.root.position;
    let left = dt * speed, went = 0, face = null;
    while (left > 1e-4 && C.k < C.pts.length) {
      const q = C.pts[C.k];
      if (floorOfX(q.x) !== floorOfX(p.x)) { p.set(q.x, q.y, q.z); C.k++; continue; }
      const dx = q.x - p.x, dz = q.z - p.z, dy = q.y - p.y, d = Math.hypot(dx, dz, dy);
      if (Math.hypot(dx, dz) > 1e-3) face = Math.atan2(dx, dz);
      if (d <= left) { p.set(q.x, q.y, q.z); left -= d; went += d; C.k++; continue; }
      p.x += (dx / d) * left; p.y += (dy / d) * left; p.z += (dz / d) * left; went += left; left = 0;
    }
    if (face !== null) {
      if (a === player) player.face = face; else a.face = face;
      a.root.rotation.y = angleLerp(a.root.rotation.y, face, damp(0.0004, dt));
    }
    if (C.k >= C.pts.length) { a.climb = null; p.y = 0; }
    return went;
  }
  // the end of the stairs on the floor you're on (where you step on)
  function stairEnd(fl) {
    const G = stairGeom();
    return G ? (fl === 1 ? G.L : G.E) : null;
  }
  // a dog headed for the other floor: walk to the stairs, then up or down
  function dogFloorHop(d, tx) {
    if (place !== 'home' || d.climb || !home().stairs) return null;
    const pos = d.root.position, fl = floorOfX(pos.x);
    if (floorOfX(tx) === fl) return null;
    const P = stairEnd(fl);
    if (!P) return null;
    if (Math.hypot(P.x - pos.x, P.z - pos.z) < 0.4) { startClimb(d, fl === 0); return 'climb'; }
    return P;
  }
  // you, pushing the stick into the stairs while standing in front of them
  function playerStairPush(mx, mz) {
    if (place !== 'home' || player.climb || !home().stairs) return false;
    const c = stairCells(home().stairs), p = player.root.position;
    const i = Math.floor(p.x), j = Math.floor(p.z);
    if (i === c.entry[0] && j === c.entry[1] && mx * c.di + mz * c.dj > 0.55) return startClimb(player, true);
    if (i === c.landing[0] && j === c.landing[1] && -(mx * c.di + mz * c.dj) > 0.55) return startClimb(player, false);
    return false;
  }

  // ----- drawing: the staircase, the stairwell, walls between rooms -----
  const stairGroup = pivot(homeRoot);
  const innerWallGroup = pivot(homeRoot);
  let innerWallKey = '';
  const floorPieceMats = new Map();
  function floorPieceMat(id, w, d, ox, oz) {
    const k = [id, w, d, ox % 2, oz % 2].join('|');
    if (floorPieceMats.has(k)) return floorPieceMats.get(k);
    const base = ART.floorMaterial(id);
    let m = base;
    if (base.map) {
      const t = base.map.clone();
      t.needsUpdate = true;
      if (t.repeat) t.repeat.set(w / 2, d / 2);
      if (t.offset) t.offset.set((ox % 2) / 2, -(oz % 2) / 2);
      m = new THREE.MeshLambertMaterial({ map: t });
    }
    floorPieceMats.set(k, m);
    return m;
  }
  // the floor of an upstairs room with the stairwell in it: four pieces around the hole
  function stairwellFloor(cx, cz, floorId) {
    const c = stairCells(home().stairs);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const hs = c.steps.map(([i, j]) => [i + UPX, j]);
    const hx0 = Math.min(...hs.map((h) => h[0])), hx1 = Math.max(...hs.map((h) => h[0])) + 1;
    const hz0 = Math.min(...hs.map((h) => h[1])), hz1 = Math.max(...hs.map((h) => h[1])) + 1;
    const pieces = [
      [x0, x0 + CHUNK, z0, hz0], [x0, x0 + CHUNK, hz1, z0 + CHUNK],
      [x0, hx0, hz0, hz1], [hx1, x0 + CHUNK, hz0, hz1],
    ];
    for (const [a, b, e, f] of pieces) {
      if (b - a < 0.01 || f - e < 0.01) continue;
      const m = new THREE.Mesh(geo(b - a, 0.12, f - e), floorPieceMat(floorId, b - a, f - e, a - x0, e - z0));
      m.position.set((a + b) / 2, -0.06, (e + f) / 2);
      roomGroup.add(m);
    }
    // a railing round the hole, open at the top of the stairs
    const rail = '#8d6e4c';
    const sides = [[hx0, hx0, hz0, hz1, 'w'], [hx1, hx1, hz0, hz1, 'e'], [hx0, hx1, hz0, hz0, 'n'], [hx0, hx1, hz1, hz1, 's']];
    const topSide = c.di === 1 ? 'e' : c.di === -1 ? 'w' : c.dj === 1 ? 's' : 'n';
    for (const [a, b, e, f, side] of sides) {
      if (side === topSide) continue;
      const len = Math.max(b - a, f - e), along = b - a > f - e;
      box(roomGroup, along ? len : 0.08, 0.06, along ? 0.08 : len, rail, (a + b) / 2, 0.9, (e + f) / 2);
      for (let k = 0; k <= len + 0.01; k += 0.5) box(roomGroup, 0.06, 0.9, 0.06, rail, along ? a + k : a, 0.45, along ? e : e + k);
    }
  }
  function buildStairs() {
    stairGroup.clear();
    const st = home().stairs;
    if (!st || !hasUpstairs()) return;
    const c = stairCells(st), G = stairGeom();
    const g = pivot(stairGroup, st.i + 0.5, 0, st.j + 0.5);
    g.rotation.y = Math.atan2(-c.di, -c.dj);   // the steps rise towards local -z
    const N = 9, run = 3 / N, rise = FH / N;
    for (let k = 0; k < N; k++) {
      const y = (k + 1) * rise;
      box(g, 0.94, y, run + 0.01, k % 2 ? '#b58b5f' : '#a97f55', 0, y / 2, 0.5 - run * (k + 0.5));
      box(g, 0.96, 0.05, run + 0.03, '#d8b98d', 0, y + 0.02, 0.5 - run * (k + 0.5));
    }
    for (const x of [-0.5, 0.5]) {
      box(g, 0.06, 0.06, 3.3, '#6d4c41', x, FH * 0.5 + 0.85, -1);
      g.children[g.children.length - 1].rotation.x = Math.atan2(FH, 3);
      for (let k = 0; k < 4; k++) box(g, 0.05, 0.9, 0.05, '#6d4c41', x, (k + 0.5) * FH / 4 + 0.45, 0.4 - k * 0.95);
    }
    void G;
  }
  // walls between rooms. In front of you (between you and the camera) they're cut down so you can see in.
  function buildInnerWalls(force) {
    const H = home(), W = H.walls || {};
    const p = player.root.position;
    const cut = mode === 'build' || mode === 'decorate';
    const pcx = Math.floor(p.x / CHUNK), pcz = Math.floor(p.z / CHUNK);
    const key = Object.entries(W).map((e) => e.join(':')).join('|') + '/' + (cut ? 'c' : pcx + ',' + pcz) + '/' + H.chunks.length + '/' + Object.keys(H.rooms || {}).length;
    if (!force && key === innerWallKey) return;
    innerWallKey = key;
    innerWallGroup.clear();
    for (const [k, w] of Object.entries(W)) {
      const [cx, cz, side] = k.split(','), x = +cx, z = +cz;
      const east = side === 'e';
      const a = [x, z], b = east ? [x + 1, z] : [x, z + 1];
      if (!hasChunk(...a) || !hasChunk(...b)) continue;
      // in front of you = the wall's line is south or east of where you stand
      const front = cut || (east ? (x + 1) * CHUNK > p.x && Math.abs((z + 0.5) * CHUNK - p.z) < CHUNK * 1.6 : (z + 1) * CHUNK > p.z && Math.abs((x + 0.5) * CHUNK - p.x) < CHUNK * 1.6) && !(east ? pcx === x + 1 : pcz === z + 1);
      const h = front ? 0.45 : 2.4;
      const sideStyle = (c) => (isGardenChunk(...c) ? null : roomStyle(...c));
      const sA = sideStyle(a), sB = sideStyle(b);
      const L0 = east ? z * CHUNK : x * CHUNK;
      const segs = w === 'd' ? [[0, 2], [CHUNK - 2, CHUNK]] : [[0, CHUNK]];
      for (const [u0, u1] of segs) {
        const len = u1 - u0, mid = L0 + (u0 + u1) / 2;
        for (const [st, off] of [[sA, -0.06], [sB, 0.06]]) {
          const matC = st ? (front ? (D.WALLS[st.wall] || D.WALLS.cream).c1 : ART.wallMaterial(st.wall, len)) : '#e8e2d6';
          if (east) box(innerWallGroup, 0.12, h, len, matC, (x + 1) * CHUNK + off, h / 2, mid);
          else box(innerWallGroup, len, h, 0.12, matC, mid, h / 2, (z + 1) * CHUNK + off);
        }
        const trim = sA ? (D.WALLS[sA.wall] || D.WALLS.cream).trim : '#c9b9a0';
        if (east) box(innerWallGroup, 0.28, 0.08, len, trim, (x + 1) * CHUNK, h + 0.03, mid);
        else box(innerWallGroup, len, 0.08, 0.28, trim, mid, h + 0.03, (z + 1) * CHUNK);
      }
      if (w === 'd') {
        // a doorway: a frame (no door), with the wall over it when the wall is full height
        const trim = sA ? (D.WALLS[sA.wall] || D.WALLS.cream).trim : '#c9b9a0';
        const m0 = L0 + 2, m1 = L0 + CHUNK - 2;
        for (const u of [m0, m1]) {
          if (east) box(innerWallGroup, 0.3, h + 0.02, 0.1, trim, (x + 1) * CHUNK, (h + 0.02) / 2, u);
          else box(innerWallGroup, 0.1, h + 0.02, 0.3, trim, u, (h + 0.02) / 2, (z + 1) * CHUNK);
        }
        if (!front) {
          const lw = m1 - m0, mm = (m0 + m1) / 2, sm = sA ? (D.WALLS[sA.wall] || D.WALLS.cream).c1 : '#e8e2d6';
          if (east) { box(innerWallGroup, 0.24, 0.4, lw, sm, (x + 1) * CHUNK, 2.2, mm); box(innerWallGroup, 0.3, 0.1, lw + 0.1, trim, (x + 1) * CHUNK, 1.98, mm); }
          else { box(innerWallGroup, lw, 0.4, 0.24, sm, mm, 2.2, (z + 1) * CHUNK); box(innerWallGroup, lw + 0.1, 0.1, 0.3, trim, mm, 1.98, (z + 1) * CHUNK); }
        }
      }
    }
  }

  function buildRoom() {
    roomGroup.clear();
    gridGroup.clear();
    const C = CHUNK, h = C / 2;
    home().chunks.forEach(([cx, cz], n) => {
      const x0 = cx * C, z0 = cz * C;
      if (isGardenChunk(cx, cz)) { buildGardenChunk(cx, cz); return; }
      const st = roomStyle(cx, cz);
      const W = D.WALLS[st.wall] || D.WALLS.cream;
      const sc = home().stairs && stairCells(home().stairs);
      if (sc && isUpChunk(cx) && Math.floor(sc.steps[0][0] / C) === cx - UPC && Math.floor(sc.steps[0][1] / C) === cz) stairwellFloor(cx, cz, st.floor);
      else {
        const floor = new THREE.Mesh(geo(C, 0.12, C), ART.floorMaterial(st.floor));
        floor.position.set(x0 + h, -0.06, z0 + h);
        roomGroup.add(floor);
      }
      // upstairs rooms rest on a thick ceiling over the room below
      if (isUpChunk(cx)) box(roomGroup, C + 0.02, 0.26, C + 0.02, W.trim, x0 + h, -0.25, z0 + h);

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
    buildStairs();
    buildInnerWalls(true);
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
      if (f.type === 'painting') applyPaintingTex(g, f.pid);
    }
    rebuildHomeLights();
    if (!visit) mailFlags();
  }
  // =====================================================================
  // Light at night: lamps light up the floor around them, and on walks a flashlight or headlamp lights the way
  // (soft pools of light and glows, so they're cheap and look the same on every phone)
  // =====================================================================
  const glowTex = (() => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      // the glow is written pixel by pixel: Safari adds coloured noise to canvas gradients, which showed as confetti in the light
      const img = x.createImageData(64, 64), A = [[0, 1], [0.35, 0.55], [0.7, 0.16], [1, 0]];
      for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
        const d = Math.min(1, Math.hypot(i + 0.5 - 32, j + 0.5 - 32) / 32);
        let k = 0;
        while (k < A.length - 2 && d > A[k + 1][0]) k++;
        const t = (d - A[k][0]) / (A[k + 1][0] - A[k][0]);
        const n = (j * 64 + i) * 4;
        img.data[n] = img.data[n + 1] = img.data[n + 2] = 255;
        img.data[n + 3] = Math.round(255 * (A[k][1] + (A[k + 1][1] - A[k][1]) * t));
      }
      x.putImageData(img, 0, 0);
      return new THREE.CanvasTexture(c);
    } catch (_) { return null; }
  })();
  const ADD = THREE.AdditiveBlending;
  const POOL_Y = 0.24;
  const PLANE1 = THREE.PlaneGeometry ? new THREE.PlaneGeometry(1, 1) : new THREE.BoxGeometry(1, 1, 0.001);
  function lightPool(color) {
    const m = new THREE.Mesh(PLANE1, new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: ADD, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 3;
    return m;
  }
  function lightHalo(color, s) {
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: ADD, depthWrite: false, fog: false }));
    h.scale.set(s, s, 1);
    h.renderOrder = 4;
    return h;
  }
  // ----- at home -----
  const homeLightGroup = new THREE.Group();
  homeRoot.add(homeLightGroup);
  let homeLights = [];
  function rebuildHomeLights() {
    homeLightGroup.clear();
    homeLights = [];
    for (const f of home().furniture) {
      const L = D.GLOW[f.type];
      if (!L) continue;
      const pool = lightPool(L.color), halo = lightHalo(L.color, 0.6 + L.r * 0.45);
      pool.position.set(f.i + 0.5, 0.08, f.j + 0.5);
      pool.scale.set(L.r * 2, L.r * 2, 1);
      halo.position.set(f.i + 0.5, L.y, f.j + 0.5);
      homeLightGroup.add(pool, halo);
      homeLights.push({ f, L, pool, halo, k: Math.random() * 10 });
    }
  }
  const glowOn = (f, L) => (L.on === undefined ? true : (f.on ?? L.on));
  // how much of your home is lit at night, 0..1
  function homeLitShare() {
    let lit = 0, all = 0;
    const src = home().furniture.filter((f) => D.GLOW[f.type] && glowOn(f, D.GLOW[f.type]));
    for (const [cx, cz] of home().chunks || state.chunks) {
      for (let i = 0; i < CHUNK; i++) for (let j = 0; j < CHUNK; j++) {
        const x = cx * CHUNK + i + 0.5, z = cz * CHUNK + j + 0.5;
        all++;
        if (src.some((f) => Math.hypot(f.i + 0.5 - x, f.j + 0.5 - z) <= D.GLOW[f.type].r * 0.85)) lit++;
      }
    }
    return all ? lit / all : 0;
  }
  function litAt(x, z) {
    return homeLights.some((h) => glowOn(h.f, h.L) && Math.hypot(h.f.i + 0.5 - x, h.f.j + 0.5 - z) <= h.L.r * 0.85);
  }
  // ----- on walks: street lamps, and your own light -----
  function sceneLights() {
    if (!S || S.lights) return;
    S.lights = [];
    const lamps = [];
    S.root.updateMatrixWorld(true);
    S.root.traverse((o) => { if (o.isMesh && o.material === ART.M.lamp) lamps.push(o); });
    for (const m of lamps.slice(0, 40)) {
      const p = new V3();
      m.getWorldPosition(p);
      const gy = S.height ? S.height(p.x, p.z) : 0;
      const tall = p.y - gy > 1.2;
      const pool = lightPool('#ffd890'), halo = lightHalo('#ffd890', tall ? 1.6 : 0.8);
      pool.position.set(p.x, gy + POOL_Y, p.z);
      pool.scale.set(tall ? 5.2 : 2.4, tall ? 5.2 : 2.4, 1);
      halo.position.copy(p);
      S.root.add(pool, halo);
      S.lights.push({ pool, halo, tall });
    }
  }
  const beamGroup = new THREE.Group();
  world.add(beamGroup);
  const playerBeam = { pool: lightPool('#fff1c9'), halo: lightHalo('#fff1c9', 0.7) };
  beamGroup.add(playerBeam.pool, playerBeam.halo);
  const dogBeams = [];
  const flashlight = new THREE.Group();
  ART.box(flashlight, 0.07, 0.07, 0.2, '#37474f', 0, -0.02, 0.06);
  ART.box(flashlight, 0.09, 0.09, 0.04, ART.M.lamp, 0, -0.02, 0.17);
  flashlight.visible = false;
  const hasGadget = (id) => (state.gadgets || []).includes(id);
  const wearsMiner = () => Object.values((state.look && state.look.outfit) || {}).some((id) => D.OUTFITS[id] && D.OUTFITS[id].model === 'miner');
  const dogLamp = (d) => !!d.acc && (d.acc.head === 'headlamp' || d.acc.head === 'minerhat');
  const walkDark = () => place === 'park' && (nightLevel > 0.45 || !!(S && S.env && S.env.dark));
  function walkLit() { return hasGadget('flashlight') || wearsMiner() || dogs.some(dogLamp); }
  function nightHidesSpots() { return walkDark() && !walkLit(); }
  const lv = new V3();
  function beamAt(b, root, face, dist, len, wide, s) {
    root.getWorldPosition(lv);
    const bx = lv.x + Math.sin(face) * dist, bz = lv.z + Math.cos(face) * dist;
    b.pool.position.set(bx, groundAt(bx, bz) + POOL_Y + 0.01, bz);
    b.pool.rotation.z = face;
    b.pool.scale.set(wide, len, 1);
    b.pool.material.opacity = 0.55 * s;
  }
  function updateLights(dt) {
    const night = nightLevel;
    // home: every lamp, candle and fire glows a little, flickering where it should
    homeLightGroup.visible = place === 'home' && night > 0.02;
    if (homeLightGroup.visible) {
      const t = animT;
      for (const h of homeLights) {
        const on = glowOn(h.f, h.L) ? 1 : 0;
        const fl = h.L.flicker ? 0.92 + Math.sin(t * 4.2 + h.k) * 0.04 + Math.sin(t * 7.3 + h.k) * 0.025 : h.L.twinkle ? 0.9 + Math.sin(t * 2 + h.k) * 0.1 : 1;
        h.pool.material.opacity = 0.62 * night * on * fl;
        h.halo.material.opacity = 0.5 * night * on * fl;
      }
      for (const r of furnRT.values()) r.group.userData.dark = night > 0.3;
    }
    // walks: street lamps after dark
    if (place === 'park' && S) {
      sceneLights();
      const dark = S.env && S.env.dark ? 1 : night;
      for (const l of S.lights) { l.pool.material.opacity = 0.45 * dark; l.halo.material.opacity = 0.55 * dark; }
    }
    // your own light, and your dogs' headlamps
    const dark = walkDark() ? Math.max(nightLevel, S && S.env && S.env.dark ? 1 : 0) : 0;
    const mine = dark > 0 && (hasGadget('flashlight') || wearsMiner()) && !title;
    beamGroup.visible = place === 'park' && dark > 0;
    if (mine) {
      const useHand = hasGadget('flashlight');
      if (useHand && flashlight.parent !== player.hand) player.hand.add(flashlight);
      flashlight.visible = useHand;
      beamAt(playerBeam, player.root, player.root.rotation.y, 2.2, 4.6, 2.6, dark);
      (useHand ? player.hand : player.root).getWorldPosition(lv);
      playerBeam.halo.position.set(lv.x, useHand ? lv.y : 1.75, lv.z);
      playerBeam.halo.material.opacity = 0.7 * dark;
    } else { flashlight.visible = false; playerBeam.pool.material.opacity = 0; playerBeam.halo.material.opacity = 0; }
    let k = 0;
    for (const d of dogs) {
      if (!dogLamp(d) || !beamGroup.visible) continue;
      if (!dogBeams[k]) { dogBeams[k] = { pool: lightPool('#fff6d8'), halo: lightHalo('#fff6d8', 0.45) }; beamGroup.add(dogBeams[k].pool, dogBeams[k].halo); }
      const b = dogBeams[k++];
      beamAt(b, d.root, d.root.rotation.y, 1.5, 3.2, 1.8, dark);
      d.head.getWorldPosition(lv);
      b.halo.position.set(lv.x, lv.y + 0.15, lv.z);
      b.halo.material.opacity = 0.6 * dark;
    }
    for (; k < dogBeams.length; k++) { dogBeams[k].pool.material.opacity = 0; dogBeams[k].halo.material.opacity = 0; }
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
    siteGroup.children.forEach((c) => { c.userData.keepShown = true; });
  }

  let buildCands = [];
  let buildPick = null;
  const candMat = new THREE.MeshBasicMaterial({ color: 0x6ccf6c, transparent: true, opacity: 0.4, depthWrite: false });
  const candSelMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.6, depthWrite: false });
  const plusMat = new THREE.SpriteMaterial({ map: emojiTexture('➕'), transparent: true, depthWrite: false });
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
      addSeats(scenes[id]);
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
  // =====================================================================
  // Trainer rank and place mastery. Features open up as your rank grows.
  // =====================================================================
  function rankInfo(xp = state.xp || 0) {
    let r = 1, left = xp;
    while (r < D.RANK_MAX && left >= D.rankNeed(r)) { left -= D.rankNeed(r); r++; }
    return { rank: r, into: left, need: r >= D.RANK_MAX ? 0 : D.rankNeed(r) };
  }
  function xpAtRank(r) { let t = 0; for (let k = 1; k < r; k++) t += D.rankNeed(k); return t; }
  function rank() { return (/[?&]maxrank\b/.test(location.search) ? D.RANK_MAX : 0) || rankInfo().rank; }
  function rankTitle(r) { return D.RANK_TITLES[clamp(r, 1, D.RANK_MAX) - 1]; }
  function featRank(f) { return D.RANK_UNLOCKS[f] ? D.RANK_UNLOCKS[f].rank : 0; }
  function unlockedFeat(f) { return !!visit || rank() >= featRank(f); }
  function needRank(f) {
    if (unlockedFeat(f)) return true;
    const U = D.RANK_UNLOCKS[f];
    toast(`${U.name} unlocks at Trainer rank ${U.rank}`);
    sfx('fail');
    return false;
  }
  function gainXP(n) {
    if (visit || !n) return;
    if (dogs.some((d) => d.hasBadge('champion'))) n *= 1.1;
    state.xp = (state.xp || 0) + Math.round(n);
    const r = rank();
    if (r > (state.rankSeen || 1)) {
      for (let k = (state.rankSeen || 1) + 1; k <= r; k++) celebrateRank(k);
      state.rankSeen = r;
      save();
    }
    renderRankRow();
  }
  // things you do: XP, and points toward mastering the place you are in (capped per game day)
  function earn(ev, amt = 1) {
    const X = D.XP[ev];
    if (!X || visit) return;
    if (X.cap) {
      const day = clockNow.gameDay;
      if (!state.xpDay || state.xpDay.day !== day) state.xpDay = { day, n: {} };
      const used = state.xpDay.n[ev] || 0;
      if (used >= X.cap) return;
      amt = Math.min(amt, X.cap - used);
      state.xpDay.n[ev] = used + amt;
    }
    gainXP(X.xp * amt);
    if (X.m && place === 'park') addMastery(loc, X.m * amt);
  }
  function starsOf(l) {
    const p = (state.mastery || {})[l] || 0;
    let s = 0;
    D.MASTERY_STARS.forEach((t, i) => { if (p >= t) s = i; });
    return s;
  }
  function starProgress(l) {
    const p = (state.mastery || {})[l] || 0, s = starsOf(l);
    if (s >= 5) return { s, have: p, next: null };
    return { s, have: p - D.MASTERY_STARS[s], next: D.MASTERY_STARS[s + 1] - D.MASTERY_STARS[s] };
  }
  function addMastery(l, n) {
    if (!D.LOCATIONS[l] || visit || !n) return;
    state.mastery = state.mastery || {};
    const before = starsOf(l);
    state.mastery[l] = (state.mastery[l] || 0) + n;
    const after = starsOf(l);
    for (let k = before + 1; k <= after; k++) starUp(l, k);
  }
  const starsHTML = (n) => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  function starUp(l, n) {
    sfx('unlock');
    news({ title: `${'★'.repeat(n)} ${D.LOCATIONS[l].name}`, text: n === 1 ? 'You’re getting to know this place. More stars bring perks here.' : D.MASTERY_PERKS[n], th: TH('loc', l) });
    if (n === 5) { state.coins += 300; setTimeout(() => gainXP(200), 50); }
    setTimeout(checkLocUnlocks, 100);
    save();
  }
  function celebrateRank(r) {
    const feats = Object.values(D.RANK_UNLOCKS).filter((U) => U.rank === r);
    const places = Object.keys(D.LOCATIONS).filter((id) => reqsOf(id).some((U) => U.kind === 'rank' && U.n === r) && !locUnlocked(id));
    sfx('unlock');
    try { confetti(player.root.position.clone().add(new V3(0, 1.8, 0)), 10); } catch (_) { /* fine */ }
    const what = feats.map((U) => U.say || U.name.charAt(0).toLowerCase() + U.name.slice(1));
    const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0];
    const text = what.length ? `Unlocked: ${list}.${places.length ? ' You’re a step closer to a new place, too.' : ''}` : places.length ? 'You’re a step closer to a new place.' : 'Keep it up, more opens at higher ranks.';
    news({ title: `Rank ${r}: ${rankTitle(r)}`, text, th: rankBadge(r) });
    setTimeout(() => { refreshGates(); checkLocUnlocks(); ensureDaily(); ensureEvent(); }, 60);
  }
  const rankBadge = (r) => `<span class="rankBadge">${r}</span>`;

  // show what's locked: hub tiles, dog card buttons, the dock, the decorate tabs
  const TILE_FEAT = { daily: 'daily', photo: 'photo', people: 'stories', house: 'house' };
  const CARD_FEAT = { tricks: 'tricks', treat: 'kitchen', style: 'boutique', bath: 'bath' };
  function refreshGates() {
    document.querySelectorAll('#hub .tile[data-act]').forEach((t) => {
      const f = TILE_FEAT[t.dataset.act];
      const locked = !!f && !unlockedFeat(f);
      t.classList.toggle('rlocked', locked);
      let tag = t.querySelector('.rtag');
      if (locked && !tag) { tag = document.createElement('i'); tag.className = 'rtag'; t.appendChild(tag); }
      if (tag) { tag.textContent = locked ? `Rank ${featRank(f)}` : ''; tag.classList.toggle('hidden', !locked); }
    });
    document.querySelectorAll('[data-dact]').forEach((b) => { const f = CARD_FEAT[b.dataset.dact]; b.classList.toggle('rlocked', !!f && !unlockedFeat(f)); });
    // dock buttons only show up once they do something
    document.querySelectorAll('.dock [data-act=tricks]').forEach((b) => b.classList.toggle('hidden', !unlockedFeat('tricks')));
    const lb = $('leashBtn');
    if (lb) lb.classList.toggle('hidden', !unlockedFeat('offleash'));
    document.querySelectorAll('.decoTab[data-tab=style]').forEach((b) => b.classList.toggle('rlocked', !unlockedFeat('styles')));
    renderRankRow();
  }
  // the rank bar in the menu
  function renderRankRow() {
    const el = $('rankRow');
    if (!el) return;
    const I = rankInfo(), r = rank();
    const pct = I.need ? Math.round((I.into / I.need) * 100) : 100;
    const key = `${r}|${pct}`;
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.innerHTML = `${rankBadge(r)}<span class="rkTxt"><b>${esc(rankTitle(r))}</b><small>${I.need ? `${I.into} / ${I.need} XP to rank ${r + 1}` : 'Highest rank!'}</small><span class="track"><span class="fill" style="width:${pct}%"></span></span></span>`;
  }
  function openRanks() {
    const r = rank(), I = rankInfo();
    const up = Object.entries(D.RANK_UNLOCKS).sort((a, b) => a[1].rank - b[1].rank);
    const placeRows = Object.keys(D.LOCATIONS).map((id) => [id, (reqsOf(id).find((U) => U.kind === 'rank') || {}).n]).filter(([id, n]) => n && locUnlocked(id) === false && locNext(id));
    $('rkHead').innerHTML = `${rankBadge(r)}<span class="rkTxt"><b>${esc(rankTitle(r))}</b><small>${I.need ? `${I.into} / ${I.need} XP to rank ${r + 1} · ${(state.xp || 0)} XP in total` : 'Highest rank!'}</small><span class="track"><span class="fill" style="width:${I.need ? Math.round((I.into / I.need) * 100) : 100}%"></span></span></span>`;
    const next = up.filter(([, U]) => U.rank > r);
    const done = up.filter(([, U]) => U.rank <= r);
    $('rkNext').innerHTML = next.length ? next.map(([, U]) => `<div class="row"><div class="ic">${rankBadge(U.rank)}</div><div class="txt"><b>${esc(U.name)}</b><small>${esc(U.text)}</small></div></div>`).join('') : '<p class="sub">Everything is unlocked. Ranks keep counting for bragging rights.</p>';
    $('rkPlaces').innerHTML = placeRows.length ? `<p class="sub">New places also need a certain rank. The map shows what the next ones need.</p>` : '';
    $('rkDone').innerHTML = done.map(([, U]) => `<span class="chip">${esc(U.name)}</span>`).join('');
    $('rkStars').innerHTML = Object.keys(D.LOCATIONS).filter(locUnlocked).map((id) => {
      const P = starProgress(id);
      return `<div class="row"><div class="ic">${TH('loc', id)}</div><div class="txt"><b>${esc(D.LOCATIONS[id].name)} ${starsHTML(P.s)}</b>${P.next ? `<div class="track"><div class="fill" style="width:${Math.round((P.have / P.next) * 100)}%"></div></div><small>${P.have} / ${P.next} to the next star</small>` : '<small>Mastered</small>'}</div></div>`;
    }).join('');
    $('ranks').classList.remove('hidden');
  }
  $('ranks').addEventListener('click', (e) => { if (e.target.id === 'ranks' || e.target.closest('[data-act="closeRanks"]')) $('ranks').classList.add('hidden'); });
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
    const tw = (t) => t.weight * (t.secret ? 0.4 : 1);
    let r = Math.random() * list.reduce((s, [, t]) => s + tw(t), 0);
    for (const [k, t] of list) { r -= tw(t); if (r <= 0) return k; }
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
      const group = pivot(parkRoot, x, groundAt(x, z), z);
      const toy = ART.buildToy(type);
      toy.position.y = 0.16;
      toy.scale.setScalar(1.3);
      group.add(toy);
      const sparkle = ART.scentFX();
      sparkle.position.y = 0.85;
      sparkle.scale.setScalar(0.75);
      group.add(sparkle);
      parkLoot = { type, group, toy, sparkle, t: 0 };
      return;
    }
  }
  function updateParkLoot(dt) {
    if (!parkLoot) return;
    parkLoot.t += dt;
    parkLoot.toy.rotation.y += dt * 1.5;
    parkLoot.sparkle.userData.tick(dt);
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
      news({ title: 'New toy!', text: `${t.name}. It's in your toy bag.`, th: thumbOf.toy(type) });
      save();
    }
    if (pos) spawnEmoji(t.icon, pos.clone().add(new V3(0, 1, 0)), { size: 0.6, life: 1.6, vy: 0.8 });
  }

  // =====================================================================
  // Collision + pathfinding
  // =====================================================================
  function isSolid(x, z, y) {
    if (y !== undefined && onTopLevel(x, z, y)) return !S.inside(x, z);
    if (place === 'home') {
      const i = Math.floor(x), j = Math.floor(z);
      if (!isHomeTile(i, j) || stairSolid(i, j) || wallSolidAt(x, z)) return true;
      const f = furnitureAt(i, j);
      return !!(f && D.ITEMS[f.type].solid);
    }
    if (S.inside && !S.inside(x, z)) return true;
    if (S.solid && S.solid(x, z)) return true;
    const G = colliderGrid();
    const hit = (c) => (c.r !== undefined ? (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r : x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1);
    const cell = G.map.get(Math.floor(x / 2) * 4096 + Math.floor(z / 2));
    if (cell) for (const c of cell) if (hit(c)) return true;
    for (const c of G.dyn) if (hit(c)) return true;
    return quirkSolid(x, z);
  }
  // colliders sorted into 2 x 2 buckets, so big shaped places stay quick (cows and the rover move, so they are checked on their own)
  let colGrid = null;
  function colliderGrid() {
    if (colGrid && colGrid.S === S && colGrid.n === parkColliders.length) return colGrid;
    const q = S.q || {}, dyn = new Set();
    (q.cows || []).forEach((c) => dyn.add(c.col));
    if (q.rover && q.rover.col) dyn.add(q.rover.col);
    const map = new Map();
    for (const c of parkColliders) {
      if (dyn.has(c)) continue;
      const x0 = c.r !== undefined ? c.x - c.r : c.x0, x1 = c.r !== undefined ? c.x + c.r : c.x1;
      const z0 = c.r !== undefined ? c.z - c.r : c.z0, z1 = c.r !== undefined ? c.z + c.r : c.z1;
      for (let i = Math.floor(Math.max(-200, x0) / 2); i <= Math.floor(Math.min(200, x1) / 2); i++) {
        for (let j = Math.floor(Math.max(-200, z0) / 2); j <= Math.floor(Math.min(200, z1) / 2); j++) {
          const k = i * 4096 + j;
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(c);
        }
      }
    }
    colGrid = { S, n: parkColliders.length, map, dyn: [...dyn] };
    return colGrid;
  }
  function bounds() {
    if (place === 'home') return { x0: homeBounds.x0 + 0.25, x1: homeBounds.x1 - 0.25, z0: homeBounds.z0 + 0.25, z1: homeBounds.z1 - 0.25 };
    if (S && S.bbox) return { x0: S.bbox.x0 + 0.25, x1: S.bbox.x1 - 0.25, z0: S.bbox.z0 + 0.25, z1: S.bbox.z1 - 0.25 };
    return { x0: -19.2, x1: 19.2, z0: -19.2, z1: 19.2 };
  }
  function inBounds(x, z, m = 0) {
    const b = bounds();
    if (!(x >= b.x0 + m && x <= b.x1 - m && z >= b.z0 + m && z <= b.z1 - m)) return false;
    if (place !== 'home' && S && S.inside) return S.inside(x, z) && S.inside(x + m, z) && S.inside(x - m, z) && S.inside(x, z + m) && S.inside(x, z - m);
    return true;
  }
  // ground height on walks (places with hills, steps and coves); flat everywhere else
  const terrainOn = () => place === 'park' && !!(S && S.height);
  const groundAt = (x, z) => (terrainOn() ? S.height(x, z) : 0);
  // two levels: a cove or a grotto you walk into has the hill's top right above it. ref = the height you are at now,
  // and you stand on whichever level is closer
  const layerH = (x, z, ref) => {
    const lo = S.height(x, z);
    if (!S.upper || ref === undefined) return lo;
    const up = S.upper(x, z);
    if (up - lo < 0.6) return lo;
    return Math.abs(ref - up) < Math.abs(ref - lo) ? up : lo;
  };
  const groundAtY = (x, z, ref) => (terrainOn() ? layerH(x, z, ref) : 0);
  // up on the top level, nothing from the cave below gets in the way
  const onTopLevel = (x, z, y) => terrainOn() && !!S.upper && y !== undefined && S.upper(x, z) - S.height(x, z) >= 0.6 && Math.abs(y - S.upper(x, z)) < Math.abs(y - S.height(x, z));
  const CLIMB = 0.45;
  // ----- shaped places: ground you can walk under, hidden spots, and the map you fill in as you explore -----
  let roofOver = null;
  const inRectXZ = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  function atLookout() {
    const p = player.root.position;
    return !!(S && S.lookout && inRectXZ(S.lookout, p.x, p.z) && p.y > 1);
  }
  const hiddenOf = (l) => ((state.hiddenFound || {})[l] || []);
  const hiddenTotal = (l) => Object.values(D.FINDS).filter((F) => F.loc === l && F.where && F.where.startsWith('hidden:')).length;
  function updateTerrain(dt) {
    roofOver = null;
    if (!terrainOn()) return;
    const p = player.root.position;
    // a cliff or a hill you are standing under turns see-through
    for (const r of S.roofs || []) {
      const under = p.y < 1.2 && r.test.some((t) => inRectXZ(t, p.x, p.z));
      if (under) roofOver = r.id;
      const want = under ? 0.16 : 1;
      if (r.fade === undefined) r.fade = 1;
      if (Math.abs(r.fade - want) > 0.004) {
        r.fade = lerp(r.fade, want, Math.min(1, dt * 5));
        if (Math.abs(r.fade - want) < 0.01) r.fade = want;
        // solid again: back to a normal opaque material, so nothing flickers when you are not underneath
        const see = r.fade < 0.999;
        for (const m of r.mats) { if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; } m.opacity = r.fade; m.depthWrite = !see; }
      }
    }
    // stepping into a hidden spot for the first time
    for (const sec of S.secrets || []) {
      if ((!sec.high && p.y > 1.2) || !sec.rects.some((t) => inRectXZ(t, p.x, p.z))) continue;
      const got = hiddenOf(loc);
      if (got.includes(sec.id)) continue;
      state.hiddenFound = state.hiddenFound || {};
      state.hiddenFound[loc] = [...got, sec.id];
      news({ title: 'You found a hidden spot!', text: sec.name, th: TH('loc', loc) });
      confetti(p.clone().add(new V3(0, 1.2, 0)), 6);
      sfx('find');
      gainXP(D.XP_MISC.secret || 60);
      addMastery(loc, 40);
      dogs.forEach((d) => { d.happy = Math.min(100, d.happy + 8); journalAdd(d, 'hid:' + loc + ':' + sec.id, '🔍', `Discovered ${sec.name.replace(/^The /, 'the ')} in ${LOC().name}`); });
      if (mmFog) mmFog.delete(loc);
      save();
    }
    markExplored(p.x, p.z);
  }
  // the map starts blank in shaped places and fills in where you have been (2 x 2 cells, kept in the save)
  let exploreT = 0;
  function exploreGrid() {
    const b = S.bbox;
    return { x0: b.x0, z0: b.z0, w: Math.ceil((b.x1 - b.x0) / 2), h: Math.ceil((b.z1 - b.z0) / 2) };
  }
  function exploredBits(l) {
    state.explored = state.explored || {};
    if (!Array.isArray(state.explored[l])) state.explored[l] = [];
    return state.explored[l];
  }
  function isExplored(l, G, i, j) {
    const n = j * G.w + i, a = exploredBits(l);
    return !!((a[n >> 5] >>> (n & 31)) & 1);
  }
  function markExplored(x, z, force) {
    exploreT -= 1 / 60;
    if (exploreT > 0 && !force) return;
    exploreT = 0.25;
    const G = exploreGrid(), a = exploredBits(loc), R = 7;
    let changed = false;
    for (let j = Math.max(0, Math.floor((z - R - G.z0) / 2)); j <= Math.min(G.h - 1, Math.floor((z + R - G.z0) / 2)); j++) {
      for (let i = Math.max(0, Math.floor((x - R - G.x0) / 2)); i <= Math.min(G.w - 1, Math.floor((x + R - G.x0) / 2)); i++) {
        const cx = G.x0 + i * 2 + 1, cz = G.z0 + j * 2 + 1;
        if (Math.hypot(cx - x, cz - z) > R) continue;
        const n = j * G.w + i;
        if (!((a[n >> 5] >>> (n & 31)) & 1)) { a[n >> 5] = (a[n >> 5] | (1 << (n & 31))) >>> 0; changed = true; }
      }
    }
    if (changed && mmFog) mmFog.delete(loc);
  }
  function exploredShare(l) {
    if (!S || loc !== l || !S.bbox) return 0;
    const G = exploreGrid();
    let n = 0, all = 0;
    for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) {
      if (!S.inside(G.x0 + i * 2 + 1, G.z0 + j * 2 + 1)) continue;
      all++;
      if (isExplored(l, G, i, j)) n++;
    }
    return all ? n / all : 0;
  }
  function moveWithCollision(pos, dx, dz, r, climb = CLIMB) {
    // on hilly ground you can only step up or down so far: cliffs and ledges stop you like a wall
    const terr = terrainOn(), h0 = terr ? layerH(pos.x, pos.z, pos.y) : 0, y = terr ? h0 : undefined;
    const stepOK = (x, z) => !terr || Math.abs(layerH(x, z, h0) - h0) <= climb;
    if (dx) {
      const s = Math.sign(dx);
      if (!(isSolid(pos.x + dx + s * r, pos.z, y) && !isSolid(pos.x + s * r, pos.z, y)) && stepOK(pos.x + dx + s * r, pos.z) && stepOK(pos.x + dx, pos.z)) pos.x += dx;
    }
    if (dz) {
      const s = Math.sign(dz);
      if (!(isSolid(pos.x, pos.z + dz + s * r, y) && !isSolid(pos.x, pos.z + s * r, y)) && stepOK(pos.x, pos.z + dz + s * r) && stepOK(pos.x, pos.z + dz)) pos.z += dz;
    }
    const b = bounds();
    pos.x = clamp(pos.x, b.x0, b.x1);
    pos.z = clamp(pos.z, b.z0, b.z1);
  }
  function passable(i, j) {
    if (!isHomeTile(i, j) || stairSolid(i, j)) return false;
    const f = furnitureAt(i, j);
    return !(f && D.ITEMS[f.type].solid);
  }
  function lineClear(ax, az, bx, bz, ay) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 1e-3) return true;
    const px = (-dz / d) * 0.2, pz = (dx / d) * 0.2;
    const n = Math.ceil(d / 0.2);
    let ph = groundAtY(ax, az, ay);
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = ax + dx * t, z = az + dz * t;
      const y = terrainOn() ? ph : undefined;
      if (isSolid(x, z, y) || isSolid(x + px, z + pz, y) || isSolid(x - px, z - pz, y)) return false;
      if (terrainOn()) { const h = layerH(x, z, ph); if (Math.abs(h - ph) > CLIMB) return false; ph = h; }
    }
    return true;
  }
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function findPath(from, to, climb = CLIMB) {
    const goal = new V3(to.x, 0, to.z);
    const fy = terrainOn() ? from.y : undefined;
    if (lineClear(from.x, from.z, to.x, to.z, fy)) return [goal];
    const si = Math.floor(from.x), sj = Math.floor(from.z), ti = Math.floor(to.x), tj = Math.floor(to.z);
    const key = (i, j) => i + ',' + j;
    const prev = new Map([[key(si, sj), null]]);
    const queue = [[si, sj]];
    let found = false;
    // at home: tiles and furniture; on walks: the shape of the place, things in the way, and how steep it is
    const atHome = place === 'home';
    const memo = new Map(), memoMid = new Map();
    // on two-level spots each cell keeps the height you reached it at
    const hAt = new Map();
    const two = !atHome && terrainOn() && !!S.upper;
    const cellH = (i, j) => { const v = hAt.get(i * 4096 + j); return v !== undefined ? v : groundAtY(i + 0.5, j + 0.5, fy); };
    const nextH = (i, j, ni, nj) => (terrainOn() ? layerH(ni + 0.5, nj + 0.5, cellH(i, j)) : 0);
    const lvl = (x, z, y) => (two && onTopLevel(x, z, y) ? 1 : 0);
    const midOK = (si2, sj2, y) => { const x = (si2 + 1) / 2, z = (sj2 + 1) / 2, k = (si2 * 8192 + sj2) * 2 + lvl(x, z, y); let v = memoMid.get(k); if (v === undefined) { v = !isSolid(x, z, y); memoMid.set(k, v); } return v; };
    const pass = atHome ? passable : (i, j, y) => { const k = (i * 4096 + j) * 2 + lvl(i + 0.5, j + 0.5, y); let v = memo.get(k); if (v === undefined) { v = !isSolid(i + 0.5, j + 0.5, y); memo.set(k, v); } return v; };
    const tileIn = atHome ? isHomeTile : (i, j) => !S.inside || S.inside(i + 0.5, j + 0.5);
    const climbOK = (i, j, ni, nj) => !terrainOn() || Math.abs(nextH(i, j, ni, nj) - cellH(i, j)) <= climb + 0.01;
    // at home the stairs link the tile in front of them with the landing upstairs
    const sc = atHome && home().stairs && hasUpstairs() ? stairCells(home().stairs) : null;
    for (let h = 0; h < queue.length && h < 9000; h++) {
      const [i, j] = queue[h];
      if (i === ti && j === tj) { found = true; break; }
      if (sc) {
        for (const [a, b] of [[sc.entry, sc.landing], [sc.landing, sc.entry]]) {
          if (a[0] !== i || a[1] !== j) continue;
          const k = key(b[0], b[1]);
          if (!prev.has(k) && passable(b[0], b[1])) { prev.set(k, [i, j]); queue.push([b[0], b[1]]); }
        }
      }
      for (const [di, dj] of DIRS8) {
        const ni = i + di, nj = j + dj, k = key(ni, nj);
        if (prev.has(k)) continue;
        if (atHome && (wallBlocks(i, j, ni, nj) || (di && dj && (wallBlocks(i, j, i + di, j) || wallBlocks(i, j, i, j + dj) || wallBlocks(i + di, j, ni, nj) || wallBlocks(i, j + dj, ni, nj))))) continue;
        const isGoal = ni === ti && nj === tj;
        const nh = nextH(i, j, ni, nj);
        if (isGoal ? !tileIn(ni, nj) : !pass(ni, nj, nh)) continue;
        if (!climbOK(i, j, ni, nj)) continue;
        // thin walls (an igloo, a tent) can sit between two cell centres
        if (!atHome && !isGoal && !midOK(i + ni, j + nj, nh)) continue;
        if (di && dj && (!pass(i + di, j, nextH(i, j, i + di, j)) || !pass(i, j + dj, nextH(i, j, i, j + dj)) || !climbOK(i, j, i + di, j) || !climbOK(i, j, i, j + dj))) continue;
        prev.set(k, [i, j]);
        if (two) hAt.set(ni * 4096 + nj, nh);
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
      while (j > i && !lineClear(cx, cz, pts[j].x, pts[j].z, fy)) j--;
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
    // sitting, lying back, playing: a push of the stick gets you up again (and you take the lead back from your dog)
    if (fun && (fun.still || fun.kind === 'lead') && Math.hypot(ix, iy) > 0.35) { if (fun.kind === 'lead') toast('You take the lead again 🦮'); endFun('move'); }
    if (player.pose || (fun && fun.still)) { poseTick(dt); return; }
    if (player.climb) {
      if (place !== 'home') player.climb = null;
      else {
        const went = climbStep(player, dt, 2.6);
        player.phase += went * 4.2;
        player.blend = lerp(player.blend, 1, damp(0.0005, dt));
        const s2 = Math.sin(player.phase) * 0.7 * player.blend;
        player.legL.rotation.x = s2; player.legR.rotation.x = -s2; player.armL.rotation.x = -s2 * 0.8; player.armR.rotation.x = s2 * 0.8;
        return;
      }
    }

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
      if (place === 'home' || terrainOn()) {
        // walk around furniture (or cliffs) instead of bumping into it
        if (player.pathFor !== goal) { player.path = findPath(pos, goal); player.pathFor = goal; }
        while (player.path.length > 1 && Math.hypot(player.path[0].x - pos.x, player.path[0].z - pos.z) < 0.25) player.path.shift();
        tgt = player.path[0] || goal;
        // the next step is on the other floor: take the stairs
        if (place === 'home' && floorOfX(tgt.x) !== floorOfX(pos.x)) {
          const P = stairEnd(floorOfX(pos.x));
          if (P && Math.hypot(P.x - pos.x, P.z - pos.z) < 0.45) { startClimb(player, floorOfX(pos.x) === 0); player.path = null; player.pathFor = null; return; }
          if (P) tgt = P;
        }
      }
      const d = Math.hypot(goal.x - pos.x, goal.z - pos.z);
      const dx = tgt.x - pos.x, dz = tgt.z - pos.z, dt2 = Math.hypot(dx, dz) || 1;
      if (d < 0.12) player.moveTarget = null;
      else { mx = dx / dt2; mz = dz / dt2; mag = 1; }
    }

    let moved = 0;
    if (mag > 0.05 && !player.moveTarget && playerStairPush(mx, mz)) return;
    if (mag > 0.05) {
      const ox = pos.x, oz = pos.z;
      moveWithCollision(pos, mx * 3.3 * mag * dt, mz * 3.3 * mag * dt, 0.25);
      moved = Math.hypot(pos.x - ox, pos.z - oz);
      if (moved < 0.0005 && player.moveTarget) player.moveTarget = null;
      player.face = Math.atan2(mx, mz);
    }
    player.root.rotation.y = angleLerp(player.root.rotation.y, player.face, damp(0.0002, dt));

    if (terrainOn()) { const gy = layerH(pos.x, pos.z, pos.y); pos.y += (gy - pos.y) * Math.min(1, dt * 16); }
    if (place === 'park') {
      walkDist += moved;
      walkTotal += moved;
      const step = 10 / specMult(null, 'athlete');
      while (walkDist >= step) { walkDist -= step; addCoins(1, pos); dogs.forEach((d) => addSpec(d, 'athlete', 0.2)); }
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
      this.bondDay = data.bondDay || '';
      this.bondToday = +data.bondToday || 0;
      this.bondSeen = data.bondSeen == null ? heartsOfBond(this.bond) : +data.bondSeen;
      this.badges = Array.isArray(data.badges) ? D.BADGES.map((B) => B.id).filter((id) => data.badges.includes(id)) : [];
      this.examDay = data.examDay == null ? -1 : +data.examDay;
      this.spec = D.SPECIALTIES[data.spec] ? data.spec : null;
      this.specPts = +data.specPts || 0;
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
      // the journal and little life counters (walks per place, meals, fetches, finds)
      this.journal = Array.isArray(data.journal) ? data.journal.filter((e) => e && typeof e.tx === 'string').slice(-140) : [];
      const life = data.life && typeof data.life === 'object' ? data.life : {};
      this.life = { walks: Object.assign({}, life.walks), meals: Object.assign({}, life.meals), fetches: +life.fetches || 0, finds: +life.finds || 0, songs: +life.songs || 0 };
      this.fluffUntil = +data.fluffUntil || 0;
      if (!this.journal.length && !data.npc && !String(this.id).startsWith('n:')) this.journal.push({ k: 'home', t: this.born || Date.now(), gd: Math.floor((this.born || Date.now()) / 3600000), ic: '🏠', tx: 'Came home with you' });
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
        bondDay: this.bondDay, bondToday: this.bondToday, bondSeen: this.bondSeen, badges: this.badges, examDay: this.examDay, spec: this.spec, specPts: Math.round(this.specPts),
        journal: this.journal, life: this.life, fluffUntil: this.fluffUntil > Date.now() ? this.fluffUntil : undefined,
      };
    }

    // ----- tricks & leash -----
    trickLvl(id) { return trickLevelOf(this.tricks[id] || 0); }
    obedience() { return Object.keys(ALL_TRICKS).reduce((s, id) => s + this.trickLvl(id), 0); }
    leashHand() { return player.hand; }
    onLeash() { return place === 'park' && !this.offLeash && !this.free && !this.returning && this.state !== 'fetch' && this.state !== 'return'; }

    // ----- personality -----
    mod(key) {
      let m = 1;
      this.traits.forEach((t, i) => {
        const v = D.TRAITS[t] && D.TRAITS[t].mods[key];
        if (v !== undefined) m *= i === 0 ? v : 1 + (v - 1) * 0.5;
      });
      return m;
    }
    hearts() { return heartsOfBond(this.bond); }
    hasBadge(id) { return this.badges.includes(id); }
    specLvl() { if (!this.spec) return 0; let l = 1; D.SPEC_LEVELS.forEach((t, i) => { if (this.specPts >= t) l = i + 1; }); return Math.min(l, this.hearts() >= 4 ? 3 : 2); }
    specAs(id) { return this.spec === id && unlockedFeat('specialties') ? this.specLvl() : 0; }
    needMul() { return this.hearts() >= 3 ? 0.9 : 1; }
    learnMul() { return (this.hearts() >= 4 ? 1.25 : 1) * (this.hasBadge('gold') ? 1.2 : 1); }
    flag(f) { return this.traits.some((t) => D.TRAITS[t] && D.TRAITS[t].flags.includes(f)); }
    addBond(n) {
      // bond grows a little every day: caring for a dog for many days is what builds hearts
      if (n > 0) {
        const key = clockNow.dateKey;
        if (this.bondDay !== key) { this.bondDay = key; this.bondToday = 0; }
        n = Math.min(n, D.BOND.perDay - this.bondToday);
        if (n <= 0) return;
        this.bondToday += n;
      }
      this.bond += n;
      checkHearts(this);
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
        journalAdd(this, 'grown', '🎉', 'Grew up from a puppy into a big dog');
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
    setState(s, timer = 0) {
      if (s === 'splash' && this.state !== 'splash' && this.root.visible) sfx('splash');
      this.state = s; this.timer = timer; this.stateTime = 0;
    }
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
    // pastimes: hand the dog a little script to run each frame, with a pose to show
    doAct(pose, fn, label) {
      this.releaseClaim();
      this.dropSpot();
      this.onArrive = null;
      this.zoomLeft = 0;
      if (this.state === 'sleep' || this.state === 'hide') this.wake();
      this.act = { pose, fn, label, path: null, pk: '' };
      this.setState('act');
    }
    // walk toward a point inside a script (finds the way round furniture at home); returns how far is left
    stepTo(tx, tz, speed, dt) {
      const pos = this.root.position, A = this.act || {};
      let wx = tx, wz = tz;
      if (place === 'home') {
        const k = Math.round(tx * 4) + ',' + Math.round(tz * 4);
        if (!A.path || A.pk !== k) { A.path = findPath(pos, { x: tx, z: tz }); A.pk = k; }
        while (A.path.length > 1 && Math.hypot(A.path[0].x - pos.x, A.path[0].z - pos.z) < 0.3) A.path.shift();
        if (A.path.length > 1) { wx = A.path[0].x; wz = A.path[0].z; }
      }
      const left = Math.hypot(tx - pos.x, tz - pos.z);
      if (left < 0.06) return left;
      this.moveTowards(wx, wz, Math.min(speed, left / Math.max(dt, 1e-3)), dt);
      return Math.hypot(tx - pos.x, tz - pos.z);
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
      this.root.position.y = groundAtY(this.root.position.x, this.root.position.z, this.root.position.y);
      this.onArrive = null;
      this.path = null;
      this.zoomLeft = 0;
      this.idle(0.5);
    }
    wake() {
      this.releaseClaim();
      this.root.position.y = groundAtY(this.root.position.x, this.root.position.z, this.root.position.y);
      this.idle(0.5);
    }

    // ----- needs -----
    tickNeeds(dt) {
      const W = place === 'park' ? localWeather() : curWeather();
      const pup = this.isPuppy();
      if (place === 'park') {
        const R = D.NEEDS.park, X = LOC().needs || {};
        const nm = this.needMul();
        this.hunger -= R.hunger * this.mod('hunger') * (X.hunger || 1) * nm * dt;
        this.thirst -= R.thirst * (X.thirst || 1) * nm * dt;
        this.energy -= R.energy * this.mod('energy') * this.mod('walkEnergy') * (pup ? 1.3 : 1) * (X.energy || 1) * nm * dt;
        const coat = this.acc.body && D.ACCESSORIES[this.acc.body].rainproof && W.precip ? 0.5 : 1;
        const rate = R.clean * this.mod('dirt') * (W.muddy ? D.NEEDS.rainDirt : 1) * (W.precip === 'snow' ? 1.3 : 1) * coat * dt;
        this.clean -= rate;
        const k = walkDirt();
        this.dirt[k] = (this.dirt[k] || 0) + rate;
        let joy = this.energy > CRITICAL ? R.happyGain * this.mod('walkJoy') : 0;
        if (W.precip === 'rain' && this.flag('rainJoy')) joy += 0.15;
        if (W.lightning && this.flag('stormFear')) joy -= 0.25;
        this.happy += joy * (joy > 0 ? evMult('joy') : 1) * dt;
      } else {
        const R = D.NEEDS.home;
        const nm = this.needMul();
        this.hunger -= R.hunger * this.mod('hunger') * nm * dt;
        this.thirst -= R.thirst * nm * dt;
        const cozy = (this.claim && D.ITEMS[this.claim.type] && D.ITEMS[this.claim.type].regen || 1) * (nearLitFire(this.root.position) ? 1.5 : 1);
        if (this.state === 'sleep') this.energy += R.sleepRegen * cozy * (houseTier() >= 1 ? 1.15 : 1) * dt;
        else if (this.state === 'lounge' || this.state === 'hide') this.energy += R.loungeRegen * cozy * dt;
        else this.energy -= R.energy * this.mod('energy') * (pup ? 1.4 : 1) * nm * dt;
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
        if (W.precip === 'rain' && this.flag('rainJoy') && isGardenTile(Math.floor(pos.x), Math.floor(pos.z))) decay -= 0.03;
        decay -= D.COMFORT_BONUS * (comfort.paws - 1);
        if (houseTier() >= 2) decay -= 0.02;
        if (nightLevel > 0.5 && litAt(pos.x, pos.z)) decay -= 0.02;
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

    // overall mood from the needs: great dogs find more on walks, grumpy ones ignore tricks
    mood() {
      if (this.hearts() >= 5 && (this.happy < 30 || this.hunger < CRITICAL || this.thirst < CRITICAL)) return 'good';
      if (this.happy < 30 || this.hunger < CRITICAL || this.thirst < CRITICAL) return 'grumpy';
      if (this.happy >= 80 && this.hunger >= 40 && this.thirst >= 40 && this.energy >= 30 && this.clean >= 40) return 'great';
      return 'good';
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
        case 'act': return (this.act && this.act.label) || 'Playing with you';
      }
      if (this.zoomLeft > 0) return 'Zoomies! 🌀';
      const needs = [['hunger', 'Hungry'], ['thirst', 'Thirsty'], ['energy', 'Tired'], ['clean', 'Dirty'], ['happy', 'Wants attention']]
        .filter(([k]) => this[k] < 30).sort((a, b) => this[a[0]] - this[b[0]]);
      if (needs.length) return needs[0][1];
      if (this.mood() === 'grumpy') return 'Grumpy';
      if (this.missing()) return `Misses its ${D.TOYS[this.favToy].icon}`;
      if (this.flag('lonely') && dogs.length === 1 && place === 'home') return 'A bit lonely';
      if (place === 'park') return 'Enjoying the walk';
      if (this.happy > 80) return 'Very happy';
      return 'Content';
    }

    // ----- movement -----
    // on hilly walks a dog finds its way round cliffs and up the slopes, like you do
    navPoint(tx, tz, dt) {
      const pos = this.root.position;
      const N = this.nav || (this.nav = { t: 0, path: null, tx: 0, tz: 0 });
      N.t -= dt;
      N.ct = (N.ct || 0) - dt;
      if (N.ct <= 0 || Math.hypot(N.cx - tx, N.cz - tz) > 1 || Math.hypot(N.px - pos.x, N.pz - pos.z) > 1) {
        N.clear = lineClear(pos.x, pos.z, tx, tz, pos.y); N.ct = 0.25; N.cx = tx; N.cz = tz; N.px = pos.x; N.pz = pos.z;
      }
      if (N.clear) { N.path = null; return null; }
      if (!N.path || N.t <= 0 || Math.hypot(N.tx - tx, N.tz - tz) > 1.5) {
        N.path = findPath(pos, { x: tx, z: tz }, 0.62);
        N.t = 0.7; N.tx = tx; N.tz = tz;
      }
      while (N.path.length > 1 && Math.hypot(N.path[0].x - pos.x, N.path[0].z - pos.z) < 0.35) N.path.shift();
      return N.path.length > 1 ? N.path[0] : null;
    }
    moveTowards(tx, tz, speed, dt) {
      const pos = this.root.position;
      const gx = tx, gz = tz;
      if (terrainOn()) { const w = this.navPoint(tx, tz, dt); if (w) { tx = w.x; tz = w.z; } }
      // headed for the other floor: to the stairs first, then up or down
      const hop = place === 'home' ? dogFloorHop(this, tx) : null;
      if (hop === 'climb') { this.moving = true; return Math.hypot(gx - pos.x, gz - pos.z); }
      if (hop) { tx = hop.x; tz = hop.z; }
      const dx = tx - pos.x, dz = tz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) return Math.hypot(gx - pos.x, gz - pos.z);
      const step = Math.min(d, speed * dt);
      moveWithCollision(pos, (dx / d) * step, (dz / d) * step, 0.22, 0.62);
      this.face = Math.atan2(dx, dz);
      this.moving = true;
      this.curSpeed = speed;
      return Math.hypot(gx - pos.x, gz - pos.z);
    }

    // ----- main update -----
    update(dt) {
      this.stateTime += dt;
      this.moving = false;
      this.tickNeeds(dt);
      if (this.climb) {
        if (place !== 'home') this.climb = null;
        else { climbStep(this, dt, 2.2); this.moving = true; this.curSpeed = 2.2; this.animate(dt); this.updateBubble(); return; }
      }
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
      const A = this.state === 'act' && this.act;
      if (A && A.y !== undefined) this.root.position.y += (A.y - this.root.position.y) * Math.min(1, dt * 10);
      else if (terrainOn() && this.state !== 'bath') { const gy = groundAtY(this.root.position.x, this.root.position.z, this.root.position.y); this.root.position.y += (gy - this.root.position.y) * Math.min(1, dt * 14); }
      else if (place === 'home' && this.root.position.y > 0.001 && this.state !== 'sleep' && this.state !== 'bath') this.root.position.y = Math.max(0, this.root.position.y - dt * 3);
      pastimeDogTick(this, dt);
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
        case 'act': {
          // scripted: pastimes drive the dog with a little function (false = done)
          const A = this.act;
          if (!A || A.fn(dt, this) === false) { this.act = null; this.idle(); }
          break;
        }
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
        let bed = findFurniture('bed', this, false, this.root.position);
        // never right next to a rival who's asleep already
        const rv = bed && dogs.find((o) => o !== this && o.state === 'sleep' && isRival(this, o) && flatDist(o.root.position, tileCenter(bed)) < 3);
        if (rv) {
          const far = home().furniture.filter((f) => roleOf(f) === 'bed' && !(furnRT.get(f) || {}).claim && flatDist(rv.root.position, tileCenter(f)) >= 3);
          bed = far.length ? far.sort((x, y) => flatDist(this.root.position, tileCenter(x)) - flatDist(this.root.position, tileCenter(y)))[0] : null;
          if (Math.random() < 0.3) toast(fill(pick(D.RIVAL_LINES.avoid), { a: this.name, b: rv.name }));
        }
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
      if (!visit && gardenDogIdea(this)) return;
      if (!visit && critterChaseIdea(this)) return;
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
      let tx = pp.x + Math.sin(a) * 1.5, tz = pp.z + Math.cos(a) * 1.5;
      // the spot behind you is down a ledge? then just come to you
      if (terrainOn() && (isSolid(tx, tz, pp.y) || !lineClear(pp.x, pp.z, tx, tz, pp.y))) { tx = pp.x + Math.sin(a) * 0.4; tz = pp.z + Math.cos(a) * 0.4; }
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
      if (this.offLeash || this.free || this.returning || this.state === 'fetch' || this.state === 'return') return;
      const pp = player.root.position, pos = this.root.position;
      const dx = pos.x - pp.x, dz = pos.z - pp.z, d = Math.hypot(dx, dz);
      // on hills the leash goes round corners: a dog walking the long way up the slope gets some slack
      const clear = !terrainOn() || lineClear(pp.x, pp.z, pos.x, pos.z, pp.y);
      const L = clear ? 3.2 : 7;
      if (d > L) {
        if (clear) {
          pos.x = pp.x + (dx / d) * L;
          pos.z = pp.z + (dz / d) * L;
        } else {
          // really stuck: the dog catches up at your side
          const f = player.root.rotation.y;
          pos.set(pp.x - Math.sin(f) * 0.9, pp.y, pp.z - Math.cos(f) * 0.9);
          if (isSolid(pos.x, pos.z, pp.y) || !lineClear(pp.x, pp.z, pos.x, pos.z, pp.y)) pos.set(pp.x, pp.y, pp.z);
          if (this.nav) this.nav.path = null;
        }
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
        spot.cooldown = 45 / (starsOf(loc) >= 2 ? 1.3 : 1);
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
      this.root.position.y = groundAtY(this.root.position.x, this.root.position.z, this.root.position.y);
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
        this.life.fetches++;
        journalAdd(this, 'fetch1', '🎾', 'Brought the ball back for the very first time');
        haptic();
        if (snow) addDirt(this, 'frost', 2);
        this.happy = Math.min(this.missing() ? CONFIG.MISS_CAP : 100, this.happy + joy);
        this.energy = Math.max(0, this.energy - 4);
        this.addBond(1);
        addSpec(this, 'athlete', 2);
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
      tutEvent('pet');
      sfx(Math.random() < 0.5 ? 'bark' : 'pet');
      this.happy = Math.min(this.missing() ? CONFIG.MISS_CAP : 100, this.happy + 12 * this.mod('petJoy'));
      this.addBond(1);
      treatDog = this;
      haptic();
      progress('pet');
      treatDog = null;
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
          case 'sing': SIT(); headRX = -0.85 * up + Math.sin(this.t * 7) * 0.12 * up; break;
          case 'dance': hop = Math.abs(Math.sin(this.t * 9)) * 0.22; legT = [Math.sin(this.t * 9) * 0.9, -Math.sin(this.t * 9) * 0.9, 0, 0]; bodyRX = -0.35; posed = true; break;
          default: break;
        }
      }
      if (st === 'act' && this.act) {
        const P = this.act.pose;
        const SIT = () => { poseY = -0.06; bodyRX = -0.5; legT = [0.5, 0.5, -1.1, -1.1]; headRX = 0.3; posed = true; };
        const LIE = () => { poseY = -0.21; legT = [-1.45, -1.45, 1.45, 1.45]; headRX = 0.15; headY = hb - 0.06; posed = true; };
        switch (P) {
          case 'sit': SIT(); break;
          case 'lie': case 'nap': LIE(); break;
          case 'crouch': LIE(); headRX = 0.35; break;
          case 'cover': SIT(); headRX = 0.95; legT = [-1.6, -1.6, -1.1, -1.1]; bodyRX = -0.75; break;
          case 'knee': SIT(); headRX = 0.65; headY = hb - 0.04; break;
          case 'beg': poseY = -0.04; bodyRX = -1.05; legT = [-1.4, -1.4, -1.3, -1.3]; headRX = 0.2; posed = true; break;
          case 'howl': SIT(); headRX = -0.9 + Math.sin(this.t * 6) * 0.1; break;
          case 'tilt': SIT(); bodyRZ = Math.sin(this.t * 1.6) * 0.18; break;
          case 'sniff': headRX = 0.6 + Math.sin(this.t * 22) * 0.06; break;
          case 'dig': headRX = 0.55; bodyRX = 0.2; legT = [Math.sin(this.t * 24) * 1.1, -Math.sin(this.t * 24) * 1.1, 0, 0]; posed = true; break;
          case 'hop': hop = Math.abs(Math.sin(this.t * 9)) * 0.2; headRX = -0.25; break;
          case 'dance': hop = Math.abs(Math.sin(this.t * 9)) * 0.22; legT = [Math.sin(this.t * 9) * 0.9, -Math.sin(this.t * 9) * 0.9, 0, 0]; bodyRX = -0.35; posed = true; break;
          case 'shake': bodyRZ = Math.sin(this.t * 42) * 0.32; break;
          case 'jump': hop = this.act.hop || 0; bodyRX = this.act.tilt || 0; legT = [-0.8, -0.8, 0.8, 0.8]; posed = true; break;
          case 'hide': LIE(); bodyRZ = Math.sin(this.t * 40) * 0.03; break;
          default: break;
        }
      }
      if (this.tumbleT > 0) bodyRZ = Math.sin((0.7 - this.tumbleT) / 0.7 * Math.PI) * 1.3;

      this.poseY = lerp(this.poseY, poseY, k);
      if (place === 'park' && LOC().lowGravity) hop += Math.abs(Math.sin(this.phase * 0.5)) * 0.3 * this.walkBlend; // bouncy moon steps
      this.body.position.y = this.poseY + Math.abs(Math.sin(this.phase)) * 0.05 * this.walkBlend + hop;
      this.body.rotation.x = lerp(this.body.rotation.x, bodyRX, k);
      const snapZ = this.tumbleT > 0 || ['towel', 'hide', 'confused', 'scuffle'].includes(st) || (st === 'trick' && ['shake', 'roll', 'dead'].includes(this.trickId)) || (st === 'act' && this.act && ['shake', 'hide', 'tilt'].includes(this.act.pose));
      this.body.rotation.z = snapZ ? bodyRZ : lerp(this.body.rotation.z, 0, k * 2);
      this.legs.forEach((l, i) => { l.rotation.x = posed ? lerp(l.rotation.x, legT[i], k * (st === 'dig' ? 4 : 1)) : lerp(l.rotation.x, legT[i], 0.5); });
      this.head.rotation.x = lerp(this.head.rotation.x, headRX, k * 1.5);
      this.head.position.y = lerp(this.head.position.y, headY, k);

      const resting = st === 'sleep' || st === 'hide' || (st === 'act' && this.act && (this.act.pose === 'nap' || this.act.pose === 'hide'));
      const wag = resting ? 1 : 5 + (this.happy / 100) * 14 + (st === 'happy' ? 8 : 0) + (st === 'act' && this.act && this.act.wag ? 14 : 0);
      this.tail.rotation[this.wagAxis] = Math.sin(this.t * wag) * (resting ? 0.1 : 0.55);
      this.tail.rotation.x = lerp(this.tail.rotation.x, this.happy < LOW || st === 'hide' || (st === 'act' && this.act && this.act.pose === 'hide') ? this.tailDown : this.tailUp, k);
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
      if (terrainOn() && Math.abs(groundAt(s.pos.x, s.pos.z) - groundAt(pos.x, pos.z)) > 0.6) continue;
      const d = flatDist(pos, s.pos);
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
    if (n > 0) n *= Math.max(a.npc ? 1 : specMult(a, 'charmer'), b.npc ? 1 : specMult(b, 'charmer'));
    const k = pairKey(a.id, b.id);
    const before = state.friends[k] || 0;
    const v = clamp(before + n, 0, 100);
    state.friends[k] = Math.round(v * 10) / 10;
    if (before < D.FRIEND_LEVEL && v >= D.FRIEND_LEVEL) {
      toast(`💕 ${a.name} and ${b.name} are friends now!`);
      if (!a.npc) journalAdd(a, 'friend:' + b.id, '💕', `Became friends with ${b.name}`);
      if (!b.npc) journalAdd(b, 'friend:' + a.id, '💕', `Became friends with ${a.name}`);
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
    if (kind !== 'scuffle') mine.forEach((d) => addSpec(d, 'charmer', 4));
    if (kind === 'play' && mine.length === 1) { const npc = [a, b].find((d) => d.npc); if (npc) setTimeout(() => storyPlay(npc), 1200); }
    if (kind === 'play') addRivalry(a, b, -D.RIVAL.play);
    if (kind === 'scuffle') addRivalry(a, b, D.RIVAL.scuffle);
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
      const pack = sitDog ? dogs.concat(sitDog) : dogs;
      for (let i = 0; i < pack.length; i++) {
        for (let j = i + 1; j < pack.length; j++) {
          const a = pack[i], b = pack[j];
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
      // their owner sat down on a bench with you: lie down at their feet
      const V = this.walker.visit;
      if (V && V.phase === 'sit') {
        const sp = V.front;
        if (Math.hypot(sp.x - this.root.position.x, sp.z - this.root.position.z) > 0.4) { this.setState('follow'); this.moveTowards(sp.x, sp.z, 1.6, dt); }
        else if (this.state !== 'lounge') { this.setState('lounge', 999); this.face = V.face; }
        return;
      }
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
    if (talk) endTalk(false);
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
    // neighbors with a story to tell are more likely to be out, and always where they asked to meet you
    const order = shuffle(D.NEIGHBORS);
    const want = order.filter((N) => storyReady(N.owner) && (() => { const C = storyOf(N.owner) && storyChapter(N.owner); return !C || C.task.kind !== 'at' || C.task.loc === loc; })());
    const must = want.find((N) => { const C = storyOf(N.owner) && storyChapter(N.owner); return C && C.task.kind === 'at' && C.task.loc === loc; });
    const lead = must || (want.length && Math.random() < 0.75 ? pick(want) : null);
    if (lead) { order.splice(order.indexOf(lead), 1); order.unshift(lead); }
    // a neighbor who invited you here is always out
    const meet = meetupLive(), mo = meet && meet.loc === loc ? order.find((N) => N.owner === meet.owner) : null;
    if (mo) { order.splice(order.indexOf(mo), 1); order.unshift(mo); }
    for (const info of order.slice(0, Math.max(count, lead ? 1 : 0) + (mo ? 1 : 0))) {
      const parts = ART.buildPlayer({ shirt: info.shirt, hair: info.hair });
      parkRoot.add(parts.root);
      const w = { info, parts, t: rand(0, loopLength()), dir: pick([1, -1]), speed: rand(0.9, 1.3), pause: 0, met: false, phase: 0 };
      w.label = textSprite(info.owner, 0.3);
      w.label.position.y = 2.15;
      w.label.visible = false;
      parts.root.add(w.label);
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
      const near = flatDist(pos, pp);
      // neighbors stop whenever you stand next to them (and all through a chat), and turn to face you
      const facing = !w.visit && (w.talking || near < 2.4);
      if (facing) {
        w.pause = Math.max(w.pause, w.talking ? 999 : 1.4);
        w.parts.root.rotation.y = angleLerp(w.parts.root.rotation.y, Math.atan2(pp.x - pos.x, pp.z - pos.z), damp(0.0005, dt));
      }
      if (w.visit) moved = benchWalker(w, dt);
      else if (w.talking || w.waiting) { /* stays put while you chat, or while your dog looks for their things */ }
      else if (w.pause > 0) w.pause -= dt;
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
      benchPose(w);
      if (!w.met && pos.distanceTo(pp) < 2.2) { w.met = true; if (!storyMeet(w)) neighborGift(w); }
      w.label.visible = pos.distanceTo(pp) < 9;
      // neighbors slow down for a moment when they pass you, so you can say hi
      if (terrainOn()) pos.y = layerH(pos.x, pos.z, pos.y);
      w.dog.update(dt);
      w.dog.updateLeash();
    }
  }
  function neighborGift(w) {
    const friends = dogs.some((d) => friendship(d.id, w.dog.id) >= D.FRIEND_LEVEL);
    if (Math.random() > D.GIFT_CHANCE * [1, 1, 1.3, 1.6][packSpec('charmer')] + (friends ? D.GIFT_FRIEND_BONUS : 0)) return;
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
      const opts = Object.keys(D.FINDS).filter((k) => !D.FINDS[k].secret && D.FINDS[k].weight > 0 && D.LOCATIONS[D.FINDS[k].loc]);
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
      else { state.accessories.push(key); toast(`🎁 ${who} gave you a ${D.ACCESSORIES[key].icon} ${D.ACCESSORIES[key].name} from the ${V.name}! Try it on: dog bubble → Style`); }
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
      const options = [...Object.keys(D.WALLS), ...Object.keys(D.FLOORS)].filter((id) => !state.styles.includes(id) && !(D.WALLS[id] || D.FLOORS[id]).earned);
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
    if (!needRank('offleash')) return;
    const ok = dogs.filter((d) => d.trickLvl('come') >= CONFIG.OFFLEASH_COME_LEVEL);
    if (!ok.length) {
      toast(`Teach Come to level ${CONFIG.OFFLEASH_COME_LEVEL} in Trick Mode first`);
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
      if (d.hasBadge('gold') || Math.random() < D.RECALL[lvl]) {
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
    endFun('switch');
    d = d || selected || dogs[0];
    if (!d || mode !== 'normal') return;
    if (!needRank('tricks')) return;
    setTimeout(() => tip('trickmode', { title: 'Trick Mode', text: 'Draw gestures anywhere: swipe, tap, hold or circle. The book (top right) lists every trick and its gesture. Each try uses a little focus.', icon: 'cap' }), 600);
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
    if (tm.exam && !tm.exam.done) { examEnd(false, true); toast('Exam called off. You can try again tomorrow.'); }
    $('trickMode').classList.remove('exam');
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
    if (tm.exam && !tm.exam.done) examEnd(false, true);
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
    if (d.hasBadge('silver')) drain *= 0.8;
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
    const night = isNight();
    let id = null;
    for (const [k, T] of Object.entries(ALL_TRICKS)) {
      if (T.seq !== seq) continue;
      if (T.secret && ((T.night && !night) || (T.rhythm && !evenRhythm(taps)) || !reqMet(d, T.req))) continue;
      if (T.music && !(d.tricks[k] > 0)) continue;
      id = k;
      break;
    }
    if (!id) { confuse(d, TF.unknown); toast(`🤔 ${d.name} doesn't know what you mean`); examTry(null, null); return; }
    const T = ALL_TRICKS[id];
    const missing = (T.needs || []).filter((n) => d.trickLvl(n) < 1);
    if (missing.length) {
      confuse(d, TF.unknown);
      toast(`${d.name} needs to learn ${missing.map((n) => `${ALL_TRICKS[n].icon} ${ALL_TRICKS[n].name}`).join(' and ')} first`);
      examTry(null, null);
      return;
    }
    const lvl = d.trickLvl(id);
    const md = d.mood();
    if (md === 'grumpy' && Math.random() < 0.35) {
      confuse(d, TF.fail);
      toast(`${d.name} is grumpy and ignores you. Some food, water or play might help.`);
      tip('grumpy', { title: 'A grumpy dog', text: 'Hungry, thirsty or bored dogs get grumpy and sometimes ignore tricks. Look after their needs and they’ll cheer up.', icon: 'heart' });
      examTry(null, null);
      return;
    }
    let p = D.TRICK_SUCCESS[lvl] * (0.7 + 0.3 * clamp(tm.focus, 0, 100) / 100);
    if (md === 'grumpy') p *= 0.6;
    if (md === 'great') p += 0.08;
    if (d.isPuppy()) p *= 0.8;
    if (d.energy < 25) p *= 0.8;
    if (d.flag('quick')) p += 0.08;
    if (d.flag('stormFear')) p += place === 'home' ? 0.05 : -0.08;
    if (d.hasBadge('bronze')) p += 0.05;
    p += [0, 0.03, 0.06, 0.1][d.specAs('performer')];
    // training bones from the oven: a few easier tries
    if (d.trainBoost > 0) { p += 0.12; d.trainBoost--; }
    p = clamp(p, 0.05, 0.99);
    if (Math.random() < p) { performTrick(d, id); examTry(id, id); return; }
    if (lvl === 0) d.tricks[id] = (d.tricks[id] || 0) + 0.35;
    confuse(d, TF.fail);
    toast(lvl === 0 ? `${d.name} is trying to figure out ${T.secret ? 'what you want' : T.name}… keep practicing!` : `${d.name} almost got it — try again!`);
    if (tm.exam) { examTry(null, id); return; }
    if (Math.random() < D.TRICK_SNAP[lvl] * (d.isPuppy() ? 1.6 : 1)) setTimeout(() => { if (tm && tm.dog === d) snapOut(); }, 700);
  }
  function confuse(d, cost) {
    sfx('fail');
    d.setState('confused', 1.1);
    tm.focus -= cost;
    spawnEmoji('❓', d.headWorld(0.4), { size: 0.4, life: 1 });
  }
  function performTrick(d, id) {
    const T = ALL_TRICKS[id];
    const before = d.trickLvl(id);
    d.tricks[id] = (d.tricks[id] || 0) + (d.flag('quick') ? 1.5 : 1) * d.learnMul();
    const after = d.trickLvl(id);
    addSpec(d, 'performer', 2);
    d.trickId = id;
    d.trickFace = d.root.rotation.y;
    d.setState('trick', T.dur);
    d.happy = Math.min(100, d.happy + 3);
    d.energy = Math.max(0, d.energy - 1.2);
    d.addBond(1);
    tm.focus = Math.min(100, tm.focus + TF.success);
    const head = d.headWorld(0.45);
    const fx = { speak: '💬', shake: '💦', howl: '🌕', dance: '🎶', chase: '🌀', dead: '💫', sing: '🎵' }[id];
    if (fx) spawnEmoji(fx, head, { size: 0.45, life: 1.4 });
    if (id === 'sing') { sfx('howl'); setTimeout(() => spawnEmoji('🎶', d.headWorld(0.5), { size: 0.4 }), 500); }
    if (after >= 1 && !state.learned.includes(id)) state.learned.push(id);
    if (after > before) journalAdd(d, after === 1 ? 'trick:' + id : null, T.icon, after === 1 ? `Learned a new trick: ${T.name}` : `Got better at ${T.name} (level ${after})`);
    haptic();
    progress('trick');
    progress('trick:' + id);
    sfx('trick');
    const show = place === 'park' && eventOn('show');
    if (show && state.event.n < show.max) { state.event.n++; addCoins(show.coins, d.root.position); if (state.event.n >= show.max) eventDone(); }
    if (T.secret && !state.secrets.includes(id)) {
      state.secrets.push(id);
      news({ title: 'Secret trick discovered!', text: `${d.name} can do ${T.name}.`, th: thumbOf.pic(T.icon) });
      confetti(head);
    } else if (after > before) {
      gainXP(D.XP_MISC.trickLevel);
      if (after === 1) news({ title: 'New trick learned', text: `${d.name} learned ${T.name}!`, th: thumbOf.pic(T.icon) });
      else toast(`${T.name} is now ${D.TRICK_LEVELS[after]} (Lv ${after})`);
      if (after === 5) confetti(head);
      else spawnEmoji('⭐', head, { size: 0.45 });
      if (d.ui) refreshCardStatic(d);
    } else spawnEmoji('👏', head, { size: 0.4 });
    if (place === 'park' && loc === 'caves' && id === 'speak') setTimeout(() => doEcho(d), 600);
    if (place === 'park') storyTrick(d, id);
    if (place === 'park' && loc === 'carnival') carnivalTrick(d, id, after);
    else if (place === 'park' && loc === 'oldtown' && inPlaza(player.root.position)) plazaPerformance(d, after);
    else if (place === 'park' && after >= 3) {
      const fan = walkers.find((w) => w.parts.root.position.distanceTo(d.root.position) < 5);
      if (fan && Math.random() < 0.3) setTimeout(() => { addCoins(Math.round((1 + Math.floor(Math.random() * 3)) * showMult(d)), fan.parts.root.position); toast(`👏 ${fan.info.owner} loved that trick!`); }, 900);
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
      } else if (T.music && !lvl) {
        r.innerHTML = `<div class="ic">${TH('pic', T.icon)}</div><div class="txt"><b></b><small>Dogs who howl along to your music learn this one</small></div>`;
        r.querySelector('b').textContent = T.name;
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

  // =====================================================================
  // Bond hearts, specialties and training exams (one dog at a time)
  // =====================================================================
  function heartsOfBond(b) {
    let h = 0;
    D.BOND.hearts.forEach((t, i) => { if (b >= t) h = i; });
    return h;
  }
  const heartsHTML = (n) => `<span class="hearts">${'♥'.repeat(n)}<span class="off">${'♥'.repeat(5 - n)}</span></span>`;
  function checkHearts(d) {
    if (d.npc || !dogs.includes(d)) return;
    const h = d.hearts();
    if (h <= d.bondSeen) return;
    for (let k = d.bondSeen + 1; k <= h; k++) {
      sfx('unlock');
      news({ title: `${d.name}: ${D.BOND.names[k]}`, text: k === 2 && !unlockedFeat('specialties') ? `${D.BOND.perks[k]} once you reach Trainer rank ${featRank('specialties')}.` : D.BOND.perks[k] + '.', th: `<span class="heartBadge">${k}</span>` });
      if (k === 1) state.coins += 30;
      gainXP(D.BOND.xp[k]);
      journalAdd(d, 'heart' + k, '💕', `Became ${D.BOND.names[k]} with you`);
      try { spawnEmoji('💕', d.headWorld(0.5), { size: 0.5, life: 1.6 }); } catch (_) { /* fine */ }
    }
    d.bondSeen = h;
    if (h >= 2 && unlockedFeat('specialties') && !d.spec) setTimeout(() => tip('specPick', { title: 'Pick a specialty', text: `${d.name} trusts you enough to get really good at something. Open their bubble and tap the hearts.`, icon: 'heart' }), 2500);
    if (d.ui) refreshCardStatic(d);
    save();
  }
  // the strongest specialty among the dogs on this walk / at home
  const packSpec = (id) => Math.max(0, ...dogs.map((d) => d.specAs(id)));
  const SPEC_MULT = {
    sniffer: [1, 1.25, 1.5, 1.8], forager: [1, 1.3, 1.6, 2], athlete: [1, 1.15, 1.3, 1.5], performer: [1, 1.25, 1.5, 2], charmer: [1, 1.3, 1.6, 2],
  };
  const specMult = (d, id) => SPEC_MULT[id][d ? d.specAs(id) : packSpec(id)];
  function addSpec(d, id, n) {
    if (!d || d.npc || visit || d.spec !== id || !unlockedFeat('specialties')) return;
    const before = d.specLvl();
    d.specPts += n;
    const after = d.specLvl();
    if (after > before) {
      const S = D.SPECIALTIES[id];
      sfx('unlock');
      news({ title: `${d.name}: ${S.name} level ${after}`, text: S.lv[after - 1] + '.', th: IC(S.icon) });
      gainXP(40 * after);
      if (d.ui) refreshCardStatic(d);
    } else if (before === 2 && d.hearts() < 4 && d.specPts >= D.SPEC_LEVELS[2] && !d.specCapTold) {
      d.specCapTold = true;
      toast(`${d.name} is ready for ${D.SPECIALTIES[id].name} level 3, once you two are Best friends`);
    }
  }
  // show-off coins: the best performer and any show dog in the pack
  const showMult = (d) => specMult(d, 'performer') * (d && d.hasBadge('platinum') ? 1.5 : 1);

  // ----- badges -----
  const SECRET_IDS = Object.keys(ALL_TRICKS).filter((id) => ALL_TRICKS[id].secret);
  function badgeRows(d, B) {
    const R = B.req, rows = [];
    for (const [id, l] of Object.entries(R.must || {})) rows.push({ text: `${ALL_TRICKS[id].name} at ${D.TRICK_LEVELS[l]}`, have: Math.min(d.trickLvl(id), l), need: l });
    if (R.count) {
      const n = BASIC_TRICKS.filter((id) => d.trickLvl(id) >= R.lvl).length;
      rows.push({ text: R.count >= BASIC_TRICKS.length ? `Every trick at ${D.TRICK_LEVELS[R.lvl]}` : `${R.count} tricks at ${D.TRICK_LEVELS[R.lvl]} or better`, have: Math.min(n, R.count), need: R.count });
    }
    if (R.secrets) {
      const n = SECRET_IDS.filter((id) => d.trickLvl(id) >= 1).length;
      rows.push({ text: `Knows ${R.secrets} secret trick${R.secrets > 1 ? 's' : ''}`, have: Math.min(n, R.secrets), need: R.secrets });
    }
    rows.forEach((r) => { r.ok = r.have >= r.need; });
    return rows;
  }
  const nextBadge = (d) => D.BADGES.find((B) => !d.hasBadge(B.id));
  function examBlock(d, B) {
    if (rank() < B.rank) return `Opens at Trainer rank ${B.rank}`;
    if (!badgeRows(d, B).every((r) => r.ok)) return 'Train the tricks above first';
    if (d.examDay === clockNow.gameDay) return 'The examiner is back tomorrow';
    if (d.isPuppy()) return 'Puppies can’t take exams yet';
    if (state.coins < B.fee) return `The exam costs ${B.fee} coins`;
    return '';
  }
  function startExam(d, id) {
    const B = D.BADGES.find((x) => x.id === id);
    if (!B || !needRank('exams') || d.hasBadge(id) || nextBadge(d) !== B) return;
    const why = examBlock(d, B);
    if (why) { toast(why); return; }
    hideSheet('dogSheet');
    if (mode !== 'normal') { toast('Finish what you’re doing first'); return; }
    enterTrickMode(d);
    if (!tm || tm.dog !== d) return;
    state.coins -= B.fee;
    updateHud();
    // the examiner's list: tricks the dog knows, the badge's own ones more often, never the same twice in a row
    const known = BASIC_TRICKS.filter((t) => d.trickLvl(t) >= 1);
    const must = Object.keys(B.req.must || {});
    const asks = [];
    for (let i = 0; i < B.asks; i++) {
      let t;
      do { t = must.length && Math.random() < 0.5 ? pick(must) : pick(known); } while (known.length > 1 && t === asks[asks.length - 1]);
      asks.push(t);
    }
    tm.exam = { id, asks, i: 0, ok: 0, miss: 0, allowed: B.asks - B.need, done: false };
    tm.focus = 100;
    $('trickMode').classList.add('exam');
    examShow();
    sfx('tip');
  }
  function examShow() {
    const E = tm && tm.exam;
    if (!E || E.done || E.i >= E.asks.length) return;
    const B = D.BADGES.find((x) => x.id === E.id), T = ALL_TRICKS[E.asks[E.i]];
    $('tmHint').innerHTML = `<span class="exHead">${esc(B.name)} exam · ${E.i + 1} of ${E.asks.length}</span><span class="exAsk">${TH('pic', T.icon)}<b>${esc(T.name)}</b></span><span class="exMiss">${E.allowed ? `Misses ${E.miss} of ${E.allowed} allowed` : 'No misses allowed'}</span>`;
  }
  // a try during an exam: right trick done well, or a miss
  function examTry(okId, triedId) {
    const E = tm && tm.exam;
    if (!E || E.done) return;
    const want = E.asks[E.i];
    if (okId && okId === want) { E.ok++; E.i++; spawnEmoji('✅', tm.dog.headWorld(0.6), { size: 0.4 }); }
    else { E.miss++; E.i++; }
    if (E.miss > E.allowed) { examEnd(false); return; }
    if (E.i >= E.asks.length) { examEnd(true); return; }
    if (triedId && triedId !== want) setTimeout(() => toast(`That was ${ALL_TRICKS[triedId].name}. The examiner asked for ${ALL_TRICKS[want].name}.`), 300);
    setTimeout(examShow, 500);
  }
  function examEnd(pass, quiet) {
    const E = tm && tm.exam;
    if (!E || E.done) return;
    E.done = true;
    const d = tm.dog, B = D.BADGES.find((x) => x.id === E.id);
    $('trickMode').classList.remove('exam');
    if (pass) {
      d.badges.push(B.id);
      journalAdd(d, 'badge:' + B.id, '🏅', `Passed the ${B.name} exam`);
      state.coins += B.coins;
      gainXP(B.xp);
      sfx('unlock');
      try { confetti(d.root.position.clone().add(new V3(0, 1.2, 0)), 10); } catch (_) { /* fine */ }
      news({ title: `${d.name} passed: ${B.name}!`, text: `${B.perk}. Prize: ${B.coins} coins.`, th: `<span class="medal ${B.id}">${IC('star')}</span>` });
      $('tmHint').textContent = `${B.name} badge earned!`;
    } else {
      d.examDay = clockNow.gameDay;
      if (!quiet) toast(`${d.name} didn’t pass this time. Keep practicing and try again tomorrow.`);
      $('tmHint').textContent = 'Exam over';
    }
    if (d.ui) refreshCardStatic(d);
    updateHud();
    save();
    setTimeout(() => { if (tm && tm.exam === E) { tm.exam = null; if (pass) exitTrickMode(); } }, 1600);
  }

  // ----- the dog sheet: hearts, specialty, badges -----
  let sheetDog = null;
  function openDogSheet(d) {
    sheetDog = d;
    renderDogSheet();
    $('dogSheet').classList.remove('hidden');
  }
  function hideSheet(id) { $(id).classList.add('hidden'); }
  function renderDogSheet() {
    const d = sheetDog;
    if (!d) return;
    $('dsName').textContent = d.name;
    const h = d.hearts(), H = D.BOND.hearts;
    const into = h >= 5 ? 1 : (d.bond - H[h]) / (H[h + 1] - H[h]);
    const today = d.bondDay === clockNow.dateKey ? d.bondToday : 0;
    $('dsBond').innerHTML = `<div class="bondHead">${heartsHTML(h)}<b>${esc(D.BOND.names[h])}</b></div>` +
      (h < 5 ? `<div class="track"><div class="fill" style="width:${Math.round(into * 100)}%"></div></div><small class="sub">${Math.floor(d.bond - H[h])} / ${H[h + 1] - H[h]} to ${esc(D.BOND.names[h + 1])}${today >= D.BOND.perDay ? ' · that’s enough bonding for today' : ''}</small>` : '<small class="sub">As close as can be.</small>') +
      D.BOND.names.slice(1).map((nm, i) => `<div class="req${h > i ? ' done' : ''}">${IC(h > i ? 'check' : 'heart')}<div><small class="note"><b>${esc(nm)}</b> · ${esc(D.BOND.perks[i + 1])}</small></div></div>`).join('');
    // specialty
    let sp = '';
    if (!unlockedFeat('specialties')) sp = `<p class="sub">Specialties open at Trainer rank ${featRank('specialties')}.</p>`;
    else if (!d.spec && h < 2) sp = `<p class="sub">When you two are Buddies (2 hearts), ${esc(d.name)} can pick something to be great at.</p>`;
    else if (!d.spec || d.specPicking) {
      sp = `<p class="sub">Pick one. ${esc(d.name)} gets better at it by doing it.</p><div class="specGrid">` + Object.entries(D.SPECIALTIES).map(([id, S]) =>
        `<button class="specOpt${d.spec === id ? ' sel' : ''}" data-spec="${id}">${IC(S.icon)}<b>${esc(S.name)}</b><small>${esc(S.desc)}</small></button>`).join('') + '</div>' +
        (d.spec ? `<button class="ghost" data-act="specCancel">Keep ${esc(D.SPECIALTIES[d.spec].name)}</button>` : '');
    } else {
      const S = D.SPECIALTIES[d.spec], l = d.specLvl();
      const nextAt = D.SPEC_LEVELS[l];
      const capped = l === 2 && h < 4;
      sp = `<div class="row"><div class="ic">${IC(S.icon)}</div><div class="txt"><b>${esc(S.name)} · level ${l}</b><small>${esc(S.lv[l - 1])}</small>` +
        (l < 3 ? `<div class="track"><div class="fill" style="width:${Math.round(Math.min(1, (d.specPts - D.SPEC_LEVELS[l - 1]) / (nextAt - D.SPEC_LEVELS[l - 1])) * 100)}%"></div></div><small>${capped && d.specPts >= nextAt ? 'Level 3 needs Best friends (4 hearts)' : `${esc(S.grows)} · ${Math.floor(d.specPts)} / ${nextAt}`}</small>` : '<small>Top level</small>') +
        `</div></div><button class="ghost" data-act="specChange">Switch specialty (${D.SPEC_CHANGE} coins, starts over)</button>`;
    }
    $('dsSpec').innerHTML = sp;
    // badges
    let bg = '';
    if (!unlockedFeat('exams')) bg = `<p class="sub">Training exams open at Trainer rank ${featRank('exams')}.</p>`;
    else {
      const nb = nextBadge(d);
      bg = D.BADGES.map((B) => {
        const got = d.hasBadge(B.id);
        const head = `<span class="medal ${B.id}${got ? '' : ' off'}">${IC('star')}</span>`;
        if (got) return `<div class="row badgeRow got"><div class="ic">${head}</div><div class="txt"><b>${esc(B.name)}</b><small>${esc(B.perk)}</small></div></div>`;
        if (B !== nb) return `<div class="row badgeRow later"><div class="ic">${head}</div><div class="txt"><b>${esc(B.name)}</b><small>${rank() < B.rank ? `Rank ${B.rank}` : 'After the badge before it'} · ${esc(B.perk)}</small></div></div>`;
        const rows = badgeRows(d, B).map((r) => `<div class="req${r.ok ? ' done' : ''}">${IC(r.ok ? 'check' : 'dot')}<div><small class="note">${esc(r.text)}</small>${r.need > 1 ? `<div class="track"><div class="fill" style="width:${Math.round((r.have / r.need) * 100)}%"></div></div><small class="prog">${r.have} of ${r.need}</small>` : ''}</div></div>`).join('');
        const why = examBlock(d, B);
        return `<div class="row badgeRow next"><div class="ic">${head}</div><div class="txt"><b>${esc(B.name)}</b><small>${esc(B.perk)}</small>${rows}<small class="exInfo">${B.asks} tricks, ${B.asks - B.need ? `up to ${B.asks - B.need} miss${B.asks - B.need > 1 ? 'es' : ''}` : 'no misses'} · fee ${B.fee} coins · prize ${B.coins} coins</small>` +
          `<button class="primary small" data-exam="${B.id}"${why ? ' disabled' : ''}>${why ? esc(why) : 'Take the exam'}</button></div></div>`;
      }).join('');
    }
    $('dsBadges').innerHTML = bg;
  }
  $('dogSheet').addEventListener('click', (e) => {
    const d = sheetDog;
    if (e.target.id === 'dogSheet' || e.target.closest('[data-act="closeDogSheet"]')) { if (d) d.specPicking = false; hideSheet('dogSheet'); return; }
    if (!d) return;
    const so = e.target.closest('[data-spec]');
    if (so) {
      const id = so.dataset.spec;
      if (d.spec && d.spec !== id) {
        if (state.coins < D.SPEC_CHANGE) { toast(`Switching costs ${D.SPEC_CHANGE} coins`); return; }
        state.coins -= D.SPEC_CHANGE;
        updateHud();
      }
      if (d.spec !== id) { d.spec = id; d.specPts = 0; d.specCapTold = false; news({ title: `${d.name} is a ${D.SPECIALTIES[id].name}`, text: D.SPECIALTIES[id].desc + '.', th: IC(D.SPECIALTIES[id].icon) }); sfx('unlock'); }
      d.specPicking = false;
      if (d.ui) refreshCardStatic(d);
      save();
      renderDogSheet();
      return;
    }
    if (e.target.closest('[data-act="specChange"]')) { d.specPicking = true; renderDogSheet(); return; }
    if (e.target.closest('[data-act="specCancel"]')) { d.specPicking = false; renderDogSheet(); return; }
    const ex = e.target.closest('[data-exam]');
    if (ex && !ex.disabled) startExam(d, ex.dataset.exam);
  });
  // one line on the dog card: hearts, specialty and badges
  function bondLine(d) {
    const B = [...d.badges].reverse().find(Boolean);
    const bits = [`${heartsHTML(d.hearts())}<span>${esc(D.BOND.names[d.hearts()])}</span>`];
    if (d.spec && unlockedFeat('specialties')) bits.push(`<span>${esc(D.SPECIALTIES[d.spec].name)} ${d.specLvl()}</span>`);
    else if (!d.spec && d.hearts() >= 2 && unlockedFeat('specialties')) bits.push('<span class="new">Pick a specialty</span>');
    if (B) bits.push(`<span class="medal ${B}">${IC('star')}</span>`);
    return bits.join('');
  }

  // =====================================================================
  // Home tiers: from a cozy flat to a dream estate
  // =====================================================================
  const houseTier = () => clamp(state.houseTier || 0, 0, D.HOUSE_TIERS.length - 1);
  const roomCap = () => Math.min(CONFIG.MAX_CHUNKS, D.HOUSE_TIERS[houseTier()].rooms);
  const luxuryCount = () => state.furniture.filter((f) => D.ITEMS[f.type] && D.ITEMS[f.type].cat === 'luxury').length;
  function houseRows(T) {
    const R = T.req || {}, rows = [];
    const add = (text, have, need) => rows.push({ text, have: Math.min(have, need), need, ok: have >= need });
    if (R.rooms) add(`${R.rooms} rooms`, state.chunks.length, R.rooms);
    if (R.gardens) add(`A garden`, Object.keys(state.gardens || {}).length, R.gardens);
    if (R.comfort) add(`${R.comfort} paws of comfort`, comfort.paws, R.comfort);
    if (R.items) add(`${R.items} things placed in your home`, state.furniture.length, R.items);
    if (R.dogs) add(`${R.dogs} dogs`, dogs.length, R.dogs);
    if (R.luxury) add(`${R.luxury} luxury pieces placed`, luxuryCount(), R.luxury);
    return rows;
  }
  function houseBlock(T) {
    if (!unlockedFeat('house')) return `Opens at Trainer rank ${featRank('house')}`;
    if (rank() < T.rank) return `Opens at Trainer rank ${T.rank}`;
    if (!houseRows(T).every((r) => r.ok)) return 'Not ready yet';
    if (state.coins < T.cost) return `Costs ${T.cost} coins`;
    return '';
  }
  function upgradeHouse() {
    const T = D.HOUSE_TIERS[houseTier() + 1];
    if (!T || !needRank('house')) return;
    const why = houseBlock(T);
    if (why) { toast(why); return; }
    state.coins -= T.cost;
    state.houseTier = houseTier() + 1;
    for (const id of [T.wall, T.floor]) if (id && !state.styles.includes(id)) state.styles.push(id);
    gainXP(120 * state.houseTier);
    sfx('unlock');
    try { if (place === 'home') confetti(player.root.position.clone().add(new V3(0, 1.6, 0)), 12); } catch (_) { /* fine */ }
    news({ title: `Your home is now a ${T.name}!`, text: `${T.perk}. Room for ${T.rooms} rooms, plus a new wallpaper and floor in Decorate.`, th: IC('home') });
    updateHud();
    save();
    renderHouse();
  }
  function checkAllowance() {
    if (visit || houseTier() < 4) return;
    const key = clockNow.dateKey;
    if (state.allowanceDay === key) return;
    state.allowanceDay = key;
    state.coins += 100;
    setTimeout(() => news({ title: 'Your daily allowance', text: 'The estate brings in 100 coins today.', th: IC('coin') }), 1500);
    updateHud();
    save();
  }
  function openHouse() {
    if (!needRank('house')) return;
    renderHouse();
    $('house').classList.remove('hidden');
  }
  function renderHouse() {
    const t = houseTier(), cur = D.HOUSE_TIERS[t];
    const upTxt = (T) => (T.up ? ` + ${T.up} upstairs` : '');
    $('hsNow').innerHTML = `<div class="ic">${IC('home')}</div><div class="txt"><b>${esc(cur.name)}</b><small>${t ? esc(cur.perk) : 'Upgrade it to fit more rooms and make life nicer for your dogs.'} · room for ${cur.rooms} rooms${upOpen() ? upTxt(cur) : ''}</small>` +
      (unlockedFeat('rooms') && !visit ? `<button class="small" data-act="rooms">${IC('crane')} Rooms: add, move, walls${upOpen() ? ', stairs' : ''}</button>` : '') + `</div>`;
    $('hsList').innerHTML = D.HOUSE_TIERS.map((T, i) => {
      if (i === 0) return '';
      const done = i <= t, next = i === t + 1;
      const head = `<div class="ic tierNo${done ? ' done' : ''}">${i + 1}</div>`;
      if (done) return `<div class="row badgeRow got">${head}<div class="txt"><b>${esc(T.name)}</b><small>${esc(T.perk)}</small></div></div>`;
      if (!next) return `<div class="row badgeRow later">${head}<div class="txt"><b>${esc(T.name)}</b><small>Rank ${T.rank} · ${T.rooms} rooms${upTxt(T)} · ${esc(T.perk)}</small></div></div>`;
      const rows = houseRows(T).map((r) => `<div class="req${r.ok ? ' done' : ''}">${IC(r.ok ? 'check' : 'dot')}<div><small class="note">${esc(r.text)}</small>${r.need > 1 ? `<div class="track"><div class="fill" style="width:${Math.round((r.have / r.need) * 100)}%"></div></div><small class="prog">${r.have} of ${r.need}</small>` : ''}</div></div>`).join('');
      const why = houseBlock(T);
      return `<div class="row badgeRow next">${head}<div class="txt"><b>${esc(T.name)}</b><small>${esc(T.perk)} · room for ${T.rooms} rooms${T.up ? ` (and ${T.up} upstairs, once every room downstairs is built)` : ''} · a new wallpaper and floor</small>${rows}` +
        `<button class="primary small" data-act="upgradeHouse"${why ? ' disabled' : ''}>${why ? esc(why) : `Upgrade for ${T.cost} coins`}</button></div></div>`;
    }).join('');
  }
  $('house').addEventListener('click', (e) => {
    if (e.target.id === 'house' || e.target.closest('[data-act="closeHouse"]')) { $('house').classList.add('hidden'); return; }
    if (e.target.closest('[data-act="upgradeHouse"]')) upgradeHouse();
    if (e.target.closest('[data-act="rooms"]')) { $('house').classList.add('hidden'); if (place !== 'home') { toast('Head home first 🏠'); return; } enterBuildMode('move'); }
  });

  // =====================================================================
  // Neighbor stories: meet them on walks, help them out, chapter by chapter
  // =====================================================================
  const nbOf = (owner) => D.NEIGHBORS.find((N) => N.owner === owner);
  const storyOf = (owner) => (state.stories || {})[owner];
  function storyChapter(owner) {
    const S = D.STORIES[owner], st = storyOf(owner);
    if (!S || !st || st.ch >= S.length) return null;
    return S[st.ch];
  }
  // a chapter opens the in-game day after the one before
  function storyReady(owner) {
    const S = D.STORIES[owner];
    if (!S || !unlockedFeat('stories') || visit) return false;
    const st = storyOf(owner);
    if (!st) return true;
    return st.ch < S.length && (st.ch === 0 || st.day !== clockNow.gameDay);
  }
  function taskLine(owner, C) {
    const T = C.task, st = storyOf(owner) || { n: 0 }, N = nbOf(owner), dog = N ? N.dog.name : 'their dog';
    switch (T.kind) {
      case 'meet': return 'Say hello on a walk';
      case 'play': return `Let your dog play with ${dog} (${Math.min(st.n || 0, T.n)} of ${T.n})`;
      case 'bring': return `Bring ${ingCount(T.ing, T.n)} (you have ${state.pantry[T.ing] || 0})`;
      case 'show': return `Show a ${D.FINDS[T.id].name.toLowerCase()} from ${D.LOCATIONS[D.FINDS[T.id].loc].name}${state.finds[T.id] ? ' (you have one)' : ''}`;
      case 'trick': return `Do ${ALL_TRICKS[T.id].name} at ${D.TRICK_LEVELS[T.lvl]} or better near ${dog}`;
      case 'badge': return `Bring a dog with the ${D.BADGES.find((B) => B.id === T.id).name} badge`;
      case 'at': return `Meet them in ${locUnlocked(T.loc) ? D.LOCATIONS[T.loc].name : 'a place you haven’t found yet'}`;
      case 'dressed': return 'Bring a dog wearing an outfit';
      case 'clean': return 'Bring all your dogs at least 90% clean';
      case 'meal': return `Bring ${D.RECIPES[T.id].name} (you have ${state.meals.filter((m) => m.id === T.id).length})`;
      case 'comfort': return `Reach ${T.n} paws of comfort at home`;
      default: return '';
    }
  }
  const ingCount = (id, n) => {
    const nm = D.INGREDIENTS[id].name.toLowerCase();
    if (/(fish|cheese|honey)$/.test(nm)) return `${n === 1 ? 'some' : n + ' portions of'} ${nm}`;
    if (n === 1) return `${/^[aeiou]/.test(nm) ? 'an' : 'a'} ${nm}`;
    return `${n} ${/s$/.test(nm) ? nm : /y$/.test(nm) ? nm.slice(0, -1) + 'ies' : nm + 's'}`;
  };
  function rewardText(R) {
    const bits = [];
    if (R.coins) bits.push(`${R.coins} coins`);
    if (R.wall) bits.push(`${D.WALLS[R.wall].name} wallpaper`);
    if (R.floor) bits.push(`${D.FLOORS[R.floor].name} floor`);
    if (R.item) bits.push(`a ${D.ITEMS[R.item].name.toLowerCase()}`);
    return bits.join(', ');
  }
  // can this chapter be finished right now, while you stand next to them?
  function taskDone(owner, T) {
    const st = storyOf(owner);
    switch (T.kind) {
      case 'meet': return true;
      case 'play': return (st.n || 0) >= T.n;
      case 'bring': return (state.pantry[T.ing] || 0) >= T.n;
      case 'show': return (state.finds[T.id] || 0) > 0;
      case 'trick': return !!st.trickOk;
      case 'badge': return dogs.some((d) => d.hasBadge(T.id));
      case 'at': return place === 'park' && loc === T.loc;
      case 'dressed': return dogs.some((d) => Object.keys(d.acc || {}).length > 0);
      case 'clean': return dogs.every((d) => d.clean >= 90);
      case 'meal': return state.meals.some((m) => m.id === T.id);
      case 'comfort': return comfort.paws >= T.n;
      default: return false;
    }
  }
  function storyMeet(w) {
    const owner = w.info.owner;
    if (!storyReady(owner)) return false;
    state.stories = state.stories || {};
    if (!state.stories[owner]) state.stories[owner] = { ch: 0, n: 0, day: -1 };
    const C = storyChapter(owner);
    if (!C) return false;
    w.pause = Math.max(w.pause, 3);
    if (taskDone(owner, C.task)) { storyComplete(owner, w); return true; }
    if (!w.asked) {
      w.asked = true;
      news({ title: owner, text: `${C.say} ${taskLine(owner, C)}.`, th: TH('dog', `${nbOf(owner).dog.breed}|${nbOf(owner).dog.coat}`) });
      state.stories[owner].asked = st0(owner).ch;
      setTimeout(() => tip('stories', { title: 'Neighbor stories', text: 'Neighbors ask for little favors. Check what they need in Menu → Neighbors, then meet them on a walk.', icon: 'person' }), 3000);
      save();
    }
    return true;
  }
  const st0 = (owner) => state.stories[owner];
  function storyComplete(owner, w) {
    const S = D.STORIES[owner], st = st0(owner), C = S[st.ch], T = C.task, R = C.reward;
    if (T.kind === 'bring') state.pantry[T.ing] -= T.n;
    if (T.kind === 'meal') state.meals.splice(state.meals.findIndex((m) => m.id === T.id), 1);
    st.ch++;
    st.n = 0;
    st.trickOk = false;
    st.day = clockNow.gameDay;
    if (R.coins) state.coins += R.coins;
    if (R.xp) gainXP(R.xp);
    for (const id of [R.wall, R.floor]) if (id && !state.styles.includes(id)) state.styles.push(id);
    if (R.item) state.inventory[R.item] = (state.inventory[R.item] || 0) + 1;
    sfx('unlock');
    const N = nbOf(owner);
    const said = T.kind === 'meet' ? C.say : `Thank you! ${st.ch >= S.length ? `${N.dog.name} and I won’t forget this.` : 'Come find us again tomorrow.'}`;
    news({ title: st.ch >= S.length ? `${owner}’s story is complete` : owner, text: `${said} You got ${rewardText(R)}.`, th: TH('dog', `${N.dog.breed}|${N.dog.coat}`) });
    if (w) { try { spawnEmoji('💕', w.parts.root.position.clone().add(new V3(0, 2, 0)), { size: 0.5, life: 1.6, vy: 0.5 }); w.pause = Math.max(w.pause, 3); } catch (_) { /* fine */ } }
    updateHud();
    save();
  }
  // their dog played with yours, or they watched a trick: chapters that count those
  function storyPlay(npc) {
    const w = walkers.find((x) => x.dog === npc);
    if (!w || !storyReady(w.info.owner) || !storyOf(w.info.owner)) return;
    const C = storyChapter(w.info.owner);
    if (!C || C.task.kind !== 'play') return;
    const st = st0(w.info.owner);
    st.n = (st.n || 0) + 1;
    if (st.n >= C.task.n) storyComplete(w.info.owner, w);
    else toast(`${w.dog.name} had a blast! Playdates for ${w.info.owner}: ${st.n} of ${C.task.n}`);
  }
  function storyTrick(d, id) {
    for (const w of walkers) {
      const owner = w.info.owner;
      if (!storyReady(owner) || !storyOf(owner)) continue;
      const C = storyChapter(owner);
      if (!C || C.task.kind !== 'trick' || C.task.id !== id) continue;
      if (w.parts.root.position.distanceTo(d.root.position) > 6) continue;
      if (d.trickLvl(id) < C.task.lvl) { setTimeout(() => toast(`${owner}: Nice! But ${w.dog.name} needs to see it done at ${D.TRICK_LEVELS[C.task.lvl]}.`), 900); continue; }
      st0(owner).trickOk = true;
      setTimeout(() => storyComplete(owner, w), 900);
    }
  }
  function openPeople() {
    if (!needRank('stories')) return;
    renderPeople();
    $('people').classList.remove('hidden');
  }
  function renderPeople() {
    const known = Object.keys(state.stories || {}).filter((o) => D.STORIES[o] && nbOf(o));
    const total = Object.keys(D.STORIES).length;
    $('ppSub').textContent = known.length ? `${known.filter((o) => st0(o).ch >= D.STORIES[o].length).length} of ${total} stories finished. Meet neighbors on walks to carry on.` : 'Meet neighbors on walks. Some of them have stories to tell.';
    $('ppList').innerHTML = known.map((o) => {
      const N = nbOf(o), S = D.STORIES[o], st = st0(o), C = storyChapter(o);
      const dots = S.map((_, i) => `<i class="${i < st.ch ? 'on' : ''}"></i>`).join('');
      let line;
      if (!C) line = '<small>Story complete. Thanks for being a good neighbor!</small>';
      else if (!storyReady(o)) line = '<small>Next chapter tomorrow</small>';
      else if (st.asked !== st.ch && st.ch > 0) line = '<small>They have something new to tell you. Meet them on a walk.</small>';
      else line = `<small class="quote">“${esc(C.say)}”</small><small class="task">${esc(taskLine(o, C))}</small><small>Reward: ${esc(rewardText(C.reward))}</small>`;
      return `<div class="row storyRow"><div class="ic"><img class="nbPortrait" src="${ART.portraitURL(N.dog.breed, N.dog.coat)}" alt=""></div><div class="txt"><b>${esc(o)} &amp; ${esc(N.dog.name)}</b><span class="chDots">${dots}</span>${line}</div></div>`;
    }).join('') + (known.length < total ? `<p class="sub">${total - known.length} more neighbor${total - known.length > 1 ? 's have' : ' has'} a story to share.</p>` : '');
  }
  $('people').addEventListener('click', (e) => { if (e.target.id === 'people' || e.target.closest('[data-act="closePeople"]')) $('people').classList.add('hidden'); });

  // =====================================================================
  // Rotating content: weekly specials, monthly sets, collection sets and the critter guide
  // =====================================================================
  // weeks start on Monday (German time), so specials change overnight from Sunday to Monday
  function weekKey() {
    const [y, m, d] = clockNow.dateKey.split('-').map(Number);
    return Math.floor((Date.UTC(y, m - 1, d) / 86400000 + 3) / 7);
  }
  function weekRand(salt) { return ART.mulberry32(hashStr(`${weekKey()}|${salt}|${state.uid}`)); }
  function pickN(list, n, rr) {
    const a = list.slice(), out = [];
    while (out.length < n && a.length) out.push(a.splice(Math.floor(rr() * a.length), 1)[0]);
    return out;
  }
  // a vendor's specials: two things from shops in other places, and now and then a rare piece
  function vendorSpecials(vid) {
    const V = D.VENDORS[vid];
    if (!V || V.currency === 'tickets') return [];
    const own = new Set(V.stock.map(([k, key]) => k + ':' + key));
    const pool = [];
    for (const [id, W] of Object.entries(D.VENDORS)) {
      if (id === vid || W.currency === 'tickets') continue;
      for (const [k, key, p0] of W.stock) if (['acc', 'outfit', 'toy', 'shampoo', 'meal'].includes(k) && !own.has(k + ':' + key) && !pool.some((x) => x[0] === k && x[1] === key)) pool.push([k, key, p0, id]);
    }
    const rr = weekRand(vid);
    const out = pickN(pool, 2, rr);
    if (rr() < 0.3) {
      const rares = Object.keys(D.ITEMS).filter((k) => D.ITEMS[k].rare);
      out.push(['item', rares[Math.floor(rr() * rares.length)], 650]);
    }
    return out;
  }
  // the home shop's three deals of the week
  function homeSpecials() {
    const pool = [];
    for (const [k, t] of Object.entries(D.TOYS)) if (t.price && !t.vendor && k !== 'tennis') pool.push(['toy', k]);
    for (const [k, it] of Object.entries(D.ITEMS)) if (it.price != null && !it.garden && it.cat !== 'luxury') pool.push(['item', k]);
    for (const [k, A] of Object.entries(D.ACCESSORIES)) if (A.price && !A.unlock && !A.vendor) pool.push(['acc', k]);
    return pickN(pool, 3, weekRand('home'));
  }

  // ----- monthly sets -----
  function rollSeason() {
    const S = D.SEASONS[clockNow.month];
    if (!S) return null;
    const ids = S.finds.map((f) => f[0]);
    const missing = ids.filter((k) => !state.finds[k]);
    return pick(missing.length && Math.random() < 0.7 ? missing : ids);
  }
  function checkSeasons() {
    state.seasonsDone = state.seasonsDone || [];
    for (const [m, S] of Object.entries(D.SEASONS)) {
      const key = `${m}`;
      if (state.seasonsDone.includes(key) || !S.finds.every(([k]) => state.finds[k])) continue;
      state.seasonsDone.push(key);
      giveReward(S.reward);
      sfx('unlock');
      news({ title: `${S.name} set complete!`, text: `You found all four ${D.MONTHS[m]} things. You got ${rewardText(S.reward)}.`, th: TH('pic', S.finds[0][2]) });
    }
  }
  // ----- collection sets -----
  function checkSets() {
    state.setsDone = state.setsDone || [];
    for (const S of D.SETS) {
      if (state.setsDone.includes(S.id) || !S.finds.every((k) => state.finds[k])) continue;
      state.setsDone.push(S.id);
      giveReward(S.reward);
      sfx('unlock');
      news({ title: `Set complete: ${S.name}`, text: `You got ${rewardText(S.reward)}.`, th: TH('pic', D.FINDS[S.finds[0]].icon) });
    }
  }
  function giveReward(R) {
    if (R.coins) state.coins += R.coins;
    if (R.xp) gainXP(R.xp);
    for (const id of [R.wall, R.floor]) if (id && !state.styles.includes(id)) state.styles.push(id);
    if (R.item) { state.inventory[R.item] = (state.inventory[R.item] || 0) + 1; if (D.ITEMS[R.item].rare) seeRare(R.item); }
    updateHud();
  }
  // ----- critters -----
  function critterOk(C) {
    const W = localWeather(), night = isNight();
    switch (C.when) {
      case 'night': return night;
      case 'day': return !night;
      case 'rain': return W.precip === 'rain';
      case 'snow': return W.precip === 'snow';
      case 'sun': return weatherId === 'sun' && !night;
      default: return true;
    }
  }
  function spotCritter(id, pos) {
    const C = D.CRITTERS[id];
    if (!C || !unlockedFeat('critters') || visit) return;
    state.critters = state.critters || {};
    const first = !state.critters[id];
    state.critters[id] = (state.critters[id] || 0) + 1;
    if (first) {
      gainXP(25);
      sfx('find');
      news({ title: 'New for your critter guide', text: C.name, th: TH('pic', C.icon) });
      setTimeout(() => tip('critters', { title: 'Critter guide', text: 'Your dogs sniff out little animals now and then. Some only come out at night, in the rain or in the snow. See Menu → Collectibles.', icon: 'search' }), 2500);
      if (Object.keys(D.CRITTERS).every((k) => state.critters[k]) && !state.crittersDone) {
        state.crittersDone = true;
        giveReward(D.CRITTER_REWARD);
        setTimeout(() => news({ title: 'Critter guide complete!', text: `Every last one. You got ${rewardText(D.CRITTER_REWARD)}.`, th: TH('pic', '🐾') }), 1500);
      }
    } else toast(`Another ${C.name.toLowerCase()} sighting`);
    if (pos) try { spawnEmoji(C.icon, pos.clone().add(new V3(rand(-0.6, 0.6), 0.9, rand(-0.6, 0.6))), { size: 0.6, life: 1.8, vy: 0.4 }); } catch (_) { /* fine */ }
    save();
  }
  // a sniff sometimes turns up a critter instead of loot
  function sniffCritter(d) {
    if (!unlockedFeat('critters') || Math.random() > D.CRITTER_CHANCE) return false;
    const here = Object.keys(D.CRITTERS).filter((k) => D.CRITTERS[k].loc === loc && !D.CRITTERS[k].ev && critterOk(D.CRITTERS[k]));
    if (!here.length) return false;
    const fresh = here.filter((k) => !(state.critters || {})[k]);
    spotCritter(pick(fresh.length && Math.random() < 0.75 ? fresh : here), d.root.position);
    return true;
  }
  const CRITTER_EV = Object.fromEntries(Object.entries(D.CRITTERS).filter(([, C]) => C.ev).map(([k, C]) => [C.ev, k]));
  function critterWhere(C) {
    const where = locUnlocked(C.loc) ? D.LOCATIONS[C.loc].name : 'Somewhere new';
    const when = { night: 'at night', day: 'by day', rain: 'in the rain', snow: 'in the snow', sun: 'on sunny days' }[C.when];
    return when ? `${where}, ${when}` : where;
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
  const MOOD_TIP = {
    great: 'Great mood: finds collectibles more often on walks and learns tricks a little easier.',
    good: 'Good mood. Keep needs high and play a lot for a great mood.',
    grumpy: 'Grumpy: sometimes ignores tricks. Food, water, petting and play will help.',
  };
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
        '<button class="bondRow" data-dact="profile"></button>' +
        '<div class="chips"></div>' +
        D.STATS.map((s) => `<div class="bar ${s.k}"><span class="bic">${IC(STAT_IC[s.k])}<i class="badge">!</i></span><div class="track"><div class="fill ${s.k}"></div></div></div>`).join('') +
        '<div class="favs"></div>' +
        `<div class="cardBtns"><button class="mini" data-dact="tricks">${IC('cap')}Tricks</button><button class="mini" data-dact="treat">${IC('treat')}Treat</button><button class="mini" data-dact="style">${IC('hat')}Style</button><button class="mini" data-dact="bath">${IC('bath')}Bath</button><button class="mini" data-dact="towel">${IC('towel')}Towel</button><button class="mini" data-dact="journal">${IC('book')}Journal</button><button class="mini" data-dact="play">${IC('ball')}Play</button></div>` +
      '</div>';
    el.querySelector('.pName').textContent = d.name;
    d.ui = {
      el, open: false, alertKey: null,
      status: el.querySelector('.pStatus'),
      alerts: el.querySelector('.alerts'),
      chips: el.querySelector('.chips'),
      favs: el.querySelector('.favs'),
      bondRow: el.querySelector('.bondRow'),
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
        if (btn.dataset.dact === 'profile') openDogSheet(d);
        else if (btn.dataset.dact === 'towel') startTowel(d);
        else if (btn.dataset.dact === 'journal') openJournal(d);
        else if (btn.dataset.dact === 'play') openPlay(d);
        else if (btn.dataset.dact === 'tricks') { d.ui.open = false; el.classList.remove('open'); enterTrickMode(d); }
        else if (btn.dataset.dact === 'treat') { if (needRank('kitchen')) openMeals(d); }
        else if (btn.dataset.dact === 'style') { if (needRank('boutique')) openWardrobe(d); }
        else if (btn.dataset.dact === 'bath') { if (!needRank('bath')) return; if (place !== 'home') toast('Baths happen at home 🛁'); else openBath(d); }
        return;
      }
      selected = d;
      d.ui.open = !d.ui.open;
      el.classList.toggle('open', d.ui.open);
      document.body.classList.toggle('cardOpen', dogs.some((x) => x.ui && x.ui.open));
      if (d.ui.open) { refreshCardStatic(d); tutEvent('card'); }
      updatePack();
    });
    $('pack').appendChild(el);
    refreshCardStatic(d);
    refreshGates();
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
      `<span class="chip mood ${d.mood()}" data-tip="${esc(MOOD_TIP[d.mood()])}">${{ great: 'Great mood', good: 'Good mood', grumpy: 'Grumpy' }[d.mood()]}</span>` +
      chip(`Obedience ${d.obedience()}`, `Obedience grows with every trick level. Teach tricks in Trick Mode.${d.trickLvl('come') >= CONFIG.OFFLEASH_COME_LEVEL ? ' Can go off-leash on walks.' : ''}`) +
      (d.fluffUntil > Date.now() ? chip('Fluffy ✨', `Freshly brushed: extra fluffy for about ${Math.max(1, Math.round((d.fluffUntil - Date.now()) / 60000))} more minutes`) : '') +
      ((state.starNames || {})[d.id] ? chip('⭐ Has a star', `There’s a star named after ${d.name}. Look for it on a clear night.`) : '');
    u.el.querySelector('.pName').textContent = d.name + ((state.starNames || {})[d.id] ? ' ⭐' : '');
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
    // favorite playmate among your own dogs, and a rival if there is one
    const pal = dogs.filter((o) => o !== d).sort((a, b) => friendship(d.id, b.id) - friendship(d.id, a.id))[0];
    const palLine = pal && friendship(d.id, pal.id) >= 25 && !(bf && bf.name === pal.name) ? `<div>Favorite playmate: ${esc(pal.name)} 🐾</div>` : '';
    const rv = rivalOf(d);
    const rivalLine = rv ? `<div>Doesn’t get along with: ${esc(rv.name)} 💢</div>` : '';
    u.favs.innerHTML = `<div>Favorite toy: ${esc(fav)}</div>${spot}${friendLine}${palLine}${rivalLine}`;
    u.bondRow.innerHTML = bondLine(d);
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
    if (d.clean >= CONFIG.TOWEL_MAX - 1) { toast(`${d.name} is already fairly clean. A bath gets the rest off`); return; }
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
    const toys = state.clutter.filter((c) => c.kind === 'toy').length, holes = state.clutter.filter((c) => c.kind === 'hole').length, prints = state.clutter.filter((c) => c.kind === 'prints').length;
    if (toys || holes || prints) parts.push([prints ? 'Mess (toys, holes & paw prints)' : 'Mess (toys & holes)', -(toys * 4 + holes * 5 + prints * 2)]);
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
      `<div class="section">Night lighting</div><p class="sub">${(() => { const p = Math.round(homeLitShare() * 100); return `${p}% of your home is lit at night. ${p >= 50 ? 'Dogs relax a little more in the lamplight.' : 'Lamps, candles, lanterns and string lights brighten it up. Dogs relax more in a lit home.'}`; })()}</p>` +
      `<div class="section">Combos found</div><p class="sub">${comfort.found.length ? comfort.found.map(esc).join(' · ') : 'None yet — try placing things that belong together near each other.'}${comfort.missing ? ` · ${comfort.missing} more to discover` : ''}</p>`;
    $('comfort').classList.remove('hidden');
  }

  function renderClutter() {
    clutterGroup.clear();
    if (visit) return;
    for (const c of state.clutter) {
      const g = c.kind === 'hole' ? ART.buildHole() : c.kind === 'prints' ? ART.buildPrints(c.seed || 1) : ART.buildToy(c.type);
      g.position.set(c.i + 0.5 + (c.ox || 0), c.kind === 'hole' || c.kind === 'prints' ? 0 : (D.TOYS[c.type] ? D.TOYS[c.type].restY : 0.1), c.j + 0.5 + (c.oz || 0));
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
      const tn = (D.TOYS[state.clutter[state.clutter.length - 1].type] || { name: 'toy' }).name.toLowerCase();
      setTimeout(() => { if (place === 'home' && d.state === 'playtoy') toyPals(d, tn); }, 1500);
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
    news({ title: 'A rare find!', text: `${D.ITEMS[k].name}. Place it in Decorate.`, th: thumbOf.item(k) });
    if (pos) confetti(pos.clone().add(new V3(0, 1, 0)));
    save();
  }
  function autoRefill() {
    const mins = CONFIG.AUTO_REFILL_MINUTES * 60000 / (houseTier() >= 3 ? 2 : 1);
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
    const spot = D.SEATS[f.type] && !D.ITEMS[f.type].solid && !it.use ? tileCenter(f) : frontOf(f) || tileCenter(f);
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
      if (c.kind === 'prints') {
        // wiping one set of prints wipes the trail
        state.clutter = state.clutter.filter((x) => x.kind !== 'prints' || Math.hypot(x.i - c.i, x.j - c.j) > 2.5);
        renderClutter();
        computeComfort();
      }
      toast(c.kind === 'hole' ? 'Hole filled in 🌱' : c.kind === 'prints' ? 'Wiped up the paw prints 🧽' : 'Tidied up a toy ✨');
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
    if (!it.use && D.SEATS[f.type]) { sitDown(homeSeat(f)); return; }
    if (it.use === 'paint') { startPainting(f); return; }
    if (it.use === 'mail') { openMail(); return; }
    if (it.use === 'bake') { openBake(); return; }
    if (it.use === 'piano') { startMusic(f); return; }
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
    endFun('switch');
    if (!d || !needRank('bath')) return;
    if (bath) closeBath();
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
  // ----- bath time fills the whole screen: the real voxel dog stands in a wide, low tub and reacts to your finger -----
  let B3 = null;   // null = not tried yet, false = no 3D here (falls back to a flat picture)
  const bathSize = () => [Math.max(200, window.innerWidth || 390), Math.max(300, window.innerHeight || 844)];
  function bathTub(parent) {
    const g = new THREE.Group();
    const white = '#ffffff', outer = '#8fd0e0', lip = '#f4fbfd', grout = '#d3e8f1';
    box(g, 9, 0.04, 7, '#e9cfa8', 0, -0.02, 0);                                   // a warm wooden floor
    for (let k = -8; k <= 8; k++) box(g, 0.02, 0.005, 7, '#d6b98f', k * 0.5, 0.001, 0);
    box(g, 9, 4, 0.1, '#e8f5fb', 0, 2, -1.6);                                     // tiled wall behind
    for (let k = -12; k <= 12; k++) box(g, 0.015, 4, 0.02, grout, k * 0.3, 2, -1.54);
    for (let k = 1; k <= 13; k++) box(g, 9, 0.015, 0.02, grout, 0, k * 0.3, -1.54);
    box(g, 2.7, 0.08, 1.6, white, 0, 0.04, 0);                                    // the tub: wide and low
    for (const z of [-0.78, 0.78]) { box(g, 2.7, 0.36, 0.08, outer, 0, 0.2, z); box(g, 2.8, 0.06, 0.16, lip, 0, 0.4, z); }
    for (const x of [-1.33, 1.33]) { box(g, 0.08, 0.36, 1.6, outer, x, 0.2, 0); box(g, 0.16, 0.06, 1.7, lip, x, 0.4, 0); }
    for (const [x, z] of [[-1.2, -0.68], [1.2, -0.68], [-1.2, 0.68], [1.2, 0.68]]) box(g, 0.14, 0.06, 0.14, '#e0b84a', x, -0.01, z);
    const water = box(g, 2.58, 0.02, 1.48, new THREE.MeshLambertMaterial({ color: '#9fd8f5', transparent: true, opacity: 0.45 }), 0, 0.26, 0);
    water.userData.water = true;
    for (const [x, z, s] of [[-1.05, 0.5, 0.16], [-0.95, 0.58, 0.11], [1.0, -0.5, 0.14], [1.12, -0.44, 0.1], [0.9, 0.55, 0.12]]) box(g, s, s * 0.7, s, '#ffffff', x, 0.3, z);
    const duck = new THREE.Group();                                                // a rubber duck in the corner
    box(duck, 0.2, 0.14, 0.16, '#ffd54a', 0, 0, 0);
    box(duck, 0.11, 0.11, 0.11, '#ffd54a', 0.07, 0.11, 0);
    box(duck, 0.06, 0.03, 0.06, '#ff8a3d', 0.15, 0.1, 0);
    duck.position.set(-0.95, 0.32, -0.45);
    duck.rotation.y = 0.6;
    g.add(duck);
    box(g, 0.5, 0.05, 0.22, '#ffffff', 1.75, 0.9, -1.45);                         // a shelf with bottles
    box(g, 0.11, 0.24, 0.1, '#ff8fb1', 1.62, 1.04, -1.45);
    box(g, 0.1, 0.18, 0.1, '#7fc8f8', 1.8, 1.01, -1.45);
    box(g, 0.09, 0.2, 0.09, '#a7e3a1', 1.94, 1.02, -1.45);
    parent.add(g);
    return { g, duck };
  }
  function bath3d() {
    if (B3 !== null) return B3 || null;
    try {
      const cv = $('bathGL');
      const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      r.setClearColor(0x000000, 0);
      const sc = new THREE.Scene();
      sc.add(new THREE.HemisphereLight(0xffffff, 0xa8b8c8, 0.95));
      const sun = new THREE.DirectionalLight(0xffffff, 0.55);
      sun.position.set(2, 4, 3);
      sc.add(sun);
      const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 40);
      const T = bathTub(sc);
      const t = new V3(1, 2, 3).project(cam);
      if (!isFinite(t.x)) throw new Error('no projection');
      B3 = { r, sc, cam, tub: T.g, duck: T.duck, ray: new THREE.Raycaster(), parts: null, fx: [], ppu: 140 };
      bathFrame();
    } catch (_) { B3 = false; }
    return B3 || null;
  }
  // fit the camera to the screen: the dog fills the width on a phone, and stays big in landscape too
  function bathFrame() {
    const B = B3;
    const [W, H] = bathSize();
    if (bath) { bath.W = W; bath.H = H; }
    if (!B) return;
    B.r.setSize(W, H, false);
    const target = new V3(0, 0.42, 0), pos = new V3(0.8, 1.8, 3.1);
    const dist = pos.distanceTo(target), a = W / H;
    const wantW = 1.75, wantH = 2.0;
    const vFromW = 2 * Math.atan(Math.tan(Math.atan(wantW / 2 / dist)) / a), vFromH = 2 * Math.atan(wantH / 2 / dist);
    B.cam.fov = THREE.MathUtils ? THREE.MathUtils.radToDeg(Math.max(vFromW, vFromH)) : Math.max(vFromW, vFromH) * 57.2958;
    B.cam.aspect = a;
    B.cam.position.copy(pos);
    B.cam.lookAt(target.x, target.y + (a < 1 ? -0.05 : 0.22), target.z);   // landscape: keep the dog clear of the bar on top
    B.cam.updateProjectionMatrix();
    // pixels per world unit around the dog: rubbing reach and strength scale with it
    const p0 = target.clone().project(B.cam), p1 = target.clone().add(new V3(1, 0, 0)).project(B.cam);
    B.ppu = Math.max(60, Math.hypot((p1.x - p0.x) * W / 2, (p1.y - p0.y) * H / 2));
  }
  window.addEventListener('resize', () => { if (bath && bath.step !== 'pick') { bathFrame(); bathCanvasFit(); drawBath(); } });
  // how much bigger things are than in the old 280-pixel picture
  const bathK = () => (B3 && B3.parts ? B3.ppu / 143 : Math.min(bath.W, bath.H) / 280);
  const bv = new V3(), bc = new V3();
  function bathSetupDog(d) {
    const B = bath3d();
    if (!B) return;
    if (B.parts) B.sc.remove(B.parts.root);
    B.fx.forEach((f) => B.sc.remove(f.m));
    B.fx = [];
    const P = ART.buildDog(d.breed, d.coat);
    P.root.traverse((o) => { if (o.isMesh && o.material && o.material.transparent && o.material.opacity < 0.5) o.visible = false; });
    P.root.scale.setScalar(d.isPuppy() ? 0.85 : 1);
    P.root.position.set(0, 0.08, 0);
    P.patches.forEach((m) => { m.visible = false; m.scale.setScalar(1); m.userData.patch = true; });
    B.sc.add(P.root);
    B.parts = P;
    B.side = 0;
    B.yaw = Math.PI / 2 - 0.3;
    P.root.rotation.y = B.yaw;
    B.t = 0; B.rub = 0; B.shake = 0; B.hop = 0; B.ptr = null; B.turning = 0; B.blind = 0; B.visT = 0; B.idleTurns = 0;
  }
  // screen position of a point, and whether you can actually see it from here (not behind the dog or the tub)
  function bathProject(m) {
    const B = B3;
    m.getWorldPosition(bv);
    bc.copy(bv).project(B.cam);
    return [(bc.x * 0.5 + 0.5) * bath.W, (-bc.y * 0.5 + 0.5) * bath.H];
  }
  function bathOccluders() {
    const B = B3, out = [];
    B.parts.root.traverse((o) => { if (o.isMesh && o.visible && !o.userData.fx && !o.userData.patch) out.push(o); });
    B.tub.traverse((o) => { if (o.isMesh && !o.userData.water) out.push(o); });
    return out;
  }
  function bathSeen(m, occ) {
    const B = B3;
    m.getWorldPosition(bv);
    const dir = bv.clone().sub(B.cam.position), dist = dir.length();
    B.ray.set(B.cam.position, dir.normalize());
    const h = B.ray.intersectObjects(occ, false)[0];
    return !h || h.distance > dist - 0.06;
  }
  function bathHit(x, y) {
    const B = B3;
    B.ray.setFromCamera({ x: (x / bath.W) * 2 - 1, y: 1 - (y / bath.H) * 2 }, B.cam);
    const meshes = [];
    B.parts.root.traverse((o) => { if (o.isMesh && o.visible && !o.userData.fx) meshes.push(o); });
    const h = B.ray.intersectObjects(meshes, false)[0];
    return h ? h.point : null;
  }
  function bathBlob(at, color, size, opacity = 1) {
    const B = B3;
    const m = box(B.parts.root, size, size, size, opacity < 1 ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity }) : color, 0, 0, 0);
    B.parts.root.worldToLocal(m.position.copy(at));
    m.userData.fx = true;
    m.rotation.set(rand(0, 1), rand(0, 1), rand(0, 1));
    return m;
  }
  const bathItems = () => (bath.step === 'scrub' ? bath.spots.filter((x) => x.hp > 0) : bath.step === 'rinse' || bath.step === 'dry' ? bath.foam : []);
  function bathTurn(auto) {
    const B = B3;
    if (!B || !B.parts || B.turning > 0) return;
    B.yaw += Math.PI;
    B.side = 1 - B.side;
    B.turning = 0.9;
    sfx('bubble');
    if (auto) { B.idleTurns++; toast(`${bath.dog.name} turns around`); }
  }
  function updateBath3D(dt) {
    const B = B3;
    if (!B || !B.parts || $('bathFull').classList.contains('hidden')) return;
    const P = B.parts;
    B.t += dt;
    B.rub = Math.max(0, B.rub - dt);
    B.turning = Math.max(0, B.turning - dt);
    P.root.rotation.y = angleLerp(P.root.rotation.y, B.yaw, damp(0.004, dt));
    // which spots you can reach from here: anything you can see. Checked a few times a second.
    const items = bathItems();
    B.visT -= dt;
    if (B.visT <= 0 && B.turning <= 0) {
      B.visT = 0.15;
      const occ = bathOccluders();
      let seen = 0;
      for (const it of items) if (it.mesh) { it.seen = it.forced || bathSeen(it.mesh, occ); if (it.seen) seen++; }
      // nothing left on this side: turn around once. If the other side has nothing in view either, show what's left anyway.
      if (items.length && !seen) {
        B.blind += 0.15;
        if (B.blind > 0.5) {
          B.blind = 0;
          if (B.idleTurns < 1) bathTurn(true);
          else items.forEach((it) => { it.seen = true; it.forced = true; });
        }
      } else { B.blind = 0; if (seen) B.idleTurns = 0; }
    }
    // reactions: a happy wiggle while you scrub, a head turn toward your finger, a big shake after rinsing
    const wag = B.rub > 0 ? 16 : 6;
    P.tail.rotation[P.wagAxis] = Math.sin(B.t * wag) * (B.rub > 0 ? 0.6 : 0.3);
    if (B.ptr) {
      const look = clamp((B.ptr[0] - bath.W / 2) / (bath.W / 2), -1, 1) * 0.6, tilt = clamp((B.ptr[1] - bath.H / 2) / (bath.H / 2), -1, 1) * 0.25;
      P.head.rotation.y = lerp(P.head.rotation.y, B.rub > 0 ? -look * (B.side ? -1 : 1) : 0, damp(0.05, dt));
      P.head.rotation.x = lerp(P.head.rotation.x, B.rub > 0 ? tilt : 0, damp(0.05, dt));
    }
    P.body.rotation.z = B.shake > 0 ? Math.sin(B.t * 42) * 0.32 * Math.min(1, B.shake) : lerp(P.body.rotation.z, B.rub > 0 ? Math.sin(B.t * 9) * 0.05 : 0, 0.2);
    if (B.shake > 0) {
      B.shake -= dt;
      if (Math.random() < 0.7) B.fx.push({ m: box(B.sc, 0.05, 0.05, 0.05, M_DROP, rand(-0.4, 0.4), rand(0.5, 0.9), rand(-0.3, 0.3)), v: new V3(rand(-2, 2), rand(0.6, 2), rand(-1.6, 1.6)), life: 0.8 });
    }
    if (B.hop > 0) { B.hop -= dt; P.root.position.y = 0.08 + Math.max(0, Math.sin((1 - B.hop) * Math.PI * 2)) * 0.2; }
    P.earL.rotation.z = -0.12 + Math.sin(B.t * 7) * (B.rub > 0 ? 0.12 : 0.03);
    B.duck.position.y = 0.32 + Math.sin(B.t * 2) * 0.012;
    B.duck.rotation.z = Math.sin(B.t * 1.6) * 0.08;
    for (const f of B.fx) {
      f.life -= dt;
      f.v.y -= 6 * dt;
      f.m.position.addScaledVector(f.v, dt);
      if (f.life <= 0) B.sc.remove(f.m);
    }
    B.fx = B.fx.filter((f) => f.life > 0);
    // keep the dirt, foam and drops lined up with the picture
    for (const sp of bath.spots) if (sp.mesh) {
      [sp.x, sp.y] = bathProject(sp.mesh);
      sp.mesh.visible = sp.hp > 0;
      sp.mesh.scale.setScalar((sp.mesh.userData.big || 1) * (0.4 + 0.6 * Math.max(0, sp.hp)));
    }
    for (const f of bath.foam) if (f.mesh) [f.x, f.y] = bathProject(f.mesh);
    B.r.render(B.sc, B.cam);
    drawBathMarks();
  }
  const M_DROP = new THREE.MeshLambertMaterial({ color: '#8fd3ff', transparent: true, opacity: 0.85 });
  function bathCanvasFit() {
    const c = $('bathCanvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(bath.W * dpr);
    c.height = Math.round(bath.H * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function startScrub(shampoo) {
    const d = bath.dog;
    bath.shampoo = shampoo;
    bath.step = 'scrub';
    bath.meter = 0;
    [bath.W, bath.H] = bathSize();
    $('bath').classList.add('hidden');
    $('bathFull').classList.remove('hidden');
    $('bathResult').classList.add('hidden');
    $('bathFull').classList.remove('done');
    bathCanvasFit();
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
    const k = Math.min(bath.W, bath.H) / 280, cx = bath.W / 2, cy = bath.H * 0.55;
    bath.spots = Array.from({ length: n }, () => ({ x: cx + rand(-80, 80) * k, y: cy + rand(-70, 80) * k, r: rand(16, 26) * k, hp: 1, col: dirtCol(), seen: true }));
    bath.foam = [];
    const B = bath3d();
    if (B) {
      bathFrame();
      bathSetupDog(d);
      // the dirt sits on the dog itself: on its sides, back and legs
      const order = shuffle(B.parts.patches.map((_, i) => i).slice(0, 6)).concat(shuffle(B.parts.patches.map((_, i) => i).slice(6)));
      bath.spots.forEach((sp, j) => {
        const m = B.parts.patches[order[j % order.length]];
        m.visible = true;
        m.material = mat(sp.col);
        m.userData.big = 3;
        sp.mesh = m;
        sp.r = 20;
        sp.seen = false;
      });
      B.visT = 0;
      $('bathFull').classList.add('three');
    } else {
      bathImg.src = ART.portraitURL(d.breed, d.coat);
      $('bathFull').classList.remove('three');
    }
    bathSay('Scrub away the dirt', B ? 'Rub the dirty spots. Tap Turn to see the other side.' : 'Rub over the dirty spots with your finger');
    drawBath();
  }
  function bathSay(step, hint) {
    $('bfStep').textContent = step;
    $('bfHint').textContent = hint;
    const n = { scrub: 1, rinse: 2, dry: 3 }[bath.step];
    document.querySelectorAll('#bfDots i').forEach((el, i) => el.classList.toggle('on', n > i));
  }
  // soft rings where something is left to do, so nothing hides from you
  function drawBathMarks() {
    const c = $('bathCanvas'), x = c.getContext('2d');
    x.clearRect(0, 0, bath.W, bath.H);
    if (!(B3 && B3.parts) || bath.step === 'done') return;
    const t = performance.now() / 1000, k = bathK();
    const items = bathItems();
    const few = items.length <= 6;
    for (const it of items) {
      if (!it.seen || it.x < -100) continue;
      if (bath.step !== 'scrub' && !few && !it.forced) continue;
      const r = (bath.step === 'scrub' ? 26 : 16) * k * (1 + 0.08 * Math.sin(t * 4 + it.x));
      x.strokeStyle = bath.step === 'scrub' ? 'rgba(255,255,255,0.75)' : 'rgba(80,170,255,0.7)';
      x.lineWidth = 2.5;
      x.setLineDash([6, 6]);
      x.beginPath(); x.arc(it.x, it.y, r, 0, TAU); x.stroke();
    }
    x.setLineDash([]);
  }
  function drawBath() {
    $('bathFill').style.width = Math.round(bath.meter * 100) + '%';
    if (B3 && B3.parts) return;          // the 3D dog is drawn every frame
    const c = $('bathCanvas'), x = c.getContext('2d');
    const W = bath.W, H = bath.H, k = Math.min(W, H) / 280;
    x.clearRect(0, 0, W, H);
    x.imageSmoothingEnabled = false;
    const s = 256 * k;
    if (bathImg.complete && bathImg.naturalWidth) x.drawImage(bathImg, W / 2 - s / 2, H * 0.55 - s / 2, s, s);
    for (const sp of bath.spots) {
      if (sp.hp <= 0) continue;
      x.globalAlpha = 0.25 + 0.7 * sp.hp;
      x.fillStyle = sp.col;
      x.beginPath(); x.arc(sp.x, sp.y, sp.r, 0, TAU); x.fill();
    }
    x.globalAlpha = 1;
    for (const f of bath.foam) {
      x.fillStyle = bath.step === 'dry' ? 'rgba(120,180,255,0.6)' : 'rgba(255,255,255,0.85)';
      x.beginPath(); x.arc(f.x, f.y, f.r, 0, TAU); x.fill();
    }
  }
  const dropFoam = (keep) => (f) => { if (keep(f)) return true; if (f.mesh && f.mesh.parent) f.mesh.parent.remove(f.mesh); return false; };
  function bathRub(x, y, dist) {
    if (!bath || bath.step === 'pick' || bath.step === 'done') return;
    const eff = dirtEfficiency(bath.dog, bath.shampoo);
    const B = B3 && B3.parts ? B3 : null;
    const k = bathK();
    const reach = (it) => it.seen !== false || !B;
    if (B) { B.rub = 0.35; B.ptr = [x, y]; }
    if (bath.step === 'scrub') {
      if (Math.random() < 0.6 && bath.foam.length < 90) {
        if (B) {
          const at = bathHit(x + rand(-6, 6) * k, y + rand(-6, 6) * k);
          if (at) { const m = bathBlob(at, '#ffffff', rand(0.05, 0.09)); bath.foam.push({ x, y, r: 10 * k, mesh: m, seen: true }); if (Math.random() < 0.3) sfx('bubble'); }
        } else bath.foam.push({ x: x + rand(-8, 8) * k, y: y + rand(-8, 8) * k, r: rand(6, 12) * k });
      }
      if (B && Math.random() < 0.25) sfx('scrub');
      for (const s of bath.spots) if (s.hp > 0 && reach(s) && Math.hypot(s.x - x, s.y - y) < (s.r + 18) * k) s.hp -= (dist / k) * 0.006 * (0.5 + eff);
      const left = bath.spots.reduce((a, s) => a + Math.max(0, s.hp), 0);
      bath.meter = 1 - left / bath.spots.length;
      if (left <= 0.001) { bath.step = 'rinse'; bath.meter = 0; if (B) B.idleTurns = 0; bathSay('Rinse off the foam', 'Rub to wash the bubbles away'); }
    } else if (bath.step === 'rinse') {
      bath.foam = bath.foam.filter(dropFoam((f) => !reach(f) || Math.hypot(f.x - x, f.y - y) > 26 * k));
      if (B) {
        const at = bathHit(x, y);
        if (at) for (let j = 0; j < 2; j++) B.fx.push({ m: box(B.sc, 0.035, 0.07, 0.035, M_DROP, at.x + rand(-0.05, 0.05), at.y + 0.25, at.z + rand(-0.05, 0.05)), v: new V3(0, -0.5, 0), life: 0.45 });
        if (Math.random() < 0.08) sfx('splash');
      }
      bath.meter = clamp(bath.meter + dist / k / 1600, 0, 1);
      if (!bath.foam.length && bath.meter > 0.4) {
        bath.step = 'dry';
        bath.meter = 0;
        if (B) {
          // a big shake, then drops to towel off: only where you can see them
          B.shake = 1.1;
          B.idleTurns = 0;
          sfx('shake');
          bath.foam = [];
          const occ = bathOccluders();
          const c = new V3(); B.parts.root.getWorldPosition(c); c.y += 0.45;
          const [cx, cy] = (() => { const p = c.clone().project(B.cam); return [(p.x * 0.5 + 0.5) * bath.W, (-p.y * 0.5 + 0.5) * bath.H]; })();
          for (let j = 0; j < 500 && bath.foam.length < 30; j++) {
            const px = cx + rand(-0.85, 0.85) * B.ppu, py = cy + rand(-0.6, 0.55) * B.ppu, at = bathHit(px, py);
            if (!at) continue;
            const m = bathBlob(at, '#8fd3ff', 0.05, 0.85);
            m.updateMatrixWorld(true);
            if (!bathSeen(m, occ)) { m.parent.remove(m); continue; }
            bath.foam.push({ x: px, y: py, r: 4, mesh: m, seen: true });
          }
          if (!bath.foam.length) bath.foam = Array.from({ length: 16 }, () => ({ x: cx + rand(-60, 60) * k, y: cy + rand(-40, 40) * k, r: 4 * k, seen: true }));
        } else bath.foam = Array.from({ length: 40 }, () => ({ x: bath.W / 2 + rand(-110, 110) * k, y: bath.H * 0.55 + rand(-100, 120) * k, r: rand(3, 6) * k }));
        bath.dropTotal = bath.foam.length;
        bathSay('Towel dry', 'Rub to dry off all the drops');
      }
    } else if (bath.step === 'dry') {
      bath.foam = bath.foam.filter(dropFoam((f) => !reach(f) || Math.hypot(f.x - x, f.y - y) > 24 * k));
      bath.meter = 1 - bath.foam.length / (bath.dropTotal || 40);
      if (!bath.foam.length) { if (B) { B.hop = 1; sfx('bark'); } finishBath(); }
    }
    drawBath();
  }
  function finishBath() {
    const d = bath.dog, S = D.SHAMPOOS[bath.shampoo];
    const e = eventOn('spa') ? 1 : dirtEfficiency(d, bath.shampoo);
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
    bath.meter = 1;
    drawBath();
    $('bathResTitle').textContent = d.clean >= 100 ? `${d.name} is sparkling clean!` : `${d.name} is ${Math.round(d.clean)}% clean`;
    $('bathResText').textContent = e < 0.95 ? 'A shampoo that matches the dirt cleans completely.' : (d.flag('splashes') ? 'Water Lovers adore bath time!' : 'All done!');
    bathSay('Done', '');
    $('bathResult').classList.remove('hidden');
    $('bathFull').classList.add('done');
    try { if (B3 && B3.parts) for (let j = 0; j < 14; j++) B3.fx.push({ m: box(B3.sc, 0.05, 0.05, 0.05, '#fff6b0', rand(-0.5, 0.5), rand(0.8, 1.2), rand(-0.3, 0.3)), v: new V3(rand(-1, 1), rand(1, 2.2), rand(-1, 1)), life: 1 }); } catch (_) { /* fine */ }
    save();
  }
  function closeBath() {
    if (!bath) return;
    const d = bath.dog, tub = bath.tub;
    const out = frontOf(tub);
    d.root.position.set(out ? out.x : tub.i + 0.5, 0, out ? out.z : tub.j + 1.5);
    d.idle(1);
    const done = bath.step === 'done';
    if (done) { spawnEmoji('✨', d.headWorld(0.4), { size: 0.5 }); if (d.flag('splashes')) d.setState('happy', 1.5); }
    bath = null;
    if (done && Math.random() < 0.7) setTimeout(() => { if (place === 'home') shakeOff(d, 'bath'); }, 700);
    $('bath').classList.add('hidden');
    $('bathFull').classList.add('hidden');
  }
  (function bathInput() {
    const c = $('bathCanvas');
    let last = null;
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (bath.W / r.width), (e.clientY - r.top) * (bath.H / r.height)]; };
    c.addEventListener('pointerdown', (e) => { if (!bath) return; e.preventDefault(); last = pt(e); try { c.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } });
    c.addEventListener('pointermove', (e) => {
      if (!last || !bath) return;
      const p = pt(e);
      bathRub(p[0], p[1], Math.hypot(p[0] - last[0], p[1] - last[1]));
      last = p;
    });
    const up = () => { last = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  })();
  $('bathClose').addEventListener('click', closeBath);
  $('bathQuit').addEventListener('click', closeBath);
  $('bathDone').addEventListener('click', closeBath);
  $('bathTurn').addEventListener('click', () => { if (B3 && B3.parts) { if (B3.parts) B3.idleTurns = 0; bathTurn(false); } });

  // =====================================================================
  // Cooking (stove mini game) and treats
  // =====================================================================
  let cook = null;
  function openKitchen() {
    if (!needRank('kitchen')) return;
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
      toast(`${R.name} ${'★'.repeat(stars)} is ready! Give it from a dog's bubble → Treat`);
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
    const tin = Object.entries(state.treats || {}).filter(([k, n]) => n > 0 && D.BAKES[k]);
    $('mealSub').textContent = state.meals.length || tin.length ? `Pick a treat for ${d.name}` : 'No treats yet — cook some at a 🍳 Stove, bake some in an oven, or buy some from vendors on walks.';
    for (const [k, n] of tin) {
      const B = D.BAKES[k], b = document.createElement('button');
      b.className = 'toyCard';
      b.innerHTML = `${thumbOf.pic(B.icon)}<b>${esc(B.name)}</b><small>Homemade ×${n}</small>`;
      b.addEventListener('click', () => giveTreat(d, k));
      L.appendChild(b);
    }
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
    treatDog = d;
    d.life.meals[m.id] = (d.life.meals[m.id] || 0) + 1;
    journalAdd(d, 'meal:' + m.id, R.icon || '🍖', `Tasted ${R.name} for the first time`);
    progress('treat');
    treatDog = null;
    if (E.thirst) d.thirst = Math.min(100, d.thirst + E.thirst * q);
    if (E.energy) d.energy = Math.min(100, d.energy + E.energy * q);
    if (E.clean) d.clean = Math.min(100, d.clean + E.clean * q);
    if (E.happy) d.happy = Math.min(d.missing() ? CONFIG.MISS_CAP : 100, d.happy + E.happy * q * d.mod('mealJoy'));
    d.addBond(E.bond || 1);
    spawnEmoji('😋', d.headWorld(0.4), { size: 0.45 });
    toast(`${d.name} loved the ${R.name}!`);
    $('meals').classList.add('hidden');
    save();
  }
  $('meals').addEventListener('click', (e) => { if (e.target.id === 'meals' || e.target.closest('[data-act="closeMeals"]')) $('meals').classList.add('hidden'); });

  // =====================================================================
  // Wardrobe (accessories)
  // =====================================================================
  let wardDog = null;
  function openWardrobe(d) {
    if (!needRank('boutique')) return;
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
    alltricks: () => dogs.some((d) => BASIC_TRICKS.every((id) => d.trickLvl(id) >= 1)),
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
    for (const [id, O] of Object.entries(D.OUTFITS)) {
      if (!O.unlock || state.outfits.includes(id)) continue;
      const fn = UNLOCK_CHECKS[O.unlock];
      if (fn && fn()) getOutfit(id, true);
    }
    for (const [id, A] of Object.entries(D.ACCESSORIES)) {
      if (!A.unlock || state.accessories.includes(id)) continue;
      const fn = UNLOCK_CHECKS[A.unlock];
      if (fn && fn()) {
        state.accessories.push(id);
        news({ title: 'Outfit unlocked', text: `${A.name}. Dress up in a dog's bubble → Style.`, th: thumbOf.acc(id) });
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
    if (!needRank('gifts')) return;
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
        b.addEventListener('click', () => { if (takeForGift(o)) { f.gift = { id: newId(), kind: o.kind, key: o.key, q: o.q }; afterGiftChange(); toast(`🎁 Packed ${giftLabel(f.gift)}. Share your home from Menu → Settings`); } });
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
      chunks: state.chunks, gardens: Object.keys(state.gardens), rooms: state.rooms, walls: state.walls, stairs: state.stairs,
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
      chunks: p.chunks, rooms: p.rooms || {}, gardens: Object.fromEntries((p.gardens || []).map((k) => [k, true])), walls: p.walls || {}, stairs: p.stairs || null,
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
    haptic();
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
      if (inBounds(tx, tz, 0.3) && !isSolid(tx, tz) && (place === 'home' || !inPond(tx, tz, 0.3)) && (!terrainOn() || lineClear(p.x, p.z, tx, tz))) { ok = true; break; }
    }
    if (!ok) { toast('No room to throw — turn around!'); return; }
    sfx('throw');
    setBallToy(toyId);
    ball.snow = snow;
    ball.arcK = grav ? grav.arc : 1;
    ball.timeK = grav ? grav.time : 1;
    player.hand.getWorldPosition(ball.from);
    ball.gy = groundAt(tx, tz);
    ball.to.set(tx, def.restY + ball.gy, tz);
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
        lerp(ball.from.y, def.restY + (ball.gy || 0), t) + Math.sin(Math.PI * t) * def.arc * (ball.arcK || 1),
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
      ball.mesh.position.y = def.restY + (ball.gy || 0) + Math.abs(Math.sin(ball.bounce * 8)) * def.bounce * fade;
    }
  }
  function updateToyIcons() {
    const k = D.TOYS[state.toy] ? state.toy : 'tennis';
    document.querySelectorAll('.toyIcon').forEach((el) => { if (el.dataset.toy !== k) { el.dataset.toy = k; el.innerHTML = TH('toy', k); } });
  }

  // =====================================================================
  // Scenes: home <-> walks
  // =====================================================================
  let shortWalk = false;
  let walkInfo = null;     // what the walk was like when it started (for records)
  function recordWalk(wasAt) {
    const st = state.stats;
    st.walks = (st.walks || 0) + 1;
    if (curWeather().precip === 'rain' && !(S.env && S.env.noWeather)) st.rainWalks = (st.rainWalks || 0) + 1;
    const first = !state.locWalks[wasAt];
    state.locWalks[wasAt] = (state.locWalks[wasAt] || 0) + 1;
    if (first) gainXP(D.XP_MISC.firstVisit);
    st.longestWalk = Math.max(st.longestWalk || 0, Math.round(walkTotal));
    st.bestWalkCoins = Math.max(st.bestWalkCoins || 0, walkEarn);
    if (walkInfo && walkInfo.night) st.nightWalks = (st.nightWalks || 0) + 1;
    if (walkInfo && walkInfo.storm) st.stormWalks = (st.stormWalks || 0) + 1;
    // a proper walk counts toward your rank and the place; a quick in-and-out doesn't
    shortWalk = walkTotal < 20;
    progress('walk');
    progress('walk:' + wasAt);
    if (!shortWalk) {
      for (const d of dogs) {
        d.life.walks[wasAt] = (d.life.walks[wasAt] || 0) + 1;
        const nm = D.LOCATIONS[wasAt] ? D.LOCATIONS[wasAt].name : 'the park';
        if (!journalAdd(d, 'walk1', '🐾', `Went on a very first walk, in ${nm}`)) journalAdd(d, 'walk:' + wasAt, '🗺️', `First walk in ${nm}`);
      }
      calWalkDone(wasAt, walkInfo);
    }
    shortWalk = false;
  }
  // =====================================================================
  // Seasonal events on the in-game calendar
  // =====================================================================
  const calState = () => {
    if (!state.cal || typeof state.cal !== 'object') state.cal = {};
    const C = state.cal;
    for (const k of ['done', 'prog', 'hunt', 'ann', 'night']) if (!C[k] || typeof C[k] !== 'object') C[k] = {};
    for (const k of ['seen', 'first']) if (!Array.isArray(C[k])) C[k] = [];
    return C;
  };
  const seasonNow = () => D.SEASON_NAMES[seasonOf(clockNow.month)];
  const calDate = (m, d) => `${D.MONTHS[m]} ${d}`;
  function bornCal(d) { return calOf(Math.floor((d.born || Date.now()) / 3600000)); }
  function dogAge(d) {
    const days = clockNow.gameDay - Math.floor((d.born || Date.now()) / 3600000);
    const y = Math.floor(days / CALY), m = Math.floor((days % CALY) / CALD);
    return y >= 1 ? `${y} year${y > 1 ? 's' : ''}${m ? `, ${m} month${m > 1 ? 's' : ''}` : ''}` : m >= 1 ? `${m} month${m > 1 ? 's' : ''}` : `${Math.max(1, days)} day${days > 1 ? 's' : ''}`;
  }
  function birthdayEvents() {
    return dogs.map((d) => {
      const c = bornCal(d);
      return { id: 'bday:' + d.id, bday: d.id, name: `${d.name}’s birthday`, icon: '🎂', m: c.month, d0: c.day, d1: c.day, loc: 'home',
        text: `${d.name} was born on this day.`, task: { kind: 'progress', ev: 'pet', n: 3, how: `Give ${d.name} 3 birthday cuddles` }, reward: { coins: 40, xp: 40 } };
    });
  }
  const calEvents = () => D.CAL_EVENTS.filter((e) => !e.need || locUnlocked(e.need)).concat(birthdayEvents(), tourneyEvents(), discEvents());
  function discEvents() {
    if (!locUnlocked('beach') || !unlockedFeat('disc')) return [];
    const out = [];
    for (let m = 1; m <= 12; m++) for (const d0 of D.DISC.cup) out.push({ id: `discup:${m}:${d0}`, tourney: true, name: 'Disc Cup', icon: '🥏', m, d0, d1: d0, loc: 'beach',
      text: 'Play disc dog on the mat at the beach. Your first round of the day counts for the cup.', task: { kind: 'progress', ev: 'disc', n: 1, how: 'Play a round of disc dog at the beach' }, reward: { coins: 20, xp: 30 } });
    return out;
  }
  const evKnown = (e) => !!e.bday || !!e.tourney || calState().seen.includes(e.id);
  const evRange = (e, y) => [gdOf(y, e.m, e.d0), gdOf(y, e.m, e.d1) + 1];
  function evActive(e) { const [a, b] = evRange(e, clockNow.year); return clockNow.gameDay >= a && clockNow.gameDay < b; }
  const evDone = (e) => calState().done[e.id] === clockNow.year;
  const evKey = (e) => e.id + '@' + clockNow.year;
  const activeEvents = () => calEvents().filter(evActive);
  // when an event comes round next: { a, b, now } in game days
  function evNext(e) {
    for (let y = clockNow.year; y <= clockNow.year + 1; y++) { const [a, b] = evRange(e, y); if (b > clockNow.gameDay) return { y, a, b, now: clockNow.gameDay >= a }; }
    return null;
  }
  const hoursUntil = (gd) => gd - clockNow.gameDay - clockNow.hour / 24;
  function inHours(h) {
    if (h <= 0) return 'now';
    if (h < 1) return `in ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 36) return `in about ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
    return `in about ${Math.round(h / 24)} days`;
  }
  const evHere = (e) => e.loc === 'home' || (place === 'park' && loc === e.loc);
  function evProgressText(e) {
    const C = calState(), k = evKey(e), T = e.task;
    if (evDone(e)) return 'Done this year';
    if (T.kind === 'hunt') return `${(C.hunt[k] || []).length} of ${T.n} found`;
    if (T.kind === 'progress') return `${C.prog[k] || 0} of ${T.n}`;
    return '';
  }
  // reveal an event in the calendar (the first time you are around while it happens, or when its place opens up)
  function revealEvent(e, quiet) {
    const C = calState();
    if (e.bday || C.seen.includes(e.id)) return false;
    C.seen.push(e.id);
    if (!quiet) inboxAdd({ title: 'New in your calendar', text: `${e.name} · ${calDate(e.m, e.d0)}`, th: TH('pic', e.icon) });
    return true;
  }
  function revealPlaceEvents(id) {
    const list = D.CAL_EVENTS.filter((e) => e.need === id && revealEvent(e, true));
    if (list.length) news({ title: 'New in your calendar', text: list.map((e) => e.name).join(', '), th: TH('pic', list[0].icon) });
  }
  let calT = 0;
  function calTick(dt) {
    calT -= dt;
    if (calT > 0 || visit || title || !dogs.length) return;
    calT = 2;
    // a meetup invite now and then
    if (unlockedFeat('meetups')) maybeInvite();
    if (!unlockedFeat('calendar')) return;
    const C = calState();
    for (const e of activeEvents()) {
      revealEvent(e, true);
      if (C.ann[e.id] === clockNow.year || evDone(e)) continue;
      C.ann[e.id] = clockNow.year;
      news({ title: e.bday ? `It’s ${e.name.replace('’s birthday', '')}’s birthday!` : `${e.name} has begun`, text: e.task.how, th: TH('pic', e.icon) });
      save();
    }
  }
  let treatDog = null;
  function calProgress(ev, amt) {
    if (visit || !dogs.length || !unlockedFeat('calendar')) return;
    const C = calState();
    for (const e of activeEvents()) {
      const T = e.task;
      if (T.kind !== 'progress' || T.ev !== ev || evDone(e) || !evHere(e)) continue;
      if (e.bday && (!treatDog || treatDog.id !== e.bday)) continue;
      const k = evKey(e);
      C.prog[k] = Math.min(T.n, (C.prog[k] || 0) + amt);
      if (C.prog[k] >= T.n) completeEvent(e);
      else toast(`${e.icon} ${e.name}: ${C.prog[k]} of ${T.n}`);
    }
  }
  function calWalkDone(wasAt, info) {
    for (const e of activeEvents()) {
      if (e.task.kind !== 'visit' || e.loc !== wasAt || evDone(e)) continue;
      if (e.task.cond === 'rain' && !(info && info.rain) && curWeather().precip !== 'rain') { toast(`${e.icon} ${e.name}: come back when it rains`); continue; }
      completeEvent(e);
    }
  }
  function completeEvent(e) {
    const C = calState();
    if (evDone(e)) return;
    C.done[e.id] = clockNow.year;
    revealEvent(e, true);
    const first = !C.first.includes(e.id);
    if (first) C.first.push(e.id);
    const at = player.root.position.clone().add(new V3(0, 1.2, 0));
    const R = e.reward || {};
    addCoins(R.coins || 0, player.root.position);
    gainXP(R.xp || 0);
    confetti(at, 6);
    sfx('find');
    haptic('strong');
    state.keepsakes = state.keepsakes || {};
    let extra = '';
    if (e.keepsake) {
      const [k, nm] = e.keepsake;
      if (!state.keepsakes[k]) extra = ` · new keepsake: ${nm}`;
      state.keepsakes[k] = (state.keepsakes[k] || 0) + 1;
    }
    news({ title: first ? `You took part in ${e.name}!` : `${e.name}: done again`, text: `🪙 ${R.coins || 0}${extra}`, th: TH('pic', e.keepsake ? e.keepsake[2] : e.icon) });
    if (e.bday) {
      const d = dogs.find((x) => x.id === e.bday);
      if (d) { d.happy = 100; journalAdd(d, null, '🎂', `Had a birthday, ${dogAge(d)} old, with lots of cuddles`); }
    } else {
      for (const d of withYou()) journalAdd(d, first ? 'ev:' + e.id : null, e.icon, first ? `Took part in ${e.name} for the first time` : `Took part in ${e.name} again`);
    }
    save();
  }
  const withYou = () => dogs;
  // night events: stay a little while after dark
  function calNight(dt) {
    const C = calState();
    for (const e of activeEvents()) {
      if (e.task.kind !== 'night' || evDone(e) || !evHere(e)) continue;
      if (!isNight()) { if (!quirk.calNightHint) { quirk.calNightHint = true; toast(`${e.icon} ${e.name} happens after dark`); } continue; }
      const k = evKey(e);
      C.night[k] = (C.night[k] || 0) + dt;
      if (!quirk.calNightOn) { quirk.calNightOn = true; toast(`${e.icon} Stay a little and enjoy ${e.name}`); }
      if (C.night[k] > 25) completeEvent(e);
    }
  }
  // ----- hunts: things to find on a walk -----
  let hunt = [];
  function huntPoints(e, n) {
    const r = ART.mulberry32(hashStr(evKey(e) + '|' + state.uid));
    const b = S.bbox || { x0: -19, x1: 19, z0: -19, z1: 19 }, out = [];
    for (let k = 0; k < 4000 && out.length < n; k++) {
      const x = b.x0 + 1 + r() * (b.x1 - b.x0 - 2), z = b.z0 + 1 + r() * (b.z1 - b.z0 - 2);
      if (z > 15 && Math.abs(x) < 4) continue;
      if (!inBounds(x, z, 0.6) || isSolid(x, z) || isSolid(x + 0.5, z) || isSolid(x - 0.5, z) || isSolid(x, z + 0.5) || isSolid(x, z - 0.5) || inPond(x, z, 0.8)) continue;
      if (S.roofs && S.roofs.some((rf) => rf.test.some((t) => inRectXZ(t, x, z)))) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
      out.push(new V3(x, groundAt(x, z), z));
    }
    return out;
  }
  function startHunts() {
    clearHunts();
    const C = calState();
    for (const e of activeEvents()) {
      if (e.task.kind !== 'hunt' || e.loc !== loc || evDone(e)) continue;
      const got = C.hunt[evKey(e)] || [];
      huntPoints(e, e.task.n).forEach((p, i) => {
        if (got.includes(i)) return;
        const g = ART.huntItem(e.task.item);
        g.scale.setScalar(1.45);
        // a little glint so you can spot them from a distance
        const gl = emojiSprite('✨', 0.32);
        gl.position.y = 0.85;
        g.add(gl);
        g.userData.glint = gl;
        g.position.copy(p);
        g.rotation.y = rand(0, TAU);
        parkRoot.add(g);
        hunt.push({ e, i, g, pos: p, t: rand(0, 6) });
      });
      if (e.task.night && !isNight()) toast(`${e.icon} ${e.name}: come back after dark to find them`);
      else toast(`${e.icon} ${e.name}: ${e.task.how.toLowerCase()}`);
    }
  }
  function clearHunts() { for (const h of hunt) parkRoot.remove(h.g); hunt = []; }
  function updateHunts(dt) {
    if (!hunt.length) return;
    const pp = player.root.position, C = calState();
    for (const h of [...hunt]) {
      const show = !h.e.task.night || isNight();
      h.g.visible = show;
      if (!show) continue;
      h.t += dt;
      h.g.position.y = h.pos.y + (h.g.userData.bob ? 0.12 + Math.sin(h.t * 2.4) * 0.08 : 0);
      if (h.g.userData.glint) h.g.userData.glint.material.opacity = 0.35 + 0.65 * Math.abs(Math.sin(h.t * 1.7));
      if (h.g.userData.spin) h.g.rotation.y += dt * 0.8;
      const me = flatDist(pp, h.pos) < 1.1 && Math.abs(pp.y - h.pos.y) < 0.6;
      const by = me ? null : dogs.find((d) => flatDist(d.root.position, h.pos) < 0.9 && Math.abs(d.root.position.y - h.pos.y) < 0.6);
      if (!me && !by) continue;
      // found one
      parkRoot.remove(h.g);
      hunt.splice(hunt.indexOf(h), 1);
      const k = evKey(h.e);
      C.hunt[k] = (C.hunt[k] || []).concat(h.i);
      const n = C.hunt[k].length, N = h.e.task.n;
      spawnEmoji(h.g.userData.emoji || h.e.icon, h.pos.clone().add(new V3(0, 0.9, 0)), { size: 0.5, life: 1.2, vy: 0.8 });
      sfx('find');
      haptic();
      if (by) { by.happy = Math.min(100, by.happy + 4); spawnEmoji('💛', by.headWorld(0.3), { size: 0.35 }); }
      if (n >= N) completeEvent(h.e);
      else toast(`${h.e.icon} ${n} of ${N}${by ? ` · ${by.name} found one!` : ''}`);
      save();
    }
  }
  // ----- event decorations and sky effects on walks -----
  let calDecor = null;
  function startCalDecor() {
    if (calDecor) { parkRoot.remove(calDecor); calDecor = null; }
    const kinds = activeEvents().filter((e) => e.decor && e.loc === loc).map((e) => e.decor);
    if (!kinds.length || !S.loop) return;
    calDecor = new THREE.Group();
    const L = S.loop, pts = [];
    for (let t = -L.x; t <= L.x; t += 5.5) pts.push([t, L.z0 - 2.1], [t, L.z1 + 2.1]);
    for (let t = L.z0 + 3; t <= L.z1 - 3; t += 5.5) pts.push([-L.x - 2.1, t], [L.x + 2.1, t]);
    let k = 0;
    for (const [x, z] of pts) {
      if (isSolid(x, z) || inPond(x, z, 0.6) || (z > 15 && Math.abs(x) < 3)) continue;
      const g = ART.eventProp(kinds[k++ % kinds.length], k);
      g.position.set(x, groundAt(x, z), z);
      g.rotation.y = Math.atan2(-x, -z);
      calDecor.add(g);
    }
    parkRoot.add(calDecor);
  }
  function endCalDecor() { if (calDecor) { parkRoot.remove(calDecor); calDecor = null; } clearHunts(); clearSkyFX(); }
  const skyFX = [];
  let skyT = 0;
  function clearSkyFX() { for (const p of skyFX) world.remove(p.m); skyFX.length = 0; }
  function updateSkyFX(dt) {
    const fx = isNight() && place === 'park' ? activeEvents().find((e) => e.fx && e.loc === loc) : null;
    skyT -= dt;
    if (fx && skyT <= 0) {
      const pp = player.root.position;
      if (fx.fx === 'fireworks') {
        skyT = rand(0.7, 1.6);
        const c = new V3(pp.x + rand(-6, 6), pp.y + rand(4.5, 6.5), pp.z + rand(-7, -1));
        const col = pick(['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb', '#ffffff']);
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * TAU, up = rand(-0.6, 0.9);
          const m = new THREE.Mesh(fxGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, fog: false }));
          m.position.copy(c);
          world.add(m);
          skyFX.push({ m, v: new V3(Math.cos(a) * 3.2, up * 3, Math.sin(a) * 3.2), life: 1.5, g: 2 });
        }
        sfx('bounce');
      } else if (fx.fx === 'meteors') {
        skyT = rand(0.8, 2.2);
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.6), new THREE.MeshBasicMaterial({ color: '#fffde7', transparent: true, fog: false }));
        m.position.set(pp.x + rand(-8, 8), pp.y + rand(6, 8), pp.z + rand(-9, -3));
        m.rotation.y = 0.8; m.rotation.x = 0.5;
        world.add(m);
        skyFX.push({ m, v: new V3(-7, -3.5, 5), life: 0.9, g: 0 });
      }
    }
    for (const p of [...skyFX]) {
      p.life -= dt;
      p.v.y -= p.g * dt;
      p.m.position.set(p.m.position.x + p.v.x * dt, p.m.position.y + p.v.y * dt, p.m.position.z + p.v.z * dt);
      p.m.material.opacity = Math.max(0, Math.min(1, p.life / 0.6));
      if (p.life <= 0) { world.remove(p.m); skyFX.splice(skyFX.indexOf(p), 1); }
    }
  }
  const fxGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  // ----- seasons you can see: falling leaves in autumn, blossom petals in spring -----
  const seasonFX = (() => {
    const N = 46, mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.03, 0.09), new THREE.MeshLambertMaterial({ color: '#ffffff' }), N);
    mesh.frustumCulled = false;
    mesh.visible = false;
    world.add(mesh);
    const P = [], m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), ax = new V3(0.6, 0.8, 0.2).normalize(), s4 = new V3(1, 1, 1), c4 = new THREE.Color(), p4 = new V3();
    for (let k = 0; k < N; k++) P.push({ x: rand(-12, 12), y: rand(0, 7), z: rand(-12, 12), s: rand(0.4, 0.9), r: rand(0, TAU), w: rand(0.5, 1.5) });
    let kind = null;
    return {
      update(dt) {
        const sea = seasonOf(clockNow.month);
        const want = place === 'park' && !(S && S.env && (S.env.noWeather || S.env.dark)) && !curWeather().precip ? (sea === 'autumn' ? 'leaves' : sea === 'spring' ? 'petals' : null) : null;
        mesh.visible = !!want;
        if (!want) return;
        if (kind !== want) {
          kind = want;
          const cols = want === 'leaves' ? ['#e65100', '#f9a825', '#c62828', '#ef6c00', '#8d6e63'] : ['#f8bbd0', '#ffffff', '#f48fb1', '#fce4ec'];
          for (let k = 0; k < N; k++) mesh.setColorAt(k, c4.set(cols[k % cols.length]));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        const c = camLook;
        P.forEach((p, k) => {
          p.y -= dt * p.s;
          p.r += dt * p.w;
          p.x += Math.sin(p.r) * dt * 0.6 + dt * 0.3;
          if (p.y < 0) { p.y = rand(5, 8); p.x = rand(-12, 12); p.z = rand(-12, 12); }
          q4.setFromAxisAngle(ax, p.r);
          m4.compose(p4.set(c.x + p.x, groundAt(c.x + p.x, c.z + p.z) + p.y, c.z + p.z), q4, s4);
          mesh.setMatrixAt(k, m4);
        });
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
  })();
  // ----- the calendar page (from the weather) -----
  let calView = null;
  function openCalendar() {
    calView = { y: clockNow.year, m: clockNow.month, sel: clockNow.day };
    renderCalendar();
  }
  function renderCalendar() {
    const V = calView, today = V.y === clockNow.year && V.m === clockNow.month;
    const evs = calEvents().filter(evKnown);
    const on = (d) => evs.filter((e) => e.m === V.m && d >= e.d0 && d <= e.d1);
    const meet = state.meetup && !state.meetup.met ? state.meetup : null;
    const meetOn = (d) => meet && (() => { const gd = gdOf(V.y, V.m, d); return gd >= meet.from && gd < meet.until; })();
    let grid = '';
    for (let d = 1; d <= CALD; d++) {
      const list = on(d), past = V.y < clockNow.year || (today && d < clockNow.day);
      grid += `<button class="calDay${today && d === clockNow.day ? ' today' : ''}${past ? ' past' : ''}${V.sel === d ? ' sel' : ''}" data-cday="${d}"><small>${d}</small><span>${list.slice(0, 2).map((e) => TH('pic', e.icon)).join('')}${meetOn(d) ? IC('wave') : ''}</span></button>`;
    }
    const sel = on(V.sel);
    const selHTML = sel.length || meetOn(V.sel) ? sel.map((e) => calEventRow(e)).join('') + (meetOn(V.sel) ? meetRow() : '') : `<p class="sub">Nothing on ${calDate(V.m, V.sel)} yet.</p>`;
    // what's coming up
    const soon = evs.map((e) => ({ e, n: evNext(e) })).filter((x) => x.n && !(x.n.now && evDone(x.e))).sort((a, b) => a.n.a - b.n.a).slice(0, 4);
    $('calView').innerHTML =
      `<div class="calHead"><button class="soft calNav" data-cnav="-1" aria-label="Previous month">${IC('left')}</button>` +
      `<div><b>${D.MONTHS[V.m]}</b><small>${D.SEASON_NAMES[seasonOf(V.m)]} · year ${V.y}</small></div>` +
      `<button class="soft calNav" data-cnav="1" aria-label="Next month">${IC('right')}</button></div>` +
      `<p class="sub small">Today is ${calDate(clockNow.month, clockNow.day)}. A game day lasts an hour, so a month goes by in a day.</p>` +
      `<div class="calGrid">${grid}</div>` +
      `<div class="section">${calDate(V.m, V.sel)}</div>${selHTML}` +
      `<div class="section">${IC('star')}Coming up</div>${soon.map((x) => calEventRow(x.e, x.n)).join('') || '<p class="sub">Nothing yet.</p>'}` +
      `<p class="sub small">More events appear in your calendar as you explore new places and take part.</p>`;
  }
  function calEventRow(e, n) {
    n = n || evNext(e);
    const when = !n ? '' : n.now ? `On now · ends ${inHours(hoursUntil(n.b))}` : `${calDate(e.m, e.d0)}${e.d1 > e.d0 ? `–${e.d1}` : ''} · starts ${inHours(hoursUntil(n.a))}`;
    const where = e.loc === 'home' ? 'Anywhere' : D.LOCATIONS[e.loc] ? D.LOCATIONS[e.loc].name : '';
    const prog = n && n.now ? evProgressText(e) : '';
    return `<div class="row calEv${n && n.now ? ' live' : ''}${evDone(e) && n && n.now ? ' done' : ''}"><div class="ic">${TH('pic', e.icon)}</div><div class="txt"><b>${esc(e.name)}</b><small>${esc(when)} · ${esc(where)}</small><small>${esc(e.task.how)}${prog ? ` · ${esc(prog)}` : ''}</small></div></div>`;
  }
  function meetRow() {
    const M = state.meetup;
    return `<div class="row calEv live"><div class="ic"><img class="th" src="${ART.personPortraitURL(neighborInfo(M.owner))}" alt=""></div><div class="txt"><b>Meet ${esc(M.owner)}</b><small>${esc(M.spot[0])} · ${esc(D.LOCATIONS[M.loc].name)}</small><small>Waiting for you, for ${inHours(hoursUntil(M.until)).replace(/^in (about )?/, 'about ')} more</small></div></div>`;
  }
  $('weather').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-wxtab]');
    if (tab) { setWxTab(tab.dataset.wxtab); return; }
    const nav = e.target.closest('[data-cnav]');
    if (nav && calView) {
      calView.m += +nav.dataset.cnav;
      if (calView.m < 1) { calView.m = 12; calView.y--; }
      if (calView.m > 12) { calView.m = 1; calView.y++; }
      calView.sel = calView.y === clockNow.year && calView.m === clockNow.month ? clockNow.day : 1;
      renderCalendar();
      return;
    }
    const day = e.target.closest('[data-cday]');
    if (day && calView) { calView.sel = +day.dataset.cday; renderCalendar(); }
  });
  function setWxTab(t) {
    document.querySelectorAll('#weather [data-wxtab]').forEach((b) => b.classList.toggle('sel', b.dataset.wxtab === t));
    $('wxPage').classList.toggle('hidden', t !== 'weather');
    $('calView').classList.toggle('hidden', t !== 'cal');
    if (t === 'cal') openCalendar();
  }

  // =====================================================================
  // Neighbor meetups: any neighbor may ask you to meet them somewhere, now and then
  // =====================================================================
  const neighborInfo = (owner) => D.NEIGHBORS.find((N) => N.owner === owner) || D.NEIGHBORS[0];
  function meetupLive() {
    const M = state.meetup;
    if (!M) return null;
    if (clockNow.gameDay >= M.until || !D.LOCATIONS[M.loc]) { state.meetup = null; return null; }
    return M.met ? null : M;
  }
  function maybeInvite(force) {
    if (visit || title || !dogs.length || (!unlockedFeat('meetups') && !force)) return;
    if (meetupLive()) return;
    // the first invite comes a little while after meetups open up
    if (!state.lastInvite && !force) { state.lastInvite = clockNow.gameDay; return; }
    const last = state.lastInvite || 0;
    if (!force && clockNow.gameDay - last < 6) return;
    state.lastInvite = clockNow.gameDay;
    if (!force && Math.random() > 0.45) return;
    const found = (l, id) => hiddenOf(l).includes(id);
    const places = Object.keys(D.MEET_SPOTS).filter((l) => locUnlocked(l));
    const l = pick(places);
    const spots = D.MEET_SPOTS[l].filter((sp) => !sp[3] || found(l, sp[3]));
    const N = pick(D.NEIGHBORS), sp = pick(spots);
    state.meetup = { owner: N.owner, loc: l, spot: sp.slice(0, 3), from: clockNow.gameDay, until: clockNow.gameDay + 4, met: false };
    const line = pick(D.MEET_INVITES).replace(/\{ndog\}/g, N.dog.name).replace(/\{dog\}/g, pick(dogs).name).replace(/\{spot\}/g, sp[0]).replace(/\{place\}/g, D.LOCATIONS[l].name);
    news({ title: `${N.owner} invites you`, text: `“${line}”`, th: `<img class="th" src="${ART.personPortraitURL(N)}" alt="">` });
    save();
  }
  // on a walk to the right place, the neighbor waits at the spot
  function placeMeetup() {
    const M = meetupLive();
    if (!M || M.loc !== loc) return;
    const w = walkers.find((x) => x.info.owner === M.owner);
    if (!w) return;
    const [, x, z] = M.spot;
    w.meet = true;
    w.pause = 1e9;
    w.parts.root.position.set(x, groundAt(x, z), z);
    w.dog.root.position.set(x + 0.9, groundAt(x + 0.9, z + 0.6), z + 0.6);
    w.label.visible = true;
    toast(`${M.owner} is waiting at ${M.spot[0]}`);
  }
  function finishMeetup(w) {
    const M = state.meetup;
    if (!M || M.met || !w.meet) return null;
    M.met = true;
    const N = w.info;
    const coins = 25 + Math.floor(Math.random() * 20);
    addCoins(coins, w.parts.root.position);
    gainXP(30);
    for (const d of withYou()) {
      d.happy = Math.min(100, d.happy + 15);
      addFriendship(d, w.dog, 3);
      journalAdd(d, null, '👋', `Met ${N.dog.name} and ${N.owner} at ${M.spot[0]} in ${D.LOCATIONS[M.loc].name}`);
    }
    state.meetups = (state.meetups || 0) + 1;
    confetti(w.parts.root.position.clone().add(new V3(0, 1.4, 0)), 4);
    haptic();
    save();
    return pick(D.MEET_LINES).replace(/\{ndog\}/g, N.dog.name).replace(/\{dog\}/g, pick(dogs).name);
  }

  // =====================================================================
  // Dog journals: a scrapbook for every dog
  // =====================================================================
  // k = a key for things that only happen once (first walk, first trick...); entries keep the in-game date
  function journalAdd(d, k, ic, tx) {
    if (!d || visit) return false;
    d.journal = d.journal || [];
    if (k && d.journal.some((e) => e.k === k)) return false;
    d.journal.push({ k: k || undefined, t: Date.now(), gd: clockNow.gameDay, ic, tx });
    if (d.journal.length > 140) {
      const i = d.journal.findIndex((e, n) => n > 0 && !e.k && !e.ph);
      d.journal.splice(i > 0 ? i : 1, 1);
    }
    return true;
  }
  const journalFirst = (d, k, ic, tx) => journalAdd(d, k, ic, tx);
  function favOf(obj) { let best = null, bv = 0; for (const [k, v] of Object.entries(obj || {})) if (v > bv) { bv = v; best = k; } return best; }
  function bestDogFriend(d) {
    let best = null, bv = 0;
    for (const o of dogs) { if (o === d) continue; const v = friendship(d.id, o.id); if (v > bv) { bv = v; best = o.name; } }
    for (const N of D.NEIGHBORS) { const v = friendship(d.id, 'n:' + N.dog.name); if (v > bv) { bv = v; best = N.dog.name; } }
    return best;
  }
  let journalDog = null;
  function openJournal(d) {
    journalDog = d;
    renderJournal();
    $('journal').classList.remove('hidden');
  }
  function renderJournal() {
    const d = journalDog;
    if (!d) return;
    const B = D.BREEDS[d.breed], C = ART.coatOf(d.breed, d.coat), bc = bornCal(d), L = d.life;
    const toy = d.favToy && D.TOYS[d.favToy] ? D.TOYS[d.favToy] : null;
    const placeK = favOf(L.walks), meal = favOf(L.meals), friend = bestDogFriend(d), spot = d.favSpot;
    const fav = (ic, label, val) => `<div class="jFav">${ic}<small>${label}</small><b>${esc(val || 'Not yet')}</b></div>`;
    const tricksKnown = Object.keys(ALL_TRICKS).filter((id) => d.trickLvl(id) >= 1).length;
    const photos = (state.photos || []).filter((p) => p.dogs.includes(d.id)).slice(-6).reverse();
    const entries = [...(d.journal || [])].reverse();
    let lastMonth = '';
    const story = entries.map((e) => {
      const c = calOf(e.gd != null ? e.gd : Math.floor(e.t / 3600000));
      const head = `${D.MONTHS[c.month]}, year ${c.year}`;
      const h = head !== lastMonth ? `<div class="jMonth">${head}</div>` : '';
      lastMonth = head;
      return `${h}<div class="jEntry">${TH('pic', e.ic || '🐾')}<div><small>${D.MONTHS[c.month]} ${c.day}</small><span>${esc(plain(personal(e.tx)))}</span>${e.ph ? `<img class="jPhoto" src="${e.ph}" alt="">` : ''}</div></div>`;
    }).join('');
    $('jBody').innerHTML =
      `<div class="jCover"><img class="portrait" src="${ART.portraitURL(d.breed, d.coat)}" alt=""><div><h3>${esc(d.name)}</h3>` +
      `<small>${esc(C.name)} ${esc(B ? B.name : '')}${d.grown ? '' : ' puppy'}</small><small>Born ${D.MONTHS[bc.month]} ${bc.day} · ${esc(dogAge(d))} old</small>` +
      `<div class="jTraits">${d.revealed ? d.traits.map((t) => `<span class="chip">${esc(D.TRAITS[t].name)}</span>`).join('') : '<span class="chip">Personality still a mystery</span>'}</div></div></div>` +
      `<div class="section">${IC('heart')}Favourites</div><div class="jFavs">` +
      fav(IC('ball'), 'Toy', toy && toy.name) + fav(IC('map'), 'Place', placeK && D.LOCATIONS[placeK] && D.LOCATIONS[placeK].name) +
      fav(IC('treat'), 'Treat', meal && D.RECIPES[meal] && D.RECIPES[meal].name) + fav(IC('dog'), 'Friend', friend) +
      fav(IC('home'), 'Spot at home', spot && D.ITEMS[spot] ? D.ITEMS[spot].name : spot ? 'By the window' : null) + fav(IC('cap'), 'Tricks', tricksKnown ? `${tricksKnown} known` : null) + `</div>` +
      `<div class="jNums"><span><b>${Object.values(L.walks).reduce((a, b) => a + b, 0)}</b><small>walks</small></span><span><b>${L.fetches || 0}</b><small>fetches</small></span><span><b>${L.finds || 0}</b><small>things sniffed out</small></span><span><b>${d.hearts()}</b><small>hearts</small></span></div>` +
      (photos.length ? `<div class="section">${IC('camera')}Photos</div><div class="jPhotos">${photos.map((p) => `<img src="${p.url}" alt="">`).join('')}</div>` : '') +
      `<div class="section">${IC('book')}Story so far</div>${story || '<p class="sub">The story starts here.</p>'}`;
  }
  $('journal').addEventListener('click', (e) => { if (e.target.id === 'journal' || e.target.closest('[data-act="closeJournal"]')) $('journal').classList.add('hidden'); });

  // =====================================================================
  // While you were away: a little summary when you come back
  // =====================================================================
  function awayLines() {
    const A = D.AWAY, used = new Set(state.awayUsed || []), out = [];
    const take = (pool, key) => {
      const all = pool.map((t, i) => [t, key + i]);
      const fresh = all.filter(([, id]) => !used.has(id));
      const [t, id] = pick(fresh.length ? fresh : all);
      used.add(id);
      return t;
    };
    const furn = [...new Set(state.furniture.map((f) => f.type))].filter((t) => A.furn[t]);
    const nb = pick(D.NEIGHBORS);
    const fill = (t, d, o) => t.replace(/\{dog\}/g, d.name).replace(/\{other\}/g, o ? o.name : '').replace(/\{toy\}/g, d.favToy && D.TOYS[d.favToy] ? D.TOYS[d.favToy].name.toLowerCase() : 'ball')
      .replace(/\{neighbor\}/g, nb.owner).replace(/\{ndog\}/g, nb.dog.name).replace(/\{furn\}/g, furn.length ? D.ITEMS[pick(furn)].name.toLowerCase() : 'rug');
    for (const d of shuffle(dogs).slice(0, 3)) {
      const opts = [];
      if (d.revealed) d.traits.forEach((t) => { if (A.trait[t]) opts.push([A.trait[t], 'tr:' + t, 3]); });
      if (A.breed[d.breed]) opts.push([A.breed[d.breed], 'br:' + d.breed, 1.2]);
      for (const t of furn) opts.push([A.furn[t], 'fu:' + t, 2.4 / furn.length]);
      if (d.favToy) opts.push([A.toy, 'toy', 1.2]);
      if (!d.grown) opts.push([A.puppy, 'pup', 3]);
      if (d.hunger < 45) opts.push([A.hungry, 'hun', 2.5]);
      if (awayHours > 20) opts.push([A.long, 'long', 1.4]);
      opts.push([A.general, 'gen', 1.6]);
      let r = Math.random() * opts.reduce((s, o) => s + o[2], 0), ch = opts[opts.length - 1];
      for (const o of opts) { r -= o[2]; if (r <= 0) { ch = o; break; } }
      out.push({ d, tx: fill(take(ch[0], ch[1]), d) });
    }
    if (dogs.length >= 2) {
      const [a, b] = shuffle(dogs);
      out.push({ d: a, d2: b, tx: fill(take(A.pair, 'pair'), a, b) });
    }
    const wk = curWeather().lightning ? 'storm' : curWeather().precip || (curWeather().fog ? 'fog' : weatherId === 'sun' ? 'sun' : null);
    if (wk && A.weather[wk] && Math.random() < 0.6) { const d = pick(dogs); out.push({ d, tx: fill(take(A.weather[wk], 'wx:' + wk), d) }); }
    else if (Math.random() < 0.3) { const d = pick(dogs); out.push({ d, tx: fill(take(A.night, 'night'), d) }); }
    state.awayUsed = [...used].slice(-80);
    return out.slice(0, 5);
  }
  function showAway() {
    if (visit || !dogs.length || awayHours < 0.75) return false;
    if (state.awayDay === clockNow.dateKey && awayHours < 4) return false;
    state.awayDay = clockNow.dateKey;
    const lines = awayLines();
    const h = awayHours;
    $('awaySub').textContent = h >= 48 ? `You were away for ${Math.round(h / 24)} days.` : h >= 1.5 ? `You were away for ${Math.round(h)} hours.` : 'You were away for a little while.';
    $('awayTitle').textContent = youName() ? `While you were away, ${youName()}` : 'While you were away';
    $('awayList').innerHTML = lines.map((l) => `<div class="awayRow"><img class="portrait" src="${ART.portraitURL(l.d.breed, l.d.coat)}" alt="">${l.d2 ? `<img class="portrait two" src="${ART.portraitURL(l.d2.breed, l.d2.coat)}" alt="">` : ''}<span>${esc(l.tx)}</span></div>`).join('');
    $('away').classList.remove('hidden');
    // the nicest line goes into the journal too
    const keep = lines[0];
    if (keep) journalAdd(keep.d, null, '🏠', keep.tx);
    save();
    return true;
  }
  $('away').addEventListener('click', (e) => { if (e.target.id === 'away' || e.target.closest('[data-act="closeAway"]')) { $('away').classList.add('hidden'); pumpTips(); } });

  // =====================================================================
  // What's new: when lots of news arrive at once, the rest wait here (Menu → What's new)
  // =====================================================================
  function inboxAdd(o) {
    state.inbox = state.inbox || [];
    state.inbox.unshift({ title: o.title || '', text: o.text || '', th: o.th || '', icon: o.icon || '', at: Date.now(), read: false });
    state.inbox = state.inbox.filter((x) => Date.now() - x.at < 7 * 86400000).slice(0, 40);
    renderInboxTile();
  }
  const inboxUnread = () => (state.inbox || []).filter((x) => !x.read).length;
  function renderInboxTile() {
    const n = inboxUnread(), t = $('tileInbox');
    if (!t) return;
    t.classList.toggle('hidden', !n);
    $('inboxBadge').textContent = String(n);
  }
  function openInbox() {
    const list = state.inbox || [];
    $('inboxList').innerHTML = list.map((x) => `<div class="row inboxRow${x.read ? '' : ' unread'}"><div class="ic">${x.th || IC(x.icon || 'sparkle')}</div><div class="txt"><b>${esc(plain(x.title))}</b><small>${esc(plain(x.text))}</small></div></div>`).join('') || '<p class="sub">Nothing new.</p>';
    list.forEach((x) => { x.read = true; });
    $('inbox').classList.remove('hidden');
    renderInboxTile();
    save();
  }
  $('inbox').addEventListener('click', (e) => { if (e.target.id === 'inbox' || e.target.closest('[data-act="closeInbox"]')) $('inbox').classList.add('hidden'); });

  // =====================================================================
  // What now? A few good next steps (in the You menu)
  // =====================================================================
  function whatNow() {
    const out = [];
    const add = (ic, text, go, label = 'Go') => out.push({ ic, text, go, label });
    const home = place === 'home';
    const thirsty = dogs.filter((d) => d.thirst < 40 || d.hunger < 40);
    if (thirsty.length) add(IC('food'), `${thirsty.map((d) => d.name).join(' and ')} could do with food and water.`, home ? 'bowls' : 'home', home ? 'Fill bowls' : 'Go home');
    const dirty = dogs.filter((d) => d.clean < 35);
    if (dirty.length && unlockedFeat('bath')) add(IC('bath'), `${dirty[0].name} is quite dirty. A bath would help.`, 'bath:' + dirty[0].id, 'Bath');
    const tired = dogs.filter((d) => d.energy < 20);
    if (tired.length && !home) add(IC('bolt'), `${tired[0].name} is tired. Time to head home for a nap.`, 'home', 'Go home');
    if (unlockedFeat('calendar')) {
      for (const e of activeEvents().filter((x) => evKnown(x) && !evDone(x))) add(TH('pic', e.icon), `${e.name}: ${e.task.how}.${e.task.kind === 'hunt' ? ` ${evProgressText(e)}.` : ''}`, e.loc === 'home' ? '' : 'walk:' + e.loc, e.loc === 'home' ? '' : 'Go');
    }
    const M = meetupLive();
    if (M) add(`<img class="th" src="${ART.personPortraitURL(neighborInfo(M.owner))}" alt="">`, `${M.owner} is waiting for you at ${M.spot[0]} in ${D.LOCATIONS[M.loc].name}.`, 'walk:' + M.loc, 'Go');
    if (state.daily && unlockedFeat('daily')) { const left = state.daily.items.filter((c) => !c.done).length; if (left) add(IC('list'), `${left} of today’s challenges still to do.`, 'daily', 'See them'); }
    if (unlockedFeat('stories')) { const w = Object.keys(D.STORIES).filter((o) => storyOf(o) && storyChapter(o) && storyReady(o)); if (w.length) add(IC('wave'), `${w[0]} has something to tell you. Look out for them on a walk.`, 'people', 'Neighbors'); }
    const next = Object.keys(D.LOCATIONS).find((id) => !locUnlocked(id) && locNext(id));
    if (next) { const open = reqsOf(next).filter((U) => { const [a, b] = reqProgress(U); return a < b; }); if (open.length) add(IC('lock'), `Next place: ${plain(reqText(open[0]))}.`, 'map', 'Map'); }
    for (const id of Object.keys(D.LOCATIONS)) { const t = hiddenTotal(id), f = hiddenOf(id).length; if (locUnlocked(id) && t && f < t && (state.locWalks || {})[id]) { add(IC('search'), `${t - f} hidden spot${t - f > 1 ? 's' : ''} still to find in ${D.LOCATIONS[id].name}.`, 'walk:' + id, 'Go'); break; } }
    if (inboxUnread()) add(IC('sparkle'), `${inboxUnread()} new thing${inboxUnread() > 1 ? 's' : ''} in What’s new.`, 'inbox', 'Read');
    // hobbies
    if (unreadMail()) add(IC('chat'), `${unreadMail()} letter${unreadMail() > 1 ? 's' : ''} in your mailbox.`, '', '');
    if (state.tmap) add(TH('pic', '🗺️'), `You have a treasure map for ${D.LOCATIONS[state.tmap.loc].name}.`, 'tmap', 'Map');
    if (state.sitting && !state.sitting.pending) { const N = D.NEIGHBORS.find((x) => x.owner === state.sitting.owner); if (N) add(TH('dog', `${N.dog.breed}|${N.dog.coat}`), state.sitting.ready ? `${state.sitting.owner} is at your door to pick up ${N.dog.name}.` : `${N.dog.name} is staying with you. A walk and some cuddles make for a happy dog.`, state.sitting.ready ? 'home' : '', state.sitting.ready ? 'Go home' : ''); }
    const ripe = (state.beds || []).filter((b) => b.seed && b.stage >= 4 && !D.SEEDS[b.seed].flower).length;
    if (ripe) add(IC('sprout'), `${ripe} bed${ripe > 1 ? 's are' : ' is'} ready to pick in your garden.`, home ? '' : 'home', home ? '' : 'Go home');
    if (locUnlocked('grounds') && tourneyToday() && agi().entered !== clockNow.gameDay) add(TH('pic', '🏆'), `It’s tournament day at the Tournament Grounds (${D.CLASSES[agi().cls]}).`, 'walk:grounds', 'Go');
    if (unlockedFeat('disc') && locUnlocked('beach') && discCupToday() && disc().cupDay !== clockNow.gameDay) add(TH('pic', '🥏'), `Disc Cup today at the beach (${D.CLASSES[disc().cls]}).${state.toys.includes('frisbee') ? '' : ' You’ll need a frisbee from the kiosk.'}`, 'walk:beach', 'Go');
    if (unlockedFeat('market') && locUnlocked('oldtown') && marketDay() && state.marketDay !== clockNow.gameDay) add(TH('pic', '🧺'), 'It’s market day in Old Town. Bring crops, treats or bouquets to sell.', 'walk:oldtown', 'Go');
    if (unlockedFeat('museum') && locUnlocked('oldtown') && state.museum && state.museum.pending >= 20) add(TH('pic', '🏛️'), `The museum is holding 🪙 ${Math.floor(state.museum.pending)} in ticket money for you.`, 'walk:oldtown', 'Go');
    if (unlockedFeat('museum') && locUnlocked('oldtown') && (!state.museum || !Object.values(state.museum.halls || {}).some((h) => h.slots.some(Boolean)))) add(TH('pic', '🏛️'), 'The museum in Old Town would love to show some of your finds.', 'walk:oldtown', 'Go');
    // pastimes that fit right now
    const kind = pileKind();
    if (kind && unlockedFeat('piles') && out.length < 5) add(IC('rake'), kind === 'snow' ? 'It’s snowy: shovel a snow pile for your dogs to jump in.' : 'Leaves are falling: rake a pile for your dogs to jump in.', home ? '' : '', '');
    if (unlockedFeat('stars') && nightLevel > 0.55 && clearSky() && dogs.some((d) => !(state.starNames || {})[d.id]) && out.length < 5) add(IC('star'), 'It’s a clear night. Lie down outside and look for your dogs in the stars.', '', '');
    const fluff = dogs.find((d) => !d.fluffed && d.clean > 50);
    if (fluff && unlockedFeat('brush') && out.length < 5 && Math.random() < 0.5) add(IC('brush'), `${fluff.name} would love a brush.`, 'play:' + fluff.id, 'Brush');
    if (unlockedFeat('hideseek') && out.length < 4) add(IC('hide'), `Play hide and seek with ${pick(dogs).name}.`, 'play:' + dogs[0].id, 'Play');
    if (out.length < 3) add(IC('walk'), `Take ${pick(dogs).name} for a walk. There’s always something to sniff.`, 'map', 'Map');
    return out.slice(0, 6);
  }
  function renderWhatNow() {
    const list = whatNow();
    $('crNow').innerHTML = `<p class="sub">A few ideas for what to do next.</p>` + list.map((x, i) => `<div class="row wnRow"><div class="ic">${x.ic}</div><div class="txt"><small>${esc(plain(x.text))}</small></div>${x.go ? `<button class="soft" data-wn="${i}">${esc(x.label)}</button>` : ''}</div>`).join('');
    $('crNow').dataset.list = JSON.stringify(list.map((x) => x.go));
  }
  $('crNow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wn]');
    if (!b) return;
    const go = JSON.parse($('crNow').dataset.list || '[]')[+b.dataset.wn];
    closeCreator();
    if (go === 'bowls') fillAll();
    else if (go === 'home') { if (place === 'park') goHome(); }
    else if (go === 'map') openMap();
    else if (go === 'daily') openDaily();
    else if (go === 'people') openPeople();
    else if (go === 'inbox') openInbox();
    else if (go.startsWith('bath:')) { const d = dogs.find((x) => x.id === go.slice(5)); if (place !== 'home') toast('Baths happen at home 🛁'); else if (d) openBath(d); }
    else if (go.startsWith('walk:')) { if (place === 'park' && loc === go.slice(5)) toast('You are already here!'); else openMap(); }
    else if (go.startsWith('play:')) { const d = dogs.find((x) => x.id === go.slice(5)); if (d) openPlay(d); }
    else if (go === 'tmap') openTreasureMap();
  });

  // =====================================================================
  // Little buzzes (off by default; Settings). iPhones have no vibration API, but a switch toggle buzzes.
  // =====================================================================
  const hapticEl = (() => {
    const l = document.createElement('label');
    l.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    l.innerHTML = '<input type="checkbox" switch>';
    document.body.appendChild(l);
    return l;
  })();
  let hapticLast = 0;
  function haptic(kind) {
    if (!prefs.haptics) return;
    const now = performance.now();
    if (now - hapticLast < 60) return;
    hapticLast = now;
    try {
      if (navigator.vibrate) navigator.vibrate(kind === 'strong' ? [18, 40, 18] : 12);
      else hapticEl.click();
    } catch (_) { /* no buzz on this phone */ }
  }
  function applyBigUI() { document.body.classList.toggle('bigui', !!prefs.bigui); }

  // =====================================================================
  // New furniture: the dogs come and check it out
  // =====================================================================
  let furnNew = [];
  function reactToFurniture() {
    const list = furnNew;
    furnNew = [];
    if (place !== 'home' || !dogs.length) return;
    const seen = new Set();
    let delay = 0.6;
    for (const f of list) {
      if (seen.has(f.type) || !state.furniture.includes(f)) continue;
      seen.add(f.type);
      const free = dogs.filter((d) => ['idle', 'sit', 'wander'].includes(d.state) || d.state === 'follow');
      const d = pick(free.length ? free : dogs);
      const R = D.FURN_REACT[f.type] || ['sniffs it all over', '🤔'];
      const it = D.ITEMS[f.type];
      setTimeout(() => {
        const to = frontOf(f) || new V3(f.i + 0.5, 0, f.j + 1.5);
        d.goTo(to, 2.6, () => {
          d.faceTo(new V3(f.i + 0.5, 0, f.j + 0.5));
          d.setState('happy', 1.4);
          spawnEmoji(R[1], d.headWorld(0.35), { size: 0.45, life: 1.6 });
          toast(`${d.name} ${R[0]}`);
          if (journalAdd(d, 'furn:' + f.type, it.icon, `Checked out the new ${it.name.toLowerCase()}: ${R[0]}`)) save();
        }, 0.5);
      }, delay * 1000);
      delay += 1.6;
      if (seen.size >= 3) break;
    }
  }

  const SHAPE_TIPS = {
    park: 'There is more to explore now: a hill with a view, a sunken pond and a meadow to the east. Not every corner is easy to find.',
    beach: 'There is more to explore now: dunes, a boardwalk and a rocky headland with stairs up to the lighthouse. Some places only show at the right tide.',
    oldtown: 'There is more to explore now: steps lead down to the old canal in the east. And not every door in town is what it seems.',
    forest: 'The forest has grown: a mossy dell lies past the west glade, and a rocky terrace rises in the north-east. Listen for water.',
    alpine: 'There’s a real mountain to climb now, north of the meadow. The view from the top is worth it.',
    caves: 'The tunnels go further now, east and west. One of them leads down, deep under the mountain.',
    snowy: 'The village has grown: a frozen pond lies in a hollow to the west, and a snowy ridge rises in the east.',
    carnival: 'There’s a boardwalk in the east now, with the big top on it. And the north-west corner is quieter than it looks.',
    fairy: 'A soft green hill has appeared in the north. Fairies love hills.',
    moon: 'The base has grown: a huge crater to the east and a mesa to the west. Low gravity makes the climbing easy.',
    grounds: 'Three agility rings, the stands in the east and the judges’ tent in the far corner.',
  };
  function goWalk(id = 'park') {
    if (!dogs.length) return;
    if (!locUnlocked(id)) { toast('That place is still locked 🔒'); return; }
    if (!canVisitNow(id)) { toast(`${D.LOCATIONS[id].icon} ${D.LOCATIONS[id].name} is closed right now — it opens at ${D.LOCATIONS[id].hours[0]}:00`); return; }
    endFun('leave');
    clearPatches();
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
    player.root.position.set(0, groundAt(0, 16), 16);
    player.root.rotation.y = player.face = Math.PI;
    if (S.roofs) S.roofs.forEach((r) => { r.fade = 1; r.mats.forEach((m) => { m.opacity = 1; m.depthWrite = true; if (m.transparent) { m.transparent = false; m.needsUpdate = true; } }); });
    walkTotal = 0;
    walkInfo = { night: nightLevel > 0.5, storm: !!curWeather().lightning, rain: curWeather().precip === 'rain' };
    dogs.forEach((d, i) => {
      d.releaseClaim();
      d.dropSpot();
      d.onArrive = null;
      d.path = null;
      d.zoomLeft = 0;
      d.root.position.set(-0.6 * (dogs.length - 1) / 2 + i * 0.6, groundAt(0, 17.3), 17.3);
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
    if (unlockedFeat('calendar')) { startHunts(); startCalDecor(); }
    spawnPatches();
    spawnDucks();
    spawnBottle();
    round3Walk();
    walkStartT = Date.now();
    if (sitDog) { sitDog.reset && sitDog.releaseClaim(); sitDog.root.position.set(0.9, groundAt(0.9, 17.3), 17.3); sitDog.root.rotation.y = sitDog.face = Math.PI; sitDog.setState('follow'); if (state.sitting) state.sitting.walks = (state.sitting.walks || 0) + 1; }
    placeMeetup();
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
      grounds: 'The Tournament Grounds! 🏁 Stand on a ring’s red mat to train · tournaments on the 8th and 20th',
    }[loc];
    arriveFade();
    eventOnArrive();
    const first = intro && tip('visit:' + loc, { title: LOC().name, text: intro, th: TH('loc', loc) });
    if (!first) toast(intro || (parkLoot ? 'Walk time! Something is glinting in the grass… ✨' : W.muddy ? `Walk time! It's ${W.name.toLowerCase()} — expect muddy paws 🐾` : 'Walk time! Let your dog sniff the ✨ spots'));
    if (S.secrets && !first && SHAPE_TIPS[loc]) tip('shape:' + loc, { title: `${LOC().name} has grown`, text: SHAPE_TIPS[loc], icon: 'map' });
    if (loc === 'park' && unlockedFeat('minimap')) tip('minimap', { title: 'The mini-map', text: 'The little map in the top right shows sniff spots, shops and the way home. Tap it to make it bigger.', icon: 'map' });
  }

  function goHome() {
    if (tm) exitTrickMode();
    endFun('leave');
    clearPatches();
    clearDucks();
    clearCatchables();
    if (bottle) { bottle.g.parent && bottle.g.parent.remove(bottle.g); bottle = null; }
    clearLostDog();
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
    sniffSpots.forEach((s) => { s.taken = null; if (s.golden) { s.golden = false; ART.setScentGold(s.sparkle, false); } });
    parkWater.taken = null;
    recordWalk(wasAt);
    spawnPatches();
    if (sitDog) { sitDog.dropSpot(); sitDog.offLeash = false; sitDog.returning = false; sitDog.leash.visible = false; sitDog.root.position.copy(freeNear(CHUNK / 2 + 0.9, CHUNK - 2)); sitDog.idle(rand(1, 3)); }
    renderBeds();
    sittingTick();
    round3Home();
    // a dog that got wet on the walk shakes off at the door, right next to you
    const wet = dogs.find((d) => d.wetT > 0);
    if (wet) setTimeout(() => { if (place === 'home') shakeOff(wet, 'walk'); }, 1400);
    refreshUI();
    applyEnvironment();
    updateCamera(0, true);
    arriveFade();
    toast(walkEarn > 0 ? `Great walk! You earned 🪙 ${walkEarn}` : 'Back home 🏠');
    save();
  }

  function updateSniffSpots(dt) {
    for (const s of sniffSpots) {
      if (title) { s.sparkle.visible = false; continue; }
      if (s.cooldown > 0) s.cooldown -= dt;
      // at night, without a light you only notice the spots close by
      const near = !nightHidesSpots() || flatDist(s.pos, player.root.position) < 6.5;
      s.sparkle.visible = s.cooldown <= 0 && s.active !== false && near;
      s.phase += dt;
      if (s.sparkle.visible && s.sparkle.userData.tick) s.sparkle.userData.tick(dt);
    }
  }

  // =====================================================================
  // Finds for the 📒 book, and loot from sniff spots and digging
  // =====================================================================
  function findOk(F) {
    const W = localWeather(), night = isNight();
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
    // secret finds are rare: a fraction of their weight, the fairy ring stone even more so
    const w = (F) => F.weight * (F.glade ? 4 : 1) * (F.when ? 1.5 : 1) * (F.secret ? 0.22 * (starsOf(where) >= 4 ? 2 : 1) : 1) * (F === D.FINDS.fairystone ? 0.5 : 1);
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
      news({ title: 'New for your book', text: F.name, th: thumbOf.find(id) });
      if (finder) { if (!journalAdd(finder, 'find1', F.icon, `Sniffed out a first treasure: ${F.name}`) && F.secret) journalAdd(finder, null, F.icon, `Sniffed out something rare: ${F.name}`); }
      haptic();
      tip('book', { title: 'Collectibles', text: 'Everything you find goes into your book: Menu → Collectibles. Finishing a page unlocks an outfit.', icon: 'book' });
      if (at) confetti(at, 4);
    }
    if (at) spawnEmoji(F.icon, at, { size: 0.55, life: 1.6, vy: 0.7 });
    gainXP(had ? D.XP_MISC.dupFind : D.XP_MISC.newFind);
    addMastery(D.LOCATIONS[F.loc] ? F.loc : loc, had ? 2 : 15);
    progress('find');
    if (!had) { checkSets(); checkSeasons(); }
    save();
  }
  let finder = null;
  function walkLoot(d, spot) {
    finder = d;
    d.life.finds++;
    setTimeout(() => { finder = null; }, 0);
    const pos = d.root.position;
    const kind = spot && spot.kind;
    if (spot && spot.golden) { spot.golden = false; if (spot.sparkle) ART.setScentGold(spot.sparkle, false); addCoins(eventOn('golden').coins, pos); confetti(pos.clone().add(new V3(0, 1, 0)), 6); toast(`${d.name} sniffed out the golden spot! 🪙 ${eventOn('golden').coins}`); sfx('find'); return; }
    if (Math.random() < D.RARE_FIND * (kind === 'glade' ? 4 : 1) * (d.mood() === 'great' ? 1.5 : 1) * (eventOn('meteors') && isNight() ? eventOn('meteors').mult : 1)) { findRare(pos); return; }
    if (!kind && sniffCritter(d)) return;
    if (kind === 'pool' && Math.random() < 0.7) { grantFind(pick(['starfish', 'crabclaw']), pos); return; }
    if (kind && kind.startsWith('hidden:')) {
      const k = Object.keys(D.FINDS).find((f) => D.FINDS[f].where === kind);
      if (k && (!state.finds[k] || Math.random() < 0.35)) { grantFind(k, pos); return; }
      if (Math.random() < 0.5) { addCoins(6, pos); spawnEmoji('✨', d.headWorld(0.3), { size: 0.4 }); return; }
    }
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
    const great = d.mood() === 'great';
    addSpec(d, 'sniffer', 1);
    addSpec(d, 'forager', 1);
    const fm = specMult(d, 'forager');
    const opts = [['coins', L.coins], ['find', L.find * (great ? 1.6 : 1) * evMult('finds') * specMult(d, 'sniffer')], ['ingredient', L.ingredient * fm], ['toy', L.toy * evMult('toys') * fm]];
    let r = Math.random() * opts.reduce((s, o) => s + o[1], 0), what = 'coins';
    for (const [k, w] of opts) { r -= w; if (r <= 0) { what = k; break; } }
    if (what === 'find') { const f = (D.SEASONS[clockNow.month] && Math.random() < 0.22 && rollSeason()) || rollFind(loc, kind); if (f) { grantFind(f, pos); return; } what = 'coins'; }
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
      const T = D.TREASURE, n = (T.min + Math.floor(Math.random() * (T.max - T.min + 1))) * (eventOn('treasure') ? 2 : 1);
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
  // sunset to sunrise is night: night finds, night encounters
  const isNight = () => clockNow.hour >= 18 || clockNow.hour < 6;
  const isWinter = () => clockNow.month === 12 || clockNow.month <= 2;
  // 0 = high tide, 1 = low tide. A real 12.42-hour tide clock, the same for everyone.
  function tideLevel() {
    if (tideOverride !== null) return tideOverride;
    return (1 - Math.cos(((Date.now() / 3600000) * 24 / 12.42) * TAU)) / 2;
  }
  // tides follow the game clock: about two high tides every game day
  const tideFalling = () => Math.sin(((Date.now() / 3600000) * 24 / 12.42) * TAU) > 0;
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
    endCalDecor();
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
      grounds: 'Train in the three rings any time · tournaments on the 8th and 20th of each month at the Agility club stall',
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
    // the museum door, your market stall, the pier and the disc mat come before a chat
    if (!want && !fun) { const r3 = round3Ctx(pp); if (r3 && r3 !== 'favor' && r3 !== 'catch' && r3 !== 'snowman') want = r3; }
    if (!want && !talk && nearestWalker(pp) && !fun) want = favorW && favorW.favor && nearestWalker(pp) === favorW ? 'favor' : 'talk';
    if (!want) want = funCtx();
    if (fun && fun.kind !== 'lead' && fun.kind !== 'seek' && fun.kind !== 'hide') want = null;
    updateTalk();
    setCtx(mode === 'normal' && place === 'park' ? want : null);
  }
  // =====================================================================
  // Chatting with neighbors on walks: small talk, tips, hints, and now and then a little present
  // (neighbor stories work exactly as before; this is the everyday chat)
  // =====================================================================
  let talk = null;
  const talkSeen = new Set();
  const lcFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  function nearestWalker(pp, r = 2.6) {
    let best = null, bd = r;
    for (const w of walkers) { const d = flatDist(w.parts.root.position, pp); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  function chatFill(t, w) {
    const mine = dogs.length ? pick(dogs).name : 'your dog';
    return t.replace(/\{dog\}/g, w.dog.name).replace(/\{mine\}/g, mine).replace(/\{place\}/g, LOC().name);
  }
  const fresh = (list) => { const f = list.filter((x) => !talkSeen.has(x)); return pick(f.length ? f : list); };
  // hints about things you could do next, worked out from your game
  function hintLines() {
    const out = [];
    for (const id of Object.keys(D.LOCATIONS)) {
      if (!locNext(id)) continue;
      const open = reqsOf(id).filter((U) => U.kind !== 'portal' && U.kind !== 'rocket' && (() => { const [a, b] = reqProgress(U); return a < b; })());
      if (open.length) out.push(`Folks say there’s somewhere new to explore, once you ${lcFirst(reqText(pick(open)))}.`);
    }
    if (unlockedFeat('critters')) {
      const here = Object.entries(D.CRITTERS).filter(([k, C]) => C.loc === loc && !(state.critters || {})[k] && !C.ev);
      if (here.length) { const [, C] = pick(here); const when = { night: 'at night', day: 'during the day', rain: 'when it rains', snow: 'when it snows', sun: 'on sunny days' }[C.when] || 'now and then'; out.push(`I spotted a ${C.name.toLowerCase()} around here ${when}. Keep your eyes open!`); }
    }
    const SE = D.SEASONS[clockNow.month];
    if (SE) { const miss = SE.finds.filter(([k]) => !state.finds[k]); if (miss.length) out.push(`This month you can sniff out a ${pick(miss)[1].toLowerCase()} anywhere, if you’re lucky.`); }
    for (const Z of D.SETS) { const miss = Z.finds.filter((k) => !state.finds[k]); if (miss.length === 1 && !(state.setsDone || []).includes(Z.id)) out.push(`You’re just one find away from the ${Z.name.toLowerCase()} set. It’s from ${D.LOCATIONS[D.FINDS[miss[0]].loc] ? D.LOCATIONS[D.FINDS[miss[0]].loc].name : 'somewhere'}.`); }
    const secret = Object.entries(ALL_TRICKS).filter(([k, T]) => T.secret && !state.secrets.includes(k) && T.hint);
    if (secret.length && Math.random() < 0.5) out.push(`I once saw a dog do the most amazing trick. The owner whispered: “${pick(secret)[1].hint}”`);
    const waiting = Object.keys(D.STORIES).filter((o) => storyOf(o) && storyChapter(o) && storyReady(o));
    if (waiting.length) out.push(`${pick(waiting)} was asking about you, I think. Keep an eye out on your walks.`);
    if (S && S.secrets && place === 'park') {
      const left = S.secrets.filter((x) => !hiddenOf(loc).includes(x.id) && (!x.tide || Math.random() < 0.6));
      if (left.length && Math.random() < 0.7) out.push(pick(left).hint);
    }
    if (walkDark() && !walkLit()) out.push('A flashlight from the shop makes night walks so much easier. You’d spot every sniff spot.');
    return out;
  }
  function chatLine(w, first) {
    const W = curWeather(), night = isNight(), h = clockNow.hour;
    const pools = [];
    pools.push([D.CHAT.casual, 3]);
    pools.push([D.CHAT.tips, 2]);
    if (D.CHAT.places[loc]) pools.push([D.CHAT.places[loc], 2]);
    if (D.CHAT.people[w.info.owner]) pools.push([D.CHAT.people[w.info.owner], first ? 3 : 1.5]);
    const wk = night ? 'night' : W.lightning ? 'storm' : W.precip || (W.fog ? 'fog' : weatherId === 'sun' ? 'sun' : null);
    if (wk && D.CHAT.weather[wk]) pools.push([D.CHAT.weather[wk], 1.5]);
    const hints = hintLines();
    if (hints.length) pools.push([hints, 2]);
    let r = Math.random() * pools.reduce((a, p) => a + p[1], 0), list = pools[0][0];
    for (const [l, wt] of pools) { r -= wt; if (r <= 0) { list = l; break; } }
    const line = fresh(list);
    talkSeen.add(line);
    let hello = '';
    if (first) { const t = night ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : 'evening'; hello = pick(D.CHAT.hello[t]) + ' '; }
    return chatFill(hello + line, w);
  }
  function chatGift(w) {
    const st = state.chats[w.info.owner] = state.chats[w.info.owner] || { n: 0, day: -1 };
    if (st.day === clockNow.gameDay || Math.random() > 0.14) return null;
    st.day = clockNow.gameDay;
    const r = Math.random();
    if (r < 0.45) { const n = 5 + Math.floor(Math.random() * 11); state.coins += n; return `You got ${n} coins.`; }
    const ings = Object.keys(D.INGREDIENTS).filter((k) => D.INGREDIENTS[k].price != null);
    const k = pick(ings);
    state.pantry[k] = (state.pantry[k] || 0) + (r < 0.8 ? 1 : 2);
    return `You got ${D.INGREDIENTS[k].name.toLowerCase()} for your pantry.`;
  }
  function startTalk(w) {
    if (!w || talk || mode !== 'normal') return;
    talk = { w, n: 0 };
    w.pause = 999;
    w.talking = true;
    const pp = player.root.position, wp = w.parts.root.position;
    w.parts.root.rotation.y = Math.atan2(pp.x - wp.x, pp.z - wp.z);
    player.face = Math.atan2(wp.x - pp.x, wp.z - pp.z);
    player.moveTarget = null;
    state.chats = state.chats || {};
    const st = state.chats[w.info.owner] = state.chats[w.info.owner] || { n: 0, day: -1 };
    st.n++;
    progress('chat');
    $('talkPic').src = ART.personPortraitURL(w.info);
    $('talkName').textContent = w.info.owner;
    $('talkSub').textContent = `with ${w.info.dog.name}`;
    const meetLine = finishMeetup(w);
    const hello = youName() && Math.random() < 0.5 ? `${pick(['Hi', 'Hello', 'Oh, hi', 'Hey'])}, ${youName()}! ` : '';
    showTalkLine(meetLine || hello + chatLine(w, true));
    $('talk').classList.remove('hidden');
    sfx('tip');
    tip('chat', { title: 'Neighbors', text: 'Stop and chat with the neighbors on your walks. They know a thing or two, and sometimes they have something for you.', icon: 'person' });
    save();
  }
  function showTalkLine(t) {
    $('talkLine').textContent = plain(t);
    $('talkMore').classList.toggle('hidden', !talk || talk.n >= 2);
  }
  function talkMore() {
    if (!talk) return;
    const w = talk.w;
    talk.n++;
    const g = talk.n === 1 ? chatGift(w) : null;
    if (g) { showTalkLine(`${chatFill(pick(D.CHAT.gift), w)} ${g}`); sfx('find'); updateHud(); save(); return; }
    showTalkLine(`${pick(D.CHAT.more)} ${chatLine(w, false)}`);
  }
  function endTalk(bye) {
    if (!talk) return;
    const w = talk.w;
    if (bye) toast(`${w.info.owner}: ${plain(chatFill(pick(D.CHAT.bye), w))}`);
    w.pause = 0.8;
    w.talking = false;
    talk = null;
    $('talk').classList.add('hidden');
  }
  $('talkMore').addEventListener('click', talkMore);
  $('talkBye').addEventListener('click', () => endTalk(true));
  function updateTalk() {
    if (!talk) return;
    if (place !== 'park' || mode !== 'normal' || flatDist(talk.w.parts.root.position, player.root.position) > 4) endTalk(false);
  }
  // the extra button in the walk bar changes with what's nearby
  const CTX = { talk: ['chat', 'Talk'], stay: ['hand', 'Stay'], echo: ['echo', 'Speak'], sled: ['sled', 'Sled'], ferris: ['ferris', 'Ride'], portal: ['portal', 'Portal'], rocket: ['rocket', 'Rocket'],
    sit: ['seat', 'Sit'], skip: ['stone', 'Skip'], stars: ['star', 'Stars'], rake: ['rake', 'Rake'], shovel: ['rake', 'Shovel'],
    pickup: ['person', 'Hand over'], bed: ['sprout', 'Dig a bed'], treasure: ['map', 'Dig here'], bottle: ['search', 'Bottle'], run: ['flag', 'Run'], enter: ['flag', 'Enter'], ducks: ['wave', 'Feed ducks'],
    catch: ['net', 'Catch'], museum: ['museum', 'Museum'], market: ['stall', 'Market'], fish: ['fish', 'Fish'], disc: ['disc', 'Disc dog'], favor: ['search', 'Help'], snowman: ['snowman', 'Snowman'], flakes: ['snow', 'Snowflakes'] };
  let ctxKind = null;
  function setCtx(k) {
    if (k === ctxKind) return;
    ctxKind = k;
    for (const id of ['ctxBtn', 'ctxHome']) {
      const b = $(id);
      b.classList.toggle('hidden', !k);
      if (k) b.innerHTML = `${IC(CTX[k][0], 'dIc')}<small>${CTX[k][1]}</small>`;
    }
    placeToast();
  }
  function ctxAction() {
    switch (ctxKind) {
      case 'talk': startTalk(nearestWalker(player.root.position)); break;
      case 'stay': askStay(); break;
      case 'echo': doEcho(); break;
      case 'sled': startSled(); break;
      case 'ferris': rideWheel(); break;
      case 'portal': usePortal(); break;
      case 'rocket': useRocket(); break;
      case 'sit': { const st = nearestSeat(player.root.position); if (st) sitDown(st); break; }
      case 'skip': startSkip(); break;
      case 'stars': startGaze(); break;
      case 'rake': case 'shovel': startRake(); break;
      default: if (!hobbyAction(ctxKind)) round3Action(ctxKind); break;
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
      toast('Red light! Wait for green, and tap Stay so your dog waits nicely');
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
      if (!stop) c.g.position.x = nx > 36 ? -36 : nx < -36 ? 36 : nx;
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
    const n = Math.min(cap - quirk.plazaCoins, Math.round((D.PLAZA_COINS[lvl] || 1) * showMult(d)));
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
    // only the very lowest tides uncover the sand along the cliffs
    const strip = lvl > 0.8;
    if (q.stripMesh && q.strip !== strip) { q.strip = strip; q.stripMesh.visible = strip; }
    // caught by the rising tide? you can always wade back to the beach
    q.wading = false;
    const inCave = S.secrets && S.secrets.some((x) => x.tide && x.rects.some((t) => inRectXZ(t, pp.x, pp.z)));
    q.wading = (pp.z < edge && pp.x < 21 && S.solid(pp.x, pp.z)) || (inCave && !strip);
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
        const m = Math.min(state.finds.moonstone || 0, moonFuel());
        toast(m >= moonFuel() ? '🚀 You have enough moonstones — tap 🚀 Rocket to fuel it!' : `🚀 The rocket needs ${moonFuel()} 🌕 moonstones from the Crystal Caves (${m}/${moonFuel()})`);
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
  const moonFuel = () => (reqsOf('moon').find((U) => U.kind === 'rocket') || { n: 6 }).n;
  // what a place still needs, in words
  const unmet = (id) => reqsOf(id).filter((U) => U.kind !== 'rocket' && U.kind !== 'portal' && (() => { const [a, b] = reqProgress(U); return a < b; })()).map((U) => reqText(U)).join(' · ');
  function useRocket() {
    if (place !== 'park' || loc !== 'snowy') return;
    const need = moonFuel(), have = state.finds.moonstone || 0;
    if (!state.rocket) {
      if (have < need) { toast(`🚀 Not enough fuel: bring ${need} 🌕 moonstones from the Crystal Caves (${have}/${need})`); return; }
      state.rocket = true;
      checkLocUnlocks();
      confetti(S.q.rocket.pos.clone().add(new V3(0, 2, 0)), 8);
      save();
    }
    checkLocUnlocks();
    if (!locUnlocked('moon')) { toast(`The rocket is fueled. Before liftoff: ${unmet('moon')}`); return; }
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
    checkLocUnlocks();
    if (!locUnlocked('fairy')) { toast(`The portal shimmers, but it won't let you through yet: ${unmet('fairy')}`); return; }
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
    const known = BASIC_TRICKS.filter((id) => dogs.some((d) => d.trickLvl(id) >= 1) && id !== exclude);
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
    const n = Math.min(cap - quirk.tickets, Math.round((2 + lvl) * showMult(d))) * (eventOn('tickets') ? 2 : 1);
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
      toast('An astronaut helmet in the moon dust! Try it on: dog bubble → Style');
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
  // a place can need several things at once: unlock.all = [ ... ]
  const reqsOf = (id) => { const U = D.LOCATIONS[id].unlock; return !U ? [] : U.all || [U]; };
  function reqProgress(U) {
    switch (U.kind) {
      case 'obedience': return [Math.max(0, ...dogs.map((d) => d.obedience())), U.n];
      case 'walks': return [state.stats.walks || 0, U.n];
      case 'locWalks': return [state.locWalks[U.loc] || 0, U.n];
      case 'finds': return [Object.keys(D.FINDS).filter((k) => D.FINDS[k].loc === U.loc && state.finds[k]).length, U.n];
      case 'glades': return [state.glades.length, U.n];
      case 'treasure': return [state.treasures || 0, U.n];
      case 'acc': return [state.accessories.includes(U.id) ? 1 : 0, 1];
      case 'summits': return [state.summits || 0, U.n];
      case 'loc': return [locUnlocked(U.loc) ? 1 : 0, 1];
      case 'portal': return [state.portal ? 1 : 0, 1];
      case 'rocket': return [Math.min(state.finds.moonstone || 0, U.n), U.n];
      case 'rank': return [Math.min(rank(), U.n), U.n];
      case 'stars': return [Math.min(starsOf(U.loc), U.n), U.n];
      default: return [0, 1];
    }
  }
  function reqText(U) {
    const L = (k) => D.LOCATIONS[k].name;
    switch (U.kind) {
      case 'obedience': return `A dog reaches Obedience ${U.n}`;
      case 'walks': return `Go on ${U.n} walks`;
      case 'locWalks': return `Walk in ${L(U.loc)} ${U.n} times`;
      case 'finds': return `Find ${U.n} collectibles in ${L(U.loc)}`;
      case 'glades': return `Find all ${U.n} hidden glades in ${L('forest')}`;
      case 'treasure': return `Dig up ${U.n} buried treasure${U.n > 1 ? 's' : ''} on ${L('beach')}`;
      case 'acc': { const A = D.ACCESSORIES[U.id], V = A.vendor && D.VENDORS[A.vendor]; return `Own a ${A.name}${V ? ` (${V.name}, ${L(V.loc)})` : ''}`; }
      case 'summits': return `Reach the summit in ${L('alpine')}${U.n > 1 ? ` ${U.n} times` : ''}`;
      case 'loc': return `Unlock ${L(U.loc)}`;
      case 'portal': return `A hidden portal somewhere in ${L('forest')}…`;
      case 'rocket': return `Fuel the rocket in ${L('snowy')} with ${U.n} moonstones from ${L('caves')}`;
      case 'rank': return `Reach Trainer rank ${U.n}`;
      case 'stars': return `Earn ${U.n}★ mastery in ${L(U.loc)}`;
      default: return '';
    }
  }
  // overall progress (for old code that wants one number pair)
  function locProgress(id) {
    const R = reqsOf(id);
    if (!R.length) return null;
    if (R.length === 1) return reqProgress(R[0]);
    let have = 0;
    for (const U of R) { const [a, b] = reqProgress(U); have += Math.min(1, a / b); }
    return [Math.round(have * 100) / 100, R.length];
  }
  function locReady(id) {
    const R = reqsOf(id);
    if (!R.length) return false;
    return R.every((U) => (U.kind === 'rocket' ? !!state.rocket : (() => { const [a, b] = reqProgress(U); return a >= b; })()));
  }
  function checkLocUnlocks() {
    const fresh = [];
    for (let again = true; again;) {   // one unlock can open the next (Old Town -> carnival)
      again = false;
      for (const id of Object.keys(D.LOCATIONS)) {
        if (locUnlocked(id) || !locReady(id)) continue;
        state.unlocked.push(id);
        fresh.push(id);
        setTimeout(() => revealPlaceEvents(id), 3000);
        again = true;
      }
    }
    if (!fresh.length) return;
    sfx('unlock');
    for (const id of fresh) news({ title: 'New place unlocked!', text: `${D.LOCATIONS[id].name}. Tap Walk to go there.`, th: TH('loc', id) });
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
    const hidN = hiddenTotal(id);
    if (hidN && ((state.locWalks || {})[id] || hiddenOf(id).length)) parts.push(`🔍 Hidden spots ${Math.min(hidN, hiddenOf(id).length)}/${hidN}`);
    const ids = Object.keys(D.FINDS).filter((k) => D.FINDS[k].loc === id);
    parts.push(`Collectibles ${ids.filter((k) => state.finds[k]).length}/${ids.length}`);
    return parts.join(' · ');
  }
  function openMap() {
    tutEvent('walk');
    if (!dogs.length) return;
    renderMap();
    $('map').classList.remove('hidden');
  }
  // places a locked place depends on: until you have been there, its hint stays hidden
  function locNeeds(id) {
    const out = [];
    for (const U of reqsOf(id)) {
      switch (U.kind) {
        case 'locWalks': case 'loc': case 'finds': case 'stars': out.push(U.loc); break;
        case 'glades': case 'portal': out.push('forest'); break;
        case 'treasure': out.push('beach'); break;
        case 'summits': out.push('alpine'); break;
        case 'acc': { const A = D.ACCESSORIES[U.id]; if (A && A.vendor) out.push(D.VENDORS[A.vendor].loc); break; }
        case 'rocket': out.push('snowy', 'caves'); break;
        default: break;
      }
    }
    return out;
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
        const note = closed ? `Closed now · opens at ${P.hours[0]}:00` : locNote(id);
        card.innerHTML = `<div class="lcIc">${TH('loc', id)}</div><div class="txt"><b></b><small class="desc"></small><small class="note"></small></div>`;
        card.querySelector('b').textContent = P.name;
        card.querySelector('b').insertAdjacentHTML('beforeend', ` ${starsHTML(starsOf(id))}`);
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
        // not named yet: only how to get there, one line per thing it needs
        const rows = reqsOf(id).map((U) => {
          const [have, need] = reqProgress(U), done = have >= need;
          const bar = U.kind !== 'portal' && need > 1 ? `<div class="track"><div class="fill" style="width:${Math.round(Math.min(1, have / need) * 100)}%"></div></div><small class="prog">${Math.min(have, need)} of ${need}</small>` : '';
          return `<div class="req${done ? ' done' : ''}">${IC(done ? 'check' : 'dot')}<div><small class="note">${esc(reqText(U))}</small>${bar}</div></div>`;
        }).join('');
        card.innerHTML = `<div class="lcIc">${TH('locx', id)}<span class="lockMark">${IC('lock')}</span></div><div class="txt"><b>Undiscovered place</b>${rows}</div>`;
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
    if (need === 'offleash' && !unlockedFeat('offleash')) return null;
    if (need.startsWith('feat:') && !unlockedFeat(need.slice(5))) return null;
    if (need === 'music' && !hasItem('piano') && !hasItem('guitar')) return null;
    if (need === 'beds' && !(state.beds || []).some((b) => b.seed)) return null;
    if (need === 'agilityok' && !(unlockedFeat('agility') && (locUnlocked('grounds') || state.furniture.filter((f) => D.ITEMS[f.type].agility).length >= 3))) return null;
    if (need === 'mailbox' && !(unlockedFeat('letters') && hasItem('mailbox'))) return null;
    if (need === 'oven' && !(unlockedFeat('baking') && hasItem('oven'))) return null;
    if (need === 'rod' && !(unlockedFeat('fishing') && hasGadget('rod') && locUnlocked('beach'))) return null;
    if (need === 'net' && !(unlockedFeat('catching') && hasGadget('net'))) return null;
    if (need === 'discok' && !(unlockedFeat('disc') && locUnlocked('beach') && state.toys.includes('frisbee'))) return null;
    if (need === 'winter' && !(unlockedFeat('winter') && (isWinter() || locUnlocked('snowy')))) return null;
    if (need === 'trick' && !unlockedFeat('tricks')) return null;
    if (need === 'stove' && !unlockedFeat('kitchen')) return null;
    if (need === 'bathtub' && !unlockedFeat('bath')) return null;
    if (need === 'treats' && !unlockedFeat('kitchen')) return null;
    if (C.ev === 'trick' && !unlockedFeat('tricks')) return null;
    if (need === 'offleash' && !dogs.some((d) => d.trickLvl('come') >= CONFIG.OFFLEASH_COME_LEVEL)) return null;
    if (need === 'treats' && !hasItem('stove') && places.length < 2) return null;
    let n = Array.isArray(C.n) ? C.n[0] + Math.floor(rr() * (C.n[1] - C.n[0] + 1)) : C.n;
    let text = C.text, ev = C.ev;
    if (need === 'trick') {
      const known = BASIC_TRICKS.filter((id) => dogs.some((d) => d.trickLvl(id) >= 1));
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
    checkAllowance();
    if (visit || !dogs.length || !unlockedFeat('daily')) { renderDailyBadge(); return; }
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
    if (visit) return;
    calProgress(ev, amt);
    weekStat(ev, amt);
    if (CRITTER_EV[ev] && place === 'park') spotCritter(CRITTER_EV[ev], null);
    if (!shortWalk) {
      if (D.XP[ev]) earn(ev, amt);
      else if (ev.startsWith('walk:')) addMastery(ev.slice(5), 10);
    }
    if (!state.daily || !unlockedFeat('daily')) return;
    let changed = false;
    for (const c of state.daily.items) {
      if (c.done || c.ev !== ev) continue;
      c.got = Math.min(c.n, c.got + amt);
      changed = true;
      if (c.got >= c.n) {
        c.done = true;
        state.coins += c.reward;
        state.stats.challengesDone = (state.stats.challengesDone || 0) + 1;
        gainXP(D.XP_MISC.challenge);
        setTimeout(() => toast(`📋 Challenge done: ${c.text} · +🪙 ${c.reward}`), 700);
      }
    }
    if (!changed) return;
    if (!state.daily.bonus && state.daily.items.every((c) => c.done)) {
      state.daily.bonus = true;
      state.coins += D.CHALLENGE_BONUS.coins;
      gainXP(D.XP_MISC.allChallenges);
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
    const left = state.daily && unlockedFeat('daily') ? state.daily.items.filter((c) => !c.done).length : 0;
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
    const h = Math.max(0, 24 - clockNow.realHour);
    $('dailySub').textContent = `New challenges in ${Math.floor(h)}h ${Math.floor((h % 1) * 60)}m. Finish all three for a bonus!`;
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
    ['season', ['pic', '🍂'], 'Seasons'], ['sets', ['pic', '🧩'], 'Sets'], ['critters', ['pic', '🐾'], 'Critters'],
    ['events', ['pic', '🎆'], 'Events'], ['rare', ['item', 'goldstatue'], 'Rare'], ['tricks', ['pic', '🎓'], 'Tricks'], ['breeds', ['dog', 'retriever|golden'], 'Breeds'], ['records', ['pic', '🏆'], 'Records']];
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
        E.push({ thk: ['pic', F.icon], name: F.name, got: !!state.finds[k], secret: !!F.secret, sub: state.finds[k] > 1 ? `×${state.finds[k]}` : F.where === 'pool' ? 'In tide pools' : F.where === 'treasure' ? (F.loc === 'moon' ? 'In a space capsule' : 'In buried treasure') : F.where === 'crystal' ? 'In glowing crystals' : F.where === 'prize' ? 'Prize booth' : F.where === 'puzzle' ? 'A puzzle reward' : F.where && F.where.startsWith('hidden:') ? 'In a hidden place' : F.glade ? 'In a hidden glade' : WHEN_TEXT[F.when] || '' });
      }
    } else if (id === 'season') {
      const cm = clockNow.month, months = Object.keys(D.SEASONS).map(Number).sort((a, b) => ((a - cm + 12) % 12) - ((b - cm + 12) % 12));
      for (const m of months) for (const [k, name, icon] of D.SEASONS[m].finds) E.push({ thk: ['pic', icon], name, got: !!state.finds[k], secret: false, sub: state.finds[k] ? D.MONTHS[m] : m === cm ? 'This month, while sniffing' : `Turns up in ${D.MONTHS[m]}` });
    } else if (id === 'sets') {
      for (const S of D.SETS) E.push({ set: S, name: S.name, got: (state.setsDone || []).includes(S.id), secret: false });
    } else if (id === 'critters') {
      for (const [k, C] of Object.entries(D.CRITTERS)) E.push({ thk: ['pic', C.icon], name: C.name, got: !!(state.critters || {})[k], secret: false, sub: (state.critters || {})[k] ? critterWhere(C) : locUnlocked(C.loc) ? critterWhere(C) : 'Somewhere you haven’t been' });
    } else if (id === 'events') {
      for (const e of D.CAL_EVENTS) { const [k, nm, ic] = e.keepsake; const got = !!(state.keepsakes || {})[k]; E.push({ thk: ['pic', ic], name: got || evKnown(e) ? nm : '???', got, secret: !evKnown(e), sub: evKnown(e) ? `${e.name} · ${D.MONTHS[e.m]}` : 'An event you haven’t seen yet' }); }
    } else if (id === 'rare') {
      for (const [k, it] of Object.entries(D.ITEMS)) if (it.rare) E.push({ thk: ['item', k], name: it.name, got: state.seen.rares.includes(k), secret: false, sub: 'Found or gifted' });
    } else if (id === 'tricks') {
      for (const [k, T] of Object.entries(ALL_TRICKS)) E.push({ thk: ['pic', T.icon], name: T.name, got: state.learned.includes(k) || dogs.some((d) => d.trickLvl(k) >= 1), secret: !!T.secret, sub: T.secret ? 'Secret trick' : T.music ? 'Learned through music' : '', subHTML: T.secret || T.music ? '' : seqGlyphs(T.seq) });
    } else if (id === 'breeds') {
      for (const [b, B] of Object.entries(D.BREEDS)) for (const c of B.coats) if (!c.legacy) E.push({ img: ART.portraitURL(b, c.id), name: `${c.name} ${B.name}`, got: state.seen.coats.includes(b + ':' + c.id), secret: false, sub: 'Adopt one' });
    } else if (id === 'records') {
      for (const R of D.RECORDS) { const v = recordValue(R.stat); E.push({ thk: ['pic', R.icon], name: R.name, got: v >= R.n, secret: !!R.secret, sub: v >= R.n ? R.text : `${R.text} · ${Math.min(v, R.n)}/${R.n}` }); }
    }
    return { entries: E, done: E.filter((e) => e.got).length, total: E.length };
  }
  let albumPage = 'toys';
  const bookPages = () => BOOK_PAGES.filter(([id]) => (id !== 'critters' || unlockedFeat('critters')) && (id !== 'events' || unlockedFeat('calendar')));
  function openAlbum() {
    renderAlbum();
    $('album').classList.remove('hidden');
  }
  function renderAlbum() {
    const tabs = $('albumTabs');
    tabs.innerHTML = '';
    let all = 0, got = 0;
    for (const [id, icon, name] of bookPages()) {
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
    const S = D.SEASONS[clockNow.month];
    if (albumPage === 'season' && S) { const n = S.finds.filter(([k]) => state.finds[k]).length; head.innerHTML = `<span class="rwd">${TH('pic', S.finds[0][2])}</span><span>${(state.seasonsDone || []).includes(String(clockNow.month)) ? `${esc(S.name)} set complete!` : `This month: ${esc(S.name)} (${n}/4). Find all four for ${esc(rewardText(S.reward))}.`} Each month brings four new things.</span>`; }
    if (albumPage === 'sets') head.innerHTML = `<span>Things from all over that belong together. Finish a set for a prize.</span>`;
    if (albumPage === 'critters') head.innerHTML = `<span class="rwd">${TH('pic', '🐾')}</span><span>${state.crittersDone ? 'Every critter spotted!' : `Your dogs sniff out little animals now and then. Spot them all for ${esc(rewardText(D.CRITTER_REWARD))}.`}</span>`;
    const G = $('albumGrid');
    G.innerHTML = '';
    G.classList.toggle('setList', albumPage === 'sets');
    if (albumPage === 'sets') {
      for (const S2 of D.SETS) {
        const have = S2.finds.filter((k) => state.finds[k]).length, done = (state.setsDone || []).includes(S2.id);
        const row = document.createElement('div');
        row.className = 'row setRow' + (done ? ' done' : '');
        row.innerHTML = `<div class="txt"><b>${esc(S2.name)} <span class="cnt">${have}/${S2.finds.length}</span></b><div class="setPics">${S2.finds.map((k) => `<span class="sp${state.finds[k] ? '' : ' miss'}" title="${state.finds[k] ? esc(D.FINDS[k].name) : '?'}">${state.finds[k] ? TH('pic', D.FINDS[k].icon) : IC('question')}</span>`).join('')}</div><small>${done ? 'Complete' : `Prize: ${esc(rewardText(S2.reward))}`}</small></div>`;
        G.appendChild(row);
      }
      return;
    }
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
      const e = extentOf(floorChunks(editFloor).concat(floorChunks(0).length && editFloor ? floorChunks(0).map(([x, z]) => [x + UPC, z]) : []).concat(buildCands));
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
      // up on a lookout you see further; tucked under a cliff, the camera comes in close
      if (terrainOn() && atLookout()) dist *= 1.3;
      if (roofOver) dist *= 0.82;
    }
    dist *= clamp(0.8 / camera.aspect, 1, 1.6) * (mode === 'build' ? 1 : zoom);
    const k = snap ? 1 : damp(camFocus ? 0.005 : 0.02, dt);
    let ly = 0.5 + (terrainOn() ? p.y : 0);
    // upstairs: look at the floor above (what's drawn there is slid back over the rooms below)
    if (place === 'home') {
      if (isUpX(tx)) tx -= UPX;
      ly = 0.5 + (mode === 'build' || mode === 'decorate' ? editFloor * FH : isUpX(p.x) ? FH : p.y);
    }
    camLook.set(lerp(camLook.x, tx, k), snap ? ly : lerp(camLook.y, ly, damp(0.05, dt)), lerp(camLook.z, tz, k));
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
  // the joystick stays out of the way: faint from the start, nearly gone after a moment of steady walking
  let joyAng = null, joyFadeT = null;
  const joyWake = () => { joyBase.classList.remove('fade'); clearTimeout(joyFadeT); joyFadeT = setTimeout(() => joyBase.classList.add('fade'), 1100); };
  const MODALS = ['weather', 'creator', 'hub', 'shop', 'start', 'bag', 'confirm', 'litter', 'settings', 'trickBook', 'bath', 'kitchen', 'meals', 'wardrobe', 'comfort', 'giftModal', 'map', 'daily', 'album', 'photoPreview', 'ranks', 'dogSheet', 'house', 'people', 'bathFull', 'journal', 'away', 'inbox', 'playSheet', 'bedSheet', 'courseSheet', 'tourney', 'paint', 'mail', 'tmapSheet', 'nameAsk', 'bake', 'stall', 'museum', 'critters', 'gazette'];
  // sheets: a soft sound when they open and close; tips step aside while one is open
  const modalWatch = new MutationObserver((muts) => {
    for (const m of muts) {
      const was = (m.oldValue || '').includes('hidden'), now = m.target.classList.contains('hidden');
      if (was !== now) sfx(now ? 'close' : 'open');
    }
    document.body.classList.toggle('sheetOpen', modalOpen());
  });
  MODALS.forEach((id) => modalWatch.observe($(id), { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));
  const modalOpen = () => MODALS.some((id) => !$(id).classList.contains('hidden'));

  canvas.addEventListener('pointerdown', (e) => {
    if (modalOpen() || title) return;
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
    // brushing: swipes are brush strokes, not walking
    if (fun && fun.kind === 'brush' && ptrs.size === 1) { brushMove(e); return; }
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
      joyAng = null;
      joyWake();
      camFocus = null;
      hideHint();
    }
    if (primary.dragging) {
      const R = 55, len = Math.hypot(dx, dy), k = len > R ? R / len : 1;
      joy.x = (dx * k) / R;
      joy.y = (dy * k) / R;
      joy.active = true;
      joyKnob.style.transform = `translate(${dx * k * 0.62}px, ${dy * k * 0.62}px)`;
      if (len > 14) {
        const a = Math.atan2(dy, dx);
        if (joyAng === null || Math.abs(Math.atan2(Math.sin(a - joyAng), Math.cos(a - joyAng))) > 0.7) { joyAng = a; joyWake(); }
      }
    }
  });
  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (fun && fun.kind === 'brush') fun.last = null;
    if (primary && e.pointerId === primary.id) {
      if (!primary.dragging && e.type === 'pointerup' && !pinch) handleTap(e.clientX, e.clientY);
      primary = null;
      joy.active = false;
      joy.x = joy.y = 0;
      joyBase.style.display = 'none';
      joyKnob.style.transform = '';
      clearTimeout(joyFadeT);
      joyBase.classList.remove('fade');
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
    lastTap = { x: cx, y: cy };
    ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const gp = new V3();
    const vf = viewFloor();
    groundPlane.constant = terrainOn() ? -player.root.position.y : place === 'home' && vf === 1 ? -FH : 0;
    const hitGround = raycaster.ray.intersectPlane(groundPlane, gp);
    // upstairs taps land on the floor above: turn them into upstairs tiles
    if (hitGround && place === 'home' && vf === 1) { gp.x += UPX; gp.y = 0; }

    if (mode === 'decorate') { if (hitGround) decorateTap(gp); return; }
    if (mode === 'build') { if (hitGround) buildTap(gp); return; }
    camFocus = null;
    if (funTap()) return;

    let dog = null;
    const onView = (d) => place !== 'home' || floorOfX(d.root.position.x) === vf;
    const hits = withShift(() => raycaster.intersectObjects(dogs.filter(onView).map((d) => d.root).concat(sitDog && onView(sitDog) ? [sitDog.root] : []), true));
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.dog) o = o.parent;
      if (o) { dog = o.userData.dog; break; }
    }
    if (!dog && hitGround) {
      let best = 0.85;
      for (const d of sitDog ? dogs.concat(sitDog) : dogs) {
        if (!onView(d)) continue;
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

    const bd = tapBed(raycaster, hitGround ? gp : null);
    if (bd) {
      const c = new V3(bd.i + 0.5, 0, bd.j + 0.5);
      if (flatDist(player.root.position, c) < 2.6) openBed(bd);
      else { player.moveTarget = c.clone(); bedTask = bd; }
      tapRing.position.set(c.x, 0.06, c.z);
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
    const vf = viewFloor();
    const hits = withShift(() => ray.intersectObjects(clutterGroup.children.concat(furnGroup.children), true));
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.f && !o.userData.clutter) o = o.parent;
      if (!o) continue;
      const it = o.userData.f || o.userData.clutter;
      if (it && floorOfX(it.i) !== vf) continue;
      if (o.userData.clutter) return { clutter: o.userData.clutter, at: o.position };
      if (D.ITEMS[o.userData.f.type].use || D.SEATS[o.userData.f.type]) return { f: o.userData.f, at: o.position };
    }
    if (!gp) return null;
    const i = Math.floor(gp.x), j = Math.floor(gp.z);
    const c = !visit && state.clutter.find((x) => x.i === i && x.j === j);
    if (c) return { clutter: c, at: new V3(i + 0.5, 0, j + 0.5) };
    const f = furnitureAt(i, j);
    if (f && (D.ITEMS[f.type].use || D.SEATS[f.type])) return { f, at: tileCenter(f) };
    return null;
  }
  function interactDog(d) {
    if (d === sitDog) {
      if (state.sitting) state.sitting.petted = (state.sitting.petted || 0) + 1;
      if (d.state === 'sleep') d.wake();
      if (d.root.position.distanceTo(player.root.position) < 1.9 || place === 'park') d.pet(); else d.goTo(() => player.root.position, 3.2, () => d.pet(), 1.1);
      return;
    }
    selected = d;
    updatePack();
    if (funTapDog(d)) return;
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
    endFun('switch');
    refreshGates();
    editFloor = viewFloor();
    mode = 'decorate';
    camFocus = null;
    buildInnerWalls(true);
    if (!selectedInv || !(state.inventory[selectedInv] > 0)) selectedInv = firstInv();
    renderInv();
    refreshUI();
  }
  function exitDecorate() {
    mode = 'normal';
    buildInnerWalls(true);
    refreshUI();
    save();
    reactToFurniture();
  }
  function renderInv() {
    const list = $('invList');
    list.innerHTML = '';
    document.querySelectorAll('#decoBar .decoTab').forEach((b) => b.classList.toggle('sel', b.dataset.tab === decoTab));
    $('decoFloorBtn').classList.toggle('hidden', !hasUpstairs());
    $('decoFloorLbl').textContent = editFloor ? 'Downstairs' : 'Upstairs';
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
    if (D.ITEMS[selectedInv].garden && !isGardenTile(i, j)) { toast(`${D.ITEMS[selectedInv].name} only fits in a garden`); return; }
    if (state.clutter.some((c) => c.i === i && c.j === j)) { toast('Tidy up that spot first'); return; }
    if (stairSolid(i, j)) { toast('That’s where the stairs are 🪜'); return; }
    if ((isStairEntry(i, j) || isStairLanding(i, j)) && D.ITEMS[selectedInv].solid) { toast('Keep the way to the stairs free 🪜'); return; }
    if (bedAt(i, j)) { toast('There’s a garden bed there'); return; }
    let pid;
    if (selectedInv === 'painting') { const P = freePainting(); if (!P) { toast('All your paintings are up already'); return; } pid = P.id; }
    if (D.ITEMS[selectedInv].solid && Math.floor(player.root.position.x) === i && Math.floor(player.root.position.z) === j) {
      toast("You're standing there!");
      return;
    }
    state.furniture.push(Object.assign({ type: selectedInv, i, j, rot: placeRot, filled: false }, pid ? { pid } : {}));
    furnNew.push(state.furniture[state.furniture.length - 1]);
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

  // =====================================================================
  // Rooms mode: add, move and remove rooms, walls between rooms, and the stairs
  // =====================================================================
  let buildTool = 'add';
  let movePick = null;     // the room being moved
  let stairDraft = null;   // { room: [cx, cz], i, j, rot } while placing the stairs
  const downCount = () => floorChunks(0, state).length;
  const upCount = () => floorChunks(1, state).length;
  const roomFull = (fl) => (fl ? upCount() >= upCap() : downCount() >= roomCap());
  const isRoomChunk = (cx, cz) => hasChunk(cx, cz) && !isGardenChunk(cx, cz);
  const movePrice = () => Math.max(100, Math.round((expandPrice(Math.max(1, state.chunks.length - 1)) * D.HOME_BUILD.moveShare) / 5) * 5);
  const stairsRoom = () => (state.stairs ? [Math.floor(state.stairs.i / CHUNK), Math.floor(state.stairs.j / CHUNK)] : null);
  function checkUpstairsOpen() {
    if (state.upOK || visit) return;
    if (houseTier() >= D.HOME_BUILD.upFrom && downCount() >= roomCap()) {
      state.upOK = true;
      news({ title: 'Your home can grow upward!', text: `Every room downstairs is built. Open Rooms (Shop → Add a room), switch to Upstairs and place the stairs in any room. Your ${D.HOUSE_TIERS[houseTier()].name.toLowerCase()} can have ${upCap()} rooms up there.`, th: IC('home') });
    }
  }
  function nbrs(cx, cz) { return [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]; }
  // free spots next to a set of rooms on one floor (upstairs only over rooms, never over gardens)
  function freeAround(list, fl, skip) {
    const out = [], seen = new Set();
    for (const [cx, cz] of list) {
      for (const [x, z] of nbrs(cx, cz)) {
        const k = chunkKey(x, z);
        if (seen.has(k)) continue;
        seen.add(k);
        if (chunkSet.has(k) && !(skip && skip[0] === x && skip[1] === z)) continue;
        if (state.build && state.build.cx === x && state.build.cz === z) continue;
        if (fl === 1 && !isRoomChunk(x - UPC, z)) continue;
        if (fl === 0 && isUpChunk(x)) continue;
        out.push([x, z]);
      }
    }
    return out;
  }
  function canMoveFrom([cx, cz]) {
    if (state.build) return 'Wait until the builders are done 🏗️';
    if (!isUpChunk(cx) && hasChunk(cx + UPC, cz)) return 'There’s a room upstairs on top of this one';
    const sr = stairsRoom();
    if (isUpChunk(cx) && sr && sr[0] + UPC === cx && sr[1] === cz) return 'The stairs come up here. Move the stairs first';
    return null;
  }
  function canRemove([cx, cz]) {
    if (state.build) return 'Wait until the builders are done 🏗️';
    const up = isUpChunk(cx);
    if (!up && downCount() <= 1) return 'That’s your last room';
    if (!up && hasChunk(cx + UPC, cz)) return 'There’s a room upstairs on top of this one';
    if (dogs.length > state.chunks.length - 1) return 'Your dogs need every room you have';
    const sr = stairsRoom(), stairsHere = up && sr && sr[0] + UPC === cx && sr[1] === cz;
    if (stairsHere && upCount() > 1) return 'The stairs come up here. Move the stairs first';
    const rest = state.chunks.filter(([x, z]) => !(x === cx && z === cz));
    if (!homeConnected(rest, state.walls, stairsHere ? null : state.stairs)) return 'The other rooms would be cut off';
    return null;
  }
  function moveTargets(from) {
    const [fx, fz] = from, fl = isUpChunk(fx) ? 1 : 0;
    const rest = state.chunks.filter(([x, z]) => !(x === fx && z === fz));
    const walls = Object.fromEntries(Object.entries(state.walls || {}).filter(([k]) => !wallTouches(k, fx, fz)));
    return freeAround(rest.filter((c) => chunkFloor(c) === fl), fl, from).filter(([x, z]) => !(x === fx && z === fz) && homeConnected(rest.concat([[x, z]]), walls, state.stairs));
  }
  function wallTouches(k, cx, cz) {
    const [x, z, side] = k.split(','), X = +x, Z = +z;
    return (X === cx && Z === cz) || (side === 'e' ? X + 1 === cx && Z === cz : X === cx && Z + 1 === cz);
  }
  function findCandidates() {
    const fl = editFloor;
    if (buildTool === 'add') {
      if (fl === 1 && !hasUpstairs(state)) return [];
      if (roomFull(fl)) return [];
      return freeAround(floorChunks(fl, state), fl);
    }
    if (buildTool === 'move') return movePick ? moveTargets(movePick) : floorChunks(fl, state).filter((c) => !canMoveFrom(c));
    if (buildTool === 'remove') return floorChunks(fl, state);
    if (buildTool === 'stairs') {
      if (stairDraft) return [stairDraft.room];
      return floorChunks(0, state).filter(([x, z]) => isRoomChunk(x, z) && (!hasUpstairs(state) || hasChunk(x + UPC, z)));
    }
    return [];
  }
  // every place two rooms on this floor touch
  function innerEdges(fl) {
    const out = [];
    for (const [cx, cz] of floorChunks(fl, state)) {
      if (hasChunk(cx + 1, cz)) out.push({ k: `${cx},${cz},e`, x: (cx + 1) * CHUNK, z: (cz + 0.5) * CHUNK, east: true });
      if (hasChunk(cx, cz + 1)) out.push({ k: `${cx},${cz},s`, x: (cx + 0.5) * CHUNK, z: (cz + 1) * CHUNK, east: false });
    }
    return out;
  }
  const edgeMats = { open: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), w: new THREE.MeshBasicMaterial({ color: 0xe57373, transparent: true, opacity: 0.8, depthWrite: false }), d: new THREE.MeshBasicMaterial({ color: 0x64b5f6, transparent: true, opacity: 0.8, depthWrite: false }) };
  const pickMat = new THREE.MeshBasicMaterial({ color: 0xffb74d, transparent: true, opacity: 0.5, depthWrite: false });
  const delMat = new THREE.MeshBasicMaterial({ color: 0xe57373, transparent: true, opacity: 0.4, depthWrite: false });
  function plate(cx, cz, m, y = 0.03) {
    const p = new THREE.Mesh(geo(CHUNK - 0.3, 0.04, CHUNK - 0.3), m);
    p.position.set(cx * CHUNK + CHUNK / 2, y, cz * CHUNK + CHUNK / 2);
    candGroup.add(p);
    return p;
  }
  function tilePlate(i, j, color, y = 0.06) {
    const p = new THREE.Mesh(geo(0.92, 0.05, 0.92), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
    p.position.set(i + 0.5, y, j + 0.5);
    candGroup.add(p);
  }
  function showCandidates() {
    candGroup.clear();
    if (buildTool === 'walls') {
      for (const E of innerEdges(editFloor)) {
        const w = (state.walls || {})[E.k] || 'open';
        const m = new THREE.Mesh(geo(E.east ? 0.3 : CHUNK - 0.6, 0.1, E.east ? CHUNK - 0.6 : 0.3), edgeMats[w]);
        m.position.set(E.x, 0.08, E.z);
        candGroup.add(m);
        const s = emojiSprite(w === 'w' ? '🧱' : w === 'd' ? '🚪' : '➕', 0.9);
        s.position.set(E.x, 0.9, E.z);
        candGroup.add(s);
      }
      return;
    }
    if (buildTool === 'stairs' && stairDraft) {
      const c = stairCells(stairDraft), ok = stairOK(stairDraft);
      for (const [i, j] of c.steps) tilePlate(i, j, ok ? 0xffb74d : 0xe57373);
      tilePlate(c.entry[0], c.entry[1], 0x81c784);
      tilePlate(c.landing[0] - UPX, c.landing[1], 0x64b5f6, 0.09);
      const a = emojiSprite('⬆️', 0.8);
      a.position.set(c.steps[1][0] + 0.5, 1.2, c.steps[1][1] + 0.5);
      candGroup.add(a);
      return;
    }
    for (const [cx, cz] of buildCands) {
      const isPick = buildPick && buildPick[0] === cx && buildPick[1] === cz;
      plate(cx, cz, buildTool === 'remove' ? delMat : buildTool === 'move' && !movePick ? pickMat : isPick ? candSelMat : candMat);
      const s = new THREE.Sprite(buildTool === 'add' || (buildTool === 'move' && movePick) ? plusMat : new THREE.SpriteMaterial({ map: emojiTexture(buildTool === 'remove' ? '🔨' : buildTool === 'stairs' ? '🪜' : '✋'), transparent: true, depthWrite: false }));
      s.scale.set(1.3, 1.3, 1);
      s.position.set(cx * CHUNK + CHUNK / 2, 0.9, cz * CHUNK + CHUNK / 2);
      candGroup.add(s);
    }
    if (movePick) plate(movePick[0], movePick[1], pickMat, 0.05);
  }
  // ----- the bar at the bottom -----
  const TOOL_NAMES = { add: 'Add', move: 'Move', walls: 'Walls', remove: 'Remove', stairs: 'Stairs' };
  function renderBuildBar() {
    const tools = ['add', 'move', 'walls', 'remove'].concat(upOpen() ? ['stairs'] : []);
    $('buildTabs').innerHTML = tools.map((t) => `<button class="decoTab${t === buildTool ? ' sel' : ''}" data-act="buildTool" data-tool="${t}">${TOOL_NAMES[t]}</button>`).join('');
    const fl = editFloor, where = fl ? 'upstairs' : 'downstairs';
    let title = '', help = '';
    switch (buildTool) {
      case 'add':
        if (fl === 1 && !hasUpstairs(state)) { title = 'First, the stairs'; help = 'Switch to Stairs and pick the room they go in'; }
        else if (roomFull(fl)) { title = fl ? `Upstairs is full (${upCap()} rooms)` : `Room for ${roomCap()} rooms`; help = fl ? 'A bigger home allows more rooms upstairs' : upOpen() ? 'Build upstairs, or upgrade your home for more' : 'Upgrade your home for more rooms'; }
        else { title = `New room ${where}: 🪙 ${expandPrice(state.chunks.length)}`; help = fl ? 'Tap a green area over a room downstairs' : 'Tap a green area next to your home'; }
        break;
      case 'move':
        title = movePick ? `Move it where? 🪙 ${movePrice()}` : 'Which room should move?';
        help = movePick ? 'Tap a green area. Furniture moves along' : 'Tap a room. Rooms with a room on top stay put';
        break;
      case 'walls':
        title = `Walls between rooms: 🪙 ${D.HOME_BUILD.wall} each`;
        help = innerEdges(fl).length ? 'Tap the line between two rooms: open → wall → doorway' : 'Only where two rooms touch';
        break;
      case 'remove':
        title = 'Tear down a room (no refund)';
        help = 'Furniture goes back to your inventory. The next room gets cheaper again';
        break;
      case 'stairs':
        if (stairDraft) { title = STAIR_NAMES[stairDraft.rot]; help = stairOK(stairDraft) ? 'Tap a tile to move them · Turn · Place' : 'They don’t fit here. Tap another tile or turn them'; }
        else { title = hasUpstairs(state) ? `Move the stairs: 🪙 ${D.HOME_BUILD.stairsMove}` : `Stairs and a first room upstairs: 🪙 ${expandPrice(state.chunks.length)}`; help = hasUpstairs(state) ? 'Tap a room that has a room above it' : 'Tap the room the stairs should go in'; }
        break;
    }
    $('buildTitle').textContent = title;
    $('buildHelp').textContent = help;
    const showFloor = upOpen() && buildTool !== 'stairs';
    $('buildFloorBtn').classList.toggle('hidden', !showFloor);
    $('buildFloorLbl').textContent = fl ? 'Downstairs' : 'Upstairs';
    $('stairTurnBtn').classList.toggle('hidden', !stairDraft);
    $('stairPlaceBtn').classList.toggle('hidden', !stairDraft);
    $('stairPlaceBtn').disabled = !(stairDraft && stairOK(stairDraft));
  }
  function refreshBuild() {
    buildCands = findCandidates();
    showCandidates();
    renderBuildBar();
  }
  function enterBuildMode(tool) {
    if (!needRank('rooms')) return;
    endFun('switch');
    editFloor = place === 'home' && mode === 'normal' ? viewFloor() : 0;
    mode = 'build';
    camFocus = null;
    buildTool = tool || 'add';
    if (editFloor === 1 && !hasUpstairs(state)) editFloor = 0;
    movePick = null; stairDraft = null; buildPick = null;
    if (buildTool === 'stairs') editFloor = 0;
    refreshBuild();
    refreshUI();
    buildInnerWalls(true);
  }
  function exitBuildMode() {
    mode = 'normal';
    buildPick = null; movePick = null; stairDraft = null;
    buildCands = [];
    candGroup.clear();
    refreshUI();
    buildInnerWalls(true);
  }
  function setBuildTool(t) {
    buildTool = t;
    movePick = null; stairDraft = null; buildPick = null;
    if (t === 'stairs') editFloor = 0;
    refreshBuild();
  }
  function toggleBuildFloor() {
    editFloor = editFloor ? 0 : 1;
    movePick = null; stairDraft = null; buildPick = null;
    if (editFloor === 1 && !hasUpstairs(state) && buildTool !== 'walls') { buildTool = 'stairs'; editFloor = 0; toast('First, the stairs: tap the room they should go in 🪜'); }
    refreshBuild();
  }
  function buildTap(gp) {
    const cx = Math.floor(gp.x / CHUNK), cz = Math.floor(gp.z / CHUNK);
    const isCand = buildCands.some(([x, z]) => x === cx && z === cz);
    switch (buildTool) {
      case 'add': if (isCand) addRoomAt(cx, cz); return;
      case 'move':
        if (!movePick) {
          if (!hasChunk(cx, cz) || chunkFloor([cx]) !== editFloor) return;
          const why = canMoveFrom([cx, cz]);
          if (why) { toast(why); return; }
          movePick = [cx, cz];
          refreshBuild();
          if (!buildCands.length) { toast('There’s nowhere else this room could go'); movePick = null; refreshBuild(); }
          return;
        }
        if (cx === movePick[0] && cz === movePick[1]) { movePick = null; refreshBuild(); return; }
        if (!isCand) return;
        {
          const price = movePrice(), from = movePick, to = [cx, cz];
          confirmBox('Move this room here?', `Costs 🪙 ${price}. Everything in it moves along. Walls along its sides come down.`, `Move for 🪙 ${price}`, state.coins >= price,
            () => { if (state.coins < price) { toast('Not enough coins yet'); return; } state.coins -= price; moveRoom(from, to); movePick = null; refreshBuild(); updateHud(); save(); });
        }
        return;
      case 'remove': {
        if (!hasChunk(cx, cz) || chunkFloor([cx]) !== editFloor) return;
        const why = canRemove([cx, cz]);
        if (why) { toast(why); return; }
        const garden = isGardenChunk(cx, cz), last = isUpChunk(cx) && upCount() === 1;
        confirmBox(garden ? 'Tear down this garden?' : 'Tear down this room?', `You don’t get the coins back. Furniture goes to your inventory.${last ? ' The stairs go too.' : ''} The next room costs 🪙 ${expandPrice(state.chunks.length - 1)}.`, 'Tear it down', true,
          () => { removeRoom([cx, cz]); refreshBuild(); save(); });
        return;
      }
      case 'walls': {
        const E = innerEdges(editFloor).map((e) => Object.assign(e, { d: e.east ? Math.abs(gp.x - e.x) + Math.max(0, Math.abs(gp.z - e.z) - CHUNK / 2) : Math.abs(gp.z - e.z) + Math.max(0, Math.abs(gp.x - e.x) - CHUNK / 2) })).sort((a, b) => a.d - b.d)[0];
        if (!E || E.d > 1.4) return;
        cycleWall(E.k);
        return;
      }
      case 'stairs': {
        if (!stairDraft) {
          if (!isCand) return;
          stairDraft = autoStairs([cx, cz]);
          if (!stairDraft) { toast('The stairs don’t fit in that room. Is it full of furniture?'); return; }
          refreshBuild();
          return;
        }
        const i = Math.floor(gp.x), j = Math.floor(gp.z);
        if (cx !== stairDraft.room[0] || cz !== stairDraft.room[1]) return;
        // keep the direction if it fits, otherwise find one that does
        const tries = [0, 1, 2, 3].map((k) => (stairDraft.rot + k) % 4);
        const rot = tries.find((r) => stairOK(Object.assign({}, stairDraft, { i, j, rot: r })));
        Object.assign(stairDraft, { i, j, rot: rot === undefined ? stairDraft.rot : rot });
        refreshBuild();
      }
    }
  }
  function addRoomAt(cx, cz) {
    const price = expandPrice(state.chunks.length), up = isUpChunk(cx);
    buildPick = [cx, cz];
    showCandidates();
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
    const garden = !up && gardensUnlocked();
    confirmBox('Build here?', `Costs 🪙 ${price} · ready in ${CONFIG.BUILD_MINUTES} minutes${garden ? ' · a room, or an open garden with grass and a fence' : ''}`,
      `🏠 Room for 🪙 ${price}`, state.coins >= price, () => go('room'), () => { buildPick = null; showCandidates(); },
      garden ? { label: `🌷 Garden for 🪙 ${price}`, enabled: state.coins >= price, fn: () => go('garden') } : null);
  }
  // ----- walls -----
  function cycleWall(k) {
    state.walls = state.walls || {};
    const cur = state.walls[k] || null, next = cur === null ? 'w' : cur === 'w' ? 'd' : null;
    const walls = Object.assign({}, state.walls);
    if (next) walls[k] = next; else delete walls[k];
    if (next === 'w' && !homeConnected(state.chunks, walls, state.stairs)) {
      // a full wall would cut a room off: go straight to a doorway instead
      walls[k] = 'd';
      toast('A full wall here would shut a room off, so it’s a doorway');
    }
    const cost = walls[k] && !cur ? D.HOME_BUILD.wall : 0;
    if (cost && state.coins < cost) { toast('Not enough coins yet'); return; }
    state.coins -= cost;
    state.walls = walls;
    if (cost) updateHud();
    sfx(walls[k] ? 'place' : 'tap');
    buildInnerWalls(true);
    dogs.forEach((d) => { d.path = null; });
    showCandidates();
    save();
  }
  // ----- the stairs -----
  function stairOK(dr) {
    const c = stairCells(dr), [rx, rz] = dr.room;
    const inRoom = ([i, j]) => Math.floor(i / CHUNK) === rx && Math.floor(j / CHUNK) === rz;
    if (!c.steps.every(inRoom) || !inRoom(c.entry) || !inRoom([c.landing[0] - UPX, c.landing[1]])) return false;
    return true;
  }
  function autoStairs(room) {
    const [rx, rz] = room, x0 = rx * CHUNK, z0 = rz * CHUNK;
    let best = null, bs = -1;
    for (let rot = 0; rot < 4; rot++) {
      for (let i = x0; i < x0 + CHUNK; i++) for (let j = z0; j < z0 + CHUNK; j++) {
        const dr = { room, i, j, rot };
        if (!stairOK(dr)) continue;
        const c = stairCells(dr);
        // prefer a spot along a wall with nothing in the way
        const busy = c.steps.concat([c.entry]).filter(([a, b]) => furnitureAt(a, b)).length;
        const wallSide = Math.min(i - x0, x0 + CHUNK - 1 - i, j - z0, z0 + CHUNK - 1 - j) === 0 ? 2 : 0;
        const sc = 10 - busy * 4 + wallSide + (rot === 0 ? 1 : 0);
        if (sc > bs) { bs = sc; best = dr; }
      }
    }
    return best;
  }
  // whatever stands where the stairs go is put back in your inventory
  function clearForStairs(st) {
    const c = stairCells(st);
    const cells = c.steps.concat([c.entry], c.steps.map(([i, j]) => [i + UPX, j]), [c.landing]);
    let moved = 0;
    for (const [i, j] of cells) {
      const f = furnitureAt(i, j);
      const isWalk = (i === c.entry[0] && j === c.entry[1]) || (i === c.landing[0] && j === c.landing[1]);
      if (f && (!isWalk || D.ITEMS[f.type].solid)) {
        if (f.gift) { returnGift(f.gift); f.gift = null; }
        state.furniture.splice(state.furniture.indexOf(f), 1);
        state.inventory[f.type] = (state.inventory[f.type] || 0) + 1;
        furnMap.delete(i + ',' + j);
        moved++;
      }
      state.clutter = state.clutter.filter((x) => !(x.i === i && x.j === j));
    }
    return moved;
  }
  function placeStairs() {
    if (!stairDraft || !stairOK(stairDraft)) return;
    const st = { i: stairDraft.i, j: stairDraft.j, rot: stairDraft.rot };
    if (!hasUpstairs(state)) {
      // the first room upstairs comes with the stairs
      const price = expandPrice(state.chunks.length), [rx, rz] = stairDraft.room;
      confirmBox('Stairs and a room upstairs?', `Costs 🪙 ${price} · ready in ${CONFIG.BUILD_MINUTES} minutes. Anything standing where the stairs go is put away.`, `Build for 🪙 ${price}`, state.coins >= price, () => {
        if (state.coins < price) { toast('Not enough coins yet'); return; }
        state.coins -= price;
        state.build = { cx: rx + UPC, cz: rz, kind: 'room', readyAt: Date.now() + CONFIG.BUILD_MINUTES * 60000, stairs: st };
        exitBuildMode();
        rebuildSite();
        updateHud();
        toast(`🪜 The builders are on it! Your upstairs is ready in ${CONFIG.BUILD_MINUTES} minutes 🏗️`);
        save();
      });
      return;
    }
    const price = D.HOME_BUILD.stairsMove;
    if (!homeConnected(state.chunks, state.walls, st)) { toast('From there you couldn’t reach every room upstairs'); return; }
    confirmBox('Move the stairs here?', `Costs 🪙 ${price}. Anything standing where they go is put away.`, `Move for 🪙 ${price}`, state.coins >= price, () => {
      if (state.coins < price) { toast('Not enough coins yet'); return; }
      state.coins -= price;
      setStairs(st);
      stairDraft = null;
      refreshBuild();
      updateHud();
      toast('🪜 The stairs are in their new spot');
      save();
    });
  }
  function setStairs(st) {
    if (st) { const n = clearForStairs(st); if (n) toast(`${n} thing${n > 1 ? 's were' : ' was'} in the way and went back to your inventory`); }
    state.stairs = st;
    syncChunkSet();
    buildRoom();
    rebuildFurniture();
    renderClutter();
    // anyone standing in the way steps aside
    for (const a of [player].concat(dogs, sitDog ? [sitDog] : [])) {
      const p = a.root.position;
      a.climb = null;
      if (isSolid(p.x, p.z)) { const q = randomFreePoint(); p.set(q.x, 0, q.z); }
    }
    dogs.forEach((d) => d.reset());
  }
  // ----- moving and removing -----
  function forRoom(cx, cz, fn) {
    const inRoom = (i, j) => Math.floor(i / CHUNK) === cx && Math.floor(j / CHUNK) === cz;
    for (const f of state.furniture.slice()) if (inRoom(f.i, f.j)) fn('furn', f);
    for (const c of state.clutter.slice()) if (inRoom(c.i, c.j)) fn('clutter', c);
    for (const b of bedsOf().slice()) if (inRoom(b.i, b.j)) fn('bed', b);
  }
  function moveRoom(from, to) {
    const [fx, fz] = from, [tx, tz] = to, di = (tx - fx) * CHUNK, dj = (tz - fz) * CHUNK;
    const kf = chunkKey(fx, fz), kt = chunkKey(tx, tz);
    forRoom(fx, fz, (_k, o) => { o.i += di; o.j += dj; });
    if (state.rooms[kf]) { state.rooms[kt] = state.rooms[kf]; delete state.rooms[kf]; }
    if (state.gardens[kf]) { state.gardens[kt] = true; delete state.gardens[kf]; }
    if (state.exhibits && state.exhibits[kf]) { state.exhibits[kt] = state.exhibits[kf]; delete state.exhibits[kf]; }
    for (const k of Object.keys(state.walls || {})) if (wallTouches(k, fx, fz)) delete state.walls[k];
    const c = state.chunks.find(([x, z]) => x === fx && z === fz);
    c[0] = tx; c[1] = tz;
    for (const a of [player].concat(dogs, sitDog ? [sitDog] : [])) {
      const p = a.root.position;
      if (Math.floor(p.x / CHUNK) === fx && Math.floor(p.z / CHUNK) === fz) { p.x += di; p.z += dj; }
    }
    afterRoomsChange();
    confetti(new V3(tx * CHUNK + CHUNK / 2, 1.5, tz * CHUNK + CHUNK / 2));
    toast('🚚 Room moved!');
    sfx('unlock');
  }
  function removeRoom([cx, cz]) {
    const k = chunkKey(cx, cz);
    let items = 0;
    forRoom(cx, cz, (kind, o) => {
      if (kind === 'furn') {
        if (o.gift) { returnGift(o.gift); o.gift = null; }
        state.furniture.splice(state.furniture.indexOf(o), 1);
        state.inventory[o.type] = (state.inventory[o.type] || 0) + 1;
        items++;
      } else if (kind === 'clutter') state.clutter.splice(state.clutter.indexOf(o), 1);
      else if (kind === 'bed') { if (o.seed && o.stage < 4) state.seeds[o.seed] = (state.seeds[o.seed] || 0) + 1; state.beds.splice(state.beds.indexOf(o), 1); }
    });
    if (state.exhibits && state.exhibits[k]) { for (const id of state.exhibits[k]) state.caught[id] = (state.caught[id] || 0) + 1; delete state.exhibits[k]; }
    delete state.rooms[k];
    delete state.gardens[k];
    for (const w of Object.keys(state.walls || {})) if (wallTouches(w, cx, cz)) delete state.walls[w];
    state.chunks = state.chunks.filter(([x, z]) => !(x === cx && z === cz));
    if (!hasUpstairs(state)) state.stairs = null;
    afterRoomsChange();
    for (const a of [player].concat(dogs, sitDog ? [sitDog] : [])) {
      const p = a.root.position;
      a.climb = null;
      if (!isHomeTile(Math.floor(p.x), Math.floor(p.z)) || isSolid(p.x, p.z)) { const q = randomFreePoint(); p.set(q.x, 0, q.z); }
    }
    if (player.root.position.x >= UP_LIM && !hasUpstairs()) editFloor = 0;
    toast(`🔨 Torn down${items ? `. ${items} thing${items > 1 ? 's' : ''} went back to your inventory` : ''}`);
    sfx('tap');
  }
  function afterRoomsChange() {
    syncChunkSet();
    buildRoom();
    rebuildFurniture();
    renderClutter();
    renderBeds();
    if (typeof renderExhibits === 'function') renderExhibits();
    computeComfort();
    renderComfortChip();
    dogs.forEach((d) => d.reset());
    player.moveTarget = null;
    updateHud();
  }
  function checkBuild() {
    const b = state.build;
    if (!b || Date.now() < b.readyAt) return;
    state.chunks.push([b.cx, b.cz]);
    if (b.kind === 'garden') state.gardens[chunkKey(b.cx, b.cz)] = true;
    state.build = null;
    if (b.stairs) setStairs(b.stairs);
    syncChunkSet();
    buildRoom();
    rebuildSite();
    if (place === 'home') confetti(new V3(b.cx * CHUNK + CHUNK / 2, 1.5, b.cz * CHUNK + CHUNK / 2));
    gainXP(D.XP_MISC.room);
    if (isUpChunk(b.cx)) state.stats.upRooms = upCount();
    toast(b.stairs ? '🪜 Your upstairs is ready! Walk up the stairs to have a look.' : b.kind === 'garden' ? '🌷 Your new garden is ready! Garden items are in the 🛒 Shop.' : '🎉 Your new room is finished! Room for one more dog.');
    checkUpstairsOpen();
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
    if (shopVendor) setTimeout(() => tip('vendor', { title: 'Vendors', text: 'Every place has its own shops with things you can’t buy at home. Tap a stall to walk over.', icon: 'shop' }), 400);
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
    // today's sale (one home shop section) or market day (vendors on walks)
    const deal = !V ? eventOn('sale') : !tix ? eventOn('market') : null;
    // a place you've mastered (3 stars) gets you 10% off at its vendors
    const known = V && !tix && starsOf(V.loc) >= 3;
    const card = (th, title, sub, price, onBuy, opts = {}) => {
      let was = null;
      const gate = opts.feat || cur.feat;
      if (gate && !unlockedFeat(gate) && !opts.owned) { opts = Object.assign({}, opts, { disabled: true, label: `Rank ${featRank(gate)}` }); }
      if (price != null && !opts.owned && !opts.label) {
        let f = 1;
        if (deal && (V || (opts.cat || cur.id) === deal.cat)) f *= 1 - deal.off;
        if (known) f *= 0.9;
        if (opts.off) f *= 1 - opts.off;
        if (f < 1) { was = price; price = Math.max(1, Math.round(price * f)); }
      }
      cur.cards.push({ th, title, sub, price, was, onBuy, ...opts });
    };
    const lockSec = (f) => { cur.feat = f; if (!unlockedFeat(f)) cur.lock = featRank(f); };
    const done = () => { updateHud(); save(); renderShop(); };
    const pay = (price) => { if (tix) state.tickets -= price; else state.coins -= price; };

    if (V) {
      const sp = vendorSpecials(shopVendor);
      if (sp.length) {
        section('week', 'This week only');
        cur.note = 'New specials every Monday: things from shops in other places, and sometimes something rare.';
        for (const [kind, key, p0] of sp) {
          if (kind === 'item') {
            const it = D.ITEMS[key], have = (state.inventory[key] || 0) + state.furniture.filter((f) => f.type === key).length;
            card(thumbOf.item(key), it.name, have ? `You have ${have} · rare` : 'Rare · hardly ever for sale', p0, (pr) => { pay(pr); state.inventory[key] = (state.inventory[key] || 0) + 1; seeRare(key); toast(`${it.name} added. Place it in Decorate`); done(); });
          } else if (kind === 'acc') {
            const A = D.ACCESSORIES[key], owned = state.accessories.includes(key);
            card(thumbOf.acc(key), A.name, owned ? 'In your wardrobe' : `For the ${A.slot} · usually ${D.VENDORS[sp.find((x) => x[1] === key)[3]].name}`, Math.round(A.price * 1.3), (pr) => { pay(pr); state.accessories.push(key); toast(`${A.name} bought! Open a dog bubble → Style`); done(); }, { owned, feat: 'boutique' });
          } else if (kind === 'outfit') {
            const O = D.OUTFITS[key], owned = state.outfits.includes(key);
            card(wearThumb(key), O.name, owned ? 'In your closet' : `For you · ${SLOT_NAMES[O.slot]}`, Math.round(O.price * 1.3), (pr) => { pay(pr); getOutfit(key, false); done(); }, { owned, feat: 'clothes' });
          } else if (kind === 'toy') {
            const t = D.TOYS[key], owned = state.toys.includes(key);
            card(thumbOf.toy(key), t.name, owned ? 'In your bag' : toyBlurb(t), Math.round(t.price * 1.3), (pr) => { pay(pr); state.toys.push(key); state.toy = key; updateToyIcons(); toast(`${t.name} is ready to throw!`); done(); }, { owned });
          } else if (kind === 'shampoo') {
            const Sh = D.SHAMPOOS[key];
            card(thumbOf.shampoo(key), Sh.name, shampooBlurb(key), Math.round(Sh.price * 1.3), (pr) => { pay(pr); state.shampoos[key] = (state.shampoos[key] || 0) + 1; done(); }, { feat: 'bath' });
          } else if (kind === 'meal') {
            const Rc = D.RECIPES[key];
            card(thumbOf.meal(key), Rc.name, Rc.desc, Math.round(Rc.price * 1.3), (pr) => { pay(pr); state.meals.push({ id: key, q: 2 }); toast(`${Rc.name} — give it from a dog's bubble → Treat`); done(); }, { feat: 'kitchen' });
          }
        }
      }
      section('stock', V.name);
      for (const [kind, key, p0] of V.stock) {
        if (kind === 'item') {
          const it = D.ITEMS[key], have = (state.inventory[key] || 0) + state.furniture.filter((f) => f.type === key).length;
          card(thumbOf.item(key), it.name, have ? `You have ${have}` : 'For your home', p0 || it.price, (pr) => { pay(pr); state.inventory[key] = (state.inventory[key] || 0) + 1; selectedInv = key; toast(`${it.name} added. Place it in Decorate`); done(); }, { feat: it.agility ? 'agility' : null });
        } else if (kind === 'meal') {
          const R = D.RECIPES[key], have = state.meals.filter((m) => m.id === key).length;
          const price = tix ? R.tickets : R.price;
          card(thumbOf.meal(key), R.name, `${R.desc}${have ? ` · you have ${have}` : ''}`, price, (pr) => { pay(pr); state.meals.push({ id: key, q: 2 }); toast(`${R.name} — give it from a dog's bubble → Treat`); done(); }, { feat: 'kitchen' });
        } else if (kind === 'shampoo') {
          const Sh = D.SHAMPOOS[key], price = tix ? Sh.tickets : Sh.price;
          card(thumbOf.shampoo(key), Sh.name, shampooBlurb(key), price, (pr) => { pay(pr); state.shampoos[key] = (state.shampoos[key] || 0) + 1; done(); }, { feat: 'bath' });
        } else if (kind === 'acc') {
          const A = D.ACCESSORIES[key], owned = state.accessories.includes(key), price = tix ? A.tickets : A.price;
          card(thumbOf.acc(key), A.name, owned ? 'In your wardrobe' : `For the ${A.slot}${A.rainproof ? ' · keeps rain dirt off' : ''}`, price, (pr) => { pay(pr); state.accessories.push(key); toast(`${A.name} ${tix ? 'won' : 'bought'}! Open a dog bubble → Style`); done(); }, { owned, feat: 'boutique' });
        } else if (kind === 'toy') {
          const t = D.TOYS[key], owned = state.toys.includes(key), price = tix ? t.tickets : t.price;
          card(thumbOf.toy(key), t.name, owned ? 'In your bag' : toyBlurb(t), price, (pr) => { pay(pr); state.toys.push(key); state.toy = key; updateToyIcons(); toast(`${t.name} is ready to throw!`); done(); }, { owned });
        } else if (kind === 'ingredient') {
          const I = D.INGREDIENTS[key];
          card(thumbOf.ing(key), I.name, `You have ${state.pantry[key] || 0} · cook at a Stove`, p0, (pr) => { pay(pr); state.pantry[key] = (state.pantry[key] || 0) + 1; done(); }, { feat: 'kitchen' });
        } else if (kind === 'outfit') {
          const O = D.OUTFITS[key], owned = state.outfits.includes(key), price = tix ? O.tickets : O.price;
          card(wearThumb(key), O.name, owned ? 'In your closet' : `For you · ${SLOT_NAMES[O.slot]}`, price, (pr) => { pay(pr); getOutfit(key, false); done(); }, { owned, feat: 'clothes' });
        } else if (kind === 'find') {
          const F = D.FINDS[key], owned = !!state.finds[key];
          card(thumbOf.find(key), F.name, 'A prize for your book', p0, (pr) => { pay(pr); grantFind(key, null); done(); }, { owned });
        }
      }
    } else {
      section('home', 'Home');
      const n = state.chunks.length;
      const downFull = downCount() >= roomCap(), allFull = downFull && (!upOpen() || upCount() >= upCap());
      if (state.build) card(TH('loc', 'room'), 'Add a room', `Building… ready in ${fmtTime(state.build.readyAt - Date.now())}`, null, null, { label: 'Busy' });
      else if (allFull) card(TH('loc', 'room'), 'Rooms', `All ${n} rooms built. Move rooms, add walls${upOpen() ? ' or move the stairs' : ''}`, 0, () => { closeShop(); enterBuildMode('move'); }, { keep: true, label: 'Rearrange', feat: 'rooms' });
      else card(TH('loc', 'room'), downFull ? 'Add a room upstairs' : 'Add a room', `You have ${n} · +1 dog · ${CONFIG.BUILD_MINUTES} min to build. Move rooms and add walls in there too`, expandPrice(n), () => { closeShop(); if (downFull && !hasUpstairs(state)) { enterBuildMode('stairs'); } else { enterBuildMode('add'); if (downFull) toggleBuildFloor(); } }, { keep: true, feat: 'rooms' });
      if (!state.build && downFull && !upOpen() && unlockedFeat('rooms') && n < CONFIG.MAX_CHUNKS) card(TH('loc', 'room'), 'More rooms', `Your ${D.HOUSE_TIERS[houseTier()].name.toLowerCase()} has room for ${roomCap()}. Upgrade your home for more${houseTier() + 1 >= D.HOME_BUILD.upFrom ? ', and an upstairs' : ''}.`, 0, () => { closeShop(); openHouse(); }, { keep: true, label: 'See home' });
      const cap = capacity(), full = dogs.length >= cap;
      const pup = todayLitter().pups.find((x) => !x.taken) || todayLitter().pups[0];
      card(TH('dog', `${pup.breed}|${pup.coat}`), 'Adopt a puppy', full ? `Home is full (${dogs.length}/${cap}). Add a room first` : `${dogs.length}/${cap} dogs · a new litter every day`, adoptPrice(), () => { closeShop(); openLitter(); }, { keep: true, disabled: full, label: full ? null : 'See litter', feat: dogs.length ? 'adopt' : null });

      section('week', 'Deals of the week');
      cur.note = '25% off, new every Monday.';
      const weekly = homeSpecials();
      // the same discount shows wherever the item is listed, not just in this section
      const wk = (kind, key) => (weekly.some(([a, b]) => a === kind && b === key) ? 0.25 : 0);
      for (const [kind, key] of weekly) {
        if (kind === 'toy') { const t = D.TOYS[key], owned = state.toys.includes(key); card(thumbOf.toy(key), t.name, owned ? 'In your bag' : toyBlurb(t), t.price, (pr) => { pay(pr); state.toys.push(key); state.toy = key; updateToyIcons(); toast(`${t.name} is ready to throw!`); done(); }, { owned, off: 0.25, cat: 'toys' }); }
        else if (kind === 'acc') { const A = D.ACCESSORIES[key], owned = state.accessories.includes(key); card(thumbOf.acc(key), A.name, owned ? 'In your wardrobe' : `For the ${A.slot}`, A.price, (pr) => { pay(pr); state.accessories.push(key); toast(`${A.name} bought! Open a dog bubble → Style`); done(); }, { owned, off: 0.25, feat: 'boutique', cat: 'boutique' }); }
        else {
          const it = D.ITEMS[key], use = it.use;
          const feat = use === 'bath' ? 'bath' : use === 'cook' ? 'kitchen' : use === 'gift' ? 'gifts' : null;
          card(thumbOf.item(key), it.name, 'For your home', it.price, (pr) => { pay(pr); state.inventory[key] = (state.inventory[key] || 0) + 1; selectedInv = key; toast(`${it.name} added. Place it in Decorate`); done(); }, { off: 0.25, feat, cat: it.cat });
        }
      }
      section('toys', 'Toys');
      for (const [k, G] of Object.entries(D.GADGETS)) {
        if (G.feat === 'farming') continue;
        const owned = (state.gadgets || []).includes(k);
        card(TH('pic', G.icon), G.name, owned ? 'You carry it on walks' : G.desc, G.price, (pr) => { pay(pr); state.gadgets = (state.gadgets || []).concat(k); toast(`${G.name} bought. ${G.bought}`); done(); }, { owned, feat: G.feat || null });
      }
      for (const [k, t] of Object.entries(D.TOYS)) {
        if (t.price == null || k === 'tennis' || t.vendor) continue;
        const owned = state.toys.includes(k);
        card(thumbOf.toy(k), t.name, owned ? 'In your bag' : toyBlurb(t), t.price, (pr) => { pay(pr); state.toys.push(k); state.toy = k; updateToyIcons(); toast(`${t.name} is ready to throw!`); done(); }, { owned, off: wk('toy', k) });
      }
      section('styles', 'Walls & floors');
      lockSec('styles');
      for (const kind of ['wall', 'floor']) {
        const defs = kind === 'wall' ? D.WALLS : D.FLOORS;
        for (const [id, st] of Object.entries(defs)) {
          if (!st.price) continue;
          const owned = state.styles.includes(id);
          card(TH(kind, id), st.name, kind === 'wall' ? 'Wallpaper' : 'Floor', st.price, (pr) => { pay(pr); state.styles.push(id); selStyle = { kind, id }; toast(`${st.name} unlocked. Apply it in Decorate → Walls & floors`); done(); }, { owned });
        }
      }
      section('boutique', 'Boutique');
      lockSec('boutique');
      for (const [id, A] of Object.entries(D.ACCESSORIES)) {
        if (A.unlock || A.vendor) continue;
        const owned = state.accessories.includes(id);
        card(thumbOf.acc(id), A.name, owned ? 'In your wardrobe' : `For the ${A.slot}${A.rainproof ? ' · keeps rain dirt off' : ''}`, A.price, (pr) => { pay(pr); state.accessories.push(id); toast(`${A.name} bought! Open a dog bubble → Style`); done(); }, { owned, off: wk('acc', id) });
      }
      section('bath', 'Shampoo');
      lockSec('bath');
      for (const [id, Sh] of Object.entries(D.SHAMPOOS)) {
        if (Sh.vendor) continue;
        card(thumbOf.shampoo(id), Sh.name, shampooBlurb(id), Sh.price, (pr) => { pay(pr); state.shampoos[id] = (state.shampoos[id] || 0) + 1; done(); });
      }
      cur.note = 'More shampoos are sold by vendors on walks.';
      section('style', 'Your style');
      lockSec('clothes');
      cur.note = 'Wear new clothes in Menu → You. More are sold by vendors on walks, and some can only be earned.';
      for (const [id, O] of Object.entries(D.OUTFITS)) {
        if (!O.price || O.vendor || O.unlock || O.tickets) continue;
        const owned = state.outfits.includes(id);
        card(wearThumb(id), O.name, owned ? 'In your closet' : SLOT_NAMES[O.slot], O.price, (pr) => { pay(pr); getOutfit(id, false); done(); }, { owned });
      }
      section('seeds', 'Garden tools & seeds');
      lockSec('farming');
      cur.note = gardensUnlocked() ? 'Dig beds in a garden with the hoe, then plant. Water makes plants grow faster and give more.' : 'You need a garden for these: turn a room into a garden first.';
      for (const [k, G] of Object.entries(D.GADGETS)) {
        if (G.feat !== 'farming') continue;
        const owned = (state.gadgets || []).includes(k);
        card(TH('pic', G.icon), G.name, owned ? 'Yours' : G.desc, G.price, (pr) => { pay(pr); state.gadgets = (state.gadgets || []).concat(k); toast(`${G.name} bought. ${G.bought}`); done(); }, { owned });
      }
      for (const [k, Sd] of Object.entries(D.SEEDS)) {
        card(TH('pic', Sd.icon), Sd.name, `You have ${state.seeds[k] || 0} · ${Sd.flower ? 'flowers that keep blooming' : `grows ${D.INGREDIENTS[Sd.crop].name.toLowerCase()}`} · about ${Math.round(Sd.stage * 4 / 60 * 10) / 10} h`, Sd.price, (pr) => { pay(pr); state.seeds[k] = (state.seeds[k] || 0) + 1; done(); });
      }
      section('pantry', 'Pantry');
      lockSec('kitchen');
      for (const [id, I] of Object.entries(D.INGREDIENTS)) {
        if (I.price == null) continue;
        card(thumbOf.ing(id), I.name, `You have ${state.pantry[id] || 0} · cook at a Stove`, I.price, (pr) => { pay(pr); state.pantry[id] = (state.pantry[id] || 0) + 1; done(); });
      }
      for (const [cat, title] of D.CATS) {
        section(cat, plain(title));
        if (cat === 'luxury') lockSec('luxury');
        if (cat === 'agility') lockSec('agility');
        if (cat === 'garden' && !unlockedFeat('gardens')) lockSec('gardens');
        const locked = cat === 'garden' && unlockedFeat('gardens') && !gardensUnlocked();
        if (locked) cur.note = `Unlocks with gardens: a home with ${D.GARDEN_UNLOCK_SECTIONS} rooms.`;
        for (const [t, it] of Object.entries(D.ITEMS)) {
          if (it.cat !== cat || it.price == null) continue;
          const owned = (state.inventory[t] || 0) + state.furniture.filter((f) => f.type === t).length;
          const kind = locked ? 'Needs gardens' : it.use === 'bath' ? 'Tap it for bath time' : it.use === 'cook' ? 'Tap it to cook' : it.use === 'gift' ? 'Pack gifts for visitors' : it.auto ? 'Refills itself' : it.role === 'bed' ? (it.regen ? 'Dogs rest extra fast' : 'Dogs nap on it') : it.role === 'food' ? 'Fill it with Bowls' : it.role === 'water' ? 'Fill it with Bowls' : it.use ? 'Tap it to use' : it.lounge ? 'Couch Potatoes love it' : it.garden ? 'For gardens' : it.solid ? 'Decoration' : 'Dogs can walk on it';
          const use = it.use;
          const feat = use === 'bath' ? 'bath' : use === 'cook' ? 'kitchen' : use === 'bake' ? 'baking' : use === 'gift' ? 'gifts' : use === 'paint' ? 'painting' : use === 'mail' ? 'letters' : it.agility ? 'agility' : (t === 'terrarium' || t === 'insecthotel') ? 'catching' : null;
          card(thumbOf.item(t), it.name, owned ? `You have ${owned} · ${it.agility ? 'part of your agility course' : use === 'paint' ? 'paint your dogs' : use === 'mail' ? 'write to neighbors' : kind}` : it.agility ? `Agility obstacle · ${D.OBSTACLES[it.agility].name}` : use === 'paint' ? 'Tap it to paint your dogs' : use === 'mail' ? 'Write to the neighbors' : kind, it.price, (pr) => { pay(pr); state.inventory[t] = (state.inventory[t] || 0) + 1; selectedInv = t; toast(`${it.name} added. Place it in Decorate`); done(); }, { disabled: locked, label: locked ? 'Locked' : null, count: owned, feat, off: wk('item', t) });
        }
      }
    }

    // tabs (home shop only): All first, then each section
    const nav = $('shopNav');
    const tabbed = !V;
    if (tabbed && !secs.some((x) => x.id === shopTab)) shopTab = 'all';
    nav.classList.toggle('hidden', !tabbed);
    if (tabbed) {
      const tabs = [['all', 'All'], ...secs.map((x) => [x.id, x.label, x.lock])];
      const key = tabs.map((t) => t[0] + (t[2] ? '!' : '')).join();
      if (nav.dataset.built !== key) {
        nav.dataset.built = key;
        nav.innerHTML = tabs.map(([id, label, lk]) => `<button class="seg${lk ? ' rlocked' : ''}" data-tab="${id}">${lk ? IC('lock') : ''}${esc(label)}</button>`).join('');
      }
      nav.querySelectorAll('.seg').forEach((b) => b.classList.toggle('sel', b.dataset.tab === shopTab));
    }
    for (const x of secs) if (x.lock) { x.note = `Opens at Trainer rank ${x.lock}.`; if (shopTab === 'all') x.cards = x.cards.slice(0, 3); }
    const ordered = secs.filter((x) => !x.lock).concat(secs.filter((x) => x.lock).sort((a, b) => a.lock - b.lock));
    const show = !tabbed || shopTab === 'all' ? ordered : secs.filter((x) => x.id === shopTab);
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
        else b.innerHTML = `${IC(tix ? 'ticket' : 'coin')}<span>${c.price}</span>${c.was ? `<s>${c.was}</s>` : ''}`;
        if (c.was) el.classList.add('deal');
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
    const seeds = Object.entries(state.seeds || {}).filter(([, n]) => n > 0);
    $('bagExtra').innerHTML = (state.tmap ? `<button class="row bagMap" data-act="tmap"><div class="ic">${TH('pic', '🗺️')}</div><div class="txt"><b>Treasure map</b><small>${esc(D.LOCATIONS[state.tmap.loc].name)} · tap to look</small></div></button>` : '') +
      (unlockedFeat('catching') && (hasGadget('net') || Object.keys(state.catchBook || {}).length) ? `<button class="row bagMap" data-act="critters"><div class="ic">${TH('pic', '🦋')}</div><div class="txt"><b>Critters</b><small>${Object.values(state.caught || {}).reduce((a, n) => a + n, 0)} in your jar · ${Object.keys(state.catchBook || {}).length} kinds caught</small></div></button>` : '') +
      (Object.values(state.treats || {}).some((n) => n > 0) ? `<p class="sub">Treat tin: ${Object.entries(state.treats).filter(([, n]) => n > 0).map(([k, n]) => `${D.BAKES[k].icon} ${n}`).join(' · ')}</p>` : '') +
      (seeds.length || state.bouquets ? `<p class="sub">${seeds.map(([k, n]) => `${D.SEEDS[k].icon} ${n}`).join(' · ')}${state.bouquets ? `${seeds.length ? ' · ' : ''}💐 ${state.bouquets} bouquet${state.bouquets > 1 ? 's' : ''}` : ''}</p>` : '');
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
    toast(`Say hi to ${name}!`);
    if (state.tutorial === 'new') setTimeout(startTutorial, 1400);
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
    if (dogs.length && !needRank('adopt')) return;
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
    gainXP(D.XP_MISC.adopt);
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
    let rescue = null;
    try { rescue = JSON.parse(localStorage.getItem(RESCUE_KEY)); } catch (_) { rescue = null; }
    $('rescueInfo').classList.toggle('hidden', !rescue);
    $('rescueBtn').classList.toggle('hidden', !rescue);
    if (rescue) $('rescueInfo').textContent = `A save from ${new Date(rescue.at).toLocaleString()} could not be opened, so it is kept here untouched. Download it to keep it safe.`;
    if (!upd.busy && !upd.found) { $('updInfo').classList.remove('found'); $('updNowBtn').classList.add('hidden'); }
    $('verInfo').textContent = `PixelPups · save format v${CONFIG.SAVE_VERSION} · ${dogs.length} dog${dogs.length === 1 ? '' : 's'} · 🪙 ${state.coins}`;
    $('optSfx').checked = prefs.sfx;
    $('optMusic').checked = prefs.music;
    $('optHaptics').checked = !!prefs.haptics;
    $('optBig').checked = !!prefs.bigui;
    $('replayTut').disabled = !dogs.length;
    $('settings').classList.remove('hidden');
  }
  $('optSfx').addEventListener('change', (e) => { prefs.sfx = e.target.checked; savePrefs(); wakeAudio(); sfx('tip'); });
  $('optMusic').addEventListener('change', (e) => { prefs.music = e.target.checked; savePrefs(); wakeAudio(); });
  $('optHaptics').addEventListener('change', (e) => { prefs.haptics = e.target.checked; savePrefs(); haptic(); });
  $('optBig').addEventListener('change', (e) => { prefs.bigui = e.target.checked; savePrefs(); applyBigUI(); });
  // ----- Updates: phones sometimes keep running an old copy of the game -----
  const GAME_FILES = ['style.css', 'data.js', 'art.js', 'game.js'];
  const upd = { busy: false, found: false, boot: null };
  const fingerprint = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + t.length; };
  const pageURL = () => location.pathname + location.search;
  async function printOf(url, fresh) {
    const r = await fetch(fresh ? url.split('?')[0] + '?check=' + Date.now() : url, { cache: fresh ? 'no-store' : 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return fingerprint(await r.text());
  }
  // what this copy of the game is running (read once, shortly after starting)
  function bootPrints() {
    if (!upd.boot) {
      upd.boot = Promise.all([printOf(pageURL(), false), ...GAME_FILES.map((f) => printOf(f + (window.PP_BUST || ''), false))]);
      upd.boot.catch(() => { upd.boot = null; });
    }
    return upd.boot;
  }
  async function checkForUpdate() {
    if (upd.busy) return;
    upd.busy = true;
    const info = $('updInfo'), btn = $('updCheckBtn');
    btn.disabled = true;
    info.classList.remove('found');
    info.textContent = 'Looking for a newer version…';
    try {
      const now = await bootPrints();
      const fresh = await Promise.all([printOf(location.pathname, true), ...GAME_FILES.map((f) => printOf(f, true))]);
      upd.found = fresh.some((p, i) => p !== now[i]);
      if (upd.found) {
        info.classList.add('found');
        info.textContent = 'Update found! A newer version of PixelPups is ready. Your game comes along when you update.';
        $('updNowBtn').classList.remove('hidden');
      } else info.textContent = 'You already have the newest version.';
    } catch (_) {
      info.textContent = 'Couldn’t reach the game’s website. Check your connection and try again.';
    }
    btn.disabled = false;
    upd.busy = false;
  }
  async function updateNow() {
    if (upd.busy) return;
    upd.busy = true;
    $('updNowBtn').disabled = true;
    $('updInfo').textContent = 'Packing up your game…';
    // 1. a fresh save, a backup, and a copy that the new version picks up when it starts
    save();
    backupCurrent();
    try {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY)); } catch (_) { data = null; }
      localStorage.setItem(TRANSFER_KEY, JSON.stringify({ at: Date.now(), data: data || JSON.parse(JSON.stringify(state)) }));
    } catch (_) {
      $('updInfo').textContent = 'Couldn’t pack up your game, so nothing was changed. Try downloading your save first.';
      $('updNowBtn').disabled = false;
      upd.busy = false;
      return;
    }
    noSave = true;
    // 2. replace the old copies the browser kept, then load the game files under a new name
    $('updInfo').textContent = 'Getting the new version…';
    await Promise.all([location.pathname, ...GAME_FILES].map((f) => fetch(f, { cache: 'reload' }).catch(() => null)));
    try { localStorage.setItem(BUST_KEY, String(Date.now())); } catch (_) { /* the reload below still helps */ }
    const q = new URLSearchParams(location.search);
    q.set('u', String(Date.now()));
    location.replace(location.pathname + '?' + q.toString());
  }
  function keepRescue(text) {
    try { localStorage.setItem(RESCUE_KEY, JSON.stringify({ at: Date.now(), text })); } catch (_) { /* nothing more we can do */ }
  }
  function backupCurrent() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (!raw) return;
      const cur = JSON.parse(raw);
      // never replace a backup that has dogs in it with a save that has none
      let old = null;
      try { old = JSON.parse(localStorage.getItem(CONFIG.BACKUP_KEY)); } catch (_) { old = null; }
      if (old && old.data && (old.data.dogs || []).length && !(cur.dogs || []).length) return;
      localStorage.setItem(CONFIG.BACKUP_KEY, JSON.stringify({ at: Date.now(), data: cur }));
    } catch (_) { /* storage full or unavailable */ }
  }
  function replaceSave(obj) {
    save();
    backupCurrent();
    noSave = true;
    try {
      if (obj) localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(obj));
      else localStorage.removeItem(CONFIG.SAVE_KEY);
      localStorage.removeItem(LAST_KEY);
    } catch (_) { toast('Could not write the save — storage unavailable'); noSave = false; return; }
    location.reload();
  }
  function importText(text) {
    let obj;
    try { obj = decodeSave(text); } catch (_) { toast("That code doesn't look like a PixelPups save"); return; }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.dogs)) { toast("That code doesn't look like a PixelPups save"); return; }
    const n = obj.dogs.length;
    confirmBox('Import this save?', `It has ${n} dog${n === 1 ? '' : 's'} and 🪙 ${obj.coins || 0}. Your current game is backed up first and can be restored from Settings.`, 'Import and restart', true, () => replaceSave(obj));
  }
  $('settings').addEventListener('click', async (e) => {
    if (e.target.id === 'settings' || e.target.closest('[data-act="closeSettings"]')) { $('settings').classList.add('hidden'); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'replayTut') {
      $('settings').classList.add('hidden');
      if (title) leaveTitle(() => startTutorial()); else startTutorial();
      return;
    }
    if (b.id === 'resetTips') { state.tips = []; save(); toast('Tips will show again'); return; }
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
      a.download = `pixelpups-save-${clockNow.dateKey}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } else if (b.id === 'visitBtn') {
      if (!needRank('gifts')) return;
      $('visitCode').value = visitLink();
      $('visitBox').classList.remove('hidden');
      const n = state.furniture.filter((f) => f.gift).length;
      $('visitInfo').textContent = n ? `Your link includes ${n} gift box${n > 1 ? 'es' : ''} 🎁` : 'Tip: place a 🎁 Gift box and pack something for your friends.';
    } else if (b.id === 'copyVisitBtn') {
      const ta = $('visitCode');
      try { await navigator.clipboard.writeText(ta.value); toast('Visit link copied 📋'); }
      catch (_) { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('Visit link copied 📋'); } catch (__) { toast('Select the link and copy it manually'); } }
    } else if (b.id === 'shareVisitBtn') {
      if (navigator.share) { try { await navigator.share({ title: 'Visit my PixelPups home', url: $('visitCode').value }); } catch (_) { /* cancelled */ } }
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
    } else if (b.id === 'rescueBtn') {
      let rescue = null;
      try { rescue = JSON.parse(localStorage.getItem(RESCUE_KEY)); } catch (_) { rescue = null; }
      if (!rescue) return;
      const blob = new Blob([rescue.text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pixelpups-kept-save.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } else if (b.id === 'updCheckBtn') {
      checkForUpdate();
    } else if (b.id === 'updNowBtn') {
      updateNow();
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
    const bars = ['actions', 'parkActions', 'decoBar', 'buildBar', 'tips'].map($).filter((e) => !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0);
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
    renderInboxTile();
    document.body.classList.toggle('visiting', !!visit);
    $('hud').classList.toggle('hidden', mode === 'trick' || !!visit);
    $('actions').classList.toggle('hidden', !(place === 'home' && mode === 'normal'));
    $('parkActions').classList.toggle('hidden', place !== 'park' || mode === 'trick');
    if (mode !== 'normal') setCtx(null);
    updateLocChip();
    $('decoBar').classList.toggle('hidden', mode !== 'decorate');
    document.body.classList.toggle('decorating', mode === 'decorate' || mode === 'build');
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
    if (!$('weather').classList.contains('hidden') && Math.floor(clockNow.hour * 4) !== updateHud.wxq) { updateHud.wxq = Math.floor(clockNow.hour * 4); if (!$('wxPage').classList.contains('hidden')) openWeather(true); }
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
        sfx(v > w.from ? 'coin' : 'pay');
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
    refreshGates();
    $('tileHouseSub').textContent = D.HOUSE_TIERS[houseTier()].name;
    const asks = Object.keys(D.STORIES).filter((o) => storyOf(o) && storyChapter(o) && storyReady(o)).length;
    $('tilePeopleSub').textContent = asks ? `${asks} waiting for you` : 'Their stories';
    const home = place === 'home' && !visit;
    $('tileDecorate').classList.toggle('hidden', !home);
    $('hubTitle').textContent = place === 'park' ? LOC().name : 'Menu';
    $('tileBagSub').textContent = `${state.toys.length} toys · throwing the ${(D.TOYS[state.toy] || D.TOYS.tennis).name.toLowerCase()}`;
    let all = 0, got = 0;
    for (const [id] of bookPages()) { const pg = bookPage(id); all += pg.total; got += pg.done; }
    $('tileAlbumSub').textContent = `${got} of ${all} collected`;
    const left = state.daily && unlockedFeat('daily') ? state.daily.items.filter((c) => !c.done).length : 0;
    $('tileDailySub').textContent = !state.daily ? "Today's goals" : left ? `${left} left today` : 'All done today';
    computeComfort();
    renderComfortChip();
    renderEventRow();
    updateHud();
    $('hub').classList.remove('hidden');
    tutEvent('menu');
  }
  const closeHub = () => $('hub').classList.add('hidden');
  $('hub').addEventListener('click', (e) => {
    if (e.target.id === 'hub' || e.target.closest('[data-act="closeHub"]')) { closeHub(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeHub();
    doAct(b.dataset.act, b);
  });
  // food and water at once (bowls are free to fill)
  function fillAll() {
    const has = (role) => state.furniture.some((f) => roleOf(f) === role);
    if (!has('food') && !has('water')) { toast('Place a food or water bowl first (🐾 Menu → 🎨 Decorate)'); return; }
    tutEvent('bowls');
    if (has('food')) fillBowls('food', true);
    if (has('water')) fillBowls('water', true);
    toast(has('food') && has('water') ? 'Bowls filled with food and water' : has('food') ? 'Food bowls filled' : 'Water bowls filled');
  }
  function doAct(act, b) {
    if (act === 'ball' && ballHeld) { ballHeld = false; return; }
    if (act === 'ball') tutEvent('throw');
    if (act === 'menu') openHub();
    else if (act === 'photo') { if (needRank('photo')) enterPhoto(); }
    else if (act === 'me') openCreator('edit');
    else if (act === 'inbox') openInbox();
    else if (act === 'event') { const def = eventDef(); if (def) news({ title: `Today: ${def.title}`, text: eventText(), th: TH('pic', def.icon) }); }
    else if (act === 'bowls') fillAll();
    else if (act === 'feed') fillBowls('food');
    else if (act === 'water') fillBowls('water');
    else if (act === 'ball') throwBall();
    else if (act === 'walk') openMap();
    else if (act === 'daily') { if (needRank('daily')) openDaily(); }
    else if (act === 'ranks') openRanks();
    else if (act === 'people') openPeople();
    else if (act === 'house') openHouse();
    else if (act === 'album') openAlbum();
    else if (act === 'ctx') ctxAction();
    else if (act === 'tmap') { $('bag').classList.add('hidden'); openTreasureMap(); }
    else if (act === 'critters') { $('bag').classList.add('hidden'); openCritters(); }
    else if (act === 'locinfo') locChipInfo();
    else if (act === 'home') goHome();
    else if (act === 'decorate') enterDecorate();
    else if (act === 'done') exitDecorate();
    else if (act === 'shop') openShop();
    else if (act === 'bag') openBag();
    else if (act === 'settings') openSettings();
    else if (act === 'cancelBuild') exitBuildMode();
    else if (act === 'buildTool') setBuildTool(b.dataset.tool);
    else if (act === 'buildFloor') toggleBuildFloor();
    else if (act === 'stairTurn') { if (stairDraft) { const tries = [1, 2, 3].map((k) => (stairDraft.rot + k) % 4); const r = tries.find((x) => stairOK(Object.assign({}, stairDraft, { rot: x }))); stairDraft.rot = r === undefined ? (stairDraft.rot + 1) % 4 : r; refreshBuild(); } }
    else if (act === 'stairPlace') placeStairs();
    else if (act === 'decoFloor') { editFloor = editFloor ? 0 : 1; renderInv(); }
    else if (act === 'tricks') enterTrickMode(selected && dogs.includes(selected) ? selected : dogs[0]);
    else if (act === 'comfort') openComfort();
    else if (act === 'leaveVisit') leaveVisit();
    else if (act === 'leash') leashButton();
    else if (act === 'tab') { if (b.dataset.tab === 'style' && !needRank('styles')) return; decoTab = b.dataset.tab; renderInv(); }
    else if (act === 'clock') {
      const W = curWeather();
      openWeather();
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
    7(s) { // v7 -> v8: tips, the guided start, daily events
      s.tips = [];
      s.tutorial = 'done';      // players who already know the game skip the guided start
      s.event = null;
      notes.add('v8');
      return s;
    },
    8(s) { // v8 -> v9: your own character (looks like the old default) and clothes
      s.look = { body: 'a', hair: 0, skin: '#f1c8a0', hairColor: '#5a3a22', fav: '#5b7cfa', outfit: { top: 'tee', bottom: 'jeans' } };
      s.outfits = ['tee', 'jeans'];
      s.lookDone = true;
      notes.add('v9');
      return s;
    },
    9(s) { // v9 -> v10: trainer rank and place mastery. Old players keep everything they already use.
      const st = s.stats || {}, finds = s.finds || {}, dogsD = Array.isArray(s.dogs) ? s.dogs : [];
      const unlocked = Array.isArray(s.unlocked) ? s.unlocked.filter((id) => D.LOCATIONS[id]) : [];
      const lvl = (d, id) => trickLevelOf((d.tricks || {})[id] || 0);
      const obed = Math.max(0, ...dogsD.map((d) => Object.keys(ALL_TRICKS).reduce((a, id) => a + lvl(d, id), 0)));
      const nFinds = Object.keys(finds).filter((k) => D.FINDS[k] && finds[k] > 0).length;
      const chunks = Array.isArray(s.chunks) ? s.chunks.length : 1;
      const glades = Array.isArray(s.glades) ? s.glades.length : 0;
      let xp = (st.walks || 0) * 30 + nFinds * 25 + (st.challengesDone || 0) * 40 + obed * 8 + unlocked.length * 150 +
        dogsD.length * 50 + Math.max(0, chunks - 1) * 60 + glades * 25 + (s.treasures || 0) * 20 + (s.summits || 0) * 30;
      // whatever you already use stays usable: your rank is at least high enough for it
      const items = (Array.isArray(s.furniture) ? s.furniture.map((f) => f && f.type) : []).concat(Object.keys(s.inventory || {}).filter((k) => s.inventory[k] > 0));
      const has = (t) => items.includes(t);
      let min = 1;
      const need = (f) => { min = Math.max(min, D.RANK_UNLOCKS[f].rank); };
      if (dogsD.some((d) => Object.keys(d.tricks || {}).length)) need('tricks');
      if (s.daily) need('daily');
      if ((s.accessories || []).length) need('boutique');
      if (has('bathtub')) need('bath');
      if (has('stove') || (s.meals || []).length) need('kitchen');
      if (dogsD.length > 1) need('adopt');
      if (dogsD.some((d) => lvl(d, 'come') >= CONFIG.OFFLEASH_COME_LEVEL)) need('offleash');
      if (chunks > 1 || s.build) need('rooms');
      if (has('giftbox')) need('gifts');
      if (s.gardens && Object.keys(s.gardens).length) need('gardens');
      if (items.some((t) => D.ITEMS[t] && D.ITEMS[t].cat === 'luxury')) need('luxury');
      for (const id of unlocked) for (const U of reqsOf(id)) if (U.kind === 'rank') min = Math.max(min, U.n);
      xp = Math.max(xp, xpAtRank(min));
      s.xp = Math.round(xp);
      s.rankSeen = rankInfo(s.xp).rank;
      // mastery from how much you've done in each place
      const m = {};
      for (const id of Object.keys(D.LOCATIONS)) {
        let p = ((s.locWalks || {})[id] || 0) * 14 + Object.keys(finds).filter((k) => D.FINDS[k] && D.FINDS[k].loc === id && finds[k] > 0).length * 15;
        if (id === 'forest') p += glades * 20;
        if (id === 'beach') p += (s.treasures || 0) * 10;
        if (id === 'alpine') p += (s.summits || 0) * 25;
        if (p > 0) m[id] = Math.min(D.MASTERY_STARS[5], p);
      }
      s.mastery = m;
      s.xpDay = null;
      notes.add('v10');
      return s;
    },
    10(s) { // v10 -> v11: bond hearts, specialties, exam badges. Hearts you already earned count, without a pile of cards.
      if (Array.isArray(s.dogs)) for (const d of s.dogs) {
        if (!d || typeof d !== 'object') continue;
        d.bondSeen = heartsOfBond(d.bond || 0);
        d.badges = [];
        d.spec = null;
        d.specPts = 0;
        d.examDay = -1;
      }
      notes.add('v11');
      return s;
    },
    11(s) { // v11 -> v12: home tiers and neighbor stories. A home that's already big keeps its rooms.
      const n = Array.isArray(s.chunks) ? s.chunks.length : 1;
      s.houseTier = Math.max(0, D.HOUSE_TIERS.findIndex((T) => T.rooms >= n));
      s.stories = {};
      s.allowanceDay = '';
      notes.add('v12');
      return s;
    },
    12(s) { // v12 -> v13: critter guide, monthly sets, collection sets. Sets you already finished pay out right away.
      s.critters = {};
      s.seasonsDone = [];
      s.setsDone = [];
      const finds = s.finds || {}, names = [];
      for (const S of D.SETS) {
        if (!S.finds.every((k) => finds[k])) continue;
        s.setsDone.push(S.id);
        names.push(S.name);
        const R = S.reward;
        s.coins = (s.coins || 0) + (R.coins || 0);
        s.xp = (s.xp || 0) + (R.xp || 0);
        if (R.item) { s.inventory = s.inventory || {}; s.inventory[R.item] = (s.inventory[R.item] || 0) + 1; }
      }
      s.setsWelcome = names;
      notes.add('v13');
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
    // walls between rooms and the stairs (both need the rooms they belong to)
    {
      const has = new Set(st.chunks.map(([x, z]) => x + ',' + z));
      if (!st.walls || typeof st.walls !== 'object') st.walls = {};
      for (const [k, v] of Object.entries(st.walls)) {
        const [x, z, side] = k.split(','), X = +x, Z = +z;
        const other = side === 'e' ? (X + 1) + ',' + Z : X + ',' + (Z + 1);
        if (!['w', 'd'].includes(v) || !has.has(X + ',' + Z) || !has.has(other)) delete st.walls[k];
      }
      const up = st.chunks.some(([x]) => x >= UPC - 20);
      const okSt = (o) => o && Number.isFinite(o.i) && Number.isFinite(o.j) && [0, 1, 2, 3].includes(o.rot);
      if (!okSt(st.stairs) || (!up && !(st.build && st.build.stairs))) st.stairs = up && okSt(st.stairs) ? st.stairs : null;
      if (st.build && st.build.stairs && !okSt(st.build.stairs)) st.build = null;
    }
    if (!Array.isArray(st.styles)) st.styles = freeStyles();
    for (const f of freeStyles()) if (!st.styles.includes(f)) st.styles.push(f);
    if (!Array.isArray(st.dogs)) st.dogs = [];
    st.dogs = st.dogs.filter((d) => d && typeof d === 'object');
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
    st.beds = Array.isArray(st.beds) ? st.beds.filter((b) => b && Number.isFinite(b.i) && Number.isFinite(b.j)).map((b) => Object.assign({ seed: null, stage: 0, prog: 0, water: [], wet: 0, last: Date.now() }, b, { seed: D.SEEDS[b.seed] ? b.seed : null, water: Array.isArray(b.water) ? b.water : [] })) : [];
    st.seeds = obj(st.seeds);
    for (const k of Object.keys(st.seeds)) if (!D.SEEDS[k]) delete st.seeds[k];
    st.bouquets = Math.max(0, +st.bouquets || 0);
    st.paintings = Array.isArray(st.paintings) ? st.paintings.filter((p) => p && p.id && typeof p.url === 'string') : [];
    st.furniture = st.furniture.filter((f) => f.type !== 'painting' || st.paintings.some((p) => p.id === f.pid));
    st.playerName = String(st.playerName || '').replace(/[<>{}]/g, '').trim().slice(0, 16);
    // round 3: treat tin, critters, snow figures, fish, rivals, the museum
    const obj3 = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
    const nums = (o, ok) => { const r = {}; for (const [k, v] of Object.entries(obj3(o))) if (ok(k) && Number.isFinite(+v) && +v > 0) r[k] = Math.floor(+v); return r; };
    st.treats = nums(st.treats, (k) => !!D.BAKES[k]);
    st.caught = nums(st.caught, (k) => !!D.CATCH[k]);
    st.catchBook = nums(st.catchBook, (k) => !!D.CATCH[k]);
    st.exhibits = Object.fromEntries(Object.entries(obj3(st.exhibits)).map(([k, v]) => [k, (Array.isArray(v) ? v : []).filter((x) => D.CATCH[x])]));
    st.snowmen = (Array.isArray(st.snowmen) ? st.snowmen : []).filter((x) => x && Number.isFinite(x.x) && Number.isFinite(x.z));
    st.fishCaught = Object.fromEntries(Object.entries(obj3(st.fishCaught)).filter(([k, v]) => D.FISH[k] && v && v.n > 0));
    st.rivals = obj3(st.rivals);
    st.favorsFrom = obj3(st.favorsFrom);
    if (st.museum && (typeof st.museum !== 'object' || !st.museum.halls)) st.museum = null;
    if (st.museum) for (const [k, h] of Object.entries(st.museum.halls)) if (!h || !Array.isArray(h.slots)) delete st.museum.halls[k];
    if (st.tmap && !(st.tmap.loc && D.LOCATIONS[st.tmap.loc])) st.tmap = null;
    if (st.sitting && !D.NEIGHBORS.some((N) => N.owner === st.sitting.owner)) st.sitting = null;
    st.clutter = Array.isArray(st.clutter) ? st.clutter.filter((c) => c && (c.kind === 'hole' || c.kind === 'prints' || (c.kind === 'toy' && D.TOYS[c.type]))) : [];
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
    if (!Array.isArray(st.tips)) st.tips = [];
    st.look = cleanLook(st.look);
    if (!Array.isArray(st.outfits)) st.outfits = [];
    st.outfits = st.outfits.filter((k) => D.OUTFITS[k]);
    for (const k of Object.keys(D.OUTFITS)) if (D.OUTFITS[k].starter && !st.outfits.includes(k)) st.outfits.push(k);
    for (const slot of Object.keys(st.look.outfit)) if (!st.outfits.includes(st.look.outfit[slot])) delete st.look.outfit[slot];
    if (!st.look.outfit.top) st.look.outfit.top = 'tee';
    if (!st.look.outfit.bottom) st.look.outfit.bottom = 'jeans';
    st.lookDone = st.lookDone !== false;
    if (st.tutorial !== 'done' && st.tutorial !== 'new') st.tutorial = 'done';
    st.gadgets = Array.isArray(st.gadgets) ? st.gadgets.filter((k) => D.GADGETS[k]) : [];
    st.chats = obj(st.chats);
    st.critters = obj(st.critters);
    for (const k of Object.keys(st.critters)) if (!D.CRITTERS[k]) delete st.critters[k];
    st.setsDone = Array.isArray(st.setsDone) ? st.setsDone.filter((id) => D.SETS.some((S) => S.id === id)) : [];
    st.seasonsDone = Array.isArray(st.seasonsDone) ? st.seasonsDone.filter((m) => D.SEASONS[m]).map(String) : [];
    st.crittersDone = !!st.crittersDone;
    st.houseTier = clamp(Math.round(+st.houseTier || 0), 0, D.HOUSE_TIERS.length - 1);
    st.stories = obj(st.stories);
    for (const k of Object.keys(st.stories)) { const v = st.stories[k]; if (!D.STORIES[k] || !v || typeof v !== 'object') delete st.stories[k]; else { v.ch = clamp(Math.round(+v.ch || 0), 0, D.STORIES[k].length); v.n = +v.n || 0; v.day = v.day == null ? -1 : +v.day; } }
    if (typeof st.allowanceDay !== 'string') st.allowanceDay = '';
    st.xp = Math.max(0, Math.round(+st.xp || 0));
    st.rankSeen = clamp(Math.round(+st.rankSeen || 1), 1, D.RANK_MAX);
    st.mastery = obj(st.mastery);
    // shaped places: hidden spots you found, and the parts of each map you have explored
    st.hiddenFound = obj(st.hiddenFound);
    for (const k of Object.keys(st.hiddenFound)) if (!D.LOCATIONS[k] || !Array.isArray(st.hiddenFound[k])) delete st.hiddenFound[k]; else st.hiddenFound[k] = st.hiddenFound[k].filter((x) => typeof x === 'string');
    // calendar, keepsakes, news you missed, journal photos, meetups
    st.cal = obj(st.cal);
    st.keepsakes = obj(st.keepsakes);
    st.inbox = Array.isArray(st.inbox) ? st.inbox.filter((x) => x && typeof x.title === 'string').slice(0, 40) : [];
    st.photos = Array.isArray(st.photos) ? st.photos.filter((p) => p && typeof p.url === 'string' && p.url.startsWith('data:image') && Array.isArray(p.dogs)).slice(-12) : [];
    if (st.meetup && !(typeof st.meetup === 'object' && D.LOCATIONS[st.meetup.loc] && Array.isArray(st.meetup.spot) && D.NEIGHBORS.some((N) => N.owner === st.meetup.owner))) st.meetup = null;
    st.explored = obj(st.explored);
    for (const k of Object.keys(st.explored)) if (!D.LOCATIONS[k] || !Array.isArray(st.explored[k])) delete st.explored[k]; else st.explored[k] = st.explored[k].map((n) => (+n >>> 0) || 0);
    for (const k of Object.keys(st.mastery)) if (!D.LOCATIONS[k] || !(+st.mastery[k] >= 0)) delete st.mastery[k]; else st.mastery[k] = +st.mastery[k];
    if (!st.xpDay || typeof st.xpDay !== 'object' || typeof st.xpDay.n !== 'object') st.xpDay = null;
    if (!st.event || typeof st.event !== 'object' || !st.event.id) st.event = null;
    return st;
  }
  let awayHours = 0;
  function load() {
    let raw = null, text = null;
    try { text = localStorage.getItem(CONFIG.SAVE_KEY); } catch (_) { boot.blocked = true; }
    try { raw = JSON.parse(text); } catch (_) { raw = null; }
    // a game brought along by "Update now"
    let tr = null;
    try { tr = JSON.parse(localStorage.getItem(TRANSFER_KEY)); } catch (_) { tr = null; }
    if (tr) {
      boot.updated = true;
      if (tr.data && typeof tr.data === 'object' && (!raw || typeof raw !== 'object' || (tr.data.savedAt || 0) >= (raw.savedAt || 0))) raw = tr.data;
      try { localStorage.removeItem(TRANSFER_KEY); } catch (_) { /* fine */ }
    }
    // the save went missing (or lost its dogs, which can't happen in play)? bring back the last copy that opened fine
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.dogs) || !raw.dogs.length) {
      let last = null;
      try { last = JSON.parse(localStorage.getItem(LAST_KEY)); } catch (_) { last = null; }
      if (last && last.data && typeof last.data === 'object' && Array.isArray(last.data.dogs) && last.data.dogs.length) {
        if (raw && typeof raw === 'object') keepRescue(JSON.stringify(raw));
        raw = last.data; boot.recovered = true;
      }
    }
    if (!raw || typeof raw !== 'object') { if (text) keepRescue(text); return false; }
    const rawText = JSON.stringify(raw);
    try {
      state = normalize(migrate(raw));
      for (const d of state.dogs) if (!d.breed) throw new Error('dog without a breed');
    } catch (_) {
      // never overwrite a save we could not open: keep it aside, so nothing is lost
      keepRescue(rawText);
      boot.problem = true;
      state = defaultState();
      return false;
    }
    if (state.dogs.length) { try { localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), data: JSON.parse(rawText) })); } catch (_) { /* storage full: the main save still works */ } }
    // time passes while you're away, but gently: after 8 hours a neighbor looks in on your dogs,
    // so time only counts a quarter as much, and needs never drop below a comfortable floor
    const real = clamp((Date.now() - (raw.savedAt || Date.now())) / 3600000, 0, 72);
    const hours = Math.min(real, 8) + Math.max(0, real - 8) * 0.25;
    const O = D.NEEDS.offlinePerHour;
    for (const d of state.dogs) {
      d.hunger = (d.hunger ?? 80) < 35 ? d.hunger : Math.max(35, (d.hunger ?? 80) - hours * O.hunger);
      d.thirst = (d.thirst ?? 80) < 35 ? d.thirst : Math.max(35, (d.thirst ?? 80) - hours * O.thirst);
      d.energy = clamp((d.energy ?? 80) - hours * O.energy, 0, 100);
      d.happy = (d.happy ?? 70) < 40 ? d.happy : Math.max(40, (d.happy ?? 70) - hours * O.happy);
      d.clean = (d.clean ?? 85) < 25 ? d.clean : Math.max(25, (d.clean ?? 85) - hours * O.clean);
    }
    awayHours = real;
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
  // Tips: see-through glass cards. Tips show once ever; news cards show what you just got.
  // =====================================================================
  const tipQ = [];
  let tipNow = null, tipTimer = null;
  function tip(id, o) {
    if (visit || title || !state.tips) return false;
    if (id && (state.tips.includes(id) || tipQ.some((t) => t.id === id) || (tipNow && tipNow.id === id))) return false;
    if (id) state.tips.push(id);
    tipQ.push(Object.assign({ id }, o));
    pumpTips();
    return true;
  }
  function news(o) {
    if (visit || title) return;
    const n = tipQ.filter((t) => t.news);
    if (n.length >= 4) tipQ.splice(tipQ.indexOf(n[0]), 1);
    tipQ.push(Object.assign({ news: true }, o));
    $('tips').dataset.last = `${($('tips').dataset.last || '').slice(-300)} | ${o.title || ''} ${o.text || ''}`;
    pumpTips();
  }
  // at most two cards in a row: anything after that waits in Menu → What's new
  let tipStreak = 0, tipIdleAt = 0;
  function pumpTips() {
    if (tipNow || tut || !tipQ.length) return;
    if (!$('away').classList.contains('hidden')) return;
    if (performance.now() - tipIdleAt > 6000) tipStreak = 0;
    if (tipStreak >= 2) {
      const n = tipQ.length;
      while (tipQ.length) inboxAdd(tipQ.shift());
      toast(`${n} more in Menu → What’s new`);
      save();
      return;
    }
    tipStreak++;
    tipNow = tipQ.shift();
    const o = tipNow;
    const el = document.createElement('div');
    el.className = 'tipCard glass' + (o.news ? ' news' : '');
    el.innerHTML = `<div class="tipPic">${o.th || IC(o.icon || 'sparkle')}</div><div class="tipTxt"><b></b><span></span></div>${o.news ? '' : '<button class="tipOk">Got it</button>'}`;
    el.querySelector('.tipTxt b').textContent = plain(o.title || '');
    el.querySelector('.tipTxt span').textContent = plain(o.text || '');
    el.querySelector('.tipTxt span').classList.toggle('hidden', !o.text);
    $('tips').dataset.raw = `${o.title || ''} ${o.text || ''}`;
    el.addEventListener('click', () => closeTip());
    $('tips').appendChild(el);
    placeToast();
    hideHint();
    sfx(o.news ? 'find' : 'tip');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(closeTip, o.news ? clamp(3200 + 40 * ((o.title || '').length + (o.text || '').length), 4200, 8000) : 14000);
  }
  function closeTip() {
    clearTimeout(tipTimer);
    const el = $('tips').querySelector('.tipCard:not(.tutCard)');
    if (el) { el.classList.add('out'); setTimeout(() => { el.remove(); placeToast(); }, 260); }
    tipNow = null;
    tipIdleAt = performance.now();
    setTimeout(pumpTips, 300);
    save();
  }

  // =====================================================================
  // The guided start: a few steps with a glowing ring around what to tap
  // =====================================================================
  const TUT = [
    { id: 'move', title: 'Walk around', text: 'Drag anywhere on the screen to walk. Let go to stop.', icon: 'walk' },
    { id: 'pet', title: 'Say hello', text: 'Tap {dog} to pet them.', icon: 'heart', target: 'dog' },
    { id: 'bowls', title: 'Food and water', text: 'Tap Bowls to fill the food and water bowls.', icon: 'bowl', target: '#actions [data-act=bowls]' },
    { id: 'throw', title: 'Play fetch', text: 'Tap Throw to toss a toy. Hold the button to pick a different toy.', icon: 'ball', target: '#actions [data-act=ball]' },
    { id: 'card', title: 'How are they doing?', text: 'Tap the bubble in the top left. It shows needs and mood, and has Tricks, Treat, Style, Bath and Towel.', icon: 'dog', target: '.dogPill' },
    { id: 'menu', title: 'The menu', text: 'Shop, decorating, collectibles, challenges and photos all live in the Menu.', icon: 'menu', target: '#actions [data-act=menu]' },
    { id: 'walk', title: 'Off you go', text: 'Tap Walk to pick a place. Walks keep your dog happy, and there is lots to find.', icon: 'walk', target: '#actions [data-act=walk]' },
  ];
  let tut = null;
  function startTutorial() {
    if (!dogs.length || visit) return;
    MODALS.forEach((id) => $(id).classList.add('hidden'));
    if (place === 'park') goHome();
    if (mode === 'decorate') exitDecorate();
    tipQ.length = 0;
    if (tipNow) closeTip();
    tut = { i: 0 };
    showTut();
  }
  function showTut() {
    $('tips').querySelectorAll('.tutCard').forEach((n) => n.remove());
    const S0 = TUT[tut.i], d = selected || dogs[0];
    const el = document.createElement('div');
    el.className = 'tipCard glass tutCard';
    el.innerHTML = `<div class="tipPic">${IC(S0.icon)}</div><div class="tipTxt"><b></b><span></span><div class="tutDots">${TUT.map((_, i) => `<i class="${i < tut.i ? 'done' : i === tut.i ? 'now' : ''}"></i>`).join('')}</div></div><button class="tipSkip">Skip</button>`;
    el.querySelector('b').textContent = S0.title;
    el.querySelector('span').textContent = S0.text.replace('{dog}', d ? d.name : 'your dog');
    el.querySelector('.tipSkip').addEventListener('click', (e) => { e.stopPropagation(); endTutorial(false); });
    $('tips').appendChild(el);
    hideHint();
    placeToast();
  }
  function tutEvent(id) {
    if (!tut || TUT[tut.i].id !== id) return;
    sfx('tip');
    tut.i++;
    if (tut.i >= TUT.length) endTutorial(true);
    else showTut();
  }
  function endTutorial(finished) {
    tut = null;
    state.tutorial = 'done';
    $('tips').querySelectorAll('.tutCard').forEach((n) => n.remove());
    $('spotlight').classList.add('hidden');
    save();
    if (finished) news({ title: 'You’re all set!', text: 'Tips will pop up whenever there is something new. Have fun with your pack!', icon: 'paw' });
    pumpTips();
  }
  const _sv = new V3();
  function updateSpotlight(dt) {
    const sp = $('spotlight');
    if (tut && TUT[tut.i].id === 'move') {
      if (!tut.from) tut.from = player.root.position.clone();
      if (flatDist(tut.from, player.root.position) > 1.6) tutEvent('move');
    }
    const t = tut && TUT[tut.i].target;
    if (!t || modalOpen()) { sp.classList.add('hidden'); return; }
    let x, y, r;
    if (t === 'dog') {
      const d = selected || dogs[0];
      if (!d) { sp.classList.add('hidden'); return; }
      try {
        d.root.getWorldPosition(_sv); _sv.y += 0.4;
        if (isUpX(_sv.x)) { _sv.x -= UPX; _sv.y += FH; }
        _sv.project(camera);
      } catch (_) { sp.classList.add('hidden'); return; }
      x = (_sv.x * 0.5 + 0.5) * window.innerWidth; y = (-_sv.y * 0.5 + 0.5) * window.innerHeight; r = 46;
      if (!isFinite(x) || !isFinite(y)) { x = window.innerWidth / 2; y = window.innerHeight / 2; }
    } else {
      const el = document.querySelector(t);
      if (!el || el.offsetParent === null) { sp.classList.add('hidden'); return; }
      const b = el.getBoundingClientRect();
      x = b.left + b.width / 2; y = b.top + b.height / 2; r = Math.max(b.width, b.height) / 2 + 10;
    }
    sp.classList.remove('hidden');
    sp.style.transform = `translate(${x - r}px, ${y - r}px)`;
    sp.style.width = sp.style.height = r * 2 + 'px';
  }

  // tips that show up the first time something happens (checked every second)
  function checkTips() {
    if (visit || title || tut || !dogs.length) return;
    const home = place === 'home';
    const hasTub = state.furniture.some((f) => f.type === 'bathtub');
    if (dogs.some((d) => d.clean < 45)) {
      tip('dirty', hasTub
        ? { title: 'Time for a bath', text: 'Your dog is getting dirty. Tap the bathtub, or open their bubble and tap Bath.', icon: 'bath' }
        : { title: 'Muddy paws', text: 'Your dog is getting dirty. Use Towel in their bubble for a quick rub, or buy a Bathtub (Menu → Shop → Dog stuff) for a real bath.', icon: 'bath' });
    }
    if (home && dogs.some((d) => d.hunger < LOW) && !state.furniture.some((f) => roleOf(f) === 'food' && f.filled)) tip('bowls', { title: 'Hungry tummies', text: 'The food bowls are empty. Tap Bowls to fill food and water.', icon: 'bowl' });
    if (!home && dogs.some((d) => d.energy < 30)) tip('tired', { title: 'A tired dog', text: 'Tired dogs play less and get grumpy. Head Home: they nap on their bed.', icon: 'bolt' });
    if (dogs.some((d) => d.mood() === 'great')) tip('great', { title: 'A great mood', text: 'Happy, well-fed dogs are in a great mood: they find collectibles more often and learn tricks easier.', icon: 'heart' });
    if (isNight() && !S.env?.dark) tip('night', { title: 'Night time', text: 'A day in the game lasts one hour, so night comes around often. Some collectibles and encounters only happen after dark.', icon: 'moon' });
    if (curWeather().muddy && !home) tip('rain', { title: 'Rainy walks', text: 'Rain makes walks muddy. A raincoat from the shop keeps the worst off.', icon: 'rain' });
    if (state.daily) tip('daily', { title: 'Daily challenges', text: 'Three new challenges every day, in Menu → Challenges. Finish all three for a bonus.', icon: 'list' });
    if (comfort.paws >= 2) tip('comfort', { title: 'Home comfort', text: 'More furniture, combos and decorated rooms make your home cozier, and cozy homes keep dogs happy.', icon: 'comfort' });
    if (unlockedFeat('offleash') && dogs.some((d) => d.trickLvl('come') >= CONFIG.OFFLEASH_COME_LEVEL)) tip('offleash', { title: 'Off the leash', text: 'Your dog knows Come well enough to run free on walks. Tap Unleash, and Come to call them back.', icon: 'unleash' });
  }

  // =====================================================================
  // One little event every day
  // =====================================================================
  function eventDone() { if (state.event && !state.event.done) { state.event.done = true; gainXP(D.XP_MISC.event); } }
  function eventDef() { return state.event ? D.EVENTS.find((e) => e.id === state.event.id) : null; }
  function eventOn(kind) {
    const E = state.event;
    if (!E || visit || title || E.date !== clockNow.dateKey || !unlockedFeat('events')) return null;
    const def = eventDef();
    return def && def.kind === kind ? Object.assign({}, def, E) : null;
  }
  const evMult = (kind) => { const e = eventOn(kind); return e ? e.mult || 1 : 1; };
  const SALE_SECS = ['toys', 'styles', 'boutique', 'style', 'bath', 'pantry', 'dog', 'living', 'kitchen', 'decor', 'luxury'];
  const eventText = () => { const def = eventDef(); return def ? def.text.replace('{loc}', state.event.loc ? D.LOCATIONS[state.event.loc].name : 'the park') : ''; };
  function ensureEvent() {
    if (visit || title || !dogs.length || !unlockedFeat('events')) return;
    const key = clockNow.dateKey;
    if (state.event && state.event.date === key) return;
    const rr = ART.mulberry32(hashStr(key + '#ev#' + state.uid));
    const ok = D.EVENTS.filter((e) => !e.needs || locUnlocked(e.needs));
    const def = ok[Math.floor(rr() * ok.length)];
    const E = { date: key, id: def.id, done: false, n: 0 };
    if (def.kind === 'lostdog') {
      const places = Object.keys(D.LOCATIONS).filter((k) => locUnlocked(k) && !D.LOCATIONS[k].hours && k !== 'moon');
      E.loc = places[Math.floor(rr() * places.length)];
      E.dog = Math.floor(rr() * D.NEIGHBORS.length);
    }
    if (def.kind === 'sale') E.cat = SALE_SECS[Math.floor(rr() * SALE_SECS.length)];
    state.event = E;
    if (def.kind === 'gift') giveEventGift(def);
    news({ title: `Today: ${def.title}`, text: eventText() + (def.kind === 'sale' ? ` (${saleName(E.cat)})` : ''), th: TH('pic', def.icon) });
    save();
  }
  const saleName = (cat) => ({ toys: 'Toys', styles: 'Walls & floors', boutique: 'Boutique', style: 'Your style', bath: 'Shampoo', pantry: 'Pantry' }[cat] || plain((D.CATS.find((c) => c[0] === cat) || ['', cat])[1]));
  function giveEventGift(def) {
    const [kind, key, n] = def.gift;
    if (kind === 'meal') for (let i = 0; i < n; i++) state.meals.push({ id: key, q: 2 });
    else if (kind === 'shampoo') state.shampoos[key] = (state.shampoos[key] || 0) + n;
    else if (kind === 'ingredients') {
      const list = Object.keys(D.INGREDIENTS).filter((k) => D.INGREDIENTS[k].price != null);
      for (let i = 0; i < key; i++) { const k = pick(list); state.pantry[k] = (state.pantry[k] || 0) + 1; }
    } else if (kind === 'mystery') {
      const toys = Object.keys(D.TOYS).filter((k) => D.TOYS[k].price != null && !D.TOYS[k].vendor && !state.toys.includes(k));
      if (toys.length) { const k = pick(toys); state.toys.push(k); setTimeout(() => news({ title: 'Inside the package', text: `A ${D.TOYS[k].name}! It's in your toy bag.`, th: thumbOf.toy(k) }), 4600); }
      else state.coins += 25;
    }
    eventDone();
  }
  // the clock panel: time of day and the forecast for the next in-game week
  function openWeather(refresh) {
    const now = clockNow, W = curWeather(), night = isNight();
    const toNext = (target) => { const left = ((target - now.hour + 24) % 24) / 24 * 60; return left < 1 ? 'now' : `in ${Math.round(left)} min`; };
    $('wxNow').innerHTML = `<span class="wxBig">${IC(night && weatherId === 'sun' ? 'moon' : WX_ICON[weatherId] || 'sun')}</span>
      <span class="wxTxt"><b>${now.weekday}, ${now.hm}</b><small>${night ? 'Night' : 'Day'} · ${esc(W.name)}${W.muddy ? ' · muddy walks' : ''}</small>
      <small>${night ? `Sunrise ${toNext(6)}` : `Sunset ${toNext(18)}`} · one game day lasts an hour</small></span>`;
    $('wxList').innerHTML = forecast().map((f) => {
      const a = D.WEATHER[f.day], b = D.WEATHER[f.night];
      return `<div class="wxRow"><b>${f.name}</b><span class="wxCell">${IC(WX_ICON[f.day] || 'sun')}<small>${esc(a.name)}</small></span><span class="wxCell night">${IC(f.night === 'sun' ? 'moon' : WX_ICON[f.night] || 'moon')}<small>${esc(f.night === 'sun' ? 'Clear' : b.name)}</small></span></div>`;
    }).join('');
    $('wxTabs').classList.toggle('hidden', !unlockedFeat('calendar'));
    if (!refresh) setWxTab('weather');
    $('weather').classList.remove('hidden');
  }
  $('weather').addEventListener('click', (e) => { if (e.target.id === 'weather' || e.target.closest('[data-act="closeWeather"]')) $('weather').classList.add('hidden'); });
  function renderEventRow() {
    const def = eventDef(), row = $('eventRow');
    const live = def && state.event.date === clockNow.dateKey;
    row.classList.toggle('hidden', !live);
    if (!live) return;
    $('eventIc').innerHTML = TH('pic', def.icon);
    $('eventTitle').textContent = `Today: ${def.title}`;
    const done = state.event.done && def.kind !== 'gift' && def.kind !== 'sale' && def.kind !== 'market';
    $('eventText').textContent = done ? 'Done for today. See you tomorrow!' : eventText() + (def.kind === 'sale' ? ` · ${saleName(state.event.cat)}` : '') + (def.kind === 'show' ? ` · ${state.event.n}/${def.max}` : '');
    row.classList.toggle('done', !!done);
  }
  // events that happen when you arrive somewhere
  function eventOnArrive() {
    const E = state.event;
    if (!E || E.date !== clockNow.dateKey || E.done) return;
    const def = eventDef();
    if (def.kind === 'birthday' && loc === 'park') {
      eventDone();
      setTimeout(() => {
        if (place !== 'park') return;
        const hat = !state.accessories.includes('partyhat');
        if (hat) state.accessories.push('partyhat'); else addCoins(def.coins, player.root.position);
        confetti(player.root.position.clone().add(new V3(0, 1.5, 0)), 10);
        sfx('unlock');
        news({ title: 'Happy birthday!', text: hat ? 'The birthday neighbor gave your pack a Party hat. Dress up in a dog bubble → Style.' : `You got a slice of cake and 🪙 ${def.coins}.`, th: hat ? thumbOf.acc('partyhat') : TH('pic', '🎂') });
        save();
      }, 1500);
    }
    if (def.kind === 'picnic') {
      eventDone();
      dogs.forEach((d) => { d.hunger = Math.max(d.hunger, 92); d.happy = Math.min(100, d.happy + 8); });
      setTimeout(() => news({ title: 'Picnic!', text: 'The neighbors shared their snacks. Full bellies all round.', th: TH('pic', '🧺') }), 1500);
    }
    if (def.kind === 'lostdog' && loc === E.loc) spawnLostDog();
    if (def.kind === 'golden') {
      const sp = sniffSpots.filter((s) => !s.kind || s.kind === 'bush');
      const g = pick(sp.length ? sp : sniffSpots);
      if (g) { g.golden = true; if (g.sparkle) ART.setScentGold(g.sparkle, true); }
    }
  }
  let lostDog = null;
  function spawnLostDog() {
    const N = D.NEIGHBORS[state.event.dog || 0] || D.NEIGHBORS[0];
    const parts = ART.buildDog(N.dog.breed, N.dog.coat);
    let pos = null;
    for (let k = 0; k < 200 && !pos; k++) {
      const x = rand(-16, 16), z = rand(-16, 10);
      if (Math.hypot(x, z - 16) > 12 && inBounds(x, z, 1) && !isSolid(x, z) && !inPond(x, z, 1)) pos = new V3(x, 0, z);
    }
    if (!pos) return;
    parts.root.position.copy(pos);
    parts.root.rotation.y = rand(0, TAU);
    parkRoot.add(parts.root);
    const tag = textSprite(`${N.dog.name}?`, 0.34);
    tag.position.set(0, 1.25, 0);
    parts.root.add(tag);
    lostDog = { parts, pos, info: N, t: 0 };
  }
  function updateLostDog(dt) {
    if (!lostDog) return;
    const L = lostDog;
    L.t += dt;
    L.parts.tail.rotation[L.parts.wagAxis] = Math.sin(L.t * 9) * 0.4;
    L.parts.head.rotation.y = Math.sin(L.t * 0.8) * 0.5;
    if (flatDist(player.root.position, L.pos) < 1.8) {
      parkRoot.remove(L.parts.root);
      lostDog = null;
      const def = eventDef();
      eventDone();
      addCoins(def.coins, L.pos);
      confetti(L.pos.clone().add(new V3(0, 1, 0)), 8);
      sfx('unlock');
      news({ title: `You found ${L.info.dog.name}!`, text: `${L.info.owner} is so relieved and gives you 🪙 ${def.coins}.`, th: TH('dog', `${L.info.dog.breed}|${L.info.dog.coat}`) });
      save();
    }
  }
  function clearLostDog() { if (lostDog) { lostDog.parts.root.parent && lostDog.parts.root.parent.remove(lostDog.parts.root); lostDog = null; } }

  // =====================================================================
  // Sound: little synthesized effects and jukebox music, no sound files needed
  // =====================================================================
  const PREFS_KEY = 'voxelpaws-prefs';
  const prefs = (() => { try { return Object.assign({ sfx: true, music: true, haptics: false, bigui: false }, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch (_) { return { sfx: true, music: true, haptics: false, bigui: false }; } })();
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* fine */ } };
  let actx = null, master = null, musicBus = null, noiseBuf = null;
  function audio() {
    if (actx) return actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* not supported */ }
    try { actx = new AC(); } catch (_) { return null; }
    master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
    musicBus = actx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    return actx;
  }
  // browsers only allow sound after the first touch
  // iPhones are picky: sound only starts from a finished tap (touchend / click, not the first touch), the context can get
  // "interrupted" after a call or switching apps, and the silent switch mutes web sound unless the page says it plays media
  let audioPrimed = false, silentEl = null;
  function silentWavURL() {
    const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function wakeAudio() {
    const a = audio();
    if (!a) return;
    try {
      // let sounds play even with the ringer switch on silent (the game has its own Sound switch in Settings)
      if (navigator.audioSession && prefs.sfx) navigator.audioSession.type = 'playback';
    } catch (_) { /* not supported */ }
    if (a.state !== 'running') { try { a.resume(); } catch (_) { /* try again on the next tap */ } }
    if (!audioPrimed) {
      audioPrimed = true;
      try {
        // a tiny silent sound, played from inside the tap, unlocks the speaker for good
        const src = a.createBufferSource();
        src.buffer = a.createBuffer(1, 1, 22050);
        src.connect(a.destination);
        src.start(0);
      } catch (_) { audioPrimed = false; }
      // older iPhones: a silent media element switches sound over to "playback" too
      if (!navigator.audioSession && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
        try { silentEl = new Audio(silentWavURL()); silentEl.loop = true; silentEl.volume = 0.01; silentEl.setAttribute('playsinline', ''); const pr = silentEl.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (_) { silentEl = null; }
      }
    }
  }
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, wakeAudio, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && actx && actx.state !== 'running') { try { actx.resume(); } catch (_) { /* next tap */ } } });
  function tone(f, dur, o = {}) {
    const a = actx, t = a.currentTime + (o.at || 0);
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const v = o.vol || 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function hiss(dur, o = {}) {
    const a = actx, t = a.currentTime + (o.at || 0);
    const src = a.createBufferSource(); src.buffer = noiseBuf;
    const f = a.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.frequency.setValueAtTime(o.f || 1200, t);
    if (o.fTo) f.frequency.exponentialRampToValueAtTime(o.fTo, t + dur);
    f.Q.value = o.q || 1;
    const g = a.createGain(); const v = o.vol || 0.15;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.2); src.stop(t + dur + 0.05);
  }
  const SFX = {
    tap: () => tone(1180, 0.045, { vol: 0.035, type: 'triangle' }),
    open: () => tone(520, 0.14, { to: 820, vol: 0.05, type: 'triangle' }),
    close: () => tone(760, 0.12, { to: 430, vol: 0.045, type: 'triangle' }),
    coin: () => { tone(1318, 0.08, { vol: 0.05, type: 'square' }); tone(1976, 0.16, { vol: 0.05, type: 'square', at: 0.07 }); },
    pay: () => { tone(880, 0.07, { vol: 0.04, type: 'triangle' }); tone(587, 0.12, { vol: 0.04, type: 'triangle', at: 0.06 }); },
    find: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.16, { vol: 0.05, at: i * 0.07 })),
    unlock: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, { vol: 0.06, type: 'triangle', at: i * 0.08 })); tone(1568, 0.5, { vol: 0.04, at: 0.4 }); },
    tip: () => { tone(988, 0.09, { vol: 0.035 }); tone(1318, 0.14, { vol: 0.035, at: 0.07 }); },
    trick: () => { tone(660, 0.1, { vol: 0.06, type: 'triangle' }); tone(990, 0.18, { vol: 0.06, type: 'triangle', at: 0.08 }); },
    fail: () => tone(240, 0.2, { to: 150, vol: 0.05, type: 'square' }),
    throw: () => hiss(0.28, { f: 700, fTo: 2600, vol: 0.07, q: 0.8 }),
    bounce: () => tone(170, 0.08, { to: 120, vol: 0.08 }),
    bark: () => { hiss(0.07, { f: 1100, vol: 0.09, q: 3 }); tone(560, 0.11, { to: 360, vol: 0.06, type: 'sawtooth', at: 0.01 }); },
    pet: () => { tone(440, 0.18, { to: 520, vol: 0.04, type: 'sine' }); },
    splash: () => hiss(0.4, { filter: 'lowpass', f: 1600, fTo: 500, vol: 0.12 }),
    scrub: () => hiss(0.07, { filter: 'highpass', f: 2600, vol: 0.035 }),
    bubble: () => tone(rand(700, 1300), 0.06, { to: rand(1400, 2200), vol: 0.03 }),
    shutter: () => { hiss(0.05, { f: 3000, vol: 0.1, q: 0.5 }); tone(1800, 0.03, { vol: 0.04, type: 'square', at: 0.06 }); },
    shake: () => hiss(0.5, { filter: 'bandpass', f: 900, vol: 0.08, q: 0.6 }),
    howl: () => { tone(430, 1.1, { to: 640, vol: 0.05, type: 'triangle', attack: 0.15 }); tone(640, 0.7, { to: 520, vol: 0.04, type: 'triangle', at: 1.0 }); },
    yip: () => { tone(900, 0.06, { to: 1300, vol: 0.05, type: 'triangle' }); tone(1100, 0.05, { to: 1500, vol: 0.04, type: 'triangle', at: 0.09 }); },
    plip: () => tone(rand(900, 1200), 0.07, { to: rand(400, 600), vol: 0.06 }),
    plop: () => { tone(420, 0.12, { to: 160, vol: 0.08 }); hiss(0.25, { filter: 'lowpass', f: 1200, fTo: 400, vol: 0.06 }); },
    rustle: () => hiss(0.3, { filter: 'highpass', f: 3200, vol: 0.05, q: 0.7 }),
    whoosh: () => hiss(0.45, { f: 500, fTo: 2200, vol: 0.08, q: 0.6 }),
    twinkle: () => [1568, 2093, 2637].forEach((f, i) => tone(f, 0.25, { vol: 0.025, at: i * 0.09 })),
    brush: () => hiss(0.12, { filter: 'highpass', f: 1800, vol: 0.04, q: 0.5 }),
    quack: () => { tone(330, 0.09, { to: 260, vol: 0.06, type: 'sawtooth' }); tone(310, 0.09, { to: 240, vol: 0.05, type: 'sawtooth', at: 0.12 }); },
  };
  // playable instruments: a soft piano and a plucked guitar
  function playNote(n, kind) {
    if (!prefs.sfx || !actx || actx.state !== 'running') return;
    try {
      const f = midi(n);
      if (kind === 'guitar') { tone(f, 0.9, { vol: 0.07, type: 'triangle', attack: 0.004 }); tone(f * 2, 0.35, { vol: 0.025, type: 'sawtooth', attack: 0.003 }); }
      else { tone(f, 1.2, { vol: 0.08, type: 'triangle', attack: 0.006 }); tone(f * 2, 0.5, { vol: 0.02, type: 'sine' }); }
    } catch (_) { /* never let sound break the game */ }
  }
  function sfx(name) {
    if (!prefs.sfx || !actx || actx.state !== 'running') return;
    try { SFX[name] && SFX[name](); } catch (_) { /* never let sound break the game */ }
  }
  // the jukebox: a gentle loop, chords plus a little melody, written on the fly
  const CHORDS = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];
  const SCALE = [72, 74, 76, 79, 81, 84];
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  let music = { on: false, next: 0, step: 0 };
  function musicTick() {
    const want = prefs.music && musicOn() && !title && !!actx && actx.state === 'running';
    if (want !== music.on) {
      music.on = want;
      if (actx) { const t = actx.currentTime; musicBus.gain.cancelScheduledValues(t); musicBus.gain.setTargetAtTime(want ? 0.5 : 0, t, 0.6); }
      if (want) { music.next = actx.currentTime + 0.1; }
    }
    if (!music.on) return;
    const beat = 60 / 84 / 2;            // eighth notes at 84 bpm
    while (music.next < actx.currentTime + 0.4) {
      const at = music.next - actx.currentTime, s = music.step, bar = Math.floor(s / 8) % 4, C = CHORDS[bar];
      if (s % 8 === 0) {
        C.forEach((n) => tone(midi(n), beat * 7.5, { vol: 0.03, type: 'triangle', at, attack: 0.25, bus: musicBus }));
        tone(midi(C[0] - 12), beat * 3, { vol: 0.08, at, bus: musicBus });
      }
      if (s % 8 === 4) tone(midi(C[0] - 12), beat * 3, { vol: 0.06, at, bus: musicBus });
      if (Math.random() < 0.55) tone(midi(SCALE[Math.floor(Math.random() * SCALE.length)]), beat * 1.6, { vol: 0.035, type: 'sine', at, bus: musicBus });
      music.next += beat;
      music.step++;
    }
  }
  // a soft tick for every button
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button, .seg, .toyCard, .card')) sfx('tap'); }, true);

  // =====================================================================
  // Mini-map on walks: small and faint until you touch it, tap to make it big
  // =====================================================================
  const MM_GROUND = { grounds: '#7cc35f', park: '#8fcb6f', oldtown: '#bdb6aa', forest: '#4f8a3c', beach: '#ead39a', alpine: '#9ccc65', caves: '#5d5d66', snowy: '#eef4fb', carnival: '#7e6ca8', fairy: '#a5d6a7', moon: '#c9c9d1' };
  const mmBase = new Map(), mmFog = new Map();
  let mmBig = false, mmIdle = 0, mmT = 0;
  // the square of the world the map shows: the classic 39 x 39, or the whole outline of a shaped place
  function mmView() {
    if (S && S.bbox) {
      const b = S.bbox, span = Math.max(b.x1 - b.x0, b.z1 - b.z0) + 2;
      return { x0: (b.x0 + b.x1) / 2 - span / 2, z0: (b.z0 + b.z1) / 2 - span / 2, span };
    }
    return { x0: -19.5, z0: -19.5, span: 39 };
  }
  function mmBackground() {
    if (mmBase.has(loc)) return mmBase.get(loc);
    const V = mmView(), N = Math.round(V.span * 2), c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d');
    const hex = MM_GROUND[loc] || '#8fcb6f', rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const COL = { ground: rgb, path: mix(rgb, [255, 244, 214], 0.45), solid: rgb.map((v) => Math.round(v * 0.68)), water: [90, 176, 224] };
    const col = (k) => `rgb(${COL[k].join(',')})`;
    const sea = S.q && S.q.sea && S.q.sea.rect;
    const shaped = !!S.inside, roofs = S.roofs || [];
    const roofTop = (wx, wz) => (roofs.some((rf) => rf.test.some((t) => inRectXZ(t, wx, wz))) ? 1 : null);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = V.x0 + (i + 0.5) * (V.span / N), wz = V.z0 + (j + 0.5) * (V.span / N);
      if (shaped && !S.inside(wx, wz)) continue;
      let k = 'ground';
      // what hangs over a cove or a tunnel is drawn as the ground on top: hidden spots stay hidden
      const over = shaped ? roofTop(wx, wz) : null;
      const h = over !== null ? Math.max(1.6, S.height(wx, wz) + 1.6) : shaped ? S.height(wx, wz) : 0;
      if (over === null && (inPond(wx, wz) || (sea && wx > sea.x0 && wx < sea.x1 && wz > sea.z0 && wz < sea.z1 && (!shaped || S.height(wx, wz) < 0.2)))) k = 'water';
      else if (over === null && isSolidMap(wx, wz)) k = 'solid';
      else if (over === null && onPath(wx, wz)) k = 'path';
      let c3 = COL[k];
      if (k !== 'water' && h) c3 = h > 0 ? mix(c3, [255, 255, 255], Math.min(0.4, h * 0.11)) : mix(c3, [0, 0, 0], Math.min(0.3, -h * 0.35));
      x.fillStyle = `rgb(${c3.join(',')})`;
      x.fillRect(i, j, 1, 1);
    }
    mmBase.set(loc, c);
    return c;
  }
  // the map only shows where shaped places have been explored; the rest is a soft cloud
  function isSolidMap(wx, wz) { return place === 'park' ? isSolid(wx, wz) : false; }
  function mmFogLayer() {
    if (!S.bbox) return null;
    if (mmFog.has(loc)) return mmFog.get(loc);
    const V = mmView(), N = Math.round(V.span), c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d'), G = exploreGrid();
    x.fillStyle = 'rgba(232,236,246,1)';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = V.x0 + i + 0.5, wz = V.z0 + j + 0.5;
      const gi = Math.floor((wx - G.x0) / 2), gj = Math.floor((wz - G.z0) / 2);
      if (gi >= 0 && gj >= 0 && gi < G.w && gj < G.h && isExplored(loc, G, gi, gj)) continue;
      if (!S.inside(wx, wz)) continue;
      x.fillRect(i, j, 1, 1);
    }
    mmFog.set(loc, c);
    return c;
  }
  function mmSeen(wx, wz) {
    if (!S.bbox) return true;
    const G = exploreGrid(), i = Math.floor((wx - G.x0) / 2), j = Math.floor((wz - G.z0) / 2);
    return i >= 0 && j >= 0 && i < G.w && j < G.h && isExplored(loc, G, i, j);
  }
  // points of interest: [x, z, kind]
  function mmPoints() {
    const P = [];
    P.push(S.exit ? [S.exit.x, S.exit.z, 'exit'] : [0, 19.2, 'exit']);
    for (const v of S.vendors || []) P.push([v.front.x, v.front.z, 'shop']);
    for (const s of sniffSpots) if (s.cooldown <= 0 && s.active !== false && s.kind !== 'glade' && s.kind !== 'crystal' && !(s.kind && s.kind.startsWith('hidden:') && !hiddenOf(loc).includes(s.kind.slice(7))) && mmSeen(s.pos.x, s.pos.z)) P.push([s.pos.x, s.pos.z, s.golden ? 'gold' : 'sniff']);
    const q = S.q || {};
    if (q.portal && q.portal.group.visible) P.push([q.portal.pos.x, q.portal.pos.z, 'magic']);
    if (q.rocket) P.push([q.rocket.pos.x, q.rocket.pos.z, 'special']);
    if (q.wheel) P.push([q.wheel.spot.x, q.wheel.spot.z, 'special']);
    if (q.sled) P.push([q.sled.pad.x, q.sled.pad.z, 'special']);
    if (q.orb) P.push([q.orb.pos.x, q.orb.pos.z, 'magic']);
    (q.booths || []).forEach((b) => P.push([b.front.x, b.front.z, 'ticket']));
    (q.flags || []).forEach((f, k) => { if (!(quirk.flags && quirk.flags[k])) P.push([f.pos.x, f.pos.z, 'flag']); });
    if (parkLoot && parkLoot.group) P.push([parkLoot.group.position.x, parkLoot.group.position.z, 'gold']);
    if (lostDog) P.push([lostDog.pos.x, lostDog.pos.z, 'lost']);
    return P;
  }
  const MM_LABEL = { exit: 'Way home', shop: 'Shop', sniff: 'Sniff spot', gold: 'Something shiny', magic: 'Magic', special: 'Something to do', ticket: 'Game booth', flag: 'Checkpoint', lost: 'Lost dog', you: 'You', dog: 'Your dogs', walker: 'Neighbors' };
  function mmGlyph(x, k, px, py, s) {
    x.save();
    x.translate(px, py);
    x.lineWidth = Math.max(1, s * 0.22);
    x.strokeStyle = 'rgba(255,255,255,0.95)';
    const fill = { exit: '#6b5cf6', shop: '#ff8a3d', sniff: '#ffd54f', gold: '#f5b700', magic: '#c06cff', special: '#29b6f6', ticket: '#ff5c8a', flag: '#e53935', lost: '#ff5c8a' }[k] || '#fff';
    x.fillStyle = fill;
    x.beginPath();
    if (k === 'sniff' || k === 'gold') { for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.35 : s; const a = (i / 8) * TAU; x.lineTo(Math.sin(a) * r, -Math.cos(a) * r); } x.closePath(); x.fill(); if (k === 'gold') x.stroke(); }
    else if (k === 'exit') { x.moveTo(0, -s); x.lineTo(s, -0.1 * s); x.lineTo(s * 0.7, -0.1 * s); x.lineTo(s * 0.7, s); x.lineTo(-s * 0.7, s); x.lineTo(-s * 0.7, -0.1 * s); x.lineTo(-s, -0.1 * s); x.closePath(); x.fill(); x.stroke(); }
    else if (k === 'shop' || k === 'ticket') { x.roundRect ? x.roundRect(-s, -s, 2 * s, 2 * s, s * 0.4) : x.rect(-s, -s, 2 * s, 2 * s); x.fill(); x.stroke(); }
    else if (k === 'flag') { x.moveTo(-s * 0.6, s); x.lineTo(-s * 0.6, -s); x.lineTo(s, -s * 0.5); x.lineTo(-s * 0.6, 0); x.closePath(); x.fill(); x.stroke(); }
    else if (k === 'lost') { x.arc(0, 0, s, 0, TAU); x.fill(); x.stroke(); x.fillStyle = '#fff'; x.font = `800 ${s * 1.5}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 0, s * 0.08); }
    else { x.moveTo(0, -s); x.lineTo(s, 0); x.lineTo(0, s); x.lineTo(-s, 0); x.closePath(); x.fill(); x.stroke(); }
    x.restore();
  }
  function updateMinimap(dt) {
    const el = $('minimap');
    const show = place === 'park' && !title && mode === 'normal' && !visit && unlockedFeat('minimap');
    el.classList.toggle('hidden', !show);
    if (!show) { mmBig = false; el.classList.remove('big'); return; }
    mmIdle += dt;
    el.classList.toggle('faint', !mmBig && mmIdle > 4);
    mmT -= dt;
    if (mmT > 0) return;
    mmT = 0.1;
    const cv = $('mmCanvas');
    const size = mmBig ? Math.min(300, window.innerWidth - 40) : 88;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); cv.style.width = cv.style.height = size + 'px'; }
    const x = cv.getContext('2d');
    const V = mmView(), W = cv.width, k = W / V.span, toPx = (wx) => (wx - V.x0) * k, toPz = (wz) => (wz - V.z0) * k;
    x.clearRect(0, 0, W, W);
    x.imageSmoothingEnabled = false;
    x.globalAlpha = 0.92;
    x.drawImage(mmBackground(), 0, 0, W, W);
    const fog = mmFogLayer();
    if (fog) { x.globalAlpha = 0.94; x.imageSmoothingEnabled = true; x.drawImage(fog, 0, 0, W, W); x.imageSmoothingEnabled = false; }
    x.globalAlpha = 1;
    const s = (mmBig ? 5.5 : 3.6) * dpr;
    const used = new Set(['you']);
    for (const [px, pz, kind] of mmPoints()) { mmGlyph(x, kind, toPx(px), toPz(pz), kind === 'sniff' ? s * 0.8 : s); used.add(kind); }
    for (const w of walkers) { const p = w.parts.root.position; x.fillStyle = 'rgba(80,70,110,0.75)'; x.beginPath(); x.arc(toPx(p.x), toPz(p.z), s * 0.55, 0, TAU); x.fill(); used.add('walker'); }
    for (const d of dogs) {
      const p = d.root.position, C = ART.coatOf(d.breed, d.coat);
      x.fillStyle = C.body; x.strokeStyle = '#fff'; x.lineWidth = s * 0.3;
      x.beginPath(); x.arc(toPx(p.x), toPz(p.z), s * 0.75, 0, TAU); x.fill(); x.stroke();
      used.add('dog');
    }
    const pp = player.root.position, a = player.face;
    x.save(); x.translate(toPx(pp.x), toPz(pp.z)); x.rotate(-a + Math.PI);
    x.fillStyle = '#ffffff'; x.strokeStyle = '#1d1834'; x.lineWidth = s * 0.3;
    x.beginPath(); x.moveTo(0, -s * 1.3); x.lineTo(s, s); x.lineTo(0, s * 0.45); x.lineTo(-s, s); x.closePath(); x.fill(); x.stroke();
    x.restore();
    if (mmBig) {
      const L = $('mmLegend'), key = [...used].join();
      if (L.dataset.k !== key) {
        L.dataset.k = key;
        L.innerHTML = [...used].map((u) => `<span><i class="lg ${u}"></i>${MM_LABEL[u] || u}</span>`).join('');
      }
    }
  }
  $('minimap').addEventListener('click', () => {
    mmIdle = 0;
    mmBig = !mmBig;
    $('minimap').classList.toggle('big', mmBig);
    $('mmLegend').dataset.k = '';
    mmT = 0;
    sfx(mmBig ? 'open' : 'close');
  });

  // =====================================================================
  // Quick toy pick: hold Throw
  // =====================================================================
  let holdTimer = null, ballHeld = false;
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.dock [data-act=ball]');
    if (!b) { if (!e.target.closest('#toyPicker')) closeToyPicker(); return; }
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { ballHeld = true; openToyPicker(b); }, 430);
  }, true);
  document.addEventListener('pointerup', (e) => {
    clearTimeout(holdTimer);
    if (!ballHeld) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const it = el && el.closest('.tpItem');
    if (it) pickToy(it.dataset.toy);
  }, true);
  document.addEventListener('pointercancel', () => clearTimeout(holdTimer), true);
  function openToyPicker(btn) {
    const P = $('toyPicker');
    P.innerHTML = `<div class="tpHead">Throw next</div><div class="tpGrid">${state.toys.map((k) => `<button class="tpItem${k === state.toy ? ' sel' : ''}" data-toy="${k}" title="${esc(D.TOYS[k].name)}">${TH('toy', k)}</button>`).join('')}</div>`;
    P.classList.remove('hidden');
    const r = btn.getBoundingClientRect(), w = P.offsetWidth;
    P.style.left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8) + 'px';
    P.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    sfx('open');
  }
  function closeToyPicker() { $('toyPicker').classList.add('hidden'); }
  function pickToy(k) {
    if (!D.TOYS[k] || !state.toys.includes(k)) return;
    state.toy = k;
    updateToyIcons();
    closeToyPicker();
    save();
    toast(`Throwing the ${D.TOYS[k].name.toLowerCase()} next`);
  }
  $('toyPicker').addEventListener('click', (e) => { const it = e.target.closest('.tpItem'); if (it) pickToy(it.dataset.toy); });

  // =====================================================================
  // Photo mode
  // =====================================================================
  let photo = false, photoURL = null;
  function enterPhoto() {
    if (fun && fun.kind !== 'sit' && fun.kind !== 'gaze') endFun('switch');
    photo = true;
    document.body.classList.add('photo');
    $('photoBar').classList.remove('hidden');
    updateNameTag();
    hideHint();
    tip('photo', { title: 'Photo mode', text: 'Pinch to zoom, walk to frame the shot, then tap the shutter. The paw button hides you from the picture.', icon: 'camera' });
  }
  function exitPhoto() {
    photo = false;
    player.root.visible = true;
    document.body.classList.remove('photo');
    $('photoBar').classList.add('hidden');
    updateNameTag();
  }
  function takePhoto() {
    drawWorld();
    const src = renderer.domElement;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    const u = c.width / 390;
    x.font = `800 ${Math.round(13 * u)}px ui-rounded, -apple-system, sans-serif`;
    x.textAlign = 'right';
    x.fillStyle = 'rgba(255,255,255,0.85)';
    x.shadowColor = 'rgba(0,0,0,0.25)'; x.shadowBlur = 6 * u;
    x.fillText(state.photoName && youName() ? `${youName()} · PixelPups` : 'PixelPups', c.width - 14 * u, c.height - 14 * u);
    photoURL = c.toDataURL('image/jpeg', 0.92);
    sfx('shutter');
    const f = $('photoFlash');
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    $('photoImg').src = photoURL;
    $('photoSave').href = photoURL;
    $('photoShare').classList.toggle('hidden', !navigator.share);
    setTimeout(() => $('photoPreview').classList.remove('hidden'), 260);
    photoFluff();
  }
  $('shutter').addEventListener('click', takePhoto);
  $('photoExit').addEventListener('click', exitPhoto);
  $('photoMe').addEventListener('click', () => { player.root.visible = !player.root.visible; $('photoMe').classList.toggle('off', !player.root.visible); updateNameTag(); });
  $('photoDone').addEventListener('click', () => $('photoPreview').classList.add('hidden'));
  $('photoJournal').addEventListener('click', () => {
    if (!photoURL) return;
    // a small copy for the journals of the dogs in the picture
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'), w = 240, h = Math.round((img.height / img.width) * 240);
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const url = c.toDataURL('image/jpeg', 0.72);
      const inPic = dogs.filter((d) => d.root.visible && (place === 'home' || !d.lost));
      state.photos = (state.photos || []).concat({ t: Date.now(), url, dogs: inPic.map((d) => d.id) }).slice(-12);
      for (const d of inPic) { journalAdd(d, null, '📷', 'Posed for a photo'); const e = d.journal[d.journal.length - 1]; if (e && e.tx === 'Posed for a photo') e.ph = url; }
      save();
      toast(`Added to ${inPic.length > 1 ? 'the journals' : `${inPic[0] ? inPic[0].name + '’s' : 'the'} journal`} 📒`);
      $('photoPreview').classList.add('hidden');
    };
    img.src = photoURL;
  });
  $('photoPreview').addEventListener('click', (e) => { if (e.target.id === 'photoPreview') $('photoPreview').classList.add('hidden'); });
  $('photoShare').addEventListener('click', async () => {
    try {
      const blob = await (await fetch(photoURL)).blob();
      const file = new File([blob], 'pixelpups.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'PixelPups' });
      else await navigator.share({ title: 'PixelPups', url: location.href });
    } catch (_) { /* cancelled */ }
  });

  // =====================================================================
  // Scene changes: a soft fade and the camera easing in
  // =====================================================================
  function arriveFade() {
    const f = $('fader');
    f.style.transition = 'none';
    f.style.opacity = '1';
    void f.offsetWidth;
    f.style.transition = 'opacity 0.6s ease';
    f.style.opacity = '0';
    camDist *= 1.35;
  }

  // =====================================================================
  // The title screen: your dogs out and about in one of your places
  // =====================================================================
  let title = null;
  function startTitle() {
    const places = Object.keys(D.LOCATIONS).filter((k) => locUnlocked(k) && canVisitNow(k));
    const id = pick(places.length ? places : ['park']);
    useScene(id);
    place = 'park';
    homeRoot.visible = false;
    parkRoot.visible = true;
    player.root.visible = false;
    dogs.forEach((d) => { d.root.visible = false; if (d.leash) d.leash.visible = false; });
    const pack = dogs.length ? dogs.map((d) => ({ breed: d.breed, coat: d.coat, name: d.name, acc: d.acc })) :
      shuffle(D.NEIGHBORS).slice(0, 3).map((N) => ({ breed: N.dog.breed, coat: N.dog.coat, name: '', acc: {} }));
    const show = pack.slice(0, 6).map((p, i) => {
      const parts = ART.buildDog(p.breed, p.coat);
      for (const slot of Object.keys(p.acc || {})) if (D.ACCESSORIES[p.acc[slot]]) ART.buildAccessory(p.acc[slot], parts);
      const pos = titleSpot(new V3(0, 0, 4)) || new V3(i - 1, 0, 4);
      parts.root.position.copy(pos);
      parkRoot.add(parts.root);
      if (p.name) { const tag = textSprite(p.name, 0.3); tag.position.set(0, 1.15, 0); parts.root.add(tag); }
      return { parts, target: null, wait: rand(0, 2), phase: 0, speed: rand(1.1, 1.8), t: rand(0, 5), sit: 0 };
    });
    // a clean view: no signs, drops or other little hints floating about
    const hidden = [];
    sniffSpots.forEach((s) => { s.sparkle.visible = false; });
    parkRoot.traverse((o) => { if (o.isSprite && o.visible && o.material.map !== glowTex) { o.visible = false; hidden.push(o); } });
    title = { show, t: 0, loc: id, hidden };
    $('playBtn').textContent = dogs.length ? 'Continue' : 'Play';
    const note = boot.blocked ? 'This browser won’t let PixelPups save (Private Browsing or blocked website data?). Your progress may be lost when you close it.' :
      boot.problem ? 'Your last save couldn’t be opened. It’s kept safe and untouched: see Settings → Backup.' :
      boot.recovered ? 'Your save had gone missing, so the last good copy was brought back.' :
      boot.updated ? 'Updated to the newest version. Your game came along!' : '';
    $('titleNote').textContent = note;
    $('titleNote').classList.toggle('hidden', !note);
    $('titleNote').classList.toggle('warn', boot.blocked || boot.problem);
    $('title').classList.remove('hidden');
    $('hud').classList.add('hidden');
    const names = dogs.map((d) => d.name);
    $('titleSub').textContent = (youName() ? `Welcome back, ${youName()}! ` : '') + (names.length ? `${names.length > 2 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} out in ${LOC().name}` : 'A cozy dog game');
    applyEnvironment();
    camLook.set(0, 0.5, 4);
    camDist = 13;
  }
  function titleSpot(near) {
    for (let k = 0; k < 40; k++) {
      const x = near.x + rand(-6, 6), z = near.z + rand(-5, 5);
      if (inBounds(x, z, 1) && !isSolid(x, z) && !inPond(x, z, 0.6)) return new V3(x, 0, z);
    }
    return null;
  }
  function updateTitle(dt) {
    const T = title;
    T.t += dt;
    let cx = 0, cz = 0;
    for (const s of T.show) {
      const p = s.parts, pos = p.root.position;
      s.t += dt;
      if (s.wait > 0) {
        s.wait -= dt;
        p.legs.forEach((l) => { l.rotation.x = lerp(l.rotation.x, 0, 0.2); });
        p.head.rotation.y = Math.sin(s.t * 0.9) * 0.45;
        p.body.position.y = lerp(p.body.position.y, s.sit ? -0.06 : 0, 0.1);
        p.body.rotation.x = lerp(p.body.rotation.x, s.sit ? -0.25 : 0, 0.1);
      } else {
        if (!s.target) { s.target = titleSpot(new V3(clamp(pos.x, -8, 8), 0, clamp(pos.z, -2, 10))); s.speed = Math.random() < 0.15 ? 3.4 : rand(1.1, 1.8); }
        if (s.target) {
          const dx = s.target.x - pos.x, dz = s.target.z - pos.z, d = Math.hypot(dx, dz);
          if (d < 0.2) { s.target = null; s.wait = rand(1, 4); s.sit = Math.random() < 0.35; }
          else {
            const step = Math.min(d, s.speed * dt);
            const nx = pos.x + (dx / d) * step, nz = pos.z + (dz / d) * step;
            if (isSolid(nx, nz) || Math.abs(groundAt(nx, nz) - groundAt(pos.x, pos.z)) > 0.6) { s.target = null; s.wait = 0.5; }
            else { pos.x = nx; pos.z = nz; pos.y = groundAt(nx, nz); }
            p.root.rotation.y = angleLerp(p.root.rotation.y, Math.atan2(dx, dz), 0.15);
            s.phase += dt * (4 + s.speed * 3.2);
            const sw = Math.sin(s.phase) * 0.7;
            [sw, -sw, -sw, sw].forEach((v, i) => { if (p.legs[i]) p.legs[i].rotation.x = v; });
            p.body.position.y = Math.abs(Math.sin(s.phase)) * 0.04;
            p.body.rotation.x = lerp(p.body.rotation.x, 0, 0.2);
            p.head.rotation.y = lerp(p.head.rotation.y, 0, 0.1);
          }
        } else s.wait = 1;
      }
      p.tail.rotation[p.wagAxis] = Math.sin(s.t * 10) * 0.5;
      cx += pos.x; cz += pos.z;
    }
    const n = T.show.length || 1;
    camLook.set(lerp(camLook.x, cx / n, damp(0.3, dt)), 0.5, lerp(camLook.z, cz / n, damp(0.3, dt)));
    const a = T.t * 0.06;
    const dist = 12 * clamp(0.8 / camera.aspect, 1, 1.6);
    camera.position.set(camLook.x + Math.sin(a) * dist * 0.62, camLook.y + dist * 0.62, camLook.z + Math.cos(a) * dist * 0.62);
    camera.lookAt(camLook);
  }
  function leaveTitle(then) {
    if (!title) return;
    for (const s of title.show) parkRoot.remove(s.parts.root);
    for (const o of title.hidden || []) o.visible = true;
    title = null;
    $('title').classList.add('hidden');
    player.root.visible = true;
    dogs.forEach((d) => { d.root.visible = true; });
    place = 'home';
    homeRoot.visible = true;
    parkRoot.visible = false;
    useScene('park');
    parkRoot.visible = false;
    refreshUI();
    applyEnvironment();
    updateCamera(0, true);
    arriveFade();
    if (then) then();
  }
  $('playBtn').addEventListener('click', () => leaveTitle(() => {
    if (!dogs.length) { if (!state.lookDone) openCreator('new'); else openStart(); return; }
    welcome();
  }));
  $('titleSettings').addEventListener('click', () => openSettings());
  $('titleHelp').addEventListener('click', () => leaveTitle(() => { if (!dogs.length) { if (!state.lookDone) openCreator('new'); else openStart(); } else startTutorial(); }));

  // =====================================================================
  // Your character: body, hair, colors and clothes
  // =====================================================================
  const SLOT_NAMES = { top: 'Top', bottom: 'Bottoms', hat: 'Hat', face: 'Face', neck: 'Neck', back: 'Back' };
  const SLOT_ORDER = ['top', 'bottom', 'hat', 'face', 'neck', 'back'];
  function cleanLook(l) {
    const d = D.DEFAULT_LOOK, L = D.LOOK;
    const o = l && typeof l === 'object' ? l : {};
    const hex = (v, list, def) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : def);
    return {
      body: o.body === 'b' ? 'b' : 'a',
      hair: clamp(o.hair | 0, 0, 3),
      skin: hex(o.skin, L.skins, d.skin),
      hairColor: hex(o.hairColor, L.hairColors, d.hairColor),
      fav: hex(o.fav, L.favColors, d.fav),
      outfit: Object.assign({}, o.outfit && typeof o.outfit === 'object' ? o.outfit : d.outfit),
    };
  }
  function applyPlayerLook() {
    const fresh = ART.buildPlayer(state.look);
    player.root.remove(player.body);
    player.root.add(fresh.body);
    Object.assign(player, { body: fresh.body, legL: fresh.legL, legR: fresh.legR, armL: fresh.armL, armR: fresh.armR, hand: fresh.hand });
  }
  const lookKey = (look, slot) => JSON.stringify(slot ? { look, slot } : { look });
  function wearThumb(id) {
    const O = D.OUTFITS[id];
    const look = JSON.parse(JSON.stringify(state.look));
    look.outfit[O.slot] = id;
    return TH('wear', lookKey(look, O.slot));
  }
  function getOutfit(id, earned) {
    if (!D.OUTFITS[id] || state.outfits.includes(id)) return;
    state.outfits.push(id);
    news({ title: earned ? 'Clothes unlocked!' : 'New clothes', text: `${D.OUTFITS[id].name}. Wear it in Menu → You.`, th: wearThumb(id) });
    save();
  }
  // the character sheet: "new" when starting a game (then the puppy comes next)
  let crMode = 'edit', crTab = 'look';
  function openCreator(mode = 'edit') {
    crMode = mode;
    crTab = mode === 'new' ? 'look' : 'now';
    $('crTitle').textContent = mode === 'new' ? 'Make your character' : 'You';
    $('crClose').classList.toggle('hidden', mode === 'new');
    $('crTabs').classList.toggle('hidden', mode === 'new');
    $('crNext').classList.toggle('hidden', mode !== 'new');
    renderCreator();
    $('creator').classList.remove('hidden');
  }
  $('crLook').addEventListener('input', (e) => { if (e.target.id === 'crName') { state.playerName = cleanName(e.target.value); state.nameAsked = true; } });
  function closeCreator() {
    $('creator').classList.add('hidden');
    applyPlayerLook();
    save();
  }
  const swatches = (list, cur, key) => `<div class="swatches">${list.map((c) => `<button class="sw${c === cur ? ' sel' : ''}" data-k="${key}" data-v="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>`;
  function renderCreator() {
    const L = state.look, LK = D.LOOK;
    const url = ART.thumbURL('me', lookKey(L));
    if (url) $('crImg').src = url;
    $('crTabs').querySelectorAll('.seg').forEach((b) => b.classList.toggle('sel', b.dataset.tab === crTab));
    $('crLook').classList.toggle('hidden', crTab !== 'look');
    $('crClothes').classList.toggle('hidden', crTab !== 'clothes');
    $('crNow').classList.toggle('hidden', crTab !== 'now');
    document.querySelector('#creator .crPreview').classList.toggle('hidden', crTab === 'now');
    if (crTab === 'now') { renderWhatNow(); return; }
    if (crTab === 'look') {
      const variant = (patch) => lookKey(Object.assign({}, L, patch));
      $('crLook').innerHTML =
        `<div class="section">Your name</div><p class="sub small">Optional. Neighbors and your dogs’ journals will use it.</p><input id="crName" class="nameField" maxlength="16" placeholder="Your name" autocomplete="off" value="${esc(youName())}">` +
        `<div class="section">Body</div><div class="crRow two">${LK.bodies.map(([id, name]) => `<button class="crOpt${L.body === id ? ' sel' : ''}" data-k="body" data-v="${id}">${TH('me', variant({ body: id, hair: L.body === id ? L.hair : 0 }))}<small>${name}</small></button>`).join('')}</div>` +
        `<div class="section">Hairstyle</div><div class="crRow four">${LK.hair[L.body].map((name, i) => `<button class="crOpt${L.hair === i ? ' sel' : ''}" data-k="hair" data-v="${i}">${TH('hairpick', JSON.stringify({ look: Object.assign({}, L, { hair: i, outfit: Object.assign({}, L.outfit, { hat: undefined }) }) }))}<small>${name}</small></button>`).join('')}</div>` +
        `<div class="section">Skin</div>${swatches(LK.skins, L.skin, 'skin')}` +
        `<div class="section">Hair color</div>${swatches(LK.hairColors, L.hairColor, 'hairColor')}` +
        `<div class="section">Favorite color</div><p class="sub small">Your favorite tee comes in this color.</p>${swatches(LK.favColors, L.fav, 'fav')}`;
    } else {
      let html = '';
      for (const slot of SLOT_ORDER) {
        const items = Object.entries(D.OUTFITS).filter(([, O]) => O.slot === slot);
        html += `<div class="section">${SLOT_NAMES[slot]}</div><div class="wardGrid">`;
        for (const [id, O] of items) {
          const owned = state.outfits.includes(id), on = L.outfit[slot] === id;
          const V = O.vendor && D.VENDORS[O.vendor];
          const where = owned ? (on ? 'Wearing' : 'Tap to wear') : O.unlock ? plain(D.UNLOCKS[O.unlock]) : V ? (locUnlocked(V.loc) ? `${V.name} · ${O.tickets ? `🎟️ ${O.tickets}` : `🪙 ${O.price}`}` : 'Sold somewhere new') : `Shop · 🪙 ${O.price}`;
          html += `<button class="toyCard${owned ? '' : ' locked'}${on ? ' eq' : ''}" data-wear="${id}">${owned || !O.unlock ? wearThumb(id) : `<span class="big q">${IC('lock')}</span>`}<b>${esc(O.name)}</b><small>${esc(where)}</small></button>`;
        }
        html += '</div>';
      }
      $('crClothes').innerHTML = html;
    }
  }
  $('creator').addEventListener('click', (e) => {
    if ((e.target.id === 'creator' && crMode !== 'new') || e.target.closest('[data-act="closeCreator"]')) { closeCreator(); return; }
    const seg = e.target.closest('#crTabs .seg');
    if (seg) { crTab = seg.dataset.tab; renderCreator(); return; }
    const opt = e.target.closest('[data-k]');
    if (opt) {
      const k = opt.dataset.k, v = opt.dataset.v;
      if (k === 'body') { if (state.look.body !== v) { state.look.body = v; state.look.hair = 0; } }
      else if (k === 'hair') state.look.hair = +v;
      else state.look[k] = v;
      renderCreator();
      applyPlayerLook();
      return;
    }
    const w = e.target.closest('[data-wear]');
    if (w) {
      const id = w.dataset.wear, O = D.OUTFITS[id];
      if (!state.outfits.includes(id)) {
        const V = O.vendor && D.VENDORS[O.vendor];
        toast(O.unlock ? `Unlock it: ${plain(D.UNLOCKS[O.unlock])}` : V ? (locUnlocked(V.loc) ? `Sold at the ${V.name} in ${D.LOCATIONS[V.loc].name}` : 'Sold somewhere you haven’t been yet…') : 'Buy it in Menu → Shop → Your style');
        return;
      }
      if (state.look.outfit[O.slot] === id) { if (O.slot !== 'top' && O.slot !== 'bottom') delete state.look.outfit[O.slot]; }
      else state.look.outfit[O.slot] = id;
      renderCreator();
      applyPlayerLook();
      save();
    }
  });
  $('crNext').addEventListener('click', () => {
    state.lookDone = true;
    closeCreator();
    openStart();
  });

  // =====================================================================
  // Main loop
  // =====================================================================
  const clock = new THREE.Clock();
  let hudTimer = 0, saveTimer = 5, slowTimer = 0, encTimer = 1;

  function update(dt) {
    animT += dt;
    musicTick();
    if (title) {
      updateTitle(dt);
      lightning = weatherFX.update(dt, localWeather(), camLook, () => false);
      applyEnvironment();
      updateDusk(Math.max(nightLevel, S && S.env && S.env.dark ? 1 : 0));
      slowTimer -= dt;
      if (slowTimer <= 0) { slowTimer = 1; tickClock(); }
      return;
    }
    updatePlayer(dt);
    funUpdate(dt);
    hobbyUpdate(dt);
    round3Update(dt);
    round3Slow(dt);
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
      updateTerrain(dt);
      if (unlockedFeat('calendar')) { updateHunts(dt); calNight(dt); updateSkyFX(dt); }
      updateVendorTask();
      if (!tiredWarned && dogs.some((d) => d.energy < CRITICAL)) { tiredWarned = true; toast('Your dog is getting tired — time to head home 🏠'); }
    } else {
      for (const r of furnRT.values()) if (r.group.userData.anim) r.group.userData.anim(animT);
      if (mode === 'normal') setCtx(funCtx());
      buildInnerWalls();
    }
    for (const d of dogs) d.updateLeash();
    calTick(dt);
    seasonFX.update(dt);
    updateParticles(dt);
    updateWallet(dt);
    pumpThumbs();
    updateSpotlight(dt);
    updateMinimap(dt);
    updateLights(dt);
    if (bath) updateBath3D(dt);
    if (place === 'park') updateLostDog(dt);
    let fxW = localWeather();
    if (place === 'park' && S.env && S.env.snowFall && !fxW.precip) fxW = D.WEATHER.snow;
    // at home it only rains or snows on the gardens: never indoors, and never in the empty space around the house
    if (place === 'home') fxW = Object.assign({}, fxW, { lightning: false });
    lightning = weatherFX.update(dt, fxW, camLook, (x, z) => place === 'home' && !isGardenTile(Math.floor(x), Math.floor(z)));
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
    selRing.visible = !!selected && dogs.length > 1 && mode === 'normal' && !(fun && (fun.kind === 'hide' || fun.kind === 'gaze'));
    if (selRing.visible) selRing.position.set(selected.root.position.x, 0.055, selected.root.position.z);

    updateCamera(dt, false);
    gazeCamera(dt);
    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.25; if (!visit) checkBuild(); updateHud(); }
    slowTimer -= dt;
    if (slowTimer <= 0) {
      slowTimer = 1;
      tickClock();
      for (const d of dogs) { d.applyGrowth(); d.updateDirtLook(); d.checkFavSwitch(); }
      if (!visit) { autoRefill(); computeComfort(); noteSeen(); checkUnlocks(); checkUpstairsOpen(); renderComfortChip(); checkLocUnlocks(); ensureDaily(); ensureEvent(); updateLocChip(); checkTips(); }
    }
    saveTimer -= dt;
    if (saveTimer <= 0) { saveTimer = 5; save(); }
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    drawWorld();
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
    applyPlayerLook();
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
    applyBigUI();
    {
      const q = new URLSearchParams(location.search);
      if (q.has('u')) { q.delete('u'); const qs = q.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); }
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) { /* not supported */ }
    try { localStorage.setItem('voxelpaws-test', '1'); localStorage.removeItem('voxelpaws-test'); } catch (_) { boot.blocked = true; }
    setTimeout(() => { if (window.fetch) bootPrints(); }, 3000);
    applyPlayerLook();
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
    growBeds();
    renderBeds();
    meltSnowmen();
    renderSnow();
    renderExhibits();
    if (state.sitting && !state.sitting.pending) sitArrive();
    updateToyIcons();
    refreshLeashBtn();
    refreshUI();
    tickClock();
    applyEnvironment();
    const skipTitle = /[?&]notitle\b/.test(location.search);
    if (!skipTitle) startTitle();
    else if (!dogs.length) { if (!state.lookDone) openCreator('new'); else openStart(); }
    else welcome();
    noteSeen();
    refreshGates();
    ensureDaily();
    ensureEvent();
    renderDailyBadge();
    checkBuild();
    updateHud();
    if (!title) updateCamera(0, true);
    save();
    loop();
  }
  // what you see when you start playing
  function welcome() {
    if (notes.has('v3')) toast('New: breeds, personalities, weather & more! Tap a dog bubble to meet them 🐾');
    else if (notes.has('v4')) toast('New: Trick Mode, neighbors on walks & friendships! Open a dog bubble → Tricks');
    else if (notes.has('v5')) toast('New: baths, cooking, outfits, gardens, comfort & visit links! 🏡');
    else if (notes.has('v6')) toast('New: new places to walk, daily challenges & a collectibles book!');
    else if (notes.has('v7')) toast('New: new places to discover, and a fresh new look!');
    else if (notes.has('v9')) { toast('New: make your own character, plus clothes to collect! Menu → You'); setTimeout(() => tip('youTile', { title: 'Make it you', text: 'Pick your body, hair and colors in Menu → You. Clothes are in the shop, at vendors on walks, and some are earned.', icon: 'person' }), 1500); }
    else if (notes.has('v8')) toast('New: a title screen, tips, daily events, sounds, a mini-map and photo mode!');
    else if (!notes.has('v10') && !showAway()) toast(awayHours > 8 ? `Welcome back! A neighbor looked after ${dogs[0].name} while you were away` : `Welcome back! ${dogs[0].name} missed you 🐾`);
    const sw = state.setsWelcome;
    if (sw && sw.length) setTimeout(() => news({ title: 'Collection sets!', text: `You had already finished: ${sw.join(', ')}. Your prizes are in.`, th: TH('pic', '🧩') }), 2500);
    delete state.setsWelcome;
    if (dogs.length && state.tutorial === 'done' && !state.nameAsked && !youName() && (!/[?&]debug\b/.test(location.search) || /[?&]askname\b/.test(location.search))) setTimeout(() => { if (!modalOpen()) askName(); else state.nameAsked = false; }, 4500);
    if (dogs.length && state.tutorial === 'done') setTimeout(() => tip('pastimesNew', { title: 'New things to do together', text: 'Tap a dog’s bubble, then Play: hide and seek, brushing and letting your dog lead. You can also sit on sofas and benches, play the piano, rake leaves, skip stones and look at the stars.', icon: 'ball' }), 3000);
    if (notes.has('v13') && !notes.has('v12')) setTimeout(() => tip('seasonNew', { title: 'Something new every week and month', text: 'New: vendors have specials every week, each month hides four new things to find, collection sets give prizes, and there’s a critter guide. See Menu → Collectibles.', icon: 'book' }), 1200);
    if (notes.has('v12') && !notes.has('v11')) setTimeout(() => tip('houseNew', { title: 'Neighbors and your home', text: 'New: neighbors have stories to tell (Menu → Neighbors), your home can grow into a dream estate (Menu → Home), vendors have weekly specials, and your book has sets, monthly finds and a critter guide.', icon: 'home' }), 1200);
    if (notes.has('v11') && !notes.has('v10')) setTimeout(() => tip('bondNew', { title: 'Hearts, badges and specialties', text: 'New: each dog has bond hearts, exam badges and a specialty (tap the hearts in a dog’s bubble). Neighbors have stories to tell, and your home can be upgraded too: see the Menu.', icon: 'heart' }), 1200);
    if (notes.has('v10')) setTimeout(() => tip('rankNew', { title: `You're a ${rankTitle(rank())}`, text: 'New: Trainer rank and place stars. Everything you do earns XP, ranks open up new things, and stars in a place unlock the next one. Your dogs also have hearts, badges and specialties: tap the hearts in a dog’s bubble.', th: rankBadge(rank()) }), notes.size > 1 ? 4500 : 900);
    ensureEvent();
  }
  // =====================================================================
  // Pastimes: sitting down, hide and seek, grooming, leaf piles, skipping stones,
  // stargazing, music and letting a dog lead. One at a time: fun says what is going on.
  // =====================================================================
  let fun = null;
  const funDogs = () => dogs.filter((d) => !d.lost && d.root.visible !== false);
  const fill = (t, o) => t.replace(/\{(\w+)\}/g, (m, k) => (o[k] !== undefined ? o[k] : m));
  const traitPick = (d) => (Math.random() < 0.7 || !d.revealed ? d.traits[0] : d.traits[1]);
  // a little bar above the dock: what's going on, an optional meter, and one button
  function funBar(text, btn, meter) {
    $('funTxt').textContent = text;
    $('funBtn').textContent = btn || '';
    $('funBtn').classList.toggle('hidden', !btn);
    $('funMeter').classList.toggle('hidden', meter === undefined || meter === null);
    if (meter !== undefined && meter !== null) $('funFill').style.width = Math.round(clamp(meter, 0, 1) * 100) + '%';
    $('funBar').classList.remove('hidden');
    document.body.classList.add('funOn');
  }
  const funBarOff = () => { $('funBar').classList.add('hidden'); $('funMeter').classList.remove('needle'); document.body.classList.remove('funOn'); };
  $('funBtn').addEventListener('click', () => { if (fun && fun.onBtn) fun.onBtn(); });

  // ----- your pose: sitting, lying on your back, covering your eyes, playing -----
  function setPose(kind, o = {}) {
    player.pose = Object.assign({ kind, t: 0, y: 0 }, o);
    player.moveTarget = null;
  }
  function clearPose() {
    if (!player.pose) return;
    const P = player.pose;
    player.pose = null;
    player.body.rotation.set(0, 0, 0);
    player.body.position.set(0, 0, 0);
    for (const l of [player.legL, player.legR, player.armL, player.armR]) l.rotation.set(0, 0, 0);
    if (P.tool) { P.tool.parent && P.tool.parent.remove(P.tool); }
    if (P.at) { player.root.position.copy(P.at); player.root.position.y = groundAt(P.at.x, P.at.z); }
  }
  function holdTool(kind) {
    const t = ART.buildTool(kind);
    player.hand.add(t);
    return t;
  }
  function poseTick(dt) {
    const P = player.pose;
    if (!P) return;
    P.t += dt;
    const k = Math.min(1, dt * 10);
    const B = player.body, L = player.legL, R = player.legR, AL = player.armL, AR = player.armR;
    const to = (o, ax, v) => { o.rotation[ax] = lerp(o.rotation[ax], v, k); };
    switch (P.kind) {
      case 'sit': case 'floor': case 'guitar': {
        B.position.y = lerp(B.position.y, P.y - 0.5, k);
        to(B, 'x', 0);
        to(L, 'x', P.kind === 'floor' ? -1.52 : -1.42); to(R, 'x', P.kind === 'floor' ? -1.52 : -1.42);
        to(L, 'z', P.kind === 'floor' ? 0.12 : 0); to(R, 'z', P.kind === 'floor' ? -0.12 : 0);
        if (P.kind === 'guitar') { to(AL, 'x', -1.1); to(AR, 'x', -0.7 + (P.strum > 0 ? Math.sin(P.t * 30) * 0.25 : 0)); P.strum = Math.max(0, (P.strum || 0) - dt); }
        else if (P.pet > 0) { P.pet -= dt; to(AR, 'x', -0.9 + Math.sin(P.t * 9) * 0.25); to(AL, 'x', -0.5); }
        else { to(AL, 'x', -0.55); to(AR, 'x', -0.55); }
        break;
      }
      case 'lie':
        to(B, 'x', -Math.PI / 2);
        B.position.y = lerp(B.position.y, 0.13, k);
        B.position.z = lerp(B.position.z, 0.6, k);
        to(L, 'x', 0); to(R, 'x', 0);
        to(AL, 'x', -2.9); to(AR, 'x', -2.9);
        break;
      case 'cover':
        to(AL, 'x', -2.5); to(AR, 'x', -2.5); to(AL, 'z', -0.55); to(AR, 'z', 0.55);
        break;
      case 'piano':
        to(AL, 'x', -1.25 + (P.keys > 0 ? Math.sin(P.t * 24) * 0.12 : 0)); to(AR, 'x', -1.25 + (P.keys > 0 ? Math.cos(P.t * 24) * 0.12 : 0));
        P.keys = Math.max(0, (P.keys || 0) - dt);
        break;
      case 'brush':
        to(B, 'x', 0.32);
        to(AR, 'x', -1.0 + (P.stroke > 0 ? Math.sin(P.t * 18) * 0.35 : 0)); to(AL, 'x', -0.4);
        P.stroke = Math.max(0, (P.stroke || 0) - dt);
        break;
      case 'skip':
        if (player.throwT > 0) { player.throwT -= dt; to(AR, 'x', -2.4); } else to(AR, 'x', -0.6);
        to(B, 'x', 0.1);
        break;
      default: break;
    }
    player.root.rotation.y = angleLerp(player.root.rotation.y, player.face, damp(0.0002, dt));
  }

  // ends whatever pastime is going on (why: 'move' = you walked off, 'done', 'leave' = left the place)
  function endFun(why) {
    const F = fun;
    if (!F) return;
    fun = null;
    try { if (F.end) F.end(why); } catch (e) { console.warn(e); }
    clearPose();
    funBarOff();
    for (const d of dogs) {
      if (d.free) d.free = false;
      if (d.state === 'act' && (!d.act || !d.act.keep)) { d.act = null; d.idle(0.5); }
    }
    if (place === 'home') for (const d of dogs) if (d.root.position.y > 0 && d.state !== 'sleep' && !(d.act && d.act.keep)) d.root.position.y = 0;
  }

  // =====================================================================
  // Sitting down: on furniture at home, on benches and logs on walks
  // =====================================================================
  // seats on walks: the benches each place already had, plus a few new benches and logs along the neighbors' loop
  function addSeats(sc) {
    const SEAT_STYLE = { grounds: 'wood', park: 'wood', oldtown: 'dark', forest: 'log', beach: 'wood', alpine: 'dark', caves: 'stone', snowy: 'snow', carnival: 'red', fairy: 'mush', moon: 'metal' };
    const seats = [];
    const tmp = new V3();
    sc.root.updateMatrixWorld(true);
    sc.root.traverse((o) => {
      if (!o.userData.seat) return;
      o.getWorldPosition(tmp);
      seats.push({ x: tmp.x, z: tmp.z, y: tmp.y, rot: o.rotation.y, two: true, style: 'old' });
    });
    // new ones: flat, open ground just outside the loop path, facing it
    const L = sc.loop || { x: 11, z0: -11, z1: 11 };
    const r = ART.mulberry32(hashStr('seats|' + sc.id));
    const cands = [];
    const sides = [
      [(t) => [lerp(-L.x, L.x, t), L.z0 - 1.9], 0], [(t) => [lerp(-L.x, L.x, t), L.z1 + 1.9], Math.PI],
      [(t) => [-L.x - 1.9, lerp(L.z0, L.z1, t)], Math.PI / 2], [(t) => [L.x + 1.9, lerp(L.z0, L.z1, t)], -Math.PI / 2],
      [(t) => [lerp(-L.x, L.x, t), L.z0 + 1.9], Math.PI], [(t) => [-L.x + 1.9, lerp(L.z0, L.z1, t)], -Math.PI / 2],
    ];
    for (const [f, rot] of sides) for (let t = 0.12; t <= 0.88; t += 0.08) { const [x, z] = f(t); cands.push({ x, z, rot }); }
    const solidAt = (x, z) => {
      if (sc.inside && !sc.inside(x, z)) return true;
      if (sc.solid && sc.solid(x, z)) return true;
      return sc.colliders.some((c) => (c.r !== undefined ? (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r : x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1));
    };
    const meet = (D.MEET_SPOTS[sc.id] || []).map((m) => [m[1], m[2]]);
    const ok = (c) => {
      const h = sc.height ? sc.height(c.x, c.z) : 0;
      for (let dx = -1.1; dx <= 1.1; dx += 0.55) for (let dz = -0.8; dz <= 0.9; dz += 0.425) {
        const x = c.x + dx, z = c.z + dz;
        if (solidAt(x, z)) return false;
        if (sc.onPath && sc.onPath(x, z) && Math.abs(dz) < 0.5) return false;
        if (sc.height && Math.abs(sc.height(x, z) - h) > 0.02) return false;
        if (sc.ponds.some((p) => x > p.x0 - 0.8 && x < p.x1 + 0.8 && z > p.z0 - 0.8 && z < p.z1 + 0.8)) return false;
      }
      // the bench faces open ground you can walk to
      const fx = c.x + Math.sin(c.rot) * 1.0, fz = c.z + Math.cos(c.rot) * 1.0;
      if (solidAt(fx, fz) || (sc.height && Math.abs(sc.height(fx, fz) - h) > 0.02)) return false;
      if (sc.spots.some((s) => Math.hypot(s.pos.x - c.x, s.pos.z - c.z) < 2)) return false;
      if ((sc.vendors || []).some((v) => Math.hypot(v.front.x - c.x, v.front.z - c.z) < 3)) return false;
      if (meet.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 2.2)) return false;
      if (Math.hypot(c.x, c.z - 18) < 4.5) return false;
      if (sc.water && Math.hypot(sc.water.pos.x - c.x, sc.water.pos.z - c.z) < 2.5) return false;
      return true;
    };
    for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]]; }
    let added = 0;
    for (const c of cands) {
      if (added >= 3) break;
      if (!ok(c) || seats.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 8)) continue;
      const style = SEAT_STYLE[sc.id] || 'wood';
      const g = ART.buildBench(style);
      const y = sc.height ? sc.height(c.x, c.z) : 0;
      g.position.set(c.x, y, c.z);
      g.rotation.y = c.rot;
      sc.root.add(g);
      const along = Math.abs(Math.cos(c.rot)) > 0.5;
      if (style === 'mush') {
        // two little toadstools with a gap between them
        for (const k of [-0.42, 0.42]) sc.colliders.push({ x: c.x + (along ? k : 0), z: c.z + (along ? 0 : k), r: 0.27, seat: true });
      } else {
        const ax = along ? 0.8 : 0.32, az = along ? 0.32 : 0.8;
        sc.colliders.push({ x0: c.x - ax, x1: c.x + ax, z0: c.z - az, z1: c.z + az, seat: true });
      }
      seats.push({ x: c.x, z: c.z, y, rot: c.rot, two: style !== 'mush', style, low: style === 'log' || style === 'stone' });
      added++;
    }
    sc.seats = seats;
  }
  // where a seat puts you (and a dog beside you) in the world
  function seatFrame(seat) {
    const rot = seat.rot, c = Math.cos(rot), s = Math.sin(rot);
    // local x (along the bench) and z (forward) to world
    const at = (lx, lz) => new V3(seat.x + lx * c + lz * s, 0, seat.z - lx * s + lz * c);
    return { at, face: rot };
  }
  function homeSeat(f) {
    const S0 = D.SEATS[f.type];
    if (!S0) return null;
    const rot = [0, Math.PI / 2, Math.PI, -Math.PI / 2][f.rot || 0];
    return { x: f.i + 0.5, z: f.j + 0.5, y: 0, rot, two: !!S0.two, seatY: S0.y, floor: !!S0.floor, f, solid: !!D.ITEMS[f.type].solid };
  }
  function nearestSeat(pp, r = 2.2) {
    if (place !== 'park' || !S.seats) return null;
    let best = null, bd = r;
    for (const s of S.seats) {
      const fr = seatFrame(s).at(0, 0.75);
      const d = Math.hypot(fr.x - pp.x, fr.z - pp.z);
      if (d < bd && Math.abs(groundAt(s.x, s.z) - pp.y) < 0.6) { bd = d; best = s; }
    }
    return best;
  }
  // sit down: seat = a bench on a walk, or homeSeat(f) at home
  function sitDown(seat) {
    if (fun) endFun('switch');
    const F = seatFrame(seat);
    const two = seat.two;
    const lx = two ? -0.28 : 0;
    const p = F.at(lx, seat.floor ? 0 : 0.04);
    const standAt = seat.f ? (frontOf(seat.f) || player.root.position.clone()) : F.at(0, 0.95);
    const baseY = place === 'park' ? groundAt(seat.x, seat.z) : 0;
    const seatY = seat.seatY !== undefined ? seat.seatY : seat.low ? 0.4 : 0.46;
    player.root.position.set(p.x, baseY, p.z);
    player.face = F.face;
    player.root.rotation.y = F.face;
    setPose(seat.floor ? 'floor' : 'sit', { y: seatY, at: new V3(standAt.x, 0, standAt.z) });
    fun = { kind: 'sit', still: true, seat, frame: F, lx, t: 0, joined: [], neighbor: null, rewarded: false, onBtn: () => endFun('done') };
    const where = seat.f ? `the ${D.ITEMS[seat.f.type].name.toLowerCase()}` : seat.style === 'log' ? 'a log' : 'a bench';
    funBar(`Sitting on ${where}`, 'Stand up');
    const me = fun;
    fun.end = (why) => { if (why !== 'leave' && why !== 'switch') stealSeat(me); };
    // dogs come over in their own way, one after the other
    const near = funDogs().filter((d) => place === 'park' || d.root.position.distanceTo(player.root.position) < 9);
    const busy = (d) => ['eat', 'drink', 'bath', 'towel', 'fetch', 'return', 'trick'].includes(d.state) || (d.state === 'sleep' && !d.flag('lounges'));
    const free = near.filter((d) => !busy(d)).slice(0, 3);
    let slotBeside = two;
    const used = [];
    free.forEach((d, i) => {
      let tr = traitPick(d);
      let R = D.SIT_REACT[tr] || D.SIT_REACT.shy;
      if (R.how === 'beside' && (!slotBeside || seat.floor)) { tr = 'shy'; R = D.SIT_REACT.shy; }
      if (R.how === 'beside') slotBeside = false;
      // two dogs never end up on the same spot
      let how = R.how;
      if (used.includes(how) && how !== 'beside') how = used.includes('feet') ? 'lean' : 'feet';
      used.push(how);
      setTimeout(() => { if (fun && fun.kind === 'sit' && fun.seat === seat) sitReact(d, how, R, i); }, 400 + i * 900);
    });
    sfx('pet');
    tip('sitdown', { title: 'Take a seat', text: 'Tap a sofa, chair, bed or rug at home, or a bench on a walk, to sit down. Your dogs come over in their own way. Move to stand up again.', icon: 'seat' });
  }
  function sitReact(d, how, R, i) {
    const F = fun.frame, seat = fun.seat;
    const side = i % 2 ? -1 : 1;
    let spot, face = F.face, pose = 'lie', y, wait = 0;
    const floorY = place === 'park' ? groundAt(seat.x, seat.z) : 0;
    switch (how) {
      case 'beside': spot = F.at(0.3, 0.02); y = floorY + (seat.seatY !== undefined ? seat.seatY : 0.44) - 0.04; pose = 'lie'; break;
      case 'knee': spot = F.at(fun.lx, 0.74); face = F.face + Math.PI; pose = 'knee'; break;
      case 'stare': spot = F.at(fun.lx + 0.1 * side, 1.15); face = F.face + Math.PI; pose = 'sit'; break;
      case 'lean': spot = F.at(fun.lx + 0.34 * side, 0.55); pose = 'sit'; break;
      case 'nest': spot = F.at(0.75 * side, 0.55); pose = 'lie'; wait = 1.5; break;
      case 'toy': spot = F.at(0.15, 0.95); face = F.face + Math.PI; pose = 'sit'; break;
      case 'lap': spot = F.at(-0.6 * side, 0.7); pose = 'lie'; break;
      default: spot = F.at(0.5 * side, 0.7); pose = 'lie'; break;
    }
    if (isSolid(spot.x, spot.z) && how !== 'beside') spot = F.at(0, 1.1);
    const lap = how === 'lap' ? [0, 1, 2, 3].map((k) => { const a = F.face + k * Math.PI / 2 + 0.6; return new V3(player.root.position.x + Math.sin(a) * 2.2, 0, player.root.position.z + Math.cos(a) * 2.2); }).filter((p) => !isSolid(p.x, p.z)) : [];
    let toyShown = false, said = false, t = 0;
    d.free = true;
    d.doAct('none', (dt) => {
      if (!fun || fun.kind !== 'sit') return false;
      t += dt;
      const A = d.act;
      if (lap.length) { const p = lap[0]; if (d.stepTo(p.x, p.z, 4.6, dt) < 0.4 || t > 6) { lap.shift(); t = 0; } return true; }
      if (how === 'toy' && !toyShown) {
        if (!A.fetchAt) { const a = rand(0, TAU); A.fetchAt = new V3(spot.x + Math.sin(a) * 2.5, 0, spot.z + Math.cos(a) * 2.5); if (isSolid(A.fetchAt.x, A.fetchAt.z)) A.fetchAt = spot.clone(); }
        if (!A.gotToy) { if (d.stepTo(A.fetchAt.x, A.fetchAt.z, 2.6, dt) < 0.3 || t > 5) { A.gotToy = true; spawnEmoji(d.favToy ? D.TOYS[d.favToy].icon : '🎾', d.headWorld(0.3), { size: 0.35 }); } return true; }
      }
      const goal = how === 'beside' ? F.at(0.3, 0.95) : spot;
      const left = A.y !== undefined ? 0 : d.stepTo(goal.x, goal.z, 2.4, dt);
      if (left > 0.15 && t < 8) return true;
      // a hop up onto the seat
      if (how === 'beside' && A.y === undefined) { d.root.position.set(spot.x, d.root.position.y, spot.z); A.y = y; sfx('bounce'); }
      if (how === 'toy' && !toyShown) { toyShown = true; spawnEmoji(d.favToy ? D.TOYS[d.favToy].icon : '🎾', spot.clone().add(new V3(0, 0.5, 0)), { size: 0.4 }); }
      if (wait > 0) { wait -= dt; A.pose = 'dig'; return true; }
      d.face = face;
      A.pose = pose;
      if (!said) {
        said = true;
        if (!fun.joined.length) toast(fill(pick(R.tx), { dog: d.name }));
        else spawnEmoji(how === 'stare' ? '🥺' : '💕', d.headWorld(0.35), { size: 0.4 });
        fun.joined.push(d);
        sfx('pet');
      }
      // a dog right by you leans in for the occasional cuddle
      if (Math.random() < dt * 0.25) { spawnEmoji(how === 'stare' ? '🥺' : '💕', d.headWorld(0.35), { size: 0.32 }); if (player.pose) player.pose.pet = 0.8; }
      d.happy = Math.min(100, d.happy + dt * 0.5);
      if (d.hunger < CRITICAL || d.thirst < CRITICAL) return false;
      return true;
    }, 'Sitting with you 💕');
  }
  function sitTick(dt) {
    const F = fun;
    F.t += dt;
    if (!F.rewarded && F.t > 6) {
      F.rewarded = true;
      progress('sit');
      for (const d of F.joined) {
        d.addBond(1);
        if (F.seat.f) journalAdd(d, 'sit:home', '🛋️', `Cuddled up with you on the ${D.ITEMS[F.seat.f.type].name.toLowerCase()}`);
        else journalAdd(d, 'sit:' + loc, '🪑', `Sat with you on a bench in ${LOC().name}`);
      }
    }
    // on a walk, a neighbor sometimes comes and sits with you
    if (place === 'park' && F.seat.two && !F.neighbor && F.t > (F.askAt || (F.askAt = rand(5, 8)))) {
      F.askAt = F.t + 9;
      const pp = player.root.position;
      const w = walkers.filter((x) => !x.talking && !x.meet && !x.visit && flatDist(x.parts.root.position, pp) < 26).sort((a, b) => flatDist(a.parts.root.position, pp) - flatDist(b.parts.root.position, pp))[0];
      if (w && Math.random() < 0.7) benchVisit(w, F);
    }
  }
  // when you get up, a cheeky dog may take your seat
  function stealSeat(F) {
    const seat = F.seat;
    if (seat.floor) return;
    const thief = F.joined.find((d) => d.flag('zooms') || d.flag('lounges'));
    if (!thief || Math.random() > 0.6) return;
    const p = F.frame.at(F.seat.two ? -0.28 : 0, 0.04);
    const y = (place === 'park' ? groundAt(seat.x, seat.z) : 0) + (seat.seatY !== undefined ? seat.seatY : 0.44) - 0.04;
    let t = 0;
    thief.doAct('lie', (dt) => {
      t += dt;
      if (fun || t > 22 || (place === 'park' && flatDist(player.root.position, thief.root.position) > 3)) { thief.act = null; thief.root.position.copy(F.frame.at(0, 0.95)); thief.root.position.y = groundAt(thief.root.position.x, thief.root.position.z); return false; }
      return true;
    }, 'Stole your seat 😎');
    thief.act.keep = true;
    thief.free = true;
    thief.root.position.set(p.x, y, p.z);
    thief.act.y = y;
    thief.face = F.frame.face;
    setTimeout(() => toast(fill(pick(D.STEAL_LINES), { dog: thief.name })), 300);
  }

  // ----- a neighbor walks over and sits beside you -----
  function benchVisit(w, F) {
    const sp = F.frame.at(0.3, 0.02), front = F.frame.at(0.3, 1.0);
    const path = findPath(w.parts.root.position, front);
    const [hx, hz] = [w.parts.root.position.x, w.parts.root.position.z];
    w.visit = { phase: 'go', path, seat: sp, front, face: F.frame.face, home: new V3(hx, 0, hz), t: 0, y: groundAt(F.seat.x, F.seat.z) + 0.46 };
    w.pause = 0;
    F.neighbor = w;
  }
  // returns how far the neighbor moved this frame
  function benchWalker(w, dt) {
    const V = w.visit, pos = w.parts.root.position;
    V.t += dt;
    const walk = (pts, speed) => {
      const tgt = pts[0];
      if (!tgt) return 0;
      const dx = tgt.x - pos.x, dz = tgt.z - pos.z, d = Math.hypot(dx, dz);
      if (d < 0.15) { pts.shift(); return 0; }
      const st = Math.min(d, speed * dt);
      pos.x += (dx / d) * st; pos.z += (dz / d) * st;
      w.parts.root.rotation.y = angleLerp(w.parts.root.rotation.y, Math.atan2(dx, dz), damp(0.002, dt));
      return st;
    };
    const sitting = fun && fun.kind === 'sit' && fun.neighbor === w;
    if (V.phase === 'go') {
      if (!sitting || V.t > 25) { V.phase = 'back'; V.path = findPath(pos, V.home); return 0; }
      const m = walk(V.path, 1.3);
      if (!V.path.length) {
        V.phase = 'sit';
        pos.set(V.seat.x, pos.y, V.seat.z);
        w.parts.root.rotation.y = V.face;
        startTalk(w);
        if (talk && talk.w === w) {
          showTalkLine(fill(pick(D.BENCH_LINES), { ndog: w.info.dog.name, dog: (fun.joined[0] || dogs[0]).name }));
          player.face = V.face;
          w.parts.root.rotation.y = V.face;
        }
      }
      return m;
    }
    if (V.phase === 'sit') {
      // after the chat they stay a few seconds more, then wave and walk on
      if (!V.leaveAt && !(talk && talk.w === w)) V.leaveAt = V.t + rand(4, 8);
      if (!sitting || (V.leaveAt && V.t > V.leaveAt)) {
        V.phase = 'back';
        V.path = findPath(pos, V.home);
        if (talk && talk.w === w) endTalk(false);
        if (sitting) toast(`${w.info.owner} waves goodbye 👋`);
      }
      return 0;
    }
    // back to the loop
    const m = walk(V.path, 1.2);
    if (!V.path.length) { w.visit = null; w.pause = 0.5; }
    return m;
  }
  // posing the neighbor on the bench (after the usual walking animation)
  function benchPose(w) {
    const V = w.visit;
    const P = w.parts;
    if (V && V.phase === 'sit') {
      P.body.position.y = lerp(P.body.position.y, V.y - P.root.position.y - 0.5, 0.2);
      P.legL.rotation.x = P.legR.rotation.x = -1.42;
      P.armL.rotation.x = P.armR.rotation.x = -0.5;
    } else if (P.body.position.y !== 0) P.body.position.y = lerp(P.body.position.y, 0, 0.3);
  }

  // =====================================================================
  // Hide and seek: you hide and your dogs come looking, or a dog hides and you look
  // =====================================================================
  // how well hidden a point is: things in the way around it, and most of all between it and the camera
  function coverAt(x, z) {
    let n = 0;
    for (const [dx, dz, w] of [[0.9, 0.9, 2], [0, 0.9, 2], [0.9, 0, 1.5], [-0.9, 0.9, 1], [0.9, -0.9, 1], [-0.9, 0, 0.6], [0, -0.9, 0.6], [-0.9, -0.9, 0.4]]) if (isSolid(x + dx, z + dz)) n += w;
    return n;
  }
  function freePoint(cx, cz, r0, r1, test) {
    for (let k = 0; k < 24; k++) {
      const a = rand(0, TAU), r = rand(r0, r1), x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      const b = bounds();
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || isSolid(x, z)) continue;
      if (place === 'park' && (inPond(x, z, 0.5) || Math.abs(groundAt(x, z) - groundAt(cx, cz)) > 2.5)) continue;
      if (test && !test(x, z)) continue;
      return new V3(x, groundAt(x, z), z);
    }
    return null;
  }
  // ----- you hide -----
  function startSeek() {
    if (!needRank('hideseek')) return;
    const team = funDogs().filter((d) => d.state !== 'bath');
    if (!team.length) return;
    if (fun) endFun('switch');
    const pp = player.root.position;
    const count = place === 'home' ? 8 : 10;
    fun = { kind: 'seek', t: 0, count, phase: 'count', team, from: pp.clone(), found: [], onBtn: () => { toast('Okay, game over! Everyone back 🐾'); endFun('done'); } };
    const names = team.length > 1 ? 'Your dogs are' : `${team[0].name} is`;
    funBar(`${names} counting… ${count}. Go and hide!`, 'Stop');
    for (const d of team) {
      d.free = true;
      d.seek = null;
      const a = Math.atan2(pp.x - d.root.position.x, pp.z - d.root.position.z) + Math.PI;
      d.doAct('cover', (dt) => {
        if (!fun || fun.kind !== 'seek') return false;
        if (fun.phase !== 'count') return seekTick(d, dt);
        d.face = a;
        return true;
      }, 'Counting… 🙈');
      spawnEmoji('🙈', d.headWorld(0.4), { size: 0.4, life: 1.6 });
    }
    fun.end = () => { for (const d of team) d.seek = null; };
    tip('hideseek', { title: 'Hide and seek', text: 'While your dogs count, find a good hiding place: behind furniture, hedges or trees is best. Each dog searches in its own way.', icon: 'hide' });
  }
  // each dog's search: a few sniffing stops, closing in on you
  function seekPlan(d) {
    const tr = d.traits.map((t) => D.SEEK[t]).filter(Boolean)[0] || D.SEEK.water;
    const pp = player.root.position;
    const cover = coverAt(pp.x, pp.z);
    const dist = flatDist(d.root.position, pp);
    const r0 = (tr.nose ? 1.6 : 3) + Math.min(6, dist * 0.3) + cover * 0.6;
    const steps = tr.steps + Math.round(cover / 3);
    return { tr, r0, steps, k: 0, wp: null, sniff: 0, napAt: tr.nap && Math.random() < 0.55 ? 2 : -1, passed: false, t: 0 };
  }
  function seekTick(d, dt) {
    if (!d.seek) d.seek = seekPlan(d);
    const P = d.seek, pp = player.root.position, pos = d.root.position;
    if (P.done) return true;
    P.t += dt;
    const close = flatDist(pos, pp);
    // found you!
    if (close < 1.15 && (P.k >= P.steps || P.tr.nose || close < 0.8) && (place === 'home' || lineClear(pos.x, pos.z, pp.x, pp.z, pos.y))) { seekFound(d); return true; }
    if (P.napAt >= 0 && P.k >= P.napAt) {
      P.done = 'nap';
      d.act.pose = 'nap';
      toast(`${d.name} gave up and is having a nap 💤`);
      d.act.fn = () => { if (!fun || fun.kind !== 'seek') return false; if (Math.random() < 1 / 90) spawnEmoji('💤', d.headWorld(0.3), { size: 0.35 }); return true; };
      seekCheckEnd();
      return true;
    }
    if (P.sniff > 0) { P.sniff -= dt; d.act.pose = 'sniff'; return true; }
    d.act.pose = 'none';
    if (!P.wp) {
      if (P.k >= P.steps) {
        // the last bit: straight to you, or (the playful ones) right past you first
        if (P.tr.pretend && !P.passed) {
          const side = rand(0, 1) < 0.5 ? 1 : -1, a = Math.atan2(pp.x - pos.x, pp.z - pos.z) + side * 0.6;
          P.wp = freePoint(pp.x + Math.sin(a) * 1.8, pp.z + Math.cos(a) * 1.8, 0, 0.6) || pp.clone();
          P.passed = true;
          P.pounce = true;
        } else P.wp = pp.clone();
      } else {
        const r = P.r0 * (1 - P.k / (P.steps + 1));
        P.wp = freePoint(pp.x, pp.z, r * 0.5, r) || pp.clone();
      }
      P.wt = 0;
    }
    P.wt += dt;
    const sp = P.k >= P.steps && P.passed && !P.pounce ? 5 : P.tr.speed;
    const left = d.stepTo(P.wp.x, P.wp.z, sp, dt);
    if (left < 0.35 || P.wt > 9) {
      if (P.pounce) { P.pounce = false; P.wp = null; P.sniff = 0.7; d.faceTo(pp); spawnEmoji('👀', d.headWorld(0.35), { size: 0.35 }); return true; }
      P.wp = null;
      if (P.k < P.steps) { P.k++; P.sniff = P.tr.nose ? rand(0.4, 0.8) : rand(0.8, 1.5); }
    }
    return true;
  }
  function seekFound(d) {
    const F = fun;
    const P = d.seek;
    P.done = 'found';
    d.faceTo(player.root.position);
    d.act.pose = 'hop';
    d.act.fn = () => !!fun && fun.kind === 'seek';
    F.found.push(d);
    spawnEmoji('🎉', d.headWorld(0.4), { size: 0.5 });
    sfx('bark');
    haptic();
    toast(F.found.length === 1 && F.team.length > 1 ? `${fill(P.tr.say, { dog: d.name })}. ${d.name} found you first!` : fill(P.tr.say, { dog: d.name }) + '!');
    seekCheckEnd();
  }
  function seekCheckEnd() {
    const F = fun;
    if (!F || F.kind !== 'seek') return;
    if (!F.team.every((d) => d.seek && d.seek.done)) return;
    seekRound(F.found.length ? 'found' : 'none');
  }
  // the round is over: everybody wins a little
  function seekRound(how) {
    const F = fun;
    if (!F || F.over) return;
    F.over = true;
    const coins = how === 'won' ? 10 + Math.floor(Math.random() * 6) : 3 + Math.floor(Math.random() * 5);
    addCoins(coins, player.root.position);
    state.stats.seeks = (state.stats.seeks || 0) + 1;
    progress('seek');
    for (const d of F.team) {
      d.happy = Math.min(100, d.happy + 12);
      d.energy = Math.max(0, d.energy - 4);
      d.addBond(2);
      journalAdd(d, 'seek1', '🙈', 'Played hide and seek with you for the first time');
      if (F.found.includes(d) && F.found[0] === d) journalAdd(d, 'seekfirst', '🏆', 'Was the first to find you in hide and seek');
    }
    if (how === 'won') { toast(`Nobody found you! You win this round 🏆 +🪙 ${coins}`); confetti(player.root.position.clone().add(new V3(0, 1.4, 0)), 5); }
    funBar(how === 'won' ? 'You stayed hidden! 🏆' : 'Round over! 🎉', 'Done');
    F.phase = 'over';
    F.overT = 0;
    save();
  }
  function seekUpdate(dt) {
    const F = fun;
    F.t += dt;
    if (F.phase === 'count') {
      const left = Math.ceil(F.count - F.t);
      if (left !== F.shown) { F.shown = left; funBar(left > 0 ? `${F.team.length > 1 ? 'Counting' : F.team[0].name + ' is counting'}… ${left}. Go and hide!` : 'Ready or not, here they come!', 'Stop'); if (left > 0 && left <= 3) sfx('tap'); }
      if (F.t >= F.count) { F.phase = 'search'; F.t = 0; sfx('bark'); for (const d of F.team) spawnEmoji('👃', d.headWorld(0.35), { size: 0.4 }); }
      return;
    }
    if (F.phase === 'search') {
      const looking = F.team.filter((d) => !d.seek || !d.seek.done).length;
      if (Math.ceil(F.t) !== F.shown2) { F.shown2 = Math.ceil(F.t); funBar(`${looking ? `${looking > 1 ? looking + ' dogs are' : 'A dog is'} looking for you…` : 'Found!'} ${F.found.length ? `· found by ${F.found.map((d) => d.name).join(', ')}` : ''}`, 'Give up'); fun.onBtn = () => { F.team.forEach((d) => { if (d.seek && !d.seek.done) seekFound(d); }); }; }
      if (F.t > 60) seekRound('won');
      return;
    }
    if (F.phase === 'over') {
      F.overT += dt;
      fun.onBtn = () => endFun('done');
      if (F.overT > 6) endFun('done');
    }
  }

  // ----- a dog hides -----
  function hideSpot(d) {
    const pp = player.root.position;
    const shy = d.flag('stormFear'), far = d.flag('zooms');
    const [r0, r1] = place === 'home' ? [shy ? 1.5 : 2.5, shy ? 5 : 12] : [shy ? 4 : 6, shy ? 9 : far ? 16 : 13];
    let best = null, bs = -1;
    for (let k = 0; k < 40; k++) {
      const p = freePoint(pp.x, pp.z, r0, r1);
      if (!p) continue;
      let sc = coverAt(p.x, p.z) + rand(0, 1.5);
      // foodies hide by the food, of course
      if (d.traits.includes('foodie')) { const f = place === 'home' && home().furniture.find((x) => ['fridge', 'stove', 'bowl'].includes(x.type)); if (f && Math.hypot(f.i + 0.5 - p.x, f.j + 0.5 - p.z) < 2.5) sc += 3; }
      if (place === 'home' && findPath(d.root.position, p).length === 1 && !lineClear(d.root.position.x, d.root.position.z, p.x, p.z)) continue;
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }
  function startHide(d) {
    if (!needRank('hideseek') || !d) return;
    if (fun) endFun('switch');
    const spot = hideSpot(d);
    if (!spot) { toast(`${d.name} can’t find anywhere to hide here`); return; }
    const count = 6;
    const pp = player.root.position;
    setPose('cover');
    fun = { kind: 'hide', still: true, dog: d, t: 0, count, phase: 'count', spot, hints: 0, moved: false, onBtn: () => hideGiveUp() };
    funBar(`You’re counting… ${count}`, 'Stop');
    $('peek').classList.remove('hidden');
    $('peekTxt').textContent = count;
    d.free = true;
    const face = Math.atan2(-camOffsetDir.x, -camOffsetDir.z) + rand(-0.6, 0.6);
    d.doAct('none', (dt) => {
      if (!fun || fun.kind !== 'hide' || fun.dog !== d) return false;
      const F = fun;
      if (F.phase === 'count' || F.moving) {
        const left = d.stepTo(F.spot.x, F.spot.z, d.flag('zooms') ? 5 : 3.8, dt);
        if (left < 0.25 || (F.phase !== 'count' && F.t > 3)) {
          if (left >= 0.25) d.root.position.set(F.spot.x, groundAt(F.spot.x, F.spot.z), F.spot.z);
          F.moving = false;
          d.act.pose = 'hide';
          d.face = face;
        }
        return true;
      }
      if (F.phase === 'hidden') {
        d.act.pose = d.act.sleepy ? 'nap' : 'hide';
        d.act.wag = Math.sin(F.t * 1.3) > 0.6;
        return true;
      }
      return true;
    }, 'Hiding 🙈');
    fun.end = () => { $('peek').classList.add('hidden'); };
    tip('hidedog', { title: `Where is ${d.name}?`, text: 'Look for a tail sticking out, or listen for a little snort. Tap your dog (or walk up to it) when you spot it.', icon: 'search' });
    void pp;
  }
  function hideUpdate(dt) {
    const F = fun, d = F.dog;
    F.t += dt;
    if (F.phase === 'count') {
      const left = Math.ceil(F.count - F.t);
      $('peekTxt').textContent = left > 0 ? left : '';
      if (left !== F.shown) { F.shown = left; funBar(left > 0 ? `You’re counting… ${left}` : 'Ready or not!', 'Stop'); if (left > 0) sfx('tap'); }
      if (F.t >= F.count) {
        if (flatDist(d.root.position, F.spot) > 0.3) d.root.position.set(F.spot.x, groundAt(F.spot.x, F.spot.z), F.spot.z);
        F.phase = 'hidden';
        F.t = 0;
        F.still = false;
        clearPose();
        $('peek').classList.add('hidden');
        if (d.flag('lounges') && Math.random() < 0.6) d.act.sleepy = true;
        funBar(`Find ${d.name}! Tap it when you spot it`, 'Give up');
      }
      return;
    }
    if (F.phase !== 'hidden') { F.overT = (F.overT || 0) + dt; if (F.overT > 3) endFun('done'); return; }
    // walking right up to it counts too
    if (flatDist(player.root.position, d.root.position) < 1.2) { hideFound(); return; }
    // the zoomy ones can't keep still and sneak off to a new spot once
    if (!F.moved && d.flag('zooms') && F.t > 12) {
      F.moved = true;
      const s = hideSpot(d);
      if (s) { spawnEmoji('🍃', d.headWorld(0), { size: 0.4 }); sfx('rustle'); F.spot = s; F.moving = true; F.t = 0.1; d.act.pose = 'none'; }
    }
    const every = d.act && d.act.sleepy ? 3 : 14;
    if (F.t > 8 + F.hints * every) {
      F.hints++;
      if (d.act && d.act.sleepy) spawnEmoji('💤', d.headWorld(0.3), { size: 0.4 });
      else { spawnEmoji(pick(['💨', '🐾', '❗']), d.headWorld(0.35), { size: 0.4 }); sfx('yip'); if (F.hints % 2 === 1) toast(pick(D.HIDE_GIGGLE)); }
    }
  }
  function hideFound() {
    const F = fun, d = F.dog;
    if (F.phase !== 'hidden') return;
    F.phase = 'over';
    const secs = F.t;
    const coins = Math.max(2, Math.round(10 - secs / 6));
    addCoins(coins, d.root.position);
    toast(fill(pick(D.HIDE_FOUND), { dog: d.name }) + ` (${Math.round(secs)} s)`);
    sfx('bark');
    haptic();
    d.act.pose = 'hop';
    d.act.sleepy = false;
    d.faceTo(player.root.position);
    spawnEmoji('🎉', d.headWorld(0.4), { size: 0.5 });
    finishHideRound(d);
    funBar(`Found ${d.name}! 🎉`, 'Done');
    fun.onBtn = () => endFun('done');
  }
  function hideGiveUp() {
    const F = fun, d = F.dog;
    if (F.phase !== 'hidden') { endFun('done'); return; }
    F.phase = 'over';
    d.act.pose = 'hop';
    d.act.sleepy = false;
    spawnEmoji('🏆', d.headWorld(0.45), { size: 0.5 });
    toast(`${d.name} pops out, very proud. ${d.name} wins this round!`);
    finishHideRound(d);
    d.happy = Math.min(100, d.happy + 6);
    funBar(`${d.name} wins! 🏆`, 'Done');
    fun.onBtn = () => endFun('done');
  }
  function finishHideRound(d) {
    state.stats.seeks = (state.stats.seeks || 0) + 1;
    progress('seek');
    d.happy = Math.min(100, d.happy + 12);
    d.addBond(2);
    journalAdd(d, 'hide1', '🙈', 'Hid from you in a game of hide and seek');
    save();
  }

  // =====================================================================
  // Grooming: muddy paw prints, wet dogs shaking off, and brushing
  // =====================================================================
  const PRINTS_MAX = 6;
  let playerWet = 0;
  function pastimeDogTick(d, dt) {
    if (d.npc || !dogs.includes(d)) return;
    // wet dogs: from rain, splashing and baths
    if (place === 'park' && (curWeather().precip === 'rain' || d.state === 'splash')) d.wetT = Math.max(d.wetT || 0, 40);
    else if (d.wetT > 0) d.wetT -= dt;
    // muddy paws leave prints indoors
    if (place === 'home' && !visit && d.moving && d.state !== 'act') {
      const mud = (d.dirt.mud || 0) + (d.dirt.slush || 0) + (d.dirt.sand || 0) * 0.5;
      // only properly dirty dogs (under half clean) track mud in
      if (mud > 2 && d.clean < 50) {
        const p = d.root.position;
        if (!d.lastPrint) d.lastPrint = p.clone();
        if (flatDist(p, d.lastPrint) > 2.2) {
          d.lastPrint.copy(p);
          const i = Math.floor(p.x), j = Math.floor(p.z);
          if (Math.random() < 0.6 && !isGardenTile(i, j) && !furnitureAt(i, j) && !state.clutter.some((c) => c.i === i && c.j === j) && state.clutter.filter((c) => c.kind === 'prints').length < PRINTS_MAX) {
            state.clutter.push({ kind: 'prints', i, j, rot: d.face, seed: Math.floor(Math.random() * 1e6) });
            renderClutter();
            computeComfort();
            if (!state.tips.includes('prints')) setTimeout(() => tip('prints', { title: 'Muddy paws!', text: 'Muddy dogs leave paw prints on the floor. Tap the prints to wipe them up, and give your dog a bath or a towel.', icon: 'paw' }), 600);
          }
        }
      }
    }
    // a freshly brushed dog is a bit fluffier for a while
    const fluffy = (d.fluffUntil || 0) > Date.now();
    if (fluffy !== !!d.fluffed) {
      d.fluffed = fluffy;
      d.body.scale.set(fluffy ? 1.08 : 1, fluffy ? 1.06 : 1, fluffy ? 1.05 : 1);
      if (d.ui) refreshCardStatic(d);
    }
    if (fluffy && Math.random() < dt * 0.12) spawnEmoji('✨', d.headWorld(0.1), { size: 0.25, life: 0.9 });
  }
  // back home after a wet walk (or out of the bath), a dog shakes off right next to you
  function shakeOff(d, why) {
    if (!d || fun) return;
    let t = 0, shook = false;
    d.doAct('none', (dt) => {
      t += dt;
      const pp = player.root.position;
      if (!shook) {
        const left = d.stepTo(pp.x + 0.5, pp.z + 0.5, 3, dt);
        if (left > 0.6 && t < 4) return true;
        shook = true; t = 0;
        d.act.pose = 'shake';
        sfx('shake');
        for (let k = 0; k < 8; k++) setTimeout(() => spawnEmoji('💦', d.headWorld(0).add(new V3(rand(-0.6, 0.6), rand(-0.3, 0.2), rand(-0.6, 0.6))), { size: 0.3, life: 0.8, vy: 1.4 }), k * 60);
        playerWet = 6;
        toast(why === 'bath' ? `${d.name} shakes off the bath water. All over you! 💦` : `${d.name} shook off right next to you. You’re soaked! 💦`);
        d.wetT = 0;
        d.clean = Math.min(100, d.clean + 2);
        journalAdd(d, 'shake1', '💦', 'Shook off right next to you and got you soaked');
        return true;
      }
      return t < 1.1;
    }, 'Shaking off 💦');
  }
  function updatePlayerWet(dt) {
    if (playerWet <= 0) return;
    playerWet -= dt;
    if (Math.random() < dt * 5) spawnEmoji('💧', player.root.position.clone().add(new V3(rand(-0.25, 0.25), rand(0.6, 1.4), rand(-0.2, 0.2))), { size: 0.2, life: 0.6, vy: -1.4 });
  }
  // ----- brushing: swipe back and forth -----
  function startBrush(d) {
    if (!needRank('brush') || !d) return;
    if (fun) endFun('switch');
    const need = 14;
    fun = { kind: 'brush', dog: d, strokes: 0, need, fast: 0, still: true, phase: 'go', t: 0, onBtn: () => endFun('done') };
    funBar(`Swipe back and forth to brush ${d.name}`, 'Stop', 0);
    d.free = true;
    d.doAct('none', (dt) => {
      if (!fun || fun.kind !== 'brush' || fun.dog !== d) return false;
      const F = fun;
      if (F.phase === 'go') {
        const pp = player.root.position, f = player.face;
        const left = d.stepTo(pp.x + Math.sin(f) * 0.85, pp.z + Math.cos(f) * 0.85, 2.6, dt);
        F.t += dt;
        if (left < 0.3 || F.t > 5) { F.phase = 'brush'; d.faceTo(pp); d.face += Math.PI / 2; }
        return true;
      }
      if (F.wiggle > 0) { F.wiggle -= dt; d.act.pose = 'dance'; return true; }
      d.act.pose = F.flinch > 0 ? 'tilt' : 'sit';
      if (F.flinch > 0) F.flinch -= dt;
      return true;
    }, 'Being brushed 🪮');
    // face your dog
    const dp = d.root.position, pp = player.root.position;
    player.face = Math.atan2(dp.x - pp.x, dp.z - pp.z);
    setPose('brush');
    tip('brushing', { title: 'Brushing', text: 'Swipe back and forth anywhere on the screen. Gentle, steady strokes work best: rushing tugs at the tangles.', icon: 'brush' });
  }
  function brushMove(e) {
    const F = fun;
    if (!F || F.kind !== 'brush' || F.phase !== 'brush') return;
    const now = performance.now();
    if (!F.last) { F.last = { x: e.clientX, y: e.clientY, t: now }; F.dir = 0; F.run = 0; return; }
    const dx = e.clientX - F.last.x, dy = e.clientY - F.last.y, dtm = Math.max(1, now - F.last.t);
    const along = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    F.last = { x: e.clientX, y: e.clientY, t: now };
    const sign = Math.sign(along);
    if (!sign) return;
    if (sign !== F.dir && F.run > 40) brushStroke(F, Math.abs(along) / dtm);
    if (sign !== F.dir) { F.dir = sign; F.run = 0; F.speed = 0; }
    F.run += Math.abs(along);
    F.speed = Math.max(F.speed || 0, Math.abs(along) / dtm);
  }
  function brushStroke(F, _v) {
    const d = F.dog;
    if (player.pose) player.pose.stroke = 0.25;
    sfx('brush');
    // rushing tugs at the tangles
    if ((F.speed || 0) > 3.2) {
      F.fast++;
      if (F.fast % 2 === 0) {
        F.flinch = 0.6;
        spawnEmoji('😣', d.headWorld(0.35), { size: 0.35 });
        if (!F.warned) { F.warned = true; toast('Gently! Slower strokes get the tangles out'); }
        return;
      }
    }
    F.strokes++;
    const C = ART.coatOf(d.breed, d.coat);
    for (let k = 0; k < 2; k++) spawnEmoji(pick(['☁️', '✨']), d.headWorld(-0.25).add(new V3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3))), { size: 0.2, life: 0.7, vy: 0.6 });
    void C;
    if (d.flag('zooms') && F.strokes === 5 && !F.wiggled) { F.wiggled = true; F.wiggle = 1; F.strokes -= 2; toast(`${d.name} wriggles! Hold on…`); }
    if (d.flag('stormFear') || d.traits.includes('pampered')) d.happy = Math.min(100, d.happy + 1);
    funBar(`Brushing ${d.name}…`, 'Stop', F.strokes / F.need);
    if (F.strokes >= F.need) brushDone();
  }
  function brushDone() {
    const F = fun, d = F.dog;
    F.phase = 'done';
    d.fluffUntil = Date.now() + D.BRUSH_MIN * 60000;
    for (const k of ['grass', 'burrs', 'sand', 'glitter', 'pollen', 'confetti', 'dust', 'moondust']) if (d.dirt[k]) d.dirt[k] *= 0.3;
    d.clean = Math.min(100, d.clean + 10);
    d.happy = Math.min(100, d.happy + 12);
    d.addBond(2);
    d.updateDirtLook();
    progress('brush');
    haptic();
    sfx('twinkle');
    confetti(d.headWorld(0.2), 3);
    const R = D.BRUSH_REACT[d.traits[0]] || '{dog} looks lovely.';
    toast(`✨ ${fill(R, { dog: d.name })} So fluffy!`);
    journalAdd(d, 'brush1', '🪮', 'Got brushed until the coat was extra fluffy');
    d.act.pose = 'hop';
    funBar(`${d.name} is all fluffy ✨`, 'Done', 1);
    fun.onBtn = () => endFun('done');
    setTimeout(() => { if (fun === F) endFun('done'); }, 2500);
    save();
  }
  // photos of a freshly brushed dog are a little special
  function photoFluff() {
    const fl = dogs.filter((d) => d.fluffed && d.root.visible);
    if (!fl.length) return;
    const key = 'fluffpic:' + clockNow.gameDay;
    if (!state.xpDay || state.xpDay.day !== clockNow.gameDay || !state.xpDay.n[key]) {
      if (!state.xpDay || state.xpDay.day !== clockNow.gameDay) state.xpDay = { day: clockNow.gameDay, n: {} };
      state.xpDay.n[key] = 1;
      gainXP(10);
    }
    for (const d of fl) journalAdd(d, 'fluffpic', '📸', 'Looked extra fluffy in a photo');
    setTimeout(() => toast(`${fl.map((d) => d.name).join(' and ')} ${fl.length > 1 ? 'look' : 'looks'} extra fluffy in this one ✨`), 600);
  }

  // =====================================================================
  // Leaf piles (autumn) and snow piles (winter, and always in the Snowy Village)
  // =====================================================================
  let patches = [];
  const patchRoot = () => (place === 'home' ? homeRoot : parkRoot);
  function pileKind() {
    if (place === 'park' && loc === 'snowy') return 'snow';
    if (place === 'park' && ['caves', 'moon', 'fairy', 'beach'].includes(loc)) return null;
    const s = seasonOf(clockNow.month);
    return s === 'autumn' ? 'leaves' : s === 'winter' ? 'snow' : null;
  }
  function clearPatches() { for (const p of patches) if (p.g.parent) p.g.parent.remove(p.g); patches = []; }
  function spawnPatches() {
    clearPatches();
    const kind = pileKind();
    if (!kind || visit || !unlockedFeat('piles')) return;
    const root = patchRoot();
    const add = (x, z) => {
      const g = ART.buildPatch(kind, Math.floor(Math.random() * 1e6));
      g.position.set(x, groundAt(x, z) + 0.01, z);
      root.add(g);
      patches.push({ g, x, z, kind });
    };
    if (place === 'home') {
      for (let k = 0; k < 6; k++) { const p = randomGardenPoint(); if (p && !patches.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1)) add(p.x, p.z); }
      return;
    }
    // a few clusters near the path, so they are easy to find
    const L = S.loop || { x: 11, z0: -11, z1: 11 };
    for (let c = 0; c < 4; c++) {
      const cx = rand(-L.x, L.x), cz = rand(L.z0, L.z1);
      for (let k = 0; k < 4; k++) {
        const x = cx + rand(-2.5, 2.5), z = cz + rand(-2.5, 2.5);
        if (isSolid(x, z) || inPond(x, z, 0.6) || (S.inside && !S.inside(x, z)) || patches.some((q) => Math.hypot(q.x - x, q.z - z) < 1)) continue;
        if (terrainOn() && Math.abs(S.height(x, z) - S.height(cx, cz)) > 0.5) continue;
        add(x, z);
      }
    }
  }
  const nearPatch = (pp, r) => patches.find((p) => Math.hypot(p.x - pp.x, p.z - pp.z) < r && Math.abs(p.g.position.y - pp.y) < 0.8);
  function startRake() {
    if (!needRank('piles')) return;
    const pp = player.root.position;
    const near = nearPatch(pp, 2.4);
    if (!near) return;
    if (fun) endFun('switch');
    const kind = near.kind;
    // the pile goes just ahead of you
    const f = player.face;
    let at = new V3(pp.x + Math.sin(f) * 1.3, 0, pp.z + Math.cos(f) * 1.3);
    if (isSolid(at.x, at.z) || inPond(at.x, at.z, 0.5)) at = pp.clone();
    at.y = groundAt(at.x, at.z);
    const pile = { g: null, n: 0, at, kind };
    const setPile = () => {
      if (pile.g && pile.g.parent) pile.g.parent.remove(pile.g);
      pile.g = ART.buildPile(kind, pile.n);
      pile.g.position.copy(at);
      patchRoot().add(pile.g);
    };
    setPile();
    const tool = holdTool(kind === 'snow' ? 'shovel' : 'rake');
    tool.rotation.x = 0.5;
    fun = { kind: 'rake', pile, setPile, tool, flying: [], onBtn: () => pileJump() };
    const noun = kind === 'snow' ? 'snow' : 'leaves';
    funBar(`Walk over the ${noun} to sweep them onto the pile`, 'Done');
    fun.end = () => { tool.parent && tool.parent.remove(tool); if (!fun || fun.pile !== pile) { if (pile.g && pile.g.parent && !pile.keep) pile.g.parent.remove(pile.g); } };
    tip('piles', { title: kind === 'snow' ? 'A snow pile' : 'A leaf pile', text: `Walk over the ${noun} to sweep them onto your pile. The bigger the pile, the bigger the jump, and sometimes there’s a surprise inside. Tap Done when it’s ready.`, icon: 'rake' });
  }
  function rakeUpdate(dt) {
    const F = fun, pp = player.root.position;
    // sweep up what you walk over
    for (let k = patches.length - 1; k >= 0; k--) {
      const p = patches[k];
      if (p.kind !== F.pile.kind || Math.hypot(p.x - pp.x, p.z - pp.z) > D.PILE.reach) continue;
      patches.splice(k, 1);
      F.flying.push({ g: p.g, from: p.g.position.clone(), t: 0 });
      sfx('rustle');
    }
    for (let k = F.flying.length - 1; k >= 0; k--) {
      const fl = F.flying[k];
      fl.t += dt * 2.2;
      const to = F.pile.at;
      fl.g.position.set(lerp(fl.from.x, to.x, fl.t), lerp(fl.from.y, to.y, fl.t) + Math.sin(Math.min(1, fl.t) * Math.PI) * 0.8, lerp(fl.from.z, to.z, fl.t));
      fl.g.scale.setScalar(1 - fl.t * 0.6);
      if (fl.t >= 1) {
        fl.g.parent && fl.g.parent.remove(fl.g);
        F.flying.splice(k, 1);
        F.pile.n++;
        F.setPile();
        funBar(`Your pile: ${F.pile.n} ${F.pile.kind === 'snow' ? 'scoops of snow' : 'heaps of leaves'}${F.pile.n >= D.PILE.findAt ? ' — nice and big!' : ''}`, 'Done');
      }
    }
    // swing the rake as you walk
    if (player.blend > 0.2) { player.armR.rotation.x = -0.6 + Math.sin(animT * 9) * 0.35; player.armL.rotation.x = -0.6 + Math.sin(animT * 9) * 0.35; }
  }
  // your dogs jump in, one after another
  function pileJump() {
    const F = fun;
    if (!F || F.kind !== 'rake' || F.jumping) return;
    if (F.pile.n < 2) { toast(`Sweep up a little more ${F.pile.kind === 'snow' ? 'snow' : 'leaves'} first`); return; }
    F.jumping = true;
    F.still = true;
    F.tool.parent && F.tool.parent.remove(F.tool);
    const pile = F.pile, team = funDogs();
    let landed = 0;
    funBar('Here they come!', null);
    team.forEach((d, i) => {
      const keen = !(d.traits[0] === 'pampered' && Math.random() < 0.6);
      d.free = true;
      const a = Math.atan2(d.root.position.x - pile.at.x, d.root.position.z - pile.at.z);
      const start = new V3(pile.at.x + Math.sin(a) * 1.8, 0, pile.at.z + Math.cos(a) * 1.8);
      if (isSolid(start.x, start.z)) start.copy(d.root.position);
      let t = -i * 1.1, ph = 'run', jt = 0;
      const from = new V3();
      d.doAct('none', (dt) => {
        if (!fun || fun !== F) return false;
        t += dt;
        if (t < 0) return true;
        if (!keen) {
          if (ph === 'run') { ph = 'watch'; d.faceTo(pile.at); d.act.pose = 'sit'; toast(fill(pick(D.PILE_LINES.skip), { dog: d.name })); landed++; }
          return true;
        }
        if (ph === 'run') {
          if (d.stepTo(start.x, start.z, 4, dt) < 0.3 || t > 4) { ph = 'jump'; from.copy(d.root.position); d.faceTo(pile.at); sfx('whoosh'); }
          return true;
        }
        if (ph === 'jump') {
          jt = Math.min(1, jt + dt / 0.75);
          d.root.position.x = lerp(from.x, pile.at.x, jt);
          d.root.position.z = lerp(from.z, pile.at.z, jt);
          d.act.pose = 'jump';
          d.act.hop = Math.sin(jt * Math.PI) * (0.7 + Math.min(pile.n, 12) * 0.06);
          d.act.tilt = lerp(-0.5, 0.5, jt);
          if (jt >= 1) {
            ph = 'in'; t = 0;
            d.act.hop = -0.15;
            const e = pile.kind === 'snow' ? '❄️' : '🍂';
            for (let k = 0; k < 7; k++) setTimeout(() => spawnEmoji(e, pile.at.clone().add(new V3(rand(-0.8, 0.8), rand(0.2, 0.9), rand(-0.8, 0.8))), { size: 0.35, life: 1.1, vy: rand(0.6, 1.6) }), k * 50);
            sfx('splash');
            haptic();
            toast(fill(pick(D.PILE_LINES[pile.kind === 'snow' ? 'snow' : 'leaves']), { dog: d.name }));
            d.happy = Math.min(100, d.happy + 6 + pile.n * 1.2);
            d.energy = Math.max(0, d.energy - 3);
            addDirt(d, pile.kind === 'snow' ? 'frost' : loc === 'forest' && place === 'park' ? 'burrs' : 'grass', pile.kind === 'snow' ? 1 : 2);
            if (pile.kind === 'snow') d.wetT = 30;
            journalAdd(d, 'pile:' + pile.kind, pile.kind === 'snow' ? '❄️' : '🍂', pile.kind === 'snow' ? 'Jumped into a big pile of snow you made' : 'Jumped into a pile of leaves you raked up');
            // the pile gets a little smaller with every jump
            pile.n = Math.max(1, Math.round(pile.n * 0.7));
            F.setPile();
          }
          return true;
        }
        if (ph === 'in') {
          d.act.pose = 'lie';
          d.act.hop = 0;
          if (t > 1.2) { ph = 'out'; landed++; d.act.pose = 'hop'; }
          return true;
        }
        if (ph === 'out') { if (t > 2.4) { ph = 'done'; d.act.pose = 'sit'; } return true; }
        return true;
      }, 'Jumping in the pile 🍂');
    });
    const total = team.length;
    const waitEnd = () => {
      if (fun !== F) return;
      if (landed < total && !F.timeUp) { setTimeout(waitEnd, 400); return; }
      // a surprise in a big pile
      const big = F.startN >= D.PILE.findAt;
      let surprise = '';
      if (big && Math.random() < D.PILE.findChance) {
        if (place === 'park') { const id = rollFind(loc, 'sniff') || rollFind(loc); if (id) { grantFind(id, pile.at.clone().add(new V3(0, 0.8, 0))); surprise = ' Something was hiding in the pile!'; } }
        else { findIngredient(pile.at); surprise = ' Something was hiding in the pile!'; }
      }
      const coins = D.PILE.coins[0] + Math.floor(Math.random() * (D.PILE.coins[1] - D.PILE.coins[0] + 1)) + (big ? 4 : 0);
      addCoins(coins, pile.at.clone().add(new V3(0, 0.6, 0)));
      progress('pile');
      funBar(`What a jump!${surprise}`, 'Done');
      F.onBtn = () => endFun('done');
      setTimeout(() => { if (fun === F) endFun('done'); }, 3500);
      save();
    };
    F.startN = pile.n;
    setTimeout(() => { F.timeUp = true; }, 12000);
    setTimeout(waitEnd, 1200);
  }

  // =====================================================================
  // Skipping stones: time your throw, count the bounces
  // =====================================================================
  function waterNear(pp) {
    if (place !== 'park' || !S.ponds) return null;
    const e = pondEdge(pp);
    if (!e || flatDist(e, pp) > 1.9) return null;
    const P = S.ponds.find((p) => e.center.x > p.x0 - 0.6 && e.center.x < p.x1 + 0.6 && e.center.z > p.z0 - 0.6 && e.center.z < p.z1 + 0.6);
    if (!P || Math.min(P.x1 - P.x0, P.z1 - P.z0) < 2.5) return null;
    return { edge: e, pond: P };
  }
  const skipRay = new THREE.Raycaster();
  function waterY(x, z) {
    try {
      skipRay.set(new V3(x, 20, z), new V3(0, -1, 0));
      const h = skipRay.intersectObjects(parkRoot.children, true).find((o) => o.object.material && o.object.material.color && o.object.material.color.b > o.object.material.color.r + 0.15);
      if (h) return h.point.y + 0.03;
    } catch (_) { /* fine */ }
    return groundAt(x, z) + 0.05;
  }
  function startSkip() {
    if (!needRank('stones')) return;
    const W = waterNear(player.root.position);
    if (!W) return;
    if (fun) endFun('switch');
    const pp = player.root.position;
    player.face = Math.atan2(W.edge.center.x - pp.x, W.edge.center.z - pp.z);
    setPose('skip');
    fun = { kind: 'skip', still: true, water: W, t: 0, v: 0, stone: null, onBtn: () => skipThrow() };
    funBar('Tap Throw when the marker is in the middle', 'Throw', 0);
    $('funMeter').classList.add('needle');
    fun.end = () => { if (fun && fun.stone) fun.stone.g.parent && fun.stone.g.parent.remove(fun.stone.g); };
    tip('skipping', { title: 'Skipping stones', text: 'Throw when the marker is in the green middle of the bar. The closer to the middle, the more bounces. Water lovers may jump in after it!', icon: 'stone' });
  }
  function skipUpdate(dt) {
    const F = fun;
    F.t += dt;
    if (!F.stone) {
      F.v = (Math.sin(F.t * D.SKIP.swing * Math.PI) + 1) / 2;
      $('funFill').style.width = (F.v * 100).toFixed(1) + '%';
      return;
    }
    const st = F.stone;
    st.t += dt;
    const leg = st.legs[st.i];
    if (!leg) {
      F.stone = null;
      return;
    }
    const k = Math.min(1, st.t / leg.dur);
    st.g.position.set(lerp(leg.a.x, leg.b.x, k), lerp(leg.a.y, leg.b.y, k) + Math.sin(k * Math.PI) * leg.h, lerp(leg.a.z, leg.b.z, k));
    st.g.rotation.y += dt * 20;
    if (k >= 1) {
      st.t = 0;
      st.i++;
      if (leg.end) { sfx('plop'); ripple(leg.b, 1.4); st.g.parent && st.g.parent.remove(st.g); skipScore(F, st.n, leg.shore); return; }
      st.n++;
      sfx('plip');
      ripple(leg.b, 0.9);
      F.counter = st.n;
      funBar(`${st.n}…`, null);
    }
  }
  const ripples = [];
  function ripple(p, s) {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    for (const [x, z, w, d] of [[0, 0.5, 1.1, 0.1], [0, -0.5, 1.1, 0.1], [0.5, 0, 0.1, 1.1], [-0.5, 0, 0.1, 1.1]]) box(g, w, 0.01, d, m, x, 0, z);
    g.position.copy(p);
    g.scale.setScalar(0.2);
    parkRoot.add(g);
    ripples.push({ g, m, t: 0, s });
  }
  function updateRipples(dt) {
    for (let k = ripples.length - 1; k >= 0; k--) {
      const r = ripples[k];
      r.t += dt;
      r.g.scale.setScalar(0.2 + r.t * r.s);
      r.m.opacity = Math.max(0, 0.9 - r.t * 0.9);
      if (r.t > 1) { r.g.parent && r.g.parent.remove(r.g); ripples.splice(k, 1); }
    }
  }
  function skipThrow() {
    const F = fun;
    if (!F || F.kind !== 'skip' || F.stone) return;
    const off = Math.abs(F.v - 0.5);
    const q = clamp(1 - off / 0.5, 0, 1);
    let n = Math.floor(Math.pow(q, 1.6) * D.SKIP.max + rand(0, 1.3));
    if (off < 0.035) n++;
    n = clamp(n, 0, D.SKIP.max + 1);
    player.throwT = 0.35;
    sfx('throw');
    const pp = player.root.position, f = player.face;
    const dir = new V3(Math.sin(f), 0, Math.cos(f));
    const P = F.water.pond;
    const inW = (x, z) => x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1;
    const legs = [];
    const a = pp.clone().add(new V3(0, 1.1, 0));
    let cur = new V3(pp.x + dir.x * 1.2, 0, pp.z + dir.z * 1.2);
    if (!inW(cur.x, cur.z)) { const e = F.water.edge.center; cur = new V3(e.x + dir.x * 0.4, 0, e.z + dir.z * 0.4); }
    cur.y = waterY(cur.x, cur.z);
    // how much water is ahead: the hops shrink to fit (big water, big hops)
    let len = 0;
    while (len < 30 && inW(cur.x + dir.x * (len + 0.1), cur.z + dir.z * (len + 0.1))) len += 0.1;
    const decay = 0.86;
    let step = n ? Math.min(1.5 + q * 0.4, (len * 0.9 * (1 - decay)) / (1 - Math.pow(decay, n))) : 1;
    legs.push({ a, b: cur.clone(), dur: 0.35, h: 0.4 });
    let shore = false;
    for (let i = 0; i < n; i++) {
      const nx = cur.x + dir.x * step, nz = cur.z + dir.z * step;
      if (!inW(nx, nz)) { shore = true; const b = new V3(nx, groundAt(nx, nz) + 0.05, nz); legs.push({ a: cur.clone(), b, dur: 0.3, h: 0.3, end: true, shore: true }); break; }
      const b = new V3(nx, cur.y, nz);
      legs.push({ a: cur.clone(), b, dur: 0.18 + step * 0.06, h: 0.12 + step * 0.05 });
      cur = b;
      step *= decay;
    }
    // the last hop ends with a plop
    if (!shore) legs[legs.length - 1].end = true;
    const g = ART.buildTool('stone');
    parkRoot.add(g);
    F.stone = { g, legs, i: 0, t: 0, n: 0 };
    $('funFill').style.width = '50%';
    // the dogs watch: water lovers go in after it, the others bark at the splashes
    for (const d of funDogs()) {
      if (d.state === 'act') continue;
      if (d.flag('splashes') && Math.random() < 0.7) {
        const e = pondEdge(d.root.position);
        if (e && flatDist(e, d.root.position) < 6) { d.goTo(e, 3.6, () => { d.faceTo(e.center); d.setState('splash', 2.2); d.wetT = 40; addDirt(d, walkDirt(), 1); }, 0.5); continue; }
      }
      setTimeout(() => { if (place === 'park') { sfx('bark'); spawnEmoji('💬', d.headWorld(0.4), { size: 0.35 }); d.faceTo(cur); } }, 700 + Math.random() * 600);
    }
  }
  function skipScore(F, n, shore) {
    const best = state.stats.skipBest || 0;
    state.stats.skips = (state.stats.skips || 0) + 1;
    progress('skip');
    let msg = n === 0 ? 'Plop! Straight in. Try a flatter throw' : fill(n >= 7 ? D.SKIP_LINES[2] : n <= 2 ? D.SKIP_LINES[3] : pick(D.SKIP_LINES.slice(0, 2)), { n });
    if (shore) msg = `${n} skips, and right across to the other side!`;
    if (n > best) {
      state.stats.skipBest = n;
      if (best > 0) msg += ` New best! 🏆`;
      if (n >= 3) for (const d of funDogs()) journalAdd(d, null, '🪨', `Watched you skip a stone ${n} times in ${LOC().name}`);
      if (n >= 5) confetti(player.root.position.clone().add(new V3(0, 1.5, 0)), 4);
    }
    if (n >= 3) addCoins(Math.floor(n / 2), player.root.position);
    toast(msg);
    funBar(`${n} skip${n === 1 ? '' : 's'}${state.stats.skipBest ? ` · best ${state.stats.skipBest}` : ''}. Again?`, 'Throw', 0.5);
    save();
  }

  // =====================================================================
  // Stargazing: lie back on a clear night, and your dogs' shapes appear in the stars
  // =====================================================================
  let gazeK = 0;
  const gazeRoot = new THREE.Group();
  camera.add(gazeRoot);
  world.add(camera);
  gazeRoot.visible = false;
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false, depthWrite: false });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xa8d4ff, transparent: true, opacity: 0, fog: false, depthWrite: false });
  let starField = null;
  function buildStarField() {
    if (starField) return;
    starField = new THREE.Group();
    const r = ART.mulberry32(99);
    for (let k = 0; k < 150; k++) {
      const x = (r() - 0.5) * 140, y = (r() - 0.35) * 90, s = 0.12 + r() * 0.28;
      const m = new THREE.Mesh(geo(s, s, s), starMat);
      m.position.set(x, y, -70);
      m.userData.tw = r() * 6;
      starField.add(m);
    }
    gazeRoot.add(starField);
  }
  const clearSky = () => { const W = localWeather(); return !W.precip && !['clouds', 'cloudy', 'fog', 'overcast'].includes(W.id || weatherId) && !W.fog; };
  const canGaze = () => unlockedFeat('stars') && nightLevel > 0.55 && clearSky() && (place === 'home' ? isGardenTile(Math.floor(player.root.position.x), Math.floor(player.root.position.z)) : !LOC().indoor || loc === 'moon') && !roofOver;
  // a dog's outline, side on, as stars (x to the right, y up)
  function dogShape(d) {
    const sh = D.BREEDS[d.breed].shape, long = sh.torsoL > 0.8 ? 1.25 : 1, short = sh.legH < 0.2 ? 0.55 : 1;
    const ear = sh.ears === 'upright' || sh.ears === 'pointy' ? [[0.6, 0.85]] : [[0.5, 0.18]];
    const tail = sh.tail === 'curl' ? [[-0.85, 0.62], [-0.68, 0.5]] : sh.tail === 'stub' ? [[-0.7, 0.32]] : [[-1.05, 0.55]];
    const pts = [[1.0, 0.36], [0.78, 0.6], ...ear, [0.5, 0.45], [0.34, 0.2], [-0.5 * long, 0.22], ...tail, [-0.58 * long, 0.0], [-0.52 * long, -0.5 * short], [0.0, -0.06], [0.4, -0.5 * short], [0.52, 0.04], [0.86, 0.24]];
    return pts;
  }
  function startGaze() {
    if (!needRank('stars')) return;
    if (!canGaze()) { toast(nightLevel < 0.55 ? 'Wait until it’s dark' : 'It’s too cloudy to see the stars tonight'); return; }
    if (fun) endFun('switch');
    buildStarField();
    setPose('lie');
    const team = funDogs();
    const pick1 = team.find((d) => !(state.starNames || {})[d.id]) || pick(team);
    fun = { kind: 'gaze', still: true, t: 0, dog: pick1, con: null, shown: 0, done: false, shooting: null, nextShoot: rand(6, 10), wished: false, onBtn: () => endFun('done') };
    funBar('Lie back and watch the sky…', 'Stand up');
    team.forEach((d, i) => {
      const side = i % 2 ? -1 : 1, f = player.face;
      const at = new V3(player.root.position.x + Math.cos(f) * 0.8 * side, 0, player.root.position.z - Math.sin(f) * 0.8 * side);
      d.free = true;
      d.doAct('none', (dt) => {
        if (!fun || fun.kind !== 'gaze') return false;
        if (d.stepTo(at.x, at.z, 2, dt) < 0.3) { d.act.pose = 'lie'; d.face = f + Math.PI; }
        return true;
      }, 'Looking at the stars ✨');
    });
    fun.end = () => { if (fun && fun.con) fun.con.parent && fun.con.parent.remove(fun.con); };
    sfx('twinkle');
    tip('stargaze', { title: 'Stargazing', text: 'Watch the sky for a little while. If the stars make a shape you know, tap the sky. And keep an eye out for shooting stars!', icon: 'star' });
  }
  function gazeUpdate(dt) {
    const F = fun;
    F.t += dt;
    if (!clearSky() || nightLevel < 0.4) { toast('Clouds rolled in. Time to head on'); endFun('done'); return; }
    // twinkle
    if (starField) for (let k = 0; k < 6; k++) { const m = starField.children[Math.floor(Math.random() * starField.children.length)]; m.scale.setScalar(0.6 + Math.random() * 0.8); }
    // a constellation slowly appears, star by star
    if (!F.con && F.t > 3) {
      const g = new THREE.Group();
      // sized to fit the screen, phone or tablet
      const halfW = 60 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
      const pts = dogShape(F.dog), s = clamp((halfW * 0.82) / 1.05, 4, 11);
      g.position.set(0, 4, -60);
      g.userData.pts = pts.map(([x, y]) => new V3(x * s, y * s, 0));
      g.userData.stars = g.userData.pts.map((p, i) => { const m = new THREE.Mesh(geo(0.75, 0.75, 0.75), i === 1 ? new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, fog: false, depthWrite: false }) : starMat); m.position.copy(p); m.visible = false; g.add(m); return m; });
      g.userData.lines = [];
      for (let i = 0; i < pts.length; i++) {
        const a = g.userData.pts[i], b = g.userData.pts[(i + 1) % pts.length], L = a.distanceTo(b);
        const l = new THREE.Mesh(geo(L, 0.16, 0.16), lineMat);
        l.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
        l.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
        l.visible = false;
        g.add(l);
        g.userData.lines.push(l);
      }
      gazeRoot.add(g);
      F.con = g;
      F.next = F.t;
    }
    if (F.con && F.shown < F.con.userData.stars.length && F.t >= F.next) {
      F.con.userData.stars[F.shown].visible = true;
      F.shown++;
      F.next = F.t + 0.7;
      sfx('twinkle');
      if (F.shown === F.con.userData.stars.length) { F.done = true; F.con.userData.lines.forEach((l) => { l.visible = true; }); funBar('Those stars look familiar… tap the sky', 'Stand up'); }
    }
    if (F.done && !F.named) lineMat.opacity = 0.35 + Math.sin(F.t * 3) * 0.25;
    // shooting stars
    F.nextShoot -= dt;
    if (!F.shooting && F.nextShoot <= 0) {
      const m = new THREE.Mesh(geo(4, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false, depthWrite: false }));
      const y = rand(10, 24), x = rand(-30, 10);
      m.position.set(x, y, -65);
      m.rotation.z = -0.35;
      gazeRoot.add(m);
      F.shooting = { m, t: 0 };
      F.nextShoot = rand(9, 16);
    }
    if (F.shooting) {
      const sh = F.shooting;
      sh.t += dt;
      sh.m.position.x += dt * 38;
      sh.m.position.y -= dt * 14;
      sh.m.material.opacity = Math.max(0, 1 - sh.t / 1.3);
      if (sh.t > 1.3) { gazeRoot.remove(sh.m); F.shooting = null; }
    }
  }
  function gazeTap() {
    const F = fun;
    if (F.shooting && !F.wished) {
      F.wished = true;
      addCoins(5, player.root.position.clone().add(new V3(0, 1, 0)));
      toast('🌠 You made a wish!');
      sfx('find');
      return;
    }
    if (!F.done || F.named) return;
    F.named = true;
    lineMat.opacity = 0.7;
    const d = F.dog;
    const names = state.starNames = state.starNames || {};
    progress('stars');
    if (names[d.id]) { toast(fill(pick(D.STAR_AGAIN), { dog: d.name }) + ' ✨'); funBar(`${d.name}’s stars ✨`, 'Stand up'); return; }
    toast(fill(pick(D.STAR_LINES), { dog: d.name }));
    setTimeout(() => {
      if (fun !== F) return;
      confirmBox('Name a star?', `The brightest star in these is now free to name. Call it “${d.name}’s Star”? It stays up there for good.`, 'Name it', true, () => {
        names[d.id] = { gd: clockNow.gameDay, loc: place === 'park' ? loc : 'home' };
        state.stats.starsNamed = (state.stats.starsNamed || 0) + 1;
        journalAdd(d, 'star', '⭐', `Has a star named after them, spotted from ${place === 'park' ? LOC().name : 'your garden'}`);
        news({ title: `${d.name}’s Star`, text: `There’s a star named after ${d.name} now. Look for the brightest one in the dog-shaped stars on a clear night.`, th: TH('pic', '⭐') });
        sfx('unlock');
        if (d.ui) refreshCardStatic(d);
        funBar(`${d.name}’s Star ⭐`, 'Stand up');
        save();
      });
    }, 900);
  }
  function gazeCamera(dt) {
    const want = fun && fun.kind === 'gaze' ? 1 : 0;
    gazeK = clamp(gazeK + (want ? dt * 0.8 : -dt * 1.6), 0, 1);
    gazeRoot.visible = gazeK > 0.5;
    if (starField) starMat.opacity = clamp((gazeK - 0.5) * 2, 0, 1) * clamp((nightLevel - 0.4) * 2, 0, 1);
    if (gazeK <= 0) return;
    const p = player.root.position, e = gazeK * gazeK * (3 - 2 * gazeK);
    const gp = new V3(p.x, p.y + 1.1, p.z + 1.2), gl = new V3(p.x, p.y + 8, p.z - 9);
    camera.position.lerp(gp, e);
    const look = camLook.clone().lerp(gl, e);
    camera.lookAt(look);
  }

  // =====================================================================
  // Music: play the piano or the guitar, and watch how each dog reacts
  // =====================================================================
  const KEYS = [60, 62, 64, 67, 69, 72, 74, 76];
  const KEY_COLS = ['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#29b6f6', '#5c6bc0', '#ab47bc', '#ec407a'];
  function musicStyle(d) {
    if (D.HOWL_BREEDS.includes(d.breed)) return 'howl';
    const h = hashStr(d.id + '|music') % 10;
    return D.MUSIC_STYLE[h < 8 || !d.revealed ? d.traits[0] : d.traits[1]] || 'tilt';
  }
  function startMusic(f) {
    if (fun) endFun('switch');
    const kind = f.type === 'guitar' ? 'guitar' : 'piano';
    const c = tileCenter(f), pp = player.root.position;
    player.face = Math.atan2(c.x - pp.x, c.z - pp.z);
    let tool = null, hid = [];
    if (kind === 'guitar') {
      // sit on the little stool and take the guitar off its stand
      const seat = homeSeat(Object.assign({}, f, { type: 'chair' }));
      const F2 = seatFrame(seat);
      const p = F2.at(0, 0.22);
      const stand = pp.clone();
      player.root.position.set(p.x, 0, p.z);
      player.face = F2.face;
      setPose('guitar', { y: 0.38, at: stand });
      const r = furnRT.get(f);
      if (r) r.group.traverse((o) => { if (o.userData.gtr) { o.visible = false; hid.push(o); } });
      tool = ART.buildTool('guitar');
      tool.position.set(0.02, 0.62, 0.2);
      tool.rotation.set(0.1, 0, 1.2);
      player.body.add(tool);
    } else {
      // stand at the keys
      const fr = frontOf(f);
      if (fr && flatDist(fr, pp) > 0.3) player.root.position.set(fr.x, 0, fr.z);
      player.face = Math.atan2(c.x - player.root.position.x, c.z - player.root.position.z);
      setPose('piano');
    }
    fun = { kind: 'music', still: true, inst: kind, f, notes: 0, songs: 0, reacted: new Map(), t: 0, onBtn: () => endFun('done') };
    fun.end = () => { if (tool && tool.parent) tool.parent.remove(tool); hid.forEach((o) => { o.visible = true; }); $('keys').classList.add('hidden'); document.body.classList.remove('keysOn'); };
    $('keysTitle').textContent = kind === 'guitar' ? '🎸 Guitar' : '🎹 Piano';
    $('keyRow').innerHTML = KEYS.map((n, i) => `<button class="key" data-key="${i}" style="--kc:${KEY_COLS[i]}"><span></span></button>`).join('');
    $('keys').classList.remove('hidden');
    document.body.classList.add('keysOn');
    funBarOff();
    tip('music', { title: 'Play some music', text: 'Tap the keys to play. After a little tune your dogs react, each in its own way. Some even learn to sing along.', icon: 'note' });
  }
  $('keyRow').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-key]');
    if (!b || !fun || fun.kind !== 'music') return;
    e.preventDefault();
    b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
    playKey(+b.dataset.key);
  });
  $('keysDone').addEventListener('click', () => endFun('done'));
  function playKey(i) {
    const F = fun;
    playNote(KEYS[i], F.inst);
    if (player.pose) { if (F.inst === 'guitar') player.pose.strum = 0.3; else player.pose.keys = 0.3; }
    const at = tileCenter(F.f).add(new V3(rand(-0.3, 0.3), 1.3, rand(-0.3, 0.3)));
    if (F.notes % 2 === 0) spawnEmoji(pick(['🎵', '🎶']), at, { size: 0.35, life: 1.2 });
    F.notes++;
    if (F.notes % 8 === 0) musicSong();
  }
  // a little tune is done: the dogs nearby react
  function musicSong() {
    const F = fun;
    F.songs++;
    progress('music');
    const pp = player.root.position;
    const near = dogs.filter((d) => d.root.position.distanceTo(pp) < 9 && !['bath', 'eat', 'drink'].includes(d.state));
    for (const d of near) d.happy = Math.min(100, d.happy + 4);
    near.forEach((d, i) => {
      const style = musicStyle(d);
      const first = !F.reacted.has(d);
      F.reacted.set(d, style);
      if (style === 'howl') {
        d.life.songs = (d.life.songs || 0) + 1;
        if (d.life.songs >= D.SING_SONGS && !(d.tricks.sing > 0)) setTimeout(() => learnSing(d), 2200);
      }
      if (!first && !(d.state === 'act' && d.act && d.act.music)) { /* keeps doing its thing */ }
      if (first || !(d.state === 'act' && d.act && d.act.music)) setTimeout(() => { if (fun === F) musicReact(d, style, i === 0 && first); }, 300 + i * 700);
      else if (style === 'howl') { sfx('howl'); spawnEmoji('🎵', d.headWorld(0.4), { size: 0.4 }); }
    });
  }
  function musicReact(d, style, say) {
    const F = fun, R = D.MUSIC_REACT[style];
    const pp = player.root.position;
    let target = null, pose = 'sit';
    const ang = rand(0, TAU);
    switch (style) {
      case 'howl': target = freePoint(pp.x, pp.z, 1.2, 2.2) || d.root.position.clone(); pose = 'howl'; break;
      case 'knee': { const f = player.face; target = new V3(pp.x + Math.sin(f) * 0.62, 0, pp.z + Math.cos(f) * 0.62); if (isSolid(target.x, target.z)) target = freePoint(pp.x, pp.z, 0.6, 1) || d.root.position.clone(); pose = 'knee'; break; }
      case 'hide': { const bed = findFurniture('bed', d, false, d.root.position); target = bed ? tileCenter(bed) : (freePoint(pp.x, pp.z, 3, 6) || d.root.position.clone()); pose = 'hide'; break; }
      case 'dance': target = d.root.position.distanceTo(pp) > 3 ? (freePoint(pp.x, pp.z, 1.5, 2.6) || d.root.position.clone()) : d.root.position.clone(); pose = 'dance'; break;
      default: target = d.root.position.distanceTo(pp) > 3.5 ? (freePoint(pp.x, pp.z, 1.5, 2.8) || d.root.position.clone()) : d.root.position.clone(); pose = 'tilt'; break;
    }
    void ang;
    let t = 0, there = false;
    d.doAct('none', (dt) => {
      if (fun !== F && style !== 'hide') return false;
      t += dt;
      if (!there) {
        if (d.stepTo(target.x, target.z, style === 'hide' ? 3.4 : 2.4, dt) > 0.3 && t < 6) return true;
        there = true;
        if (style !== 'hide') d.faceTo(pp); else d.face = rand(0, TAU);
        if (style === 'knee') d.faceTo(pp);
        d.act.pose = pose;
        if (style === 'howl') sfx('howl');
        spawnEmoji(R.ic, d.headWorld(0.4), { size: 0.4 });
        if (say) toast(fill(R.tx, { dog: d.name }));
        journalAdd(d, 'music:' + style, '🎶', { howl: 'Howled along to your music', knee: 'Rested its head on your knee while you played', hide: 'Hid under the bed when you played music', dance: 'Bounced around to your music', tilt: 'Listened to you play, head tilted' }[style]);
      }
      if (style === 'howl' && Math.random() < dt * 0.5) spawnEmoji('🎵', d.headWorld(0.4), { size: 0.3 });
      // the shy ones come out again once it's quiet
      if (style === 'hide') return fun === F || t < 12;
      return true;
    }, { howl: 'Singing along 🎵', knee: 'Listening 🥰', hide: 'Hiding from the music 🙈', dance: 'Dancing 🎶', tilt: 'Listening 🎶' }[style]);
    d.act.music = true;
    if (style === 'hide') d.act.keep = true;
  }
  function learnSing(d) {
    if (d.tricks.sing > 0) return;
    d.tricks.sing = D.TRICK_XP[1];
    if (!state.learned.includes('sing')) state.learned.push('sing');
    journalAdd(d, 'trick:sing', '🎤', 'Learned a new trick: Sing along');
    news({ title: 'New trick: Sing along', text: `${d.name} has howled along so often that it’s now a trick. Practice it in Trick Mode: circle, then swipe up.`, th: TH('pic', '🎤') });
    sfx('unlock');
    if (d.ui) refreshCardStatic(d);
    save();
  }

  // =====================================================================
  // Let your dog lead: it picks where the walk goes, by personality
  // =====================================================================
  function leadStop(kind, d, used) {
    const pos = d.root.position;
    const far = (p, r = 34) => p && flatDist(p, pos) < r && !used.some((u) => flatDist(u, p) < 3);
    switch (kind) {
      case 'hidden': {
        const left = (S.secrets || []).filter((x) => !hiddenOf(loc).includes(x.id) && !x.high);
        const pts = left.map((x) => { const r = x.rects[0]; return new V3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2); }).filter((p) => !isSolid(p.x, p.z));
        pts.sort((a, b) => flatDist(a, pos) - flatDist(b, pos));
        return pts[0] && far(pts[0], 60) ? { kind, p: pts[0] } : null;
      }
      case 'unexplored': {
        if (!S.bbox) return null;
        const G = exploreGrid();
        let best = null, bd = 40;
        for (let k = 0; k < 160; k++) {
          const i = Math.floor(Math.random() * G.w), j = Math.floor(Math.random() * G.h);
          if (isExplored(loc, G, i, j)) continue;
          const x = G.x0 + i * 2 + 1, z = G.z0 + j * 2 + 1;
          if (isSolid(x, z) || !S.inside(x, z) || inPond(x, z, 0.5)) continue;
          const dd = Math.hypot(x - pos.x, z - pos.z);
          if (dd < bd && dd > 6) { bd = dd; best = new V3(x, 0, z); }
        }
        return far(best, 41) ? { kind, p: best } : null;
      }
      case 'sniff': { const s = nearestSpot(pos, 20, true); return s && far(s.pos) ? { kind, p: s.pos.clone(), spot: s } : null; }
      case 'dig': { const p = freePoint(pos.x, pos.z, 5, 11, (x, z) => !onPath(x, z) && !inPond(x, z, 1)); return far(p) ? { kind, p } : null; }
      case 'water': { const e = pondEdge(pos); return e && far(e, 30) ? { kind, p: e } : null; }
      case 'bench': {
        let best = null, bd = 32;
        for (const s of S.seats || []) { const p = seatFrame(s).at(0, 0.95); const dd = flatDist(p, pos); if (dd < bd && !isSolid(p.x, p.z)) { bd = dd; best = { kind, p, seat: s }; } }
        return best;
      }
      case 'vendor': { const v = (S.vendors || []).slice().sort((a, b) => flatDist(a.front, pos) - flatDist(b.front, pos))[0]; return v && far(v.front, 34) ? { kind, p: v.front.clone() } : null; }
      case 'friend': { const w = walkers.filter((x) => !x.visit && !x.meet).sort((a, b) => flatDist(a.parts.root.position, pos) - flatDist(b.parts.root.position, pos))[0]; return w && far(w.parts.root.position, 30) ? { kind, w, p: w.parts.root.position.clone() } : null; }
      case 'far': { const p = freePoint(pos.x, pos.z, 11, 18, (x, z) => Math.abs(groundAt(x, z) - groundAt(pos.x, pos.z)) < 1.2); return far(p, 30) ? { kind, p } : null; }
      case 'hunt': { const h = hunt.filter((x) => !x.e.task.night || isNight()).sort((a, b) => flatDist(a.pos, pos) - flatDist(b.pos, pos))[0]; return h && far(h.pos, 30) ? { kind, p: h.pos.clone() } : null; }
      default: return null;
    }
  }
  function startLead(d) {
    if (!needRank('lead') || !d) return;
    if (place !== 'park') { toast('Your dog can lead the way on walks'); return; }
    if (fun) endFun('switch');
    const order = (D.LEAD[d.traits[0]] || ['sniff']).concat(d.revealed ? (D.LEAD[d.traits[1]] || []).slice(0, 1) : []);
    // an event hunt is on? the nose knows
    if (hunt.some((x) => !x.e.task.night || isNight())) order.splice(1, 0, 'hunt');
    // in its favorite place, a dog knows where it wants to go
    const fav = favOf(d.life && d.life.walks);
    if (fav === loc) order.unshift('hidden');
    fun = { kind: 'lead', dog: d, order, i: 0, stop: null, used: [], t: 0, wait: 0, done: [], onBtn: () => { toast('You take the lead again 🦮'); endFun('done'); } };
    d.free = true;
    d.doAct('none', (dt) => leadDog(d, dt), `Leading the way 🐾`);
    funBar(`${d.name} is leading the way. Follow!`, 'Take the lead');
    leadNext();
    tip('leading', { title: `${d.name} leads`, text: 'You follow wherever your dog wants to go: each personality has its favorite kinds of places. Move yourself to take the lead again.', icon: 'lead' });
  }
  function leadNext() {
    const F = fun, d = F.dog;
    F.stop = null;
    while (F.i < F.order.length && !F.stop) {
      const s = leadStop(F.order[F.i], d, F.used);
      F.i++;
      if (s) F.stop = s;
    }
    if (!F.stop) { leadFinish(); return; }
    F.used.push(F.stop.p.clone());
    F.t = 0; F.wait = 0;
    F.stop.phase = 'go';
    toast(fill(D.LEAD_SAY[F.stop.kind], { dog: d.name }));
    spawnEmoji(F.stop.kind === 'hunt' ? '👃' : '❗', d.headWorld(0.4), { size: 0.4 });
  }
  function leadDog(d, dt) {
    const F = fun;
    if (!F || F.kind !== 'lead' || F.dog !== d) return false;
    const st = F.stop;
    if (!st) return true;
    F.t += dt;
    const pp = player.root.position, pos = d.root.position;
    if (st.phase === 'go') {
      // too far ahead? wait and look back
      if (flatDist(pos, pp) > 6) { d.faceTo(pp); d.act.pose = 'sit'; F.wait += dt; if (F.wait > 12) { F.wait = 0; leadNext(); } return true; }
      d.act.pose = 'none';
      const tgt = st.kind === 'friend' && st.w ? st.w.parts.root.position : st.p;
      const left = d.stepTo(tgt.x, tgt.z, st.kind === 'far' || d.flag('zooms') ? 3.6 : 2.5, dt);
      if (left < (st.kind === 'friend' ? 1.6 : 0.6) || F.t > 30) { st.phase = 'do'; F.t = 0; leadArrive(d, st); }
      return true;
    }
    if (st.phase === 'do') {
      if (F.t > (st.dur || 2.2)) { F.done.push(st.kind); leadNext(); }
      return true;
    }
    return true;
  }
  function leadArrive(d, st) {
    const A = d.act;
    switch (st.kind) {
      case 'sniff': A.pose = 'sniff'; st.dur = 2.2; if (st.spot && !st.spot.taken && st.spot.cooldown <= 0) setTimeout(() => { if (fun && fun.kind === 'lead') { d.spot = st.spot; st.spot.taken = d; d.finishSniff(); d.setState('act'); } }, 1800); break;
      case 'dig': A.pose = 'dig'; st.dur = 2.4; setTimeout(() => { if (fun && fun.kind === 'lead') { const r = Math.random(); if (r < 0.35) addCoins(1 + Math.floor(Math.random() * 3), d.root.position); else spawnEmoji('🕳️', d.headWorld(-0.2), { size: 0.35 }); } }, 2000); break;
      case 'water': A.pose = 'hop'; st.dur = 2; d.wetT = 40; for (let k = 0; k < 4; k++) setTimeout(() => spawnEmoji('💦', d.headWorld(0), { size: 0.3 }), k * 300); if (d.flag('splashes')) addDirt(d, walkDirt(), 1); break;
      case 'vendor': A.pose = 'beg'; st.dur = 2.6; spawnEmoji('🥺', d.headWorld(0.35), { size: 0.4 }); break;
      case 'friend': A.pose = 'hop'; st.dur = 2.5; spawnEmoji('💕', d.headWorld(0.35), { size: 0.4 }); if (st.w) { addFriendship(d, st.w.dog, 2); st.w.pause = Math.max(st.w.pause, 3); } break;
      case 'bench': {
        // the lazy ones want a sit: you sit down too, and that's the end of the lead
        F_benchSit(d, st);
        return;
      }
      case 'hunt': A.pose = 'sniff'; st.dur = 1.5; break;
      default: A.pose = 'sit'; st.dur = 1.6; spawnEmoji('👀', d.headWorld(0.35), { size: 0.35 }); break;
    }
  }
  function F_benchSit(d, st) {
    const F = fun;
    leadRewards(F, 'bench');
    toast(`${d.name} flops down by the bench. Time for a sit!`);
    endFun('done');
    sitDown(st.seat);
  }
  function leadRewards(F, last) {
    const d = F.dog;
    progress('lead');
    d.happy = Math.min(100, d.happy + 14);
    d.addBond(3);
    addMastery(loc, 10);
    const words = { hidden: 'a hidden spot', unexplored: 'somewhere new', sniff: 'a great sniffing spot', water: 'the water', bench: 'a bench for a rest', vendor: 'the snack stand', friend: 'a friend', far: 'the far side', dig: 'a digging spot', hunt: 'something hidden' };
    const best = F.done.concat(last ? [last] : []).find((k) => k === 'hidden' || k === 'unexplored') || last || F.done[0];
    journalAdd(d, 'lead:' + loc, '🦮', `Led you to ${words[best] || 'a few favorite spots'} in ${LOC().name}`);
    save();
  }
  function leadFinish() {
    const F = fun, d = F.dog;
    leadRewards(F, null);
    toast(`${d.name} is done leading. What a walk! 🐾`);
    spawnEmoji('💕', d.headWorld(0.4), { size: 0.45 });
    endFun('done');
  }
  function leadUpdate(dt) {
    const F = fun, d = F.dog;
    // you follow a couple of steps behind
    F.follow = (F.follow || 0) - dt;
    if (F.follow <= 0) {
      F.follow = 0.4;
      const pp = player.root.position, dp = d.root.position;
      const dd = flatDist(pp, dp);
      if (dd > 1.8) player.moveTarget = new V3(dp.x - (dp.x - pp.x) / dd * 1.4, 0, dp.z - (dp.z - pp.z) / dd * 1.4);
      else player.moveTarget = null;
    }
  }

  // =====================================================================
  // The play sheet: everything you can do with a dog, in one place
  // =====================================================================
  let playDog = null;
  function openPlay(d) {
    playDog = d;
    renderPlay();
    $('playSheet').classList.remove('hidden');
  }
  function renderPlay() {
    const d = playDog;
    if (!d) return;
    $('playTitle').textContent = `Things to do with ${d.name}`;
    const lock = (f) => (unlockedFeat(f) ? '' : `Opens at rank ${featRank(f)}`);
    const row = (act, ic, name, sub, lk, off) => `<button class="row playRow${lk || off ? ' locked' : ''}" ${lk || off ? 'disabled' : ''} data-play="${act}"><div class="ic">${IC(lk ? 'lock' : ic)}</div><div class="txt"><b>${esc(name)}</b><small>${esc(lk || off || sub)}</small></div></button>`;
    const info = (ic, name, sub, lk) => `<div class="row playRow info${lk ? ' locked' : ''}"><div class="ic">${IC(lk ? 'lock' : ic)}</div><div class="txt"><b>${esc(name)}</b><small>${esc(lk || sub)}</small></div></div>`;
    const kind = pileKind();
    const walk = place === 'park';
    $('playList').innerHTML =
      row('seek', 'hide', 'Hide and seek: you hide', 'Your dogs count, then come looking for you', lock('hideseek')) +
      row('hide', 'search', `Hide and seek: ${d.name} hides`, 'You cover your eyes, then go looking', lock('hideseek')) +
      row('brush', 'brush', `Brush ${d.name}`, d.fluffed ? 'Already lovely and fluffy, but dogs never say no' : 'A fluffy coat, and a happy dog', lock('brush')) +
      row('lead', 'lead', `Let ${d.name} lead`, 'Follow your dog wherever it wants to go', lock('lead'), walk ? '' : 'On walks only') +
      row('flakes', 'snow', 'Catch snowflakes', `Tap big snowflakes as they fall and ${d.name} jumps for them`, lock('winter'), flakesNow() ? '' : 'When it’s snowing') +
      row('course', 'flag', 'Agility course', (() => { const n = homeCourse().list.length; return n >= 3 ? `${n} obstacles at home · set the order and run it` : `Place 3 obstacles or more at home (Shop → Agility). You have ${n}`; })(), lock('agility'), walk ? 'At home (or at the Tournament Grounds)' : '') +
      '<div class="section">More to try</div>' +
      info('seat', 'Sit down', 'Tap a sofa, chair, dog bed or rug at home, or stand by a bench on a walk') +
      info('note', 'Play music', 'Tap a piano or a guitar at home') +
      info('rake', 'Leaf and snow piles', kind ? `It’s ${kind === 'snow' ? 'snowy' : 'autumn'}: look for ${kind === 'snow' ? 'snow' : 'leaves'} on the ground and rake a pile` : 'In autumn and winter (always in the Snowy Village)', lock('piles')) +
      info('stone', 'Skipping stones', 'Stand by a pond, a lake or the sea on a walk', lock('stones')) +
      info('star', 'Stargazing', 'On a clear night, on a walk or in your garden', lock('stars')) +
      info('sprout', 'Growing plants', hasGadget('hoe') ? 'Stand on garden ground and tap Dig a bed, then plant seeds' : 'Buy a hoe and seeds in the shop, then dig beds in a garden', lock('farming')) +
      info('wave', 'Feeding ducks', 'Stand by a pond with ducks on a walk', lock('ducks')) +
      info('brush', 'Painting', 'Tap an easel at home (from the shop)', lock('painting')) +
      info('chat', 'Letters', 'Tap your mailbox at home', lock('letters')) +
      info('search', 'Messages in bottles', 'Look along the shore at the beach', lock('bottles')) +
      info('flag', 'Tournaments', locUnlocked('grounds') ? `At the Tournament Grounds on the ${D.TOURNEY.days.join('th and ')}th of each month` : 'At the Tournament Grounds, once you’ve found them') +
      info('dog', 'Dog sitting', 'Neighbors who know you well sometimes ask by letter', lock('sitting')) +
      info('snowman', 'Snowmen and snow dogs', 'When there’s snow on the ground, on walks or in your garden', lock('winter')) +
      info('fish', 'Fishing', hasGadget('rod') ? 'Walk to the end of the pier at the beach' : 'Buy a fishing rod (Shop → Gadgets), then go to the pier at the beach', lock('fishing')) +
      info('net', 'Catching critters', hasGadget('net') ? 'Look for critters on walks. Your catches can live in your garden (Bag → Critters)' : 'Buy a critter net (Shop → Gadgets)', lock('catching')) +
      info('oven', 'Baking', 'Tap a baking oven at home (Shop → Kitchen). Treats come from your harvest', lock('baking')) +
      info('search', 'Neighbor favors', 'Look for a neighbor with an exclamation mark over their head on your walks', lock('favors')) +
      info('stall', 'Market stall', 'In Old Town, every Saturday and Sunday', lock('market')) +
      info('museum', 'Town museum', 'The building with the columns in Old Town', lock('museum')) +
      info('disc', 'Disc dog', state.toys.includes('frisbee') ? 'The blue mat at the beach · Disc Cup on the 14th' : 'Get a frisbee at the beach kiosk, then use the blue mat · Disc Cup on the 14th', lock('disc')) +
      info('paper', 'The Gazette', 'Every Monday in your mailbox', lock('gazette'));
  }
  $('playList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-play]');
    if (!b || b.disabled || !playDog) return;
    const d = playDog;
    $('playSheet').classList.add('hidden');
    for (const x of dogs) if (x.ui && x.ui.open) { x.ui.open = false; x.ui.el.classList.remove('open'); }
    document.body.classList.remove('cardOpen');
    switch (b.dataset.play) {
      case 'seek': startSeek(); break;
      case 'hide': startHide(d); break;
      case 'brush': startBrush(d); break;
      case 'lead': startLead(d); break;
      case 'course': if (place === 'home') openCourse(); else toast('Your course is at home. Here, stand on a ring’s red start mat'); break;
      case 'flakes': startFlakes(); break;
      default: break;
    }
  });
  $('playClose').addEventListener('click', () => $('playSheet').classList.add('hidden'));

  // =====================================================================
  // Glue: the context button, taps, the per-frame update
  // =====================================================================
  // what the extra button offers right now, if anything
  function funCtx() {
    if (fun || mode !== 'normal' || visit || title) return null;
    const pp = player.root.position;
    const hc = hobbyCtx(pp) || round3Ctx(pp);
    if (hc) return hc;
    if (unlockedFeat('piles') && patches.length && nearPatch(pp, 2.2)) return patches[0].kind === 'snow' ? 'shovel' : 'rake';
    if (place === 'park') {
      if (nearestSeat(pp)) return 'sit';
      if (unlockedFeat('stones') && waterNear(pp)) return 'skip';
    }
    if (canGaze()) return 'stars';
    return null;
  }
  function funTapDog(d) {
    if (!fun) return false;
    if (fun.kind === 'hide' && fun.dog === d && fun.phase === 'hidden') { hideFound(); return true; }
    if (d.state === 'act') { spawnEmoji('❤️', d.headWorld(0.35), { size: 0.4 }); sfx('pet'); d.addBond(0); return true; }
    return false;
  }
  function funTap() {
    if (!fun) return false;
    if (fun.kind === 'gaze') { gazeTap(); return true; }
    if (fun.kind === 'flakes') return flakesTap();
    if (fun.kind === 'fish' || fun.kind === 'disc') return true;
    if (fun.kind === 'brush' || fun.kind === 'music' || (fun.kind === 'hide' && fun.phase === 'count')) return true;
    return false;
  }
  function funUpdate(dt) {
    updateRipples(dt);
    updatePlayerWet(dt);
    if (!fun) return;
    switch (fun.kind) {
      case 'sit': sitTick(dt); break;
      case 'seek': seekUpdate(dt); break;
      case 'hide': hideUpdate(dt); break;
      case 'rake': rakeUpdate(dt); break;
      case 'skip': skipUpdate(dt); break;
      case 'gaze': gazeUpdate(dt); break;
      case 'lead': leadUpdate(dt); break;
      default: break;
    }
  }


  // =====================================================================
  // Hobbies, part 1: the vegetable and flower garden (dig a bed, plant, water, pick)
  // =====================================================================
  const bedGroup = pivot(homeRoot);
  const bedsOf = () => (state.beds = Array.isArray(state.beds) ? state.beds : []);
  const bedAt = (i, j) => bedsOf().find((b) => b.i === i && b.j === j);
  const rainingHome = () => !visit && curWeather().precip === 'rain';
  function renderBeds() {
    bedGroup.clear();
    if (visit) return;
    const now = Date.now();
    for (const b of bedsOf()) {
      const g = ART.buildBed(b.wet > now || (rainingHome() && !!b.seed));
      if (b.seed) g.add(ART.buildPlant(b.seed, b.stage, false));
      g.position.set(b.i + 0.5, 0, b.j + 0.5);
      g.userData.bed = b;
      bedGroup.add(g);
    }
  }
  // what the garden needs at the spot you stand on
  function bedSpot() {
    if (place !== 'home' || visit || !unlockedFeat('farming') || !hasGadget('hoe')) return null;
    const p = player.root.position, i = Math.floor(p.x), j = Math.floor(p.z);
    if (!isGardenTile(i, j) || bedAt(i, j) || furnitureAt(i, j) || state.clutter.some((c) => c.i === i && c.j === j)) return null;
    return { i, j };
  }
  function digBed() {
    const s = bedSpot();
    if (!s) return;
    if (bedsOf().length >= D.GARDEN.beds) { toast(`That’s ${D.GARDEN.beds} beds already. Plenty to look after!`); return; }
    state.beds.push({ i: s.i, j: s.j, seed: null, stage: 0, prog: 0, water: [], wet: 0, last: Date.now() });
    // step off the new bed
    sfx('scrub');
    for (let k = 0; k < 5; k++) setTimeout(() => spawnEmoji('🟫', new V3(s.i + 0.5 + rand(-0.3, 0.3), 0.3, s.j + 0.5 + rand(-0.3, 0.3)), { size: 0.22, life: 0.6, vy: 1.2 }), k * 90);
    renderBeds();
    toast('A fresh bed, ready to plant 🌱 Tap it to plant seeds');
    tip('beds', { title: 'Your garden beds', text: 'Tap a bed to plant seeds. Plants grow in five stages over a few hours, even while you’re away. Water them (or let it rain): watered plants grow faster and give more. Pick them when they’re ready, or they drop their crop and start over.', icon: 'sprout' });
    save();
  }
  // plants grow in real time; water makes a stage go 1.5x as fast and adds to the harvest
  function growBeds(now = Date.now()) {
    let changed = false;
    const rain = rainingHome();
    for (const b of bedsOf()) {
      if (!b.seed) { b.last = now; continue; }
      const S = D.SEEDS[b.seed];
      if (!S) { b.seed = null; continue; }
      const last = b.last || now, el = Math.max(0, (now - last) / 60000);
      b.last = now;
      if (rain) { b.wet = Math.max(b.wet || 0, now + D.GARDEN.moist * 60000); if (!b.water[b.stage]) { b.water[b.stage] = 1; changed = true; } }
      const wetMin = clamp(((b.wet || 0) - last) / 60000, 0, el);
      b.prog = (b.prog || 0) + wetMin * 1.5 + (el - wetMin);
      while (b.prog >= S.stage && b.stage < 4) { b.prog -= S.stage; b.stage++; changed = true; if ((b.wet || 0) > now) b.water[b.stage] = 1; }
      // left ripe too long: a crop drops its fruit and starts over from a sprout (flowers just keep blooming)
      if (b.stage >= 4 && !S.flower && b.prog > S.stage * D.GARDEN.ripeKeep) {
        b.stage = 1; b.prog = 0; b.water = []; b.dropped = (b.dropped || 0) + 1; changed = true;
        if (place === 'home') toast(`${S.icon} The ${D.INGREDIENTS[S.crop].name.toLowerCase()} were left too long and fell off. The plant is growing again`);
      }
      if (b.stage >= 4 && S.flower) b.prog = Math.min(b.prog, S.stage);
    }
    if (changed) { renderBeds(); computeComfort(); }
    return changed;
  }
  // tapping a bed: walk over, then the bed sheet
  function tapBed(ray, gp) {
    if (place !== 'home' || visit || !bedsOf().length || viewFloor() === 1) return null;
    const hits = ray.intersectObjects(bedGroup.children, true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.bed) o = o.parent; if (o) return o.userData.bed; }
    if (gp) return bedAt(Math.floor(gp.x), Math.floor(gp.z)) || null;
    return null;
  }
  let bedOpen = null;
  function openBed(b) {
    bedOpen = b;
    growBeds();
    renderBedSheet();
    $('bedSheet').classList.remove('hidden');
  }
  function bedLeft(b) {
    const S = D.SEEDS[b.seed];
    if (!S || b.stage >= 4) return '';
    const wet = (b.wet || 0) > Date.now();
    const min = Math.max(1, Math.round((S.stage - (b.prog || 0)) / (wet ? 1.5 : 1)));
    return min >= 60 ? `about ${Math.round(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}` : `about ${min} min`;
  }
  function renderBedSheet() {
    const b = bedOpen;
    if (!b) return;
    const S = D.SEEDS[b.seed];
    const wet = (b.wet || 0) > Date.now() || rainingHome();
    const can = hasGadget('wateringcan');
    let h = '';
    if (!S) {
      $('bedTitle').textContent = 'An empty bed';
      const have = Object.entries(state.seeds || {}).filter(([k, n]) => n > 0 && D.SEEDS[k]);
      h += `<p class="sub">${have.length ? 'Pick something to plant:' : 'You have no seeds. The shop sells them (Menu → Shop → Garden), and neighbors sometimes send some.'}</p>`;
      h += `<div class="wardGrid">${have.map(([k, n]) => `<button class="ward" data-bed="plant" data-k="${k}">${TH('pic', D.SEEDS[k].icon)}<small>${esc(D.SEEDS[k].name)}</small><b>×${n}</b></button>`).join('')}</div>`;
      h += `<div class="btnRow"><button class="soft" data-bed="remove">Fill the bed in</button></div>`;
    } else {
      const ripe = b.stage >= 4;
      const watered = (b.water || []).filter(Boolean).length;
      $('bedTitle').textContent = `${S.icon} ${S.flower ? S.name.replace(/ (seeds|bulbs|cuttings)$/, '') : D.INGREDIENTS[S.crop].name}`;
      h += `<div class="bedStages">${D.STAGE_NAMES.map((n, k) => `<span class="${k < b.stage ? 'done' : k === b.stage ? 'now' : ''}${b.water && b.water[k] ? ' wet' : ''}" title="${esc(n)}"></span>`).join('')}</div>`;
      h += `<p class="sub"><b>${esc(D.STAGE_NAMES[b.stage])}</b>${ripe ? '' : ` · next stage in ${bedLeft(b)}`}<br>${wet ? '💧 The soil is wet: growing 1.5× as fast.' : 'The soil is dry.'} Watered at ${watered} of 5 stages${S.flower ? '' : ' (more water, a bigger harvest)'}.</p>`;
      h += '<div class="btnRow">';
      if (!ripe) h += `<button class="soft" data-bed="water" ${can && !wet ? '' : 'disabled'}>${can ? (wet ? 'Still wet' : '🚿 Water') : '🚿 Needs a watering can'}</button>`;
      if (ripe) h += `<button class="primary" data-bed="pick">${S.flower ? '💐 Pick a bouquet' : '🧺 Harvest'}</button>`;
      if (ripe && S.flower) h += `<button class="soft" data-bed="leave">Leave them blooming</button>`;
      h += `<button class="soft danger" data-bed="pull">Pull it up</button></div>`;
    }
    $('bedBody').innerHTML = h;
  }
  $('bedBody').addEventListener('click', (e) => {
    const t = e.target.closest('[data-bed]');
    if (!t || t.disabled || !bedOpen) return;
    const b = bedOpen, act = t.dataset.bed;
    if (act === 'plant') {
      const k = t.dataset.k;
      if (!(state.seeds[k] > 0)) return;
      state.seeds[k]--;
      Object.assign(b, { seed: k, stage: 0, prog: 0, water: [], last: Date.now(), dropped: 0 });
      if ((b.wet || 0) > Date.now()) b.water[0] = 1;
      progress('plant');
      sfx('pet');
      toast(`Planted ${D.SEEDS[k].name.toLowerCase()} 🌱`);
    } else if (act === 'water') {
      waterBed(b);
    } else if (act === 'pick') {
      harvestBed(b);
    } else if (act === 'leave') {
      $('bedSheet').classList.add('hidden');
      return;
    } else if (act === 'pull') {
      Object.assign(b, { seed: null, stage: 0, prog: 0, water: [] });
      toast('Pulled it up. The bed is empty again');
    } else if (act === 'remove') {
      state.beds = bedsOf().filter((x) => x !== b);
      $('bedSheet').classList.add('hidden');
      renderBeds();
      save();
      return;
    }
    renderBeds();
    computeComfort();
    renderBedSheet();
    save();
  });
  $('bedClose').addEventListener('click', () => $('bedSheet').classList.add('hidden'));
  function waterBed(b) {
    if (!hasGadget('wateringcan')) return;
    b.wet = Date.now() + D.GARDEN.moist * 60000;
    b.water[b.stage] = 1;
    sfx('splash');
    for (let k = 0; k < 6; k++) setTimeout(() => spawnEmoji('💧', new V3(b.i + 0.5 + rand(-0.3, 0.3), 0.9, b.j + 0.5 + rand(-0.3, 0.3)), { size: 0.25, life: 0.6, vy: -1.2 }), k * 80);
    player.armR.rotation.x = -1.2;
    toast('Watered 💧 It grows faster while the soil is wet');
  }
  function harvestBed(b) {
    const S = D.SEEDS[b.seed];
    if (!S || b.stage < 4) return;
    const watered = (b.water || []).filter(Boolean).length;
    const at = new V3(b.i + 0.5, 0.8, b.j + 0.5);
    if (S.flower) {
      const n = 1 + (watered >= 3 ? 1 : 0);
      state.bouquets = (state.bouquets || 0) + n;
      Object.assign(b, { stage: 2, prog: 0, water: [] });
      toast(`💐 You picked ${n > 1 ? 'two bouquets' : 'a bouquet'}. ${n > 1 ? 'They' : 'It'} can go in a letter. The ${S.name.split(' ')[0].toLowerCase()} will bloom again`);
      spawnEmoji('💐', at, { size: 0.5 });
    } else {
      const n = S.yield[0] + Math.floor(Math.random() * (S.yield[1] - S.yield[0] + 1)) + watered;
      const key = b.seed;
      state.pantry[S.crop] = (state.pantry[S.crop] || 0) + n;
      Object.assign(b, { seed: null, stage: 0, prog: 0, water: [] });
      // usually a seed to plant again
      if (Math.random() < 0.6) state.seeds[key] = (state.seeds[key] || 0) + 1;
      state.stats.harvested = (state.stats.harvested || 0) + n;
      toast(`🧺 You picked ${n} ${D.INGREDIENTS[S.crop].icon} ${D.INGREDIENTS[S.crop].name.toLowerCase()}${watered >= 4 ? '. Well watered, a great harvest!' : ''}`);
      for (let k = 0; k < Math.min(n, 6); k++) setTimeout(() => spawnEmoji(D.INGREDIENTS[S.crop].icon, at.clone().add(new V3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3))), { size: 0.4 }), k * 120);
      // the dogs nearby are curious
      for (const d of dogs) if (d.root.position.distanceTo(at) < 4) { d.happy = Math.min(100, d.happy + 3); journalAdd(d, 'harvest1', '🧺', `Watched you pick the first ${D.INGREDIENTS[S.crop].name.toLowerCase()} from the garden`); }
    }
    progress('harvest');
    sfx('find');
    haptic();
  }
  // a digger finds the garden irresistible; a foodie keeps watch over ripe food
  function gardenDogIdea(d) {
    if (place !== 'home' || visit || !bedsOf().some((b) => b.seed)) return false;
    const ripe = bedsOf().filter((b) => b.seed && b.stage >= 3 && !D.SEEDS[b.seed].flower);
    if (d.flag('digs') && ripe.length && Math.random() < 0.05) {
      const b = pick(ripe);
      d.goTo(new V3(b.i + 0.5, 0, b.j + 1.2), 2, () => {
        d.setState('dig', 2);
        const S = D.SEEDS[b.seed];
        setTimeout(() => {
          if (!b.seed) return;
          state.pantry[S.crop] = (state.pantry[S.crop] || 0) + 1;
          Object.assign(b, { stage: 1, prog: 0, water: [] });
          renderBeds();
          toast(`${d.name} dug up a ${D.INGREDIENTS[S.crop].name.toLowerCase().replace(/s$/, '')} a bit early! ${S.icon}`);
          journalAdd(d, 'digcrop', '⛏️', `Dug up a ${D.INGREDIENTS[S.crop].name.toLowerCase().replace(/s$/, '')} from the garden, a bit too early`);
        }, 1800);
      }, 0.35);
      return true;
    }
    if (d.traits.includes('foodie') && ripe.length && Math.random() < 0.15) {
      const b = pick(ripe);
      d.goTo(new V3(b.i + 0.5, 0, b.j + 1.2), 1.6, () => { d.faceTo(new V3(b.i + 0.5, 0, b.j + 0.5)); d.setState('sit', rand(6, 10)); spawnEmoji('👀', d.headWorld(0.35), { size: 0.35 }); }, 0.35);
      return true;
    }
    return false;
  }

  // =====================================================================
  // Hobbies, part 2: agility (a course at home, and the rings and tournaments at the Tournament Grounds)
  // =====================================================================
  const agi = () => (state.agility = Object.assign({ best: {}, cls: 0, wins: [0, 0, 0], entered: -1, runs: 0, trophies: [] }, state.agility || {}));
  const ROT_ANG = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  // your course at home: every obstacle you placed, in the order you set
  function homeCourse() {
    const F = state.furniture.filter((f) => D.ITEMS[f.type] && D.ITEMS[f.type].agility);
    const order = (state.agility && state.agility.order) || [];
    F.sort((a, b) => { const ia = order.indexOf(a.i + ',' + a.j), ib = order.indexOf(b.i + ',' + b.j); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || state.furniture.indexOf(a) - state.furniture.indexOf(b); });
    const list = F.map((f) => [D.ITEMS[f.type].agility, f.i + 0.5, f.j + 0.5, ROT_ANG[f.rot || 0], f]);
    const key = 'home:' + list.map((o) => o[0] + o[1] + o[2] + o[3].toFixed(1)).join('|');
    return { id: key, name: 'Your course', list, par: Math.round(list.reduce((s, o) => s + D.OBSTACLES[o[0]].t + 2.2, 2)), home: true };
  }
  function groundsCourse(id) {
    const C = D.COURSES[id];
    return C && { id, name: C.name, list: C.list, par: C.par, cls: C.cls, start: C.start };
  }
  // how fast and how clean a dog runs
  function agilityStats(d) {
    let v = 4.2 * (d.flag('zooms') ? 1.2 : 1) * (d.flag('lounges') ? 0.82 : 1) * (d.isPuppy() ? 0.9 : 1) * (d.energy < 30 ? 0.8 : 1) * (d.hearts() >= 4 ? 1.05 : 1);
    if (d.specAs('athlete')) v *= 1 + 0.04 * d.specAs('athlete');
    const fault = clamp(0.22 - d.obedience() * 0.004 + (d.flag('zooms') ? 0.08 : 0) + (d.isPuppy() ? 0.06 : 0), 0.03, 0.4);
    return { v, fault };
  }
  function startAgility(course, opt = {}) {
    const d = opt.dog || selected || dogs[0];
    if (!d || !course.list.length) return;
    if (course.list.length < 3) { toast('Place at least 3 obstacles for a course (Shop → Agility)'); return; }
    if (d.energy < 15) { toast(`${d.name} is too tired for agility right now`); return; }
    if (fun) endFun('switch');
    const pp = player.root.position;
    // the way round: in front of each obstacle, through it, and out the other side
    const legs = [];
    let start = course.start ? new V3(course.start[0], 0, course.start[1]) : null;
    if (!start) { const [, x, z, r] = course.list[0]; start = new V3(x - Math.sin(r) * 2.2, 0, z - Math.cos(r) * 2.2); if (isSolid(start.x, start.z)) start = d.root.position.clone(); }
    for (const [kind, x, z, r] of course.list) {
      const len = kind === 'weave' || kind === 'tunnel' ? 0.75 : 0.6;
      legs.push({ kind, a: new V3(x - Math.sin(r) * len, 0, z - Math.cos(r) * len), c: new V3(x, 0, z), b: new V3(x + Math.sin(r) * len, 0, z + Math.cos(r) * len), r });
    }
    const st = agilityStats(d);
    // a pumpkin heart before the run: a little faster
    if (d.zoomTreat) { st.v *= 1.08; d.zoomTreat = false; toast(`${d.name} is full of pumpkin power 🧡`); }
    fun = { kind: 'agility', still: true, dog: d, course, legs, i: 0, phase: 'toStart', t: 0, faults: 0, tapped: null, start, st, opt, cue: 0, onBtn: () => agilityTap() };
    funBar(`Get ready… ${d.name} heads to the start`, 'Go!', 0);
    $('funMeter').classList.add('needle', 'cue');
    d.free = true;
    d.doAct('none', (dt) => agilityStep(d, dt), 'Running agility 🏁');
    player.face = Math.atan2(start.x - pp.x, start.z - pp.z);
    camFocus = { dog: d, t: 999 };
    fun.end = () => { camFocus = null; $('funMeter').classList.remove('cue'); };
    tip('agility', { title: 'Agility', text: 'As your dog runs up to each obstacle, a marker fills the bar. Tap Go! when it’s in the green: that tells your dog exactly when to take it. Too early or too late and it may knock a bar or run past.', icon: 'flag' });
  }
  function agilityTap() {
    const F = fun;
    if (!F || F.kind !== 'agility') return;
    if (F.phase === 'done') { endFun('done'); return; }
    if (F.phase !== 'run' || F.tapped !== null) return;
    F.tapped = F.cue;
    haptic();
    sfx('tap');
  }
  function agilityStep(d, dt) {
    const F = fun;
    if (!F || F.kind !== 'agility' || F.dog !== d) return false;
    const A = d.act, pos = d.root.position;
    if (F.phase === 'toStart') {
      if (d.stepTo(F.start.x, F.start.z, 3, dt) < 0.3 || (F.t += dt) > 8) {
        pos.set(F.start.x, groundAt(F.start.x, F.start.z), F.start.z);
        F.phase = 'count'; F.t = 0;
        const L0 = F.legs[0]; d.faceTo(L0.a); A.pose = 'sit';
      }
      return true;
    }
    if (F.phase === 'count') {
      F.t += dt;
      const left = 3 - Math.floor(F.t);
      if (left !== F.shown) { F.shown = left; funBar(left > 0 ? `${left}…` : 'Go!', 'Go!', 0); sfx(left > 0 ? 'tap' : 'whoosh'); }
      if (F.t >= 3) { F.phase = 'run'; F.t = 0; F.time = 0; F.legT = 0; F.sub = 'to'; F.tapped = null; A.pose = 'none'; }
      return true;
    }
    if (F.phase !== 'run') return true;
    F.time += dt;
    const L = F.legs[F.i];
    if (!L) { agilityFinish(); return true; }
    const O = D.OBSTACLES[L.kind];
    if (F.sub === 'to') {
      // running up to the obstacle: the cue fills as it gets close
      const dd = flatDist(pos, L.a);
      F.cue = clamp(1 - (dd - 0.2) / 3.2, 0, 1);
      $('funFill').style.width = (F.cue * 100).toFixed(1) + '%';
      const dx = L.a.x - pos.x, dz = L.a.z - pos.z, l = Math.hypot(dx, dz) || 1, step = Math.min(l, F.st.v * dt);
      pos.x += dx / l * step; pos.z += dz / l * step;
      pos.y = groundAt(pos.x, pos.z);
      d.face = Math.atan2(dx, dz); d.moving = true; d.curSpeed = F.st.v;
      if (l < 0.12) {
        // judge the timing: green is 0.72 to 0.96
        const q = F.tapped;
        let fault = F.st.fault;
        if (q === null) fault += 0.45; else if (q < 0.72) fault += 0.2 + (0.72 - q); else if (q > 0.96) fault += 0.15;
        else fault *= 0.35;
        if (L.kind === 'weave' && d.flag('quick')) fault = 0;
        if (O.trick) fault *= 1 - d.trickLvl(O.trick) * 0.1;
        F.bad = Math.random() < fault;
        F.sub = 'through'; F.legT = 0; F.tapped = null;
        $('funFill').style.width = '0%';
      }
      return true;
    }
    if (F.sub === 'through') {
      const dur = O.t * (4.2 / F.st.v) + (F.bad && (L.kind === 'tunnel' || L.kind === 'weave' || L.kind === 'table') ? 1.2 : 0);
      F.legT += dt;
      const k = clamp(F.legT / dur, 0, 1);
      const r = L.r;
      let ox = 0, oy = 0, hop = 0;
      if (L.kind === 'weave') ox = Math.sin(k * Math.PI * 5) * 0.22;
      if (L.kind === 'hurdle' || L.kind === 'tire') hop = Math.sin(k * Math.PI) * 0.7;
      if (L.kind === 'aframe') oy = Math.sin(k * Math.PI) * 0.62;
      if (L.kind === 'table') oy = k < 0.15 ? k / 0.15 * 0.42 : k > 0.85 ? (1 - k) / 0.15 * 0.42 : 0.42;
      if (L.kind === 'tunnel') oy = -0.12;
      const bx = lerp(L.a.x, L.b.x, k), bz = lerp(L.a.z, L.b.z, k);
      pos.set(bx + Math.cos(r) * ox, groundAt(bx, bz) + oy, bz - Math.sin(r) * ox);
      d.face = r; d.moving = L.kind !== 'table' || k < 0.15 || k > 0.85; d.curSpeed = F.st.v;
      A.pose = (L.kind === 'hurdle' || L.kind === 'tire') ? 'jump' : L.kind === 'table' && k > 0.15 && k < 0.85 ? 'sit' : 'none';
      A.hop = hop; A.tilt = (L.kind === 'hurdle' || L.kind === 'tire') ? lerp(-0.4, 0.4, k) : 0;
      if (F.bad && L.kind !== 'table' && k > 0.45 && !F.said) { F.said = true; F.faults++; sfx('fail'); spawnEmoji(L.kind === 'hurdle' || L.kind === 'tire' ? '💥' : '❌', d.headWorld(0.35), { size: 0.4 }); }
      if (F.bad && L.kind === 'table' && k > 0.5 && !F.said) { F.said = true; F.faults++; sfx('fail'); spawnEmoji('❌', d.headWorld(0.35), { size: 0.4 }); }
      if (k >= 1) {
        if (!F.bad) { sfx('pet'); spawnEmoji('✨', d.headWorld(0.3), { size: 0.3 }); }
        F.i++; F.sub = 'to'; F.bad = false; F.said = false; A.hop = 0; A.tilt = 0;
        funBar(`⏱ ${F.time.toFixed(1)} s · ${F.i}/${F.legs.length}${F.faults ? ` · ${F.faults} fault${F.faults > 1 ? 's' : ''}` : ''}`, 'Go!', 0);
      }
      return true;
    }
    return true;
  }
  function agilityFinish() {
    const F = fun, d = F.dog, C = F.course, G = agi();
    F.phase = 'done';
    const total = Math.round((F.time + F.faults * D.TOURNEY.fault) * 10) / 10;
    d.act.pose = 'hop';
    d.happy = Math.min(100, d.happy + 10);
    d.energy = Math.max(0, d.energy - 8);
    d.addBond(2);
    addSpec(d, 'athlete', 3);
    G.runs++;
    progress('agility');
    const prev = G.best[C.id];
    const better = !prev || total < prev.t;
    if (better) G.best[C.id] = { t: total, dog: d.name, faults: F.faults };
    journalAdd(d, 'agility1', '🏁', `Ran an agility course for the first time (${total} s)`);
    if (F.faults === 0) journalAdd(d, 'agilityclean:' + C.id, '✨', `Ran the ${C.name.toLowerCase()} without a single fault`);
    let msg = `${d.name}: ${total} s${F.faults ? ` (${F.time.toFixed(1)} s + ${F.faults} × ${D.TOURNEY.fault} s for faults)` : ', clean run!'}${better && prev ? ' · new best!' : ''}`;
    if (F.opt.tourney !== undefined) msg = tourneyResult(F, total) || msg;
    else if (total <= C.par) msg += ' · under par 🌟';
    confetti(d.headWorld(0.3), F.faults ? 2 : 5);
    sfx(F.faults ? 'trick' : 'unlock');
    $('funMeter').classList.remove('cue');
    funBar(msg, 'Done');
    save();
  }
  // ----- tournaments: twice a month at the grounds; win a class to move up -----
  const tourneyToday = () => D.TOURNEY.days.includes(clockNow.day);
  function tourneyEvents() {
    if (!locUnlocked('grounds')) return [];
    const out = [];
    for (let m = 1; m <= 12; m++) for (const d0 of D.TOURNEY.days) out.push({ id: `tourney:${m}:${d0}`, tourney: true, name: 'Agility tournament', icon: '🏆', m, d0, d1: d0, loc: 'grounds',
      text: 'Enter at the Agility club stall at the Tournament Grounds.', task: { kind: 'progress', ev: 'tourney', n: 1, how: 'Run in the tournament at the Tournament Grounds' }, reward: { coins: 20, xp: 30 } });
    return out;
  }
  function enterTourney() {
    const G = agi();
    if (!tourneyToday()) { toast(`The next tournament is on the ${D.TOURNEY.days.find((x) => x > clockNow.day) || D.TOURNEY.days[0]}th`); return; }
    if (G.entered === clockNow.gameDay) { toast('You already ran in today’s tournament. Come back next time!'); return; }
    const cls = G.cls, C = Object.entries(D.COURSES).find(([, x]) => x.cls === cls);
    const fee = D.TOURNEY.fee[cls], d = selected || dogs[0];
    confirmBox(`${D.CLASSES[cls]} tournament`, `${d.name} runs the ${C[1].name.toLowerCase()} against ${D.TOURNEY.rivals} other dogs. Entry: 🪙 ${fee}. Prizes for the top 3${cls < 2 ? ', and a win moves you up a class' : ''}.`, `Enter (🪙 ${fee})`, state.coins >= fee, () => {
      state.coins -= fee;
      G.entered = clockNow.gameDay;
      updateHud();
      startAgility(groundsCourse(C[0]), { tourney: cls, dog: d });
    });
  }
  function tourneyResult(F, total) {
    const G = agi(), cls = F.opt.tourney, C = F.course;
    const rr = ART.mulberry32(hashStr(`${state.uid}|${clockNow.gameDay}|${cls}`));
    const span = [[1.0, 1.4], [0.95, 1.3], [0.9, 1.25]][cls];
    const rivals = shuffle(D.NEIGHBORS).slice(0, D.TOURNEY.rivals).map((N) => ({ name: N.dog.name, owner: N.owner, t: Math.round(C.par * (span[0] + rr() * (span[1] - span[0])) * 10) / 10 }));
    const all = rivals.concat({ me: true, name: F.dog.name, t: total }).sort((a, b) => a.t - b.t);
    const place1 = all.findIndex((x) => x.me) + 1;
    const prize = D.TOURNEY.prize[cls][place1 - 1] || 0;
    if (prize) addCoins(prize, player.root.position);
    progress('tourney');
    const medal = ['🥇', '🥈', '🥉'][place1 - 1];
    if (place1 === 1) {
      G.wins[cls] = (G.wins[cls] || 0) + 1;
      G.trophies.push({ cls, dog: F.dog.name, gd: clockNow.gameDay });
      if (cls === 2) state.stats.champWins = (state.stats.champWins || 0) + 1;
      if (G.cls === cls && cls < 2) { G.cls = cls + 1; setTimeout(() => news({ title: `Moved up: ${D.CLASSES[cls + 1]}`, text: `${F.dog.name} won the ${D.CLASSES[cls].toLowerCase()}. Next tournament, you run in the ${D.CLASSES[cls + 1].toLowerCase()}.`, th: TH('pic', '🏆') }), 1500); }
    }
    if (medal) journalAdd(F.dog, null, medal, `Came ${['first', 'second', 'third'][place1 - 1]} in the ${D.CLASSES[cls].toLowerCase()} at an agility tournament (${total} s)`);
    else journalAdd(F.dog, 'tourney1', '🏁', 'Ran in an agility tournament for the first time');
    F.board = all;
    showTourneyBoard(all, cls, place1, prize);
    return `${medal || ''} Place ${place1} of ${all.length}: ${total} s${prize ? ` · 🪙 ${prize}` : ''}`;
  }
  function showTourneyBoard(all, cls, place1, prize) {
    $('tourneyTitle').textContent = `${D.CLASSES[cls]}: place ${place1}`;
    $('tourneyList').innerHTML = all.map((x, i) => `<div class="row${x.me ? ' me' : ''}"><div class="ic"><b>${['🥇', '🥈', '🥉'][i] || i + 1}</b></div><div class="txt"><b>${esc(x.name)}</b><small>${x.me ? 'Your dog' : esc(x.owner + '’s dog')}</small></div><b>${x.t.toFixed(1)} s</b></div>`).join('') +
      `<p class="sub">${prize ? `You won 🪙 ${prize}.` : 'No prize this time. Practice in the rings and try again next tournament!'}</p>`;
    setTimeout(() => $('tourney').classList.remove('hidden'), 900);
  }
  $('tourneyClose').addEventListener('click', () => $('tourney').classList.add('hidden'));
  // the course sheet at home: the order your obstacles are run in
  function openCourse() {
    renderCourse();
    $('courseSheet').classList.remove('hidden');
  }
  function renderCourse() {
    const C = homeCourse(), G = agi();
    const best = G.best[C.id];
    $('courseList').innerHTML = C.list.length ? C.list.map((o, i) => `<div class="row"><div class="ic"><b>${i + 1}</b></div><div class="txt"><b>${D.OBSTACLES[o[0]].icon} ${esc(D.OBSTACLES[o[0]].name)}</b></div><button class="soft small" data-mv="${i}" data-d="-1" ${i ? '' : 'disabled'}>↑</button><button class="soft small" data-mv="${i}" data-d="1" ${i < C.list.length - 1 ? '' : 'disabled'}>↓</button></div>`).join('') +
      `<p class="sub">Your dog runs them in this order. ${best ? `Best time on this course: ${best.t} s (${esc(best.dog)}).` : 'No best time yet.'} Rotate an obstacle in Decorate to change which way the dog goes through it.</p>`
      : '<p class="sub">No obstacles yet. Buy some in the Shop (Agility) and place them at home, in a room or a garden.</p>';
    $('courseRun').disabled = C.list.length < 3;
  }
  $('courseList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mv]');
    if (!b) return;
    const C = homeCourse(), i = +b.dataset.mv, j = i + +b.dataset.d;
    const keys = C.list.map((o) => o[4].i + ',' + o[4].j);
    [keys[i], keys[j]] = [keys[j], keys[i]];
    agi().order = keys;
    renderCourse();
    save();
  });
  $('courseRun').addEventListener('click', () => { $('courseSheet').classList.add('hidden'); startAgility(homeCourse()); });
  $('courseClose').addEventListener('click', () => $('courseSheet').classList.add('hidden'));
  // at the grounds: which ring's start mat you're standing on
  function ringAt(pp) {
    if (place !== 'park' || loc !== 'grounds') return null;
    for (const [id, C] of Object.entries(D.COURSES)) if (Math.hypot(pp.x - C.start[0], pp.z - C.start[1]) < 1.8) return id;
    return null;
  }
  const nearBooth = (pp) => place === 'park' && loc === 'grounds' && S.vendors[0] && flatDist(S.vendors[0].front, pp) < 2.4;

  // =====================================================================
  // Hobbies, part 3: ducks on the ponds, and painting your dogs
  // =====================================================================
  let ducks = [], crumbs = [], handfuls = 0;
  function clearDucks() { for (const k of ducks) k.g.parent && k.g.parent.remove(k.g); for (const c of crumbs) c.g.parent && c.g.parent.remove(c.g); ducks = []; crumbs = []; }
  function spawnDucks() {
    clearDucks();
    handfuls = D.DUCK_HANDFULS;
    if (!D.DUCK_PLACES.includes(loc) || !S.ponds || !unlockedFeat('ducks')) return;
    const spring = seasonOf(clockNow.month) === 'spring';
    for (const P of S.ponds) {
      if (P.x1 - P.x0 > 40 || Math.min(P.x1 - P.x0, P.z1 - P.z0) < 2.2) continue;
      const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
      const y = waterY(cx, cz) - 0.03;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const g = ART.buildDuck(false);
        const x = rand(P.x0 + 0.5, P.x1 - 0.5), z = rand(P.z0 + 0.5, P.z1 - 0.5);
        g.position.set(x, y, z);
        parkRoot.add(g);
        const mom = { g, P, y, tx: x, tz: z, t: rand(0, 4), speed: 0.4 };
        ducks.push(mom);
        // in spring a mother duck has little ones paddling behind her
        if (spring && k === 0) for (let c = 0; c < 3; c++) { const gg = ART.buildDuck(true); gg.position.set(x, y, z + 0.4 * (c + 1)); parkRoot.add(gg); ducks.push({ g: gg, P, y, follow: ducks[ducks.length - 1], young: true, t: 0, speed: 0.6 }); }
      }
    }
  }
  function nearDucks(pp) {
    if (place !== 'park' || !ducks.length || !unlockedFeat('ducks')) return null;
    const e = pondEdge(pp);
    if (!e || flatDist(e, pp) > 2.2) return null;
    return ducks.some((k) => flatDist(k.g.position, pp) < 9) ? e : null;
  }
  function updateDucks(dt) {
    if (!ducks.length) return;
    const pp = player.root.position;
    for (const k of ducks) {
      const P = k.P, g = k.g;
      k.t += dt;
      let tx, tz, sp = k.speed;
      if (k.follow) { const f = k.follow.g.position, back = new V3(-Math.sin(k.follow.g.rotation.y), 0, -Math.cos(k.follow.g.rotation.y)); tx = f.x + back.x * 0.45; tz = f.z + back.z * 0.45; sp = 0.9; }
      else {
        // food in the water? paddle over. A dog in the water? paddle away.
        const food = crumbs.filter((c) => c.wet && c.P === P).sort((a, b) => flatDist(a.g.position, g.position) - flatDist(b.g.position, g.position))[0];
        const splash = dogs.find((d) => d.state === 'splash' && flatDist(d.root.position, g.position) < 3);
        if (splash) { const a = Math.atan2(g.position.x - splash.root.position.x, g.position.z - splash.root.position.z); tx = g.position.x + Math.sin(a) * 2; tz = g.position.z + Math.cos(a) * 2; sp = 1.6; if (!k.quacked) { k.quacked = true; sfx('quack'); } }
        else if (food) { tx = food.g.position.x; tz = food.g.position.z; sp = 1.1; if (flatDist(food.g.position, g.position) < 0.3) { food.left -= dt * 1.5; if (food.left <= 0) { food.g.parent && food.g.parent.remove(food.g); crumbs.splice(crumbs.indexOf(food), 1); sfx('quack'); spawnEmoji('💛', g.position.clone().add(new V3(0, 0.5, 0)), { size: 0.3 }); } } }
        else { k.quacked = false; if (k.t > 4 || flatDist(new V3(k.tx, 0, k.tz), g.position) < 0.2) { k.t = 0; k.tx = rand(P.x0 + 0.4, P.x1 - 0.4); k.tz = rand(P.z0 + 0.4, P.z1 - 0.4); } tx = k.tx; tz = k.tz; }
      }
      tx = clamp(tx, P.x0 + 0.3, P.x1 - 0.3); tz = clamp(tz, P.z0 + 0.3, P.z1 - 0.3);
      const dx = tx - g.position.x, dz = tz - g.position.z, l = Math.hypot(dx, dz);
      if (l > 0.05) { const st = Math.min(l, sp * dt); g.position.x += dx / l * st; g.position.z += dz / l * st; g.rotation.y = angleLerp(g.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 5)); }
      g.position.y = k.y + Math.sin(k.t * 2 + g.position.x) * 0.015;
    }
    for (let i = crumbs.length - 1; i >= 0; i--) {
      const c = crumbs[i];
      if (c.wet) { c.age += dt; if (c.age > 25) { c.g.parent && c.g.parent.remove(c.g); crumbs.splice(i, 1); } continue; }
      c.t += dt;
      const k = Math.min(1, c.t / 0.6);
      c.g.position.set(lerp(c.from.x, c.to.x, k), lerp(c.from.y, c.to.y, k) + Math.sin(k * Math.PI) * 0.8, lerp(c.from.z, c.to.z, k));
      if (k >= 1) { c.wet = true; c.age = 0; ripple(c.to, 0.6); }
    }
    void pp;
  }
  function feedDucks() {
    const pp = player.root.position, e = nearDucks(pp);
    if (!e) return;
    if (handfuls <= 0) { toast('You’re out of crumbs for this walk. The ducks look very full anyway'); return; }
    handfuls--;
    const P = S.ponds.find((p) => e.center.x > p.x0 - 0.6 && e.center.x < p.x1 + 0.6 && e.center.z > p.z0 - 0.6 && e.center.z < p.z1 + 0.6) || S.ponds[0];
    player.face = Math.atan2(e.center.x - pp.x, e.center.z - pp.z);
    player.throwT = 0.3;
    const dir = new V3(e.center.x - pp.x, 0, e.center.z - pp.z).normalize();
    for (let k = 0; k < 3; k++) {
      const to = new V3(clamp(e.center.x + dir.x * rand(0.6, 1.8) + rand(-0.4, 0.4), P.x0 + 0.2, P.x1 - 0.2), 0, clamp(e.center.z + dir.z * rand(0.6, 1.8) + rand(-0.4, 0.4), P.z0 + 0.2, P.z1 - 0.2));
      to.y = waterY(to.x, to.z);
      const g = new THREE.Group();
      box(g, 0.08, 0.04, 0.08, '#e6c27a', 0, 0, 0);
      g.position.copy(pp).add(new V3(0, 1.1, 0));
      parkRoot.add(g);
      crumbs.push({ g, from: g.position.clone(), to, t: -k * 0.08, wet: false, P, left: 1 });
    }
    sfx('throw');
    progress('ducks');
    state.stats.duckFeeds = (state.stats.duckFeeds || 0) + 1;
    // the dogs: each in its own way, the first time on a walk
    if (!feedDucks.seen) feedDucks.seen = new Set();
    for (const d of dogs) {
      const key = loc + ':' + d.id + ':' + walkStartT;
      if (feedDucks.seen.has(key)) continue;
      feedDucks.seen.add(key);
      const tr = traitPick(d), T = D.DUCK_REACT[tr];
      if (!T) continue;
      setTimeout(() => {
        if (place !== 'park') return;
        toast(fill(T, { dog: d.name }));
        journalAdd(d, 'ducks1', '🦆', 'Watched you feed the ducks');
        if (tr === 'water' && e) { d.goTo(e.clone(), 3.4, () => { d.faceTo(e.center); d.setState('splash', 2.6); d.wetT = 40; addDirt(d, walkDirt(), 1); }, 0.5); }
        else if (tr === 'shy') { const f = player.face; d.goTo(new V3(pp.x - Math.sin(f) * 0.7, 0, pp.z - Math.cos(f) * 0.7), 3, () => d.setState('sit', 3), 0.3); }
        else if (tr === 'foodie') { d.goTo(e.clone(), 3.2, () => { d.faceTo(e.center); d.setState('sniff', 2); spawnEmoji('😋', d.headWorld(0.35), { size: 0.35 }); }, 0.5); }
        else spawnEmoji(tr === 'zoomies' ? '🌀' : '🦆', d.headWorld(0.4), { size: 0.35 });
      }, 700 + dogs.indexOf(d) * 900);
    }
    tip('ducks', { title: 'Feeding the ducks', text: `You have ${D.DUCK_HANDFULS} handfuls of crumbs on every walk. The ducks paddle over when the crumbs hit the water. In spring, look out for ducklings!`, icon: 'wave' });
    if (handfuls === 0) setTimeout(() => toast('That was the last handful 🦆'), 1500);
  }

  // ----- painting: your dog poses, you paint -----
  let paint = null;
  const portraitImg = (d) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = ART.portraitURL(d.breed, d.coat); });
  async function startPainting(f) {
    if (!needRank('painting')) return;
    const d = selected && dogs.includes(selected) ? selected : dogs[0];
    if (!d) return;
    if (fun) endFun('switch');
    const easel = tileCenter(f);
    // the model sits a couple of steps in front of the easel
    const r = ROT_ANG[f.rot || 0];
    let spot = new V3(easel.x + Math.sin(r) * 2, 0, easel.z + Math.cos(r) * 2);
    if (isSolid(spot.x, spot.z)) spot = freePoint(easel.x, easel.z, 1.5, 3) || d.root.position.clone();
    d.free = true;
    d.doAct('none', (dt) => {
      if (!paint || paint.dog !== d) return false;
      if (d.stepTo(spot.x, spot.z, 2.4, dt) < 0.3) { d.act.pose = 'sit'; d.faceTo(easel); }
      return true;
    }, 'Posing for a painting 🎨');
    const img = await portraitImg(d);
    const c = $('paintCanvas'), x = c.getContext('2d');
    const N = c.width;
    x.fillStyle = '#fbf8f0'; x.fillRect(0, 0, N, N);
    // light pencil lines to paint over
    x.globalAlpha = 0.18;
    if (img) { x.imageSmoothingEnabled = false; x.drawImage(img, N * 0.18, N * 0.14, N * 0.64, N * 0.64); }
    x.globalAlpha = 1;
    paint = { dog: d, f, img, col: D.PAINT_COLS[Math.floor(Math.random() * D.PAINT_COLS.length)], cov: new Set(), last: null, strokes: 0 };
    $('paintTitle').textContent = `Painting ${d.name}`;
    $('paintCols').innerHTML = D.PAINT_COLS.map((c2) => `<button class="sw${c2 === paint.col ? ' sel' : ''}" data-pc="${c2}" style="--c:${c2}" aria-label="${c2}"></button>`).join('');
    $('paintDone').disabled = true;
    $('paintHint').textContent = 'Pick a color for the background, then paint over the whole canvas with your finger.';
    $('paint').classList.remove('hidden');
    tip('painting', { title: 'Painting', text: 'Rub over the canvas to paint. Each background color you pick goes where you paint next, so try a few. When most of it is painted, tap Finish.', icon: 'brush' });
  }
  function paintAt(px, py) {
    const P = paint, c = $('paintCanvas'), x = c.getContext('2d'), N = c.width;
    // the finished picture at this spot: your color behind the dog
    const R = 16 + Math.random() * 6;
    x.save();
    x.beginPath();
    x.arc(px + rand(-2, 2), py + rand(-2, 2), R, 0, TAU);
    x.clip();
    x.fillStyle = P.col; x.fillRect(px - R, py - R, R * 2, R * 2);
    if (P.img) { x.imageSmoothingEnabled = false; x.drawImage(P.img, N * 0.18, N * 0.14, N * 0.64, N * 0.64); }
    // a few lighter bristle marks
    x.globalAlpha = 0.18; x.fillStyle = '#ffffff';
    for (let k = 0; k < 3; k++) x.fillRect(px + rand(-R, R), py + rand(-R, R), rand(4, 9), 2);
    x.restore();
    const g = 10;
    for (let gx = Math.floor((px - R) / (N / g)); gx <= Math.floor((px + R) / (N / g)); gx++) for (let gy = Math.floor((py - R) / (N / g)); gy <= Math.floor((py + R) / (N / g)); gy++) if (gx >= 0 && gy >= 0 && gx < g && gy < g) P.cov.add(gx + ',' + gy);
    const share = P.cov.size / (g * g);
    $('paintDone').disabled = share < 0.6;
    if (share >= 0.6) $('paintHint').textContent = share > 0.9 ? 'Lovely! Tap Finish.' : 'Almost there. Finish whenever you like.';
  }
  (function paintInput() {
    const c = $('paintCanvas');
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    let down = false, last = null;
    c.addEventListener('pointerdown', (e) => { if (!paint) return; e.preventDefault(); down = true; last = pt(e); paintAt(...last); try { c.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } });
    c.addEventListener('pointermove', (e) => {
      if (!down || !paint) return;
      const p = pt(e), dd = Math.hypot(p[0] - last[0], p[1] - last[1]);
      for (let k = 1; k <= Math.ceil(dd / 8); k++) paintAt(lerp(last[0], p[0], k / Math.ceil(dd / 8)), lerp(last[1], p[1], k / Math.ceil(dd / 8)));
      if (Math.random() < 0.3) sfx('brush');
      last = p;
    });
    const up = () => { down = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  })();
  $('paintCols').addEventListener('click', (e) => { const b = e.target.closest('[data-pc]'); if (!b || !paint) return; paint.col = b.dataset.pc; $('paintCols').querySelectorAll('.sw').forEach((x) => x.classList.toggle('sel', x === b)); });
  $('paintQuit').addEventListener('click', () => { paint = null; $('paint').classList.add('hidden'); });
  $('paintDone').addEventListener('click', () => finishPainting());
  function finishPainting() {
    const P = paint;
    if (!P) return;
    const c = $('paintCanvas'), out = document.createElement('canvas');
    out.width = out.height = 160;
    const x = out.getContext('2d');
    x.drawImage(c, 0, 0, 160, 160);
    const url = out.toDataURL('image/jpeg', 0.8);
    const id = newId();
    state.paintings = (state.paintings || []).concat({ id, dog: P.dog.id, name: P.dog.name, url, t: Date.now() }).slice(-24);
    state.inventory.painting = (state.inventory.painting || 0) + 1;
    state.stats.paintings = (state.stats.paintings || 0) + 1;
    journalAdd(P.dog, null, '🎨', 'Sat for a painting');
    const e = P.dog.journal[P.dog.journal.length - 1];
    if (e && e.tx === 'Sat for a painting') e.ph = url;
    P.dog.happy = Math.min(100, P.dog.happy + 8);
    progress('paint');
    sfx('unlock');
    paint = null;
    $('paint').classList.add('hidden');
    news({ title: 'A new painting!', text: `Your portrait of ${P.dog.name} is in your inventory. Hang it up in Decorate.`, th: `<img class="th" src="${url}" alt="">` });
    save();
  }
  // a painting on its stand shows the picture you painted
  const paintTex = new Map();
  function applyPaintingTex(g, pid) {
    const P = (state.paintings || []).find((p) => p.id === pid);
    const c = g.userData.canvas;
    if (!P || !c) return;
    let t = paintTex.get(pid);
    if (!t) {
      const im = new Image();
      t = new (THREE.Texture || THREE.CanvasTexture)(im);
      im.onload = () => { t.needsUpdate = true; };
      im.src = P.url;
      paintTex.set(pid, t);
    }
    c.material = new THREE.MeshLambertMaterial({ map: t });
  }
  const freePainting = () => (state.paintings || []).find((p) => !state.furniture.some((f) => f.pid === p.id));

  // =====================================================================
  // Hobbies, part 4: letters, messages in bottles, dog sitting, and your name
  // =====================================================================
  const youName = () => String(state.playerName || '').trim();
  // "Sat with you on the sofa" → "Sat with Lena on the sofa", once you have a name
  function personal(t) {
    const n = youName();
    if (!n || !t) return t;
    return t.replace(/\byour\b/g, n + '’s').replace(/\byou\b/g, n);
  }
  const mail = () => (state.mail = Object.assign({ inbox: [], out: [], last: -99 }, state.mail || {}));
  const nfriend = (o) => ((state.nfriend || {})[o] || 0) + Math.min(10, ((state.chats || {})[o] || {}).n || 0);
  const addNFriend = (o, n) => { state.nfriend = state.nfriend || {}; state.nfriend[o] = clamp((state.nfriend[o] || 0) + n, 0, 100); };
  const unreadMail = () => mail().inbox.filter((m) => !m.read).length;
  const knownNeighbors = () => D.NEIGHBORS.filter((N) => (state.chats || {})[N.owner] || (state.nfriend || {})[N.owner] || storyOf(N.owner));
  function nfill(t, N) { return fill(t, { ndog: N.dog.name, dog: (dogs[0] || { name: 'your dog' }).name, you: youName() || 'us', owner: N.owner }); }
  // the mailbox flag goes up when a letter is waiting
  function mailFlags() {
    const up = unreadMail() > 0;
    for (const [f, r] of furnRT) if (f.type === 'mailbox' && r.group.userData.flag) r.group.userData.flag.rotation.x = up ? 0 : 1.4;
  }
  function receive(o) {
    mail().inbox.unshift(Object.assign({ id: newId(), gd: clockNow.gameDay, read: false }, o));
    state.mail.inbox = state.mail.inbox.slice(0, 30);
    const N = D.NEIGHBORS.find((x) => x.owner === o.from);
    if (o.gazette) news({ title: `📰 ${o.gazette.name}, issue ${o.gazette.no}`, text: `“${o.gazette.head[0]}” and your week in numbers. ${hasItem('mailbox') ? 'It’s in your mailbox at home.' : 'Put a mailbox up at home to read it.'}`, th: IC('paper') });
    else news({ title: `📬 A letter from ${o.from}`, text: hasItem('mailbox') ? 'It’s in your mailbox at home.' : 'Put a mailbox up at home to read it (Shop → Decor).', th: N ? `<img class="th" src="${ART.personPortraitURL(N)}" alt="">` : TH('pic', '💌') });
    mailFlags();
  }
  function seedGift(n) { const pool = Object.keys(D.SEEDS); const out = {}; for (let k = 0; k < n; k++) { const s = pick(pool); out[s] = (out[s] || 0) + 1; } return { seeds: out }; }
  function giftText(g) {
    if (!g) return '';
    const parts = [];
    if (g.coins) parts.push(`🪙 ${g.coins}`);
    for (const [k, n] of Object.entries(g.seeds || {})) parts.push(`${n} × ${D.SEEDS[k].icon} ${D.SEEDS[k].name.toLowerCase()}`);
    for (const [k, n] of Object.entries(g.pantry || {})) parts.push(`${n} × ${D.INGREDIENTS[k].icon} ${D.INGREDIENTS[k].name.toLowerCase()}`);
    if (g.find) parts.push(`${D.FINDS[g.find].icon} ${D.FINDS[g.find].name}`);
    return parts.join(', ');
  }
  function claimGift(g) {
    if (!g) return;
    if (g.coins) addCoins(g.coins, null);
    for (const [k, n] of Object.entries(g.seeds || {})) state.seeds[k] = (state.seeds[k] || 0) + n;
    for (const [k, n] of Object.entries(g.pantry || {})) state.pantry[k] = (state.pantry[k] || 0) + n;
    if (g.find) grantFind(g.find, null);
  }
  // replies come the next in-game day; now and then a neighbor writes first
  function mailTick() {
    const M = mail(), today = clockNow.gameDay;
    for (const o of M.out.filter((x) => x.gd < today)) {
      M.out.splice(M.out.indexOf(o), 1);
      const N = D.NEIGHBORS.find((x) => x.owner === o.to);
      if (!N) continue;
      let text, gift = null;
      if (o.gift) {
        text = fill(pick(D.LETTER_REPLIES.gift), { gift: o.giftName, ndog: N.dog.name });
        gift = Object.assign(unlockedFeat('farming') ? seedGift(3) : {}, { coins: 20 + Math.floor(Math.random() * 20) });
        if (Math.random() < 0.08) { const rare = Object.keys(D.FINDS).filter((k) => !state.finds[k] && D.FINDS[k].weight > 0 && !D.FINDS[k].where && locUnlocked(D.FINDS[k].loc)); if (rare.length) gift.find = pick(rare); }
        addNFriend(N.owner, 10);
      } else if (o.kind === 'tip') {
        const h = hintLines();
        text = fill(pick(D.LETTER_REPLIES.tip), { hint: h.length ? pick(h) : 'Honestly, I think your garden is the best secret spot around.' });
        addNFriend(N.owner, 4);
      } else if (o.kind === 'walk') {
        text = nfill(pick(D.LETTER_REPLIES.walk), N);
        addNFriend(N.owner, 5);
        if (unlockedFeat('meetups') && !meetupLive()) setTimeout(() => inviteFrom(N), 4000);
      } else {
        text = nfill(pick(D.LETTER_REPLIES[o.kind] || D.LETTER_REPLIES.hello), N);
        addNFriend(N.owner, o.kind === 'thanks' ? 6 : 4);
        if (Math.random() < 0.45) gift = Math.random() < 0.5 && unlockedFeat('farming') ? seedGift(2) : { coins: 10 + Math.floor(Math.random() * 15) };
      }
      state.stats.lettersBack = (state.stats.lettersBack || 0) + 1;
      receive({ from: N.owner, text: `Dear ${youName() || 'neighbor'},\n${text}\n${N.owner} & ${N.dog.name}`, gift });
    }
    // a neighbor writes first: seeds for the garden, or could you look after their dog?
    if (today - M.last >= 3 && dogs.length && !visit && unlockedFeat('letters')) {
      M.last = today;
      const friends = knownNeighbors().filter((N) => nfriend(N.owner) >= 8);
      if (friends.length && Math.random() < 0.5) {
        const N = pick(friends);
        if (unlockedFeat('sitting') && !state.sitting && Math.random() < 0.45) receive({ from: N.owner, ask: 'sit', text: `Dear ${youName() || 'neighbor'},\n${nfill(pick(D.SIT_ASK), N)}\n${N.owner}` });
        else receive({ from: N.owner, text: `Dear ${youName() || 'neighbor'},\n${nfill(pick(D.LETTER_REPLIES.random), N)}\n${N.owner} & ${N.dog.name}`, gift: unlockedFeat('farming') ? seedGift(3) : { coins: 15 } });
      }
    }
    mailFlags();
  }
  // a neighbor you wrote to asks to meet
  function inviteFrom(N) {
    const places = Object.keys(D.MEET_SPOTS).filter((l) => locUnlocked(l));
    if (!places.length) return;
    const l = pick(places), sp = pick(D.MEET_SPOTS[l].filter((x) => !x[3] || hiddenOf(l).includes(x[3])));
    if (!sp) return;
    state.meetup = { owner: N.owner, loc: l, spot: sp.slice(0, 3), from: clockNow.gameDay, until: clockNow.gameDay + 4, met: false };
    news({ title: `${N.owner} invites you`, text: `“Let’s meet at ${sp[0]} in ${D.LOCATIONS[l].name}!”`, th: `<img class="th" src="${ART.personPortraitURL(N)}" alt="">` });
    save();
  }
  // ----- the mailbox sheet -----
  let mailTab = 'inbox', mailTo = null, mailKind = null, mailGift = null, mailOpenId = null;
  function openMail() {
    if (!needRank('letters')) return;
    mailTab = unreadMail() || !mail().inbox.length ? 'inbox' : mailTab;
    if (!mail().inbox.length) mailTab = 'write';
    mailTo = mailKind = mailGift = null;
    renderMail();
    $('mail').classList.remove('hidden');
  }
  function renderMail() {
    const M = mail();
    $('mailTabs').querySelectorAll('.seg').forEach((b) => b.classList.toggle('sel', b.dataset.mt === mailTab));
    const B = $('mailBody');
    if (mailTab === 'inbox') {
      if (!M.inbox.length) { B.innerHTML = '<p class="sub">No letters yet. Write to a neighbor, and they’ll write back the next day.</p>'; return; }
      B.innerHTML = M.inbox.map((m) => {
        if (m.gazette) return `<div class="row letter gz${m.read ? '' : ' unread'}" data-ml="${m.id}"><div class="ic">${IC('paper')}</div><div class="txt"><b>${esc(m.gazette.name)}</b><small>Issue ${m.gazette.no}: ${esc(m.gazette.head[0])}</small></div></div>`;
        const N = D.NEIGHBORS.find((x) => x.owner === m.from);
        const open = m.id === mailOpenId;
        return `<div class="row letter${m.read ? '' : ' unread'}" data-ml="${m.id}">${N ? `<img class="th" src="${ART.personPortraitURL(N)}" alt="">` : TH('pic', '💌')}<div class="txt"><b>${esc(m.from)}</b><small>${esc(open ? '' : m.text.split('\n')[1] || '')}</small>${open ? `<p class="letterTxt">${esc(m.text).replace(/\n/g, '<br>')}</p>${m.gift ? `<p class="sub">Enclosed: ${esc(giftText(m.gift))}${m.gotGift ? ' (collected)' : ''}</p>` : ''}${m.ask === 'sit' && !m.answered ? `<div class="btnRow"><button class="primary small" data-sit="yes" data-m="${m.id}">Yes, I’ll look after ${esc(N ? N.dog.name : 'the dog')}</button><button class="soft small" data-sit="no" data-m="${m.id}">Not this time</button></div>` : ''}` : ''}</div></div>`;
      }).join('');
      return;
    }
    // writing: to whom, what, and maybe a little something
    const known = knownNeighbors();
    if (!known.length) { B.innerHTML = '<p class="sub">You don’t know anyone’s address yet. Chat with neighbors on your walks first.</p>'; return; }
    const sentToday = (o) => M.out.some((x) => x.to === o);
    let h = '<div class="section">To</div><div class="mailWho">' + known.map((N) => `<button class="crOpt${mailTo === N.owner ? ' sel' : ''}" data-to="${N.owner}" ${sentToday(N.owner) ? 'disabled' : ''}><img class="th" src="${ART.personPortraitURL(N)}" alt=""><small>${esc(N.owner)}${sentToday(N.owner) ? ' ✉️' : ''}</small></button>`).join('') + '</div>';
    if (mailTo) {
      h += '<div class="section">Letter</div><div class="mailKinds">' + Object.entries(D.LETTER_KINDS).map(([k, L]) => `<button class="soft${mailKind === k ? ' sel' : ''}" data-kind="${k}">${L.icon} ${esc(L.name)}</button>`).join('') + '</div>';
      const pantry = Object.entries(state.pantry || {}).filter(([, n]) => n > 0).slice(0, 4);
      h += '<div class="section">Put something in (optional)</div><div class="mailKinds">' +
        `<button class="soft${!mailGift ? ' sel' : ''}" data-gift="">Nothing</button>` +
        (state.bouquets > 0 ? `<button class="soft${mailGift === 'bouquet' ? ' sel' : ''}" data-gift="bouquet">💐 A bouquet (${state.bouquets})</button>` : '') +
        Object.entries(state.treats || {}).filter(([k, n]) => n > 0 && D.BAKES[k]).map(([k, n]) => `<button class="soft${mailGift === 'treat:' + k ? ' sel' : ''}" data-gift="treat:${k}">${D.BAKES[k].icon} ${esc(D.BAKES[k].name)} (${n})</button>`).join('') +
        pantry.map(([k, n]) => `<button class="soft${mailGift === 'ing:' + k ? ' sel' : ''}" data-gift="ing:${k}">${D.INGREDIENTS[k].icon} ${esc(D.INGREDIENTS[k].name)} (${n})</button>`).join('') + '</div>';
      if (mailKind) {
        const N = D.NEIGHBORS.find((x) => x.owner === mailTo);
        h += `<p class="letterTxt">Dear ${esc(mailTo)},<br>${esc(nfill(D.LETTER_KINDS[mailKind].text, N))}<br>${esc(youName() || 'Your neighbor')}</p><button class="primary" id="mailSend">Send</button>`;
      }
    }
    B.innerHTML = h;
  }
  $('mailTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-mt]'); if (b) { mailTab = b.dataset.mt; renderMail(); } });
  $('mailClose').addEventListener('click', () => $('mail').classList.add('hidden'));
  $('mailBody').addEventListener('click', (e) => {
    const M = mail();
    const sit = e.target.closest('[data-sit]');
    if (sit) {
      const m = M.inbox.find((x) => x.id === sit.dataset.m);
      if (!m) return;
      m.answered = true;
      if (sit.dataset.sit === 'yes') { acceptSitting(m.from); $('mail').classList.add('hidden'); }
      else { addNFriend(m.from, -2); toast('Maybe next time'); renderMail(); }
      save();
      return;
    }
    const l = e.target.closest('[data-ml]');
    if (l) {
      const m = M.inbox.find((x) => x.id === l.dataset.ml);
      if (!m) return;
      if (m.gazette) { m.read = true; mailFlags(); openGazette(m.gazette); renderMail(); save(); return; }
      mailOpenId = mailOpenId === m.id ? null : m.id;
      if (!m.read) { m.read = true; if (m.gift && !m.gotGift) { m.gotGift = true; claimGift(m.gift); toast(`Enclosed: ${giftText(m.gift)}`); } mailFlags(); }
      renderMail();
      save();
      return;
    }
    const to = e.target.closest('[data-to]');
    if (to && !to.disabled) { mailTo = to.dataset.to; renderMail(); return; }
    const k = e.target.closest('[data-kind]');
    if (k) { mailKind = k.dataset.kind; renderMail(); return; }
    const g = e.target.closest('[data-gift]');
    if (g) { mailGift = g.dataset.gift || null; renderMail(); return; }
    if (e.target.id === 'mailSend') sendLetter();
  });
  function sendLetter() {
    if (!mailTo || !mailKind) return;
    let giftName = '';
    if (mailGift === 'bouquet' && state.bouquets > 0) { state.bouquets--; giftName = 'a lovely bouquet'; }
    else if (mailGift && mailGift.startsWith('ing:')) { const k = mailGift.slice(4); if (state.pantry[k] > 0) { state.pantry[k]--; giftName = `a ${D.INGREDIENTS[k].name.toLowerCase().replace(/s$/, '')}`; } }
    else if (mailGift && mailGift.startsWith('treat:')) { const k = mailGift.slice(6), B = D.BAKES[k]; if (B && (state.treats || {})[k] > 0) { state.treats[k]--; giftName = `homemade ${B.name.toLowerCase()}`; if (B.effect.gift) addNFriend(mailTo, 6); } }
    mail().out.push({ to: mailTo, kind: mailKind, gift: !!giftName, giftName, gd: clockNow.gameDay });
    addNFriend(mailTo, 2);
    progress('letter');
    sfx('pay');
    toast(`✉️ Sent to ${mailTo}. A reply should come tomorrow (in about an hour)`);
    mailTo = mailKind = mailGift = null;
    $('mail').classList.add('hidden');
    save();
  }

  // ----- messages in bottles -----
  let bottle = null;
  function spawnBottle() {
    if (bottle) { bottle.g.parent && bottle.g.parent.remove(bottle.g); bottle = null; }
    if (loc !== 'beach' || !unlockedFeat('bottles') || state.tmap || state.bottleDay === clockNow.gameDay || Math.random() > D.BOTTLE.chance) return;
    const z = S.q.sea.rect.z1 + 0.7;
    for (let k = 0; k < 20; k++) {
      const x = rand(-14, 14);
      if (isSolid(x, z) || !S.inside(x, z)) continue;
      const g = ART.buildBottle();
      g.scale.setScalar(1.4);
      const glint = emojiSprite('✨', 0.3);
      glint.position.set(0, 0.45, 0);
      g.add(glint);
      g.position.set(x, groundAt(x, z), z);
      g.rotation.y = rand(0, TAU);
      parkRoot.add(g);
      bottle = { g, x, z, t: 0 };
      return;
    }
  }
  const nearBottle = (pp) => bottle && flatDist(pp, bottle.g.position) < 2;
  function sceneSolid(sc, x, z) {
    if (sc.inside && !sc.inside(x, z)) return true;
    if (sc.solid && sc.solid(x, z)) return true;
    if (sc.ponds.some((p) => x > p.x0 - 0.8 && x < p.x1 + 0.8 && z > p.z0 - 0.8 && z < p.z1 + 0.8)) return true;
    if ((sc.roofs || []).some((r) => r.test.some((t) => x > t.x0 - 1 && x < t.x1 + 1 && z > t.z0 - 1 && z < t.z1 + 1))) return true;
    return sc.colliders.some((c) => (c.r !== undefined ? (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.5) ** 2 : x > c.x0 - 0.5 && x < c.x1 + 0.5 && z > c.z0 - 0.5 && z < c.z1 + 0.5));
  }
  // a map to treasure: near something you'd recognise, somewhere you can go
  function makeMap() {
    const places = Object.keys(D.LOCATIONS).filter((l) => locUnlocked(l) && l !== 'caves');
    for (let tries = 0; tries < 12; tries++) {
      const l = pick(places), sc = sceneOf(l);
      const marks = [];
      for (const v of sc.vendors || []) marks.push({ name: D.VENDORS[v.id].name, ic: D.VENDORS[v.id].icon, x: v.front.x, z: v.front.z });
      for (const s of sc.seats || []) marks.push({ name: 'bench', ic: '🪑', x: s.x, z: s.z });
      for (const p of sc.ponds || []) if (p.x1 - p.x0 < 30) marks.push({ name: 'pond', ic: '💧', x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, r: Math.max(p.x1 - p.x0, p.z1 - p.z0) / 2 });
      if (sc.water) marks.push({ name: 'drinking spot', ic: '🚰', x: sc.water.pos.x, z: sc.water.pos.z });
      if (!marks.length) continue;
      const m = pick(marks);
      const h0 = sc.height ? sc.height(m.x, m.z) : 0;
      for (let k = 0; k < 60; k++) {
        const a = rand(0, TAU), r = (m.r || 0) + rand(2.5, 4.5), x = m.x + Math.sin(a) * r, z = m.z + Math.cos(a) * r;
        if (sceneSolid(sc, x, z) || (sc.height && Math.abs(sc.height(x, z) - h0) > 0.3) || Math.hypot(x, z - 18) < 4) continue;
        return { loc: l, x: +x.toFixed(2), z: +z.toFixed(2), mark: { name: m.name, ic: m.ic, x: m.x, z: m.z }, note: fill(pick(D.MAP_NOTES), { mark: m.name, place: D.LOCATIONS[l].name }), gd: clockNow.gameDay };
      }
    }
    return null;
  }
  function pickBottle() {
    if (!bottle) return;
    const M = makeMap();
    bottle.g.parent && bottle.g.parent.remove(bottle.g);
    bottle = null;
    state.bottleDay = clockNow.gameDay;
    if (!M) { addCoins(10, player.root.position); toast('The note in the bottle is too faded to read. There were a few coins inside, though'); return; }
    state.tmap = M;
    sfx('find');
    haptic();
    for (const d of dogs) journalAdd(d, 'bottle1', '🍾', 'Found a message in a bottle with you on the beach');
    openTreasureMap();
    save();
  }
  // the map: a torn, hand-drawn sketch of the place around the X
  function drawTreasureMap(c, M) {
    const sc = sceneOf(M.loc), x = c.getContext('2d'), N = c.width;
    const cx = (M.x + M.mark.x) / 2, cz = (M.z + M.mark.z) / 2, span = 18;
    const W = (wx) => ((wx - cx) / span + 0.5) * N, H = (wz) => ((wz - cz) / span + 0.5) * N;
    x.fillStyle = '#efe0bd'; x.fillRect(0, 0, N, N);
    const cell = N / 48;
    for (let j = 0; j < 48; j++) for (let i = 0; i < 48; i++) {
      const wx = cx + ((i + 0.5) / 48 - 0.5) * span, wz = cz + ((j + 0.5) / 48 - 0.5) * span;
      let col = null;
      if (sc.inside && !sc.inside(wx, wz)) col = '#cdb98f';
      else if (sc.ponds.some((p) => wx > p.x0 && wx < p.x1 && wz > p.z0 && wz < p.z1)) col = '#9cc3d5';
      else if (sc.colliders.some((cc) => (cc.r !== undefined ? (wx - cc.x) ** 2 + (wz - cc.z) ** 2 < cc.r * cc.r : wx > cc.x0 && wx < cc.x1 && wz > cc.z0 && wz < cc.z1))) col = '#7f8f5a';
      else if (sc.onPath && sc.onPath(wx, wz)) col = '#dcc79a';
      else if (sc.height) { const h = sc.height(wx, wz); if (h > 0.6) col = '#d9c48f'; else if (h < -0.4) col = '#c7b27f'; }
      if (col) { x.fillStyle = col; x.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5); }
    }
    // pencil texture
    x.globalAlpha = 0.08; x.fillStyle = '#5d4037';
    const r = ART.mulberry32(hashStr(M.loc + M.x));
    for (let k = 0; k < 140; k++) x.fillRect(r() * N, r() * N, 1 + r() * 6, 1);
    x.globalAlpha = 1;
    x.font = `${Math.round(N / 9)}px serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(M.mark.ic, W(M.mark.x), H(M.mark.z));
    x.strokeStyle = '#c62828'; x.lineWidth = N / 40; x.lineCap = 'round';
    const X = W(M.x), Y = H(M.z), s = N / 26;
    x.beginPath(); x.moveTo(X - s, Y - s); x.lineTo(X + s, Y + s); x.moveTo(X + s, Y - s); x.lineTo(X - s, Y + s); x.stroke();
    // a dotted trail from the landmark
    x.setLineDash([N / 60, N / 50]); x.lineWidth = N / 110; x.strokeStyle = '#6d4c41';
    x.beginPath(); x.moveTo(W(M.mark.x), H(M.mark.z) + N / 18); x.quadraticCurveTo((W(M.mark.x) + X) / 2 + N / 10, (H(M.mark.z) + Y) / 2, X, Y); x.stroke(); x.setLineDash([]);
    // north
    x.fillStyle = '#5d4037'; x.font = `bold ${Math.round(N / 16)}px serif`; x.fillText('N', N - N / 12, N / 9); x.fillText('▲', N - N / 12, N / 5.2);
    // torn edges
    x.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 4; k++) for (let t = 0; t < N; t += 6) { const d = 2 + r() * 7; if (k === 0) x.fillRect(t, 0, 7, d); if (k === 1) x.fillRect(t, N - d, 7, d); if (k === 2) x.fillRect(0, t, d, 7); if (k === 3) x.fillRect(N - d, t, d, 7); }
    x.globalCompositeOperation = 'source-over';
  }
  function openTreasureMap() {
    const M = state.tmap;
    if (!M) { toast('You don’t have a treasure map right now'); return; }
    drawTreasureMap($('tmapCanvas'), M);
    $('tmapNote').textContent = M.note;
    $('tmapPlace').textContent = `${D.LOCATIONS[M.loc].icon} ${D.LOCATIONS[M.loc].name}`;
    $('tmapSheet').classList.remove('hidden');
    tip('tmap', { title: 'A treasure map', text: 'Go to the place on the map, find the landmark, and stand where the X is. A Dig button shows up when you’re close. You can look at the map again in your Bag.', icon: 'map' });
  }
  $('tmapClose').addEventListener('click', () => $('tmapSheet').classList.add('hidden'));
  const nearTreasure = (pp) => state.tmap && place === 'park' && loc === state.tmap.loc && Math.hypot(pp.x - state.tmap.x, pp.z - state.tmap.z) < 2;
  function digTreasure() {
    const M = state.tmap, d = selected && dogs.includes(selected) ? selected : dogs[0];
    if (!M || !d) return;
    state.tmap = null;
    const at = new V3(M.x, groundAt(M.x, M.z), M.z);
    let t = 0, dug = false;
    d.free = true;
    d.doAct('none', (dt) => {
      t += dt;
      if (!dug) {
        if (d.stepTo(at.x, at.z, 3, dt) > 0.5 && t < 4) return true;
        dug = true; t = 0; d.act.pose = 'dig'; d.faceTo(at);
        return true;
      }
      if (t < 2.2) { if (Math.random() < dt * 6) spawnEmoji('🟫', d.headWorld(-0.4), { size: 0.18, life: 0.5, vy: 1.2 }); return true; }
      d.free = false;
      const coins = D.BOTTLE.coins[0] + Math.floor(Math.random() * (D.BOTTLE.coins[1] - D.BOTTLE.coins[0]));
      addCoins(coins, at.clone().add(new V3(0, 0.6, 0)));
      const extra = [];
      if (Math.random() < D.BOTTLE.findChance) { const f = rollFind(loc); if (f) { grantFind(f, at.clone().add(new V3(0, 1, 0))); extra.push(D.FINDS[f].name); } }
      if (unlockedFeat('farming')) { const g = seedGift(2); claimGift(g); extra.push(giftText(g)); }
      state.stats.mapsDug = (state.stats.mapsDug || 0) + 1;
      progress('treasuremap');
      confetti(at.clone().add(new V3(0, 1, 0)), 8);
      sfx('unlock');
      haptic('strong');
      news({ title: 'Treasure!', text: `${d.name} dug up a little chest: 🪙 ${coins}${extra.length ? ', ' + extra.join(', ') : ''}.`, th: TH('pic', '🗺️') });
      for (const x of dogs) journalAdd(x, null, '🗺️', `Dug up the treasure from a bottle map in ${LOC().name}`);
      save();
      return false;
    }, 'Digging for treasure ⛏️');
  }

  // ----- dog sitting -----
  let sitDog = null, sitOwner = null;
  class SitDog extends Dog {
    constructor(data, N) {
      super(Object.assign({ born: Date.now() - 400 * DAY, grown: true, revealed: true, happy: 75, hunger: 70, thirst: 70, energy: 80, clean: 85 }, N.dog, data, { id: 'n:' + N.dog.name }));
      this.npc = true;
      this.sitting = N;
      const label = textSprite(`${this.name} (${N.owner}’s)`, 0.26);
      label.position.y = this.headBaseY + 0.62;
      this.root.add(label);
    }
    addBond() { /* not yours to keep */ }
  }
  function acceptSitting(owner) {
    const N = D.NEIGHBORS.find((x) => x.owner === owner);
    if (!N || state.sitting) return;
    state.sitting = { owner, pending: true, until: 0, walks: 0, petted: 0, data: null };
    if (place === 'home') sitArrive();
    else toast(`${owner} will drop ${N.dog.name} off at your home`);
    save();
  }
  function sitArrive() {
    const T = state.sitting;
    const N = T && D.NEIGHBORS.find((x) => x.owner === T.owner);
    if (!N || sitDog) return;
    if (T.pending) { T.pending = false; T.until = Date.now() + D.SIT.minutes * 60000; }
    sitDog = new SitDog(T.data || {}, N);
    sitDog.root.position.copy(freeNear(CHUNK / 2 + 0.6, CHUNK - 1.6));
    world.add(sitDog.root);
    sitDog.idle(1);
    if (!T.told) {
      T.told = true;
      const q = D.SIT_QUIRKS[N.dog.traits[0]];
      news({ title: `${N.dog.name} is staying with you`, text: `${T.owner} dropped ${N.dog.name} off for a day (about an hour). ${N.dog.name} ${q}. Feed, walk and cuddle ${N.dog.name}, and ${T.owner} will be back to pick ${N.dog.name} up.`, th: TH('dog', `${N.dog.breed}|${N.dog.coat}`) });
      tip('sitting', { title: 'Dog sitting', text: 'A neighbor’s dog stays with you for a while. It comes on walks on its own leash, eats from your bowls and gets to know your dogs (not every pair gets along). Look after it well for a bigger thank-you.', icon: 'dog' });
    }
  }
  function sitLeave() {
    if (sitDog) { world.remove(sitDog.root); world.remove(sitDog.leash); sitDog = null; }
    if (sitOwner) { sitOwner.root.parent && sitOwner.root.parent.remove(sitOwner.root); sitOwner = null; }
  }
  // time's up: the owner comes to the door
  function sittingTick() {
    const T = state.sitting;
    if (!T) return;
    if (T.pending) { if (place === 'home') sitArrive(); return; }
    if (sitDog) T.data = { hunger: sitDog.hunger, thirst: sitDog.thirst, energy: sitDog.energy, happy: sitDog.happy, clean: sitDog.clean };
    if (Date.now() > T.until && !T.ready) {
      T.ready = true;
      const N = D.NEIGHBORS.find((x) => x.owner === T.owner);
      news({ title: `${T.owner} is back`, text: `${T.owner} is waiting at your front door to pick up ${N.dog.name}.`, th: `<img class="th" src="${ART.personPortraitURL(N)}" alt="">` });
    }
    if (T.ready && place === 'home' && !sitOwner) {
      const N = D.NEIGHBORS.find((x) => x.owner === T.owner);
      sitOwner = ART.buildPlayer({ shirt: N.shirt, hair: N.hair });
      sitOwner.root.position.copy(freeNear(CHUNK / 2 - 0.8, CHUNK - 0.8));
      sitOwner.root.rotation.y = Math.PI;
      const lb = textSprite(N.owner, 0.3); lb.position.y = 2.15; sitOwner.root.add(lb);
      homeRoot.add(sitOwner.root);
    }
  }
  const nearSitOwner = (pp) => sitOwner && place === 'home' && flatDist(sitOwner.root.position, pp) < 2.4;
  function finishSitting() {
    const T = state.sitting, N = T && D.NEIGHBORS.find((x) => x.owner === T.owner);
    if (!T || !N) return;
    const d = sitDog || { happy: (T.data || {}).happy || 60, hunger: (T.data || {}).hunger || 60 };
    let score = 0;
    if (T.walks >= 1) score++;
    if (T.petted >= 3) score++;
    if (d.happy >= 60) score++;
    if (d.hunger >= 45 && d.thirst >= 40) score++;
    const coins = D.SIT.coins[0] + score * Math.round((D.SIT.coins[1] - D.SIT.coins[0]) / 4);
    addCoins(coins, player.root.position);
    addNFriend(T.owner, 8 + score * 3);
    if (sitDog) for (const x of dogs) addFriendship(x, sitDog, 3 + score);
    for (const x of dogs) journalAdd(x, null, '🐕', `Looked after ${N.dog.name} for ${T.owner} together with you`);
    state.stats.sits = (state.stats.sits || 0) + 1;
    progress('sitting');
    const misses = [T.walks < 1 && 'a walk', T.petted < 3 && 'more cuddles', !(d.hunger >= 45) && 'a full bowl'].filter(Boolean);
    toast(`${T.owner}: ${nfill(pick(D.SIT_THANKS), N)} +🪙 ${coins}`);
    if (misses.length) setTimeout(() => toast(`Next time ${N.dog.name} would like ${misses.join(' and ')}`), 2600);
    confetti(player.root.position.clone().add(new V3(0, 1.4, 0)), 4);
    state.sitting = null;
    sitLeave();
    save();
  }

  // ----- your name -----
  function askName() {
    $('playerNameInput').value = youName();
    $('nameAsk').classList.remove('hidden');
    setTimeout(() => { try { $('playerNameInput').focus(); } catch (_) { /* fine */ } }, 200);
  }
  const cleanName = (v) => String(v || '').replace(/[<>{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  $('nameSave').addEventListener('click', () => { state.playerName = cleanName($('playerNameInput').value); state.nameAsked = true; $('nameAsk').classList.add('hidden'); if (youName()) toast(`Nice to meet you, ${youName()}! 🐾`); save(); });
  $('nameSkip').addEventListener('click', () => { state.nameAsked = true; $('nameAsk').classList.add('hidden'); toast('You can add a name any time in Menu → You'); save(); });
  // the name tag in photos (optional)
  let nameTag = null;
  function updateNameTag() {
    const want = !!(state.photoName && youName() && document.body.classList.contains('photo') && player.root.visible);
    if (want && (!nameTag || nameTag.userData.n !== youName())) {
      if (nameTag) player.root.remove(nameTag);
      nameTag = textSprite(youName(), 0.34);
      nameTag.userData.n = youName();
      nameTag.position.y = 2.2;
      player.root.add(nameTag);
    }
    if (nameTag) nameTag.visible = want;
    $('photoName').classList.toggle('off', !state.photoName);
    $('photoName').classList.toggle('hidden', !youName());
  }
  $('photoName').addEventListener('click', () => { state.photoName = !state.photoName; updateNameTag(); save(); });

  // ----- glue for the hobbies: the context button, the slow tick, walks -----
  let walkStartT = 0;
  function hobbyCtx(pp) {
    if (fun || mode !== 'normal' || visit || title) return null;
    if (place === 'home') {
      if (nearSitOwner(pp)) return 'pickup';
      if (bedSpot()) return 'bed';
      return null;
    }
    if (nearTreasure(pp)) return 'treasure';
    if (nearBottle(pp)) return 'bottle';
    if (ringAt(pp)) return 'run';
    if (nearBooth(pp) && tourneyToday()) return 'enter';
    if (nearDucks(pp)) return 'ducks';
    return null;
  }
  function hobbyAction(k) {
    switch (k) {
      case 'pickup': finishSitting(); return true;
      case 'bed': digBed(); return true;
      case 'treasure': digTreasure(); return true;
      case 'bottle': pickBottle(); return true;
      case 'run': { const id = ringAt(player.root.position); if (id) startAgility(groundsCourse(id)); return true; }
      case 'enter': enterTourney(); return true;
      case 'ducks': feedDucks(); return true;
      default: return false;
    }
  }
  let hobbyT = 0, bedTask = null;
  function hobbySlow() {
    if (visit || title) return;
    growBeds();
    mailTick();
    sittingTick();
    // letters open up: your first mailbox is a present
    if (unlockedFeat('letters') && !state.mailboxGiven) {
      state.mailboxGiven = true;
      if (!hasItem('mailbox')) state.inventory.mailbox = (state.inventory.mailbox || 0) + 1;
      news({ title: 'A mailbox for you', text: 'Place it at home (Menu → Decorate). Write to the neighbors you’ve chatted with, and they write back the next day.', th: thumbOf.item('mailbox') });
    }
  }
  function hobbyUpdate(dt) {
    if (place === 'park') { updateDucks(dt); if (bottle) { bottle.t += dt; bottle.g.position.y = groundAt(bottle.x, bottle.z) + Math.abs(Math.sin(bottle.t * 1.6)) * 0.05; } }
    if (sitDog) { sitDog.update(dt); sitDog.updateLeash(); }
    if (bedTask) {
      const c = new V3(bedTask.i + 0.5, 0, bedTask.j + 0.5);
      if (flatDist(player.root.position, c) < 1.4) { player.moveTarget = null; openBed(bedTask); bedTask = null; }
      else if (!player.moveTarget) bedTask = null;
    }
    hobbyT -= dt;
    if (hobbyT <= 0) { hobbyT = 2; hobbySlow(); }
  }


  // =====================================================================
  // Baking: roll out dough, press cookie cutters into it (as many as fit), ice one, and into the oven.
  // Treats go in a tin (state.treats) and are given from the dog's treat sheet.
  // =====================================================================
  let bake = null;
  const treats = () => (state.treats = state.treats || {});
  const haveBake = (B) => Object.entries(B.needs).every(([k, n]) => (state.pantry[k] || 0) >= n);
  // cutter outlines in a box from -1 to 1
  function cutterPath(x, shape, cx, cy, s) {
    x.beginPath();
    const P = (u, v) => [cx + u * s, cy + v * s];
    switch (shape) {
      case 'bone': {
        for (const [u, v] of [[-0.62, -0.28], [-0.62, 0.28], [0.62, -0.28], [0.62, 0.28]]) { const [a, b] = P(u, v); x.moveTo(a + 0.3 * s, b); x.arc(a, b, 0.3 * s, 0, TAU); }
        const [a, b] = P(-0.62, -0.2); x.rect(a, b, 1.24 * s, 0.4 * s);
        break;
      }
      case 'paw': {
        const [a, b] = P(0, 0.25); x.moveTo(a + 0.48 * s, b); x.ellipse(a, b, 0.48 * s, 0.4 * s, 0, 0, TAU);
        for (const [u, v] of [[-0.62, -0.25], [-0.22, -0.62], [0.22, -0.62], [0.62, -0.25]]) { const [c, d] = P(u, v); x.moveTo(c + 0.2 * s, d); x.arc(c, d, 0.2 * s, 0, TAU); }
        break;
      }
      case 'heart': {
        const [a, b] = P(0, 0.85); x.moveTo(a, b);
        x.bezierCurveTo(...P(-1.1, 0.1), ...P(-0.75, -0.95), ...P(0, -0.4));
        x.bezierCurveTo(...P(0.75, -0.95), ...P(1.1, 0.1), a, b);
        break;
      }
      case 'star': {
        for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.42 : 0.95, an = -Math.PI / 2 + (k * Math.PI) / 5; const [a, b] = P(Math.cos(an) * r, Math.sin(an) * r); if (k) x.lineTo(a, b); else x.moveTo(a, b); }
        x.closePath();
        break;
      }
      case 'drop': {
        const [a, b] = P(0, -0.95); x.moveTo(a, b);
        x.bezierCurveTo(...P(0.25, -0.5), ...P(0.75, 0.05), ...P(0.75, 0.35));
        x.arc(cx, cy + 0.35 * s, 0.75 * s, 0, Math.PI);
        x.bezierCurveTo(...P(-0.75, 0.05), ...P(-0.25, -0.5), a, b);
        break;
      }
      default: { // fish
        const [a, b] = P(0.95, -0.45); x.moveTo(a, b);
        x.lineTo(...P(0.5, 0)); x.lineTo(...P(0.95, 0.45));
        x.bezierCurveTo(...P(0.4, 0.15), ...P(0.05, 0.6), ...P(-0.45, 0.5));
        x.bezierCurveTo(...P(-0.95, 0.4), ...P(-0.95, -0.4), ...P(-0.45, -0.5));
        x.bezierCurveTo(...P(0.05, -0.6), ...P(0.4, -0.15), a, b);
      }
    }
  }
  const DOUGH = { x0: 26, x1: 294, y0: 70, y1: 262, r: 31 };
  function openBake() {
    if (!needRank('baking')) return;
    bake = null;
    renderBakeList();
    $('bake').classList.remove('hidden');
    tip('baking', { title: 'Baking', text: 'Press the cutter into the dough as often as it fits (no overlapping!). Then pipe icing along the dotted line on one of them. More cutters, more treats.', icon: 'oven' });
  }
  function renderBakeList() {
    $('bakeGame').classList.add('hidden');
    const L = $('bakeList');
    L.classList.remove('hidden');
    const have = Object.entries(state.pantry).filter(([, n]) => n > 0);
    $('bakePantry').innerHTML = have.length ? `<span class="lbl">Pantry</span>${have.map(([k, n]) => `<span class="ingr">${thumbOf.ing(k)}<b>${n}</b></span>`).join('')}` : 'Your pantry is empty. Grow crops in your garden, or buy basics in the Shop.';
    L.innerHTML = Object.entries(D.BAKES).map(([id, B]) => {
      const needs = Object.entries(B.needs).map(([k, n]) => `<span class="ingr${(state.pantry[k] || 0) < n ? ' miss' : ''}">${thumbOf.ing(k)}${n > 1 ? `<b>×${n}</b>` : ''}</span>`).join('');
      return `<div class="row"><div class="ic">${thumbOf.pic(B.icon)}</div><div class="txt"><b>${esc(B.name)}</b><small>${esc(B.desc)}${treats()[id] ? ` · ${treats()[id]} in the tin` : ''}</small><span class="needs">${needs}</span></div><button class="buy" data-bake="${id}"${haveBake(B) ? '' : ' disabled'}>Bake</button></div>`;
    }).join('');
  }
  function startBake(id) {
    const B = D.BAKES[id];
    if (!B || !haveBake(B)) return;
    for (const [k, n] of Object.entries(B.needs)) state.pantry[k] -= n;
    bake = { id, phase: 'cut', cuts: [], ice: null, hover: null };
    $('bakeList').classList.add('hidden');
    $('bakeGame').classList.remove('hidden');
    $('bakeNext').textContent = 'Into the oven';
    $('bakeNext').disabled = true;
    $('bakeHint').textContent = `Tap the dough to press the ${B.shape} cutter. As many as fit, without overlapping.`;
    drawBake();
    save();
  }
  function drawBake() {
    const c = $('bakeCanvas'), x = c.getContext('2d'), B = D.BAKES[bake.id];
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = '#c99a6b'; x.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < 14; k++) { x.fillStyle = k % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)'; x.fillRect(0, k * 23, c.width, 11); }
    if (bake.phase === 'cut') {
      // the dough
      x.fillStyle = '#f3dcb1';
      x.beginPath(); x.roundRect ? x.roundRect(DOUGH.x0, DOUGH.y0, DOUGH.x1 - DOUGH.x0, DOUGH.y1 - DOUGH.y0, 22) : x.rect(DOUGH.x0, DOUGH.y0, DOUGH.x1 - DOUGH.x0, DOUGH.y1 - DOUGH.y0); x.fill();
      x.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 18; k++) x.fillRect(DOUGH.x0 + ((k * 53) % (DOUGH.x1 - DOUGH.x0 - 8)), DOUGH.y0 + ((k * 37) % (DOUGH.y1 - DOUGH.y0 - 6)), 5, 3);
      for (const [px, py] of bake.cuts) {
        cutterPath(x, B.shape, px, py, DOUGH.r * 0.92);
        x.fillStyle = '#e8c48c'; x.fill(); x.strokeStyle = '#b8864f'; x.lineWidth = 2.5; x.stroke();
      }
      if (bake.hover) {
        const [hx, hy] = bake.hover, ok = cutFits(hx, hy);
        cutterPath(x, B.shape, hx, hy, DOUGH.r * 0.92);
        x.strokeStyle = ok ? '#5d8a3a' : '#d84a3a'; x.lineWidth = 3; x.setLineDash([6, 5]); x.stroke(); x.setLineDash([]);
      }
      x.fillStyle = '#5b3d22'; x.font = 'bold 18px system-ui, sans-serif'; x.textAlign = 'center';
      x.fillText(`${bake.cuts.length} of ${D.BAKE.dough}`, c.width / 2, 40);
    } else if (bake.phase === 'ice') {
      // one big treat, a dotted line to pipe along
      cutterPath(x, B.shape, 160, 165, 118);
      x.fillStyle = '#e8c48c'; x.fill(); x.strokeStyle = '#b8864f'; x.lineWidth = 4; x.stroke();
      x.fillStyle = 'rgba(91,61,34,.45)';
      for (const [gx, gy] of bake.ice.guide) { x.beginPath(); x.arc(gx, gy, 2.6, 0, TAU); x.fill(); }
      x.strokeStyle = bake.ice.col; x.lineWidth = 9; x.lineCap = 'round'; x.lineJoin = 'round';
      for (const st of bake.ice.strokes) { x.beginPath(); st.forEach(([a, b], k) => (k ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke(); }
    } else {
      // the oven
      x.fillStyle = '#4a4a52'; x.fillRect(30, 50, 260, 220);
      x.fillStyle = '#2b2b31'; x.fillRect(50, 80, 220, 150);
      const t = clamp(bake.ovenT / 2.2, 0, 1);
      x.fillStyle = `rgba(255,${Math.round(150 - t * 60)},40,${0.25 + t * 0.4})`; x.fillRect(50, 80, 220, 150);
      for (let k = 0; k < Math.min(bake.cuts.length, 8); k++) { cutterPath(x, B.shape, 85 + (k % 4) * 50, 130 + Math.floor(k / 4) * 55, 20); x.fillStyle = `rgb(${Math.round(232 - t * 40)},${Math.round(196 - t * 60)},${Math.round(140 - t * 70)})`; x.fill(); }
      x.fillStyle = '#ffffff'; x.font = 'bold 18px system-ui, sans-serif'; x.textAlign = 'center';
      x.fillText(t < 1 ? 'Baking…' : 'Done!', 160, 255);
    }
  }
  function cutFits(px, py) {
    const r = DOUGH.r;
    if (px - r < DOUGH.x0 + 4 || px + r > DOUGH.x1 - 4 || py - r < DOUGH.y0 + 4 || py + r > DOUGH.y1 - 4) return false;
    return bake.cuts.every(([a, b]) => Math.hypot(a - px, b - py) >= r * 1.95);
  }
  function bakeCut(px, py) {
    if (!bake || bake.phase !== 'cut') return;
    if (bake.cuts.length >= D.BAKE.dough) return;
    if (!cutFits(px, py)) { sfx('tap'); haptic('light'); $('bakeHint').textContent = 'That one doesn’t fit there. Leave a little gap.'; return; }
    bake.cuts.push([px, py]);
    sfx('tap');
    $('bakeNext').disabled = false;
    $('bakeNext').textContent = bake.cuts.length >= D.BAKE.dough ? 'Ice one' : `Ice one (${bake.cuts.length})`;
    $('bakeHint').textContent = bake.cuts.length >= D.BAKE.dough ? 'The tray is full! Now ice one of them.' : 'Keep going, or ice one now.';
    drawBake();
  }
  const ICE_COLS = ['#ffffff', '#f8bbd0', '#b3e5fc', '#fff59d'];
  function bakeToIce() {
    // the dotted icing line: a zigzag, a wave or a loop, depending on the treat
    const pat = ['zigzag', 'wave', 'loop'][Object.keys(D.BAKES).indexOf(bake.id) % 3], guide = [];
    for (let k = 0; k <= 60; k++) {
      const t = k / 60;
      if (pat === 'loop') { const a = t * TAU * 1.0; guide.push([160 + Math.cos(a) * 48 * (1 - t * 0.35), 165 + Math.sin(a) * 40 * (1 - t * 0.35)]); }
      else if (pat === 'wave') guide.push([95 + t * 130, 165 + Math.sin(t * TAU * 1.5) * 28]);
      else { const z = (t * 4) % 1; guide.push([95 + t * 130, 165 + (z < 0.5 ? z : 1 - z) * 4 * 30 - 30]); }
    }
    bake.phase = 'ice';
    bake.ice = { guide, strokes: [], hit: new Set(), ink: 0, stray: 0, col: pick(ICE_COLS) };
    $('bakeNext').textContent = 'Into the oven';
    $('bakeNext').disabled = true;
    $('bakeHint').textContent = 'Pipe icing along the dotted line with your finger.';
    drawBake();
  }
  function iceAt(px, py, start) {
    const I = bake && bake.phase === 'ice' && bake.ice;
    if (!I) return;
    if (start || !I.strokes.length) I.strokes.push([]);
    I.strokes[I.strokes.length - 1].push([px, py]);
    let near = false;
    I.guide.forEach(([gx, gy], k) => { if (Math.hypot(gx - px, gy - py) < 14) { I.hit.add(k); near = true; } });
    I.ink++;
    if (!near) I.stray++;
    if (I.hit.size > I.guide.length * 0.4) $('bakeNext').disabled = false;
    drawBake();
  }
  const iceScore = () => { const I = bake.ice; return clamp((I.hit.size / I.guide.length) * (1 - 0.6 * (I.stray / Math.max(1, I.ink))), 0, 1); };
  function bakeOven() {
    if (!bake || bake.phase !== 'ice') return;
    const acc = iceScore();
    bake.stars = acc >= D.BAKE.icingGood ? 3 : acc >= 0.55 ? 2 : 1;
    bake.phase = 'oven';
    bake.ovenT = 0;
    $('bakeNext').disabled = true;
    $('bakeHint').textContent = 'Mmm, it smells amazing…';
    sfx('bubble');
  }
  function bakeTick(dt) {
    if (!bake || bake.phase !== 'oven') return;
    bake.ovenT += dt;
    drawBake();
    if (bake.ovenT >= 2.4 && !bake.done) finishBake();
  }
  function finishBake() {
    const B = D.BAKES[bake.id];
    bake.done = true;
    const n = bake.cuts.length + (bake.stars - 1);
    treats()[bake.id] = (treats()[bake.id] || 0) + n;
    state.stats.baked = (state.stats.baked || 0) + n;
    weekStat('baked', n);
    earn('bake');
    progress('bake');
    $('bakeHint').innerHTML = `${'★'.repeat(bake.stars)}${'☆'.repeat(3 - bake.stars)} · ${n} ${esc(B.name.toLowerCase())} in the tin${bake.stars === 3 ? ' (perfect icing: two extra!)' : bake.stars === 2 ? ' (nice icing: one extra)' : ''}. Give them from a dog’s card.`;
    $('bakeNext').textContent = 'Bake more';
    $('bakeNext').disabled = false;
    bake.phase = 'done';
    sfx('find');
    // the dogs smell it
    for (const d of dogs) if (d.state !== 'sleep' && Math.random() < 0.7) d.goTo(() => player.root.position, 2.6, () => { d.faceTo(player.root.position); spawnEmoji('🤤', d.headWorld(0.3), { size: 0.35 }); d.setState('sit', 3); }, 1.2);
    save();
  }
  (function bakeInput() {
    const c = $('bakeCanvas');
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    let down = false;
    c.addEventListener('pointerdown', (e) => {
      if (!bake) return;
      e.preventDefault();
      const p = pt(e);
      if (bake.phase === 'cut') { bake.hover = p; drawBake(); }
      if (bake.phase === 'ice') { down = true; iceAt(p[0], p[1], true); try { c.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } }
    });
    c.addEventListener('pointermove', (e) => {
      if (!bake) return;
      const p = pt(e);
      if (bake.phase === 'cut' && e.pointerType === 'mouse') { bake.hover = p; drawBake(); }
      if (bake.phase === 'ice' && down) iceAt(p[0], p[1], false);
    });
    c.addEventListener('pointerup', (e) => {
      if (!bake) return;
      if (bake.phase === 'cut') { const p = pt(e); bake.hover = null; bakeCut(p[0], p[1]); }
      down = false;
    });
    c.addEventListener('pointercancel', () => { down = false; });
  })();
  $('bake').addEventListener('click', (e) => {
    if (e.target.id === 'bake' || e.target.closest('[data-act="closeBake"]')) { if (bake && bake.phase !== 'done' && bake.phase !== 'oven' && bake.cuts.length) { bake.cuts.length = Math.max(1, bake.cuts.length); bake.stars = 1; bake.phase = 'oven'; finishBake(); } bake = null; $('bake').classList.add('hidden'); return; }
    const b = e.target.closest('[data-bake]');
    if (b) startBake(b.dataset.bake);
  });
  $('bakeNext').addEventListener('click', () => {
    if (!bake) return;
    if (bake.phase === 'cut') bakeToIce();
    else if (bake.phase === 'ice') bakeOven();
    else if (bake.phase === 'done') { bake = null; renderBakeList(); }
  });
  // giving a treat from the tin
  function giveTreat(d, id) {
    const B = D.BAKES[id];
    if (!B || !(treats()[id] > 0)) return;
    treats()[id]--;
    const E = B.effect;
    if (E.hunger) d.hunger = Math.min(100, d.hunger + E.hunger);
    if (E.energy) d.energy = Math.min(100, d.energy + E.energy);
    if (E.clean) d.clean = Math.min(100, d.clean + E.clean);
    if (E.happy) d.happy = Math.min(d.missing() ? CONFIG.MISS_CAP : 100, d.happy + E.happy * d.mod('mealJoy'));
    d.addBond(E.bond || 1);
    if (E.train) d.trainBoost = (d.trainBoost || 0) + E.train;
    if (E.zoom) d.zoomTreat = true;
    d.life.meals['bake:' + id] = (d.life.meals['bake:' + id] || 0) + 1;
    journalAdd(d, 'bake:' + id, B.icon, `Tasted homemade ${B.name.toLowerCase()} for the first time`);
    treatDog = d; progress('treat'); treatDog = null;
    spawnEmoji('😋', d.headWorld(0.4), { size: 0.45 });
    toast(`${d.name} loved the ${B.name.toLowerCase()}!${E.train ? ' Tricks come easier for a bit.' : E.zoom ? ' Ready to zoom round a course!' : ''}`);
    $('meals').classList.add('hidden');
    save();
  }

  // =====================================================================
  // The market in Old Town, on Saturdays and Sundays: set up a stall and serve the neighbors
  // =====================================================================
  let stall = null;
  const marketDay = () => D.MARKET.days.includes(clockNow.weekday);
  const marketSpot = () => (place === 'park' && loc === 'oldtown' && S && S.q && S.q.market ? S.q.market : null);
  function nearMarket(pp) {
    const M = marketSpot();
    return !!M && M.g.visible && unlockedFeat('market') && flatDist(pp, M.front) < 2.2;
  }
  // what you could sell: [key, name, thumb, how many, coins each]
  function marketStock() {
    const out = [];
    const hot = weekHot();
    const price = (k, base) => Math.round(base * (k === hot ? D.MARKET.hot : 1));
    for (const [k, G] of Object.entries(D.MARKET_GOODS)) {
      if (G.kind === 'pantry' && (state.pantry[k] || 0) > 0) out.push([k, D.INGREDIENTS[k].name, thumbOf.ing(k), state.pantry[k], price(k, G.base)]);
      if (G.kind === 'bouquet' && (state.bouquets || 0) > 0) out.push([k, G.name, thumbOf.pic(G.icon), state.bouquets, price(k, G.base)]);
      if (G.kind === 'painting') { const n = (state.paintings || []).filter((P) => !state.furniture.some((f) => f.pid === P.id)).length; if (n) out.push([k, G.name, thumbOf.pic(G.icon), n, price(k, G.base)]); }
    }
    for (const [k, B] of Object.entries(D.BAKES)) if (treats()[k] > 0) out.push(['t:' + k, B.name, thumbOf.pic(B.icon), treats()[k], price('t:' + k, B.price)]);
    return out;
  }
  function takeStock(k) {
    if (k.startsWith('t:')) { treats()[k.slice(2)]--; return; }
    const G = D.MARKET_GOODS[k];
    if (G.kind === 'pantry') state.pantry[k]--;
    else if (G.kind === 'bouquet') state.bouquets--;
    else if (G.kind === 'painting') {
      const P = (state.paintings || []).find((x) => !state.furniture.some((f) => f.pid === x.id));
      if (P) { state.paintings.splice(state.paintings.indexOf(P), 1); state.inventory.painting = Math.max(0, (state.inventory.painting || 0) - 1); }
    }
  }
  function openStall() {
    if (!needRank('market')) return;
    if (!marketDay()) { toast('The market is on Saturdays and Sundays'); return; }
    if (state.marketDay === clockNow.gameDay) { toast('You had your stall today already. See you next market day!'); return; }
    stall = { pick: new Set(), price: 1, phase: 'setup' };
    renderStall();
    $('stall').classList.remove('hidden');
    tip('market', { title: 'Your market stall', text: 'Pick up to six things to sell and a price. Then serve the customers: tap what they ask for before they lose patience. Cheap sells more, pricey earns more per sale.', icon: 'stall' });
  }
  function renderStall() {
    const B = $('stallBody');
    if (stall.phase === 'setup') {
      const stock = marketStock(), hot = weekHot();
      const hotName = hot ? (hot.startsWith('t:') ? D.BAKES[hot.slice(2)].name : D.INGREDIENTS[hot] ? D.INGREDIENTS[hot].name : D.MARKET_GOODS[hot].name) : '';
      B.innerHTML = `<p class="sub">${hot ? `This week everyone wants <b>${esc(hotName)}</b> (it sells for more). ` : ''}Pick up to ${D.MARKET.slots} things to sell.</p>` +
        (stock.length ? `<div class="stallGoods">${stock.map(([k, n, th, c, pr]) => `<button class="toyCard${stall.pick.has(k) ? ' sel' : ''}" data-good="${k}">${th}<b>${esc(n)}</b><small>×${c} · 🪙 ${pr}${k === hot ? ' 🔥' : ''}</small></button>`).join('')}</div>`
          : '<div class="empty">Nothing to sell yet. Harvest crops, bake treats, pick bouquets or paint.</div>') +
        `<div class="segs priceSegs">${D.MARKET.prices.map(([nm], i) => `<button class="seg${stall.price === i ? ' sel' : ''}" data-price="${i}">${nm}</button>`).join('')}</div>` +
        `<button class="primary" id="stallOpen"${stall.pick.size ? '' : ' disabled'}>Open the stall</button>`;
      return;
    }
    if (stall.phase === 'run') {
      B.innerHTML = `<div class="stallTop"><span>${IC('coin')} <b id="stEarn">${stall.earned}</b></span><span id="stClock">${Math.ceil(stall.left)}s</span><span>${IC('person')} ${stall.served}</span></div>` +
        `<div id="stQueue" class="stQueue"></div><div class="stallGoods run" id="stGoods"></div>`;
      renderStallRun();
      return;
    }
    B.innerHTML = `<div class="stallDone"><h3>Stall closed</h3><p>You served ${stall.served} customer${stall.served === 1 ? '' : 's'} and sold ${stall.sold} thing${stall.sold === 1 ? '' : 's'}.</p><p class="big">${IC('coin')} ${stall.earned}</p>${stall.lost ? `<p class="sub">${stall.lost} went home without anything.</p>` : ''}<button class="primary" data-act="closeStall">Pack up</button></div>`;
  }
  function renderStallRun() {
    const Q = $('stQueue'), G = $('stGoods');
    if (!Q) return;
    Q.innerHTML = stall.queue.map((c, i) => `<div class="cust${i ? '' : ' first'}${c.sad ? ' sad' : ''}"><img src="${ART.personPortraitURL(c.N)}" alt=""><div class="wish">${c.thumb}</div><div class="pat"><i style="width:${Math.round(clamp(c.pat / c.max, 0, 1) * 100)}%"></i></div><small>${esc(c.line)}</small></div>`).join('') || '<div class="empty">Waiting for customers…</div>';
    G.innerHTML = stall.goods.map(([k, n, th, , pr]) => `<button class="toyCard" data-sell="${k}"${stall.left > 0 && stall.count[k] > 0 ? '' : ' disabled'}>${th}<b>${esc(n)}</b><small>×${stall.count[k]} · 🪙 ${Math.round(pr * D.MARKET.prices[stall.price][1])}</small></button>`).join('');
  }
  function startStall() {
    const stock = marketStock().filter(([k]) => stall.pick.has(k));
    if (!stock.length) return;
    state.marketDay = clockNow.gameDay;
    stall.phase = 'run';
    stall.goods = stock;
    stall.count = Object.fromEntries(stock.map(([k, , , c]) => [k, c]));
    stall.left = D.MARKET.seconds;
    stall.queue = [];
    stall.next = 1.2;
    stall.earned = 0; stall.served = 0; stall.sold = 0; stall.lost = 0;
    // a happy dog at your stall draws a crowd
    stall.charm = 1 + Math.min(0.5, dogs.filter((d) => d.happy > 70).length * 0.12 + Math.max(0, ...dogs.map((d) => d.specAs('performer'))) * 0.1);
    renderStall();
    save();
  }
  function stallTick(dt) {
    if (!stall || stall.phase !== 'run' || $('stall').classList.contains('hidden')) return;
    stall.left -= dt;
    stall.next -= dt * stall.charm;
    const P = D.MARKET.prices[stall.price];
    if (stall.next <= 0 && stall.left > 4 && stall.queue.length < 3) {
      stall.next = rand(2.6, 4.6) / P[2];
      const have = stall.goods.filter(([k]) => stall.count[k] > 0);
      if (have.length) {
        const N = pick(D.NEIGHBORS);
        // mostly they want what you have; sometimes the hot item of the week
        const g = pick(have);
        const max = 8 * P[2] + (stall.price === 2 ? -1 : 0);
        stall.queue.push({ N, k: g[0], thumb: g[2], pat: max, max, line: pick(D.MARKET_LINES.hello) });
      }
    }
    for (const c of stall.queue) c.pat -= dt;
    const gone = stall.queue.filter((c) => c.pat <= 0);
    if (gone.length) { stall.lost += gone.length; stall.queue = stall.queue.filter((c) => c.pat > 0); }
    if (stall.left <= 0 || (!stall.goods.some(([k]) => stall.count[k] > 0) && !stall.queue.length)) { endStall(); return; }
    stall.ui = (stall.ui || 0) - dt;
    if (stall.ui <= 0) {
      stall.ui = 0.2;
      const cl = $('stClock'); if (cl) cl.textContent = `${Math.max(0, Math.ceil(stall.left))}s`;
      renderStallRun();
    }
  }
  function stallSell(k) {
    if (!stall || stall.phase !== 'run' || !(stall.count[k] > 0)) return;
    const c = stall.queue[0];
    if (!c) return;
    if (c.k !== k) { c.pat -= 1.5; c.line = 'Hmm, that’s not what I asked for…'; c.sad = true; sfx('tap'); renderStallRun(); return; }
    const g = stall.goods.find((x) => x[0] === k), P = D.MARKET.prices[stall.price];
    const coins = Math.round(g[4] * P[1]);
    stall.count[k]--;
    takeStock(k);
    stall.earned += coins;
    state.coins += coins;
    stall.served++; stall.sold++;
    stall.queue.shift();
    addNFriend(c.N.owner, 1);
    state.stats.sold = (state.stats.sold || 0) + 1;
    weekStat('sold', 1); weekStat('marketCoins', coins);
    sfx('coin');
    $('stEarn').textContent = stall.earned;
    renderStallRun();
    updateHud();
  }
  function endStall() {
    stall.phase = 'done';
    if (stall.sold) { earn('market'); progress('market'); }
    renderStall();
    save();
  }
  $('stall').addEventListener('click', (e) => {
    if (e.target.id === 'stall' || e.target.closest('[data-act="closeStall"]')) {
      if (stall && stall.phase === 'run') { endStall(); return; }
      stall = null; $('stall').classList.add('hidden'); return;
    }
    const g = e.target.closest('[data-good]');
    if (g && stall.phase === 'setup') { const k = g.dataset.good; if (stall.pick.has(k)) stall.pick.delete(k); else if (stall.pick.size < D.MARKET.slots) stall.pick.add(k); renderStall(); return; }
    const pr = e.target.closest('[data-price]');
    if (pr && stall.phase === 'setup') { stall.price = +pr.dataset.price; renderStall(); return; }
    if (e.target.closest('#stallOpen')) { startStall(); return; }
    const s2 = e.target.closest('[data-sell]');
    if (s2) stallSell(s2.dataset.sell);
  });

  // =====================================================================
  // The town museum. You lend finds (and paintings, and fish you caught) to themed halls.
  // Every game day the halls draw visitors; fresh exhibitions draw more. Your share of the tickets builds up.
  // =====================================================================
  const SEASON_FINDS = (() => { const o = {}; for (const S2 of Object.values(D.SEASONS)) for (const [k, n, ic] of S2.finds) o[k] = { name: n, icon: ic }; return o; })();
  const findInfo = (k) => D.FINDS[k] || SEASON_FINDS[k] || null;
  const museum = () => { const M = state.museum = state.museum || {}; for (const [k, v] of Object.entries({ halls: {}, visitors: 0, pending: 0, gd: clockNow.gameDay, log: [], fame: 0 })) if (M[k] === undefined) M[k] = v; return M; };
  const museumFame = () => { const v = museum().visitors; let f = 0; D.MUSEUM.fame.forEach((t, i) => { if (v >= t) f = i + 1; }); return f; };
  const hallOf = (id) => { const M = museum(); return (M.halls[id] = Object.assign({ slots: Array(D.MUSEUM.slots).fill(null), changed: clockNow.gameDay }, M.halls[id] || {})); };
  const hallOpen = (H) => museumFame() >= H.fame;
  // what a slot holds: f:<find>, p:<painting id>, x:<fish>
  function exhibitInfo(key) {
    if (!key) return null;
    const [t, id] = [key.slice(0, 1), key.slice(2)];
    if (t === 'f') { const F = findInfo(id); return F ? { name: F.name, th: TH('pic', F.icon), secret: !!(D.FINDS[id] && D.FINDS[id].secret) } : null; }
    if (t === 'p') { const P = (state.paintings || []).find((x) => x.id === id); return P ? { name: P.title || `Portrait of ${P.dog || 'a dog'}`, th: P.img ? `<img class="th" src="${P.img}" alt="">` : TH('pic', '🖼️'), secret: false } : null; }
    if (t === 'x') { const F = D.FISH[id]; return F ? { name: `${F.name} (${((state.fishCaught || {})[id] || {}).best || '?'} cm)`, th: TH('pic', F.icon), secret: !!F.rare } : null; }
    return null;
  }
  // everything you could put in a hall that isn't on show somewhere already
  function hallChoices(H) {
    const out = [];
    const shown = new Set();
    for (const h of D.MUSEUM_HALLS) for (const k of hallOf(h.id).slots) if (k) shown.add(k);
    if (H.locs) for (const [k, F] of Object.entries(D.FINDS)) if (H.locs.includes(F.loc) && state.finds[k] > 0) out.push('f:' + k);
    if (H.seasonal) for (const k of Object.keys(SEASON_FINDS)) if (state.finds[k] > 0) out.push('f:' + k);
    if (H.paintings) for (const P of state.paintings || []) out.push('p:' + P.id);
    if (H.fish) for (const [k, v] of Object.entries(state.fishCaught || {})) if (v && v.n && !D.FISH[k].junk) out.push('x:' + k);
    return out.filter((k) => !shown.has(k) && exhibitInfo(k));
  }
  function hallVisitors(H) {
    const h = hallOf(H.id), M = D.MUSEUM;
    const items = h.slots.filter(Boolean).map(exhibitInfo).filter(Boolean);
    if (!items.length) return 0;
    let v = items.length * M.perItem + items.filter((x) => x.secret).length * M.secretBonus;
    if (items.length >= M.slots) v *= M.fullBonus;
    const age = clockNow.gameDay - h.changed;
    const fresh = age <= M.freshDays ? 1 : Math.max(M.staleMin, 1 - (age - M.freshDays) * M.staleRate);
    return Math.round(v * fresh * (1 + 0.1 * museumFame()));
  }
  const hallFresh = (H) => { const age = clockNow.gameDay - hallOf(H.id).changed, M = D.MUSEUM; return age <= M.freshDays ? 1 : Math.max(M.staleMin, 1 - (age - M.freshDays) * M.staleRate); };
  // once a game day: count the visitors
  function museumTick() {
    if (visit || !unlockedFeat('museum')) return;
    const M = museum(), today = clockNow.gameDay;
    if (today <= M.gd) return;
    const days = Math.min(7, today - M.gd);
    M.gd = today;
    const per = D.MUSEUM_HALLS.filter(hallOpen).reduce((a, H) => a + hallVisitors(H), 0);
    if (!per) return;
    const before = museumFame();
    for (let k = 0; k < days; k++) { M.visitors += per; M.pending += per * D.MUSEUM.coinPer; M.log.push(per); weekStat('visitors', per); }
    M.log = M.log.slice(-14);
    state.stats.visitors = M.visitors;
    const after = museumFame();
    if (after > before) {
      M.fame = after;
      const R = D.MUSEUM_REWARDS[after];
      if (R) giveReward(R);
      const newHalls = D.MUSEUM_HALLS.filter((H) => H.fame === after - 1 && after - 1 > 0);
      news({ title: `The museum is getting famous! ${'★'.repeat(after)}`, text: `${M.visitors} visitors so far.${newHalls.length ? ` New hall${newHalls.length > 1 ? 's' : ''}: ${newHalls.map((H) => H.name).join(', ')}.` : ''}${R ? ` A thank-you from the museum: ${rewardText(R)}.` : ''}`, th: TH('pic', '🏛️') });
    }
  }
  function nearMuseum(pp) {
    return place === 'park' && loc === 'oldtown' && S && S.q && S.q.museum && unlockedFeat('museum') && flatDist(pp, S.q.museum.front) < 2.2;
  }
  let museumPick = null;   // [hall id, slot]
  function openMuseum() {
    if (!needRank('museum')) return;
    museumTick();
    museumPick = null;
    renderMuseum();
    $('museum').classList.remove('hidden');
    tip('museum', { title: 'The museum', text: 'Lend your finds to the halls (they stay in your book). Each hall draws visitors every day, more when it’s full and fresh, so swap things now and then. You get a share of the tickets.', icon: 'museum' });
  }
  function renderMuseum() {
    const M = museum(), fame = museumFame();
    const B = $('museumBody');
    if (museumPick) {
      const H = D.MUSEUM_HALLS.find((x) => x.id === museumPick[0]), h = hallOf(H.id), cur = h.slots[museumPick[1]];
      const ch = hallChoices(H);
      B.innerHTML = `<p class="sub">${esc(H.name)}: pick something for this spot.</p>` +
        (cur ? `<button class="soft" data-mtake="1">Take back ${esc(exhibitInfo(cur).name)}</button>` : '') +
        (ch.length ? `<div class="stallGoods">${ch.map((k) => { const I = exhibitInfo(k); return `<button class="toyCard" data-mput="${k}">${I.th}<b>${esc(I.name)}</b>${I.secret ? '<small>Rare</small>' : ''}</button>`; }).join('')}</div>` : `<div class="empty">Nothing that fits ${esc(H.name)} yet. ${H.paintings ? 'Paint your dogs at an easel.' : H.fish ? 'Find shells on the beach, or fish off the pier.' : 'Sniff out more finds on your walks.'}</div>`) +
        `<button class="soft" data-mback="1">Back</button>`;
      return;
    }
    const per = D.MUSEUM_HALLS.filter(hallOpen).reduce((a, H) => a + hallVisitors(H), 0);
    const log = M.log.slice(-7), mx = Math.max(10, ...log);
    let h = `<div class="musTop"><div><b>${'★'.repeat(fame)}${'☆'.repeat(5 - fame)}</b><small>${M.visitors} visitors in all</small></div><div><b>${per}</b><small>a day right now</small></div>` +
      `<button class="primary small" data-mcollect="1"${M.pending >= 1 ? '' : ' disabled'}>${IC('coin')} ${Math.floor(M.pending)}</button></div>`;
    if (log.length) h += `<div class="kChart">${log.map((v) => `<i style="height:${Math.round((v / mx) * 100)}%"><b>${v}</b></i>`).join('')}</div>`;
    for (const H of D.MUSEUM_HALLS) {
      if (!hallOpen(H)) { h += `<div class="row hall locked"><div class="ic">${TH('pic', H.icon)}</div><div class="txt"><b>${esc(H.name)}</b><small>Opens at ${'★'.repeat(H.fame)} museum fame</small></div></div>`; continue; }
      const hh = hallOf(H.id), fr = hallFresh(H);
      h += `<div class="hall"><div class="hallHead">${TH('pic', H.icon)}<div><b>${esc(H.name)}</b><small>${esc(H.blurb)}</small></div><span class="hallV">${hallVisitors(H)}/day</span></div>` +
        `<div class="fresh"><i style="width:${Math.round(fr * 100)}%"></i><small>${fr >= 1 ? 'Fresh' : fr > 0.7 ? 'Getting old' : 'Stale: swap something'}</small></div>` +
        `<div class="slots">${hh.slots.map((k, i) => { const I = exhibitInfo(k); return `<button class="slot${I ? ' on' : ''}" data-mslot="${H.id}:${i}">${I ? I.th : IC('plus')}</button>`; }).join('')}</div></div>`;
    }
    B.innerHTML = h;
  }
  $('museum').addEventListener('click', (e) => {
    if (e.target.id === 'museum' || e.target.closest('[data-act="closeMuseum"]')) { $('museum').classList.add('hidden'); return; }
    const M = museum();
    if (e.target.closest('[data-mcollect]')) { const n = Math.floor(M.pending); if (n > 0) { M.pending -= n; addCoins(n, null); toast(`🏛️ Your share of the tickets: ${n} coins`); earn('museum'); } renderMuseum(); save(); return; }
    const sl = e.target.closest('[data-mslot]');
    if (sl) { const [hid, i] = sl.dataset.mslot.split(':'); museumPick = [hid, +i]; renderMuseum(); return; }
    if (e.target.closest('[data-mback]')) { museumPick = null; renderMuseum(); return; }
    if (e.target.closest('[data-mtake]') && museumPick) { const h = hallOf(museumPick[0]); h.slots[museumPick[1]] = null; h.changed = clockNow.gameDay; museumPick = null; renderMuseum(); save(); return; }
    const put = e.target.closest('[data-mput]');
    if (put && museumPick) {
      const h = hallOf(museumPick[0]);
      h.slots[museumPick[1]] = put.dataset.mput;
      h.changed = clockNow.gameDay;
      museumPick = null;
      progress('museum');
      sfx('tap');
      renderMuseum();
      save();
    }
  });

  // =====================================================================
  // Catching critters with a net on walks. Caught ones live in your critter jar, or in a garden where they roam about.
  // =====================================================================
  const catchables = [];
  const caught = () => (state.caught = state.caught || {});
  const catchBook = () => (state.catchBook = state.catchBook || {});
  const exhibits = () => (state.exhibits = state.exhibits || {});
  function catchOk(C) {
    if (C.months && !C.months.includes(clockNow.month)) return false;
    const W = localWeather(), night = isNight();
    switch (C.when) {
      case 'night': return night;
      case 'day': return !night && !W.precip;
      case 'sun': return !night && weatherId === 'sun';
      case 'rain': return W.precip === 'rain';
      default: return true;
    }
  }
  function clearCatchables() { for (const c of catchables) c.g.parent && c.g.parent.remove(c.g); catchables.length = 0; }
  function catchPoint() {
    const B = S.bbox || { x0: -18, x1: 18, z0: -18, z1: 18 };
    for (let k = 0; k < 40; k++) {
      const x = rand(B.x0 + 2, B.x1 - 2), z = rand(B.z0 + 2, B.z1 - 2);
      if (isSolid(x, z) || inPond(x, z, 0.5) || (S.solid && S.solid(x, z))) continue;
      if (Math.hypot(x, z - 18) < 6) continue;
      return new V3(x, groundAt(x, z), z);
    }
    return null;
  }
  function spawnCatchables() {
    clearCatchables();
    if (!unlockedFeat('catching') || !hasGadget('net')) return;
    const here = Object.entries(D.CATCH).filter(([, C]) => C.where.includes(loc) && catchOk(C));
    if (!here.length) return;
    const [a, b] = D.CATCHING.perWalk;
    const n = a + Math.floor(Math.random() * (b - a + 1)) + (here.some(([k]) => k === 'firefly') ? 3 : 0);
    for (let k = 0; k < n; k++) {
      const [id, C] = pick(here);
      const p = catchPoint();
      if (!p) continue;
      const g = ART.buildCatchable(C);
      g.position.copy(p);
      parkRoot.add(g);
      let halo = null;
      if (C.glow) { halo = lightHalo(C.col, 0.6); halo.material.opacity = 0.8; g.add(halo); halo.position.y = C.fly ? 0 : 0.1; }
      catchables.push({ id, C, g, halo, home: p.clone(), rest: rand(1, 4), move: 0, from: null, to: null, t: Math.random() * 9 });
    }
  }
  function updateCatchables(dt) {
    if (!catchables.length) return;
    for (const c of catchables) {
      c.t += dt;
      const p = c.g.position, base = groundAt(p.x, p.z);
      // dogs running about scare them off
      if (!c.flee && dogs.some((d) => d.moving && d.curSpeed > 2.6 && flatDist(d.root.position, p) < D.CATCHING.scare)) { c.flee = true; c.move = 0; c.rest = 0; }
      if (c.rest > 0) {
        c.rest -= dt;
        if (c.C.fly) p.y = base + 0.5 + Math.sin(c.t * 2) * 0.03;
        if (c.rest <= 0) {
          const far = c.flee ? 4 : c.C.fly ? 2.4 : 0.8;
          let tx = p.x + rand(-far, far), tz = p.z + rand(-far, far);
          if (Math.hypot(tx - c.home.x, tz - c.home.z) > 5 && !c.flee) { tx = c.home.x + rand(-1, 1); tz = c.home.z + rand(-1, 1); }
          if (isSolid(tx, tz)) { tx = p.x; tz = p.z; }
          c.from = p.clone(); c.to = new V3(tx, 0, tz); c.move = 0;
        }
      } else if (c.to) {
        c.move += dt / (c.C.fly ? 1.4 : 2.2) * (c.flee ? 2 : 1);
        const t = Math.min(1, c.move);
        p.x = lerp(c.from.x, c.to.x, t); p.z = lerp(c.from.z, c.to.z, t);
        p.y = groundAt(p.x, p.z) + (c.C.fly ? 0.5 + Math.sin(t * Math.PI) * 0.6 + Math.sin(c.t * 9) * 0.05 : 0);
        c.g.rotation.y = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
        if (t >= 1) { c.to = null; c.flee = false; c.rest = rand(1.5, 4.5); }
      }
      const W = c.g.userData.wings;
      if (W) { const a = c.rest > 0 ? Math.sin(c.t * 3) * 0.3 : Math.sin(c.t * 30) * 0.8; W[0].rotation.z = a; W[1].rotation.z = -a; }
      if (c.halo) c.halo.material.opacity = 0.5 + Math.sin(c.t * 2.3) * 0.35;
    }
  }
  const nearCatchable = (pp) => (hasGadget('net') ? catchables.filter((c) => flatDist(c.g.position, pp) < D.CATCHING.reach).sort((a, b) => flatDist(a.g.position, pp) - flatDist(b.g.position, pp))[0] || null : null);
  function swingNet() {
    const pp = player.root.position, c = nearCatchable(pp);
    if (!c) return;
    player.face = Math.atan2(c.g.position.x - pp.x, c.g.position.z - pp.z);
    player.throwT = 0.35;
    sfx('whoosh');
    const resting = c.rest > 0 && !c.flee;
    if (Math.random() < (resting ? 0.88 : 0.25)) catchIt(c);
    else { c.flee = true; c.rest = 0; c.to = null; toast(resting ? 'Missed! Try again' : `The ${c.C.name.toLowerCase()} is on the move. Wait till it sits still`); }
  }
  function catchIt(c) {
    catchables.splice(catchables.indexOf(c), 1);
    c.g.parent && c.g.parent.remove(c.g);
    const first = !catchBook()[c.id];
    catchBook()[c.id] = (catchBook()[c.id] || 0) + 1;
    state.stats.critterKinds = Object.keys(catchBook()).length;
    earn('catch'); progress('catch');
    spawnEmoji(c.C.icon, player.headWorld ? player.headWorld(0.4) : player.root.position.clone().add(new V3(0, 2, 0)), { size: 0.5 });
    if (c.id === 'firefly') {
      state.fireflies = (state.fireflies || 0) + 1;
      if (state.fireflies % D.CATCHING.jar === 0) { state.inventory.fireflyjar = (state.inventory.fireflyjar || 0) + 1; news({ title: 'A firefly jar!', text: `${D.CATCHING.jar} fireflies make a lovely light. Put the jar up at home (Decorate).`, th: thumbOf.item('fireflyjar') }); }
      else toast(`✨ A firefly for your jar (${state.fireflies % D.CATCHING.jar} of ${D.CATCHING.jar})`);
    } else {
      caught()[c.id] = (caught()[c.id] || 0) + 1;
      toast(`${first ? 'New! ' : ''}You caught a ${c.C.name.toLowerCase()}. It’s in your critter jar (Bag → Critters)`);
    }
    for (const d of dogs) if (flatDist(d.root.position, player.root.position) < 4) { d.happy = Math.min(100, d.happy + 2); journalAdd(d, 'catch:' + c.id, c.C.icon, `Watched you catch a ${c.C.name.toLowerCase()}`); }
    save();
  }
  // ----- the critter garden: let your catches roam a garden at home -----
  const exhibitCap = (k) => {
    const [cx, cz] = k.split(',').map(Number);
    const extra = home().furniture.filter((f) => (f.type === 'terrarium' || f.type === 'insecthotel') && Math.floor(f.i / CHUNK) === cx && Math.floor(f.j / CHUNK) === cz).length * 4;
    return D.CATCHING.exhibit + extra;
  };
  const roamers = [];
  const exhibitGroup = pivot(homeRoot);
  function renderExhibits() {
    exhibitGroup.clear();
    roamers.length = 0;
    const H = home(), E = (H === state ? exhibits() : H.exhibits) || {};
    for (const [k, list] of Object.entries(E)) {
      const [cx, cz] = k.split(',').map(Number);
      if (!isGardenChunk(cx, cz)) continue;
      for (const id of list) {
        const C = D.CATCH[id];
        if (!C) continue;
        const g = ART.buildCatchable(C);
        const x = cx * CHUNK + rand(0.6, CHUNK - 0.6), z = cz * CHUNK + rand(0.6, CHUNK - 0.6);
        g.position.set(x, C.fly ? 0.6 : 0, z);
        exhibitGroup.add(g);
        let halo = null;
        if (C.glow) { halo = lightHalo(C.col, 0.5); halo.material.opacity = 0.7; g.add(halo); }
        roamers.push({ C, g, halo, cx, cz, rest: rand(0, 3), t: Math.random() * 9, to: null, from: null, move: 0 });
      }
    }
  }
  function updateRoamers(dt) {
    for (const c of roamers) {
      c.t += dt;
      const p = c.g.position;
      // the dogs chase them now and then; the critters flit off
      const chaser = dogs.find((d) => d.moving && flatDist(d.root.position, p) < 1.2);
      if (chaser && !c.to) c.rest = 0;
      if (c.rest > 0) { c.rest -= dt; if (c.C.fly) p.y = 0.6 + Math.sin(c.t * 2) * 0.04; }
      if (c.rest <= 0 && !c.to) {
        const x0 = c.cx * CHUNK + 0.4, x1 = (c.cx + 1) * CHUNK - 0.4, z0 = c.cz * CHUNK + 0.4, z1 = (c.cz + 1) * CHUNK - 0.4;
        const r = c.C.fly ? 2.2 : 0.7;
        c.from = p.clone(); c.to = new V3(clamp(p.x + rand(-r, r), x0, x1), 0, clamp(p.z + rand(-r, r), z0, z1)); c.move = 0;
      }
      if (c.to) {
        c.move += dt / (c.C.fly ? 1.5 : 2.6);
        const t = Math.min(1, c.move);
        p.x = lerp(c.from.x, c.to.x, t); p.z = lerp(c.from.z, c.to.z, t);
        p.y = c.C.fly ? 0.6 + Math.sin(t * Math.PI) * 0.5 : 0;
        c.g.rotation.y = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
        if (t >= 1) { c.to = null; c.rest = rand(1.5, 5); }
      }
      const W = c.g.userData.wings;
      if (W) { const a = c.to ? Math.sin(c.t * 30) * 0.8 : Math.sin(c.t * 3) * 0.3; W[0].rotation.z = a; W[1].rotation.z = -a; }
      if (c.halo) c.halo.material.opacity = (0.4 + Math.sin(c.t * 2.3) * 0.3) * (nightLevel > 0.3 ? 1.2 : 0.5);
    }
  }
  // a dog that loves to chase now and then goes after a critter in the garden
  function critterChaseIdea(d) {
    if (!roamers.length || !(d.flag('zooms') || d.flag('digs')) || Math.random() > 0.08) return false;
    const c = pick(roamers);
    d.goTo(() => c.g.position, 3.6, () => { d.faceTo(c.g.position); d.setState('happy', 1.2); spawnEmoji('❗', d.headWorld(0.3), { size: 0.35 }); }, 0.6);
    return true;
  }
  let critTab = 'jar';
  function openCritters() {
    if (!needRank('catching')) return;
    renderCritters();
    $('critters').classList.remove('hidden');
  }
  function renderCritters() {
    const B = $('critBody'), gardens = Object.keys(state.gardens || {}).filter((k) => state.chunks.some(([x, z]) => chunkKey(x, z) === k));
    $('critTabs').querySelectorAll('.seg').forEach((b) => b.classList.toggle('sel', b.dataset.ct === critTab));
    if (critTab === 'book') {
      const all = Object.entries(D.CATCH);
      B.innerHTML = `<p class="sub">${Object.keys(catchBook()).length} of ${all.length} kinds caught. ${state.fireflies ? `Fireflies caught: ${state.fireflies}.` : ''}</p><div class="stallGoods">` +
        all.map(([k, C]) => catchBook()[k] ? `<div class="toyCard">${TH('pic', C.icon)}<b>${esc(C.name)}</b><small>${C.where.map((l) => D.LOCATIONS[l] ? D.LOCATIONS[l].name : l).join(', ')}${C.when ? ` · ${C.when}` : ''}</small></div>` : `<div class="toyCard dim">${TH('pic', '❔')}<b>???</b><small>${C.where.filter(locUnlocked).length ? D.LOCATIONS[C.where.find(locUnlocked)].name : 'Somewhere new'}</small></div>`).join('') + '</div>';
      return;
    }
    const jar = Object.entries(caught()).filter(([, n]) => n > 0);
    let h = '';
    if (!gardens.length) h += '<p class="sub">Build a garden at home and your critters can roam in it.</p>';
    h += jar.length ? `<div class="section">In your jar</div>` + jar.map(([k, n]) => {
      const C = D.CATCH[k];
      return `<div class="row"><div class="ic">${TH('pic', C.icon)}</div><div class="txt"><b>${esc(C.name)} ×${n}</b><small>Let go: 🪙 ${C.value}</small></div>` +
        `<div class="btnCol">${gardens.length ? `<button class="small primary" data-cx="${k}">To the garden</button>` : ''}<button class="small soft" data-cfree="${k}">Let go</button></div></div>`;
    }).join('') : '<p class="sub">Your jar is empty. Catch critters on your walks with the net.</p>';
    for (const g of gardens) {
      const list = exhibits()[g] || [];
      h += `<div class="section">Garden ${gardens.indexOf(g) + 1}: ${list.length} of ${exhibitCap(g)}</div>`;
      h += list.length ? `<div class="stallGoods">${list.map((id, i) => `<button class="toyCard" data-cback="${g}:${i}">${TH('pic', D.CATCH[id].icon)}<b>${esc(D.CATCH[id].name)}</b><small>Tap to take back</small></button>`).join('')}</div>` : '<p class="sub">No critters here yet.</p>';
    }
    B.innerHTML = h;
  }
  $('critters').addEventListener('click', (e) => {
    if (e.target.id === 'critters' || e.target.closest('[data-act="closeCritters"]')) { $('critters').classList.add('hidden'); return; }
    const tb = e.target.closest('[data-ct]');
    if (tb) { critTab = tb.dataset.ct; renderCritters(); return; }
    const gardens = Object.keys(state.gardens || {}).filter((k) => state.chunks.some(([x, z]) => chunkKey(x, z) === k));
    const ex = e.target.closest('[data-cx]');
    if (ex) {
      const id = ex.dataset.cx;
      const g = gardens.find((k) => (exhibits()[k] || []).length < exhibitCap(k));
      if (!g) { toast('Your gardens are full of critters. A terrarium or a bug hotel makes room for more'); return; }
      (exhibits()[g] = exhibits()[g] || []).push(id);
      caught()[id]--;
      renderExhibits();
      toast(`${D.CATCH[id].name} is in the garden now`);
      renderCritters(); save(); return;
    }
    const fr = e.target.closest('[data-cfree]');
    if (fr) { const id = fr.dataset.cfree; caught()[id]--; addCoins(D.CATCH[id].value, null); toast(`Off it goes! (+🪙 ${D.CATCH[id].value} from the nature club)`); renderCritters(); save(); return; }
    const bk = e.target.closest('[data-cback]');
    if (bk) { const [g, i] = bk.dataset.cback.split(':'); const list = exhibits()[g] || []; const id = list.splice(+i, 1)[0]; if (id) caught()[id] = (caught()[id] || 0) + 1; renderExhibits(); renderCritters(); save(); }
  });

  // =====================================================================
  // Fishing off the pier: cast, wait for the bobber to dip, strike, then reel without snapping the line
  // =====================================================================
  const nearPier = (pp) => place === 'park' && loc === 'beach' && S && S.q && S.q.pier && flatDist(pp, S.q.pier.end) < 1.6;
  function fishPick() {
    const night = isNight();
    const pool = Object.entries(D.FISH).filter(([, F]) => (!F.months || F.months.includes(clockNow.month)) && (!F.when || (F.when === 'night') === night));
    let r = Math.random() * pool.reduce((a, [, F]) => a + F.weight, 0);
    for (const [k, F] of pool) { r -= F.weight; if (r <= 0) return k; }
    return pool[0][0];
  }
  function startFishing() {
    if (!needRank('fishing')) return;
    if (!hasGadget('rod')) { toast('You need a fishing rod (Shop → Gadgets)'); return; }
    if (fun) endFun('switch');
    const pp = player.root.position;
    player.face = Math.PI;   // out to sea
    const bob = new THREE.Group();
    box(bob, 0.14, 0.12, 0.14, '#e53935', 0, 0.06, 0); box(bob, 0.14, 0.08, 0.14, '#ffffff', 0, 0.16, 0);
    bob.visible = false;
    parkRoot.add(bob);
    let line;
    try { line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]), new THREE.LineBasicMaterial({ color: 0xffffff })); } catch (_) { line = new THREE.Group(); }
    line.visible = false;
    parkRoot.add(line);
    fun = { kind: 'fish', still: true, phase: 'cast', t: 0, p: 0, dir: 1, bob, line, onBtn: () => fishTap() };
    fun.end = () => { bob.parent && bob.parent.remove(bob); line.parent && line.parent.remove(line); $('funMeter').classList.remove('needle'); };
    funBar('Tap Cast when the marker is far right for a long cast', 'Cast', 0);
    $('funMeter').classList.add('needle');
    // the dogs settle down on the pier to watch
    dogs.forEach((d, i) => { if (d.offLeash) return; d.free = true; const sp = new V3(pp.x + (i % 2 ? 0.55 : -0.55), 0, pp.z + 0.9 + Math.floor(i / 2) * 0.7); d.doAct('none', (dt) => { if (!fun || fun.kind !== 'fish') return false; if (d.stepTo(sp.x, sp.z, 2, dt) < 0.25) { d.act.pose = 'sit'; d.face = Math.PI; } return true; }, 'Watching the water 🎣'); });
    tip('fishing', { title: 'Fishing', text: 'Cast, then wait. When the bobber dips, tap quickly! Then tap to reel, but keep the line in the green or it snaps.', icon: 'fish' });
  }
  function fishTap() {
    const F = fun;
    if (!F || F.kind !== 'fish') return;
    if (F.phase === 'cast') {
      const pp = player.root.position, dist = 2.5 + F.p * 5;
      F.bobAt = new V3(pp.x + rand(-0.6, 0.6), 0.05, pp.z - dist);
      F.bob.position.copy(F.bobAt); F.bob.visible = true; F.line.visible = true;
      F.phase = 'wait'; F.t = 0; F.bite = rand(...D.FISHING.bite) * (F.p > 0.7 ? 0.8 : 1);
      player.throwT = 0.4;
      sfx('throw');
      setTimeout(() => sfx('plip'), 400);
      $('funMeter').classList.remove('needle');
      funBar('Wait for a bite…', 'Strike!', null);
      return;
    }
    if (F.phase === 'wait') { F.bite += 1.2; funBar('Too soon! It got spooked. Wait for it…', 'Strike!', null); return; }
    if (F.phase === 'bite') {
      F.phase = 'reel'; F.t = 0; F.ten = 0.5; F.prog = 0.15; F.fish = fishPick();
      $('funMeter').classList.add('band');
      funBar(`Reel it in! Keep the line in the green`, 'Reel', 0.5);
      sfx('splash');
      return;
    }
    if (F.phase === 'reel') {
      const P = D.FISH[F.fish].pull;
      F.ten += 0.16 * P;
      const [lo, hi] = D.FISHING.keep;
      F.prog += F.ten >= lo && F.ten <= hi ? 0.1 : 0.025;
      sfx('tap');
    }
  }
  function fishUpdate(dt) {
    const F = fun, pp = player.root.position;
    F.t += dt;
    if (F.line.visible && F.line.geometry && F.line.geometry.setFromPoints) {
      const tip = new V3(pp.x, 1.6 + groundAt(pp.x, pp.z), pp.z - 0.6), b = F.bob.position;
      F.line.geometry.setFromPoints([tip, new V3(b.x, b.y + 0.1, b.z)]);
    }
    if (F.phase === 'cast') {
      F.p += F.dir * dt * 0.9;
      if (F.p > 1) { F.p = 1; F.dir = -1; } else if (F.p < 0) { F.p = 0; F.dir = 1; }
      $('funFill').style.width = Math.round(F.p * 100) + '%';
      return;
    }
    if (F.phase === 'wait') {
      F.bob.position.y = 0.05 + Math.sin(F.t * 2.2) * 0.03;
      // a dog that loves water can't resist now and then
      if (!F.splashed && F.t > 2 && Math.random() < dt * 0.04) {
        const d = dogs.find((x) => x.flag('water') && x.state === 'act');
        if (d) { F.splashed = true; spawnEmoji('💦', d.headWorld(0.2), { size: 0.5 }); d.wetT = 60; addDirt(d, 'salt', 3); sfx('splash'); toast(`${d.name} jumped in after the bobber! 💦`); }
      }
      if (F.t >= F.bite) { F.phase = 'bite'; F.t = 0; funBar('A bite! Tap Strike!', 'Strike!', null); sfx('plop'); haptic('medium'); }
      return;
    }
    if (F.phase === 'bite') {
      F.bob.position.y = -0.08 + Math.sin(F.t * 18) * 0.05;
      if (F.t > D.FISHING.window) { F.phase = 'wait'; F.t = 0; F.bite = rand(...D.FISHING.bite); funBar('Too slow, it got away. Wait for the next one…', 'Strike!', null); }
      return;
    }
    if (F.phase === 'reel') {
      const [lo, hi] = D.FISHING.keep, Fi = D.FISH[F.fish];
      F.ten = Math.max(0, F.ten - dt * 0.32);
      if (F.ten < lo) F.prog = Math.max(0, F.prog - dt * 0.05 * Fi.pull);
      F.bob.position.z = lerp(F.bobAt.z, pp.z - 0.8, F.prog);
      F.bob.position.x = F.bobAt.x + Math.sin(F.t * 5) * 0.25 * Fi.pull;
      F.bob.position.y = -0.05 + Math.sin(F.t * 14) * 0.04;
      $('funFill').style.width = Math.round(clamp(F.ten, 0, 1) * 100) + '%';
      $('funTxt').textContent = F.ten > hi ? 'Careful! The line’s too tight' : F.ten < lo ? 'Reel! It’s getting away' : `Reeling it in… ${Math.round(F.prog * 100)}%`;
      if (F.ten >= 1) { fishEnd(false, 'Snap! The line broke. Gentler next time'); return; }
      if (F.prog <= 0 && F.t > 2) { fishEnd(false, 'It got away…'); return; }
      if (F.t > D.FISHING.reel + Fi.pull * 3) { fishEnd(false, 'It got tired of waiting and swam off'); return; }
      if (F.prog >= 1) fishEnd(true);
    }
  }
  function fishEnd(ok, msg) {
    const F = fun;
    $('funMeter').classList.remove('band');
    if (!ok) { toast(msg); F.phase = 'cast'; F.p = 0; F.bob.visible = false; F.line.visible = false; funBar('Cast again?', 'Cast', 0); $('funMeter').classList.add('needle'); return; }
    const id = F.fish, Fi = D.FISH[id];
    const size = Math.round(rand(Fi.size[0], Fi.size[1]));
    const fc = (state.fishCaught = state.fishCaught || {});
    const rec = fc[id] = Object.assign({ n: 0, best: 0 }, fc[id] || {});
    const first = !rec.n, best = size > rec.best;
    rec.n++; if (best) rec.best = size;
    state.stats.fished = (state.stats.fished || 0) + 1;
    if (!Fi.junk) state.pantry.fish = (state.pantry.fish || 0) + 1;
    if (Fi.rare) addCoins(80, player.root.position);
    if (state.stats.fished >= D.FISHING.trophyAt && !state.fishTrophy) { state.fishTrophy = true; state.inventory.fishtrophy = (state.inventory.fishtrophy || 0) + 1; news({ title: 'A fish trophy!', text: `${D.FISHING.trophyAt} fish off the pier. The trophy is in your inventory.`, th: thumbOf.item('fishtrophy') }); }
    earn('fish'); progress('fish'); weekStat('fishBest', 0, size);
    spawnEmoji(Fi.icon, player.root.position.clone().add(new V3(0, 2.2, -0.4)), { size: 0.7, life: 1.6 });
    sfx(Fi.junk ? 'tap' : 'find');
    toast(Fi.junk ? `An old boot… well, it’s clean now 👢` : `${first ? 'New! ' : ''}${Fi.name}, ${size} cm${best && !first ? ' (your biggest yet!)' : ''}${Fi.junk ? '' : '. One for the pantry'}`);
    for (const d of dogs) if (d.state === 'act') { d.happy = Math.min(100, d.happy + 3); journalAdd(d, 'fish1', '🎣', `Watched you pull a ${Fi.name.toLowerCase()} out of the sea`); }
    F.phase = 'cast'; F.p = 0; F.bob.visible = false; F.line.visible = false;
    funBar('Cast again?', 'Cast', 0);
    $('funMeter').classList.add('needle');
    save();
  }

  // =====================================================================
  // Winter: build snowmen and snow dogs (roll the balls by walking), catch snowflakes with your dog
  // =====================================================================
  const snowOnGround = () => {
    if (place === 'park') return !!(LOC().snowy || (isWinter() && !LOC().indoor && loc !== 'beach' && loc !== 'moon') || (curWeather().precip === 'snow' && !LOC().indoor));
    return place === 'home' && (isWinter() || curWeather().precip === 'snow');
  };
  const snowmen = () => (state.snowmen = state.snowmen || []);
  const snowGroup = pivot(homeRoot);
  let parkSnow = null;
  function snowHere() { return snowmen().filter((s) => s.loc === (place === 'home' ? 'home' : loc)); }
  // snow melts when winter is over (except in the Snowy Village)
  function meltSnowmen() {
    const before = snowmen().length;
    const snowing = curWeather().precip === 'snow';
    state.snowmen = snowmen().filter((s) => s.loc === 'snowy' || isWinter() || snowing);
    return before - state.snowmen.length;
  }
  function buildSnowFigure(s) {
    let g;
    if (s.kind === 'dog') {
      const P = ART.buildDog(s.breed || 'retriever', null);
      g = P.root || P;
      g.traverse((o) => { if (o.isMesh) { const c = o.material && o.material.color; const dark = c && (c.r + c.g + c.b) < 0.45; o.material = mat(dark ? '#3a3a40' : '#f4f8fc'); } });
      g.scale.setScalar(1.6);
      box(g, 0.5, 0.06, 0.12, s.scarf || '#e53935', 0, 0.62, 0.32);
    } else g = ART.buildSnowman(s.scarf || '#e53935', s.sizes);
    g.position.set(s.x, s.y || 0, s.z);
    g.rotation.y = s.ry || 0;
    return g;
  }
  function renderSnow() {
    snowGroup.clear();
    if (parkSnow && parkSnow.parent) parkSnow.parent.remove(parkSnow);
    parkSnow = null;
    const list = snowHere();
    if (!list.length) return;
    if (place === 'park') { parkSnow = pivot(parkRoot); for (const s of list) parkSnow.add(buildSnowFigure(s)); }
    else for (const s of list) snowGroup.add(buildSnowFigure(s));
  }
  const nearSnowSpot = (pp) => unlockedFeat('winter') && snowOnGround() && (place === 'park' || isGardenTile(Math.floor(pp.x), Math.floor(pp.z))) && !snowHere().some((s) => flatDist(s, pp) < 3);
  function startSnowman() {
    if (!needRank('winter')) return;
    const d0 = dogs[0];
    confirmBox('Build what?', 'Roll the snowballs by walking around. The more you walk, the bigger they get.', '⛄ A snowman', true, () => snowStart('man'), null,
      d0 ? { label: `🐕 A snow dog like ${d0.name}`, enabled: true, fn: () => snowStart('dog') } : null);
  }
  function snowStart(kind) {
    if (fun) endFun('switch');
    const balls = kind === 'dog' ? 1 : 3;
    const ball = new THREE.Group();
    box(ball, 1, 0.9, 1, '#f6f9fc'); box(ball, 0.8, 1.02, 0.8, '#ffffff');
    ball.scale.setScalar(0.2);
    (place === 'home' ? homeRoot : parkRoot).add(ball);
    fun = { kind: 'snow', still: false, what: kind, balls, k: 0, size: 0.2, sizes: [], last: player.root.position.clone(), ball, at: player.root.position.clone(), onBtn: () => snowNext() };
    fun.end = () => { ball.parent && ball.parent.remove(ball); };
    funBar(kind === 'dog' ? 'Roll a big snowball for the snow dog: walk around!' : 'Roll the bottom snowball: walk around!', 'Done', 0);
    tip('snowman', { title: 'Snowmen', text: 'Walk around to roll the snowball bigger, then tap Done. Your dogs love to help.', icon: 'snowman' });
  }
  function snowUpdate(dt) {
    const F = fun, pp = player.root.position;
    const walked = flatDist(pp, F.last);
    F.last.copy(pp);
    const max = D.SNOW.roll[F.k] || 1;
    if (walked > 0 && walked < 1) F.size = Math.min(max, F.size + walked * D.SNOW.growth);
    const r = player.root.rotation.y;
    F.ball.position.set(pp.x + Math.sin(r) * (0.5 + F.size * 0.35), groundAt(pp.x, pp.z) + F.size * 0.35, pp.z + Math.cos(r) * (0.5 + F.size * 0.35));
    F.ball.scale.setScalar(F.size * 0.6);
    F.ball.rotation.x += walked * 2;
    $('funFill').style.width = Math.round((F.size / max) * 100) + '%';
    $('funBtn').disabled = F.size < max * 0.5;
    // the dogs bound along through the snow
    for (const d of dogs) if (d.state === 'idle' || d.state === 'sit') { if (Math.random() < dt * 0.4) d.goTo(F.ball.position.clone().add(new V3(rand(-1, 1), 0, rand(-1, 1))), 3, () => spawnEmoji('❄️', d.headWorld(0.2), { size: 0.3 }), 0.5); }
  }
  function snowNext() {
    const F = fun;
    if (F.size < (D.SNOW.roll[F.k] || 1) * 0.5) return;
    F.sizes.push(F.size);
    if (F.k === 0) F.at = F.ball.position.clone();
    F.k++;
    if (F.k < F.balls) {
      F.size = 0.2;
      funBar(F.k === 1 ? 'Now the middle one: keep walking!' : 'And the head: a small one', 'Done', 0);
      sfx('tap');
      return;
    }
    // done: stack it up where the first ball was
    const d0 = dogs[0];
    const s = { loc: place === 'home' ? 'home' : loc, x: F.at.x, z: F.at.z, y: place === 'park' ? groundAt(F.at.x, F.at.z) : 0, kind: F.what, sizes: F.what === 'man' ? F.sizes.map((x) => x * 1.1) : null, scarf: (state.look && state.look.fav) || '#e53935', breed: d0 ? d0.breed : 'retriever', name: d0 ? d0.name : '', ry: Math.atan2(camOffsetDir.x, camOffsetDir.z) };
    snowmen().push(s);
    if (snowmen().length > 30) snowmen().shift();
    endFun('done');
    renderSnow();
    state.stats.snowmen = (state.stats.snowmen || 0) + 1;
    earn('snowman'); progress('snowman');
    confetti(new V3(s.x, 1.5, s.z), 6);
    sfx('unlock');
    toast(s.kind === 'dog' ? `A snow ${d0 ? d0.name : 'dog'}! The real one looks a little confused 🐕❄️` : '⛄ A proper snowman!');
    for (const d of dogs) { d.happy = Math.min(100, d.happy + 6); journalAdd(d, 'snowman', '⛄', s.kind === 'dog' && d === d0 ? 'Got a snow dog built in their likeness' : 'Helped build a snowman'); }
    if (state.stats.snowmen === 3 && !state.inventory.snowglobe) { state.inventory.snowglobe = 1; news({ title: 'A snow globe', text: 'Three snow figures! Here’s a little snow globe for your shelf (Decorate).', th: thumbOf.item('snowglobe') }); }
    save();
  }
  // ----- catching snowflakes: tap a big flake as it drifts down, your dog leaps for it -----
  const flakesNow = () => unlockedFeat('winter') && (curWeather().precip === 'snow' || (place === 'park' && LOC().snowy)) && !(place === 'park' && LOC().indoor);
  let lastTap = null;
  function startFlakes() {
    const d = (selected && dogs.includes(selected) ? selected : dogs[0]);
    if (!d) return;
    if (fun) endFun('switch');
    const pp = player.root.position, r = player.root.rotation.y;
    const spot = new V3(pp.x + Math.sin(r) * 1.6, 0, pp.z + Math.cos(r) * 1.6);
    fun = { kind: 'flakes', still: true, dog: d, flakes: [], t: 0, next: 0.5, got: 0, missed: 0, spot, onBtn: () => endFun('stop') };
    fun.end = () => { for (const f of fun ? fun.flakes : []) f.s.parent && f.s.parent.remove(f.s); };
    const F = fun;
    fun.end = () => { for (const f of F.flakes) f.s.parent && f.s.parent.remove(f.s); };
    d.free = true;
    d.doAct('sit', (dt) => { if (!fun || fun.kind !== 'flakes') return false; if (d.act.leap > 0) { d.act.leap -= dt; d.act.y = Math.sin((1 - d.act.leap / 0.6) * Math.PI) * 0.9; d.act.pose = 'jump'; } else { d.act.y = 0; d.act.pose = 'sit'; if (d.stepTo(spot.x, spot.z, 2.6, dt) < 0.3) d.faceTo(pp); } return true; }, 'Catching snowflakes ❄️');
    funBar(`Tap the big snowflakes before they land. ${d.name} jumps for them!`, 'Stop', null);
    tip('flakes', { title: 'Snowflakes', text: 'Big snowflakes drift down around your dog. Tap one before it lands and your dog jumps up to catch it.', icon: 'snow' });
  }
  function flakesUpdate(dt) {
    const F = fun, sp = F.spot, root = place === 'home' ? homeRoot : parkRoot;
    F.t += dt;
    F.next -= dt;
    if (F.next <= 0 && F.t < D.SNOW.flakes - 3) {
      F.next = rand(0.7, 1.4);
      const s = emojiSprite('❄️', 0.55);
      s.position.set(sp.x + rand(-1.8, 1.8), 3.6, sp.z + rand(-1.6, 1.6));
      root.add(s);
      F.flakes.push({ s, life: rand(...D.SNOW.flakeLife), wob: Math.random() * 6 });
    }
    for (const f of F.flakes.slice()) {
      f.life -= dt;
      f.s.position.y -= dt * 0.75;
      f.s.position.x += Math.sin(F.t * 2 + f.wob) * dt * 0.4;
      if (f.s.position.y < 0.25 || f.life <= 0) { F.missed++; f.s.parent && f.s.parent.remove(f.s); F.flakes.splice(F.flakes.indexOf(f), 1); }
    }
    $('funTxt').textContent = `❄️ ${F.got} caught · ${Math.max(0, Math.ceil(D.SNOW.flakes - F.t))}s`;
    if (F.t >= D.SNOW.flakes && !F.flakes.length) {
      const d = F.dog, n = F.got;
      endFun('done');
      if (n) {
        d.happy = Math.min(100, d.happy + Math.min(20, n * 2)); d.addBond(Math.min(4, Math.ceil(n / 3)));
        earn('flakes'); progress('flakes');
        journalAdd(d, 'flakes', '❄️', `Caught ${n} snowflakes in one go`);
        toast(`${d.name} caught ${n} snowflake${n > 1 ? 's' : ''}! ❄️`);
      } else toast('The snowflakes won this time ❄️');
      save();
    }
  }
  function flakesTap() {
    const F = fun;
    if (!lastTap) return true;
    let best = null, bd = 60;
    for (const f of F.flakes) {
      const v = f.s.position.clone();
      if (place === 'home' && isUpX(v.x)) { v.x -= UPX; v.y += FH; }
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth, sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      const dd = Math.hypot(sx - lastTap.x, sy - lastTap.y);
      if (dd < bd) { bd = dd; best = f; }
    }
    if (!best) return true;
    F.flakes.splice(F.flakes.indexOf(best), 1);
    best.s.parent && best.s.parent.remove(best.s);
    F.got++;
    const d = F.dog;
    if (d.act) d.act.leap = 0.6;
    sfx('yip');
    spawnEmoji('✨', d.headWorld(0.6), { size: 0.4 });
    return true;
  }

  // =====================================================================
  // Disc dog at the beach: five throws; time the power, and tap Jump! as the disc comes down for a flip catch
  // =====================================================================
  const disc = () => { const X = state.disc = state.disc || {}; for (const [k, v] of Object.entries({ cls: 0, best: 0, wins: 0 })) if (X[k] === undefined) X[k] = v; return X; };
  const nearDiscMat = (pp) => place === 'park' && loc === 'beach' && S && S.q && S.q.disc && flatDist(pp, S.q.disc.start) < 1.4;
  const discCupToday = () => D.DISC.cup.includes(clockNow.day);
  function startDisc() {
    if (!needRank('disc')) return;
    if (!state.toys.includes('frisbee')) { toast('You need a frisbee. The beach kiosk sells them'); return; }
    const d = selected && dogs.includes(selected) ? selected : dogs[0];
    if (!d) return;
    if (d.energy < 15) { toast(`${d.name} is too tired for disc dog right now`); return; }
    if (fun) endFun('switch');
    const st = S.q.disc.start;
    player.root.position.set(st.x, groundAt(st.x, st.z), st.z);
    player.face = Math.PI / 2;
    const cup = discCupToday() && disc().cupDay !== clockNow.gameDay;
    if (cup) {
      const fee = D.DISC.fee[disc().cls];
      if (state.coins < fee) { toast(`The Disc Cup costs 🪙 ${fee} to enter`); return; }
      state.coins -= fee; updateHud();
      disc().cupDay = clockNow.gameDay;
    }
    const dg = new THREE.Group();
    box(dg, 0.42, 0.05, 0.42, '#ff7043'); box(dg, 0.3, 0.06, 0.3, '#ffab91');
    dg.visible = false;
    parkRoot.add(dg);
    fun = { kind: 'disc', still: true, dog: d, n: 0, score: 0, phase: 'aim', p: 0, dir: 1, dg, cup, flips: 0, catches: 0, onBtn: () => discTap() };
    fun.end = () => { dg.parent && dg.parent.remove(dg); $('funMeter').classList.remove('needle'); camFocus = null; };
    d.free = true;
    d.doAct('none', (dt) => discDog(d, dt), 'Playing disc dog 🥏');
    $('funMeter').classList.add('needle');
    funBar(`${cup ? `Disc Cup, ${D.CLASSES[disc().cls]}! ` : ''}Throw 1 of ${D.DISC.throws}: tap Throw for the distance you want`, 'Throw', 0);
    tip('disc', { title: 'Disc dog', text: 'The longer the throw, the more points, if your dog gets there in time. As the disc drops towards your dog, tap Jump! for a flip catch worth extra.', icon: 'disc' });
  }
  function discDog(d, dt) {
    const F = fun;
    if (!F || F.kind !== 'disc') return false;
    const st = S.q.disc.start;
    if (F.phase === 'aim' || F.phase === 'done') { if (d.stepTo(st.x + 0.6, st.z + 0.9, 3, dt) < 0.3) d.faceTo(new V3(st.x + 5, 0, st.z)); d.act.pose = 'sit'; d.act.y = 0; return true; }
    if (F.phase === 'fly') {
      d.act.pose = 'none';
      const left = d.stepTo(F.land.x, F.land.z, F.speed, dt);
      if (d.act.flip > 0) { d.act.flip -= dt; d.act.y = Math.sin((1 - d.act.flip / 0.55) * Math.PI) * 1.1; } else d.act.y = 0;
      F.dogLeft = left;
      return true;
    }
    if (F.phase === 'back') {
      d.act.y = 0;
      if (d.stepTo(st.x + 0.6, st.z + 0.9, 4, dt) < 0.4) { F.phase = 'aim'; F.p = 0; nextThrowBar(); }
      F.dg.position.copy(d.headWorld(0.1));
      return true;
    }
    return true;
  }
  function nextThrowBar() {
    const F = fun;
    F.dg.visible = false;
    if (F.n >= D.DISC.throws) { discFinish(); return; }
    $('funMeter').classList.add('needle');
    funBar(`Throw ${F.n + 1} of ${D.DISC.throws} · ${F.score} points`, 'Throw', 0);
  }
  function discTap() {
    const F = fun;
    if (!F || F.kind !== 'disc') return;
    if (F.phase === 'aim') {
      const st = S.q.disc.start, dist = D.DISC.minDist + F.p * (D.DISC.maxDist - D.DISC.minDist);
      F.dist = dist;
      F.land = new V3(st.x + dist, 0, st.z + rand(-1.2, 1.2));
      F.flight = dist / 7 + 0.45;
      F.ft = 0;
      F.from = new V3(st.x + 0.3, 1.3, st.z);
      const d = F.dog;
      F.speed = 5.2 * (d.flag('zooms') ? 1.15 : 1) * (d.flag('lounges') ? 0.85 : 1) * (d.energy < 30 ? 0.85 : 1) * (1 + 0.04 * d.specAs('athlete'));
      F.phase = 'fly';
      F.jumped = false;
      F.dg.visible = true;
      player.throwT = 0.4;
      sfx('throw');
      $('funMeter').classList.remove('needle');
      funBar('Jump! as it comes down to your dog', 'Jump!', null);
      camFocus = { dog: F.dog, t: 999 };
      return;
    }
    if (F.phase === 'fly' && !F.jumped) {
      F.jumped = true;
      const y = F.dg.position.y, near = F.dogLeft !== undefined && F.dogLeft < 1.6;
      F.dog.act.flip = 0.55;
      F.flipOK = near && y > 0.5 && y < 1.9;
      sfx('whoosh');
    }
  }
  function discUpdate(dt) {
    const F = fun;
    if (F.phase === 'aim') {
      F.p += F.dir * dt * 0.75;
      if (F.p > 1) { F.p = 1; F.dir = -1; } else if (F.p < 0) { F.p = 0; F.dir = 1; }
      $('funFill').style.width = Math.round(F.p * 100) + '%';
      return;
    }
    if (F.phase !== 'fly') return;
    F.ft += dt;
    const t = Math.min(1, F.ft / F.flight);
    F.dg.position.set(lerp(F.from.x, F.land.x, t), lerp(F.from.y, 0.1, t) + Math.sin(t * Math.PI) * 2.4, lerp(F.from.z, F.land.z, t));
    F.dg.rotation.y += dt * 18;
    const dp = F.dog.root.position;
    const close = Math.hypot(dp.x - F.dg.position.x, dp.z - F.dg.position.z) < 0.9;
    const caught = close && F.dg.position.y < 1.7 && t > 0.55;
    if (caught || t >= 1) {
      F.n++;
      const L = D.DISC_LINES;
      if (caught) {
        const flip = F.flipOK && F.jumped;
        const pts = Math.round(F.dist * (flip ? 1.5 : 1));
        F.score += pts; F.catches++; if (flip) F.flips++;
        spawnEmoji(flip ? '🤸' : '🥏', F.dog.headWorld(0.5), { size: 0.5 });
        toast(`${pick(flip ? L.flip : L.catch)} +${pts}`);
        sfx(flip ? 'unlock' : 'yip');
        F.dog.happy = Math.min(100, F.dog.happy + 3);
        F.dog.energy = Math.max(0, F.dog.energy - 2);
      } else { toast(pick(L.miss)); sfx('fail'); F.dg.position.y = 0.05; }
      F.phase = 'back';
      F.dog.act.flip = 0;
    }
  }
  function discFinish() {
    const F = fun, D2 = disc(), d = F.dog;
    F.phase = 'done';
    const best = F.score > D2.best;
    if (best) D2.best = F.score;
    state.stats.discBest = D2.best;
    earn('disc'); progress('disc'); weekStat('discBest', 0, F.score);
    d.addBond(2);
    journalAdd(d, 'disc', '🥏', `Played disc dog at the beach: ${F.score} points`);
    if (F.cup) { discCupResult(F.score); return; }
    funBar(`${F.score} points${best ? ' · a new best!' : ''} (${F.catches} catches, ${F.flips} flips)`, 'Again', null);
    fun.onBtn = () => { endFun('again'); startDisc(); };
    save();
  }
  function discCupResult(score) {
    const D2 = disc(), cls = D2.cls;
    const rr = weekRand('disc' + clockNow.gameDay + cls);
    const base = [32, 48, 64][cls];
    const rivals = D.NEIGHBORS.slice().sort(() => rr() - 0.5).slice(0, D.DISC.rivals).map((N) => [N.owner + ' & ' + N.dog.name, Math.round(base * (0.6 + rr() * 0.7))]);
    const all = rivals.concat([[`${youName() || 'You'} & ${fun.dog.name}`, score, true]]).sort((a, b) => b[1] - a[1]);
    const placeN = all.findIndex((x) => x[2]) + 1;
    const prize = D.DISC.prize[cls][placeN - 1] || 0;
    if (prize) addCoins(prize, player.root.position);
    earn('discup');
    if (placeN === 1) {
      D2.wins++;
      state.stats.discWins = D2.wins;
      if (D2.cls < D.CLASSES.length - 1) D2.cls++;
      if (!state.inventory.discrack && D2.wins === 1) state.inventory.discrack = 1;
    }
    endFun('done');
    $('tourneyTitle').textContent = `Disc Cup, ${D.CLASSES[cls]}: place ${placeN}`;
    $('tourneyList').innerHTML = all.map((x, i) => `<div class="row${x[2] ? ' me' : ''}"><div class="ic"><b>${['🥇', '🥈', '🥉'][i] || i + 1}</b></div><div class="txt"><b>${esc(x[0])}</b></div><b>${x[1]} pts</b></div>`).join('') +
      `<p class="sub">${placeN === 1 ? `You won! 🏆${prize ? ` 🪙 ${prize}.` : ''}${D2.cls > cls ? ` Next time: ${esc(D.CLASSES[D2.cls])}.` : ''}${D2.wins === 1 ? ' A disc rack for your home is in your inventory.' : ''}` : prize ? `You won 🪙 ${prize}.` : 'No prize this time. Next Disc Cup on the 14th!'}</p>`;
    $('tourney').classList.remove('hidden');
    save();
  }

  // =====================================================================
  // Neighbor favors: a neighbor lost something (or their dog ran off). Your dog sniffs them for the scent,
  // follows the trail and brings it back.
  // =====================================================================
  let favorW = null;    // the walker who needs help on this walk
  function rollFavor() {
    favorW = null;
    if (!unlockedFeat('favors') || !dogs.length || state.favorDay === clockNow.gameDay || Math.random() > D.FAVOR.chance) return;
    const w = walkers.find((x) => !x.visit) || null;
    if (!w) return;
    const kinds = Object.keys(D.FAVOR_KINDS);
    const kind = pick(kinds);
    const K = D.FAVOR_KINDS[kind];
    w.favor = { kind, thing: K.things.length ? pick(K.things) : null };
    w.bang = emojiSprite('❗', 0.5);
    w.bang.position.y = 2.5;
    w.parts.root.add(w.bang);
    favorW = w;
  }
  function favorAsk(w) {
    const F = w.favor, N = w.info;
    return fill(pick(D.FAVOR_KINDS[F.kind].ask), { ndog: N.dog.name, dog: (selected && dogs.includes(selected) ? selected : dogs[0]).name, thing: F.thing || '' });
  }
  // a hidden spot for the lost thing: well away, somewhere you can walk to
  function favorSpot(from) {
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * TAU, r = rand(D.FAVOR.trail, D.FAVOR.trail + 8);
      const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
      if (!inBounds(x, z, 1) || isSolid(x, z) || inPond(x, z, 0.6) || (S.solid && S.solid(x, z))) continue;
      if (Math.abs(groundAt(x, z) - groundAt(from.x, from.z)) > 1.5) continue;
      const path = findPath(from, { x, z });
      if (!path.length) continue;
      return new V3(x, groundAt(x, z), z);
    }
    return null;
  }
  function startFavor(w) {
    const d = selected && dogs.includes(selected) ? selected : dogs[0];
    if (!d || !w || !w.favor) return;
    if (talk) endTalk(false);
    if (fun) endFun('switch');
    const target = favorSpot(w.parts.root.position);
    if (!target) { toast('Hmm, the trail goes cold here. Maybe another time'); return; }
    w.waiting = true;
    if (w.bang) { w.parts.root.remove(w.bang); w.bang = null; }
    const F = { kind: 'favor', still: false, w, dog: d, target, phase: 'sniff', t: 0, trailT: 0, item: null, lost: null, onBtn: () => endFun('stop') };
    fun = F;
    fun.end = (why) => {
      w.waiting = false;
      if (F.item && F.item.parent) F.item.parent.remove(F.item);
      if (F.lost) { F.lost.root.parent && F.lost.root.parent.remove(F.lost.root); }
      if (why !== 'done') { w.favor = null; toast(`${w.info.owner}: Oh well, thanks for trying!`); }
    };
    d.free = true;
    if (d.offLeash !== undefined) d.offLeashFavor = d.offLeash;
    d.doAct('none', (dt) => favorStep(d, dt), 'Following a scent 👃');
    funBar(`${d.name} sniffs ${w.info.owner}${F.w.favor.kind === 'dog' ? ` and ${w.info.dog.name}’s leash` : ''} to pick up the scent…`, 'Give up', null);
    tip('favors', { title: 'Favors', text: 'Your dog picked up a scent. Follow the trail: your dog leads the way and waits if you fall behind.', icon: 'search' });
  }
  function favorStep(d, dt) {
    const F = fun;
    if (!F || F.kind !== 'favor') return false;
    const wp = F.w.parts.root.position, pp = player.root.position;
    F.t += dt;
    if (F.phase === 'sniff') {
      const s = new V3(wp.x + 0.6, 0, wp.z + 0.6);
      if (d.stepTo(s.x, s.z, 2.6, dt) < 0.35) { d.act.pose = 'sniff'; d.faceTo(wp); if (!F.sniffT) F.sniffT = F.t; }
      if (F.sniffT && F.t - F.sniffT > 2) {
        F.phase = 'trail'; F.t = 0;
        spawnEmoji('👃', d.headWorld(0.3), { size: 0.45 });
        sfx('rustle');
        $('funTxt').textContent = `${d.name} has the scent! Follow the trail`;
      }
      return true;
    }
    if (F.phase === 'trail') {
      d.act.pose = 'none';
      // waits when you fall behind
      if (flatDist(d.root.position, pp) > 6.5) { d.act.pose = 'sit'; d.faceTo(pp); if (Math.random() < dt * 0.6) spawnEmoji('❓', d.headWorld(0.3), { size: 0.3 }); return true; }
      const left = d.stepTo(F.target.x, F.target.z, 2.4, dt);
      F.trailT -= dt;
      if (F.trailT <= 0) { F.trailT = 0.35; spawnEmoji('🐾', d.root.position.clone().add(new V3(0, 0.08, 0)), { size: 0.22, life: 2.4, vy: 0 }); }
      if (left < 0.5) {
        F.phase = 'dig'; F.t = 0;
        if (F.w.favor.kind === 'dog') {
          // the runaway, hiding here
          const N = F.w.info;
          const lost = new NPCDog(Object.assign({ id: 'n:' + N.dog.name + ':lost' }, N.dog), F.w);
          lost.root.position.set(F.target.x + 0.7, F.target.y, F.target.z + 0.4);
          lost.updateState = function (dt2) { if (F.phase === 'back') { const q = d.root.position; if (flatDist(this.root.position, q) > 1) this.moveTowards(q.x, q.z, 2.6, dt2); } else this.setState('sit'); };
          lost.applyLeash = () => {};
          parkRoot.add(lost.root);
          F.lost = lost;
        }
      }
      return true;
    }
    if (F.phase === 'dig') {
      d.act.pose = F.w.favor.kind === 'dog' ? 'tilt' : 'dig';
      if (F.t > 1.6) {
        F.phase = 'back'; F.t = 0;
        if (F.w.favor.kind !== 'dog') {
          F.item = emojiSprite(D.FAVOR_KINDS[F.w.favor.kind].icon, 0.4);
          parkRoot.add(F.item);
        }
        sfx('find');
        $('funTxt').textContent = F.w.favor.kind === 'dog' ? `${d.name} found ${F.w.info.dog.name}! Back to ${F.w.info.owner}` : `${d.name} found the ${F.w.favor.thing}! Back to ${F.w.info.owner}`;
      }
      return true;
    }
    if (F.phase === 'back') {
      d.act.pose = 'none';
      if (F.item) F.item.position.copy(d.headWorld(0.25));
      if (F.lost) F.lost.update(dt);
      if (d.stepTo(wp.x + 0.7, wp.z + 0.5, 3.2, dt) < 0.6) favorDone();
      return true;
    }
    return true;
  }
  function favorDone() {
    const F = fun, w = F.w, N = w.info, d = F.dog;
    const first = !(state.favorsFrom || {})[N.owner];
    state.favorsFrom = Object.assign(state.favorsFrom || {}, { [N.owner]: ((state.favorsFrom || {})[N.owner] || 0) + 1 });
    const coins = Math.round(rand(...D.FAVOR.coins));
    addCoins(coins, w.parts.root.position);
    addNFriend(N.owner, D.FAVOR.friend);
    state.stats.favors = (state.stats.favors || 0) + 1;
    state.favorDay = clockNow.gameDay;
    d.addBond(4); d.happy = Math.min(100, d.happy + 10);
    journalAdd(d, 'favor:' + N.owner, '🤝', `Sniffed out ${F.w.favor.kind === 'dog' ? N.dog.name : `${N.owner}’s ${F.w.favor.thing}`} for ${N.owner}`);
    earn('favor'); progress('favor');
    w.favor = null;
    endFun('done');
    let extra = '';
    const G = first && D.FAVOR_GIFTS[N.owner];
    if (G) { giveReward(G); extra = ` As a thank-you, ${N.owner} gives you ${rewardText(G)} for your home.`; }
    sfx('unlock');
    news({ title: `${N.owner} is so grateful`, text: `${fill(pick(D.FAVOR_THANKS), { dog: d.name })} (+🪙 ${coins})${extra}`, th: `<img class="th" src="${ART.personPortraitURL(N)}" alt="">` });
    save();
  }

  // =====================================================================
  // The PixelPups Gazette: a weekly paper with your week in numbers, a town ranking, gossip and what's coming
  // =====================================================================
  const weekNo = () => Math.floor(clockNow.gameDay / 7);
  function weekStat(k, n, best) {
    if (visit) return;
    const W = state.week = state.week && state.week.k === weekNo() ? state.week : rollWeek();
    if (best !== undefined) W.s[k] = Math.max(W.s[k] || 0, best);
    else W.s[k] = (W.s[k] || 0) + (n || 0);
  }
  // a new week: last week's numbers go into the paper
  function rollWeek() {
    const old = state.week;
    const W = { k: weekNo(), s: {} };
    if (old && old.k < W.k && unlockedFeat('gazette') && Object.keys(old.s).length) {
      state.week = W;
      deliverGazette(old);
    }
    state.week = W;
    return W;
  }
  function weekHot() {
    const pool = Object.keys(D.MARKET_GOODS).filter((k) => D.MARKET_GOODS[k].kind === 'pantry').concat(Object.keys(D.BAKES).map((k) => 't:' + k), ['bouquet']);
    const r = ART.mulberry32(hashStr('hot' + weekNo() + (state.uid || '')))();
    return pool[Math.floor(r * pool.length)];
  }
  const GZ_STATS = [['walk', 'Walks', '🦮'], ['find', 'Finds', '🔎'], ['trick', 'Tricks', '🎓'], ['fish', 'Fish caught', '🎣'], ['catch', 'Critters caught', '🥅'], ['baked', 'Treats baked', '🥧'],
    ['sold', 'Sold at market', '🧺'], ['visitors', 'Museum visitors', '🏛️'], ['favor', 'Favors done', '🤝'], ['agility', 'Agility runs', '🏁'], ['letter', 'Letters sent', '💌'], ['snowman', 'Snow figures', '⛄']];
  function deliverGazette(W) {
    const s = W.s, no = (state.gazetteNo || 0) + 1;
    state.gazetteNo = no;
    const score = Math.round((s.walk || 0) * 10 + (s.find || 0) * 6 + (s.trick || 0) + (s.fish || 0) * 4 + (s.catch || 0) * 4 + (s.baked || 0) * 2 + (s.sold || 0) * 3 + (s.visitors || 0) * 0.2 + (s.favor || 0) * 15 + (s.agility || 0) * 5 + (s.tourney || 0) * 20 + (s.discup || 0) * 20);
    const rr = ART.mulberry32(hashStr('gz' + W.k + (state.uid || '')));
    const rivals = D.NEIGHBORS.slice().sort(() => rr() - 0.5).slice(0, 5).map((N) => ({ name: N.owner, dog: N.dog.name, score: Math.round(Math.max(20, score) * (0.45 + rr() * 0.9)) }));
    const table = rivals.concat([{ name: youName() || 'You', dog: dogs[0] ? dogs[0].name : '', score, me: true }]).sort((a, b) => b.score - a.score);
    // the headline: the biggest thing you did this week
    const heads = [];
    if (s.tourney) heads.push(['Agility star!', `${youName() || 'A local dog owner'} won at the Tournament Grounds`]);
    if (s.discup) heads.push(['Disc Cup champion', 'A spectacular flip catch had the beach on its feet']);
    if ((s.visitors || 0) > 150) heads.push(['Museum crowds', `${s.visitors} visitors came to see the exhibitions`]);
    if ((s.sold || 0) >= 10) heads.push(['Market hit', `${s.sold} things sold at the weekend market`]);
    if ((s.favor || 0) >= 2) heads.push(['Super sniffer', `${dogs[0] ? dogs[0].name : 'A clever dog'} tracked down lost things for the neighbors`]);
    if ((s.fish || 0) >= 5) heads.push(['Tall tales from the pier', `${s.fish} fish, and the biggest was ${s.fishBest || '?'} cm`]);
    if (!heads.length) heads.push(['Quiet week in town', `${dogs.length ? dogs.map((d) => d.name).join(' and ') : 'The dogs'} enjoyed the little things`]);
    const N = pick(D.NEIGHBORS);
    const issue = {
      no, week: W.k, stats: GZ_STATS.filter(([k]) => s[k]).map(([k, n, ic]) => [ic, n, Math.round(s[k])]), head: heads[0], table,
      gossip: fill(pick(D.GAZETTE.gossip), { owner: N.owner, ndog: N.dog.name }),
      hot: weekHot(), ad: fill(pick(D.GAZETTE.ads), { cat: pick(['dog beds', 'lamps', 'rugs', 'plants']), fish: pick(Object.values(D.FISH).filter((F) => !F.junk)).name.toLowerCase() + 's' }),
      museum: (state.museum && state.museum.log || []).slice(-7),
      coming: upcomingLines(),
      name: D.GAZETTE.names[no % D.GAZETTE.names.length],
    };
    receive({ from: 'The PixelPups Gazette', gazette: issue, text: `Issue ${no}\n${issue.head[0]}` });
  }
  function upcomingLines() {
    const out = [];
    const d = clockNow.day;
    const next = (days) => days.map((x) => x - d).filter((x) => x > 0).sort((a, b) => a - b)[0];
    if (unlockedFeat('agility')) { const n = next(D.TOURNEY.days); if (n) out.push(`🏁 Agility tournament in ${n} day${n > 1 ? 's' : ''}`); }
    if (unlockedFeat('disc')) { const n = next(D.DISC.cup); if (n) out.push(`🥏 Disc Cup in ${n} day${n > 1 ? 's' : ''}`); }
    if (unlockedFeat('market')) out.push('🧺 Market every Saturday and Sunday');
    for (const dd of dogs) { const b = bornCal(dd); if (b.month === clockNow.month && b.day > d) out.push(`🎂 ${dd.name}’s birthday on the ${b.day}th`); }
    return out.slice(0, 4);
  }
  function openGazette(issue) {
    const I = issue;
    const goodName = (k) => (k.startsWith('t:') ? D.BAKES[k.slice(2)].name : D.INGREDIENTS[k] ? D.INGREDIENTS[k].name : (D.MARKET_GOODS[k] || {}).name || k);
    const mx = Math.max(1, ...I.table.map((x) => x.score));
    const mm = Math.max(10, ...(I.museum || []));
    $('gazetteBody').innerHTML = `<div class="gzMast"><b>${esc(I.name)}</b><small>Issue ${I.no} · ${esc(D.MONTHS[clockNow.month] || '')} edition · 1 coin</small></div>` +
      `<div class="gzHead"><h3>${esc(I.head[0])}</h3><p>${esc(I.head[1])}</p></div>` +
      (I.stats.length ? `<div class="gzBox"><div class="gzT">Your week in numbers</div><div class="gzStats">${I.stats.map(([ic, n, v]) => `<div><b>${v}</b><small>${ic} ${esc(n)}</small></div>`).join('')}</div></div>` : '') +
      `<div class="gzBox"><div class="gzT">Dog owner of the week</div>${I.table.map((x, i) => `<div class="gzRow${x.me ? ' me' : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(x.name)}${x.dog ? ` & ${esc(x.dog)}` : ''}</span><span class="bar"><i style="width:${Math.round((x.score / mx) * 100)}%"></i></span><b>${x.score}</b></div>`).join('')}</div>` +
      (I.museum && I.museum.length ? `<div class="gzBox"><div class="gzT">Museum visitors</div><div class="kChart small">${I.museum.map((v) => `<i style="height:${Math.round((v / mm) * 100)}%"><b>${v}</b></i>`).join('')}</div></div>` : '') +
      `<div class="gzCols"><div class="gzBox"><div class="gzT">Market tip</div><p>Everyone wants <b>${esc(goodName(I.hot))}</b> this week. It sells for more!</p></div><div class="gzBox"><div class="gzT">Gossip</div><p>${esc(I.gossip)}</p></div></div>` +
      (I.coming.length ? `<div class="gzBox"><div class="gzT">Coming up</div>${I.coming.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : '') +
      `<div class="gzAd">${esc(I.ad)}</div>`;
    $('gazette').classList.remove('hidden');
    sfx('open');
  }
  $('gazette').addEventListener('click', (e) => { if (e.target.id === 'gazette' || e.target.closest('[data-act="closeGazette"]')) $('gazette').classList.add('hidden'); });

  // =====================================================================
  // Friends and rivals among your own dogs
  // =====================================================================
  const rivalry = (a, b) => (state.rivals || {})[pairKey(a, b)] || 0;
  function addRivalry(a, b, n) {
    if (a.npc || b.npc || !dogs.includes(a) || !dogs.includes(b)) return;
    state.rivals = state.rivals || {};
    const k = pairKey(a.id, b.id), before = state.rivals[k] || 0;
    const v = clamp(before + n, 0, 100);
    state.rivals[k] = v;
    const L = D.RIVAL.level;
    if (before < L && v >= L) {
      toast(`💢 ${a.name} and ${b.name} don’t get along right now`);
      journalAdd(a, 'rival:' + b.id + ':' + clockNow.gameDay, '💢', `Had a falling-out with ${b.name}`);
      journalAdd(b, 'rival:' + a.id + ':' + clockNow.gameDay, '💢', `Had a falling-out with ${a.name}`);
    } else if (before >= L && v < L / 2) {
      state.rivals[k] = 0;
      toast(`🤝 ${a.name} and ${b.name} made up!`);
      journalAdd(a, 'makeup:' + b.id + ':' + clockNow.gameDay, '🤝', `Made up with ${b.name}`);
      journalAdd(b, 'makeup:' + a.id + ':' + clockNow.gameDay, '🤝', `Made up with ${a.name}`);
    }
  }
  const isRival = (a, b) => rivalry(a.id, b.id) >= D.RIVAL.level;
  function rivalOf(d) {
    let best = null, bv = D.RIVAL.level - 1;
    for (const o of dogs) if (o !== d && rivalry(d.id, o.id) > bv) { bv = rivalry(d.id, o.id); best = o; }
    return best;
  }
  // a dog pulled a toy out: its rival wants it too (tug of war), or it takes it to a friend to share
  function toyPals(d, toyName) {
    if (place !== 'home') return;
    const others = dogs.filter((o) => o !== d && FREE_FOR_MEETING.includes(o.state) && flatDist(o.root.position, d.root.position) < 5);
    const rv = others.find((o) => isRival(d, o));
    const fr = others.filter((o) => friendship(d.id, o.id) >= D.FRIEND_LEVEL).sort((a, b) => friendship(d.id, b.id) - friendship(d.id, a.id))[0];
    if (rv && Math.random() < 0.6) {
      toast(fill(pick(D.RIVAL_LINES.tug), { a: rv.name, b: d.name, toy: toyName }));
      startEncounter(d, rv);
      for (const x of [d, rv]) if (x.state === 'play' || x.state === 'greet' || x.state === 'scuffle') x.setState('play', 3);
      addRivalry(d, rv, -2);
      return;
    }
    if (fr && Math.random() < 0.5) {
      d.goTo(() => fr.root.position, 2.2, () => {
        toast(fill(pick(D.RIVAL_LINES.share), { a: d.name, b: fr.name, toy: toyName }));
        startEncounter(d, fr);
        addFriendship(d, fr, 3);
      }, 0.9);
    }
  }

  // =====================================================================
  // Glue for this round: context buttons, the per-frame and slow updates, walks
  // =====================================================================
  function round3Ctx(pp) {
    if (fun || mode !== 'normal' || visit || title) return null;
    if (place === 'park') {
      if (nearCatchable(pp)) return 'catch';
      if (nearMuseum(pp)) return 'museum';
      if (nearMarket(pp) && marketDay()) return 'market';
      if (unlockedFeat('fishing') && nearPier(pp)) return 'fish';
      if (unlockedFeat('disc') && nearDiscMat(pp)) return 'disc';
      if (favorW && favorW.favor && flatDist(favorW.parts.root.position, pp) < 2.4) return 'favor';
    }
    if (unlockedFeat('winter') && dogs.length && nearSnowSpot(pp)) return 'snowman';
    return null;
  }
  function round3Action(k) {
    switch (k) {
      case 'catch': swingNet(); return true;
      case 'museum': openMuseum(); return true;
      case 'market': openStall(); return true;
      case 'fish': startFishing(); return true;
      case 'disc': startDisc(); return true;
      case 'favor': if (favorW) { const w = favorW; confirmBox(`${w.info.owner} needs help`, favorAsk(w), 'Help', true, () => startFavor(w), () => { toast('Maybe next time'); }); } return true;
      case 'snowman': startSnowman(); return true;
      case 'flakes': startFlakes(); return true;
      default: return false;
    }
  }
  function round3Update(dt) {
    bakeTick(dt);
    stallTick(dt);
    if (place === 'park') {
      updateCatchables(dt);
      if (S && S.q && S.q.market) S.q.market.setOpen(marketDay() && unlockedFeat('market'));
    } else updateRoamers(dt);
    if (fun) {
      switch (fun.kind) {
        case 'fish': fishUpdate(dt); break;
        case 'snow': snowUpdate(dt); break;
        case 'flakes': flakesUpdate(dt); break;
        case 'disc': discUpdate(dt); break;
        default: break;
      }
    }
  }
  let r3T = 0;
  function round3Slow(dt) {
    r3T -= dt;
    if (r3T > 0) return;
    r3T = 2;
    if (visit || title) return;
    museumTick();
    if (!state.week || state.week.k !== weekNo()) rollWeek();
    if (meltSnowmen()) renderSnow();
  }
  // walks: critters to catch, a neighbor who might need a favor, snow figures from before
  function round3Walk() {
    spawnCatchables();
    rollFavor();
    renderSnow();
  }
  function round3Home() {
    clearCatchables();
    favorW = null;
    renderSnow();
    renderExhibits();
  }

  // Add ?debug to the game link to poke at the game from the browser console
  if (/[?&]debug\b/.test(location.search)) {
    window.VP = {
      get state() { return state; }, get place() { return place; }, get parkLoot() { return parkLoot; }, get weather() { return weatherId; },
      dogs, player, ball, grantToy, save, migrate, walkers, ALL_TRICKS,
      get tm() { return tm; }, get mode() { return mode; },
      get title() { return !!title; }, leaveTitle, startTitle, startTutorial, get tut() { return tut; }, tip, news, ensureEvent, eventOn, get prefs() { return prefs; },
      enterPhoto, exitPhoto, takePhoto, openCreator, applyPlayerLook, forecast, openWeather, get clock() { return clockNow; }, weatherAt, reqsOf, reqProgress, locReady, openToyPicker, pickToy, get lostDog() { return lostDog; }, spawnLostDog, updateMinimap, get B3() { return B3; },
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
      startTalk, talkMore, endTalk, nearestWalker, hintLines, chatLine, get talk() { return talk; }, homeLitShare, litAt, walkLit, nightHidesSpots, rebuildHomeLights, get homeLights() { return homeLights; }, get playerBeam() { return playerBeam; },
      weekKey, vendorSpecials, homeSpecials, rollSeason, checkSets, checkSeasons, spotCritter, sniffCritter, critterOk,
      openHouse, upgradeHouse, houseTier, roomCap, openPeople, renderPeople, storyMeet, storyPlay, storyTrick, storyComplete, storyReady, checkAllowance, get walkersList() { return walkers; },
      openDogSheet, renderDogSheet, startExam, examTry, examEnd, badgeRows, addSpec, heartsOfBond, get sheetDog() { return sheetDog; },
      rank, rankInfo, xpAtRank, gainXP, earn, addMastery, starsOf, unlockedFeat, needRank, refreshGates, openRanks, renderShop, fillAll, recordWalk, get notes() { return [...notes]; },
      groundAt, moveWithCollision, findPath, lineClear, updateTerrain, get roofOver() { return roofOver; }, atLookout, hiddenOf, hiddenTotal, exploredShare, markExplored, mmBackground, mmFogLayer, updateMinimap, locNote,
      calEvents, activeEvents, completeEvent, calState, startHunts, get hunt() { return hunt; }, openCalendar, setWxTab, maybeInvite, meetupLive, finishMeetup, placeMeetup,
      openJournal, journalAdd, showAway, awayLines, inboxAdd, openInbox, whatNow, haptic, reactToFurniture, get furnNew() { return furnNew; }, calOf, gdOf, evKnown, revealPlaceEvents,
      setGameDay(gd) { gdOverride = gd; tickClock(); }, calNight, calProgress, get clockNowRaw() { return clockNow; }, exitDecorate, enterDecorate, set awayHours(v) { awayHours = v; }, updateHunts,
      doEcho, startSled, useRocket, usePortal, rideWheel, carnivalTrick, turnStatue, catchFloater, craterDig, travel, canVisitNow, ctxAction, get ctxKind() { return ctxKind; },
      layerH, groundAtY, onTopLevel, get actx() { return actx; },
      rebuildFurniture, get beds() { return state.beds; }, digBed, growBeds, openBed, harvestBed, waterBed, renderBeds, bedSpot, homeCourse, groundsCourse, startAgility, agilityTap, enterTourney, tourneyToday, get agi() { return agi(); },
      spawnDucks, feedDucks, get ducks() { return ducks; }, nearDucks, startPainting, paintAt, finishPainting, get paint() { return paint; }, openMail, mailTick, receive, sendLetter, get mail() { return mail(); },
      spawnBottle, get bottle() { return bottle; }, pickBottle, makeMap, openTreasureMap, digTreasure, acceptSitting, sittingTick, finishSitting, get sitDog() { return sitDog; }, askName, youName, personal, hobbyCtx, openCourse, ringAt,
      get fun() { return fun; }, endFun, sitDown, homeSeat, nearestSeat, seatFrame, startSeek, startHide, hideFound, hideGiveUp, seekFound, startBrush, brushStroke, shakeOff, get playerWet() { return playerWet; },
      startRake, pileJump, spawnPatches, get patches() { return patches; }, pileKind, startSkip, skipThrow, waterNear, startGaze, gazeTap, canGaze, clearSky, startMusic, playKey, musicStyle, learnSing,
      startLead, leadStop, openPlay, funCtx, coverAt, hideSpot, get gazeK() { return gazeK; }, renderClutter, computeComfort, dogShape, setCtx, BASIC_TRICKS,
      // round: upstairs and rooms
      UPC, UPX, FH, viewFloor, get editFloor() { return editFloor; }, stairCells, startClimb, homeConnected, wallBlocks, wallSolidAt, enterBuildMode, exitBuildMode, setBuildTool, toggleBuildFloor, buildTap,
      get buildCands() { return buildCands; }, get stairDraft() { return stairDraft; }, placeStairs, setStairs, moveRoom, removeRoom, canRemove, canMoveFrom, cycleWall, checkBuild, syncChunkSet, buildRoom, checkUpstairsOpen,
      expandPrice, movePrice, upCap, upOpen, handleTap, drawWorld, withShift, buildInnerWalls, get innerWallGroup() { return innerWallGroup; }, get stairGroup() { return stairGroup; }, updatePlayer,
      openBake, startBake, bakeCut, bakeToIce, iceAt, bakeOven, get bake() { return bake; }, giveTreat, openStall, startStall, stallSell, get stall() { return stall; }, marketDay, marketStock, weekHot,
      openMuseum, museumTick, hallVisitors, hallChoices, museum, museumFame, renderMuseum, spawnCatchables, get catchables() { return catchables; }, swingNet, catchIt, openCritters, renderExhibits, get roamers() { return roamers; },
      startFishing, fishTap, fishPick, startSnowman, snowStart, snowNext, renderSnow, meltSnowmen, snowOnGround, startFlakes, flakesTap, set lastTap(v) { lastTap = v; }, startDisc, discTap, disc, discCupToday,
      rollFavor, startFavor, get favorW() { return favorW; }, weekStat, rollWeek, deliverGazette, openGazette, addRivalry, rivalry, rivalOf, toyPals, round3Ctx, round3Action, nearPier, nearDiscMat, nearMuseum, nearMarket,
    };
  }
  init();
})();
