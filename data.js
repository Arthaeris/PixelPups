'use strict';
/* Voxel Paws — game content & balance.
   This is the file to edit when you want to tune prices, timers, drop rates or add content. */
window.VP_DATA = (function () {
  // ===================================================================
  // General settings
  // ===================================================================
  const CONFIG = {
    SAVE_KEY: 'voxelpaws-save-v1',     // keep this name so old saves are found
    BACKUP_KEY: 'voxelpaws-backup',
    SAVE_VERSION: 3,
    TIME_ZONE: 'Europe/Berlin',        // all clocks, weather and daily resets use German time

    CHUNK: 6,                          // one home section is CHUNK x CHUNK tiles
    BUILD_MINUTES: 10,                 // construction time for a new section
    MAX_CHUNKS: 16,
    EXPAND_BASE: 80,                   // price of the first extra section
    EXPAND_GROWTH: 1.6,                // each further section costs this much more
    ADOPT_BASE: 50,                    // adoption price = ADOPT_BASE x dogs you already have

    LOW: 25,                           // a need below this shows a yellow badge
    CRITICAL: 10,                      // ... and below this a red one

    PUPPY_DAYS: 3,                     // real days for a puppy to grow up
    PUPPY_START_SCALE: 0.55,           // puppy size compared to an adult
    BOND_REVEAL: 20,                   // interactions until the secondary trait is revealed

    FAV_TOY_PLAYS: 5,                  // plays with one toy before it becomes the favorite
    FAV_MISS_DAYS: 3,                  // unused this long -> the dog misses it
    FAV_MISS_THROWS: 30,               // ... or this many throws of other toys
    FAV_SWITCH_DAYS: 7,                // still unused this long -> a new favorite can take over
    FAV_SWITCH_THROWS: 70,
    MISS_CAP: 90,                      // happiness cap while missing the favorite toy (never drains)

    TOWEL_MAX: 80,                     // a towel-off can clean up to this much (baths do the rest)
    TOWEL_AMOUNT: 40,
  };

  // Need changes per second. Home is gentle, walks are hungrier, thirstier and dirtier.
  const NEEDS = {
    home: { hunger: 0.1, thirst: 0.13, energy: 0.05, sleepRegen: 4, loungeRegen: 1.2, clean: 0.0015, happyDecay: 0.07, needyDecay: 0.25 },
    park: { hunger: 0.18, thirst: 0.32, energy: 0.22, clean: 0.07, happyGain: 0.15 },
    rainDirt: 2.5,                     // walks in rain get this much dirtier (and muddy)
    offlinePerHour: { hunger: 15, thirst: 18, energy: -25, happy: 8, clean: 2 },
  };

  const STATS = [
    { k: 'hunger', ic: '🍖', name: 'Food' },
    { k: 'thirst', ic: '💧', name: 'Water' },
    { k: 'energy', ic: '⚡', name: 'Energy' },
    { k: 'happy', ic: '❤️', name: 'Happiness' },
    { k: 'clean', ic: '🧼', name: 'Cleanliness' },
  ];

  // ===================================================================
  // Personality traits. A primary trait counts fully, the secondary at half strength.
  // mods multiply a value (1 = no change). flags switch on a behaviour.
  // ===================================================================
  const TRAITS = {
    zoomies:  { name: 'Zoomies',          icon: '🌀', desc: 'Random sprint bursts and faster fetch, but runs out of energy sooner.', mods: { energy: 1.35, fetchSpeed: 1.25 }, flags: ['zooms'] },
    couch:    { name: 'Couch Potato',     icon: '🛋️', desc: 'Saves energy and naps on sofas, but tires quickly on walks.',          mods: { energy: 0.7, walkEnergy: 1.4 }, flags: ['lounges'] },
    foodie:   { name: 'Foodie',           icon: '🍖', desc: 'Meals make it extra happy and it sniffs out more treats, but gets hungry faster.', mods: { hunger: 1.35, mealJoy: 2.4, sniffCoins: 1.5 }, flags: [] },
    water:    { name: 'Water Lover',      icon: '💦', desc: 'Loves rain, ponds and puddles, and gets wet and muddy doing it.',      mods: { dirt: 1.2 }, flags: ['splashes', 'rainJoy'] },
    pampered: { name: 'Pampered',         icon: '🎀', desc: 'Extra happy when clean, but dirt really spoils its mood.',             mods: { dirtMood: 2, cleanJoy: 1.5 }, flags: [] },
    shy:      { name: 'Shy',              icon: '🫣', desc: 'Bonds deeply with you, but is scared of storms and a bit nervous outside.', mods: { petJoy: 1.6, walkJoy: 0.7 }, flags: ['stormFear'] },
    social:   { name: 'Social Butterfly', icon: '🦋', desc: 'Thrives with other dogs around, but gets lonely as an only dog.',       mods: {}, flags: ['lonely'] },
    brainiac: { name: 'Brainiac',         icon: '🧠', desc: 'Loves new toys and learns fast, but gets bored of the same toy.',      mods: {}, flags: ['bored'] },
    digger:   { name: 'Digger',           icon: '⛏️', desc: 'Digs up coins and treasures on walks, and gets dirty doing it.',       mods: { dirt: 1.6 }, flags: ['digs'] },
  };

  // ===================================================================
  // Breeds. shape = body proportions (adult). Coats marked legacy only exist for converted old saves.
  // ===================================================================
  const BREEDS = {
    retriever: {
      name: 'Retriever',
      shape: { scale: 1, torsoW: 0.46, torsoH: 0.32, torsoL: 0.72, legH: 0.26, legW: 0.12, headW: 0.36, headH: 0.32, headD: 0.34,
               muzW: 0.22, muzH: 0.15, muzD: 0.18, ears: 'floppy', earLen: 0.22, tail: 'straight', extras: [] },
      coats: [
        { id: 'golden', name: 'Golden', body: '#d9a441', dark: '#a8762a', light: '#f3d595' },
        { id: 'chocolate', name: 'Chocolate', body: '#7a4a2a', dark: '#4e2c16', light: '#b07a52' },
        { id: 'black', name: 'Black', body: '#2c2c31', dark: '#18181c', light: '#4a4a52' },
        { id: 'shadow', name: 'Shadow', body: '#34343a', dark: '#1d1d22', light: '#c27a3e', legacy: true },
        { id: 'snow', name: 'Snow', body: '#f2efe8', dark: '#d6ccbb', light: '#ffffff', legacy: true },
        { id: 'pebble', name: 'Pebble', body: '#8d939c', dark: '#5d626b', light: '#d3d6db', legacy: true },
        { id: 'ginger', name: 'Ginger', body: '#d2652d', dark: '#9c4519', light: '#f4c9a2', legacy: true },
      ],
    },
    corgi: {
      name: 'Corgi',
      shape: { scale: 0.95, torsoW: 0.44, torsoH: 0.3, torsoL: 0.7, legH: 0.13, legW: 0.12, headW: 0.36, headH: 0.32, headD: 0.32,
               muzW: 0.2, muzH: 0.14, muzD: 0.16, ears: 'upright', earLen: 0.2, earW: 0.13, tail: 'stub', extras: ['bib', 'fluffyRear', 'blaze'] },
      coats: [
        { id: 'redwhite', name: 'Red & white', body: '#d9873a', dark: '#b8692a', light: '#f6f1e7' },
        { id: 'tricolor', name: 'Tricolor', body: '#2b2b30', dark: '#1a1a1e', light: '#f6f1e7', accent: '#c8843f' },
        { id: 'sable', name: 'Sable', body: '#b58a52', dark: '#6e4f2d', light: '#f6f1e7' },
      ],
    },
    dachshund: {
      name: 'Dachshund',
      shape: { scale: 0.95, torsoW: 0.3, torsoH: 0.26, torsoL: 0.92, legH: 0.12, legW: 0.1, headW: 0.28, headH: 0.26, headD: 0.3,
               muzW: 0.16, muzH: 0.13, muzD: 0.24, ears: 'long', earLen: 0.28, tail: 'thin', extras: [] },
      coats: [
        { id: 'red', name: 'Red', body: '#a8552a', dark: '#7a3a1a', light: '#c9773f' },
        { id: 'blacktan', name: 'Black & tan', body: '#222226', dark: '#111114', light: '#b06b34', accent: '#b06b34' },
        { id: 'dapple', name: 'Dapple', body: '#8a7666', dark: '#4a3f37', light: '#c9b7a3', spots: '#3d3530' },
      ],
    },
    husky: {
      name: 'Husky',
      shape: { scale: 1.08, torsoW: 0.46, torsoH: 0.36, torsoL: 0.76, legH: 0.34, legW: 0.12, headW: 0.38, headH: 0.34, headD: 0.34,
               muzW: 0.2, muzH: 0.14, muzD: 0.18, ears: 'pointed', earLen: 0.16, earW: 0.11, tail: 'curl', eyes: '#5fb4ff', extras: ['mask', 'bib'] },
      coats: [
        { id: 'grey', name: 'Grey', body: '#8a929c', dark: '#5d646d', light: '#f2f2f2' },
        { id: 'black', name: 'Black', body: '#2c2c33', dark: '#1a1a1f', light: '#f2f2f2' },
        { id: 'red', name: 'Red', body: '#b5652f', dark: '#80451e', light: '#f6efe6' },
      ],
    },
    poodle: {
      name: 'Poodle',
      shape: { scale: 1, torsoW: 0.36, torsoH: 0.3, torsoL: 0.58, legH: 0.34, legW: 0.09, headW: 0.3, headH: 0.3, headD: 0.3,
               muzW: 0.16, muzH: 0.13, muzD: 0.2, ears: 'fluffy', earLen: 0.28, tail: 'pom', extras: ['topknot', 'mane', 'pompaws'] },
      coats: [
        { id: 'white', name: 'White', body: '#f4f1ea', dark: '#e2dccf', light: '#ffffff' },
        { id: 'apricot', name: 'Apricot', body: '#e8b27a', dark: '#cc915a', light: '#f4cfa3' },
        { id: 'black', name: 'Black', body: '#2a292d', dark: '#18171a', light: '#3e3c42' },
      ],
    },
  };
  // Old saves stored a number for the dog's color: these become Retriever coats
  const LEGACY_COATS = ['golden', 'chocolate', 'shadow', 'snow', 'pebble', 'ginger'];

  // ===================================================================
  // Furniture. role: 'bed' = dogs sleep there, 'food' / 'water' = bowls that can be filled.
  // lounge: Couch Potatoes like to lie next to it.
  // ===================================================================
  const ITEMS = {
    // Dog stuff
    bed:       { name: 'Dog bed',        icon: '🛏️', price: 35, cat: 'dog', solid: false, role: 'bed', sleepY: 0.1 },
    bowl:      { name: 'Food bowl',      icon: '🥣', price: 20, cat: 'dog', solid: false, role: 'food' },
    water:     { name: 'Water bowl',     icon: '💧', price: 20, cat: 'dog', solid: false, role: 'water' },
    cushion:   { name: 'Floor cushion',  icon: '🟪', price: 25, cat: 'dog', solid: false, role: 'bed', sleepY: 0.08 },
    kennel:    { name: 'Dog house',      icon: '🏠', price: 70, cat: 'dog', solid: true, lounge: true },
    toybox:    { name: 'Toy box',        icon: '🧸', price: 30, cat: 'dog', solid: true },
    hurdle:    { name: 'Agility hurdle', icon: '🚧', price: 40, cat: 'dog', solid: true },
    // Living room
    sofa:      { name: 'Sofa',           icon: '🛋️', price: 45, cat: 'living', solid: true, lounge: true },
    armchair:  { name: 'Armchair',       icon: '💺', price: 40, cat: 'living', solid: true, lounge: true },
    beanbag:   { name: 'Bean bag',       icon: '🟠', price: 30, cat: 'living', solid: true, lounge: true },
    tv:        { name: 'TV stand',       icon: '📺', price: 60, cat: 'living', solid: true, lounge: true },
    shelf:     { name: 'Bookshelf',      icon: '📚', price: 40, cat: 'living', solid: true },
    lamp:      { name: 'Floor lamp',     icon: '💡', price: 25, cat: 'living', solid: true },
    rug:       { name: 'Rug',            icon: '🧶', price: 15, cat: 'living', solid: false },
    fireplace: { name: 'Fireplace',      icon: '🔥', price: 90, cat: 'living', solid: true, lounge: true },
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

  // ===================================================================
  // Toys. price: null = only found on walks. weight = how often it's found.
  // ===================================================================
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

  // ===================================================================
  // Wallpapers and floors (per home section). price 0 = free from the start.
  // ===================================================================
  const WALLS = {
    cream:    { name: 'Cream',          price: 0,  pattern: 'plain',   c1: '#f3dfc1', trim: '#c99f72' },
    mint:     { name: 'Mint stripes',   price: 0,  pattern: 'stripes', c1: '#d8f0e3', c2: '#bfe3d0', trim: '#7fb59a' },
    rose:     { name: 'Rose dots',      price: 0,  pattern: 'dots',    c1: '#f8dfe4', c2: '#ec9fb1', trim: '#c97c8f' },
    sky:      { name: 'Sky blue',       price: 30, pattern: 'plain',   c1: '#cfe5f7', trim: '#86aed1' },
    lavender: { name: 'Lavender check', price: 40, pattern: 'check',   c1: '#e6dcf5', c2: '#d6c7ef', trim: '#9b86c2' },
    forest:   { name: 'Forest stripes', price: 45, pattern: 'stripes', c1: '#6f9a6b', c2: '#628c5e', trim: '#3c5a3a' },
    brick:    { name: 'Brick',          price: 60, pattern: 'brick',   c1: '#b8573f', c2: '#e8d7c3', trim: '#7d3a2a' },
    panel:    { name: 'Wood panels',    price: 60, pattern: 'planksV', c1: '#b98a5a', c2: '#a57a4d', trim: '#6e4b2c' },
  };
  const FLOORS = {
    oak:      { name: 'Oak checker',  price: 0,  pattern: 'check',  c1: '#d8b689', c2: '#cba579' },
    planks:   { name: 'Dark planks',  price: 0,  pattern: 'planks', c1: '#8a5f3c', c2: '#7a5233' },
    tiles:    { name: 'White tiles',  price: 0,  pattern: 'tiles',  c1: '#f1efe9', c2: '#d9d5cc' },
    bluetile: { name: 'Blue check',   price: 35, pattern: 'check',  c1: '#cfe2f3', c2: '#8fb5dc' },
    pink:     { name: 'Pink carpet',  price: 40, pattern: 'carpet', c1: '#f2b8c6', c2: '#eaa9b9' },
    teal:     { name: 'Teal carpet',  price: 40, pattern: 'carpet', c1: '#7cc4bd', c2: '#70b8b1' },
    stone:    { name: 'Stone',        price: 55, pattern: 'tiles',  c1: '#b4b0a8', c2: '#9a968e' },
    marble:   { name: 'Marble',       price: 90, pattern: 'marble', c1: '#f4f2ee', c2: '#d7d3cc' },
  };
  const DEFAULT_ROOM = { wall: 'cream', floor: 'oak' };

  // ===================================================================
  // Time of day and weather (Berlin time). Weather changes every 3 hours and is the same for everyone.
  // ===================================================================
  const WEATHER = {
    sun:    { name: 'Sunny',  icon: '☀️', light: 1 },
    clouds: { name: 'Cloudy', icon: '☁️', light: 0.82 },
    rain:   { name: 'Rainy',  icon: '🌧️', light: 0.68, precip: 'rain', amount: 420, muddy: true },
    storm:  { name: 'Stormy', icon: '⛈️', light: 0.52, precip: 'rain', amount: 650, muddy: true, lightning: true },
    fog:    { name: 'Foggy',  icon: '🌫️', light: 0.78, fog: true },
    snow:   { name: 'Snowy',  icon: '🌨️', light: 0.88, precip: 'snow', amount: 380 },
  };
  const WEATHER_ODDS = {
    winter: { clouds: 35, snow: 30, fog: 15, sun: 15, rain: 5 },
    spring: { sun: 30, clouds: 30, rain: 25, fog: 10, storm: 5 },
    summer: { sun: 50, clouds: 25, rain: 12, storm: 8, fog: 5 },
    autumn: { sun: 25, clouds: 30, rain: 25, fog: 15, storm: 5 },
  };
  // [hour, sky color, ambient light, sun light]
  const DAYLIGHT = [
    [0, '#1b2340', 0.38, 0.08], [5, '#2b3560', 0.42, 0.12], [6.5, '#f4b98a', 0.7, 0.4],
    [8, '#cfe6f2', 0.85, 0.55], [17, '#cfe6f2', 0.85, 0.55], [19, '#f6c27a', 0.76, 0.45],
    [20.5, '#6b5b95', 0.52, 0.2], [22, '#1b2340', 0.38, 0.08], [24, '#1b2340', 0.38, 0.08],
  ];

  const DOG_NAMES = ['Biscuit', 'Pixel', 'Mochi', 'Pepper', 'Waffles', 'Nugget', 'Luna', 'Bean', 'Ziggy', 'Noodle', 'Maple', 'Cosmo',
    'Pretzel', 'Juno', 'Toast', 'Sprout', 'Olive', 'Pickle', 'Clover', 'Dumpling', 'Peanut', 'Socks', 'Bubbles', 'Scout'];

  return { CONFIG, NEEDS, STATS, TRAITS, BREEDS, LEGACY_COATS, ITEMS, CATS, TOYS, WALLS, FLOORS, DEFAULT_ROOM, WEATHER, WEATHER_ODDS, DAYLIGHT, DOG_NAMES };
})();
