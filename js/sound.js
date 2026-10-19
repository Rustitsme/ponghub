// Звуки табло (WebAudio, без файлов): гул зала «у-у-у», аплодисменты и свист, фейерверки, стук очка,
// напряжение на матч-пойнте, фанфары победы. Всё идёт через общий зал-реверберацию, чтобы звучало объёмно.
// Браузер не даёт играть звук без нажатия — один раз нажать по табло (кнопка «Включить звук»).
let AC = null, OUT = null, REV = null, on = false;
export const soundOn = () => on;
export function unlock() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume();
    if (!OUT) {
      OUT = AC.createDynamicsCompressor(); OUT.threshold.value = -14; OUT.ratio.value = 4; OUT.connect(AC.destination);
      // реверберация «большой зал»: затухающий шум как отклик помещения
      const len = AC.sampleRate * 2.2, ir = AC.createBuffer(2, len, AC.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      REV = AC.createConvolver(); REV.buffer = ir; const rg = AC.createGain(); rg.gain.value = .35; REV.connect(rg).connect(OUT);
    }
    on = true;
  } catch { /* без звука */ }
}
// выход: сухой сигнал + доля в зал
function bus(wet = .5) { const g = AC.createGain(), w = AC.createGain(); w.gain.value = wet; g.connect(OUT); g.connect(w).connect(REV); return g; }
function noise(sec, pink = false) {
  const b = AC.createBuffer(1, Math.max(1, AC.sampleRate * sec), AC.sampleRate), d = b.getChannelData(0); let l = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; l = pink ? (l * .97 + w * .03) : w; d[i] = pink ? l * 6 : w; }
  const s = AC.createBufferSource(); s.buffer = b; return s;
}
const env = (p, t, a, peak, d) => { p.setValueAtTime(.0001, t); p.exponentialRampToValueAtTime(peak, t + a); p.exponentialRampToValueAtTime(.0001, t + a + d); };

// гул толпы «у-у-у»: десятки голосов, каждый со своим тоном и дрожью, через гласную «у»
function roar(t, sec, vol = .5, rise = 1) {
  const out = AC.createGain(); env(out.gain, t, sec * .35, vol, sec * .65); out.connect(bus(.7));
  const f1 = AC.createBiquadFilter(), f2 = AC.createBiquadFilter(); f1.type = f2.type = 'bandpass'; f1.frequency.value = 320; f2.frequency.value = 800; f1.Q.value = f2.Q.value = 4;
  const mix = AC.createGain(); mix.gain.value = .5; mix.connect(f1).connect(out); mix.connect(f2).connect(out);
  for (let i = 0; i < 36; i++) {
    const o = AC.createOscillator(), g = AC.createGain(), lfo = AC.createOscillator(), lg = AC.createGain();
    o.type = 'sawtooth'; const f = 110 + Math.random() * 170; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (1 + .18 * rise), t + sec * .6);
    lfo.frequency.value = 4 + Math.random() * 3; lg.gain.value = f * .02; lfo.connect(lg).connect(o.frequency);
    g.gain.value = .05; const st = t + Math.random() * .4;
    o.connect(g).connect(mix); o.start(st); lfo.start(st); o.stop(t + sec + .1); lfo.stop(t + sec + .1);
  }
  const n = noise(sec, true), nf = AC.createBiquadFilter(), ng = AC.createGain(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = .7; ng.gain.value = .5; n.connect(nf).connect(ng).connect(out); n.start(t);
}
// аплодисменты: сотни коротких хлопков
function clapping(t, sec, vol = .35, rate = 40) {
  const out = bus(.5);
  for (let i = 0; i < sec * rate; i++) {
    const at = t + Math.random() * sec, fade = 1 - (at - t) / sec, c = noise(.04), f = AC.createBiquadFilter(), g = AC.createGain();
    f.type = 'bandpass'; f.frequency.value = 1000 + Math.random() * 1800; f.Q.value = 1.2; env(g.gain, at, .002, vol * (.4 + Math.random() * .6) * (.3 + fade * .7), .05);
    c.connect(f).connect(g).connect(out); c.start(at);
  }
}
// свист из зала
function whistle(t) { const o = AC.createOscillator(), g = AC.createGain(), f = 1900 + Math.random() * 700; o.type = 'sine'; o.frequency.setValueAtTime(f * .8, t); o.frequency.linearRampToValueAtTime(f, t + .15); o.frequency.setValueAtTime(f, t + .45); o.frequency.linearRampToValueAtTime(f * .7, t + .7); env(g.gain, t, .05, .06, .7); o.connect(g).connect(bus(.6)); o.start(t); o.stop(t + .9); }
// фейерверк: свист вверх → хлопок → треск
function firework(t, pan = 0) {
  const p = AC.createStereoPanner ? AC.createStereoPanner() : AC.createGain(); if (p.pan) p.pan.value = pan; p.connect(bus(.8));
  const o = AC.createOscillator(), og = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(2400, t + .7); env(og.gain, t, .1, .05, .65); o.connect(og).connect(p); o.start(t); o.stop(t + .8);
  const b = t + .75, n = noise(1.2), lp = AC.createBiquadFilter(), ng = AC.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500, b); lp.frequency.exponentialRampToValueAtTime(200, b + .8); env(ng.gain, b, .005, .9, 1); n.connect(lp).connect(ng).connect(p); n.start(b);
  const s = AC.createOscillator(), sg = AC.createGain(); s.frequency.setValueAtTime(90, b); s.frequency.exponentialRampToValueAtTime(35, b + .5); env(sg.gain, b, .005, .7, .6); s.connect(sg).connect(p); s.start(b); s.stop(b + .7);
  for (let i = 0; i < 40; i++) { const at = b + .25 + Math.random() * 1.3, c = noise(.015), hp = AC.createBiquadFilter(), cg = AC.createGain(); hp.type = 'highpass'; hp.frequency.value = 3000; env(cg.gain, at, .001, .12 + Math.random() * .2, .02); c.connect(hp).connect(cg).connect(p); c.start(at); }
}
// аккорд «медь»: пилообразные голоса через открывающийся фильтр
function brass(t, freqs, dur, vol = .12) {
  const out = bus(.45);
  for (const f of freqs) for (const det of [-6, 6]) {
    const o = AC.createOscillator(), lp = AC.createBiquadFilter(), g = AC.createGain(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2600, t + .12); lp.frequency.linearRampToValueAtTime(1400, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .04); g.gain.setValueAtTime(vol, t + dur * .7); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + .05);
  }
}
function drum(t, f = 70, vol = .9) { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(f * 2, t); o.frequency.exponentialRampToValueAtTime(f, t + .12); env(g.gain, t, .004, vol, .45); o.connect(g).connect(bus(.4)); o.start(t); o.stop(t + .6); }

const FX = {
  // имена вылетают
  whoosh() { const t = AC.currentTime, n = noise(1.1, true), f = AC.createBiquadFilter(), g = AC.createGain(); f.type = 'bandpass'; f.Q.value = 1.5; f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(3000, t + .55); f.frequency.exponentialRampToValueAtTime(500, t + 1); env(g.gain, t, .4, .7, .6); n.connect(f).connect(g).connect(bus(.6)); n.start(t); drum(t + .5, 55, 1); },
  // игроки выходят: зал гудит «у-у-у» и хлопает
  entrance() { const t = AC.currentTime; roar(t, 4.5, .55); clapping(t + .6, 4, .3); whistle(t + 1.2); whistle(t + 2.1); },
  // карточка игрока
  hit() { const t = AC.currentTime; drum(t, 60, .8); brass(t, [196, 294], .5, .07); },
  // начало игры: зал взрывается, салют
  go() { const t = AC.currentTime; brass(t, [262, 330, 392, 523], 1.2, .1); roar(t, 3, .5, 1.5); clapping(t, 3, .35); firework(t + .2, -.6); firework(t + .7, .6); },
  // очко — короткий «тук» мяча и лёгкая реакция
  point() { const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(700, t + .06); env(g.gain, t, .002, .25, .09); o.connect(g).connect(bus(.3)); o.start(t); o.stop(t + .15); clapping(t + .05, .8, .12, 25); },
  // гейм-пойнт: напряжение
  tension() { const t = AC.currentTime; roar(t, 2.2, .3, .6); for (let i = 0; i < 3; i++) drum(t + i * .28, 60, .55); },
  // матч-пойнт: барабаны и нарастание
  matchpoint() { const t = AC.currentTime; for (let i = 0; i < 12; i++) drum(t + i * (.3 - i * .015), 55 + i * 2, .4 + i * .05); const n = noise(2.6, true), f = AC.createBiquadFilter(), g = AC.createGain(); f.type = 'bandpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 2.5); env(g.gain, t, 2.3, .4, .3); n.connect(f).connect(g).connect(bus(.6)); n.start(t); roar(t + .5, 2.5, .35, 1.2); },
  // партия выиграна
  setwin() { const t = AC.currentTime; brass(t, [392, 494, 587], .8, .09); roar(t, 3, .5, 1.3); clapping(t, 3, .35); whistle(t + .5); },
  // победа: фанфары, салют, зал
  victory() { const t = AC.currentTime;
    [[392, 0, .18], [523, .18, .18], [659, .36, .18], [784, .54, .9]].forEach(([f, d, l]) => brass(t + d, [f, f / 2], l, .1));
    brass(t + 1.5, [523, 659, 784, 1047], 1.6, .09);
    roar(t + .3, 6, .6, 1.6); clapping(t + .3, 6, .4, 55); whistle(t + 1); whistle(t + 1.8); whistle(t + 2.9);
    [0, .5, 1.1, 1.6, 2.3, 3, 3.6].forEach((d, i) => firework(t + .4 + d, i % 2 ? .7 : -.7)); },
};
export function sfx(name) { if (!on || !AC) return; try { FX[name](); } catch { /* */ } }
