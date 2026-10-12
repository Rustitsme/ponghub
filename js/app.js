import { createStore } from './store.js';
import {
  analyze, ranking, playerStats, ACHIEVEMENTS, insights, playerOfMonth, headToHead, validateSet,
  leagueOf, nextLeague, LEAGUES, DEFAULT_SETTINGS, ratingAt, setsFor, expected, marginFactor, winsNeeded, ts,
} from './engine.js';
import {
  FORMATS, koBracket, koPlacings, roundName, pairings, standings, snakeGroups, playoffSlots, slotsFromSeeds, findPairMatch,
} from './tourney.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const S = { store: null, user: null, me: null, data: null, A: null, rank: [], byId: new Map(), emails: new Map(), recovery: false, installEvt: null };
const DAY = 864e5;

// ───────────── Утилиты ─────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = id => S.byId.get(id) || { id, nickname: 'Удалён', avatar: '❔', color: '#666' };
const fmtR = r => (Math.round((r ?? 0) * 10) / 10).toFixed(1);
const fmtD = d => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2);
const fmtDate = (iso, o) => new Date(iso).toLocaleDateString('ru-RU', o || { day: 'numeric', month: 'short' });
const fmtDT = iso => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pct = x => Math.round((x || 0) * 100) + '%';
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
const toLocalInput = d => { const x = new Date(d); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const isAdmin = () => S.me?.role === 'admin' && S.me?.status === 'approved';
const isEditor = () => (S.me?.role === 'editor' || S.me?.role === 'admin') && S.me?.status === 'approved';
const ratingOf = id => S.A.rating.get(id) ?? S.A.S.initialRating;
const settings = () => ({ ...DEFAULT_SETTINGS, ...(S.data?.settings || {}) });
const tById = id => S.data.tournaments.find(t => t.id === id);

function ava(p, cls = '') {
  const inner = p.photo_url ? `<img src="${esc(p.photo_url)}" alt="" loading="lazy">` : esc(p.avatar || (p.nickname || '?')[0]);
  return `<span class="ava ${cls}" style="--c:${esc(p.color || '#e63946')}">${inner}</span>`;
}
function leagueBadge(r) { const l = leagueOf(r); return `<span class="league ${l.cls}">${l.name}</span>`; }
function roleBadge(p) { return p.role === 'admin' ? '<span class="role-badge owner">👑 Владелец</span>' : p.role === 'editor' ? '<span class="role-badge">✍️ Помощник</span>' : ''; }
function delta(d, cls = '') { if (d == null || Math.abs(d) < 0.005) return `<span class="delta zero ${cls}">0.00</span>`; return `<span class="delta ${d > 0 ? 'up' : 'down'} ${cls}">${fmtD(d)}</span>`; }

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

function openModal(html, onMount) {
  $modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="sheet-x" data-act="close" aria-label="Закрыть">✕</button>${html}</div>`;
  $modal.classList.add('open');
  document.body.classList.add('noscroll');
  onMount && onMount($modal.querySelector('.sheet'));
}
function closeModal() { $modal.classList.remove('open'); $modal.innerHTML = ''; document.body.classList.remove('noscroll'); }
function confirmDialog(text, okText = 'Да', danger = false) {
  return new Promise(res => {
    openModal(`<h3>Подтвердите</h3><p class="muted">${esc(text)}</p>
      <div class="row-btns"><button class="btn ghost" id="cf-no">Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-yes">${esc(okText)}</button></div>`, sh => {
      sh.querySelector('#cf-no').onclick = () => { closeModal(); res(false); };
      sh.querySelector('#cf-yes').onclick = () => { closeModal(); res(true); };
    });
  });
}
async function busy(btn, fn) {
  const old = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try { return await fn(); } catch (e) { toast(e.message || String(e), 'err'); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ───────────── Иконка приложения ─────────────
const ICON_VARIANTS = { hub: 'Хаб', table: 'Стол' };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
function iconChoice() { const v = S.data?.settings?.icon || lsGet('ponghub_icon'); return ICON_VARIANTS[v] ? v : 'hub'; }
const logo = () => `icons/${iconChoice()}.svg`;
function applyIcon() {
  const v = iconChoice();
  lsSet('ponghub_icon', v);
  const set = (id, href) => { const el = document.getElementById(id); if (el && !el.href.endsWith(href)) el.href = href; };
  set('l-manifest', `manifest-${v}.webmanifest`);
  set('l-icon', `icons/${v}.svg`);
  set('l-apple', `icons/${v}-apple.png`);
}

// ───────────── Тема ─────────────
function applyTheme() {
  let t = 'light';
  try { t = localStorage.getItem('ponghub_theme') || 'light'; } catch { /* */ }
  const real = t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = real;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', real === 'light' ? '#e9effa' : '#0f2540');
  return t;
}

// ───────────── Данные ─────────────
function derive() {
  const d = S.data;
  S.byId = new Map(d.profiles.map(p => [p.id, p]));
  S.me = S.user ? S.byId.get(S.user.id) || null : null;
  S.A = analyze(d.profiles.filter(p => p.status === 'approved' || p.status === 'archived'), d.matches, d.settings);
  S.rank = ranking(S.A, d.profiles);
  document.title = settings().clubName || 'PongHub';
  if (S.data.settings && S.data.settings.icon) applyIcon();
}
async function reload() {
  if (!S.user) { S.data = { profiles: [], matches: [], tournaments: [], events: [], settings: {} }; derive(); return; }
  try {
    S.data = await S.store.loadAll();
    if (isAdmin()) S.emails = await S.store.adminEmails();
  } catch (e) {
    toast(e.message, 'err');
    S.data = S.data || { profiles: [], matches: [], tournaments: [], events: [], settings: {} };
  }
  derive();
  if (isAdmin() && !S.emails.size) S.emails = await S.store.adminEmails();
}
async function refresh() { await reload(); render(); }

// ───────────── Роутер ─────────────
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'home', args: parts.slice(1), q: new URLSearchParams(q || '') };
}
const go = h => { if (location.hash === h) render(); else location.hash = h; };

let lastRoute = '';
function render() {
  const r = route();
  const key = location.hash;
  const keepScroll = key === lastRoute;
  const y = scrollY;
  lastRoute = key;
  let html;
  if (!S.user) html = authView(r);
  else if (S.recovery) html = recoveryView();
  else if (!S.me) html = gateView('🤔', 'Профиль не найден', 'Аккаунт создан, но профиль в базе отсутствует. Напишите администратору.');
  else if (S.me.status === 'pending') html = gateView('⏳', 'Заявка на рассмотрении', `Привет, <b>${esc(S.me.nickname)}</b>! Администратор клуба скоро подтвердит вашу регистрацию. Загляните позже.`, true);
  else if (S.me.status === 'rejected') html = gateView('🚫', 'Заявка отклонена', 'Администратор отклонил регистрацию. Если это ошибка — свяжитесь с ним лично.');
  else if (S.me.status === 'archived') html = gateView('📦', 'Профиль в архиве', 'Ваш профиль перенесён в архив. Свяжитесь с администратором.');
  else {
    const views = { home: viewHome, rating: viewRating, matches: viewMatches, player: viewPlayer, h2h: viewH2H, tournaments: viewTournaments, tournament: viewTournament, calendar: viewCalendar, admin: viewAdmin, rules: viewRules, me: viewMe, help: viewHelp };
    const v = views[r.name] || viewHome;
    html = shell(r, v(r));
  }
  $app.innerHTML = html;
  if (keepScroll) scrollTo(0, y); else scrollTo(0, 0);
  afterRender(r);
}

// ───────────── Каркас ─────────────
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  rating: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  matches: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/>',
  cup: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

function pendingCounts() {
  const users = isAdmin() ? S.data.profiles.filter(p => p.status === 'pending').length : 0;
  const matches = isEditor() ? S.data.matches.filter(m => m.status === 'pending').length : 0;
  return { users, matches, total: users + matches };
}

function shell(r, body) {
  const pc = pendingCounts();
  const tab = (name, label, ic, also = []) => `<a href="#/${name}" class="tab ${r.name === name || also.includes(r.name) ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`;
  const club = settings().clubName || 'PongHub';
  return `
  <header class="top">
    <a href="#/home" class="brand"><img src="${logo()}" alt="" width="30" height="30"><span>${esc(club)}</span></a>
    <div class="top-actions">
      ${S.store.mode === 'demo' ? '<span class="demo-pill" title="Данные хранятся только в этом браузере">ДЕМО</span>' : ''}
      <a href="#/calendar" class="icon-btn" aria-label="Календарь">${icon('cal')}</a>
      ${isEditor() ? `<a href="#/admin" class="icon-btn" aria-label="Управление">${icon('bell')}${pc.total ? `<i class="dot">${pc.total}</i>` : ''}</a>` : ''}
    </div>
  </header>
  <main class="page">${body}</main>
  <button class="fab" data-act="add-match" aria-label="${isEditor() ? 'Внести матч' : 'Отправить результат'}">${icon('plus')}</button>
  <nav class="tabs">
    ${tab('home', 'Главная', 'home')}
    ${tab('rating', 'Рейтинг', 'rating')}
    ${tab('matches', 'Матчи', 'matches', ['h2h'])}
    ${tab('tournaments', 'Турниры', 'cup', ['tournament'])}
    ${tab('me', 'Профиль', 'user', ['admin', 'rules'])}
  </nav>${iosInstallHint()}`;
}

function gateView(emoji, title, text, refreshBtn = false) {
  return `<div class="auth-wrap"><div class="auth-card center">
    <div class="gate-emoji">${emoji}</div><h2>${title}</h2><p class="muted">${text}</p>
    <div class="row-btns">${refreshBtn ? '<button class="btn primary" data-act="refresh">Проверить снова</button>' : ''}<button class="btn ghost" data-act="logout">Выйти</button></div>
  </div></div>`;
}

// ───────────── Вход / регистрация ─────────────
function authView(r) {
  const mode = ['register', 'forgot'].includes(r.name) ? r.name : 'login';
  const demo = S.store.mode === 'demo';
  const head = `<div class="auth-hero"><img src="${logo()}" alt="" width="84" height="84"><h1>PongHub</h1><p>Пинг-понг в нашем коворкинге: рейтинг, матчи, турниры</p></div>`;
  let form;
  if (mode === 'register') form = `
    <form data-form="register" class="stack">
      <h2>Регистрация</h2>
      <label>Ник (будет виден в рейтинге)<input name="nickname" required minlength="2" maxlength="20" pattern="[A-Za-zА-Яа-яЁё0-9_\\-. ]+" autocomplete="nickname"></label>
      <label>Имя и фамилия<input name="full_name" required maxlength="60" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Пароль<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
      <button class="btn primary big">Зарегистрироваться</button>
      <p class="muted small center">После регистрации администратор клуба подтвердит вашу заявку.</p>
      <a href="#/login" class="link center">Уже есть аккаунт? Войти</a>
    </form>`;
  else if (mode === 'forgot') form = `
    <form data-form="forgot" class="stack">
      <h2>Восстановление пароля</h2>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <button class="btn primary big">Отправить ссылку</button>
      <a href="#/login" class="link center">Назад ко входу</a>
    </form>`;
  else form = `
    <form data-form="login" class="stack">
      <h2>Вход</h2>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Пароль<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary big">Войти</button>
      <div class="split"><a href="#/register" class="link">Регистрация</a><a href="#/forgot" class="link">Забыли пароль?</a></div>
    </form>`;
  const demoBox = demo ? `
    <div class="auth-card demo-box">
      <h3>Демо-режим</h3>
      <p class="muted small">База ещё не подключена — это пробная версия с выдуманными игроками. Посмотрите приложение глазами разных ролей:</p>
      <div class="demo-grid">
        <button class="btn" data-act="demo-as" data-id="demo-1">👑 Админ</button>
        <button class="btn" data-act="demo-as" data-id="demo-2">✍️ Помощник</button>
        <button class="btn" data-act="demo-as" data-id="demo-4">🏓 Игрок</button>
        <button class="btn" data-act="demo-as" data-id="demo-9">⏳ Новичок</button>
      </div>
    </div>` : '';
  return `<div class="auth-wrap">${head}<div class="auth-card">${form}</div>${demoBox}</div>${iosInstallHint(true)}`;
}

function recoveryView() {
  return `<div class="auth-wrap"><div class="auth-card"><form data-form="newpass" class="stack">
    <h2>Новый пароль</h2>
    <label>Пароль<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
    <button class="btn primary big">Сохранить</button></form></div></div>`;
}

// ───────────── Компоненты ─────────────
function matchCard(m, ctx = null) {
  const a = P(m.player1_id), b = P(m.player2_id);
  const d = S.A.md.get(m.id);
  const t = m.tournament_id ? tById(m.tournament_id) : null;
  const w1 = m.winner_id === m.player1_id;
  const side = (p, won, right) => `<div class="mp ${won ? 'win' : ''} ${right ? 'right' : ''}">
      ${right ? '' : ava(p, 'sm')}<span class="nick">${esc(p.nickname)}</span>${right ? ava(p, 'sm') : ''}
      ${d ? `<small>${delta(d.delta[p.id])}</small>` : ''}</div>`;
  const sets = (m.sets || []).map(s => `<span class="${s[0] > s[1] ? 'l' : 'r'}">${s[0]}:${s[1]}</span>`).join('');
  const status = m.status === 'pending' ? '<span class="badge warn">ждёт подтверждения</span>' : m.status === 'rejected' ? '<span class="badge bad">отклонён</span>' : '';
  const hl = ctx ? (m.winner_id === ctx ? 'hl-win' : 'hl-loss') : '';
  return `<div class="mcard ${hl}" data-act="match" data-id="${m.id}">
    <div class="mmeta"><span class="badge ${m.type === 'tournament' ? 'tour' : 'free'}">${m.type === 'tournament' ? 'Турнир' : 'Свободная'}</span>
      ${t ? `<span class="tname">${esc(t.name)}</span>` : ''}${status}<span class="mdate">${fmtDT(m.played_at)}</span></div>
    <div class="mrow">${side(a, w1, false)}<div class="mscore"><b class="${w1 ? 'w' : ''}">${m.sets1 ?? '-'}</b>:<b class="${!w1 ? 'w' : ''}">${m.sets2 ?? '-'}</b></div>${side(b, !w1, true)}</div>
    ${sets ? `<div class="msets">${sets}</div>` : ''}
  </div>`;
}

function lineChart(points, h = 160) {
  if (points.length < 2) return '<div class="empty small">График появится после первого матча</div>';
  const W = 340, H = h, pl = 36, pr = 12, pt = 14, pb = 20;
  const ys = points.map(p => p.r);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 4) { const c = (max + min) / 2; min = c - 2; max = c + 2; }
  const padY = (max - min) * 0.12; min -= padY; max += padY;
  const X = i => pl + (W - pl - pr) * i / (points.length - 1);
  const Y = v => pt + (H - pt - pb) * (1 - (v - min) / (max - min));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.r).toFixed(1)}`).join('');
  const area = `${line}L${X(points.length - 1).toFixed(1)},${H - pb}L${pl},${H - pb}Z`;
  const grid = [0, 0.5, 1].map(k => { const v = min + (max - min) * k; const y = Y(v); return `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="grid"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end" class="axis">${fmtR(v)}</text>`; }).join('');
  const last = points[points.length - 1];
  const dots = points.length <= 40 ? points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.r)}" r="2.2" class="pt"/>`).join('') : '';
  const first = points.find(p => p.t) || points[1];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="График рейтинга">
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--red)" stop-opacity=".35"/><stop offset="1" stop-color="var(--red)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#cg)"/><path d="${line}" class="ln"/>${dots}
    <circle cx="${X(points.length - 1)}" cy="${Y(last.r)}" r="5" class="pt-last"/>
    <text x="${pl}" y="${H - 4}" class="axis">${first.t ? fmtDate(first.t) : ''}</text>
    <text x="${W - pr}" y="${H - 4}" text-anchor="end" class="axis">${last.t ? fmtDate(last.t) : ''}</text>
  </svg>`;
}

function sparkline(points) {
  if (points.length < 2) return '';
  const W = 90, H = 30, ys = points.map(p => p.r);
  const min = Math.min(...ys), max = Math.max(...ys) || 1, rng = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(W * i / (points.length - 1)).toFixed(1)},${(H - 3 - (H - 6) * (p.r - min) / rng).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="spark"><path d="${d}"/></svg>`;
}

function bar(label, w, l) {
  const n = w + l;
  const p = n ? w / n : 0;
  return `<div class="bar-row"><div class="bar-lbl"><span>${label}</span><b>${n ? `${w}–${l} · ${pct(p)}` : '—'}</b></div>
    <div class="bar"><i style="width:${n ? p * 100 : 0}%"></i></div></div>`;
}

function formDots(form) {
  return `<div class="form">${form.map(x => `<i class="${x === 'W' ? 'w' : 'l'}">${x === 'W' ? 'В' : 'П'}</i>`).join('') || '<span class="muted small">нет матчей</span>'}</div>`;
}

const visibleMatch = m => m.status === 'approved' || isEditor() || m.submitted_by === S.me.id || m.player1_id === S.me.id || m.player2_id === S.me.id;

// ───────────── Главная ─────────────
function viewHome() {
  const me = S.me;
  const r = ratingOf(me.id);
  const pos = S.rank.findIndex(x => x.p.id === me.id) + 1;
  const total = S.rank.length;
  const hist = S.A.history.get(me.id) || [];
  const d30 = r - ratingAt(S.A, me.id, Date.now() - 30 * DAY);
  const st = playerStats(me.id, S.A, S.data.tournaments);
  const nl = nextLeague(r);
  const pom = playerOfMonth(S.A, S.data.profiles);
  const pc = pendingCounts();
  const recent = S.data.matches.filter(m => m.status === 'approved').sort((a, b) => ts(b) - ts(a)).slice(0, 6);
  const upcoming = upcomingItems().slice(0, 3);
  const active = S.data.tournaments.filter(t => t.status === 'active');
  const mine = S.data.matches.filter(m => m.status === 'pending' && m.submitted_by === me.id);

  return `
  <section class="hero table-card">
    <div class="hero-top">
      ${ava(me, 'lg')}
      <div class="hero-id"><div class="hello">Привет,</div><div class="hero-nick">${esc(me.nickname)}</div><div class="badges">${leagueBadge(r)}${roleBadge(me)}</div></div>
      <div class="hero-rank"><small>место</small><b>${st.matches ? pos : '—'}</b><small>из ${total}</small></div>
    </div>
    <div class="hero-mid">
      <div><div class="big-num">${fmtR(r)}</div><div class="muted small">рейтинг · ${delta(d30)} за 30 дней</div></div>
      ${sparkline(hist.slice(-20))}
    </div>
    <div class="hero-stats">
      <div><b>${st.wins}</b><small>побед</small></div><div><b>${st.losses}</b><small>поражений</small></div>
      <div><b>${pct(st.winRate)}</b><small>% побед</small></div>
      <div><b>${st.streakType === 'W' ? '🔥' + st.streak : st.streak ? '−' + st.streak : '0'}</b><small>серия</small></div>
    </div>
    ${nl ? `<div class="next-league"><span>До лиги «${nl.name}»: ${fmtR(nl.min - r)}</span><div class="bar thin"><i style="width:${Math.max(4, Math.min(100, 100 - (nl.min - r) * 5))}%"></i></div></div>` : ''}
    <a href="#/player/${me.id}" class="btn ghost-light full">Моя статистика и анализ →</a>
  </section>

  ${pc.total ? `<a href="#/admin" class="alert">🔔 Ждут вашего решения: ${pc.users ? `${pc.users} ${plural(pc.users, 'заявка', 'заявки', 'заявок')} на регистрацию` : ''}${pc.users && pc.matches ? ', ' : ''}${pc.matches ? `${pc.matches} ${plural(pc.matches, 'матч', 'матча', 'матчей')}` : ''} →</a>` : ''}
  ${mine.length ? `<div class="alert info">⏳ ${mine.length} ${plural(mine.length, 'ваш результат ждёт', 'ваших результата ждут', 'ваших результатов ждут')} подтверждения администратором</div>` : ''}

  ${active.map(t => `<a href="#/tournament/${t.id}" class="card live-t"><span class="live">● LIVE</span><div><b>${esc(t.name)}</b><div class="muted small">${FORMATS[t.format]} · ${t.participants.length} участников</div></div><span>→</span></a>`).join('')}

  ${pom ? `<section class="card pom" data-act="go" data-href="#/player/${pom.id}">
    <div class="pom-badge">⭐ Игрок месяца</div>
    <div class="pom-row">${ava(P(pom.id), 'md')}<div><b>${esc(P(pom.id).nickname)}</b><div class="muted small">прибавил ${fmtD(pom.g)} за ${new Date().toLocaleDateString('ru-RU', { month: 'long' })}</div></div></div>
  </section>` : ''}

  <section class="card">
    <div class="card-h"><h3>Топ-5</h3><a href="#/rating" class="link">Весь рейтинг →</a></div>
    ${S.rank.slice(0, 5).map((x, i) => rankRow(x, i)).join('') || '<div class="empty">Пока нет игроков</div>'}
  </section>

  ${upcoming.length ? `<section class="card"><div class="card-h"><h3>Ближайшие события</h3><a href="#/calendar" class="link">Календарь →</a></div>${upcoming.map(eventRow).join('')}</section>` : ''}

  <section>
    <div class="sec-h"><h3>Последние матчи</h3><a href="#/matches" class="link">Все →</a></div>
    ${recent.map(m => matchCard(m)).join('') || '<div class="empty">Матчей пока нет. Нажмите «+», чтобы внести первый.</div>'}
  </section>`;
}

function rankRow(x, i) {
  const p = x.p;
  const d = x.r - ratingAt(S.A, p.id, Date.now() - 30 * DAY);
  const st = S.A.played.reduce((a, m) => { if (m.player1_id === p.id || m.player2_id === p.id) m.winner_id === p.id ? a.w++ : a.l++; return a; }, { w: 0, l: 0 });
  const medal = x.g ? ['🥇', '🥈', '🥉'][i] : null;
  return `<a href="#/player/${p.id}" class="rank-row ${p.id === S.me.id ? 'me' : ''}">
    <span class="pos">${medal || (x.g ? i + 1 : '–')}</span>${ava(p, 'sm')}
    <span class="rn"><b>${esc(p.nickname)}</b><small>${x.g ? `${st.w}В · ${st.l}П · ${pct(st.w / (x.g || 1))}` : 'нет матчей'}</small></span>
    <span class="rr"><b>${fmtR(x.r)}</b>${x.g ? delta(d, 'xs') : ''}</span></a>`;
}

// ───────────── Рейтинг ─────────────
function viewRating() {
  const top = S.rank.filter(x => x.g).slice(0, 3);
  const podium = top.length === 3 ? `
    <div class="podium">
      ${[1, 0, 2].map(i => { const x = top[i]; return `<a href="#/player/${x.p.id}" class="pod p${i + 1}">${ava(x.p, i === 0 ? 'lg' : 'md')}<b>${esc(x.p.nickname)}</b><span>${fmtR(x.r)}</span><div class="step">${i + 1}</div></a>`; }).join('')}
    </div>` : '';
  const byLeague = [...LEAGUES].reverse().map(l => {
    const list = S.rank.map((x, i) => ({ x, i })).filter(({ x }) => x.g && leagueOf(x.r).cls === l.cls);
    return list.length ? `<div class="league-h"><span class="league ${l.cls}">${l.name}</span><small class="muted">${l.min === -Infinity ? `до ${LEAGUES[1].min}` : `от ${l.min}`}</small></div>${list.map(({ x, i }) => rankRow(x, i)).join('')}` : '';
  }).join('');
  const none = S.rank.filter(x => !x.g);
  return `
  <div class="page-h"><h1>Рейтинг</h1><a href="#/rules" class="link">Как считается?</a></div>
  ${podium}
  <section class="card">${byLeague || '<div class="empty">Пока никто не сыграл ни одного матча</div>'}</section>
  ${none.length ? `<section class="card"><div class="card-h"><h3>Ещё без матчей</h3></div>${none.map(x => rankRow(x, 0)).join('')}</section>` : ''}`;
}

// ───────────── Матчи ─────────────
function viewMatches(r) {
  const type = r.q.get('type') || 'all';
  const pl = r.q.get('p') || '';
  let list = S.data.matches.filter(visibleMatch);
  if (type !== 'all') list = list.filter(m => m.type === type);
  if (pl) list = list.filter(m => m.player1_id === pl || m.player2_id === pl);
  list.sort((a, b) => ts(b) - ts(a));
  const groups = new Map();
  for (const m of list) { const k = fmtDate(m.played_at, { day: 'numeric', month: 'long', year: 'numeric' }); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const qs = (t, p) => `#/matches?type=${t}${p ? '&p=' + p : ''}`;
  const players = S.data.profiles.filter(p => p.status === 'approved').sort((a, b) => a.nickname.localeCompare(b.nickname));
  return `
  <div class="page-h"><h1>Матчи</h1><button class="btn sm" data-act="h2h-pick">⚔️ Личные встречи</button></div>
  <div class="seg">
    <a href="${qs('all', pl)}" class="${type === 'all' ? 'on' : ''}">Все</a>
    <a href="${qs('free', pl)}" class="${type === 'free' ? 'on' : ''}">Свободные</a>
    <a href="${qs('tournament', pl)}" class="${type === 'tournament' ? 'on' : ''}">Турнирные</a>
  </div>
  <select class="filter" data-act-change="filter-player" data-type="${type}">
    <option value="">Все игроки</option>${players.map(p => `<option value="${p.id}" ${p.id === pl ? 'selected' : ''}>${esc(p.nickname)}</option>`).join('')}
  </select>
  ${[...groups].map(([k, ms]) => `<div class="day-h">${k}</div>${ms.map(m => matchCard(m, pl || null)).join('')}`).join('') || '<div class="empty">Матчей не найдено</div>'}`;
}

// ───────────── Игрок ─────────────
function viewPlayer(r) {
  const id = r.args[0] || S.me.id;
  const p = S.byId.get(id);
  if (!p) return '<div class="empty">Игрок не найден</div>';
  const st = playerStats(id, S.A, S.data.tournaments);
  const rt = ratingOf(id);
  const pos = S.rank.findIndex(x => x.p.id === id) + 1;
  const hist = S.A.history.get(id) || [];
  const nl = nextLeague(rt);
  const ins = insights(st);
  const opps = [...st.opponents].map(([oid, o]) => ({ oid, ...o })).sort((a, b) => (b.w + b.l) - (a.w + a.l));
  const unlocked = ACHIEVEMENTS.filter(a => a.test(st));
  const medalsTotal = st.medals.gold + st.medals.silver + st.medals.bronze;
  const mine = id === S.me.id;
  const hand = p.hand === 'left' ? 'Левша' : p.hand === 'right' ? 'Правша' : '';

  return `
  <section class="hero table-card">
    <div class="hero-top">
      ${ava(p, 'lg')}
      <div class="hero-id"><div class="hero-nick">${esc(p.nickname)}</div><div class="muted small">${esc(p.full_name || '')}${hand ? ' · ' + hand : ''}</div><div class="badges">${leagueBadge(rt)}${roleBadge(p)}</div></div>
      <div class="hero-rank"><small>место</small><b>${st.matches ? pos : '—'}</b><small>из ${S.rank.length}</small></div>
    </div>
    ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
    <div class="hero-mid"><div><div class="big-num">${fmtR(rt)}</div><div class="muted small">пик ${fmtR(st.peak)} · старт ${fmtR(hist[0]?.r)}</div></div>
      ${medalsTotal ? `<div class="medals">${'🥇'.repeat(st.medals.gold)}${'🥈'.repeat(st.medals.silver)}${'🥉'.repeat(st.medals.bronze)}</div>` : ''}</div>
    ${nl ? `<div class="next-league"><span>До лиги «${nl.name}»: ${fmtR(nl.min - rt)}</span><div class="bar thin"><i style="width:${Math.max(4, Math.min(100, 100 - (nl.min - rt) * 5))}%"></i></div></div>` : ''}
    <div class="row-btns">
      ${mine ? '<button class="btn ghost-light" data-act="edit-profile">✏️ Редактировать</button>' : `<a class="btn ghost-light" href="#/h2h/${S.me.id}/${id}">⚔️ Сравнить со мной</a>`}
    </div>
  </section>

  <section class="stat-grid">
    <div><b>${st.matches}</b><small>матчей</small></div>
    <div><b class="up">${st.wins}</b><small>побед</small></div>
    <div><b class="down">${st.losses}</b><small>поражений</small></div>
    <div><b>${pct(st.winRate)}</b><small>% побед</small></div>
    <div><b>${st.setsW}:${st.setsL}</b><small>партии</small></div>
    <div><b>${st.streakType === 'W' ? '🔥' + st.streak : st.streak ? '−' + st.streak : 0}</b><small>серия</small></div>
    <div><b>${st.bestStreak}</b><small>лучшая серия</small></div>
    <div><b>${st.tournamentsPlayed}</b><small>турниров</small></div>
  </section>

  <section class="card"><div class="card-h"><h3>Динамика рейтинга</h3></div>${lineChart(hist)}
    <div class="card-h mt"><h3>Форма (последние 10)</h3></div>${formDots(st.form)}</section>

  <section class="card"><div class="card-h"><h3>📊 Анализ игры</h3></div>
    <div class="insights">${ins.map(x => `<div class="ins ${x.tone}">${x.tone === 'good' ? '✅' : x.tone === 'bad' ? '⚠️' : '💡'} ${esc(x.text)}</div>`).join('')}</div>
    ${bar('Решающие партии', st.deciderW, st.deciderL)}
    ${bar('Партии на балансе', st.closeW, st.closeL)}
    ${bar('Против сильных (рейтинг на 5+ выше)', st.strongW, st.strongL)}
    ${bar('Против равных', st.equalW, st.equalL)}
    ${bar('Против слабее (на 5+ ниже)', st.weakW, st.weakL)}
    ${bar('Турнирные матчи', st.tourW, st.tourL)}
    ${bar('Свободные игры', st.freeW, st.freeL)}
    ${st.ptsW + st.ptsL ? `<div class="muted small mt">Очки в партиях: ${st.ptsW}:${st.ptsL} (${pct(st.ptsW / (st.ptsW + st.ptsL))} розыгрышей выиграно)</div>` : ''}
  </section>

  <section class="card"><div class="card-h"><h3>🏅 Достижения</h3><span class="muted small">${unlocked.length} из ${ACHIEVEMENTS.length}</span></div>
    <div class="ach-grid">${ACHIEVEMENTS.map(a => { const ok = a.test(st); const pr = !ok && a.prog ? a.prog(st) : null; return `<div class="ach ${ok ? 'ok' : ''}" title="${esc(a.desc)}"><span class="ach-i">${a.icon}</span><b>${a.name}</b><small>${esc(a.desc)}</small>${pr ? `<div class="bar thin"><i style="width:${Math.min(100, pr[0] / pr[1] * 100)}%"></i></div><small>${pr[0]}/${pr[1]}</small>` : ''}</div>`; }).join('')}</div>
  </section>

  ${opps.length ? `<section class="card"><div class="card-h"><h3>Соперники</h3></div>
    ${opps.map(o => { const op = P(o.oid); return `<a href="#/h2h/${id}/${o.oid}" class="opp-row">${ava(op, 'sm')}<span class="rn"><b>${esc(op.nickname)}</b><small>${o.w + o.l} ${plural(o.w + o.l, 'матч', 'матча', 'матчей')}</small></span><span class="h2h-score"><b class="up">${o.w}</b>:<b class="down">${o.l}</b></span></a>`; }).join('')}
  </section>` : ''}

  <section><div class="sec-h"><h3>История матчей</h3></div>
    ${[...st.list].reverse().slice(0, 30).map(m => matchCard(m, id)).join('') || '<div class="empty">Матчей пока нет</div>'}
    ${st.list.length > 30 ? `<a href="#/matches?type=all&p=${id}" class="btn ghost full">Показать все ${st.list.length}</a>` : ''}
  </section>`;
}

// ───────────── Личные встречи ─────────────
function viewH2H(r) {
  const players = S.data.profiles.filter(p => p.status === 'approved' || p.status === 'archived').sort((a, b) => a.nickname.localeCompare(b.nickname));
  const a = r.args[0] || S.me.id, b = r.args[1] || '';
  const sel = (name, v) => `<select data-act-change="h2h-sel" data-side="${name}"><option value="">— выберите —</option>${players.map(p => `<option value="${p.id}" ${p.id === v ? 'selected' : ''}>${esc(p.nickname)}</option>`).join('')}</select>`;
  let body = '<div class="empty">Выберите двух игроков</div>';
  if (a && b && a !== b) {
    const h = headToHead(S.A, a, b);
    const pa = P(a), pb = P(b);
    const ra = ratingOf(a), rb = ratingOf(b);
    const chance = expected(ra, rb, S.A.S.spread);
    body = `
    <section class="card h2h">
      <div class="h2h-top">
        <a href="#/player/${a}" class="h2h-p">${ava(pa, 'lg')}<b>${esc(pa.nickname)}</b><small>${fmtR(ra)}</small></a>
        <div class="h2h-big"><b class="${h.wa > h.wb ? 'up' : ''}">${h.wa}</b><span>:</span><b class="${h.wb > h.wa ? 'up' : ''}">${h.wb}</b><small>по матчам</small></div>
        <a href="#/player/${b}" class="h2h-p">${ava(pb, 'lg')}<b>${esc(pb.nickname)}</b><small>${fmtR(rb)}</small></a>
      </div>
      <div class="muted small center">По партиям ${h.sa}:${h.sb}</div>
      <div class="chance"><div class="chance-bar"><i style="width:${chance * 100}%"></i></div>
        <div class="split small"><span>${pct(chance)}</span><span class="muted">шанс победы по рейтингу</span><span>${pct(1 - chance)}</span></div></div>
    </section>
    ${[...h.ms].reverse().map(m => matchCard(m, a)).join('') || '<div class="empty">Эти игроки ещё не встречались</div>'}`;
  }
  return `<div class="page-h"><h1>Личные встречи</h1></div>
    <div class="h2h-sel">${sel('a', a)}<span>vs</span>${sel('b', b)}</div>${body}`;
}

// ───────────── Турниры ─────────────
function viewTournaments() {
  const ts2 = [...S.data.tournaments].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const active = ts2.filter(t => t.status === 'active'), done = ts2.filter(t => t.status === 'finished');
  const card = t => {
    const r = t.results;
    return `<a href="#/tournament/${t.id}" class="card t-card">
      <div class="t-ic">${t.status === 'active' ? '🏓' : '🏆'}</div>
      <div class="t-body"><b>${esc(t.name)}</b><small class="muted">${t.date ? fmtDate(t.date, { day: 'numeric', month: 'long', year: 'numeric' }) : ''} · ${t.participants.length} уч. · ${FORMATS[t.format].split(' (')[0]}</small>
      ${r && r.gold ? `<small>🥇 ${esc(P(r.gold).nickname)}${r.silver ? ` · 🥈 ${esc(P(r.silver).nickname)}` : ''}${(r.bronze || []).length ? ` · 🥉 ${r.bronze.map(x => esc(P(x).nickname)).join(', ')}` : ''}</small>` : ''}</div>
      ${t.status === 'active' ? '<span class="live">● идёт</span>' : ''}</a>`;
  };
  return `<div class="page-h"><h1>Турниры</h1>${isEditor() ? '<button class="btn primary sm" data-act="new-tournament">+ Создать</button>' : ''}</div>
    ${active.length ? `<div class="sec-h"><h3>Идут сейчас</h3></div>${active.map(card).join('')}` : ''}
    <div class="sec-h"><h3>Архив</h3></div>${done.map(card).join('') || '<div class="empty">Завершённых турниров пока нет</div>'}`;
}

function tMatches(t) { return S.data.matches.filter(m => m.tournament_id === t.id && m.status !== 'rejected'); }

function koBlock(t, slots, ms) {
  const br = koBracket(slots, ms, t.config.thirdPlace);
  const can = isEditor() && t.status === 'active';
  const cell = (c, label) => {
    const m = c.match;
    const sc = id => (m && m.status === 'approved' ? (id === m.player1_id ? m.sets1 : m.sets2) : '');
    const line = (id, bye) => id ? `<div class="bp ${c.winner === id && !c.bye ? 'w' : ''}">${ava(P(id), 'xs')}<span>${esc(P(id).nickname)}</span><b>${sc(id)}</b></div>`
      : `<div class="bp tbd">${bye ? 'свободный проход' : 'ожидается'}</div>`;
    const clickable = (c.a && c.b) && (can || m);
    const isByeA = c.r === 0 && !c.a, isByeB = c.r === 0 && !c.b;
    return `<div class="bcell ${clickable ? 'click' : ''} ${c.conflict ? 'conflict' : ''} ${c.bye ? 'bye' : ''} ${m && m.status === 'pending' ? 'pending' : ''}"
      ${clickable || (c.conflict && can) ? `data-act="kocell" data-t="${t.id}" data-r="${c.r}" data-i="${c.i ?? 0}"` : ''}>
      ${label ? `<div class="blabel">${label}</div>` : ''}${line(c.a, isByeA)}${line(c.b, isByeB)}
      ${c.conflict ? '<div class="bwarn">⚠️ Результат устарел — нажмите, чтобы удалить</div>' : ''}
      ${can && c.a && c.b && !m && !c.conflict ? '<div class="benter">Внести счёт</div>' : ''}</div>`;
  };
  const cols = br.rounds.map((row, r) => `<div class="bcol"><div class="bcol-h">${roundName(r, br.rounds.length)}</div><div class="bcol-b">${row.map(c => cell(c)).join('')}</div></div>`).join('');
  return { br, html: `<div class="bracket-wrap"><div class="bracket">${cols}</div></div>${br.third ? `<div class="third"><div class="bcol-h">Матч за 3-е место</div>${cell({ ...br.third, r: 'third', i: 0 })}</div>` : ''}` };
}

function rrBlock(t, ids, ms, stage, grp = null, title = '') {
  const st = standings(ids, ms.filter(m => m.stage === stage && (grp === null || m.grp === grp)));
  const can = isEditor() && t.status === 'active';
  const table = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th class="l">Игрок</th><th>И</th><th>В</th><th>П</th><th>Партии</th><th>Очки</th></tr></thead><tbody>
    ${st.list.map((x, i) => `<tr class="${grp !== null && i < (t.config.advance || 2) ? 'adv' : ''}"><td>${i + 1}</td><td class="l"><a href="#/player/${x.id}">${ava(P(x.id), 'xs')} ${esc(P(x.id).nickname)}</a></td><td>${x.p}</td><td>${x.w}</td><td>${x.l}</td><td>${x.sw}:${x.sl}</td><td><b>${x.pts}</b></td></tr>`).join('')}
  </tbody></table></div>`;
  const fixtures = pairings(ids).map(([a, b]) => {
    const m = findPairMatch(ms, stage, a, b, grp);
    const done = m && m.status === 'approved';
    const w = done ? m.winner_id : null;
    const sa = done ? (m.player1_id === a ? m.sets1 : m.sets2) : '', sb = done ? (m.player1_id === a ? m.sets2 : m.sets1) : '';
    const act = m ? `data-act="match" data-id="${m.id}"` : can ? `data-act="fixture" data-t="${t.id}" data-a="${a}" data-b="${b}" data-stage="${stage}" data-grp="${grp ?? ''}"` : '';
    return `<div class="fx ${act ? 'click' : ''} ${done ? 'done' : ''}" ${act}>
      <span class="${w === a ? 'w' : ''}">${esc(P(a).nickname)}</span>
      <b>${done ? `${sa}:${sb}` : m ? '⏳' : can ? '+' : '–'}</b>
      <span class="${w === b ? 'w' : ''} r">${esc(P(b).nickname)}</span></div>`;
  }).join('');
  return { st, html: `${title ? `<h3 class="grp-h">${title}</h3>` : ''}${table}<details class="fixtures" ${can && !st.complete ? 'open' : ''}><summary>Матчи · сыграно ${st.played} из ${st.total}</summary><div class="fx-list">${fixtures}</div></details>` };
}

function tournamentPlacings(t) {
  const ms = tMatches(t);
  if (t.format === 'ko') return koPlacings(koBracket(t.config.slots, ms, t.config.thirdPlace));
  if (t.format === 'groups') return t.config.slots ? koPlacings(koBracket(t.config.slots, ms.filter(m => m.stage === 'ko' || m.stage === 'ko3'), t.config.thirdPlace)) : null;
  const st = standings(t.participants, ms.filter(m => m.stage === 'rr'));
  if (!st.played) return null;
  return { gold: st.list[0]?.id, silver: st.list[1]?.id, bronze: st.list[2] ? [st.list[2].id] : [], incomplete: !st.complete };
}

function viewTournament(r) {
  const t = tById(r.args[0]);
  if (!t) return '<div class="empty">Турнир не найден</div>';
  const ms = tMatches(t);
  const can = isEditor();
  let body = '';
  if (t.format === 'ko') body = `<section class="card">${koBlock(t, t.config.slots, ms).html}</section>`;
  else if (t.format === 'rr') body = `<section class="card">${rrBlock(t, t.participants, ms, 'rr').html}</section>`;
  else {
    const blocks = (t.config.groups || []).map((g, i) => rrBlock(t, g, ms, 'grp', i, `Группа ${String.fromCharCode(1040 + i)}`));
    const allDone = blocks.every(b => b.st.complete);
    const koStarted = ms.some(m => m.stage === 'ko');
    body = `<section class="card">${blocks.map(b => b.html).join('<hr>')}</section>
      <section class="card"><div class="card-h"><h3>Плей-офф</h3>${can && t.status === 'active' && !koStarted ? `<button class="btn sm ${allDone ? 'primary' : ''}" data-act="make-playoff" data-t="${t.id}">${t.config.slots ? 'Пересобрать' : 'Сформировать'}</button>` : ''}</div>
      ${t.config.slots ? koBlock(t, t.config.slots, ms.filter(m => m.stage === 'ko' || m.stage === 'ko3')).html : `<div class="empty small">Сетка появится после группового этапа. Из каждой группы выходят ${t.config.advance || 2}.</div>`}</section>`;
  }
  const pl = t.status === 'active' ? tournamentPlacings(t) : null;
  const res = t.results;
  return `
  <div class="page-h"><a href="#/tournaments" class="back">← Турниры</a></div>
  <section class="hero table-card t-hero">
    <div class="t-title"><h1>${esc(t.name)}</h1>${t.status === 'active' ? '<span class="live">● идёт</span>' : '<span class="badge">завершён</span>'}</div>
    <div class="muted small">${t.date ? fmtDate(t.date, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}${t.place ? ' · ' + esc(t.place) : ''}</div>
    <div class="chips"><span class="chip">${FORMATS[t.format]}</span><span class="chip">до ${winsNeeded(t.best_of)} ${plural(winsNeeded(t.best_of), 'победы', 'побед', 'побед')} в партиях</span><span class="chip">партия до ${t.points_to}</span><span class="chip">${t.participants.length} участников</span></div>
    ${res && res.gold ? `<div class="t-podium"><div>🥇 <b>${esc(P(res.gold).nickname)}</b></div>${res.silver ? `<div>🥈 ${esc(P(res.silver).nickname)}</div>` : ''}${(res.bronze || []).map(x => `<div>🥉 ${esc(P(x).nickname)}</div>`).join('')}</div>` : ''}
  </section>
  ${body}
  ${can ? `<section class="card admin-actions">
    ${t.status === 'active' ? `<button class="btn primary" data-act="finish-t" data-t="${t.id}" ${pl ? '' : 'disabled'}>🏁 Завершить турнир</button>${pl ? '' : '<p class="muted small">Завершить можно, когда определится победитель.</p>'}` : `<button class="btn" data-act="reopen-t" data-t="${t.id}">↩︎ Возобновить</button>`}
    <button class="btn danger ghost" data-act="del-t" data-t="${t.id}">Удалить турнир</button></section>` : ''}
  <div class="sec-h"><h3>Участники</h3></div>
  <div class="chips people">${t.participants.map(id => `<a href="#/player/${id}" class="chip">${ava(P(id), 'xs')} ${esc(P(id).nickname)}</a>`).join('')}</div>`;
}

// ───────────── Календарь ─────────────
function upcomingItems() {
  const now = Date.now() - 3 * 36e5;
  const ev = S.data.events.filter(e => Date.parse(e.starts_at) >= now).map(e => ({ kind: 'event', t: Date.parse(e.starts_at), e }));
  return ev.sort((a, b) => a.t - b.t);
}
function eventRow(it) {
  const e = it.e;
  const going = (e.attendees || []).includes(S.me.id);
  const d = new Date(e.starts_at);
  return `<div class="ev">
    <div class="ev-date"><b>${d.getDate()}</b><small>${d.toLocaleDateString('ru-RU', { month: 'short' })}</small></div>
    <div class="ev-body"><b>${esc(e.title)}</b><small class="muted">${d.toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}${e.place ? ' · ' + esc(e.place) : ''}</small>
      ${e.note ? `<small>${esc(e.note)}</small>` : ''}
      <div class="ev-people">${(e.attendees || []).map(id => ava(P(id), 'xs')).join('')}<small class="muted">${(e.attendees || []).length ? `${e.attendees.length} ${plural(e.attendees.length, 'идёт', 'идут', 'идут')}` : 'пока никто не отметился'}</small></div></div>
    <div class="ev-act"><button class="btn sm ${going ? 'primary' : ''}" data-act="rsvp" data-id="${e.id}">${going ? '✓ Иду' : 'Пойду'}</button>
      ${isEditor() ? `<button class="btn xs ghost" data-act="del-event" data-id="${e.id}">Удалить</button>` : ''}</div>
  </div>`;
}
function viewCalendar() {
  const up = upcomingItems();
  const past = S.data.events.filter(e => Date.parse(e.starts_at) < Date.now() - 3 * 36e5).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)).slice(0, 10);
  return `<div class="page-h"><h1>Календарь</h1>${isEditor() ? '<button class="btn primary sm" data-act="new-event">+ Событие</button>' : ''}</div>
    <section class="card">${up.map(eventRow).join('') || '<div class="empty">Ближайших событий нет</div>'}</section>
    ${past.length ? `<details class="card"><summary>Прошедшие</summary>${past.map(e => eventRow({ e })).join('')}</details>` : ''}`;
}

// ───────────── Правила рейтинга ─────────────
function viewRules() {
  const s = settings();
  const diffs = [-30, -15, 0, 15, 30];
  const row = (k, label) => `<tr><td class="l">${label}</td>${diffs.map(d => { const e = expected(0, d, s.spread); return `<td><span class="up">+${(k * (1 - e)).toFixed(2)}</span><br><span class="down">−${(k * e).toFixed(2)}</span></td>`; }).join('')}</tr>`;
  return `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div>
  <section class="card prose">
    <h1>Как считается рейтинг</h1>
    <p>Используется система <b>Эло</b> — та же идея, что в шахматах и в большинстве любительских лиг по настольному теннису.</p>
    <ul>
      <li>Каждый начинает с <b>${s.initialRating}</b> (администратор может выставить другой стартовый рейтинг конкретному игроку).</li>
      <li>Перед матчем система оценивает шансы: чем больше разница в рейтинге, тем увереннее фаворит.</li>
      <li><b>Победа над сильным</b> — много очков. <b>Победа над слабым</b> — мало.</li>
      <li><b>Поражение сильному</b> — небольшой минус. <b>Поражение слабому</b> — заметный минус.</li>
      <li>Турнирный матч весит до <b>${s.kTournament}</b> очков, свободная игра — до <b>${s.kFree}</b>.</li>
      <li>Первые <b>${s.newcomerGames}</b> матчей рейтинг меняется в <b>${s.newcomerMult}×</b> быстрее, чтобы новичок быстрее нашёл свой уровень.</li>
      ${s.marginBonus ? '<li>Счёт тоже важен: победа всухую (3:0) даёт +10%, а победа в решающей партии (3:2) — −10%.</li>' : ''}
      <li>Рейтинг всегда пересчитывается по всей истории, поэтому исправление ошибочного матча обновляет всё автоматически.</li>
    </ul>
    <h3>Сколько очков за турнирный матч</h3>
    <p class="muted small">Колонки — насколько рейтинг соперника выше (+) или ниже (−) вашего. Сверху — за победу, снизу — за поражение (для опытного игрока, счёт 3:1).</p>
    <div class="tbl-wrap"><table class="tbl rules"><thead><tr><th class="l">Соперник</th>${diffs.map(d => `<th>${d > 0 ? '+' : ''}${d}</th>`).join('')}</tr></thead><tbody>
      ${row(s.kTournament, 'Турнир')}${row(s.kFree, 'Свободная')}</tbody></table></div>
    <h3>Лиги</h3>
    <div class="chips">${LEAGUES.map((l, i) => `<span class="league ${l.cls}">${l.name} ${l.min === -Infinity ? `< ${LEAGUES[1].min}` : `${l.min}${LEAGUES[i + 1] ? '–' + LEAGUES[i + 1].min : '+'}`}</span>`).join('')}</div>
  </section>`;
}

// ───────────── Подсказка установки для iPhone ─────────────
/** Видна только на iPhone/iPad, когда приложение открыто в браузере, а не с иконки. */
function iosInstallHint(onAuth = false) {
  if (!isIOS() || isStandalone()) return '';
  if (Date.now() < +(lsGet('ponghub_ios_hint_until') || 0)) return '';
  const ua = navigator.userAgent;
  const chrome = /CriOS/.test(ua);
  const steps = chrome
    ? 'Нажмите <b>«Поделиться» ⬆︎</b> справа в адресной строке → <b>«На экран „Домой“»</b>.'
    : 'Нажмите <b>«Поделиться» ⬆︎</b> внизу экрана (на новых iOS — сначала <b>«•••»</b>) → <b>«На экран „Домой“»</b>.';
  return `<div class="ios-hint ${onAuth ? 'auth' : ''} ${chrome ? 'top' : ''}" role="note">
    <img src="${logo()}" alt="" width="44" height="44">
    <div class="ios-hint-body"><b>Установите PongHub на iPhone</b><p>${steps}</p>
      <small>Откроется на весь экран — без строки браузера, и будут приходить уведомления. Открыли из WhatsApp или Telegram? Сначала «Открыть в Safari».</small></div>
    <button class="ios-hint-x" data-act="ios-hint-later" aria-label="Напомнить позже">✕</button>
    ${chrome ? '' : '<i class="ios-hint-arrow">⬇︎</i>'}
  </div>`;
}

// ───────────── Справка ─────────────
const FORMAT_HELP = {
  ko: 'Проиграл — выбыл. Пары первого круга строятся по рейтингу: сильнейшие встретятся только в конце. Быстро, подходит для 8–16 человек.',
  rr: 'Каждый играет с каждым, побеждает набравший больше очков (победа — 2, поражение — 1). Честнее всего, но долго: для 6 человек это 15 матчей.',
  groups: 'Сначала маленькие круговые турниры в группах, затем лучшие из каждой группы играют на выбывание. Золотая середина для 8+ человек.',
};
function viewHelp() {
  const sec = (title, body) => `<section class="card prose"><h3>${title}</h3>${body}</section>`;
  return `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div>
  <h1>Как пользоваться</h1>
  ${sec('🏓 Свободная игра', `<p>Обычная игра в перерыв. Нажмите <b>«+»</b>, выберите игроков, формат и счёт по партиям.</p>
    <ul><li>Вы и помощники вносите результат сразу.</li><li>Игрок может отправить результат сам — он попадёт в рейтинг после подтверждения владельцем или помощником.</li><li>Свободная игра весит в рейтинге вдвое меньше турнирной.</li></ul>`)}
  ${sec('🏆 Турнир по шагам', `<ol>
    <li><b>Турниры → «Создать».</b> Название, дата, где проходит (необязательно), формат, до скольких побед и до скольких очков партия.</li>
    <li><b>Отметьте участников.</b> Приложение само составит пары и сетку по текущему рейтингу.</li>
    <li><b>После каждой игры</b> откройте страницу турнира и нажмите на нужную пару — внесите счёт.</li>
    <li>В олимпийской системе победитель <b>сам переходит</b> в следующий раунд. В группах таблица пересчитывается сразу.</li>
    <li>Когда определится победитель — <b>«Завершить турнир»</b>. Медали появятся в профилях, всем придёт уведомление.</li></ol>`)}
  ${sec('📋 Форматы турниров', `
    <p><b>Олимпийская система (на выбывание).</b> ${FORMAT_HELP.ko} Если участников не 4, 8 или 16, сильнейшие получают «свободный проход» в следующий круг. Можно включить матч за 3-е место.</p>
    <p><b>Круговой (каждый с каждым).</b> ${FORMAT_HELP.rr} При равенстве очков решает личная встреча, затем соотношение партий.</p>
    <p><b>Группы + плей-офф.</b> ${FORMAT_HELP.groups} Игроки раскладываются по группам «змейкой» по рейтингу, чтобы группы были равными. Когда группы доиграны, нажмите «Сформировать» — первые места сыграют со вторыми из других групп.</p>`)}
  ${sec('🎯 Формат матча', `<ul><li><b>До 2 или 3 побед</b> — сколько партий нужно выиграть, чтобы выиграть матч (2:0, 2:1 или 3:0, 3:1, 3:2).</li>
    <li><b>Партия до 11 или 21</b> — до скольких очков идёт партия. При 10:10 (или 20:20) играют до разницы в 2 очка.</li>
    <li>Если счёт партий не записали, включите <b>«Знаю только итоговый счёт»</b>.</li></ul>`)}
  ${sec('❓ «Турнирный матч» в кнопке «+»', `<p>Это разовый важный матч, который не входит в турнир, созданный в приложении, — например, вы сыграли в городской лиге или договорились о «матче на интерес». Он весит в рейтинге как турнирный.</p>
    <p>Матчи турниров из приложения вносите <b>на странице самого турнира</b> — тогда они попадут в сетку и таблицу.</p>`)}
  ${!isAdmin() ? '' : sec('👥 Роли <span class="muted small">· видите только вы</span>', `<ul><li><b>👑 Владелец</b> — принимает заявки, назначает помощников, меняет настройки рейтинга.</li>
    <li><b>✍️ Помощник</b> — вносит результаты, ведёт турниры, подтверждает матчи. Назначается в «Управление → Игроки».</li>
    <li><b>Игрок</b> — смотрит статистику и может отправить свой результат на подтверждение.</li></ul>`)}
  <a href="#/rules" class="card menu-item">📐 <span>Как считается рейтинг</span><span>→</span></a>`;
}

// ───────────── Профиль / настройки ─────────────
function viewMe() {
  const me = S.me;
  let theme = 'light';
  try { theme = localStorage.getItem('ponghub_theme') || 'light'; } catch { /* */ }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<div class="page-h"><h1>Профиль</h1></div>
  <a href="#/player/${me.id}" class="card me-card">${ava(me, 'md')}<div><b>${esc(me.nickname)}</b> ${roleBadge(me)}<div class="muted small">${esc(me.full_name || '')}</div></div><span>→</span></a>
  ${isEditor() ? `<a href="#/admin" class="card menu-item">🛠️ <span>${isAdmin() ? 'Управление клубом' : 'Подтверждение результатов'}</span>${pendingCounts().total ? `<i class="dot inline">${pendingCounts().total}</i>` : ''}<span>→</span></a>` : ''}
  <section class="card menu">
    <button class="menu-item" data-act="edit-profile">✏️ <span>Редактировать профиль</span></button>
    <a class="menu-item" href="#/help">❓ <span>Как пользоваться</span></a>
    <a class="menu-item" href="#/rules">📐 <span>Как считается рейтинг</span></a>
    <a class="menu-item" href="#/calendar">📅 <span>Календарь игр</span></a>
    <a class="menu-item" href="#/h2h/${me.id}">⚔️ <span>Личные встречи</span></a>
    ${S.store.mode === 'supabase' ? '<button class="menu-item" data-act="change-pass">🔑 <span>Сменить пароль</span></button>' : ''}
  </section>
  <section class="card"><div class="card-h"><h3>Оформление</h3></div>
    <div class="seg">${[['dark', '🌙 Тёмная'], ['light', '☀️ Светлая'], ['auto', '⚙️ Авто']].map(([k, l]) => `<button class="${theme === k ? 'on' : ''}" data-act="theme" data-v="${k}">${l}</button>`).join('')}</div>
  </section>
  <section class="card" id="push-box"><div class="card-h"><h3>🔔 Уведомления</h3></div><div class="muted small">Проверяю…</div></section>
  ${standalone ? '' : `<section class="card"><div class="card-h"><h3>📲 Установить на телефон</h3></div>
    ${S.installEvt ? '<button class="btn primary full" data-act="install">Установить приложение</button>' : ios
      ? '<p class="small">В Safari нажмите <b>«Поделиться»</b> <span class="kbd">⬆︎</span>, затем <b>«На экран „Домой“»</b>.</p>'
      : '<p class="small">Откройте меню браузера <span class="kbd">⋮</span> и выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.</p>'}</section>`}
  ${S.store.mode === 'demo' ? `<section class="card"><div class="card-h"><h3>Демо-режим</h3></div>
    <p class="muted small">Сейчас вы вошли как демо-пользователь. Данные хранятся только в этом браузере.</p>
    <div class="row-btns"><button class="btn" data-act="logout">Сменить роль</button><button class="btn ghost" data-act="demo-reset">Сбросить демо-данные</button></div></section>` : ''}
  <button class="btn ghost full danger-text" data-act="logout">Выйти из аккаунта</button>
  <p class="muted small center ver">PongHub · v1.1</p>`;
}

// ───────────── Админка ─────────────
function viewAdmin(r) {
  if (!isEditor()) return '<div class="empty">Нет доступа</div>';
  const tabs = isAdmin() ? [['reqs', 'Заявки'], ['matches', 'Матчи'], ['players', 'Игроки'], ['rating', 'Рейтинг'], ['data', 'Данные']] : [['matches', 'Матчи']];
  const tab = tabs.some(t => t[0] === r.args[0]) ? r.args[0] : tabs[0][0];
  const pc = pendingCounts();
  const cnt = { reqs: pc.users, matches: pc.matches };
  let body = '';
  if (tab === 'reqs') {
    const pend = S.data.profiles.filter(p => p.status === 'pending');
    const rej = S.data.profiles.filter(p => p.status === 'rejected');
    body = `<section class="card">${pend.map(p => `<div class="req">${ava(p, 'md')}<div class="rn"><b>${esc(p.nickname)}</b><small>${esc(p.full_name || '')}</small><small class="muted">${esc(S.emails.get(p.id) || '')} · ${fmtDate(p.created_at)}</small></div>
      <div class="req-btns"><button class="btn primary sm" data-act="approve-user" data-id="${p.id}">Принять</button><button class="btn ghost sm" data-act="reject-user" data-id="${p.id}">Отклонить</button></div></div>`).join('') || '<div class="empty">Новых заявок нет 👌</div>'}</section>
      ${rej.length ? `<details class="card"><summary>Отклонённые (${rej.length})</summary>${rej.map(p => `<div class="req">${ava(p, 'sm')}<div class="rn"><b>${esc(p.nickname)}</b><small class="muted">${esc(S.emails.get(p.id) || '')}</small></div><button class="btn sm" data-act="approve-user" data-id="${p.id}">Всё-таки принять</button></div>`).join('')}</details>` : ''}`;
  } else if (tab === 'matches') {
    const pend = S.data.matches.filter(m => m.status === 'pending').sort((a, b) => ts(b) - ts(a));
    body = `<p class="muted small">Результаты, которые игроки отправили сами. В рейтинг они попадут только после подтверждения.</p>
      ${pend.map(m => `<div class="pend">${matchCard(m)}<div class="row-btns"><span class="muted small">Отправил: ${esc(P(m.submitted_by).nickname)}</span><button class="btn ghost sm" data-act="reject-match" data-id="${m.id}">Отклонить</button><button class="btn primary sm" data-act="approve-match" data-id="${m.id}">Подтвердить</button></div></div>`).join('') || '<div class="empty">Нечего подтверждать 👌</div>'}`;
  } else if (tab === 'players') {
    const list = S.data.profiles.filter(p => p.status === 'approved' || p.status === 'archived').sort((a, b) => (a.status > b.status) - (a.status < b.status) || a.nickname.localeCompare(b.nickname));
    body = `<p class="muted small">«Помощник» может вносить результаты, вести турниры и подтверждать матчи — например, когда вас нет. Права можно включить и выключить в любой момент.</p>
      <section class="card">${list.map(p => `<div class="pl-row ${p.status === 'archived' ? 'arch' : ''}">
        <div class="pl-top">${ava(p, 'sm')}<div class="rn"><b>${esc(p.nickname)}</b><small class="muted">${esc(p.full_name || '')} · ${esc(S.emails.get(p.id) || '')}</small></div><span class="pl-r">${fmtR(ratingOf(p.id))}</span></div>
        ${p.role === 'admin' ? '<div class="muted small">👑 Владелец клуба</div>' : `<div class="pl-ctl">
          <label class="switch"><input type="checkbox" data-act-change="toggle-editor" data-id="${p.id}" ${p.role === 'editor' ? 'checked' : ''} ${p.status === 'archived' ? 'disabled' : ''}><i></i><span>Помощник</span></label>
          <label class="init">Старт<input type="number" step="0.5" min="0" value="${p.initial_rating ?? ''}" placeholder="${settings().initialRating}" data-act-change="set-initial" data-id="${p.id}"></label>
          <button class="btn xs ghost" data-act="${p.status === 'archived' ? 'restore-user' : 'archive-user'}" data-id="${p.id}">${p.status === 'archived' ? 'Вернуть' : 'В архив'}</button>
        </div>`}</div>`).join('')}</section>
      <p class="muted small">«В архив» скрывает игрока из рейтинга, но сохраняет историю его матчей.</p>`;
  } else if (tab === 'rating') {
    const s = settings();
    const f = (k, label, hint, step = 1) => `<label>${label}<input type="number" name="${k}" value="${s[k]}" step="${step}" min="0"><small class="muted">${hint}</small></label>`;
    body = `<form data-form="settings" class="card stack">
      <label>Название клуба<input name="clubName" value="${esc(s.clubName)}" maxlength="30"></label>
      ${f('initialRating', 'Стартовый рейтинг', 'С какого рейтинга начинают новые игроки', 0.5)}
      ${f('kTournament', 'Вес турнирного матча (K)', 'Максимум очков за турнирный матч', 0.5)}
      ${f('kFree', 'Вес свободной игры (K)', 'Максимум очков за обычную игру', 0.5)}
      ${f('spread', 'Масштаб разницы', 'При такой разнице рейтингов фаворит побеждает в ~10 раз чаще', 1)}
      ${f('newcomerGames', 'Матчей «новичка»', 'Сколько первых матчей рейтинг меняется быстрее', 1)}
      ${f('newcomerMult', 'Ускорение для новичков', 'Множитель для первых матчей', 0.1)}
      <label class="switch"><input type="checkbox" name="marginBonus" ${s.marginBonus ? 'checked' : ''}><i></i><span>Учитывать счёт (3:0 весит больше, чем 3:2)</span></label>
      <div><b class="small">Иконка приложения</b><div class="icon-pick">${Object.entries(ICON_VARIANTS).map(([k, l]) => `<label><input type="radio" name="icon" value="${k}" ${iconChoice() === k ? 'checked' : ''}><img src="icons/${k}.svg" alt="" width="64" height="64"><span>${l}</span></label>`).join('')}</div>
        <small class="muted">Меняется в приложении сразу. На главном экране телефона иконка обновится после переустановки.</small></div>
      <div class="calc" id="calc"></div>
      <div class="row-btns"><button type="button" class="btn ghost" data-act="settings-default">По умолчанию</button><button class="btn primary">Сохранить и пересчитать</button></div>
    </form>`;
  } else if (tab === 'data') {
    body = `<section class="card stack">
      <p class="muted small">Выгрузки открываются в Excel и Google Таблицах.</p>
      <button class="btn" data-act="export-rating">📊 Рейтинг (Excel/CSV)</button>
      <button class="btn" data-act="export-matches">📋 Все матчи (Excel/CSV)</button>
      <button class="btn ghost" data-act="export-json">💾 Полная резервная копия (JSON)</button>
    </section>
    <section class="card"><div class="card-h"><h3>Статистика клуба</h3></div>
      <div class="stat-grid in">
        <div><b>${S.data.profiles.filter(p => p.status === 'approved').length}</b><small>игроков</small></div>
        <div><b>${S.A.played.length}</b><small>матчей</small></div>
        <div><b>${S.data.tournaments.length}</b><small>турниров</small></div>
        <div><b>${S.A.played.reduce((a, m) => a + (m.sets1 || 0) + (m.sets2 || 0), 0)}</b><small>партий</small></div>
      </div></section>`;
  }
  return `<div class="page-h"><h1>${isAdmin() ? 'Управление' : 'Подтверждение'}</h1></div>
    ${tabs.length > 1 ? `<div class="seg scroll">${tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${tab === k ? 'on' : ''}">${l}${cnt[k] ? ` <i class="dot inline">${cnt[k]}</i>` : ''}</a>`).join('')}</div>` : ''}
    ${body}`;
}

function updateCalc(form) {
  const el = form.querySelector('#calc');
  if (!el) return;
  const fd = new FormData(form);
  const s = { ...settings() };
  for (const k of ['kTournament', 'kFree', 'spread', 'initialRating']) s[k] = +fd.get(k) || 0;
  s.marginBonus = !!fd.get('marginBonus');
  const base = s.initialRating;
  const ex = (ra, rb) => expected(ra, rb, s.spread || 50);
  const mf = s.marginBonus ? marginFactor(3, 1, 5) : 1;
  const w = (ra, rb, k) => (k * mf * (1 - ex(ra, rb))).toFixed(2);
  const l = (ra, rb, k) => (k * mf * ex(ra, rb)).toFixed(2);
  el.innerHTML = `<b>Примеры (турнир, 3:1):</b>
    <div>Игрок ${base} обыграл ${base + 30}: <span class="up">+${w(base, base + 30, s.kTournament)}</span></div>
    <div>Игрок ${base} обыграл ${base}: <span class="up">+${w(base, base, s.kTournament)}</span></div>
    <div>Игрок ${base} обыграл ${base - 20}: <span class="up">+${w(base, base - 20, s.kTournament)}</span></div>
    <div>Игрок ${base} проиграл ${base + 30}: <span class="down">−${l(base, base + 30, s.kTournament)}</span></div>
    <div>Игрок ${base} проиграл ${base - 20}: <span class="down">−${l(base, base - 20, s.kTournament)}</span></div>`;
}

// ───────────── Формы в модальных окнах ─────────────
function playerOptions(sel, exclude) {
  return S.data.profiles.filter(p => p.status === 'approved' && p.id !== exclude).sort((a, b) => a.nickname.localeCompare(b.nickname))
    .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nickname)} · ${fmtR(ratingOf(p.id))}</option>`).join('');
}

function openMatchForm(opts = {}) {
  const m0 = opts.match || null;
  const fx = opts.fixed || {};
  const editor = isEditor();
  const st = {
    p1: m0?.player1_id || fx.player1_id || (editor ? '' : S.me.id),
    p2: m0?.player2_id || fx.player2_id || '',
    type: m0?.type || fx.type || 'free',
    bestOf: m0?.best_of || fx.best_of || 5,
    pointsTo: m0?.points_to || fx.points_to || 11,
    sets: m0?.sets?.length ? m0.sets.map(s => [String(s[0]), String(s[1])]) : [],
    simple: m0 ? !(m0.sets && m0.sets.length) : false,
    s1: m0?.sets1 ?? '', s2: m0?.sets2 ?? '',
    date: toLocalInput(m0?.played_at || new Date()),
    note: m0?.note || '',
  };
  const lockPlayers = !!(fx.player1_id || m0?.tournament_id);
  const lockFormat = !!(fx.tournament_id || m0?.tournament_id);
  const lockP1 = !editor;
  const tour = tById(fx.tournament_id || m0?.tournament_id);

  const summary = () => {
    const need = winsNeeded(st.bestOf);
    let a = 0, b = 0;
    if (st.simple) { a = +st.s1 || 0; b = +st.s2 || 0; }
    else st.sets.forEach(([x, y]) => { if (x !== '' && y !== '' && +x !== +y) (+x > +y ? a++ : b++); });
    const n1 = st.p1 ? P(st.p1).nickname : 'Игрок 1', n2 = st.p2 ? P(st.p2).nickname : 'Игрок 2';
    const win = a >= need ? n1 : b >= need ? n2 : null;
    return `<b>${a}:${b}</b> ${win ? `— победа <b>${esc(win)}</b>` : `<span class="muted">(до ${need} ${plural(need, 'победы', 'побед', 'побед')})</span>`}`;
  };

  const draw = sh => {
    const rows = Array.from({ length: st.bestOf }, (_, i) => st.sets[i] || ['', '']);
    st.sets = rows;
    sh.querySelector('.mf-body').innerHTML = `
      <h3>${m0 ? 'Изменить матч' : editor ? 'Новый матч' : 'Отправить результат'}</h3>
      ${tour ? `<div class="chip">🏆 ${esc(tour.name)}</div>` : ''}
      ${!editor ? '<p class="muted small">Результат попадёт в рейтинг после подтверждения администратором.</p>' : ''}
      <div class="vs-pick">
        <select name="p1" ${lockPlayers || lockP1 ? 'disabled' : ''}><option value="">Игрок 1</option>${playerOptions(st.p1, st.p2)}</select>
        <span>vs</span>
        <select name="p2" ${lockPlayers ? 'disabled' : ''}><option value="">Игрок 2</option>${playerOptions(st.p2, st.p1)}</select>
      </div>
      ${editor && !lockFormat ? `<div class="seg"><button type="button" data-k="type" data-v="free" class="${st.type === 'free' ? 'on' : ''}">Свободная игра</button><button type="button" data-k="type" data-v="tournament" class="${st.type === 'tournament' ? 'on' : ''}">Турнирный матч</button></div>
        ${st.type === 'tournament' ? '<p class="hint">Для турнира, созданного в приложении, счёт вносится на странице турнира. Здесь — разовый важный матч или матч турнира вне приложения: он просто весит в рейтинге больше.</p>' : ''}` : ''}
      <div class="fmt-row">
        <div><small class="muted">Играем до</small><div class="seg sm">${[[1, '1'], [3, '2'], [5, '3'], [7, '4']].map(([v, l]) => `<button type="button" data-k="bestOf" data-v="${v}" class="${st.bestOf === v ? 'on' : ''}" ${lockFormat ? 'disabled' : ''}>${l}</button>`).join('')}</div><small class="muted">побед в партиях</small></div>
        <div><small class="muted">Партия до</small><div class="seg sm">${[11, 21].map(v => `<button type="button" data-k="pointsTo" data-v="${v}" class="${st.pointsTo === v ? 'on' : ''}" ${lockFormat ? 'disabled' : ''}>${v}</button>`).join('')}<input type="number" class="pts-custom" min="5" max="50" value="${[11, 21].includes(st.pointsTo) ? '' : st.pointsTo}" placeholder="др." ${lockFormat ? 'disabled' : ''}></div><small class="muted">очков</small></div>
      </div>
      <label class="switch"><input type="checkbox" name="simple" ${st.simple ? 'checked' : ''}><i></i><span>Знаю только итоговый счёт по партиям</span></label>
      ${st.simple ? `<div class="sets-simple"><input type="number" name="s1" min="0" max="4" value="${st.s1}" placeholder="0"><span>:</span><input type="number" name="s2" min="0" max="4" value="${st.s2}" placeholder="0"></div>`
        : `<div class="sets-grid"><div class="sg-h"><span></span><span>${esc(st.p1 ? P(st.p1).nickname : 'Игрок 1')}</span><span>${esc(st.p2 ? P(st.p2).nickname : 'Игрок 2')}</span></div>
          ${rows.map((s, i) => `<div class="sg-row"><span>Партия ${i + 1}</span><input type="number" inputmode="numeric" min="0" max="99" data-set="${i}" data-side="0" value="${s[0]}"><input type="number" inputmode="numeric" min="0" max="99" data-set="${i}" data-side="1" value="${s[1]}"></div>`).join('')}</div>`}
      <div class="mf-sum">${summary()}</div>
      <label>Дата и время<input type="datetime-local" name="date" value="${st.date}"></label>
      <label>Комментарий<input name="note" value="${esc(st.note)}" maxlength="140" placeholder="необязательно"></label>
      <div class="mf-err"></div>
      <div class="row-btns">${m0 && editor ? '<button type="button" class="btn danger ghost" data-mf="delete">Удалить</button>' : ''}<button type="button" class="btn primary" data-mf="save">${editor ? 'Сохранить' : 'Отправить'}</button></div>`;
  };

  openModal('<div class="mf-body"></div>', sh => {
    draw(sh);
    sh.addEventListener('click', async e => {
      const b = e.target.closest('[data-k]');
      if (b && !b.disabled) { const k = b.dataset.k; st[k] = k === 'type' ? b.dataset.v : +b.dataset.v; draw(sh); return; }
      const act = e.target.closest('[data-mf]')?.dataset.mf;
      if (act === 'save') saveMatch(e.target.closest('button'));
      if (act === 'delete' && await confirmDialog('Удалить этот матч? Рейтинг будет пересчитан.', 'Удалить', true)) {
        await busy(null, async () => { await S.store.remove('matches', m0.id); toast('Матч удалён'); await refresh(); });
      }
    });
    sh.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.set != null) st.sets[+t.dataset.set][+t.dataset.side] = t.value;
      else if (t.name === 's1' || t.name === 's2') st[t.name] = t.value;
      else if (t.name === 'date' || t.name === 'note') st[t.name] = t.value;
      else if (t.classList.contains('pts-custom')) { if (+t.value >= 5) st.pointsTo = +t.value; return; }
      sh.querySelector('.mf-sum').innerHTML = summary();
      // авто-переход к следующему полю после ввода двухзначного счёта
      if (t.dataset.set != null && t.value.length >= 2) {
        const all = [...sh.querySelectorAll('[data-set]')]; const nx = all[all.indexOf(t) + 1]; if (nx) nx.focus();
      }
    });
    sh.addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'p1' || t.name === 'p2') { st[t.name] = t.value; draw(sh); }
      if (t.name === 'simple') { st.simple = t.checked; draw(sh); }
      if (t.classList.contains('pts-custom') && +t.value >= 5) { st.pointsTo = +t.value; draw(sh); }
    });
  });

  async function saveMatch(btn) {
    const err = msg => { $modal.querySelector('.mf-err').textContent = msg; };
    if (!st.p1 || !st.p2) return err('Выберите обоих игроков');
    if (st.p1 === st.p2) return err('Игрок не может играть сам с собой');
    const need = winsNeeded(st.bestOf);
    let sets = [], s1 = 0, s2 = 0;
    if (st.simple) {
      s1 = +st.s1; s2 = +st.s2;
      if (!(Math.max(s1, s2) === need && Math.min(s1, s2) < need)) return err(`Победитель должен выиграть ровно ${need} ${plural(need, 'партию', 'партии', 'партий')}`);
    } else {
      for (let i = 0; i < st.sets.length; i++) {
        const [x, y] = st.sets[i];
        if (x === '' && y === '') continue;
        if (x === '' || y === '') return err(`Партия ${i + 1}: заполните счёт обоих игроков`);
        if (s1 >= need || s2 >= need) return err(`Партия ${i + 1} лишняя — матч уже был решён`);
        const v = validateSet(x, y, st.pointsTo);
        if (v) return err(`Партия ${i + 1}: ${v}`);
        sets.push([+x, +y]);
        +x > +y ? s1++ : s2++;
      }
      if (s1 < need && s2 < need) return err(`Матч не доигран: нужно ${need} ${plural(need, 'победа', 'победы', 'побед')} в партиях`);
    }
    if (!st.date) return err('Укажите дату');
    const row = {
      player1_id: st.p1, player2_id: st.p2, type: lockFormat ? 'tournament' : st.type,
      tournament_id: fx.tournament_id ?? m0?.tournament_id ?? null,
      stage: fx.stage ?? m0?.stage ?? null, grp: fx.grp ?? m0?.grp ?? null, round: fx.round ?? m0?.round ?? null, slot: fx.slot ?? m0?.slot ?? null,
      sets, sets1: s1, sets2: s2, winner_id: s1 > s2 ? st.p1 : st.p2,
      best_of: st.bestOf, points_to: st.pointsTo, played_at: new Date(st.date).toISOString(), note: st.note.trim(),
      status: editor ? 'approved' : 'pending',
    };
    await busy(btn, async () => {
      if (m0) await S.store.update('matches', m0.id, row);
      else await S.store.insert('matches', { ...row, submitted_by: S.me.id });
      closeModal();
      toast(editor ? 'Матч сохранён, рейтинг пересчитан' : 'Результат отправлен на подтверждение');
      if (m0 && m0.stage === 'ko' && m0.winner_id !== row.winner_id) toast('Победитель изменился — проверьте следующие раунды сетки', 'warn');
      await refresh();
    });
  }
}

function openMatchDetail(id) {
  const m = S.data.matches.find(x => x.id === id);
  if (!m) return;
  const d = S.A.md.get(m.id);
  const a = P(m.player1_id), b = P(m.player2_id);
  const t = m.tournament_id ? tById(m.tournament_id) : null;
  const side = p => `<a href="#/player/${p.id}" class="md-p ${m.winner_id === p.id ? 'win' : ''}" data-act="close">${ava(p, 'lg')}<b>${esc(p.nickname)}</b>
    ${d ? `<small>${fmtR(d.before[p.id])} → ${fmtR(d.after[p.id])}</small>${delta(d.delta[p.id])}<small class="muted">шанс ${pct(d.exp[p.id])}</small>` : ''}</a>`;
  const canEdit = isEditor() || (m.status === 'pending' && m.submitted_by === S.me.id);
  openModal(`
    <div class="md">
      <div class="mmeta center"><span class="badge ${m.type === 'tournament' ? 'tour' : 'free'}">${m.type === 'tournament' ? 'Турнир' : 'Свободная игра'}</span>${t ? `<a href="#/tournament/${t.id}" data-act="close" class="tname">${esc(t.name)}</a>` : ''}</div>
      <div class="md-top">${side(a)}<div class="md-score"><b>${m.sets1}:${m.sets2}</b></div>${side(b)}</div>
      ${m.sets?.length ? `<div class="md-sets">${m.sets.map((s, i) => `<div><small>П${i + 1}</small><span class="${s[0] > s[1] ? 'w' : ''}">${s[0]}</span><span class="${s[1] > s[0] ? 'w' : ''}">${s[1]}</span></div>`).join('')}</div>` : ''}
      <div class="muted small center">${fmtDT(m.played_at)} · до ${winsNeeded(m.best_of)} ${plural(winsNeeded(m.best_of), 'победы', 'побед', 'побед')}, партия до ${m.points_to}${m.status === 'pending' ? ' · ⏳ ждёт подтверждения' : ''}</div>
      ${m.note ? `<p class="center">«${esc(m.note)}»</p>` : ''}
      <div class="row-btns">
        <a class="btn ghost" href="#/h2h/${a.id}/${b.id}" data-act="close">⚔️ Все встречи</a>
        ${canEdit && isEditor() ? `<button class="btn" data-act="edit-match" data-id="${m.id}">✏️ Изменить</button>` : ''}
        ${canEdit && !isEditor() ? `<button class="btn danger ghost" data-act="withdraw-match" data-id="${m.id}">Отозвать</button>` : ''}
        ${isEditor() && m.status === 'pending' ? `<button class="btn primary" data-act="approve-match" data-id="${m.id}">Подтвердить</button>` : ''}
      </div>
    </div>`);
}

function openProfileForm() {
  const me = S.me;
  const emojis = ['🏓', '😎', '🔥', '⚡', '🌀', '🦊', '🐯', '🦁', '🐺', '🦅', '🦈', '🐉', '🦄', '🐣', '🧱', '🚀', '💎', '👑', '🎯', '🥷', '🤖', '👽', '🍀', '🌶️'];
  const colors = ['#e63946', '#f4a261', '#ffd166', '#06d6a0', '#2a9d8f', '#118ab2', '#8ab4f8', '#c77dff', '#ff70a6', '#adb5bd'];
  openModal(`<form data-form="profile" class="stack">
    <h3>Мой профиль</h3>
    <div class="ava-preview">${ava(me, 'xl')}</div>
    <div class="photo-btns">
      <label class="btn sm"><input type="file" accept="image/*" id="photo-in" hidden>📷 ${me.photo_url ? 'Сменить фото' : 'Загрузить фото'}</label>
      ${me.photo_url ? '<button type="button" class="btn sm ghost" id="photo-rm">Убрать фото</button>' : ''}
    </div>
    <p class="muted small center">Без фото будет показан эмодзи:</p>
    <div class="emoji-grid">${emojis.map(e => `<label><input type="radio" name="avatar" value="${e}" ${me.avatar === e ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div>
    <div class="color-grid">${colors.map(c => `<label><input type="radio" name="color" value="${c}" ${me.color === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
    <label>Ник<input name="nickname" value="${esc(me.nickname)}" required minlength="2" maxlength="20"></label>
    <label>Имя и фамилия<input name="full_name" value="${esc(me.full_name || '')}" maxlength="60"></label>
    <label>Игровая рука<select name="hand"><option value="">—</option><option value="right" ${me.hand === 'right' ? 'selected' : ''}>Правша</option><option value="left" ${me.hand === 'left' ? 'selected' : ''}>Левша</option></select></label>
    <label>О себе<input name="bio" value="${esc(me.bio || '')}" maxlength="120" placeholder="Например: атакующий стиль, накладки Tenergy"></label>
    <button class="btn primary">Сохранить</button></form>`, sh => {
    const preview = () => {
      const fd = new FormData(sh.querySelector('form'));
      const photo = sh.dataset.photo !== undefined ? sh.dataset.photo : me.photo_url;
      sh.querySelector('.ava-preview').innerHTML = ava({ ...me, photo_url: photo || null, avatar: fd.get('avatar'), color: fd.get('color') }, 'xl');
    };
    sh.addEventListener('change', async e => {
      if (e.target.id === 'photo-in' && e.target.files[0]) {
        const file = e.target.files[0];
        e.target.value = '';  // чтобы можно было выбрать тот же файл ещё раз
        let blob;
        try { blob = await cropImage(file, sh, 400); } catch (err) { toast(err.message, 'err'); return; }
        if (!blob) return;
        await busy(e.target.closest('label'), async () => { sh.dataset.photo = await S.store.uploadAvatar(blob); });
      }
      preview();
    });
    sh.querySelector('#photo-rm')?.addEventListener('click', () => { sh.dataset.photo = ''; preview(); });
  });
}

/**
 * Редактор фото: двигать пальцем или мышью, приближать ползунком, двумя пальцами или колёсиком.
 * Возвращает квадратный JPEG size×size или null, если нажали «Отмена».
 */
function cropImage(file, host, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть изображение')); };
    img.onload = () => {
      host.scrollTop = 0;
      const box = document.createElement('div');
      box.className = 'cropper';
      box.innerHTML = `<h3>Выберите область</h3>
        <div class="crop-view"><img src="${url}" alt="" draggable="false"><div class="crop-ring"></div></div>
        <div class="crop-zoom"><button type="button" class="btn sm ghost" data-z="-1">−</button><input type="range" min="1" max="5" step="0.01" value="1" aria-label="Масштаб"><button type="button" class="btn sm ghost" data-z="1">+</button></div>
        <p class="muted small center">Двигайте фото пальцем. Приблизить — ползунком или двумя пальцами.</p>
        <div class="row-btns"><button type="button" class="btn ghost" data-c="cancel">Отмена</button><button type="button" class="btn primary" data-c="ok">Готово</button></div>`;
      host.appendChild(box);
      const view = box.querySelector('.crop-view'), im = box.querySelector('img'), range = box.querySelector('input');
      const V = view.clientWidth;
      const W = img.naturalWidth, H = img.naturalHeight;
      const base = V / Math.min(W, H);  // при масштабе 1 фото целиком закрывает круг
      let zoom = 1, x = 0, y = 0;       // смещение центра фото от центра окна, px
      const draw = () => {
        const w = W * base * zoom, h = H * base * zoom;
        const mx = (w - V) / 2, my = (h - V) / 2;
        x = Math.max(-mx, Math.min(mx, x)); y = Math.max(-my, Math.min(my, y));
        im.style.width = w + 'px'; im.style.height = h + 'px';
        im.style.transform = `translate(${(V - w) / 2 + x}px, ${(V - h) / 2 + y}px)`;
        range.value = zoom;
      };
      const setZoom = z => { const k = Math.max(1, Math.min(5, z)); x *= k / zoom; y *= k / zoom; zoom = k; draw(); };
      draw();

      const pts = new Map();
      let pinch = null;
      view.addEventListener('pointerdown', e => { view.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = null; });
      view.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) { x += e.clientX - prev.x; y += e.clientY - prev.y; draw(); }
        else if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (!pinch) pinch = { d, z: zoom }; else setZoom(pinch.z * d / pinch.d);
        }
      });
      const up = e => { pts.delete(e.pointerId); pinch = null; };
      view.addEventListener('pointerup', up);
      view.addEventListener('pointercancel', up);
      view.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
      range.addEventListener('input', () => setZoom(+range.value));

      const finish = result => { box.remove(); URL.revokeObjectURL(url); resolve(result); };
      box.addEventListener('click', e => {
        const z = e.target.closest('[data-z]');
        if (z) return setZoom(zoom + 0.25 * +z.dataset.z);
        const c = e.target.closest('[data-c]')?.dataset.c;
        if (c === 'cancel') finish(null);
        if (c === 'ok') {
          const s = base * zoom;  // экранных px на 1 px исходного фото
          const w = W * s, h = H * s;
          const left = ((w - V) / 2 - x) / s, top = ((h - V) / 2 - y) / s, side = V / s;
          const cv = document.createElement('canvas');
          cv.width = cv.height = size;
          cv.getContext('2d').drawImage(img, left, top, side, side, 0, 0, size, size);
          cv.toBlob(b => finish(b), 'image/jpeg', 0.88);
        }
      });
    };
    img.src = url;
  });
}

function openTournamentForm() {
  const players = S.rank.map(x => x.p);
  openModal(`<form data-form="tournament" class="stack">
    <h3>Новый турнир</h3>
    <label>Название<input name="name" required maxlength="60" placeholder="Например: Кубок офиса"></label>
    <div class="two"><label>Дата<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Где проходит<input name="place" maxlength="60" placeholder="Необязательно"></label></div>
    <label>Формат<select name="format">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <p class="hint" id="fmt-hint"></p>
    <div class="two"><label>До скольких побед<select name="best_of"><option value="3">до 2 побед</option><option value="5" selected>до 3 побед</option><option value="7">до 4 побед</option><option value="1">1 партия</option></select></label>
    <label>Партия до<select name="points_to"><option>11</option><option>21</option></select></label></div>
    <div class="two only-groups"><label>Групп<input type="number" name="groups" value="2" min="1" max="8"></label><label>Выходят из группы<select name="advance"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label></div>
    <label class="switch only-ko"><input type="checkbox" name="thirdPlace" checked><i></i><span>Матч за 3-е место</span></label>
    <div class="card-h"><b>Участники <span class="muted" id="t-cnt">0</span></b><button type="button" class="btn xs ghost" id="t-all">Выбрать всех</button></div>
    <div class="pick-list">${players.map(p => `<label class="pick"><input type="checkbox" name="participants" value="${p.id}"><span>${ava(p, 'xs')} ${esc(p.nickname)}</span><small>${fmtR(ratingOf(p.id))}</small></label>`).join('')}</div>
    <p class="muted small">Посев — по текущему рейтингу: сильнейшие не встретятся в начале.</p>
    <button class="btn primary">Создать турнир</button></form>`, sh => {
    const f = sh.querySelector('form');
    const sync = () => {
      const fmt = f.format.value;
      sh.querySelectorAll('.only-groups').forEach(x => x.style.display = fmt === 'groups' ? '' : 'none');
      sh.querySelectorAll('.only-ko').forEach(x => x.style.display = fmt === 'rr' ? 'none' : '');
      sh.querySelector('#fmt-hint').innerHTML = `${FORMAT_HELP[fmt]} <a href="#/help" class="link" data-act="close">Подробнее</a>`;
      sh.querySelector('#t-cnt').textContent = f.querySelectorAll('[name=participants]:checked').length;
    };
    f.addEventListener('change', sync); sync();
    sh.querySelector('#t-all').onclick = () => { const all = [...f.querySelectorAll('[name=participants]')]; const on = all.some(x => !x.checked); all.forEach(x => x.checked = on); sync(); };
  });
}

function openEventForm() {
  const d = new Date(Date.now() + DAY); d.setHours(19, 0, 0, 0);
  openModal(`<form data-form="event" class="stack"><h3>Новое событие</h3>
    <label>Название<input name="title" required maxlength="60" placeholder="Вечерняя игра"></label>
    <label>Когда<input type="datetime-local" name="starts_at" value="${toLocalInput(d)}" required></label>
    <label>Где<input name="place" maxlength="60"></label>
    <label>Комментарий<input name="note" maxlength="140"></label>
    <button class="btn primary">Создать</button></form>`);
}

// ───────────── Обработчики ─────────────
const ACT = {
  close: () => closeModal(),
  go: el => go(el.dataset.href),
  refresh: el => busy(el, refresh),
  'ios-hint-later': () => { lsSet('ponghub_ios_hint_until', String(Date.now() + 3 * DAY)); document.querySelector('.ios-hint')?.remove(); },
  'push-on': el => busy(el, async () => { await enablePush(); toast('Уведомления включены 🔔'); renderPushBox(); }),
  'push-off': el => busy(el, async () => { await disablePush(); toast('Уведомления выключены'); renderPushBox(); }),
  'push-test': el => busy(el, async () => { await S.store.testPush(); toast('Отправлено — уведомление придёт через пару секунд'); }),
  logout: async () => { closeModal(); await disablePush().catch(() => {}); await S.store.signOut(); S.user = null; S.me = null; await reload(); location.hash = '#/login'; render(); },
  'demo-as': async el => { await S.store.signInAs(el.dataset.id); },
  'demo-reset': async () => { if (await confirmDialog('Вернуть демо-данные к исходным?')) { S.store.reset(); await refresh(); toast('Демо-данные сброшены'); } },
  'add-match': () => openMatchForm(),
  match: el => openMatchDetail(el.dataset.id),
  'edit-match': el => { const m = S.data.matches.find(x => x.id === el.dataset.id); closeModal(); openMatchForm({ match: m }); },
  'withdraw-match': async el => { if (await confirmDialog('Отозвать отправленный результат?', 'Отозвать', true)) await busy(el, async () => { await S.store.remove('matches', el.dataset.id); closeModal(); await refresh(); toast('Результат отозван'); }); },
  'approve-match': el => busy(el, async () => { await S.store.update('matches', el.dataset.id, { status: 'approved' }); closeModal(); await refresh(); toast('Матч подтверждён'); }),
  'reject-match': async el => { if (await confirmDialog('Отклонить и удалить этот результат?', 'Отклонить', true)) await busy(el, async () => { await S.store.remove('matches', el.dataset.id); await refresh(); toast('Результат отклонён'); }); },
  'approve-user': el => busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'approved' }); await refresh(); toast('Игрок принят в клуб 🎉'); }),
  'reject-user': async el => { if (await confirmDialog('Отклонить заявку?', 'Отклонить', true)) await busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'rejected' }); await refresh(); }); },
  'archive-user': async el => { if (await confirmDialog('Перенести игрока в архив? Его матчи сохранятся, но он пропадёт из рейтинга.')) await busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'archived', role: 'player' }); await refresh(); }); },
  'restore-user': el => busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'approved' }); await refresh(); }),
  'edit-profile': () => openProfileForm(),
  'change-pass': () => openModal(`<form data-form="newpass" class="stack"><h3>Новый пароль</h3><label>Пароль<input name="password" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn primary">Сохранить</button></form>`),
  theme: el => { try { localStorage.setItem('ponghub_theme', el.dataset.v); } catch { /* */ } applyTheme(); render(); },
  install: async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; render(); },
  'h2h-pick': () => go(`#/h2h/${S.me.id}`),
  'new-tournament': () => openTournamentForm(),
  'new-event': () => openEventForm(),
  rsvp: el => busy(el, async () => { await S.store.toggleRsvp(el.dataset.id); await refresh(); }),
  'del-event': async el => { if (await confirmDialog('Удалить событие?', 'Удалить', true)) await busy(el, async () => { await S.store.remove('events', el.dataset.id); await refresh(); }); },
  fixture: el => {
    const t = tById(el.dataset.t);
    openMatchForm({ fixed: { player1_id: el.dataset.a, player2_id: el.dataset.b, tournament_id: t.id, type: 'tournament', stage: el.dataset.stage, grp: el.dataset.grp === '' ? null : +el.dataset.grp, best_of: t.best_of, points_to: t.points_to } });
  },
  kocell: async el => {
    const t = tById(el.dataset.t);
    const ms = tMatches(t).filter(m => m.stage === 'ko' || m.stage === 'ko3');
    const br = koBracket(t.config.slots, ms, t.config.thirdPlace);
    const third = el.dataset.r === 'third';
    const c = third ? br.third : br.rounds[+el.dataset.r][+el.dataset.i];
    if (c.conflict) {
      if (isEditor() && await confirmDialog('Этот результат больше не соответствует сетке (изменился победитель предыдущего раунда). Удалить его?', 'Удалить', true))
        await busy(null, async () => { await S.store.remove('matches', c.conflict.id); await refresh(); });
      return;
    }
    if (c.match && !(isEditor() && t.status === 'active')) return openMatchDetail(c.match.id);
    if (c.match) return openMatchForm({ match: c.match });
    openMatchForm({ fixed: { player1_id: c.a, player2_id: c.b, tournament_id: t.id, type: 'tournament', stage: third ? 'ko3' : 'ko', round: third ? 0 : c.r, slot: third ? 0 : c.i, best_of: t.best_of, points_to: t.points_to } });
  },
  'make-playoff': async el => {
    const t = tById(el.dataset.t);
    const ms = tMatches(t);
    const tables = t.config.groups.map((g, i) => standings(g, ms.filter(m => m.stage === 'grp' && m.grp === i)));
    if (!tables.every(x => x.complete) && !(await confirmDialog('Не все матчи в группах сыграны. Сформировать плей-офф по текущим результатам?'))) return;
    const slots = playoffSlots(tables.map(x => x.list.map(r => r.id)), t.config.advance || 2);
    await busy(el, async () => { await S.store.update('tournaments', t.id, { config: { ...t.config, slots } }); await refresh(); toast('Сетка плей-офф готова'); });
  },
  'finish-t': async el => {
    const t = tById(el.dataset.t);
    const pl = tournamentPlacings(t);
    if (!pl) return;
    if (pl.incomplete && !(await confirmDialog('Не все матчи сыграны. Завершить по текущей таблице?'))) return;
    const results = { gold: pl.gold || null, silver: pl.silver || null, bronze: pl.bronze || [] };
    await busy(el, async () => { await S.store.update('tournaments', t.id, { status: 'finished', results }); await refresh(); toast(`🏆 Турнир завершён! Победитель — ${P(pl.gold).nickname}`); });
  },
  'reopen-t': el => busy(el, async () => { await S.store.update('tournaments', el.dataset.t, { status: 'active', results: null }); await refresh(); }),
  'del-t': async el => {
    if (!(await confirmDialog('Удалить турнир вместе со всеми его матчами? Рейтинг будет пересчитан.', 'Удалить', true))) return;
    await busy(el, async () => { await S.store.remove('tournaments', el.dataset.t); go('#/tournaments'); await refresh(); toast('Турнир удалён'); });
  },
  'settings-default': () => { const f = document.querySelector('[data-form=settings]'); for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) { if (!f[k]) continue; f[k].type === 'checkbox' ? f[k].checked = v : f[k].value = v; } f.clubName.value = settings().clubName; updateCalc(f); },
  'export-rating': () => {
    const rows = [['Место', 'Ник', 'Имя', 'Рейтинг', 'Матчи', 'Победы', 'Поражения', '% побед', 'Лига']];
    S.rank.forEach((x, i) => { const st = playerStats(x.p.id, S.A); rows.push([x.g ? i + 1 : '', x.p.nickname, x.p.full_name || '', fmtR(x.r).replace('.', ','), st.matches, st.wins, st.losses, pct(st.winRate), leagueOf(x.r).name]); });
    download(`rating-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows), 'text/csv;charset=utf-8');
  },
  'export-matches': () => {
    const rows = [['Дата', 'Тип', 'Турнир', 'Игрок 1', 'Игрок 2', 'Счёт', 'Партии', 'Победитель', 'Изм. 1', 'Изм. 2']];
    for (const m of [...S.A.played].reverse()) {
      const d = S.A.md.get(m.id);
      rows.push([fmtDT(m.played_at), m.type === 'tournament' ? 'Турнир' : 'Свободная', tById(m.tournament_id)?.name || '', P(m.player1_id).nickname, P(m.player2_id).nickname, `${m.sets1}:${m.sets2}`, (m.sets || []).map(s => s.join(':')).join(' '), P(m.winner_id).nickname, d.delta[m.player1_id].toFixed(2).replace('.', ','), d.delta[m.player2_id].toFixed(2).replace('.', ',')]);
    }
    download(`matches-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows), 'text/csv;charset=utf-8');
  },
  'export-json': () => download(`ponghub-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S.data, null, 2), 'application/json'),
};
const csv = rows => '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');

const CHANGE = {
  'filter-player': el => go(`#/matches?type=${el.dataset.type}${el.value ? '&p=' + el.value : ''}`),
  'h2h-sel': el => { const r = route(); const a = el.dataset.side === 'a' ? el.value : (r.args[0] || ''); const b = el.dataset.side === 'b' ? el.value : (r.args[1] || ''); go(`#/h2h/${a || S.me.id}/${b}`); },
  'toggle-editor': async el => {
    const p = P(el.dataset.id);
    await busy(null, async () => { await S.store.update('profiles', p.id, { role: el.checked ? 'editor' : 'player' }); await refresh(); toast(el.checked ? `${p.nickname} теперь может вносить результаты` : `У ${p.nickname} больше нет прав помощника`); });
  },
  'set-initial': async el => {
    const v = el.value === '' ? null : +el.value;
    await busy(null, async () => { await S.store.update('profiles', el.dataset.id, { initial_rating: v }); await refresh(); toast('Стартовый рейтинг обновлён, всё пересчитано'); });
  },
};

const FORMS = {
  login: async (f, fd) => { await S.store.signIn(fd.get('email').trim(), fd.get('password')); },
  register: async (f, fd) => {
    const nickname = fd.get('nickname').trim();
    if (!(await S.store.nicknameAvailable(nickname))) throw new Error('Такой ник уже занят');
    const r = await S.store.signUp({ email: fd.get('email').trim(), password: fd.get('password'), nickname, full_name: fd.get('full_name').trim() });
    if (r.needsConfirm) {
      $app.innerHTML = gateView('📧', 'Подтвердите email', 'Мы отправили письмо со ссылкой. Откройте его, затем войдите в приложение.').replace('data-act="logout">Выйти', 'data-act="go" data-href="#/login">Ко входу');
    }
  },
  forgot: async (f, fd) => { await S.store.resetPassword(fd.get('email').trim()); toast('Письмо со ссылкой отправлено'); go('#/login'); },
  newpass: async (f, fd) => { await S.store.updatePassword(fd.get('password')); S.recovery = false; closeModal(); toast('Пароль изменён'); location.hash = '#/home'; render(); },
  profile: async (f, fd) => {
    const nickname = fd.get('nickname').trim();
    if (nickname.toLowerCase() !== S.me.nickname.toLowerCase() && !(await S.store.nicknameAvailable(nickname))) throw new Error('Такой ник уже занят');
    await S.store.update('profiles', S.me.id, { nickname, full_name: fd.get('full_name').trim(), avatar: fd.get('avatar') || S.me.avatar, color: fd.get('color') || S.me.color, hand: fd.get('hand') || null, bio: fd.get('bio').trim(),
      ...(f.closest('.sheet').dataset.photo !== undefined ? { photo_url: f.closest('.sheet').dataset.photo || null } : {}) });
    closeModal(); await refresh(); toast('Профиль сохранён');
  },
  settings: async (f, fd) => {
    const s = { ...settings() };
    for (const k of ['initialRating', 'kTournament', 'kFree', 'spread', 'newcomerGames', 'newcomerMult']) s[k] = +fd.get(k);
    if (!(s.spread > 0)) throw new Error('Масштаб должен быть больше нуля');
    s.marginBonus = !!fd.get('marginBonus');
    s.clubName = fd.get('clubName').trim() || 'PongHub';
    s.icon = fd.get('icon') || 'hub';
    try { s.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* */ }
    await S.store.saveSettings(s); await refresh(); applyIcon(); toast('Настройки сохранены, рейтинг пересчитан');
  },
  tournament: async (f, fd) => {
    const ids = fd.getAll('participants');
    if (ids.length < 2) throw new Error('Выберите хотя бы двух участников');
    const sorted = [...ids].sort((a, b) => ratingOf(b) - ratingOf(a));
    const format = fd.get('format');
    const config = { thirdPlace: !!fd.get('thirdPlace') };
    if (format === 'ko') config.slots = slotsFromSeeds(sorted);
    if (format === 'groups') {
      const g = Math.max(1, Math.min(+fd.get('groups') || 1, Math.floor(ids.length / 2)));
      config.groups = snakeGroups(sorted, g);
      config.advance = Math.min(+fd.get('advance') || 2, Math.min(...config.groups.map(x => x.length)));
    }
    const t = await S.store.insert('tournaments', {
      name: fd.get('name').trim(), date: fd.get('date') || null, place: fd.get('place').trim(), format,
      best_of: +fd.get('best_of'), points_to: +fd.get('points_to'), status: 'active', participants: sorted, config, results: null, created_by: S.me.id,
    });
    closeModal(); await refresh(); go(`#/tournament/${t.id}`); toast('Турнир создан!');
  },
  event: async (f, fd) => {
    await S.store.insert('events', { title: fd.get('title').trim(), starts_at: new Date(fd.get('starts_at')).toISOString(), place: fd.get('place').trim(), note: fd.get('note').trim(), attendees: [S.me.id], created_by: S.me.id });
    closeModal(); await refresh(); toast('Событие добавлено');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (e.target === $modal) closeModal(); return; }
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'A') e.preventDefault();
  fn(el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-act-change]');
  if (el) CHANGE[el.dataset.actChange]?.(el, e);
});
document.addEventListener('input', e => {
  const f = e.target.closest('[data-form=settings]');
  if (f) updateCalc(f);
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form];
  if (fn) await busy(f.querySelector('button:not([type=button])'), () => fn(f, new FormData(f)));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $modal.classList.contains('open')) closeModal(); });

// ───────────── Push-уведомления ─────────────
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function b64ToBytes(b64) {
  const raw = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function pushState() {
  if (S.store.mode === 'demo') return 'demo';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}
async function enablePush() {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Вы не разрешили уведомления');
  const reg = await navigator.serviceWorker.ready;
  const key = await S.store.pushPublicKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await S.store.savePushSub(sub.toJSON());
}
async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await S.store.deletePushSub(sub.endpoint); await sub.unsubscribe(); }
}
async function renderPushBox() {
  const box = document.getElementById('push-box');
  if (!box) return;
  const st = await pushState();
  const what = '<p class="muted small">Новые матчи и изменения рейтинга, заявки, турниры и события календаря.</p>';
  const body = {
    demo: '<p class="muted small">Заработают после подключения базы.</p>',
    'ios-install': '<p class="small">На iPhone уведомления работают только в установленном приложении: Safari → «Поделиться» → «На экран „Домой“», затем откройте PongHub с главного экрана.</p>',
    unsupported: '<p class="muted small">Этот браузер не поддерживает уведомления.</p>',
    denied: '<p class="small">Уведомления запрещены в настройках браузера или телефона. Разрешите их для этого сайта и обновите страницу.</p>',
    off: `${what}<button class="btn primary full" data-act="push-on">Включить уведомления</button>`,
    on: `${what}<div class="row-btns"><span class="muted small">✅ Включены на этом устройстве</span><button class="btn sm ghost" data-act="push-test">Проверить</button><button class="btn sm ghost" data-act="push-off">Выключить</button></div>`,
  }[st];
  if (document.getElementById('push-box') === box) box.innerHTML = `<div class="card-h"><h3>🔔 Уведомления</h3></div>${body}`;
}

/** Уменьшает шрифт ника, пока он не поместится; если совсем длинный — переносит на две строки. */
function fitNicks() {
  document.querySelectorAll('.hero-nick').forEach(el => {
    el.style.fontSize = ''; el.classList.remove('wrap');
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 18) { size -= 1; el.style.fontSize = size + 'px'; }
    if (el.scrollWidth > el.clientWidth) el.classList.add('wrap');
  });
}
addEventListener('resize', () => fitNicks());

function afterRender(r) {
  fitNicks();
  document.fonts?.ready.then(fitNicks);
  if (r.name === 'me') renderPushBox();
  const f = document.querySelector('[data-form=settings]');
  if (f) updateCalc(f);
}

// ───────────── Запуск ─────────────
async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { applyTheme(); });
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  try {
    S.store = await createStore();
  } catch (e) {
    $app.innerHTML = gateView('📡', 'Нет соединения', 'Не удалось подключиться к серверу. Проверьте интернет и обновите страницу.');
    return;
  }
  S.user = await S.store.currentUser();
  await reload();
  S.store.onAuth(async (ev, u) => {
    if (ev === 'PASSWORD_RECOVERY') S.recovery = true;
    const changed = (u?.id || null) !== (S.user?.id || null);
    S.user = u;
    if (changed || ev === 'PASSWORD_RECOVERY') {
      await reload();
      if (u && ['login', 'register', 'forgot'].includes(route().name)) location.hash = '#/home';
      render();
    }
  });
  S.store.subscribe(async () => {
    await reload();
    // не перерисовываем, пока человек что-то печатает в форме на странице
    const ae = document.activeElement;
    if (ae && $app.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
    if (!$modal.classList.contains('open')) render();
  });
  document.addEventListener('visibilitychange', async () => { if (!document.hidden && S.user) { await reload(); if (!$modal.classList.contains('open')) render(); } });
  addEventListener('hashchange', () => { closeModal(); render(); });
  render();
  document.getElementById('splash')?.remove();
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
boot();
