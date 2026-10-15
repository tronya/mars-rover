import * as THREE from 'three';
import { CHASSIS_LIST, chassisKit } from './chassis.js';
import { vehicleKit } from './vehicle.js';
import { VEHICLE_PRICES } from './upgrades.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The garage: one vehicle at a time on a round patch of Martian ground, standing
// three-quarters on under a low warm sun, turning slowly (drag to turn it yourself).
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
  // The vehicle never moves: the ground runs under it, like a treadmill. A patch of
  // rolling ground with stones, scrolled toward the camera's far side at walking
  // pace; wheels turn to match, each corner's suspension follows the bumps under it,
  // and the rear tyres kick up dust. `world` turns as one when you drag.
  const SPEED = 2.6; // m/s
  const SIZE = 36;
  const world = new THREE.Group();
  scene.add(world);
  // Rolling ground with a few sharper bumps; Z runs along the route, so the shapes
  // stay put on the ground while it scrolls.
  const H = (x, Z) =>
    0.34 * Math.sin(Z * 0.21 + 1.3 * Math.sin(x * 0.13)) +
    0.2 * Math.sin(Z * 0.47 + x * 0.31) +
    0.11 * Math.sin(x * 0.6 - Z * 0.33) +
    0.05 * Math.sin(Z * 1.7 + x * 1.1);
  const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, 96, 96).rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  const baseXZ = Float32Array.from({ length: gp.count * 2 }, (_, i) => (i % 2 ? gp.getZ(i >> 1) : gp.getX(i >> 1)));
  const groundTex = groundTexture(new URL('../textures/red_laterite_soil_stones_diff.jpg', import.meta.url).href);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ map: groundTex, color: 0xd08a62, roughness: 1, alphaMap: edgeTexture(), transparent: true })
  );
  ground.receiveShadow = true;
  world.add(ground);
  let travel = 0;
  function moveGround() {
    for (let i = 0; i < gp.count; i++) gp.setY(i, H(baseXZ[i * 2], baseXZ[i * 2 + 1] + travel));
    gp.needsUpdate = true;
    groundGeo.computeVertexNormals();
    // The photo slides with the ground (5 repeats across SIZE metres).
    groundTex.offset.y = (-travel / SIZE) * 5;
  }

  // Stones beside the track, recycled from behind to ahead.
  const stoneGeo = (() => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const h = Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7) * 43758.5;
      const k = 0.7 + 0.45 * (h - Math.floor(h));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  const STONES = 46;
  const stones = new THREE.InstancedMesh(stoneGeo, new THREE.MeshStandardMaterial({ color: 0x8a5a40, roughness: 0.95, flatShading: true }), STONES);
  stones.castShadow = true;
  stones.receiveShadow = true;
  world.add(stones);
  const stoneAt = [];
  // A third of them lie in the wheel tracks — small enough to roll over — the rest
  // beside the route, any size.
  const placeStone = (st, ahead) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    const inTrack = Math.random() < 0.35;
    st.x = side * (inTrack ? 0.8 + Math.random() * 3.2 : 4.5 + Math.random() * 12);
    st.Z = travel + (ahead ? SIZE / 2 + Math.random() * 6 : (Math.random() - 0.5) * SIZE);
    st.s = inTrack ? 0.14 + Math.random() * 0.22 : 0.12 + Math.pow(Math.random(), 2.4) * 0.7;
    st.r = Math.random() * 6;
  };
  // What a tyre at (x, Z) rests on: the ground, or the top of a stone under it. The
  // stone is treated as a low dome (it is squashed to 0.7 of its width) and the tyre
  // meets its flank before its peak, so the wheel climbs it rather than jumping.
  const groundUnder = (x, Z, halfW, R) => {
    let g = H(x, Z);
    for (const st of stoneAt) {
      const dx = Math.max(0, Math.abs(st.x - x) - halfW);
      // A round tyre touches a stone ahead of it before rolling on top: its reach is
      // the chord of the tyre at the stone's height.
      const top = st.s * 0.95;
      const reach = Math.sqrt(Math.max(0, 2 * R * top - top * top)) * 0.8;
      const dz = Math.max(0, Math.abs(st.Z - Z) - reach);
      const r = st.s * 1.1;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      g = Math.max(g, H(st.x, st.Z) + st.s * 0.25 + st.s * 0.7 * Math.sqrt(1 - d2 / (r * r)));
    }
    return g;
  };
  for (let i = 0; i < STONES; i++) { const st = {}; placeStone(st, false); stoneAt.push(st); }
  const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), sv = new THREE.Vector3(), ss = new THREE.Vector3(), se = new THREE.Euler();
  function moveStones() {
    stoneAt.forEach((st, i) => {
      if (st.Z - travel < -SIZE / 2 - 2) placeStone(st, true);
      const z = st.Z - travel;
      sv.set(st.x, H(st.x, st.Z) + st.s * 0.25, z);
      sq.setFromEuler(se.set(0, st.r, 0));
      stones.setMatrixAt(i, sm.compose(sv, sq, ss.setScalar(st.s)));
    });
    stones.instanceMatrix.needsUpdate = true;
  }

  // Dust: soft sprites thrown up behind the rear wheels, left behind by the ground.
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
    world.add(sp);
    return { sp, life: 0, max: 1, vx: 0, vy: 0, vz: 0 };
  });
  let dustNext = 0;
  function puff(x, y, z, strong) {
    const d = dust[dustNext];
    dustNext = (dustNext + 1) % DUST;
    d.sp.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.2, z);
    d.vx = (Math.random() - 0.5) * 0.6;
    d.vy = 0.25 + Math.random() * 0.4;
    d.vz = -SPEED * (0.55 + Math.random() * 0.25) - (strong ? 0.6 : 0);
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

  const built = {};
  let showing = null;
  function show(id) {
    if (showing) world.remove(built[showing].root);
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
        y: null, pitch: 0, roll: 0,
        L: chassisKit(id).WHEEL_DEFS.map(() => kit.SUSP.Lstatic),
      };
    }
    world.add(built[id].root);
    showing = id;
    fitCamera();
  }

  // Sit the vehicle on the ground under its wheels: body height, pitch and roll from
  // a plane through the four (six, eight) contact points, then each corner's
  // suspension takes up what the plane does not.
  let dustAcc = 0;
  function drive(dt) {
    const b = built[showing];
    const { root, v, kit, defs } = b;
    const k = 1 - Math.exp(-dt * 8);
    if (b.flight) {
      let g = 0;
      for (const [x, z] of [[-1.5, -2], [1.5, -2], [-1.5, 2], [1.5, 2]]) g += H(x, z + travel) / 4;
      const y = g + 2.1 + Math.sin(performance.now() / 700) * 0.08;
      b.y = b.y === null ? y : b.y + (y - b.y) * k * 0.5;
      root.position.y = b.y;
      root.rotation.x = Math.sin(performance.now() / 1300) * 0.03 - 0.04;
      dustAcc += dt * 18;
      while (dustAcc > 1) { dustAcc--; puff((Math.random() - 0.5) * 3, g, (Math.random() - 0.5) * 3, true); }
      return;
    }
    let n = 0, sz = 0, sx = 0, szz = 0, sxx = 0, sg = 0, szg = 0, sxg = 0;
    const gs = defs.map((d) => {
      const g = groundUnder(d.x, d.z + travel, 0.35 * d.R * (d.wk || 1), d.R) + d.R;
      n++; sx += d.x; sz += d.z; sxx += d.x * d.x; szz += d.z * d.z; sg += g; szg += d.z * g; sxg += d.x * g;
      return g;
    });
    // Least squares (independent in x and z: the wheel layout is symmetric).
    const mx = sx / n, mz = sz / n, mg = sg / n;
    const slopeZ = (szg / n - mz * mg) / Math.max(1e-6, szz / n - mz * mz);
    const slopeX = (sxg / n - mx * mg) / Math.max(1e-6, sxx / n - mx * mx);
    const y = mg + kit.SUSP.Lstatic;
    if (b.y === null) b.y = y;
    b.y += (y - b.y) * k;
    b.pitch += (-Math.atan(slopeZ) - b.pitch) * k;
    b.roll += (Math.atan(slopeX) - b.roll) * k;
    root.position.y = b.y;
    root.rotation.set(b.pitch, 0, b.roll);
    defs.forEach((d, i) => {
      const plane = b.y - Math.tan(b.pitch) * d.z + Math.tan(b.roll) * d.x + d.my;
      const L = Math.min(kit.SUSP.Lmax, Math.max(kit.SUSP.Lmin, plane - gs[i]));
      b.L[i] += (L - b.L[i]) * Math.min(1, k * 2);
      v.setSuspension(i, b.L[i]);
      v.wheels[i].spin.rotation.x += (SPEED / d.R) * dt;
    });
    // Dust from the rear axle.
    dustAcc += dt * 22;
    while (dustAcc > 1) {
      dustAcc--;
      const rear = defs.filter((d) => d.axle === defs[defs.length - 1].axle);
      const d = rear[Math.floor(Math.random() * rear.length)];
      puff(d.x, gs[defs.indexOf(d)] - d.R, d.z - d.R * 0.6, false);
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
    get debug() { return { dust, world, built, showing }; },
    open(after) {
      onClose = after || null;
      api.isOpen = true;
      el.classList.remove('hidden');
      index = Math.max(0, ORDER.indexOf(current));
      refresh();
    },
    close() {
      api.isOpen = false;
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
      travel += SPEED * dt;
      moveGround();
      moveStones();
      drive(dt);
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
