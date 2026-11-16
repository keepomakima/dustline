// WARDEN bots: five low-poly humanoids with a finite-state brain — PATROL waypoints,
// INVESTIGATE gunfire, ENGAGE on line-of-sight inside a view cone, HUNT the last known
// position when sight is lost, DEFUSE when the bomb is planted. They walk the waypoint
// graph (BFS paths from world.js), strafe while firing, and recover when stuck.
// Perception is distance + FOV + the map's LOS segment test; shooting is a burst with a
// distance/speed-based hit chance, never a hitscan ray — the player can dodge.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './player.js';
import { findPath, losBlocked, WAYPOINTS, SPAWNS } from './world.js';

const BOT_SPEED = 3.4;
const VIEW_DIST = 38;
const VIEW_COS = Math.cos(1.15); // ~66 deg half-cone
const BURST = 3;
const BURST_GAP = 0.11;
// v4 rebalance: WARDENs were too lethal — the striker side lost 5 of 12 judged
// games. Longer pauses between bursts, a full second to aim after spotting a
// target, and softer hits, so a crossing or a plant is a fight, not a shredding.
const BURST_PAUSE = 1.15;
const REACT_TIME = 1.0;
const HIT_BASE = 0.42;
const HIT_CAP = 0.45;
const DMG_MIN = 7;
const DMG_SPREAD = 5;

export function createBots(scene, colliders, random) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.7, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
  const torsoGeo = new THREE.BoxGeometry(0.56, 0.72, 0.32);
  const headGeo = new THREE.SphereGeometry(0.17, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.62, 0.2);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.55);

  const bots = [];
  const hitMeshes = [];
  for (let i = 0; i < 5; i += 1) {
    const spawn = SPAWNS.bots[i];
    const { body, move } = createBody(colliders, spawn.x, spawn.z);
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, bodyMat); torso.position.y = 1.08;
    const head = new THREE.Mesh(headGeo, darkMat); head.position.y = 1.62;
    const legL = new THREE.Mesh(legGeo, darkMat); legL.position.set(-0.14, 0.31, 0);
    const legR = new THREE.Mesh(legGeo, darkMat); legR.position.set(0.14, 0.31, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat); gun.position.set(0.2, 1.15, -0.3);
    group.add(torso, head, legL, legR, gun);
    group.position.set(spawn.x, 0, spawn.z);
    scene.add(group);
    const bot = {
      id: i + 1, name: `WARDEN ${i + 1}`, group, torso, head, legL, legR,
      body, move, hp: 100, alive: true, state: 'patrol',
      waypoint: Math.floor(random() * WAYPOINTS.length),
      path: [], pathIndex: 0, target: null, lastKnown: null, loseTimer: 0,
      burstLeft: 0, burstTimer: 0, pauseTimer: 0.4 + random() * 0.6, aimTimer: 0,
      strafeDir: random() > 0.5 ? 1 : -1, strafeTimer: 0,
      stuckTimer: 0, lastPos: new THREE.Vector3(spawn.x, 0, spawn.z),
      defuseProgress: 0, walkPhase: random() * 6, kills: 0, deaths: 0,
    };
    torso.userData.bot = bot; torso.userData.part = 'torso';
    head.userData.bot = bot; head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
  }

  // Perception: the nearest living target (the player or a squadmate) inside the
  // view distance and view cone with a clear line of sight. Returns {dist, target}
  // where target is {pos, isPlayer, ref}, or null.
  function canSee(bot, ctx) {
    let best = null; let bestDist = Infinity;
    for (const t of ctx.targets) {
      if (!t.alive) continue;
      const dx = t.pos.x - bot.body.position.x;
      const dz = t.pos.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > VIEW_DIST || dist >= bestDist) continue;
      if (losBlocked(bot.body.position.x, bot.body.position.z, t.pos.x, t.pos.z)) continue;
      const fx = -Math.sin(bot.body.yaw); const fz = -Math.cos(bot.body.yaw);
      if (dist > 4 && (dx * fx + dz * fz) / (dist || 1) < VIEW_COS) continue;
      best = t; bestDist = dist;
    }
    return best ? { dist: bestDist, target: best } : null;
  }

  function setPath(bot, target) {
    bot.path = findPath(bot.body.position, target);
    bot.pathIndex = 0;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) return;
    const pos = bot.body.position;
    const seen = canSee(bot, ctx);
    const dist = seen ? seen.dist : 0;
    const prevState = bot.state;
    if (seen) {
      bot.state = 'engage'; bot.target = seen.target;
      // Reaction time: a bot that just spotted a target takes 1.0 s to aim
      // before its first burst, so a player (or scripted player) crossing a
      // doorway is not instantly shredded.
      if (prevState !== 'engage') bot.aimTimer = REACT_TIME;
      bot.lastKnown = { x: seen.target.pos.x, z: seen.target.pos.z }; bot.loseTimer = 0;
    } else if (bot.state === 'engage') {
      bot.loseTimer += dt;
      bot.state = bot.loseTimer > 2.5 ? 'hunt' : 'engage';
      if (bot.state === 'hunt' && bot.lastKnown) setPath(bot, bot.lastKnown);
    }
    if (ctx.bombPlanted && bot.state !== 'engage') bot.state = 'defuse';
    if (bot.state === 'defuse' && ctx.bombPos) {
      const d = Math.hypot(ctx.bombPos.x - pos.x, ctx.bombPos.z - pos.z);
      if (d < 1.6) {
        bot.defuseProgress += dt;
        ctx.onDefuse(bot, bot.defuseProgress);
        bot.body.yaw = Math.atan2(-(ctx.bombPos.x - pos.x), -(ctx.bombPos.z - pos.z));
        return;
      }
      if (!bot.path.length || bot.pathIndex >= bot.path.length) setPath(bot, ctx.bombPos);
    } else if (bot.state === 'patrol') {
      const wp = WAYPOINTS[bot.waypoint];
      const d = Math.hypot(wp[0] - pos.x, wp[1] - pos.z);
      if (d < 1.2) { bot.waypoint = Math.floor(random() * WAYPOINTS.length); bot.path = []; }
      else if (!bot.path.length) setPath(bot, { x: wp[0], z: wp[1] });
    } else if (bot.state === 'investigate' || bot.state === 'hunt') {
      if (!bot.path.length || bot.pathIndex >= bot.path.length) {
        bot.state = 'patrol'; bot.path = [];
      }
    }

    // Movement target.
    let target = null;
    const engagePos = bot.target && bot.target.alive ? bot.target.pos : null;
    if (bot.state === 'engage' && engagePos) {
      // Strafe sideways at 6-14 m, close in if far.
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) { bot.strafeDir *= -1; bot.strafeTimer = 0.8 + random() * 1.2; }
      const dx = engagePos.x - pos.x; const dz = engagePos.z - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len * bot.strafeDir; const pz = dx / len * bot.strafeDir;
      const toward = dist > 14 ? 0.8 : dist < 6 ? -0.5 : 0;
      target = { x: pos.x + px + (dx / len) * toward, z: pos.z + pz + (dz / len) * toward };
      bot.body.yaw = Math.atan2(-dx, -dz);
    } else if (bot.path.length && bot.pathIndex < bot.path.length) {
      target = bot.path[bot.pathIndex];
      if (Math.hypot(target.x - pos.x, target.z - pos.z) < 0.9) { bot.pathIndex += 1; bot.nodeTimer = 0; target = bot.path[bot.pathIndex] || null; }
      // A node that cannot be reached in 4 s (a crate nudged into the way, a
      // corner) is skipped rather than pushed against forever.
      bot.nodeTimer = (bot.nodeTimer || 0) + dt;
      if (bot.nodeTimer > 4) { bot.pathIndex += 1; bot.nodeTimer = 0; target = bot.path[bot.pathIndex] || null; }
      if (target) bot.body.yaw = Math.atan2(-(target.x - pos.x), -(target.z - pos.z));
    }
    if (target) {
      const dx = target.x - pos.x; const dz = target.z - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      bot.move(dt, dx / len, dz / len, BOT_SPEED, false, false);
      bot.walkPhase += dt * 9;
    } else {
      bot.move(dt, 0, 0, BOT_SPEED, false, false);
    }
    // Stuck recovery: if barely moved in 2 s, pick a fresh waypoint.
    bot.stuckTimer += dt;
    if (bot.stuckTimer > 2) {
      const moved = Math.hypot(pos.x - bot.lastPos.x, pos.z - bot.lastPos.z);
      if (moved < 0.3 && bot.state !== 'engage') { bot.waypoint = Math.floor(random() * WAYPOINTS.length); bot.path = []; }
      bot.lastPos.copy(pos); bot.stuckTimer = 0;
    }
    // Burst fire while engaging (after the reaction delay).
    if (bot.state === 'engage' && dist > 0 && bot.target && bot.target.alive) {
      if (bot.aimTimer > 0) { bot.aimTimer -= dt; }
      else {
      bot.pauseTimer -= dt;
      if (bot.burstLeft > 0) {
        bot.burstTimer -= dt;
        if (bot.burstTimer <= 0) {
          bot.burstLeft -= 1; bot.burstTimer = BURST_GAP;
          ctx.onBotShot(bot);
          const targetSpeed = bot.target.isPlayer ? ctx.playerSpeed : 3.6;
          const chance = Math.max(0.08, Math.min(HIT_CAP, HIT_BASE - dist * 0.008 - targetSpeed * 0.02));
          if (random() < chance) {
            if (bot.target.isPlayer) ctx.onDamagePlayer(DMG_MIN + random() * DMG_SPREAD, bot);
            else ctx.onDamageMate(bot.target.ref, DMG_MIN + random() * DMG_SPREAD, bot);
          }
        }
      } else if (bot.pauseTimer <= 0) {
        bot.burstLeft = BURST; bot.burstTimer = 0; bot.pauseTimer = BURST_PAUSE + random() * 0.5;
      }
      }
    }
    if (prevState !== bot.state) { /* state changes are visible in the probe */ }
    // Animate the mesh.
    bot.group.position.set(pos.x, pos.y, pos.z);
    bot.group.rotation.y = bot.body.yaw;
    const swing = Math.sin(bot.walkPhase) * 0.35 * Math.min(1, Math.hypot(bot.body.velocity.x, bot.body.velocity.z) / 3);
    bot.legL.rotation.x = swing; bot.legR.rotation.x = -swing;
    bot.group.rotation.x = bot.alive ? 0 : 0;
  }

  return {
    bots, hitMeshes,
    step(dt, ctx) { for (const b of bots) stepBot(b, dt, ctx); },
    hear(x, z) {
      for (const b of bots) {
        if (!b.alive || b.state === 'engage' || b.state === 'defuse') continue;
        const d = Math.hypot(x - b.body.position.x, z - b.body.position.z);
        if (d < 26) { b.state = 'investigate'; setPath(b, { x, z }); }
      }
    },
    damage(mesh, amount) {
      const bot = mesh.userData.bot;
      if (!bot || !bot.alive) return null;
      bot.hp -= amount;
      if (bot.hp > 0) {
        // Being shot reveals the shooter: investigate the player's position.
        if (mesh.userData.lastShooter) { bot.lastKnown = mesh.userData.lastShooter; }
        return { killed: false, bot };
      }
      bot.alive = false; bot.deaths += 1;
      bot.group.rotation.x = -1.45; bot.group.position.y = -0.1;
      return { killed: true, bot };
    },
    aliveCount() { return bots.filter((b) => b.alive).length; },
    reset() {
      for (let i = 0; i < bots.length; i += 1) {
        const b = bots[i]; const s = SPAWNS.bots[i];
        b.body.position.set(s.x, 0, s.z); b.body.velocity.set(0, 0, 0);
        b.hp = 100; b.alive = true; b.state = 'patrol'; b.target = null;
        b.waypoint = Math.floor(random() * WAYPOINTS.length);
        b.path = []; b.defuseProgress = 0; b.burstLeft = 0;
        b.group.rotation.set(0, 0, 0); b.group.position.set(s.x, 0, s.z);
      }
    },
  };
}
