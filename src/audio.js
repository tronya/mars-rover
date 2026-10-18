import { CHASSIS } from './chassis.js';

// Everything here is synthesised — no audio files. Mars has a thin, cold atmosphere,
// so the mix is deliberately sparse: a low wind bed, an electric drivetrain, grit
// under the tyres and the odd structural knock.
//
// It used to be built from raw square, triangle and saw oscillators, which is exactly
// the palette of an 8-bit console — the rover sounded like a chiptune. Nothing below
// uses a bare geometric wave any more: tones are soft custom spectra that beat
// against a detuned twin, textures are filtered noise, and one-shots have real
// envelopes and a touch of cabin reverb.

// Brown-ish noise: heavier at the bottom, which reads as wind and rumble, not hiss.
function brownNoise(ctx, seconds = 4) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + Math.random() * 2 - 1) * 0.5;
    d[i] = last;
  }
  return buf;
}

// Pink noise (Paul Kellet's filter): even energy per octave, the natural texture of
// tyre roar and air.
function pinkNoise(ctx, seconds = 4) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

// Gravel: sparse little clicks of random size, each a few milliseconds long — the
// sound of individual stones popping out from under a tyre, not a steady hiss.
function crackleBuffer(ctx, seconds = 3) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const sr = ctx.sampleRate;
  for (let i = 0; i < d.length; i++) {
    if (Math.random() > 0.0016) continue;
    const amp = Math.pow(Math.random(), 2.2) * (Math.random() < 0.5 ? -1 : 1);
    const len = Math.floor(sr * (0.0015 + Math.random() * 0.006));
    for (let k = 0; k < len && i + k < d.length; k++) {
      d[i + k] += amp * Math.exp((-6 * k) / len) * (Math.random() * 2 - 1);
    }
  }
  return buf;
}

// A short, dark room: the cab. Decaying stereo noise used as a convolution response.
function cabinImpulse(ctx, seconds = 0.7) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

// Motor pitch and body per chassis: the 8×8's big motors sit low, the speedster's
// small high-revving ones well up.
const MOTOR = {
  truck: { base: 70, perMs: 18 },
  crawler: { base: 55, perMs: 16 },
  hauler: { base: 42, perMs: 13 },
  galatea: { base: 50, perMs: 14 },
  glider: { base: 120, perMs: 10 },
  buggy: { base: 75, perMs: 20 },
  speedster: { base: 95, perMs: 24 },
}[CHASSIS] || { base: 70, perMs: 18 };

export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();

  // Master chain: a gentle top cut (the thin air and the cab walls take the edge off
  // everything) and a compressor that glues the layers into one mix.
  const master = ctx.createGain();
  master.gain.value = 0;
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.frequency.value = 7000;
  air.Q.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  // Trim so the whole mix lands at the old synth's loudness and the saved volume
  // sliders keep meaning what they did.
  const trim = ctx.createGain();
  trim.gain.value = 0.38;
  master.connect(trim).connect(air).connect(comp).connect(ctx.destination);

  // Separate buses so each source can be dialled in on its own. The ambient bed was
  // drowning everything, so it starts well below the rest.
  const buses = {
    ambient: ctx.createGain(),
    engine: ctx.createGain(),
    ground: ctx.createGain(),
  };
  for (const b of Object.values(buses)) b.connect(master);
  const levels = { master: 0.8, ambient: 0.1, engine: 0.7, ground: 0.1, voice: 0.85 };
  buses.ambient.gain.value = levels.ambient;
  buses.engine.gain.value = levels.engine;
  buses.ground.gain.value = levels.ground;

  // Cabin reverb, fed by a send from the one-shots.
  const reverb = ctx.createConvolver();
  reverb.buffer = cabinImpulse(ctx);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.22;
  reverb.connect(reverbGain).connect(buses.engine);

  const brown = brownNoise(ctx);
  const pink = pinkNoise(ctx);
  const crackle = crackleBuffer(ctx);

  const loop = (buffer, rate = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(0, Math.random() * buffer.duration);
    return src;
  };
  const filter = (type, freq, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const gain = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };

  // --- wind bed: two filtered noise layers that drift against each other ---
  const windGain = gain(0.35);
  windGain.connect(buses.ambient);
  const windLayers = [];
  for (const [freq, q, level, lfoRate] of [[220, 0.9, 0.5, 0.05], [620, 1.6, 0.22, 0.083]]) {
    const bp = filter('bandpass', freq, q);
    const g = gain(level);
    loop(brown).connect(bp).connect(g).connect(windGain);
    // Slow gusting.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;
    const lfoGain = gain(level * 0.6);
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    windLayers.push({ bp, g });
  }

  // --- electric drivetrain ---
  const driveGain = gain(0);
  driveGain.connect(buses.engine);
  // Motor: a soft spectrum (strong fundamental, falling harmonics, a little odd-order
  // grit) on two oscillators a few cents apart, so the tone breathes and beats like a
  // real motor instead of holding a pure chip-tune note.
  const motorWave = ctx.createPeriodicWave(
    new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    new Float32Array([0, 1, 0.42, 0.3, 0.1, 0.16, 0.05, 0.07, 0.03])
  );
  const motorTone = filter('lowpass', 900, 0.8); // opens up under load
  const motorBody = filter('peaking', 300, 1.2);
  motorBody.gain.value = 4;
  const motorGain = gain(0.14);
  motorTone.connect(motorBody).connect(motorGain).connect(driveGain);
  const motors = [0, 7].map((cents) => {
    const o = ctx.createOscillator();
    o.setPeriodicWave(motorWave);
    o.frequency.value = MOTOR.base;
    o.detune.value = cents;
    const g = gain(cents ? 0.6 : 1);
    o.connect(g).connect(motorTone);
    o.start();
    return o;
  });
  // A slow random wobble on the motor level: bearings, load, nothing is perfectly steady.
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 5.3;
  const wobbleGain = gain(0.02);
  wobble.connect(wobbleGain).connect(motorGain.gain);
  wobble.start();

  // Reduction gears: a thin whine at a non-integer multiple of the motor.
  const gear = ctx.createOscillator();
  gear.type = 'sine';
  const gearGain = gain(0);
  gear.connect(filter('bandpass', 1200, 2)).connect(gearGain).connect(driveGain);
  gear.start();

  // Inverter: the faint high switching whistle every EV makes at low speed. It holds
  // one pitch per speed band and steps up between them, like a real PWM carrier.
  const inverter = ctx.createOscillator();
  inverter.type = 'sine';
  inverter.frequency.value = 2400;
  const inverterGain = gain(0);
  inverter.connect(inverterGain).connect(driveGain);
  inverter.start();

  // Mechanical rumble: driveshafts and the chassis itself.
  const rumbleLp = filter('lowpass', 110, 0.6);
  const rumbleGain = gain(0);
  loop(brown).connect(rumbleLp).connect(rumbleGain).connect(driveGain);

  // --- tyres on regolith ---
  // Tread roar: pink noise in the low mids, pulsed at the rate the lugs hit the ground.
  const treadBp = filter('bandpass', 180, 0.9);
  const treadAm = gain(0.5);
  const treadGain = gain(0);
  loop(pink).connect(treadBp).connect(treadAm).connect(treadGain).connect(buses.ground);
  const lugs = ctx.createOscillator();
  lugs.type = 'sine';
  lugs.frequency.value = 10;
  const lugsDepth = gain(0.45);
  lugs.connect(lugsDepth).connect(treadAm.gain);
  lugs.start();
  // Gravel: individual stones cracking out from under the tyres.
  const gravelSrc = loop(crackle);
  const gravelHp = filter('highpass', 900, 0.5);
  const gravelTone = filter('peaking', 2600, 1);
  gravelTone.gain.value = 3;
  const gravelGain = gain(0);
  gravelSrc.connect(gravelHp).connect(gravelTone).connect(gravelGain).connect(buses.ground);
  // A soft sand hiss under it.
  const sandBp = filter('bandpass', 1400, 0.6);
  const sandGain = gain(0);
  loop(pink).connect(sandBp).connect(sandGain).connect(buses.ground);

  // --- one-shots ---
  // Suspension hitting its stop: a low body punch plus a short burst of dull noise.
  function thump(strength) {
    const t = ctx.currentTime;
    const s = Math.min(2, strength);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(70 + 20 * s, t);
    body.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(Math.min(0.5, 0.25 * s), t + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.0008, t + 0.26);
    body.connect(bg).connect(buses.ground);
    body.start(t);
    body.stop(t + 0.3);

    const src = ctx.createBufferSource();
    src.buffer = brown;
    const lp = filter('lowpass', 180 + 160 * s, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.4, 0.18 * s), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    src.connect(lp).connect(g).connect(buses.ground);
    g.connect(reverb);
    src.start(t, Math.random() * 2, 0.24);
  }

  // The solar-wing actuator: a geared DC motor — a hum that rises as it spins up,
  // the rattle of gear teeth on it, a little mechanical noise, and a latch clunk at
  // the end of travel.
  function servo(on) {
    const t = ctx.currentTime;
    const dur = 2.4;
    const hum = ctx.createOscillator();
    hum.setPeriodicWave(motorWave);
    hum.frequency.setValueAtTime(on ? 120 : 170, t);
    hum.frequency.linearRampToValueAtTime(on ? 175 : 125, t + dur);
    const teeth = ctx.createOscillator();
    teeth.type = 'sine';
    teeth.frequency.value = 38;
    const teethDepth = gain(0.35);
    const am = gain(0.6);
    teeth.connect(teethDepth).connect(am.gain);
    const lp = filter('lowpass', 1100, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.15);
    g.gain.setValueAtTime(0.05, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    hum.connect(am).connect(lp).connect(g).connect(buses.engine);

    const noise = ctx.createBufferSource();
    noise.buffer = pink;
    const nbp = filter('bandpass', 2200, 1.4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.025, t + 0.15);
    ng.gain.setValueAtTime(0.025, t + dur - 0.2);
    ng.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    noise.connect(nbp).connect(am);
    noise.connect(nbp).connect(ng).connect(buses.engine);

    hum.start(t);
    teeth.start(t);
    noise.start(t, Math.random() * 2);
    hum.stop(t + dur + 0.1);
    teeth.stop(t + dur + 0.1);
    noise.stop(t + dur + 0.1);
    setTimeout(() => thump(0.35), dur * 1000);
  }

  // Cockpit chime: two sine partials (the octave slightly stretched, like a small
  // bell) with a quick attack and a ring-out into the cab reverb.
  function beep(freq = 720, dur = 0.14) {
    const t = ctx.currentTime;
    const ring = Math.max(0.25, dur * 2.5);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.07, t + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    out.connect(buses.engine);
    out.connect(reverb);
    for (const [mul, level] of [[1, 1], [2.01, 0.28], [3.02, 0.08]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mul;
      const g = gain(level);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + ring + 0.05);
    }
  }

  let enabled = false;
  const at = (p, v, tc = 0.12) => p.setTargetAtTime(v, ctx.currentTime, tc);

  // Speech rides on the browser's own synthesiser, so it has its own level rather
  // than a Web Audio bus.
  const synth = window.speechSynthesis || null;
  let lastSpoken = 0;
  function speak(text) {
    if (!enabled || !synth || levels.voice <= 0) return;
    const now = performance.now();
    if (now - lastSpoken < 400) return;
    lastSpoken = now;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'uk-UA';
    u.volume = levels.voice * levels.master;
    u.rate = 0.98;
    u.pitch = 0.9;
    synth.speak(u);
  }

  return {
    levels,
    setLevel(name, v) {
      levels[name] = v;
      if (name === 'master') at(master.gain, enabled ? v : 0, 0.08);
      else if (buses[name]) at(buses[name].gain, v, 0.08);
    },
    speak,
    get running() {
      return enabled && ctx.state === 'running';
    },
    async toggle() {
      if (!enabled) {
        await ctx.resume();
        enabled = true;
        at(master.gain, levels.master, 0.4);
      } else {
        enabled = false;
        at(master.gain, 0, 0.2);
        if (synth) synth.cancel();
      }
      return enabled;
    },
    // speed m/s, throttle -1..1, contact 0..1, boost bool, daylight 0..1
    // ground: { soft 0..1 (dust/sand), stones 0..1 (pebbles, scree), road 0..1 (graded) }
    update({ speed, throttle, contact, boost, daylight, storm = 0, ground = { soft: 0.3, stones: 0.4, road: 0 } }) {
      if (!enabled) return;
      const v = Math.min(Math.abs(speed), 50);
      const load = Math.abs(throttle) * (boost ? 1.3 : 1);
      const f = MOTOR.base + v * MOTOR.perMs;
      for (const o of motors) at(o.frequency, f, 0.08);
      at(driveGain.gain, contact > 0 ? 0.3 + 0.7 * Math.min(1, load) : 0.08, 0.1);
      at(motorTone.frequency, 500 + 900 * Math.min(1.3, load) + v * 25, 0.1);
      at(motorGain.gain, 0.1 + 0.08 * Math.min(1.3, load), 0.1);
      at(gear.frequency, f * 3.73, 0.08);
      at(gearGain.gain, 0.012 + 0.02 * Math.min(1, load) * Math.min(1, v / 6), 0.1);
      at(inverter.frequency, v < 4 ? 2400 : v < 12 ? 3200 : 4200, 0.02);
      at(inverterGain.gain, 0.006 * Math.min(1, load) * Math.max(0, 1 - v / 20), 0.1);
      at(rumbleGain.gain, Math.min(0.5, v * 0.03), 0.15);

      // The ground changes the voice: packed road is a dull steady roar, loose dust
      // swallows the tread and hisses, stony ground cracks.
      const { soft, stones, road } = ground;
      at(treadGain.gain, contact * Math.min(0.5, v * 0.03) * (1 + 0.35 * road - 0.5 * soft), 0.1);
      at(treadBp.frequency, 140 + v * 6 - 40 * soft + 30 * road, 0.15);
      at(lugs.frequency, Math.max(2, v * 2.9), 0.1);
      at(gravelGain.gain, contact * Math.min(0.9, v * 0.07) * (0.25 + 1.1 * stones) * (1 - 0.6 * road) * (1 - 0.5 * soft), 0.1);
      at(gravelSrc.playbackRate, 0.6 + Math.min(1.6, v * 0.06), 0.2);
      at(sandGain.gain, contact * Math.min(0.12, v * 0.008) * (0.3 + 2.4 * soft) * (1 - road), 0.15);

      // Nights feel colder: the wind sits higher and thinner.
      // A storm (weather.js) roars up over everything else.
      at(windGain.gain, 0.55 + 0.3 * (1 - daylight) + v * 0.01 + storm * 1.6, 0.6);
      at(windLayers[1].bp.frequency, 520 + 260 * (1 - daylight) + storm * 700, 1.0);
    },
    thump,
    servo,
    beep,
  };
}
