// The bomb: hold E for 3 s inside a site to plant, a 35 s fuse, then the blast wins
// the round for the attackers. A living bot that reaches the planted bomb defuses in
// 5 s. Planting cancels if the planter lets go, moves out of the site or dies.
import * as THREE from 'three';
import { SITES } from './world.js';
import { PALETTE } from './palette.js';

export const PLANT_TIME = 3;
export const FUSE_TIME = 35;
export const DEFUSE_TIME = 5;

export function createBomb(scene) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.3 }),
  );
  mesh.visible = false;
  scene.add(mesh);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.enemy), 0, 8);
  scene.add(light);
  const state = {
    planted: false, plantProgress: 0, fuse: 0, site: null, pos: null,
    defuser: null, defuseProgress: 0, exploded: false,
  };
  let beepTimer = 0;
  return {
    state,
    siteAt(x, z) {
      for (const [key, s] of Object.entries(SITES)) {
        if (Math.hypot(x - s.x, z - s.z) < s.r) return key;
      }
      return null;
    },
    step(dt, ctx) {
      // ctx: {planting, planterPos, planterAlive, onPlant, onExplode, onDefuse, beep}
      // The planter is the player (hold E in a site) or, in v4, a squadmate
      // carrying the bomb after the player went down — same channel, same fuse.
      if (!state.planted) {
        if (ctx.planting && ctx.planterAlive) {
          const site = this.siteAt(ctx.planterPos.x, ctx.planterPos.z);
          if (site) {
            state.plantProgress += dt;
            if (state.plantProgress >= PLANT_TIME) {
              state.planted = true; state.site = site; state.fuse = FUSE_TIME;
              state.pos = { x: ctx.planterPos.x, z: ctx.planterPos.z };
              mesh.position.set(state.pos.x, 0.12, state.pos.z);
              mesh.visible = true;
              state.plantProgress = 0;
              ctx.onPlant(site);
            }
          } else state.plantProgress = 0;
        } else state.plantProgress = 0;
        return;
      }
      state.fuse -= dt;
      beepTimer -= dt;
      if (beepTimer <= 0) { ctx.beep(); beepTimer = Math.max(0.25, state.fuse / 20); }
      light.intensity = 6 + Math.sin(performance.now() / 120) * 4;
      light.position.set(state.pos.x, 1, state.pos.z);
      if (state.defuseProgress >= DEFUSE_TIME) {
        ctx.onDefuse(state.defuser);
        this.reset();
        return;
      }
      if (state.fuse <= 0) {
        state.exploded = true;
        ctx.onExplode();
        this.reset();
      }
    },
    noteDefuse(bot, progress) {
      state.defuser = bot; state.defuseProgress = progress;
    },
    reset() {
      state.planted = false; state.plantProgress = 0; state.fuse = 0; state.site = null;
      state.pos = null; state.defuser = null; state.defuseProgress = 0; state.exploded = false;
      mesh.visible = false; light.intensity = 0;
    },
  };
}
