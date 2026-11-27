# Zone Rush

Jeu de tir et de construction **3D multijoueur** qui se joue dans le navigateur, avec deux modes.

## Lancer le jeu

Il faut [Node.js](https://nodejs.org) (version 18 ou plus).

```powershell
cd C:\Users\USER\Desktop\zone-rush
npm install
npm start
```

`npm start` lance les **deux modes** en même temps. Ouvre **http://localhost:3000** : la page d'accueil
affiche les deux modes, avec un voyant vert quand leur serveur tourne. Tape ton pseudo et clique sur
**Jouer** dans le mode de ton choix.

| Mode | Carte | Principe | Port |
|---|---|---|---|
| **Mode libre** | Grande île (300 m) avec maisons et entrepôts | Jusqu'à 50 joueurs, bots ajoutés automatiquement, armes à ramasser, réapparition infinie | 3000 |
| **Duel 1v1** | Petite arène fermée (48 m) | 2 combattants : seul, tu affrontes 1 bot ; à deux, vrai 1 contre 1. Tout le monde a fusil à pompe, fusil d'assaut et sniper. Réapparition en 2 s à l'opposé de l'adversaire | 3001 |

Pour lancer un seul mode : `npm run libre` ou `npm run 1v1`.
Dans une partie, **Échap** puis **Retour à l'accueil** pour changer de mode.

En mode libre, la partie démarre 10 secondes après qu'il y a au moins 2 joueurs (bots compris).

**Bots :** dès qu'un vrai joueur se connecte, le serveur ajoute automatiquement 9 bots qui se
déplacent, ramassent des armes et tirent. Ils visent en priorité les vrais joueurs et ripostent
quand on leur tire dessus. Dans le salon (touche **Échap**), tu peux en ajouter ou les retirer.
Pour changer le nombre de bots ajoutés automatiquement (ici 20, ou 0 pour aucun) :

```powershell
$env:BOTS=20; npm start
```

Pour jouer avec quelqu'un sur le même réseau Wi-Fi : il ouvre `http://<ton-adresse-IP>:3000`
(le pare-feu Windows peut demander d'autoriser Node.js pour les ports 3000 et 3001)
(ton adresse IP s'affiche avec la commande `ipconfig`).

## Commandes (modifiables dans « Paramètres et touches »)

| Action | Touche par défaut (QWERTY / AZERTY) |
|---|---|
| Se déplacer | W A S D / Z Q S D |
| Sprinter | Maj gauche |
| Viser / tirer | Souris / clic gauche |
| Mode visée (zoom, balles moins dispersées, lunette au sniper) | Clic droit maintenu |
| Changer d'arme | 1, 2, 3 ou molette |
| Recharger | R |
| Ramasser une arme | E |
| Ouvrir / fermer l'inventaire | Tab |
| Utiliser mini-potion / grosse potion / trousse de soins | 4 / 5 / 6 |
| Sauter | Espace |
| Construire un **mur** | Q / A |
| Construire un **sol** | F |
| Construire un **escalier** | C |
| Construire un **cône** (toit en pointe) | V |
| Poser la pièce choisie (maintenir = construction turbo) | Clic gauche |
| Reprendre une arme (quitter la construction) | 1, 2, 3 ou molette |
| Modifier une construction : ouvrir / fermer la grille | G |
| Réinitialiser la construction visée (sans ouvrir la grille) | T |
| Détruire sa construction | X |
| Pause, bots, paramètres | Échap |

Toutes les actions (y compris Tirer, Arme suivante, Arme précédente) peuvent être assignées à une touche du clavier,
à un bouton de la souris (gauche, droit, molette, boutons latéraux 4 et 5) ou à la molette (haut / bas).
Les réglages sont enregistrés dans le navigateur.

## Règles

- **Mode par défaut : réapparition infinie.** Pas de zone : quand tu es éliminé, tu réapparais 3 s plus tard
  à un endroit au hasard de la carte, avec 2 s de protection. Le classement (en haut à droite) compte
  les éliminations et les morts. Pour jouer en battle royale classique (zone + dernier survivant) :

  ```powershell
  $env:MODE='br'; npm run libre
  ```

- Chacun commence avec un **pistolet** et 60 munitions. Les **matériaux sont illimités** par défaut
  (pour les limiter : `$env:MATS='limited'; npm start`, on commence alors avec 100 matériaux).
- La carte contient des **maisons** et des **entrepôts** (portes, fenêtres, toits) avec du butin garanti à l'intérieur.
- Au sol : **armes** (pistolet, fusil d'assaut, fusil à pompe, sniper — faisceau lumineux de leur couleur),
  **munitions** (jaune) et **objets de soin** :
  - **Mini-potion** (petite fiole bleu clair) : +25 de bouclier, jusqu'à 50, en 1 s (6 max) ;
  - **Grosse potion** (grosse fiole bleue) : +50 de bouclier en 3 s (3 max) ;
  - **Trousse de soins** (boîte blanche à croix rouge) : vie remise à 100 en 6 s (3 max).
  Les soins vont dans l'inventaire (Tab) et s'utilisent avec 4, 5, 6 ou d'un clic dans l'inventaire.
  Tirer ou changer d'arme interrompt le soin. En 1v1, chacun commence avec 2 mini-potions,
  1 grosse potion et 1 trousse.
  Tout sauf les armes se ramasse en marchant dessus.
- Le **bouclier** encaisse les dégâts avant la vie. Un tir dans la tête fait 50 % de dégâts en plus.
- **Construction** : chaque pièce (mur, sol, escalier, cône) se pose sur une grille de 5 m × 4 m de haut
  et se détruit à coups de feu. **Maintiens le clic** pour construire en continu (turbo) en tournant ou en
  avançant. Monte un escalier puis pose un sol pour construire en hauteur (jusqu'à 12 étages).
  Regarde vers le haut pour poser un sol ou un cône à l'étage au-dessus, vers le bas pour poser un sol sous tes pieds.
- **Modification** : vise une de tes constructions et appuie sur **G**. Une grille de carrés apparaît
  (3×3 sur un mur, 2×2 sur un sol, un escalier ou un cône). Maintiens le clic et balaie les carrés :
  la modification s'applique dès que tu relâches le clic, sans confirmer. Touche **T** = tout remettre.
  - **Mur et sol** : les carrés choisis (en rouge) sont retirés. Colonne du milieu en bas d'un mur = une
    porte ; carré central = une fenêtre ; un carré d'un sol = un trou pour descendre. Il faut garder au moins un carré.
  - **Escalier** : glisse d'un carré vers un carré voisin (en jaune) : l'escalier se retourne et monte
    dans ce sens. Il n'a jamais de trou.
  - **Cône** : les carrés choisis (en jaune) deviennent des coins relevés. 1 carré = un coin relevé,
    2 côte à côte = une pente, 2 en diagonale = une arête, 3 = un coin creux. Aucun = la pointe d'origine.
- En mode battle royale, la **zone** (mur violet) rétrécit en 5 phases ; le cercle blanc au sol et sur la mini-carte montre
  la prochaine zone. Hors zone, on perd de la vie, de plus en plus vite.
  Éliminé ? Tu regardes les autres joueurs (clic pour changer). Une nouvelle manche démarre après la victoire.

## Comment c'est fait

| Fichier | Rôle |
|---|---|
| `start.js` | Lanceur : démarre le mode libre (port 3000) et le mode 1v1 (port 3001). |
| `server.js` | Serveur Node.js + Socket.IO d'un mode (variable `MODE` : libre, 1v1 ou br). Il fait autorité : tirs, dégâts, zone, objets, constructions, victoire, et il fait jouer les bots. 20 mises à jour par seconde. |
| `public/shared.js` | Code commun au serveur et au client : armes, génération de la carte et des bâtiments, pièces de construction, collisions, gravité. |
| `public/weapons.js` | Modèles 3D des 4 armes (construits avec des formes simples, sans fichier externe). |
| `public/main.js` | Client : affichage 3D avec Three.js, caméra à la 3e personne, contrôles, interface, mini-carte. |
| `public/index.html`, `public/style.css` | Page et interface (menus, barres de vie, armes…). |

Le client calcule son propre déplacement (pour que ce soit fluide) et l'envoie au serveur, qui refuse
les déplacements trop rapides. Les tirs, eux, sont entièrement vérifiés par le serveur.

## Idées pour la suite

- S'accroupir, modifier les sols et escaliers, constructions plus solides (qui tombent sans appui)
- Un bus / une chute en parachute au début de la partie
- Sons et modèles 3D plus jolis, animations des personnages
- Plusieurs parties en même temps, classement, mise en ligne sur un hébergeur (Render, Railway, Fly.io…)
