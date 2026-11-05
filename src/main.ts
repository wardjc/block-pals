import './ui/styles.css';
import * as THREE from 'three';
import { generateWorld } from './core/worldgen';
import { makePalModel, makePlayerModel } from './render/characters';
import { GameScene } from './render/scene';

// Temporary wiring (Task 4): render the world with a static player and Pip.
const { world, spawn } = generateWorld();
const scene = new GameScene(document.getElementById('game')!, world);

const player = makePlayerModel();
player.position.set(spawn.x + 0.5, spawn.y, spawn.z + 0.5);
scene.add(player);

const pip = makePalModel();
pip.position.set(spawn.x + 1.8, spawn.y, spawn.z + 1.2);
pip.rotation.y = -0.6;
scene.add(pip);

if (import.meta.env.DEV) {
  (window as unknown as { __triangles: () => number }).__triangles = () => scene.triangleCount();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  scene.followTarget(player.position, 0, dt);
  scene.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
