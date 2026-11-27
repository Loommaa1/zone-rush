// Lance les deux modes de jeu en même temps (chacun dans son propre processus Node.js) :
//  - mode libre (grande île) sur le port 3000
//  - mode 1v1 (petite arène) sur le port 3001
// Ctrl + C arrête les deux.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ports = { PORT_LIBRE: process.env.PORT_LIBRE || '3000', PORT_1V1: process.env.PORT_1V1 || '3001' };
const servers = [
  { MODE: 'libre', PORT: ports.PORT_LIBRE },
  { MODE: '1v1', PORT: ports.PORT_1V1 },
];

const children = servers.map((env) => {
  const child = spawn(process.execPath, [path.join(dir, 'server.js')], {
    env: { ...process.env, ...ports, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    console.log(`Le serveur du mode ${env.MODE} s'est arrêté (code ${code}).`);
  });
  return child;
});

console.log(`\nOuvre http://localhost:${ports.PORT_LIBRE} et choisis ton mode sur la page d'accueil.\n`);

const stopAll = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
