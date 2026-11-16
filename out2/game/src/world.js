// DUSTLINE map: YARD-7, a 44 x 34 m walled yard with two bomb sites, three lanes and a
// mid double-door. All geometry is procedural boxes; every box is a collider, a bullet
// stopper and a minimap rect. LOS is a 2D segment test against the tall wall rects, and
// bots navigate a hand-placed waypoint graph searched with BFS.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Tall walls (block sight + movement). [x, z, halfW, halfD]
export const WALLS = [
  [-22, 0, 0.3, 17.3], [22, 0, 0.3, 17.3], [0, -17, 22.3, 0.3], [0, 17, 22.3, 0.3],
  [-14, -8, 4, 0.6], [-14, 8, 4, 0.6], [14, -8, 4, 0.6], [14, 8, 4, 0.6],
  [-6, 0, 0.6, 5], [6, 0, 0.6, 5], // mid double-door pillars (gap between them is the door)
  [0, -11, 6, 0.6], [0, 11, 6, 0.6],
  [-19, 0, 0.6, 3], [19, 0, 0.6, 3],
];
// Low crates (block movement, not sight over the top). [x, z, w, h, d]
export const CRATES = [
  [-12, -11, 2.2, 1.1, 2.2], [-10, 13, 2.2, 1.1, 2.2], [12, -11, 2.2, 1.1, 2.2], [12, 15.5, 2.2, 1.1, 2.2],
  [-3, -3, 1.6, 0.9, 1.6], [3, 3, 1.6, 0.9, 1.6], [-19, -10, 1.6, 0.9, 1.6], [19, 10, 1.6, 0.9, 1.6],
  [-17, 12, 1.6, 0.9, 1.6], [17, -12, 1.6, 0.9, 1.6], [-5, -16, 1.6, 0.9, 1.6], [5, 16, 1.6, 0.9, 1.6],
];
export const SITES = {
  A: { x: -18, z: -13, r: 3.4 },
  B: { x: 18, z: 13, r: 3.4 },
};
export const SPAWNS = {
  player: { x: 0, z: 15.5, yaw: 0 },
  bots: [
    { x: -18, z: -15 }, { x: -8, z: -14 }, { x: 18, z: -13 }, { x: 8, z: -14 }, { x: 0, z: -15 },
  ],
};
// Waypoint graph for bot navigation (nodes + links). Every link was audited against
// the tall walls with the same segment test LOS uses: no link crosses a wall, and no
// node sits on a wall edge or inside a crate, so a bot walking node to node never has
// to push through solid geometry. Through-lanes run at x = ±8 (the z = ±11 walls
// block the centre column there); the centre column is open between z = -10 and 10.
export const WAYPOINTS = [
  [0, 15], [-8, 14], [8, 14],           // 0-2 south pocket (player spawn)
  [-8, 6], [8, 6], [0, 6],              // 3-5 mid south
  [-8, -6], [8, -6], [0, -6],           // 6-8 mid north
  [0, -15], [-8, -14], [8, -14],        // 9-11 north pocket (bot spawn)
  [-16, -13], [-16, 0], [-13, 0],       // 12-14 site A + west lane
  [16, 13], [16, 0], [13, 0],           // 15-17 site B + east lane
  [0, 0],                               // 18 mid door
];
const LINKS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [2, 15],
  [3, 5], [4, 5], [5, 18], [18, 8],
  [3, 6], [4, 7], [6, 8], [7, 8],
  [6, 10], [7, 11], [10, 9], [11, 9], [10, 12],
  [13, 14], [14, 3], [14, 6], [13, 6],
  [16, 17], [17, 4], [17, 7], [16, 7],
];

export function losBlocked(ax, az, bx, bz) {
  // 2D segment vs tall-wall rects (crates are low: they do not block sight).
  for (const [wx, wz, hw, hd] of WALLS) {
    if (segmentRect(ax, az, bx, bz, wx - hw, wz - hd, wx + hw, wz + hd)) return true;
  }
  return false;
}
function segmentRect(x1, z1, x2, z2, minX, minZ, maxX, maxZ) {
  // Liang-Barsky clip of the segment against the rect.
  let t0 = 0; let t1 = 1;
  const dx = x2 - x1; const dz = z2 - z1;
  const p = [-dx, dx, -dz, dz];
  const q = [x1 - minX, maxX - x1, z1 - minZ, maxZ - z1];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

export function findPath(from, to) {
  // BFS over the waypoint graph from the nearest node to `from` to the nearest to `to`.
  const nearest = (p) => {
    let best = 0; let bd = Infinity;
    WAYPOINTS.forEach(([x, z], i) => { const d = (x - p.x) ** 2 + (z - p.z) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const start = nearest(from); const goal = nearest(to);
  const adj = WAYPOINTS.map(() => []);
  for (const [a, b] of LINKS) { adj[a].push(b); adj[b].push(a); }
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [start]; prev[start] = start;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const n of adj[cur]) if (prev[n] === -1) { prev[n] = cur; queue.push(n); }
  }
  if (prev[goal] === -1) return [to];
  const path = [];
  let cur = goal;
  while (cur !== start) { path.unshift({ x: WAYPOINTS[cur][0], z: WAYPOINTS[cur][1] }); cur = prev[cur]; }
  path.push(to);
  return path;
}

function siteLetterTexture(letter) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 256);
  g.strokeStyle = PALETTE.accent; g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 228);
  g.fillStyle = PALETTE.accent; g.font = 'bold 150px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const mats = {};
  for (const name of ['canvas', 'surface', 'hairline', 'ink', 'muted', 'accent']) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92, metalness: 0.03,
    });
  }
  const colliders = [];
  const shootables = [];
  function box(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }
  box(44.6, 0.4, 34.6, 0, -0.2, 0, 'canvas'); // floor
  for (const [x, z, hw, hd] of WALLS) box(hw * 2, 4.2, hd * 2, x, 2.1, z, 'surface');
  for (const [x, z, w, h, d] of CRATES) box(w, h, d, x, h / 2, z, 'hairline');
  // Site pads + floating letters.
  for (const [key, s] of Object.entries(SITES)) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(s.r * 2, s.r * 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.16 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(s.x, 0.02, s.z);
    group.add(pad);
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: siteLetterTexture(key), transparent: true, side: THREE.DoubleSide }));
    letter.position.set(s.x, 3.4, s.z);
    letter.rotation.y = key === 'A' ? 0 : Math.PI;
    group.add(letter);
  }
  // Dusk sky: warm key low from the west, cool fill, hemisphere gradient.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8a7a5c'), new THREE.Color(PALETTE.canvas), 1.6));
  const key = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.6);
  key.position.set(-14, 16, 10); key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26; key.shadow.camera.right = 26;
  key.shadow.camera.top = 20; key.shadow.camera.bottom = -20;
  key.shadow.camera.far = 60; key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.9);
  fill.position.set(12, 10, -12);
  scene.add(fill);
  return { colliders, shootables, group };
}
