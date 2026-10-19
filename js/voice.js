// Озвучка табло: голос диктора (синтез речи браузера, русский) и звуки (WebAudio, без файлов).
// Браузер не даёт играть звук без нажатия — один раз нажать «Включить звук» на табло (запоминается).
let AC = null, voice = null, on = false;
const pickVoice = () => {
  const vs = speechSynthesis.getVoices().filter(v => /^ru/i.test(v.lang));
  voice = vs.find(v => /google/i.test(v.name)) || vs.find(v => /milena|yuri|irina|pavel|natural/i.test(v.name)) || vs[0] || null;
};
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export const soundOn = () => on;
export function unlock() {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch { /* без звуков */ }
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* без голоса */ }
  on = true;
}

// фраза диктора; очередь сбрасывается, если событие важнее (матч-пойнт, победа)
export function say(text, { urgent = false, rate = 1.02, pitch = .95 } = {}) {
  if (!on || !('speechSynthesis' in window)) return;
  if (urgent) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; if (voice) u.voice = voice; u.rate = rate; u.pitch = pitch; u.volume = 1;
  speechSynthesis.speak(u);
}

// ── звуки ──
function noise(sec) { const b = AC.createBuffer(1, AC.sampleRate * sec, AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = AC.createBufferSource(); s.buffer = b; return s; }
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); }
function tone(f, t, dur, type = 'triangle', vol = .18) { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); env(g, t, .02, vol, dur); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + .05); }
const SFX = {
  // пролёт имён
  whoosh() { const t = AC.currentTime, n = noise(1), f = AC.createBiquadFilter(), g = AC.createGain(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3500, t + .5); f.frequency.exponentialRampToValueAtTime(600, t + .9); env(g, t, .3, .5, .6); n.connect(f).connect(g).connect(AC.destination); n.start(t); },
  // удар перед выходом
  boom() { const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + .6); env(g, t, .01, .9, .8); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 1); },
  // очко-звоночек для важных моментов
  ding() { const t = AC.currentTime; tone(1318, t, .5, 'sine', .2); tone(1760, t + .09, .6, 'sine', .14); },
  // напряжение: дробь
  roll() { const t = AC.currentTime; for (let i = 0; i < 18; i++) { const n = noise(.06), f = AC.createBiquadFilter(), g = AC.createGain(); f.type = 'highpass'; f.frequency.value = 900; env(g, t + i * .055, .005, .15 + i * .02, .05); n.connect(f).connect(g).connect(AC.destination); n.start(t + i * .055); } },
  // фанфары победы
  fanfare() { const t = AC.currentTime; [[523, 0], [659, .14], [784, .28], [1047, .45]].forEach(([f, d]) => { tone(f, t + d, d === .45 ? 1.2 : .25, 'sawtooth', .09); tone(f / 2, t + d, d === .45 ? 1.2 : .25, 'triangle', .1); }); },
  // зал шумит и хлопает
  crowd(sec = 3) { const t = AC.currentTime, n = noise(sec), f = AC.createBiquadFilter(), g = AC.createGain(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = .5; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.22, t + .4); g.gain.linearRampToValueAtTime(0, t + sec); n.connect(f).connect(g).connect(AC.destination); n.start(t);
    for (let i = 0; i < sec * 22; i++) { const at = t + .2 + Math.random() * (sec - .6), c = noise(.03), cf = AC.createBiquadFilter(), cg = AC.createGain(); cf.type = 'bandpass'; cf.frequency.value = 1500 + Math.random() * 2000; env(cg, at, .002, .25 * Math.random() + .05, .03); c.connect(cf).connect(cg).connect(AC.destination); c.start(at); } },
};
export function sfx(name, ...a) { if (!on || !AC) return; try { SFX[name](...a); } catch { /* */ } }
