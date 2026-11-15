// STRIKER teammates: four AI squadmates who fight beside the player, so DUSTLINE is
// a 5v5. They share the bot brain's shape — patrol waypoints, follow the player when
// nothing is happening, engage the nearest visible WARDEN with burst fire — but they
// are on the player's side (ink-coloured, never shot at by the player: friendly fire
// is off) and they call out contacts. If the player dies, the round goes on with them
// until the squad is wiped, the yard is cleared, or the bomb resolves.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './player.js';
import { findPath, losBlocked, WAYPOINTS, SPAWNS } from './world.js';

const MATE_SPEED = 3.6;
const VIEW_DIST = 38;
const VIEW_COS = Math.cos(1.15);
const BURST = 3;
const BURST_GAP = 0.11;
const BURST_PAUSE = 0.9;
export const CALLSIGNS = ['VEX', 'ORIN', 'KESTREL', 'BRAM'];
// Team plan: VEX and ORIN follow the player; KESTREL holds Site A and BRAM
// holds Site B, patrolling between the site's two waypoint nodes, so both
// sites are covered every round instead of the whole squad clumping behind
// the player. When the bomb is planted, every mate converges to defend it.
const HOLD_NODES = { A: [10, 12], B: [15, 16] };
const CALLOUTS = [
  'Contact!', 'WARDEN spotted!', 'Engaging!', 'Taking fire — need help!',
];

export function createTeammates(scene, colliders, random) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.7, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.1 });
  const torsoGeo = new THREE.BoxGeometry(0.56, 0.72, 0.32);
  const headGeo = new THREE.SphereGeometry(0.17, 14, 10);
  const visorGeo = new THREE.BoxGeometry(0.3, 0.07, 0.05);
  const legGeo = new THREE.BoxGeometry(0.2, 0.62, 0.2);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.55);

  const mates = [];
  const hitMeshes = [];
  const spawns = [{ x: -2, z: 14 }, { x: 2, z: 14 }, { x: -3, z: 16 }, { x: 3, z: 16 }];
  for (let i = 0; i < 4; i += 1) {
    const spawn = spawns[i];
    const { body, move } = createBody(colliders, spawn.x, spawn.z);
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, bodyMat); torso.position.y = 1.08;
    const head = new THREE.Mesh(headGeo, darkMat); head.position.y = 1.62;
    const visor = new THREE.Mesh(visorGeo, accentMat); visor.position.set(0, 1.64, -0.15);
    const legL = new THREE.Mesh(legGeo, darkMat); legL.position.set(-0.14, 0.31, 0);
    const legR = new THREE.Mesh(legGeo, darkMat); legR.position.set(0.14, 0.31, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat); gun.position.set(0.2, 1.15, -0.3);
    group.add(torso, head, visor, legL, legR, gun);
    group.position.set(spawn.x, 0, spawn.z);
    scene.add(group);
    const mate = {
      id: i + 1, name: CALLSIGNS[i], group, torso, head, legL, legR,
      body, move, hp: 100, alive: true, state: 'follow',
      role: i < 2 ? 'follow' : 'hold', holdSite: i === 2 ? 'A' : i === 3 ? 'B' : null, holdNode: 0,
      path: [], pathIndex: 0, target: null, loseTimer: 0,
      burstLeft: 0, burstTimer: 0, pauseTimer: 0.4 + random() * 0.6,
      strafeDir: random() > 0.5 ? 1 : -1, strafeTimer: 0,
      stuckTimer: 0, lastPos: new THREE.Vector3(spawn.x, 0, spawn.z),
      walkPhase: random() * 6, kills: 0, deaths: 0, calledOut: false,
    };
    torso.userData.mate = mate; torso.userData.part = 'torso';
    head.userData.mate = mate; head.userData.part = 'head';
    hitMeshes.push(torso, head);
    mates.push(mate);
  }

  function nearestVisibleEnemy(mate, ctx) {
    let best = null; let bestDist = Infinity;
    for (const enemy of ctx.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.body.position.x - mate.body.position.x;
      const dz = enemy.body.position.z - mate.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > VIEW_DIST || dist >= bestDist) continue;
      if (losBlocked(mate.body.position.x, mate.body.position.z, enemy.body.position.x, enemy.body.position.z)) continue;
      const fx = -Math.sin(mate.body.yaw); const fz = -Math.cos(mate.body.yaw);
      if (dist > 4 && (dx * fx + dz * fz) / (dist || 1) < VIEW_COS) continue;
      best = enemy; bestDist = dist;
    }
    return best ? { enemy: best, dist: bestDist } : null;
  }

  function setPath(mate, target) {
    mate.path = findPath(mate.body.position, target);
    mate.pathIndex = 0;
  }

  function stepMate(mate, dt, ctx) {
    if (!mate.alive) return;
    const pos = mate.body.position;
    const seen = nearestVisibleEnemy(mate, ctx);
    if (seen) {
      mate.target = seen.enemy; mate.state = 'engage'; mate.loseTimer = 0;
      if (!mate.calledOut) {
        mate.calledOut = true;
        ctx.onCallout(mate, CALLOUTS[Math.floor(random() * CALLOUTS.length)], seen.enemy);
        setTimeout(() => { mate.calledOut = false; }, 9000);
      }
    } else if (mate.state === 'engage') {
      mate.loseTimer += dt;
      if (mate.loseTimer > 2.5) { mate.state = 'follow'; mate.target = null; mate.path = []; }
    }

    let target = null;
    if (mate.state === 'engage' && mate.target && mate.target.alive) {
      const tp = mate.target.body.position;
      const dx = tp.x - pos.x; const dz = tp.z - pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      mate.strafeTimer -= dt;
      if (mate.strafeTimer <= 0) { mate.strafeDir *= -1; mate.strafeTimer = 0.8 + random() * 1.2; }
      const px = -dz / dist * mate.strafeDir; const pz = dx / dist * mate.strafeDir;
      const toward = dist > 14 ? 0.8 : dist < 6 ? -0.5 : 0;
      target = { x: pos.x + px + (dx / dist) * toward, z: pos.z + pz + (dz / dist) * toward };
      mate.body.yaw = Math.atan2(-dx, -dz);
    } else if (ctx.bombPlanted && ctx.bombPos) {
      // Bomb down: converge on the planted site and defend it — a plant the
      // squad ignores is a round handed to the defusers.
      const d = Math.hypot(ctx.bombPos.x - pos.x, ctx.bombPos.z - pos.z);
      if (d > 4) {
        if (!mate.path.length || mate.pathIndex >= mate.path.length) setPath(mate, ctx.bombPos);
        target = mate.path[mate.pathIndex] || null;
        if (target && Math.hypot(target.x - pos.x, target.z - pos.z) < 0.9) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
        mate.nodeTimer = (mate.nodeTimer || 0) + dt;
        if (mate.nodeTimer > 4) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
        if (target) mate.body.yaw = Math.atan2(-(target.x - pos.x), -(target.z - pos.z));
      } else {
        mate.body.yaw += dt * 0.6; // hold the site, scanning
      }
    } else if (mate.role === 'hold' && mate.holdSite) {
      // Hold the assigned site: patrol between its two waypoint nodes.
      const nodes = HOLD_NODES[mate.holdSite];
      const wp = WAYPOINTS[nodes[mate.holdNode % nodes.length]];
      const d = Math.hypot(wp[0] - pos.x, wp[1] - pos.z);
      if (d < 1.2) { mate.holdNode += 1; mate.path = []; }
      else {
        if (!mate.path.length || mate.pathIndex >= mate.path.length) setPath(mate, { x: wp[0], z: wp[1] });
        target = mate.path[mate.pathIndex] || null;
        if (target && Math.hypot(target.x - pos.x, target.z - pos.z) < 0.9) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
        mate.nodeTimer = (mate.nodeTimer || 0) + dt;
        if (mate.nodeTimer > 4) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
        if (target) mate.body.yaw = Math.atan2(-(target.x - pos.x), -(target.z - pos.z));
      }
    } else if (mate.state === 'follow' && ctx.playerAlive) {
      // Hold a loose formation ~4 m behind the player; drift to a nearby waypoint.
      const pp = ctx.playerPos;
      const d = Math.hypot(pp.x - pos.x, pp.z - pos.z);
      if (d > 7) {
        if (!mate.path.length || mate.pathIndex >= mate.path.length) {
          setPath(mate, { x: pp.x + (random() * 4 - 2), z: pp.z + 3 + random() * 2 });
        }
        target = mate.path[mate.pathIndex] || null;
        if (target && Math.hypot(target.x - pos.x, target.z - pos.z) < 0.9) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
        mate.nodeTimer = (mate.nodeTimer || 0) + dt;
        if (mate.nodeTimer > 4) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
        if (target) mate.body.yaw = Math.atan2(-(target.x - pos.x), -(target.z - pos.z));
      } else {
        mate.body.yaw = ctx.playerYaw;
      }
    } else {
      // Player dead: patrol the yard on the waypoint graph.
      if (!mate.path.length || mate.pathIndex >= mate.path.length) {
        const wp = WAYPOINTS[Math.floor(random() * WAYPOINTS.length)];
        setPath(mate, { x: wp[0], z: wp[1] });
      }
      target = mate.path[mate.pathIndex] || null;
      if (target && Math.hypot(target.x - pos.x, target.z - pos.z) < 0.9) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
      mate.nodeTimer = (mate.nodeTimer || 0) + dt;
      if (mate.nodeTimer > 4) { mate.pathIndex += 1; mate.nodeTimer = 0; target = mate.path[mate.pathIndex] || null; }
      if (target) mate.body.yaw = Math.atan2(-(target.x - pos.x), -(target.z - pos.z));
    }

    if (target) {
      const dx = target.x - pos.x; const dz = target.z - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      mate.move(dt, dx / len, dz / len, MATE_SPEED, false, false);
      mate.walkPhase += dt * 9;
    } else {
      mate.move(dt, 0, 0, MATE_SPEED, false, false);
    }
    mate.stuckTimer += dt;
    if (mate.stuckTimer > 2) {
      const moved = Math.hypot(pos.x - mate.lastPos.x, pos.z - mate.lastPos.z);
      if (moved < 0.3 && mate.state !== 'engage') mate.path = [];
      mate.lastPos.copy(pos); mate.stuckTimer = 0;
    }
    // Burst fire while engaging.
    if (mate.state === 'engage' && mate.target && mate.target.alive && seen) {
      mate.pauseTimer -= dt;
      if (mate.burstLeft > 0) {
        mate.burstTimer -= dt;
        if (mate.burstTimer <= 0) {
          mate.burstLeft -= 1; mate.burstTimer = BURST_GAP;
          ctx.onMateShot(mate);
          const chance = Math.max(0.12, Math.min(0.65, 0.62 - seen.dist * 0.008));
          if (random() < chance) ctx.onDamageEnemy(mate.target, 12 + random() * 8, mate);
        }
      } else if (mate.pauseTimer <= 0) {
        mate.burstLeft = BURST; mate.burstTimer = 0; mate.pauseTimer = BURST_PAUSE + random() * 0.5;
      }
    }
    mate.group.position.set(pos.x, pos.y, pos.z);
    mate.group.rotation.y = mate.body.yaw;
    const swing = Math.sin(mate.walkPhase) * 0.35 * Math.min(1, Math.hypot(mate.body.velocity.x, mate.body.velocity.z) / 3);
    mate.legL.rotation.x = swing; mate.legR.rotation.x = -swing;
  }

  return {
    mates, hitMeshes,
    step(dt, ctx) { for (const m of mates) stepMate(m, dt, ctx); },
    damage(mate, amount) {
      if (!mate || !mate.alive) return false;
      mate.hp -= amount;
      if (mate.hp > 0) return false;
      mate.alive = false; mate.deaths += 1;
      mate.group.rotation.x = -1.45; mate.group.position.y = -0.1;
      return true;
    },
    aliveCount() { return mates.filter((m) => m.alive).length; },
    reset() {
      const spawns = [{ x: -2, z: 14 }, { x: 2, z: 14 }, { x: -3, z: 16 }, { x: 3, z: 16 }];
      for (let i = 0; i < mates.length; i += 1) {
        const m = mates[i]; const s = spawns[i];
        m.body.position.set(s.x, 0, s.z); m.body.velocity.set(0, 0, 0);
        m.hp = 100; m.alive = true; m.state = 'follow'; m.holdNode = 0;
        m.path = []; m.target = null; m.burstLeft = 0;
        m.group.rotation.set(0, 0, 0); m.group.position.set(s.x, 0, s.z);
      }
    },
  };
}
