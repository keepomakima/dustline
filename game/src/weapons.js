// Arsenal: five weapons plus a frag grenade. Each weapon owns its numbers, its view
// model (procedural boxes on the camera) and its feel: spread punishes movement, ADS
// (right mouse) tightens spread and zooms the FOV, the view model bobs with the stride
// and kicks on every shot. Grenades arc, bounce once, then blast with falloff.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { name: 'P9 Pistol', price: 0, damage: 34, head: 2, mag: 12, reserve: 48, gap: 0.16, reload: 1.4, spreadStill: 0.003, spreadMove: 0.02, auto: false, range: 40 },
  smg: { name: 'VK-9 SMG', price: 1500, damage: 22, head: 2, mag: 30, reserve: 120, gap: 0.075, reload: 1.7, spreadStill: 0.006, spreadMove: 0.034, auto: true, range: 35 },
  rifle: { name: 'AR-7 Rifle', price: 2700, damage: 36, head: 2.5, mag: 30, reserve: 90, gap: 0.096, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true, range: 60 },
  shotgun: { name: 'SG-12 Shotgun', price: 2100, damage: 14, head: 2, mag: 6, reserve: 24, gap: 0.85, reload: 2.4, spreadStill: 0.02, spreadMove: 0.05, auto: false, range: 18, pellets: 8 },
  dmr: { name: 'DMR-8 Marksman', price: 3200, damage: 78, head: 2, mag: 8, reserve: 32, gap: 0.55, reload: 2.2, spreadStill: 0.0008, spreadMove: 0.04, auto: false, range: 80 },
};
export const GRENADE = { name: 'Frag Grenade', price: 300, damage: 110, radius: 6, fuse: 1.6 };

export function createWeapons(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });

  function buildModel(kind) {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z, m = bodyMat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z); g.add(mesh); return mesh;
    };
    if (kind === 'pistol') { add(0.07, 0.09, 0.2, 0, 0, -0.1); add(0.06, 0.12, 0.07, 0, -0.09, 0.02, grip); }
    else if (kind === 'smg') { add(0.08, 0.09, 0.34, 0, 0, -0.12); add(0.04, 0.04, 0.3, 0, 0.02, -0.35, grip); add(0.06, 0.14, 0.06, 0, -0.1, 0.05, grip); }
    else if (kind === 'shotgun') { add(0.09, 0.1, 0.4, 0, 0, -0.12); add(0.05, 0.05, 0.42, 0, 0.03, -0.36, dark); add(0.07, 0.08, 0.2, 0, -0.02, 0.26, grip); }
    else if (kind === 'dmr') { add(0.08, 0.1, 0.5, 0, 0, -0.16); add(0.03, 0.06, 0.1, 0, 0.07, -0.1, dark); add(0.07, 0.08, 0.22, 0, -0.02, 0.28, grip); }
    else if (kind === 'grenade') { const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), dark); s.position.set(0, 0, -0.1); g.add(s); }
    else { add(0.09, 0.1, 0.42, 0, 0, -0.14); add(0.045, 0.045, 0.4, 0, 0.025, -0.38, grip); add(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip); }
    g.position.set(0.24, -0.2, -0.42);
    return g;
  }

  const models = {};
  for (const kind of [...Object.keys(WEAPONS), 'grenade']) {
    models[kind] = buildModel(kind);
    models[kind].visible = false;
    camera.add(models[kind]);
  }
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0.24, -0.18, -0.95); flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);
  const torch = new THREE.SpotLight(new THREE.Color('#ffd9a0'), 0, 26, 0.5, 0.45, 1.2);
  torch.position.set(0, 0, 0);
  camera.add(torch); camera.add(torch.target);
  torch.target.position.set(0, 0, -1);

  const state = {
    current: 'rifle', owned: ['pistol', 'rifle'], grenades: 0,
    mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bobPhase: 0, aiming: false, torchOn: false,
  };
  function def() { return WEAPONS[state.current]; }
  function showModel() {
    for (const [k, m] of Object.entries(models)) m.visible = k === state.current;
  }
  showModel();

  return {
    state,
    def,
    owned: () => state.owned,
    hasGrenade: () => state.grenades > 0,
    select(kind) {
      if (kind === 'grenade') { if (state.grenades <= 0) return false; }
      else if (!state.owned.includes(kind)) return false;
      if (state.current === kind) return true;
      state.current = kind; state.reloadLeft = 0; state.cooldown = 0.25;
      const d = def();
      if (d) { state.mag = d.mag; state.reserve = d.reserve; }
      showModel();
      return true;
    },
    cycle(dir) {
      const list = [...state.owned, ...(state.grenades > 0 ? ['grenade'] : [])];
      const i = list.indexOf(state.current);
      const next = list[(i + dir + list.length) % list.length];
      return this.select(next);
    },
    buy(kind, money) {
      const price = kind === 'grenade' ? GRENADE.price : WEAPONS[kind].price;
      if (money < price) return { ok: false, reason: 'not enough money' };
      if (kind === 'grenade') { if (state.grenades >= 2) return { ok: false, reason: 'max 2 grenades' }; state.grenades += 1; }
      else if (state.owned.includes(kind)) return { ok: false, reason: 'already owned' };
      else state.owned.push(kind);
      return { ok: true, price };
    },
    resetRound() {
      state.owned = ['pistol']; state.grenades = 0;
      this.select('pistol');
      state.mag = WEAPONS.pistol.mag; state.reserve = WEAPONS.pistol.reserve;
    },
    giveStarter() { if (!state.owned.includes('rifle')) state.owned.push('rifle'); this.select('rifle'); },
    ready() { return state.current !== 'grenade' && state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0; },
    pullTrigger() { state.cooldown = def().gap; state.flash = 0.06; state.kick = 0.055; },
    takeRound() { if (state.mag <= 0) return false; state.mag -= 1; return true; },
    throwGrenade() { if (state.grenades <= 0) return false; state.grenades -= 1; if (state.grenades === 0 && state.current === 'grenade') this.select('pistol'); return true; },
    reload() {
      const d = def();
      if (!d || state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return;
      state.reloadLeft = d.reload;
    },
    spread(speed) {
      const d = def();
      if (!d) return 0;
      const base = d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove;
      return state.aiming ? base * 0.45 : base;
    },
    aimFov() { return state.aiming ? 55 : 74; },
    step(dt, speed) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      state.bobPhase += dt * (2 + speed * 1.6);
      const bob = Math.min(1, speed / 5.2) * 0.012;
      const m = models[state.current];
      const aimX = state.aiming ? 0 : 0.24;
      const aimY = state.aiming ? -0.155 : -0.2;
      m.position.x += (aimX - m.position.x) * Math.min(1, dt * 14);
      m.position.y = aimY + Math.sin(state.bobPhase * 2) * bob;
      m.position.z = -0.42 + state.kick;
      m.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        const d = def();
        m.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
        if (state.reloadLeft === 0) {
          const need = d.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take; state.reserve -= take;
        }
      }
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 30;
      flashLight.intensity = state.flash > 0 ? 18 : 0;
      torch.intensity = state.torchOn ? 30 : 0;
    },
  };
}
