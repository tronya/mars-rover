import * as THREE from 'three';
import { lamp } from './glow.js';
import { PLANET } from './planet.js';
import { getLandmarks, groundHeight, BASES, LAB } from './terrain.js';

// Side jobs: small errands handed out over the radio, each built around one of the
// landmarks scattered across the planet (landmarks.js). A greenhouse wants its crop
// hauled in, a depot's spares are needed at a drill, somebody at a hut is hurt and
// has to be driven to the lab, an antenna wants fixing. One job at a time; finishing
// it pays мотлох and the next one comes in a little later. They run alongside the
// story and never block it.
//
// A job is a short chain of steps:
//   collect  — pick up every crate in `items` (drive within PICK_R of each)
//   board    — stop by the door until someone climbs in (hold still for `secs`)
//   hold     — stay within HOLD_R of a spot for `secs` (repair, scan)
//   deliver  — reach the destination

const PICK_R = 6;
const HOLD_R = 16;
const STILL = 1.5; // m/s, slow enough to count as stopped
const COOLDOWN = 9; // s between one job ending and the next being offered

// Call signs, so the radio can say which of a dozen greenhouses it means.
const GREEK = ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Епсилон', 'Зета', 'Ета', 'Тета', 'Йота', 'Каппа', 'Лямбда', 'Сигма', 'Омега'];
const callSign = (i) => `${GREEK[i % GREEK.length]}-${1 + Math.floor(i / GREEK.length)}`;

const PEOPLE = [
  { n: 'Марко', f: false }, { n: 'Ярина', f: true }, { n: 'Тарас', f: false }, { n: 'Олеся', f: true },
  { n: 'Богдан', f: false }, { n: 'Ніна', f: true }, { n: 'Остап', f: false }, { n: 'Дарина', f: true },
  { n: 'Левко', f: false }, { n: 'Соломія', f: true },
];

const DISPATCH = PLANET === 'verdanta' ? 'ЛІРА · біолабораторія' : 'ОРІОН · керівник зміни';

// Which landmark types offer which job.
const KIND_BY_TYPE = {
  geodome: 'harvest', orangery: 'harvest', depot: 'parts', miner: 'parts',
  outpost: 'rescue', hut: 'rescue', habmound: 'rescue',
  comms: 'repair', weather: 'repair', beacon: 'repair', dish: 'repair',
  wreck: 'salvage', pod: 'salvage', roverwreck: 'salvage', lander: 'salvage',
  ring: 'survey', arch: 'survey', drill: 'survey', reflector: 'survey',
  settlement: 'town',
};

function pickOne(list, rand) {
  return list[Math.floor(rand() * list.length) % list.length];
}

export function createJobs() {
  // `sign` is the call sign alone, for use mid-sentence where the type name would
  // need declining («об’єкт «Сигма-3»»); `label` is the full name, for titles.
  const landmarks = getLandmarks().map((lm, i) => ({
    lm, i, sign: `«${callSign(i)}»`, label: `${lm.type.name} «${callSign(i)}»`, kind: KIND_BY_TYPE[lm.type.id],
  }));
  let seed = (Date.now() & 0xffff) + 17;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // --- 3D markers: crates, the person waiting, beams over the current target ---
  const group = new THREE.Group();
  const crateGeo = new THREE.BoxGeometry(1.1, 0.8, 1.1);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.8 });
  const bandMat = new THREE.MeshBasicMaterial({ color: lamp(0xffb347, 3) });
  const bandGeo = new THREE.BoxGeometry(1.14, 0.12, 1.14);
  const beamGeo = new THREE.CylinderGeometry(0.1, 0.1, 60, 6, 1, true);
  beamGeo.translate(0, 30, 0);
  const beamMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const targetBeam = new THREE.Mesh(beamGeo, beamMat(0xffb347));
  const destBeam = new THREE.Mesh(beamGeo, beamMat(0x4fe0ff));
  targetBeam.visible = destBeam.visible = false;
  group.add(targetBeam, destBeam);

  const person = new THREE.Group();
  {
    const suit = new THREE.MeshStandardMaterial({ color: 0xd8662a, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.8, 6, 10), suit);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.3, metalness: 0.2 }));
    head.position.y = 1.75;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, Math.PI / 2 - 0.9, 1.8, 0.9, 1.0), new THREE.MeshStandardMaterial({ color: 0xc98a2e, metalness: 0.9, roughness: 0.15 }));
    visor.position.set(0, 1.76, 0.1);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.6, 4, 6), suit);
    arm.position.set(0.38, 1.6, 0);
    arm.rotation.z = -0.5;
    const flare = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: lamp(0xff3a2a, 5) }));
    flare.position.set(0.62, 2.0, 0);
    person.add(body, head, visor, arm, flare);
    person.userData = { arm, flare };
  }
  person.visible = false;
  group.add(person);

  const crates = [];
  function crateMesh() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(crateGeo, crateMat);
    c.position.y = 0.4;
    c.castShadow = true;
    const b = new THREE.Mesh(bandGeo, bandMat);
    b.position.y = 0.45;
    g.add(c, b);
    group.add(g);
    return g;
  }

  // --- destinations ---
  function nearestDepotFor(x, z) {
    if (PLANET === 'verdanta') return { x: LAB.x, z: LAB.z, r: 30, label: 'лабораторії біля АЛЬФИ' };
    let best = BASES[0];
    for (const b of BASES) if (Math.hypot(b.x - x, b.z - z) < Math.hypot(best.x - x, best.z - z)) best = b;
    return { x: best.x, z: best.z, r: 60, label: `бази ${best.name}` };
  }
  const groundAt = (x, z) => groundHeight(x, z);
  function around(lm, k, n, frac = 0.85) {
    const a0 = rand() * Math.PI * 2;
    const a = a0 + (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const r = lm.r * frac;
    return { x: lm.x + Math.cos(a) * r, z: lm.z + Math.sin(a) * r };
  }

  // --- building a job ---
  let lastKind = null;
  function makeJob(rx, rz, avoid) {
    const pool = landmarks.filter((L) => L.kind && L !== avoid);
    if (!pool.length) return null;
    const near = pool.filter((L) => {
      const d = Math.hypot(L.lm.x - rx, L.lm.z - rz);
      return d > 250 && d < 2400;
    });
    // Pick the kind of job first (never the same twice running), then a site for
    // it — picking a site first made whatever building is most common dominate.
    const from = near.length ? near : pool;
    const kinds = [...new Set(from.map((L) => L.kind))];
    const fresh = kinds.filter((k) => k !== lastKind);
    const kind = pickOne(fresh.length ? fresh : kinds, rand);
    lastKind = kind;
    const L = pickOne(from.filter((c) => c.kind === kind), rand);
    const lm = L.lm;
    const home = nearestDepotFor(lm.x, lm.z);
    const job = buildFor(L, lm, home, rx, rz);
    if (job) job.site = L;
    return job;
  }

  function buildFor(L, lm, home, rx, rz) {
    const dist = Math.hypot(lm.x - rx, lm.z - rz) + Math.hypot(home.x - lm.x, home.z - lm.z);
    const pay = Math.round(4 + dist / 450);
    const npc = pickOne(PEOPLE, rand);
    const who = npc.n;

    switch (L.kind) {
      case 'harvest':
        return {
          title: `Врожай: ${L.label}`,
          brief: [[DISPATCH, `${L.label}: зібрали врожай, три ящики стоять біля входу. Підбери всі й відвези до ${home.label}.`]],
          steps: [
            { type: 'collect', text: 'зібрати ящики', items: [0, 1, 2].map((k) => around(lm, k, 3)) },
            { type: 'deliver', text: `доставити до ${home.label}`, at: home },
          ],
          pay, done: [[DISPATCH, 'Ящики прийнято. Свіжа зелень на Марсі — хтось сьогодні їсть не з тюбика.']],
        };
      case 'parts': {
        const drills = landmarks.filter((D) => D.lm.type.id === 'drill' || D.lm.type.id === 'comms' || D.lm.type.id === 'weather' || D.lm.type.id === 'dish');
        const D = drills.length ? drills.reduce((b, c) => (Math.hypot(c.lm.x - lm.x, c.lm.z - lm.z) < Math.hypot(b.lm.x - lm.x, b.lm.z - lm.z) ? c : b)) : null;
        const to = D ? { x: D.lm.x, z: D.lm.z, r: D.lm.r + 10, label: `об’єкта ${D.sign}`, name: D.label } : { ...home, name: home.label };
        return {
          title: `Запчастини: ${L.label}`,
          brief: [[DISPATCH, `${to.name}: стала техніка. Запчастини є на складі — ${L.label}. Забери два ящики й довези до ${to.label}.`]],
          steps: [
            { type: 'collect', text: 'забрати запчастини', items: [0, 1].map((k) => around(lm, k, 2)) },
            { type: 'deliver', text: `довезти до ${to.label}`, at: to },
          ],
          pay: pay + 2, done: [[DISPATCH, `${to.name} знову працює. Дякую.`]],
        };
      }
      case 'rescue': {
        const voice = `${who.toUpperCase()} · ${L.label}`;
        const why = pickOne([
          'у мене стався витік у скафандрі, кисню на годину',
          'мене придавило панеллю, нога, здається, зламана',
          'реактор модуля вимкнувся, тут холоднішає',
          'зв’язок з базою зник два дні тому, запаси закінчуються',
        ], rand);
        const limit = Math.round(dist / 9 + 90);
        const p = around(lm, 0, 1, 0.75);
        return {
          title: `Евакуація: ${who}`,
          brief: [
            [voice, `Сьомий? Це ${who}, я сховал${npc.f ? 'ася' : 'ся'} на об’єкті ${L.sign}. ${why[0].toUpperCase() + why.slice(1)}. Забери мене, будь ласка.`],
            [DISPATCH, `Чую. Сьомий, під’їдь до входу й зупинись, поки ${who} сяде. Потім до ${home.label}. Що швидше — то краще.`],
          ],
          steps: [
            { type: 'board', text: `зупинитись біля об’єкта ${L.sign}`, at: p, secs: 3, person: true },
            { type: 'deliver', text: `відвезти до ${home.label}`, at: home },
          ],
          pay: pay + 3, limit, bonus: 6,
          done: [[voice, `Дякую, Сьомий. Я вже ${npc.f ? 'думала' : 'думав'}, що ніхто не приїде.`], [DISPATCH, `${who} у безпеці. Гарна робота.`]],
        };
      }
      case 'repair':
        return {
          title: `Ремонт: ${L.label}`,
          brief: [[DISPATCH, `${L.label}: мовчить з ранку. Під’їдь і постій поруч, поки ровер прожене діагностику й перезапуск.`]],
          steps: [{ type: 'hold', text: `ремонт об’єкта ${L.sign}`, at: { x: lm.x, z: lm.z }, secs: 10 }],
          pay, done: [[DISPATCH, `${L.label}: знову на зв’язку. Сигнал чистий.`]],
        };
      case 'salvage':
        return {
          title: `Бортовий самописець: ${L.label}`,
          brief: [[DISPATCH, `${L.label}: поруч лежить бортовий самописець. Підбери і привези до ${home.label} — розберемося, що там сталося.`]],
          steps: [
            { type: 'collect', text: 'підібрати самописець', items: [around(lm, 0, 1)] },
            { type: 'deliver', text: `привезти до ${home.label}`, at: home },
          ],
          pay, done: [[DISPATCH, 'Самописець у нас. Розшифруємо — розповім.']],
        };
      case 'town': {
        // The town trades with the bases both ways: supplies out to it, people in.
        const plaza = { x: lm.x, z: lm.z, r: 26, label: 'площі поселення «Обрій»' };
        const base = BASES[Math.floor(rand() * BASES.length)];
        if (rand() < 0.5) {
          // On the base's cargo pad, which base-layout.js keeps clear of the buildings.
          const p0 = base.cargo;
          return {
            title: `Доставка в «Обрій» з бази ${base.name}`,
            brief: [[DISPATCH, `Поселенню «Обрій» бракує медикаментів і фільтрів. Два ящики чекають на базі ${base.name} — забери й відвези на площу поселення.`]],
            steps: [
              { type: 'collect', text: `забрати ящики на базі ${base.name}`, items: [p0, { x: p0.x + 5, z: p0.z - 4 }] },
              { type: 'deliver', text: 'відвезти на площу «Обрію»', at: plaza },
            ],
            pay: pay + 3, done: [[`${who.toUpperCase()} · поселення «Обрій»`, 'Ящики тут! Діти вже розпаковують фільтри. Дякуємо, Сьомий.']],
          };
        }
        const home = { x: base.x, z: base.z, r: 60, label: `бази ${base.name}` };
        return {
          title: `Колоніст з «Обрію»: ${who}`,
          brief: [
            [`${who.toUpperCase()} · поселення «Обрій»`, `Сьомий, це ${who} з «Обрію». Мене перевели на базу ${base.name}, а транспорт зламався. Підкинеш?`],
            [DISPATCH, 'Бери. Площа поселення, біля щогли.'],
          ],
          steps: [
            { type: 'board', text: 'зупинитись на площі «Обрію»', at: { x: lm.x + 9 * lm.sin, z: lm.z + 9 * lm.cos }, secs: 3, person: true },
            { type: 'deliver', text: `відвезти до ${home.label}`, at: home },
          ],
          pay: pay + 2, done: [[`${who.toUpperCase()} · поселення «Обрій»`, `Дякую! ${npc.f ? 'Сама я б ішла' : 'Сам я б ішов'} пішки до вечора.`]],
        };
      }
      default: // survey
        return {
          title: `Сканування: ${L.label}`,
          brief: [[DISPATCH, `${L.label}: потрібні свіжі скани. Під’їдь ближче й тримайся поруч, поки лідар не закінчить коло.`]],
          steps: [{ type: 'hold', text: `сканування об’єкта ${L.sign}`, at: { x: lm.x, z: lm.z }, secs: 8 }],
          pay: Math.max(3, pay - 1), done: [[DISPATCH, 'Скани отримали. Красиво вийшло.']],
        };
    }
  }

  let job = null;
  let src = null; // landmark of the current job, so the next one picks another
  let cooldown = 14;
  let completed = 0;

  function clearMarkers() {
    for (const c of crates) group.remove(c);
    crates.length = 0;
    person.visible = false;
    targetBeam.visible = destBeam.visible = false;
  }

  function enterStep() {
    clearMarkers();
    const s = job.steps[job.step];
    s.t = 0;
    if (s.type === 'collect') {
      s.left = s.items.length;
      for (const it of s.items) {
        const m = crateMesh();
        m.position.set(it.x, groundAt(it.x, it.z), it.z);
        m.rotation.y = rand() * Math.PI;
        it.mesh = m;
        it.got = false;
        crates.push(m);
      }
      const c = s.items[0];
      targetBeam.position.set(c.x, groundAt(c.x, c.z), c.z);
      targetBeam.visible = true;
    } else if (s.type === 'deliver') {
      destBeam.position.set(s.at.x, groundAt(s.at.x, s.at.z), s.at.z);
      destBeam.visible = true;
    } else {
      targetBeam.position.set(s.at.x, groundAt(s.at.x, s.at.z), s.at.z);
      targetBeam.visible = true;
      if (s.person) {
        person.position.set(s.at.x, groundAt(s.at.x, s.at.z), s.at.z);
        person.visible = true;
      }
    }
  }

  function start(x, z) {
    job = makeJob(x, z, src);
    if (!job) return null;
    src = job.site;
    job.step = 0;
    job.elapsed = 0;
    enterStep();
    return { type: 'offer', lines: job.brief, text: `Нове доручення: ${job.title}` };
  }

  function finish() {
    const late = job.limit && job.elapsed > job.limit;
    const pay = job.pay + (job.limit && !late ? job.bonus : 0);
    const lines = job.done;
    const title = job.title;
    clearMarkers();
    job = null;
    cooldown = COOLDOWN;
    completed++;
    return { type: 'done', pay, lines, text: `Доручення виконано: ${title} · +${pay} мотлоху${late ? '' : ''}` };
  }

  return {
    group,
    get active() { return job; },
    get completed() { return completed; },
    // Decline the current job; a different one is offered shortly.
    skip() {
      if (!job) return null;
      const title = job.title;
      clearMarkers();
      job = null;
      cooldown = 4;
      return { type: 'skip', text: `Доручення скасовано: ${title}` };
    },
    // Per frame. Returns an event ({type, text, lines?, pay?}) when something happens.
    update(t, dt, x, z, speed) {
      person.userData.arm.rotation.z = -0.5 - 0.5 * Math.max(0, Math.sin(t * 6));
      person.userData.flare.visible = Math.sin(t * 8) > -0.2;
      for (const c of crates) c.children[1].visible = Math.sin(t * 4 + c.position.x) > -0.4;
      if (!job) {
        cooldown -= dt;
        return cooldown <= 0 ? start(x, z) : null;
      }
      job.elapsed += dt;
      const s = job.steps[job.step];
      let advance = false;
      let ev = null;
      if (s.type === 'collect') {
        for (const it of s.items) {
          if (it.got || Math.hypot(x - it.x, z - it.z) > PICK_R) continue;
          it.got = true;
          group.remove(it.mesh);
          s.left--;
          ev = { type: 'pick', text: s.left ? `Вантаж на борту · лишилось ${s.left}` : 'Увесь вантаж на борту' };
        }
        const next = s.items.find((it) => !it.got);
        if (next) targetBeam.position.set(next.x, groundAt(next.x, next.z), next.z);
        advance = s.left === 0;
      } else if (s.type === 'deliver') {
        advance = Math.hypot(x - s.at.x, z - s.at.z) < s.at.r;
      } else {
        const r = s.type === 'board' ? 9 : HOLD_R;
        const inside = Math.hypot(x - s.at.x, z - s.at.z) < r;
        if (inside && Math.abs(speed) < STILL) s.t += dt;
        else if (!inside) s.t = Math.max(0, s.t - dt * 0.5);
        advance = s.t >= s.secs;
        if (advance && s.person) ev = { type: 'pick', text: `${job.title.split(': ')[1] || 'Пасажир'} на борту` };
      }
      if (advance) {
        job.step++;
        if (job.step >= job.steps.length) return finish();
        enterStep();
      }
      return ev;
    },
    // HUD: the job's title, the current step and a 0..1 gauge (hold progress, or the
    // rescue clock running down), or null with no job.
    hud() {
      if (!job) return null;
      const s = job.steps[job.step];
      let text = s.text;
      let gauge = null;
      if (s.type === 'collect') text += ` ${s.items.length - s.left}/${s.items.length}`;
      if (s.type === 'hold' || s.type === 'board') gauge = s.t / s.secs;
      let clock = null;
      if (job.limit) {
        const left = Math.max(0, job.limit - job.elapsed);
        clock = left > 0 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} до бонусу` : 'бонус втрачено';
      }
      return { title: job.title, text, gauge, clock };
    },
    // Where to steer: the next crate, the hold spot, or the destination.
    targets() {
      if (!job) return [];
      const s = job.steps[job.step];
      if (s.type === 'collect') return s.items.filter((it) => !it.got).map((it) => ({ x: it.x, z: it.z, kind: 'circle', text: '!', color: '#ffb347' }));
      if (s.type === 'deliver') return [{ x: s.at.x, z: s.at.z, kind: 'circle', text: '↓', color: '#4fe0ff' }];
      return [{ x: s.at.x, z: s.at.z, kind: 'circle', text: s.type === 'board' ? '+' : '⚙', color: '#ffb347' }];
    },
  };
}
