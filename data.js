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
    SAVE_VERSION: 8,
    AUTO_REFILL_MINUTES: 20,           // luxury feeder / fountain refill this long after being emptied
    OFFLEASH_COME_LEVEL: 2,            // Come must reach this level before a dog can go off-leash
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
    brainiac: { name: 'Brainiac',         icon: '🧠', desc: 'Loves new toys and learns fast, but gets bored of the same toy.',      mods: {}, flags: ['bored', 'quick'] },
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
    // Phase 3: bath & gifts
    bathtub:   { name: 'Bathtub',        icon: '🛁', price: 60, cat: 'dog', solid: true, use: 'bath', comfort: 2 },
    giftbox:   { name: 'Gift box',       icon: '🎁', price: 10, cat: 'decor', solid: true, use: 'gift' },
    // Garden (only in garden sections)
    flowerbed: { name: 'Flower bed',     icon: '🌷', price: 20, cat: 'garden', solid: true, garden: true, comfort: 2 },
    hedge:     { name: 'Hedge',          icon: '🌳', price: 18, cat: 'garden', solid: true, garden: true },
    birdbath:  { name: 'Bird bath',      icon: '🐦', price: 35, cat: 'garden', solid: true, garden: true, comfort: 3 },
    gardentree:{ name: 'Apple tree',     icon: '🍎', price: 45, cat: 'garden', solid: true, garden: true, comfort: 3 },
    gardenpond:{ name: 'Garden pond',    icon: '🪷', price: 70, cat: 'garden', solid: true, garden: true, comfort: 4 },
    digpit:    { name: 'Sand pit',       icon: '🏖️', price: 45, cat: 'garden', solid: false, garden: true, digSpot: true },
    // Luxury: expensive, only in the shop, never found
    jukebox:   { name: 'Jukebox',        icon: '🎶', price: 300, cat: 'luxury', solid: true, use: 'music', comfort: 6, luxury: true },
    autofeeder:{ name: 'Auto-feeder',    icon: '🤖', price: 450, cat: 'luxury', solid: false, role: 'food', auto: true, comfort: 3, luxury: true },
    fountain:  { name: 'Drinking fountain', icon: '⛲', price: 400, cat: 'luxury', solid: false, role: 'water', auto: true, comfort: 4, luxury: true },
    heatedbed: { name: 'Heated bed',     icon: '♨️', price: 350, cat: 'luxury', solid: false, role: 'bed', sleepY: 0.12, regen: 1.6, comfort: 8, luxury: true },
    // Rare: only found or gifted, never in the shop
    rainbowrug:{ name: 'Rainbow rug',    icon: '🌈', price: null, cat: 'rare', solid: false, comfort: 10, rare: true },
    crystallamp:{ name: 'Crystal lamp',  icon: '💎', price: null, cat: 'rare', solid: true, comfort: 8, rare: true },
    goldstatue:{ name: 'Golden dog statue', icon: '🏆', price: null, cat: 'rare', solid: true, comfort: 12, rare: true },
    cloudbed:  { name: 'Cloud bed',      icon: '☁️', price: null, cat: 'rare', solid: false, role: 'bed', sleepY: 0.14, regen: 2, comfort: 10, rare: true },
  };
  // What tapping a piece of furniture does
  const USES = { tv: 'tv', toybox: 'toybox', fireplace: 'fire', stove: 'cook', piano: 'piano', lamp: 'lamp', bathtub: 'bath', giftbox: 'gift', jukebox: 'music' };
  for (const [k, u] of Object.entries(USES)) ITEMS[k].use = u;
  const CATS = [['dog', '🐶 Dog stuff'], ['living', '🛋️ Living room'], ['kitchen', '🍳 Kitchen'], ['decor', '🪴 Decor'], ['garden', '🌷 Garden'], ['luxury', '💎 Luxury']];

  // ===================================================================
  // Comfort rating (1-5 paws). Synergies: two items within r tiles of each other.
  // 'role:bed' matches any bed.
  // ===================================================================
  const SYNERGIES = [
    { a: 'role:bed', b: 'fireplace', r: 2, pts: 6, name: 'Fireside nap' },
    { a: 'sofa', b: 'tv', r: 3, pts: 5, name: 'Movie night' },
    { a: 'armchair', b: 'lamp', r: 1.5, pts: 3, name: 'Reading nook' },
    { a: 'table', b: 'chair', r: 1.5, pts: 3, name: 'Dinner table' },
    { a: 'stove', b: 'fridge', r: 2, pts: 4, name: 'Kitchen corner' },
    { a: 'desk', b: 'chair', r: 1.5, pts: 3, name: 'Home office' },
    { a: 'piano', b: 'armchair', r: 2.5, pts: 4, name: 'Music room' },
    { a: 'aquarium', b: 'sofa', r: 2.5, pts: 3, name: 'Fish watching' },
    { a: 'bathtub', b: 'plant', r: 2, pts: 2, name: 'Spa vibes' },
    { a: 'toybox', b: 'cushion', r: 2, pts: 3, name: 'Play corner' },
    { a: 'role:bed', b: 'rug', r: 1.5, pts: 2, name: 'Soft landing' },
    { a: 'flowerbed', b: 'birdbath', r: 2.5, pts: 4, name: 'Bird garden' },
    { a: 'gardentree', b: 'kennel', r: 2, pts: 4, name: 'Shady doghouse' },
    { a: 'jukebox', b: 'rug', r: 2, pts: 3, name: 'Dance floor' },
    { a: 'heatedbed', b: 'fireplace', r: 2, pts: 8, name: 'Ultimate cozy' },
  ];
  const COMFORT_PAWS = [0, 12, 30, 55, 85];   // points needed for 1..5 paws
  const COMFORT_BONUS = 0.012;               // less happiness loss per paw above 1
  const CLUTTER_MAX = 5;                     // toys dogs drag out of the toy box
  const HOLES_MAX = 6;                       // holes diggers make in gardens

  // ===================================================================
  // Kinds of dirt. color = the dirt patches on the dog and in the bath.
  // ===================================================================
  const DIRT = {
    mud:      { name: 'Mud',              icon: '🟤', color: '#6b4a2b' },
    grass:    { name: 'Grass stains',     icon: '🌿', color: '#5e8c3a' },
    grime:    { name: 'Street grime',     icon: '🌫️', color: '#5d6168' },
    icecream: { name: 'Sticky ice cream', icon: '🍦', color: '#f3a9c0' },
    burrs:    { name: 'Burrs',            icon: '🌰', color: '#8d6b36' },
    sap:      { name: 'Pine sap',         icon: '🍯', color: '#d08a1e' },
    sand:     { name: 'Sand',             icon: '🏖️', color: '#e2c98a' },
    salt:     { name: 'Salt water',       icon: '🧂', color: '#cfe3ea' },
    seaweed:  { name: 'Seaweed',          icon: '🌊', color: '#3d7a4e' },
    snow:     { name: 'Snow clumps',      icon: '❄️', color: '#f2f7ff' },
    dust:     { name: 'Cave dust',        icon: '🪨', color: '#8a8278' },
    slime:    { name: 'Glowing slime',    icon: '🟢', color: '#76ff7a' },
    slush:    { name: 'Slush',            icon: '🌨️', color: '#b9c8d6' },
    frost:    { name: 'Frost',            icon: '🧊', color: '#d9f1ff' },
    cottoncandy:{ name: 'Cotton candy',   icon: '🍭', color: '#ff9fd6' },
    confetti: { name: 'Confetti',         icon: '🎊', color: '#ffd54f' },
    glitter:  { name: 'Glitter',          icon: '✨', color: '#e1bee7' },
    pollen:   { name: 'Fairy pollen',     icon: '🌼', color: '#fff176' },
    moondust: { name: 'Moon dust',        icon: '🌑', color: '#9e9ea6' },
  };

  // ===================================================================
  // Baths: one bottle per bath. eff = how well it cleans each kind of dirt (1 = perfectly),
  // other = any dirt not listed. vendor = only sold by that vendor on a walk (see VENDORS).
  // ===================================================================
  const SHAMPOOS = {
    gentle:   { name: 'Gentle shampoo',  icon: '🧴', price: 5,  eff: { mud: 0.7, grass: 0.7 }, other: 0.6 },
    mudbuster:{ name: 'Mud buster',      icon: '🟤', price: 8,  eff: { mud: 1, grass: 0.6 }, other: 0.5 },
    meadow:   { name: 'Meadow fresh',    icon: '🌿', price: 8,  eff: { grass: 1, mud: 0.6 }, other: 0.5 },
    lavender: { name: 'Lavender deluxe', icon: '💜', price: 20, eff: { mud: 0.92, grass: 0.92 }, other: 0.85, fancy: true },
    citrus:   { name: 'City citrus',     icon: '🍋', price: 10, eff: { grime: 1, icecream: 1, mud: 0.6 }, other: 0.5, vendor: 'boutique' },
    pine:     { name: 'Sap solver',      icon: '🌲', price: 10, eff: { sap: 1, burrs: 1, mud: 0.85 }, other: 0.5, vendor: 'ranger' },
    ocean:    { name: 'Ocean rinse',     icon: '🐚', price: 10, eff: { sand: 1, salt: 1, seaweed: 1 }, other: 0.5, vendor: 'kiosk' },
    alpine:   { name: 'Alpine herbs',    icon: '🌼', price: 10, eff: { burrs: 1, snow: 1, grass: 0.9 }, other: 0.5, vendor: 'hut' },
    cave:     { name: 'Cave clean',      icon: '⛏️', price: 12, eff: { dust: 1, slime: 1, mud: 0.8 }, other: 0.5, vendor: 'miner' },
    frostmelt:{ name: 'Frost melt',      icon: '♨️', price: 12, eff: { slush: 1, frost: 1, snow: 1 }, other: 0.5, vendor: 'igloo' },
    sugar:    { name: 'Sugar rinse',     icon: '🍬', price: 12, eff: { cottoncandy: 1, confetti: 1, icecream: 1 }, other: 0.5, vendor: 'prizes', tickets: 8 },
    pixie:    { name: 'Pixie wash',      icon: '🧚', price: 12, eff: { glitter: 1, pollen: 1, grass: 1 }, other: 0.6, vendor: 'fairyshop' },
    cosmic:   { name: 'Cosmic shampoo',  icon: '🌌', price: 15, eff: { moondust: 1, dust: 1, sand: 0.9 }, other: 0.6, vendor: 'station' },
  };
  const WATER_ONLY = 0.4;  // bath without shampoo

  // ===================================================================
  // Pantry & cooking. price null = only found (walks, digging, neighbors).
  // ===================================================================
  const INGREDIENTS = {
    carrot:  { name: 'Carrot',  icon: '🥕', price: 3,    weight: 4 },
    apple:   { name: 'Apple',   icon: '🍎', price: 3,    weight: 4 },
    egg:     { name: 'Egg',     icon: '🥚', price: 4,    weight: 3 },
    cheese:  { name: 'Cheese',  icon: '🧀', price: null, weight: 3 },
    berries: { name: 'Berries', icon: '🫐', price: null, weight: 4 },
    fish:    { name: 'Fish',    icon: '🐟', price: null, weight: 2 },
    honey:   { name: 'Honey',   icon: '🍯', price: null, weight: 2 },
    pumpkin: { name: 'Pumpkin', icon: '🎃', price: null, weight: 2 },
    pastry:  { name: 'Pastry',  icon: '🥐', price: null, weight: 0 },   // dropped in Old Town
    mushroom:{ name: 'Mushroom',icon: '🍄', price: null, weight: 0 },   // grows in the forest
  };
  // effect numbers are scaled by cooking quality (1-3 stars); hunger 100 means "fully fed"
  const RECIPES = {
    crunchies: { name: 'Carrot crunchies', icon: '🥕', needs: { carrot: 2 }, effect: { happy: 12 }, desc: 'A crunchy snack' },
    pupcakes:  { name: 'Apple pupcakes',   icon: '🧁', needs: { apple: 1, egg: 1 }, effect: { happy: 15, energy: 10 }, desc: 'Sweet and energizing' },
    gourmet:   { name: 'Gourmet kibble',   icon: '🥣', needs: { carrot: 1, apple: 1 }, effect: { bowls: true }, desc: 'Fills every food bowl with a tastier meal' },
    omelette:  { name: 'Cheesy omelette',  icon: '🍳', needs: { egg: 1, cheese: 1 }, effect: { hunger: 100, happy: 10 }, desc: 'A full, cheesy meal' },
    fishfeast: { name: 'Fish feast',       icon: '🐟', needs: { fish: 1, carrot: 1 }, effect: { hunger: 100, happy: 12, clean: 10 }, desc: 'Makes the coat shine' },
    berryblast:{ name: 'Berry blast',      icon: '🫐', needs: { berries: 1, honey: 1 }, effect: { energy: 35, happy: 8 }, desc: 'A burst of energy' },
    stew:      { name: 'Pumpkin stew',     icon: '🎃', needs: { pumpkin: 1, carrot: 1, egg: 1 }, effect: { hunger: 100, thirst: 30, happy: 20 }, desc: 'The coziest meal' },
    biscuits:  { name: 'Honey biscuits',   icon: '🍪', needs: { honey: 1, egg: 1 }, effect: { happy: 10, bond: 3 }, desc: 'Brings you closer' },
    shroompie: { name: 'Mushroom pie',     icon: '🥧', needs: { mushroom: 1, egg: 1 }, effect: { hunger: 100, energy: 15, happy: 12 }, desc: 'Hearty forest food' },
    berrypuff: { name: 'Berry puff',       icon: '🥮', needs: { pastry: 1, berries: 1 }, effect: { happy: 18, bond: 2 }, desc: 'Flaky and sweet' },
    // Treats bought from vendors on walks (no cooking). hunger below 100 adds that much.
    puppuccino:{ name: 'Puppuccino',       icon: '🥛', vendor: 'cafe',  price: 12, effect: { happy: 15, thirst: 30 }, desc: 'Foamy milk, no coffee' },
    pretzel:   { name: 'Mini pretzel',     icon: '🥨', vendor: 'cafe',  price: 10, effect: { hunger: 45, happy: 8 }, desc: 'A Berlin bakery classic' },
    trailmix:  { name: 'Trail mix',        icon: '🥜', vendor: 'ranger',price: 10, effect: { energy: 30, happy: 5 }, desc: 'Energy for long trails' },
    pupsicle:  { name: 'Dog ice cream',    icon: '🍦', vendor: 'kiosk', price: 12, effect: { happy: 20, thirst: 20, messy: 'icecream' }, desc: 'Cold, sweet, a bit sticky' },
    cheesebite:{ name: 'Alpine cheese bites', icon: '🧀', vendor: 'hut', price: 15, effect: { hunger: 35, happy: 15, bond: 2 }, desc: 'Straight from the cows up here' },
    rockbiscuit:{ name: 'Rock biscuits',   icon: '🍘', vendor: 'miner', price: 12, effect: { hunger: 40, energy: 15 }, desc: 'Crunchy miner snacks (not real rocks!)' },
    broth:     { name: 'Warm broth',       icon: '🍵', vendor: 'igloo', price: 12, effect: { thirst: 50, energy: 20, happy: 8 }, desc: 'Warms up cold paws' },
    cottoncandy:{ name: 'Dog cotton candy',icon: '🍭', vendor: 'prizes', price: 10, tickets: 6, effect: { happy: 22, messy: 'cottoncandy' }, desc: 'Fluffy, pink and very sticky' },
    stardrop:  { name: 'Star drops',       icon: '🌟', vendor: 'fairyshop', price: 15, effect: { energy: 40, happy: 12 }, desc: 'Tingly fairy sweets' },
    mooncheese:{ name: 'Moon cheese',      icon: '🧀', vendor: 'station', price: 18, effect: { hunger: 100, happy: 15 }, desc: 'Yes, the moon IS made of cheese' },
  };
  const COOK_QUALITY = [0.7, 1, 1.3];  // 1, 2, 3 stars

  // ===================================================================
  // Accessories. price = sold in the boutique; unlock = earned (see UNLOCKS).
  // slot: neck, head, face, body. One per slot.
  // ===================================================================
  const ACCESSORIES = {
    bandana_red:  { name: 'Red bandana',      icon: '🟥', slot: 'neck', price: 25, model: 'bandana', color: '#d64545' },
    bandana_blue: { name: 'Blue bandana',     icon: '🟦', slot: 'neck', price: 25, model: 'bandana', color: '#3d7fd6' },
    bowtie:       { name: 'Bow tie',          icon: '🎀', slot: 'neck', price: 30, model: 'bowtie', color: '#8a5cf6' },
    partyhat:     { name: 'Party hat',        icon: '🥳', slot: 'head', price: 35, model: 'partyhat', color: '#f06292' },
    beanie:       { name: 'Cozy beanie',      icon: '🧶', slot: 'head', price: 40, model: 'beanie', color: '#4db6ac' },
    flowercrown:  { name: 'Flower crown',     icon: '🌸', slot: 'head', price: 45, model: 'flowercrown' },
    sunglasses:   { name: 'Sunglasses',       icon: '🕶️', slot: 'face', price: 40, model: 'sunglasses', color: '#222222' },
    raincoat:     { name: 'Raincoat',         icon: '🧥', slot: 'body', price: 60, model: 'raincoat', color: '#ffd93b', rainproof: true },
    starcollar:   { name: 'Star collar',      icon: '⭐', slot: 'neck', unlock: 'obedience15', model: 'collar', color: '#ffd34d' },
    gradcap:      { name: 'Graduation cap',   icon: '🎓', slot: 'head', unlock: 'alltricks', model: 'gradcap' },
    explorer:     { name: 'Explorer bandana', icon: '🧭', slot: 'neck', unlock: 'walks50', model: 'bandana', color: '#5f8a5c' },
    goldcollar:   { name: 'Golden collar',    icon: '🌟', slot: 'neck', unlock: 'goldenball', model: 'collar', color: '#ffd34d', gold: true },
    scarf:        { name: 'Friendship scarf', icon: '🧣', slot: 'neck', unlock: 'friends3', model: 'scarf', color: '#ef6f8e' },
    secretshades: { name: 'Secret shades',    icon: '😎', slot: 'face', unlock: 'secret1', model: 'sunglasses', color: '#8a5cf6' },
    crown:        { name: 'Comfy crown',      icon: '👑', slot: 'head', unlock: 'comfort5', model: 'crown' },
    rainhat:      { name: 'Puddle hat',       icon: '☔', slot: 'head', unlock: 'rainwalks5', model: 'rainhat', color: '#ffd93b' },
    // Phase 4: sold by vendors on walks
    beret:        { name: 'Beret',            icon: '🎨', slot: 'head', price: 45, vendor: 'boutique', model: 'beret', color: '#c62828' },
    pearls:       { name: 'Pearl collar',     icon: '🦪', slot: 'neck', price: 70, vendor: 'boutique', model: 'pearls' },
    headlamp:     { name: 'Headlamp',         icon: '🔦', slot: 'head', price: 80, vendor: 'ranger', model: 'headlamp', color: '#2e7d32' },
    sunhat:       { name: 'Sun hat',          icon: '👒', slot: 'head', price: 40, vendor: 'kiosk', model: 'sunhat', color: '#f3d27a' },
    alpinehat:    { name: 'Alpine hat',       icon: '🎩', slot: 'head', price: 55, vendor: 'hut', model: 'alpinehat', color: '#3e6b3a' },
    // Phase 4: earned in new places, with challenges and by completing pages of the 📒 book
    safetyvest:   { name: 'Crossing vest',    icon: '🦺', slot: 'body', unlock: 'crosswalk10', model: 'vest', color: '#ff8f1f' },
    summitscarf:  { name: 'Summit scarf',     icon: '⛰️', slot: 'neck', unlock: 'summit3', model: 'scarf', color: '#c62828' },
    gogetter:     { name: 'Go-getter bandana',icon: '📋', slot: 'neck', unlock: 'daily10', model: 'bandana', color: '#ff9800' },
    herocape:     { name: 'Toy hero cape',    icon: '🦸', slot: 'body', unlock: 'page_toys', model: 'cape', color: '#e53935' },
    cloverwreath: { name: 'Clover wreath',    icon: '☘️', slot: 'head', unlock: 'page_park', model: 'wreath', color: '#43a047' },
    goldberet:    { name: 'Golden beret',     icon: '🖼️', slot: 'head', unlock: 'page_oldtown', model: 'beret', color: '#ffd34d', gold: true },
    antlers:      { name: 'Forest antlers',   icon: '🦌', slot: 'head', unlock: 'page_forest', model: 'antlers' },
    piratehat:    { name: 'Pirate hat',       icon: '🏴‍☠️', slot: 'head', unlock: 'page_beach', model: 'pirate' },
    cowbell:      { name: 'Cowbell collar',   icon: '🔔', slot: 'neck', unlock: 'page_alpine', model: 'bell', color: '#b5652f' },
    diamondcollar:{ name: 'Diamond collar',   icon: '💎', slot: 'neck', unlock: 'page_rare', model: 'collar', color: '#7fdcff' },
    wizardhat:    { name: 'Wizard hat',       icon: '🧙', slot: 'head', unlock: 'page_tricks', model: 'wizard', color: '#3f51b5' },
    // Phase 5: sold in the new places (prizes cost 🎟️ tickets) or found there
    minerhat:     { name: 'Miner helmet',     icon: '👷', slot: 'head', price: 70, vendor: 'miner', model: 'headlamp', color: '#fbc02d' },
    wintercoat:   { name: 'Winter coat',      icon: '🧥', slot: 'body', price: 75, vendor: 'igloo', model: 'coat', color: '#c62828' },
    santahat:     { name: 'Santa hat',        icon: '🎅', slot: 'head', price: 40, vendor: 'igloo', model: 'santa', color: '#d32f2f' },
    jesterhat:    { name: 'Jester hat',       icon: '🃏', slot: 'head', price: 30, tickets: 30, vendor: 'prizes', model: 'jester' },
    fairywings:   { name: 'Fairy wings',      icon: '🦋', slot: 'body', price: 90, vendor: 'fairyshop', model: 'wings', color: '#ce93d8' },
    spacesuit:    { name: 'Space suit',       icon: '👨‍🚀', slot: 'body', price: 120, vendor: 'station', model: 'spacesuit' },
    spacehelmet:  { name: 'Astronaut helmet', icon: '🌐', slot: 'head', find: 'moon', model: 'helmet' },
    tiara:        { name: 'Crystal tiara',    icon: '💎', slot: 'head', unlock: 'page_caves', model: 'tiara', color: '#b388ff' },
    earmuffs:     { name: 'Earmuffs',         icon: '🎧', slot: 'head', unlock: 'page_snowy', model: 'earmuffs', color: '#f48fb1' },
    balloonhat:   { name: 'Balloon hat',      icon: '🎈', slot: 'head', unlock: 'page_carnival', model: 'balloon', color: '#e53935' },
    halo:         { name: 'Fairy halo',       icon: '😇', slot: 'head', unlock: 'page_fairy', model: 'halo' },
    antenna:      { name: 'Alien antennae',   icon: '👽', slot: 'head', unlock: 'page_moon', model: 'antenna', color: '#76ff03' },
    rosette:      { name: 'Best in show',     icon: '🏵️', slot: 'neck', unlock: 'page_breeds', model: 'rosette', color: '#1e88e5' },
    sash:         { name: 'Champion sash',    icon: '🎗️', slot: 'body', unlock: 'page_records', model: 'sash', color: '#8e24aa' },
  };
  const UNLOCKS = {
    obedience15: 'A dog reaches 🎓 Obedience 15',
    alltricks:   'A dog learns all 15 regular tricks',
    walks50:     'Go on 50 walks',
    goldenball:  'Find the 🌟 Golden ball',
    friends3:    'Make 3 dog friendships',
    secret1:     'Discover a secret trick',
    comfort5:    'Reach 5-paw comfort at home',
    rainwalks5:  'Go on 5 walks in the rain',
    crosswalk10: 'Stay at 10 red lights in Old Town',
    summit3:     'Reach the alpine summit 3 times',
    daily10:     'Finish 10 daily challenges',
    page_toys:   'Complete the 🎾 Toys page of the 📒 book',
    page_park:   'Complete the 🌳 Park page of the 📒 book',
    page_oldtown:'Complete the 🏘️ Old Town page of the 📒 book',
    page_forest: 'Complete the 🌲 Forest page of the 📒 book',
    page_beach:  'Complete the 🏖️ Beach page of the 📒 book',
    page_alpine: 'Complete the 🏔️ Alpine page of the 📒 book',
    page_rare:   'Complete the 💎 Rare items page of the 📒 book',
    page_tricks: 'Complete the 🎓 Tricks page of the 📒 book',
    page_breeds: 'Complete the 🐶 Breeds page of the 📒 book',
    page_records:'Complete the 🏆 Records page of the 📒 book',
    page_caves:  'Complete the 💎 Caves page of the 📒 book',
    page_snowy:  'Complete the ⛄ Snowy Village page of the 📒 book',
    page_carnival:'Complete the 🎡 Carnival page of the 📒 book',
    page_fairy:  'Complete the 🧚 Fairy Realm page of the 📒 book',
    page_moon:   'Complete the 🚀 Moon page of the 📒 book',
  };
  const GARDEN_UNLOCK_SECTIONS = 2;  // gardens unlock once your home has this many sections

  // ===================================================================
  // Toys. price: null = only found on walks. weight = how often it's found.
  // loc = only found in these places. vendor = only sold there (not in the home shop).
  // secret = hidden in the 📒 book until you have it.
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
    stick:   { name: 'Stick',        icon: '🪵', price: null, dist: 1,    arc: 1.5, bounce: 0.05, spin: 'tumble', restY: 0.04, weight: 40, loc: ['park', 'forest'] },
    golden:  { name: 'Golden ball',  icon: '🌟', price: null, dist: 1.1,  arc: 1.7, bounce: 0.4,  spin: 'roll',   restY: 0.11, weight: 2, happy: 25, coins: 2, loc: ['park'], secret: true },
    beachball:{ name: 'Beach ball',  icon: '🏐', price: 35,   dist: 1.2,  arc: 2.1, bounce: 0.6,  spin: 'roll',   restY: 0.16, weight: 8, decay: 0.8, vendor: 'kiosk', loc: ['beach'] },
    pinecone:{ name: 'Pine cone',    icon: '🌲', price: null, dist: 0.95, arc: 1.5, bounce: 0.1,  spin: 'tumble', restY: 0.06, weight: 30, loc: ['forest', 'alpine'] },
    plushball:{ name: 'Plush ball',  icon: '🧶', price: 20,   tickets: 20, dist: 0.9, arc: 1.4, bounce: 0.2, spin: 'tumble', restY: 0.1, weight: 4, happy: 20, vendor: 'prizes' },
    ufo:     { name: 'UFO disc',     icon: '🛸', price: 70,   dist: 1.6,  arc: 1.1, bounce: 0,    spin: 'flat',   restY: 0.04, weight: 3, time: 1.2, happy: 22, vendor: 'station' },
    wand:    { name: 'Fairy wand',   icon: '🪄', price: 55,   dist: 1.1,  arc: 1.8, bounce: 0.1,  spin: 'tumble', restY: 0.05, weight: 3, happy: 22, vendor: 'fairyshop' },
    crystalball:{ name: 'Crystal ball', icon: '🔮', price: null, dist: 1,  arc: 1.6, bounce: 0.5,  spin: 'roll',   restY: 0.11, weight: 2, happy: 25, coins: 1, loc: ['caves'], secret: true },
    oldstick:{ name: 'Ancient stick',icon: '🥢', price: null, dist: 1.15, arc: 1.6, bounce: 0.05, spin: 'tumble', restY: 0.04, weight: 2, happy: 25, loc: ['forest'], secret: true },
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

  // ===================================================================
  // Tricks. Inputs: T = tap, H = hold & release, S = hold 3 seconds, u d l r = swipe, O = draw a circle.
  // needs = tricks the dog must know (level 1+) first. dur = seconds the trick takes.
  // ===================================================================
  const TRICKS = {
    sit:      { name: 'Sit',        icon: '🐕', seq: 'd',   dur: 1.4 },
    paw:      { name: 'Paw',        icon: '🐾', seq: 'T',   dur: 1.4 },
    come:     { name: 'Come',       icon: '📣', seq: 'TT',  dur: 1.2 },
    jump:     { name: 'Jump',       icon: '⬆️', seq: 'u',   dur: 1.1 },
    speak:    { name: 'Speak',      icon: '💬', seq: 'TTT', dur: 1.3 },
    spin:     { name: 'Spin',       icon: '🔄', seq: 'O',   dur: 1.3 },
    shake:    { name: 'Shake off',  icon: '💦', seq: 'lrl', dur: 1.4 },
    stay:     { name: 'Stay',       icon: '✋', seq: 'S',   dur: 1.6, needs: ['sit'] },
    down:     { name: 'Lie down',   icon: '⬇️', seq: 'dd',  dur: 1.6, needs: ['sit'] },
    beg:      { name: 'Sit pretty', icon: '🥺', seq: 'du',  dur: 1.7, needs: ['sit'] },
    highfive: { name: 'High five',  icon: '🙌', seq: 'Tu',  dur: 1.4, needs: ['paw'] },
    wave:     { name: 'Wave',       icon: '👋', seq: 'TH',  dur: 1.8, needs: ['highfive'] },
    bow:      { name: 'Bow',        icon: '🙇', seq: 'dH',  dur: 1.6, needs: ['down'] },
    roll:     { name: 'Roll over',  icon: '🌀', seq: 'rl',  dur: 1.8, needs: ['down'] },
    dead:     { name: 'Play dead',  icon: '😵', seq: 'uH',  dur: 2.4, needs: ['roll'] },
  };
  // Five secret tricks, lightly scrambled so they can't be read at a glance. No peeking!
  const SECRET_TRICKS = 'XX0iLnRhZWIgeWRhZXRzIGEgcGVlSyI6InRuaWgiLGV1cnQ6Im1odHlociIsfTI6ImthZXBzIns6InFlciIsNi4yOiJydWQiLCJUVFRUIjoicWVzIiwiNmJmZHVcYzM4ZHVcIjoibm9jaSIsImVjbmFEIjoiZW1hbiIsImVjbmFkIjoiZGkieyx9Ii50dW8gc2kgbm9vbSBlaHQgbmVodyB5bG5PIjoidG5paCIsZXVydDoidGhnaW4iLH0xOiJrYWVwcyJ7OiJxZXIiLDQuMjoicnVkIiwiSE8iOiJxZXMiLCI1MWZkdVxjMzhkdVwiOiJub2NpIiwibm9vbSBlaHQgdGEgbHdvSCI6ImVtYW4iLCJsd29oIjoiZGkieyx9IiF0aSBkbG9oIGRuYSAscHUgLHBVIjoidG5paCIsfTM6InBtdWoiezoicWVyIiwyLjI6InJ1ZCIsIkh1dSI6InFlcyIsIjgzZGR1XGUzOGR1XCI6Im5vY2kiLCJkbmF0c2RuYUgiOiJlbWFuIiwiZG5hdHNkbmFoIjoiZGkieyx9Ii5rY2FiIGVkaWxzIG5laHQgLi4ubGxpdHMgZGxvSCI6InRuaWgiLH0zOiJuaXBzIns6InFlciIsNC4yOiJydWQiLCJkSCI6InFlcyIsImE3ZGR1XGQzOGR1XCI6Im5vY2kiLCJrbGF3bm9vTSI6ImVtYW4iLCJrbGF3bm9vbSI6ImRpInssfSIuLi5uaWFnYSBuaXBzIGRuYSBuaXBzICxuaXBTIjoidG5paCIsfTI6Im5pcHMiezoicWVyIiwyLjI6InJ1ZCIsIk9PTyI6InFlcyIsIjAwZmR1XGMzOGR1XCI6Im5vY2kiLCJsaWF0IHJ1b3kgZXNhaEMiOiJlbWFuIiwiZXNhaGMiOiJkaSJ7Ww==';
  const TRICK_XP = [0, 2, 6, 12, 22, 36];             // total successes needed for level 1..5
  const TRICK_LEVELS = ['Untrained', 'Clumsy', 'Learning', 'Good', 'Great', 'Star'];
  const TRICK_SUCCESS = [0.35, 0.55, 0.7, 0.82, 0.9, 0.96];  // base success chance per level
  const TRICK_SNAP = [0.12, 0.06, 0, 0, 0, 0];             // chance to wander off after a failed try
  const TRICK_FOCUS = { start: 100, drain: 0.8, fail: 15, unknown: 12, success: 5 };

  // ===================================================================
  // Friendships between dogs. Pair scores for traits (primary counts fully, secondary half).
  // '*' matches any trait. Positive = they get along quickly; nothing ever blocks a friendship.
  // ===================================================================
  const COMPAT = {
    'zoomies|zoomies': 2, 'couch|zoomies': -1, 'couch|couch': 1, 'foodie|foodie': -1,
    'water|water': 1, 'pampered|water': -1, 'digger|digger': 1, 'digger|pampered': -1,
    'brainiac|brainiac': 1, 'shy|shy': 1, 'shy|zoomies': -1, 'social|*': 1, 'shy|*': -0.5,
  };
  const FRIEND_LEVEL = 50;  // friendship from 0 to 100; this much makes them friends

  // ===================================================================
  // Neighbors you meet on walks (3-5 random ones per walk). Later each save will get its own neighborhood.
  // ===================================================================
  const NEIGHBORS = [
    { owner: 'Lena',   shirt: '#e57373', hair: '#3b2a1e', dog: { name: 'Bruno',   breed: 'retriever', coat: 'chocolate', traits: ['foodie', 'social'], acc: { neck: 'bandana_red' } } },
    { owner: 'Jonas',  shirt: '#4db6ac', hair: '#d9a441', dog: { name: 'Kiki',    breed: 'corgi',     coat: 'redwhite',  traits: ['zoomies', 'brainiac'], acc: { head: 'partyhat' } } },
    { owner: 'Mia',    shirt: '#ba68c8', hair: '#1a1a1a', dog: { name: 'Fritz',   breed: 'dachshund', coat: 'red',       traits: ['digger', 'shy'] } },
    { owner: 'Paul',   shirt: '#ffb74d', hair: '#6d4c41', dog: { name: 'Nala',    breed: 'husky',     coat: 'grey',      traits: ['zoomies', 'water'], acc: { neck: 'bandana_blue' } } },
    { owner: 'Emma',   shirt: '#64b5f6', hair: '#c2783f', dog: { name: 'Coco',    breed: 'poodle',    coat: 'apricot',   traits: ['pampered', 'social'], acc: { neck: 'bowtie', head: 'flowercrown' } } },
    { owner: 'Felix',  shirt: '#81c784', hair: '#2b2b2b', dog: { name: 'Rocky',   breed: 'retriever', coat: 'black',     traits: ['couch', 'foodie'] } },
    { owner: 'Hannah', shirt: '#f06292', hair: '#8d5524', dog: { name: 'Lotte',   breed: 'dachshund', coat: 'dapple',    traits: ['brainiac', 'digger'] } },
    { owner: 'Leon',   shirt: '#9575cd', hair: '#e0c068', dog: { name: 'Balu',    breed: 'husky',     coat: 'black',     traits: ['social', 'zoomies'], acc: { face: 'sunglasses' } } },
    { owner: 'Sophie', shirt: '#4dd0e1', hair: '#5a3a22', dog: { name: 'Mimi',    breed: 'poodle',    coat: 'white',     traits: ['pampered', 'shy'], acc: { head: 'beanie' } } },
    { owner: 'Noah',   shirt: '#aed581', hair: '#1a1a1a', dog: { name: 'Pepe',    breed: 'corgi',     coat: 'tricolor',  traits: ['foodie', 'zoomies'] } },
    { owner: 'Clara',  shirt: '#ff8a65', hair: '#b5652f', dog: { name: 'Sammy',   breed: 'retriever', coat: 'golden',    traits: ['water', 'social'] } },
    { owner: 'Ben',    shirt: '#7986cb', hair: '#4a3728', dog: { name: 'Wolke',   breed: 'husky',     coat: 'red',       traits: ['brainiac', 'couch'] } },
    { owner: 'Lea',    shirt: '#f48fb1', hair: '#e8c37a', dog: { name: 'Krümel',  breed: 'dachshund', coat: 'blacktan',  traits: ['shy', 'foodie'] } },
    { owner: 'Tim',    shirt: '#90a4ae', hair: '#2b2b2b', dog: { name: 'Luna',    breed: 'poodle',    coat: 'black',     traits: ['zoomies', 'pampered'], acc: { face: 'sunglasses', neck: 'bowtie' } } },
    { owner: 'Marie',  shirt: '#ce93d8', hair: '#6d4c41', dog: { name: 'Toffee',  breed: 'corgi',     coat: 'sable',     traits: ['couch', 'social'], acc: { body: 'raincoat' } } },
    { owner: 'Elias',  shirt: '#80cbc4', hair: '#d9a441', dog: { name: 'Bello',   breed: 'retriever', coat: 'golden',    traits: ['digger', 'water'] } },
  ];
  // What neighbors sometimes give you. souvenir = a find from any place, even ones you haven't unlocked;
  // vendor = something a vendor in another place sells.
  const GIFTS = [
    { kind: 'coins', weight: 36, min: 5, max: 20 },
    { kind: 'ingredient', weight: 16 },
    { kind: 'toy', weight: 12 },
    { kind: 'item', weight: 14 },
    { kind: 'style', weight: 6 },
    { kind: 'meal', weight: 4 },
    { kind: 'souvenir', weight: 8 },
    { kind: 'vendor', weight: 5 },
    { kind: 'luxury', weight: 1 },
    { kind: 'rare', weight: 1 },
  ];
  const RARE_FIND = 0.006;  // chance a sniff spot or dig turns up a rare item
  const GIFT_CHANCE = 0.15;          // chance a neighbor has a gift when you first meet them on a walk
  const GIFT_FRIEND_BONUS = 0.2;     // extra chance if your dog is friends with their dog
  const RECALL = [0, 0.4, 0.7, 0.85, 0.93, 0.99];  // chance Come works off-leash, by Come level

  // ===================================================================
  // Places to walk. unlock = what opens the place (checked all the time).
  // dirt: dry / wet (rain) / snow = what your dog gets covered in; extra = special dirt from quirks.
  // loot = odds for a sniff spot: coins, a find for the 📒 book, an ingredient, a toy.
  // needs = how much faster needs drop here. walkers = neighbors met [min, max].
  // loop = the square path neighbors walk: x = half width, z0 / z1 = north / south side.
  // ===================================================================
  const LOCATIONS = {
    park: {
      name: 'Neighborhood Park', icon: '🌳', desc: 'Sniff spots, a fountain and a pond. Where it all began.',
      unlock: null, dirt: { dry: 'grass', wet: 'mud' }, walkers: [3, 5], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 62, find: 12, ingredient: 16, toy: 10 }, ingredients: ['berries', 'apple', 'honey', 'carrot'],
    },
    oldtown: {
      name: 'Old Town', icon: '🏘️', desc: 'Cobblestones, a café and a plaza. Wait for green at the crosswalks — and show off tricks on the plaza for coins.',
      unlock: { kind: 'obedience', n: 8 }, hint: 'A dog reaches 🎓 Obedience 8',
      dirt: { dry: 'grime', wet: 'grime', extra: 'icecream' }, walkers: [4, 6], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 55, find: 22, ingredient: 15, toy: 8 }, ingredients: ['pastry', 'egg', 'cheese', 'apple'],
      vendors: ['cafe', 'boutique'], plazaCap: 40,
    },
    forest: {
      name: 'Whispering Forest', icon: '🌲', desc: 'Winding trails, squirrels and three hidden glades off the beaten path.',
      unlock: { kind: 'locWalks', loc: 'oldtown', n: 3 }, hint: 'Go on 3 walks in Old Town',
      dirt: { dry: 'burrs', wet: 'mud', extra: 'sap' }, walkers: [1, 3], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 45, find: 25, ingredient: 20, toy: 10 }, ingredients: ['mushroom', 'berries', 'honey'],
      vendors: ['ranger'], needs: { energy: 1.15 },
    },
    beach: {
      name: 'Sunny Beach', icon: '🏖️', desc: 'Dig spots, waves and crabs. At low tide (real tide times) the sea pulls back and reveals tide pools.',
      unlock: { kind: 'glades', n: 3 }, hint: 'Find all 3 hidden glades in the Whispering Forest',
      dirt: { dry: 'sand', wet: 'sand', extra: 'seaweed', water: 'salt' }, walkers: [2, 4], loop: { x: 11, z0: -5, z1: 11 },
      loot: { coins: 50, find: 25, ingredient: 12, toy: 13 }, ingredients: ['fish', 'apple'],
      vendors: ['kiosk'], needs: { thirst: 1.3 },
    },
    alpine: {
      name: 'Alpine Meadow', icon: '🏔️', desc: 'Wind, wildflowers and cows with bells. Touch all four hiking checkpoints to reach the summit.',
      unlock: { kind: 'treasure', n: 1 }, hint: 'Dig up buried treasure on Sunny Beach',
      dirt: { dry: 'burrs', wet: 'mud', snow: 'snow' }, walkers: [1, 3], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 48, find: 25, ingredient: 17, toy: 10 }, ingredients: ['cheese', 'berries', 'honey'],
      vendors: ['hut'], needs: { energy: 1.25 },
    },
    // ----- Phase 5 -----
    caves: {
      name: 'Crystal Caves', icon: '💎', desc: 'Dark tunnels and bats. Ask a dog to 💬 Speak: the echo makes hidden crystals glow.',
      unlock: { kind: 'acc', id: 'headlamp' }, hint: 'Own a 🔦 Headlamp (Ranger hut, Whispering Forest)',
      dirt: { dry: 'dust', wet: 'dust', extra: 'slime' }, walkers: [0, 1], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 50, find: 25, ingredient: 8, toy: 8 }, ingredients: ['mushroom'],
      vendors: ['miner'], needs: { energy: 1.1 }, indoor: true,
    },
    snowy: {
      name: 'Snowy Village', icon: '⛄', desc: 'Always snowy. Go sledding, play snowball fetch and fuel the rocket at the observatory. Extra festive in December!',
      unlock: { kind: 'summits', n: 1 }, hint: 'Reach the summit on the Alpine Meadow',
      dirt: { dry: 'frost', wet: 'slush', snow: 'frost' }, walkers: [2, 4], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 52, find: 25, ingredient: 13, toy: 10 }, ingredients: ['pumpkin', 'honey', 'apple'],
      vendors: ['igloo'], needs: { energy: 1.15 }, snowy: true,
    },
    carnival: {
      name: 'Moonlight Carnival', icon: '🎡', desc: 'Only open in the evening. Do the trick a stall asks for to win 🎟️ tickets, trade them for prizes, ride the Ferris wheel.',
      unlock: { kind: 'loc', loc: 'oldtown' }, hint: 'Unlock Old Town first', hours: [18, 24],
      dirt: { dry: 'confetti', wet: 'mud', extra: 'cottoncandy' }, walkers: [4, 7], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 60, find: 25, ingredient: 5, toy: 10 }, ingredients: ['apple', 'honey'],
      vendors: ['prizes'], ticketCap: 40,
    },
    fairy: {
      name: 'Fairy Realm', icon: '🧚', desc: 'Talking animals, floating toys and four dog statues that guard a secret.',
      unlock: { kind: 'portal' }, hint: 'A hidden portal somewhere in the Whispering Forest…',
      dirt: { dry: 'glitter', wet: 'pollen', extra: 'pollen' }, walkers: [0, 2], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 45, find: 30, ingredient: 15, toy: 10 }, ingredients: ['berries', 'honey', 'mushroom'],
      vendors: ['fairyshop'], magic: true,
    },
    moon: {
      name: 'Moon Base', icon: '🚀', desc: 'Low gravity: toys fly high and far. Dig in craters — one hides a space capsule.',
      unlock: { kind: 'rocket', n: 3 }, hint: 'Fuel the rocket at the Snowy Village observatory with 3 🌕 moonstones from the caves',
      dirt: { dry: 'moondust', wet: 'moondust' }, walkers: [0, 1], loop: { x: 11, z0: -11, z1: 11 },
      loot: { coins: 50, find: 30, ingredient: 0, toy: 12 }, ingredients: [],
      vendors: ['station'], indoor: true, lowGravity: true,
    },
  };
  const FUTURE_LOCATIONS = [];

  // Vendors on walks. stock kinds: meal (RECIPES), shampoo, acc (ACCESSORIES), toy, ingredient.
  const VENDORS = {
    cafe:     { name: 'Café Pfote',     icon: '☕', loc: 'oldtown', greet: 'Fresh treats for good dogs!',
                stock: [['meal', 'puppuccino'], ['meal', 'pretzel'], ['ingredient', 'cheese', 6], ['ingredient', 'egg', 4]] },
    boutique: { name: 'Pet boutique',   icon: '🛍️', loc: 'oldtown', greet: 'The latest in dog fashion.',
                stock: [['shampoo', 'citrus'], ['acc', 'beret'], ['acc', 'pearls'], ['acc', 'bowtie'], ['shampoo', 'lavender']] },
    ranger:   { name: 'Ranger hut',     icon: '🛖', loc: 'forest',  greet: 'Gear for the trail.',
                stock: [['acc', 'headlamp'], ['acc', 'raincoat'], ['shampoo', 'pine'], ['meal', 'trailmix'], ['ingredient', 'honey', 6]] },
    kiosk:    { name: 'Beach kiosk',    icon: '🍦', loc: 'beach',   greet: 'Sun, sand and ice cream!',
                stock: [['toy', 'beachball'], ['toy', 'frisbee'], ['acc', 'sunhat'], ['acc', 'sunglasses'], ['shampoo', 'ocean'], ['meal', 'pupsicle']] },
    hut:      { name: 'Alpine hut',     icon: '🏠', loc: 'alpine',  greet: 'Grüß Gott! Cheese from our cows.',
                stock: [['meal', 'cheesebite'], ['ingredient', 'cheese', 5], ['acc', 'alpinehat'], ['shampoo', 'alpine'], ['ingredient', 'pumpkin', 6]] },
    miner:    { name: 'Old miner',      icon: '⛏️', loc: 'caves',   greet: 'Mind your step down here, little paws.',
                stock: [['acc', 'minerhat'], ['shampoo', 'cave'], ['meal', 'rockbiscuit'], ['ingredient', 'mushroom', 6]] },
    igloo:    { name: 'Igloo shop',     icon: '🧊', loc: 'snowy',   greet: 'Warm coats for cold noses!',
                stock: [['acc', 'wintercoat'], ['acc', 'santahat'], ['acc', 'beanie'], ['shampoo', 'frostmelt'], ['meal', 'broth']] },
    prizes:   { name: 'Prize booth',    icon: '🎪', loc: 'carnival', greet: 'Step right up! Prizes for tickets 🎟️', currency: 'tickets',
                stock: [['find', 'plushbear', 12], ['find', 'plushbunny', 12], ['find', 'plushdino', 20], ['find', 'plushunicorn', 30], ['acc', 'jesterhat'], ['toy', 'plushball'], ['meal', 'cottoncandy'], ['shampoo', 'sugar']] },
    fairyshop:{ name: 'Fairy vendor',   icon: '🍄', loc: 'fairy',   greet: 'Sparkles and wonders, dear dog-friend!',
                stock: [['acc', 'fairywings'], ['toy', 'wand'], ['shampoo', 'pixie'], ['meal', 'stardrop'], ['ingredient', 'berries', 5]] },
    station:  { name: 'Space station shop', icon: '🛰️', loc: 'moon', greet: 'Welcome, space cadet!',
                stock: [['acc', 'spacesuit'], ['toy', 'ufo'], ['shampoo', 'cosmic'], ['meal', 'mooncheese']] },
  };

  // Finds for the 📒 collectibles book. weight 0 = only from special places (treasure, tide pools).
  // when: night / day / rain / snow / sun. secret = hidden in the book until found.
  const FINDS = {
    acorn:     { name: 'Acorn',              icon: '🌰', loc: 'park', weight: 5 },
    feather:   { name: 'Blue feather',       icon: '🪶', loc: 'park', weight: 4 },
    sock:      { name: 'Lost sock',          icon: '🧦', loc: 'park', weight: 3 },
    leaf:      { name: 'Red maple leaf',     icon: '🍁', loc: 'park', weight: 3 },
    clover:    { name: 'Four-leaf clover',   icon: '🍀', loc: 'park', weight: 1, secret: true },
    glowworm:  { name: 'Glow worm',          icon: '🐛', loc: 'park', weight: 3, when: 'night', secret: true },

    postcard:  { name: 'Postcard',           icon: '💌', loc: 'oldtown', weight: 5 },
    keychain:  { name: 'City keychain',      icon: '🔑', loc: 'oldtown', weight: 4 },
    minitram:  { name: 'Toy tram',           icon: '🚋', loc: 'oldtown', weight: 3 },
    button:    { name: 'Shiny button',       icon: '🔘', loc: 'oldtown', weight: 4 },
    lanternpin:{ name: 'Lantern pin',        icon: '🏮', loc: 'oldtown', weight: 3, when: 'night', secret: true },
    umbrella:  { name: 'Tiny umbrella',      icon: '☂️', loc: 'oldtown', weight: 3, when: 'rain', secret: true },
    ticket:    { name: 'Golden tram ticket', icon: '🎫', loc: 'oldtown', weight: 1, secret: true },

    oakleaf:   { name: 'Oak leaf',           icon: '🍂', loc: 'forest', weight: 5 },
    pebble:    { name: 'Mossy pebble',       icon: '🪨', loc: 'forest', weight: 4 },
    bark:      { name: 'Birch bark',         icon: '📜', loc: 'forest', weight: 3 },
    owlfeather:{ name: 'Owl feather',        icon: '🦉', loc: 'forest', weight: 3, when: 'night', secret: true },
    snail:     { name: 'Snail shell',        icon: '🐌', loc: 'forest', weight: 3, when: 'rain', secret: true },
    fairystone:{ name: 'Fairy ring stone',   icon: '🧚', loc: 'forest', weight: 1, secret: true, glade: true },

    scallop:   { name: 'Scallop shell',      icon: '🐚', loc: 'beach', weight: 5 },
    seaglass:  { name: 'Sea glass',          icon: '🔷', loc: 'beach', weight: 4 },
    starfish:  { name: 'Starfish',           icon: '⭐', loc: 'beach', weight: 0, where: 'pool' },
    crabclaw:  { name: 'Crab shell',         icon: '🦀', loc: 'beach', weight: 0, where: 'pool' },
    piratecoin:{ name: 'Pirate coin',        icon: '🏴‍☠️', loc: 'beach', weight: 0, where: 'treasure' },
    pearl:     { name: 'Pearl',              icon: '🦪', loc: 'beach', weight: 1, secret: true },
    bottle:    { name: 'Message in a bottle',icon: '🍾', loc: 'beach', weight: 3, when: 'rain', secret: true },
    moonshell: { name: 'Moon shell',         icon: '🌙', loc: 'beach', weight: 3, when: 'night', secret: true },

    edelweiss: { name: 'Edelweiss',          icon: '🌼', loc: 'alpine', weight: 3 },
    gentian:   { name: 'Blue gentian',       icon: '💙', loc: 'alpine', weight: 4 },
    cowbellfind:{ name: 'Lost cowbell',      icon: '🔔', loc: 'alpine', weight: 2 },
    crystal:   { name: 'Mountain crystal',   icon: '💠', loc: 'alpine', weight: 1, secret: true },
    eagle:     { name: 'Eagle feather',      icon: '🦅', loc: 'alpine', weight: 2, when: 'sun', secret: true },
    starpebble:{ name: 'Shooting-star pebble', icon: '🌠', loc: 'alpine', weight: 3, when: 'night', secret: true },
    snowflake: { name: 'Perfect snowflake',  icon: '❄️', loc: 'alpine', weight: 4, when: 'snow', secret: true },

    amethyst:  { name: 'Amethyst',           icon: '🔮', loc: 'caves', weight: 5, where: 'crystal' },
    quartz:    { name: 'Rose quartz',        icon: '💗', loc: 'caves', weight: 4, where: 'crystal' },
    moonstone: { name: 'Moonstone',          icon: '🌕', loc: 'caves', weight: 3, where: 'crystal' },
    fossil:    { name: 'Dino fossil',        icon: '🦕', loc: 'caves', weight: 3 },
    pickaxe:   { name: 'Tiny pickaxe',       icon: '⛏️', loc: 'caves', weight: 3 },
    geode:     { name: 'Rainbow geode',      icon: '🌈', loc: 'caves', weight: 1, secret: true },

    snowcharm: { name: 'Snowflake charm',    icon: '❄️', loc: 'snowy', weight: 5 },
    mitten:    { name: 'Lost mitten',        icon: '🧤', loc: 'snowy', weight: 4 },
    sleighbell:{ name: 'Sleigh bell',        icon: '🛎️', loc: 'snowy', weight: 3 },
    icecrystal:{ name: 'Ice crystal',        icon: '🧊', loc: 'snowy', weight: 3 },
    snownose:  { name: "Snowman's nose",     icon: '🥕', loc: 'snowy', weight: 1, secret: true },
    candycane: { name: 'Candy cane',         icon: '🍬', loc: 'snowy', weight: 4, when: 'december', secret: true },

    stub:      { name: 'Ticket stub',        icon: '🎟️', loc: 'carnival', weight: 5 },
    balloon:   { name: 'Runaway balloon',    icon: '🎈', loc: 'carnival', weight: 4 },
    confettibit:{ name: 'Golden confetti',   icon: '🎊', loc: 'carnival', weight: 3 },
    plushbear: { name: 'Plush bear',         icon: '🧸', loc: 'carnival', weight: 0, where: 'prize' },
    plushbunny:{ name: 'Plush bunny',        icon: '🐰', loc: 'carnival', weight: 0, where: 'prize' },
    plushdino: { name: 'Plush dino',         icon: '🦖', loc: 'carnival', weight: 0, where: 'prize' },
    plushunicorn:{ name: 'Plush unicorn',    icon: '🦄', loc: 'carnival', weight: 0, where: 'prize' },
    magicball: { name: 'Fortune ball',       icon: '🎱', loc: 'carnival', weight: 1, secret: true },

    magicbone: { name: 'Magic bone',         icon: '🦴', loc: 'fairy', weight: 4 },
    fairydust: { name: 'Fairy dust',         icon: '💫', loc: 'fairy', weight: 5 },
    elfshoe:   { name: 'Elf shoe',           icon: '👞', loc: 'fairy', weight: 3 },
    moonflower:{ name: 'Moon flower',        icon: '🌺', loc: 'fairy', weight: 3, when: 'night', secret: true },
    chime:     { name: 'Fairy chime',        icon: '🎐', loc: 'fairy', weight: 0, where: 'puzzle', secret: true },

    moonrock:  { name: 'Moon rock',          icon: '🌑', loc: 'moon', weight: 5 },
    meteorite: { name: 'Meteorite',          icon: '☄️', loc: 'moon', weight: 3 },
    satellite: { name: 'Tiny satellite',     icon: '🛰️', loc: 'moon', weight: 2 },
    patch:     { name: 'Mission patch',      icon: '🎖️', loc: 'moon', weight: 0, where: 'treasure' },
    ufobolt:   { name: 'UFO bolt',           icon: '🛸', loc: 'moon', weight: 1, secret: true },
  };
  const FIND_DUPLICATE_COINS = 3;   // a find you already have is traded for this
  const TREASURE = { min: 30, max: 60, rareChance: 0.25 };
  const SUMMIT_COINS = 25;
  const PLAZA_COINS = [1, 2, 3, 4, 5, 6];  // coins per trick on the plaza, by trick level
  const CROSSWALK = { red: 9, green: 7, coins: 2 };  // seconds of red / green for people, coins for a good Stay
  // Phase 5 balance
  const ECHO = { radius: 9, glow: 60, cooldown: 6 };         // crystals revealed by a Speak echo stay lit this many seconds
  const CAPSULE = { min: 40, max: 80, rareChance: 0.3 };     // the space capsule hidden in a moon crater
  const HELMET_CHANCE = 0.12;                                 // a crater turns up the astronaut helmet (once)
  const LOW_GRAVITY = { arc: 2.6, time: 1.9, dist: 1.35 };    // fetch on the moon
  const PUZZLE = { min: 30, max: 50 };                        // fairy statue puzzle reward
  const SLED_COINS = 1;

  // ===================================================================
  // Daily challenges: 3 per day, reset at Berlin midnight, only from what you have unlocked.
  // n = [min, max] or a number. needs: loc:<place>, stove, bathtub, toybox, offleash, trick, loc (any unlocked place).
  // ===================================================================
  const CHALLENGES = [
    { id: 'walkat',   text: 'Go for a walk in {loc}',             ev: 'walk:{loc}', n: 1, reward: 15, needs: 'loc' },
    { id: 'walks',    text: 'Go on {n} walks',                    ev: 'walk', n: 2, reward: 15 },
    { id: 'sniff',    text: 'Let your dogs sniff {n} ✨ spots',    ev: 'sniff', n: [4, 8], reward: 20 },
    { id: 'fetch',    text: 'Play fetch {n} times',               ev: 'fetch', n: [5, 10], reward: 15 },
    { id: 'pet',      text: 'Pet your dogs {n} times',            ev: 'pet', n: [8, 15], reward: 10 },
    { id: 'tricks',   text: 'Do {n} tricks',                      ev: 'trick', n: [5, 10], reward: 20 },
    { id: 'trick',    text: 'Do {trick} {n} times',               ev: 'trick:{trick}', n: 3, reward: 20, needs: 'trick' },
    { id: 'find',     text: 'Find {n} things for your 📒 book',   ev: 'find', n: [2, 3], reward: 25 },
    { id: 'play',     text: 'Let your dogs play with others {n} times', ev: 'play', n: [2, 3], reward: 20 },
    { id: 'coins',    text: 'Earn 🪙 {n} on walks',                ev: 'walkcoins', n: [15, 30], reward: 15 },
    { id: 'cook',     text: 'Cook a meal at the stove',           ev: 'cook', n: 1, reward: 15, needs: 'stove' },
    { id: 'bath',     text: 'Give a dog a bath',                  ev: 'bath', n: 1, reward: 15, needs: 'bathtub' },
    { id: 'treat',    text: 'Give {n} treats',                    ev: 'treat', n: 2, reward: 15, needs: 'treats' },
    { id: 'tidy',     text: 'Tidy up toys or holes',              ev: 'tidy', n: 1, reward: 10, needs: 'toybox' },
    { id: 'recall',   text: 'Call your dog back off-leash {n} times', ev: 'recall', n: 2, reward: 20, needs: 'offleash' },
    { id: 'crosswalk',text: 'Stay at {n} red lights in Old Town',  ev: 'crosswalk', n: 2, reward: 20, needs: 'loc:oldtown' },
    { id: 'plaza',    text: 'Perform {n} tricks on the Old Town plaza', ev: 'plaza', n: 3, reward: 25, needs: 'loc:oldtown' },
    { id: 'squirrel', text: 'Spot {n} squirrels in the forest',   ev: 'squirrel', n: 3, reward: 20, needs: 'loc:forest' },
    { id: 'glade',    text: 'Visit a hidden glade in the forest', ev: 'glade', n: 1, reward: 20, needs: 'loc:forest' },
    { id: 'beachdig', text: 'Dig at {n} sandy spots on the beach', ev: 'beachdig', n: 3, reward: 20, needs: 'loc:beach' },
    { id: 'crab',     text: 'Say hi to {n} crabs',                ev: 'crab', n: 2, reward: 15, needs: 'loc:beach' },
    { id: 'summit',   text: 'Reach the alpine summit',            ev: 'summit', n: 1, reward: 30, needs: 'loc:alpine' },
    { id: 'cow',      text: 'Visit {n} cows on the meadow',       ev: 'cow', n: 3, reward: 15, needs: 'loc:alpine' },
    { id: 'echo',     text: 'Make {n} echoes in the Crystal Caves', ev: 'echo', n: 2, reward: 20, needs: 'loc:caves' },
    { id: 'crystal',  text: 'Collect {n} glowing crystals',       ev: 'crystal', n: 2, reward: 25, needs: 'loc:caves' },
    { id: 'sled',     text: 'Go sledding {n} times',              ev: 'sled', n: [2, 3], reward: 20, needs: 'loc:snowy' },
    { id: 'snowball', text: 'Play snowball fetch {n} times',      ev: 'fetch:snowy', n: 4, reward: 15, needs: 'loc:snowy' },
    { id: 'tickets',  text: 'Win {n} 🎟️ tickets at the carnival',  ev: 'tickets', n: [8, 15], reward: 25, needs: 'loc:carnival' },
    { id: 'ferris',   text: 'Ride the Ferris wheel',              ev: 'ferris', n: 1, reward: 15, needs: 'loc:carnival' },
    { id: 'statue',   text: 'Solve the fairy statue puzzle',      ev: 'statue', n: 1, reward: 30, needs: 'loc:fairy' },
    { id: 'floattoy', text: 'Catch {n} floating toys',            ev: 'floattoy', n: 3, reward: 20, needs: 'loc:fairy' },
    { id: 'moonfetch',text: 'Play fetch on the moon {n} times',   ev: 'fetch:moon', n: 4, reward: 20, needs: 'loc:moon' },
    { id: 'crater',   text: 'Dig in {n} moon craters',            ev: 'crater', n: 3, reward: 20, needs: 'loc:moon' },
  ];
  const CHALLENGE_BONUS = { coins: 30, rareChance: 0.15 };  // for finishing all three in a day

  // ===================================================================
  // Records page of the 📒 book. stat = a number the game keeps track of.
  // ===================================================================
  const RECORDS = [
    { id: 'walk10',   name: 'Little explorer', icon: '🥾', text: 'Go on 10 walks', stat: 'walks', n: 10 },
    { id: 'walk100',  name: 'Trailblazer',     icon: '🏅', text: 'Go on 100 walks', stat: 'walks', n: 100 },
    { id: 'longwalk', name: 'Long walk',       icon: '📏', text: 'Walk 500 m in one go', stat: 'longestWalk', n: 500 },
    { id: 'rich',     name: 'Piggy bank',      icon: '🐷', text: 'Earn 🪙 50 on one walk', stat: 'bestWalkCoins', n: 50 },
    { id: 'friends',  name: 'Popular pup',     icon: '💕', text: 'Make 5 dog friendships', stat: 'friendships', n: 5 },
    { id: 'comfort',  name: 'Dream home',      icon: '🏡', text: 'Reach 5-paw comfort', stat: 'comfort', n: 5 },
    { id: 'daily',    name: 'Go-getter',       icon: '📋', text: 'Finish 10 daily challenges', stat: 'challengesDone', n: 10 },
    { id: 'treasure', name: 'Treasure hunter', icon: '🗝️', text: 'Dig up 3 treasures', stat: 'treasures', n: 3 },
    { id: 'summit',   name: 'Summiteer',       icon: '⛰️', text: 'Reach the alpine summit', stat: 'summits', n: 1 },
    { id: 'pack',     name: 'Full pack',       icon: '🐕', text: 'Have 4 dogs', stat: 'dogs', n: 4 },
    { id: 'night',    name: 'Night owl',       icon: '🌙', text: 'Go for a walk at night', stat: 'nightWalks', n: 1, secret: true },
    { id: 'storm',    name: 'Storm chaser',    icon: '⛈️', text: 'Go for a walk in a storm', stat: 'stormWalks', n: 1, secret: true },
    { id: 'globe',    name: 'Globetrotter',    icon: '🗺️', text: 'Walk in all 10 places', stat: 'placesVisited', n: 10 },
    { id: 'echoes',   name: 'Echo master',     icon: '🔊', text: 'Make 10 echoes in the caves', stat: 'echoes', n: 10 },
    { id: 'tickets',  name: 'Ticket tycoon',   icon: '🎟️', text: 'Win 100 carnival tickets', stat: 'ticketsWon', n: 100 },
    { id: 'puzzles',  name: 'Statue whisperer',icon: '🗿', text: 'Solve the fairy puzzle 3 times', stat: 'puzzles', n: 3 },
    { id: 'sleds',    name: 'Snow speedster',  icon: '🛷', text: 'Go sledding 10 times', stat: 'sleds', n: 10 },
  ];

  // ===================================================================
  // Phase 6: one little event every day (German time). Picked from the ones that fit
  // your progress. kind decides what the game does; the rest is flavor.
  // ===================================================================
  const EVENTS = [
    { id: 'bakery',   kind: 'gift',  icon: '🥐', title: 'Bakery surprise',   text: 'The bakery left a bag of honey biscuits at your door.', gift: ['meal', 'biscuits', 2] },
    { id: 'samples',  kind: 'gift',  icon: '🧴', title: 'Free samples',      text: 'Two bottles of shampoo arrived in the mail. Bath time?', gift: ['shampoo', 'meadow', 2] },
    { id: 'package',  kind: 'gift',  icon: '📦', title: 'Mystery package',   text: 'A package with your name on it is waiting by the door.', gift: ['mystery'] },
    { id: 'veggies',  kind: 'gift',  icon: '🥕', title: 'Garden basket',     text: 'A neighbor dropped off a basket from their garden.', gift: ['ingredients', 3] },
    { id: 'sale',     kind: 'sale',  icon: '🏷️', title: 'Shop sale',         text: 'Everything in one shop section is 25% off today.', off: 0.25 },
    { id: 'market',   kind: 'market',icon: '🧺', title: 'Market day',        text: 'Vendors on walks sell everything 25% cheaper today.', off: 0.25, needs: 'oldtown' },
    { id: 'birthday', kind: 'birthday', icon: '🎂', title: 'Birthday in the park', text: 'A neighbor is celebrating in the park. Drop by for cake and a gift!', coins: 20 },
    { id: 'dogshow',  kind: 'show',  icon: '🏅', title: 'Dog show',          text: 'Every trick your dog shows on a walk earns 🪙 4 today (up to 5 times).', coins: 4, max: 5 },
    { id: 'rainbow',  kind: 'finds', icon: '🌈', title: 'Lucky rainbow',     text: 'Sniff spots turn up collectibles twice as often today.', mult: 2 },
    { id: 'kites',    kind: 'toys',  icon: '🪁', title: 'Kite festival',     text: 'Lost toys are everywhere on walks today.', mult: 3 },
    { id: 'meteors',  kind: 'meteors', icon: '☄️', title: 'Meteor shower',   text: 'Tonight, rare treasures are much easier to find on walks.', mult: 4 },
    { id: 'golden',   kind: 'golden', icon: '✨', title: 'Golden sniff',     text: 'On each walk one sniff spot shines gold. It hides 🪙 25.', coins: 25 },
    { id: 'lostdog',  kind: 'lostdog', icon: '🐕', title: 'A lost dog',      text: 'A neighbor\'s dog ran off. Find it on a walk in {loc} and bring it home!', coins: 30 },
    { id: 'tickets',  kind: 'tickets', icon: '🎟️', title: 'Double ticket night', text: 'Carnival booths pay double tickets tonight.', needs: 'carnival' },
    { id: 'zoomies',  kind: 'joy',   icon: '🌀', title: 'Sunny spirits',     text: 'Dogs get happy twice as fast on walks today.', mult: 2 },
    { id: 'spa',      kind: 'spa',   icon: '🛁', title: 'Spa day',           text: 'Every bath gets your dog perfectly clean today, whatever the shampoo.' },
    { id: 'treasure', kind: 'treasure', icon: '🏴‍☠️', title: 'Treasure tide', text: 'Buried treasure on the beach holds twice the coins today.', needs: 'beach' },
    { id: 'picnic',   kind: 'picnic', icon: '🧺', title: 'Picnic day',       text: 'Neighbors share snacks: your dogs\' first walk today fills their bellies.' },
  ];

  return {
    CONFIG, NEEDS, STATS, TRAITS, BREEDS, LEGACY_COATS, ITEMS, CATS, TOYS, WALLS, FLOORS, DEFAULT_ROOM, WEATHER, WEATHER_ODDS, DAYLIGHT, DOG_NAMES,
    TRICKS, SECRET_TRICKS, TRICK_XP, TRICK_LEVELS, TRICK_SUCCESS, TRICK_SNAP, TRICK_FOCUS, COMPAT, FRIEND_LEVEL, NEIGHBORS, GIFTS, GIFT_CHANCE, GIFT_FRIEND_BONUS, RECALL,
    SYNERGIES, COMFORT_PAWS, COMFORT_BONUS, CLUTTER_MAX, HOLES_MAX, SHAMPOOS, WATER_ONLY, INGREDIENTS, RECIPES, COOK_QUALITY,
    ACCESSORIES, UNLOCKS, GARDEN_UNLOCK_SECTIONS, RARE_FIND,
    DIRT, LOCATIONS, FUTURE_LOCATIONS, VENDORS, FINDS, FIND_DUPLICATE_COINS, TREASURE, SUMMIT_COINS, PLAZA_COINS, CROSSWALK,
    CHALLENGES, CHALLENGE_BONUS, RECORDS,
    ECHO, CAPSULE, HELMET_CHANCE, LOW_GRAVITY, PUZZLE, SLED_COINS,
    EVENTS,
  };
})();
