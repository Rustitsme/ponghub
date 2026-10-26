// QR-коды PongHub: логотип приложения в центре.
// Уровень защиты H — код читается, даже если закрыто до 30%; логотип с белой рамкой занимает ~5% площади.
const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const LOGO = '<rect width="120" height="120" rx="26" fill="#2563b8"/><g transform="translate(60 60) rotate(-24)"><ellipse rx="45" ry="16" fill="none" stroke="#e63946" stroke-width="6.5"/></g><circle cx="60" cy="60" r="22" fill="#fff"/><g transform="translate(60 60) rotate(-24)"><path d="M-45 0 A45 16 0 0 0 45 0" fill="none" stroke="#e63946" stroke-width="6.5" stroke-linecap="round"/></g>';

let lib = null;
function loadLib() {
  if (window.qrcode) return Promise.resolve();
  return lib ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIB; s.onload = res; s.onerror = () => { lib = null; rej(new Error('QR-код не загрузился. Проверьте интернет')); };
    document.head.appendChild(s);
  });
}

export async function makeQr(text) {
  await loadLib();
  const q = window.qrcode(0, 'H'); q.addData(text); q.make();
  return q;
}

// SVG-строка: вектор, годится для экрана, печати и скачивания. margin — белое поле в модулях.
export function qrSvg(q, { margin = 2, size: px = 0 } = {}) {
  const n = q.getModuleCount(), size = n + margin * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x + margin},${y + margin}h1v1h-1z`;
  const L = +(n * 0.17).toFixed(2), B = L + 2, c = size / 2;   // логотип и белая рамка вокруг него (по модулю с каждой стороны)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"${px ? ` width="${px}" height="${px}"` : ''} shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/>`
    + `<rect x="${c - B / 2}" y="${c - B / 2}" width="${B}" height="${B}" rx="${(B * 0.24).toFixed(2)}" fill="#fff" shape-rendering="geometricPrecision"/>`
    + `<g transform="translate(${c - L / 2} ${c - L / 2}) scale(${(L / 120).toFixed(4)})" shape-rendering="geometricPrecision">${LOGO}</g></svg>`;   // группа, а не вложенный svg: стили «.x svg {width:100%}» его не растянут
}

// PNG px×px (по умолчанию 3000) — для дизайнера и печати
export async function qrPng(q, px = 3000) {
  const url = URL.createObjectURL(new Blob([qrSvg(q, { margin: 4, size: px })], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = px;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, px, px);
    return await new Promise(res => c.toBlob(res, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

// нарисовать QR в элемент (подписи и ошибки — как раньше)
export async function drawQr(el, text, margin = 2) {
  if (!el) return;
  try { el.innerHTML = qrSvg(await makeQr(text), { margin }); } catch { el.innerHTML = '<div class="muted small">QR-код не загрузился</div>'; }
}
