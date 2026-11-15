# DUSTLINE — Yard 7

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/keepomakima/dustline/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/keepomakima/dustline/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

DUSTLINE is a round-based tactical FPS in the browser, built with Three.js — an original game inspired by classic tactical FPS gameplay (its own map, art, sounds and names). A five-strong STRIKER squad — you and four AI squadmates — against five WARDEN bots in a dusk desert yard: plant the bomb at Site A or B, or eliminate the whole enemy team. First to 7 rounds (max 12).

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network at runtime: static ES modules, vendored Three.js 0.187.0, all art procedural, all sound synthesised with WebAudio.

## The game

- **Map — Yard 7:** a 44×34 m walled yard, Sites A and B, three lanes, a mid double-door, crates for cover, floating site letters and a dusk sky.
- **Rounds & economy:** 15 s buy phase, 100 s rounds. Kills pay $300, a round win $3250, a loss $1900. First to 7, max 12 rounds.
- **Arsenal:** P9 pistol, VK-9 SMG, AR-7 rifle, SG-12 shotgun, DMR-8 marksman rifle, plus frag grenades (arc, bounce, blast falloff). Aim-down-sights (RMB: FOV 74→55, spread ×0.45), sprint, crouch, jump, flashlight, walk bob, recoil kick, muzzle flash, tracers and impact puffs.
- **Objective:** hold E for 3 s inside a site to plant; a 35 s fuse follows. A living WARDEN that reaches the bomb defuses it in 5 s.
- **Bots:** five WARDENs with a finite-state brain — patrol waypoints, investigate gunfire, engage on line-of-sight inside a view cone, hunt the last known position, rush to defuse. They walk a BFS waypoint graph, strafe while firing in bursts with distance/speed-based hit chance, and recover when stuck. They see and shoot your squadmates too, not just you.
- **Squad:** four AI STRIKER squadmates (VEX, ORIN, KESTREL, BRAM) fight beside you — 5v5. They hold formation behind you, call out contacts ("Contact! — Site A"), and keep fighting if you die: the camera spectates a living squadmate until the round resolves. Friendly fire is off.
- **HUD:** health, money, timer, round score, alive count, kill feed, bomb status, plant bar, buy menu with weapon stats, Tab scoreboard, minimap (spotted bots only), damage vignette and round banners.
- **Feel:** fixed 60 Hz simulation, deterministic `?shot=` captures, `window.__dustline` playtest probe, synthesised footsteps / shots / reload / plant beeps (M mutes).

## Controls

WASD move · Shift sprint · mouse look · click fire · RMB aim · R reload · 1–5 / wheel weapons · G grenade · E plant (hold) · F flashlight · B buy · Tab scoreboard · Ctrl crouch · Space jump · M mute.

---

<sub>Entered on [make.fun](https://make.fun/?ref=keepo&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
