'use strict';
/* PixelPups — the world map and the player places.
   The world map shows the land you have uncovered so far: walk places (round badges) and places just for you
   (signboards). Tap a place to see its stars, tap again to pick who comes along.
   Player places are full-screen places of their own with little games, not walks. game.js hands in what they
   can use (G) and calls window.PPVenues(G) once at start. */
window.PPVenues = function (G) {
  const { D, esc, IC, pick, rand, clamp } = G;
  const $ = (id) => document.getElementById(id);
  const S = () => G.state;
  const html = (tag, cls, inner) => { const e = document.createElement(tag); if (cls) e.className = cls; if (inner !== undefined) e.innerHTML = inner; return e; };
  const hash = (s) => G.hashStr(String(s));
  const seeded = (salt) => G.ART.mulberry32(hash(salt + '|' + (S().uid || '')));
  const shuffleR = (a, rr) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const coin = (n) => `${IC('coin')} ${n}`;
  const tix = (n) => `${IC('ticket')} ${n}`;
  const youName = () => G.youName() || 'You';
  const tap = (fn) => (e) => { e.preventDefault(); fn(e); };

  // =====================================================================
  // The player places
  // =====================================================================
  const VENUES = {
    cafe: { name: 'Café Pfote upstairs', short: 'Café upstairs', icon: 'cup', feat: 'v_cafe', needLoc: 'oldtown', at: [152, 82],
      blurb: 'Upstairs at Café Pfote: latte art, and neighbors with stories to tell.', dogs: 'Dogs welcome. There’s a water bowl by the window.' },
    mall: { name: 'Old Town Mall', short: 'Mall', icon: 'bag', feat: 'v_mall', needLoc: 'oldtown', at: [170, 98],
      blurb: 'Weekly specials, clothes with a mirror, toys, a furniture showroom, a photo booth and a food court.', dogs: 'Dogs welcome on a leash.' },
    library: { name: 'Town library', short: 'Library', icon: 'book', feat: 'v_library', needLoc: 'oldtown', at: [126, 86],
      blurb: 'A dog quiz, a breed encyclopedia and books to borrow.', dogs: 'Quiet dogs welcome. There’s a cozy reading rug.' },
    arcade: { name: 'Pixel Arcade', short: 'Arcade', icon: 'joy', feat: 'v_arcade', needLoc: 'oldtown', at: [160, 116],
      blurb: 'Claw machine, Boop-a-Mole and Paw Beat. Win tickets and trade them for prizes.', dogs: 'Dogs welcome. They love the flashing lights.' },
    minigolf: { name: 'Mini golf', short: 'Mini golf', icon: 'flag', feat: 'v_minigolf', needLoc: 'beach', at: [140, 148],
      blurb: 'Nine dog-themed holes by the sea. Swipe back and let go to putt.', dogs: 'Dogs cheer from the side of the green.' },
    flea: { name: 'Sunday flea market', short: 'Flea market', icon: 'stall', feat: 'v_flea', needLoc: 'park', at: [84, 98], sunday: true,
      blurb: 'Haggle for one-of-a-kind vintage furniture. Every Sunday.', dogs: 'Dogs welcome. The sellers love a friendly face.' },
    workshop: { name: 'Workshop hall', short: 'Workshop', icon: 'hammer', feat: 'v_workshop', needLoc: 'forest', at: [62, 112],
      blurb: 'Make your own food bowl, sew a bandana, and paint a dog house.', dogs: 'Dogs nap in the wood shavings corner.' },
    pool: { name: 'Indoor pool', short: 'Pool', icon: 'wave', feat: 'v_pool', needLoc: 'beach', at: [100, 152], dogsWait: true,
      blurb: 'Swim races against the neighbors and the diving board.', dogs: 'Dogs wait at the entrance, guarding your towel.' },
  };
  const venueOpen = (id) => { const V = VENUES[id]; return !!V && G.unlockedFeat(V.feat) && G.locUnlocked(V.needLoc); };
  const isSunday = () => G.clock.weekday === 'Sunday';
  const hoursToSunday = () => { const i = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(G.clock.weekday); return (6 - i + 7) % 7 || 7; };
  const venueClosedNow = (id) => !!(VENUES[id].sunday && !isSunday());
  const closedText = (id) => { const h = hoursToSunday(); return `Open on Sundays · next Sunday ${h <= 1 ? 'in under an hour' : `in about ${h} hours`}`; };

  // stars for a player place: points from playing there, same steps as walk places
  const vpts = (id) => ((S().vmastery || {})[id] || 0);
  function vstars(id) { let s = 0; D.MASTERY_STARS.forEach((t, i) => { if (vpts(id) >= t) s = i; }); return s; }
  function addVP(id, n) {
    if (!n) return;
    const st = S();
    st.vmastery = st.vmastery || {};
    const before = vstars(id);
    st.vmastery[id] = Math.round((vpts(id) + n) * 10) / 10;
    const after = vstars(id);
    if (after > before) {
      const coins = 30 * after;
      G.addCoins(coins);
      G.gainXP(25 * after);
      G.sfx('unlock');
      G.news({ title: `${VENUES[id].name}: ${'★'.repeat(after)}`, text: `You’re a regular! ${after} star${after > 1 ? 's' : ''} at the ${VENUES[id].short.toLowerCase()} (+${coins} coins).`, th: G.TH('pic', '⭐') });
    }
  }
  const starsLine = (n) => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;

  // a few drawn icons the game doesn't have
  const XI = {
    cup: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2M7 3c0 2 2 2 2 4M11 3c0 2 2 2 2 4"/>',
    joy: '<rect x="3" y="12" width="18" height="8" rx="3"/><path d="M8 12V8"/><circle cx="8" cy="6" r="2.2"/><circle cx="15" cy="16" r="1"/><circle cx="18" cy="16" r="1"/>',
    hammer: '<path d="M14 4l6 6-2 2-6-6zM12 6l-9 9a2 2 0 0 0 3 3l9-9"/>',
    pool: '<path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M3 13c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M8 13V5a2 2 0 0 1 4 0M16 13V5"/>',
    mirror: '<ellipse cx="12" cy="10" rx="6" ry="7"/><path d="M12 17v4M8 21h8M10 7l3-2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    claw: '<path d="M12 3v7M7 14l5-4 5 4M7 14l-1 4M17 14l1 4"/><circle cx="12" cy="20" r="1.6"/>',
    mole: '<circle cx="12" cy="11" r="5"/><path d="M3 20h18M6 20a6 4 0 0 1 12 0"/><circle cx="10" cy="10" r=".7" fill="currentColor"/><circle cx="14" cy="10" r=".7" fill="currentColor"/>',
    beat: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.4"/><circle cx="17" cy="16" r="2.4"/>',
    prize: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M12 9v11M4 13h16M12 9c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/>',
    wheel: '<ellipse cx="12" cy="16" rx="8" ry="3"/><path d="M6 15c0-5 2-9 6-9s6 4 6 9"/>',
    needle: '<path d="M4 20L18 6M15 3l6 6M14 8c-3-1-6 0-8 3"/>',
    saw: '<path d="M3 15l12-12 3 3-12 12zM6 18l2 2M9 15l2 2M12 12l2 2"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
    shelf: '<path d="M4 4h16v16H4zM4 12h16M8 4v8M11 6v6M15 14v6M18 15v5"/>',
    foam: '<circle cx="12" cy="12" r="8"/><path d="M12 16s-4-2.5-4-5a2 2 0 0 1 4-.5 2 2 0 0 1 4 .5c0 2.5-4 5-4 5z"/>',
    table: '<path d="M3 9h18M5 9v10M19 9v10M8 9l1-4h6l1 4"/>',
    golf: '<path d="M12 21V4l7 3-7 3"/><ellipse cx="12" cy="21" rx="5" ry="1.4"/>',
    dive: '<path d="M3 20h8M11 20V9h10M15 5a2 2 0 1 0 0-.1"/>',
    swim: '<circle cx="17" cy="6" r="2"/><path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M5 13l5-4 3 3 4-2"/>',
    sofa: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M2 12a2 2 0 0 1 4 0v3h12v-3a2 2 0 0 1 4 0v6H2zM5 18v2M19 18v2"/>',
    photo: '<rect x="6" y="2" width="12" height="20" rx="1"/><path d="M8 4h8v5H8zM8 11h8v5H8z"/>',
    food: '<path d="M4 11h16a8 8 0 0 1-16 0zM8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/>',
    door: '<rect x="5" y="3" width="14" height="18" rx="1"/><circle cx="15" cy="12" r="1"/>',
  };
  const VI = (n, cls) => (XI[n] ? `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${XI[n]}</svg>` : IC(n, cls));

  // =====================================================================
  // World map: a pixel-art island. Places you have unlocked clear the clouds around them.
  // =====================================================================
  const MW = 240, MH = 170;
  let SC = 3;   // screen pixels per map pixel: set to fill the screen when the map opens
  // where the walk places are (venues carry their own spot)
  const SPOTS = {
    park: [104, 110], oldtown: [146, 100], forest: [70, 82], beach: [120, 136], alpine: [92, 46], caves: [120, 58],
    snowy: [50, 30], carnival: [190, 126], fairy: [32, 90], moon: [214, 20], grounds: [184, 76],
  };
  const HOME = [94, 126];
  const placeAt = (id) => (VENUES[id] ? VENUES[id].at : SPOTS[id] || [MW / 2, MH / 2]);

  // value noise for the land shape and textures
  function noise2(seed) {
    const rr = G.ART.mulberry32(seed), N = 64, g = new Float32Array(N * N);
    for (let i = 0; i < g.length; i++) g[i] = rr();
    const at = (x, y) => g[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx, b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
      return a + (b - a) * sy;
    };
  }
  const fbm = (nf, x, y) => nf(x / 16, y / 16) * 0.55 + nf(x / 8, y / 8) * 0.3 + nf(x / 4, y / 4) * 0.15;

  const BIOMES = {
    meadow: ['#7cc56a', '#6db85c', '#8bd078'], town: ['#cfc2a8', '#c2b397', '#dacfb9'], forest: ['#3f8f4f', '#367f46', '#4a9b58'],
    fairy: ['#62ad95', '#8a82d6', '#57a088'], mountain: ['#9c9188', '#8c8178', '#b2a79c'], snow: ['#eaf2f9', '#dce7f2', '#ffffff'],
    plains: ['#a9d47a', '#9cc86d', '#b6dd88'], coast: ['#d8c08c', '#ccb27e', '#e2ca98'], beach: ['#ecd9a4', '#e3cd93', '#f3e3b6'],
  };
  const SEEDS = [
    ['meadow', 104, 110], ['meadow', 94, 126], ['meadow', 84, 98], ['town', 146, 98], ['town', 160, 112], ['town', 128, 88], ['town', 168, 94],
    ['forest', 70, 82], ['forest', 58, 108], ['forest', 80, 66], ['fairy', 30, 90], ['fairy', 22, 104], ['mountain', 92, 46], ['mountain', 120, 56], ['mountain', 140, 40],
    ['snow', 50, 30], ['snow', 30, 44], ['snow', 70, 20], ['plains', 184, 76], ['plains', 200, 60], ['plains', 170, 64], ['coast', 190, 126], ['coast', 206, 112],
    ['beach', 120, 140], ['beach', 100, 150], ['beach', 140, 150], ['meadow', 230, 40], ['plains', 236, 70],
  ];
  const BLOBS = [[110, 100, 64], [90, 46, 44], [48, 34, 32], [34, 94, 30], [180, 92, 40], [192, 126, 24], [256, 46, 46], [62, 138, 22], [140, 66, 34], [222, 70, 22]];
  let baseCanvas = null, landMask = null;
  function buildBase() {
    const c = document.createElement('canvas');
    c.width = MW; c.height = MH;
    const x = c.getContext('2d');
    const img = x.createImageData(MW, MH), px = img.data;
    const nf = noise2(4242), nf2 = noise2(777);
    const pts = Object.values(SPOTS).filter((p, i) => Object.keys(SPOTS)[i] !== 'moon').concat(Object.values(VENUES).map((V) => V.at), [HOME]);
    landMask = new Uint8Array(MW * MH);
    const landV = (i, j) => {
      let f = -1;
      for (const [cx, cy, r] of BLOBS) f = Math.max(f, 1 - Math.hypot(i - cx, j - cy) / r);
      for (const [cx, cy] of pts) f = Math.max(f, 1 - Math.hypot(i - cx, j - cy) / 13);
      // the moon is up in the sky, not on the island
      if (i > 196 && j < 40) f -= 0.6;
      return f + (fbm(nf, i, j) - 0.5) * 0.5;
    };
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) landMask[j * MW + i] = landV(i, j) > 0 ? 1 : 0;
    const isLand = (i, j) => i >= 0 && j >= 0 && i < MW && j < MH && landMask[j * MW + i];
    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const put = (i, j, col) => { if (i < 0 || j < 0 || i >= MW || j >= MH) return; const k = (j * MW + i) * 4, c3 = typeof col === 'string' ? hex(col) : col; px[k] = c3[0]; px[k + 1] = c3[1]; px[k + 2] = c3[2]; px[k + 3] = 255; };
    const biomeAt = (i, j) => {
      let best = null, bd = 1e9;
      const jx = (nf2(i / 6, j / 6) - 0.5) * 18, jy = (nf2(i / 6 + 40, j / 6) - 0.5) * 18;
      for (const [b, sx, sy] of SEEDS) { const d = Math.hypot(i + jx - sx, j + jy - sy); if (d < bd) { bd = d; best = b; } }
      return best;
    };
    const coastDist = (i, j) => { for (let r = 1; r <= 3; r++) for (let a = 0; a < 8; a++) { const ii = Math.round(i + Math.cos(a * 0.785) * r), jj = Math.round(j + Math.sin(a * 0.785) * r); if (!isLand(ii, jj)) return r; } return 9; };
    const bio = new Array(MW * MH);
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      const k = j * MW + i;
      if (!landMask[k]) {
        // the sea: deeper further out, sparkles of waves, and the night sky with the moon up in the corner
        if (i > 196 && j < 40) { const st = ((i * 7 + j * 13) % 37 === 0) ? '#fff6c8' : (j < 20 ? '#232a5c' : '#2c3570'); put(i, j, st); continue; }
        let near = 9;
        for (let r = 1; r <= 5 && near === 9; r++) if (isLand(i + r, j) || isLand(i - r, j) || isLand(i, j + r) || isLand(i, j - r)) near = r;
        const wave = (i + j * 3 + Math.floor(fbm(nf2, i * 2, j * 2) * 20)) % 23 === 0;
        put(i, j, wave ? '#a6d8f5' : near <= 2 ? '#79bdea' : near <= 5 ? '#5aa4dc' : '#4387c8');
        continue;
      }
      let b = biomeAt(i, j);
      const cd = coastDist(i, j);
      if (cd <= 2 && b !== 'snow' && b !== 'mountain' && b !== 'coast') b = 'beach';
      bio[k] = b;
      const pal = BIOMES[b], n = fbm(nf2, i * 3, j * 3);
      put(i, j, pal[n < 0.42 ? 1 : n > 0.6 ? 2 : 0]);
    }
    // a river from the mountains down to the sea
    const river = [[118, 60], [116, 72], [121, 86], [118, 100], [124, 116], [128, 130], [131, 150], [133, 168]];
    for (let s = 0; s < river.length - 1; s++) {
      const [x0, y0] = river[s], [x1, y1] = river[s + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
      for (let t = 0; t <= n; t++) { const xx = Math.round(x0 + ((x1 - x0) * t) / n + Math.sin(t * 0.7 + s) * 0.8), yy = Math.round(y0 + ((y1 - y0) * t) / n); if (isLand(xx, yy)) { put(xx, yy, '#5aa4dc'); put(xx + 1, yy, '#79bdea'); } }
    }
    // little roads from home to everywhere
    const road = (a, b) => {
      const [x0, y0] = a, [x1, y1] = b, n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let t = 2; t < n - 2; t++) {
        if (t % 3 === 2) continue;
        const xx = Math.round(x0 + ((x1 - x0) * t) / n), yy = Math.round(y0 + ((y1 - y0) * t) / n);
        if (isLand(xx, yy)) put(xx, yy, '#f0e4bf');
      }
    };
    for (const id of Object.keys(SPOTS)) if (id !== 'moon' && id !== 'fairy') road(HOME, SPOTS[id]);
    for (const V of Object.values(VENUES)) road(SPOTS[V.needLoc] || HOME, V.at);
    x.putImageData(img, 0, 0);
    // details: trees, houses, peaks, pines, flowers, fairy sparkles
    const rr = G.ART.mulberry32(99);
    const dot = (i, j, c, w = 1, h = 1) => { x.fillStyle = c; x.fillRect(i, j, w, h); };
    for (let j = 2; j < MH - 2; j += 3) for (let i = 2; i < MW - 2; i += 3) {
      const k = j * MW + i, b = bio[k];
      if (!b || rr() > 0.6) continue;
      const ox = i + Math.floor(rr() * 2), oy = j + Math.floor(rr() * 2);
      if (b === 'forest' && rr() < 0.8) { dot(ox, oy, '#2a6b37', 3, 2); dot(ox + 1, oy - 1, '#2f7a3e'); dot(ox + 1, oy + 2, '#6b4a2a'); }
      else if (b === 'fairy' && rr() < 0.5) { dot(ox, oy, rr() < 0.5 ? '#f7a8e0' : '#fff5a8'); if (rr() < 0.4) { dot(ox + 2, oy, '#e86fb0', 2, 1); dot(ox + 2, oy + 1, '#f6f0e8'); } }
      else if (b === 'mountain' && rr() < 0.45) { dot(ox + 1, oy - 2, '#6f665f'); dot(ox, oy - 1, '#7a706a', 3, 1); dot(ox - 1, oy, '#857a72', 5, 1); dot(ox + 1, oy - 2, '#f4f4f4'); }
      else if (b === 'snow' && rr() < 0.4) { dot(ox + 1, oy - 1, '#3f7a5a'); dot(ox, oy, '#2f6a4a', 3, 1); dot(ox + 1, oy + 1, '#6b4a2a'); }
      else if (b === 'town' && rr() < 0.55) { dot(ox, oy, rr() < 0.5 ? '#c0504d' : '#8d5a3c', 3, 1); dot(ox, oy + 1, '#f2ead8', 3, 1); dot(ox + 1, oy + 1, '#5a6f86'); }
      else if (b === 'meadow' && rr() < 0.18) dot(ox, oy, rr() < 0.5 ? '#ffe36b' : '#ff9fc0');
      else if (b === 'plains' && rr() < 0.12) dot(ox, oy, '#e8f6b4');
      else if (b === 'coast' && rr() < 0.35) dot(ox, oy, '#a8774a', 2, 1);
    }
    // landmarks: the big top and Ferris wheel, flags at the grounds, the lighthouse, the moon
    const [cx, cy] = SPOTS.carnival;
    x.strokeStyle = '#ff7aa8'; x.lineWidth = 1; x.beginPath(); x.arc(cx + 8, cy - 6, 4, 0, Math.PI * 2); x.stroke();
    dot(cx - 9, cy - 4, '#e5484d', 5, 3); dot(cx - 8, cy - 5, '#fff', 3, 1);
    const [gx, gy] = SPOTS.grounds;
    for (let k = 0; k < 3; k++) { dot(gx - 10 + k * 7, gy - 8, '#ffffff', 1, 4); dot(gx - 9 + k * 7, gy - 8, ['#e5484d', '#f5c542', '#3d7fd6'][k], 2, 2); }
    const [mx, my] = SPOTS.moon;
    x.fillStyle = '#f6f0c8'; x.beginPath(); x.arc(mx, my + 2, 8, 0, Math.PI * 2); x.fill();
    dot(mx - 3, my, '#ddd5a5', 2, 2); dot(mx + 2, my + 4, '#ddd5a5', 3, 2);
    dot(130, 158, '#ffffff', 2, 5); dot(130, 156, '#e5484d', 2, 2);
    baseCanvas = c;
  }

  // ----- the clouds -----
  // revealed: [x, y, r] per place you have; new ones grow open while you watch
  function revealList() {
    const out = [[HOME[0], HOME[1], 30, 'home']];
    for (const id of Object.keys(SPOTS)) if (G.locUnlocked(id)) out.push([...SPOTS[id], id === 'moon' ? 22 : 30, id]);
    for (const id of Object.keys(VENUES)) if (venueOpen(id)) out.push([...VENUES[id].at, 20, 'v:' + id]);
    return out;
  }
  let fogCanvas = null, fogAnim = null;
  function drawFog(grow) {
    if (!fogCanvas) { fogCanvas = document.createElement('canvas'); fogCanvas.width = MW; fogCanvas.height = MH; }
    const x = fogCanvas.getContext('2d');
    const img = x.createImageData(MW, MH), px = img.data;
    const nf = noise2(31337);
    const list = revealList().map(([a, b, r, k]) => [a, b, grow && grow[k] !== undefined ? r * grow[k] : r]);
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      let open = 0;
      for (const [a, b, r] of list) { const d = Math.hypot(i - a, j - b); open = Math.max(open, clamp((r - d) / 9 + 0.5, 0, 1)); }
      const wob = (fbm(nf, i * 0.9, j * 0.9) - 0.5) * 0.5;
      const v = clamp(open + wob * (open > 0 && open < 1 ? 1 : 0.2), 0, 1);
      const th = (BAYER[(j % 4) * 4 + (i % 4)] + 0.5) / 16;
      if (v > th) continue;
      const k = (j * MW + i) * 4, n = fbm(nf, i * 0.7 + 50, j * 0.7);
      const c = n > 0.6 ? [255, 253, 248] : n > 0.47 ? [243, 239, 230] : [228, 222, 210];
      px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }
  function composeMap() {
    const c = $('wmCanvas');
    if (!c) return;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.clearRect(0, 0, MW, MH);
    x.drawImage(baseCanvas, 0, 0);
    x.drawImage(fogCanvas, 0, 0);
  }

  // ----- the map screen -----
  let mapSel = null, mapPan = { x: 0, y: 0 }, mapBuilt = false;
  function buildMapDom() {
    if (mapBuilt) return;
    mapBuilt = true;
    const root = html('div', 'hidden', `
      <div id="wmHead" class="glass"><div class="wmTitle"><b>World map</b><small id="wmSub"></small></div><button class="x" id="wmClose" aria-label="Close map">${IC('x')}</button></div>
      <div id="wmView"><div id="wmInner"><canvas id="wmCanvas" width="${MW}" height="${MH}"></canvas><div id="wmPins"></div></div></div>
      <div id="wmInfo" class="glass hidden"></div>
      <div id="wmPack" class="hidden"><div class="wmPackCard glass"></div></div>`);
    root.id = 'wmap';
    document.body.appendChild(root);
    $('wmClose').addEventListener('click', closeMap);
    const view = $('wmView');
    let drag = null;
    view.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, px: mapPan.x, py: mapPan.y, moved: false, pin: e.target.closest('.wmPin') };
      try { view.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    });
    view.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 7) drag.moved = true;
      if (drag.moved) { mapPan.x = drag.px + dx; mapPan.y = drag.py + dy; applyPan(); }
    });
    const up = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) return;
      if (d.pin) tapPin(d.pin.dataset.id);
      else selectPin(null);
    };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', () => { drag = null; });
    $('wmPack').addEventListener('click', (e) => { if (e.target.id === 'wmPack') closePack(); });
  }
  function applyPan() {
    const view = $('wmView'), W = MW * SC, H = MH * SC;
    const vw = view.clientWidth || 360, vh = view.clientHeight || 600;
    const m = 30;
    mapPan.x = W <= vw ? (vw - W) / 2 : clamp(mapPan.x, vw - W - m, m);
    mapPan.y = H <= vh ? (vh - H) / 2 : clamp(mapPan.y, vh - H - m, m);
    $('wmInner').style.transform = `translate(${Math.round(mapPan.x)}px, ${Math.round(mapPan.y)}px)`;
  }
  function centerOn(p, smooth) {
    const view = $('wmView');
    mapPan.x = (view.clientWidth || 360) / 2 - p[0] * SC;
    mapPan.y = (view.clientHeight || 600) * 0.42 - p[1] * SC;
    const inner = $('wmInner');
    inner.style.transition = smooth ? 'transform 0.35s ease' : '';
    applyPan();
    if (smooth) setTimeout(() => { inner.style.transition = ''; }, 380);
  }
  // what kind of pin: a walk place, a player place, or a place still to find
  function pinState(id) {
    if (id === 'home') return 'home';
    if (VENUES[id]) return venueOpen(id) ? 'open' : (G.rank() >= D.RANK_UNLOCKS[VENUES[id].feat].rank - 1 && G.locUnlocked(VENUES[id].needLoc)) ? 'next' : 'hidden';
    if (G.locUnlocked(id)) return 'open';
    return G.locNext(id) ? 'next' : 'hidden';
  }
  function renderPins() {
    const box = $('wmPins');
    box.innerHTML = '';
    const ids = ['home', ...Object.keys(SPOTS), ...Object.keys(VENUES)];
    for (const id of ids) {
      const st = pinState(id);
      if (st === 'hidden') continue;
      const p = id === 'home' ? HOME : placeAt(id), ven = !!VENUES[id];
      const b = html('button', `wmPin ${ven ? 'ven' : id === 'home' ? 'homePin' : 'walk'} ${st}${mapSel === id ? ' sel' : ''}${hereNow(id) ? ' here' : ''}${ven && st === 'open' && venueClosedNow(id) ? ' closed' : ''}`);
      b.dataset.id = id;
      b.style.left = p[0] * SC + 'px';
      b.style.top = p[1] * SC + 'px';
      let badge;
      if (id === 'home') badge = `<span class="pinBadge">${IC('home')}</span>`;
      else if (st === 'next') badge = `<span class="pinBadge">${IC('question')}</span>`;
      else if (ven) badge = `<span class="pinBoard"><span class="pinRope"></span><span class="pinPlank">${VI(VENUES[id].icon)}</span><span class="pinPosts"></span></span>`;
      else badge = `<span class="pinBadge">${G.TH('loc', id)}</span>`;
      const name = id === 'home' ? 'Home' : st === 'next' ? 'Somewhere new' : ven ? VENUES[id].short : D.LOCATIONS[id].name;
      const stars = st === 'open' && id !== 'home' ? starsLine(ven ? vstars(id) : G.starsOf(id)) : '';
      b.innerHTML = `${badge}<span class="pinLabel"><b>${esc(name)}</b>${stars}</span>${hereNow(id) ? '<span class="pinHere">You’re here</span>' : ''}`;
      b.setAttribute('aria-label', name);
      box.appendChild(b);
    }
  }
  const hereNow = (id) => (id === 'home' ? G.place === 'home' && !G.venueId : VENUES[id] ? G.venueId === id : G.place === 'park' && G.loc === id);
  function selectPin(id) {
    mapSel = id;
    document.querySelectorAll('#wmPins .wmPin').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
    const info = $('wmInfo');
    if (!id) { info.classList.add('hidden'); return; }
    const st = pinState(id), ven = !!VENUES[id];
    let body = '';
    if (id === 'home') body = `<b>Home</b><small>${G.place === 'home' && !G.venueId ? 'You’re at home.' : 'Tap again to go home.'}</small>`;
    else if (st === 'next') {
      if (ven) { const U = D.RANK_UNLOCKS[VENUES[id].feat]; body = `<b>Somewhere new</b><small>Opens at Trainer rank ${U.rank}. Keep going!</small>`; }
      else body = `<b>Somewhere new</b>${G.reqsOf(id).map((U) => { const [h, n] = G.reqProgress(U); return `<small class="req${h >= n ? ' done' : ''}">${IC(h >= n ? 'check' : 'dot')} ${esc(G.reqText(U))}${n > 1 ? ` (${Math.min(h, n)}/${n})` : ''}</small>`; }).join('')}`;
    } else if (ven) {
      const V = VENUES[id];
      body = `<b>${esc(V.name)} ${starsLine(vstars(id))}</b><small>${esc(V.blurb)}</small>${venueClosedNow(id) ? `<small class="warn">${esc(closedText(id))}</small>` : `<small class="go">${hereNow(id) ? 'You’re here.' : 'Tap again to choose who comes along.'}</small>`}`;
    } else {
      const L = D.LOCATIONS[id], closed = !G.canVisitNow(id);
      body = `<b>${esc(L.name)} ${starsLine(G.starsOf(id))}</b><small>${esc(G.plain(G.locNote(id)))}</small>${closed ? `<small class="warn">Closed now · opens at ${L.hours[0]}:00</small>` : `<small class="go">${hereNow(id) ? 'You’re here.' : 'Tap again to choose who comes along.'}</small>`}`;
    }
    info.innerHTML = body;
    info.classList.remove('hidden');
    info.classList.toggle('ven', ven);
    // keep it on screen
    const p = id === 'home' ? HOME : placeAt(id), view = $('wmView');
    const sx = p[0] * SC + mapPan.x, sy = p[1] * SC + mapPan.y;
    if (sx < 50 || sx > view.clientWidth - 50 || sy < 60 || sy > view.clientHeight * 0.62) centerOn(p, true);
    G.sfx('tap');
  }
  function tapPin(id) {
    if (mapSel !== id) { selectPin(id); return; }
    const st = pinState(id);
    if (id === 'home') { if (G.place === 'home' && !G.venueId) { G.toast('You’re at home 🏠'); return; } closeMap(); G.goHome(); return; }
    if (st !== 'open') { G.sfx('fail'); return; }
    if (hereNow(id)) { G.toast('You’re already here!'); return; }
    if (VENUES[id] && venueClosedNow(id)) { G.toast(closedText(id)); return; }
    if (!VENUES[id] && !G.canVisitNow(id)) { G.toast(`${D.LOCATIONS[id].name} is closed right now`); return; }
    openPack(id);
  }
  let reveal = null;
  function openMap() {
    buildMapDom();
    if (!baseCanvas) buildBase();
    // fill the screen: about four fifths of its height
    $('wmap').classList.remove('hidden');
    const vh = $('wmView').clientHeight || window.innerHeight || 700;
    SC = clamp(Math.round(((vh * 0.84) / MH) * 2) / 2, 3, 6);
    const inner = $('wmInner'), cnv = $('wmCanvas');
    inner.style.width = cnv.style.width = MW * SC + 'px';
    inner.style.height = cnv.style.height = MH * SC + 'px';
    const st = S();
    // places you've unlocked since you last looked open up while you watch
    const keys = revealList().map((r) => r[3]);
    const seen = st.mapSeen || null;
    const fresh = seen ? keys.filter((k) => !seen.includes(k)) : [];
    st.mapSeen = keys;
    mapSel = null;
    $('wmInfo').classList.add('hidden');
    $('wmPack').classList.add('hidden');
    $('wmap').classList.remove('hidden');
    renderPins();
    const found = Object.keys(SPOTS).filter(G.locUnlocked).length + Object.keys(VENUES).filter(venueOpen).length;
    $('wmSub').textContent = `${found} of ${Object.keys(SPOTS).length + Object.keys(VENUES).length} places found`;
    const focus = G.venueId ? placeAt(G.venueId) : G.place === 'park' ? placeAt(G.loc) : HOME;
    requestAnimationFrame(() => centerOn(fresh.length ? (fresh[0].startsWith('v:') ? VENUES[fresh[0].slice(2)].at : SPOTS[fresh[0]] || focus) : focus));
    if (fresh.length) {
      const grow = {};
      fresh.forEach((k) => { grow[k] = 0; });
      reveal = { t: 0, grow };
      drawFog(grow);
      composeMap();
      const step = () => {
        if (!reveal || $('wmap').classList.contains('hidden')) { reveal = null; drawFog(); composeMap(); return; }
        reveal.t += 1 / 22;
        const k = Math.min(1, reveal.t * reveal.t * (3 - 2 * reveal.t));
        for (const f of fresh) reveal.grow[f] = k;
        drawFog(reveal.grow);
        composeMap();
        if (reveal.t < 1) setTimeout(step, 45);
        else { reveal = null; G.toast('New land on the map! ✨'); }
      };
      setTimeout(step, 450);
      G.sfx('twinkle');
    } else { drawFog(); composeMap(); }
    G.save();
  }
  function closeMap() { $('wmap').classList.add('hidden'); closePack(); }

  // ----- who comes along -----
  const STAY = [
    { k: 'nap', say: 'is in the middle of the best nap of the week 💤', back: 'woke up from the best nap of the week, all cozy and happy to see you! 💤' },
    { k: 'duck', say: 'has an important job today: guarding the squeaky duck 🦆', back: 'kept the squeaky duck perfectly safe and is SO happy you’re back! 🦆' },
    { k: 'sun', say: 'found the one perfect sunny spot on the floor ☀️', back: 'soaked up all the sunshine and greets you with a warm, happy wiggle ☀️' },
    { k: 'birds', say: 'is busy watching the birds from the window 🐦', back: 'watched about a hundred birds and can’t wait to tell you about them 🐦' },
    { k: 'chew', say: 'is deep in a very serious chew-toy project 🦴', back: 'finished the chew-toy project and proudly shows it off 🦴' },
    { k: 'sofa', say: 'is keeping the sofa warm for you 🛋️', back: 'kept the sofa perfectly warm for you. Come sit! 🛋️' },
  ];
  // very rarely a dog would rather stay home for a few hours, always for a happy reason
  function stayReason(d) {
    if (G.walkCount() < 4 || (d.isPuppy && d.isPuppy())) return null;
    // only a dog that's at home can choose to stay there
    if (d.restAt === 'venue' || (G.place === 'park' && !d.restAt)) return null;
    if (S().forceStay === d.id) return STAY[0];
    const block = Math.floor(G.clock.realHour / 3);
    const h = hash(`${G.clock.dateKey}|${block}|${d.id}`);
    if (h % 1000 >= 25) return null;
    return STAY[(h >> 10) % STAY.length];
  }
  let packFor = null, packPick = new Set();
  function openPack(id) {
    packFor = id;
    const dogs = G.dogs, sit = G.sitter;
    const last = S().lastPack;
    packPick = new Set();
    const useLast = Array.isArray(last) && (!last.length || last.some((k) => dogs.some((d) => d.id === k)));
    for (const d of dogs) if (!stayReason(d) && (!useLast || last.includes(d.id))) packPick.add(d.id);
    if (sit) packPick.add('sit');
    renderPack();
    $('wmPack').classList.remove('hidden');
  }
  function closePack() { packFor = null; const p = $('wmPack'); if (p) p.classList.add('hidden'); }
  function renderPack() {
    const id = packFor, ven = VENUES[id], dogs = G.dogs, sit = G.sitter;
    const name = ven ? ven.name : D.LOCATIONS[id].name;
    const card = $('wmPack').querySelector('.wmPackCard');
    const cards = dogs.map((d) => {
      const why = stayReason(d);
      const on = packPick.has(d.id);
      return `<button class="packDog${on ? ' on' : ''}${why ? ' stays' : ''}" data-pd="${d.id}"${why ? ' disabled' : ''}><img src="${G.dogPortrait(d)}" alt=""><b>${esc(d.name)}</b><small>${why ? esc(`${d.name} ${why.say} and would like to stay home this time.`) : on ? 'Coming along' : 'Stays home'}</small><span class="packTick">${IC(on ? 'check' : 'home')}</span></button>`;
    });
    if (sit) cards.push(`<button class="packDog${packPick.has('sit') ? ' on' : ''}" data-pd="sit"><img src="${G.dogPortrait(sit)}" alt=""><b>${esc(sit.name)}</b><small>${esc(G.sitting ? G.sitting.owner : '')}’s dog · ${packPick.has('sit') ? 'Coming along' : 'Stays home'}</small><span class="packTick">${IC(packPick.has('sit') ? 'check' : 'home')}</span></button>`);
    const n = [...packPick].length;
    const names = [...packPick].map((k) => (k === 'sit' ? sit && sit.name : (dogs.find((d) => d.id === k) || {}).name)).filter(Boolean);
    const note = ven ? (ven.dogsWait && n ? `<p class="packNote">${IC('paw')} ${esc(G.nameList(names))} will wait at the entrance, guarding your towel.</p>` : `<p class="packNote">${IC('paw')} ${esc(ven.dogs)}</p>`) : '';
    card.innerHTML = `<div class="packHead"><b>Who’s coming to ${esc(name)}?</b><button class="x" data-pk="close" aria-label="Back to the map">${IC('x')}</button></div>
      <div class="packList">${cards.join('')}</div>
      <button class="packMe${n ? '' : ' on'}" data-pk="me">${IC('person')} Just me</button>${note}
      <button class="primary packGo" data-pk="go">${n ? `Let’s go with ${esc(G.nameList(names))}` : 'Go on your own'}</button>`;
    card.onclick = (e) => {
      const b = e.target.closest('[data-pd],[data-pk]');
      if (!b || b.disabled) return;
      if (b.dataset.pd) { const k = b.dataset.pd; if (packPick.has(k)) packPick.delete(k); else packPick.add(k); G.sfx('tap'); renderPack(); return; }
      const k = b.dataset.pk;
      if (k === 'close') closePack();
      else if (k === 'me') { packPick.clear(); G.sfx('tap'); renderPack(); }
      else if (k === 'go') go();
    };
  }
  function go() {
    const id = packFor, ids = [...packPick];
    // dogs that stay home for a happy reason get to tell you about it later
    for (const d of G.dogs) { const why = stayReason(d); d.stayWhy = why && !ids.includes(d.id) ? why : null; }
    S().lastPack = ids.filter((k) => k !== 'sit');
    closePack();
    closeMap();
    if (VENUES[id]) G.enterVenue(id, ids);
    else G.goWalk(id, ids);
    if (!ids.length && !VENUES[id]) setTimeout(() => G.toast('Just you today. Enjoy the stroll! 🚶'), 1600);
  }

  // =====================================================================
  // Inside a player place: a pixel-art picture of the place, who came with you, and what there is to do
  // =====================================================================
  let cur = null;   // { id, dogs: [...], sit, game }
  function buildVenueDom() {
    if ($('venue')) return;
    const v = html('div', 'hidden', `
      <div class="vnTop"><canvas id="vnScene" width="160" height="72"></canvas><div class="vnSign"><b id="vnName"></b><span id="vnStars"></span></div></div>
      <div class="vnPack" id="vnPack"></div>
      <div class="vnActs" id="vnActs"></div>
      <div class="vnBar"><div class="vnWallet" id="vnWallet"></div><button class="soft" id="vnMap">${IC('map')} Map</button><button class="primary" id="vnLeave">${IC('home')} Home</button></div>`);
    v.id = 'venue';
    document.body.appendChild(v);
    const g = html('div', 'hidden', `<div class="vgHead"><button class="vgBack" id="vgBack" aria-label="Back">${IC('left')}</button><b id="vgTitle"></b><span id="vgRight"></span></div><div class="vgBody" id="vgBody"></div>`);
    g.id = 'vgame';
    document.body.appendChild(g);
    $('vnLeave').addEventListener('click', () => G.leaveVenue());
    $('vnMap').addEventListener('click', () => openMap());
    $('vgBack').addEventListener('click', () => closeGame());
    $('vnActs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !cur) return;
      const A = ACTS[cur.id].find((a) => a.id === b.dataset.act);
      if (!A) return;
      if (A.locked && A.locked()) { G.toast(A.locked()); G.sfx('fail'); return; }
      G.sfx('tap');
      A.run();
    });
  }
  function show(id, dogs, sit) {
    buildVenueDom();
    cur = { id, dogs: dogs.slice(), sit, game: null };
    const v = $('venue');
    v.className = 'vn-' + id;
    $('vgame').className = 'hidden vn-' + id;
    $('vnName').textContent = VENUES[id].name;
    drawScene(id);
    renderVenue();
    G.tip('venue:' + id, { title: VENUES[id].name, text: `${VENUES[id].blurb} ${VENUES[id].dogs}`, icon: 'map' });
    if (VENUES[id].dogsWait && dogs.length) setTimeout(() => G.toast(`${G.nameList(dogs.map((d) => d.name))} settle${dogs.length > 1 ? '' : 's'} down at the entrance with your towel 🐾`), 700);
    else if (dogs.length) setTimeout(() => G.toast(pick([`${dogs[0].name} sniffs around excitedly 🐾`, `${dogs[0].name} loves it here 🐾`, `${dogs[0].name} wags at everyone 🐾`])), 700);
  }
  function hide() {
    closeGame(true);
    const v = $('venue');
    if (v) v.classList.add('hidden');
    cur = null;
  }
  const covers = () => !!cur && !$('venue').classList.contains('hidden');
  function renderVenue() {
    if (!cur) return;
    const id = cur.id;
    $('vnStars').innerHTML = starsLine(vstars(id));
    const who = cur.dogs.map((d) => `<span class="vnDog"><img src="${G.dogPortrait(d)}" alt=""><small>${esc(d.name)}</small></span>`);
    if (cur.sit) who.push(`<span class="vnDog"><img src="${G.dogPortrait(cur.sit)}" alt=""><small>${esc(cur.sit.name)}</small></span>`);
    $('vnPack').innerHTML = who.length ? `${who.join('')}<span class="vnPackNote">${esc(VENUES[id].dogsWait ? 'Waiting at the entrance' : 'With you')}</span>` : `<span class="vnPackNote">${IC('person')} Just you today</span>`;
    $('vnActs').innerHTML = ACTS[id].map((A) => {
      const lk = A.locked && A.locked();
      return `<button class="vnAct${lk ? ' locked' : ''}" data-act="${A.id}"><span class="vnIc">${VI(A.icon)}</span><b>${esc(A.name)}</b><small>${lk ? esc(lk) : A.sub ? A.sub() : ''}</small></button>`;
    }).join('');
    wallet();
  }
  function wallet() {
    const w = $('vnWallet');
    if (!w) return;
    w.innerHTML = `<span>${coin(S().coins)}</span>${cur && (cur.id === 'arcade') ? `<span>${tix(S().tickets || 0)}</span>` : ''}`;
    const r = $('vgRight');
    if (r && cur && cur.game) r.innerHTML = cur.id === 'arcade' ? `${tix(S().tickets || 0)}` : coin(S().coins);
  }
  const companions = () => (cur ? cur.dogs.concat(cur.sit ? [cur.sit] : []) : []);
  // a dog that came along reacts now and then
  function dogCheer(lines) {
    const c = companions();
    if (!c.length || Math.random() < 0.35) return;
    const d = pick(c);
    G.toast(`${d.name} ${pick(lines)}`);
    G.petDog(d, 3);
  }

  // ----- the little games: a full-screen panel -----
  function openGame(title, build) {
    const g = $('vgame');
    $('vgTitle').textContent = title;
    // a fresh body for every game, so no old game's taps get in the way
    const oldBody = $('vgBody'), fresh = html('div', 'vgBody');
    fresh.id = 'vgBody';
    oldBody.replaceWith(fresh);
    g.classList.remove('hidden');
    const game = { alive: true, stops: [], body: $('vgBody'), title };
    cur.game = game;
    wallet();
    game.onStop = (fn) => game.stops.push(fn);
    game.loop = (fn) => {
      let last = performance.now();
      const step = (t) => {
        if (!game.alive) return;
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        try { fn(dt); } catch (e) { console.error(e); game.alive = false; G.toast('Something went wrong in this game. Please send a screenshot.'); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    game.after = (ms, fn) => { const t = setTimeout(() => { if (game.alive) fn(); }, ms); game.stops.push(() => clearTimeout(t)); };
    try { build(game); } catch (e) { console.error(e); G.toast('Something went wrong. Please send a screenshot.'); }
    return game;
  }
  function closeGame(quiet) {
    if (!cur || !cur.game) { const g = $('vgame'); if (g) g.classList.add('hidden'); return; }
    const game = cur.game;
    game.alive = false;
    game.stops.forEach((f) => { try { f(); } catch (_) { /* fine */ } });
    cur.game = null;
    $('vgame').classList.add('hidden');
    $('vgBody').innerHTML = '';
    if (!quiet) { renderVenue(); G.save(); }
  }
  // a canvas that fills the panel's width; draw in logical units (LW wide)
  function gameCanvas(game, LW, LH) {
    const body = game.body;
    const wrap = html('div', 'vgCanvasWrap');
    const c = document.createElement('canvas');
    wrap.appendChild(c);
    body.appendChild(wrap);
    const fit = () => {
      const maxW = Math.min((body.clientWidth || 390) - 28, 480), maxH = Math.max(240, (window.innerHeight || 700) - 190);
      const k = Math.min(maxW / LW, maxH / LH);
      c.style.width = Math.round(LW * k) + 'px';
      c.style.height = Math.round(LH * k) + 'px';
      c.width = Math.round(LW * k * dpr());
      c.height = Math.round(LH * k * dpr());
      cv.k = k;
      cv.x.setTransform(k * dpr(), 0, 0, k * dpr(), 0, 0);
    };
    const cv = { c, x: c.getContext('2d'), LW, LH, k: 1, fit };
    cv.pos = (e) => { const r = c.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * LW, y: ((e.clientY - r.top) / r.height) * LH }; };
    fit();
    c.style.touchAction = 'none';
    // keep following a finger that slides off the picture (pulling back a putt, sawing to the edge)
    c.addEventListener('pointerdown', (e) => { try { c.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } });
    return cv;
  }
  // results at the end of a game
  function result(game, o) {
    const r = html('div', 'vgResult glass', `<div class="vgrIc">${VI(o.icon || 'star')}</div><b>${esc(o.title)}</b>${(o.lines || []).map((l) => `<p>${l}</p>`).join('')}<div class="btnRow">${o.again ? '<button class="soft" data-r="again">Play again</button>' : ''}<button class="primary" data-r="done">Done</button></div>`);
    game.body.appendChild(r);
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'again') { closeGame(true); renderVenue(); o.again(); }
      else closeGame();
    });
    wallet();
    G.save();
  }
  function payFor(n, what) {
    if (!n) return true;
    if (!G.spend(n)) return false;
    if (what) G.toast(`${what} −🪙 ${n}`);
    wallet();
    return true;
  }

  // ----- pixel pictures of each place -----
  function drawScene(id) {
    const c = $('vnScene'), x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    const W = 160, H = 72;
    const R = (cx, cy, w, h, col) => { x.fillStyle = col; x.fillRect(cx, cy, w, h); };
    const rr = G.ART.mulberry32(hash('scene' + id));
    const wallFloor = (wall, wall2, floor, floor2, fy = 46) => {
      R(0, 0, W, fy, wall);
      for (let i = 0; i < W; i += 8) R(i, 0, 4, fy, wall2);
      R(0, fy, W, H - fy, floor);
      for (let j = fy; j < H; j += 4) for (let i = (j / 4) % 2 ? 0 : 6; i < W; i += 12) R(i, j, 6, 2, floor2);
      R(0, fy - 2, W, 2, '#00000022');
    };
    const person = (px, py, shirt, hair, skin = '#f1c8a0') => { R(px, py, 4, 4, skin); R(px, py - 1, 4, 2, hair); R(px - 1, py + 4, 6, 6, shirt); R(px, py + 10, 1, 4, '#3a4a6b'); R(px + 3, py + 10, 1, 4, '#3a4a6b'); };
    const dogPx = (px, py, col) => { R(px, py, 7, 3, col); R(px + 6, py - 2, 3, 3, col); R(px, py + 3, 1, 2, col); R(px + 5, py + 3, 1, 2, col); R(px - 1, py - 1, 1, 2, col); R(px + 8, py - 1, 1, 1, '#222'); };
    const win = (wx, wy, w, h, sky = '#bfe3f7') => { R(wx - 1, wy - 1, w + 2, h + 2, '#f4efe6'); R(wx, wy, w, h, sky); R(wx + Math.floor(w / 2), wy, 1, h, '#f4efe6'); R(wx, wy + Math.floor(h / 2), w, 1, '#f4efe6'); };
    switch (id) {
      case 'cafe': {
        wallFloor('#f2dcc0', '#ecd2b2', '#9b6a45', '#8a5c3a');
        win(14, 8, 26, 20); win(118, 8, 26, 20);
        R(56, 6, 48, 10, '#5d3a22'); x.fillStyle = '#f7e7c8'; x.font = '7px monospace'; x.fillText('CAFÉ PFOTE', 60, 14);
        for (const tx of [30, 74, 118]) { R(tx, 50, 18, 3, '#7a4a2a'); R(tx + 8, 53, 2, 10, '#5d3a22'); R(tx + 4, 46, 3, 4, '#ffffff'); R(tx + 11, 46, 3, 4, '#ffffff'); }
        person(24, 40, '#e57373', '#3b2a1e'); person(96, 40, '#4db6ac', '#d9a441'); dogPx(46, 60, '#c99a6b'); dogPx(132, 60, '#2c2c31');
        for (let k = 0; k < 6; k++) R(60 + k * 7, 22, 4, 6, ['#e57373', '#ffd54f', '#81c784', '#64b5f6', '#ba68c8', '#ffb74d'][k]);
        break;
      }
      case 'mall': {
        wallFloor('#e8eef6', '#dde6f1', '#cfd8e3', '#c0cad6', 44);
        const shops = [['#ef9a9a', 'CLOTHES'], ['#90caf9', 'TOYS'], ['#ffe082', 'HOME'], ['#a5d6a7', 'FOOD']];
        shops.forEach(([col, t], k) => { const sx = 4 + k * 39; R(sx, 6, 36, 34, '#ffffff'); R(sx, 6, 36, 7, col); R(sx + 4, 16, 28, 22, '#e3f2fd'); x.fillStyle = '#ffffff'; x.font = '5px monospace'; x.fillText(t, sx + 3, 12); R(sx + 8, 30, 6, 8, col); R(sx + 20, 26, 8, 12, '#ffffff99'); });
        R(66, 46, 28, 6, '#b0bec5'); R(70, 40, 20, 6, '#7fd1b0');
        person(30, 48, '#ba68c8', '#1a1a1a'); person(120, 50, '#ffb74d', '#6d4c41'); dogPx(40, 62, '#d9873a');
        break;
      }
      case 'library': {
        wallFloor('#d9c8a9', '#d0bd9b', '#7a5236', '#6c472e');
        for (let s = 0; s < 4; s++) { const sx = 4 + s * 40; R(sx, 4, 34, 40, '#5d3a22'); for (let r = 0; r < 4; r++) { R(sx + 2, 6 + r * 10, 30, 1, '#3b2414'); for (let b = 0; b < 9; b++) R(sx + 3 + b * 3, 7 + r * 10, 2, 8 - (b * 7 + r) % 3, ['#c0504d', '#3d7fd6', '#5f8a5c', '#e9a400', '#8a5cf6', '#e5738f'][(b + r * 2 + s) % 6]); } }
        R(56, 54, 48, 12, '#a5413f'); R(58, 56, 44, 8, '#c0504d');
        R(120, 50, 22, 3, '#8d5a34'); R(124, 47, 6, 3, '#ffffff'); person(104, 42, '#5b7cfa', '#3b2a1e');
        dogPx(70, 56, '#e8b27a');
        break;
      }
      case 'arcade': {
        R(0, 0, W, H, '#1c1736');
        for (let i = 0; i < 40; i++) R(Math.floor(rr() * W), Math.floor(rr() * 40), 1, 1, '#ffffff55');
        R(0, 50, W, 22, '#2a2350'); for (let i = 0; i < W; i += 10) R(i, 50, 5, 22, '#251e48');
        const cols = ['#ff5fa2', '#5be0ff', '#ffe24a', '#7cff6b', '#b98bff'];
        for (let k = 0; k < 5; k++) { const cx = 8 + k * 31; R(cx, 14, 22, 40, '#3f2a8a'); R(cx + 2, 18, 18, 12, cols[k]); R(cx + 4, 20, 14, 8, '#140f2b'); R(cx + 6 + (k % 3) * 3, 22, 3, 3, cols[(k + 2) % 5]); R(cx, 10, 22, 4, cols[k]); R(cx + 4, 34, 3, 3, '#e53935'); R(cx + 12, 35, 2, 2, '#ffca28'); }
        R(64, 2, 34, 7, '#ff5fa2'); x.fillStyle = '#1c1736'; x.font = '5px monospace'; x.fillText('ARCADE', 69, 8);
        person(40, 50, '#4db6ac', '#d9a441'); dogPx(56, 64, '#8a929c');
        break;
      }
      case 'minigolf': {
        R(0, 0, W, 24, '#a8dcf5'); R(0, 18, W, 6, '#6fb4e6'); for (let i = 0; i < W; i += 9) R(i, 19, 4, 1, '#d6f0ff');
        R(0, 24, W, 48, '#7cc56a');
        R(10, 30, 70, 30, '#4caf50'); R(12, 32, 66, 26, '#5cc15e'); R(64, 44, 3, 3, '#1b1b1b'); R(65, 34, 1, 11, '#ffffff'); R(66, 34, 5, 3, '#e53935');
        R(90, 34, 60, 28, '#4caf50'); R(92, 36, 56, 24, '#5cc15e'); R(110, 40, 12, 10, '#d9a066'); R(108, 38, 16, 3, '#c0392b'); R(113, 45, 6, 5, '#3b2a1e');
        R(136, 46, 4, 6, '#e53935'); R(135, 45, 6, 1, '#e53935'); R(20, 46, 2, 2, '#ffffff');
        person(28, 40, '#ffb74d', '#6d4c41'); dogPx(40, 64, '#d9a441');
        break;
      }
      case 'flea': {
        R(0, 0, W, 30, '#bfe3f7'); R(10, 6, 14, 5, '#ffffff'); R(16, 4, 8, 3, '#ffffff'); R(110, 9, 18, 4, '#ffffff');
        R(0, 30, W, 42, '#8bcf7a'); for (let i = 0; i < 60; i++) R(Math.floor(rr() * W), 30 + Math.floor(rr() * 42), 1, 1, '#76b866');
        const awn = [['#e5484d', '#ffffff'], ['#3d7fd6', '#ffffff'], ['#f5c542', '#ffffff']];
        awn.forEach(([a, b], k) => { const sx = 6 + k * 52; for (let s = 0; s < 8; s++) R(sx + s * 6, 20, 6, 6, s % 2 ? b : a); R(sx, 26, 2, 22, '#8d6e4f'); R(sx + 46, 26, 2, 22, '#8d6e4f'); R(sx, 40, 48, 4, '#a5713f'); R(sx + 6, 32, 6, 8, ['#c9a227', '#7b4a2a', '#4f8fbf'][k]); R(sx + 20, 34, 10, 6, ['#5d3a22', '#7b2d5a', '#c0504d'][k]); R(sx + 34, 30, 5, 10, '#8d5a34'); });
        person(30, 50, '#e57373', '#9c9c9c'); person(84, 52, '#5b7cfa', '#3b2a1e'); dogPx(100, 64, '#f4f1ea');
        break;
      }
      case 'workshop': {
        wallFloor('#c9a882', '#bf9d76', '#a58460', '#987752');
        R(6, 6, 50, 3, '#6d4c41'); for (let k = 0; k < 7; k++) R(9 + k * 7, 9, 2, 8 + (k % 3) * 2, ['#9e9e9e', '#795548', '#e53935', '#9e9e9e', '#ffca28', '#795548', '#9e9e9e'][k]);
        R(10, 40, 40, 4, '#8d5a34'); R(14, 44, 3, 14, '#6d4c41'); R(43, 44, 3, 14, '#6d4c41'); R(18, 34, 10, 6, '#c86b4a'); R(32, 36, 8, 4, '#e8d7b0');
        R(66, 44, 22, 4, '#7a4a2a'); R(72, 38, 10, 6, '#c86b4a'); R(70, 48, 14, 10, '#5d3a22');
        R(100, 30, 50, 14, '#ffffff'); for (let k = 0; k < 6; k++) R(102 + k * 8, 32, 6, 10, ['#e5484d', '#3d7fd6', '#f5c542', '#3fbf7f', '#8a5cf6', '#ff8a3d'][k]);
        R(110, 52, 30, 4, '#8d5a34'); R(116, 46, 14, 6, '#7fb3d5'); R(114, 44, 18, 3, '#f5c542');
        person(56, 42, '#6b7a4a', '#3b2a1e'); dogPx(130, 64, '#7a4a2a'); R(124, 66, 16, 3, '#f3e2b3');
        break;
      }
      case 'pool': {
        R(0, 0, W, 30, '#e3f2f7'); for (let i = 0; i < W; i += 6) for (let j = 0; j < 30; j += 6) R(i, j, 5, 5, (i + j) % 12 ? '#d6ecf3' : '#cfe7f0');
        R(0, 30, W, 42, '#4fb3e0');
        for (let l = 0; l < 4; l++) { R(0, 38 + l * 9, W, 1, '#ffffff'); for (let i = 0; i < W; i += 6) R(i, 38 + l * 9, 3, 1, ['#e53935', '#ffffff'][(i / 6) % 2]); }
        for (let i = 0; i < 30; i++) R(Math.floor(rr() * W), 31 + Math.floor(rr() * 40), 3, 1, '#8fd6f2');
        R(120, 16, 36, 3, '#ffffff'); R(150, 19, 3, 12, '#b0bec5'); R(118, 12, 4, 4, '#f1c8a0'); R(118, 10, 4, 2, '#3b2a1e');
        R(14, 44, 4, 3, '#f1c8a0'); R(13, 47, 8, 1, '#ffffff'); R(60, 52, 4, 3, '#e0ac7e'); R(59, 55, 8, 1, '#ffffff');
        R(4, 20, 18, 10, '#ff8a3d'); dogPx(8, 22, '#d9873a');
        break;
      }
      default: R(0, 0, W, H, '#ddd');
    }
  }

  // =====================================================================
  // Café Pfote upstairs: latte art, and the neighbors' table
  // =====================================================================
  const LATTE = [
    ['heart', 'a heart'], ['paw', 'a paw print'], ['bone', 'a bone'], ['leaf', 'a leaf'], ['star', 'a star'], ['face', 'a puppy face'],
  ];
  function shapePath(x, kind, cx, cy, s) {
    x.beginPath();
    const E = (ex, ey, rx, ry) => { x.moveTo(cx + (ex + rx) * s, cy + ey * s); x.ellipse(cx + ex * s, cy + ey * s, rx * s, ry * s, 0, 0, Math.PI * 2); };
    switch (kind) {
      case 'heart':
        x.moveTo(cx, cy + 0.75 * s);
        x.bezierCurveTo(cx - 1.05 * s, cy + 0.05 * s, cx - 0.75 * s, cy - 0.85 * s, cx, cy - 0.35 * s);
        x.bezierCurveTo(cx + 0.75 * s, cy - 0.85 * s, cx + 1.05 * s, cy + 0.05 * s, cx, cy + 0.75 * s);
        break;
      case 'paw': E(0, 0.25, 0.42, 0.34); E(-0.5, -0.25, 0.15, 0.2); E(-0.18, -0.55, 0.15, 0.2); E(0.18, -0.55, 0.15, 0.2); E(0.5, -0.25, 0.15, 0.2); break;
      case 'bone': x.rect(cx - 0.55 * s, cy - 0.13 * s, 1.1 * s, 0.26 * s); E(-0.6, -0.18, 0.17, 0.17); E(-0.6, 0.18, 0.17, 0.17); E(0.6, -0.18, 0.17, 0.17); E(0.6, 0.18, 0.17, 0.17); break;
      case 'leaf': E(0, -0.05, 0.42, 0.7); break;
      case 'star':
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = (k % 2 ? 0.34 : 0.78) * s; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
        x.closePath();
        break;
      case 'face': E(0, 0.05, 0.5, 0.48); E(-0.55, -0.05, 0.16, 0.36); E(0.55, -0.05, 0.16, 0.36); break;
      default: E(0, 0, 0.5, 0.5);
    }
  }
  function playLatte() {
    const [kind, label] = pick(LATTE);
    openGame('Latte art', (game) => {
      game.body.insertAdjacentHTML('beforeend', `<p class="vgHelp">Pour the foam with your finger: draw <b>${esc(label)}</b> inside the cup. Tap Serve when it looks good.</p>`);
      const cv = gameCanvas(game, 300, 300), x = cv.x;
      const milk = document.createElement('canvas'); milk.width = milk.height = 300;
      const mx = milk.getContext('2d');
      let left = 1, pour = null, done = false;
      const btns = html('div', 'btnRow', '<button class="soft" data-l="clear">Start over</button><button class="primary" data-l="serve">Serve</button>');
      game.body.appendChild(btns);
      const meter = html('div', 'vgMeter', '<i></i>');
      game.body.insertBefore(meter, btns);
      const draw = () => {
        x.clearRect(0, 0, 300, 300);
        x.fillStyle = '#f4efe6'; x.beginPath(); x.arc(150, 150, 146, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#e6dccb'; x.beginPath(); x.arc(150, 150, 128, 0, Math.PI * 2); x.fill();
        const g = x.createRadialGradient(150, 140, 20, 150, 150, 116);
        g.addColorStop(0, '#b27a4c'); g.addColorStop(1, '#6e4124');
        x.fillStyle = g; x.beginPath(); x.arc(150, 150, 116, 0, Math.PI * 2); x.fill();
        x.save(); x.setLineDash([6, 6]); x.strokeStyle = 'rgba(255,248,236,0.45)'; x.lineWidth = 2; shapePath(x, kind, 150, 150, 92); x.stroke(); x.restore();
        x.drawImage(milk, 0, 0);
        meter.firstChild.style.width = Math.round(left * 100) + '%';
      };
      const blob = (p) => {
        if (left <= 0 || Math.hypot(p.x - 150, p.y - 150) > 112) return;
        const r = 10;
        const gg = mx.createRadialGradient(p.x, p.y, 2, p.x, p.y, r);
        gg.addColorStop(0, 'rgba(255,250,240,1)'); gg.addColorStop(0.75, 'rgba(250,240,222,0.95)'); gg.addColorStop(1, 'rgba(250,240,222,0)');
        mx.fillStyle = gg; mx.beginPath(); mx.arc(p.x, p.y, r, 0, Math.PI * 2); mx.fill();
      };
      cv.c.addEventListener('pointerdown', (e) => { if (done) return; pour = cv.pos(e); blob(pour); draw(); });
      cv.c.addEventListener('pointermove', (e) => {
        if (!pour || done) return;
        const p = cv.pos(e), d = Math.hypot(p.x - pour.x, p.y - pour.y);
        const n = Math.ceil(d / 4);
        for (let k = 1; k <= n; k++) blob({ x: pour.x + ((p.x - pour.x) * k) / n, y: pour.y + ((p.y - pour.y) * k) / n });
        left = Math.max(0, left - d / 2600);
        pour = p;
        draw();
      });
      const lift = () => { pour = null; };
      cv.c.addEventListener('pointerup', lift); cv.c.addEventListener('pointercancel', lift);
      const serve = () => {
        if (done) return;
        done = true;
        // how much of the shape is covered, and how much foam went outside it
        const N = 75, t = document.createElement('canvas'); t.width = t.height = N;
        const tx = t.getContext('2d');
        tx.fillStyle = '#000'; shapePath(tx, kind, N / 2, N / 2, 92 * (N / 300)); tx.fill();
        const T = tx.getImageData(0, 0, N, N).data;
        const m2 = document.createElement('canvas'); m2.width = m2.height = N;
        const m2x = m2.getContext('2d'); m2x.drawImage(milk, 0, 0, N, N);
        const M = m2x.getImageData(0, 0, N, N).data;
        let tn = 0, hit = 0, mn = 0, spill = 0;
        for (let i = 3; i < T.length; i += 4) { const ti = T[i] > 128, mi = M[i] > 110; if (ti) tn++; if (mi) mn++; if (ti && mi) hit++; if (mi && !ti) spill++; }
        const cover = tn ? hit / tn : 0, out = mn ? spill / mn : 1;
        const score = clamp(cover * 1.25 - out * 0.45, 0, 1);
        const tips = 4 + Math.round(score * 16);
        G.addCoins(tips);
        G.earn('latte');
        addVP('cafe', 3 + score * 8);
        const verdict = score >= 0.72 ? 'Barista-perfect! ☕' : score >= 0.48 ? 'Lovely! The guests are taking photos.' : score >= 0.25 ? 'Cozy and delicious.' : 'A very abstract latte. Still delicious!';
        if (score >= 0.72) { G.sfx('unlock'); dogCheer(['sniffs the foam and sneezes happily ☕', 'wags at the beautiful latte']); } else G.sfx('find');
        result(game, { icon: 'foam', title: verdict, lines: [score >= 0.25 ? `It looks ${Math.round(score * 100)}% like ${esc(label)}.` : `Somewhere in there is ${esc(label)}!`, `The guests leave a tip: ${coin(tips)}`], again: playLatte });
      };
      btns.addEventListener('click', (e) => {
        const b = e.target.closest('[data-l]');
        if (!b) return;
        if (b.dataset.l === 'clear' && !done) { mx.clearRect(0, 0, 300, 300); left = 1; draw(); }
        if (b.dataset.l === 'serve') serve();
      });
      draw();
    });
  }
  const STORIES = [
    '{ndog} once stole a whole baguette from the bakery and carried it home like a trophy. The baker just laughed and gave me a second one for free.',
    'When {ndog} was a puppy, the vacuum cleaner was the scariest thing in the world. Now {ndog} follows it around the flat like a little supervisor.',
    'Last winter {ndog} saw snow for the first time and tried to catch every single snowflake. We stayed out until our noses were bright red.',
    'My grandmother taught {ndog} to bring her slippers. {ndog} still brings me one slipper every morning. Only ever the left one.',
    '{ndog} has a best friend at the park, a very old pug called Herr Knopf. They just sit next to each other and watch the ducks together.',
    'I got lost on a hike once, and {ndog} led me all the way back to the car. {ndog} got the biggest sausage in the village that night.',
    '{ndog} howls along with the church bells every Sunday. The whole street knows the song by now.',
    'On my birthday {ndog} brought me a stick taller than both of us. It’s still standing in the hallway, like a little monument.',
    'We tried a dog yoga class once. {ndog} fell asleep in the first five minutes, and the teacher said it was the most relaxed pose of the day.',
    '{ndog} and I met at the shelter on a rainy Tuesday. {ndog} put a paw on my shoe, and that was that.',
    '{ndog} is sure the mail carrier comes just to visit. We leave a treat by the door so {ndog} can “give” her a present.',
    'The first time {ndog} went to the beach, {ndog} barked at every wave to make them stop. They didn’t. {ndog} forgave them eventually.',
  ];
  const STORY_REPLIES = [['Aww, that’s lovely!', 'I knew you’d like that one!'], ['Ha! Tell me more!', 'Oh, I could talk about {ndog} all day…'], ['That’s so {ndog}!', 'Right? {ndog} is one of a kind.']];
  function tableNeighbors() {
    const known = G.knownNeighbors(), pool = known.length >= 3 ? known : known.concat(D.NEIGHBORS.filter((N) => !known.includes(N)));
    const rr = seeded('table|' + G.clock.gameDay);
    return shuffleR(pool, rr).slice(0, 3);
  }
  function playStories() {
    openGame('The neighbors’ table', (game) => {
      const st = S();
      st.cafeTold = st.cafeTold && st.cafeTold.day === G.clock.dateKey ? st.cafeTold : { day: G.clock.dateKey, who: [] };
      const render = () => {
        const list = tableNeighbors();
        const pups = companions();
        game.body.innerHTML = `<p class="vgHelp">Pull up a chair. Who would you like to listen to?</p><div class="vgList">${list.map((N) => {
          const told = st.cafeTold.who.includes(N.owner);
          return `<button class="vgRow${told ? ' done' : ''}" data-n="${esc(N.owner)}"><img class="th" src="${G.personPortrait(N)}" alt=""><span><b>${esc(N.owner)}</b><small>${told ? 'Already told you a story today' : `Has a story about ${esc(N.dog.name)}`}</small></span></button>`;
        }).join('')}</div>${pups.length ? `<button class="soft wide" data-n="__pup">${VI('cup')} Pup cups for ${esc(G.nameList(pups.map((d) => d.name)))} · ${coin(5 * pups.length)}</button>` : ''}`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-n],[data-rep]');
        if (!b) return;
        if (b.dataset.n === '__pup') {
          const pups = companions();
          if (!payFor(5 * pups.length)) return;
          for (const d of pups) G.petDog(d, 10);
          G.toast(`${G.nameList(pups.map((d) => d.name))} lick${pups.length > 1 ? '' : 's'} the whipped cream off their nose${pups.length > 1 ? 's' : ''} 🍦`);
          return;
        }
        if (b.dataset.rep !== undefined) {
          const N = D.NEIGHBORS.find((n) => n.owner === b.dataset.who), R = STORY_REPLIES[+b.dataset.rep];
          G.addNFriend(N.owner, 3);
          G.earn('story');
          addVP('cafe', 4);
          G.sfx('find');
          game.body.innerHTML = `<div class="vgStory"><img class="th big" src="${G.personPortrait(N)}" alt=""><p>“${esc(G.nfill(R[1], N))}”</p><p class="sub">You and ${esc(N.owner)} are getting along nicely.</p><button class="primary" data-n="__back">Back to the table</button></div>`;
          return;
        }
        if (b.dataset.n === '__back') { render(); return; }
        const N = D.NEIGHBORS.find((n) => n.owner === b.dataset.n);
        if (!N || st.cafeTold.who.includes(N.owner)) { G.toast(`${b.dataset.n} has told you a story today already. Come back tomorrow!`); return; }
        st.cafeTold.who.push(N.owner);
        const rr = seeded('story|' + N.owner + '|' + G.clock.dateKey);
        const story = STORIES[Math.floor(rr() * STORIES.length)];
        game.body.innerHTML = `<div class="vgStory"><img class="th big" src="${G.personPortrait(N)}" alt=""><b>${esc(N.owner)}</b><p>“${esc(G.nfill(story, N))}”</p><div class="btnCol">${STORY_REPLIES.map((R, k) => `<button class="soft" data-rep="${k}" data-who="${esc(N.owner)}">${esc(G.nfill(R[0], N))}</button>`).join('')}</div></div>`;
        G.sfx('tip');
      });
    });
  }

  // =====================================================================
  // The library: a dog quiz that fills the breed encyclopedia, and books to borrow
  // =====================================================================
  const QUIZ = [
    ['How many teeth does a grown-up dog usually have?', ['42', '32', '28', '50']],
    ['What’s special about a dog’s nose print?', ['It’s unique, like a fingerprint', 'It changes every year', 'It’s always round', 'It shows the dog’s age']],
    ['Which is a dog’s strongest sense?', ['Smell', 'Sight', 'Taste', 'Touch']],
    ['Why do dogs pant?', ['To cool down', 'To smell better', 'Because they’re bored', 'To clean their teeth']],
    ['Corgis were first bred to…', ['Herd cattle', 'Pull sleds', 'Hunt badgers', 'Guard castles']],
    ['“Dachshund” is German for…', ['Badger dog', 'Sausage dog', 'Short dog', 'Brave dog']],
    ['Siberian Huskies were bred to…', ['Pull sleds', 'Herd sheep', 'Fetch ducks', 'Guard farms']],
    ['Retrievers were bred to…', ['Bring back birds for hunters', 'Pull carts', 'Herd geese', 'Guard sheep']],
    ['Poodles were first water dogs that fetched…', ['Ducks', 'Fish', 'Balls', 'Sticks']],
    ['Puppies born together are called…', ['A litter', 'A pack', 'A herd', 'A flock']],
    ['Puppies are born with their eyes…', ['Closed', 'Wide open', 'Half open', 'Open, but blue']],
    ['About when do puppies open their eyes?', ['At about 2 weeks', 'After 2 days', 'At 2 months', 'Right away']],
    ['A loose, wide tail wag usually means…', ['A happy, relaxed dog', 'An angry dog', 'A sleepy dog', 'A cold dog']],
    ['Which of these must dogs never eat?', ['Chocolate', 'Carrots', 'Plain rice', 'Cooked chicken']],
    ['Grapes and raisins for dogs are…', ['Harmful, keep them away', 'A healthy snack', 'Fine as a treat', 'Good for their teeth']],
    ['Where do dogs sweat a little?', ['Through their paw pads', 'Through their ears', 'Through their tails', 'All over, like people']],
    ['A husky’s eyes can be…', ['Blue, brown, or one of each', 'Only green', 'Only brown', 'Purple']],
    ['Poodle coats are known for being…', ['Curly and low-shedding', 'Short and shiny', 'Long and straight', 'Like feathers']],
    ['“Corgi” is often said to mean… in Welsh', ['Dwarf dog', 'Fast runner', 'Royal friend', 'Little sheep']],
    ['How do dogs usually say hello to each other?', ['By sniffing', 'By shaking paws', 'By barking three times', 'By spinning around']],
    ['Compared to ours, a dog’s body temperature is…', ['A little warmer', 'Much colder', 'Exactly the same', 'Colder in summer']],
    ['What should a new dog do before you pet it?', ['Sniff your hand', 'Hear you clap', 'See you jump', 'Watch you from far away']],
    ['Compared to us, dogs see…', ['Fewer colors', 'More colors', 'Only black and white', 'No blue at all']],
    ['A dog’s whiskers help it…', ['Feel things close by', 'Taste food', 'Hear better', 'Smell flowers']],
    ['Which breed is known as the fastest?', ['Greyhound', 'Dachshund', 'Husky', 'Poodle']],
    ['What helps a dog on a hot day?', ['Shade and fresh water', 'A long run at noon', 'A warm blanket', 'Lots of treats']],
    ['How many baby teeth does a puppy have?', ['28', '42', '12', '60']],
    ['How many toes are on a dog’s front paw, counting the dewclaw?', ['Five', 'Four', 'Three', 'Six']],
    ['A “play bow” (front down, bottom up) means…', ['Let’s play!', 'I’m tired', 'I’m hungry', 'Go away']],
    ['Dogs wag a little more to the right when they see…', ['Someone they love', 'A cat', 'Rain', 'A vacuum cleaner']],
  ];
  const PAGES = [
    { id: 'retriever', title: 'Retrievers', th: ['dog', 'retriever|golden'], text: ['Golden and Labrador Retrievers were bred to bring back birds for hunters, gently, without biting them.', 'That “soft mouth” is why they love carrying things around, like shoes, toys and the occasional sock.', 'Many retrievers work as guide and assistance dogs.'] },
    { id: 'corgi', title: 'Corgis', th: ['dog', 'corgi|redwhite'], text: ['Pembroke Welsh Corgis come from Wales, where they herded cattle by nipping at their heels.', 'Their short legs helped them duck under kicking hooves.', 'Queen Elizabeth II kept corgis for most of her life.'] },
    { id: 'dachshund', title: 'Dachshunds', th: ['dog', 'dachshund|red'], text: ['“Dachshund” means “badger dog” in German.', 'Their long bodies and short legs helped them follow badgers into burrows.', 'They come with smooth, wire-haired and long-haired coats.'] },
    { id: 'husky', title: 'Huskies', th: ['dog', 'husky|grey'], text: ['Siberian Huskies were bred to pull light sleds over long distances in the cold.', 'A thick double coat keeps them warm, even when they sleep in the snow.', 'Many huskies “talk” with howls and yodels instead of barks.'] },
    { id: 'poodle', title: 'Poodles', th: ['dog', 'poodle|white'], text: ['Poodles started out as water dogs that fetched ducks.', 'The famous haircut kept their joints warm while swimming.', 'They come in toy, miniature and standard sizes, and are known for being very clever.'] },
    { id: 'noses', title: 'Noses', th: ['pic', '👃'], text: ['A dog’s nose print is as unique as a fingerprint.', 'Dogs can tell which nostril a smell came from, a bit like smelling in stereo.', 'A good sniff on a walk is like reading the morning paper.'] },
    { id: 'tails', title: 'Tails', th: ['pic', '🐕'], text: ['A loose, wide wag usually means a happy dog.', 'Dogs wag a little more to the right when they see someone they love.', 'Tails also help with balance when running and turning.'] },
    { id: 'puppies', title: 'Puppies', th: ['pic', '🐶'], text: ['Puppies are born with their eyes and ears closed.', 'Their eyes open at about two weeks old.', '28 baby teeth make room for 42 grown-up teeth.'] },
    { id: 'paws', title: 'Paws', th: ['pic', '🐾'], text: ['Dogs sweat a little through their paw pads.', 'Pads protect against rough ground and help with grip.', 'Front paws usually have five toes, counting the dewclaw.'] },
    { id: 'play', title: 'Play', th: ['pic', '🎾'], text: ['A play bow, front down and bottom up, means “let’s play!”.', 'Good playmates take turns chasing and being chased.', 'Short breaks help keep play friendly.'] },
  ];
  const BOOKS = [
    { k: 'tricks', title: 'Clever Paws', sub: 'A training guide', perk: 'Your dogs learn tricks 25% faster' },
    { k: 'coins', title: 'Treasure Walks', sub: 'Finding good things outside', perk: '15% more coins on walks' },
    { k: 'xp', title: 'The Trainer’s Handbook', sub: 'Everything about dogs', perk: '10% more XP from everything' },
    { k: 'cozy', title: 'Hygge for Hounds', sub: 'A cozy home for dogs', perk: 'Dogs at home stay happier' },
    { k: 'explore', title: 'The Wanderer’s Atlas', sub: 'Maps and hidden paths', perk: 'Places on walks earn stars 25% faster' },
  ];
  const BOOK_MIN = 60;
  const pagesHave = () => (S().pages || []).filter((id) => PAGES.some((P) => P.id === id));
  function playQuiz() {
    openGame('Dog quiz', (game) => {
      const rr = Math.random;
      const qs = shuffleR(QUIZ, rr).slice(0, 5);
      let i = 0, right = 0;
      const ask = () => {
        const [q, opts] = qs[i];
        const order = shuffleR(opts.map((o, k) => [o, k]), rr);
        game.body.innerHTML = `<div class="vgQuiz"><small>Question ${i + 1} of 5</small><b>${esc(q)}</b><div class="btnCol">${order.map(([o, k]) => `<button class="soft" data-q="${k}">${esc(o)}</button>`).join('')}</div></div>`;
      };
      game.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]');
        if (!b || b.disabled) return;
        const ok = b.dataset.q === '0';
        game.body.querySelectorAll('[data-q]').forEach((x) => { x.disabled = true; if (x.dataset.q === '0') x.classList.add('right'); });
        if (ok) { right++; G.sfx('find'); } else { b.classList.add('wrong'); G.sfx('tap'); }
        game.after(ok ? 650 : 1300, () => {
          i++;
          if (i < 5) { ask(); return; }
          G.earn('quiz');
          addVP('library', 2 + right * 1.6);
          const st = S();
          st.pages = pagesHave();
          let lines = [`${right} of 5 right.`];
          if (right >= 4) {
            const next = PAGES.find((P) => !st.pages.includes(P.id));
            if (next) { st.pages.push(next.id); lines.push(`A new page for your encyclopedia: <b>${esc(next.title)}</b>!`); G.sfx('unlock'); }
            else lines.push('Your encyclopedia is complete. The librarian is very impressed!');
          } else lines.push('Get 4 right to add a page to your breed encyclopedia. Have another go!');
          result(game, { icon: 'quiz', title: right === 5 ? 'Perfect score!' : right >= 4 ? 'Well done!' : 'Good try!', lines, again: playQuiz });
        });
      });
      ask();
    });
  }
  function openBook() {
    openGame('Breed encyclopedia', (game) => {
      const have = pagesHave();
      const list = () => {
        game.body.innerHTML = `<p class="vgHelp">${have.length} of ${PAGES.length} pages. Pass the dog quiz to add more.</p><div class="vgList">${PAGES.map((P) => have.includes(P.id)
          ? `<button class="vgRow" data-p="${P.id}">${G.TH(P.th[0], P.th[1])}<span><b>${esc(P.title)}</b><small>${esc(P.text[0])}</small></span></button>`
          : `<div class="vgRow done">${IC('lock')}<span><b>A page still to find</b><small>Pass the dog quiz</small></span></div>`).join('')}</div>`;
      };
      list();
      game.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]');
        if (b && b.dataset.p === '__back') { list(); return; }
        if (!b) return;
        const P = PAGES.find((x) => x.id === b.dataset.p);
        game.body.innerHTML = `<div class="vgPage">${G.TH(P.th[0], P.th[1], 'big')}<b>${esc(P.title)}</b>${P.text.map((t) => `<p>${esc(t)}</p>`).join('')}<button class="soft" data-p="__back">All pages</button></div>`;
      });
    });
  }
  const bookLeft = () => { const B = S().book; return B && Date.now() < B.until ? Math.ceil((B.until - Date.now()) / 60000) : 0; };
  function playBooks() {
    openGame('Borrow a book', (game) => {
      const render = () => {
        const B = S().book, left = bookLeft();
        game.body.innerHTML = `<p class="vgHelp">Borrow one book at a time, free, for ${BOOK_MIN} minutes. While you have it, it helps a little.</p>${left ? `<div class="vgNow glass">${VI('book')} Reading <b>${esc(BOOKS.find((x) => x.k === B.k).title)}</b> · ${left} min left <button class="soft small" data-b="return">Return it</button></div>` : ''}<div class="vgList">${BOOKS.map((K) => `<button class="vgRow${B && left && B.k === K.k ? ' sel' : ''}" data-b="${K.k}"><span class="bookSpine bk-${K.k}"></span><span><b>${esc(K.title)}</b><small>${esc(K.sub)} · ${esc(K.perk)}</small></span></button>`).join('')}</div>`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-b]');
        if (!b) return;
        const st = S();
        if (b.dataset.b === 'return') { st.book = null; G.toast('Book returned. Thanks!'); render(); G.save(); return; }
        if (bookLeft() && st.book.k === b.dataset.b) { G.toast('You’re reading this one already'); return; }
        const K = BOOKS.find((x) => x.k === b.dataset.b);
        st.book = { k: K.k, until: Date.now() + BOOK_MIN * 60000 };
        G.earn('borrow');
        addVP('library', 2);
        G.sfx('find');
        G.toast(`📖 ${K.title}: ${K.perk} for the next hour`);
        const pups = companions();
        if (pups.length) setTimeout(() => G.toast(`${pups[0].name} curls up on the reading rug 💤`), 1800);
        render();
        G.save();
      });
    });
  }

  // =====================================================================
  // The mall: weekly specials, clothes with a mirror, a furniture showroom, toys, a photo booth, a food court
  // =====================================================================
  const weekR = (salt) => seeded(`${G.weekKey()}|${salt}`);
  function mallSpecials() {
    const rr = weekR('mall');
    const own = shuffleR(Object.keys(D.ITEMS).filter((k) => D.ITEMS[k].mall), rr).slice(0, 2).map((k) => [k, D.ITEMS[k].mall, true]);
    const reg = shuffleR(Object.keys(D.ITEMS).filter((k) => D.ITEMS[k].price > 0 && !D.ITEMS[k].use && !D.ITEMS[k].agility && !D.ITEMS[k].garden && !D.ITEMS[k].luxury && !D.ITEMS[k].role), rr).slice(0, 2).map((k) => [k, Math.round(D.ITEMS[k].price * 0.75), false]);
    return own.concat(reg);
  }
  function mallShop() {
    openGame('Weekly specials', (game) => {
      const render = () => {
        game.body.innerHTML = `<p class="vgHelp">New every Monday. The first two are only sold here.</p><div class="vgGrid">${mallSpecials().map(([k, p, only]) => `<button class="vgCard" data-buy="${k}" data-p="${p}">${G.thumbOf.item(k)}<b>${esc(D.ITEMS[k].name)}</b><small>${only ? 'Mall exclusive' : `25% off · was ${D.ITEMS[k].price}`}</small><span class="price">${coin(p)}</span>${S().inventory[k] ? `<span class="have">You have ${S().inventory[k]}</span>` : ''}</button>`).join('')}</div>`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-buy]');
        if (!b || !payFor(+b.dataset.p)) return;
        G.giveItem(b.dataset.buy);
        G.earn('shopmall');
        addVP('mall', 3);
        G.toast(`${D.ITEMS[b.dataset.buy].name} is in your inventory. Place it in Decorate.`);
        render();
        G.save();
      });
    });
  }
  // clothes: tap to see yourself in the mirror, then buy or wear
  function mallClothes() {
    openGame('Clothes shop', (game) => {
      const ids = Object.keys(D.OUTFITS).filter((k) => D.OUTFITS[k].vendor === 'mall');
      let tryId = ids[0];
      const lookWith = (id) => { const L = JSON.parse(JSON.stringify(S().look || {})); L.outfit = L.outfit || {}; L.outfit[D.OUTFITS[id].slot] = id; return L; };
      const render = () => {
        const O = D.OUTFITS[tryId], owned = S().outfits.includes(tryId), wearing = (S().look.outfit || {})[O.slot] === tryId;
        game.body.innerHTML = `<div class="mirror"><div class="mirrorFrame">${G.TH('wear', G.lookKey(lookWith(tryId), null), 'mirrorImg')}</div><b>${esc(O.name)}</b><div class="btnRow">${owned ? (wearing ? '<button class="soft" disabled>You’re wearing it</button>' : '<button class="primary" data-w="wear">Wear it</button>') : `<button class="primary" data-w="buy">Buy · ${coin(O.price)}</button>`}</div></div>
          <div class="vgChips">${ids.map((k) => `<button class="vgChip${k === tryId ? ' sel' : ''}" data-try="${k}">${G.wearThumb(k)}<small>${esc(D.OUTFITS[k].name)}</small>${S().outfits.includes(k) ? `<i class="ownDot">${IC('check')}</i>` : ''}</button>`).join('')}</div>`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-try]');
        if (t) { tryId = t.dataset.try; G.sfx('tap'); render(); return; }
        const w = e.target.closest('[data-w]');
        if (!w) return;
        const O = D.OUTFITS[tryId];
        if (w.dataset.w === 'buy') { if (!payFor(O.price)) return; S().outfits.push(tryId); G.earn('shopmall'); addVP('mall', 3); G.toast(`${O.name}: yours!`); }
        S().look.outfit = S().look.outfit || {};
        S().look.outfit[O.slot] = tryId;
        G.applyPlayerLook();
        G.sfx('find');
        render();
        G.save();
      });
    });
  }
  const ROOMSETS = [
    ['Cozy living room', ['sofa', 'armchair', 'lamp', 'rug']], ['Music corner', ['piano', 'guitar', 'beanbag', 'fairylights']],
    ['Dog corner', ['bed', 'cushion', 'bowl', 'water', 'kennel']], ['Little study', ['desk', 'shelf', 'clock', 'plant']],
    ['Dining nook', ['table', 'chair', 'fridge', 'candles']], ['Fireside', ['fireplace', 'armchair', 'rug', 'lantern']],
  ];
  function mallShowroom() {
    openGame('Furniture showroom', (game) => {
      const sets = shuffleR(ROOMSETS, weekR('rooms')).slice(0, 3).map(([n, ids]) => [n, ids.filter((k) => D.ITEMS[k] && D.ITEMS[k].price)]);
      const render = () => {
        game.body.innerHTML = `<p class="vgHelp">Three rooms set up this week. Take the whole room for 15% off, or single pieces.</p>${sets.map(([n, ids], si) => {
          const full = ids.reduce((s, k) => s + D.ITEMS[k].price, 0), deal = Math.round(full * 0.85);
          return `<div class="showroom glass"><b>${esc(n)}</b><div class="srItems">${ids.map((k) => `<button class="srItem" data-one="${k}">${G.thumbOf.item(k)}<small>${esc(D.ITEMS[k].name)}<br>${coin(D.ITEMS[k].price)}</small></button>`).join('')}</div><button class="primary wide" data-set="${si}">The whole room · ${coin(deal)} <s>${full}</s></button></div>`;
        }).join('')}`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        const one = e.target.closest('[data-one]'), set = e.target.closest('[data-set]');
        if (one) { const k = one.dataset.one; if (!payFor(D.ITEMS[k].price)) return; G.giveItem(k); G.toast(`${D.ITEMS[k].name} is in your inventory`); }
        else if (set) {
          const [n, ids] = sets[+set.dataset.set];
          if (!payFor(Math.round(ids.reduce((s, k) => s + D.ITEMS[k].price, 0) * 0.85))) return;
          ids.forEach((k) => G.giveItem(k));
          G.toast(`The ${n.toLowerCase()} is in your inventory. Happy decorating!`);
          addVP('mall', 6);
        } else return;
        G.earn('shopmall');
        addVP('mall', 2);
        G.sfx('find');
        render();
        G.save();
      });
    });
  }
  function mallToys() {
    openGame('Toy shop', (game) => {
      const ids = Object.keys(D.TOYS).filter((k) => D.TOYS[k].vendor === 'mall').concat(Object.keys(D.TOYS).filter((k) => D.TOYS[k].price > 0 && !D.TOYS[k].vendor));
      const render = () => {
        game.body.innerHTML = `<p class="vgHelp">The first three are only sold at the mall.</p><div class="vgGrid">${ids.map((k) => { const T = D.TOYS[k], own = S().toys.includes(k); return `<button class="vgCard${own ? ' owned' : ''}" data-toy="${k}">${G.thumbOf.toy(k)}<b>${esc(T.name)}</b><small>${T.vendor === 'mall' ? 'Mall exclusive' : 'Classic'}</small><span class="price">${own ? 'In your toy bag' : coin(T.price)}</span></button>`; }).join('')}</div>`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-toy]');
        if (!b) return;
        const k = b.dataset.toy;
        if (S().toys.includes(k)) { G.toast('You have this one already'); return; }
        if (!payFor(D.TOYS[k].price)) return;
        G.grantToy(k);
        G.earn('shopmall');
        addVP('mall', 3);
        dogCheer([`can’t take their eyes off the new ${D.TOYS[k].name.toLowerCase()} 👀`, 'does a happy spin 🌀']);
        render();
        G.save();
      });
    });
  }
  // ----- photo booth: four snaps, stickers on top, and a strip to hang up at home -----
  const loadImg = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  function stickerAt(x, kind, cx, cy, s, col) {
    x.save();
    x.fillStyle = col;
    x.strokeStyle = '#ffffff';
    x.lineWidth = 1.5;
    shapePath(x, kind === 'paws' ? 'paw' : kind === 'stars' ? 'star' : kind === 'bones' ? 'bone' : 'heart', cx, cy, s);
    x.fill(); x.stroke();
    x.restore();
  }
  const BOOTH = { hearts: ['#ff6fa3', '#ffe1ee'], stars: ['#ffd23f', '#fff5cc'], paws: ['#8a5cf6', '#ece4ff'], bones: ['#4fb3e0', '#e1f5ff'] };
  function mallBooth() {
    openGame('Photo booth', (game) => {
      const pups = companions();
      game.body.innerHTML = `<p class="vgHelp">Four snaps for ${coin(10)}. ${pups.length ? `${esc(G.nameList(pups.map((d) => d.name)))} squeeze${pups.length > 1 ? '' : 's'} in with you!` : 'Just you today. Strike a pose!'} Pick your stickers:</p><div class="vgChips">${Object.keys(BOOTH).map((k, i) => `<button class="vgChip${i ? '' : ' sel'}" data-st="${k}"><span class="stk" style="background:${BOOTH[k][1]};color:${BOOTH[k][0]}">${VI(k === 'paws' ? 'paw' : k === 'stars' ? 'star' : k === 'bones' ? 'bone' : 'heart')}</span><small>${k[0].toUpperCase() + k.slice(1)}</small></button>`).join('')}</div><button class="primary wide" data-go="1">Take the photos</button><div id="boothOut"></div>`;
      let theme = 'hearts';
      game.body.addEventListener('click', async (e) => {
        const stb = e.target.closest('[data-st]');
        if (stb) { theme = stb.dataset.st; game.body.querySelectorAll('[data-st]').forEach((b) => b.classList.toggle('sel', b === stb)); return; }
        const go = e.target.closest('[data-go]');
        if (!go || go.disabled) return;
        if (!payFor(10)) return;
        go.disabled = true;
        const L = S().look || {};
        const me = await loadImg(G.personPortrait({ owner: youName(), shirt: L.fav, hair: L.hairColor, skin: L.skin }));
        const pics = [];
        for (const d of pups.slice(0, 3)) pics.push(await loadImg(G.dogPortrait(d)));
        const out = $('boothOut');
        out.innerHTML = '<div class="boothFlash"><b>3</b></div>';
        const FW = 120, FH = 90, strip = document.createElement('canvas');
        strip.width = FW + 16; strip.height = FH * 4 + 16 * 5 + 18;
        const x = strip.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, strip.width, strip.height);
        const [col, bg] = BOOTH[theme], rr = Math.random;
        for (let f = 0; f < 4; f++) {
          for (const n of ['3', '2', '1']) { out.querySelector('b').textContent = n; G.sfx('tap'); await new Promise((r) => game.after(380, r)); }
          out.querySelector('.boothFlash').classList.add('flash');
          G.sfx('shutter');
          const oy = 8 + f * (FH + 16);
          x.save();
          x.beginPath(); x.rect(8, oy, FW, FH); x.clip();
          x.fillStyle = f % 2 ? bg : '#ffffff'; x.fillRect(8, oy, FW, FH);
          for (let k = 0; k < 6; k++) { x.fillStyle = col + '33'; x.beginPath(); x.arc(8 + rr() * FW, oy + rr() * FH, 6 + rr() * 10, 0, Math.PI * 2); x.fill(); }
          const all = [me, ...pics].filter(Boolean);
          const n = all.length, sz = n > 2 ? 46 : 56;
          all.forEach((im, k) => {
            const cx = 8 + (FW * (k + 1)) / (n + 1), cy = oy + FH / 2 + (k ? 10 : 0) + Math.sin(f * 1.7 + k) * 5;
            x.save(); x.translate(cx, cy); x.rotate(((f + k) % 3 - 1) * 0.12 * (f === 2 ? 2 : 1));
            x.imageSmoothingEnabled = false; x.drawImage(im, -sz / 2, -sz / 2, sz, sz);
            x.restore();
          });
          for (let k = 0; k < 3; k++) stickerAt(x, theme, 14 + rr() * (FW - 12), oy + 8 + rr() * (FH - 16), 7 + rr() * 5, col);
          x.restore();
          await new Promise((r) => game.after(260, r));
          out.querySelector('.boothFlash').classList.remove('flash');
        }
        x.fillStyle = col; x.font = 'bold 10px sans-serif'; x.textAlign = 'center';
        x.fillText(`PixelPups · ${G.clock.dateKey.split('-').reverse().join('.')}`, strip.width / 2, strip.height - 7);
        const url = strip.toDataURL('image/jpeg', 0.85);
        const st = S();
        st.strips = (st.strips || []).concat({ id: G.newId(), url, t: Date.now() }).slice(-12);
        G.giveItem('photostrip');
        G.earn('photobooth');
        addVP('mall', 5);
        G.sfx('unlock');
        out.innerHTML = `<div class="boothResult"><img src="${url}" alt="Your photo strip"><p>Your photo strip is in your inventory. Hang it up at home in Decorate!</p></div>`;
        go.disabled = false;
        go.textContent = 'Another strip';
        G.save();
      });
    });
  }
  const FOOD = [['Pretzel', 6, 'food'], ['Noodle bowl', 10, 'food'], ['Ice cream', 8, 'cup']];
  const COURT = [
    'Have you tried the noodles here? I come every Saturday. {ndog} waits for the one that always drops.',
    'I love people-watching at the mall. Everyone looks so busy, and I’m just here with my pretzel.',
    'The toy shop got squeaky carrots in. {ndog} would lose their mind. In a good way!',
    'Did you see the photo booth? {ndog} and I made a strip last week. {ndog} blinked in all four.',
    'Pull up a chair! The food court is always nicer with company.',
    'I’m taking a little break from shopping. My feet are tired, but my bags are happy.',
    'Fun fact: the ice cream place makes a dog-friendly scoop. Ask for the “pup cone”.',
  ];
  function mallFood() {
    openGame('Food court', (game) => {
      const render = () => {
        game.body.innerHTML = `<p class="vgHelp">Grab a bite and find a seat. Someone you know might be here.</p><div class="vgList">${FOOD.map(([n, p, ic], k) => `<button class="vgRow" data-f="${k}">${VI(ic)}<span><b>${esc(n)}</b><small>${coin(p)}</small></span></button>`).join('')}</div>`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        if (e.target.closest('[data-fb]')) { render(); return; }
        const b = e.target.closest('[data-f]');
        if (!b) return;
        const [n, p] = FOOD[+b.dataset.f];
        if (!payFor(p)) return;
        const N = pick(tableNeighbors());
        G.addNFriend(N.owner, 2);
        G.earn('foodcourt');
        addVP('mall', 3);
        const pups = companions();
        for (const d of pups) G.petDog(d, 6);
        game.body.innerHTML = `<div class="vgStory"><img class="th big" src="${G.personPortrait(N)}" alt=""><b>${esc(N.owner)} waves you over</b><p>“${esc(G.nfill(pick(COURT), N))}”</p>${pups.length ? `<p class="sub">${esc(G.nameList(pups.map((d) => d.name)))} get${pups.length > 1 ? '' : 's'} a little pup cone 🍦</p>` : ''}<p class="sub">You enjoy your ${esc(n.toLowerCase())} together.</p><button class="primary" data-fb="1">Back to the menu</button></div>`;
        G.sfx('find');
        G.save();
      });
    });
  }

  // =====================================================================
  // The arcade: claw machine, Boop-a-Mole, Paw Beat, and the prize counter
  // =====================================================================
  const PLUSH = [['#f4a6c6', 12], ['#9fd3f5', 12], ['#ffe082', 12], ['#b8e994', 12], ['#d7b8ff', 14], ['#ffcc80', 14], ['#f6d365', 30]];
  function drawPlush(x, p) {
    const { px, py, c, gold } = p, r = 15;
    x.fillStyle = c;
    x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(px - 11, py - 6, 5, 9, -0.3, 0, Math.PI * 2); x.ellipse(px + 11, py - 6, 5, 9, 0.3, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2b1d14'; x.fillRect(px - 6, py - 3, 3, 3); x.fillRect(px + 3, py - 3, 3, 3); x.fillRect(px - 2, py + 3, 4, 3);
    if (gold) { x.strokeStyle = '#fff6c8'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, r + 2, 0, Math.PI * 2); x.stroke(); }
  }
  function playClaw() {
    if (!payFor(5, 'Claw machine')) return;
    openGame('Claw machine', (game) => {
      game.body.insertAdjacentHTML('beforeend', '<p class="vgHelp">The claw moves by itself. Tap to drop it right above a plush. Golden ones are worth more tickets!</p>');
      const cv = gameCanvas(game, 240, 300), x = cv.x;
      const plush = [];
      for (let k = 0; k < 9; k++) {
        const [c, t] = PLUSH[k === 4 ? 6 : k % 6];
        plush.push({ px: 40 + (k % 5) * 40 + (k > 4 ? 20 : 0) + rand(-5, 5), py: k > 4 ? 226 : 250, c, t, gold: t >= 30 });
      }
      const C = { x: 120, y: 30, dir: 1, ph: 'move', hold: null, slip: false, t: 0 };
      const tapIt = () => { if (C.ph === 'move') { C.ph = 'drop'; G.sfx('tap'); } };
      cv.c.addEventListener('pointerdown', tapIt);
      game.loop((dt) => {
        if (C.ph === 'move') { C.x += C.dir * 78 * dt; if (C.x > 214) { C.x = 214; C.dir = -1; } if (C.x < 26) { C.x = 26; C.dir = 1; } }
        else if (C.ph === 'drop') {
          const under = plush.filter((p) => Math.abs(p.px - C.x) < 18).sort((a, b) => a.py - b.py)[0];
          const floor = under ? under.py - 18 : 262;
          C.y += 150 * dt;
          if (C.y >= floor) {
            C.y = floor; C.ph = 'grab'; C.t = 0;
            if (under) { const dx = Math.abs(under.px - C.x), chance = clamp(0.95 - dx / 22, 0.1, 0.92); C.hold = under; C.slip = Math.random() > chance; }
          }
        } else if (C.ph === 'grab') { C.t += dt; if (C.t > 0.45) C.ph = 'lift'; }
        else if (C.ph === 'lift') {
          C.y -= 110 * dt;
          if (C.hold) { C.hold.px = C.x; C.hold.py = C.y + 18; if (C.slip && C.y < 150) { C.hold.py = 250; C.hold.px = clamp(C.x + rand(-10, 10), 30, 210); C.hold = null; G.toast('So close! It slipped 😅'); } }
          if (C.y <= 30) { C.y = 30; C.ph = C.hold ? 'carry' : 'over'; }
        } else if (C.ph === 'carry') {
          C.x -= 90 * dt;
          C.hold.px = C.x; C.hold.py = C.y + 18;
          if (C.x <= 26) {
            const p = C.hold;
            plush.splice(plush.indexOf(p), 1);
            C.hold = null; C.ph = 'won';
            G.addTickets(p.t);
            G.earn('arcadegame');
            addVP('arcade', p.gold ? 8 : 5);
            G.sfx('unlock');
            dogCheer(['wants to cuddle the new plush 🧸', 'barks happily at the prize chute 🐾']);
            game.after(400, () => result(game, { icon: 'claw', title: p.gold ? 'A golden plush!' : 'You got one!', lines: [`+${tix(p.t)} tickets`], again: playClaw }));
          }
        } else if (C.ph === 'over') { C.ph = 'done'; game.after(300, () => result(game, { icon: 'claw', title: 'Not this time', lines: ['The claw came up empty. Plushies are slippery!'], again: playClaw })); }
        // draw
        x.clearRect(0, 0, 240, 300);
        x.fillStyle = '#2a2350'; x.fillRect(0, 0, 240, 300);
        x.fillStyle = '#e8f4ff22'; x.fillRect(8, 16, 224, 264);
        x.fillStyle = '#3f2a8a'; x.fillRect(8, 268, 224, 32);
        x.fillStyle = '#140f2b'; x.fillRect(8, 230, 40, 40);
        x.fillStyle = '#ffe24a'; x.font = 'bold 9px sans-serif'; x.fillText('PRIZE', 12, 284);
        for (const p of plush) if (p !== C.hold) drawPlush(x, p);
        x.strokeStyle = '#cfd8dc'; x.lineWidth = 2; x.beginPath(); x.moveTo(C.x, 16); x.lineTo(C.x, C.y); x.stroke();
        x.fillStyle = '#b0bec5'; x.fillRect(C.x - 10, C.y - 4, 20, 6);
        const open = C.ph === 'move' || C.ph === 'drop' ? 1 : 0.35;
        x.lineWidth = 3; x.beginPath(); x.moveTo(C.x - 8, C.y + 2); x.lineTo(C.x - 8 - 8 * open, C.y + 16); x.moveTo(C.x + 8, C.y + 2); x.lineTo(C.x + 8 + 8 * open, C.y + 16); x.stroke();
        if (C.hold) drawPlush(x, C.hold);
        x.fillStyle = '#ff5fa2'; x.fillRect(0, 0, 240, 14);
      });
    });
  }
  function playMole() {
    if (!payFor(3, 'Boop-a-Mole')) return;
    openGame('Boop-a-Mole', (game) => {
      game.body.insertAdjacentHTML('beforeend', '<p class="vgHelp">Boop the moles on the nose before they pop back down. Golden ones count triple. 30 seconds!</p>');
      const cv = gameCanvas(game, 300, 300), x = cv.x;
      const holes = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) holes.push({ x: 60 + c * 90, y: 70 + r * 85, up: 0, t: 0, gold: false, booped: 0 });
      let left = 30, score = 0, next = 0.6, over = false;
      cv.c.addEventListener('pointerdown', (e) => {
        if (over) return;
        const p = cv.pos(e);
        for (const h of holes) if (h.t > 0 && !h.booped && Math.hypot(p.x - h.x, p.y - (h.y - 14 * h.up)) < 34) { h.booped = 0.35; score += h.gold ? 3 : 1; G.sfx('pet'); return; }
      });
      game.loop((dt) => {
        if (!over) {
          left -= dt;
          next -= dt;
          const speed = 1 + (30 - left) / 30;
          if (next <= 0) {
            const free = holes.filter((h) => h.t <= 0);
            if (free.length) { const h = pick(free); h.t = rand(0.75, 1.05) / speed; h.gold = Math.random() < 0.1; h.booped = 0; }
            next = rand(0.35, 0.7) / speed;
          }
          if (left <= 0) {
            over = true;
            const t = Math.floor(score / 2);
            G.addTickets(t); G.earn('arcadegame'); addVP('arcade', 2 + score / 6);
            G.sfx('unlock');
            game.after(500, () => result(game, { icon: 'mole', title: `${score} boops!`, lines: [`+${tix(t)} tickets`, score >= 30 ? 'The moles have never been so well booped.' : 'The moles had a lovely time.'], again: playMole }));
          }
        }
        for (const h of holes) {
          if (h.booped > 0) { h.booped -= dt; if (h.booped <= 0) h.t = 0; }
          else if (h.t > 0) h.t -= dt;
          const target = h.t > 0 && !(h.booped < 0) ? 1 : 0;
          h.up += (target - h.up) * Math.min(1, dt * 14);
        }
        x.clearRect(0, 0, 300, 300);
        x.fillStyle = '#7cc56a'; x.fillRect(0, 0, 300, 300);
        x.fillStyle = '#ffffff'; x.font = 'bold 14px sans-serif'; x.fillText(`Boops: ${score}`, 10, 20); x.fillText(`${Math.max(0, Math.ceil(left))} s`, 250, 20);
        for (const h of holes) {
          x.fillStyle = '#4e342e'; x.beginPath(); x.ellipse(h.x, h.y + 18, 34, 12, 0, 0, Math.PI * 2); x.fill();
          if (h.up > 0.02) {
            x.save(); x.beginPath(); x.rect(h.x - 40, h.y - 70, 80, 88); x.clip();
            const my = h.y + 30 - 46 * h.up;
            x.fillStyle = h.gold ? '#f6d365' : '#9c7a5b';
            x.beginPath(); x.ellipse(h.x, my, 22, 26, 0, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#f3dcc0'; x.beginPath(); x.ellipse(h.x, my + 8, 12, 9, 0, 0, Math.PI * 2); x.fill();
            x.fillStyle = h.booped > 0 ? '#ff6fa3' : '#2b1d14';
            x.beginPath(); x.ellipse(h.x, my + 2, 5, 4, 0, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#2b1d14'; x.fillRect(h.x - 9, my - 9, 4, 4); x.fillRect(h.x + 5, my - 9, 4, 4);
            if (h.booped > 0) { x.fillStyle = '#ff6fa3'; shapePath(x, 'heart', h.x + 18, my - 26, 10); x.fill(); }
            x.restore();
          }
          x.fillStyle = '#6d4c41'; x.beginPath(); x.ellipse(h.x, h.y + 22, 36, 8, 0, 0, Math.PI); x.fill();
        }
      });
    });
  }
  function playBeat() {
    if (!payFor(3, 'Paw Beat')) return;
    openGame('Paw Beat', (game) => {
      game.body.insertAdjacentHTML('beforeend', '<p class="vgHelp">Tap a lane when a paw reaches the line.</p>');
      const cv = gameCanvas(game, 300, 420), x = cv.x;
      const BPM = 112, beat = 60 / BPM, fall = 1.7, HIT = 360;
      const notes = [];
      let t = -2;
      const rr = Math.random;
      for (let b = 0; b < 48; b++) {
        if (b % 8 === 7) continue;
        const lane = Math.floor(rr() * 3);
        notes.push({ at: b * beat * (b > 24 ? 0.75 : 1) + (b > 24 ? 24 * beat * 0.25 : 0), lane, done: false, res: null });
        if (b > 16 && rr() < 0.18) notes.push({ at: notes[notes.length - 1].at + beat / 2, lane: (lane + 1 + Math.floor(rr() * 2)) % 3, done: false, res: null });
      }
      const end = notes[notes.length - 1].at + 1.5;
      let score = 0, combo = 0, best = 0, flashes = [], over = false;
      const judge = (lane) => {
        const cand = notes.filter((n) => !n.done && n.lane === lane && Math.abs(n.at - t) < 0.22).sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))[0];
        if (!cand) return;
        const d = Math.abs(cand.at - t);
        cand.done = true;
        cand.res = d < 0.09 ? 'Perfect' : 'Good';
        score += d < 0.09 ? 2 : 1;
        combo++; best = Math.max(best, combo);
        flashes.push({ lane, t: 0.3, txt: cand.res });
        G.sfx(d < 0.09 ? 'plip' : 'tap');
      };
      cv.c.addEventListener('pointerdown', (e) => { if (!over) judge(clamp(Math.floor(cv.pos(e).x / 100), 0, 2)); });
      game.loop((dt) => {
        t += dt;
        for (const n of notes) if (!n.done && t - n.at > 0.22) { n.done = true; n.res = 'miss'; combo = 0; }
        if (!over && t > end) {
          over = true;
          const max = notes.length * 2, k = score / max, tk = Math.round(score / 4);
          G.addTickets(tk); G.earn('arcadegame'); addVP('arcade', 2 + k * 8);
          G.sfx('unlock');
          game.after(300, () => result(game, { icon: 'beat', title: k > 0.85 ? 'Paw-fect rhythm!' : k > 0.55 ? 'Great groove!' : 'Fun jam!', lines: [`${Math.round(k * 100)}% · best combo ${best}`, `+${tix(tk)} tickets`], again: playBeat }));
          dogCheer(['wiggles along to the beat 🎵', 'howls one perfect note 🎶']);
        }
        x.clearRect(0, 0, 300, 420);
        x.fillStyle = '#1c1736'; x.fillRect(0, 0, 300, 420);
        const pulse = Math.max(0, 1 - ((t % beat) + beat) % beat / 0.15);
        for (let l = 0; l < 3; l++) { x.fillStyle = l % 2 ? '#241d45' : '#2a2350'; x.fillRect(l * 100, 0, 100, 420); }
        x.fillStyle = `rgba(255,95,162,${0.4 + pulse * 0.5})`; x.fillRect(0, HIT - 3, 300, 6);
        for (const n of notes) {
          if (n.done && n.res !== 'miss') continue;
          const y = HIT - ((n.at - t) / fall) * HIT;
          if (y < -30 || y > 440) continue;
          x.fillStyle = n.res === 'miss' ? '#ffffff33' : ['#5be0ff', '#ffe24a', '#7cff6b'][n.lane];
          shapePath(x, 'paw', n.lane * 100 + 50, y, 26); x.fill();
        }
        flashes = flashes.filter((f) => (f.t -= dt) > 0);
        for (const f of flashes) { x.fillStyle = `rgba(255,255,255,${f.t * 3})`; x.font = 'bold 14px sans-serif'; x.textAlign = 'center'; x.fillText(f.txt, f.lane * 100 + 50, HIT - 40); }
        x.textAlign = 'left'; x.fillStyle = '#ffffff'; x.font = 'bold 13px sans-serif'; x.fillText(`Score ${score}`, 10, 20); if (combo > 2) x.fillText(`Combo ${combo}`, 210, 20);
        if (t < 0) { x.textAlign = 'center'; x.font = 'bold 30px sans-serif'; x.fillText(String(Math.ceil(-t)), 150, 200); x.textAlign = 'left'; }
      });
    });
  }
  const PRIZES = [['toy', 'burger', 45], ['outfit', 'neoncap', 60], ['item', 'bigplush', 150], ['item', 'arcadecab', 250]];
  function arcadePrizes() {
    openGame('Prize counter', (game) => {
      const render = () => {
        game.body.innerHTML = `<p class="vgHelp">Trade your tickets. You have ${tix(S().tickets || 0)}.</p><div class="vgGrid">${PRIZES.map(([k, id, p], i) => {
          const name = k === 'toy' ? D.TOYS[id].name : k === 'outfit' ? D.OUTFITS[id].name : D.ITEMS[id].name;
          const th = k === 'toy' ? G.thumbOf.toy(id) : k === 'outfit' ? G.wearThumb(id) : G.thumbOf.item(id);
          const owned = (k === 'toy' && S().toys.includes(id)) || (k === 'outfit' && S().outfits.includes(id));
          return `<button class="vgCard${owned ? ' owned' : ''}" data-pz="${i}">${th}<b>${esc(name)}</b><span class="price">${owned ? 'Yours already' : tix(p)}</span></button>`;
        }).join('')}</div>`;
      };
      render();
      game.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pz]');
        if (!b) return;
        const [k, id, p] = PRIZES[+b.dataset.pz];
        if ((k === 'toy' && S().toys.includes(id)) || (k === 'outfit' && S().outfits.includes(id))) { G.toast('You have this one already'); return; }
        if (!G.spendTickets(p)) return;
        if (k === 'toy') G.grantToy(id);
        else if (k === 'outfit') G.getOutfit(id);
        else { G.giveItem(id); G.toast(`${D.ITEMS[id].name} is in your inventory!`); }
        addVP('arcade', 4);
        wallet();
        render();
        G.save();
      });
    });
  }

  // =====================================================================
  // The workshop hall: pottery (a food bowl), sewing (a bandana), woodwork (a painted dog house)
  // =====================================================================
  const PAINTS = ['#e5484d', '#ff8a3d', '#f5c542', '#3fbf7f', '#2bb3c0', '#5aa9e6', '#5b7cfa', '#8a5cf6', '#ef6fa8', '#ffffff', '#3a3a46', '#8d6e4f'];
  const swatches = (key, cur) => `<div class="swatches">${PAINTS.map((c) => `<button class="sw${c === cur ? ' sel' : ''}" data-${key}="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const choice = (key, opts, cur) => `<div class="vgChips small">${opts.map(([v, n]) => `<button class="vgChip${v === cur ? ' sel' : ''}" data-${key}="${v}"><small>${esc(n)}</small></button>`).join('')}</div>`;
  const qualityWord = (q) => (q > 0.8 ? 'Beautifully made!' : q > 0.55 ? 'Nicely made!' : q > 0.3 ? 'Charmingly handmade!' : 'Wonderfully wobbly, full of character!');

  function playPottery() {
    if (!payFor(30, 'Clay and glaze')) return;
    openGame('Pottery: a food bowl', (game) => {
      game.body.insertAdjacentHTML('beforeend', '<p class="vgHelp">Keep the clay in the middle of the wheel: press and hold on the left or right side to nudge it back.</p>');
      const cv = gameCanvas(game, 300, 240), x = cv.x;
      let w = 0, v = 0, push = 0, t = 0, good = 0, total = 8, stage = 'spin';
      const hold = (e) => { const p = cv.pos(e); push = p.x < 150 ? 1 : -1; };
      cv.c.addEventListener('pointerdown', hold);
      cv.c.addEventListener('pointermove', (e) => { if (push) hold(e); });
      const let_ = () => { push = 0; };
      cv.c.addEventListener('pointerup', let_); cv.c.addEventListener('pointercancel', let_);
      game.loop((dt) => {
        if (stage !== 'spin') return;
        t += dt;
        v += (rand(-1, 1) * 2.2 + w * 0.9 + push * 3.2) * dt;
        v *= 0.985;
        w = clamp(w + v * dt * 1.4, -1.2, 1.2);
        if (Math.abs(w) < 0.3) good += dt;
        x.clearRect(0, 0, 300, 240);
        x.fillStyle = '#c9a882'; x.fillRect(0, 0, 300, 240);
        x.fillStyle = '#6d4c41'; x.beginPath(); x.ellipse(150, 190, 120, 26, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#8d6e63'; x.beginPath(); x.ellipse(150, 184, 112, 22, 0, 0, Math.PI * 2); x.fill();
        x.strokeStyle = '#a1887f'; x.lineWidth = 2; for (let k = 0; k < 6; k++) { const a = t * 6 + k; x.beginPath(); x.moveTo(150 + Math.cos(a) * 100, 184 + Math.sin(a) * 18); x.lineTo(150 + Math.cos(a) * 60, 184 + Math.sin(a) * 11); x.stroke(); }
        const cx = 150 + w * 60, wob = Math.sin(t * 14) * Math.abs(w) * 6;
        x.fillStyle = '#c86b4a';
        x.beginPath(); x.moveTo(cx - 46 - wob, 182); x.quadraticCurveTo(cx - 40, 110, cx, 104 + wob); x.quadraticCurveTo(cx + 40, 110, cx + 46 + wob, 182); x.closePath(); x.fill();
        x.fillStyle = '#e08b6a'; x.beginPath(); x.ellipse(cx, 108 + wob, 18, 5, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(20, 16, 260, 10); x.fillStyle = Math.abs(w) < 0.3 ? '#3fbf7f' : '#ff8a3d'; x.fillRect(20, 16, 260 * Math.min(1, t / total), 10);
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(150 - 39, 32, 78, 6); x.fillStyle = '#ffffff'; x.fillRect(150 + w * 120 - 3, 30, 6, 10);
        if (t >= total) { stage = 'design'; design(clamp(good / total, 0, 1)); }
      });
      const design = (q) => {
        const C = Object.assign({ shape: 'classic', base: '#5aa9e6', rim: '#ffffff', pattern: 'paws', accent: '#f5c542' }, (S().custom || {}).bowl || {});
        const draw = () => {
          game.body.innerHTML = `<p class="vgHelp">${esc(qualityWord(q))} Now pick the shape and glaze.</p><canvas id="bowlPrev" width="240" height="130" class="vgPrev"></canvas>
            <b class="lbl">Shape</b>${choice('shape', [['wide', 'Wide'], ['classic', 'Classic'], ['tall', 'Tall']], C.shape)}
            <b class="lbl">Glaze</b>${swatches('base', C.base)}<b class="lbl">Rim</b>${swatches('rim', C.rim)}
            <b class="lbl">Pattern</b>${choice('pattern', [['plain', 'Plain'], ['dots', 'Dots'], ['stripes', 'Stripes'], ['paws', 'Paws']], C.pattern)}${C.pattern !== 'plain' ? swatches('accent', C.accent) : ''}
            <button class="primary wide" data-fire="1">Fire it in the kiln</button>`;
          const px = $('bowlPrev').getContext('2d');
          const W = C.shape === 'wide' ? 190 : C.shape === 'tall' ? 130 : 160, H = C.shape === 'tall' ? 90 : C.shape === 'wide' ? 50 : 66, y0 = 110 - H;
          px.fillStyle = C.base; px.beginPath(); px.moveTo(120 - W / 2, y0); px.lineTo(120 + W / 2, y0); px.lineTo(120 + W / 2 - 16, 110); px.lineTo(120 - W / 2 + 16, 110); px.closePath(); px.fill();
          px.fillStyle = C.rim; px.fillRect(120 - W / 2 - 3, y0 - 6, W + 6, 9);
          px.fillStyle = C.accent;
          if (C.pattern === 'dots') for (let k = -2; k <= 2; k++) { px.beginPath(); px.arc(120 + k * (W / 6), y0 + H * 0.5, 6, 0, Math.PI * 2); px.fill(); }
          if (C.pattern === 'stripes') { px.fillRect(120 - W / 2 + 6, y0 + H * 0.3, W - 12, 6); px.fillRect(120 - W / 2 + 10, y0 + H * 0.65, W - 20, 6); }
          if (C.pattern === 'paws') for (const k of [-1, 1]) { shapePath(px, 'paw', 120 + k * (W / 4), y0 + H * 0.52, 14); px.fill(); }
        };
        draw();
        game.body.onclick = (e) => {
          const b = e.target.closest('[data-shape],[data-base],[data-rim],[data-pattern],[data-accent],[data-fire]');
          if (!b) return;
          for (const k of ['shape', 'base', 'rim', 'pattern', 'accent']) if (b.dataset[k]) C[k] = b.dataset[k];
          if (!b.dataset.fire) { draw(); return; }
          const st = S();
          st.custom = st.custom || {};
          st.custom.bowl = C;
          G.applyCustom(st);
          G.giveItem('mybowl');
          G.refreshCustomLooks();
          G.earn('craft');
          addVP('workshop', 5 + q * 6);
          G.sfx('unlock');
          dogCheer(['sniffs the new bowl and looks at you hopefully 🥣', 'already wants dinner from it 🥣']);
          result(game, { icon: 'wheel', title: 'Your bowl is ready!', lines: [esc(qualityWord(q)), 'It’s in your inventory, and it works as a real food bowl. All your handmade bowls wear your newest glaze.'] });
        };
      };
    });
  }
  function playSewing() {
    openGame('Sewing: a bandana', (game) => {
      const st = S();
      const prev = (st.custom || {}).bandana;
      const grid = prev && Array.isArray(prev.grid) ? prev.grid.slice(0, 16) : Array(16).fill('#e5484d');
      while (grid.length < 16) grid.push('#e5484d');
      let col = '#ffffff', name = (prev && prev.name) || 'My bandana';
      const ROWS = [7, 5, 3, 1];
      const render = () => {
        let k = 0;
        const tri = ROWS.map((n) => `<div class="triRow">${Array.from({ length: n }, () => { const i = k++; return `<button class="patch" data-cell="${i}" style="background:${grid[i]}"></button>`; }).join('')}</div>`).join('');
        game.body.innerHTML = `<p class="vgHelp">Tap a patch to color it. Sixteen patches make one bandana.</p><div class="bandana">${tri}</div>${swatches('col', col)}
          <div class="btnRow small"><button class="soft small" data-pat="fill">Fill all</button><button class="soft small" data-pat="stripes">Stripes</button><button class="soft small" data-pat="check">Checks</button><button class="soft small" data-pat="tip">Two-tone</button></div>
          <label class="lbl">Name <input id="bandName" maxlength="16" value="${esc(name)}"></label>
          <button class="primary wide" data-sew="1">Sew it · ${coin(20)}</button>`;
      };
      render();
      game.body.addEventListener('input', (e) => { if (e.target.id === 'bandName') name = e.target.value; });
      game.body.addEventListener('click', (e) => {
        const c = e.target.closest('[data-cell]'), s = e.target.closest('[data-col]'), p = e.target.closest('[data-pat]');
        if (c) { grid[+c.dataset.cell] = col; c.style.background = col; G.sfx('tap'); return; }
        if (s) { col = s.dataset.col; render(); return; }
        if (p) {
          const other = grid[0] === col ? '#ffffff' : grid[0];
          let k = 0;
          ROWS.forEach((n, r) => { for (let i = 0; i < n; i++, k++) grid[k] = p.dataset.pat === 'fill' ? col : p.dataset.pat === 'stripes' ? (r % 2 ? other : col) : p.dataset.pat === 'check' ? ((i + r) % 2 ? other : col) : (r >= 2 ? other : col); });
          render();
          return;
        }
        if (!e.target.closest('[data-sew]')) return;
        if (!payFor(20, 'Fabric and thread')) return;
        st.custom = st.custom || {};
        st.custom.bandana = { grid: grid.slice(), name: String(name || '').replace(/[<>{}]/g, '').trim().slice(0, 16) || 'My bandana' };
        G.applyCustom(st);
        if (!st.accessories.includes('mybandana')) st.accessories.push('mybandana');
        G.refreshCustomLooks();
        G.earn('craft');
        addVP('workshop', 8);
        G.sfx('unlock');
        result(game, { icon: 'needle', title: `“${esc(st.custom.bandana.name)}” is ready!`, lines: ['Put it on any dog: tap a dog → Style. If you sew a new one, the bandana gets the new pattern.'] });
      });
    });
  }
  function playWoodwork() {
    if (!payFor(50, 'Wood and paint')) return;
    openGame('Woodwork: a dog house', (game) => {
      game.body.insertAdjacentHTML('beforeend', '<p class="vgHelp">Saw along the dotted line: put your finger on the left end and slide to the right.</p>');
      const cv = gameCanvas(game, 300, 200), x = cv.x;
      const lineY = (px) => 100 + Math.sin(px / 38) * 16;
      let cut = [], sawing = false, done = false;
      const draw = () => {
        x.clearRect(0, 0, 300, 200);
        x.fillStyle = '#a58460'; x.fillRect(0, 0, 300, 200);
        x.fillStyle = '#e3c08f'; x.fillRect(10, 40, 280, 120);
        x.strokeStyle = '#c9a26b'; x.lineWidth = 1; for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(10, 52 + k * 14); x.bezierCurveTo(100, 46 + k * 14, 200, 60 + k * 14, 290, 52 + k * 14); x.stroke(); }
        x.setLineDash([6, 5]); x.strokeStyle = '#5d3a22'; x.lineWidth = 2; x.beginPath(); for (let px = 14; px <= 286; px += 4) { if (px === 14) x.moveTo(px, lineY(px)); else x.lineTo(px, lineY(px)); } x.stroke(); x.setLineDash([]);
        if (cut.length) { x.strokeStyle = '#3b2414'; x.lineWidth = 3; x.beginPath(); cut.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.stroke(); }
        x.fillStyle = '#3fbf7f'; x.beginPath(); x.arc(14, lineY(14), 7, 0, Math.PI * 2); x.fill();
      };
      draw();
      cv.c.addEventListener('pointerdown', (e) => { if (done) return; const p = cv.pos(e); if (p.x < 60) { sawing = true; cut = [p]; G.sfx('rustle'); } });
      cv.c.addEventListener('pointermove', (e) => {
        if (!sawing || done) return;
        const p = cv.pos(e);
        if (p.x > cut[cut.length - 1].x) cut.push(p);
        draw();
        if (p.x >= 280) finish();
      });
      const stop = () => { if (sawing && !done) { sawing = false; if (cut.length && cut[cut.length - 1].x < 280) G.toast('Keep going all the way to the right edge'); } };
      cv.c.addEventListener('pointerup', stop); cv.c.addEventListener('pointercancel', stop);
      const finish = () => {
        done = true; sawing = false;
        const dev = cut.reduce((s, p) => s + Math.abs(p.y - lineY(p.x)), 0) / Math.max(1, cut.length);
        const q = clamp(1 - dev / 16, 0, 1);
        G.sfx('find');
        game.after(400, () => paint(q));
      };
      const paint = (q) => {
        const C = Object.assign({ wall: '#7fb3d5', roof: '#f5c542', trim: '#ffffff', heart: true }, (S().custom || {}).kennel || {});
        const draw2 = () => {
          game.body.innerHTML = `<p class="vgHelp">${esc(qualityWord(q))} Time to paint!</p><canvas id="housePrev" width="240" height="150" class="vgPrev"></canvas>
            <b class="lbl">Walls</b>${swatches('wall', C.wall)}<b class="lbl">Roof</b>${swatches('roof', C.roof)}<b class="lbl">Trim</b>${swatches('trim', C.trim)}
            ${choice('heart', [['1', 'Heart above the door'], ['0', 'No heart']], C.heart ? '1' : '0')}
            <button class="primary wide" data-done="1">Let it dry</button>`;
          const px = $('housePrev').getContext('2d');
          px.fillStyle = C.wall; px.fillRect(60, 60, 120, 80);
          px.fillStyle = C.roof; px.beginPath(); px.moveTo(46, 64); px.lineTo(120, 14); px.lineTo(194, 64); px.closePath(); px.fill();
          px.fillStyle = '#3b2a1e'; px.beginPath(); px.moveTo(96, 140); px.lineTo(96, 100); px.arc(120, 100, 24, Math.PI, 0); px.lineTo(144, 140); px.fill();
          px.fillStyle = C.trim; px.fillRect(56, 136, 128, 6); px.fillRect(60, 60, 6, 80); px.fillRect(174, 60, 6, 80); px.fillRect(100, 68, 40, 8);
          if (C.heart) { px.fillStyle = '#e5484d'; shapePath(px, 'heart', 120, 52, 9); px.fill(); }
        };
        draw2();
        game.body.onclick = (e) => {
          const b = e.target.closest('[data-wall],[data-roof],[data-trim],[data-heart],[data-done]');
          if (!b) return;
          for (const k of ['wall', 'roof', 'trim']) if (b.dataset[k]) C[k] = b.dataset[k];
          if (b.dataset.heart) C.heart = b.dataset.heart === '1';
          if (!b.dataset.done) { draw2(); return; }
          const st = S();
          st.custom = st.custom || {};
          st.custom.kennel = C;
          G.applyCustom(st);
          G.giveItem('paintedkennel');
          G.refreshCustomLooks();
          G.earn('craft');
          addVP('workshop', 6 + q * 6);
          G.sfx('unlock');
          result(game, { icon: 'saw', title: 'Your dog house is ready!', lines: [esc(qualityWord(q)), 'It’s in your inventory. Dogs love to lounge next to it. All your painted dog houses wear the newest colors.'] });
        };
      };
    });
  }

  // =====================================================================
  // Mini golf: nine dog-themed holes. Pull back and let go to putt.
  // =====================================================================
  const HOLES = [
    { name: 'Puppy Steps', par: 2, start: [120, 320], cup: [120, 60] },
    { name: 'Fire Hydrant Alley', par: 3, start: [120, 320], cup: [120, 50], bump: [[80, 210, 12], [160, 160, 12], [110, 110, 12]] },
    { name: 'The Bone Zone', par: 3, start: [60, 320], cup: [180, 60], walls: [[10, 165, 85, 30], [145, 165, 85, 30]], bump: [[95, 180, 9], [145, 180, 9]] },
    { name: 'The Water Bowl', par: 3, start: [120, 320], cup: [120, 60], water: [[60, 140, 120, 70]] },
    { name: 'Doghouse Tunnel', par: 3, start: [190, 320], cup: [50, 60], walls: [[10, 180, 90, 22], [140, 180, 90, 22]], house: [100, 172, 40] },
    { name: 'Sleepy Pup', par: 3, start: [120, 320], cup: [120, 64], bump: [[120, 195, 34, 'pup']] },
    { name: 'Squirrel Run', par: 3, start: [120, 320], cup: [120, 56], mover: { y: 190, w: 54, h: 14, x0: 14, x1: 172, v: 80 } },
    { name: 'Paw Print Path', par: 3, start: [200, 320], cup: [50, 56], sand: [[30, 110, 80, 56], [130, 190, 80, 56]], walls: [[90, 260, 140, 16]] },
    { name: 'Kibble Corner', par: 4, start: [40, 320], cup: [42, 52], walls: [[10, 190, 170, 16], [80, 10, 16, 120]], bump: [[160, 90, 10]] },
  ];
  const COURSE = [10, 10, 220, 340];
  function playGolf(startAt = 0) {
    openGame('Mini golf', (game) => {
      const cv = gameCanvas(game, 240, 360), x = cv.x;
      const card = html('div', 'golfCard'); game.body.insertBefore(card, game.body.firstChild);
      const strokes = [];
      let h = clamp(startAt | 0, 0, HOLES.length - 1), H, ball, rest, aim = null, shots = 0, sunk = false, mover = null, splash = 0, cheerT = 0;
      const startHole = () => {
        H = HOLES[h];
        ball = { x: H.start[0], y: H.start[1], vx: 0, vy: 0, moving: false, s: 1 };
        rest = { x: ball.x, y: ball.y };
        shots = 0; sunk = false;
        mover = H.mover ? { x: H.mover.x0, dir: 1 } : null;
        renderCard();
      };
      const renderCard = () => {
        const tot = strokes.reduce((a, b) => a + b, 0), par = HOLES.slice(0, strokes.length).reduce((a, b) => a + b.par, 0);
        card.innerHTML = `<b>Hole ${h + 1}: ${esc(H.name)}</b><small>Par ${H.par} · Strokes ${shots}${strokes.length ? ` · Total ${tot} (${tot - par > 0 ? '+' : ''}${tot - par})` : ''}</small>`;
      };
      const rects = () => {
        const r = (H.walls || []).slice();
        if (mover) r.push([mover.x, H.mover.y, H.mover.w, H.mover.h, 'mover']);
        return r;
      };
      const inR = (px, py, R) => px > R[0] && px < R[0] + R[2] && py > R[1] && py < R[1] + R[3];
      cv.c.addEventListener('pointerdown', (e) => { if (ball.moving || sunk) return; const p = cv.pos(e); aim = { x0: p.x, y0: p.y, x: p.x, y: p.y }; });
      cv.c.addEventListener('pointermove', (e) => { if (!aim) return; const p = cv.pos(e); aim.x = p.x; aim.y = p.y; });
      const release = () => {
        if (!aim) return;
        const dx = aim.x0 - aim.x, dy = aim.y0 - aim.y, len = Math.hypot(dx, dy);
        aim = null;
        if (len < 6) return;
        const pw = Math.min(len, 110) / 110 * 430;
        ball.vx = (dx / len) * pw; ball.vy = (dy / len) * pw; ball.moving = true;
        rest = { x: ball.x, y: ball.y };
        shots++;
        G.sfx('throw');
        renderCard();
      };
      cv.c.addEventListener('pointerup', release); cv.c.addEventListener('pointercancel', () => { aim = null; });
      const holeDone = () => {
        strokes.push(shots);
        const d = shots - H.par;
        const word = shots === 1 ? 'Hole in one!' : d <= -2 ? 'Eagle!' : d === -1 ? 'Birdie!' : d === 0 ? 'Par!' : d === 1 ? 'Bogey, nice try!' : 'Done!';
        G.toast(`⛳ ${word}`);
        if (shots === 1) { dogCheer(['jumps up and down: a hole in one! 🎉', 'does zoomies around the green 🌀']); G.sfx('unlock'); }
        else if (d <= 0) dogCheer(['wags at your putt 🐾', 'gives an approving woof 🐕']);
        game.after(900, () => {
          h++;
          if (h < HOLES.length) { startHole(); return; }
          const tot = strokes.reduce((a, b) => a + b, 0), par = HOLES.reduce((a, b) => a + b.par, 0), diff = tot - par;
          const coins = Math.max(10, 60 - Math.max(0, diff) * 5);
          G.addCoins(coins);
          G.earn('golf');
          addVP('minigolf', 6 + Math.max(0, 12 - Math.max(0, diff)));
          const st = S(), lines = [`${tot} strokes · par ${par} (${diff > 0 ? '+' : ''}${diff})`, `+${coin(coins)}`];
          if (!st.golfBest || tot < st.golfBest) { if (st.golfBest) lines.push('A new personal best!'); st.golfBest = tot; }
          if (diff <= 0 && !st.golfTrophy) { st.golfTrophy = true; G.giveItem('golftrophy'); lines.push('You won the mini golf trophy! It’s in your inventory.'); G.sfx('unlock'); }
          result(game, { icon: 'golf', title: diff < 0 ? 'Under par!' : diff === 0 ? 'Right on par!' : 'Round complete!', lines, again: () => playGolf() });
        });
      };
      startHole();
      game.loop((dt) => {
        if (mover) { mover.x += mover.dir * H.mover.v * dt; if (mover.x > H.mover.x1) { mover.x = H.mover.x1; mover.dir = -1; } if (mover.x < H.mover.x0) { mover.x = H.mover.x0; mover.dir = 1; } }
        if (splash > 0) splash -= dt;
        if (ball.moving && !sunk) {
          const sub = 4, R = 5;
          for (let s = 0; s < sub; s++) {
            const sd = dt / sub;
            const inSand = (H.sand || []).some((S2) => inR(ball.x, ball.y, S2));
            const f = Math.exp(-(inSand ? 3.6 : 1.05) * sd);
            ball.vx *= f; ball.vy *= f;
            ball.x += ball.vx * sd; ball.y += ball.vy * sd;
            // course edge
            const [cx0, cy0, cw, ch] = COURSE;
            if (ball.x < cx0 + R) { ball.x = cx0 + R; ball.vx = Math.abs(ball.vx) * 0.8; }
            if (ball.x > cx0 + cw - R) { ball.x = cx0 + cw - R; ball.vx = -Math.abs(ball.vx) * 0.8; }
            if (ball.y < cy0 + R) { ball.y = cy0 + R; ball.vy = Math.abs(ball.vy) * 0.8; }
            if (ball.y > cy0 + ch - R) { ball.y = cy0 + ch - R; ball.vy = -Math.abs(ball.vy) * 0.8; }
            for (const W of rects()) {
              const qx = clamp(ball.x, W[0], W[0] + W[2]), qy = clamp(ball.y, W[1], W[1] + W[3]);
              const dx = ball.x - qx, dy = ball.y - qy, d = Math.hypot(dx, dy);
              if (d < R) {
                const nx = d ? dx / d : 0, ny = d ? dy / d : -1;
                ball.x = qx + nx * R; ball.y = qy + ny * R;
                const dot = ball.vx * nx + ball.vy * ny;
                if (dot < 0) { ball.vx -= 1.8 * dot * nx; ball.vy -= 1.8 * dot * ny; }
                if (W[4] === 'mover') ball.vx += mover.dir * H.mover.v * 0.6;
              }
            }
            for (const B of H.bump || []) {
              const dx = ball.x - B[0], dy = ball.y - B[1], d = Math.hypot(dx, dy);
              if (d < B[2] + R) {
                const nx = dx / d, ny = dy / d;
                ball.x = B[0] + nx * (B[2] + R); ball.y = B[1] + ny * (B[2] + R);
                const dot = ball.vx * nx + ball.vy * ny;
                if (dot < 0) { ball.vx -= 2.05 * dot * nx; ball.vy -= 2.05 * dot * ny; G.sfx(B[3] === 'pup' ? 'yip' : 'bounce'); }
              }
            }
            if ((H.water || []).some((Wt) => inR(ball.x, ball.y, Wt))) {
              splash = 0.8; G.sfx('splash'); G.toast('Splash! Into the water bowl 💧 (+1 stroke)');
              shots++; ball.x = rest.x; ball.y = rest.y; ball.vx = ball.vy = 0; ball.moving = false; renderCard(); break;
            }
            const cd = Math.hypot(ball.x - H.cup[0], ball.y - H.cup[1]), sp = Math.hypot(ball.vx, ball.vy);
            if (cd < 7 && sp < 300) { sunk = true; ball.moving = false; ball.x = H.cup[0]; ball.y = H.cup[1]; G.sfx('plop'); holeDone(); break; }
            if (cd < 10 && sp >= 300) { ball.vx += (H.cup[0] - ball.x) * 3; ball.vy += (H.cup[1] - ball.y) * 3; }
          }
          if (ball.moving && Math.hypot(ball.vx, ball.vy) < 7) { ball.moving = false; ball.vx = ball.vy = 0; if (shots >= 8 && !sunk) { G.toast('Picked up after 8 strokes. On to the next!'); sunk = true; shots = 8; holeDone(); } }
        }
        // draw the hole
        x.clearRect(0, 0, 240, 360);
        x.fillStyle = '#7cc56a'; x.fillRect(0, 0, 240, 360);
        x.fillStyle = '#5b3a24'; x.fillRect(COURSE[0] - 6, COURSE[1] - 6, COURSE[2] + 12, COURSE[3] + 12);
        x.fillStyle = '#5cc15e'; x.fillRect(...COURSE);
        for (let k = 0; k < 14; k++) { x.fillStyle = k % 2 ? '#58b95a' : '#5cc15e'; x.fillRect(COURSE[0], COURSE[1] + k * 24.3, COURSE[2], 12); }
        for (const Sd of H.sand || []) { x.fillStyle = '#ecd9a4'; x.fillRect(...Sd); x.fillStyle = '#d8c08a'; shapePath(x, 'paw', Sd[0] + Sd[2] / 2, Sd[1] + Sd[3] / 2, Math.min(Sd[2], Sd[3]) * 0.4); x.fill(); }
        for (const Wt of H.water || []) { x.fillStyle = '#d64545'; x.fillRect(Wt[0] - 5, Wt[1] - 5, Wt[2] + 10, Wt[3] + 10); x.fillStyle = splash > 0 ? '#9fd3f5' : '#5aa4dc'; x.fillRect(...Wt); x.fillStyle = '#ffffff55'; x.fillRect(Wt[0] + 10, Wt[1] + 10, 30, 4); }
        for (const W of rects()) {
          if (W[4] === 'mover') { x.fillStyle = '#b5652f'; x.fillRect(W[0], W[1], W[2], W[3]); x.fillStyle = '#d98a4a'; x.beginPath(); x.ellipse(W[0] + W[2] + 6, W[1] + 2, 9, 12, 0.4, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2b1d14'; x.fillRect(W[0] + 4, W[1] + 3, 3, 3); continue; }
          x.fillStyle = '#8d5a34'; x.fillRect(...W); x.fillStyle = '#a5713f'; x.fillRect(W[0], W[1], W[2], 4);
        }
        if (H.house) { const [hx, hy, hw] = H.house; x.fillStyle = '#c0392b'; x.beginPath(); x.moveTo(hx - 6, hy + 8); x.lineTo(hx + hw / 2, hy - 12); x.lineTo(hx + hw + 6, hy + 8); x.fill(); x.fillStyle = '#3b2a1e'; x.fillRect(hx + 6, hy + 8, hw - 12, 22); }
        for (const B of H.bump || []) {
          if (B[3] === 'pup') { x.fillStyle = '#d9a441'; x.beginPath(); x.ellipse(B[0], B[1], B[2], B[2] * 0.75, 0, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(B[0] + B[2] * 0.7, B[1] - 6, B[2] * 0.45, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2b1d14'; x.fillRect(B[0] + B[2] * 0.6, B[1] - 8, 6, 2); x.fillStyle = '#ffffff'; x.font = 'bold 10px sans-serif'; x.fillText('z', B[0] + B[2] * 0.9, B[1] - B[2] * 0.7 - Math.sin(game.t = (game.t || 0) + dt) * 3); continue; }
          x.fillStyle = '#e53935'; x.beginPath(); x.arc(B[0], B[1], B[2], 0, Math.PI * 2); x.fill(); x.fillStyle = '#ffca28'; x.fillRect(B[0] - B[2] * 0.6, B[1] - 2, B[2] * 1.2, 4); x.fillStyle = '#ffffff55'; x.beginPath(); x.arc(B[0] - B[2] * 0.3, B[1] - B[2] * 0.3, B[2] * 0.3, 0, Math.PI * 2); x.fill();
        }
        x.fillStyle = '#1b1b1b'; x.beginPath(); x.arc(H.cup[0], H.cup[1], 7, 0, Math.PI * 2); x.fill();
        if (!sunk) { x.fillStyle = '#eeeeee'; x.fillRect(H.cup[0] - 1, H.cup[1] - 30, 2, 30); x.fillStyle = '#e53935'; x.beginPath(); x.moveTo(H.cup[0] + 1, H.cup[1] - 30); x.lineTo(H.cup[0] + 16, H.cup[1] - 25); x.lineTo(H.cup[0] + 1, H.cup[1] - 20); x.fill(); }
        x.fillStyle = 'rgba(0,0,0,0.2)'; x.beginPath(); x.ellipse(ball.x + 2, ball.y + 3, 5, 3, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(ball.x, ball.y, 5, 0, Math.PI * 2); x.fill();
        if (aim) {
          const dx = aim.x0 - aim.x, dy = aim.y0 - aim.y, len = Math.hypot(dx, dy), k = Math.min(len, 110) / 110;
          if (len > 6) {
            x.setLineDash([4, 5]); x.strokeStyle = `rgba(255,255,255,0.9)`; x.lineWidth = 2;
            x.beginPath(); x.moveTo(ball.x, ball.y); x.lineTo(ball.x + (dx / len) * (30 + k * 90), ball.y + (dy / len) * (30 + k * 90)); x.stroke(); x.setLineDash([]);
            x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(16, 340, 80, 8); x.fillStyle = k > 0.8 ? '#ff8a3d' : '#ffe24a'; x.fillRect(16, 340, 80 * k, 8);
          }
        }
        if (cheerT > 0) cheerT -= dt;
      });
    });
  }

  // =====================================================================
  // The Sunday flea market: haggle for one-of-a-kind vintage furniture
  // =====================================================================
  const SELLERS = [
    { name: 'Oma Gertrud', shirt: '#b39ddb', hair: '#d6d6d6', hi: 'Everything here has a story, dear.', low: 'Oh my, that’s a little low! This was my mother’s.', ok: 'Deal! Look after it for me.', counter: 'How about {p}? I’ll throw in a smile.', last: 'For you, {p}. That’s my very last word.' },
    { name: 'Herr Brandt', shirt: '#8d6e4f', hair: '#4e342e', hi: 'Genuine antiques! Well. Mostly genuine.', low: 'Ha! You’re a tough one. Try again.', ok: 'Sold! A fine choice.', counter: 'I could do {p}. Because it’s Sunday.', last: '{p}, and not a coin less. Final offer!' },
    { name: 'Jules', shirt: '#4db6ac', hair: '#1a1a1a', hi: 'Hey! I restore old things. Have a look!', low: 'Hmm, I spent a week sanding that one…', ok: 'Yes! It’s going to a good home.', counter: 'Meet me at {p}?', last: 'Okay, {p}. That’s as low as I go.' },
  ];
  const vintageLeft = () => Object.keys(D.ITEMS).filter((k) => D.ITEMS[k].vintage && !(S().vintage || []).includes(k));
  function fleaStock() {
    const rr = seeded('flea|' + Math.floor(G.clock.gameDay / 7));
    const left = shuffleR(vintageLeft(), rr);
    return SELLERS.map((P, i) => ({ P, items: left.slice(i * 2, i * 2 + 2) }));
  }
  function playFlea() {
    openGame('Flea market', (game) => {
      const st = S();
      st.flea = st.flea && st.flea.day === G.clock.gameDay ? st.flea : { day: G.clock.gameDay, walked: [] };
      const list = () => {
        const stock = fleaStock();
        game.body.innerHTML = `<p class="vgHelp">Every piece here is one of a kind: once it’s yours, nobody else gets it. Make an offer!</p>${stock.map(({ P, items }) => `<div class="stallCard glass"><div class="vgRow plain"><img class="th" src="${G.personPortrait({ owner: P.name, shirt: P.shirt, hair: P.hair })}" alt=""><span><b>${esc(P.name)}</b><small>“${esc(P.hi)}”</small></span></div><div class="vgGrid">${items.length ? items.map((k) => `<button class="vgCard${st.flea.walked.includes(k) ? ' owned' : ''}" data-item="${k}" data-seller="${esc(P.name)}">${G.thumbOf.item(k)}<b>${esc(D.ITEMS[k].name)}</b><span class="price">${st.flea.walked.includes(k) ? 'Maybe next Sunday' : `asks ${coin(Math.round(D.ITEMS[k].vintage * 1.35))}`}</span></button>`).join('') : '<p class="sub">Sold out! Come back next Sunday.</p>'}</div></div>`).join('')}`;
      };
      list();
      game.body.addEventListener('click', (e) => {
        if (e.target.closest('[data-back]')) { list(); return; }
        const b = e.target.closest('[data-item]');
        if (!b) return;
        const k = b.dataset.item;
        if (st.flea.walked.includes(k)) { G.toast('The seller is keeping that one for next Sunday'); return; }
        haggle(game, k, SELLERS.find((P) => P.name === b.dataset.seller), list);
      });
    });
  }
  function haggle(game, k, P, back) {
    const base = D.ITEMS[k].vintage, pups = companions();
    // what they'd really take (a nice dog at your side softens anyone)
    const floor = Math.round(base * rand(0.72, 0.88) * (pups.length ? 0.95 : 1));
    let ask = Math.round(base * 1.35), offer = Math.round(base * 0.85), patience = 3 + (pups.length ? 1 : 0), last = false, line = P.hi;
    if (pups.length) line = `${pups[0].name}! What a sweetheart. ${P.hi}`;
    const render = () => {
      game.body.innerHTML = `<div class="haggle"><img class="th big" src="${G.personPortrait({ owner: P.name, shirt: P.shirt, hair: P.hair })}" alt=""><b>${esc(P.name)}</b><p class="say">“${esc(line)}”</p>
        <div class="hagItem">${G.thumbOf.item(k)}<span><b>${esc(D.ITEMS[k].name)}</b><small>Asking ${coin(ask)} · you have ${coin(S().coins)}</small></span></div>
        <div class="patience">${Array.from({ length: 4 }, (_, i) => `<i class="${i < patience ? 'on' : ''}"></i>`).join('')}<small>Seller’s patience</small></div>
        ${last ? `<div class="btnRow"><button class="primary" data-h="take">Take it for ${coin(ask)}</button><button class="soft" data-h="leave">Maybe next Sunday</button></div>` :
        `<div class="offer"><button class="soft small" data-h="-10">−10</button><button class="soft small" data-h="-1">−1</button><b>${coin(offer)}</b><button class="soft small" data-h="+1">+1</button><button class="soft small" data-h="+10">+10</button></div>
        <div class="btnRow"><button class="primary" data-h="offer">Offer ${offer}</button><button class="soft" data-h="take">Pay ${ask}</button></div>`}
        <button class="link" data-back="1">Back to the stalls</button></div>`;
    };
    render();
    game.body.onclick = (e) => {
      const b = e.target.closest('[data-h]');
      if (!b) return;
      const h = b.dataset.h;
      if (/^[+-]\d+$/.test(h)) { offer = clamp(offer + +h, 1, ask); render(); return; }
      if (h === 'leave') { const st = S(); st.flea.walked.push(k); game.body.onclick = null; back(); return; }
      if (h === 'take') { buy(ask, ask >= Math.round(base * 1.35) ? 'Paid the asking price. The seller beams!' : 'A fair deal!'); return; }
      if (h === 'offer') {
        G.sfx('tap');
        if (offer >= floor) { buy(offer, offer < base ? 'What a bargain!' : 'A fair deal!'); return; }
        if (offer < floor * 0.6) { patience -= 2; line = P.low; }
        else { patience -= 1; ask = Math.max(floor, Math.round((ask + offer) / 2 + rand(0, 6))); line = P.counter.replace('{p}', ask); }
        if (patience <= 0) { last = true; ask = Math.max(floor, Math.round(ask)); line = P.last.replace('{p}', ask); }
        render();
      }
    };
    const buy = (price, note) => {
      if (!payFor(price)) return;
      const st = S();
      st.vintage = (st.vintage || []).concat(k);
      G.giveItem(k);
      G.earn('haggle');
      addVP('flea', 6 + clamp((base * 1.35 - price) / 10, 0, 8));
      G.sfx('unlock');
      game.body.onclick = null;
      result(game, { icon: 'tag', title: `${D.ITEMS[k].name}: yours!`, lines: [`“${esc(P.ok)}”`, `${esc(note)} You paid ${coin(price)}.`, 'It’s in your inventory. One of a kind!'] });
    };
  }

  // =====================================================================
  // The indoor pool: swim races and the diving board. Dogs wait at the entrance.
  // =====================================================================
  function playSwim() {
    openGame('Swim race', (game) => {
      game.body.insertAdjacentHTML('beforeend', '<p class="vgHelp">Tap when the marker is in the green: every good stroke is a burst of speed. 50 meters, four lanes!</p>');
      const cv = gameCanvas(game, 300, 380), x = cv.x;
      const rivals = shuffleR(D.NEIGHBORS, Math.random).slice(0, 3).map((N, i) => ({ N, d: 0, v: rand(1.75, 2.15) + i * 0.05, ph: rand(0, 6), done: 0 }));
      const me = { d: 0, v: 0, ph: 0, done: 0 };
      let t = -2.5, m = 0, mDir = 1, place = 0, finished = false, flash = 0, flashOk = false;
      const LEN = 50;
      cv.c.addEventListener('pointerdown', () => {
        if (t < 0 || me.done) return;
        const good = m > 0.38 && m < 0.62, great = m > 0.45 && m < 0.55;
        me.v = Math.min(3.1, me.v + (great ? 1.15 : good ? 0.85 : 0.25));
        flash = 0.25; flashOk = good;
        G.sfx(good ? 'splash' : 'plop');
      });
      game.loop((dt) => {
        t += dt;
        if (t > 0) {
          m += mDir * dt * 1.25; if (m > 1) { m = 1; mDir = -1; } if (m < 0) { m = 0; mDir = 1; }
          me.v = Math.max(0.35, me.v - dt * 0.9);
          if (!me.done) { me.d += me.v * dt * 2.2; me.ph += me.v * dt * 3; if (me.d >= LEN) { me.d = LEN; me.done = t; place = 1 + rivals.filter((r) => r.done && r.done < t).length; } }
          for (const r of rivals) if (!r.done) { r.d += (r.v + Math.sin(t * 1.3 + r.ph) * 0.25) * dt * 2.2; r.ph += dt * 5; if (r.d >= LEN) { r.d = LEN; r.done = t; } }
          if (me.done && !finished) {
            finished = true;
            const coins = [40, 25, 15, 10][place - 1];
            G.addCoins(coins); G.earn('swim'); addVP('pool', [10, 7, 5, 4][place - 1]);
            const st = S(), lines = [`${['1st', '2nd', '3rd', '4th'][place - 1]} place · ${me.done.toFixed(1)} s`, `+${coin(coins)}`];
            if (place === 1 && !st.swimTrophy) { st.swimTrophy = true; G.giveItem('swimtrophy'); lines.push('You won the swim trophy! It’s in your inventory.'); }
            G.sfx(place === 1 ? 'unlock' : 'find');
            const c = companions();
            if (c.length) lines.push(`${esc(c[0].name)} barks a happy hello from the entrance 🐾`);
            game.after(700, () => result(game, { icon: 'swim', title: place === 1 ? 'You won the race!' : place === 2 ? 'So close: 2nd place!' : 'What a swim!', lines, again: playSwim }));
          }
        }
        x.clearRect(0, 0, 300, 380);
        x.fillStyle = '#4fb3e0'; x.fillRect(0, 0, 300, 380);
        for (let l = 0; l <= 4; l++) { for (let y = 0; y < 330; y += 10) { x.fillStyle = (y / 10) % 2 ? '#ffffff' : '#e53935'; x.fillRect(l * 75 - 2, y + 20, 4, 6); } }
        x.fillStyle = '#e3f2f7'; x.fillRect(0, 0, 300, 20); x.fillRect(0, 350, 300, 30);
        const all = [{ who: youName(), r: me, col: (S().look || {}).fav || '#5b7cfa' }].concat(rivals.map((r) => ({ who: r.N.owner, r, col: r.N.shirt })));
        all.forEach((A, i) => {
          const lx = i * 75 + 37, y = 340 - (A.r.d / LEN) * 310;
          x.fillStyle = '#ffffff66'; x.beginPath(); x.ellipse(lx, y + 14, 10, 6, 0, 0, Math.PI * 2); x.fill();
          x.fillStyle = A.col; x.beginPath(); x.arc(lx, y, 8, 0, Math.PI * 2); x.fill();
          x.fillStyle = '#f1c8a0'; const s = Math.sin(A.r.ph); x.fillRect(lx - 14 + s * 3, y - 2 - s * 5, 5, 5); x.fillRect(lx + 9 - s * 3, y - 2 + s * 5, 5, 5);
          x.fillStyle = '#1d1834'; x.font = 'bold 9px sans-serif'; x.textAlign = 'center'; x.fillText(A.who.slice(0, 9), lx, 372);
        });
        x.textAlign = 'left';
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(40, 4, 220, 12);
        x.fillStyle = '#3fbf7f'; x.fillRect(40 + 220 * 0.38, 4, 220 * 0.24, 12);
        x.fillStyle = '#2e9e68'; x.fillRect(40 + 220 * 0.45, 4, 220 * 0.1, 12);
        x.fillStyle = flash > 0 ? (flashOk ? '#ffffff' : '#ff8a3d') : '#ffe24a'; x.fillRect(40 + 220 * m - 3, 2, 6, 16);
        if (flash > 0) flash -= dt;
        if (t < 0) { x.fillStyle = '#ffffff'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.fillText(t < -1.6 ? 'Ready' : t < -0.7 ? 'Set' : 'Go!', 150, 190); x.textAlign = 'left'; }
      });
    });
  }
  function playDive() {
    openGame('Diving board', (game) => {
      game.body.insertAdjacentHTML('beforeend', '<p class="vgHelp">Tap at the top of each bounce to go higher (3 bounces). In the air, tap to spin. Then tap when the arrow points straight down for a clean entry.</p>');
      const cv = gameCanvas(game, 300, 380), x = cv.x;
      let dive = 0, total = 0;
      const scores = [];
      let D2;
      const reset = () => { D2 = { ph: 'bounce', b: 0, y: 0, vy: 0, h: 22, best: 0, spins: 0, rot: 0, spinning: 0, entry: null, t: 0, waterY: 0, splash: 0 }; D2.vy = 60; };
      reset();
      cv.c.addEventListener('pointerdown', () => {
        if (D2.ph === 'bounce') {
          const top = Math.abs(D2.vy) < 26 && D2.y > 4;
          D2.h = clamp(D2.h + (top ? 16 : 4), 0, 80);
          G.sfx(top ? 'bounce' : 'tap');
        } else if (D2.ph === 'air' && D2.spinning <= 0) { D2.spinning = 0.5; D2.spins++; G.sfx('whoosh'); }
        else if (D2.ph === 'entry' && D2.entry === null) {
          const a = ((D2.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), off = Math.min(Math.abs(a - Math.PI), Math.PI);
          D2.entry = clamp(1 - off / 1.2, 0, 1);
        }
      });
      game.loop((dt) => {
        const g = 220;
        if (D2.ph === 'bounce') {
          D2.y += D2.vy * dt; D2.vy -= g * dt;
          if (D2.y <= 0) { D2.y = 0; D2.b++; if (D2.b >= 4) { D2.ph = 'air'; D2.vy = 70 + D2.h * 1.8; D2.best = D2.h; D2.x = 0; } else D2.vy = Math.sqrt(2 * g * D2.h); }
        } else if (D2.ph === 'air' || D2.ph === 'entry') {
          D2.y += D2.vy * dt; D2.vy -= g * dt; D2.x = (D2.x || 0) + 38 * dt;
          if (D2.spinning > 0) { D2.spinning -= dt; D2.rot += (Math.PI * 2 / 0.5) * dt; }
          else if (D2.ph === 'entry' && D2.entry === null) D2.rot += 3.2 * dt;
          if (D2.vy < 0 && D2.ph === 'air' && D2.spinning <= 0) D2.ph = 'entry';
          if (D2.y < -150) {
            D2.ph = 'done';
            const height = clamp(D2.best / 70, 0, 1), spin = Math.min(D2.spins, 3) / 3, entry = D2.entry === null ? 0.1 : D2.entry;
            const judge = () => clamp(Math.round((height * 3 + spin * 3 + entry * 4) * 10 + rand(-6, 6)) / 10, 0, 10);
            const J = [judge(), judge(), judge()];
            const sc = Math.round(J.reduce((a, b) => a + b, 0) * 10) / 10;
            scores.push(sc); total += sc; dive++;
            D2.splash = entry > 0.6 ? 0.6 : 1.4;
            G.sfx('splash');
            G.toast(entry > 0.7 ? `A clean entry! Judges: ${J.join(' · ')}` : entry > 0.35 ? `Nice dive! Judges: ${J.join(' · ')}` : `Big splash! The kids cheer 💦 Judges: ${J.join(' · ')}`);
            game.after(1600, () => {
              if (dive < 3) { reset(); return; }
              const coins = Math.round(total);
              G.addCoins(coins); G.earn('swim'); addVP('pool', 3 + total / 6);
              const c = companions();
              result(game, { icon: 'dive', title: total >= 70 ? 'A dive star!' : total >= 45 ? 'Great dives!' : 'What a fun splash!', lines: [`Dives: ${scores.join(' · ')} = ${Math.round(total * 10) / 10} points`, `+${coin(coins)}`].concat(c.length ? [`${esc(c[0].name)} wags so hard at the entrance that the towel falls off 🐾`] : []), again: playDive });
            });
          }
        }
        if (D2.splash > 0) D2.splash -= dt;
        x.clearRect(0, 0, 300, 380);
        x.fillStyle = '#e3f2f7'; x.fillRect(0, 0, 300, 380);
        for (let i = 0; i < 300; i += 20) for (let j = 0; j < 260; j += 20) { x.fillStyle = (i + j) % 40 ? '#d6ecf3' : '#cfe7f0'; x.fillRect(i, j, 19, 19); }
        x.fillStyle = '#4fb3e0'; x.fillRect(0, 270, 300, 110);
        x.fillStyle = '#8fd6f2'; for (let i = 0; i < 300; i += 24) x.fillRect(i + (dive * 7) % 24, 280, 10, 2);
        x.fillStyle = '#b0bec5'; x.fillRect(30, 150, 10, 120); x.fillStyle = '#ffffff'; x.fillRect(20, 140, 110, 8);
        const bend = D2.ph === 'bounce' && D2.y < 8 ? 6 : 0;
        x.fillStyle = '#ffffff'; x.fillRect(80, 140 + bend, 50, 8);
        const px = 110 + (D2.x || 0), py = 128 - D2.y + (D2.ph === 'bounce' ? bend : 0);
        if (D2.ph !== 'done' || D2.splash <= 0) {
          x.save(); x.translate(px, py); x.rotate(D2.rot);
          x.fillStyle = (S().look || {}).fav || '#5b7cfa'; x.fillRect(-5, -10, 10, 14);
          x.fillStyle = '#f1c8a0'; x.beginPath(); x.arc(0, -15, 6, 0, Math.PI * 2); x.fill();
          x.fillRect(-4, 4, 3, 10); x.fillRect(1, 4, 3, 10);
          x.restore();
        }
        if (D2.ph === 'entry' && D2.entry === null) { x.strokeStyle = '#e53935'; x.lineWidth = 3; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.sin(D2.rot) * 26, py - Math.cos(D2.rot) * 26); x.stroke(); }
        if (D2.splash > 0) { x.fillStyle = '#ffffffcc'; for (let k = 0; k < 9; k++) { x.beginPath(); x.arc(px + (k - 4) * 8, 270 - Math.sin((k / 8) * Math.PI) * 40 * D2.splash, 5, 0, Math.PI * 2); x.fill(); } }
        x.fillStyle = '#1d1834'; x.font = 'bold 12px sans-serif'; x.fillText(`Dive ${Math.min(dive + 1, 3)} of 3 · ${Math.round(total * 10) / 10} pts`, 10, 18);
        if (D2.ph === 'bounce') x.fillText(`Bounce ${Math.min(D2.b + 1, 3)}`, 10, 34);
        if (D2.ph === 'air') x.fillText(`Spins: ${D2.spins}`, 10, 34);
        if (D2.ph === 'entry' && D2.entry === null) x.fillText('Tap when the arrow points down!', 10, 34);
      });
    });
  }

  // =====================================================================
  // What there is to do in each place
  // =====================================================================
  const best = (k, f) => (S()[k] ? f(S()[k]) : '');
  const ACTS = {
    cafe: [
      { id: 'latte', name: 'Latte art', icon: 'foam', run: playLatte, sub: () => 'Draw in the foam. Guests tip for pretty cups.' },
      { id: 'table', name: 'The neighbors’ table', icon: 'table', run: playStories, sub: () => 'Listen to stories about their dogs' },
    ],
    mall: [
      { id: 'specials', name: 'Weekly specials', icon: 'tag', run: mallShop, sub: () => 'New every Monday' },
      { id: 'clothes', name: 'Clothes shop', icon: 'mirror', run: mallClothes, sub: () => 'Try things on in the mirror' },
      { id: 'showroom', name: 'Furniture showroom', icon: 'sofa', run: mallShowroom, sub: () => 'Whole rooms, 15% off' },
      { id: 'toys', name: 'Toy shop', icon: 'ball', run: mallToys, sub: () => 'Squeaky things!' },
      { id: 'booth', name: 'Photo booth', icon: 'photo', run: mallBooth, sub: () => 'A photo strip to hang up at home' },
      { id: 'food', name: 'Food court', icon: 'food', run: mallFood, sub: () => 'A bite with a neighbor' },
    ],
    library: [
      { id: 'quiz', name: 'Dog quiz', icon: 'quiz', run: playQuiz, sub: () => `Pass it to add encyclopedia pages (${pagesHave().length}/${PAGES.length})` },
      { id: 'book', name: 'Breed encyclopedia', icon: 'book', run: openBook, sub: () => `${pagesHave().length} of ${PAGES.length} pages` },
      { id: 'borrow', name: 'Borrow a book', icon: 'shelf', run: playBooks, sub: () => (bookLeft() ? `Reading now · ${bookLeft()} min left` : 'Free, one at a time') },
    ],
    arcade: [
      { id: 'claw', name: 'Claw machine', icon: 'claw', run: playClaw, sub: () => `${coin(5)} a go` },
      { id: 'mole', name: 'Boop-a-Mole', icon: 'mole', run: playMole, sub: () => `${coin(3)} · boop them on the nose` },
      { id: 'beat', name: 'Paw Beat', icon: 'beat', run: playBeat, sub: () => `${coin(3)} · a rhythm game` },
      { id: 'prizes', name: 'Prize counter', icon: 'prize', run: arcadePrizes, sub: () => `You have ${S().tickets || 0} tickets` },
    ],
    minigolf: [
      { id: 'golf', name: 'Play nine holes', icon: 'golf', run: playGolf, sub: () => best('golfBest', (b) => `Your best: ${b} strokes`) || 'Par 27' },
    ],
    flea: [
      { id: 'stalls', name: 'Browse the stalls', icon: 'stall', run: playFlea, sub: () => `${vintageLeft().length} vintage pieces still out there`, locked: () => (vintageLeft().length ? '' : 'You own every vintage piece! The sellers are amazed.') },
    ],
    workshop: [
      { id: 'pottery', name: 'Pottery', icon: 'wheel', run: playPottery, sub: () => `A food bowl of your own · ${coin(30)}` },
      { id: 'sewing', name: 'Sewing', icon: 'needle', run: playSewing, sub: () => 'Design a bandana for your dogs' },
      { id: 'wood', name: 'Woodwork', icon: 'saw', run: playWoodwork, sub: () => `A painted dog house · ${coin(50)}` },
    ],
    pool: [
      { id: 'swim', name: 'Swim race', icon: 'swim', run: playSwim, sub: () => '50 meters against the neighbors' },
      { id: 'dive', name: 'Diving board', icon: 'dive', run: playDive, sub: () => 'Three dives, three judges' },
    ],
  };

  return {
    VENUES, SPOTS, openMap, closeMap, show, hide, covers, venueOpen, vstars, addVP, renderVenue,
    get cur() { return cur; }, get mapSel() { return mapSel; }, tapPin, selectPin, openPack, go, stayReason, STAY, packPick: () => [...packPick],
    playLatte, playStories, playQuiz, openBook, playBooks, mallShop, mallClothes, mallShowroom, mallToys, mallBooth, mallFood,
    playClaw, playMole, playBeat, arcadePrizes, playPottery, playSewing, playWoodwork, playGolf, playFlea, playSwim, playDive, closeGame,
    HOLES, QUIZ, PAGES, BOOKS, fleaStock,
  };
};
