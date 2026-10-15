// Which vehicle you drive. Read once at load, exactly like planet.js: the wheel
// layout, mass, inertia and suspension rates are all derived into module-level
// constants in physics.js, so switching chassis reloads the page instead of trying
// to rebuild a live rigid body.
const KEY = 'rover.chassis';

function read() {
  try { return localStorage.getItem(KEY); } catch (e) { return null; } // storage may be blocked
}
const IDS = ['truck', 'crawler', 'hauler', 'buggy', 'speedster', 'galatea', 'glider'];
export const CHASSIS = IDS.includes(read()) ? read() : 'truck';

export function setChassis(id) {
  localStorage.setItem(KEY, IDS.includes(id) ? id : 'truck');
  location.reload();
}

// Everything that differs between the two machines lives here, so vehicle.js (art)
// and physics.js (behaviour) read one description instead of each keeping their own
// copy of the wheel positions.
const SPECS = {
  // ГЕРМЕС-3: the original four-wheel scout. These numbers are the tuned ones the
  // whole game was balanced around — do not drift them.
  truck: {
    id: 'truck',
    // Range and off-road ability (main.js): pack size and use per metre against the
    // stock pack, idle drain, solar array area, rolling resistance and churn off the
    // graded road, and how deep it fords.
    terrain: { pack: 1, perM: 0.0055, idle: 1, solar: 1, offRoll: 1, offDrag: 1, wade: 1.1 },
    blurb: 'збалансований, прощає помилки; на швидкості відключає передній міст',
    name: 'СКАУТ 4×4',
    tag: 'сонячний ровер · Гермес-3',
    driveLabel: ['4×4', '4×2'],
    wheelScale: 1.2,
    wheelX: 1.75,
    hullW: 3.1,
    axleZ: [2.4, -2.4],
    turnZ: -2.4, // steering pivots about the rear axle
    susp: { Lmin: 0.15, Lmax: 0.72, Lfree: 0.52, Lstatic: 0.465 },
    steerTime: 0.5, // seconds from centre to full lock
    progLen: 0.15, // how quickly the coil firms up past static sag (smaller = sooner)
    damp: { bump: 1, rebound: 1 },
    mass: 4200,
    box: { w: 3.6, h: 2.0, l: 7.2 },
    comY: -0.32,
    mu: 1.3,
    vMax: 12,
    vMaxBoost: 34,
    awdSplit: true, // front hubs disengage at speed
    lockers: false, // open diffs: a wheel in the air still takes its share of torque
    lowGear: 1, // multiplies the stock tractive-force ceiling, not the power
    arb: [1, 1], // anti-roll bar stiffness per axle
    climb: 0.65, // tallest step a tyre mounts, in wheel radii
    tyreFaceX: 2.0,
    hullGrids: [
      { xs: [-1.2, 0, 1.2], ys: [-0.5], zs: [-3.3, -1.1, 1.1, 3.3] },
      { xs: [-1.55, 0, 1.55], ys: [0.35, 0.85], zs: [-3.6, -1.8, 0, 1.8, 3.7] },
      { xs: [-1.35, 0, 1.35], ys: [1.38], zs: [-3.2, -1.5, 0.5, 2.0] },
      { xs: [-1.55, 1.55], ys: [-0.45], zs: [-3.4, -1.7, 0, 1.7, 3.4] },
    ],
    mounts: {
      head: { x: 0.8, y: 0.36, z: 3.7, glowZ: 3.84, aimX: 0.55 },
      far: { y: 1.4, z: 2.0 },
      cab: { y: 1.0, z: 1.7 },
      marker: { x: 1.55, y: -0.2, z: 0.1 },
    },
  },
  // ТИТАН-6: a six-wheel crawler. Three axles, all of them driven and all of them
  // steered (the rear pair counter-steers, see turnZ), a long low frame and half
  // again the mass. It is slower and it leans less; it climbs and it does not care
  // if one wheel is in a hole.
  crawler: {
    id: 'crawler',
    terrain: { pack: 1.5, perM: 0.005, idle: 1.3, solar: 1.6, offRoll: 0.85, offDrag: 0.9, wade: 1.4 },
    blurb: 'повільний, але лізе будь-куди: блоковані диференціали, усі колеса кермові',
    name: 'КРАУЛЕР 6×6',
    tag: 'важкий краулер · Титан-6',
    driveLabel: ['6×6', '6×6'],
    wheelScale: 1.12,
    wheelX: 2.02, // wide track for the balloon tyres
    hullW: 3.4,
    axleZ: [3.35, 0, -3.35],
    // Ahead of the rear axle, so the rear wheels steer the other way: the whole
    // 9-metre machine turns inside a radius a four-wheeler that long could not.
    turnZ: -1.1,
    // Long-travel and soft: 0.52 m of bump from ride height on a spring with half a
    // metre of static sag, so a rock the size of a sidewall is swallowed by the wheel
    // instead of lifting the body. Flat test bed at 25 km/h: a 30 cm rock lifts it
    // 2 cm (was 15), a 60 cm one 9 cm (was 48). The free length sits past full droop,
    // so a wheel dropping into a hole still pushes down on it. A spring this soft
    // leans, so the ride stays low and the mass sits lower (comY) — with both, a blind
    // full-throttle weave over steep hills rolls it no more often than the stiff one.
    susp: { Lmin: 0.1, Lmax: 1.08, Lfree: 1.12, Lstatic: 0.62 },
    steerTime: 0.5,
    progLen: 0.5,
    // Light bump damping — it is the damper, not the spring, that kicks a body up
    // off a sharp edge — and a firmer, but still under-critical, rebound.
    damp: { bump: 0.1, rebound: 0.22 },
    mass: 6400,
    box: { w: 3.8, h: 2.1, l: 10.0 },
    comY: -0.55, // even lower: the pack hangs between the frame rails
    mu: 1.45, // six contact patches
    vMax: 10,
    vMaxBoost: 24,
    awdSplit: false, // permanent 6×6
    // A crawler's whole point. Locked diffs send the torque to whichever wheels are
    // actually on the ground; the low range puts more force down at walking pace
    // (the power, and so the top speed, is the same motor's); and the middle axle
    // has no anti-roll bar, so the chassis can twist and keep all six tyres loaded
    // over ground that lifts a rigid three-axle frame onto four of them.
    lockers: true,
    lowGear: 1.6,
    arb: [1, 0, 1],
    // Six driven wheels push the front pair up a ledge a lone axle could not.
    climb: 0.8,
    tyreFaceX: 2.62,
    hullGrids: [
      { xs: [-1.3, 0, 1.3], ys: [-0.52], zs: [-4.4, -2.6, -0.9, 0.9, 2.6, 4.4] },
      { xs: [-1.7, 0, 1.7], ys: [0.3, 0.8], zs: [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5] },
      { xs: [-1.35, 0, 1.35], ys: [1.85], zs: [-4.3, -1.5, 1.4, 3.9] }, // cage and cab roof
      { xs: [-1.75, 1.75], ys: [-0.45], zs: [-4.2, -2.1, 0, 2.1, 4.2] },
    ],
    mounts: {
      head: { x: 1.0, y: 0.32, z: 4.6, glowZ: 4.72, aimX: 0.7 },
      far: { y: 1.97, z: 3.4 },
      cab: { y: 1.4, z: 2.9 },
      marker: { x: 1.45, y: -0.2, z: 1.67 },
    },
  },
  // АТЛАС-8: an eight-wheel armoured transporter. Two steered axles up front, two
  // close-coupled ones at the back, a tall slab-sided hull sitting over the wheels
  // and a forward cab with a big raked screen. The crawler's long-travel soft
  // suspension and locked diffs, on bigger tyres under a heavier body.
  hauler: {
    id: 'hauler',
    // Huge pack and array, heavy appetite; wades rivers that stop anything else.
    terrain: { pack: 3, perM: 0.0075, idle: 2, solar: 2.6, offRoll: 0.8, offDrag: 0.9, wade: 1.9 },
    blurb: 'важкий і стійкий, знижена передача; неквапливий, зате майже не перекидається',
    name: 'ТРАНСПОРТЕР 8×8',
    tag: 'броньований транспортер · Атлас-8',
    driveLabel: ['8×8', '8×8'],
    wheelScale: 1.3,
    wheelX: 2.15,
    hullW: 3.9,
    axleZ: [4.6, 2.1, -2.8, -5.3],
    // Between the rear pair: both front axles steer (the second one less), the rear
    // pair toe a little either way about their own midpoint, like a real 8×8.
    turnZ: -4.05,
    susp: { Lmin: 0.12, Lmax: 1.1, Lfree: 1.14, Lstatic: 0.64 },
    steerTime: 0.55,
    progLen: 0.5,
    damp: { bump: 0.1, rebound: 0.22 },
    mass: 9000,
    box: { w: 4.0, h: 2.6, l: 12.6 },
    comY: -0.85, // batteries and drivetrain in the tub, low between the wheels
    mu: 1.5,
    vMax: 10,
    vMaxBoost: 22,
    awdSplit: false,
    lockers: true,
    lowGear: 1.8,
    arb: [1.6, 1, 1, 1.6],
    climb: 0.8,
    tyreFaceX: 2.84,
    hullGrids: [
      { xs: [-1.0, 0, 1.0], ys: [-0.58], zs: [-5.8, -3.5, -1.2, 1.2, 3.5, 5.7] },
      { xs: [-1.95, 0, 1.95], ys: [1.0, 1.9], zs: [-6.2, -4.1, -2, 0, 2, 4.1, 5.9] },
      { xs: [-1.5, 0, 1.5], ys: [2.8], zs: [-6.0, -2.0, 2.0, 4.2] },
      { xs: [-1.2, 1.2], ys: [-0.5], zs: [-5.6, -2.8, 0, 2.8, 5.6] },
    ],
    mounts: {
      head: { x: 1.25, y: 1.05, z: 6.02, glowZ: 6.12, aimX: 0.8 },
      far: { y: 2.98, z: 4.3 }, // just proud of the roof bar's lens (4.26)
      cab: { y: 2.3, z: 3.6 },
      marker: { x: 1.99, y: 1.05, z: -2.0 }, // the middle of the three amber side lamps
    },
  },
  // КОЙОТ: a light buggy. Big tyres out on long arms, a narrow faceted copper body
  // riding high between them, a glass canopy over the nose. Quick and bouncy.
  buggy: {
    id: 'buggy',
    terrain: { pack: 1.1, perM: 0.0054, idle: 0.7, solar: 0.6, offRoll: 0.85, offDrag: 0.85, wade: 1.0 },
    blurb: 'легкий і швидкий, довгий хід підвіски ковтає горби; далі за скаута, краще бездоріжжям і на форсажі',
    name: 'БАГІ 4×4',
    tag: 'легкий баггі · Койот',
    driveLabel: ['4×4', '4×2'],
    wheelScale: 1.3,
    wheelX: 2.1,
    hullW: 2.4,
    axleZ: [2.4, -2.5],
    turnZ: -2.5,
    // The crawler's long-travel soft corners: a bump is soaked up by the wheel
    // instead of throwing the light body about — it was a pogo stick on stiff ones.
    susp: { Lmin: 0.1, Lmax: 1.08, Lfree: 1.12, Lstatic: 0.62 },
    steerTime: 0.5,
    progLen: 0.5,
    damp: { bump: 0.1, rebound: 0.22 },
    mass: 3000,
    box: { w: 3.0, h: 1.6, l: 6.8 },
    comY: -0.8, // pack slung low in the belly
    mu: 1.4,
    vMax: 13,
    vMaxRwd: 24,
    vMaxBoost: 35,
    power: 1.25,
    drag: 0.7,
    awdSplit: false, // permanent 4×4
    lockers: true,
    lowGear: 1.4,
    arb: [1, 1],
    climb: 0.8,
    tyreFaceX: 2.79,
    hullGrids: [
      { xs: [-0.9, 0, 0.9], ys: [-0.35], zs: [-3, -1.5, 0, 1.5, 3] },
      { xs: [-1.25, 1.25], ys: [0.4], zs: [-3, -1.5, 0, 1.5, 3] },
      { xs: [-0.8, 0.8], ys: [1.0], zs: [-2.5, -0.5, 1.0] },
    ],
    mounts: {
      head: { x: 0.75, y: 0.2, z: 3.56, glowZ: 3.62, aimX: 0.5 },
      far: { y: 1.46, z: -0.34 }, // roof bar on struts behind the canopy
      cab: { y: 0.5, z: 1.45, k: 0.3 }, // dash glow, low and dim in a small cockpit
      marker: { x: 1.1, y: 0.35, z: 2.7 }, // the amber strips on the nose flanks
    },
  },
  // СТРІЛА: the fast one. Low, light, open-wheeled, a single-seat canopy, a hotter
  // motor and a body that cuts through the dust — about half again the scout's top
  // speed, on shorter, firmer suspension that wants smooth ground.
  speedster: {
    id: 'speedster',
    // A road car: tiny pack, tiny array, and off the graded road it bogs down in the
    // regolith; low nose, so water much over the hubs stops it.
    terrain: { pack: 0.6, perM: 0.0055, idle: 0.6, solar: 0.45, offRoll: 3.2, offDrag: 14, wade: 0.45 },
    blurb: 'найшвидший: притискна сила, широкі задні шини; любить рівну дорогу',
    name: 'СПІДСТЕР 4×4',
    tag: 'швидкісний ровер · Стріла',
    driveLabel: ['4×4', '4×2'],
    wheelScale: 1.18,
    wheelX: 1.95,
    hullW: 2.3,
    axleZ: [2.55, -2.45],
    turnZ: -2.45,
    susp: { Lmin: 0.12, Lmax: 0.62, Lfree: 0.56, Lstatic: 0.42 },
    steerTime: 0.35,
    progLen: 0.12, // firms up hard, so the wings can't bottom it out
    damp: { bump: 0.8, rebound: 0.9 },
    mass: 1900,
    box: { w: 2.9, h: 1.3, l: 7.0 },
    comY: -0.7,
    mu: 1.6, // soft compound
    vMax: 40, // always in 4×4 now, so this is the cruise ceiling
    vMaxRwd: 40,
    vMaxBoost: 48,
    power: 1.6,
    // Aero: ~0.35 of its weight at 100 km/h, ~1.2 at 180, capped at 1.6.
    downforce: 7,
    drag: 0.35,
    awdSplit: false, // permanent 4×4: rear-drive-only at speed kept spinning it out
    lockers: false,
    lowGear: 1,
    arb: [1.3, 1.1],
    climb: 0.6,
    // The nose is far below the scout's shock towers: drop the towers and the upper
    // arms to the tub and brace them to it (brace.y follows the body's top line).
    // F1-style rear: 15 % taller, 35 % wider tyres, track pushed out to match, and
    // the extra rubber grips harder — the rear bites, so it understeers, not spins.
    rear: { scale: 1.15, width: 1.35, dx: 0.27, mu: 1.2 },
    corner: { topY: 0.22, upY: -0.06, brace: { x: 0.72, y: (z) => (z > 0 ? -0.08 : 0.12) } },
    // Per axle: narrow round-crowned fronts, and the wide rears' outer face, which
    // stands 0.6 m further out (measured off the wheel mesh: 2.50 and 3.08).
    tyreFaceX: [2.42, 3.0],
    hullGrids: [
      { xs: [-0.8, 0, 0.8], ys: [-0.95], zs: [-3, -1.5, 0, 1.5, 3.3] },
      { xs: [-1.3, 1.3], ys: [-0.3], zs: [-1.2, 0, 1.2] },
      { xs: [-0.9, 0.9], ys: [-0.4], zs: [-3.1, 3.2] },
      { xs: [-0.5, 0.5], ys: [0.95], zs: [0, 1.0] },
      { xs: [-1.1, 1.1], ys: [0.85], zs: [-3.3] },
    ],
    mounts: {
      head: { x: 0.5, y: -0.5, z: 3.5, glowZ: 3.62, aimX: 0.4 },
      far: { y: 1.16, z: -0.2 }, // pod on the front of the spine
      cab: { y: 0.1, z: 1.3, k: 0.3 },
      marker: { x: 1.34, y: -0.7, z: 0.6 }, // the lime pair on the sidepods
    },
  },
  // ГАЛАТЕЯ: a six-wheeled research rover on walking-machine legs. A white oval hull
  // rides high; the front wheels hang on their own jointed legs, the four rear ones
  // on a rocker bogie each side, so every wheel goes up and down with a lot of travel.
  galatea: {
    id: 'galatea',
    terrain: { pack: 2, perM: 0.008, idle: 1.3, solar: 1.9, offRoll: 0.85, offDrag: 0.9, wade: 1.6 },
    blurb: 'дослідник на ногах: передні колеса на окремих ногах, задні четверо на балках-візках; м’яко ковтає камені, повертає як танк — бортами',
    name: 'ГАЛАТЕЯ 6×6',
    tag: 'дослідницький ровер · Галатея',
    driveLabel: ['6×6', '6×6'],
    wheelScale: 1.15,
    wheelX: 3.45, // splayed far out on the legs
    hullW: 3.2,
    axleZ: [3.5, 0, -3.5],
    // No wheel steers: it turns like a tank, the left and right sides driven apart
    // (see physics.js), and spins on the spot with no throttle at all.
    turnZ: 0,
    skidSteer: true,
    legs: true,
    susp: { Lmin: 0.1, Lmax: 1.3, Lfree: 1.36, Lstatic: 0.72 },
    steerTime: 0.5,
    progLen: 0.5,
    damp: { bump: 0.12, rebound: 0.24 },
    mass: 5600,
    box: { w: 3.4, h: 1.7, l: 8.8 },
    comY: -0.5,
    mu: 1.45,
    vMax: 11,
    vMaxBoost: 26,
    awdSplit: false,
    lockers: true,
    lowGear: 1.5,
    arb: [0.8, 0, 0.8],
    climb: 0.85,
    tyreFaceX: 4.07,
    // The oval nose leads; the gunmetal module is the tail.
    hullGrids: [
      { xs: [-1.1, 0, 1.1], ys: [-0.02], zs: [3.8, 2.2, 0.7, -0.7, -2.2, -3.9] },
      { xs: [-1.6, 0, 1.6], ys: [0.45, 0.95], zs: [3.9, 2.2, 0.6, -1.0, -2.6, -4.2] },
      { xs: [-1.15, 0, 1.15], ys: [1.48], zs: [3.4, 1.5, -0.5, -2.4] },
      { xs: [-1.3, 1.3], ys: [1.15], zs: [-4.4] },
    ],
    mounts: {
      head: { x: 0.78, y: 0.62, z: 4.3, glowZ: 4.42, aimX: 0.55 },
      far: { y: 1.5, z: 3.32 },
      cab: { y: 1.25, z: -3.4 },
      marker: { x: 1.62, y: 0.55, z: -1.2 },
    },
  },
  // КОЛІБРІ: a hover glider. No wheels — physics.js flies it as a HoverSim, holding
  // it at a chosen height (to 15 m) over the ground, water or a bridge. The wheel
  // and suspension fields below only keep shared code happy; nothing reads them.
  glider: {
    id: 'glider',
    flight: true,
    // Hovering burns power just to stay up, so it drains even standing still.
    terrain: { pack: 1.3, perM: 0.0062, idle: 7, solar: 0.9, offRoll: 1, offDrag: 1, wade: 99 },
    blurb: 'летить над поверхнею до 15 м: Shift — вгору, Ctrl — вниз; не боїться ні каміння, ні води',
    name: 'ГЛАЙДЕР',
    tag: 'ховер-глайдер · Колібрі',
    driveLabel: ['політ', 'політ'],
    wheelScale: 1,
    wheelX: 1.6,
    hullW: 2.6,
    axleZ: [],
    turnZ: 0,
    susp: { Lmin: 0.1, Lmax: 0.7, Lfree: 0.6, Lstatic: 0.5 },
    steerTime: 0.5,
    progLen: 0.15,
    damp: { bump: 1, rebound: 1 },
    mass: 2600,
    box: { w: 3.4, h: 1.9, l: 6.4 },
    comY: 0,
    mu: 1,
    vMax: 24,
    vMaxBoost: 24,
    awdSplit: false,
    lockers: false,
    lowGear: 1,
    arb: [],
    climb: 0.6,
    tyreFaceX: 2,
    hullGrids: [{ xs: [-1, 1], ys: [-0.6], zs: [-2.5, 2.5] }],
    mounts: {
      head: { x: 0.55, y: -0.15, z: 3.15, glowZ: 3.25, aimX: 0.45 },
      far: { y: 1.25, z: 1.7 },
      cab: { y: 0.6, z: 1.9 },
      marker: { x: 1.75, y: -0.1, z: -0.6 },
    },
  },
};

export const SPEC = SPECS[CHASSIS];
export const CHASSIS_LIST = [SPECS.truck, SPECS.crawler, SPECS.hauler, SPECS.buggy, SPECS.speedster, SPECS.galatea, SPECS.glider];

// Everything derived from one chassis description: its wheel table, axle pairs and
// steering geometry. The game's own chassis is built once below; the garage builds
// any other one it wants to show.
export function chassisKit(id) {
  const SPEC = SPECS[id] || SPECS.truck;
  // One entry per wheel, the single source of truth for both the art and the sim —
  // they are matched by index in main.js, so the order must come from one place.
  // `dz` is the lever arm about the steering centre; 0 means the wheel never steers.
  // A chassis may run bigger, wider tyres on the rear axle (the speedster, like an
  // F1 car): `R` is each wheel's own radius, `wk` its extra width, `my` how much higher
  // its mount sits so the body still rides level, `mu` its grip factor.
  const R0 = 0.855 * SPEC.wheelScale;
  const REAR = SPEC.rear || {};
  const WHEEL_DEFS = SPEC.axleZ.flatMap((z, axle) =>
    [1, -1].map((s) => {
      const rear = axle === SPEC.axleZ.length - 1 && SPEC.rear;
      const rs = rear ? REAR.scale : 1;
      const x = s * (SPEC.wheelX + (rear ? REAR.dx : 0));
      return {
        name: `${SPEC.axleZ.length === 2 ? 'FR'[axle] : SPEC.axleZ.length === 3 ? 'FMR'[axle] : axle + 1}${s > 0 ? 'L' : 'R'}`,
        s,
        axle,
        z,
        x,
        dz: z - SPEC.turnZ,
        front: axle === 0,
        R: R0 * rs,
        my: R0 * rs - R0,
        rs,
        wk: rear ? REAR.width : 1,
        mu: rear ? REAR.mu : 1,
      };
    })
  );

  // Left/right pairs of one axle, for the anti-roll bars.
  const AXLE_PAIRS = SPEC.axleZ.map((_, axle) => [axle * 2, axle * 2 + 1]);

  const REAR_Z = SPEC.axleZ[SPEC.axleZ.length - 1];
  // Rear-axle counter-steer is a low-speed trick. At speed it makes every input twice as
  // sharp, and with a maxed motor the crawler rolled itself over on an ordinary weave.
  // So the steering centre slides back onto the rear axle between these speeds, which
  // straightens the rear wheels — what real all-wheel-steer trucks do. For the scout the
  // centre already sits on the rear axle, so nothing changes there.
  const RS_FULL = 12 / 3.6;
  const RS_OFF = 35 / 3.6;

  // Ackermann for an arbitrary layout: every wheel points along the tangent of its own
  // circle about one turn centre, which sits abeam the steering centre at radius R. For
  // the four-wheeler (turn centre on the rear axle) this reduces exactly to the old
  // two-wheel formula; for the crawler it falls out as all-wheel steering for free.
  function steerAngle(w, delta, speed = 0) {
    if (Math.abs(delta) < 1e-4) return 0;
    if (SPEC.skidSteer || (SPEC.frontSteerOnly && !w.front)) return 0;
    const t = Math.min(1, Math.max(0, (Math.abs(speed) - RS_FULL) / (RS_OFF - RS_FULL)));
    const turnZ = SPEC.turnZ + (REAR_Z - SPEC.turnZ) * t * t * (3 - 2 * t);
    const dz = w.z - turnZ;
    if (Math.abs(dz) < 1e-6) return 0;
    const s = Math.sign(delta);
    const R = (SPEC.axleZ[0] - turnZ) / Math.tan(Math.abs(delta));
    return s * Math.atan2(dz, R - s * w.x);
  }
  return { CHASSIS: SPEC.id, SPEC, WHEEL_DEFS, AXLE_PAIRS, steerAngle };
}

const KIT = chassisKit(CHASSIS);
export const WHEEL_DEFS = KIT.WHEEL_DEFS;
export const AXLE_PAIRS = KIT.AXLE_PAIRS;
export const steerAngle = KIT.steerAngle;
