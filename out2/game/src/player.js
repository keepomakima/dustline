// Player movement: acceleration, friction, gravity, crouch, jump and sprint, resolved
// as a box against the world's colliders one axis at a time, so a wall never swallows
// the player. Shared by bots through createBody below.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 7.0;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createBody(colliders, x, z) {
  const body = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0, eye: STAND_EYE, onGround: true, crouching: false, height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();
  function overlaps(px, py, pz, height, lift) {
    probe.min.set(px - RADIUS, py + lift, pz - RADIUS);
    probe.max.set(px + RADIUS, py + height - lift, pz + RADIUS);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }
  function move(dt, wishX, wishZ, speed, wantJump, wantCrouch) {
    if (wantCrouch && !body.crouching) { body.crouching = true; body.height = CROUCH_HEIGHT; }
    else if (!wantCrouch && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false; body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && !wishX && !wishZ) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp; body.velocity.z *= damp;
    }
    if (wantJump && body.onGround) { body.velocity.y = JUMP_SPEED; body.onGround = false; }
    body.velocity.y -= GRAVITY * dt;
    const nx = body.position.x + body.velocity.x * dt;
    if (!overlaps(nx, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nx;
    else body.velocity.x = 0;
    const nz = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nz, body.height, 0.04)) body.position.z = nz;
    else body.velocity.z = 0;
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) { body.position.y = hit.max.y; body.velocity.y = 0; body.onGround = true; }
    else if (hit) { body.position.y = hit.min.y - body.height; body.velocity.y = 0; }
    if (body.position.y < 0) { body.position.y = 0; body.velocity.y = 0; body.onGround = true; }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }
  return { body, move, overlaps };
}

export function createPlayer(colliders) {
  const { body, move } = createBody(colliders, 0, 15.5);
  const wish = new THREE.Vector3();
  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }
  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }
  function step(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw); const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    const sprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && forward > 0 && !body.crouching;
    const speed = body.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    move(dt, wish.x, wish.z, speed,
      keys.has('Space'),
      keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
    return sprinting;
  }
  return {
    state: body, step, look, recoil,
    groundSpeed() { return Math.hypot(body.velocity.x, body.velocity.z); },
  };
}
