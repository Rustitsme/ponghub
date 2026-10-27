// Картинки предметов магазина и реалистичная 3D-ракетка (three.js r128, грузится по требованию).
import { BRANDS, byId, colorOf, parseKey } from './shop-catalog.js';

// ───────────── Эмблемы ─────────────
function emblem(x, bk, cx, cy, s, col) {
  const b = BRANDS[bk] || { mark: 'box', color: '#333' };
  x.save(); x.translate(cx, cy); x.fillStyle = col || b.color; x.strokeStyle = col || b.color; x.lineWidth = s * .12; x.lineCap = 'round'; x.lineJoin = 'round';
  const m = b.mark;
  if (m === 'bird') { x.beginPath(); x.moveTo(-s * .62, -s * .28); x.quadraticCurveTo(-s * .2, -s * .12, 0, s * .12); x.quadraticCurveTo(s * .2, -s * .12, s * .62, -s * .28); x.quadraticCurveTo(s * .3, s * .1, s * .08, s * .22); x.lineTo(s * .22, s * .5); x.lineTo(0, s * .32); x.lineTo(-s * .22, s * .5); x.lineTo(-s * .08, s * .22); x.quadraticCurveTo(-s * .3, s * .1, -s * .62, -s * .28); x.fill(); }
  else if (m === 'bolt') { x.beginPath(); x.moveTo(s * .12, -s * .5); x.lineTo(-s * .3, s * .06); x.lineTo(-s * .02, s * .06); x.lineTo(-s * .14, s * .5); x.lineTo(s * .3, -s * .08); x.lineTo(s * .02, -s * .08); x.closePath(); x.fill(); }
  else if (m === 'flame') { x.beginPath(); x.moveTo(0, -s * .5); x.bezierCurveTo(s * .45, -s * .1, s * .4, s * .45, 0, s * .48); x.bezierCurveTo(-s * .4, s * .45, -s * .42, s * .05, -s * .12, -s * .18); x.quadraticCurveTo(-s * .05, s * .02, s * .02, -s * .05); x.quadraticCurveTo(s * .08, -s * .25, 0, -s * .5); x.fill(); }
  else if (m === 'mountain') { x.beginPath(); x.moveTo(-s * .62, s * .38); x.lineTo(-s * .2, -s * .3); x.lineTo(0, 0); x.lineTo(s * .22, -s * .42); x.lineTo(s * .62, s * .38); x.closePath(); x.fill(); }
  else if (m === 'diamond') { x.beginPath(); x.moveTo(0, -s * .48); x.lineTo(s * .4, 0); x.lineTo(0, s * .48); x.lineTo(-s * .4, 0); x.closePath(); x.stroke(); x.beginPath(); x.moveTo(0, -s * .2); x.lineTo(s * .17, 0); x.lineTo(0, s * .2); x.lineTo(-s * .17, 0); x.closePath(); x.fill(); }
  else if (m === 'chevron') { x.beginPath(); x.moveTo(-s * .55, -s * .4); x.lineTo(0, s * .4); x.lineTo(s * .55, -s * .4); x.stroke(); x.beginPath(); x.moveTo(-s * .3, -s * .4); x.lineTo(0, s * .05); x.lineTo(s * .3, -s * .4); x.stroke(); }
  else if (m === 'stripes') { for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(i * s * .22 - s * .1, -s * .45); x.lineTo(i * s * .22 + s * .1, s * .45); x.stroke(); } }
  else if (m === 'ring') { x.beginPath(); x.arc(0, 0, s * .42, 0, 7); x.stroke(); x.beginPath(); x.arc(0, 0, s * .16, 0, 7); x.fill(); }
  else if (m === 'sun') { x.beginPath(); x.arc(0, 0, s * .3, 0, 7); x.fill(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(Math.cos(a) * s * .42, Math.sin(a) * s * .42); x.lineTo(Math.cos(a) * s * .56, Math.sin(a) * s * .56); x.stroke(); } }
  else if (m === 'stars') { for (const [dx, dy] of [[-.36, .15], [0, -.2], [.36, .15]]) star(x, dx * s, dy * s, s * .2); }
  else if (m === 'tri') { x.beginPath(); x.moveTo(0, -s * .45); x.lineTo(s * .5, s * .38); x.lineTo(-s * .5, s * .38); x.closePath(); x.stroke(); }
  else if (m === 'wave') { x.beginPath(); x.moveTo(-s * .6, 0); for (let i = 0; i <= 12; i++) x.lineTo(-s * .6 + i * s * .1, Math.sin(i / 1.9) * s * .22); x.stroke(); }
  else { x.strokeRect(-s * .45, -s * .32, s * .9, s * .64); x.font = `800 ${s * .38}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText((b.name || '').slice(0, 3), 0, s * .02); }
  x.restore();
}
function star(x, cx, cy, r) { x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); }
function rr(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
const light = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * .3 + ((n >> 8) & 255) * .59 + (n & 255) * .11) > 150; };
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const f = c => Math.max(0, Math.min(255, c + amt)); return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join(''); }

// ───────────── Картинки предметов (2D) ─────────────
function headPath2D(x, cx, cy, k, hex) {
  // та же форма головы, что и в 3D (с «плечами» у ручки)
  x.beginPath();
  if (hex) { const r = 7.4 * k; const p = [[.62, -1], [1, -.25], [.82, .78], [.18, 1.02], [-.18, 1.02], [-.82, .78], [-1, -.25], [-.62, -1]]; p.forEach(([a, b], i) => i ? x.lineTo(cx + a * r, cy + b * r) : x.moveTo(cx + a * r, cy + b * r)); x.closePath(); return; }
  const P = (a, b) => [cx + a * k, cy - b * k];
  x.moveTo(...P(1.25, -7.0));
  x.bezierCurveTo(...P(3.6, -7.5), ...P(7.0, -5.0), ...P(7.3, -2.0));
  x.bezierCurveTo(...P(7.6, 1.0), ...P(7.0, 4.4), ...P(5.2, 6.3));
  x.bezierCurveTo(...P(3.7, 7.7), ...P(1.9, 8.15), ...P(0, 8.15));
  x.bezierCurveTo(...P(-1.9, 8.15), ...P(-3.7, 7.7), ...P(-5.2, 6.3));
  x.bezierCurveTo(...P(-7.0, 4.4), ...P(-7.6, 1.0), ...P(-7.3, -2.0));
  x.bezierCurveTo(...P(-7.0, -5.0), ...P(-3.6, -7.5), ...P(-1.25, -7.0));
  x.closePath();
}
function thumb(it, color, big = false) {
  // предметы магазина — снимок настоящей 3D-модели, в разрешении экрана
  const css = big ? 220 : 128, px = Math.round(css * Math.min(3, Math.max(2, window.devicePixelRatio || 1)));
  if (window.THREE && ['blade', 'rubber', 'grip', 'tape', 'ball', 'case'].includes(it.type)) {
    const ck = colorOf(it, color)?.key;
    const url = it.type === 'blade' ? snapshot(`b:${it.id}:${ck}`, { blade: `${it.id}:${ck}`, only: 'blade' }, { rx: -.12, ry: .5, rz: -.55, d: 54, y: .2 }, px)
      : it.type === 'rubber' ? snapshot(`r:${it.id}:${ck}`, { blade: 'cn-b1:FL', fh: `${it.id}:${ck}`, only: 'rubber' }, { rx: -.2, ry: .45, rz: -.25, d: 33, y: 3.6 }, px)
      : it.type === 'grip' ? snapshot(`g:${it.id}:${ck}`, { blade: 'eu-b1:FL', grip: `${it.id}:${ck}`, only: 'blade' }, { rx: .2, ry: .65, rz: -.62, d: 50, y: -1.6, x: -1 }, px)
      : it.type === 'tape' ? snapshot(`t:${it.id}:${ck}`, null, { rx: .55, ry: .4, rz: -.12, d: 46, y: 0 }, px, () => buildTapeRoll(it, ck))
      : it.type === 'ball' ? snapshot(`ba:${it.id}:${ck}`, null, { rx: .1, ry: 0, rz: 0, d: 40, y: 0 }, px, () => buildBalls(it, ck))
      : snapshot(`c:${it.id}:${ck}`, null, { rx: -.15, ry: .45, rz: -.42, d: 64, y: -2.5 }, px, () => buildCase(it, ck));
    if (url) { const img = new Image(); img.src = url; img.alt = ''; img.width = css; img.height = css; img.className = 'snap'; return img; }
  }
  const N = big ? 220 : 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = N; const x = cv.getContext('2d');
  x.scale(N / 128, N / 128);
  const col = colorOf(it, color);
  const t = it.type;
  if (t === 'blade' || t === 'rubber') {
    x.save(); x.translate(64, 60); x.rotate(-0.42);
    const k = 3.9;
    // ручка
    const cheek = t === 'blade' ? it.look.cheek : '#c9935a';
    x.fillStyle = cheek; rr(x, -5.6, 26, 11.2, 40, 4); x.fill();
    x.fillStyle = 'rgba(255,255,255,.18)'; rr(x, -2.6, 40, 5.2, 14, 2); x.fill();
    // голова
    headPath2D(x, 0, 0, k, t === 'blade' && it.look.hex);
    if (t === 'blade') {
      x.fillStyle = it.look.face; x.fill(); x.save(); x.clip();
      x.strokeStyle = 'rgba(90,50,15,.28)'; x.lineWidth = 1;
      for (let i = -34; i < 34; i += 4) { x.beginPath(); x.moveTo(i, -36); x.bezierCurveTo(i + 4, -14, i - 3, 4, i + 2, 30); x.stroke(); }
      x.restore(); x.strokeStyle = shade(it.look.face, -40); x.lineWidth = 1.4; headPath2D(x, 0, 0, k, it.look.hex); x.stroke();
      emblem(x, it.bk, 0, -20, 14, BRANDS[it.bk]?.color);
    } else {
      const g = x.createLinearGradient(-30, -30, 30, 30); g.addColorStop(0, shade(col.hex, 30)); g.addColorStop(1, shade(col.hex, -15));
      x.fillStyle = g; x.fill();
      x.strokeStyle = it.sp || '#e3b04b'; x.lineWidth = 2; x.stroke();
      if (it.rubber === 'длинные шипы') { x.save(); headPath2D(x, 0, 0, k); x.clip(); x.fillStyle = 'rgba(255,255,255,.2)'; for (let a = -30; a <= 30; a += 4.5) for (let b = -34; b <= 34; b += 4.5) { x.beginPath(); x.arc(a + ((b / 4.5) % 2) * 2.2, b, 1.2, 0, 7); x.fill(); } x.restore(); }
      x.fillStyle = 'rgba(255,255,255,.22)'; x.beginPath(); x.ellipse(-10, -12, 10, 16, -0.5, 0, 7); x.fill();
      const lc = col.key === 'black' ? '#e8e8e8' : '#fff';
      emblem(x, it.bk, 0, 13, 12, lc);
      x.fillStyle = lc; x.font = '800 7px Arial'; x.textAlign = 'center'; x.fillText(it.brand.toUpperCase(), 0, 25);
    }
    x.restore();
  } else if (t === 'grip' && false) {
    x.save(); x.translate(64, 64); x.rotate(-0.4);
    x.fillStyle = '#c9935a'; rr(x, -10, -44, 20, 88, 8); x.fill();
    x.save(); rr(x, -10, -44, 20, 88, 8); x.clip();
    for (let y = -60; y < 60; y += 9) { x.fillStyle = col.hex; x.beginPath(); x.moveTo(-14, y); x.lineTo(14, y - 10); x.lineTo(14, y - 3); x.lineTo(-14, y + 7); x.closePath(); x.fill(); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(-14, y + 6, 28, 1.2); }
    x.restore();
    emblem(x, it.bk, 0, 0, 13, light(col.hex) ? '#333' : '#fff');
    x.restore();
  } else if (t === 'tape') {
    x.translate(64, 64); x.shadowColor = 'rgba(10,30,70,.28)'; x.shadowBlur = 8; x.shadowOffsetY = 4;
    x.strokeStyle = col.hex; x.lineWidth = 18; x.beginPath(); x.arc(0, 0, 32, 0, 7); x.stroke();
    x.shadowColor = 'transparent';
    const tg = x.createLinearGradient(-40, -40, 40, 40); tg.addColorStop(0, 'rgba(255,255,255,.35)'); tg.addColorStop(.5, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(0,0,0,.25)');
    x.strokeStyle = tg; x.lineWidth = 18; x.beginPath(); x.arc(0, 0, 32, 0, 7); x.stroke();
    x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = 1; for (let r2 = 24; r2 < 41; r2 += 3) { x.beginPath(); x.arc(0, 0, r2, 0, 7); x.stroke(); }
    x.fillStyle = '#e7ecf4'; x.beginPath(); x.arc(0, 0, 22, 0, 7); x.fill();
    emblem(x, it.bk, 0, 0, 16, BRANDS[it.bk]?.color);
  } else if (t === 'ball') {
    x.translate(64, 64);
    x.fillStyle = 'rgba(10,30,70,.18)'; x.beginPath(); x.ellipse(0, 44, 48, 8, 0, 0, 7); x.fill();
    const drawBall = (bx, by, r) => {
      const g = x.createRadialGradient(bx - r * .35, by - r * .4, r * .1, bx, by, r); g.addColorStop(0, '#fff'); g.addColorStop(1, shade(col.hex, -40));
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
      x.fillStyle = BRANDS[it.bk]?.color || '#333';
      for (let i = 0; i < it.stars; i++) star(x, bx - (it.stars - 1) * r * .22 + i * r * .44, by - r * .12, r * .18);
      x.font = `800 ${r * .34}px Arial`; x.textAlign = 'center'; x.fillText(it.brand.toUpperCase(), bx, by + r * .38);
    };
    drawBall(-20, 14, 24); drawBall(22, 18, 22); drawBall(0, -20, 26);
  } else if (t === 'case') {
    x.translate(64, 64); x.rotate(-0.3); x.shadowColor = 'rgba(10,30,70,.3)'; x.shadowBlur = 10; x.shadowOffsetY = 5;
    x.fillStyle = col.hex; headPath2D(x, 0, -6, 4.6); x.fill();
    rr(x, -8, 26, 16, 26, 6); x.fill();
    x.shadowColor = 'transparent';
    { const cg = x.createRadialGradient(-12, -22, 4, 0, -6, 44); cg.addColorStop(0, 'rgba(255,255,255,.28)'); cg.addColorStop(1, 'rgba(0,0,0,.22)'); x.fillStyle = cg; headPath2D(x, 0, -6, 4.6); x.fill(); }
    x.strokeStyle = light(col.hex) ? '#9aa4b2' : 'rgba(255,255,255,.55)'; x.setLineDash([3, 3]); x.lineWidth = 2; headPath2D(x, 0, -6, 4.1); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#c9ced8'; rr(x, 30, -14, 6, 12, 2); x.fill();
    if (col.key === 'carbon') { x.save(); headPath2D(x, 0, -6, 4.6); x.clip(); x.fillStyle = 'rgba(255,255,255,.07)'; for (let i = -60; i < 60; i += 6) for (let j = -60; j < 60; j += 6) if ((i + j) / 6 % 2 === 0) x.fillRect(i, j, 6, 6); x.restore(); }
    emblem(x, it.bk, 0, -8, 22, light(col.hex) ? BRANDS[it.bk]?.color : '#fff');
  } else if (t === 'shirt') {
    x.translate(64, 66); x.shadowColor = 'rgba(10,30,70,.28)'; x.shadowBlur = 9; x.shadowOffsetY = 4;
    x.fillStyle = col.hex;
    x.beginPath(); x.moveTo(-18, -40); x.lineTo(-42, -26); x.lineTo(-32, -6); x.lineTo(-24, -10); x.lineTo(-24, 42); x.lineTo(24, 42); x.lineTo(24, -10); x.lineTo(32, -6); x.lineTo(42, -26); x.lineTo(18, -40); x.quadraticCurveTo(0, -26, -18, -40); x.closePath(); x.fill();
    x.shadowColor = 'transparent';
    { const sg = x.createLinearGradient(-42, -40, 42, 42); sg.addColorStop(0, 'rgba(255,255,255,.22)'); sg.addColorStop(.55, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(0,0,0,.2)'); x.fillStyle = sg; x.fill();
      x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-10, 0); x.quadraticCurveTo(-6, 20, -12, 40); x.moveTo(12, 4); x.quadraticCurveTo(8, 22, 14, 40); x.stroke();
      x.fillStyle = 'rgba(0,0,0,.18)'; x.beginPath(); x.moveTo(-18, -40); x.quadraticCurveTo(0, -24, 18, -40); x.quadraticCurveTo(0, -30, -18, -40); x.fill(); }
    x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = 1.5;
    const acc = BRANDS[it.bk]?.color || '#333';
    x.fillStyle = light(col.hex) ? acc : 'rgba(255,255,255,.9)';
    x.fillRect(-24, 18, 48, 4);
    if (it.bk === 'falkner') { x.fillStyle = 'rgba(0,0,0,.35)'; for (let i = -22; i < 24; i += 9) { x.beginPath(); x.moveTo(i, -10); x.lineTo(i + 5, 14); x.lineTo(i + 2, 14); x.closePath(); x.fill(); } }
    if (it.bk === 'huaxia') { x.fillStyle = col.key === 'red' ? '#ffcc00' : '#c8102e'; for (const [a, b, r] of [[-12, -18, 5], [-3, -24, 2], [2, -19, 2], [2, -12, 2], [-3, -8, 2]]) star(x, a, b, r); }
    emblem(x, it.bk, 10, -14, 11, light(col.hex) ? acc : '#fff');
    if (col.key === 'gold') { x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.moveTo(-24, -10); x.lineTo(-6, -10); x.lineTo(-24, 20); x.closePath(); x.fill(); }
  } else if (t === 'shorts') {
    x.translate(64, 64); x.shadowColor = 'rgba(10,30,70,.28)'; x.shadowBlur = 9; x.shadowOffsetY = 4;
    x.fillStyle = col.hex;
    x.beginPath(); x.moveTo(-30, -30); x.lineTo(30, -30); x.lineTo(36, 34); x.lineTo(6, 36); x.lineTo(0, 6); x.lineTo(-6, 36); x.lineTo(-36, 34); x.closePath(); x.fill();
    x.shadowColor = 'transparent';
    { const sg = x.createLinearGradient(-36, -30, 36, 36); sg.addColorStop(0, 'rgba(255,255,255,.2)'); sg.addColorStop(1, 'rgba(0,0,0,.22)'); x.fillStyle = sg; x.fill(); }
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(-30, -30, 60, 7);
    const acc = BRANDS[it.bk]?.color || '#333';
    x.fillStyle = light(col.hex) ? acc : 'rgba(255,255,255,.85)'; x.fillRect(-35, 26, 5, 8); x.fillRect(30, 26, 5, 8);
    emblem(x, it.bk, -18, 18, 10, light(col.hex) ? acc : '#fff');
  } else if (t === 'shoes') {
    x.translate(64, 70);
    x.fillStyle = 'rgba(10,30,70,.18)'; x.beginPath(); x.ellipse(2, 24, 54, 6, 0, 0, 7); x.fill();
    const [a1, a2] = it.accent;
    x.fillStyle = col.hex;
    x.beginPath(); x.moveTo(-48, 6); x.quadraticCurveTo(-46, -22, -26, -24); x.lineTo(-6, -24); x.quadraticCurveTo(8, -6, 34, -4); x.quadraticCurveTo(50, -2, 50, 10); x.lineTo(50, 14); x.lineTo(-48, 14); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 1.2; x.stroke();
    { const sg = x.createLinearGradient(0, -24, 0, 14); sg.addColorStop(0, 'rgba(255,255,255,.3)'); sg.addColorStop(1, 'rgba(0,0,0,.15)'); x.fillStyle = sg; x.fill(); }
    x.fillStyle = col.key === 'black' || col.key === 'bg' || col.key === 'neon' || col.key === 'navy' || col.key === 'purple' ? '#2a2b30' : '#e9edf3';
    x.fillRect(-48, 12, 98, 7);
    x.fillStyle = col.key === 'neon' ? a2 : a1;
    x.beginPath(); x.moveTo(-30, 8); x.quadraticCurveTo(-4, -16, 30, 4); x.quadraticCurveTo(-2, -6, -30, 8); x.fill();
    x.fillStyle = a2; x.fillRect(-48, 18, 98, 2);
    x.strokeStyle = light(col.hex) ? '#9aa4b2' : 'rgba(255,255,255,.5)'; x.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(-18 + i * 6, -22 + i * 2); x.lineTo(-12 + i * 6, -16 + i * 2); x.stroke(); }
    emblem(x, it.bk, -30, -4, 10, light(col.hex) ? BRANDS[it.bk]?.color : '#fff');
  } else if (t === 'socks') {
    // пара носков: высокие гетры или короткие
    x.translate(64, 64); const acc = BRANDS[it.bk]?.color || '#333', top = it.high ? -44 : -14;
    for (const [dx, rot] of [[-14, -.12], [14, .1]]) {
      x.save(); x.translate(dx, 0); x.rotate(rot); x.shadowColor = 'rgba(10,30,70,.25)'; x.shadowBlur = 8; x.shadowOffsetY = 4;
      x.fillStyle = col.hex; x.beginPath(); x.moveTo(-10, top); x.lineTo(10, top); x.lineTo(10, 22); x.quadraticCurveTo(30, 22, 30, 34); x.quadraticCurveTo(30, 44, 14, 44); x.lineTo(-4, 44); x.quadraticCurveTo(-12, 44, -10, 30); x.closePath(); x.fill();
      x.shadowColor = 'transparent';
      { const g = x.createLinearGradient(-10, 0, 30, 0); g.addColorStop(0, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(0,0,0,.18)'); x.fillStyle = g; x.fill(); }
      x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(-10, top, 20, 5);
      x.fillStyle = light(col.hex) ? acc : 'rgba(255,255,255,.85)'; x.fillRect(-10, top + 8, 20, 3); if (it.high) x.fillRect(-10, top + 14, 20, 3);
      x.restore();
    }
  } else if (t === 'wrist' || t === 'head') {
    // махровое кольцо в перспективе
    x.translate(64, 66); const head = t === 'head', rx = head ? 46 : 30, ry = head ? 16 : 13, hh = head ? 18 : 26, acc = BRANDS[it.bk]?.color || '#333';
    const g = x.createLinearGradient(-rx, 0, rx, 0); g.addColorStop(0, shade(col.hex, -40)); g.addColorStop(.4, shade(col.hex, 25)); g.addColorStop(1, shade(col.hex, -55));
    x.shadowColor = 'rgba(10,30,70,.25)'; x.shadowBlur = 9; x.shadowOffsetY = 5;
    x.fillStyle = g; x.beginPath(); x.ellipse(0, hh / 2, rx, ry, 0, 0, Math.PI); x.lineTo(-rx, -hh / 2); x.ellipse(0, -hh / 2, rx, ry, 0, Math.PI, 0, true); x.closePath(); x.fill();
    x.shadowColor = 'transparent';
    x.fillStyle = shade(col.hex, -70); x.beginPath(); x.ellipse(0, -hh / 2, rx * .86, ry * .72, 0, 0, 7); x.fill();
    x.strokeStyle = shade(col.hex, 30); x.lineWidth = 2; x.beginPath(); x.ellipse(0, -hh / 2, rx, ry, 0, 0, 7); x.stroke();
    x.strokeStyle = 'rgba(0,0,0,.08)'; x.lineWidth = 1; for (let i = -rx + 4; i < rx; i += 4) { x.beginPath(); x.moveTo(i, -hh / 2 + Math.sqrt(Math.max(0, 1 - (i / rx) ** 2)) * ry); x.lineTo(i, hh / 2 + Math.sqrt(Math.max(0, 1 - (i / rx) ** 2)) * ry); x.stroke(); }
    emblem(x, it.bk, 0, ry * .75, head ? 13 : 12, light(col.hex) ? acc : '#fff');
  }
  return cv;
}

// ───────────── 3D: реалистичная ракетка ─────────────

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (!opts.data) t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return t;
}
// рисунок торцевой ленты: цвет, кант, надпись бренда по всей длине
function tapeTexture(it, col, kind, q = 1) {
  const W = 1024, H = 64;
  const t = canvasTex(W, H, (x, w, h) => {
    const base = kind === 'carbon' ? '#23262c' : kind === 'gold' ? '#c9a227' : col.hex;
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    if (kind === 'carbon') { for (let i = 0; i < w; i += 8) for (let j = 0; j < h; j += 8) { x.fillStyle = ((i + j) / 8) % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.25)'; x.fillRect(i, j, 8, 4); x.fillRect(i + 4, j + 4, 4, 4); } }
    if (kind === 'gold' || col.key === 'silver') { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.2)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
    const ink = kind === 'carbon' ? col.hex : light(base) ? '#15171c' : '#ffffff';
    // кант по краям торца
    x.fillStyle = kind === 'carbon' ? col.hex : light(base) ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.55)';
    x.fillRect(0, h * .22, w, 2); x.fillRect(0, h * .78 - 2, w, 2);
    if (kind === 'pro') { x.fillStyle = BRANDS[it.bk]?.color || ink; x.fillRect(0, h * .3, w, 2); x.fillRect(0, h * .7 - 2, w, 2); }
    // надпись
    const word = (kind === 'gold' ? 'PONGHUB GOLD' : (BRANDS[it.bk]?.name || 'PONGHUB').toUpperCase()) + (kind === 'pro' ? ' PRO' : kind === 'carbon' ? ' CARBON' : '');
    x.font = `800 ${h * .34}px "Barlow Condensed", Arial`; x.textBaseline = 'middle'; x.fillStyle = ink;
    const gap = h * .9, tw = x.measureText(word).width;
    for (let px = 12; px < w; px += tw + gap * 2) {
      x.fillText(word, px, h / 2 + 1);
      x.save(); x.translate(px + tw + gap * .7, h / 2); emblem(x, it.bk, 0, 0, h * .3, ink); x.restore();
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
function woodCanvas(x, w, h, base, seed, dark = 1) {
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  let r = seed * 9301 + 7; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 150; i++) {
    const xx = rnd() * w, lw = .6 + rnd() * 2.4, a = (.03 + rnd() * .09) * dark;
    x.strokeStyle = `rgba(80,45,12,${a})`; x.lineWidth = lw; x.beginPath(); x.moveTo(xx, 0);
    for (let y = 0; y <= h; y += 24) x.lineTo(xx + Math.sin(y / 90 + i * .7) * 5 + (rnd() - .5) * 2, y);
    x.stroke();
  }
  for (let i = 0; i < 6; i++) { const cx = rnd() * w, cy = rnd() * h; const g = x.createRadialGradient(cx, cy, 2, cx, cy, 30 + rnd() * 40); g.addColorStop(0, 'rgba(110,60,20,.10)'); g.addColorStop(1, 'rgba(110,60,20,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
}
// материал отделки: roughness / metalness / clearcoat — у «лаковых» и карбоновых свои, без шлифовки
const FIN_MAT = { jet: { r: .08, m: .1, cc: 1, ccr: .02, e: .3 }, twill: { r: .32, m: .35, cc: 1, ccr: .08 }, forged: { r: .38, m: .3, cc: .9, ccr: .12 }, titanium: { r: .34, m: 1, cc: .5, ccr: .3 }, pearl: { r: .12, m: .2, cc: 1, ccr: .03 } };
// металлические отделки скинов: чёрно-золотая, серебро, бронза, золотая фольга, блёстки
function metalCanvas(x, w, h, kind, base) {
  const G = (stops, ang = 0.8) => { const g = x.createLinearGradient(0, 0, w * Math.cos(ang), h * Math.sin(ang) + h * .2); stops.forEach(([o, c]) => g.addColorStop(o, c)); x.fillStyle = g; x.fillRect(0, 0, w, h); };
  if (kind === 'silver') G([[0, '#8d94a3'], [.25, '#f3f5f9'], [.5, '#aab1bf'], [.75, '#ffffff'], [1, '#939aa8']]);
  else if (kind === 'bronze') G([[0, '#6b3f1d'], [.3, '#d19a64'], [.55, '#9a5f2c'], [.8, '#e0b27a'], [1, '#6b3f1d']]);
  else if (kind === 'gold') G([[0, '#8a6a12'], [.25, '#ffe08a'], [.5, '#c9a227'], [.75, '#fff0b3'], [1, '#9a7714']]);
  else if (kind === 'goldblack') { x.fillStyle = '#121216'; x.fillRect(0, 0, w, h); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, 'rgba(212,175,55,.0)'); g.addColorStop(.5, 'rgba(212,175,55,.22)'); g.addColorStop(1, 'rgba(212,175,55,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.strokeStyle = '#d4af37'; x.lineWidth = 3; for (let i = -h; i < w + h; i += 46) { x.globalAlpha = .75; x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke(); } x.globalAlpha = 1; }
  else if (kind === 'jet') { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#000000'); g.addColorStop(.5, '#16171c'); g.addColorStop(1, '#030304'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
  else if (kind === 'twill') {   // карбон «саржа 2×2»: диагональное плетение
    x.fillStyle = '#0c0d10'; x.fillRect(0, 0, w, h); const c = 12;
    for (let i = 0; i < w / c + 2; i++) for (let j = 0; j < h / c + 2; j++) {
      const ph = (i + j) % 4, hi = ph < 2;
      const g = hi ? x.createLinearGradient(i * c, j * c, i * c + c, j * c) : x.createLinearGradient(i * c, j * c, i * c, j * c + c);
      g.addColorStop(0, hi ? '#2c2f37' : '#16181d'); g.addColorStop(.5, hi ? '#4a4e59' : '#23262d'); g.addColorStop(1, hi ? '#23262d' : '#0d0e11');
      x.fillStyle = g; x.fillRect(i * c, j * c, c - 1, c - 1);
    }
  }
  else if (kind === 'forged') {  // кованый карбон: хаотичные «чешуйки» волокна
    x.fillStyle = '#101114'; x.fillRect(0, 0, w, h); let r = 77; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 520; i++) { const cx = rnd() * w, cy = rnd() * h, a = rnd() * Math.PI, l = 14 + rnd() * 46, t = 5 + rnd() * 14, v = 18 + Math.floor(rnd() * 38);
      x.save(); x.translate(cx, cy); x.rotate(a); x.fillStyle = `rgba(${v},${v + 2},${v + 8},${.55 + rnd() * .4})`; x.beginPath(); x.moveTo(-l, 0); x.lineTo(-l * .3, -t); x.lineTo(l, -t * .2); x.lineTo(l * .5, t); x.lineTo(-l * .6, t * .6); x.closePath(); x.fill(); x.restore(); }
    const sh = x.createLinearGradient(0, 0, w, h); sh.addColorStop(0, 'rgba(255,255,255,.10)'); sh.addColorStop(.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,.06)'); x.fillStyle = sh; x.fillRect(0, 0, w, h);
  }
  else if (kind === 'titanium') { // шлифованный анодированный титан
    G([[0, '#4c5565'], [.3, '#8d97aa'], [.55, '#5d6779'], [.8, '#a7b0c2'], [1, '#4f5868']]);
    for (let i = 0; i < 1400; i++) { x.fillStyle = Math.random() < .5 ? `rgba(255,255,255,${Math.random() * .09})` : `rgba(10,15,30,${Math.random() * .12})`; x.fillRect(0, Math.random() * h, w, 1); }
  }
  else if (kind === 'pearl') {   // белая керамика с перламутром
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f7f4ef'); g.addColorStop(.35, '#efe8f0'); g.addColorStop(.65, '#e8f0f2'); g.addColorStop(1, '#f6efe6'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  }
  else { x.fillStyle = base; x.fillRect(0, 0, w, h); }
  if (FIN_MAT[kind]) return;     // у этих отделок своя фактура — без шлифовки
  // шлифовка + блики
  for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * .07})`; x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 90, 1); }
  if (kind === 'glitter') for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(255,255,255,${.3 + Math.random() * .7})`; const r = .6 + Math.random() * 2; x.fillRect(Math.random() * w, Math.random() * h, r, r); }
}
// контур головы (см): ширина 15, высота 15.8, «плечи» переходят в ручку шириной 2.5
function headShape(hex, inset = 0) {
  const s = new THREE.Shape();
  const k = 1 - inset / 7.5;
  if (hex) {
    const r = 7.4 * k, cy = 0.35;
    const p = [[.62, -1], [1, -.25], [.82, .78], [.18, 1.02], [-.18, 1.02], [-.82, .78], [-1, -.25], [-.62, -1]].map(([a, b]) => [a * r, cy - b * r]);
    s.moveTo(p[0][0], p[0][1]); p.slice(1).forEach(q => s.lineTo(q[0], q[1])); s.closePath(); return s;
  }
  const P = (a, b) => [a * k, b * k];
  s.moveTo(...P(1.25, -7.0));
  s.bezierCurveTo(...P(3.6, -7.5), ...P(7.0, -5.0), ...P(7.3, -2.0));
  s.bezierCurveTo(...P(7.6, 1.0), ...P(7.0, 4.4), ...P(5.2, 6.3));
  s.bezierCurveTo(...P(3.7, 7.7), ...P(1.9, 8.15), ...P(0, 8.15));
  s.bezierCurveTo(...P(-1.9, 8.15), ...P(-3.7, 7.7), ...P(-5.2, 6.3));
  s.bezierCurveTo(...P(-7.0, 4.4), ...P(-7.6, 1.0), ...P(-7.3, -2.0));
  s.bezierCurveTo(...P(-7.0, -5.0), ...P(-3.6, -7.5), ...P(-1.25, -7.0));
  s.closePath();
  return s;
}
// накладка: та же голова, но внизу вырез дугой под «корону» ручки
function rubberShape(hex) {
  const s = headShape(hex, 0.02);
  if (hex) return s;
  const pts = s.getPoints(120).filter(p => p.y > -6.35);
  const o = new THREE.Shape();
  // начинаем справа над ручкой, идём по контуру, закрываем дугой
  const start = pts.findIndex((p, i) => i > 0 && pts[i - 1].y <= -6.35);
  const ordered = start > 0 ? pts.slice(start).concat(pts.slice(0, start)) : pts;
  o.moveTo(ordered[0].x, ordered[0].y);
  ordered.slice(1).forEach(p => o.lineTo(p.x, p.y));
  o.quadraticCurveTo(0, -5.75, ordered[0].x, ordered[0].y);
  return o;
}
function setCapUV(geo, size) {
  const uv = geo.attributes.uv, pos = geo.attributes.position, nor = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) if (Math.abs(nor.getZ(i)) > 0.7) uv.setXY(i, pos.getX(i) / size + .5, pos.getY(i) / size + .5);
  uv.needsUpdate = true;
}
function buildEnv(renderer) {
  // мягкая «студия»: светлые панели вокруг — для бликов на резине и лаке
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: canvasTex(64, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#cfd9ea'); g.addColorStop(1, '#5d6f8f'); x.fillStyle = g; x.fillRect(0, 0, w, h); }) }));
  env.add(sky);
  const panel = (w, h, x, y, z, ry, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
  panel(30, 14, 0, 26, 0, 0, Math.PI / 2); panel(14, 30, 30, 4, 10, -Math.PI / 2.4); panel(12, 26, -30, 0, 6, Math.PI / 2.2);
  const pm = new THREE.PMREMGenerator(renderer);
  return pm.fromScene(env, 0.03).texture;
}
// cfg: { blade:'id:FL', fh, bh, grip, tape, only:'rubber'|'blade' } · q — разрешение текстур
function buildRacket(cfg, q = 1) {
  const inner = new THREE.Group(); inner.position.y = 3.6;
  const bk = parseKey(cfg.blade), bl = bk.it, hex = !!bl.look.hex, HAND = bk.color || 'FL';
  const R = n => Math.round(n * q);
  const T = 0.58;
  // ── основание: голова + стержень ручки одной пластиной, кромка — видны слои
  const bshape = headShape(hex);
  const bladeGeo = new THREE.ExtrudeGeometry(bshape, { depth: T, bevelEnabled: true, bevelThickness: .03, bevelSize: .035, bevelSegments: 3, curveSegments: 96 });
  bladeGeo.translate(0, 0, -T / 2); setCapUV(bladeGeo, 16);
  const seq = bl.look.ply.length === 3 ? [0, 2, 1, 2, 1, 2, 0].map(i => bl.look.ply[i]) : [0, 1, 0, 1, 0].map(i => bl.look.ply[i]);
  const plyTex = canvasTex(8, 256, (x, w, h) => { const hh = h / seq.length; seq.forEach((c, i) => { x.fillStyle = c; x.fillRect(0, i * hh, w, hh + 1); x.fillStyle = 'rgba(60,30,10,.25)'; x.fillRect(0, i * hh, w, 1); }); });
  plyTex.wrapT = THREE.ClampToEdgeWrapping; plyTex.repeat.set(1, 1 / (T + .06)); plyTex.offset.set(0, .03 / (T + .06));
  const fin = bl.look.finish, FM = FIN_MAT[fin];
  const faceTex = canvasTex(R(512), R(512), (x, w, h) => fin ? metalCanvas(x, w, h, fin, bl.look.face) : woodCanvas(x, w, h, bl.look.face, bl.price), { repeat: true });
  const bladeMat = [new THREE.MeshPhysicalMaterial({ map: faceTex, roughness: FM ? FM.r : fin ? .22 : .55, metalness: FM ? FM.m : fin ? .85 : 0, clearcoat: FM ? FM.cc : fin ? 1 : .25, clearcoatRoughness: FM ? FM.ccr : fin ? .15 : .5, envMapIntensity: FM?.e ?? 1 }), new THREE.MeshStandardMaterial({ map: plyTex, roughness: .7 })];
  if (cfg.only !== 'rubber') inner.add(new THREE.Mesh(bladeGeo, bladeMat));
  // ── ручка: стержень + две щёчки с расширением книзу (FL) и выпуклой «короной»
  const HTOP = -6.15, HBOT = HAND === 'CS' ? -13.1 : -16.3;
  const stemW = 1.05;
  const stem = new THREE.Shape(); stem.moveTo(-stemW, -6.8); stem.lineTo(stemW, -6.8); stem.lineTo(stemW * 1.08, HBOT); stem.lineTo(-stemW * 1.08, HBOT); stem.closePath();
  const stemGeo = new THREE.ExtrudeGeometry(stem, { depth: T, bevelEnabled: false }); stemGeo.translate(0, 0, -T / 2);
  if (cfg.only !== 'rubber') inner.add(new THREE.Mesh(stemGeo, bladeMat));
  // формы ручки: FL — расширяется книзу, ST — прямая, AN — утолщение посередине, CS — короткая
  const HW = { FL: [1.3, 1.16, 1.78], ST: [1.32, 1.32, 1.32], AN: [1.16, 1.62, 1.22], CS: [1.2, 1.1, 1.22] }[HAND];
  const cheekShape = () => {
    const s = new THREE.Shape(); const [w0, wm, w1] = HW.map(v => v * .86);
    // точки контура заданы для длинной ручки — для короткой (CS) пропорционально сжимаем по высоте
    const Y = y => HTOP + (y - HTOP) * (HTOP - HBOT) / (HTOP + 16.3);
    s.moveTo(-w0, HTOP - .55); s.quadraticCurveTo(0, HTOP + .32, w0, HTOP - .55);
    s.bezierCurveTo(w0 + .02, Y(HTOP - 3), wm, Y(-11.6), wm + .05, Y(-12.6));
    s.bezierCurveTo(wm + .15, Y(-14), w1, Y(-15.2), w1, HBOT + .35);
    s.quadraticCurveTo(w1, HBOT, w1 - .35, HBOT); s.lineTo(-w1 + .35, HBOT); s.quadraticCurveTo(-w1, HBOT, -w1, HBOT + .35);
    s.bezierCurveTo(-w1, Y(-15.2), -wm - .15, Y(-14), -wm - .05, Y(-12.6));
    s.bezierCurveTo(-wm, Y(-11.6), -w0 - .02, Y(HTOP - 3), -w0, HTOP - .55);
    return s;
  };
  const grip = parseKey(cfg.grip);
  const CT = 0.42, CB = 0.22; // щёчка: толщина + скругление → ручка ≈ 2,3 см
  const cheekWood = canvasTex(R(256), R(512), (x, w, h) => fin ? metalCanvas(x, w, h, fin === 'goldblack' ? 'gold' : fin, bl.look.cheek) : woodCanvas(x, w, h, bl.look.cheek, bl.price + 3, light(bl.look.cheek) ? 1 : .6), { repeat: true });
  let cheekMat;
  if (grip.it) {
    const gc = colorOf(grip.it, grip.color).hex;
    const wrap = canvasTex(R(256), R(512), (x, w, h) => {
      x.fillStyle = gc; x.fillRect(0, 0, w, h);
      for (let y = -w; y < h + w; y += 34) { x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y - 60); x.lineTo(w, y - 56); x.lineTo(0, y + 4); x.closePath(); x.fill(); x.fillStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.moveTo(0, y + 6); x.lineTo(w, y - 54); x.lineTo(w, y - 50); x.lineTo(0, y + 10); x.closePath(); x.fill(); }
      if (grip.it.id === 'acc-g1') for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * .12})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    }, { repeat: true });
    cheekMat = new THREE.MeshStandardMaterial({ map: wrap, roughness: grip.it.id === 'acc-g3' ? .45 : .9 });
  } else cheekMat = new THREE.MeshPhysicalMaterial({ map: cheekWood, roughness: FM ? FM.r : fin ? .25 : .45, metalness: FM ? FM.m : fin ? .8 : 0, clearcoat: FM ? FM.cc : fin ? 1 : .5, clearcoatRoughness: FM ? FM.ccr : .3, envMapIntensity: FM?.e ?? 1 });
  for (const sgn of cfg.only === 'rubber' ? [] : [1, -1]) {
    const cg = new THREE.ExtrudeGeometry(cheekShape(), { depth: CT, bevelEnabled: true, bevelThickness: CB, bevelSize: .2, bevelSegments: 6, curveSegments: 48 });
    setCapUV(cg, 6);
    const m = new THREE.Mesh(cg, cheekMat);
    if (sgn === 1) m.position.z = T / 2 + CB; else { m.rotation.y = Math.PI; m.position.z = -T / 2 - CB; }
    inner.add(m);
    // фирменная плашка на ручке
    if (!grip.it) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 2.8), new THREE.MeshPhysicalMaterial({
        map: canvasTex(150, 320, (x, w, h) => {
          const bc = BRANDS[bl.bk]?.color || '#333';
          const g2 = x.createLinearGradient(0, 0, w, h); g2.addColorStop(0, '#f6f7fa'); g2.addColorStop(.5, '#c9ced8'); g2.addColorStop(1, '#eef0f4');
          x.fillStyle = g2; rr(x, 4, 4, w - 8, h - 8, 22); x.fill(); x.strokeStyle = bc; x.lineWidth = 6; rr(x, 10, 10, w - 20, h - 20, 18); x.stroke();
          emblem(x, bl.bk, w / 2, 80, 70, bc);
          x.save(); x.translate(w / 2, 200); x.rotate(-Math.PI / 2); x.fillStyle = bc; x.font = '800 34px "Barlow Condensed", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(bl.brand.toUpperCase(), 0, 0); x.restore();
        }), transparent: true, metalness: .55, roughness: .3, clearcoat: 1,
      }));
      plate.position.set(0, HAND === 'CS' ? -9.6 : -10.9, sgn * (T / 2 + CB + CT + CB + .012));
      if (sgn === -1) plate.rotation.y = Math.PI;
      inner.add(plate);
    }
  }
  // торец ручки — сплошной, без щели между щёчками
  if (cfg.only !== 'rubber') {
    const w1 = HW[2] * .86, depth = T + 2 * (CB + CT * .6);
    const capS = new THREE.Shape(); const hw = w1 - .12, r0 = .35;
    capS.moveTo(-hw + r0, 0); capS.lineTo(hw - r0, 0); capS.quadraticCurveTo(hw, 0, hw, r0); capS.lineTo(hw, 1.1); capS.lineTo(-hw, 1.1); capS.lineTo(-hw, r0); capS.quadraticCurveTo(-hw, 0, -hw + r0, 0);
    const capG = new THREE.ExtrudeGeometry(capS, { depth, bevelEnabled: true, bevelThickness: .06, bevelSize: .06, bevelSegments: 3 });
    capG.translate(0, HBOT + .06, -depth / 2);
    inner.add(new THREE.Mesh(capG, cheekMat));
  }
  // ── накладки: цветная верхняя резина + губка (видна на торце)
  for (const side of cfg.only === 'blade' ? [] : ['fh', 'bh'].filter(sd => cfg[sd])) {
    const { it, color } = parseKey(cfg[side]);
    const col = colorOf(it, color);
    const shape = rubberShape(hex);
    const SP = it.sp ? 0.17 : 0.05, TS = 0.07; // губка, верхний лист
    const sponge = new THREE.ExtrudeGeometry(shape, { depth: SP, bevelEnabled: false, curveSegments: 96 });
    const topG = new THREE.ExtrudeGeometry(shape, { depth: TS, bevelEnabled: true, bevelThickness: .015, bevelSize: .012, bevelSegments: 2, curveSegments: 96 });
    setCapUV(topG, 15.4);
    const pimples = it.rubber === 'длинные шипы';
    const lc = col.key === 'black' ? '#e9e9e9' : '#ffffff';
    const topTex = canvasTex(R(1024), R(1024), (x, w, h) => {
      x.save(); x.scale(w / 1024, h / 1024); w = 1024; h = 1024;
      x.fillStyle = col.hex; x.fillRect(0, 0, w, h);
      const img = x.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      x.putImageData(img, 0, 0);
      if (it.fin) { const k = it.fin === 'gold' ? 'gold' : 'glitter'; x.save(); if (k === 'glitter') { x.fillStyle = col.hex; x.fillRect(0, 0, w, h); } metalCanvas(x, w, h, k, col.hex); x.restore(); if (k === 'glitter') { x.fillStyle = col.hex; x.globalAlpha = .55; x.fillRect(0, 0, w, h); x.globalAlpha = 1; } }
      x.fillStyle = lc; x.strokeStyle = lc; x.textAlign = 'center';
      // логотип у ручки, как на настоящих накладках
      emblem(x, it.bk, w / 2, h * .74, 70, lc);
      x.font = '800 62px "Barlow Condensed", Arial'; x.fillText(it.brand.toUpperCase(), w / 2, h * .835);
      x.font = '600 34px Inter, Arial'; x.fillText(it.name.replace(/ ·.*$/, ''), w / 2, h * .875);
      x.globalAlpha = .55; x.font = '600 18px Inter, Arial'; x.fillText(it.sp ? `${it.sponge} · ${it.region === 'cn' ? 'MADE IN CHINA' : it.region === 'jp' ? 'MADE IN JAPAN' : 'MADE IN GERMANY'}` : 'OX · PIMPLES OUT', w / 2, h * .905);
      x.globalAlpha = 1; x.restore();
    });
    const bump = pimples ? canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; for (let a = 6; a < w; a += 12) for (let b = 6; b < h; b += 12) { x.beginPath(); x.arc(a + ((b / 12) % 2) * 6, b, 3.6, 0, 7); x.fill(); } }, { data: true }) : null;
    const tacky = it.rubber.includes('лип');
    const topMat = new THREE.MeshPhysicalMaterial({ map: topTex, metalness: it.fin === 'gold' ? .5 : it.fin ? .12 : 0, roughness: it.fin ? .32 : pimples ? .75 : tacky ? .42 : .55, clearcoat: pimples ? 0 : tacky ? .6 : .3, clearcoatRoughness: tacky ? .22 : .45, bumpMap: bump, bumpScale: pimples ? .05 : 0, envMapIntensity: .45 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: shade(col.hex, -10), roughness: .7 });
    const spongeMat = new THREE.MeshStandardMaterial({ color: it.sp || col.hex, roughness: .95 });
    const grp = new THREE.Group();
    const spM = new THREE.Mesh(sponge, spongeMat); grp.add(spM);
    const tpM = new THREE.Mesh(topG, [topMat, edgeMat]); tpM.position.z = SP; grp.add(tpM);
    if (side === 'fh') grp.position.z = T / 2 + .005; else { grp.rotation.y = Math.PI; grp.position.z = -T / 2 - .005; }
    grp.userData = { side, baseZ: grp.position.z };
    inner.add(grp);
  }
  // ── торцевая лента: тонкая полоса, приклеенная по торцу головы и чуть заходящая на накладки
  const tape = parseKey(cfg.tape);
  if (tape.it && cfg.only !== 'rubber') {
    const tc = colorOf(tape.it, tape.color), kind = tape.it.tape || 'classic';
    const sideZ = sd => { if (!cfg[sd]) return T / 2; const r = parseKey(cfg[sd]).it; return T / 2 + .005 + (r.sp ? .17 : .05) + .07; };
    const zF = sideZ('fh') + .012, zB = sideZ('bh') + .012;
    // контур головы с небольшим отступом наружу; лента заканчивается у «плеч» ручки
    const raw = headShape(hex, -0.03).getPoints(hex ? 24 : 220);
    let pts = raw.filter(p => p.y > -6.05);
    if (hex) { const dense = []; const loop = raw.concat([raw[0]]); for (let i = 0; i < loop.length - 1; i++) for (let k = 0; k < 12; k++) dense.push(loop[i].clone().lerp(loop[i + 1], k / 12)); pts = dense.filter(p => p.y > -6.05); }
    // контур замкнут: начинаем сразу после разрыва у ручки, чтобы лента шла одним куском от плеча до плеча
    let gi = 0, gmax = -1;
    for (let i = 0; i < pts.length; i++) { const d = pts[i].distanceTo(pts[(i + 1) % pts.length]); if (d > gmax) { gmax = d; gi = i; } }
    pts = pts.slice(gi + 1).concat(pts.slice(0, gi + 1));
    if (pts[0].x < pts[pts.length - 1].x) pts.reverse(); // всегда от правого плеча к левому — надпись читается одинаково
    const N = pts.length, lip = .16, th = .022, P = [], U = [], I = [];
    let len = 0;
    for (let i = 0; i < N; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], c = pts[Math.min(N - 1, i + 1)];
      if (i) len += p.distanceTo(pts[i - 1]);
      let nx = c.y - a.y, ny = -(c.x - a.x); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if (nx * p.x + ny * (p.y - .5) < 0) { nx = -nx; ny = -ny; }
      const u = len / 6.0;
      // сечение: губа на лицевой стороне → торец → губа на тыльной (снаружи и изнутри — толщина ленты)
      const sec = [[-lip, zF, 1], [0, zF + th * .5, .86], [th, zF * .55, .7], [th, -zB * .55, .3], [0, -zB - th * .5, .14], [-lip, -zB, 0]];
      for (const [o, z, v] of sec) { P.push(p.x + nx * o, p.y + ny * o, z); U.push(u, v); }
    }
    const S = 6;
    for (let i = 0; i < N - 1; i++) for (let k = 0; k < S - 1; k++) { const a0 = i * S + k, b0 = a0 + S; I.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); tg.setIndex(I); tg.computeVertexNormals();
    const tex = tapeTexture(tape.it, tc, kind, q);
    const metal = kind === 'gold' || tc.key === 'silver';
    const tm = new THREE.Mesh(tg, new THREE.MeshPhysicalMaterial({ map: tex, side: THREE.DoubleSide, roughness: metal ? .28 : kind === 'neon' ? .45 : .38, metalness: metal ? .75 : 0, clearcoat: .7, clearcoatRoughness: .25 }));
    inner.add(tm);
  }
  return inner;
}
// ── картинки для карточек: снимок той же 3D-модели ──
const SNAP = new Map();
let snapR = null;
// снимок 3D-объекта для карточки; size — в пикселях (с учётом плотности экрана)
function snapshot(key, cfg, view, size = 256, build = null) {
  key += '@' + size;
  if (SNAP.has(key)) return SNAP.get(key);
  if (!window.THREE) return null;
  if (!snapR) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.LinearToneMapping; renderer.toneMappingExposure = .95; renderer.physicallyCorrectLights = true;
    const scene = new THREE.Scene(); scene.environment = buildEnv(renderer);
    const key2 = new THREE.DirectionalLight('#ffffff', 1.6); key2.position.set(10, 14, 16); scene.add(key2);
    const rim = new THREE.DirectionalLight('#cfe0ff', 1.3); rim.position.set(-12, 6, -14); scene.add(rim);
    scene.add(new THREE.AmbientLight('#ffffff', .3));
    snapR = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, .1, 200) };
  }
  const { renderer, scene, camera } = snapR;
  renderer.setSize(size, size, false);
  const g = new THREE.Group(); g.add(build ? build() : buildRacket(cfg, size > 300 ? 1 : .6)); scene.add(g);
  const v = view || { rx: -.15, ry: .55, rz: -.5, d: 50, y: 0 };
  g.rotation.set(v.rx, v.ry, v.rz); camera.position.set(v.x || 0, v.y, v.d); camera.lookAt(v.x || 0, v.y, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(g); g.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); });
  SNAP.set(key, url);
  return url;
}
// рулон торцевой ленты
function buildTapeRoll(it, color) {
  const col = colorOf(it, color), kind = it.tape || 'classic', grp = new THREE.Group();
  const tex = tapeTexture(it, col, kind); tex.repeat.set(3, 1);
  const metal = kind === 'gold' || col.key === 'silver';
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 3.4, 96, 1, true), new THREE.MeshPhysicalMaterial({ map: tex, roughness: metal ? .3 : .42, metalness: metal ? .7 : 0, clearcoat: .6 }));
  grp.add(outer);
  const sideTex = canvasTex(256, 256, (x, w, h) => { const base = kind === 'carbon' ? '#26292f' : kind === 'gold' ? '#c9a227' : col.hex; x.fillStyle = base; x.fillRect(0, 0, w, h); x.strokeStyle = light(base) ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.1)'; for (let r = 60; r < 128; r += 3) { x.beginPath(); x.arc(w / 2, h / 2, r, 0, 7); x.stroke(); } });
  const ringG = new THREE.RingGeometry(5.6, 9, 96, 1);
  for (const sgn of [1, -1]) { const r = new THREE.Mesh(ringG, new THREE.MeshPhysicalMaterial({ map: sideTex, roughness: .5, metalness: metal ? .6 : 0, side: THREE.DoubleSide })); r.rotation.x = -sgn * Math.PI / 2; r.position.y = sgn * 1.7; grp.add(r); }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 3.5, 64, 1, true), new THREE.MeshStandardMaterial({ map: canvasTex(256, 64, (x, w, h) => { x.fillStyle = '#d8c3a0'; x.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(120,90,50,${Math.random() * .15})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 1); } emblem(x, it.bk, w * .25, h / 2, 26, BRANDS[it.bk]?.color); emblem(x, it.bk, w * .75, h / 2, 26, BRANDS[it.bk]?.color); }), roughness: .9, side: THREE.DoubleSide }));
  grp.add(core);
  // хвостик ленты
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.4), new THREE.MeshPhysicalMaterial({ map: tapeTexture(it, col, kind), roughness: .42, metalness: metal ? .7 : 0, side: THREE.DoubleSide }));
  tail.position.set(9.05, 0, 2.6); tail.rotation.y = -1.25; grp.add(tail);
  return grp;
}
// мячи: три шарика с логотипом и звёздами
function buildBalls(it, color) {
  const col = colorOf(it, color), grp = new THREE.Group();
  const tex = canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = col.hex; x.fillRect(0, 0, w, h);
    const ink = BRANDS[it.bk]?.color || '#333';
    x.fillStyle = ink; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 0; i < (it.stars || 1); i++) star(x, w * .25 - ((it.stars || 1) - 1) * 14 + i * 28, h * .42, 12);
    x.font = '800 34px "Barlow Condensed", Arial'; x.fillText((BRANDS[it.bk]?.name || '').toUpperCase(), w * .25, h * .6, w * .2);
    x.font = '700 18px Arial'; x.fillText('40+', w * .75, h * .5);
  });
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: .35, clearcoat: .4 });
  const geo = new THREE.SphereGeometry(4, 48, 32);
  for (const [px, py, pz, ry] of [[-4.3, -2.2, 1.5, .2], [4.1, -2.4, .6, -.4], [0, 4.4, -.4, .05]]) { const b = new THREE.Mesh(geo, mat); b.position.set(px, py, pz); b.rotation.y = ry; grp.add(b); }
  return grp;
}
// чехол / кейс в форме ракетки
function buildCase(it, color) {
  const col = colorOf(it, color), grp = new THREE.Group(), hard = it.id === 'acc-c2';
  const sh = headShape(false, -0.9);
  const body = new THREE.ExtrudeGeometry(sh, { depth: hard ? 2.4 : 1.6, bevelEnabled: true, bevelThickness: hard ? 1.2 : 1.6, bevelSize: hard ? .9 : 1.3, bevelSegments: 8, curveSegments: 96 });
  body.translate(0, 0, -(hard ? 1.2 : .8)); setCapUV(body, 18);
  const face = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = col.hex; x.fillRect(0, 0, w, h);
    if (col.key === 'carbon' || hard) { for (let i = 0; i < w; i += 12) for (let j = 0; j < h; j += 12) { x.fillStyle = ((i + j) / 12) % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.12)'; x.fillRect(i, j, 12, 6); } }
    else { for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * .06})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }
    const ink = light(col.hex) ? BRANDS[it.bk]?.color || '#333' : '#ffffff';
    emblem(x, it.bk, w / 2, h * .42, 120, ink);
    x.fillStyle = ink; x.font = '800 54px "Barlow Condensed", Arial'; x.textAlign = 'center'; x.fillText((BRANDS[it.bk]?.name || '').toUpperCase(), w / 2, h * .66);
  });
  const mat = new THREE.MeshPhysicalMaterial({ map: face, roughness: hard ? .35 : .85, clearcoat: hard ? .8 : 0, metalness: 0 });
  const side = new THREE.MeshStandardMaterial({ color: shade(col.hex, -18), roughness: .8 });
  grp.add(new THREE.Mesh(body, [mat, side]));
  // отделение для ручки
  const hs = new THREE.Shape(); const hw = 2.6, ht = -5.5, hb = -14.5, rc = 1.4;
  hs.moveTo(-hw + rc, hb); hs.lineTo(hw - rc, hb); hs.quadraticCurveTo(hw, hb, hw, hb + rc); hs.lineTo(hw, ht); hs.lineTo(-hw, ht); hs.lineTo(-hw, hb + rc); hs.quadraticCurveTo(-hw, hb, -hw + rc, hb);
  const hg = new THREE.ExtrudeGeometry(hs, { depth: hard ? 2.2 : 1.4, bevelEnabled: true, bevelThickness: hard ? 1 : 1.3, bevelSize: .7, bevelSegments: 6 }); hg.translate(0, 0, -(hard ? 1.1 : .7));
  grp.add(new THREE.Mesh(hg, side));
  // молния по периметру
  const pts = headShape(false, -1.05).getPoints(200).map(p => new THREE.Vector3(p.x, p.y, 0));
  const zip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 300, .28, 8, true), new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: .5, metalness: .3 }));
  grp.add(zip);
  const pull = new THREE.Mesh(new THREE.BoxGeometry(1, 2.4, .5), new THREE.MeshStandardMaterial({ color: '#c9ced8', metalness: .8, roughness: .3 }));
  pull.position.set(7.9, 1.5, .4); pull.rotation.z = -.2; grp.add(pull);
  return grp;
}

export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = () => res(window.THREE); s.onerror = () => rej(new Error('3D не загрузилось — проверьте интернет')); document.head.appendChild(s);
  });
}
// 3D-просмотр ракетки: вертеть пальцем, перевернуть, приблизить. Один на экран.
let viewer = null;
export function mountViewer(el, cfg, opts = {}) {
  const THREE = window.THREE;
  if (!THREE) return null;
  if (!viewer) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.LinearToneMapping; renderer.toneMappingExposure = .95; renderer.physicallyCorrectLights = true;
    const scene = new THREE.Scene(); scene.environment = buildEnv(renderer);
    const camera = new THREE.PerspectiveCamera(30, 1, .1, 200);
    const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(10, 14, 16); scene.add(key);
    const rim = new THREE.DirectionalLight('#cfe0ff', 1.4); rim.position.set(-12, 6, -14); scene.add(rim);
    scene.add(new THREE.AmbientLight('#ffffff', .25));
    viewer = { renderer, scene, camera, group: null, inner: null, target: { x: -0.18, y: 0.35 }, cur: { x: -0.18, y: 0.35 }, zoom: 1, dragging: false, idleAt: 0, anim: null, onSide: null };
    const loop = () => {
      requestAnimationFrame(loop);
      const v = viewer;
      if (!v.group || !v.renderer.domElement.isConnected) return;
      if (!v.dragging && Date.now() - v.idleAt > 2500 && !v.anim) v.target.y += 0.005;
      v.cur.x += (v.target.x - v.cur.x) * .1; v.cur.y += (v.target.y - v.cur.y) * .1;
      v.group.rotation.set(v.cur.x, v.cur.y, 0);
      v.onSide?.(Math.cos(v.cur.y) >= 0 ? 1 : 2);
      v.camera.position.set(0, 0, v.fitD || 52 / v.zoom); v.camera.lookAt(0, 0, 0);
      if (v.anim) {
        v.anim.t = Math.min(1, v.anim.t + 0.025);
        const e = 1 - Math.pow(1 - v.anim.t, 3);
        v.inner.children.forEach(m => { if (m.userData.side === v.anim.slot) { m.position.z = m.userData.baseZ + (m.userData.side === 'fh' ? 1 : -1) * (1 - e) * 7; m.scale.setScalar(.9 + .1 * e); } });
        if (v.anim.t >= 1) v.anim = null;
      }
      v.renderer.render(v.scene, v.camera);
    };
    loop();
  }
  const v = viewer;
  const w = el.clientWidth, h = el.clientHeight;
  v.renderer.setSize(w, h, false); v.camera.aspect = w / h; v.camera.updateProjectionMatrix();
  el.prepend(v.renderer.domElement);
  // та же ракетка в том же режиме (главная перерисовывается) — не собираем заново
  const ck = JSON.stringify(cfg) + (opts.fit ? 'fit' : '');
  const same = !!(v.group && v.ck === ck && opts.fit);
  if (!same) {
  v.ck = ck;
  if (v.group) { v.scene.remove(v.group); v.group.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); }); }
  v.group = new THREE.Group(); v.inner = buildRacket(cfg); v.group.add(v.inner); v.scene.add(v.group);
  v.onSide = opts.onSide || null;
  // opts.fit: ракетка целиком в рамке при любом повороте (камера по описанной сфере), без приближения
  v.tilt = opts.fit ? .4 : 1.3; v.fitD = 0;
  if (opts.fit) {
    // по высоте — длина ракетки, по ширине — ширина головки при любом повороте вокруг ручки (+ запас на наклон)
    const box = new THREE.Box3().setFromObject(v.inner), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const tv = Math.tan(THREE.MathUtils.degToRad(v.camera.fov / 2)), th = tv * v.camera.aspect, wide = Math.hypot(sz.x, sz.z);
    v.fitD = Math.max(sz.y * 1.08 / 2 / tv, wide * 1.08 / 2 / th) + wide / 2; v.inner.position.sub(c);
  }
  }
  v.onSide = opts.onSide || null;
  if (opts.zoom) v.zoom = opts.zoom;
  if (opts.apply) { v.anim = { slot: opts.apply, t: 0 }; v.target.y = opts.apply === 'bh' ? Math.PI + .35 : opts.apply === 'grip' ? .6 : .35; v.target.x = opts.apply === 'grip' ? .35 : -.18; }
  let last = null;
  el.onpointerdown = e => { if (e.target.closest('button')) return; e.preventDefault(); v.dragging = true; last = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); };
  // ракетка внутри ссылки: мышью — вертим, а не «перетаскиваем ссылку»
  el.ondragstart = e => e.preventDefault();
  el.onpointermove = e => { if (!v.dragging) return; v.target.y += (e.clientX - last[0]) * .012; v.target.x = Math.max(-v.tilt, Math.min(v.tilt, v.target.x + (e.clientY - last[1]) * .008)); last = [e.clientX, e.clientY]; v.idleAt = Date.now(); };
  el.onpointerup = el.onpointercancel = () => { v.dragging = false; v.idleAt = Date.now(); };
  el.onwheel = opts.fit ? null : e => { e.preventDefault(); v.zoom = Math.max(.7, Math.min(2.2, v.zoom * (e.deltaY < 0 ? 1.08 : .92))); };
  return {
    flip() { v.target.y += Math.PI; v.idleAt = Date.now(); },
    zoomIn() { v.zoom = Math.min(2.2, v.zoom * 1.15); },
    zoomOut() { v.zoom = Math.max(.7, v.zoom / 1.15); },
  };
}

// снимок целой ракетки (для профиля игрока)
export function racketShot(cfg) {
  return snapshot('R:' + JSON.stringify(cfg), cfg, { rx: -.12, ry: .45, rz: -.45, d: 50, y: -.6 }, 480);
}
export { emblem, thumb, buildRacket, buildEnv, light, shade };
