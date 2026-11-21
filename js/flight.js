// Flight model B ("hybrid"): rate-based rotation, bank-to-turn, speed/energy trade,
// velocity that lags the nose slightly, optional auto-level assist.
// Local axes: forward = -Z, up = +Y, right = +X.
import * as THREE from 'three';

const FWD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const clamp = THREE.MathUtils.clamp;

export const FLIGHT_PARAMS = {
  cruise: 72,          // m/s the plane settles to
  minSpeed: 45,
  maxSpeed: 115,
  maxRoll: 1.6,        // rad/s (~90 deg/s)
  maxPitch: 0.65,      // rad/s (~37 deg/s)
  rollResp: 5,         // how fast roll rate reaches its target (1/s)
  pitchResp: 4,
  levelGain: 1.8,      // auto-level strength
  gravity: 9.81,
  gravityFactor: 0.85, // how strongly climbs/dives change speed
  dragK: 0.22,         // pull back towards cruise speed
  slipTime: 0.28,      // seconds for velocity to swing onto the nose direction
  ceiling: 1500,       // soft altitude ceiling (m)
  glideSink: 7,        // m/s the plane sinks with the engine off
  glideNoseDown: 0.15, // rad/s nose-down tendency with the engine off
};

export class FlightModel {
  constructor(params = FLIGHT_PARAMS) {
    this.p = params;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.speed = params.cruise;
    this.rollRate = 0; this.pitchRate = 0; this.yawRate = 0;
    this.engineOn = true; // false when out of fuel: no thrust, the plane glides down
    this.bank = 0; this.pitch = 0;
  }

  reset(pos, dir) {
    this.pos.copy(pos);
    _v.copy(dir).normalize();
    // Matrix4.lookAt(eye, target) puts -Z towards target
    _m.lookAt(new THREE.Vector3(), _v, UP);
    this.quat.setFromRotationMatrix(_m);
    this.speed = this.p.cruise;
    this.vel.copy(_v).multiplyScalar(this.speed);
    this.rollRate = this.pitchRate = this.yawRate = 0;
    this._axes();
  }

  _axes() {
    this.forward.copy(FWD).applyQuaternion(this.quat);
    this.up.copy(UP).applyQuaternion(this.quat);
    this.right.copy(RIGHT).applyQuaternion(this.quat);
    this.bank = Math.atan2(-this.right.y, this.up.y);       // + = right wing down
    this.pitch = Math.asin(clamp(this.forward.y, -1, 1));   // + = nose up
  }

  // input.roll: -1 (left) .. 1 (right); input.pitch: -1 (nose down) .. 1 (nose up)
  update(dt, input, opts = {}) {
    const p = this.p;
    this._axes();

    // --- target angular rates from keys ---
    let rollT = input.roll * p.maxRoll;
    if (Math.abs(input.roll) < 0.01 && opts.autoLevel) {
      rollT = clamp(-this.bank * p.levelGain, -p.maxRoll * 0.7, p.maxRoll * 0.7);
    }
    let pitchT = input.pitch * p.maxPitch;
    // soft ceiling: gently push the nose down above the ceiling
    if (this.pos.y > p.ceiling && this.forward.y > -0.2) {
      pitchT = Math.min(pitchT, -0.5 * Math.min(1, (this.pos.y - p.ceiling) / 200));
    }
    // engine out: the nose keeps wanting to drop
    if (!this.engineOn && this.pitch > -0.25) pitchT -= p.glideNoseDown;
    // near minimum speed in a steep climb the nose wants to drop
    if (this.speed < p.minSpeed + 4 && this.pitch > 0.35) pitchT = Math.min(pitchT, -0.25);

    this.rollRate += (rollT - this.rollRate) * (1 - Math.exp(-dt * p.rollResp));
    this.pitchRate += (pitchT - this.pitchRate) * (1 - Math.exp(-dt * p.pitchResp));

    // --- apply roll and pitch about the plane's own axes ---
    _q.setFromAxisAngle(FWD, this.rollRate * dt); this.quat.multiply(_q);
    _q.setFromAxisAngle(RIGHT, this.pitchRate * dt); this.quat.multiply(_q);

    // --- bank-to-turn: coordinated turn rate = g * tan(bank) / v ---
    const sb = Math.sin(this.bank), cb = Math.cos(this.bank);
    const upright = THREE.MathUtils.smoothstep(this.up.y, -0.05, 0.25); // no turn when inverted
    const levelness = Math.max(0, Math.cos(this.pitch));
    this.yawRate = (p.gravity * sb) / Math.max(cb, 0.25) / Math.max(this.speed, 30) * upright * levelness;
    _q.setFromAxisAngle(UP, -this.yawRate * dt); this.quat.premultiply(_q);
    this.quat.normalize();
    this._axes();

    // --- speed: gravity along the flight path + drag towards cruise ---
    const target = this.engineOn ? p.cruise : 0; // no thrust -> drag bleeds speed
    const acc = -p.gravity * p.gravityFactor * this.forward.y + (target - this.speed) * p.dragK;
    this.speed = clamp(this.speed + acc * dt, p.minSpeed, p.maxSpeed);

    // --- velocity swings onto the nose direction over ~slipTime ---
    _v.copy(this.forward).multiplyScalar(this.speed);
    this.vel.lerp(_v, 1 - Math.exp(-dt / p.slipTime)).setLength(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    if (!this.engineOn) this.pos.y -= p.glideSink * dt;
  }
}
