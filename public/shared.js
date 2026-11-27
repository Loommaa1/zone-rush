// Code partagé entre le serveur (Node.js) et le client (navigateur).
// Tout ce qui doit être identique des deux côtés vit ici : constantes, armes, carte, collisions.

export let MAP_HALF = 150;            // la carte va de -150 à +150 (en mètres) ; 24 dans l'arène 1v1
export const MAX_PLAYERS = 50;
export const PLAYER_RADIUS = 0.38;      // personnages plus fins…
export const PLAYER_HEIGHT = 1.6;       // …et plus petits (1,6 m)
export const EYE_HEIGHT = 1.35;
export const WALK_SPEED = 6;
export const SPRINT_SPEED = 9.5;

// Constructions (détails plus bas)
export const GRID = 5;      // une case de construction fait 5 m de côté
export const WALL_H = 4;    // et 4 m de haut
export const WALL_T = 0.3;
export const WALL_HP = 150;
export const BUILD_COST = 10;

export const WEAPONS = {
  pistol:  { name: 'Pistolet',       damage: 22, rate: 3,   mag: 12, spread: 0.012, range: 120, pellets: 1, auto: false, reload: 1.2, color: 0x9aa4b1, aimSpread: 0.3, aimFov: 50 },
  rifle:   { name: "Fusil d'assaut", damage: 17, rate: 8,   mag: 30, spread: 0.03,  range: 150, pellets: 1, auto: true,  reload: 2.0, color: 0x4caf50, aimSpread: 0.25, aimFov: 45 },
  shotgun: { name: 'Fusil à pompe',  damage: 11, rate: 1.1, mag: 5,  spread: 0.09,  range: 35,  pellets: 8, auto: false, reload: 2.4, color: 0xff8a3d, aimSpread: 0.6, aimFov: 55 },
  sniper:  { name: 'Sniper',         damage: 95, rate: 0.7, mag: 4,  spread: 0.04,  range: 300, pellets: 1, auto: false, reload: 2.8, color: 0x42a5f5, aimSpread: 0.05, aimFov: 18, scope: true },
};
// aimSpread : dispersion en visée (0.3 = 30 % de la normale) · aimFov : zoom de la caméra en visée (plus petit = plus zoomé)
// Plus un type apparaît dans cette liste, plus il est fréquent au sol
export const WEAPON_POOL = ['pistol', 'rifle', 'rifle', 'rifle', 'shotgun', 'shotgun', 'shotgun', 'sniper'];

export const PICKUP_INFO = {
  weapon: { label: 'Arme' },
  item:   { label: 'Soin' },
  ammo:   { label: 'Munitions', color: 0xffd54f },
  mats:   { label: 'Matériaux', color: 0xa1887f },
};

// Objets de soin rangés dans l'inventaire. time = durée d'utilisation (s), max = nombre qu'on peut porter
export const ITEMS = {
  mini:   { name: 'Mini-potion',      desc: '+25 bouclier (jusqu’à 50)', time: 1, max: 6, color: 0x4fc3f7, icon: '🧪' },
  big:    { name: 'Grosse potion',    desc: '+50 bouclier',              time: 3, max: 3, color: 0x1e64e5, icon: '⚗️' },
  medkit: { name: 'Trousse de soins', desc: 'Vie remise à 100',          time: 6, max: 3, color: 0xff5252, icon: '➕' },
};
export const ITEM_ORDER = ['mini', 'big', 'medkit'];
// L'objet est-il utile maintenant ? (on ne boit pas une potion avec le bouclier plein)
export function itemUseful(item, hp, shield) {
  if (item === 'mini') return shield < 50;
  if (item === 'big') return shield < 100;
  return hp < 100;
}
// Effet de l'objet : renvoie { hp, shield } après utilisation
export function applyItem(item, hp, shield) {
  if (item === 'mini') return { hp, shield: Math.max(shield, Math.min(50, shield + 25)) };
  if (item === 'big') return { hp, shield: Math.min(100, shield + 50) };
  return { hp: 100, shield };
}

// Générateur pseudo-aléatoire avec graine : même graine = même carte chez tout le monde
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Bâtiments ----------
// Un bâtiment = des murs (boîtes 'bwall') avec des portes et des fenêtres, plus un toit ('roof').
// y0 = hauteur du bas de la boîte (0 par défaut) : sert pour les fenêtres et le toit.
export const BUILDING_H = 3.6;
const BW_T = 0.4;          // épaisseur des murs
const DOOR_W = 1.8, DOOR_H = 2.5;
const WIN_W = 2, WIN_LOW = 1.1, WIN_HIGH = 2.3;

// Ajoute un côté de bâtiment (de a à b le long d'un axe) découpé en morceaux de mur / porte / fenêtre
function addSide(obs, bi, axis, fixed, a, b, openings) {
  // openings : liste triée de { at, kind } (centre de l'ouverture le long du côté)
  let cur = a;
  const seg = (from, to, y0, h) => {
    if (to - from < 0.05) return;
    const mid = (from + to) / 2, len = to - from;
    obs.push(axis === 'x'
      ? { type: 'bwall', b: bi, x: mid, z: fixed, w: len, d: BW_T, h, y0 }
      : { type: 'bwall', b: bi, x: fixed, z: mid, w: BW_T, d: len, h, y0 });
  };
  for (const o of openings) {
    const half = (o.kind === 'door' ? DOOR_W : WIN_W) / 2;
    seg(cur, o.at - half, 0, BUILDING_H);
    if (o.kind === 'door') seg(o.at - half, o.at + half, DOOR_H, BUILDING_H);
    else { seg(o.at - half, o.at + half, 0, WIN_LOW); seg(o.at - half, o.at + half, WIN_HIGH, BUILDING_H); }
    cur = o.at + half;
  }
  seg(cur, b, 0, BUILDING_H);
}

function addBuilding(obs, buildings, rnd, x, z, w, d, kind) {
  const bi = buildings.length;
  const hw = w / 2, hd = d / 2;
  buildings.push({ x, z, w, d, kind, color: Math.floor(rnd() * 5) });
  const doorSide = Math.floor(rnd() * 4);
  const sides = [
    ['x', z - hd, x - hw, x + hw], // nord
    ['x', z + hd, x - hw, x + hw], // sud
    ['z', x - hw, z - hd + BW_T / 2, z + hd - BW_T / 2], // ouest
    ['z', x + hw, z - hd + BW_T / 2, z + hd - BW_T / 2], // est
  ];
  sides.forEach(([axis, fixed, a, b], i) => {
    const len = b - a, openings = [];
    const hasDoor = i === doorSide || (kind === 'warehouse' && i === (doorSide ^ 1));
    if (hasDoor) openings.push({ at: a + len * (0.3 + rnd() * 0.4), kind: 'door' });
    // fenêtres sur les côtés assez longs, sans chevaucher la porte
    const nWin = Math.floor(len / 6);
    for (let k = 0; k < nWin; k++) {
      const at = a + (len * (k + 1)) / (nWin + 1);
      if (openings.every((o) => Math.abs(o.at - at) > 2.6) && rnd() < 0.7) openings.push({ at, kind: 'window' });
    }
    openings.sort((p, q) => p.at - q.at);
    addSide(obs, bi, axis, fixed, a, b, openings);
  });
  obs.push({ type: 'roof', b: bi, x, z, w: w + 0.6, d: d + 0.6, h: BUILDING_H + 0.35, y0: BUILDING_H });
  // Quelques caisses à l'intérieur pour se cacher
  if (kind === 'warehouse') {
    for (let k = 0; k < 3; k++) obs.push({ type: 'crate', x: x + (rnd() - 0.5) * (w - 6), z: z + (rnd() - 0.5) * (d - 6), w: 2, d: 2, h: 2 });
  }
}

// ---------- Arène 1v1 : petite carte fermée par de hauts murs ----------
export const ARENA_HALF = 24;
export const ARENA_SPAWNS = [[0, 18], [0, -18], [18, 0], [-18, 0]];
function generateArena() {
  const H = ARENA_HALF, obs = [];
  const wall = (x, z, w, d) => obs.push({ type: 'arenaWall', x, z, w, d, h: 14 });
  wall(0, -H - 0.5, 2 * H + 2, 1); wall(0, H + 0.5, 2 * H + 2, 1);
  wall(-H - 0.5, 0, 1, 2 * H + 2); wall(H + 0.5, 0, 1, 2 * H + 2);
  // Couverts symétriques (même chose des deux côtés, pour un duel équitable)
  for (const s of [-1, 1]) {
    obs.push({ type: 'crate', x: 7 * s, z: 8 * s, w: 2, d: 2, h: 2 });
    obs.push({ type: 'crate', x: -7 * s, z: 8 * s, w: 2, d: 2, h: 2 });
    obs.push({ type: 'rock', x: 13 * s, z: 0, w: 4, d: 2.5, h: 1.6 });
    obs.push({ type: 'crate', x: 0, z: 11 * s, w: 4, d: 1, h: 1.2 });
  }
  obs.push({ type: 'rock', x: 0, z: 0, w: 3, d: 3, h: 2.4 }); // bloc central
  obs.buildings = [];
  return obs;
}

// Carte en cours : 'island' (grande île, mode libre / battle royale) ou 'arena' (1v1).
// MAP_HALF est lu en direct par les autres fichiers : changer de carte met tout à jour.
export let MAP = 'island';
export function setMap(name) {
  MAP = name === 'arena' ? 'arena' : 'island';
  MAP_HALF = MAP === 'arena' ? ARENA_HALF : 150;
}

// Décor : bâtiments, rochers, caisses et arbres. Chaque élément est une boîte (x, z = centre ; w, d, h = taille)
// Le tableau renvoyé a aussi une propriété .buildings (liste des bâtiments, utile pour l'affichage et le butin)
export function generateObstacles(seed) {
  if (MAP === 'arena') return generateArena();
  const rnd = mulberry32(seed);
  const obs = [];
  const buildings = [];
  const nearBuilding = (x, z, m) => buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);
  for (let tries = 0; tries < 300 && buildings.length < 16; tries++) {
    const warehouse = buildings.length < 3;
    const w = warehouse ? 18 + Math.floor(rnd() * 3) * 2 : 8 + Math.floor(rnd() * 4) * 2;
    const d = warehouse ? 12 + Math.floor(rnd() * 2) * 2 : 8 + Math.floor(rnd() * 3) * 2;
    const x = (rnd() * 2 - 1) * (MAP_HALF - 20), z = (rnd() * 2 - 1) * (MAP_HALF - 20);
    if (buildings.some((b) => Math.abs(x - b.x) < (b.w + w) / 2 + 8 && Math.abs(z - b.z) < (b.d + d) / 2 + 8)) continue;
    addBuilding(obs, buildings, rnd, x, z, w, d, warehouse ? 'warehouse' : 'house');
  }
  for (let i = 0; i < 170; i++) {
    const x = (rnd() * 2 - 1) * (MAP_HALF - 8);
    const z = (rnd() * 2 - 1) * (MAP_HALF - 8);
    if (nearBuilding(x, z, 4)) { rnd(); rnd(); rnd(); continue; }
    const r = rnd();
    if (r < 0.35) {
      const s = 3 + rnd() * 5;
      obs.push({ type: 'rock', x, z, w: s, d: s * (0.6 + rnd() * 0.6), h: 1.5 + rnd() * 3 });
    } else if (r < 0.65) {
      obs.push({ type: 'crate', x, z, w: 2, d: 2, h: 2 });
    } else {
      obs.push({ type: 'tree', x, z, w: 1, d: 1, h: 8 });
    }
  }
  obs.buildings = buildings;
  return obs;
}

// =====================================================================
// Constructions : 4 pièces posées sur une grille de 4 m × 3 m de haut
//  - wall   : mur vertical (modifiable en porte ou fenêtre)
//  - floor  : sol / plafond horizontal
//  - stairs : escalier (pente qui monte de 3 m sur une case)
//  - cone   : toit en pointe (petite pyramide)
// Chaque pièce a une hauteur de base y (0, 3, 6, ...).
// =====================================================================
export const BUILD_PIECES = ['wall', 'floor', 'stairs', 'cone'];
export const PIECE_NAMES = { wall: 'Mur', floor: 'Sol', stairs: 'Escalier', cone: 'Cône' };
export const CONE_H = 2;
export const MAX_BUILD_LEVEL = 12;      // 12 étages maximum
export const GRAVITY = 22;
export const JUMP_SPEED = 8;
export const STEP = 0.6;                // hauteur qu'on franchit sans sauter

// ---------- Modification par carrés ----------
// Chaque pièce est découpée en carrés : 3×3 pour un mur, 2×2 pour sol, escalier et cône.
// b.cut est un nombre dont chaque bit dit si le carré correspondant a été retiré (1 = trou).
// Mur : carré n° (ligne × 3 + colonne), ligne 0 = en bas, colonne 0 = côté x local négatif.
// Autres : carré n° (u ≥ 0.5 ? 2 : 0) + (v ≥ 0.5 ? 1 : 0), avec u et v de 0 à 1 dans le repère local.
export const tileCount = (kind) => (kind === 'wall' ? 9 : 4);
export const isCut = (b, i) => ((b.cut || 0) >> i) & 1;
export const STAIRS_ROT = { nz: 0, pz: Math.PI, px: -Math.PI / 2, nx: Math.PI / 2 }; // l'escalier monte vers -z avant rotation

// Coordonnées locales (u, v entre 0 et 1) d'un point du monde dans la case d'une pièce horizontale
export function localUV(b, x, z) {
  const th = b.kind === 'stairs' ? STAIRS_ROT[b.dir] ?? 0 : 0;
  const dx = x - b.x, dz = z - b.z, c = Math.cos(th), s = Math.sin(th);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return [(GRID / 2 - lz) / GRID, (lx + GRID / 2) / GRID];
}
export const quadIndex = (u, v) => (u >= 0.5 ? 2 : 0) + (v >= 0.5 ? 1 : 0);

// Boîtes de collision d'une pièce (une par carré restant). Escalier et cône : [] (ce sont des pentes)
export function buildBoxes(b) {
  const out = [];
  if (b.kind === 'wall') {
    const tw = GRID / 3;
    for (let i = 0; i < 9; i++) {
      if (isCut(b, i)) continue;
      const r = Math.floor(i / 3), c = i % 3, off = -GRID / 2 + tw * (c + 0.5);
      const th = WALL_H / 3; // hauteur d'une rangée de carrés
      const y0 = b.y + r * th, h = b.y + (r + 1) * th;
      out.push(b.axis === 'x'
        ? { x: b.x + off, z: b.z, w: tw, d: WALL_T, y0, h }
        : { x: b.x, z: b.z - off, w: WALL_T, d: tw, y0, h });
    }
  } else if (b.kind === 'floor') {
    for (let i = 0; i < 4; i++) {
      if (isCut(b, i)) continue;
      const q = GRID / 4; // centre du carré (u = 0.25 / 0.75)
      const lz = i >= 2 ? -q : q, lx = i % 2 ? q : -q;
      out.push({ x: b.x + lx, z: b.z + lz, w: GRID / 2, d: GRID / 2, y0: b.y - 0.2, h: b.y });
    }
  }
  return out;
}
export const isSlope = (b) => b.kind === 'stairs' || b.kind === 'cone';

// ---------- Forme du cône ----------
// Le cône est découpé en 4 quarts ; chaque quart a un coin extérieur. Pour un cône d'origine, la pointe
// est au centre et les 4 coins sont en bas. Quand on le modifie, les carrés choisis deviennent des
// coins relevés : 1 carré = un coin relevé, 2 côte à côte = une pente, 2 en diagonale = une arête,
// 3 = un coin creux. (Pour un cône, b.cut = coins relevés, pas des trous.)
// Signes (sx, sz) du coin du carré n° i, dans le repère local
export const quadSigns = (i) => [i % 2 ? 1 : -1, i >= 2 ? -1 : 1];
export function coneHeights(b) {
  const H = CONE_H;
  if (!b.cut) return { center: H, corner: [0, 0, 0, 0] }; // forme d'origine : pointe au centre
  const corner = [0, 1, 2, 3].map((i) => (isCut(b, i) ? H : 0));
  return { center: (corner[0] + corner[1] + corner[2] + corner[3]) / 4, corner };
}
// Hauteur du milieu de l'arête entre deux coins voisins
function coneEdge(hts, i, j) { return hts.cut ? (hts.corner[i] + hts.corner[j]) / 2 : 0; }
// Hauteur (au-dessus de la base) en un point local (lx, lz) du cône
export function coneLocalHeight(b, lx, lz) {
  const h = GRID / 2, hts = coneHeights(b);
  hts.cut = !!b.cut;
  const sx = lx >= 0 ? 1 : -1, sz = lz >= 0 ? 1 : -1;
  const iK = (sz < 0 ? 2 : 0) + (sx > 0 ? 1 : 0);        // coin de ce quart
  const iX = (sz < 0 ? 2 : 0) + (sx > 0 ? 0 : 1);        // coin voisin dans l'autre sens de x
  const iZ = (sz < 0 ? 0 : 2) + (sx > 0 ? 1 : 0);        // coin voisin dans l'autre sens de z
  const hC = hts.center, hK = hts.corner[iK];
  const hE1 = coneEdge(hts, iK, iZ);                     // milieu de l'arête x = ±h
  const hE2 = coneEdge(hts, iK, iX);                     // milieu de l'arête z = ±h
  const a = Math.min(1, Math.abs(lx) / h), c = Math.min(1, Math.abs(lz) / h);
  return a >= c ? hC + a * (hE1 - hC) + c * (hK - hE1) : hC + c * (hE2 - hC) + a * (hK - hE2);
}

// Hauteur de la surface d'un escalier / cône au point (x, z), ou -Infinity si on est à côté
export function slopeHeight(b, x, z) {
  const h = GRID / 2;
  if (Math.abs(x - b.x) > h || Math.abs(z - b.z) > h) return -Infinity;
  if (b.kind === 'cone') return b.y + coneLocalHeight(b, x - b.x, z - b.z);
  const [u] = localUV(b, x, z);
  return b.y + WALL_H * Math.max(0, Math.min(1, u)); // u : 0 = bas de l'escalier, 1 = haut
}
// Direction d'escalier (px, nx, pz, nz) à partir d'un déplacement dans le monde
export function dirFromVector(dx, dz) {
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'px' : 'nx') : (dz > 0 ? 'pz' : 'nz');
}
// Un découpage est-il valide ? (au moins un carré doit rester)
export function validCut(kind, cut) {
  const n = tileCount(kind);
  return Number.isInteger(cut) && cut >= 0 && cut < (1 << n) - 1;
}

// Direction "devant" pour un angle yaw (même convention que la caméra Three.js : yaw 0 = vers -z)
export const forwardOf = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];

// Étage correspondant à une hauteur de pieds
export const buildLevel = (y) => Math.max(0, Math.min(MAX_BUILD_LEVEL, Math.round(y / WALL_H))) * WALL_H;

// Où poser une pièce quand on est en (px, py, pz) et qu'on regarde (yaw, pitch)
export function buildSlot(kind, px, py, pz, yaw, pitch = 0) {
  const [dx, dz] = forwardOf(yaw);
  const y = buildLevel(py);
  if (kind === 'wall') {
    const fx = px + dx * GRID * 0.65, fz = pz + dz * GRID * 0.65;
    if (Math.abs(dx) > Math.abs(dz)) return { kind, axis: 'z', x: Math.round(fx / GRID) * GRID, z: Math.floor(fz / GRID) * GRID + GRID / 2, y };
    return { kind, axis: 'x', x: Math.floor(fx / GRID) * GRID + GRID / 2, z: Math.round(fz / GRID) * GRID, y };
  }
  // Case devant soi (ou sous ses pieds si on regarde vers le bas)
  const ahead = kind !== 'stairs' && pitch < -0.6 ? 0 : GRID * 0.65;
  const cx = Math.floor((px + dx * ahead) / GRID) * GRID + GRID / 2;
  const cz = Math.floor((pz + dz * ahead) / GRID) * GRID + GRID / 2;
  const up = kind !== 'stairs' && pitch > 0.35 ? WALL_H : 0; // regarder en l'air : sol/cône à l'étage du dessus
  const s = { kind, x: cx, z: cz, y: Math.min(MAX_BUILD_LEVEL * WALL_H, y + up) };
  if (kind === 'stairs') s.dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'px' : 'nx') : (dz > 0 ? 'pz' : 'nz');
  return s;
}
// Identifiant d'emplacement : un seul mur par bord, un seul sol par case, un seul escalier OU cône par case
export function buildKey(s) {
  if (s.kind === 'wall') return `w:${s.axis}:${s.x}:${s.z}:${s.y}`;
  return `${s.kind === 'floor' ? 'f' : 'r'}:${s.x}:${s.z}:${s.y}`;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Une boîte gêne-t-elle un joueur dont les pieds sont à la hauteur y ?
const blocksAt = (b, y) => b.h > y + STEP && (b.y0 || 0) < y + PLAYER_HEIGHT - 0.1;

// Empêche un joueur (un cercle) d'entrer dans les boîtes. Renvoie la position corrigée.
export function resolveCollisions(x, z, boxes, y = 0) {
  const R = PLAYER_RADIUS;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (!blocksAt(b, y)) continue; // toit, haut de fenêtre, marche basse… : pas un obstacle
      const hx = b.w / 2, hz = b.d / 2;
      if (Math.abs(x - b.x) > hx + R || Math.abs(z - b.z) > hz + R) continue;
      const cx = clamp(x, b.x - hx, b.x + hx), cz = clamp(z, b.z - hz, b.z + hz);
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * R; z = cz + (dz / d) * R;
      } else {
        const px = hx - Math.abs(x - b.x), pz = hz - Math.abs(z - b.z);
        if (px < pz) x = b.x + Math.sign(x - b.x || 1) * (hx + R);
        else z = b.z + Math.sign(z - b.z || 1) * (hz + R);
      }
    }
  }
  const lim = MAP_HALF - R;
  return [clamp(x, -lim, lim), clamp(z, -lim, lim)];
}

// Un escalier ou un cône gêne-t-il le joueur à cette position ? (on cogne son côté au lieu de monter dessus)
// On teste le centre et 4 points autour du joueur. Sous la pente (assez de place pour la tête) on passe.
function slopeBlocks(slopes, x, z, y) {
  const r = PLAYER_RADIUS * 0.9;
  const pts = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
  for (const s of slopes) {
    for (const [ox, oz] of pts) {
      const h = slopeHeight(s, x + ox, z + oz);
      if (h > y + STEP && h - 0.35 < y + PLAYER_HEIGHT) return true;
    }
  }
  return false;
}

// Déplace le joueur de (dx, dz) par petits pas : il ne peut ni traverser un mur fin en allant vite,
// ni passer à travers le côté d'un escalier ou d'un cône. Il glisse le long des obstacles.
export function moveWithCollisions(x, z, dx, dz, y, boxes, slopes = []) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
  const sx = dx / n, sz = dz / n;
  for (let i = 0; i < n; i++) {
    let [nx, nz] = resolveCollisions(x + sx, z + sz, boxes, y);
    if (slopes.length && slopeBlocks(slopes, nx, nz, y)) {
      const [ax, az] = resolveCollisions(x + sx, z, boxes, y); // on essaie de glisser sur un seul axe
      const [bx, bz] = resolveCollisions(x, z + sz, boxes, y);
      if (sx && !slopeBlocks(slopes, ax, az, y)) [nx, nz] = [ax, az];
      else if (sz && !slopeBlocks(slopes, bx, bz, y)) [nx, nz] = [bx, bz];
      else [nx, nz] = [x, z];
    }
    x = nx; z = nz;
    // On "monte" virtuellement sur la pente pendant les petits pas, pour bien gravir un escalier même en sprint
    for (const s of slopes) {
      const h = slopeHeight(s, x, z);
      if (h > y && h <= y + STEP) y = h;
    }
  }
  return [x, z];
}

// Hauteur du sol sous les pieds : terrain, dessus des boîtes, escaliers et cônes atteignables
export function groundAt(x, z, y, boxes, slopes) {
  let g = 0;
  const m = PLAYER_RADIUS * 0.6;
  for (const b of boxes) {
    if (b.h > g && b.h <= y + STEP && Math.abs(x - b.x) <= b.w / 2 + m && Math.abs(z - b.z) <= b.d / 2 + m) g = b.h;
  }
  for (const s of slopes) {
    const h = slopeHeight(s, x, z);
    if (h > g && h <= y + STEP) g = h;
  }
  return g;
}

// Plafond au-dessus de la tête (pour arrêter un saut), ou Infinity
export function ceilingAt(x, z, y, boxes) {
  let c = Infinity;
  const m = PLAYER_RADIUS * 0.6;
  for (const b of boxes) {
    const by0 = b.y0 || 0;
    if (by0 >= y + PLAYER_HEIGHT * 0.6 && by0 < c && Math.abs(x - b.x) <= b.w / 2 + m && Math.abs(z - b.z) <= b.d / 2 + m) c = by0;
  }
  return c;
}

// Rayon / pente (escalier, cône) : on avance par petits pas dans la case. Renvoie la distance ou -1.
export function raySlope(o, d, s, maxT) {
  const h = GRID / 2, top = s.y + (s.kind === 'cone' ? CONE_H : WALL_H);
  const t0 = rayBox(o, d, s.x - h, s.y, s.z - h, s.x + h, top, s.z + h);
  if (t0 < 0 || t0 > maxT) return -1;
  for (let t = t0; t < t0 + 8 && t < maxT; t += 0.15) {
    const sh = slopeHeight(s, o.x + d.x * t, o.z + d.z * t);
    const y = o.y + d.y * t;
    if (sh !== -Infinity && y <= sh && y >= sh - 0.5) return t;
  }
  return -1;
}

// Intersection rayon / boîte 3D (méthode des "slabs"). Renvoie la distance ou -1.
export function rayBox(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const axes = [[o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ]];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < mn || oo > mx) return -1;
    } else {
      let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
