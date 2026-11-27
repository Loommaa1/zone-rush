// Modèles 3D des armes, construits avec des formes simples (boîtes et cylindres).
// Chaque modèle pointe vers -z (le canon devant) ; userData.muzzle = bout du canon.
import * as THREE from 'three';
import { WEAPONS } from './shared.js';

const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
const metalLight = new THREE.MeshStandardMaterial({ color: 0x5b616b, metalness: 0.7, roughness: 0.35 });
const wood = new THREE.MeshStandardMaterial({ color: 0x7b4a2a, roughness: 0.8 });
const glass = new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x113355, metalness: 0.2, roughness: 0.1 });
const accents = {};
const accent = (type) => (accents[type] ??= new THREE.MeshStandardMaterial({ color: WEAPONS[type].color, roughness: 0.5 }));

// Petites aides : une boîte ou un cylindre couché le long de z
function box(g, mat, w, h, d, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.castShadow = true;
  g.add(m);
  return m;
}
function tube(g, mat, r, len, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

const BUILDERS = {
  pistol(g, a) {
    box(g, metal, 0.07, 0.09, 0.32, 0, 0.05, -0.1);            // culasse
    box(g, a, 0.075, 0.03, 0.2, 0, 0.0, -0.08);                 // bande de couleur
    box(g, metal, 0.06, 0.17, 0.08, 0, -0.07, 0.03, 0.25);      // poignée
    box(g, metalLight, 0.02, 0.03, 0.02, 0, 0.11, -0.22);       // guidon
    return -0.27;
  },
  rifle(g, a) {
    box(g, metal, 0.08, 0.12, 0.5, 0, 0, -0.1);                 // carcasse
    box(g, a, 0.085, 0.09, 0.3, 0, -0.005, -0.45);              // garde-main
    tube(g, metalLight, 0.022, 0.32, 0, 0.01, -0.74);           // canon
    box(g, metal, 0.06, 0.22, 0.09, 0, -0.15, -0.14, 0.25);     // chargeur
    box(g, metal, 0.05, 0.14, 0.06, 0, -0.11, 0.06, 0.3);       // poignée
    box(g, a, 0.065, 0.11, 0.3, 0, -0.02, 0.3);                 // crosse
    box(g, metal, 0.03, 0.05, 0.16, 0, 0.085, -0.12);           // viseur
    return -0.9;
  },
  shotgun(g, a) {
    box(g, metal, 0.085, 0.12, 0.28, 0, 0, 0);                  // carcasse
    tube(g, metalLight, 0.035, 0.75, 0, 0.03, -0.5);            // canon
    tube(g, metal, 0.028, 0.55, 0, -0.04, -0.4);                // magasin tubulaire
    tube(g, a, 0.048, 0.2, 0, -0.04, -0.38);                    // pompe
    box(g, wood, 0.07, 0.13, 0.36, 0, -0.05, 0.3, -0.12);       // crosse en bois
    box(g, metal, 0.05, 0.12, 0.06, 0, -0.1, 0.1, 0.3);         // poignée
    return -0.88;
  },
  sniper(g, a) {
    box(g, metal, 0.075, 0.11, 0.5, 0, 0, -0.1);                // carcasse
    tube(g, metalLight, 0.02, 0.8, 0, 0.02, -0.75);             // long canon
    tube(g, metal, 0.035, 0.08, 0, 0.02, -1.17);                // frein de bouche
    tube(g, metal, 0.042, 0.36, 0, 0.12, -0.12);                // lunette
    tube(g, glass, 0.036, 0.01, 0, 0.12, -0.305);               // verre avant
    box(g, metal, 0.03, 0.06, 0.03, 0, 0.07, -0.02);            // montages de lunette
    box(g, metal, 0.03, 0.06, 0.03, 0, 0.07, -0.22);
    box(g, a, 0.07, 0.14, 0.42, 0, -0.03, 0.32);                // crosse
    box(g, metal, 0.05, 0.12, 0.07, 0, -0.11, -0.08, 0.2);      // chargeur
    const legL = box(g, metalLight, 0.015, 0.22, 0.015, -0.04, -0.1, -0.6); // bipied
    const legR = box(g, metalLight, 0.015, 0.22, 0.015, 0.04, -0.1, -0.6);
    legL.rotation.z = 0.3; legR.rotation.z = -0.3;
    return -1.22;
  },
};

const templates = {};
export function makeWeaponModel(type) {
  if (!templates[type]) {
    const g = new THREE.Group();
    const muzzleZ = BUILDERS[type](g, accent(type));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, muzzleZ);
    muzzle.name = 'muzzle';
    g.add(muzzle);
    templates[type] = g;
  }
  const clone = templates[type].clone(); // partage géométries et matériaux : léger même à 50 joueurs
  clone.userData.muzzle = clone.getObjectByName('muzzle');
  return clone;
}
