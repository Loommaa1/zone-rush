// Client de Zone Rush : affichage 3D (Three.js), contrôles, interface.
// Le serveur décide des règles ; le client envoie sa position et ses actions.
import * as THREE from 'three';
import * as S from './shared.js';
import { makeWeaponModel } from './weapons.js';

const $ = (id) => document.getElementById(id);

// =====================================================================
// Choix du mode : chaque mode tourne sur son propre serveur (port).
// La page reste la même ; on se connecte au serveur du mode choisi (?mode=1v1 dans l'adresse).
// =====================================================================
const params = new URLSearchParams(location.search);
let serverInfo = { mode: 'libre', ports: { libre: 3000, '1v1': 3001 } };
try { serverInfo = await (await fetch('/mode')).json(); } catch { /* ancien serveur : valeurs par défaut */ }
const MODES = ['libre', '1v1'];
const chosenMode = MODES.includes(params.get('mode')) ? params.get('mode') : serverInfo.mode === '1v1' ? '1v1' : 'libre';
const modeUrl = (m) => (m === serverInfo.mode ? location.origin : `${location.protocol}//${location.hostname}:${serverInfo.ports[m]}`);
const socket = chosenMode === serverInfo.mode ? io() : io(modeUrl(chosenMode));

// =====================================================================
// Touches configurables (sauvegardées dans le navigateur)
// On enregistre la position physique de la touche (event.code) : sur un clavier
// AZERTY, "KeyW" correspond donc à la touche Z, "KeyA" à Q, etc.
// =====================================================================
const ACTIONS = [
  ['forward', 'Avancer', 'KeyW'],
  ['back', 'Reculer', 'KeyS'],
  ['left', 'Aller à gauche', 'KeyA'],
  ['right', 'Aller à droite', 'KeyD'],
  ['sprint', 'Sprinter', 'ShiftLeft'],
  ['jump', 'Sauter', 'Space'],
  ['buildWall', 'Construire : mur', 'KeyQ'],
  ['buildFloor', 'Construire : sol', 'KeyF'],
  ['buildStairs', 'Construire : escalier', 'KeyC'],
  ['buildCone', 'Construire : cône', 'KeyV'],
  ['edit', 'Modifier une construction (ouvrir / fermer)', 'KeyG'],
  ['aim', 'Viser (maintenir) : zoom et tirs plus précis', 'Mouse2'],
  ['resetBuild', 'Réinitialiser la construction visée', 'KeyT'],
  ['demolish', 'Détruire sa construction', 'KeyX'],
  ['pickup', 'Ramasser une arme', 'KeyE'],
  ['reload', 'Recharger', 'KeyR'],
  ['slot1', 'Arme 1', 'Digit1'],
  ['slot2', 'Arme 2', 'Digit2'],
  ['slot3', 'Arme 3', 'Digit3'],
  ['fire', 'Tirer / poser la construction', 'Mouse0'],
  ['nextWeapon', 'Arme suivante', 'WheelDown'],
  ['prevWeapon', 'Arme précédente', 'WheelUp'],
  ['inventory', 'Ouvrir / fermer l’inventaire', 'Tab'],
  ['item1', 'Utiliser : mini-potion', 'Digit4'],
  ['item2', 'Utiliser : grosse potion', 'Digit5'],
  ['item3', 'Utiliser : trousse de soins', 'Digit6'],
];
// Boutons de la souris et molette : on leur donne des "codes" comme pour le clavier
const MOUSE_NAMES = { Mouse0: 'Clic gauche', Mouse1: 'Clic molette', Mouse2: 'Clic droit',
  Mouse3: 'Bouton souris 4 (arrière)', Mouse4: 'Bouton souris 5 (avant)', WheelUp: 'Molette vers le haut', WheelDown: 'Molette vers le bas' };
const DEFAULT_KEYS = Object.fromEntries(ACTIONS.map((a) => [a[0], a[2]]));
// On ne garde des réglages sauvegardés que les actions qui existent encore
const savedKeys = JSON.parse(localStorage.getItem('zr_keys') || '{}');
let keys = { ...DEFAULT_KEYS, ...Object.fromEntries(Object.entries(savedKeys).filter(([a]) => a in DEFAULT_KEYS)) };
let sensitivity = +(localStorage.getItem('zr_sens') || 2);
let layoutMap = null;
navigator.keyboard?.getLayoutMap?.().then((m) => { layoutMap = m; renderKeyList(); renderKeyHelp(); }).catch(() => {});

function keyLabel(code) {
  if (!code) return '—';
  if (MOUSE_NAMES[code]) return MOUSE_NAMES[code];
  if (code.startsWith('Mouse')) return 'Bouton souris ' + (+code.slice(5) + 1);
  if (code.startsWith('Digit')) return code.slice(5);
  const l = layoutMap?.get(code);
  if (l && l.trim()) return l.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  const names = { ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droite',
    Space: 'Espace', AltLeft: 'Alt', Tab: 'Tab', CapsLock: 'Verr. Maj', Enter: 'Entrée' };
  return names[code] || code;
}

let listening = null; // action en attente d'une nouvelle touche
let lastAssign = 0;
function renderKeyList() {
  const el = $('keyList');
  el.innerHTML = '';
  for (const [id, label] of ACTIONS) {
    const span = document.createElement('span');
    span.textContent = label;
    const b = document.createElement('button');
    b.textContent = listening === id ? 'Appuie sur une touche…' : keyLabel(keys[id]);
    if (listening === id) b.classList.add('listening');
    b.onclick = () => { if (performance.now() - lastAssign < 400) return; listening = id; renderKeyList(); };
    el.append(span, b);
  }
  $('sens').value = sensitivity;
  $('sensVal').textContent = sensitivity.toFixed(1);
}
function renderKeyHelp() {
  const k = (a) => `<b>${keyLabel(keys[a])}</b>`;
  $('keyHelp').innerHTML = `Déplacement ${k('forward')} ${k('left')} ${k('back')} ${k('right')} · Sprint ${k('sprint')}<br>
    Sauter ${k('jump')} · Mur ${k('buildWall')} · Sol ${k('buildFloor')} · Escalier ${k('buildStairs')} · Cône ${k('buildCone')}<br>
    Modifier ${k('edit')} · Réinitialiser ${k('resetBuild')} · Détruire ${k('demolish')}<br>
    Inventaire ${k('inventory')} · Soins ${k('item1')} ${k('item2')} ${k('item3')}<br>
    Tirer ${k('fire')} · Viser ${k('aim')} · Ramasser ${k('pickup')} · Recharger ${k('reload')} · Armes ${k('slot1')} ${k('slot2')} ${k('slot3')}`;
  // Pastilles des commandes principales sur la page d'accueil
  const chip = (label, a) => `<span class="chip">${label} <b>${keyLabel(keys[a])}</b></span>`;
  $('homeKeys').innerHTML = `<span class="chip">Déplacement <b>${keyLabel(keys.forward)} ${keyLabel(keys.left)} ${keyLabel(keys.back)} ${keyLabel(keys.right)}</b></span>`
    + chip('Tirer', 'fire') + chip('Viser', 'aim') + chip('Sauter', 'jump') + chip('Mur', 'buildWall') + chip('Sol', 'buildFloor')
    + chip('Escalier', 'buildStairs') + chip('Cône', 'buildCone') + chip('Modifier', 'edit') + chip('Inventaire', 'inventory');
}
function saveKeys() { localStorage.setItem('zr_keys', JSON.stringify(keys)); renderKeyHelp(); }

$('sens').oninput = (e) => { sensitivity = +e.target.value; localStorage.setItem('zr_sens', sensitivity); $('sensVal').textContent = sensitivity.toFixed(1); };
$('resetKeys').onclick = () => { keys = { ...DEFAULT_KEYS }; saveKeys(); renderKeyList(); };
let settingsFrom = null;
for (const b of document.querySelectorAll('.openSettings')) {
  b.onclick = () => {
    settingsFrom = $('menu').classList.contains('hidden') ? 'pause' : 'menu';
    $('menu').classList.add('hidden'); $('pause').classList.add('hidden');
    $('settings').classList.remove('hidden');
    renderKeyList();
  };
}
$('closeSettings').onclick = () => {
  listening = null;
  $('settings').classList.add('hidden');
  $(settingsFrom === 'menu' ? 'menu' : 'pause').classList.remove('hidden');
};
renderKeyHelp();

// =====================================================================
// Scène 3D
// =====================================================================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 70, 280);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 700);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 1.0));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
scene.add(sun, sun.target);

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5fa84e';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = `hsl(${95 + Math.random() * 25}, 45%, ${32 + Math.random() * 18}%)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.10)'; // lignes = grille de construction (4 m)
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((S.MAP_HALF * 2) / S.GRID, (S.MAP_HALF * 2) / S.GRID);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Sol de l'arène : dalles claires avec un quadrillage (couleurs différentes de chaque côté)
function arenaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9dde6';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(40,60,110,0.25)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((S.MAP_HALF * 2) / S.GRID, (S.MAP_HALF * 2) / S.GRID);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x2a7fb8 }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.3;
scene.add(sea);

// Tout le décor de la carte vit dans ce groupe : on peut le reconstruire (aperçu de l'accueil, puis vraie carte)
const world = new THREE.Group();
scene.add(world);
const staticAim = []; // objets que le viseur peut toucher
let obstacles = [];
let worldSeed = null;
let worldMap = null;
const roofs = []; // toits : cachés quand on est à l'intérieur pour voir son personnage
function buildWorld(seed, map = 'island') {
  // On efface l'ancien décor
  world.traverse((o) => { o.geometry?.dispose(); });
  world.clear();
  staticAim.length = 0;
  S.setMap(map);
  worldSeed = seed;
  worldMap = map;
  obstacles = S.generateObstacles(seed);
  const arena = map === 'arena';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S.MAP_HALF * 2, S.MAP_HALF * 2),
    new THREE.MeshStandardMaterial({ map: arena ? arenaTexture() : grassTexture() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);
  staticAim.push(ground);
  if (arena) {
    // Deux moitiés colorées (bleu / orange) pour se repérer
    for (const [z, color] of [[S.MAP_HALF / 2, 0x3d7bff], [-S.MAP_HALF / 2, 0xff7a3d]]) {
      const half = new THREE.Mesh(new THREE.PlaneGeometry(S.MAP_HALF * 2, S.MAP_HALF),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
      half.rotation.x = -Math.PI / 2;
      half.position.set(0, 0.02, z);
      world.add(half);
    }
  }
  scene.fog.near = arena ? 120 : 70;
  scene.fog.far = arena ? 400 : 280;
  const arenaWallMat = new THREE.MeshStandardMaterial({ color: 0x1d2a4d, roughness: 0.4, metalness: 0.2 });
  const arenaGlowMat = new THREE.MeshBasicMaterial({ color: 0x46e6ff });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8d8d, flatShading: true });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xb5793e });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4c2f });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, flatShading: true });
  const WALL_COLORS = [0xe8dcc4, 0xc9d6df, 0xf2c6a0, 0xd8e2c0, 0xe0c2c2];
  const ROOF_COLORS = [0x8e3b2f, 0x37474f, 0x6d4c41, 0x2e5d4b, 0x5c3d6e];
  const wallMats = WALL_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c }));
  const roofMats = ROOF_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c }));
  const warehouseMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.3, roughness: 0.6 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8d6e4f });
  roofs.length = 0;
  // Planchers (purement décoratifs)
  for (const b of obstacles.buildings) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.06, b.d), floorMat);
    f.position.set(b.x, 0.03, b.z);
    f.receiveShadow = true;
    world.add(f);
  }
  for (const o of obstacles) {
    let m;
    const y0 = o.y0 || 0;
    if (o.type === 'arenaWall') {
      m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), arenaWallMat);
      m.position.set(o.x, o.h / 2, o.z);
      for (const y of [1.2, o.h - 0.4]) { // bandes lumineuses
        const glow = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.02, 0.15, o.d + 0.02), arenaGlowMat);
        glow.position.y = y - o.h / 2;
        m.add(glow);
      }
    } else if (o.type === 'bwall' || o.type === 'roof') {
      const b = obstacles.buildings[o.b];
      const mat = o.type === 'roof' ? (b.kind === 'warehouse' ? warehouseMat : roofMats[b.color])
        : (b.kind === 'warehouse' ? warehouseMat : wallMats[b.color]);
      m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h - y0, o.d), mat);
      m.position.set(o.x, (y0 + o.h) / 2, o.z);
      if (o.type === 'roof') roofs.push({ mesh: m, b });
    } else if (o.type === 'rock') {
      m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), rockMat);
      m.position.set(o.x, o.h / 2, o.z);
    } else if (o.type === 'crate') {
      m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), crateMat);
      m.position.set(o.x, o.h / 2, o.z);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x5d3a1a })));
    } else {
      m = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.5, 8), trunkMat);
      trunk.position.y = 1.75;
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5.5, 8), leafMat);
      leaves.position.y = 5.5;
      trunk.castShadow = leaves.castShadow = true;
      m.add(trunk, leaves);
      m.position.set(o.x, 0, o.z);
    }
    m.castShadow = true;
    m.receiveShadow = true;
    world.add(m);
    staticAim.push(m);
  }
}

// ---------- Zone ----------
const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 90, 128, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x9b30ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
zoneWall.position.y = 45;
zoneWall.visible = false;
const nextRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
nextRing.rotation.x = -Math.PI / 2;
nextRing.position.y = 0.06;
nextRing.visible = false;
scene.add(zoneWall, nextRing);

// ---------- Joueurs ----------
const bodyGeo = new THREE.CapsuleGeometry(0.42, 0.95, 4, 12);
const visorGeo = new THREE.BoxGeometry(0.5, 0.16, 0.12);
const handGeo = new THREE.SphereGeometry(0.09, 8, 8);
const visorMat = new THREE.MeshStandardMaterial({ color: 0x15151f, roughness: 0.2 });

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.5)';
  x.fillRect(0, 10, 256, 44);
  x.font = 'bold 28px Segoe UI, sans-serif';
  x.textAlign = 'center';
  x.fillStyle = '#fff';
  x.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  s.scale.set(2.2, 0.55, 1);
  s.position.y = 2.4;
  return s;
}

function makePlayerMesh(id, info, isSelf) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(info.color / 360, 0.75, 0.5) }));
  body.position.y = 0.9;
  body.castShadow = true;
  body.userData.playerId = id;
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 1.45, -0.37);
  const gun = new THREE.Group(); // contient le modèle 3D de l'arme en main
  gun.position.set(0.4, 1.15, -0.4);
  gun.scale.setScalar(1.2);
  // Deux "mains" pour tenir l'arme
  const handMat = body.material;
  const handR = new THREE.Mesh(handGeo, handMat); handR.position.set(0.4, 1.06, -0.32);
  const handL = new THREE.Mesh(handGeo, handMat); handL.position.set(0.25, 1.12, -0.7);
  g.add(body, visor, gun, handR, handL);
  if (!isSelf) g.add(makeLabel(info.name));
  g.scale.setScalar(S.PLAYER_HEIGHT / 1.8); // modèle dessiné pour 1,8 m, ramené à la taille du joueur
  scene.add(g);
  return { group: g, body, gun, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, tyaw: 0, alive: true, hp: 100, weapon: '', fresh: true };
}

const roster = new Map(); // id -> { name, color, isBot }
const others = new Map(); // id -> mesh et état interpolé
let selfMesh = null;

// ---------- Constructions ----------
const builds = new Map(); // id -> { data, group }
const woodColor = new THREE.Color(0xd9a966), woodDark = new THREE.Color(0x5d4037);
// Rotation d'une pièce autour de l'axe vertical
function pieceRotation(b) {
  if (b.kind === 'stairs') return S.STAIRS_ROT[b.dir] ?? 0;
  if (b.kind === 'wall' && b.axis === 'z') return Math.PI / 2;
  return 0;
}
// Centre local d'un carré n° i d'une pièce horizontale (2×2) : [x, z] et son u (0..1 le long de la pente)
function quadCenter(i) {
  const u = i >= 2 ? 0.75 : 0.25, v = i % 2 ? 0.75 : 0.25;
  return { lx: v * S.GRID - S.GRID / 2, lz: S.GRID / 2 - u * S.GRID, u, sx: i % 2 ? 1 : -1, sz: i >= 2 ? -1 : 1 };
}
// Morceau de cône (un quart) sous forme de 2 triangles. Les hauteurs viennent de la forme du cône
// (pointe d'origine, ou coins relevés après modification).
function coneQuarterGeo(b, sx, sz) {
  const G = S.GRID / 2;
  const hy = (x, z) => S.coneLocalHeight(b, x, z);
  const C = [0, hy(0, 0), 0], E1 = [G * sx, hy(G * sx, 0), 0], K = [G * sx, hy(G * sx, G * sz), G * sz], E2 = [0, hy(0, G * sz), G * sz];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...C, ...E1, ...K, ...C, ...K, ...E2], 3));
  geo.computeVertexNormals();
  return geo;
}
const SLOPE_ANGLE = Math.atan2(S.WALL_H, S.GRID);
const SLOPE_LEN = Math.hypot(S.GRID, S.WALL_H);
// Construit les formes 3D d'une pièce dans le groupe g (coordonnées locales : base de la pièce en y = 0).
// Chaque carré non retiré (voir b.cut) a ses propres formes.
function addPieceMeshes(g, b, mat) {
  const add = (geo, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = m.receiveShadow = true;
    m.userData.buildId = b.id;
    g.add(m);
  };
  const G = S.GRID, H = S.WALL_H;
  if (b.kind === 'wall') {
    const tw = G / 3;
    for (let i = 0; i < 9; i++) {
      if (S.isCut(b, i)) continue;
      const th = H / 3; // hauteur d'une rangée de carrés
      add(new THREE.BoxGeometry(tw, th, S.WALL_T), -G / 2 + tw * ((i % 3) + 0.5), (Math.floor(i / 3) + 0.5) * th, 0);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      if (b.kind === 'floor' && S.isCut(b, i)) continue; // seuls les sols ont des trous
      const q = quadCenter(i);
      if (b.kind === 'floor') add(new THREE.BoxGeometry(G / 2, 0.2, G / 2), q.lx, -0.1, q.lz);
      else if (b.kind === 'cone') add(coneQuarterGeo(b, q.sx, q.sz), 0, 0, 0);
      else {
        // escalier : 4 marches par moitié + une planche de soutien
        const n = 8, depth = G / n;
        for (let s = 0; s < n; s++) {
          if ((s < 4) !== (i < 2)) continue;
          add(new THREE.BoxGeometry(G / 2, 0.12, depth), q.lx, ((s + 1) * H) / n - 0.06, G / 2 - depth * (s + 0.5));
        }
        add(new THREE.BoxGeometry(G / 2 * 0.9, 0.15, SLOPE_LEN / 2), q.lx, H * q.u - 0.25, q.lz, SLOPE_ANGLE);
      }
    }
  }
  g.rotation.y = pieceRotation(b);
}
function makeBuildMesh(b) {
  const g = new THREE.Group();
  addPieceMeshes(g, b, new THREE.MeshStandardMaterial({ color: woodColor.clone(), flatShading: b.kind === 'cone', side: THREE.DoubleSide }));
  g.position.set(b.x, b.y || 0, b.z);
  scene.add(g);
  return g;
}
function tintBuild(entry) {
  const k = Math.max(0, entry.data.hp / S.WALL_HP);
  entry.group.children[0].material.color.copy(woodDark).lerp(woodColor, k);
}
// Boîte invisible couvrant toute la pièce : permet de viser une pièce même à travers ses trous
// (pour modifier, réinitialiser ou détruire). Elle ne sert pas pour les tirs.
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
function makeHitbox(b) {
  const G = S.GRID, H = S.WALL_H;
  let geo, y = 0, rx = 0;
  if (b.kind === 'wall') { geo = new THREE.BoxGeometry(G, H, S.WALL_T + 0.1); y = H / 2; }
  else if (b.kind === 'floor') { geo = new THREE.BoxGeometry(G, 0.3, G); y = -0.1; }
  else if (b.kind === 'cone') { geo = new THREE.BoxGeometry(G, S.CONE_H, G); y = S.CONE_H / 2; }
  else { geo = new THREE.BoxGeometry(G, 0.3, SLOPE_LEN); y = H / 2; rx = SLOPE_ANGLE; }
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(geo, hitboxMat);
  m.position.y = y;
  m.rotation.x = rx;
  m.userData.buildId = b.id;
  pivot.add(m);
  pivot.position.set(b.x, b.y || 0, b.z);
  pivot.rotation.y = pieceRotation(b);
  scene.add(pivot);
  return pivot;
}
function addBuild(b) {
  removeBuild(b.id);
  const entry = { data: b, group: makeBuildMesh(b), hitbox: makeHitbox(b) };
  builds.set(b.id, entry);
  tintBuild(entry);
}
function removeBuild(id) {
  const e = builds.get(id);
  if (!e) return;
  scene.remove(e.group, e.hitbox);
  e.group.traverse((o) => o.geometry?.dispose());
  e.hitbox.traverse((o) => o.geometry?.dispose());
  builds.delete(id);
}
// Aperçu transparent de la pièce qu'on va poser
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
let ghost = null, ghostKey = '';
function updateGhost(s, ok) {
  const key = `${s.kind}:${s.axis}:${s.dir}`;
  if (key !== ghostKey) {
    if (ghost) scene.remove(ghost);
    ghost = new THREE.Group();
    addPieceMeshes(ghost, { ...s, id: -1, cut: 0 }, ghostMat);
    ghost.traverse((o) => { o.castShadow = false; });
    scene.add(ghost);
    ghostKey = key;
  }
  ghost.visible = true;
  ghost.position.set(s.x, s.y, s.z);
  ghostMat.color.setHex(ok ? 0x4fc3f7 : 0xff5252);
}
function hideGhost() { if (ghost) ghost.visible = false; }

// ---------- Mode modification : une grille de carrés sur la pièce ----------
// Clic maintenu en balayant les carrés = les sélectionner (rouge = sera retiré). Touche "Modifier" = valider.
let edit = null; // { id, kind, cut, group, tiles: [mesh], drag: null | 'add' | 'remove' }
const TILE_KEEP = 0x4fc3f7, TILE_CUT = 0xff3b3b, TILE_PICK = 0xffd23f;
function makeEditOverlay(b) {
  const g = new THREE.Group();
  const tiles = [];
  const G = S.GRID, H = S.WALL_H;
  const n = S.tileCount(b.kind);
  for (let i = 0; i < n; i++) {
    let geo, x, y, z, rx = 0;
    if (b.kind === 'wall') {
      const tw = G / 3;
      geo = new THREE.BoxGeometry(tw - 0.08, H / 3 - 0.08, S.WALL_T + 0.12);
      x = -G / 2 + tw * ((i % 3) + 0.5); y = (Math.floor(i / 3) + 0.5) * (H / 3); z = 0;
    } else {
      const q = quadCenter(i);
      x = q.lx; z = q.lz;
      if (b.kind === 'floor') { geo = new THREE.BoxGeometry(G / 2 - 0.1, 0.32, G / 2 - 0.1); y = -0.1; }
      else if (b.kind === 'cone') { geo = new THREE.BoxGeometry(G / 2 - 0.1, S.CONE_H + 0.2, G / 2 - 0.1); y = S.CONE_H / 2; }
      else { geo = new THREE.BoxGeometry(G / 2 - 0.1, 0.25, SLOPE_LEN / 2 - 0.1); y = H * q.u; rx = SLOPE_ANGLE; }
    }
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.userData.tile = i;
    m.renderOrder = 2;
    g.add(m);
    tiles.push(m);
  }
  g.position.set(b.x, b.y || 0, b.z);
  g.rotation.y = pieceRotation(b);
  scene.add(g);
  return { group: g, tiles };
}
function startEdit(b) {
  buildMode = null;
  // Escalier : on trace un chemin d'un carré à un autre (path). Mur / sol / cône : on choisit des carrés (cut).
  edit = { id: b.id, kind: b.kind, cut: b.kind === 'stairs' ? 0 : b.cut || 0, path: [], drag: null, ...makeEditOverlay(b) };
}
// Escalier : le sens du glissé (du 1er au dernier carré) devient le sens de la montée
function confirmStairsEdit() {
  const b = builds.get(edit.id)?.data;
  const [first, last] = [edit.path[0], edit.path[edit.path.length - 1]];
  if (!b || edit.path.length < 2 || first === last) { edit.path = []; return; } // simple clic : rien ne change
  const p1 = quadCenter(first), p2 = quadCenter(last);
  const lx = p2.lx - p1.lx, lz = p2.lz - p1.lz, th = pieceRotation(b);
  const dx = lx * Math.cos(th) + lz * Math.sin(th), dz = -lx * Math.sin(th) + lz * Math.cos(th); // repère local → monde
  socket.emit('edit', { id: edit.id, dir: S.dirFromVector(dx, dz) });
  closeEdit();
}
function closeEdit() {
  if (!edit) return;
  scene.remove(edit.group);
  edit.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  edit = null;
}
function confirmEdit() {
  if (!edit) return;
  if (edit.kind === 'stairs') { confirmStairsEdit(); return; }
  if (!S.validCut(edit.kind, edit.cut)) {
    showFlash(`<small>${edit.kind === 'cone' ? 'Choisis au plus 3 coins' : 'Il faut garder au moins un carré'}</small>`, 1200);
    return;
  }
  socket.emit('edit', { id: edit.id, cut: edit.cut });
  closeEdit();
}
// Appelé à chaque image pendant la modification
function updateEdit() {
  const e = builds.get(edit.id);
  if (!e || !me.alive || Math.hypot(e.data.x - me.x, e.data.z - me.z) > 12) { closeEdit(); return; }
  const hit = aimHits(edit.tiles)[0];
  const hover = hit ? hit.object.userData.tile : -1;
  if (isPressed('fire') && hover >= 0) {
    if (edit.kind === 'stairs') {
      // Escalier : on mémorise le chemin parcouru par le viseur
      if (!edit.drag) { edit.drag = 'path'; edit.path = []; }
      if (edit.path[edit.path.length - 1] !== hover) edit.path.push(hover);
    } else {
      const isCutNow = (edit.cut >> hover) & 1;
      if (!edit.drag) edit.drag = isCutNow ? 'remove' : 'add'; // le 1er carré décide : sélectionner ou désélectionner
      if (edit.drag === 'add') edit.cut |= 1 << hover; else edit.cut &= ~(1 << hover);
    }
  }
  if (!isPressed('fire') && edit.drag) {
    // Clic relâché : la modification s'applique tout de suite, sans confirmer
    edit.drag = null;
    confirmEdit();
    if (!edit) return;
  }
  // Couleurs : rouge = carré retiré (mur, sol) ; jaune = coin relevé (cône) ou chemin tracé (escalier)
  const pickColor = edit.kind === 'wall' || edit.kind === 'floor' ? TILE_CUT : TILE_PICK;
  edit.tiles.forEach((m, i) => {
    const on = edit.kind === 'stairs' ? edit.path.includes(i) : (edit.cut >> i) & 1;
    m.material.color.setHex(on ? pickColor : TILE_KEEP);
    m.material.opacity = i === hover ? 0.8 : on ? 0.55 : edit.kind === 'cone' ? 0.22 : 0.35;
  });
}

// ---------- Objets au sol ----------
const pickups = new Map(); // id -> { data, mesh }
const smallBox = new THREE.BoxGeometry(0.55, 0.55, 0.55);
const beamGeo = new THREE.CylinderGeometry(0.08, 0.08, 6, 6, 1, true);
// Modèles 3D des objets de soin : fioles (petite / grosse) et trousse de soins
const glassMat = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, transparent: true, opacity: 0.85, roughness: 0.15 });
const corkMat = new THREE.MeshStandardMaterial({ color: 0x8d6e4f });
function makeItemModel(item) {
  const g = new THREE.Group();
  const color = S.ITEMS[item].color;
  if (item === 'medkit') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.5), new THREE.MeshStandardMaterial({ color: 0xf5f5f5 }));
    const red = new THREE.MeshBasicMaterial({ color: 0xe53935 });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.52), red); c1.position.y = 0.0;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.52), red);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    handle.position.y = 0.26;
    box.castShadow = true;
    g.add(box, c1, c2, handle);
  } else {
    const big = item === 'big';
    const r = big ? 0.32 : 0.2;
    const flask = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), glassMat(color));
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.4, r * 0.9, 10), glassMat(color));
    neck.position.y = r * 1.1;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.38, r * 0.38, r * 0.35, 10), corkMat);
    cork.position.y = r * 1.65;
    flask.castShadow = true;
    g.add(flask, neck, cork);
  }
  return g;
}

function addPickup(p) {
  removePickup(p.id);
  const color = p.kind === 'weapon' ? S.WEAPONS[p.weapon].color
    : p.kind === 'item' ? S.ITEMS[p.item]?.color ?? 0xffffff : S.PICKUP_INFO[p.kind]?.color ?? 0xffffff;
  const g = new THREE.Group();
  let m;
  if (p.kind === 'weapon') {
    m = new THREE.Group();
    const model = makeWeaponModel(p.weapon);
    model.scale.setScalar(1.6);
    model.rotation.z = 0.25;
    m.add(model);
  } else if (p.kind === 'item' && S.ITEMS[p.item]) {
    m = makeItemModel(p.item);
  } else {
    m = new THREE.Mesh(smallBox, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
    m.castShadow = true;
  }
  g.add(m);
  if (p.kind === 'weapon') {
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = 3;
    g.add(beam);
  }
  g.position.set(p.x, 0.6, p.z);
  g.userData.phase = Math.random() * 6;
  scene.add(g);
  pickups.set(p.id, { data: p, mesh: g });
}
function removePickup(id) {
  const e = pickups.get(id);
  if (!e) return;
  scene.remove(e.mesh);
  pickups.delete(id);
}
function clearPickups() { for (const id of [...pickups.keys()]) removePickup(id); }

// ---------- Traînées de balles et sons ----------
const tracers = [];
function addTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffee88 }));
  spark.position.copy(to);
  scene.add(spark);
  tracers.push({ line, spark, life: 0.12 });
}

// Petit éclair jaune au bout du canon
const flashGeo = new THREE.SphereGeometry(0.16, 8, 8);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9 });
function muzzleFlash(pos) {
  const m = new THREE.Mesh(flashGeo, flashMat);
  m.position.copy(pos);
  scene.add(m);
  setTimeout(() => scene.remove(m), 50);
}

let actx = null;
let noiseBuf = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new AudioContext();
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.4, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { actx = null; }
}
const SOUND = { pistol: [1800, 0.12], rifle: [1300, 0.09], shotgun: [700, 0.25], sniper: [500, 0.35] };
function shotSound(weapon, dist) {
  if (!actx) return;
  const vol = Math.max(0, 1 - dist / 140) * 0.35;
  if (vol < 0.01) return;
  const [freq, len] = SOUND[weapon] || SOUND.pistol;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + len);
  src.connect(f).connect(g).connect(actx.destination);
  src.start();
  src.stop(actx.currentTime + len);
}

// =====================================================================
// État du jeu
// =====================================================================
let myId = null;
let joined = false;
const me = { x: 0, y: 0, z: 0, vy: 0, onGround: true, yaw: 0, pitch: -0.1, alive: true, spectator: false, hp: 100, shield: 0, slots: [], cur: 0, ammo: 0, mats: 0, reload: 0, kills: 0 };
let matchInfo = { s: 'lobby', timer: 10, alive: 0, total: 0 };
let zone = null;
let buildMode = null; // null, ou la pièce choisie : 'wall' | 'floor' | 'stairs' | 'cone'
let wantJump = false;
let locked = false;
const pressed = new Set();
let lastShotT = 0;
let flash = null; // message temporaire au centre { html, until }
let endText = '';
let deathText = '';
let spectateId = null;
let lastHp = 100;
let respawnMode = false; // réapparition infinie (pas de zone)
let leaderboard = [];

const isPressed = (action) => pressed.has(keys[action]);
const showFlash = (html, ms = 2500) => { flash = { html, until: performance.now() + ms }; };

function blockingBoxes() {
  const boxes = obstacles.slice();
  for (const { data } of builds.values()) boxes.push(...S.buildBoxes(data));
  return boxes;
}
function slopes() {
  const list = [];
  for (const { data } of builds.values()) if (S.isSlope(data)) list.push(data);
  return list;
}

// =====================================================================
// Réseau
// =====================================================================
let joinedSeed = null; // carte de la partie rejointe (pour détecter un redémarrage du serveur)
let gameMode = chosenMode;

function joinGame() {
  initAudio();
  const name = $('name').value.trim() || 'Joueur' + Math.floor(Math.random() * 1000);
  localStorage.setItem('zr_name', name);
  socket.emit('join', { name });
}
// Clic sur "Jouer" d'un mode : on rejoint directement si c'est le serveur déjà connecté,
// sinon on recharge la page connectée à l'autre mode, qui rejoint automatiquement.
for (const b of document.querySelectorAll('[data-play]')) {
  b.onclick = () => {
    const m = b.dataset.play;
    localStorage.setItem('zr_name', $('name').value.trim());
    if (m === chosenMode) joinGame();
    else location.href = `${location.pathname}?mode=${m}&play=1`;
  };
}
$('name').value = localStorage.getItem('zr_name') || '';
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.querySelector(`[data-play="${chosenMode}"]`).click(); });
document.querySelector(`.mode-card[data-mode="${chosenMode}"]`)?.classList.add('selected');
if (params.get('play')) socket.once('connect', joinGame);

// État des serveurs affiché sur les cartes de mode
async function refreshModeStatus() {
  for (const m of MODES) {
    const el = document.querySelector(`[data-status="${m}"]`);
    const btn = document.querySelector(`[data-play="${m}"]`);
    try {
      const info = await (await fetch(modeUrl(m) + '/mode', { cache: 'no-store' })).json();
      const full = info.humans >= info.maxHumans;
      el.className = 'mode-status online';
      el.textContent = m === '1v1'
        ? (full ? 'Arène occupée (2/2)' : info.humans ? '1 joueur attend un adversaire' : 'En ligne · arène libre')
        : `En ligne · ${info.humans} joueur${info.humans > 1 ? 's' : ''}`;
      btn.disabled = full;
    } catch {
      el.className = 'mode-status offline';
      el.textContent = 'Serveur arrêté (lance « npm start »)';
      btn.disabled = true;
    }
  }
}
refreshModeStatus();
const statusTimer = setInterval(() => { if (joined) clearInterval(statusTimer); else refreshModeStatus(); }, 4000);

// Aperçu 3D derrière l'accueil : la carte du mode choisi
buildWorld(12345, chosenMode === '1v1' ? 'arena' : 'island');

socket.on('full', () => alert(gameMode === '1v1'
  ? "L'arène 1v1 est déjà occupée par deux joueurs. Réessaie dans un moment !"
  : 'La partie est pleine (50 joueurs maximum).'));

$('backHome').onclick = () => { location.href = location.pathname + (chosenMode !== 'libre' ? `?mode=${chosenMode}` : ''); };

socket.on('init', (d) => {
  if (joinedSeed !== null && joinedSeed !== d.seed) { location.reload(); return; } // le serveur a redémarré
  joinedSeed = d.seed;
  if (worldSeed !== d.seed || worldMap !== (d.map || 'island')) buildWorld(d.seed, d.map || 'island');
  myId = d.id;
  gameMode = d.mode || 'libre';
  respawnMode = !!d.respawn;
  for (const b of document.querySelectorAll('[data-bots], #removeBots')) b.classList.toggle('hidden', gameMode === '1v1');
  joined = true;
  Object.assign(me, { x: d.x, z: d.z, yaw: d.yaw });
  for (const id of [...builds.keys()]) removeBuild(id);
  d.builds.forEach(addBuild);
  clearPickups();
  d.pickups.forEach(addPickup);
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  lockPointer();
  updateOverlays();
});

socket.on('roster', (list) => {
  const ids = new Set(list.map((p) => p.id));
  roster.clear();
  for (const p of list) roster.set(p.id, p);
  for (const [id, o] of others) if (!ids.has(id)) { scene.remove(o.group); others.delete(id); }
  for (const p of list) {
    if (p.id === myId) { if (!selfMesh) selfMesh = makePlayerMesh(p.id, p, true); }
    else if (!others.has(p.id)) others.set(p.id, makePlayerMesh(p.id, p, false));
  }
});

socket.on('state', (st) => {
  matchInfo = st.m;
  leaderboard = st.lb || [];
  zone = st.z;
  for (const [id, x, z, yaw, pitch, hp, shield, alive, weapon, y] of st.p) {
    if (id === myId) {
      if (selfMesh) setWeaponColor(selfMesh, weapon);
      continue;
    }
    const o = others.get(id);
    if (!o) continue;
    o.tx = x; o.tz = z; o.ty = y || 0; o.tyaw = yaw; o.hp = hp; o.alive = !!alive;
    if (o.fresh) { o.x = x; o.z = z; o.y = o.ty; o.yaw = yaw; o.fresh = false; }
    setWeaponColor(o, weapon);
  }
});
function setWeaponColor(o, weapon) {
  if (o.weapon === weapon) return;
  o.weapon = weapon;
  o.gun.clear();
  o.muzzle = null;
  if (weapon) {
    const model = makeWeaponModel(weapon);
    o.gun.add(model);
    o.muzzle = model.userData.muzzle;
  }
}

socket.on('me', (d) => {
  const wasAlive = me.alive;
  Object.assign(me, d);
  if (me.hp < lastHp && me.alive) { $('damage').classList.add('on'); setTimeout(() => $('damage').classList.remove('on'), 60); }
  lastHp = me.hp;
  if (wasAlive && !me.alive) { buildMode = null; closeEdit(); }
  if (!wasAlive && me.alive && respawnMode && deathText) { deathText = ''; spectateId = null; showFlash('De retour !<small>2 secondes de protection</small>', 1500); }
});

socket.on('teleport', (d) => {
  me.x = d.x; me.z = d.z;
  if (d.y !== undefined) { me.y = d.y; me.vy = 0; }
  if (d.yaw !== undefined) me.yaw = d.yaw;
});

socket.on('shot', (s) => {
  const shooter = s.id === myId ? selfMesh : others.get(s.id);
  const from = new THREE.Vector3(...s.o);
  if (shooter?.muzzle) shooter.muzzle.getWorldPosition(from);
  else if (shooter) shooter.gun.getWorldPosition(from);
  if (shooter) muzzleFlash(from);
  const color = S.WEAPONS[s.w]?.color ?? 0xffffff;
  for (const t of s.t) addTracer(from, new THREE.Vector3(...t), color);
  shotSound(s.w, Math.hypot(s.o[0] - me.x, s.o[2] - me.z));
});

socket.on('hit', () => {
  const h = $('hitmarker');
  h.classList.add('on');
  setTimeout(() => h.classList.remove('on'), 80);
  if (actx) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 1400;
    g.gain.setValueAtTime(0.08, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.08);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.08);
  }
});

socket.on('kill', (k) => {
  const div = document.createElement('div');
  div.textContent = k.killer
    ? `${k.killer} a éliminé ${k.victim} (${k.cause})`
    : `${k.victim} a été éliminé par la zone`;
  if (k.victimId === myId || k.killerId === myId) div.style.color = '#ffb703';
  $('killfeed').prepend(div);
  setTimeout(() => div.remove(), 6000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  if (k.victimId === myId) {
    deathText = k.respawn
      ? `Éliminé ${k.killer ? 'par ' + k.killer : ''}<small>Réapparition dans RESPAWN_S s, à un endroit au hasard</small>`
      : `Éliminé ! Place n°${k.placement}<small>${k.killer ? 'par ' + k.killer : 'par la zone'} · Clic pour regarder un autre joueur</small>`;
    spectateId = k.killerId;
  }
  if (k.killerId === myId) showFlash(`Élimination !<small>${k.victim}</small>`, 1500);
});

socket.on('matchStart', () => {
  buildMode = null; deathText = ''; endText = ''; spectateId = null;
  for (const o of others.values()) o.fresh = true;
  for (const id of [...builds.keys()]) removeBuild(id);
  showFlash('La partie commence !<small>Reste dans la zone et sois le dernier debout</small>', 3000);
});
socket.on('matchEnd', (e) => {
  endText = e.winnerId === myId
    ? `VICTOIRE !<small>Tu es le dernier survivant (${e.kills} éliminations)</small>`
    : `${e.winner} est le dernier survivant !<small>Nouvelle manche dans quelques secondes</small>`;
});
socket.on('lobby', () => {
  endText = ''; deathText = ''; spectateId = null;
  for (const o of others.values()) o.fresh = true;
  showFlash("Retour au salon d'attente", 2000);
});

socket.on('buildAdd', addBuild);
socket.on('buildRemove', removeBuild);
socket.on('buildsReset', () => { for (const id of [...builds.keys()]) removeBuild(id); });
socket.on('buildHp', ({ id, hp }) => { const e = builds.get(id); if (e) { e.data.hp = hp; tintBuild(e); } });
socket.on('buildUpdate', ({ id, cut, dir }) => { const e = builds.get(id); if (e) addBuild({ ...e.data, cut, ...(dir ? { dir } : {}) }); });
socket.on('pickupAdd', addPickup);
socket.on('pickupRemove', removePickup);
socket.on('pickupsReset', (list) => { clearPickups(); list.forEach(addPickup); });

socket.on('disconnect', () => showFlash('Connexion au serveur perdue…', 1e9));
socket.on('connect', () => { if (joined) location.reload(); }); // reconnexion après coupure : on recharge

// Envoi de notre position 20 fois par seconde
setInterval(() => {
  if (joined && me.alive) socket.emit('input', { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch });
}, 50);

// =====================================================================
// Contrôles
// =====================================================================
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) pressed.clear();
  updateOverlays();
});
$('resume').onclick = () => { initAudio(); lockPointer(); };
for (const b of document.querySelectorAll('[data-bots]')) b.onclick = () => socket.emit('addBots', +b.dataset.bots);
$('removeBots').onclick = () => socket.emit('removeBots');

function updateOverlays() {
  const inSettings = !$('settings').classList.contains('hidden');
  $('pause').classList.toggle('hidden', !joined || locked || inSettings || invOpen);
}

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const k = 0.0011 * sensitivity * (camera.fov / BASE_FOV); // souris plus lente quand on zoome
  me.yaw -= e.movementX * k;
  me.pitch = Math.max(-1.2, Math.min(1.1, me.pitch - e.movementY * k));
});

// Enregistre la touche / le bouton choisi dans les paramètres
function assignBinding(code) {
  lastAssign = performance.now();
  if (code !== 'Escape') {
    const other = Object.keys(keys).find((a) => keys[a] === code && a !== listening);
    if (other) keys[other] = keys[listening]; // échange si la touche était déjà utilisée
    keys[listening] = code;
    saveKeys();
  }
  listening = null;
  renderKeyList();
}

function cycleWeapon(dir) {
  for (let i = 1; i <= 3; i++) {
    const s = (me.cur + dir * i + 3) % 3;
    if (me.slots[s]) { switchSlot(s); break; }
  }
}

// Une touche, un bouton de souris ou un cran de molette vient d'être actionné : on lance l'action liée
function triggerAction(code) {
  const is = (a) => keys[a] === code;
  if (is('fire') && !me.alive) { cycleSpectate(); return; }
  if (!me.alive) return;
  const piece = { buildWall: 'wall', buildFloor: 'floor', buildStairs: 'stairs', buildCone: 'cone' };
  const pa = Object.keys(piece).find(is);
  if (is('edit')) { // ouvrir la grille de modification, ou valider si elle est déjà ouverte
    if (edit) closeEdit(); // les changements sont déjà appliqués au relâchement du clic
    else { const b = buildInSight(); if (b) startEdit(b); }
    return;
  }
  if (edit) { // pendant la modification, le clic sert à choisir les carrés (géré à chaque image)
    if (is('resetBuild')) { edit.cut = 0; confirmEdit(); } // tout remettre, appliqué tout de suite
    else if (pa) { closeEdit(); buildMode = piece[pa]; }
    return;
  }
  if (pa) buildMode = piece[pa]; // on reste en construction (pour reprendre l'arme : touches d'arme ou molette)
  else if (is('fire')) { if (buildMode) { placeBuild(true); lastBuildT = performance.now(); } else tryShoot(performance.now()); }
  else if (is('jump')) wantJump = true;
  else if (is('reload')) socket.emit('reload');
  else if (is('pickup')) socket.emit('pickup');
  else if (is('slot1')) switchSlot(0);
  else if (is('slot2')) switchSlot(1);
  else if (is('slot3')) switchSlot(2);
  else if (is('inventory')) openInventory();
  else if (is('item1')) useItem(S.ITEM_ORDER[0]);
  else if (is('item2')) useItem(S.ITEM_ORDER[1]);
  else if (is('item3')) useItem(S.ITEM_ORDER[2]);
  else if (is('nextWeapon')) cycleWeapon(1);
  else if (is('prevWeapon')) cycleWeapon(-1);
  else if (is('demolish')) { const b = buildInSight(); if (b) socket.emit('demolish', b.id); }
  else if (is('resetBuild')) { // remet à neuf la pièce visée, sans ouvrir la grille
    const b = buildInSight();
    if (b?.cut) socket.emit('edit', { id: b.id, cut: 0 });
  }
}

document.addEventListener('mousedown', (e) => {
  const code = 'Mouse' + e.button;
  if (listening) { e.preventDefault(); assignBinding(code); return; }
  if (invOpen && code === keys.inventory) { e.preventDefault(); closeInventory(); return; }
  if (!locked) return;
  e.preventDefault();
  pressed.add(code);
  triggerAction(code);
});
document.addEventListener('mouseup', (e) => {
  pressed.delete('Mouse' + e.button);
  if (locked || listening) e.preventDefault(); // empêche les boutons 4/5 de faire "page précédente"
});
document.addEventListener('contextmenu', (e) => { if (locked || listening) e.preventDefault(); });
document.addEventListener('wheel', (e) => {
  if (!e.deltaY) return;
  const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  if (listening) { e.preventDefault(); assignBinding(code); return; }
  if (locked) triggerAction(code);
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (listening) { e.preventDefault(); assignBinding(e.code); return; }
  if (invOpen) { // inventaire ouvert : sa touche ou Échap le ferme ; 4/5/6 utilisent toujours les soins
    if (e.code === keys.inventory || e.code === 'Escape') { e.preventDefault(); closeInventory(); }
    else { const i = ['item1', 'item2', 'item3'].findIndex((a) => keys[a] === e.code); if (i >= 0) useItem(S.ITEM_ORDER[i]); }
    return;
  }
  if (!locked) return;
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  pressed.add(e.code);
  triggerAction(e.code);
});
document.addEventListener('keyup', (e) => pressed.delete(e.code));

// ---------- Soins et inventaire ----------
function useItem(it) {
  if (!me.alive || !it) return;
  if (!(me.items?.[it] > 0)) { showFlash(`<small>Plus de ${S.ITEMS[it].name.toLowerCase()}</small>`, 900); return; }
  buildMode = null;
  socket.emit('useItem', it);
}
socket.on('itemRefused', (it) => showFlash(`<small>${S.ITEMS[it].name} : inutile pour l'instant (${it === 'medkit' ? 'vie pleine' : 'bouclier plein'})</small>`, 1300));

let invOpen = false;
function openInventory() {
  if (!joined) return;
  invOpen = true;
  buildMode = null;
  closeEdit();
  pressed.clear();
  $('inventory').classList.remove('hidden');
  renderInventory(true);
  document.exitPointerLock?.(); // libère la souris pour cliquer
}
function closeInventory() {
  invOpen = false;
  $('inventory').classList.add('hidden');
  lockPointer();
  updateOverlays();
}
$('closeInventory').onclick = closeInventory;
let lastInvHtml = '';
function renderInventory(force = false) {
  if (!invOpen) return;
  $('invKey').textContent = `(${keyLabel(keys.inventory)})`;
  $('invStats').innerHTML = `<span>❤ ${me.hp}</span><span>🛡 ${me.shield}</span>`;
  let w = '';
  for (let i = 0; i < 3; i++) {
    const s = me.slots[i];
    const def = s && S.WEAPONS[s.type];
    const color = def ? '#' + def.color.toString(16).padStart(6, '0') : '#888';
    w += s
      ? `<button class="inv-slot${i === me.cur ? ' cur' : ''}" data-slot="${i}"><span class="top"><span>${keyLabel(keys['slot' + (i + 1)])}</span>${i === me.cur ? '<span>en main</span>' : ''}</span>`
        + `<span class="name" style="color:${color}">${def.name}</span><span class="desc">Chargeur ${s.mag} / ${def.mag} · dégâts ${def.damage}${def.pellets > 1 ? ' × ' + def.pellets : ''}</span></button>`
      : `<button class="inv-slot" disabled><span class="top"><span>${keyLabel(keys['slot' + (i + 1)])}</span></span><span class="name">Vide</span><span class="desc">Ramasse une arme au sol</span></button>`;
  }
  let it = '';
  S.ITEM_ORDER.forEach((k, i) => {
    const def = S.ITEMS[k], n = me.items?.[k] || 0;
    it += `<button class="inv-slot" data-item="${k}" ${n ? '' : 'disabled'}><span class="top"><span>${keyLabel(keys['item' + (i + 1)])}</span><span class="cnt">${n} / ${def.max}</span></span>`
      + `<span class="name"><span class="ico">${def.icon}</span> ${def.name}</span><span class="desc">${def.desc} · ${def.time} s</span></button>`;
  });
  const html = w + '|' + it;
  if (!force && html === lastInvHtml) return; // on ne redessine que si quelque chose a changé
  lastInvHtml = html;
  $('invWeapons').innerHTML = w;
  $('invItems').innerHTML = it;
  $('invAmmo').innerHTML = `🎯 Munitions : <b>${me.ammo}</b> &nbsp; · &nbsp; 🪵 Matériaux : <b>${me.mats < 0 ? '∞' : me.mats}</b>`;
}
$('invWeapons').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b) switchSlot(+b.dataset.slot); });
$('invItems').addEventListener('click', (e) => { const b = e.target.closest('[data-item]'); if (b) useItem(b.dataset.item); });

function switchSlot(i) {
  buildMode = null;
  socket.emit('switch', i);
}

const raycaster = new THREE.Raycaster();
// Caméra : position par-dessus l'épaule, normale (hanche) ou en visée (plus proche)
const BASE_FOV = 70;
const HIP_OFFSET = new THREE.Vector3(0.9, 0.35, 3.6);
const AIM_OFFSET = new THREE.Vector3(0.6, 0.2, 1.7);
const camOffset = HIP_OFFSET.clone();
let aiming = false; // clic droit maintenu
let aimT = 0;       // 0 = hanche, 1 = visée complète (transition douce)
function aimHits(targets) {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.near = camOffset.length(); // ignore ce qui est entre la caméra et le joueur
  raycaster.far = 400;
  return raycaster.intersectObjects(targets, true);
}
function aimPoint() {
  const targets = [...staticAim];
  for (const e of builds.values()) targets.push(e.group);
  for (const o of others.values()) if (o.group.visible) targets.push(o.body);
  const hit = aimHits(targets)[0];
  if (hit) return hit.point;
  return raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(300));
}
function buildInSight() {
  const hit = aimHits([...builds.values()].map((e) => e.hitbox))[0];
  if (!hit || hit.distance > 14) return null;
  const e = builds.get(hit.object.userData.buildId);
  if (!e) return null;
  if (e.data.owner !== myId) { showFlash('<small>Tu ne peux modifier que tes propres constructions</small>', 1200); return null; }
  return e.data;
}

function tryShoot(t) {
  const w = me.slots[me.cur];
  if (!w || me.reload > 0) return;
  const def = S.WEAPONS[w.type];
  if (t - lastShotT < 1000 / def.rate) return;
  if (w.mag <= 0) { socket.emit('reload'); return; }
  lastShotT = t;
  const eye = new THREE.Vector3(me.x, me.y + S.EYE_HEIGHT, me.z);
  const p = aimPoint();
  let d = p.clone().sub(eye);
  if (d.length() < 1.5) camera.getWorldDirection(d);
  d.normalize();
  socket.emit('shoot', [d.x, d.y, d.z], aiming);
}

function currentSlot() { return S.buildSlot(buildMode, me.x, me.y, me.z, me.yaw, me.pitch); }
function slotTaken(s) {
  const k = S.buildKey(s);
  for (const { data } of builds.values()) if (S.buildKey(data) === k) return true;
  return false;
}
const canAfford = () => me.mats < 0 || me.mats >= S.BUILD_COST; // mats = -1 : illimités
let lastBuildT = 0;
let lastSentKey = '';
function placeBuild(firstClick = false) {
  const s = currentSlot();
  if (!canAfford()) { if (firstClick) showFlash('<small>Pas assez de matériaux</small>', 1000); return; }
  const k = S.buildKey(s);
  if (slotTaken(s) || (!firstClick && k === lastSentKey)) return; // en turbo : pas deux fois le même emplacement
  lastSentKey = k;
  socket.emit('build', s);
}

function cycleSpectate() {
  const alive = [...others.entries()].filter(([, o]) => o.alive).map(([id]) => id);
  if (!alive.length) return;
  const i = alive.indexOf(spectateId);
  spectateId = alive[(i + 1) % alive.length];
}

// =====================================================================
// Boucle de jeu
// =====================================================================
let lastT = performance.now();
let hudTimer = 0;
const camQuat = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (!joined) {
    // Écran d'accueil : la caméra tourne lentement au-dessus de la carte
    // (décalée vers la droite pour laisser la place au titre)
    const R = worldMap === 'arena' ? 38 : 95, Hc = worldMap === 'arena' ? 20 : 42;
    camera.position.set(Math.cos(t / 12000) * R, Hc, Math.sin(t / 12000) * R);
    camera.lookAt(0, worldMap === 'arena' ? 0 : 6, 0);
    sun.position.set(60, 120, 40);
    sun.target.position.set(0, 0, 0);
    renderer.render(scene, camera);
    return;
  }

  // --- Visée (clic droit maintenu) : zoom, caméra plus proche, lunette pour le sniper ---
  const held = me.slots[me.cur];
  aiming = locked && me.alive && !buildMode && !edit && !!held && isPressed('aim');
  aimT += ((aiming ? 1 : 0) - aimT) * Math.min(1, dt * 14);
  const aimFov = held ? S.WEAPONS[held.type].aimFov : BASE_FOV;
  const fov = BASE_FOV + (aimFov - BASE_FOV) * aimT;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camOffset.lerpVectors(HIP_OFFSET, AIM_OFFSET, aimT);
  const scoped = aiming && aimT > 0.85 && !!S.WEAPONS[held.type].scope;
  $('scope').classList.toggle('on', scoped);
  $('crosshair').classList.toggle('aim', aiming);

  // --- Déplacement local ---
  if (me.alive) {
    const boxes = blockingBoxes(), sl = slopes();
    if (locked) {
      const [fx, fz] = S.forwardOf(me.yaw);
      const rx = -fz, rz = fx; // vecteur "droite"
      let mx = 0, mz = 0;
      if (isPressed('forward')) { mx += fx; mz += fz; }
      if (isPressed('back')) { mx -= fx; mz -= fz; }
      if (isPressed('right')) { mx += rx; mz += rz; }
      if (isPressed('left')) { mx -= rx; mz -= rz; }
      const l = Math.hypot(mx, mz);
      if (l > 0) {
        const sp = (aiming ? S.WALK_SPEED * 0.55 : isPressed('sprint') && isPressed('forward') ? S.SPRINT_SPEED : S.WALK_SPEED) * dt;
        [me.x, me.z] = S.moveWithCollisions(me.x, me.z, (mx / l) * sp, (mz / l) * sp, me.y, boxes, sl);
      }
      if (isPressed('fire') && !buildMode && !edit) {
        const w = me.slots[me.cur];
        if (w && S.WEAPONS[w.type].auto) tryShoot(t);
      }
    }
    // Gravité, saut, escaliers
    const ground = S.groundAt(me.x, me.z, me.y, boxes, sl);
    if (wantJump && me.onGround) { me.vy = S.JUMP_SPEED; me.onGround = false; }
    wantJump = false;
    if (me.onGround && me.vy <= 0 && me.y - ground < 0.45) {
      me.y = ground; me.vy = 0; // colle au sol, monte et descend les escaliers en douceur
    } else {
      me.vy -= S.GRAVITY * dt;
      me.y += me.vy * dt;
      const ceil = S.ceilingAt(me.x, me.z, me.y - me.vy * dt, boxes);
      if (me.vy > 0 && me.y + S.PLAYER_HEIGHT > ceil) { me.y = ceil - S.PLAYER_HEIGHT; me.vy = 0; } // tête contre un plafond
      me.onGround = false;
      if (me.y <= ground) { me.y = ground; me.vy = 0; me.onGround = true; }
    }
  }

  // --- Autres joueurs (interpolation douce) ---
  const k = Math.min(1, dt * 12);
  for (const o of others.values()) {
    o.x += (o.tx - o.x) * k;
    o.z += (o.tz - o.z) * k;
    o.y += ((o.ty || 0) - (o.y || 0)) * k;
    o.yaw = angleLerp(o.yaw, o.tyaw, k);
    o.group.position.set(o.x, o.y, o.z);
    o.group.rotation.y = o.yaw;
    o.group.visible = o.alive;
  }
  if (selfMesh) {
    selfMesh.group.position.set(me.x, me.y, me.z);
    selfMesh.group.rotation.y = me.yaw;
    selfMesh.group.visible = me.alive && !scoped; // dans la lunette, on cache son propre personnage
  }

  // --- Caméra à la 3e personne (ou spectateur) ---
  let px = me.x, py = me.y, pz = me.z;
  if (!me.alive) {
    let target = others.get(spectateId);
    if (!target || !target.alive) { cycleSpectate(); target = others.get(spectateId); }
    if (target) { px = target.x; py = target.y || 0; pz = target.z; }
  }
  euler.set(me.pitch, me.yaw, 0);
  camQuat.setFromEuler(euler);
  camera.quaternion.copy(camQuat);
  camera.position.set(px, py + S.PLAYER_HEIGHT * 0.9, pz).add(camOffset.clone().applyQuaternion(camQuat));
  if (camera.position.y < 0.3) camera.position.y = 0.3;
  sun.position.set(px + 60, 120, pz + 40);
  sun.target.position.set(px, 0, pz);
  for (const r of roofs) {
    const b = r.b;
    r.mesh.visible = !(Math.abs(px - b.x) < b.w / 2 + 1 && Math.abs(pz - b.z) < b.d / 2 + 1);
  }

  // --- Zone ---
  if (zone) {
    zoneWall.visible = nextRing.visible = true;
    zoneWall.position.x = zone.cx; zoneWall.position.z = zone.cz;
    zoneWall.scale.set(Math.max(0.01, zone.r), 1, Math.max(0.01, zone.r));
    nextRing.position.x = zone.tcx; nextRing.position.z = zone.tcz;
    nextRing.scale.setScalar(Math.max(0.01, zone.tr));
  } else zoneWall.visible = nextRing.visible = false;

  // --- Construction turbo : clic maintenu = on pose en continu ---
  if (buildMode && me.alive && locked && isPressed('fire') && t - lastBuildT > 70) {
    lastBuildT = t;
    placeBuild();
  }
  if (edit) updateEdit();

  // --- Aperçu de construction ---
  if (buildMode && me.alive) {
    const s = currentSlot();
    updateGhost(s, canAfford() && !slotTaken(s));
  } else hideGhost();

  // --- Objets qui flottent ---
  for (const { mesh } of pickups.values()) {
    mesh.children[0].rotation.y += dt * 1.5;
    mesh.children[0].position.y = Math.sin(t / 400 + mesh.userData.phase) * 0.15;
  }

  // --- Traînées ---
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.life -= dt;
    tr.line.material.opacity = Math.max(0, tr.life / 0.12);
    if (tr.life <= 0) {
      scene.remove(tr.line, tr.spark);
      tr.line.geometry.dispose(); tr.line.material.dispose();
      tr.spark.geometry.dispose(); tr.spark.material.dispose();
      tracers.splice(i, 1);
    }
  }

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.1; updateHud(); drawMinimap(); }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// =====================================================================
// Interface
// =====================================================================
function setText(id, txt) { const el = $(id); if (el.innerHTML !== txt) el.innerHTML = txt; }

function updateHud() {
  setText('aliveCount', matchInfo.s === 'playing' && !respawnMode ? `👤 ${matchInfo.alive} en vie` : `👤 ${matchInfo.total} joueur(s)`);
  setText('leaderboard', respawnMode && matchInfo.s === 'playing'
    ? '<b>🏆 Classement (élim. / morts)</b>' + leaderboard.map(([id, name, k, d], i) =>
      `<div class="row-lb${id === myId ? ' me' : ''}"><span>${i + 1}. ${name}</span><span>${k} / ${d}</span></div>`).join('')
    : '');
  let zt = '';
  if (zone) {
    zt = zone.st === 'wait' ? `Zone ${zone.phase}/${zone.phases} : rétrécit dans ${zone.timer}s`
      : zone.st === 'shrink' ? `⚠ La zone rétrécit ! (${zone.timer}s)` : 'Zone finale';
  } else if (matchInfo.s === 'lobby') zt = "Salon d'attente";
  else if (respawnMode) zt = '♻ Réapparition infinie';
  setText('zoneInfo', zt);

  // Message central
  let center = '';
  if (flash && performance.now() < flash.until) center = flash.html;
  else if (endText) center = endText;
  else if (matchInfo.s === 'lobby') {
    center = matchInfo.total < 2
      ? "En attente d'un autre joueur…<small>Ouvre un 2e onglet, ou appuie sur Échap pour ajouter des bots</small>"
      : `La partie commence dans ${matchInfo.timer}s<small>Échauffe-toi : pas de dégâts dans le salon</small>`;
  } else if (matchInfo.s === 'ended') center = `Fin de la manche<small>Nouvelle manche dans ${matchInfo.timer}s</small>`;
  else if (me.spectator) center = 'Partie en cours<small>Tu es spectateur, tu joueras à la prochaine manche</small>';
  else if (!me.alive && deathText) center = deathText.replace('RESPAWN_S', me.respawnIn || 0);
  setText('center', center);

  $('hpBar').style.width = me.hp + '%';
  $('shieldBar').style.width = me.shield + '%';
  setText('hpTxt', `❤ ${me.hp}`);
  setText('shieldTxt', `🛡 ${me.shield}`);
  setText('mats', `🪵 Matériaux : ${me.mats < 0 ? '∞' : me.mats} &nbsp; · &nbsp; 🎯 Munitions : ${me.ammo} &nbsp; · &nbsp; 💀 ${me.kills}`);

  let slotsHtml = '';
  for (let i = 0; i < 3; i++) {
    const s = me.slots[i];
    const cls = 'slot' + (i === me.cur && !buildMode ? ' cur' : '');
    if (!s) { slotsHtml += `<div class="${cls}"><b>${i + 1}. —</b><span class="ammo">&nbsp;</span></div>`; continue; }
    const def = S.WEAPONS[s.type];
    const color = '#' + def.color.toString(16).padStart(6, '0');
    const rl = i === me.cur && me.reload > 0 ? `<div class="reload" style="width:${Math.min(100, me.reload * 100)}%"></div>` : '';
    slotsHtml += `<div class="${cls}"><b style="color:${color}">${i + 1}. ${def.name}</b><span class="ammo">${s.mag} / ${def.mag}</span>${rl}</div>`;
  }
  setText('slots', slotsHtml);
  // Barre rapide des soins + progression de l'utilisation en cours
  setText('itemBar', S.ITEM_ORDER.map((k, i) => {
    const n = me.items?.[k] || 0;
    return `<div class="item-chip${n ? '' : ' empty'}${me.using?.item === k ? ' active' : ''}"><span class="key">${keyLabel(keys['item' + (i + 1)])}</span>`
      + `<span class="ico">${S.ITEMS[k].icon}</span><span class="cnt">${n}</span></div>`;
  }).join(''));
  $('useBar').classList.toggle('on', !!me.using && me.alive);
  if (me.using) {
    setText('useText', `${S.ITEMS[me.using.item].name}…`);
    $('useFill').style.width = Math.round(me.using.pct * 100) + '%';
  }
  renderInventory();
  $('buildMode').classList.toggle('on', (!!buildMode || !!edit) && me.alive);
  if (edit) {
    const how = {
      wall: 'balaie les carrés à retirer',
      floor: 'balaie les carrés à retirer',
      cone: 'choisis les coins à relever (1 = coin, 2 = pente, 3 = coin creux)',
      stairs: "glisse d'un carré vers un autre : l'escalier montera dans ce sens",
    }[edit.kind];
    setText('buildMode', `MODIFICATION : ${S.PIECE_NAMES[edit.kind].toUpperCase()} — ${keyLabel(keys.fire)} maintenu : ${how}, appliqué en relâchant · `
      + `${keyLabel(keys.resetBuild)} : tout remettre · ${keyLabel(keys.edit)} : fermer`);
  } else if (buildMode) {
    const cost = me.mats < 0 ? 'matériaux illimités' : `${S.BUILD_COST} matériaux`;
    setText('buildMode', `CONSTRUCTION : ${S.PIECE_NAMES[buildMode].toUpperCase()} — ${keyLabel(keys.fire)} : poser, maintenu = turbo (${cost}) · `
      + `${keyLabel(keys.slot1)} ${keyLabel(keys.slot2)} ${keyLabel(keys.slot3)} ou molette : reprendre une arme · regarder en haut / en bas pour changer d'étage`);
  }

  // Indication sous le viseur
  let prompt = '';
  if (me.alive && zone && Math.hypot(me.x - zone.cx, me.z - zone.cz) > zone.r) prompt = '<span style="color:#d580ff">⚠ Tu es hors de la zone !</span>';
  else if (me.alive) {
    let best = null, bd = 3.5;
    for (const { data } of pickups.values()) {
      if (data.kind !== 'weapon') continue;
      const d = Math.hypot(data.x - me.x, data.z - me.z);
      if (d < bd) { bd = d; best = data; }
    }
    if (best) prompt = `[${keyLabel(keys.pickup)}] Ramasser : ${S.WEAPONS[best.weapon].name}`;
  }
  setText('prompt', prompt);

  // Panneau de pause
  setText('pauseTitle', matchInfo.s === 'lobby' ? "Salon d'attente" : 'Pause');
  $('lobbyBox').classList.toggle('hidden', matchInfo.s !== 'lobby');
  setText('lobbyInfo', gameMode === '1v1'
    ? 'Duel 1v1 : le combat commence dans quelques secondes.'
    : `${matchInfo.total} joueur(s) connecté(s), bots compris. La partie démarre dès qu'il y a au moins 2 joueurs.`);
}

const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const W = 180, sc = W / (S.MAP_HALF * 2);
  const tx = (x) => (x + S.MAP_HALF) * sc;
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = '#4f8f43';
  mm.fillRect(0, 0, W, W);
  for (const b of obstacles.buildings || []) {
    mm.fillStyle = b.kind === 'warehouse' ? '#9aa3ab' : '#c9b48f';
    mm.fillRect(tx(b.x - b.w / 2), tx(b.z - b.d / 2), b.w * sc, b.d * sc);
  }
  for (const o of obstacles) {
    if (o.type === 'roof' || o.type === 'bwall') continue;
    mm.fillStyle = o.type === 'tree' ? '#2e5d2a' : o.type === 'rock' ? '#8d8d8d' : '#b5793e';
    mm.fillRect(tx(o.x - o.w / 2), tx(o.z - o.d / 2), Math.max(1.5, o.w * sc), Math.max(1.5, o.d * sc));
  }
  if (zone) {
    // zone dangereuse en violet
    mm.fillStyle = 'rgba(140, 40, 220, 0.45)';
    mm.beginPath();
    mm.rect(0, 0, W, W);
    mm.arc(tx(zone.cx), tx(zone.cz), Math.max(0, zone.r * sc), 0, Math.PI * 2, true);
    mm.fill('evenodd');
    mm.strokeStyle = '#fff';
    mm.setLineDash([4, 3]);
    mm.beginPath();
    mm.arc(tx(zone.tcx), tx(zone.tcz), Math.max(0, zone.tr * sc), 0, Math.PI * 2);
    mm.stroke();
    mm.setLineDash([]);
  }
  // Moi : une flèche jaune
  const [fx, fz] = S.forwardOf(me.yaw);
  const cx = tx(me.x), cy = tx(me.z);
  mm.fillStyle = '#ffd600';
  mm.beginPath();
  mm.moveTo(cx + fx * 7, cy + fz * 7);
  mm.lineTo(cx - fx * 4 - fz * 4, cy - fz * 4 + fx * 4);
  mm.lineTo(cx - fx * 4 + fz * 4, cy - fz * 4 - fx * 4);
  mm.fill();
}

// Capture la souris (le navigateur peut refuser si ce n'est pas suite à un clic : on ignore l'erreur)
function lockPointer() {
  try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* ignoré */ }
}
