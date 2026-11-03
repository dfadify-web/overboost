// =====================================================================================
//  Central physics & gameplay configuration. Units: metres, seconds, kilograms.
//  Internal axes: x = width, y = up, z = length (goals at ±z).
//  PHYS is the live, tunable copy used by every system; STANDARD_PHYS is the reference.
// =====================================================================================
export const PHYS_HZ = 120;
export const PHYS_DT = 1 / PHYS_HZ;

export const ARENA = {
  W: 81.92, // x extent (half 40.96)
  L: 102.4, // z extent (half 51.2)
  H: 20.44,
  cornerR: 11.52, // vertical corner transition
  curveR: 2.56, // floor↔wall & wall↔ceiling radius
  bandTop: 3.6,
  goalW: 17.855,
  goalH: 6.428,
  goalD: 8.8,
};

export interface PhysTuning {
  gravity: number;
  // ball
  ballRadius: number; ballMass: number; ballRestitution: number; ballFriction: number; ballDrag: number;
  ballMaxSpeed: number; ballMaxAngVel: number; ballStartHeight: number; ballStartSpeed: number;
  // car ground
  maxSpeed: number; throttleMax: number; throttleAccel0: number; brakeAccel: number; coastDecel: number;
  gripNormal: number; gripPowerslide: number; powerslideTurn: number; stickyAccel: number; carSpeedMul: number;
  // boost
  boostAccel: number; boostUsePerSec: number; boostStart: number; unlimitedBoost: boolean; boostPads: boolean;
  // jump / dodge
  jumpImpulse: number; jumpHoldAccel: number; jumpHoldTime: number; flipWindow: number; jumpBuffer: number;
  dodgeImpulse: number; backflipImpulse: number; dodgeTorque: number; dodgeTime: number; dodgeDeadzone: number;
  // air control (angular accelerations rad/s², damping 1/s)
  airPitch: number; airYaw: number; airRoll: number; airDampPitch: number; airDampYaw: number; airDampRoll: number;
  maxAngVel: number; airThrottle: number; airSens: number; airRollSens: number;
  // flip reset
  flipResetWheels: number;
  // training start state
  carStartX: number; carStartZ: number; carStartYaw: number; carStartSpeed: number;
  supersonic: number;
}

export const STANDARD_PHYS: PhysTuning = {
  gravity: 6.5,
  ballRadius: 0.9125, ballMass: 30, ballRestitution: 0.6, ballFriction: 0.35, ballDrag: 0.03,
  ballMaxSpeed: 60, ballMaxAngVel: 6, ballStartHeight: 0, ballStartSpeed: 0,
  maxSpeed: 23, throttleMax: 14.1, throttleAccel0: 16, brakeAccel: 35, coastDecel: 5.25,
  gripNormal: 22, gripPowerslide: 2.4, powerslideTurn: 1.45, stickyAccel: 3.25, carSpeedMul: 1,
  boostAccel: 9.92, boostUsePerSec: 33.3, boostStart: 33, unlimitedBoost: false, boostPads: true,
  jumpImpulse: 2.92, jumpHoldAccel: 14.6, jumpHoldTime: 0.2, flipWindow: 1.25, jumpBuffer: 0.08,
  dodgeImpulse: 5.0, backflipImpulse: 5.33, dodgeTorque: 55, dodgeTime: 0.65, dodgeDeadzone: 0.5,
  airPitch: 12.15, airYaw: 8.92, airRoll: 36.0, airDampPitch: 2.8, airDampYaw: 1.89, airDampRoll: 4.47,
  maxAngVel: 5.5, airThrottle: 0.667, airSens: 1, airRollSens: 1,
  flipResetWheels: 3,
  carStartX: 0, carStartZ: -30, carStartYaw: 0, carStartSpeed: 0,
  supersonic: 22,
};

/** Live tuning (mutated by training presets). Never edit STANDARD_PHYS. */
export const PHYS: PhysTuning = { ...STANDARD_PHYS };
export function applyTuning(t: Partial<PhysTuning>) { Object.assign(PHYS, STANDARD_PHYS, t); }

export const PRESETS: { id: string; name: string; t: Partial<PhysTuning> }[] = [
  { id: 'standard', name: 'Física estándar', t: {} },
  { id: 'lowgrav', name: 'Gravedad baja', t: { gravity: 3.25 } },
  { id: 'highgrav', name: 'Gravedad alta', t: { gravity: 9.75 } },
  { id: 'slowball', name: 'Balón lento', t: { ballMaxSpeed: 30, ballDrag: 0.35, ballRestitution: 0.45 } },
  { id: 'fastball', name: 'Balón rápido', t: { ballMaxSpeed: 60, ballRestitution: 0.75, ballMass: 22 } },
  { id: 'unlimited', name: 'Turbo infinito', t: { unlimitedBoost: true } },
  { id: 'noboost', name: 'Sin turbo', t: { boostStart: 0, boostPads: false } },
  { id: 'aerial', name: 'Práctica aérea', t: { unlimitedBoost: true, ballStartHeight: 9 } },
  { id: 'flipreset', name: 'Práctica flip reset', t: { unlimitedBoost: true, ballStartHeight: 12, ballStartSpeed: 0 } },
];

// Legacy accessors kept for existing modules (read live values)
export const BALL = {
  get radius() { return PHYS.ballRadius; }, get mass() { return PHYS.ballMass; },
  get maxSpeed() { return PHYS.ballMaxSpeed; }, get maxAngVel() { return PHYS.ballMaxAngVel; },
  get restitution() { return PHYS.ballRestitution; }, get friction() { return PHYS.ballFriction; }, get drag() { return PHYS.ballDrag; },
};
export const GRAVITY = STANDARD_PHYS.gravity;

export const TEAM_A = 0x19d3ff; // cyan  (goal at -z)
export const TEAM_B = 0xffa21a; // amber (goal at +z)

// Collision groups: membership << 16 | filter
export const G_ARENA = 0x0001;
export const G_CAR = 0x0002;
export const G_BALL = 0x0004;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
