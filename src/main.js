import * as THREE from 'three';
import { GLOW } from './glow.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildVehicle, WHEEL_R, SUSP } from './vehicle.js';
import { createPost, tagLayers } from './post.js';
import { createSunShadows } from './sunshadow.js';
import { createAmbient } from './ambient.js';
import { createBeams } from './beams.js';
import { CHASSIS, SPEC, CHASSIS_LIST, WHEEL_DEFS, setChassis } from './chassis.js';
import { VehicleSim, HoverSim, PLANET } from './physics.js';
import { apSpeed } from './autopilot.js';
let pilotPrevSpeed = 0;
import { createTerrain, groundHeight, terrainHeight, BASES, roadSpawn, setViewScale, waterDepthAt, getSettlement, roadDist, ROAD_HALF, deckHeight, ROUTE_LEN, dustDepth, pebbleDensity, ROUTE_PTS, nearestRouteIndex } from './terrain.js';
import { buildBase, updateBases } from './base.js';
import { createAudio } from './audio.js';
import { createSeeds, seedsDelivered, LAB } from './seeds.js';
import { createLandmarks } from './landmarks.js';
import { createJobs } from './jobs.js';
import { createFinds } from './finds.js';
import { createExpedition } from './expedition.js';
import { createNPCs } from './npc.js';
import { createTracks } from './tracks.js';
import { createSand } from './sand.js';
import { createLoose } from './loose.js';
import { createRapierSim } from './rapier-sim.js';
import { createGarage } from './garage.js';
import { createKickup } from './kickup.js';
import { createGrass } from './grass.js';
import { createWater } from './water.js';
import { createSplash } from './splash.js';
import { createFlashback } from './flashback.js';
import { progress, hasSave, newGame, travelTo, consumeSkipMenu, FLASHBACK_AT, FLASHBACK_REWARD } from './progress.js';
import { createStory } from './story.js';
import { createRoadPosts } from './roadposts.js';
import { createMissions } from './missions.js';
import { createDebris } from './debris.js';
import { createUpgrades, BRANCHES as UPGRADE_BRANCHES, TREE as UPGRADE_TREE } from './upgrades.js';
import { createDustTrail } from './dust.js';
import { createSonar, MAX_BIAS as SONAR_MAX_BIAS } from './sonar.js';
import { createMinimap3D } from './minimap3d.js';
import { createSkyMaterial, updateSky, horizonColor, planetOrbit, marsMoons } from './sky.js';
import { REAL, REAL_PLACES, REGION_RADIO } from './real-mars.js';
import { fogAltitudeScale } from './atmosphere.js';
import { recordLeg, bestOf, fmtTime } from './records.js';
import { stepDust, shakeOff, chargeFactor } from './paneldust.js';
import { createRecorder, ghostAt, ghostTimeAt, saveGhost, loadGhost, ghostKey } from './ghost.js';
import { formatAltitude, formatTilt, pitchRollDeg } from './attitude.js';
import { createWeather, WEATHER_TEXT } from './weather.js';

const ARRIVE_R = 70; // how close counts as docked at a base
// Fog only far from the rover. Exponential fog was fully opaque by ~500 m, which
// turned the ridges near-white. Linear fog leaves everything within FOG_NEAR
// untouched and reaches full strength exactly where the streamed terrain window
// ends (660 m), so it also hides the edge of the world.
// Real Mars shows the whole DTM as a far mesh, so the haze is pushed out to let the rim
// and the delta stand on the horizon.
const FOG_NEAR = REAL ? 1500 : 594;
const FOG_FAR = REAL ? 7000 : 1179;
// ---------- solar rover ----------
const SOL_SECONDS = 1080; // one Martian day, compressed (18 min)
const BATTERY_MAX = 100;
const DRAW_IDLE = 0.012; // %/s just being alive (a pack lasts hours parked)
const CHARGE_PEAK = 1.5; // %/s with the wings open and the sun overhead
// Time to unfold or stow; the crawler's array opens in two stages, so it takes longer.
const PANEL_SECONDS = CHASSIS === 'crawler' || CHASSIS === 'hauler' || CHASSIS === 'galatea' ? 4.2 : 2.6;
const LOW_BATTERY = 20;
const BOOST_DRAW = 2.5; // Shift drinks the pack (on top of the extra speed it buys)
// Per chassis (chassis.js `terrain`): the battery still reads 0–100 %, but a bigger
// pack makes each percent worth more, and driving costs per metre covered rather
// than per second — so a fast car no longer goes further on a charge just by being
// fast. Below a walking pace it is still charged as if moving at it (climbing, digging).
const TR = SPEC.terrain;
const RANGE_KM = (BATTERY_MAX * TR.pack) / TR.perM / 1000; // full pack, cruising on the flat
// Default camera: low behind the truck.
// The crawler is 2.5 m longer; at the scout's distance it filled the frame.
const CAM_BACK = { truck: 13, crawler: 16, hauler: 19, buggy: 12, speedster: 11.5, galatea: 16, glider: 12 }[CHASSIS];
const CAM_UP = { truck: 2, crawler: 2.6, hauler: 3.4, buggy: 2, speedster: 1.6, galatea: 3, glider: 2.2 }[CHASSIS];
// Cinematic camera modes, cycled with C. Chase/far still turn with the truck's
// heading and can be dragged/zoomed by hand (same trick as the default camera);
// top-down and orbit are fully automatic and lock out manual control.
const CAM_MODES = ['chase', 'far', 'top', 'orbit'];
const CAM_FAR_BACK = 34;
const CAM_FAR_UP = 13;
const CAM_TOP_HEIGHT = 55;
const CAM_ORBIT_RADIUS = 70;
const CAM_ORBIT_HEIGHT = 35;
const CAM_ORBIT_SPEED = 0.15; // rad/s, slow reveal, not a spin

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
// 2x on a Retina panel means 4x the fragments for a full-screen terrain; 1.5 keeps
// the image sharp at a fraction of the fill cost.
// Render resolution, pixels per CSS pixel. It was min(devicePixelRatio, 1.5), which
// on a Retina screen drew 2.25× the pixels of the window through every post pass;
// 1× is the default now and Графіка → Роздільність trades it back (0.5–1.5×).
const RENDER_SCALE_KEY = 'rover.renderScale';
let renderScale = 1;
try { renderScale = Math.min(1.5, Math.max(0.5, parseFloat(localStorage.getItem(RENDER_SCALE_KEY)) || 1)); } catch (e) { /* storage may be blocked */ }
renderer.setPixelRatio(renderScale);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, REAL ? 9000 : 2000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI / 2 - 0.03;

// ---------- sky + lighting (day / night) ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), createSkyMaterial());
sky.renderOrder = -1000;
scene.add(sky);

const envScene = new THREE.Scene();
const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), createSkyMaterial());
envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget = null;

// Sun by day, moon by night: same light, different look.
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -250, right: 250, top: 250, bottom: -250, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.35);
scene.add(hemi);
// Верданта's companion world (see planetOrbit in sky.js) doubles as a faint night
// light — real moonlight is dim and shadowless, so no shadow map for this one.
// Intensity stays 0 on every other planet (set below in applyTimeOfDay).
const planetLight = new THREE.DirectionalLight(0xcdd6ff, 0);
scene.add(planetLight, planetLight.target);

// Day and night are the two ends of a continuous cycle, blended by sun height.
// On the Moon there's no air to bounce any light into `hemi`/`env` at all — direct
// sunlight (the `sun` light below) does almost all the work, day or night, so both
// ends of the Moon's cycle sit close together, near-black and neutral grey.
const LOOKS_BY_PLANET = {
  moon: {
    day: { light: 0xfff6ea, intensity: 3.1, sky: 0x0a0a0c, ground: 0x050505, hemi: 0.05, env: 0.04, exposure: 1.0, dust: 0x5c5c5e },
    night: { light: 0x9db4ff, intensity: 0.15, sky: 0x030304, ground: 0x000000, hemi: 0.03, env: 0.02, exposure: 1.05, dust: 0x3a3a3c },
  },
  // A real, thick atmosphere: the overcast sky itself is a strong, soft, all-over
  // light source (that's what `hemi`/`env` are standing in for here), so ambient
  // stays high even though the sun disc is muted — cloudy daylight is bright, just
  // shadowless, and it barely dims at all after dark under the same cloud deck.
  verdanta: {
    day: { light: 0xeef2f0, intensity: 1.6, sky: 0xb9c4c2, ground: 0x384a38, hemi: 0.55, env: 0.5, exposure: 1.0, dust: 0x4a4a44 },
    night: { light: 0x8fa8c0, intensity: 0.5, sky: 0x232a2c, ground: 0x0c120e, hemi: 0.3, env: 0.15, exposure: 1.1, dust: 0x2c2c2a },
  },
  mars: {
    day: { light: 0xfff0dd, intensity: 2.8, sky: 0xf1c9a0, ground: 0x8a4a32, hemi: 0.35, env: 0.7, exposure: 1.0, dust: 0x9d6d44 },
    night: { light: 0x9db4ff, intensity: 0.7, sky: 0x22305a, ground: 0x0a0806, hemi: 0.45, env: 0.2, exposure: 1.2, dust: 0x5a3d2b },
  },
};
const LOOKS = LOOKS_BY_PLANET[PLANET] || LOOKS_BY_PLANET.mars;
const sunDir = new THREE.Vector3(0, 1, 0);
const look = { ...LOOKS.night };
const mixC = new THREE.Color();
const cA = new THREE.Color();
const cB = new THREE.Color();
let daylight = 0;
let stormW = 0; // weather.w, mirrored here for lampLevel(), which runs before weather exists
const fogBase = new THREE.Color();
let viewK = 1; // the view-distance slider, which the fog follows
let envAt = -1;

// The sun is up between these hours; the rest of the sol is night.
const SUNRISE = 5 / 24;
const SUNSET = 21 / 24;
const DAY_SPAN = SUNSET - SUNRISE;

// Its arc is half a circle either way, but stretched over the long day and squeezed
// into the short night, rather than a plain sine that would split the sol evenly.
function sunAngle(t) {
  if (t >= SUNRISE && t < SUNSET) return (Math.PI * (t - SUNRISE)) / DAY_SPAN;
  const intoNight = t < SUNRISE ? t + 1 - SUNSET : t - SUNSET;
  return Math.PI + (Math.PI * intoNight) / (1 - DAY_SPAN);
}

// timeOfDay 0 = midnight, 0.5 = noon.
function applyTimeOfDay(timeOfDay) {
  const ang = sunAngle(timeOfDay);
  const elev = Math.sin(ang);
  sunDir.set(Math.cos(ang) * 0.55, elev, Math.cos(ang) * 0.45 + 0.18).normalize();
  sunDir.y = Math.max(elev, -0.35);
  sunDir.normalize();
  daylight = clamp((elev + 0.12) / 0.42, 0, 1);
  const k = daylight * daylight * (3 - 2 * daylight);

  const d = LOOKS.day;
  const n = LOOKS.night;
  const lerp = (a, b) => a + (b - a) * k;
  look.intensity = lerp(n.intensity, d.intensity);
  look.hemi = lerp(n.hemi, d.hemi);
  look.env = lerp(n.env, d.env);
  look.exposure = lerp(n.exposure, d.exposure);

  const orbit = PLANET === 'verdanta' ? planetOrbit(timeOfDay) : null;
  updateSky(sky.material, sunDir, k, orbit);
  horizonColor(k, scene.fog.color);
  fogBase.copy(scene.fog.color);
  if (orbit) {
    planetLight.position.copy(sim.pos).addScaledVector(orbit.dir, 80);
    planetLight.target.position.copy(sim.pos);
    // Fades in well after sunset, and ramps up fast once it actually clears the
    // horizon rather than needing to climb high overhead first — real moonlight is
    // faint everywhere it reaches, not just at its zenith.
    const nightK = 1 - k;
    const horizonK = clamp(orbit.dir.y / 0.2, 0, 1);
    planetLight.intensity = nightK * nightK * 0.4 * horizonK;
  } else {
    planetLight.intensity = 0;
  }
  renderer.toneMappingExposure = look.exposure;
  sun.color.copy(cA.setHex(n.light)).lerp(cB.setHex(d.light), k);
  sun.intensity = look.intensity;
  hemi.color.copy(cA.setHex(n.sky)).lerp(cB.setHex(d.sky), k);
  hemi.groundColor.copy(cA.setHex(n.ground)).lerp(cB.setHex(d.ground), k);
  hemi.intensity = look.hemi;
  scene.environmentIntensity = look.env;
  mixC.setHex(n.dust).lerp(cB.setHex(d.dust), k);
  dust.setTint(mixC);
  document.body.classList.toggle('night', k < 0.35);

  // The environment probe is costly; refresh it only when the light really moved.
  if (Math.abs(k - envAt) > 0.06) {
    envAt = k;
    updateSky(envSky.material, sunDir, k, orbit);
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0.02);
    scene.environment = envTarget.texture;
  }
}

// ---------- world ----------
const terrain = createTerrain(renderer.capabilities.getMaxAnisotropy());
scene.add(terrain.group);
terrain.prime(BASES[0].x, BASES[0].z);

// Buildings, wrecks and oddities scattered off the road, a set per planet.
const landmarks = createLandmarks();
scene.add(landmarks.group);
const TOWN = getSettlement();
// Side jobs around those landmarks, handed out over the radio (jobs.js).
const jobs = createJobs();
scene.add(jobs.group);
// A long trip through real places, started with X (expedition.js).
const expedition = createExpedition({ places: REAL_PLACES.map((p) => ({ ...p, x: p.goal.x, z: p.goal.z })), bases: BASES });
// Meteorite fragments off the road (finds.js).
const finds = createFinds();
scene.add(finds.group);
// People in the town, its rovers, haulers on the road (npc.js).
const npcs = createNPCs();
scene.add(npcs.group);
// Dust storms on Mars, rain on Верданта (weather.js); weatherLook() lays the storm
// over whatever applyTimeOfDay() just set, so the two never fight.
const weather = createWeather();
scene.add(weather.group);
const HAZE = {
  dust: { day: new THREE.Color(0xa87a52), night: new THREE.Color(0x261a12) },
  rain: { day: new THREE.Color(0x7e8a8c), night: new THREE.Color(0x161c1e) },
}[weather.kind];
const hazeC = new THREE.Color();
const KIND_FAR = weather.kind === 'rain' ? 260 : 150;
const hazeFog = new THREE.Color();
// God rays (post.js): where the sun sits on screen and how strong to make them —
// strongest low in the sky and in a dust storm, nothing on the airless Moon.
const _sunScr = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _shaftCol = new THREE.Color();
function updateShafts() {
  marsMoons(sky.material, timeOfDay, performance.now() / 1000);
  if (PLANET === 'moon') return post.setShafts(0.5, 0.5, 0);
  camera.getWorldDirection(_camDir);
  const facing = clamp(_camDir.dot(sunDir) * 1.6 + 0.2, 0, 1);
  const up = clamp((sunDir.y + 0.04) / 0.12, 0, 1);
  const low = 1 - clamp(sunDir.y / 0.7, 0, 1);
  const amt = facing * up * (0.3 + 0.5 * low) * (1 + 1.2 * stormW) * (PLANET === 'verdanta' ? 0.6 : 1);
  _sunScr.copy(sunDir).multiplyScalar(800).add(camera.position).project(camera);
  _shaftCol.copy(sun.color);
  post.setShafts((_sunScr.x + 1) / 2, (_sunScr.y + 1) / 2, amt, _shaftCol);
}
function weatherLook() {
  const w = weather.w;
  // At full blow you see maybe 150 m: the far terrain is simply gone in the murk.
  const s = Math.min(1, w * 1.25);
  // thinner air up a slope: real Mars only (the other worlds keep their fixed fog)
  const alt = REAL ? fogAltitudeScale(sim.pos.y) : 1;
  scene.fog.near = THREE.MathUtils.lerp(FOG_NEAR * viewK * alt, 8, s);
  scene.fog.far = THREE.MathUtils.lerp(FOG_FAR * viewK * alt, KIND_FAR, s);
  sky.material.uniforms.haze.value = Math.min(1, w * 1.2);
  if (w <= 0) {
    scene.fog.color.copy(fogBase);
    sun.intensity = look.intensity;
    scene.environmentIntensity = look.env;
    return;
  }
  hazeC.copy(HAZE.night).lerp(HAZE.day, daylight);
  sky.material.uniforms.hazeColor.value.copy(hazeC);
  hazeFog.setRGB(hazeC.r, hazeC.g, hazeC.b, THREE.SRGBColorSpace);
  scene.fog.color.copy(fogBase).lerp(hazeFog, Math.min(1, w * 1.2));
  sun.intensity = look.intensity * (1 - 0.72 * w);
  scene.environmentIntensity = look.env * (1 - 0.3 * w);
}

const beacons = [];
for (const b of BASES) {
  const built = buildBase(b);
  scene.add(built.group);
  beacons.push({ ...built, x: b.x, z: b.z });
}

const DIRT_COLOR = new THREE.Color({ mars: 0x8e5e3a, moon: 0x6c6a66, verdanta: 0x4a3a28 }[PLANET] || 0x8e5e3a);
const dirt = { v: 0, saveT: 0 };
try { dirt.v = Number(localStorage.getItem('rover.dirt')) || 0; } catch (e) { /* storage may be blocked */ }
const tracks = createTracks(WHEEL_DEFS.length, PLANET === 'moon' ? 1400 : 260, WHEEL_DEFS.map((d) => 1.05 * d.wk));
const drawSize = new THREE.Vector2();
const sandCtx = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, wheels: [], daylight: 1, pxPerUnit: 1000, head: { on: false, x: 0, y: 0, z: 0, dx: 0, dz: 1 }, tail: { on: false, x: 0, y: 0, z: 0 } };
const roadPosts = createRoadPosts();
const missions = createMissions();
const debris = createDebris();
// The Moon is an empty test world for now — physics/terrain only, none of the
// Гермес-3 story dressing (still built above so the rest of the code has real
// objects to reference, just never added to the scene or advanced per frame).
if (PLANET === 'mars') {
  scene.add(roadPosts.group);
  scene.add(missions.group);
  scene.add(debris.group);
}
// Верданта's own job: seed probes to bring to the lab beside АЛЬФА (see seeds.js).
const seeds = PLANET === 'verdanta' ? createSeeds() : null;
if (seeds) scene.add(seeds.group);
const upgrades = createUpgrades(debris, missions);
const sand = createSand();
// Loose stones the hull shoves aside, simulated by Rapier (loaded after start).
const loose = createLoose();
scene.add(loose.mesh);
const looseCtx = { x: 0, z: 0, pos: null, quat: null };
scene.add(sand.points);
// Clods and stones flung up off the tyres (kickup.js).
const kickup = createKickup();
scene.add(kickup.mesh);
const kickCtx = { wheels: WHEEL_DEFS.map((d) => ({ x: 0, z: 0, contact: false, R: d.R })), speed: 0, throttle: 0, fx: 0, fz: 1, offroad: 1 };
let offroadK = 1;
const grass = createGrass(); // no-op off Верданта
scene.add(grass.group);
const water = createWater(); // the river surface; also a no-op off Верданта
scene.add(water.group);
const splash = createSplash(); // spray off the wheels, same deal
scene.add(splash.group);
const flashback = createFlashback(); // the Гермес-1 wreck; only exists on the Moon
scene.add(flashback.group);
scene.add(tracks.mesh);

// Physics engine for the drive: the hand-written one (physics.js) by default, or
// Rapier (rapier-sim.js) from the settings. ?physics=rapier / ?physics=classic switches and is
// remembered; the glider always flies on HoverSim.
const PHYSICS = (() => {
  let p = null;
  try {
    p = new URLSearchParams(location.search).get('physics');
    if (p) localStorage.setItem('rover.physics', p);
    else p = localStorage.getItem('rover.physics');
  } catch (e) { /* storage may be blocked */ }
  return p === 'rapier' ? 'rapier' : 'classic'; // classic by default — it plays better for now
})();
const sim = SPEC.flight
  ? new HoverSim()
  : PHYSICS === 'rapier'
  ? await createRapierSim().catch((e) => { console.warn('Rapier failed, using classic physics', e); return new VehicleSim(); })
  : new VehicleSim(); // the glider flies, everything else drives
{
  const sp = roadSpawn(false);
  sim.reset(sp.x, sp.z, sp.yaw);
}
water.prime?.(sim.pos.x, sim.pos.z); // so a rover spawned in a river sees water on frame 1
const vehicle = buildVehicle();
scene.add(vehicle.root);
const W = vehicle.wheels.map((w, i) => ({ ...w, sim: sim.wheels[i], spinAngle: 0 }));

// ---------- dust trail ----------
// A CanvasTexture for headlight glow/impact flashes elsewhere in this file — the
// trailing dust cloud now has its own softer texture, see dust.js.
function makeDustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const dustTex = makeDustTexture();

// Contact shadow: a soft dark oval on the ground under the hull. The real sun shadow
// is there too, but the sky/hemisphere fill washes it out, so the rover looked like
// it hovered. Sized from the wheel footprint, fades as the rover leaves the ground.
const contactShadow = (() => {
  let wx = 0, wz = 0;
  for (const w of WHEEL_DEFS) { wx = Math.max(wx, Math.abs(w.x)); wz = Math.max(wz, Math.abs(w.z)); }
  if (!WHEEL_DEFS.length) { wx = SPEC.box.w / 2 - 0.6; wz = SPEC.box.l / 2 - 0.8; } // the glider: its hull
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const cx = c.getContext('2d');
  const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#fff');
  gr.addColorStop(0.65, '#d8d8d8');
  gr.addColorStop(1, '#000');
  cx.fillStyle = gr; // alphaMap reads the green channel, so grey on opaque black
  cx.fillRect(0, 0, 64, 64);
  const mat = new THREE.MeshBasicMaterial({ alphaMap: new THREE.CanvasTexture(c), color: 0x0a0503, transparent: true, opacity: 0.5,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.scale.set(wx * 2 + 2.4, wz * 2 + 3.4, 1);
  plane.renderOrder = 1;
  const g = new THREE.Group();
  g.add(plane);
  scene.add(g);
  return { g, mat, on: 1 };
})();
const dust = createDustTrail();
scene.add(dust.group);
const sonar = createSonar(vehicle.root);
scene.add(sonar.group); // the ping markers — visible whenever upgrades.unlocked('sonar') is
let sonarScan = { warnObstacle: null, avoidBias: 0 };
let sonarWarned = false;
let storyClock = 0;

// ---------- headlights, cab glow ----------
const headlights = [];
const glows = [];
const MOUNT = vehicle.MOUNTS;
for (const side of [-1, 1]) {
  const spot = new THREE.SpotLight(0xfff2d6, 0, 110, 0.44, 0.7, 2);
  spot.position.set(side * MOUNT.head.x, MOUNT.head.y, MOUNT.head.z);
  // One beam casts the shadows; two look the same from the driver's seat and cost double.
  spot.castShadow = side < 0;
  spot.shadow.mapSize.set(512, 512);
  spot.shadow.camera.near = 0.6;
  spot.shadow.camera.far = 100;
  spot.shadow.bias = -0.0004;
  spot.shadow.normalBias = 0.05;
  const aim = new THREE.Object3D();
  aim.position.set(side * MOUNT.head.aimX, -1.9, 32);
  spot.target = aim;
  vehicle.root.add(spot, aim);
  headlights.push(spot);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: dustTex, color: 0xfff2d6, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false })
  );
  glow.position.set(side * MOUNT.head.x, MOUNT.head.y, MOUNT.head.glowZ);
  glow.scale.setScalar(0.55);
  vehicle.root.add(glow);
  glows.push(glow);
}
// The roof bar is a long-range spot: a narrow, strong beam that reaches far ahead of
// the two headlights. It is on with full headlights only.
const farLight = new THREE.SpotLight(0xfff6e4, 0, 800, 0.13, 0, 2);
farLight.position.set(0, MOUNT.far.y, MOUNT.far.z);
// It casts shadows too, so rocks far down the beam are not flat blobs. The narrow cone
// keeps the map sharp: ~1 cm per texel a hundred metres out.
farLight.castShadow = true;
farLight.shadow.mapSize.set(1024, 1024);
farLight.shadow.camera.near = 2;
farLight.shadow.camera.far = 850;
farLight.shadow.bias = -0.0003;
farLight.shadow.normalBias = 0.05;
// The bar is a rectangle, so the beam is too: project a soft-edged wide rectangle
// through the cone instead of the usual round pool.
{
  const N = 128;
  const px = new Uint8Array(N * N * 4);
  const hw = 0.8; // half-width and half-height inside the [-1, 1] projection square
  const hh = 0.42;
  const soft = 0.16;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = Math.abs((x + 0.5) / N * 2 - 1);
      const v = Math.abs((y + 0.5) / N * 2 - 1);
      const k = (1 - THREE.MathUtils.smoothstep(u, hw - soft, hw)) * (1 - THREE.MathUtils.smoothstep(v, hh - soft, hh));
      const o = (y * N + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = Math.round(255 * k);
      px[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  farLight.map = tex;
}
const farAim = new THREE.Object3D();
farAim.position.set(0, -0.8, 280);
farLight.target = farAim;
vehicle.root.add(farLight, farAim);
const farUpLocal = new THREE.Vector3(0, 1, 0); // the truck's own up, before rotation

// The rear had no light of any kind: just a flat red box that read as a dash at
// night while the nose had two haloes and two beams.
const tailGlows = [];
for (const p of vehicle.TAIL_LAMPS) {
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: dustTex, color: 0xff2e14, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: false })
  );
  glow.position.copy(p).add(new THREE.Vector3(0, 0, -0.06));
  glow.scale.setScalar(0.42);
  vehicle.root.add(glow);
  tailGlows.push(glow);
}
// One lamp per side, and each throws its light backwards. A point light at the tail
// also lit the ground under the whole body, which read as a red glow from nowhere.
const tailLights = vehicle.TAIL_LAMPS.map((p) => {
  const l = new THREE.SpotLight(0xff2a10, 0, 10, 0.8, 1, 2);
  l.position.set(p.x, p.y - 0.1, p.z - 0.15);
  const aim = new THREE.Object3D();
  aim.position.set(p.x * 1.4, -1.6, p.z - 9);
  l.target = aim;
  vehicle.root.add(l, aim);
  return l;
});

// The amber marker strips also spill a little light on the ground at the sides, at
// night. They are spots aimed outwards: a point light under the sill lit the ground
// beneath the body too, which read as a glow coming from under the truck.
const markerLights = [-1, 1].map((side) => {
  const l = new THREE.SpotLight(0xffa030, 0, 6, 0.6, 1, 2);
  l.position.set(side * MOUNT.marker.x, MOUNT.marker.y, MOUNT.marker.z);
  const aim = new THREE.Object3D();
  aim.position.set(side * (MOUNT.marker.x + 2.65), -1.6, MOUNT.marker.z);
  l.target = aim;
  vehicle.root.add(l, aim);
  return l;
});

// Air you can see: dust devils and blown sand, pollen and fireflies, river mist
// (ambient.js); and the headlight beams themselves (beams.js).
const ambient = createAmbient();
scene.add(ambient.group);
const beams = createBeams(vehicle.root, MOUNT);

const cabLight = new THREE.PointLight(0xff9a3c, 0, 3, 2);
cabLight.position.set(0, MOUNT.cab.y, MOUNT.cab.z); // short reach: it lit the ground under the whole body
vehicle.root.add(cabLight);

function toggleSand() {
  sand.setEnabled(!sand.enabled);
  kickup.setEnabled(sand.enabled);
  const btn = document.getElementById('sandToggle');
  btn.textContent = sand.enabled ? 'Камінці: увімк' : 'Камінці: вимк';
  btn.classList.toggle('on', sand.enabled);
}

// L cycles: auto (the default) -> off -> marker lights only -> full headlights.
// Levels: 0 nothing, 1 marker lights (amber sides, red tail), 2 marker lights + headlights.
// L cycles these. АВТО switches the headlights on in the dark but never the long-
// range bar — at full strength it blinds you in town — so that has a mode of its
// own, offered only once the ДАЛЬНЄ upgrade is fitted. Levels: 0 off, 1 marker
// lights, 2 headlights, 3 headlights plus the long-range bar.
const LAMP_MODES = [
  { label: 'АВТО', level: null },
  { label: 'ФАРИ', level: 2 },
  { label: 'ДАЛЬНЄ', level: 3, needs: 'farlight' },
  { label: 'ВИМК', level: 0 },
];
let lampMode = 0;
function cycleLamps() {
  do lampMode = (lampMode + 1) % LAMP_MODES.length;
  while (LAMP_MODES[lampMode].needs && !upgrades.unlocked(LAMP_MODES[lampMode].needs));
  document.getElementById('lamps').textContent = `Світло: ${LAMP_MODES[lampMode].label}`;
  document.getElementById('lamps').classList.toggle('on', lampMode !== 0);
  flash(`Світло: ${LAMP_MODES[lampMode].label}`);
}
const TYRE_MODES = [
  { label: 'м\'які', p: 0.7 },
  { label: 'норма', p: 1 },
  { label: 'тверді', p: 1.3 },
];
let tyreMode = 1;
function cycleTyres() {
  tyreMode = (tyreMode + 1) % TYRE_MODES.length;
  const t = `Тиск у шинах: ${TYRE_MODES[tyreMode].label}`;
  const b = document.getElementById('tyres');
  if (b) { b.textContent = t; b.classList.toggle('on', tyreMode !== 1); }
  flash(t);
}
function lampLevel() {
  const fixed = LAMP_MODES[lampMode].level;
  return fixed !== null ? fixed : daylight < 0.45 || stormW > 0.35 ? 2 : 0;
}

const HEAD_INTENSITY = 2200;
const FAR_INTENSITY = 125000; // scaled with range^2 (decay=2) for the 800 m cutoff below
function setLamps(level) {
  const marks = level >= 1;
  const heads = level >= 2;
  for (const g of tailGlows) g.visible = marks;
  for (const l of tailLights) l.visible = marks;
  for (const l of markerLights) l.visible = marks;
  for (const l of headlights) {
    l.visible = heads;
    l.intensity = heads ? HEAD_INTENSITY : 0;
  }
  // The nose and roof bars glow as position lights in marker mode, brighter with the beams.
  for (const g of glows) {
    g.visible = marks;
    g.material.opacity = heads ? 1 : 0.4;
  }
  cabLight.visible = heads;
  cabLight.intensity = heads ? 25 * (MOUNT.cab.k ?? 1) : 0;
  // The long-range roof beam is a workshop unlock — no lamp mode lights it up until
  // ДАЛЬНЄ СВІТЛО is bought, whatever else is on.
  const far = level >= 3 && upgrades.unlocked('farlight');
  farLight.visible = far;
  farLight.intensity = far ? FAR_INTENSITY : 0;
}

// ---------- audio ----------
const audio = createAudio();
const btnSound = document.getElementById('sound');
async function toggleSound() {
  if (!audio) return;
  const on = await audio.toggle();
  btnSound.classList.toggle('on', on);
  btnSound.textContent = on ? 'Звук: увімк' : 'Звук: вимк';
}
btnSound.addEventListener('click', toggleSound);

// ---------- audio settings ----------
const MIX_KEYS = ['master', 'engine', 'ground', 'ambient', 'voice'];
const menuEl = document.getElementById('menu');
function loadMix() {
  if (!audio) return;
  try {
    const saved = JSON.parse(localStorage.getItem('rover.mix') || '{}');
    for (const k of MIX_KEYS) if (typeof saved[k] === 'number') audio.setLevel(k, saved[k]);
  } catch {
    /* storage can be unavailable; defaults are fine */
  }
}
function saveMix() {
  if (!audio) return;
  try {
    localStorage.setItem('rover.mix', JSON.stringify(audio.levels));
  } catch {
    /* ignore */
  }
}
loadMix();
for (const k of MIX_KEYS) {
  const el = document.getElementById(`mix-${k}`);
  if (!el || !audio) continue;
  el.value = Math.round(audio.levels[k] * 100);
  const out = document.getElementById(`mixv-${k}`);
  out.textContent = el.value;
  el.addEventListener('input', () => {
    audio.setLevel(k, el.value / 100);
    out.textContent = el.value;
    saveMix();
  });
}
document.getElementById('menuBtn').addEventListener('click', () => menuEl.classList.toggle('show'));
document.getElementById('menuClose').addEventListener('click', () => menuEl.classList.remove('show'));
for (const tab of document.querySelectorAll('#menu .tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('#menu .tab')) t.classList.toggle('on', t === tab);
    for (const b of document.querySelectorAll('#menu .tabBody')) b.classList.toggle('on', b.id === `tab-${tab.dataset.tab}`);
  });
}
document.getElementById('mapToggle').addEventListener('click', toggleMap);
document.getElementById('sandToggle').addEventListener('click', toggleSand);

// ---------- the campaign: where you are, what is open, and how to travel ----------
// Travel reloads the page, because planet.js and everything derived from it (gravity,
// terrain, sky, the mission and debris pools) is read once at module load.
const PLANET_SUBTITLE = {
  mars: `перехід АЛЬФА → БЕТА · ~${Math.round(ROUTE_LEN / 1000)} км`,
  moon: 'ФЛЕШБЕК · Місяць · уламки Гермес-1',
  verdanta: 'Верданта · перша висадка',
};
const PLANET_NAME = { mars: 'Марс', moon: 'Місяць', verdanta: 'Верданта' };
document.getElementById('titleSub').textContent = PLANET_SUBTITLE[PLANET];
const chapterEl = document.getElementById('chapter');

function refreshPlanets() {
  const done = missions.deliveredCount();
  for (const p of ['mars', 'moon', 'verdanta']) {
    const btn = document.getElementById(`planet-${p}`);
    const open = progress.unlocked(p, done);
    btn.classList.toggle('on', p === PLANET);
    btn.classList.toggle('locked', !open);
    btn.disabled = !open;
    if (p === 'moon' && !open) btn.textContent = `Місяць · флешбек (${done}/${FLASHBACK_AT})`;
    else if (p === 'moon') btn.textContent = progress.flashbackDone ? 'Місяць · флешбек ✓' : 'Місяць · флешбек';
    if (p === 'verdanta') btn.textContent = open ? 'Верданта' : `Верданта (${done}/4 модулів)`;
  }
}

// ---------- radio traffic ----------
// Lines queue rather than overwrite: a briefing is several of them, and control
// talking over itself would be worse than making the player wait a beat. Click to
// skip ahead; a line that is already the last one just closes the panel.
const story = createStory();
const commsEl = document.getElementById('comms');
const commsFrom = document.getElementById('commsFrom');
const commsText = document.getElementById('commsText');
const commsMore = document.getElementById('commsMore');
const commsQueue = [];
let commsUntil = 0;

function showNextComms() {
  const line = commsQueue.shift();
  if (!line) { commsEl.classList.remove('show'); return; }
  const [from, text] = line;
  commsFrom.textContent = from;
  commsText.textContent = text;
  commsMore.textContent = commsQueue.length ? `ще ${commsQueue.length} →` : 'клік — закрити';
  commsEl.classList.add('show');
  // Long lines get longer on screen, but never less than a beat to notice them.
  commsUntil = clock.elapsedTime + Math.max(3.4, Math.min(9, text.length * 0.055));
  if (audio) audio.beep(660, 0.05);
}

function say(lines) {
  if (!lines || !lines.length) return;
  commsQueue.push(...lines);
  if (!commsEl.classList.contains('show')) showNextComms();
}
commsEl.addEventListener('click', showNextComms);

function storyCtx() {
  return {
    planet: PLANET,
    scrap: debris.collectedCount(),
    delivered: missions.deliveredCount(),
    upgradeLevels: UPGRADE_BRANCHES.reduce((n, b) => n + upgrades.level(b.id), 0),
    flashbackDone: progress.flashbackDone,
    seeds: seeds ? seeds.deliveredCount() : seedsDelivered(),
  };
}

function refreshChapter() {
  if (story.finished) {
    chapterEl.innerHTML = '<i>КАМПАНІЮ ЗАВЕРШЕНО</i>вільний політ';
    return;
  }
  const text = story.objective(storyCtx()).text;
  chapterEl.innerHTML = `<i>ЗАВДАННЯ ${story.index + 1}/${story.total}</i>${text.charAt(0).toUpperCase() + text.slice(1)}`;
}

for (const p of ['mars', 'moon', 'verdanta']) {
  document.getElementById(`planet-${p}`).addEventListener('click', () => {
    if (p === PLANET || !progress.unlocked(p, missions.deliveredCount())) return;
    travelTo(p);
  });
}
refreshPlanets();
refreshChapter();

// Physics engine switch (see PHYSICS above): reloads into the chosen one.
for (const p of ['classic', 'rapier']) {
  const btn = document.getElementById(`physics-${p}`);
  btn.classList.toggle('on', (sim.engine === 'rapier' ? 'rapier' : 'classic') === p);
  btn.addEventListener('click', () => {
    try { localStorage.setItem('rover.physics', p); } catch (e) { /* storage may be blocked */ }
    location.search = '';
    location.reload();
  });
}
// Region switch (Mars only — the Moon and Верданта have their own ground): the real Jezero
// DTM or the original procedural world. Read by real-mars.js at load, so it reloads.
for (const r of ['jezero', 'gale', 'olympus', 'classic']) {
  const btn = document.getElementById(`region-${r}`);
  btn.classList.toggle('on', (REAL ? REAL.region : 'classic') === r);
  btn.disabled = PLANET !== 'mars';
  btn.addEventListener('click', () => {
    try { localStorage.setItem('rover.region', r); } catch (e) { /* storage may be blocked */ }
    location.search = '';
    location.reload();
  });
}
document.getElementById('startTag').textContent = SPEC.tag;

// ---------- main menu ----------
// Full screen over the paused world: Продовжити / Нова гра / Гараж / Налаштування,
// plus Повернутись у гру when it was opened mid-drive (Esc). The world behind is
// already built, so Продовжити is instant; Нова гра and picking another vehicle in
// the garage reload, because the save and the chassis are read once on the way in.
const startMenu = document.getElementById('startMenu');
let menuOpen = false;
const garage = createGarage({
  renderer,
  upgrades,
  current: CHASSIS,
  onSelect: (id) => {
    try { sessionStorage.setItem('rover.skipMenu', '1'); } catch (e) { /* storage may be blocked */ }
    setChassis(id); // reloads straight into the game in the new vehicle
  },
});
const mainMenu = (() => {
  const where = document.getElementById('startWhere');
  const btn = {
    resume: document.getElementById('btnResume'),
    cont: document.getElementById('btnContinue'),
    fresh: document.getElementById('btnNewGame'),
    garage: document.getElementById('btnGarage'),
    settings: document.getElementById('btnSettings'),
  };
  let inGame = false;
  let focus = 0;
  const visible = () => Object.values(btn).filter((b) => b.style.display !== 'none');
  const setFocus = (i) => {
    const list = visible();
    focus = (i + list.length) % list.length;
    list.forEach((b, k) => b.classList.toggle('focus', k === focus));
  };
  function open(midGame) {
    inGame = midGame;
    menuOpen = true;
    const saved = hasSave();
    btn.resume.style.display = midGame ? '' : 'none';
    btn.cont.style.display = !midGame && saved ? '' : 'none';
    where.textContent = saved || midGame
      ? `${PLANET_NAME[PLANET]} · ${SPEC.name} · модулі ${missions.deliveredCount()}/4 · мотлох ${upgrades.currency()}`
      : 'нова експедиція';
    startMenu.classList.remove('hidden');
    document.body.classList.add('inMenu');
    setFocus(0);
  }
  function close() {
    menuOpen = false;
    startMenu.classList.add('hidden');
    document.body.classList.remove('inMenu');
    menuEl.classList.remove('show');
    progress.markStarted();
  }
  btn.resume.addEventListener('click', close);
  btn.cont.addEventListener('click', close);
  btn.fresh.addEventListener('click', () => {
    if (hasSave() && !confirm('Почати нову гру? Прогрес, апгрейди, відкриті машини й мотлох буде втрачено.')) return;
    newGame();
  });
  btn.garage.addEventListener('click', () => {
    startMenu.classList.add('hidden');
    menuEl.classList.remove('show');
    garage.open(() => open(inGame));
  });
  btn.settings.addEventListener('click', () => menuEl.classList.toggle('show'));
  window.addEventListener('keydown', (e) => {
    if (!menuOpen || garage.isOpen || startMenu.classList.contains('hidden')) return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') setFocus(focus + 1);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') setFocus(focus - 1);
    else if (e.code === 'Enter' || e.code === 'Space') visible()[focus]?.click();
    else if (e.code === 'Escape') {
      if (menuEl.classList.contains('show')) menuEl.classList.remove('show');
      else if (inGame) close();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  for (const b of Object.values(btn)) b.addEventListener('pointerenter', () => setFocus(visible().indexOf(b)));
  return { open, close };
})();
if (!consumeSkipMenu()) mainMenu.open(false);

// ---------- graphics settings ----------
document.getElementById('viewDist').addEventListener('input', (e) => {
  const k = e.target.value / 100;
  document.getElementById('viewDistV').textContent = `${e.target.value}%`;
  setViewScale(k);
  viewK = k;
  scene.fog.near = FOG_NEAR * k;
  scene.fog.far = FOG_FAR * k;
});
const btnShadows = document.getElementById('shadowsToggle');
btnShadows.addEventListener('click', () => {
  const on = !renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = on;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  btnShadows.textContent = `Тіні: ${on ? 'увімк' : 'вимк'}`;
  btnShadows.classList.toggle('on', on);
});
let dynamicLight = true;
const btnDynLight = document.getElementById('dynLightToggle');
btnDynLight.addEventListener('click', () => {
  dynamicLight = !dynamicLight;
  btnDynLight.textContent = `Динамічне світло: ${dynamicLight ? 'увімк' : 'вимк'}`;
  btnDynLight.classList.toggle('on', dynamicLight);
});

// ---------- input ----------
let autopilot = false;
const keys = new Set();
const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && map3dEl.classList.contains('big')) return closeMap();
  if (e.code === 'Escape' && !photo && !menuOpen) return mainMenu.open(true);
  if (SPEC.flight && e.ctrlKey) e.preventDefault(); // Ctrl is the glider's "down", not a shortcut
  if (e.code === 'KeyF' || (photo && e.code === 'Escape')) return togglePhoto();
  if (photo) {
    if (e.code === 'Enter') return savePhoto();
    keys.add(e.code);
    if (DRIVE_KEYS.has(e.code)) e.preventDefault();
    return;
  }
  if (e.code === 'KeyP') return setAutopilot(!autopilot);
  if (e.code === 'KeyE') return togglePanels();
  if (e.code === 'KeyL') return cycleLamps();
  if (e.code === 'KeyT') return cycleTyres();
  if (e.code === 'KeyX') {
    if (expedition.active) { flash(expedition.cancel().text); return; }
    const ev = expedition.start(sim.pos.x, sim.pos.z);
    if (!ev) return flash('Експедиція є на справжніх картах: Єзеро, Гейл, Олімп');
    jobs.skip();
    flash(ev.text);
    say([['ОРІОН · керівник зміни', `Експедиція: ${ev.stops.map((st) => st.name).join(' → ')}. Їдь у своєму темпі, Сьомий.`]]);
    return;
  }
  if (e.code === 'KeyK') return void toggleSound();
  if (e.code === 'KeyO') return menuEl.classList.toggle('show');
  if (e.code === 'KeyU') { wsAuto = false; return toggleWorkshop(); }
  if (e.code === 'KeyR') return resetVehicle();
  if (e.code === 'KeyH') return resetVehicle(true);
  if (e.code === 'KeyM') return toggleMap();
  if (e.code === 'KeyJ') return toggleSand();
  if (e.code === 'KeyC') return cycleCamera();
  if (e.code === 'KeyN') {
    const ev = jobs.skip();
    if (ev) flash(ev.text);
    return;
  }
  keys.add(e.code);
  if (DRIVE_KEYS.has(e.code)) {
    setAutopilot(false);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ---------- odometer ----------
const odo = { trip: 0, total: 0, last: null, savedAt: 0 };
try { odo.total = Number(localStorage.getItem('rover.odo')) || 0; } catch (e) { /* storage may be blocked */ }
const hudOdoTrip = document.getElementById('odoTrip');
const hudAlt = document.getElementById('altStat');
const hudTilt = document.getElementById('tiltStat');
const attFwd = new THREE.Vector3();
const attRight = new THREE.Vector3();
if (REAL) { document.getElementById('altRow').hidden = false; document.getElementById('tiltRow').hidden = false; }
const hudRange = document.getElementById('rangeLeft');
const hudOdoTotal = document.getElementById('odoTotal');
const hudMissions = document.getElementById('missionStat');
const hudCarried = document.getElementById('carriedStat');
const hudDebris = document.getElementById('debrisStat');
const jobBoxEl = document.getElementById('jobBox');
const jobTitleEl = document.getElementById('jobTitle');
const jobStepEl = document.getElementById('jobStep');
const jobGaugeEl = document.getElementById('jobGauge');
const jobBarEl = document.getElementById('jobBar');
const jobClockEl = document.getElementById('jobClock');
if (seeds) {
  // The mission panel speaks Верданта here: probes instead of modules, no мотлох.
  document.getElementById('missionLabel').textContent = 'ЗОНДИ ЗДАНО';
  document.getElementById('debrisRow').style.display = 'none';
}
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${Math.round(m)} м`);

// ---------- upgrade tree ----------
// Open it anywhere (🛠 on the rover panel, or U) to plan; buying works only at
// БЕТА's workshop, where it also pops up by itself when you pull in.
const wsPanel = document.getElementById('workshop');
const wsCurrency = document.getElementById('wsCurrency');
const wsWhere = document.getElementById('wsWhere');
const wsTree = document.getElementById('wsTree');
const upgBtn = document.getElementById('upgBtn');
const BRANCH_BY_ID = Object.fromEntries(UPGRADE_BRANCHES.map((b) => [b.id, b]));
const ROMAN = ['', 'I', 'II', 'III'];
const wsNodes = []; // { n, el, branch }
const wsBranches = []; // { grid, svg, nodes }
let atWorkshop = false;
let wsAuto = false;
for (const br of UPGRADE_TREE) {
  const box = document.createElement('div');
  box.className = 'wsBranch';
  box.innerHTML = `<h4>${br.title}</h4>`;
  const grid = document.createElement('div');
  grid.className = 'wsGrid';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  grid.appendChild(svg);
  const nodes = [];
  for (const n of br.nodes) {
    const b = BRANCH_BY_ID[n.id];
    const el = document.createElement('button');
    el.className = 'wsNode';
    el.style.gridColumn = String(n.x + 1);
    el.style.gridRow = String(n.row + 1);
    const lv = b.kind === 'levels' ? ` ${ROMAN[n.lvl]}` : '';
    const val = b.fmt ? b.fmt(b.vals[n.lvl]) : b.short || b.hint;
    el.innerHTML = `<span class="ic">${b.icon}</span><span class="nm">${b.label}${lv}</span><span class="vl">${val}</span><span class="ct"></span>`;
    el.title = b.hint;
    el.addEventListener('click', () => {
      if (!atWorkshop || upgrades.level(n.id) !== n.lvl - 1) return;
      if (upgrades.buy(n.id)) {
        if (audio) audio.beep(1040, 0.1);
        refreshWorkshop();
      }
    });
    grid.appendChild(el);
    const rec = { n, el };
    nodes.push(rec);
    wsNodes.push(rec);
  }
  box.appendChild(grid);
  wsTree.appendChild(box);
  wsBranches.push({ grid, svg, nodes });
}
// Lines from each node up to what it needs, drawn once the grid has a size.
function drawTreeLinks() {
  for (const { grid, svg, nodes } of wsBranches) {
    const g = grid.getBoundingClientRect();
    if (!g.width) continue;
    const at = Object.fromEntries(nodes.map((r) => [`${r.n.id}:${r.n.lvl}`, r]));
    let html = '';
    for (const r of nodes) {
      const reqs = [...(r.n.req || [])];
      if (r.n.lvl > 1 && !reqs.includes(`${r.n.id}:${r.n.lvl - 1}`) && at[`${r.n.id}:${r.n.lvl - 1}`] && !reqs.length) reqs.push(`${r.n.id}:${r.n.lvl - 1}`);
      for (const k of reqs) {
        const p = at[k];
        if (!p) continue;
        const a = p.el.getBoundingClientRect();
        const c = r.el.getBoundingClientRect();
        const x1 = a.left + a.width / 2 - g.left;
        const y1 = a.bottom - g.top;
        const x2 = c.left + c.width / 2 - g.left;
        const y2 = c.top - g.top;
        const lit = upgrades.owns(k);
        const my = (y1 + y2) / 2;
        html += `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" stroke="${lit ? 'rgba(143,224,138,0.75)' : 'rgba(255,210,170,0.25)'}" stroke-width="2"/>`;
      }
    }
    svg.innerHTML = html;
  }
}
function refreshWorkshop() {
  const cash = upgrades.currency();
  wsCurrency.textContent = `мотлох: ${cash}`;
  wsWhere.textContent = atWorkshop ? 'Ти в майстерні БЕТА — клікни на доступне покращення, щоб купити' : 'Купувати можна лише в майстерні на базі БЕТА — тут можна спланувати';
  wsWhere.classList.toggle('here', atWorkshop);
  let affordable = 0;
  for (const { n, el } of wsNodes) {
    const b = BRANCH_BY_ID[n.id];
    const lv = upgrades.level(n.id);
    const owned = lv >= n.lvl;
    const next = lv === n.lvl - 1;
    const blocked = next && (upgrades.missing(n.id).length > 0 || (b.requires && !upgrades.unlocked(b.requires)));
    const open = next && !blocked;
    const cost = b.costs[n.lvl - 1];
    const ct = el.querySelector('.ct');
    ct.textContent = owned ? '✓ є' : `${cost} мотлоху`;
    el.classList.toggle('owned', owned);
    el.classList.toggle('open', open);
    el.classList.toggle('locked', !owned && !open);
    el.classList.toggle('poor', open && cash < cost);
    el.classList.toggle('buy', open && cash >= cost && atWorkshop);
    if (open && cash >= cost) affordable++;
  }
  upgBtn.classList.toggle('pulse', affordable > 0 && atWorkshop);
  if (wsPanel.classList.contains('show')) drawTreeLinks();
}
function toggleWorkshop(on = !wsPanel.classList.contains('show')) {
  wsPanel.classList.toggle('show', on);
  if (on) refreshWorkshop();
}
upgBtn.addEventListener('click', () => toggleWorkshop());
document.getElementById('wsClose').addEventListener('click', () => toggleWorkshop(false));
window.addEventListener('resize', () => { if (wsPanel.classList.contains('show')) drawTreeLinks(); });
refreshWorkshop();
document.getElementById('odoRow').addEventListener('click', () => { odo.trip = 0; });
function stepOdometer(t) {
  if (odo.last) {
    const d = Math.hypot(sim.pos.x - odo.last.x, sim.pos.z - odo.last.z);
    if (d < 30) { odo.trip += d; odo.total += d; } // a bigger jump is a teleport, not driving
  }
  odo.last = { x: sim.pos.x, z: sim.pos.z };
  hudOdoTrip.textContent = fmtDist(odo.trip);
  hudOdoTotal.textContent = fmtDist(odo.total);
  if (t > odo.savedAt) {
    odo.savedAt = t + 3;
    try { localStorage.setItem('rover.odo', String(Math.round(odo.total))); } catch (e) { /* ignore */ }
  }
}

// ---------- the crossing ----------
const trip = { target: BASES[1], docked: false, legs: 0, best: Infinity };
// The timed leg: the clock runs from the moment you leave a base until you dock at the other.
// A teleport (the H key, or anything else that jumps the rover) voids the leg.
const leg = { t: 0, valid: false, last: null };
const legKey = (from, to) => ({ region: REAL ? REAL.region : PLANET, chassis: CHASSIS, from: from.name, to: to.name });
const hudBest = document.getElementById('bestStat');
// The ghost of the best crossing, replayed beside the leg in progress: a translucent hull.
const recorder = createRecorder();
const ghost = { track: null, key: '', hint: 0 };
const ghostMesh = new THREE.Group();
{
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(SPEC.box.w, SPEC.box.h, SPEC.box.l),
    new THREE.MeshBasicMaterial({ color: 0x4fe0ff, transparent: true, opacity: 0.22, depthWrite: false, fog: false })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0x9af0ff, transparent: true, opacity: 0.8, fog: false })
  );
  ghostMesh.add(body, edges);
  ghostMesh.visible = false;
  scene.add(ghostMesh);
}
let shownBest = '';

function distanceTo(b) {
  return Math.hypot(sim.pos.x - b.x, sim.pos.z - b.z);
}

// ---------- rover power state ----------
const power = { battery: BATTERY_MAX, panels: 0, wantPanels: false, charge: 0, draw: 0, dust: 0 };
try { power.dust = Math.min(1, Math.max(0, Number(localStorage.getItem('rover.paneldust')) || 0)); } catch (e) { /* storage may be blocked */ }
const hudDust = document.getElementById('dustStat');
let dustShown = '';
let dustSavedAt = 0;
let timeOfDay = 0.62; // start in the afternoon, wings stowed
const el = (id) => document.getElementById(id);
const hudBattery = el('battery');
const hudBatteryBar = el('batteryBar');
const hudPower = el('powerFlow');
const hudClock = el('clock');
const hudPanels = el('panelState');
const hudWarn = el('warn');

function togglePanels() {
  if (!power.wantPanels && Math.abs(sim.speed) > 0.6) {
    flash('Спершу зупинись — крила не розкласти на ходу');
    return;
  }
  power.wantPanels = !power.wantPanels;
  if (power.wantPanels) { power.dust = shakeOff(power.dust); flash('Крила розкладено: частину пилу струшено'); }
  if (audio) audio.servo(power.wantPanels);
}

let flashUntil = 0;
function flash(msg) {
  hudWarn.textContent = msg;
  hudWarn.classList.add('show');
  flashUntil = clock.elapsedTime + 2.6;
}

const hudSpeed = document.getElementById('speed');
const hudMode = document.getElementById('mode');
const hudHint = document.getElementById('hint');
const btnAuto = document.getElementById('autopilot');
const btnReset = document.getElementById('reset');
// The autopilot parks, unfolds, charges to full, folds and carries on by itself.
const auto = { state: 'drive' };

function setAutopilot(on) {
  if (on && !upgrades.unlocked('autopilot')) {
    flash('Автопілот заблокований — купи в майстерні БЕТА');
    return;
  }
  autopilot = on;
  if (!on) auto.state = 'drive';
  hudMode.textContent = on ? 'АВТОПІЛОТ' : 'РУЧНЕ КЕРУВАННЯ';
  btnAuto.classList.toggle('on', on);
}
btnAuto.addEventListener('click', () => setAutopilot(!autopilot));
btnReset.addEventListener('click', () => resetVehicle());
setAutopilot(false);

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Righting is animated over ~0.8 s so it always visibly works, rather than the
// rover snapping upright or bouncing itself back onto its roof.
const righting = { t: 0, yaw: 0 };
function startRighting() {
  righting.t = 0.8;
  righting.yaw = sim.yaw();
}
function stepRighting(dt) {
  if (righting.t <= 0) return false;
  righting.t -= dt;
  const k = 1 - Math.exp(-9 * dt);
  const want = new THREE.Quaternion().setFromAxisAngle(UP, righting.yaw);
  sim.quat.slerp(want, k);
  const g = groundHeight(sim.pos.x, sim.pos.z);
  sim.pos.y += (g + WHEEL_R + SUSP.Lstatic + 0.35 - sim.pos.y) * k;
  sim.vel.multiplyScalar(1 - k);
  sim.angVel.multiplyScalar(1 - k);
  for (const w of sim.wheels) w.wasContact = false;
  sim.refresh();
  sim.syncFromSim?.(); // Rapier keeps its own body: hand it the righted pose
  return true;
}

// R: back on the wheels where you are. H: back to base.
function resetVehicle(home = false) {
  if (home) {
    const b = trip.target === BASES[1] ? BASES[0] : BASES[1];
    const sp = roadSpawn(b === BASES[1]);
    sim.reset(sp.x, sp.z, sp.yaw);
    odo.last = null;
    terrain.prime(sim.pos.x, sim.pos.z);
    tracks.clear();
  } else if (isHung()) {
    unstick();
  } else {
    startRighting();
  }
  camYaw = sim.yaw();
}

// Belly on a boulder: the wheels turn in the air and nothing moves. R lifts the rover
// off and sets it on the flattest clear ground within a few metres, facing the same way.
function isHung() {
  const touching = sim.wheels.filter((w) => w.contact).length;
  return sim.upY > 0.5 && touching <= 1 && Math.abs(sim.speed) < 1.5;
}
function unstick() {
  const yaw = sim.yaw();
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = null;
  for (const d of [-9, -6, -4, 4, 6, 9]) for (const o of [-6, -3, 0, 3, 6]) {
    const x = sim.pos.x + fx * d + fz * o, z = sim.pos.z + fz * d - fx * o;
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 3], [0, -3], [2, 3], [-2, -3]]) {
      const h = groundHeight(x + dx, z + dz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    const score = (hi - lo) + 0.02 * Math.abs(d);
    if (!best || score < best.score) best = { x, z, score };
  }
  sim.reset(best.x, best.z, yaw);
  tracks.clear();
  flash('Ровер знято з каменя');
}

// ---------- route: waypoints the autopilot drives through ----------
// The map parks small in the corner, turning slowly like a display model. A tap
// opens it into a big, orbitable dialog (drag to rotate, wheel to zoom); tapping
// its ground there — a tap, not a drag — drops a waypoint. The autopilot only ever
// drives through waypoints you've placed, never straight at a base on its own.
const route = [];
const WAYPOINT_R = 40;
const map3dEl = document.getElementById('map3d');
const routeInfo = document.getElementById('routeInfo');
const minimap = createMinimap3D(
  document.getElementById('map3dCanvas'),
  document.getElementById('map3dOverlay'),
  seeds ? seeds.items : missions.modules,
  [
    ...(seeds ? [{ x: LAB.x, z: LAB.z, text: 'Л', color: '#7ce68f' }] : TOWN ? [{ x: TOWN.x, z: TOWN.z, text: 'О', color: '#ffd08a' }] : []),
    ...REAL_PLACES.map((p) => ({ x: p.x, z: p.z, text: p.letter, color: '#ffd08a' })),
  ]
);

// What has been explored, saved per region (a map of another shape is simply dropped).
const EXPLORED_KEY = `rover.explored.${REAL ? REAL.region : PLANET}`;
try { minimap.importExplored(localStorage.getItem(EXPLORED_KEY)); } catch (e) { /* storage may be blocked */ }
const exploredState = { next: 0, saveAt: 0, text: '' };
const hudExplored = document.getElementById('exploredStat');
function stepExplored(t) {
  if (t < exploredState.next) return;
  exploredState.next = t + 0.5;
  minimap.reveal(sim.pos.x, sim.pos.z);
  // chatter on the road (real regions): comes on once as you pass each mark, counted from the base you left
  if (REAL) {
    const along = ROUTE_PTS[nearestRouteIndex(sim.pos.x, sim.pos.z)].s / ROUTE_LEN;
    const progress = trip.target === BASES[1] ? along : 1 - along;
    for (const m of REGION_RADIO[REAL.region] || []) {
      if (!m.said && progress >= m.at && progress < m.at + 0.12) { m.said = true; say(m.lines); }
    }
  }
  const text = `${(minimap.exploredFraction() * 100).toFixed(1)}%`;
  if (text !== exploredState.text) { exploredState.text = text; hudExplored.textContent = text; }
  if (t > exploredState.saveAt) {
    exploredState.saveAt = t + 10;
    try { localStorage.setItem(EXPLORED_KEY, minimap.exportExplored()); } catch (e) { /* storage may be blocked */ }
  }
}

function updateRouteInfo() {
  routeInfo.textContent = route.length
    ? `Маршрут: ${route.length} ${route.length === 1 ? 'точка' : 'точок'}`
    : 'Маршрут порожній — клацай по карті, щоб ставити точки; тягни — рух, коліщатко — зум';
  minimap.setRoute(route);
}

minimap.setOnAdd((x, z) => {
  route.push({ x, z });
  updateRouteInfo();
  if (!autopilot) {
    setAutopilot(true);
    flash('Маршрут задано — автопілот увімкнено');
  }
});

function openMap() {
  map3dEl.classList.add('big');
  minimap.setBig(true);
  minimap.resize();
}
function closeMap() {
  map3dEl.classList.remove('big');
  minimap.setBig(false);
  minimap.resize();
}
minimap.setOnTapSmall(openMap);
document.getElementById('mapClose').addEventListener('click', closeMap);
document.getElementById('mapCenter').addEventListener('click', () => minimap.recenter());

function toggleMap() {
  const hidden = map3dEl.classList.toggle('hidden');
  const btn = document.getElementById('mapToggle');
  if (btn) btn.textContent = hidden ? 'Карта: вимк' : 'Карта: увімк';
  if (hidden) closeMap();
  else minimap.resize();
}
document.getElementById('routeClear').addEventListener('click', () => {
  route.length = 0;
  updateRouteInfo();
});
document.getElementById('routeUndo').addEventListener('click', () => {
  route.pop();
  updateRouteInfo();
});
window.addEventListener('resize', () => {
  if (!map3dEl.classList.contains('hidden')) minimap.resize();
});
updateRouteInfo();
minimap.resize();

// ---------- compass ----------
// A ribbon that scrolls under a fixed centre marker, the way a real heading tape
// does: a world direction's mark slides toward the centre as you turn to face it.
// It floats with no backing panel, so every stroke gets a dark outline first —
// that, not the tick spacing, is what keeps it legible over bright ground too.
const compassCtx = document.getElementById('compassCanvas').getContext('2d');
const CARDINAL = { 0: 'Пн', 90: 'Сх', 180: 'Пд', 270: 'Зх' };
function wrapDeg(d) {
  return ((d % 360) + 360) % 360;
}
function outlinedText(c, text, x, y) {
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(20, 10, 6, 0.85)';
  c.strokeText(text, x, y);
  c.fillText(text, x, y);
}
// The game's forward is +Z at yaw 0, and a positive yaw turns toward +X — which,
// seen from behind the rover, is to its LEFT. So compass heading (clockwise from
// north = +Z, as on any real compass) is minus the yaw, not the yaw itself; using
// the yaw straight made the tape scroll the wrong way round.
function compassBearing(dx, dz) {
  return wrapDeg((-Math.atan2(dx, dz) * 180) / Math.PI);
}
function fmtRange(d) {
  return d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} км`;
}
// The tape sits between the mission panel (left, 250 px) and the rover panel
// (right, 230 px), so its width follows the window: as wide as fits the gap, 560 px
// at most. The scale per degree stays fixed; a narrower tape just shows fewer degrees.
const COMPASS_H = 70;
const PX_PER_DEG = 560 / 130;
let COMPASS_W = 560;
let HALF_WINDOW = 62;
function sizeCompass() {
  const gap = window.innerWidth / 2 - (16 + 250 + 14);
  COMPASS_W = Math.round(Math.max(200, Math.min(560, gap * 2)));
  HALF_WINDOW = COMPASS_W / 2 / PX_PER_DEG;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  compassCtx.canvas.width = COMPASS_W * dpr;
  compassCtx.canvas.height = COMPASS_H * dpr;
  compassCtx.canvas.style.width = COMPASS_W + 'px';
  compassCtx.canvas.style.height = COMPASS_H + 'px';
  compassCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeCompass();
window.addEventListener('resize', sizeCompass);
function compassBadge(c, t, x, y, withDist) {
  const r = 9;
  c.fillStyle = t.color;
  c.beginPath();
  if (t.kind === 'diamond') {
    c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y);
    c.closePath();
  } else if (t.kind === 'square') {
    c.roundRect(x - r + 1, y - r + 1, 2 * r - 2, 2 * r - 2, 3);
  } else {
    c.arc(x, y, r, 0, Math.PI * 2);
  }
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = 'rgba(20, 10, 6, 0.9)';
  c.stroke();
  if (t.text) {
    c.fillStyle = '#0d1a22';
    c.font = 'bold 11px ui-monospace, monospace';
    c.textBaseline = 'middle';
    c.fillText(t.text, x, y + 1);
    c.textBaseline = 'alphabetic';
  }
  if (!withDist) return;
  c.font = 'bold 10px ui-monospace, monospace';
  c.fillStyle = '#f4ead8';
  const text = fmtRange(t.dist);
  const half = c.measureText(text).width / 2 + 3;
  outlinedText(c, text, Math.min(COMPASS_W - half, Math.max(half, x)), y + r + 12);
}
function drawCompass(yaw, targets) {
  const c = compassCtx;
  const w = COMPASS_W;
  const h = COMPASS_H;
  const headingDeg = wrapDeg((-yaw * 180) / Math.PI);
  const pxPerDeg = PX_PER_DEG;
  const cx = w / 2;
  c.clearRect(0, 0, w, h);
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const base = h - 4; // ribbon baseline

  // Ticks and labels are generated straight from world degrees (multiples of 10,
  // major every 30), never from a fixed screen step — that's what made numbers
  // wink in and out before: a screen-spaced sample could skip right past a round
  // number as the heading changed, and land on nothing to draw.
  const first = Math.ceil((headingDeg - HALF_WINDOW) / 10) * 10;
  for (let deg = first; deg <= headingDeg + HALF_WINDOW; deg += 10) {
    const d = deg - headingDeg;
    const x = cx + d * pxPerDeg;
    if (x < -10 || x > w + 10) continue;
    const wrapped = wrapDeg(deg);
    const major = wrapped % 30 === 0;
    c.lineWidth = major ? 4.2 : 2.6;
    c.strokeStyle = 'rgba(20, 10, 6, 0.85)';
    c.beginPath();
    c.moveTo(x, base - (major ? 16 : 8));
    c.lineTo(x, base);
    c.stroke();
    c.lineWidth = major ? 1.8 : 1.1;
    c.strokeStyle = major ? 'rgba(255, 214, 176, 0.95)' : 'rgba(255, 214, 176, 0.55)';
    c.beginPath();
    c.moveTo(x, base - (major ? 16 : 8));
    c.lineTo(x, base);
    c.stroke();
    if (major) {
      c.font = 'bold 12px ui-monospace, monospace';
      c.fillStyle = CARDINAL[wrapped] ? '#7ce6ff' : '#ffd6b0';
      outlinedText(c, CARDINAL[wrapped] || String(wrapped), x, base - 20);
    }
  }

  // Targets — route points, unpicked modules, bases — as badges above the ribbon,
  // each with its distance under it, the same shape and colour as on the map. One
  // past the edge of the tape is pinned to that edge with an arrow, so a target
  // behind you still says which way to turn. Nearest drawn last, so on top.
  if (targets) {
    const badgeY = 12;
    // Place nearest first: a badge that would crowd one already placed keeps its
    // icon but drops its distance, so the digits never run into each other. Then
    // draw farthest first, so the nearest ends up on top.
    const shown = [];
    for (const t of [...targets].sort((a, b) => a.dist - b.dist)) {
      const d = ((t.bearing - headingDeg + 180) % 360 + 360) % 360 - 180;
      t.off = Math.abs(d) > HALF_WINDOW - 4;
      if (t.off && t.kind !== 'circle') continue; // only route points get edge pins
      t.side = Math.sign(d);
      t.sx = t.off ? cx + t.side * (w / 2 - 14) : cx + d * pxPerDeg;
      t.withDist = !shown.some((o) => o.withDist && Math.abs(o.sx - t.sx) < 46);
      shown.push(t);
    }
    for (const t of shown.reverse()) {
      const x = t.sx;
      if (t.off) {
        const s = t.side;
        c.fillStyle = t.color;
        c.beginPath();
        c.moveTo(x + s * 14, badgeY);
        c.lineTo(x + s * 8, badgeY - 5);
        c.lineTo(x + s * 8, badgeY + 5);
        c.closePath();
        c.fill();
      }
      compassBadge(c, t, x, badgeY, t.withDist);
    }
  }

  c.lineWidth = 3;
  c.strokeStyle = 'rgba(20, 10, 6, 0.8)';
  c.beginPath();
  c.moveTo(cx, 2);
  c.lineTo(cx, h - 2);
  c.stroke();
  c.lineWidth = 1.6;
  c.strokeStyle = '#4fe0ff';
  c.beginPath();
  c.moveTo(cx, 2);
  c.lineTo(cx, h - 2);
  c.stroke();
}

const AUTO_LABEL = { drive: 'АВТОПІЛОТ', stopping: 'АВТОПІЛОТ: ЗУПИНКА',
  charging: 'АВТОПІЛОТ: ЗАРЯДКА', stowing: 'АВТОПІЛОТ: ЗБІР КРИЛ' };

function autopilotInput() {
  if (auto.state === 'drive' && power.battery <= 0.6) auto.state = 'stopping';
  // Someone left the wings out; fold them before moving.
  if (auto.state === 'drive' && power.panels > 0.02) {
    power.wantPanels = false;
    auto.state = 'stowing';
  }
  if (auto.state === 'stopping' && Math.abs(sim.speed) < 0.6) {
    if (!power.wantPanels) {
      power.wantPanels = true;
      power.dust = shakeOff(power.dust); // the autopilot unfolds the wings too
      if (audio) audio.servo(true);
    }
    auto.state = 'charging';
  }
  if (auto.state === 'charging' && power.battery >= 99.5) {
    power.wantPanels = false;
    if (audio) { audio.servo(false); audio.speak('Батарея заряджена. Продовжую маршрут'); }
    auto.state = 'stowing';
  }
  if (auto.state === 'stowing' && power.panels < 0.01) auto.state = 'drive';

  if (auto.state !== 'drive') return { throttle: 0, steer: 0, brake: 1, boost: false };
  // No waypoints plotted: sit tight rather than heading for a base on its own.
  if (!route.length) return { throttle: 0, steer: 0, brake: 1, boost: false };

  const tgt = route[0];
  // АВТОУНИКНЕННЯ is its own workshop unlock, separate from the sonar that spots
  // the obstacle in the first place — without it the autopilot still gets warned
  // (the flash/beep above) but doesn't actually swerve for it.
  const bias = upgrades.unlocked('avoidance') ? sonarScan.avoidBias : 0;
  const want = Math.atan2(tgt.x - sim.pos.x, tgt.z - sim.pos.z) + bias;
  // A rock dead ahead with no clear side (avoidBias pinned near its max both ways
  // cancel toward the corridor centre, but the beam still reports it as crowded):
  // ease off rather than forcing the turn through it.
  const dodgeLoad = Math.abs(bias) / SONAR_MAX_BIAS;
  // A hard swerve at full speed is how it nearly tipped over — bleed off real speed
  // (not just throttle) once the dodge gets serious, so the turn happens slower.
  const turnErr = wrapAngle(want - sim.yaw());
  const vWant = apSpeed({
    ground: groundHeight, x: sim.pos.x, z: sim.pos.z, heading: sim.yaw(), turnErr,
    dist: Math.hypot(tgt.x - sim.pos.x, tgt.z - sim.pos.z), last: route.length === 1, upY: sim.upY,
  });
  const over = sim.speed - vWant;
  return {
    throttle: clamp((vWant - sim.speed) * 0.6, -1, 1) * (1 - 0.7 * dodgeLoad),
    steerTo: clamp(turnErr * 1.5, -1, 1),
    brake: Math.max(dodgeLoad > 0.55 ? (dodgeLoad - 0.55) * 1.4 : 0, over > 2 ? clamp((over - 2) * 0.15, 0, 0.6) : 0),
    boost: false,
  };
}

function readInput(t) {
  if (autopilot) return autopilotInput();
  // Wings out or battery flat: no drive, but you can still coast and steer.
  if (power.panels > 0.02 || power.battery <= 0) {
    const has = (a, b) => keys.has(a) || keys.has(b);
    return {
      throttle: 0,
      steer: (has('KeyA', 'ArrowLeft') ? 1 : 0) - (has('KeyD', 'ArrowRight') ? 1 : 0),
      centre: has('KeyA', 'ArrowLeft') && has('KeyD', 'ArrowRight'),
      brake: power.panels > 0.02 ? 1 : keys.has('Space') ? 1 : 0,
      boost: false,
    };
  }
  const has = (a, b) => keys.has(a) || keys.has(b);
  const left = has('KeyA', 'ArrowLeft');
  const right = has('KeyD', 'ArrowRight');
  return {
    throttle: (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0),
    steer: (left ? 1 : 0) - (right ? 1 : 0),
    // Holding both keys is the way back to straight ahead.
    centre: left && right,
    brake: keys.has('Space') ? 1 : 0,
    // The glider spends Shift and Ctrl on height instead: up and down.
    boost: !SPEC.flight && (keys.has('ShiftLeft') || keys.has('ShiftRight')),
    climb: SPEC.flight ? (has('ShiftLeft', 'ShiftRight') ? 1 : 0) - (has('ControlLeft', 'ControlRight') ? 1 : 0) : 0,
  };
}

// ---------- camera ----------
const origin = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camOffset = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
let camYaw = sim.yaw();
let camY = sim.pos.y;
let flippedFor = 0;
let hungFor = 0;
const HINT_FLIPPED = 'Перевернулись? Натисни R, щоб поставити на колеса';
let camMode = 0;
let orbitAngle = 0;
const ORBIT_IDLE = 4; // s without camera input before the orbit camera circles again
let orbitHeld = false;
let orbitIdle = ORBIT_IDLE;
let orbitSpin = 1;
controls.addEventListener('start', () => { orbitHeld = true; orbitIdle = 0; });
controls.addEventListener('end', () => { orbitHeld = false; orbitIdle = 0; });
const btnCamera = document.getElementById('camBtn');
const CAM_LABEL = { chase: 'ближня', far: 'дальня', top: 'згори', orbit: 'оберт' };
function presetOffset(mode, yaw) {
  const [back, up] = mode === 'far' ? [CAM_FAR_BACK, CAM_FAR_UP] : [CAM_BACK, CAM_UP];
  return new THREE.Vector3(-Math.sin(yaw) * back, up, -Math.cos(yaw) * back);
}
function setCamMode(i) {
  camMode = ((i % CAM_MODES.length) + CAM_MODES.length) % CAM_MODES.length;
  const mode = CAM_MODES[camMode];
  controls.enabled = mode !== 'top';
  if (mode === 'chase' || mode === 'far') {
    camera.position.copy(camTarget).add(presetOffset(mode, camYaw));
    controls.target.copy(camTarget);
    controls.update();
  } else if (mode === 'orbit') {
    orbitAngle = camYaw;
    orbitIdle = ORBIT_IDLE;
    orbitSpin = 1;
    camera.position.set(camTarget.x - Math.sin(orbitAngle) * CAM_ORBIT_RADIUS, camTarget.y + CAM_ORBIT_HEIGHT, camTarget.z - Math.cos(orbitAngle) * CAM_ORBIT_RADIUS);
    controls.target.copy(camTarget);
    controls.update();
  }
  btnCamera.textContent = `Камера: ${CAM_LABEL[mode]} (C)`;
}
function cycleCamera() { setCamMode(camMode + 1); }
btnCamera.addEventListener('click', cycleCamera);

camTarget.set(sim.pos.x, sim.pos.y + 0.5, sim.pos.z);
controls.target.copy(camTarget);
camera.position.copy(camTarget).add(camOffset.set(-Math.sin(camYaw) * CAM_BACK, CAM_UP, -Math.cos(camYaw) * CAM_BACK));

// ---------- photo mode ----------
// F freezes the world and frees the camera: drag to look round, wheel to zoom, WASD to
// slide, Q/E down/up, [ ] to roll the clock, Enter saves a PNG. The HUD is hidden.
let photo = null;
const photoBar = document.getElementById('photoBar');
function togglePhoto() {
  if (menuOpen) return;
  if (!photo) {
    photo = {
      pos: camera.position.clone(), target: controls.target.clone(), mode: camMode,
      minD: controls.minDistance, maxD: controls.maxDistance, polar: controls.maxPolarAngle,
    };
    keys.clear();
    setAutopilot(false);
    controls.enabled = true;
    controls.minDistance = 1.2;
    controls.maxDistance = 400;
    controls.maxPolarAngle = Math.PI - 0.05;
    document.body.classList.add('photo');
  } else {
    controls.minDistance = photo.minD;
    controls.maxDistance = photo.maxD;
    controls.maxPolarAngle = photo.polar;
    camera.position.copy(photo.pos);
    controls.target.copy(photo.target);
    setCamMode(photo.mode);
    photo = null;
    keys.clear();
    clock.getDelta(); // swallow the paused time so physics does not jump
    document.body.classList.remove('photo');
  }
}
function savePhoto() {
  post.render();
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.download = `solar-rover-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    photoBar.classList.add('snap');
    setTimeout(() => photoBar.classList.remove('snap'), 250);
  }, 'image/png');
}
const photoMove = new THREE.Vector3();
const photoRight = new THREE.Vector3();
function photoFrame(dt) {
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
  const step = Math.max(4, camera.position.distanceTo(controls.target)) * 0.9 * fast * dt;
  camera.getWorldDirection(photoMove);
  photoMove.y = 0;
  photoMove.normalize();
  photoRight.crossVectors(photoMove, UP);
  const d = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) d.add(photoMove);
  if (keys.has('KeyS') || keys.has('ArrowDown')) d.sub(photoMove);
  if (keys.has('KeyD') || keys.has('ArrowRight')) d.add(photoRight);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) d.sub(photoRight);
  if (keys.has('KeyE')) d.y += 1;
  if (keys.has('KeyQ')) d.y -= 1;
  if (d.lengthSq()) {
    d.multiplyScalar(step);
    camera.position.add(d);
    controls.target.add(d);
  }
  if (keys.has('BracketRight')) timeOfDay = (timeOfDay + dt * 0.04) % 1;
  if (keys.has('BracketLeft')) timeOfDay = (timeOfDay - dt * 0.04 + 1) % 1;
  applyTimeOfDay(timeOfDay);
  weatherLook();
  controls.update();
  const minY = groundHeight(camera.position.x, camera.position.z) + 0.4;
  if (camera.position.y < minY) camera.position.y = minY;
  sky.position.copy(camera.position);
  const hh = Math.floor(timeOfDay * 24);
  const mm = Math.floor((timeOfDay * 24 - hh) * 60);
  photoBar.querySelector('b').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ---------- loop ----------
const clock = new THREE.Clock();

// ---------- debug bar: fps and frame time ----------
// A browser page has no API for real OS CPU load, so frame time stands in for it —
// the same idea (how long each frame took to compute and draw), just measured here
// instead of by the OS.
let dbgLast = performance.now();
let fpsEma = 60;
let msEma = 16.7;
let dbgAt = 0;
const dbgFpsEl = document.getElementById('dbgFps');
const dbgMsEl = document.getElementById('dbgMs');

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (garage.isOpen) {
    garage.render(dt);
    requestAnimationFrame(frame);
    return;
  }
  if (menuOpen) {
    // Hold everything — clock included — so the sol does not run and the battery
    // does not drain while the player is still deciding.
    sunShadows.update();
    post.render();
    requestAnimationFrame(frame);
    return;
  }
  if (photo) {
    photoFrame(dt);
    sunShadows.update();
    updateShafts();
    post.render();
    requestAnimationFrame(frame);
    return;
  }
  const t = clock.elapsedTime;

  // Scanned from last frame's position — one frame of lag, not worth chasing — so
  // autopilotInput() (called inside readInput below) already sees this tick's bias.
  // The sonar itself is a workshop unlock — no scan, no pings until bought (upgrades
  // is planet-aware: always off on the Moon, always on on Верданта, see upgrades.js).
  if (upgrades.unlocked('sonar')) {
    sonarScan = sonar.update(dt, sim.pos.x, sim.pos.z, sim.yaw(), upgrades.mul('avoidance') || 30);
    if (sonarScan.warnObstacle && !sonarWarned) {
      sonarWarned = true;
      flash(`Сонар: перешкода за ${Math.round(sonarScan.warnObstacle.d)} м`);
      if (audio) audio.beep(620);
    } else if (!sonarScan.warnObstacle) {
      sonarWarned = false;
    }
  } else {
    sonarScan = { warnObstacle: null, avoidBias: 0 };
    sonarWarned = false;
  }

  if (!stepRighting(dt)) sim.update(dt, readInput(t));
  else sim.update(0.0001, { throttle: 0, steer: 0, brake: 1 });

  // Visual model follows the rigid body.
  {
    const yw = sim.yaw();
    terrain.update(sim.pos.x, sim.pos.z, 3, lampLevel() >= 3 ? { dx: Math.sin(yw), dz: Math.cos(yw) } : null);
  }
  sim.origin(origin);
  if (SPEC.flight) {
    // Flames: the lift jets work harder climbing and ease off sinking; the turbines
    // roar with the throttle.
    const climbIn = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0) - (keys.has('ControlLeft') || keys.has('ControlRight') ? 1 : 0);
    const liftK = power.battery > 0 ? clamp(0.55 + 0.1 * sim.vel.y + 0.35 * climbIn, 0.15, 1.4) : 0;
    vehicle.setThrust(liftK, power.battery > 0 ? Math.max(0, sim.cmd.throttle) : 0);
  }
  vehicle.root.position.copy(origin);
  vehicle.root.quaternion.copy(sim.quat);
  vehicle.setSteer(sim.cmd.steer, sim.speed);
  if (vehicle.setPilot) {
    const ax = dt > 0 ? (sim.speed - pilotPrevSpeed) / dt : 0;
    pilotPrevSpeed = sim.speed;
    vehicle.setPilot(ax, sim.speed * sim.angVel.y, sim.cmd.steer / 0.6);
  }

  // The roof spot's rectangular beam is drawn through its shadow camera, and that
  // camera's own `up` never rotates with its parent — only its position and look
  // direction do. Left at the world's up, the beam stayed level on a banked truck
  // instead of banking with it. Feeding it the truck's actual up vector each frame
  // rolls the rectangle along with the body, the way a real fixed lamp would.
  farLight.shadow.camera.up.copy(farUpLocal).applyQuaternion(sim.quat);

  const speedAbs = Math.abs(sim.speed);
  W.forEach((w, i) => {
    const s = w.sim;
    const Lvis = s.contact ? clamp(s.L, SUSP.Lmin, SUSP.Lmax) : SUSP.Lmax;
    vehicle.setSuspension(i, Lvis);
    w.spin.rotation.x += s.spinRate * dt;

  });

  // Camera: turns with the truck's heading (not its roll/pitch, so a flip doesn't spin
  // the view). Chase/far keep the old drag-to-orbit trick; top/orbit drive the camera
  // outright (see setCamMode/CAM_MODES).
  const prevYaw = camYaw;
  if (sim.upY > 0.2) camYaw += wrapAngle(sim.yaw() - camYaw) * (1 - Math.exp(-3 * dt));
  camY = damp(camY, sim.pos.y, 4, dt);
  camTarget.set(sim.pos.x, camY + 0.5, sim.pos.z);
  const camModeName = CAM_MODES[camMode];
  if (camModeName === 'chase' || camModeName === 'far') {
    camOffset.copy(camera.position).sub(controls.target).applyAxisAngle(UP, camYaw - prevYaw);
    camera.position.copy(camTarget).add(camOffset);
  } else if (camModeName === 'top') {
    camera.position.set(camTarget.x, camTarget.y + CAM_TOP_HEIGHT, camTarget.z + 0.01);
  } else {
    // The player can grab the orbit camera (drag, zoom); it then just follows the
    // rover from wherever they left it, and after a few idle seconds starts circling
    // again from that very spot, easing its distance and height back to the preset.
    camOffset.copy(camera.position).sub(controls.target);
    if (!orbitHeld) orbitIdle += dt;
    if (orbitHeld || orbitIdle < ORBIT_IDLE) {
      orbitSpin = 0;
    } else {
      orbitSpin = Math.min(1, orbitSpin + dt / 2); // spin up gently, not with a jerk
      const flat = Math.hypot(camOffset.x, camOffset.z);
      const ang = Math.atan2(-camOffset.x, -camOffset.z) + dt * CAM_ORBIT_SPEED * orbitSpin;
      const r = damp(flat, CAM_ORBIT_RADIUS, 0.4 * orbitSpin, dt);
      const h = damp(camOffset.y, CAM_ORBIT_HEIGHT, 0.4 * orbitSpin, dt);
      camOffset.set(-Math.sin(ang) * r, h, -Math.cos(ang) * r);
    }
    camera.position.copy(camTarget).add(camOffset);
  }
  controls.target.copy(camTarget);
  controls.update();
  const minCamY = groundHeight(camera.position.x, camera.position.z) + 0.5;
  if (camera.position.y < minCamY) camera.position.y = minCamY;

  sky.position.copy(camera.position);
  sun.position.copy(sim.pos).addScaledVector(sunDir, 60);
  sun.target.position.copy(sim.pos);

  flippedFor = sim.upY < 0.55 && speedAbs < 2.5 && righting.t <= 0 ? flippedFor + dt : 0;
  hungFor = isHung() && Math.abs(sim.cmd.throttle) > 0.3 && righting.t <= 0 ? hungFor + dt : 0;
  const hintText = hungFor > 1.5 && flippedFor <= 1.0 ? 'Застрягли на камені? Натисни R, щоб зняти ровер' : HINT_FLIPPED;
  if (hudHint.textContent !== hintText) hudHint.textContent = hintText;
  hudHint.classList.toggle('show', flippedFor > 1.0 || hungFor > 1.5);
  // ---------- workshop upgrades ----------
  sim.powerMul = upgrades.mul('motor');
  sim.suspMul = upgrades.mul('suspension');
  sim.gripMul = upgrades.mul('wheels');
  // Wading costs you: water piles up against the hull and the wheels lose bite. This
  // rides the same runtime multipliers the workshop upgrades drive, so the feel of
  // water needs nothing added to the physics itself.
  // Off the graded road the big machines just roll on; a low road car bogs down.
  {
    const rd = roadDist(sim.pos.x, sim.pos.z);
    // A bridge deck is paved: no bogging down on it.
    const onDeck = Math.abs(sim.pos.y - deckHeight(sim.pos.x, sim.pos.z)) < 3;
    const off = onDeck ? 0 : clamp((rd - ROAD_HALF * 0.6) / 24, 0, 1);
    offroadK = off;
    sim.rollMul = (0.7 + 0.3 * off) * (1 + (TR.offRoll - 1) * off);
    sim.dragMul = 1 + (TR.offDrag - 1) * off;
    // Tyre pressure: soft tyres float on dust and grip loose ground better but waste
    // energy and wander on the hard road; hard ones are the other way round.
    const dp = TYRE_MODES[tyreMode].p - 1;
    const soft = off * Math.min(1, 0.4 + dustDepth(sim.pos.x, sim.pos.z));
    sim.rollMul *= 1 + dp * (0.9 * soft - 0.5 * (1 - soft));
    sim.gripMul *= 1 - dp * (0.35 * soft - 0.08 * (1 - soft));
  }
  const wade = Math.min(1, waterDepthAt(sim.pos.x, sim.pos.z) / TR.wade);
  if (wade > 0) {
    sim.powerMul *= 1 - 0.5 * wade;
    sim.gripMul *= 1 - 0.28 * wade;
  }
  const chargeMul = upgrades.mul('panels');
  const drawMul = upgrades.mul('battery');

  // ---------- sol cycle and power ----------
  if (dynamicLight) {
    timeOfDay = (timeOfDay + dt / SOL_SECONDS) % 1;
    applyTimeOfDay(timeOfDay);
  }
  weather.update(dt, camera.position, daylight);
  stormW = weather.w;
  weatherLook();
  // Cloud shadows sliding over the ground: none on the airless Moon, thin wisps on
  // Mars, real cumulus on Верданта; lost in the murk of a storm.
  {
    const CLOUD = { mars: 0.3, verdanta: 0.42 }[PLANET] || 0;
    terrain.cloud.amt.value = CLOUD * clamp(sunDir.y * 3, 0, 1) * (1 - weather.w);
    terrain.cloud.off.value.x += dt * 0.0045;
    terrain.cloud.off.value.y += dt * 0.0025;
  }
  // The ground soaks up quickly in rain and dries slowly after.
  if (weather.kind === 'rain') {
    const wv = terrain.wet.value;
    terrain.wet.value = clamp(wv + (weather.w > 0.25 ? dt / 35 : -dt / 160), 0, 1);
  }
  if (weather.event && WEATHER_TEXT[weather.kind]) {
    const msg = WEATHER_TEXT[weather.kind][weather.event];
    flash(msg);
    if (audio && weather.event === 'start') audio.speak(msg.split(' —')[0]);
  }
  if (weather.kind === 'rain') sim.gripMul *= 1 - 0.15 * weather.w;
  setLamps(lampLevel());

  const target = power.wantPanels ? 1 : 0;
  if (power.panels !== target) {
    const step = dt / PANEL_SECONDS;
    power.panels = target > power.panels ? Math.min(target, power.panels + step) : Math.max(target, power.panels - step);
  }
  vehicle.setPanels(power.panels);

  // Charging needs the wings fully open and the sun above the horizon.
  // dust on the wings (paneldust.js): settles as you drive through soft ground and storms
  power.dust = stepDust(power.dust, dt, { speed: sim.speed, soft: REAL ? dustDepth(sim.pos.x, sim.pos.z) : 0.3, storm: weather.w, open: power.wantPanels });
  power.charge = power.panels > 0.99 ? (CHARGE_PEAK * TR.solar / TR.pack) * chargeMul * Math.max(0, sunDir.y) * (1 - 0.75 * weather.w) * chargeFactor(power.dust) : 0;
  const dustText = `${Math.round(power.dust * 100)}%`;
  if (dustText !== dustShown) { dustShown = dustText; hudDust.textContent = dustText; hudDust.style.color = power.dust > 0.5 ? '#ffb27a' : ''; }
  if (clock.elapsedTime > dustSavedAt) { dustSavedAt = clock.elapsedTime + 10; try { localStorage.setItem('rover.paneldust', power.dust.toFixed(3)); } catch (e) { /* storage may be blocked */ } }
  // Rear-only drive spins up half the drivetrain, so it costs less to hold the same
  // throttle — the payoff for giving up front-axle traction above AWD_UP.
  const moveV = Math.max(3, Math.abs(sim.speed));
  power.draw = ((DRAW_IDLE * TR.idle + TR.perM * moveV * Math.abs(sim.cmd.throttle) * (sim.cmd.boost ? BOOST_DRAW : 1) * (sim.awd ? 1 : 0.8)) / TR.pack) * drawMul;
  const wasEmpty = power.battery <= 0;
  power.battery = clamp(power.battery + (power.charge - power.draw) * dt, 0, BATTERY_MAX);
  if (!wasEmpty && power.battery <= 0) {
    flash('Батарея розряджена — розклади крила (E)');
    if (audio) { audio.beep(300, 0.4); audio.speak('Батарея розряджена. Розклади сонячні крила'); }
  }

  const pct = (power.battery / BATTERY_MAX) * 100;
  hudRange.textContent = `~${((RANGE_KM / drawMul) * pct / 100).toFixed(1)} км`;
  if (REAL) {
    // real height above Mars's own zero, and how the rover sits (pitch, roll)
    attFwd.set(0, 0, 1).applyQuaternion(sim.quat);
    attRight.set(-1, 0, 0).applyQuaternion(sim.quat);
    const pr = pitchRollDeg(attFwd.y, attRight.y);
    hudAlt.textContent = formatAltitude(sim.pos.y + REAL.ref);
    hudTilt.textContent = formatTilt(pr.pitch, pr.roll);
  }
  hudBatteryBar.style.width = `${pct}%`;
  hudBatteryBar.style.background = pct < LOW_BATTERY ? '#ff4530' : power.charge > power.draw ? '#4fe06a' : '#ff9420';
  hudBattery.textContent = `${pct.toFixed(0)}%`;
  const net = power.charge - power.draw;
  hudPower.textContent = `${net >= 0 ? '+' : ''}${net.toFixed(2)} %/с`;
  hudPower.style.color = net >= 0 ? '#7ce68f' : '#ffb27a';
  const hh = Math.floor(timeOfDay * 24);
  const mm = Math.floor((timeOfDay * 24 - hh) * 60);
  hudClock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  hudPanels.textContent =
    power.panels > 0.99 ? (power.charge > 0 ? 'КРИЛА: ЗАРЯДКА' : 'КРИЛА: ВІДКРИТІ (НЕМА СОНЦЯ)')
    : power.panels < 0.01 ? 'КРИЛА: СКЛАДЕНІ' : 'КРИЛА: РУХ…';
  hudPanels.classList.toggle('on', power.charge > 0);
  if (flashUntil && t > flashUntil) {
    hudWarn.classList.remove('show');
    flashUntil = 0;
  }

  stepOdometer(t);
  // ---------- navigation ----------
  if (route.length && Math.hypot(sim.pos.x - route[0].x, sim.pos.z - route[0].z) < WAYPOINT_R) {
    route.shift();
    updateRouteInfo();
    if (audio) audio.beep(route.length ? 980 : 1240, 0.12);
    if (!route.length) flash('Маршрут пройдено');
  }
  if (autopilot) hudMode.textContent = AUTO_LABEL[auto.state];

  // Arrival at a base is still tracked (for the docking message and H's target),
  // even though the HUD no longer shows a running bearing to it.
  const dist = distanceTo(trip.target);
  const other = trip.target === BASES[0] ? BASES[1] : BASES[0];
  // timing: runs once clear of the base you left; a jump of the rover voids it
  if (leg.last && Math.hypot(sim.pos.x - leg.last.x, sim.pos.z - leg.last.z) > 120) leg.valid = false;
  leg.last = { x: sim.pos.x, z: sim.pos.z };
  if (distanceTo(other) < ARRIVE_R * 1.6) { leg.t = 0; leg.valid = true; } else if (leg.valid) leg.t += dt;
  const bestNow = bestOf(legKey(other, trip.target));
  // the ghost for this direction (read from storage only when the direction changes)
  const gKey = ghostKey(legKey(other, trip.target));
  if (gKey !== ghost.key) { ghost.key = gKey; ghost.track = loadGhost(legKey(other, trip.target)); ghost.hint = 0; }
  if (leg.valid && leg.t > 0) recorder.sample(leg.t, sim.pos.x, sim.pos.z, sim.yaw());
  else { recorder.reset(); ghost.hint = 0; }
  let gap = '';
  const gp = ghost.track && leg.valid && leg.t > 0 ? ghostAt(ghost.track, leg.t) : null;
  if (gp && !gp.done) {
    ghostMesh.visible = true;
    ghostMesh.position.set(gp.x, groundHeight(gp.x, gp.z) + SPEC.box.h / 2 + 0.5, gp.z);
    ghostMesh.rotation.y = gp.yaw;
    const at = ghostTimeAt(ghost.track, sim.pos.x, sim.pos.z, ghost.hint);
    ghost.hint = Math.max(0, at.index - 4);
    if (at.dist < 60) { const d = at.time - leg.t; gap = ` · ${d >= 0 ? '+' : '\u2212'}${Math.abs(d).toFixed(1)} с`; }
  } else ghostMesh.visible = false;
  const bestText = `${bestNow === null ? '–' : fmtTime(bestNow)} · ${leg.valid && leg.t > 0 ? fmtTime(leg.t) : '0:00'}${gap}`;
  if (bestText !== shownBest) { shownBest = bestText; hudBest.textContent = bestText; }
  if (dist < ARRIVE_R && !trip.docked) {
    trip.docked = true;
    trip.legs++;
    let timeNote = '';
    if (leg.valid) {
      const r = recordLeg(legKey(other, trip.target), leg.t);
      if (r.counted) timeNote = r.isNew ? ` · ${fmtTime(leg.t)}, новий рекорд!` : ` · ${fmtTime(leg.t)} (рекорд ${fmtTime(r.best)})`;
      if (r.counted && r.isNew) { saveGhost(legKey(other, trip.target), recorder.finish(leg.t, sim.pos.x, sim.pos.z, sim.yaw())); ghost.key = ''; }
    }
    leg.valid = false;
    flash(`Прибув на ${trip.target.name}${timeNote}. Наступна ціль: ${other.name}`);
    if (audio) { audio.beep(880); setTimeout(() => audio.beep(1180), 130); audio.speak(`Прибули на базу ${trip.target.name}`); }
    trip.target = other;
  } else if (dist > ARRIVE_R * 1.6) {
    trip.docked = false;
  }

  // Beacons pulse; the one you are heading for pulses harder and brighter.
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
  for (const b of beacons) {
    const isTarget = Math.abs(b.x - trip.target.x) < 1 && Math.abs(b.z - trip.target.z) < 1;
    const k = isTarget ? 0.45 + 0.55 * pulse : 0.3 + 0.2 * pulse;
    b.beacon.material.color.setRGB(0.15 * k, 0.78 * k, k).multiplyScalar(GLOW);
    b.beam.material.opacity = (isTarget ? 0.2 : 0.09) * (0.55 + 0.45 * pulse);
    b.halo.material.opacity = (isTarget ? 0.9 : 0.45) * (0.5 + 0.5 * pulse);
    b.halo.scale.setScalar(isTarget ? 0.052 + 0.022 * pulse : 0.034);
  }

  // Tail lamps: dim running light, bright under braking or reversing.
  const braking = clamp(sim.cmd.brake + (sim.cmd.throttle < -0.05 ? 0.7 : 0), 0, 1);
  vehicle.setBrake(braking);
  const lampsLit = lampLevel() >= 1;
  for (const g of tailGlows) g.material.opacity = lampsLit ? 0.35 + 0.65 * braking : 0;
  for (const l of tailLights) l.intensity = lampsLit ? 14 + 56 * braking : 0;
  for (const l of markerLights) l.intensity = lampsLit ? 14 : 0;

  tracks.update(W.map((w) => ({ x: w.sim.cx, z: w.sim.cz, contact: w.sim.contact && waterDepthAt(w.sim.cx, w.sim.cz) < 0.05 })));
  {
    W.forEach((w, i) => {
      const k = kickCtx.wheels[i];
      k.x = w.sim.cx;
      k.z = w.sim.cz;
      k.contact = w.sim.contact;
    });
    const yw = sim.yaw();
    kickCtx.fx = Math.sin(yw);
    kickCtx.fz = Math.cos(yw);
    kickCtx.speed = sim.speed;
    kickCtx.throttle = sim.cmd.throttle;
    kickCtx.offroad = offroadK;
    kickup.update(dt, kickCtx);
  }
  // Grime: builds up over a few minutes of driving (faster in a dust storm), washed
  // off by rain and by fording the river. Kept across reloads.
  {
    const touching = W.length ? W.filter((w) => w.sim.contact).length / W.length : 0;
    const v = Math.min(1, Math.abs(sim.speed) / 8);
    let d = dirt.v + dt * touching * v * (1 + 2 * (weather.kind === 'dust' ? weather.w : 0)) / 220;
    if (weather.kind === 'rain') d -= dt * weather.w / 45;
    d -= dt * Math.min(1, waterDepthAt(sim.pos.x, sim.pos.z) / 0.6) / 6;
    dirt.v = clamp(d, 0, 1);
    vehicle.root.updateMatrixWorld();
    vehicle.setDirt(dirt.v, DIRT_COLOR);
    if ((dirt.saveT += dt) > 5) {
      dirt.saveT = 0;
      try { localStorage.setItem('rover.dirt', dirt.v.toFixed(3)); } catch (e) { /* storage may be blocked */ }
    }
  }

  // Loose sand: scattered by the wheels, lit by the sun or, at night, by the headlights.
  const yawNow = sim.yaw();
  {
    const gy = groundHeight(sim.pos.x, sim.pos.z);
    let touching = 0;
    for (const w of sim.wheels) if (w.contact) touching++;
    // A hovering glider's shadow fades and spreads as it climbs.
    if (SPEC.flight) touching = sim.height() < 6 ? 1 : 0;
    contactShadow.on += ((touching ? 1 : 0.25) - contactShadow.on) * (1 - Math.exp(-6 * dt));
    contactShadow.g.position.set(sim.pos.x, gy + 0.06, sim.pos.z);
    contactShadow.g.rotation.y = yawNow;
    contactShadow.g.visible = sim.upY > 0.3;
    contactShadow.mat.opacity = (0.45 + 0.4 * daylight) * contactShadow.on;
  }
  const fx = Math.sin(yawNow);
  const fz = Math.cos(yawNow);
  sandCtx.x = sim.pos.x;
  sandCtx.z = sim.pos.z;
  sandCtx.yaw = yawNow;
  sandCtx.vx = sim.vel.x;
  sandCtx.vz = sim.vel.z;
  sandCtx.wheels = sim.wheels;
  sandCtx.daylight = daylight;
  sandCtx.sunDir = sunDir;
  sandCtx.sunColor = sun.color;
  sandCtx.sunIntensity = sun.intensity;
  sandCtx.fog = scene.fog;
  sandCtx.pxPerUnit = renderer.getDrawingBufferSize(drawSize).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  sandCtx.head.on = lampLevel() >= 2;
  sandCtx.head.x = sim.pos.x + fx * (MOUNT.head.z - 0.1);
  sandCtx.head.y = sim.pos.y - 0.9;
  sandCtx.head.z = sim.pos.z + fz * (MOUNT.head.z - 0.1);
  sandCtx.head.dx = fx;
  sandCtx.head.dz = fz;
  // Tail lamps: on with any lamp mode (not just full headlights), aimed backwards
  // right along the dust trail — see dust.js's night-brightness trick.
  sandCtx.tail.on = lampLevel() >= 1;
  sandCtx.tail.x = sim.pos.x + fx * (vehicle.TAIL_LAMPS[0].z + 0.26);
  sandCtx.tail.y = sim.pos.y - 0.4;
  sandCtx.tail.z = sim.pos.z + fz * (vehicle.TAIL_LAMPS[0].z + 0.26);
  {
    // Morning mist peaks just after sunrise and is gone within the hour.
    const dawn = Math.max(0, 1 - Math.abs(timeOfDay - SUNRISE - 0.035) / 0.07);
    const air = ambient.update(dt, {
      x: sim.pos.x, z: sim.pos.z, daylight, pxScale: sandCtx.pxPerUnit, dawn,
      yaw: sim.yaw(), vx: sim.vel.x, vz: sim.vel.z, headOn: lampLevel() >= 2, head: sandCtx.head,
    });
    // A dust devil that crosses the rover shoves it round: a swirl plus a pull in,
    // a little of it turned into yaw so the rover gets spun, not just slid.
    if (air.push.lengthSq() > 0 && sim.wheels.some((w) => w.contact)) {
      sim.vel.x += air.push.x * dt;
      sim.vel.z += air.push.y * dt;
      sim.angVel.y += air.push.length() * 0.04 * dt;
    }
    // In a storm the lamps light the dust and rain in the air, day or night.
    beams.update(dt, lampLevel() >= 2, Math.min(1.8, Math.max(1 - daylight, stormW * 0.7) * (1 + stormW)));
  }
  landmarks.update(sim.pos.x, sim.pos.z, daylight);
  updateBases(daylight);
  npcs.update(dt, t, sim.pos, 1 - daylight);
  {
    const xe = expedition.update(dt, sim.pos.x, sim.pos.z);
    if (xe) {
      flash(xe.text);
      if (xe.lines) say(xe.lines);
      if (xe.type === 'done') {
        progress.addBonusScrap(xe.pay);
        if (audio) { audio.beep(880); setTimeout(() => audio.beep(1320), 150); }
      } else if (audio) audio.beep(1040, 0.1);
    }
  }
  {
    const ev = expedition.active ? null : jobs.update(t, dt, sim.pos.x, sim.pos.z, sim.speed);
    if (ev) {
      flash(ev.text);
      if (ev.lines) say(ev.lines);
      if (ev.type === 'done') {
        progress.addBonusScrap(ev.pay);
        if (audio) { audio.beep(880); setTimeout(() => audio.beep(1320), 150); }
      } else if (audio) {
        audio.beep(ev.type === 'offer' ? 660 : 1040, 0.1);
      }
    }
    const xh = expedition.hud(sim.pos.x, sim.pos.z);
    const jh = xh ? { title: xh.title, text: xh.text, gauge: null, clock: 'X — скасувати' } : jobs.hud();
    jobBoxEl.classList.toggle('on', !!jh);
    if (jh) {
      jobTitleEl.textContent = jh.title;
      jobStepEl.textContent = jh.text;
      jobGaugeEl.classList.toggle('on', jh.gauge !== null);
      if (jh.gauge !== null) jobBarEl.style.width = `${Math.min(100, jh.gauge * 100).toFixed(0)}%`;
      jobClockEl.textContent = jh.clock || '';
    }
  }
  {
    const ev = finds.update(t, sim.pos.x, sim.pos.z);
    if (ev) {
      flash(ev.text);
      progress.addBonusScrap(ev.pay);
      if (audio) { audio.beep(1320, 0.1); setTimeout(() => audio.beep(1760, 0.1), 120); }
    }
  }
  if (seeds) {
    const ev = seeds.update(t, sim.pos.x, sim.pos.z);
    if (ev) {
      flash(ev.text);
      if (audio) { audio.beep(ev.type === 'deliver' ? 1180 : 780); if (ev.type === 'pickup') setTimeout(() => audio.beep(1040), 110); }
      storyClock = 0; // let the radio react straight away
    }
    hudMissions.textContent = `${seeds.deliveredCount()}/${seeds.total}`;
    hudCarried.textContent = String(seeds.carriedCount());
  }
  if (PLANET === 'moon') {
    const fb = flashback.update(dt, sim.pos.x, sim.pos.z);
    if (fb && progress.finishFlashback()) {
      flash(`ГЕРМЕС-1 ЗНАЙДЕНО · +${FLASHBACK_REWARD} мотлоху`);
      if (audio) { audio.beep(880); setTimeout(() => audio.beep(1320), 150); }
      refreshChapter();
      refreshPlanets();
    }
  }

  // ---------- the job in hand ----------
  if (commsQueue.length && t > commsUntil) showNextComms();
  else if (!commsQueue.length && commsEl.classList.contains('show') && t > commsUntil) commsEl.classList.remove('show');
  storyClock -= dt;
  if (storyClock <= 0) {
    storyClock = 0.3; // objectives read live state; four times a second is plenty
    const lines = story.poll(storyCtx());
    if (lines.length) { say(lines); refreshPlanets(); }
    refreshChapter();
  }

  sand.update(dt, sandCtx);
  looseCtx.x = sim.pos.x;
  looseCtx.z = sim.pos.z;
  looseCtx.pos = sim.pos;
  looseCtx.quat = sim.quat;
  loose.update(dt, looseCtx);
  sandCtx.wind = 1 + 3 * weather.w;
  grass.update(dt, sandCtx);
  water.update(dt, sandCtx);
  splash.update(dt, sandCtx);
  dust.update(dt, sandCtx);

  if (PLANET === 'mars') {
    roadPosts.update(t, daylight, sandCtx.pxPerUnit, sim.pos);

    const missionEvent = missions.update(t, sim.pos.x, sim.pos.z);
    if (missionEvent) {
      flash(missionEvent.text);
      if (audio) { audio.beep(missionEvent.type === 'deliver' ? 1180 : 780); if (missionEvent.type === 'pickup') setTimeout(() => audio.beep(1040), 110); }
      // Opening a planet is announced by control over the radio (see story.js), so
      // all that is needed here is to let the buttons catch up.
      if (missionEvent.type === 'deliver') refreshPlanets();
    }
    hudMissions.textContent = `${missions.deliveredCount()}/${missions.total}`;
    hudCarried.textContent = String(missions.carriedCount());

    const debrisEvent = debris.update(t, sim.pos.x, sim.pos.z);
    if (debrisEvent) {
      flash(debrisEvent.text);
      if (audio) audio.beep(1400, 0.08);
    }
    hudDebris.textContent = `${debris.collectedCount()}/${debris.total}`;

    const nearWs = upgrades.nearWorkshop(sim.pos.x, sim.pos.z);
    if (nearWs !== atWorkshop) {
      atWorkshop = nearWs;
      // Pulling in opens it; driving off closes it only if it opened itself.
      if (nearWs) { toggleWorkshop(true); wsAuto = true; } else if (wsAuto) { toggleWorkshop(false); wsAuto = false; }
      refreshWorkshop();
    } else if (nearWs && wsPanel.classList.contains('show')) refreshWorkshop();
  }

  if (audio) {
    const contacts = W.length ? W.filter((w) => w.sim.contact).length / W.length : 0;
    audio.update({ speed: sim.speed, throttle: sim.cmd.throttle, contact: contacts,
      boost: sim.cmd.boost, daylight, storm: weather.w,
      ground: {
        soft: clamp(dustDepth(sim.pos.x, sim.pos.z), 0, 1),
        stones: pebbleDensity(sim.pos.x, sim.pos.z),
        road: 1 - clamp((roadDist(sim.pos.x, sim.pos.z) - ROAD_HALF * 0.5) / (ROAD_HALF * 0.5), 0, 1),
      } });
    // Knock when a wheel slams into its bump stop.
    for (const w of W) {
      const hard = w.sim.contact && w.sim.L < SUSP.Lmin + 0.04;
      if (hard && !w.thumped) audio.thump(clamp((SUSP.Lmin + 0.04 - w.sim.L) * 22, 0.3, 2));
      w.thumped = hard;
    }
  }

  hudSpeed.textContent = SPEC.flight
    ? `${(speedAbs * 3.6).toFixed(0)} км/год · ↕ ${Math.max(0, sim.height()).toFixed(0)} м`
    : `${(speedAbs * 3.6).toFixed(0)} км/год · ${SPEC.driveLabel[sim.awd ? 0 : 1]}`;
  const compassTargets = route.map((p, i) => ({
    x: p.x, z: p.z, kind: 'circle', text: String(i + 1), color: i === 0 ? '#7ce68f' : '#4fe0ff',
  }));
  if (PLANET === 'mars') {
    for (const m of missions.modules) {
      if (!m.collected) compassTargets.push({ x: m.x, z: m.z, kind: 'diamond', color: '#' + m.color.toString(16).padStart(6, '0') });
    }
  }
  if (seeds) {
    for (const p of seeds.items) {
      if (!p.collected) compassTargets.push({ x: p.x, z: p.z, kind: 'diamond', color: '#' + p.color.toString(16).padStart(6, '0') });
    }
    compassTargets.push({ x: LAB.x, z: LAB.z, kind: 'square', text: 'Л', color: '#7ce68f' });
  }
  for (const b of BASES) compassTargets.push({ x: b.x, z: b.z, kind: 'square', text: b.name[0], color: '#4fe0ff' });
  compassTargets.push(...jobs.targets(), ...expedition.targets());
  compassTargets.push(...finds.targets(sim.pos.x, sim.pos.z));
  if (TOWN) compassTargets.push({ x: TOWN.x, z: TOWN.z, kind: 'square', text: 'О', color: '#ffd08a' });
  for (const p of REAL_PLACES) compassTargets.push({ x: p.x, z: p.z, kind: 'square', text: p.letter, color: '#ffd08a' });
  for (const t of compassTargets) {
    t.bearing = compassBearing(t.x - sim.pos.x, t.z - sim.pos.z);
    t.dist = Math.hypot(t.x - sim.pos.x, t.z - sim.pos.z);
  }
  for (const p of REAL_PLACES) {
    if (!p.seen && Math.hypot(p.x - sim.pos.x, p.z - sim.pos.z) < 500) {
      p.seen = true;
      say([['ОРІОН · геолог', `${p.name}. ${p.blurb}`]]);
    }
  }
  drawCompass(sim.yaw(), compassTargets);
  minimap.setDynamic([...jobs.targets(), ...expedition.targets()]);
  stepExplored(t);
  if (!map3dEl.classList.contains('hidden')) minimap.update(sim, dt);
  sunShadows.update();
  if ((tagClock += dt) > 0.5) { tagClock = 0; tagLayers(scene); }
  post.update(daylight);
  updateShafts();
  post.render();

  const now = performance.now();
  const rawMs = now - dbgLast;
  dbgLast = now;
  msEma += (rawMs - msEma) * 0.08;
  fpsEma += (1000 / Math.max(rawMs, 1) - fpsEma) * 0.08;
  if (t > dbgAt) {
    dbgAt = t + 0.3;
    dbgFpsEl.textContent = `${Math.round(fpsEma)} FPS${sim.engine === 'rapier' ? ' · Rapier' : ''}`;
    dbgMsEl.textContent = `· ${msEma.toFixed(1)} мс/кадр`;
  }

  requestAnimationFrame(frame);
}

// Built last, once everything that lives in the scene has been added, so the
// cascaded sun can patch every lit material up front (see sunshadow.js).
const sunShadows = createSunShadows(scene, camera, sun, { far: 900 });
const post = createPost(renderer, scene, camera);
tagLayers(scene);
let tagClock = 0;
post.setSize(window.innerWidth, window.innerHeight);
const btnPost = document.getElementById('postToggle');
btnPost.addEventListener('click', () => {
  post.setEnabled(!post.enabled);
  btnPost.textContent = `Постобробка: ${post.enabled ? 'увімк' : 'вимк'}`;
  btnPost.classList.toggle('on', post.enabled);
});

function resizeView() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
  sunShadows.setSize();
}
window.addEventListener('resize', resizeView);

const scaleInput = document.getElementById('renderScale');
const scaleLabel = document.getElementById('renderScaleV');
scaleInput.value = renderScale;
scaleLabel.textContent = `${renderScale}×`;
scaleInput.addEventListener('input', () => {
  renderScale = parseFloat(scaleInput.value);
  scaleLabel.textContent = `${renderScale}×`;
  try { localStorage.setItem(RENDER_SCALE_KEY, String(renderScale)); } catch (e) { /* storage may be blocked */ }
  renderer.setPixelRatio(renderScale);
  resizeView();
});

// ---------- graphics presets ----------
// One click sets the whole graphics tab: resolution, view distance, shadows and the
// post effects. The individual controls still work afterwards; the choice is kept.
const GFX_PRESETS = {
  low: { scale: 0.75, view: 70, shadows: false, ao: false, bloom: false, shafts: false, grain: false },
  medium: { scale: 1, view: 90, shadows: true, ao: false, bloom: true, shafts: true, grain: false },
  high: { scale: 1, view: 100, shadows: true, ao: true, bloom: true, shafts: true, grain: true },
  ultra: { scale: 1.25, view: 140, shadows: true, ao: true, bloom: true, shafts: true, grain: true },
};
const presetBtns = [...document.querySelectorAll('#gfxPresets button')];
function applyPreset(id) {
  const p = GFX_PRESETS[id];
  if (!p) return;
  scaleInput.value = p.scale;
  scaleInput.dispatchEvent(new Event('input'));
  const view = document.getElementById('viewDist');
  view.value = p.view;
  view.dispatchEvent(new Event('input'));
  if (renderer.shadowMap.enabled !== p.shadows) btnShadows.click();
  if (!post.enabled) btnPost.click();
  Object.assign(post.settings, { ao: p.ao, bloom: p.bloom, shafts: p.shafts, grain: p.grain });
  for (const b of presetBtns) b.classList.toggle('on', b.dataset.preset === id);
  try { localStorage.setItem('rover.gfx', id); } catch (e) { /* storage may be blocked */ }
}
for (const b of presetBtns) b.addEventListener('click', () => applyPreset(b.dataset.preset));
try {
  const saved = localStorage.getItem('rover.gfx');
  if (saved) applyPreset(saved);
  else presetBtns.find((b) => b.dataset.preset === 'high')?.classList.add('on');
} catch (e) { /* storage may be blocked */ }

// debug hook: inspect state and scrub the sol from the console
window.game = { righting, expedition, finds, garage, loose, kickup, applyPreset, dirt, tracks, weather, contactShadow, vehicle, landmarks, jobs, npcs, roadPosts, missions, debris, upgrades, dust, sonar, get sonarScan() { return sonarScan; }, sim, camera, controls, power, renderer, scene, terrain, post, sunShadows, ambient, route, minimap, auto, sand, grass, water, splash, setTime: (t) => { timeOfDay = t % 1; }, get timeOfDay() { return timeOfDay; } };
document.getElementById('loading').classList.add('hidden');
frame();
