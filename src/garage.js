import * as THREE from 'three';
import { CHASSIS_LIST, chassisKit } from './chassis.js';
import { vehicleKit } from './vehicle.js';
import { VEHICLE_PRICES } from './upgrades.js';
import { loadRapier, RapierVehicleSim } from './rapier-sim.js';
import { GARAGE_SPEED, LOOP, garageHeight, garageStones, garageGround, garageInput, wrapGarage, stoneGeometry } from './garage-ground.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The garage: one vehicle at a time, driving itself slowly over a round patch of
// Martian ground, seen three-quarters on under a low warm sun (drag to turn the view).
// ← → or the strip along the bottom pick another; the button below says what can be
// done with it — it's the one in the game, pick it, buy it with мотлох, or it isn't
// for sale yet. Picking one reloads the game into it, like the chassis switch always
// has, because physics.js derives its constants once at load.
//
// Its own scene and camera, drawn straight to the screen while it is open; the
// world behind is paused (main.js skips its frame).

const ORDER = ['truck', 'buggy', 'crawler', 'speedster', 'hauler', 'galatea', 'glider'];
const SPECS = Object.fromEntries(CHASSIS_LIST.map((s) => [s.id, s]));

// Bars on a 0..1 scale against the whole line-up.
function stats(spec) {
  const t = spec.terrain || { pack: 1, perM: 0.0055, offRoll: 1, offDrag: 1 };
  return {
    speed: spec.vMaxBoost * 3.6,
    range: (100 * t.pack) / t.perM / 1000,
    // Off the graded road: rolling resistance and churn (lower is better).
    offroad: spec.flight ? 1.6 : 1 / ((t.offRoll ?? 1) * Math.sqrt(t.offDrag ?? 1)),
    mass: spec.mass / 1000,
  };
}
const ALL = ORDER.map((id) => stats(SPECS[id]));
const MAX = Object.fromEntries(Object.keys(ALL[0]).map((k) => [k, Math.max(...ALL.map((s) => s[k]))]));

function groundTexture(url) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// A soft round edge, so the ground patch fades into the dark instead of ending.
function edgeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 40, 128, 128, 128);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.7, '#fff');
  g.addColorStop(1, '#000');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function createGarage({ renderer, upgrades, current, onSelect }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120c09);
  scene.fog = new THREE.Fog(0x120c09, 18, 40);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  // Something for the paint and metal to reflect — without it every metallic panel
  // renders near black. A neutral studio, dimmed so the warm sun still leads.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  scene.add(new THREE.HemisphereLight(0xffd9b8, 0x2a160c, 0.9));
  const sun = new THREE.DirectionalLight(0xffc89a, 3.2);
  sun.position.set(-8, 7, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fb0ff, 0.8);
  rim.position.set(6, 4, -8);
  scene.add(rim);

  // ---------- the drive ----------
  // The vehicle drives itself down a strip of rolling ground with stones on it
  // (garage-ground.js), under Rapier (rapier-sim.js): its own suspension takes the
  // bumps and the stones, the wheels turn with the ground, the rear tyres kick up
  // dust. Everything drawn sits in `track`, which is moved so the vehicle stays in
  // the middle of the view — the camera follows it without moving, and `world` turns
  // as one when you drag. Rapier is loaded the first time the garage opens (it is a
  // ~1.6 MB module); until then the vehicle stands still on the ground. The glider
  // has no wheels: it hovers along over the same ground, drawn as before.
  const SIZE = 36;
  const CELL = SIZE / 96;
  const world = new THREE.Group();
  scene.add(world);
  const track = new THREE.Group();
  world.add(track);
  const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, 96, 96).rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  const baseXZ = Float32Array.from({ length: gp.count * 2 }, (_, i) => (i % 2 ? gp.getZ(i >> 1) : gp.getX(i >> 1)));
  const groundTex = groundTexture(new URL('../textures/red_laterite_soil_stones_diff.jpg', import.meta.url).href);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ map: groundTex, color: 0xd08a62, roughness: 1, alphaMap: edgeTexture(), transparent: true })
  );
  ground.receiveShadow = true;
  track.add(ground);
  // The drawn patch is centred on the vehicle, moved a whole cell at a time so its
  // vertices stay put on the ground instead of swimming over it; reshaped only then.
  let gx = NaN, gz = NaN;
  function moveGround(x, z) {
    const sx = Math.round(x / CELL) * CELL, sz = Math.round(z / CELL) * CELL;
    if (sx === gx && sz === gz) return false;
    gx = sx;
    gz = sz;
    for (let i = 0; i < gp.count; i++) gp.setY(i, garageHeight(baseXZ[i * 2] + sx, baseXZ[i * 2 + 1] + sz));
    gp.needsUpdate = true;
    groundGeo.computeVertexNormals();
    ground.position.set(sx, 0, sz);
    // The photo stays on the ground as the patch moves (5 repeats across SIZE metres).
    groundTex.offset.set((sx / SIZE) * 5, (-sz / SIZE) * 5);
    return true;
  }

  // The stones the physics collides with, each drawn at its copy nearest the vehicle
  // (the strip repeats every LOOP) and hidden past the edge of the patch.
  const stoneAt = garageStones();
  const groundSrc = garageGround(stoneAt);
  const stones = new THREE.InstancedMesh(stoneGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a5a40, roughness: 0.95, flatShading: true }), stoneAt.length);
  stones.castShadow = true;
  stones.receiveShadow = true;
  track.add(stones);
  const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), sv = new THREE.Vector3(), ss = new THREE.Vector3(), se = new THREE.Euler();
  function moveStones(z0) {
    stoneAt.forEach((st, i) => {
      const z = st.z + Math.round((z0 - st.z) / LOOP) * LOOP;
      sv.set(st.x, st.y, z);
      sq.setFromEuler(se.set(0, st.r, 0));
      stones.setMatrixAt(i, sm.compose(sv, sq, ss.setScalar(Math.abs(z - z0) < SIZE / 2 + 1 ? st.s : 0)));
    });
    stones.instanceMatrix.needsUpdate = true;
  }

  // Dust: soft sprites thrown up behind the rear wheels, left behind on the ground.
  const dustTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const DUST = 70;
  const dust = Array.from({ length: DUST }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, color: 0xc89070, transparent: true, depthWrite: false, opacity: 0 }));
    sp.visible = false;
    track.add(sp);
    return { sp, life: 0, max: 1, vx: 0, vy: 0, vz: 0 };
  });
  let dustNext = 0;
  // (vx, vz): the vehicle's velocity; a puff is dragged a little way after it.
  function puff(x, y, z, vx, vz) {
    const d = dust[dustNext];
    dustNext = (dustNext + 1) % DUST;
    d.sp.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.2, z);
    const k = 0.2 + Math.random() * 0.25;
    d.vx = vx * k + (Math.random() - 0.5) * 0.6;
    d.vy = 0.25 + Math.random() * 0.4;
    d.vz = vz * k;
    d.life = 0;
    d.max = 1.8 + Math.random() * 1.4;
    d.sp.visible = true;
  }
  function moveDust(dt) {
    for (const d of dust) {
      if (!d.sp.visible) continue;
      d.life += dt;
      const t = d.life / d.max;
      if (t >= 1) { d.sp.visible = false; continue; }
      d.sp.position.x += d.vx * dt;
      d.sp.position.y += d.vy * dt;
      d.sp.position.z += d.vz * dt;
      d.vy *= 1 - dt * 0.6;
      d.sp.scale.setScalar(0.6 + t * 3.2);
      d.sp.material.opacity = 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t);
    }
  }

  // Rapier, once loaded, and the sim driving the vehicle on show (null for the
  // glider, or while Rapier is still loading).
  let RAPIER = null;
  let rapierLoad = null;
  let sim = null;
  function needRapier() {
    rapierLoad ??= loadRapier()
      .then((R) => {
        RAPIER = R;
        if (api.isOpen && showing) startDrive();
      })
      .catch((e) => console.warn('Garage: Rapier did not load; the vehicle stands still', e));
  }
  // What the view centres on: the vehicle, and the ground under it (eased, so the
  // camera does not bob with every bump the suspension is there to show).
  const focus = new THREE.Vector3();
  let glideZ = 0;

  const built = {};
  let showing = null;
  function show(id) {
    const same = id === showing;
    if (showing) track.remove(built[showing].root);
    if (!built[id]) {
      const kit = vehicleKit(id);
      const v = kit.buildVehicle();
      v.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(v.root);
      built[id] = {
        root: v.root,
        size: box.getSize(new THREE.Vector3()),
        v,
        kit,
        defs: chassisKit(id).WHEEL_DEFS,
        flight: !!SPECS[id].flight,
      };
    }
    track.add(built[id].root);
    showing = id;
    fitCamera();
    if (!same || (!sim && !built[id].flight)) startDrive();
  }

  // A fresh start at the beginning of the strip: a new Rapier world for this vehicle
  // (the last one's is freed), or — until Rapier is in — standing on its wheels.
  function startDrive() {
    if (sim) { sim.dispose(); sim = null; }
    const b = built[showing];
    for (const d of dust) d.sp.visible = false;
    glideZ = 0;
    focus.set(0, garageHeight(0, 0), 0);
    if (!b.flight && RAPIER) {
      sim = new RapierVehicleSim(RAPIER, { chassis: showing, ground: groundSrc });
      sim.reset(0, 0, 0);
    } else if (!b.flight) {
      let g = -Infinity;
      for (const d of b.defs) g = Math.max(g, groundSrc.height(d.x, d.z));
      b.root.position.set(0, g + b.kit.WHEEL_R + b.kit.SUSP.Lstatic, 0);
      b.root.rotation.set(0, 0, 0);
      b.defs.forEach((_, i) => b.v.setSuspension(i, b.kit.SUSP.Lstatic));
    }
  }

  let dustAcc = 0;
  function drive(dt) {
    const b = built[showing];
    const { root, v, kit, defs } = b;
    if (b.flight) {
      glideZ += GARAGE_SPEED * dt;
      if (glideZ > LOOP) {
        glideZ -= LOOP;
        focus.z -= LOOP;
        for (const d of dust) d.sp.position.z -= LOOP;
      }
      let g = 0;
      for (const [x, z] of [[-1.5, -2], [1.5, -2], [-1.5, 2], [1.5, 2]]) g += garageHeight(x, glideZ + z) / 4;
      const y = g + 2.1 + Math.sin(performance.now() / 700) * 0.08;
      root.position.set(0, root.position.y + (y - root.position.y) * (1 - Math.exp(-dt * 4)), glideZ);
      root.rotation.set(Math.sin(performance.now() / 1300) * 0.03 - 0.04, 0, 0);
      focus.x = 0;
      focus.z = glideZ;
      focus.y += (g - focus.y) * (1 - Math.exp(-dt * 2));
      dustAcc += dt * 18;
      while (dustAcc > 1) { dustAcc--; puff((Math.random() - 0.5) * 3, g, glideZ + (Math.random() - 0.5) * 3, 0, GARAGE_SPEED); }
      return;
    }
    if (!sim) return; // standing until Rapier is in
    sim.update(dt, garageInput(sim));
    const shift = wrapGarage(sim);
    if (shift) {
      focus.z += shift;
      for (const d of dust) d.sp.position.z += shift;
    }
    sim.origin(root.position);
    root.quaternion.copy(sim.quat);
    v.setSteer(sim.cmd.steer, sim.speed);
    sim.wheels.forEach((w, i) => {
      v.setSuspension(i, w.contact ? Math.min(kit.SUSP.Lmax, Math.max(kit.SUSP.Lmin, w.L)) : kit.SUSP.Lmax);
      v.wheels[i].spin.rotation.x += w.spinRate * dt;
    });
    focus.x = sim.pos.x;
    focus.z = sim.pos.z;
    focus.y += (garageHeight(sim.pos.x, sim.pos.z) - focus.y) * (1 - Math.exp(-dt * 2));
    // Dust from the rear axle, as much as the wheels are rolling.
    dustAcc += dt * 22 * Math.min(1, Math.abs(sim.speed) / GARAGE_SPEED);
    const rearAxle = defs[defs.length - 1].axle;
    while (dustAcc > 1) {
      dustAcc--;
      const rear = sim.wheels.filter((w) => w.axle === rearAxle && w.contact);
      if (!rear.length) break;
      const w = rear[Math.floor(Math.random() * rear.length)];
      puff(w.cx, garageHeight(w.cx, w.cz), w.cz, sim.vel.x, sim.vel.z);
    }
  }

  // Back off until the whole vehicle fits whichever way the screen is narrower.
  function fitCamera() {
    const s = built[showing].size;
    const r = s.length() / 2;
    const v = THREE.MathUtils.degToRad(camera.fov);
    const hz = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    const d = (r / Math.sin(Math.min(v, hz) / 2)) * 1.08;
    camera.position.set(d * 0.62, d * 0.3 + s.y * 0.2, d * 0.72);
    camera.lookAt(0, s.y * 0.38, 0);
  }

  // ---------- UI ----------
  const el = document.createElement('div');
  el.id = 'garage';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="gTop"><button class="gBack">← НАЗАД</button><b>ГАРАЖ</b><span class="gWallet"></span></div>
    <button class="gArrow gPrev" aria-label="Попередня">‹</button>
    <button class="gArrow gNext" aria-label="Наступна">›</button>
    <div class="gCard panel">
      <span class="gState"></span>
      <h2 class="gName"></h2>
      <p class="gBlurb"></p>
      <div class="gStats"></div>
      <button class="gAction"></button>
    </div>
    <div class="gStrip"></div>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const strip = $('.gStrip');
  const chips = ORDER.map((id) => {
    const b = document.createElement('button');
    b.addEventListener('click', () => pick(ORDER.indexOf(id)));
    strip.appendChild(b);
    return b;
  });

  let index = Math.max(0, ORDER.indexOf(current));
  function state(id) {
    if (id === current) return 'current';
    if (upgrades.ownsVehicle(id)) return 'owned';
    if (VEHICLE_PRICES[id] == null) return 'soon';
    return upgrades.canBuyVehicle(id) ? 'buy' : 'poor';
  }
  function refresh() {
    const id = ORDER[index];
    const spec = SPECS[id];
    const st = state(id);
    const price = VEHICLE_PRICES[id];
    $('.gWallet').textContent = `мотлох: ${upgrades.currency()}`;
    $('.gName').textContent = spec.name;
    $('.gBlurb').textContent = spec.blurb || '';
    $('.gState').textContent = { current: '● у грі', owned: 'у гаражі', soon: '🔒 закрито', buy: '🔒 закрито', poor: '🔒 закрито' }[st];
    const s = stats(spec);
    const bar = (label, k, val) => `<div class="gStat"><span>${label}</span><i><em style="width:${Math.round((s[k] / MAX[k]) * 100)}%"></em></i><b>${val}</b></div>`;
    $('.gStats').innerHTML =
      bar('Швидкість', 'speed', `${Math.round(s.speed)} км/год`) +
      bar('Запас ходу', 'range', `${s.range.toFixed(0)} км`) +
      bar('Прохідність', 'offroad', spec.flight ? 'летить' : '') +
      bar('Маса', 'mass', `${s.mass.toFixed(1)} т`);
    const act = $('.gAction');
    act.disabled = st === 'current' || st === 'soon' || st === 'poor';
    act.textContent = {
      current: 'ВЖЕ В ГРІ',
      owned: 'ВИБРАТИ',
      buy: `ВІДКРИТИ · ${price} мотлоху`,
      poor: `ПОТРІБНО ${price} мотлоху`,
      soon: 'СКОРО',
    }[st];
    act.dataset.state = st;
    chips.forEach((c, i) => {
      const cid = ORDER[i];
      const cs = state(cid);
      c.textContent = `${cs === 'current' || cs === 'owned' ? '' : '🔒 '}${SPECS[cid].name}`;
      c.classList.toggle('on', i === index);
      c.classList.toggle('cur', cs === 'current');
    });
    show(id);
  }
  function pick(i) {
    index = (i + ORDER.length) % ORDER.length;
    refresh();
  }
  $('.gPrev').addEventListener('click', () => pick(index - 1));
  $('.gNext').addEventListener('click', () => pick(index + 1));
  $('.gBack').addEventListener('click', () => api.close());
  $('.gAction').addEventListener('click', () => {
    const id = ORDER[index];
    const st = state(id);
    if (st === 'buy') {
      if (!confirm(`Відкрити ${SPECS[id].name} за ${VEHICLE_PRICES[id]} мотлоху?`)) return;
      upgrades.buyVehicle(id);
      refresh();
    } else if (st === 'owned') onSelect(id);
  });

  // Drag to turn the vehicle; it resumes turning on its own a few seconds later.
  const REST = -0.3; // three-quarters on, enough side-on that the dust trail shows
  let drag = null, idle = 0, spin = REST;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, .gCard')) return;
    drag = e.clientX;
    idle = 0;
  });
  window.addEventListener('pointermove', (e) => {
    if (drag === null) return;
    spin += (e.clientX - drag) * 0.008;
    drag = e.clientX;
  });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('keydown', (e) => {
    if (!api.isOpen) return;
    if (e.code === 'ArrowLeft') pick(index - 1);
    else if (e.code === 'ArrowRight') pick(index + 1);
    else if (e.code === 'Escape') api.close();
    else if (e.code === 'Enter') $('.gAction').click();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  let onClose = null;
  const api = {
    isOpen: false,
    get debug() { return { dust, world, built, showing, sim }; },
    open(after) {
      onClose = after || null;
      api.isOpen = true;
      needRapier();
      el.classList.remove('hidden');
      index = Math.max(0, ORDER.indexOf(current));
      refresh();
    },
    close() {
      api.isOpen = false;
      // Free the Rapier world while the garage is shut; opening it starts a new drive.
      if (sim) { sim.dispose(); sim = null; }
      el.classList.add('hidden');
      if (onClose) onClose();
    },
    render(dt) {
      // Drag turns the whole scene; let go and it eases back to three-quarters on.
      if (drag === null) {
        idle += dt;
        if (idle > 3) spin += (REST - spin) * (1 - Math.exp(-dt * 0.8));
      }
      world.rotation.y = spin;
      drive(dt);
      track.position.set(-focus.x, -focus.y, -focus.z);
      if (moveGround(focus.x, focus.z)) moveStones(focus.z);
      moveDust(dt);
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
      if (camera.aspect !== w / h) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        fitCamera();
      }
      // On a wide screen the card covers the right third: shift the view so the
      // vehicle stands in the middle of what is left.
      if (w > 1000) camera.setViewOffset(w, h, w * 0.14, 0, w, h);
      else camera.setViewOffset(w, h, 0, h * 0.12, w, h);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },
  };
  return api;
}
