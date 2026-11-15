// DUSTLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Rounds: 15 s buy, 100 s live, first to 4 (max 7). Win a round by
// eliminating all five WARDENs or by planting the bomb and letting it blow; lose it by
// dying, by the timer, or by a bot defusing the bomb. Kills pay $300, a round win
// $3250, a loss $1900. ?shot=start|play|buy|end with &seed=N stages a deterministic
// frame for a capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS, losBlocked } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createTeammates } from './teammates.js';
import { createBomb, PLANT_TIME, FUSE_TIME, DEFUSE_TIME } from './bomb.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const WIN_ROUNDS = 7;
const MAX_ROUNDS = 12;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const testMode = params.get('test') === '1';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const bots = createBots(scene, world.colliders, random);
const mates = createTeammates(scene, world.colliders, random);
const bomb = createBomb(scene);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes, mates.hitMeshes);
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

// Pooled tracers (lines) and impact puffs (small spheres), so firing never allocates.
const tracers = [];
for (let i = 0; i < 24; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;
function spawnTracer(from, to) {
  const t = tracers[tracerIndex]; tracerIndex = (tracerIndex + 1) % tracers.length;
  t.line.geometry.setFromPoints([from, to]);
  t.line.material.opacity = 0.9; t.life = 0.09;
}
const impacts = [];
for (let i = 0; i < 16; i += 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
  scene.add(m);
  impacts.push({ mesh: m, life: 0 });
}
let impactIndex = 0;
function spawnImpact(point) {
  const im = impacts[impactIndex]; impactIndex = (impactIndex + 1) % impacts.length;
  im.mesh.position.copy(point); im.mesh.material.opacity = 0.9; im.life = 0.25;
}

// Thrown grenades: one live projectile, arc + one floor bounce, then blast.
const grenades = [];
function throwGrenade() {
  if (!weapons.throwGrenade()) return;
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.5 }));
  const start = camera.position.clone();
  scene.add(mesh);
  grenades.push({ mesh, vel: direction.clone().multiplyScalar(16).add(new THREE.Vector3(0, 3.5, 0)), pos: start, fuse: GRENADE.fuse });
  audio.shot('shotgun');
}

const body = player.state;
const game = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1, scoreUs: 0, scoreThem: 0, money: 800,
  hp: 100, kills: 0, deaths: 0, shots: 0, hits: 0,
  phaseTime: 0, playerAlive: true, matchOver: false,
  best: 0,
};
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let stepTimer = 0;
let roundEndTimer = 0;
let roundWinner = null;
let shake = 0;
let spectateMate = null;

try { game.best = Number(localStorage.getItem('dustline-best') ?? 0) || 0; } catch { game.best = 0; }

function syncCamera() {
  if (!game.playerAlive && spectateMate && spectateMate.alive) {
    const mp = spectateMate.body.position;
    camera.position.set(mp.x, mp.y + 1.6, mp.z);
    camera.rotation.set(-0.05, spectateMate.body.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.position.x += (random() - 0.5) * shake * 0.05;
    camera.position.y += (random() - 0.5) * shake * 0.05;
    shake = Math.max(0, shake - 0.02);
  }
}

function resetRoundPositions() {
  body.position.set(SPAWNS.player.x, 0, SPAWNS.player.z);
  body.velocity.set(0, 0, 0);
  body.yaw = SPAWNS.player.yaw; body.pitch = 0;
  bots.reset();
  mates.reset();
  spectateMate = null;
  bomb.reset();
  grenades.forEach((g) => scene.remove(g.mesh));
  grenades.length = 0;
}

function startBuyPhase() {
  game.phase = 'buy';
  game.phaseTime = BUY_SECONDS;
  resetRoundPositions();
  game.hp = 100; game.playerAlive = true;
  weapons.resetRound();
  weapons.giveStarter();
  hud.setHealth(game.hp);
  hud.setMoney(game.money);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
  hud.setRound(game.scoreUs, game.scoreThem, game.round);
  hud.setAlive(bots.aliveCount());
  hud.setSquad(1 + mates.aliveCount());
  hud.setBomb('Objective: plant at A or B — or eliminate all WARDENs');
  hud.showBuy(game.money, weapons.owned(), weapons.state.grenades, onBuy);
  hud.hideOverlay();
}

function startLivePhase() {
  game.phase = 'live';
  game.phaseTime = ROUND_SECONDS;
  hud.hideBuy();
  hud.hideOverlay();
  audio.round();
  hud.banner(`Round ${game.round} — plant the bomb or clear the yard`);
  hud.feed('VEX: "Moving out. Watch the mid door."');
}

function endRound(winner, reason) {
  if (game.phase !== 'live') return;
  game.phase = 'roundEnd';
  roundWinner = winner;
  roundEndTimer = 3.5;
  if (winner === 'us') {
    game.scoreUs += 1; game.money += 3250;
    hud.banner(`Round ${game.round} — STRIKERS win. ${reason}`);
  } else {
    game.scoreThem += 1; game.money += 1900;
    hud.banner(`Round ${game.round} — WARDENS win. ${reason}`);
  }
  hud.setMoney(game.money);
  hud.setRound(game.scoreUs, game.scoreThem, game.round);
  if (document.pointerLockElement) document.exitPointerLock();
}

function endMatch() {
  game.phase = 'matchEnd';
  game.matchOver = true;
  const won = game.scoreUs > game.scoreThem;
  const total = game.kills;
  if (total > game.best) { game.best = total; try { localStorage.setItem('dustline-best', String(total)); } catch { /* ignore */ } }
  hud.showOverlay('end', won
    ? `STRIKERS take the match ${game.scoreUs}–${game.scoreThem}. You scored ${game.kills} eliminations. Best: ${game.best}.`
    : `WARDENS take the match ${game.scoreThem}–${game.scoreUs}. You scored ${game.kills} eliminations. Best: ${game.best}.`);
}

function onBuy(kind) {
  const result = weapons.buy(kind, game.money);
  if (!result.ok) { hud.feed(result.reason); return; }
  game.money -= result.price;
  hud.setMoney(game.money);
  audio.buy();
  hud.showBuy(game.money, weapons.owned(), weapons.state.grenades, onBuy);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def() ? weapons.def().name : 'Grenade', weapons.state.grenades);
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (game.phase === 'buy') hud.hideBuy();
  } else if (game.phase === 'live') {
    hud.showOverlay('paused');
  } else if (game.phase === 'buy') {
    hud.showBuy(game.money, weapons.owned(), weapons.state.grenades, onBuy);
  } else if (!game.matchOver) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.phase === 'menu' || game.phase === 'matchEnd') {
    if (game.phase === 'matchEnd') {
      game.round = 1; game.scoreUs = 0; game.scoreThem = 0; game.money = 800;
      game.kills = 0; game.deaths = 0; game.shots = 0; game.hits = 0; game.matchOver = false;
    }
    startBuyPhase();
    return;
  }
  if (game.phase === 'buy') { hud.hideBuy(); input.requestLock(); return; }
  if (game.phase === 'live') { input.requestLock(); return; }
});
hud.onDeploy(() => {
  if (game.phase !== 'buy') return;
  startLivePhase();
  input.requestLock();
});

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function damagePlayer(amount, source) {
  if (!game.playerAlive || game.phase !== 'live') return;
  game.hp -= amount;
  hud.setHealth(game.hp);
  hud.damageFlash();
  audio.hurt();
  shake = 0.6;
  if (game.hp <= 0) {
    game.hp = 0; game.playerAlive = false; game.deaths += 1;
    hud.setHealth(0);
    hud.setSquad(mates.aliveCount());
    hud.feed(`${source} eliminated you`);
    spectateMate = mates.mates.find((m) => m.alive) || null;
    if (spectateMate) hud.feed(`Spectating ${spectateMate.name} — the squad fights on.`);
    if (!bomb.state.planted && mates.aliveCount() === 0) endRound('them', 'The squad was eliminated.');
    // If the bomb is planted, the round continues: bots must defuse or it blows.
    // If squadmates live, they can still clear the yard for the round win.
  }
}

function damageMate(mate, amount, source) {
  if (!mate.alive || game.phase !== 'live') return;
  const died = mates.damage(mate, amount);
  hud.setSquad(1 + mates.aliveCount());
  if (died) {
    hud.feed(`${source} eliminated ${mate.name}`);
    if (!game.playerAlive) spectateMate = mates.mates.find((m) => m.alive) || null;
    if (!game.playerAlive && mates.aliveCount() === 0 && !bomb.state.planted) {
      endRound('them', 'The squad was eliminated.');
    }
  }
}

function shoot(spread) {
  const def = weapons.def();
  if (!def) return false; // grenade selected: no hitscan
  if (!weapons.takeRound()) return false;
  game.shots += 1;
  camera.getWorldDirection(direction);
  const pellets = def.pellets ?? 1;
  let anyHit = false; let anyKill = false;
  for (let p = 0; p < pellets; p += 1) {
    const dir = direction.clone();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, dir);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    if (!hit) continue;
    spawnTracer(camera.position.clone(), hit.point);
    if (hit.object.userData.mate) {
      // Friendly fire is off: the round stops on a squadmate with a puff, no damage.
      spawnImpact(hit.point);
      continue;
    }
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      hit.object.userData.lastShooter = { x: body.position.x, z: body.position.z };
      bot.spottedUntil = elapsed + 4;
      const head = hit.object.userData.part === 'head';
      const dmg = def.damage * (head ? def.head : 1) * (1 - Math.min(0.4, hit.distance / def.range * 0.4));
      const result = bots.damage(hit.object, dmg);
      game.hits += 1; anyHit = true;
      if (result && result.killed) {
        anyKill = true;
        game.kills += 1; game.money += 300;
        hud.setMoney(game.money);
        hud.feed(`You eliminated ${bot.name}${head ? ' (headshot)' : ''} · +$300`);
        audio.kill();
        bots.hear(body.position.x, body.position.z);
      } else audio.hit();
      hud.hitMarker(result && result.killed, shot ? 4000 : 90);
    } else {
      spawnImpact(hit.point);
    }
  }
  weapons.pullTrigger();
  audio.shot(weapons.state.current);
  bots.hear(body.position.x, body.position.z);
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, def.name, weapons.state.grenades);
  if (bots.aliveCount() === 0 && game.phase === 'live') endRound('us', 'All WARDENs eliminated.');
  return anyHit || anyKill;
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  audio.explode();
  shake = 1;
  const blast = new THREE.Mesh(new THREE.SphereGeometry(GRENADE.radius, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.35, wireframe: true }));
  blast.position.copy(g.pos);
  scene.add(blast);
  setTimeout(() => scene.remove(blast), 350);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.body.position.x - g.pos.x, bot.body.position.z - g.pos.z);
    if (d < GRENADE.radius) {
      const dmg = GRENADE.damage * (1 - d / GRENADE.radius * 0.7);
      const result = bots.damage(bot.torso, dmg);
      if (result && result.killed) {
        game.kills += 1; game.money += 300;
        hud.setMoney(game.money);
        hud.feed(`You eliminated ${bot.name} with a grenade · +$300`);
        audio.kill();
      }
    }
  }
  const pd = Math.hypot(body.position.x - g.pos.x, body.position.z - g.pos.z);
  if (pd < GRENADE.radius * 0.7 && game.playerAlive) damagePlayer(GRENADE.damage * 0.4, 'Your grenade');
  if (bots.aliveCount() === 0 && game.phase === 'live') endRound('us', 'All WARDENs eliminated.');
}

function step(dt) {
  elapsed += dt;
  if (game.phase === 'buy') {
    game.phaseTime -= dt;
    hud.setTimer(game.phaseTime);
    if (game.phaseTime <= 0) startLivePhase();
  } else if (game.phase === 'live') {
    game.phaseTime -= dt;
    hud.setTimer(game.phaseTime);
    if (game.phaseTime <= 0 && !bomb.state.planted) endRound('them', 'Time expired — the bomb was never planted.');
  } else if (game.phase === 'roundEnd') {
    roundEndTimer -= dt;
    if (roundEndTimer <= 0) {
      if (game.scoreUs >= WIN_ROUNDS || game.scoreThem >= WIN_ROUNDS || game.round >= MAX_ROUNDS) endMatch();
      else { game.round += 1; startBuyPhase(); }
    }
  }

  const live = game.phase === 'live';
  const sprinting = live && game.playerAlive ? player.step(dt, input.state.keys) : false;
  weapons.state.aiming = input.state.aiming && weapons.state.current !== 'grenade';
  weapons.step(dt, live ? player.groundSpeed() : 0);
  const targetFov = weapons.aimFov();
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }

  // Footsteps: one per stride, firmer when sprinting.
  if (live && game.playerAlive) {
    const speed = player.groundSpeed();
    if (speed > 0.5) {
      stepTimer -= dt * speed;
      if (stepTimer <= 0) { audio.step(sprinting); stepTimer = 2.2; }
    }
  }

  // Bots. In ?shot= captures the AI holds still, so the staged frame is
  // deterministic (the starter does the same with its targets).
  if (!shot && (live || game.phase === 'roundEnd')) {
    const targets = [
      { pos: body.position, alive: game.playerAlive, isPlayer: true, ref: null },
      ...mates.mates.map((m) => ({ pos: m.body.position, alive: m.alive, isPlayer: false, ref: m })),
    ];
    bots.step(dt, {
      targets, playerAlive: game.playerAlive,
      playerSpeed: player.groundSpeed(),
      bombPlanted: bomb.state.planted, bombPos: bomb.state.pos,
      onDamagePlayer: (dmg, bot) => damagePlayer(dmg, bot.name),
      onDamageMate: (mate, dmg, bot) => damageMate(mate, dmg, bot.name),
      onBotShot: () => audio.enemyShot(),
      onDefuse: (bot, progress) => bomb.noteDefuse(bot, progress),
    });
    mates.step(dt, {
      enemies: bots.bots,
      playerPos: body.position, playerYaw: body.yaw, playerAlive: game.playerAlive,
      onMateShot: (mate) => { audio.enemyShot(); bots.hear(mate.body.position.x, mate.body.position.z); },
      onDamageEnemy: (enemy, dmg, mate) => {
        const result = bots.damage(enemy.torso, dmg);
        if (result && result.killed) {
          mate.kills += 1;
          hud.feed(`${mate.name} eliminated ${enemy.name}`);
          audio.kill();
          if (bots.aliveCount() === 0 && game.phase === 'live') endRound('us', 'All WARDENs eliminated.');
        }
      },
      onCallout: (mate, text, enemy) => {
        const site = enemy.body.position.x < 0 ? 'Site A' : 'Site B';
        hud.feed(`${mate.name}: "${text}" — ${site}`);
      },
    });
    for (const b of bots.bots) {
      if (!b.alive) continue;
      // Spotted: the player saw them recently (they fired, or were shot).
      b.spotted = elapsed < (b.spottedUntil || 0);
    }
  }

  // Bomb: plant channel (hold E inside a site) and the fuse.
  const planting = live && game.playerAlive && input.state.keys.has('KeyE') && !bomb.state.planted;
  bomb.step(dt, {
    planting, planterPos: body.position, playerAlive: game.playerAlive,
    onPlant: (site) => {
      hud.setBomb(`BOMB PLANTED at Site ${site} — defend it!`);
      hud.feed(`Bomb planted at Site ${site}`);
      audio.plant();
      game.phaseTime = FUSE_TIME; // round clock becomes the fuse
    },
    onExplode: () => {
      hud.setBomb('The bomb detonated.');
      if (game.phase === 'live') endRound('us', 'The bomb detonated.');
    },
    onDefuse: (bot) => {
      hud.setBomb('The bomb was defused.');
      if (game.phase === 'live') endRound('them', `${bot ? bot.name : 'A WARDEN'} defused the bomb.`);
    },
    beep: () => audio.beep(),
  });
  if (bomb.state.planted) {
    hud.setTimer(bomb.state.fuse);
    hud.setBomb(`BOMB PLANTED at Site ${bomb.state.site} — ${Math.ceil(bomb.state.fuse)}s · defuse ${Math.round(bomb.state.defuseProgress / DEFUSE_TIME * 100)}%`);
  }
  const plantLabel = bomb.state.planted ? '' : bomb.state.plantProgress > 0 ? 'PLANTING…' : '';
  hud.plantBar(bomb.state.plantProgress / PLANT_TIME, plantLabel);

  // Grenades in flight.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.vel.y -= 14 * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y < 0.09) { g.pos.y = 0.09; g.vel.y = Math.abs(g.vel.y) * 0.4; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    if (Math.abs(g.pos.x) > 21.5) { g.pos.x = Math.sign(g.pos.x) * 21.5; g.vel.x *= -0.4; }
    if (Math.abs(g.pos.z) > 16.5) { g.pos.z = Math.sign(g.pos.z) * 16.5; g.vel.z *= -0.4; }
    g.mesh.position.copy(g.pos);
    g.fuse -= dt;
    if (g.fuse <= 0) { explodeGrenade(g); grenades.splice(i, 1); }
  }

  // Tracers and impacts fade.
  for (const t of tracers) if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9; }
  for (const im of impacts) if (im.life > 0) { im.life -= dt; im.mesh.material.opacity = Math.max(0, im.life / 0.25) * 0.9; }

  // Minimap: spotted bots only, squadmates always.
  hud.drawMinimap(body.position, body.yaw, bots.bots, SITES, bomb.state.pos, mates.mates);

  // Scoreboard while Tab is held.
  if (input.state.keys.has('Tab') && (game.phase === 'live' || game.phase === 'buy')) {
    hud.showScoreboard([
      { name: 'YOU (Striker)', kills: game.kills, deaths: game.deaths, hp: Math.max(0, Math.round(game.hp)), money: `$${game.money}` },
      ...mates.mates.map((m) => ({ name: `${m.name} (Striker)`, kills: m.kills, deaths: m.deaths, hp: m.alive ? m.hp : 0, money: '—' })),
      ...bots.bots.map((b) => ({ name: b.name, kills: b.kills, deaths: b.deaths, hp: b.alive ? b.hp : 0, money: '—' })),
    ]);
  } else hud.hideScoreboard();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const wheel = input.takeWheel();
    if (wheel !== 0 && game.phase === 'live') {
      weapons.cycle(wheel > 0 ? 1 : -1);
      hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def() ? weapons.def().name : 'Frag Grenade', weapons.state.grenades);
    }
    if (input.pressed('KeyR') && game.phase === 'live') weapons.reload();
    if (input.pressed('KeyF') && game.phase === 'live') { weapons.state.torchOn = !weapons.state.torchOn; }
    if (input.pressed('KeyM')) { const m = audio.toggleMute(); hud.feed(m ? 'Sound muted' : 'Sound on'); }
    if (input.pressed('KeyB') && game.phase === 'live') { /* buy only in buy phase */ }
    if (input.pressed('Digit1')) weapons.select('pistol');
    if (input.pressed('Digit2')) weapons.select('smg');
    if (input.pressed('Digit3')) weapons.select('rifle');
    if (input.pressed('Digit4')) weapons.select('shotgun');
    if (input.pressed('Digit5')) weapons.select('dmr');
    if (input.pressed('KeyG') && game.phase === 'live') weapons.select('grenade');
    if (input.state.firing && game.phase === 'live' && game.playerAlive) {
      if (weapons.state.current === 'grenade') {
        if (weapons.state.cooldown === 0) { throwGrenade(); weapons.state.cooldown = 0.8; }
      } else if (weapons.ready()) shoot(shot ? 0 : weapons.spread(player.groundSpeed()));
      else if (weapons.state.mag === 0 && weapons.state.reloadLeft === 0) weapons.reload();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    input.endFrame();
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  body.pitch = 0; body.yaw = 0;
  if (name === 'start') {
    body.position.set(0.6, 0, 15.5);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -10));
    hud.showOverlay('start', 0);
  } else if (name === 'buy') {
    game.phase = 'buy'; game.phaseTime = BUY_SECONDS;
    resetRoundPositions();
    settle(10);
    aimAt(new THREE.Vector3(-6, 1.2, -8));
    hud.setMoney(game.money);
    hud.showBuy(game.money, weapons.owned(), weapons.state.grenades, onBuy);
  } else if (name === 'play' || name === 'end') {
    game.phase = 'live'; game.phaseTime = ROUND_SECONDS;
    resetRoundPositions();
    settle(20);
    // Walk a little forward, then engage a WARDEN staged in the open mid lane
    // (the AI holds still in ?shot= captures, so the frame is deterministic).
    // Aim and shoot at once; let the muzzle flash fade before the capture.
    body.position.set(0, 0, 8);
    const staged = bots.bots[0];
    staged.body.position.set(-4, 0, -6);
    staged.body.yaw = Math.atan2(-4, -14);
    staged.group.position.set(-4, 0, -6);
    staged.group.rotation.y = staged.body.yaw;
    const bot = staged;
    if (bot) {
      aimAt(new THREE.Vector3(bot.body.position.x, 1.35, bot.body.position.z));
      for (let r = 0; r < 3; r += 1) { shoot(0); settle(8); }
      settle(12);
      aimAt(new THREE.Vector3(bot.body.position.x, 1.1, bot.body.position.z));
      shoot(0);
      settle(6);
    }
    if (name === 'end') {
      game.scoreUs = 3; game.scoreThem = 2; game.round = 6;
      game.kills = 7;
      hud.setRound(game.scoreUs, game.scoreThem, game.round);
      endMatch();
    }
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
  }
  hud.setHealth(game.hp);
  hud.setMoney(game.money);
  hud.setRound(game.scoreUs, game.scoreThem, game.round);
  hud.setAlive(bots.aliveCount());
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) { window.__shotReady = true; frozen = true; }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Read-only probes for playtesting: the game state, never a cheat (no setters).
window.__dustline = {
  getState: () => ({
    phase: game.phase, round: game.round, scoreUs: game.scoreUs, scoreThem: game.scoreThem,
    money: game.money, hp: Math.round(game.hp), kills: game.kills, deaths: game.deaths,
    alive: bots.aliveCount(), playerAlive: game.playerAlive,
    bombPlanted: bomb.state.planted, bombFuse: Math.round(bomb.state.fuse),
    plantProgress: bomb.state.plantProgress,
    weapon: weapons.state.current, mag: weapons.state.mag, reserve: weapons.state.reserve,
    aiming: weapons.state.aiming, locked: input.state.locked,
    playerPos: { x: +body.position.x.toFixed(2), z: +body.position.z.toFixed(2) },
  }),
  getScore: () => game.scoreUs * 1000 + game.kills * 100,
  getHp: () => Math.round(game.hp),
  getEnemies: () => bots.bots.map((b) => ({ name: b.name, hp: b.hp, alive: b.alive, state: b.state })),
  getSquad: () => mates.mates.map((m) => ({ name: m.name, hp: m.hp, alive: m.alive, state: m.state })),
  getPlayer: () => ({ x: body.position.x, z: body.position.z, yaw: body.yaw, hp: game.hp }),
  getBestScore: () => game.best,
  getBomb: () => ({ planted: bomb.state.planted, fuse: bomb.state.fuse, site: bomb.state.site }),
  teleport(x, z, yaw = 0) {
    body.position.set(x, 0, z); body.velocity.set(0, 0, 0); body.yaw = yaw; body.pitch = 0;
    return { x: body.position.x, z: body.position.z };
  },
};
if (testMode) window.__gameTest = window.__dustline;

syncCamera();
hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
hud.setHealth(game.hp);
hud.setMoney(game.money);
hud.setRound(0, 0, 1);
hud.setAlive(5);
hud.setSquad(5);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
