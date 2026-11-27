// Serveur de jeu Zone Rush
// - sert les fichiers du jeu (dossier public/)
// - fait autorité sur les règles : tirs, dégâts, zone, objets, constructions, victoire
// - fait jouer les bots
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import * as S from './public/shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/three', express.static(path.join(__dirname, 'node_modules/three')));
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } }); // la page d'accueil (port 3000) peut se connecter au mode 1v1 (port 3001)
// Mode de jeu (variable d'environnement MODE) :
//  - 'libre' (par défaut) : grande île, réapparition infinie à un endroit aléatoire, sans zone
//  - '1v1'               : petite arène fermée, 1 contre 1 (un bot si tu es seul), réapparition rapide
//  - 'br'                : battle royale classique (zone + dernier survivant)
const MODE = ['1v1', 'br'].includes(process.env.MODE) ? process.env.MODE : 'libre';
const ARENA = MODE === '1v1';
S.setMap(ARENA ? 'arena' : 'island');
const PORT = +(process.env.PORT || (ARENA ? 3001 : 3000));
// Ports des deux modes, pour que la page d'accueil puisse proposer les deux
const MODE_PORTS = { libre: +(process.env.PORT_LIBRE || 3000), '1v1': +(process.env.PORT_1V1 || 3001) };
app.get('/mode', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const humans = [...players.values()].filter((p) => !p.isBot).length;
  res.json({ mode: MODE, ports: MODE_PORTS, humans, maxHumans: MAX_HUMANS, state: match.state });
});

const TICK = 20;               // mises à jour par seconde
const DT = 1 / TICK;
const LOBBY_COUNTDOWN = ARENA ? 3 : 10; // secondes avant le début quand il y a au moins 2 joueurs
const MAX_HUMANS = ARENA ? 2 : S.MAX_PLAYERS;
// Nombre de bots ajoutés automatiquement (modifiable : $env:BOTS=20; npm start). En 1v1 : géré à part.
const BOTS_DEFAULT = Math.max(0, Math.min(S.MAX_PLAYERS - 1, Number(process.env.BOTS ?? 9) || 0));
let botTarget = ARENA ? 0 : BOTS_DEFAULT;
const BOT_SIGHT = 60;          // distance à laquelle un bot repère un ennemi (m)
const RESPAWN = MODE !== 'br';
const RESPAWN_DELAY = ARENA ? 2 : 3; // secondes
// Matériaux illimités par défaut. Pour les limiter : $env:MATS='limited'; npm start
const UNLIMITED_MATS = process.env.MATS !== 'limited';
const END_DELAY = 10;          // secondes d'écran de fin
const SEED = Math.floor(Math.random() * 1e9);
const obstacles = S.generateObstacles(SEED);

// Zone : chaque phase = attente, puis rétrécissement jusqu'au rayon r. dps = dégâts/seconde hors zone
const PHASES = [
  { wait: 40, shrink: 30, r: 110, dps: 1 },
  { wait: 30, shrink: 25, r: 65, dps: 2 },
  { wait: 25, shrink: 20, r: 35, dps: 4 },
  { wait: 20, shrink: 20, r: 15, dps: 7 },
  { wait: 15, shrink: 20, r: 0, dps: 12 },
];

const players = new Map();   // id -> joueur (humains et bots)
const builds = new Map();    // id -> construction
const buildKeys = new Map(); // emplacement -> id (pour éviter deux murs au même endroit)
const pickups = new Map();   // id -> objet au sol
let nextId = 1;
const match = { state: 'lobby', timer: LOBBY_COUNTDOWN, winner: null, lastEliminated: null };
let zone = null;

const BOT_NAMES = ['Ricochet', 'Brindille', 'Comète', 'Pixel', 'Gravier', 'Sirocco', 'Nova', 'Tornade', 'Mistral', 'Galet',
  'Orage', 'Lynx', 'Cactus', 'Bourrasque', 'Volt', 'Écho', 'Flocon', 'Rafale', 'Basalte', 'Zéphyr'];

const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const now = () => Date.now();

// ---------- Joueurs ----------
function resetLoadout(p) {
  p.hp = 100; p.shield = 0; p.alive = true; p.spectator = false;
  if (ARENA) {
    // 1v1 : tout le monde a le même équipement complet, pas d'objets à ramasser
    p.slots = ['shotgun', 'rifle', 'sniper'].map((type) => ({ type, mag: S.WEAPONS[type].mag }));
    p.cur = 0; p.ammo = 9999; p.mats = 100;
    p.items = { mini: 2, big: 1, medkit: 1 };
  } else {
    p.slots = [{ type: 'pistol', mag: S.WEAPONS.pistol.mag }, null, null];
    p.cur = 0; p.ammo = p.isBot ? 9999 : 60; p.mats = 100;
    p.items = { mini: 0, big: 0, medkit: 0 };
  }
  p.reloadUntil = 0; p.reloadStart = 0; p.kills = 0; p.deaths = 0; p.placement = 0; p.respawnAt = 0;
  p.using = null; // objet de soin en cours d'utilisation { item, start, until }
}

function randomSpawn(maxR = S.MAP_HALF - 15, p = null) {
  if (ARENA) {
    // Arène : point d'apparition le plus éloigné des adversaires
    let best = S.ARENA_SPAWNS[0], bestD = -1;
    for (const sp of S.ARENA_SPAWNS) {
      let d = Infinity;
      for (const o of players.values()) if (o !== p && o.alive) d = Math.min(d, dist2(sp[0], sp[1], o.x, o.z));
      if (d > bestD) { bestD = d; best = sp; }
    }
    return [best[0] + rand(-1, 1), best[1] + rand(-1, 1)];
  }
  for (let i = 0; i < 60; i++) {
    const x = rand(-maxR, maxR), z = rand(-maxR, maxR);
    const ok = obstacles.every((o) => Math.abs(x - o.x) > o.w / 2 + 2 || Math.abs(z - o.z) > o.d / 2 + 2);
    if (ok) return [x, z];
  }
  return [0, 0];
}

function createPlayer(id, name, isBot, socket = null) {
  const [x, z] = randomSpawn();
  const p = { id, name, isBot, socket, x, z, y: 0, yaw: rand(0, Math.PI * 2), pitch: 0, lastShot: 0, lastInput: now(),
    color: Math.floor(Math.random() * 360), ai: {} };
  resetLoadout(p);
  players.set(id, p);
  return p;
}

function roster() {
  io.emit('roster', [...players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, isBot: p.isBot })));
}

const contenders = () => [...players.values()].filter((p) => p.alive && !p.spectator);

function teleport(p, x, z) {
  p.x = x; p.z = z; p.y = 0;
  if (p.socket) p.socket.emit('teleport', { x, z, y: 0, yaw: p.yaw });
}

// ---------- Objets au sol ----------
function addPickup(pk) {
  pk.id = nextId++;
  pickups.set(pk.id, pk);
  io.emit('pickupAdd', pk);
  return pk;
}
function removePickup(id) {
  pickups.delete(id);
  io.emit('pickupRemove', id);
}
function randomPickup(x, z) {
  const r = Math.random();
  if (r < 0.32) {
    const type = S.WEAPON_POOL[Math.floor(Math.random() * S.WEAPON_POOL.length)];
    return { kind: 'weapon', weapon: type, mag: S.WEAPONS[type].mag, x, z };
  }
  if (r < 0.57) return { kind: 'ammo', amount: 30, x, z };
  if (r < 0.84) { // objets de soin : mini-potion (fréquente), grosse potion, trousse de soins (rare)
    const q = Math.random();
    return { kind: 'item', item: q < 0.5 ? 'mini' : q < 0.8 ? 'big' : 'medkit', amount: 1, x, z };
  }
  if (UNLIMITED_MATS) return { kind: 'ammo', amount: 30, x, z }; // matériaux inutiles s'ils sont illimités
  return { kind: 'mats', amount: 40, x, z };
}
function spawnPickups() {
  if (ARENA) { pickups.clear(); io.emit('pickupsReset', []); return; } // 1v1 : pas d'objets au sol
  for (const id of pickups.keys()) pickups.delete(id);
  const list = [];
  for (let i = 0; i < 180; i++) {
    const [x, z] = randomSpawn(S.MAP_HALF - 5);
    const pk = randomPickup(x, z);
    pk.id = nextId++;
    pickups.set(pk.id, pk);
    list.push(pk);
  }
  // Butin garanti à l'intérieur des bâtiments (souvent des armes) : ça vaut le coup d'y entrer
  for (const b of obstacles.buildings) {
    const n = b.kind === 'warehouse' ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const x = b.x + rand(-1, 1) * (b.w / 2 - 1.5), z = b.z + rand(-1, 1) * (b.d / 2 - 1.5);
      let pk = randomPickup(x, z);
      if (pk.kind !== 'weapon' && Math.random() < 0.5) {
        const type = S.WEAPON_POOL[Math.floor(Math.random() * S.WEAPON_POOL.length)];
        pk = { kind: 'weapon', weapon: type, mag: S.WEAPONS[type].mag, x, z };
      }
      pk.id = nextId++;
      pickups.set(pk.id, pk);
      list.push(pk);
    }
  }
  io.emit('pickupsReset', list);
}

// Applique un objet consommable. Renvoie true s'il a été utilisé.
function consume(p, pk) {
  if (pk.kind === 'ammo') { if (p.isBot) return false; p.ammo += pk.amount; return true; }
  if (pk.kind === 'mats') { if (p.mats >= 500) return false; p.mats = Math.min(500, p.mats + pk.amount); return true; }
  if (pk.kind === 'item') { // rangé dans l'inventaire (les bots n'en ramassent pas)
    if (p.isBot || !S.ITEMS[pk.item]) return false;
    const room = S.ITEMS[pk.item].max - (p.items[pk.item] || 0);
    if (room <= 0) return false;
    const take = Math.min(room, pk.amount || 1);
    p.items[pk.item] = (p.items[pk.item] || 0) + take;
    if (take < (pk.amount || 1)) { pk.amount -= take; return false; } // il en reste au sol
    return true;
  }
  return false;
}

function takeWeapon(p, pk) {
  let slot = p.slots.findIndex((s) => !s);
  if (slot === -1) {
    slot = p.cur;
    const old = p.slots[slot];
    addPickup({ kind: 'weapon', weapon: old.type, mag: old.mag, x: p.x + rand(-1, 1), z: p.z + rand(-1, 1) });
  }
  p.slots[slot] = { type: pk.weapon, mag: pk.mag };
  p.cur = slot; p.reloadUntil = 0;
  removePickup(pk.id);
}

// ---------- Constructions ----------
function removeBuild(b) {
  builds.delete(b.id);
  buildKeys.delete(S.buildKey(b));
  io.emit('buildRemove', b.id);
}
function clearBuilds() {
  builds.clear(); buildKeys.clear();
  io.emit('buildsReset');
}

function moveBoxes() {
  const boxes = obstacles.slice();
  for (const b of builds.values()) boxes.push(...S.buildBoxes(b));
  return boxes; // les bots restent au sol (y = 0) : murs et sols en hauteur ne les gênent pas
}

// ---------- Tirs ----------
function raycast(o, d, range, ignoreId) {
  let best = range, hit = null;
  if (d.y < 0) { const t = -o.y / d.y; if (t < best) { best = t; hit = { kind: 'ground' }; } }
  for (const ob of obstacles) {
    const t = S.rayBox(o, d, ob.x - ob.w / 2, ob.y0 || 0, ob.z - ob.d / 2, ob.x + ob.w / 2, ob.h, ob.z + ob.d / 2);
    if (t >= 0 && t < best) { best = t; hit = { kind: 'obstacle' }; }
  }
  for (const b of builds.values()) {
    const ts = S.isSlope(b) ? [S.raySlope(o, d, b, best)]
      : S.buildBoxes(b).map((bx) => S.rayBox(o, d, bx.x - bx.w / 2, bx.y0, bx.z - bx.d / 2, bx.x + bx.w / 2, bx.h, bx.z + bx.d / 2));
    for (const t of ts) if (t >= 0 && t < best) { best = t; hit = { kind: 'build', build: b }; }
  }
  for (const p of players.values()) {
    if (!p.alive || p.spectator || p.id === ignoreId) continue;
    const R = S.PLAYER_RADIUS;
    const t = S.rayBox(o, d, p.x - R, p.y, p.z - R, p.x + R, p.y + S.PLAYER_HEIGHT, p.z + R);
    if (t >= 0 && t < best) { best = t; hit = { kind: 'player', player: p, head: o.y + d.y * t > p.y + S.PLAYER_HEIGHT * 0.8 }; }
  }
  return { hit, t: best, x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best };
}

function startReload(p) {
  const w = p.slots[p.cur];
  if (!w || p.reloadUntil || p.ammo <= 0) return;
  const def = S.WEAPONS[w.type];
  if (w.mag >= def.mag) return;
  p.reloadStart = now();
  p.reloadUntil = now() + def.reload * 1000;
}

// aiming = le joueur vise (clic droit) : dispersion des balles réduite
function shoot(p, dir, aiming = false) {
  if (!p.alive || p.spectator || match.state === 'ended') return;
  const w = p.slots[p.cur];
  if (!w) return;
  const def = S.WEAPONS[w.type];
  const spread = def.spread * (aiming ? def.aimSpread : 1);
  const t = now();
  if (p.reloadUntil) return;
  if (t - p.lastShot < (1000 / def.rate) * 0.85) return; // cadence de tir contrôlée par le serveur
  if (w.mag <= 0) { startReload(p); return; }
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!isFinite(len) || len < 1e-6) return;
  w.mag--; p.lastShot = t;
  p.using = null; // tirer interrompt un soin

  const o = { x: p.x, y: p.y + S.EYE_HEIGHT, z: p.z };
  const tracers = [];
  const dmgByPlayer = new Map();
  for (let i = 0; i < def.pellets; i++) {
    const d = {
      x: dir.x / len + (Math.random() - 0.5) * 2 * spread,
      y: dir.y / len + (Math.random() - 0.5) * 2 * spread,
      z: dir.z / len + (Math.random() - 0.5) * 2 * spread,
    };
    const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
    const r = raycast(o, d, def.range, p.id);
    tracers.push([+r.x.toFixed(2), +r.y.toFixed(2), +r.z.toFixed(2)]);
    if (r.hit?.kind === 'player') {
      const dmg = def.damage * (r.hit.head ? 1.5 : 1);
      dmgByPlayer.set(r.hit.player, (dmgByPlayer.get(r.hit.player) || 0) + dmg);
    } else if (r.hit?.kind === 'build') {
      const b = r.hit.build;
      if (builds.has(b.id)) {
        b.hp -= def.damage;
        if (b.hp <= 0) removeBuild(b); else io.emit('buildHp', { id: b.id, hp: b.hp });
      }
    }
  }
  io.emit('shot', { id: p.id, o: [o.x, o.y, o.z], t: tracers, w: w.type });
  let total = 0;
  for (const [target, dmg] of dmgByPlayer) {
    if (damage(target, dmg, p, def.name)) total += dmg;
  }
  if (total > 0 && p.socket) p.socket.emit('hit', Math.round(total));
  if (w.mag === 0) startReload(p);
}

// Renvoie true si des dégâts ont été appliqués
function damage(target, amount, attacker, cause) {
  if (match.state !== 'playing' || !target.alive || target.spectator) return false;
  if (now() < (target.protectedUntil || 0)) return false; // protection juste après la réapparition
  let a = amount;
  if (target.shield > 0) { const s = Math.min(target.shield, a); target.shield -= s; a -= s; }
  target.hp -= a;
  if (target.socket) target.socket.emit('hurt', attacker ? attacker.id : null);
  if (target.isBot && attacker && attacker !== target) {
    target.ai.revenge = attacker; target.ai.revengeAt = now(); target.ai.nextThink = 0; // il se retourne et riposte
  }
  if (target.hp <= 0) eliminate(target, attacker, cause);
  return true;
}

function eliminate(t, attacker, cause) {
  t.placement = contenders().length; // place = nombre de survivants avant sa mort
  t.alive = false; t.hp = 0;
  match.lastEliminated = t;
  t.deaths = (t.deaths || 0) + 1;
  // Il lâche son équipement (en réapparition infinie : seulement ses armes autres que le pistolet, pour ne pas encombrer la carte)
  for (const s of t.slots) {
    if (s && !(RESPAWN && s.type === 'pistol')) addPickup({ kind: 'weapon', weapon: s.type, mag: s.mag, x: t.x + rand(-1.5, 1.5), z: t.z + rand(-1.5, 1.5) });
  }
  if (!t.isBot && t.ammo > 0) addPickup({ kind: 'ammo', amount: Math.min(t.ammo, 60), x: t.x + rand(-1.5, 1.5), z: t.z + rand(-1.5, 1.5) });
  if (!ARENA) for (const it of S.ITEM_ORDER) if (t.items?.[it] > 0) addPickup({ kind: 'item', item: it, amount: t.items[it], x: t.x + rand(-1.5, 1.5), z: t.z + rand(-1.5, 1.5) });
  if (!UNLIMITED_MATS && t.mats > 0) addPickup({ kind: 'mats', amount: t.mats, x: t.x + rand(-1.5, 1.5), z: t.z + rand(-1.5, 1.5) });
  if (attacker && attacker !== t) attacker.kills++;
  if (RESPAWN) t.respawnAt = now() + RESPAWN_DELAY * 1000;
  io.emit('kill', { victimId: t.id, victim: t.name, killerId: attacker?.id ?? null, killer: attacker?.name ?? null, cause,
    placement: t.placement, respawn: RESPAWN ? RESPAWN_DELAY : 0 });
  checkWin();
}

// Réapparition : nouvel équipement, endroit aléatoire, 2 s de protection. Les éliminations sont conservées.
function respawn(p) {
  const kills = p.kills, deaths = p.deaths;
  resetLoadout(p);
  p.kills = kills; p.deaths = deaths;
  p.respawnAt = 0;
  p.protectedUntil = now() + 2000;
  p.ai = {};
  const [x, z] = randomSpawn(undefined, p);
  teleport(p, x, z);
}

function checkWin() {
  if (match.state !== 'playing' || RESPAWN) return; // en réapparition infinie, la partie ne s'arrête pas
  const alive = contenders();
  if (alive.length <= 1) {
    const w = alive[0] || match.lastEliminated;
    match.state = 'ended'; match.timer = END_DELAY; match.winner = w?.id ?? null;
    io.emit('matchEnd', { winnerId: w?.id ?? null, winner: w?.name ?? 'Personne', kills: w?.kills ?? 0 });
    console.log(`Fin de partie : ${w?.name} gagne`);
  }
}

// ---------- Zone ----------
function pickTarget(z, r) {
  const maxOff = Math.max(0, Math.min(z.r - r, S.MAP_HALF - r - 5));
  const a = Math.random() * Math.PI * 2, d = Math.random() * maxOff;
  let tx = z.cx + Math.cos(a) * d, tz = z.cz + Math.sin(a) * d;
  const lim = Math.max(0, S.MAP_HALF - r - 5);
  tx = Math.max(-lim, Math.min(lim, tx)); tz = Math.max(-lim, Math.min(lim, tz));
  z.tcx = tx; z.tcz = tz; z.tr = r;
}
function initZone() {
  zone = { cx: 0, cz: 0, r: 215, phase: 0, state: 'wait', timer: PHASES[0].wait };
  pickTarget(zone, PHASES[0].r);
}
function updateZone() {
  if (!zone || zone.state === 'final') return;
  zone.timer -= DT;
  const ph = PHASES[zone.phase];
  if (zone.state === 'wait' && zone.timer <= 0) {
    zone.state = 'shrink'; zone.timer = ph.shrink;
    zone.sx = zone.cx; zone.sz = zone.cz; zone.sr = zone.r;
  } else if (zone.state === 'shrink') {
    const k = Math.min(1, 1 - zone.timer / ph.shrink);
    zone.cx = zone.sx + (zone.tcx - zone.sx) * k;
    zone.cz = zone.sz + (zone.tcz - zone.sz) * k;
    zone.r = zone.sr + (zone.tr - zone.sr) * k;
    if (zone.timer <= 0) {
      zone.phase++;
      if (zone.phase < PHASES.length) {
        zone.state = 'wait'; zone.timer = PHASES[zone.phase].wait;
        pickTarget(zone, PHASES[zone.phase].r);
      } else { zone.state = 'final'; zone.phase = PHASES.length - 1; }
    }
  }
}
const zoneDps = () => PHASES[Math.min(zone.phase, PHASES.length - 1)].dps;

// ---------- Déroulement de la partie ----------
function startMatch() {
  match.state = 'playing'; match.winner = null; match.lastEliminated = null;
  clearBuilds();
  spawnPickups();
  if (!RESPAWN) initZone(); else zone = null;
  for (const p of players.values()) {
    resetLoadout(p);
    const [x, z] = randomSpawn(undefined, p);
    teleport(p, x, z);
  }
  io.emit('matchStart');
  console.log(`Partie lancée avec ${players.size} joueurs`);
}
function backToLobby() {
  match.state = 'lobby'; match.timer = LOBBY_COUNTDOWN; zone = null;
  clearBuilds();
  spawnPickups();
  for (const p of players.values()) {
    resetLoadout(p);
    const [x, z] = randomSpawn(undefined, p);
    teleport(p, x, z);
  }
  io.emit('lobby');
}

// ---------- Bots ----------
function addBots(n) {
  for (let i = 0; i < n && players.size < S.MAX_PLAYERS; i++) {
    const id = 'bot' + nextId++;
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + ' (bot)';
    createPlayer(id, name, true);
  }
  roster();
}
function removeBots() {
  botTarget = 0;
  for (const p of [...players.values()]) if (p.isBot) players.delete(p.id);
  roster();
  checkWin();
}

function lineOfSight(a, b) {
  const o = { x: a.x, y: a.y + S.EYE_HEIGHT, z: a.z };
  const dx = b.x - a.x, dy = b.y + S.PLAYER_HEIGHT * 0.65 - o.y, dz = b.z - a.z;
  const l = Math.hypot(dx, dy, dz);
  const r = raycast(o, { x: dx / l, y: dy / l, z: dz / l }, l + 1, a.id);
  return r.hit?.kind === 'player' && r.hit.player === b;
}

const BOT_PREF = { shotgun: 3, rifle: 2, sniper: 1, pistol: 0 };
function updateBot(b, boxes, slopes, t) {
  if (!b.alive || b.spectator) return;
  const ai = b.ai;
  // Réfléchit 2 à 3 fois par seconde : choisit une cible visible
  if (!ai.nextThink || t > ai.nextThink) {
    ai.nextThink = t + 350 + Math.random() * 300;
    let best = null, bestD = BOT_SIGHT * BOT_SIGHT;
    if (match.state === 'playing') {
      for (const p of players.values()) {
        if (p === b || !p.alive || p.spectator) continue;
        // Les bots visent en priorité les vrais joueurs (ils les "voient" comme 2 fois plus proches)
        const d = dist2(b.x, b.z, p.x, p.z) * (p.isBot ? 1 : 0.25);
        if (d < bestD && lineOfSight(b, p)) { best = p; bestD = d; }
      }
    }
    // Riposte : si on lui a tiré dessus récemment, il garde son agresseur en cible
    if (ai.revenge?.alive && t - ai.revengeAt < 4000 && (!best || best.isBot)) best = ai.revenge;
    if (best && ai.target !== best) ai.seenAt = t;
    ai.target = best;
    if (Math.random() < 0.3) ai.strafe = Math.random() < 0.5 ? -1 : 1;
    // Ramasse une arme proche (et la meilleure arme)
    for (const pk of pickups.values()) {
      if (pk.kind === 'weapon' && dist2(b.x, b.z, pk.x, pk.z) < 6 && b.slots.some((s) => !s)) { takeWeapon(b, pk); break; }
    }
    let bi = b.cur;
    b.slots.forEach((s, i) => { if (s && BOT_PREF[s.type] > BOT_PREF[b.slots[bi]?.type ?? 'pistol']) bi = i; });
    b.cur = bi;
  }
  let mx = 0, mz = 0;
  const target = ai.target && ai.target.alive ? ai.target : null;
  const zr = zone ? Math.sqrt(dist2(b.x, b.z, zone.tcx, zone.tcz)) : 0;
  const outside = zone && Math.sqrt(dist2(b.x, b.z, zone.cx, zone.cz)) > zone.r * 0.9;
  if (outside || (zone && !target && zr > zone.tr * 0.8 && zone.state !== 'wait')) {
    mx = zone.tcx - b.x; mz = zone.tcz - b.z;
  } else if (target) {
    const dx = target.x - b.x, dz = target.z - b.z, d = Math.hypot(dx, dz);
    b.yaw = Math.atan2(-dx, -dz);
    b.pitch = Math.atan2(target.y + S.PLAYER_HEIGHT * 0.65 - S.EYE_HEIGHT, d);
    const want = b.slots[b.cur]?.type === 'shotgun' ? 6 : b.slots[b.cur]?.type === 'sniper' ? 30 : 14;
    const fwd = d > want + 3 ? 1 : d < want - 3 ? -0.6 : 0;
    mx = (dx / d) * fwd + (-dz / d) * (ai.strafe || 1) * 0.7;
    mz = (dz / d) * fwd + (dx / d) * (ai.strafe || 1) * 0.7;
    // Tire avec un temps de réaction et une précision imparfaite
    const w = b.slots[b.cur];
    if (w && t - ai.seenAt > 450 && (!ai.nextShot || t > ai.nextShot)) {
      const def = S.WEAPONS[w.type];
      ai.nextShot = t + (1000 / def.rate) * 1.6 + Math.random() * 200;
      const err = 0.05 + Math.min(0.08, d * 0.002);
      const dy = target.y + S.PLAYER_HEIGHT * 0.6 - S.EYE_HEIGHT; // le bot reste au sol (y = 0)
      shoot(b, { x: dx / d + rand(-err, err), y: dy / d + rand(-err, err), z: dz / d + rand(-err, err) });
    }
  } else {
    // Se balade vers un point aléatoire
    if (!ai.wp || dist2(b.x, b.z, ai.wp[0], ai.wp[1]) < 4) {
      const c = zone ? [zone.tcx, zone.tcz, Math.max(5, zone.tr)] : [0, 0, S.MAP_HALF - 10];
      const a = Math.random() * Math.PI * 2, r = Math.random() * c[2];
      ai.wp = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    }
    mx = ai.wp[0] - b.x; mz = ai.wp[1] - b.z;
  }
  const l = Math.hypot(mx, mz);
  if (l > 0.01) {
    if (!target) b.yaw = Math.atan2(-mx, -mz);
    const sp = (target ? S.WALK_SPEED : S.SPRINT_SPEED * 0.8) * DT;
    const ox = b.x, oz = b.z;
    [b.x, b.z] = S.moveWithCollisions(b.x, b.z, (mx / l) * sp, (mz / l) * sp, 0, boxes, slopes);
    if (Math.hypot(b.x - ox, b.z - oz) < sp * 0.2) { ai.wp = null; ai.strafe = -(ai.strafe || 1); } // bloqué : change d'idée
  }
}

// ---------- Boucle principale ----------
setInterval(() => {
  const t = now();
  // Salon d'attente / compte à rebours / fin
  if (ARENA) {
    // 1v1 : toujours 2 combattants. Seul = 1 bot ; deux vrais joueurs = pas de bot.
    const humans = [...players.values()].filter((p) => !p.isBot).length;
    const bots = [...players.values()].filter((p) => p.isBot);
    const want = humans > 0 ? Math.max(0, 2 - humans) : 0;
    if (bots.length > want) { players.delete(bots[0].id); roster(); }
    else if (bots.length < want) addBots(1);
  }
  if (match.state === 'lobby') {
    // Remplit automatiquement la partie avec des bots dès qu'un vrai joueur est là
    const humans = [...players.values()].filter((p) => !p.isBot).length;
    const bots = players.size - humans;
    if (humans === 0 && bots > 0) { for (const p of [...players.values()]) players.delete(p.id); roster(); }
    else if (humans > 0 && bots < botTarget && players.size < S.MAX_PLAYERS) addBots(botTarget - bots);
    if (players.size >= 2) {
      match.timer -= DT;
      if (match.timer <= 0) startMatch();
    } else match.timer = LOBBY_COUNTDOWN;
  } else if (match.state === 'ended') {
    match.timer -= DT;
    if (match.timer <= 0) backToLobby();
  } else if (match.state === 'playing') {
    updateZone();
  }

  // Réapparitions
  if (RESPAWN && match.state === 'playing') {
    for (const p of players.values()) if (!p.alive && p.respawnAt && t >= p.respawnAt) respawn(p);
    if (![...players.values()].some((p) => !p.isBot)) backToLobby(); // plus aucun vrai joueur : on arrête
  }

  const boxes = moveBoxes();
  const slopes = [...builds.values()].filter(S.isSlope);
  for (const p of players.values()) {
    if (p.isBot) updateBot(p, boxes, slopes, t);
    if (!p.alive || p.spectator) continue;
    // Fin d'utilisation d'un objet de soin
    if (p.using && t >= p.using.until) {
      const it = p.using.item;
      p.using = null;
      if (p.items[it] > 0 && S.itemUseful(it, p.hp, p.shield)) {
        const r = S.applyItem(it, p.hp, p.shield);
        p.hp = r.hp; p.shield = r.shield; p.items[it]--;
      }
    }
    // Fin de rechargement
    if (p.reloadUntil && t >= p.reloadUntil) {
      const w = p.slots[p.cur];
      if (w) {
        const take = Math.min(S.WEAPONS[w.type].mag - w.mag, p.ammo);
        w.mag += take; if (!p.isBot) p.ammo -= take;
      }
      p.reloadUntil = 0;
    }
    // Objets consommables ramassés automatiquement en marchant dessus
    for (const pk of pickups.values()) {
      if (pk.kind !== 'weapon' && p.y < 1.5 && dist2(p.x, p.z, pk.x, pk.z) < 2.5 && consume(p, pk)) removePickup(pk.id);
    }
    // Dégâts de la zone
    if (match.state === 'playing' && zone && dist2(p.x, p.z, zone.cx, zone.cz) > zone.r * zone.r) {
      p.hp -= zoneDps() * DT;
      if (p.hp <= 0) eliminate(p, null, 'zone');
    }
  }

  // Envoi de l'état à tout le monde
  const r2 = (v) => Math.round(v * 100) / 100;
  io.emit('state', {
    m: { s: match.state, timer: Math.ceil(match.timer), alive: contenders().length, total: players.size },
    // Classement des 5 meilleurs (éliminations)
    lb: [...players.values()].sort((a, b) => b.kills - a.kills || (a.deaths || 0) - (b.deaths || 0)).slice(0, 5)
      .map((p) => [p.id, p.name, p.kills, p.deaths || 0]),
    z: zone && { cx: r2(zone.cx), cz: r2(zone.cz), r: r2(zone.r), tcx: r2(zone.tcx), tcz: r2(zone.tcz), tr: zone.tr,
      st: zone.state, timer: Math.ceil(zone.timer), phase: zone.phase + 1, phases: PHASES.length },
    p: [...players.values()].map((p) => [p.id, r2(p.x), r2(p.z), r2(p.yaw), r2(p.pitch), Math.ceil(p.hp), Math.ceil(p.shield),
      p.alive && !p.spectator ? 1 : 0, p.slots[p.cur]?.type || '', r2(p.y)]),
  });
  for (const p of players.values()) {
    if (!p.socket) continue;
    p.socket.emit('me', {
      slots: p.slots, cur: p.cur, ammo: p.ammo, mats: UNLIMITED_MATS ? -1 : p.mats, kills: p.kills, hp: Math.ceil(p.hp), shield: Math.ceil(p.shield),
      alive: p.alive && !p.spectator, spectator: p.spectator,
      reload: p.reloadUntil ? (t - p.reloadStart) / (p.reloadUntil - p.reloadStart) : 0,
      respawnIn: p.respawnAt ? Math.max(0, Math.ceil((p.respawnAt - t) / 1000)) : 0, deaths: p.deaths,
      protected: t < (p.protectedUntil || 0),
      items: p.items,
      using: p.using ? { item: p.using.item, pct: Math.min(1, (t - p.using.start) / (p.using.until - p.using.start)) } : null,
    });
  }
}, 1000 / TICK);

// ---------- Connexions ----------
io.on('connection', (socket) => {
  let p = null;

  socket.on('join', (data) => {
    if (p) return;
    const humans = [...players.values()].filter((o) => !o.isBot).length;
    if (humans >= MAX_HUMANS || players.size >= S.MAX_PLAYERS) { socket.emit('full'); return; }
    const name = String(data?.name || 'Joueur').replace(/[<>]/g, '').trim().slice(0, 16) || 'Joueur';
    p = createPlayer(socket.id, name, false, socket);
    if (match.state === 'playing' && !RESPAWN) { p.alive = false; p.spectator = true; } // arrive en pleine partie : spectateur
    socket.emit('init', {
      id: p.id, seed: SEED, x: p.x, z: p.z, yaw: p.yaw, respawn: RESPAWN, mode: MODE, map: S.MAP, ports: MODE_PORTS,
      builds: [...builds.values()], pickups: [...pickups.values()],
    });
    roster();
    console.log(`${name} a rejoint (${players.size} joueurs)`);
  });

  socket.on('input', (d) => {
    if (!p || !p.alive || p.spectator || typeof d?.x !== 'number' || typeof d?.z !== 'number') return;
    const t = now();
    const elapsed = Math.min(1, (t - p.lastInput) / 1000);
    p.lastInput = t;
    // Anti-triche simple : on refuse les déplacements trop rapides
    const maxD = S.SPRINT_SPEED * elapsed * 1.5 + 1;
    if (!isFinite(d.x) || !isFinite(d.z) || Math.hypot(d.x - p.x, d.z - p.z) > maxD) {
      socket.emit('teleport', { x: p.x, z: p.z });
    } else {
      const lim = S.MAP_HALF;
      p.x = Math.max(-lim, Math.min(lim, d.x)); p.z = Math.max(-lim, Math.min(lim, d.z));
      if (isFinite(d.y)) p.y = Math.max(0, Math.min(S.WALL_H * (S.MAX_BUILD_LEVEL + 2), d.y));
    }
    if (isFinite(d.yaw)) p.yaw = d.yaw;
    if (isFinite(d.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, d.pitch));
  });

  socket.on('shoot', (dir, aiming) => { if (p && dir) shoot(p, { x: +dir[0], y: +dir[1], z: +dir[2] }, aiming === true); });
  socket.on('reload', () => { if (p?.alive) startReload(p); });
  // Utiliser un objet de soin (prend du temps ; tirer ou changer d'arme l'interrompt)
  socket.on('useItem', (it) => {
    if (!p?.alive || p.spectator || !S.ITEMS[it] || !(p.items[it] > 0)) return;
    if (!S.itemUseful(it, p.hp, p.shield)) { socket.emit('itemRefused', it); return; }
    const t = now();
    p.reloadUntil = 0;
    p.using = { item: it, start: t, until: t + S.ITEMS[it].time * 1000 };
  });
  socket.on('cancelItem', () => { if (p) p.using = null; });
  socket.on('switch', (i) => {
    if (!p?.alive || ![0, 1, 2].includes(i) || i === p.cur) return;
    p.cur = i; p.reloadUntil = 0; p.using = null;
  });
  socket.on('pickup', () => {
    if (!p?.alive || p.spectator) return;
    let best = null, bestD = 3.5 * 3.5;
    for (const pk of pickups.values()) {
      const d = dist2(p.x, p.z, pk.x, pk.z);
      if (pk.kind === 'weapon' && d < bestD) { best = pk; bestD = d; }
    }
    if (best) takeWeapon(p, best);
  });

  socket.on('build', (s) => {
    if (!p?.alive || p.spectator || match.state === 'ended' || !s) return;
    const kind = S.BUILD_PIECES.includes(s.kind) ? s.kind : 'wall';
    const slot = { kind, x: +s.x, z: +s.z, y: +s.y || 0 };
    const half = S.GRID / 2;
    const isMul = (v) => Math.abs(v % S.GRID) < 1e-6;
    let aligned;
    if (kind === 'wall') {
      slot.axis = s.axis === 'z' ? 'z' : 'x';
      aligned = slot.axis === 'x' ? isMul(slot.x - half) && isMul(slot.z) : isMul(slot.x) && isMul(slot.z - half);
    } else {
      aligned = isMul(slot.x - half) && isMul(slot.z - half); // centre d'une case
      if (kind === 'stairs') slot.dir = ['px', 'nx', 'pz', 'nz'].includes(s.dir) ? s.dir : 'nz';
    }
    // Étage valide et proche du joueur
    const levelOk = slot.y >= 0 && slot.y <= S.MAX_BUILD_LEVEL * S.WALL_H && Number.isInteger(slot.y / S.WALL_H)
      && Math.abs(slot.y - p.y) <= S.WALL_H + 1.5;
    const inMap = Math.abs(slot.x) < S.MAP_HALF && Math.abs(slot.z) < S.MAP_HALF;
    if (!aligned || !levelOk || !inMap || Math.hypot(slot.x - p.x, slot.z - p.z) > S.GRID * 2) return;
    if ((!UNLIMITED_MATS && p.mats < S.BUILD_COST) || buildKeys.has(S.buildKey(slot))) return;
    if (!UNLIMITED_MATS) p.mats -= S.BUILD_COST;
    const b = { id: nextId++, ...slot, cut: 0, hp: S.WALL_HP, owner: p.id };
    builds.set(b.id, b);
    buildKeys.set(S.buildKey(b), b.id);
    io.emit('buildAdd', b);
  });
  // Modification : le joueur envoie la liste des carrés retirés (un nombre "masque")
  socket.on('edit', (d) => {
    const b = builds.get(d?.id);
    if (!p?.alive || !b || b.owner !== p.id || Math.hypot(b.x - p.x, b.z - p.z) > 12) return;
    if (b.kind === 'stairs') {
      // Escalier : on ne le troue pas, on change le sens dans lequel il monte
      if (!['px', 'nx', 'pz', 'nz'].includes(d.dir)) return;
      b.dir = d.dir; b.cut = 0;
    } else {
      if (!S.validCut(b.kind, d.cut)) return; // mur et sol : carrés retirés ; cône : coins relevés
      b.cut = d.cut;
    }
    io.emit('buildUpdate', { id: b.id, cut: b.cut, dir: b.dir });
  });
  socket.on('demolish', (id) => {
    const b = builds.get(id);
    if (!p?.alive || !b || b.owner !== p.id || Math.hypot(b.x - p.x, b.z - p.z) > 10) return;
    removeBuild(b);
    p.mats += Math.floor(S.BUILD_COST / 2);
  });

  socket.on('addBots', (n) => { if (match.state === 'lobby' && !ARENA) addBots(Math.max(1, Math.min(49, n | 0))); });
  socket.on('removeBots', () => { if (match.state !== 'playing' && !ARENA) removeBots(); });

  socket.on('disconnect', () => {
    if (!p) return;
    players.delete(p.id);
    roster();
    console.log(`${p.name} est parti (${players.size} joueurs)`);
    checkWin();
  });
});

http.listen(PORT, () => {
  console.log(`Zone Rush — mode ${MODE} : http://localhost:${PORT}`);
});
