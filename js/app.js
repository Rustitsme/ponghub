import { createStore, media, SANDBOX_HOSTED } from './store.js';
import { makeQr, qrSvg, qrPng, drawQr } from './qr.js';
import { UNLOCK_KIND, unlockText, unlockNow, ITEMS, RG, RGSUB, RUBBER_COLORS, STYLE, EQUIP, LEAGUE_REWARDS, STREAK, STARTER, byId, colorOf, priceOf, keyOf, parseKey } from './shop-catalog.js';
import { thumb, mountViewer, loadThree, racketShot } from './shop3d.js';
import {
  analyze, ranking, playerStats, ACHIEVEMENTS, insights, playerOfMonth, headToHead, validateSet,
  leagueOf, nextLeague, LEAGUES, DEFAULT_SETTINGS, ratingAt, setsFor, expected, marginFactor, winsNeeded, ts,
  analyzeDoubles, rankingDoubles, isDoubles, seasons, seasonTable, monthKey, monthName, weekSummary, replayLive, leagueDelta,
} from './engine.js';
import {
  FORMATS, koBracket, koPlacings, roundName, pairings, standings, snakeGroups, playoffSlots, slotsFromSeeds, findPairMatch,
} from './tourney.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const S = { store: null, user: null, me: null, ctx: null, club: null, data: null, A: null, rank: [], byId: new Map(), emails: new Map(), recovery: false, installEvt: null };
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
const isAdmin = () => !!S.club && S.me?.role === 'admin' && S.me?.status === 'approved';
const isEditor = () => !!S.club && (S.me?.role === 'editor' || S.me?.role === 'admin') && S.me?.status === 'approved';
const isFounder = () => !!S.ctx?.me?.is_founder;
// флажки обновлений: 'founder' — только у создателя, 'all' — у всех
const feature = name => { const m = S.ctx?.platform?.features?.[name] ?? 'all'; return m === 'all' || (m === 'founder' && (isFounder() || (S.ctx?.myFeatures || []).includes(name))); };
const ratingOf = id => S.A.rating.get(id) ?? S.A.S.initialRating;
const settings = () => ({ ...DEFAULT_SETTINGS, ...(S.data?.settings || {}) });
const tById = id => S.data.tournaments.find(t => t.id === id);

function ava(p, cls = '') {
  const inner = p.photo_url ? `<img src="${esc(media(p.photo_url))}" alt="" loading="lazy">` : esc(p.avatar || (p.nickname || '?')[0]);
  return `<span class="ava ${cls}" style="--c:${esc(p.color || '#e63946')}">${inner}</span>`;
}
function leagueBadge(r) { const l = leagueOf(r); return `<span class="league ${l.cls}">${l.name}</span>`; }
const roleIcon = p => { const t = p.role === 'admin' ? ['👑', 'Владелец'] : p.role === 'editor' ? ['✍️', 'Помощник'] : null; const st = p.is_founder ? '⭐' : ''; return t || st ? `<span class="role-ic" title="${t ? t[1] : 'Создатель PongHub'}">${t ? t[0] : ''}${st}</span>` : ''; };
// ⭐ — создатель PongHub (рядом с короной владельца, без лишних подписей)
function roleBadge(p) {
  const star = p.is_founder ? '<span class="creator-star" title="Создатель PongHub">⭐</span>' : '';
  if (p.role === 'admin') return `<span class="role-badge owner">👑${star} Владелец</span>`;
  if (p.role === 'editor') return `<span class="role-badge">✍️${star} Помощник</span>`;
  return star ? `<span class="role-badge owner">${star}</span>` : '';
}
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
const testFlag = () => (S.testMode ? { is_test: true } : {});
function derive() {
  const d = S.data;
  // Тестовые данные (их получает только владелец) показываем лишь в тестовом режиме
  S.testMode = lsGet('ponghub_testmode') === '1' && (d.profiles.find(p => p.id === S.user?.id)?.role === 'admin');
  if (!S.testMode) for (const k of ['profiles', 'matches', 'tournaments', 'live', 'challenges', 'announcements', 'predEvents']) if (d[k]) d[k] = d[k].filter(x => !x.is_test);
  if (!S.testMode && d.predictions) { const ok = new Set((d.predEvents || []).map(e => e.id)); d.predictions = d.predictions.filter(p => ok.has(p.event_id)); }
  S.byId = new Map(d.profiles.map(p => [p.id, p]));
  S.me = S.user ? S.byId.get(S.user.id) || null : null;
  if (S.user && !S.club && S.ctx?.me) S.me = { ...S.ctx.me, role: 'player', status: 'noclub' };
  S.A = analyze(d.profiles.filter(p => ['approved', 'archived', 'deleted'].includes(p.status)), d.matches, d.settings);
  S.rank = ranking(S.A, d.profiles);
  S.D = analyzeDoubles(d.profiles.filter(p => ['approved', 'archived', 'deleted'].includes(p.status)), d.matches, d.settings);
  S.data.challenges = S.data.challenges || [];
  S.data.live = S.data.live || [];
  S.data.announcements = S.data.announcements || [];
  S.data.predEvents = S.data.predEvents || [];
  S.data.predictions = S.data.predictions || [];
  S.seasons = seasons(S.A, d.profiles);
  document.title = S.club ? settings().clubName || 'PongHub' : 'PongHub';
  if (S.data.settings && S.data.settings.icon) applyIcon();
}
const EMPTY = () => ({ profiles: [], matches: [], tournaments: [], events: [], settings: {} });
// какой клуб открыт: из ссылки (?club=), из памяти или первый из моих
function pickClub() {
  const active = (S.ctx?.clubs || []).filter(c => c.my_status === 'active');
  const want = route().q.get('club') || lsGet('ponghub_club');
  S.club = active.find(c => c.id === want) || active[0] || null;
  S.store.setClub(S.club);
  if (S.club) lsSet('ponghub_club', S.club.id);
}
async function switchClub(id) {
  lsSet('ponghub_club', id);
  if (route().q.get('club')) history.replaceState(null, '', location.pathname + location.search + '#/home');
  closeModal();
  await reload();
  if (location.hash !== '#/home') location.hash = '#/home'; else render();
}
async function reload() {
  if (!S.user) { S.ctx = null; S.club = null; S.data = EMPTY(); derive(); return; }
  try {
    S.ctx = await S.store.loadContext();
    // пришёл по ссылке-приглашению до входа — после входа открываем страницу клуба
    const pendingJoin = lsGet('ponghub_join');
    if (pendingJoin && S.ctx?.me) {
      lsSet('ponghub_join', '');
      setTimeout(() => openInvite(pendingJoin), 0);
    }
    const after = lsGet('ponghub_after');
    if (after && S.ctx?.me) { lsSet('ponghub_after', ''); setTimeout(() => location.replace(after), 0); }
    pickClub();
    S.data = S.club ? await S.store.loadAll() : EMPTY();
    if (isAdmin()) S.emails = await S.store.adminEmails();
  } catch (e) {
    toast(e.message, 'err');
    S.data = S.data || EMPTY();
  }
  derive();
  if (isAdmin() && !S.emails.size) S.emails = await S.store.adminEmails();
  if (S.me?.status === 'approved' && feature('shop')) { try { await ensureShop(true); } catch { S.shop = null; } }
  else S.shop = null;
  // задания недели (за флажком магазина)
  if (S.me?.status === 'approved' && feature('shop') && S.club) { try { S.tasks = await S.store.rpc('weekly_tasks', { cid: S.club.id }); } catch { S.tasks = null; } } else S.tasks = null;
  if (S.me?.status === 'approved' && predOn() && !S.shop) { try { S.coins = await S.store.rpc('ensure_wallet'); } catch { S.coins = null; } }
  setTimeout(showNews, 600);
}
async function refresh() { await reload(); render(); }

// ───────────── Памятка «Что нового» для тестировщиков нововведений ─────────────
// показывается один раз на каждое открытое нововведение (запоминается на устройстве)
const NEWS = {
  shop: { icon: '🛍️', title: 'Магазин и своя ракетка', text: 'Пинг-коины за игры, ежедневный бонус и награды за лигу. Покупайте основания, накладки, обмотки и ленты — и собирайте свою ракетку, её видно в профиле.' },
  avatar: { icon: '🧍', title: '3D-игрок', text: 'Ваш персонаж: выберите парня или девушку, наденьте форму из магазина (футболки, шорты, кроссовки, носки, напульсники, повязки) и посмотрите жесты. На табло перед матчем игроки выходят на сцену.' },
  resale: { icon: '💸', title: 'Продажа вещей', text: 'Ненужную вещь можно продать обратно за 30% от цены покупки — кнопка в карточке вещи.' },
};
function showNews() {
  // создатель может посмотреть памятку, открыв приложение с ?news в адресе
  const preview = isFounder() && /news/.test(location.search) && !lsGet('ponghub_news_preview_done');
  if (S.newsShown || !S.me || (isFounder() && !preview)) return;
  const uid = S.me.id, key = 'ponghub_news_' + uid, seen = preview ? [] : (lsGet(key) || '').split(',').filter(Boolean);
  const fresh = (preview ? Object.keys(NEWS) : (S.ctx?.myFeatures || [])).filter(f => NEWS[f] && !seen.includes(f));
  if (!fresh.length) return;
  S.newsShown = true;
  const gift = fresh.includes('shop') ? (() => { const { it } = parseKey(STARTER); return it ? `<div class="nw-gift"><span class="nw-badge">🏆 Достижение</span><div class="nw-gift-row"><span class="nw-pic" id="nw-pic"></span><div><b>Подарок на старт</b><span>Основание ${esc(it.brand)} ${esc(it.name)} — уже в ваших вещах и на ракетке</span></div></div></div>` : ''; })() : '';
  openModal(`<div class="nw"><div class="nw-top"><span class="nw-spark">✨</span><h3>Вам открыты нововведения!</h3><p class="muted">Вы среди первых, кто их видит — до запуска для всех.</p></div>
    ${fresh.map(f => `<div class="nw-item"><span class="nw-ic">${NEWS[f].icon}</span><div><b>${NEWS[f].title}</b><p>${NEWS[f].text}</p></div></div>`).join('')}
    ${gift}
    <div class="nw-where">📍 Всё находится в разделе <b>«Профиль»</b> — внизу экрана справа.</div>
    <div class="row-btns"><button class="btn primary full" id="nw-go">Открыть профиль</button></div></div>`, sh => {
    lsSet(key, [...seen, ...fresh].join(','));
    if (preview) lsSet('ponghub_news_preview_done', '1');
    const pic = sh.querySelector('#nw-pic');
    // та же 3D-картинка, что в профиле, — только само основание-подарок, без накладок
    if (pic) { pic.textContent = '🏓'; loadThree().then(() => { const url = racketShot({ blade: STARTER }); if (url) pic.innerHTML = `<img src="${url}" alt="Основание">`; }).catch(() => {}); }
    sh.querySelector('#nw-go').onclick = () => { closeModal(); go('#/me'); };
  });
}

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
  // табло клуба на телевизоре — отдельный экран без входа в аккаунт
  if (r.name === 'tv') {
    if (!S.tvStarted) { S.tvStarted = true; import('./tv.js').then(m => m.startTV($app, S.store)); }
    return;
  }
  if (!S.user) {
    if (r.name === 'join' && r.args[0]) lsSet('ponghub_join', r.args[0]);
    // QR со стола: после входа вернёмся к этому столу
    if ((r.name === 'play' || r.name === 'tournament') && r.args[0]) lsSet('ponghub_after', location.hash);
    html = authView(r);
  }
  else if (S.recovery) html = recoveryView();
  else if (!S.ctx?.me) html = gateView('🤔', 'Профиль не найден', 'Аккаунт создан, но профиль в базе отсутствует. Напишите администратору.', true);
  else if (CLUB_FREE[r.name]) html = CLUB_FREE[r.name](r);
  // QR со стола у человека без клуба — сразу на страницу клуба с заявкой
  else if (!S.club && r.name === 'play' && r.args[0]) html = bare(viewPlay(r));
  else if (!S.club && r.name === 'tournament' && r.q.get('club')) html = bare(viewTournament(r));
  else if (!S.club) html = S.ctx.me.legacy && !S.ctx.platform?.migration_done && !isFounder() ? waitView() : viewClubs(r);
  else {
    const views = { shop: r => feature('shop') ? viewShop(r) : viewHome(r), racket: () => feature('shop') ? viewRacket() : viewHome(), inventory: () => feature('shop') ? viewInventory() : viewHome(), avatar: r => feature('avatar') ? viewAvatar(r) : viewHome(r), invite: viewInvite, clubedit: viewClubEdit, home: viewHome, rating: viewRating, players: viewPlayers, matches: viewMatches, player: viewPlayer, h2h: viewH2H, tournaments: viewTournaments, tournament: viewTournament, calendar: viewCalendar, admin: viewAdmin, rules: viewRules, me: viewMe, help: viewHelp, seasons: viewSeasons, live: viewLive, inbox: viewInbox, predict: viewPredict, play: viewPlay, tables: viewPrint, print: viewPrint };
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
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.6 5.2"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

function pendingCounts() {
  const users = isAdmin() ? S.data.profiles.filter(p => p.status === 'pending').length : 0;
  const matches = isAdmin() ? S.data.matches.filter(m => m.status === 'pending').length : 0;
  return { users, matches, total: users + matches };
}

function shell(r, body) {
  const pc = pendingCounts();
  const tab = (name, label, ic, also = []) => `<a href="#/${name}" class="tab ${r.name === name || also.includes(r.name) ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`;
  const club = settings().clubName || 'PongHub';
  const side = (name, label, ic, also = [], extra = '', cls = '') => `<a href="#/${name}" class="side-i ${cls} ${r.name === name || also.includes(r.name) ? 'on' : ''}" title="${label}"><span>${ic}</span><b>${label}</b>${extra}</a>`;
  const n = pc.total + unreadCount();
  return `
  <header class="top">
    <button class="brand club-switch" data-act="club-menu" aria-label="Мои клубы"><img src="${logo()}" alt="" width="30" height="30"><span>${esc(club)}</span><i class="caret">▾</i></button>
    <div class="top-actions">
      ${S.store.mode === 'demo' ? `<span class="demo-pill" title="Данные хранятся только в этом браузере">${S.store.sandbox ? 'ПЕСОЧНИЦА' : 'ДЕМО'}</span>` : ''}
      <a href="#/calendar" class="icon-btn" aria-label="Календарь">${icon('cal')}</a>
      <a href="#/inbox" class="icon-btn" aria-label="Уведомления">${icon('bell')}${pc.total + unreadCount() ? `<i class="dot">${pc.total + unreadCount()}</i>` : ''}</a>
    </div>
  </header>
  ${S.testMode ? `<div class="test-banner">🧪 <span><b>Тестовый режим.</b> Тестовых игроков и их матчи видите только вы.</span><a href="#/admin/players" class="link">Управлять</a></div>` : ''}
  <aside class="side">
    <button class="brand club-switch" data-act="club-menu" aria-label="Мои клубы"><img src="${logo()}" alt="" width="34" height="34"><span>${esc(club)}</span><i class="caret">▾</i></button>
    <button class="btn primary side-add" data-act="add-match">${icon('plus')} ${isAdmin() ? 'Внести матч' : 'Внести результат'}</button>
    <nav class="side-nav">
      ${side('home', 'Главная', '🏠')}${side('players', 'Игроки', '👥', ['player'])}${side('tournaments', 'Турниры', '🏆', ['tournament'])}
      ${side('rating', 'Рейтинг', '📊', ['seasons'])}${side('matches', 'Матчи', '📋', ['h2h'])}${predOn() ? side('predict', 'Прогнозы', '🎯') : ''}${side('calendar', 'Календарь', '📅', [], '', 'ico')}
      ${feature('shop') || feature('avatar') ? '<hr>' : ''}${feature('shop') ? `<a href="#/shop" class="side-i ${r.name === 'shop' && SHOP.region !== 'skin' ? 'on' : ''}" title="Магазин" data-act="shop-open"><span>🛍️</span><b>Магазин</b></a><a href="#/shop" class="side-i ${r.name === 'shop' && SHOP.region === 'skin' ? 'on' : ''}" title="Коллекция" data-act="coll-open"><span>🏆</span><b>Коллекция</b></a>` + side('inventory', 'Мой инвентарь', '🎒') + side('racket', 'Моя ракетка', '🏓') : ''}${feature('avatar') ? side('avatar', 'Мой игрок', '🧍') : ''}
      ${side('inbox', 'Уведомления', '🔔', [], n ? `<i class="dot inline">${n}</i>` : '', 'ico side-bell')}
      <hr>${side('me', 'Профиль', '👤', [], '', 'ico')}${isAdmin() ? side('admin', 'Управление', '🛠️', ['rules', 'invite', 'print', 'clubedit'], pc.total ? `<i class="dot inline">${pc.total}</i>` : '', 'ico') : ''}
    </nav>
  </aside>
  <main class="page pg-${esc(r.name)}">${body}</main>
  <nav class="tabs">
    ${tab('home', 'Главная', 'home')}
    ${tab('players', 'Игроки', 'users', ['player'])}
    <span class="tab tab-mid"><button class="fab" data-act="add-match" aria-label="${isAdmin() ? 'Внести матч' : 'Внести результат'}">${icon('plus')}</button></span>
    ${tab('tournaments', 'Турниры', 'cup', ['tournament'])}
    ${tab('me', 'Профиль', 'user', ['admin', 'rules', 'matches', 'h2h', 'rating', 'seasons'])}
  </nav>${iosInstallHint()}`;
}

function gateView(emoji, title, text, refreshBtn = false) {
  return `<div class="auth-wrap"><div class="auth-card center">
    <div class="gate-emoji">${emoji}</div><h2>${title}</h2><p class="muted">${text}</p>
    <div class="row-btns">${refreshBtn ? '<button class="btn primary" data-act="refresh">Проверить снова</button>' : ''}<button class="btn ghost" data-act="logout">Выйти</button></div>
  </div></div>`;
}

// ───────────── Песочница: гид и боты ─────────────
function sandboxState() {
  const st = S.store, cid = S.club?.id;
  const bots = st.bots(), inClub = bots.filter(b => st.mem(cid, b.id)), active = inClub.filter(b => st.mem(cid, b.id).status === 'active');
  return { invited: inClub.length > 0, accepted: active.length >= 2, played: S.data.matches.length > 0,
    live: (st.db.live_matches || []).some(l => l.club_id === cid && l.bot), challenged: S.data.challenges.some(c => c.from_id === S.me.id && st.db.profiles.find(p => p.id === c.to_id)?.bot) };
}
function sandboxButtons() {
  return `<div class="sb-btns"><button class="btn" data-act="sb-bots">🤖 Боты отправят заявки</button><button class="btn" data-act="sb-play">🏓 Боты сыграют 10 матчей</button><button class="btn" data-act="sb-live">🔴 Боты начнут живую игру</button></div>`;
}
function sandboxGuide() {
  if (!S.store.sandbox || !isAdmin()) return '';
  const g = sandboxState();
  const steps = [
    [g.invited, 'Пригласите игроков', 'В настоящем клубе вы отправите ссылку или повесите QR. Здесь приглашение получат боты.', '<button class="btn sm primary" data-act="sb-bots">🤖 Пригласить ботов</button>'],
    [g.accepted, 'Примите заявки', 'Вы решаете, кого пустить в клуб.', '<a class="btn sm" href="#/admin/reqs">Открыть заявки</a>'],
    [g.played, 'Матчи и рейтинг', 'Боты сыграют между собой — появятся рейтинг, история и топ.', '<button class="btn sm" data-act="sb-play">🏓 Сыграть 10 матчей</button>'],
    [g.live, 'Живая игра', 'Счёт идёт очко за очком, все видят его вживую, можно делать прогнозы.', '<button class="btn sm" data-act="sb-live">🔴 Начать игру ботов</button>'],
    [g.challenged, 'Вызовите бота на матч', 'Бот примет вызов — дальше «▶ Начать игру» и счёт.', '<a class="btn sm" href="#/players">Игроки →</a>'],
  ];
  const done = steps.filter(x => x[0]).length;
  if (done === steps.length && lsGet('ponghub_sb_guide') === 'hide') return '';
  return `<section class="card sb-guide"><div class="card-h"><h3>🧪 Песочница: попробуйте по шагам</h3><span class="muted small">${done} из ${steps.length}</span></div>
    ${steps.map(([ok, t, d, btn], i) => `<div class="sb-step ${ok ? 'ok' : ''}"><i>${ok ? '✓' : i + 1}</i><div><b>${t}</b><small>${d}</small></div>${ok ? '' : btn}</div>`).join('')}
    <small class="muted">Ещё стоит заглянуть: «Турниры» (создайте турнир с ботами), «Печать» (плакат и домики с QR), «Пригласить в клуб».${done === steps.length ? ' <a href="#" data-act="sb-hide" class="link">Скрыть гид</a>' : ''}</small></section>`;
}

// ───────────── Вход / регистрация ─────────────
function sandboxAuth() {
  return `<div class="auth-wrap"><div class="auth-hero"><img src="${logo()}" alt="" width="84" height="84"><h1>PongHub</h1><p>Песочница для организатора</p></div>
    <div class="auth-card"><form data-form="sb-start" class="stack">
      <h2>Попробуйте как организатор</h2>
      <p class="muted small">Это тестовая копия приложения: вы создаёте свой клуб, а играть в нём будут боты — они примут приглашение, сыграют матчи и живую игру. Всё хранится только на этом устройстве и не попадает в настоящие клубы.</p>
      <label>Как вас называть (ник)<input name="nickname" required minlength="2" maxlength="20" placeholder="Например: Coach" autocomplete="nickname"></label>
      <button class="btn primary big">Начать →</button>
      <p class="muted small center">Регистрация, email и пароль не нужны.</p>
    </form></div></div>`;
}
function authView(r) {
  if (S.store.sandbox) return sandboxAuth();
  const mode = r.name === 'join' ? 'register' : ['register', 'forgot'].includes(r.name) ? r.name : 'login';
  const demo = S.store.mode === 'demo';
  const head = `<div class="auth-hero"><img src="${logo()}" alt="" width="84" height="84"><h1>PongHub</h1><p>Клубы настольного тенниса: рейтинг, матчи, турниры</p></div>
    ${lsGet('ponghub_join') ? '<div class="auth-card invite-note">✉️ Вас пригласили в клуб. Зарегистрируйтесь или войдите — заявка в клуб отправится сама.</div>'
      : lsGet('ponghub_after')?.includes('/tournament/') ? '<div class="auth-card invite-note">🏆 Вас ждёт турнир. Зарегистрируйтесь или войдите — и откроется запись (если вы ещё не в клубе, заявка отправится сама).</div>'
      : lsGet('ponghub_after') ? '<div class="auth-card invite-note">🏓 Вы у стола клуба. Зарегистрируйтесь или войдите — и сразу к игре (если вы ещё не в клубе, заявка отправится сама).</div>' : ''}`;
  let form;
  if (mode === 'register') form = `
    <form data-form="register" class="stack">
      <h2>Регистрация</h2>
      <label>Ник (будет виден в рейтинге)<input name="nickname" required minlength="2" maxlength="20" pattern="[A-Za-zА-Яа-яЁё0-9_\\-. ]+" autocomplete="nickname"></label>
      <label>Имя и фамилия<input name="full_name" required maxlength="60" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Пароль<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
      <button class="btn primary big">Зарегистрироваться</button>
      <p class="muted small center">${lsGet('ponghub_join') ? 'После регистрации заявка в клуб, куда вас пригласили, отправится сама.' : lsGet('ponghub_after')?.includes('/tournament/') ? 'После регистрации сразу откроется турнир — останется нажать «Записаться».' : 'После регистрации вы сможете вступить в клуб по приглашению или найти клуб.'}</p>
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
  const tgBox = mode === 'forgot' ? '' : `<div class="auth-or"><span>или</span></div>
    <button class="btn tg-btn big full" data-act="tg-login">${TG_ICON} ${mode === 'register' ? 'Зарегистрироваться через Telegram' : 'Войти через Telegram'}</button>`;
  return `<div class="auth-wrap">${head}<div class="auth-card">${form}${tgBox}</div>${demoBox}</div>${iosInstallHint(true)}`;
}

function recoveryView() {
  return `<div class="auth-wrap"><div class="auth-card"><form data-form="newpass" class="stack">
    <h2>Новый пароль</h2>
    <label>Пароль<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
    <button class="btn primary big">Сохранить</button></form></div></div>`;
}

// ───────────── Компоненты ─────────────
const players = m => (isDoubles(m) ? [m.player1_id, m.player2_id, m.player3_id, m.player4_id] : [m.player1_id, m.player2_id]);
const teamName = (m, side) => isDoubles(m)
  ? `${P(side === 1 ? m.player1_id : m.player2_id).nickname} + ${P(side === 1 ? m.player3_id : m.player4_id).nickname}`
  : P(side === 1 ? m.player1_id : m.player2_id).nickname;
const wonBy = (m, id) => (isDoubles(m) ? (m.winner_id === m.player1_id) === (id === m.player1_id || id === m.player3_id) : m.winner_id === id);

function doublesCard(m, ctx) {
  const d = S.D.md.get(m.id);
  const w1 = m.winner_id === m.player1_id;
  const line = (id, right) => `<span class="dp ${right ? 'right' : ''}">${right ? '' : ava(P(id), 'xs')}<span class="nick">${esc(P(id).nickname)}</span>${right ? ava(P(id), 'xs') : ''}${d && m.rated !== false ? delta(d.delta[id], 'xs') : ''}</span>`;
  const sets = (m.sets || []).map(s => `<span>${s[0]}:${s[1]}</span>`).join('');
  const status = m.status === 'pending' ? '<span class="badge warn">ждёт подтверждения</span>' : '';
  const hl = ctx ? (wonBy(m, ctx) ? 'hl-win' : 'hl-loss') : '';
  return `<div class="mcard ${hl}" data-act="match" data-id="${m.id}">
    <div class="mmeta"><span class="badge dbl">2×2</span>${m.rated === false ? '<span class="badge">без рейтинга</span>' : ''}${status}<span class="mdate">${fmtDT(m.played_at)}</span></div>
    <div class="mrow"><div class="mp team ${w1 ? 'win' : ''}">${line(m.player1_id)}${line(m.player3_id)}</div>
      <div class="mscore"><b class="${w1 ? 'w' : ''}">${m.sets1}</b>:<b class="${!w1 ? 'w' : ''}">${m.sets2}</b></div>
      <div class="mp team right ${!w1 ? 'win' : ''}">${line(m.player2_id, true)}${line(m.player4_id, true)}</div></div>
    ${sets ? `<div class="msets">${sets}</div>` : ''}
  </div>`;
}

function matchCard(m, ctx = null) {
  if (isDoubles(m)) return doublesCard(m, ctx);
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
      ${t ? `<span class="tname">${esc(t.name)}</span>` : ''}${m.rated === false ? '<span class="badge">без рейтинга</span>' : ''}${status}<span class="mdate">${fmtDT(m.played_at)}</span></div>
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

const visibleMatch = m => m.status === 'approved' || isAdmin() || m.submitted_by === S.me.id || players(m).includes(S.me.id);

// ───────────── Главная ─────────────
function viewHome() {
  const me = S.me;
  const r = ratingOf(me.id);
  const pos = S.rank.findIndex(x => x.p.id === me.id) + 1;
  const total = S.rank.length;
  const hist = S.A.history.get(me.id) || [];
  const d30 = r - ratingAt(S.A, me.id, Date.now() - 30 * DAY);
  const st = playerStats(me.id, S.A, S.data.tournaments);
  const pom = playerOfMonth(S.A, S.data.profiles);
  const pc = pendingCounts();
  const recent = S.data.matches.filter(m => m.status === 'approved' && (isAdmin() || players(m).includes(me.id))).sort((a, b) => ts(b) - ts(a)).slice(0, 6);
  const upcoming = upcomingItems().slice(0, 3);
  const active = S.data.tournaments.filter(t => t.status === 'active');
  const mine = S.data.matches.filter(m => m.status === 'pending' && m.submitted_by === me.id);

  // главная — плитки (вариант 3): «я», пинг-коины, бонус дня, дальше всё живое; 3D-игрок — в Профиле
  const showRk = feature('shop') && S.shop;
  const bonus = S.shop && !S.shop.streak.claimed;
  const coins = S.coins != null && (feature('shop') || predOn());
  const nl = nextLeague(r);
  const bigHero = `<section class="hero table-card hm h-hero">
    <div class="hm-top"><div><div class="hero-top">${ava(me, 'lg')}<div class="hero-id"><div class="hello">Привет,</div><div class="hero-nick">${esc(me.nickname)}</div><div class="badges">${leagueBadge(r)}${roleBadge(me)}</div></div></div>
      <div class="hm-place">${st.matches ? pos : '—'} <small>место из ${total}</small></div></div>
      ${showRk ? '<a href="#/racket" class="hm-frame hm-rk" id="hm-rk" aria-label="Моя ракетка"></a>' : ''}</div>
    <div class="hero-mid"><div><div class="big-num">${fmtR(r)}</div><div class="muted small">рейтинг · ${delta(d30)} за 30 дней</div></div>${sparkline(hist.slice(-20))}</div>
    <div class="hero-stats"><div><b>${st.wins}</b><small>побед</small></div><div><b>${st.losses}</b><small>поражений</small></div>
      <div><b>${pct(st.winRate)}</b><small>% побед</small></div><div><b>${st.streakType === 'W' ? '🔥' + st.streak : 0}</b><small>серия побед</small></div></div>
    ${nl ? `<div class="next-league"><span>До лиги «${nl.name}»: ${fmtR(nl.min - r)}</span><div class="bar thin"><i style="width:${Math.max(4, Math.min(100, 100 - (nl.min - r) * 5))}%"></i></div></div>` : ''}
    <div class="row-btns hero-links"><a href="#/player/${me.id}" class="btn ghost-light">Статистика и анализ →</a></div>
  </section>`;
  const meTile = `<section class="bt bt-me">
    <a href="#/player/${me.id}" class="bt-me-main">${ava(me, 'lg')}<div class="bt-me-id"><div class="bt-hi">Привет, <b class="bt-nick">${esc(me.nickname)}</b></div>
      <div class="bt-me-num"><div class="big-num">${fmtR(r)}</div><div class="badges">${leagueBadge(r)}${roleIcon(me)}</div></div>
      <small>${st.matches ? `${pos}-е место из ${total}` : 'ещё нет матчей'} · <span title="за 30 дней">${delta(d30)}</span></small></div></a>
    ${showRk ? '<a href="#/racket" class="hm-frame bt-rk" id="hm-rk" aria-label="Моя ракетка"></a>' : `<div class="bt-spark">${sparkline(hist.slice(-20))}</div>`}
  </section>`;
  const coinTile = !coins ? '' : S.shop ? `<a href="#/shop" class="bt bt-coin half"><h4>🪙 Пинг-коины</h4><b>${fmtC(S.coins)}<i>PC</i></b><span class="bt-go">Магазин →</span></a>`
    : `<a href="${feature('shop') ? '#/shop' : '#/predict'}" class="bt bt-coin bt-row"><h4>🪙 Пинг-коины</h4><b>${fmtC(S.coins)}<i>PC</i></b><span class="bt-go">${feature('shop') ? 'Магазин' : 'Прогнозы'} →</span></a>`;
  const bonusTile = S.shop ? `<a href="#/shop?tab=bonus" class="bt bt-bonus half ${bonus ? '' : 'done'}"><h4>🔥 Бонус дня</h4><b>${bonus ? '+' + STREAK[S.shop.streak.day - 1] : '✓'}<i>${bonus ? 'PC' : 'получен'}</i></b><span class="bt-go">${bonus ? 'Забрать' : 'Завтра ещё'} →</span></a>` : '';
  const W = feature('shop') && S.tasks;
  const tDone = W ? W.tasks.filter(t => t.have >= t.goal).length : 0;
  const tReady = W ? W.tasks.filter(t => t.have >= t.goal && !(W.claimed || []).includes(t.key)).reduce((a, t) => a + t.reward, 0) : 0;
  const cur = S.seasons.find(t => !t.finished), sp = cur && seasonPlace(cur, me.id), left = seasonDaysLeft();
  const ssnTile = `<a href="#/seasons" class="bt bt-ssn ${W ? 'half' : ''}"><h4>⭐ Сезон</h4>
    ${pom ? `<b>${esc(P(pom.id).nickname)}</b><small>лидер · ${fmtD(pom.g)}</small>` : '<b>Борьба за титул</b>'}
    <small>${sp?.place ? `вы ${sp.place}-й · ` : ''}до конца ${left} ${plural(left, 'день', 'дня', 'дней')}</small></a>`;
  const tourTiles = S.data.tournaments.filter(t => t.status === 'open' && !tReg(t).includes(me.id)).slice(0, 2).map(t => `<a href="#/tournament/${t.id}" class="bt bt-tour"><h4>🏆 Запись на турнир</h4><b>${esc(t.name)}</b><small>📅 ${esc(tWhen(t))}${t.place ? ' · 📍 ' + esc(t.place) : ''} · записались: ${tReg(t).length}</small><span class="bt-go">Записаться →</span></a>`).join('');
  const activeTiles = active.map(t => `<a href="#/tournament/${t.id}" class="card live-t"><span class="live">● LIVE</span><div><b>${esc(t.name)}</b><div class="muted small">${FORMATS[t.format]} · ${t.participants.length} участников</div></div><span>→</span></a>`).join('');
  const desk = matchMedia('(min-width: 1024px)').matches;
  const topSec = `<section class="card">
    <div class="card-h"><h3>Топ-5</h3><a href="#/rating" class="link">Весь рейтинг →</a></div>
    ${S.rank.slice(0, 5).map((x, i) => rankRow(x, i)).join('') || '<div class="empty">Пока нет игроков</div>'}
  </section>`;
  const eventsSec = upcoming.length ? `<section class="card"><div class="card-h"><h3>Ближайшие события</h3><a href="#/calendar" class="link">Календарь →</a></div>${upcoming.map(eventRow).join('')}</section>` : '';
  const matchesSec = `<section class="h-matches">
    <div class="sec-h"><h3>${isAdmin() ? 'Последние матчи' : 'Мои последние матчи'}</h3><a href="#/matches" class="link">Все →</a></div>
    ${recent.map(m => matchCard(m)).join('') || `<div class="card first-match"><div class="fm-ic">🏓</div><b>Здесь появятся ваши матчи</b>
      <p class="muted small">Сыграйте первую игру и внесите счёт — сразу появится рейтинг, история и статистика. Рейтинг клуба и игроков уже можно посмотреть.</p>
      <div class="row-btns"><a href="#/rating" class="btn ghost">Рейтинг клуба</a><button class="btn primary" data-act="add-match">Внести первый матч</button></div></div>`}
  </section>`;
  // компьютер: две колонки. Слева — «я», вызовы, (Кого вызвать), Топ-5, (события).
  // Справа — 3D-игрок в полный рост (кому открыт) рядом со столбиком плиток, ниже (события) и история матчей
  const opps = desk && !feature('avatar') ? suggestOpponents(3) : [];
  const deskTile = !desk ? '' : feature('avatar')
    ? `<a href="#/avatar" class="bt bt-pl"><div class="hm-frame" id="hm-pl" data-full="1"></div><span class="hm-tag">Мой игрок</span></a>`
    : opps.length ? `<section class="bt bt-opp"><h4>⚔️ Кого вызвать</h4><p class="muted small">Соперники по силам — ближе всех к вам по рейтингу</p>
      ${opps.map(({ p }) => `<div class="plx-row"><a href="#/player/${p.id}" class="pl-main">${ava(p, 'md')}<span class="rn"><b>${esc(p.nickname)}</b><small>${fmtR(ratingOf(p.id))} · шанс ${pct(expected(r, ratingOf(p.id), S.A.S.spread))}</small></span></a>${challengeBtn(p.id)}</div>`).join('')}
      <a href="#/players" class="bt-go">Все игроки →</a></section>` : '';
  const taskTile = W ? `<a href="#/shop?tab=bonus" class="bt half"><h4>🎯 Задания</h4><b class="bt-n">${tDone}/${W.tasks.length}</b><div class="wt-bar"><i style="width:${tDone / W.tasks.length * 100}%"></i></div><small>${tReady ? `+${tReady} PC ждут` : 'неделя идёт'}</small></a>` : '';

  return `
  ${sandboxGuide()}
  ${pc.total ? `<a href="#/admin" class="alert">🔔 Ждут вашего решения: ${pc.users ? `${pc.users} ${plural(pc.users, 'заявка', 'заявки', 'заявок')} на регистрацию` : ''}${pc.users && pc.matches ? ', ' : ''}${pc.matches ? `${pc.matches} ${plural(pc.matches, 'матч', 'матча', 'матчей')}` : ''} →</a>` : ''}
  ${mine.length ? `<div class="alert info">⏳ ${mine.length} ${plural(mine.length, 'ваш результат ждёт', 'ваших результата ждут', 'ваших результатов ждут')} подтверждения администратором</div>` : ''}

  ${desk ? (() => {
    const pl = feature('avatar');
    // с игроком: рядом с ним — коины, бонус и «сейчас играют»; ниже во всю ширину — турниры, прогнозы, сезон, задания, итоги недели
    const mv = h => (h ? `<div class="mv">${h}</div>` : '');
    const stack = pl ? `<div class="bento h-stack">${coinTile}${bonusTile}${liveBlock()}</div>`
      : `<div class="bento h-stack">${coinTile}${bonusTile}${liveBlock()}</div>`;
    // остальное — отдельными блоками, чтобы раскладывать по колонкам
    const ssnRow = ssnTile + taskTile ? `<div class="bento">${ssnTile}${taskTile}</div>` : '';
    const below = `${tourTiles ? `<div class="bento">${tourTiles}</div>` : ''}${activeTiles}${mv(predHomeBlock())}${mv(ssnRow)}${pl ? mv(weekCard()) : ''}`;
    return `<div class="bento-2"><div class="h-col">${bigHero}${challengesBlock()}${idleNudge()}${pl ? '' : deskTile}${mv(topSec)}${pl ? mv(eventsSec) : mv(weekCard())}</div>
      <div class="h-col">${pl ? `<div class="h-plrow">${deskTile}${stack}</div>` : stack}${below}${pl ? '' : mv(eventsSec)}${mv(matchesSec)}</div></div>`;
  })()
  : `<div class="bento">${meTile}${coinTile}${bonusTile}${tourTiles}${liveBlock()}${activeTiles}${predHomeBlock()}${challengesBlock()}${idleNudge()}${ssnTile}${taskTile}${weekCard()}</div>`}

  ${desk ? '' : topSec + eventsSec + matchesSec}`;
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
function viewRating(r) {
  const mode = r?.q.get('mode') === 'doubles' ? 'doubles' : 'singles';
  const tabs = `<div class="seg"><a href="#/rating" class="${mode === 'singles' ? 'on' : ''}">Одиночный 1×1</a><a href="#/rating?mode=doubles" class="${mode === 'doubles' ? 'on' : ''}">Парный 2×2</a></div>`;
  const head = `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div><div class="page-h"><h1>Рейтинг</h1><div class="row-inline"><a href="#/seasons" class="link">🏆 Сезоны</a>${isAdmin() ? '<a href="#/rules" class="link">Как считается?</a>' : ''}</div></div>${tabs}`;
  if (mode === 'doubles') {
    const list = rankingDoubles(S.D, S.data.profiles);
    return `${head}<p class="muted small">Отдельный рейтинг только по парным играм. У всех стартует с ${S.D.S.initialRating}.</p>
      <section class="card">${list.map((x, i) => `<a href="#/player/${x.p.id}" class="rank-row ${x.p.id === S.me.id ? 'me' : ''}">
        <span class="pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${ava(x.p, 'sm')}
        <span class="rn"><b>${esc(x.p.nickname)}</b><small>${x.st.wins}В · ${x.st.losses}П · ${pct(x.st.wins / x.g)}</small></span>
        <span class="rr"><b>${fmtR(x.r)}</b></span></a>`).join('') || '<div class="empty">Парных игр пока не было. Нажмите «+» → «2×2».</div>'}</section>`;
  }
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
  ${head}
  ${podium}
  <section class="card">${byLeague || '<div class="empty">Пока никто не сыграл ни одного матча</div>'}</section>
  ${none.length ? `<section class="card"><div class="card-h"><h3>Ещё без матчей</h3></div>${none.map(x => rankRow(x, 0)).join('')}</section>` : ''}`;
}

// ───────────── Матчи ─────────────
function viewMatches(r) {
  const type = r.q.get('type') || 'all';
  const pl = r.q.get('p') || '';
  let list = S.data.matches.filter(visibleMatch);
  if (!isAdmin()) list = list.filter(m => players(m).includes(S.me.id));
  if (type === 'doubles') list = list.filter(isDoubles);
  else if (type !== 'all') list = list.filter(m => !isDoubles(m) && m.type === type);
  if (pl) list = list.filter(m => players(m).includes(pl));
  list.sort((a, b) => ts(b) - ts(a));
  const groups = new Map();
  for (const m of list) { const k = fmtDate(m.played_at, { day: 'numeric', month: 'long', year: 'numeric' }); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const qs = (t, p) => `#/matches?type=${t}${p ? '&p=' + p : ''}`;
  const plist = S.data.profiles.filter(p => p.status === 'approved').sort((a, b) => a.nickname.localeCompare(b.nickname));
  return `
  <div class="page-h"><h1>${isAdmin() ? 'Матчи' : 'Мои матчи'}</h1><button class="btn sm" data-act="h2h-pick">⚔️ Личные встречи</button></div>
  <div class="seg">
    <a href="${qs('all', pl)}" class="${type === 'all' ? 'on' : ''}">Все</a>
    <a href="${qs('free', pl)}" class="${type === 'free' ? 'on' : ''}">Свободные</a>
    <a href="${qs('tournament', pl)}" class="${type === 'tournament' ? 'on' : ''}">Турнирные</a>
    <a href="${qs('doubles', pl)}" class="${type === 'doubles' ? 'on' : ''}">Пары</a>
  </div>
  ${isAdmin() ? `<select class="filter" data-act-change="filter-player" data-type="${type}">
    <option value="">Все игроки</option>${plist.map(p => `<option value="${p.id}" ${p.id === pl ? 'selected' : ''}>${esc(p.nickname)}</option>`).join('')}
  </select>` : ''}
  ${[...groups].map(([k, ms]) => `<div class="day-h">${k}</div>${ms.map(m => matchCard(m, pl || null)).join('')}`).join('') || '<div class="empty">Матчей не найдено</div>'}`;
}

// ───────────── Игрок ─────────────
function viewPlayer(r) {
  const id = r.args[0] || S.me.id;
  const p = S.byId.get(id);
  if (!p) return '<div class="empty">Игрок не найден</div>';
  if (p.status === 'deleted') return `<div class="empty">👤 Этот игрок удалён из клуба.<br>Его матчи сохранены в истории соперников.</div>`;
  const st = playerStats(id, S.A, S.data.tournaments);
  const rt = ratingOf(id);
  const decay = S.A.decayTotal.get(id) || 0;
  const titles = S.seasons.filter(t => t.finished && t.champion?.id === id);
  const pos = S.rank.findIndex(x => x.p.id === id) + 1;
  const hist = S.A.history.get(id) || [];
  const nl = nextLeague(rt);
  const ins = insights(st);
  const opps = [...st.opponents].map(([oid, o]) => ({ oid, ...o })).sort((a, b) => (b.w + b.l) - (a.w + a.l));
  const unlocked = ACHIEVEMENTS.filter(a => a.test(st));
  S.badges = badgesOf(id, st);
  const special = S.badges.filter(b => !ACHIEVEMENTS.some(a => a.name === b.name));
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
    ${badgeStrip(S.badges)}
    <div class="hero-mid"><div><div class="big-num">${fmtR(rt)}</div><div class="muted small">пик ${fmtR(st.peak)} · старт ${fmtR(hist[0]?.r)}${decay > 0.005 ? ` · −${fmtR(decay)} за паузы в игре` : ''}</div></div>
      ${medalsTotal || titles.length ? `<div class="medals" title="${titles.map(t => 'Чемпион сезона: ' + monthName(t.key)).join(', ')}">${'🏆'.repeat(titles.length)}${'🥇'.repeat(st.medals.gold)}${'🥈'.repeat(st.medals.silver)}${'🥉'.repeat(st.medals.bronze)}</div>` : ''}</div>
    ${nl ? `<div class="next-league"><span>До лиги «${nl.name}»: ${fmtR(nl.min - rt)}</span><div class="bar thin"><i style="width:${Math.max(4, Math.min(100, 100 - (nl.min - rt) * 5))}%"></i></div></div>` : ''}
    <div class="row-btns">
      ${mine ? '<button class="btn ghost-light" data-act="edit-profile">✏️ Редактировать</button>' : `<a class="btn ghost-light" href="#/h2h/${S.me.id}/${id}">📊 Сравнить</a>${p.status === 'approved' && !openChallenge(id) ? `<button class="btn ghost-light" data-act="challenge" data-id="${id}">⚔️ Вызвать на матч</button>` : ''}`}
      <button class="btn ghost-light" data-act="share-player" data-id="${id}">📤 Карточка в чат</button>
    </div>
  </section>
  ${feature('avatar') ? `<section class="card"><div class="card-h"><h3>🧍 Игрок</h3><a href="#/avatar/${p.id}" class="link">${p.id === S.me.id ? 'Мой игрок →' : 'Посмотреть →'}</a></div><p class="muted small">3D-игрок в форме и с ракеткой${p.id === S.me.id ? '' : ' соперника'}.</p></section>` : ''}
  ${feature('shop') ? playerRacketCard(p) : ''}

  <section class="stat-grid">
    <div><b>${st.matches}</b><small>матчей</small></div>
    <div><b class="up">${st.wins}</b><small>побед</small></div>
    <div><b class="down">${st.losses}</b><small>поражений</small></div>
    <div><b>${pct(st.winRate)}</b><small>% побед</small></div>
    <div><b>${st.setsW}:${st.setsL}</b><small>партии</small></div>
    <div><b>${st.streakType === 'W' ? '🔥' + st.streak : 0}</b><small>серия побед</small></div>
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

  ${doublesBlock(id)}
  ${seasonsBlock(id)}

  <section class="card"><div class="card-h"><h3>🏅 Достижения</h3><span class="muted small">${unlocked.length} из ${ACHIEVEMENTS.length}</span></div>
    ${special.length ? `<div class="ach-grid mb">${special.map(b => `<div class="ach ok special"><span class="ach-i">${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('')}</div>` : ''}
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
  const open = S.data.tournaments.filter(t => t.status === 'open').sort((a, b) => (a.starts_at || a.date || '').localeCompare(b.starts_at || b.date || ''));
  const openCard = t => { const on = tReg(t).includes(S.me.id); return `<a href="#/tournament/${t.id}" class="card t-card t-open">
      <div class="t-ic">📅</div>
      <div class="t-body"><b>${esc(t.name)}</b><small class="muted">${esc(tWhen(t))}${t.place ? ' · ' + esc(t.place) : ''}</small>
      <small>✍️ записались: ${tReg(t).length}${on ? ' · <b class="up">вы в списке</b>' : ''}</small></div>
      <span class="badge ${on ? 'ok' : 'tour'}">${on ? '✓' : 'Записаться'}</span></a>`; };
  const card = t => {
    const r = t.results;
    return `<a href="#/tournament/${t.id}" class="card t-card">
      <div class="t-ic">${t.status === 'active' ? '🏓' : '🏆'}</div>
      <div class="t-body"><b>${esc(t.name)}</b><small class="muted">${t.date ? fmtDate(t.date, { day: 'numeric', month: 'long', year: 'numeric' }) : ''} · ${t.participants.length} уч. · ${FORMATS[t.format].split(' (')[0]}</small>
      ${r && r.gold ? `<small>🥇 ${esc(P(r.gold).nickname)}${r.silver ? ` · 🥈 ${esc(P(r.silver).nickname)}` : ''}${(r.bronze || []).length ? ` · 🥉 ${r.bronze.map(x => esc(P(x).nickname)).join(', ')}` : ''}</small>` : ''}</div>
      ${t.status === 'active' ? '<span class="live">● идёт</span>' : ''}</a>`;
  };
  return `<div class="page-h"><h1>Турниры</h1>${isAdmin() ? '<button class="btn primary sm" data-act="new-tournament">+ Создать</button>' : ''}</div>
    ${open.length ? `<div class="sec-h"><h3>Запись открыта</h3></div>${open.map(openCard).join('')}` : ''}
    ${active.length ? `<div class="sec-h"><h3>Идут сейчас</h3></div>${active.map(card).join('')}` : ''}
    <div class="sec-h"><h3>Архив</h3></div>${done.map(card).join('') || '<div class="empty">Завершённых турниров пока нет</div>'}`;
}

function tMatches(t) { return S.data.matches.filter(m => m.tournament_id === t.id && m.status !== 'rejected'); }

function koBlock(t, slots, ms) {
  const br = koBracket(slots, ms, t.config.thirdPlace);
  const can = isAdmin() && t.status === 'active';
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
  const can = isAdmin() && t.status === 'active';
  const adv = grp !== null ? (t.config.advance || 2) : 1;
  const table = `<div class="tp-list">${st.list.map((x, i) => `<a href="#/player/${x.id}" class="tp-row ${i < adv && (grp !== null || st.played) ? 'go' : ''}"><span class="n">${i + 1}</span>${ava(P(x.id), 'sm')}<b class="nk">${esc(P(x.id).nickname)}</b><span class="w"><b>${x.w}</b> из ${x.p}</span></a>`).join('')}</div>
    ${grp !== null ? `<p class="muted small tp-adv">🟨 в плей-офф выходят ${adv} лучших</p>` : ''}`;
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

// ближайшая несыгранная пара турнира (для карточки «Следующий матч»)
function tNext(t, ms) {
  // пара, которая уже играет на каком-то столе, — не «следующая»
  const playing = (a, b) => S.data.live.some(l => l.tournament_id === t.id && ((l.player1_id === a && l.player2_id === b) || (l.player1_id === b && l.player2_id === a)));
  if (t.format === 'ko' || (t.format === 'groups' && t.config.slots && ms.some(m => m.stage === 'ko'))) {
    if (!t.config.slots) return null;
    const br = koBracket(t.config.slots, ms.filter(m => m.stage === 'ko' || m.stage === 'ko3'), t.config.thirdPlace);
    for (const row of br.rounds) for (const c of row) if (c.a && c.b && !c.match && !c.bye && !playing(c.a, c.b)) return { a: c.a, b: c.b, act: `data-act="kocell" data-t="${t.id}" data-r="${c.r}" data-i="${c.i}"`, note: roundName(c.r, br.rounds.length) };
    if (br.third && br.third.a && br.third.b && !br.third.match && !playing(br.third.a, br.third.b)) return { a: br.third.a, b: br.third.b, act: `data-act="kocell" data-t="${t.id}" data-r="third" data-i="0"`, note: 'за 3-е место' };
    return null;
  }
  const groups = t.format === 'groups' ? (t.config.groups || []).map((g, i) => ({ ids: g, stage: 'grp', grp: i })) : [{ ids: t.participants, stage: 'rr', grp: null }];
  for (const g of groups) for (const [a, b] of pairings(g.ids)) if (!findPairMatch(ms, g.stage, a, b, g.grp) && !playing(a, b))
    return { a, b, act: `data-act="fixture" data-t="${t.id}" data-a="${a}" data-b="${b}" data-stage="${g.stage}" data-grp="${g.grp ?? ''}"`, note: g.grp === null ? 'каждый с каждым' : `группа ${String.fromCharCode(1040 + g.grp)}` };
  return null;
}
const T_HOW = { ko: 'Проиграл — выбыл. Победитель идёт дальше по сетке, финал решает, кто чемпион.', rr: 'Каждый сыграет со всеми по разу. У кого больше побед — тот выше.', groups: 'Игроки поделены на группы, в группе каждый играет с каждым. Лучшие из групп — в плей-офф на вылет.' };

function viewTournament(r) {
  const cid = r.q.get('club');
  // QR турнира: клуб из ссылки, в котором вас нет — страница клуба, заявка уходит сама
  if (cid && S.club?.id !== cid) {
    if ((S.ctx?.clubs || []).some(c => c.id === cid && c.my_status === 'active')) { setTimeout(() => switchClub(cid).then(() => location.replace(`#/tournament/${r.args[0]}`)), 0); return '<div class="empty"><span class="spin"></span></div>'; }
    return viewTournamentPublic(r);
  }
  const t = tById(r.args[0]);
  if (!t) return '<div class="empty">Турнир не найден</div>';
  if (t.status === 'open') return viewTournamentOpen(t);
  const ms = tMatches(t);
  const can = isAdmin();
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
  const nx = t.status === 'active' ? tNext(t, ms) : null;
  const nextCard = nx ? `<section class="t-next"><div><small>Следующий матч · ${esc(nx.note)}</small><b>${esc(P(nx.a).nickname)} — ${esc(P(nx.b).nickname)}</b></div>${can ? `<button class="btn" ${nx.act}>Начать ▶</button>` : ''}</section>` : '';
  return `
  <div class="page-h"><a href="#/tournaments" class="back">← Турниры</a></div>
  <section class="hero table-card t-hero">
    <div class="t-title"><h1>${esc(t.name)}</h1>${t.status === 'active' ? '<span class="live">● идёт</span>' : '<span class="badge">завершён</span>'}</div>
    <div class="muted small">${t.date ? fmtDate(t.date, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}${t.place ? ' · ' + esc(t.place) : ''}</div>
    <div class="chips"><span class="chip">${FORMATS[t.format]}</span><span class="chip">до ${winsNeeded(t.best_of)} ${plural(winsNeeded(t.best_of), 'победы', 'побед', 'побед')} в партиях</span><span class="chip">партия до ${t.points_to}</span><span class="chip">${t.participants.length} участников</span></div>
    ${res && res.gold ? `<div class="t-podium"><div>🥇 <b>${esc(P(res.gold).nickname)}</b></div>${res.silver ? `<div>🥈 ${esc(P(res.silver).nickname)}</div>` : ''}${(res.bronze || []).map(x => `<div>🥉 ${esc(P(x).nickname)}</div>`).join('')}</div>` : ''}
  </section>
  ${t.status === 'active' ? `<p class="t-how">${T_HOW[t.format] || ''}</p>` : ''}
  ${nextCard}
  ${body}
  ${can ? `<section class="card admin-actions">
    ${t.status === 'active' ? `<button class="btn primary" data-act="finish-t" data-t="${t.id}" ${pl ? '' : 'disabled'}>🏁 Завершить турнир</button>${pl ? '' : '<p class="muted small">Завершить можно, когда определится победитель.</p>'}` : `<button class="btn" data-act="reopen-t" data-t="${t.id}">↩︎ Возобновить</button>`}
    <button class="btn danger ghost" data-act="del-t" data-t="${t.id}">Удалить турнир</button></section>` : ''}
  <div class="sec-h"><h3>Участники</h3></div>
  <div class="chips people">${t.participants.map(id => `<a href="#/player/${id}" class="chip">${ava(P(id), 'xs')} ${esc(P(id).nickname)}</a>`).join('')}</div>`;
}

// ───────────── Турнир с записью заранее (статус 'open') ─────────────
// Владелец объявляет турнир (дата, время, место), участники клуба сами записываются;
// QR турнира ведёт прямо сюда (новичок — регистрация и заявка в клуб). Старт — из записавшихся.
const tReg = t => t.registered || [];
const tMonthOnly = t => t.config?.dateMode === 'month' && !!t.date;
const tWhen = t => {
  if (tMonthOnly(t)) return `${monthName(t.date.slice(0, 7))} · дата уточняется`;
  const at = t.starts_at ? new Date(t.starts_at) : t.date ? new Date(t.date + 'T00:00') : null;
  if (!at) return 'дата уточняется';
  return at.toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', ...(t.starts_at ? { hour: '2-digit', minute: '2-digit' } : {}) });
};
const tourLink = (t, code) => `${linkBase()}#/tournament/${t.id}?club=${S.club.id}${code ? '&code=' + encodeURIComponent(code) : ''}`;
function signupBtn(t, cls = '') {
  const on = tReg(t).includes(S.me.id);
  return `<button class="btn ${on ? '' : 'primary'} ${cls}" data-act="t-signup" data-t="${t.id}" data-on="${on ? 0 : 1}">${on ? '✓ Вы записаны · отменить' : '✍️ Записаться'}</button>`;
}
function viewTournamentOpen(t) {
  const reg = tReg(t), on = reg.includes(S.me.id), can = isAdmin();
  return `<div class="page-h"><a href="#/tournaments" class="back">← Турниры</a></div>
  <section class="hero table-card t-hero">
    <div class="t-title"><h1>${esc(t.name)}</h1><span class="badge ok">запись открыта</span></div>
    <div class="t-when"><span>📅 ${esc(tWhen(t))}</span>${t.place ? `<span>📍 ${esc(t.place)}</span>` : ''}</div>
    <div class="chips"><span class="chip">${FORMATS[t.format].split(' (')[0]}</span><span class="chip">до ${winsNeeded(t.best_of)} ${plural(winsNeeded(t.best_of), 'победы', 'побед', 'побед')} в партиях</span><span class="chip">партия до ${t.points_to}</span></div>
    ${t.config?.prizes ? `<p class="t-prize">🎁 <b>Призы:</b> ${esc(t.config.prizes)}</p>` : ''}
    ${t.config?.note ? `<p class="bio">${esc(t.config.note)}</p>` : ''}
  </section>
  <section class="card t-sign ${on ? 'on' : ''}">
    <div><b>${on ? 'Вы в списке участников 🎉' : 'Хотите сыграть?'}</b><small class="muted">${on ? 'Сетку составят в день турнира по рейтингу.' : 'Запишитесь — сетку составят в день турнира из записавшихся.'}</small></div>
    ${signupBtn(t, 'full')}
  </section>
  <div class="sec-h"><h3>Записались · ${reg.length}</h3></div>
  ${can && (t.pending_reg || []).length ? `<a href="#/admin/reqs" class="alert info">⏳ Записались по QR и ждут вступления в клуб (${t.pending_reg.length}): ${t.pending_reg.map(id => esc(P(id).nickname)).join(', ')}. Примите заявку — и игрок сразу в списке участников →</a>` : ''}
  ${reg.length ? `<div class="chips people">${reg.map(id => `<a href="#/player/${id}" class="chip">${ava(P(id), 'xs')} ${esc(P(id).nickname)}</a>`).join('')}</div>` : '<div class="empty small">Пока никто не записался — будьте первым!</div>'}
  ${can ? `<section class="card"><div class="card-h"><h3>📲 QR-код турнира</h3></div>
    <p class="muted small">${S.store.sandbox ? '🧪 Образец: в песочнице этот QR ведёт только в песочницу. ' : ''}Ведёт прямо на этот турнир: игрок наводит камеру и записывается. Новичок регистрируется и записывается сразу — заявка в клуб уходит сама, а после вашего «Принять» он автоматически в списке участников.</p>
    <div class="t-qr" id="t-qr" data-t="${t.id}"></div>
 <div class="row-btns t-qr-btns"><button class="btn" data-act="t-qr-svg" data-t="${t.id}">⬇️ SVG (для дизайна)</button><button class="btn" data-act="t-qr-png" data-t="${t.id}">⬇️ PNG 3000×3000</button></div>
    <button class="btn primary full" data-act="t-poster" data-t="${t.id}">🖨 Плакат турнира А4</button>
  </section>
  <section class="card admin-actions">
    <button class="btn primary" data-act="t-start" data-t="${t.id}">▶ Начать турнир</button>
    <button class="btn" data-act="t-edit" data-t="${t.id}">✏️ Изменить</button>
    <button class="btn danger ghost" data-act="del-t" data-t="${t.id}">Удалить</button>
    <p class="muted small">При старте записавшиеся уже будут отмечены — можно добавить или убрать игроков.</p>
  </section>` : ''}`;
}
// форма «Объявить турнир заранее» (и правка объявленного)
function openAnnounceForm(t = null) {
  const at = t?.starts_at ? toLocalInput(t.starts_at) : (() => { const d = new Date(Date.now() + 7 * DAY); d.setHours(19, 0, 0, 0); return toLocalInput(d); })();
  const month = t && tMonthOnly(t) ? t.date.slice(0, 7) : at.slice(0, 7);
  const byMonth = !!(t && tMonthOnly(t)), prizes = t?.config?.prizes || '';
  openModal(`<form data-form="t-announce" class="stack" ${t ? `data-t="${t.id}"` : ''}>
    <h3>${t ? 'Изменить турнир' : '📅 Объявить турнир заранее'}</h3>
    <p class="muted small">Игроки увидят дату и место и смогут записаться сами. Сетку составите в день турнира — из записавшихся.</p>
    <label>Название<input name="name" required maxlength="60" value="${esc(t?.name || '')}" placeholder="Например: Кубок IT Park"></label>
    <div class="tf-sec"><small class="tf-lbl">Когда</small>
      <div class="tf-seg2"><label><input type="radio" name="dmode" value="exact" ${byMonth ? '' : 'checked'}><span>📅 Точная дата</span></label><label><input type="radio" name="dmode" value="month" ${byMonth ? 'checked' : ''}><span>🗓 Только месяц</span></label></div>
      <label class="dm-exact" ${byMonth ? 'hidden' : ''}>Дата и время<input type="datetime-local" name="starts_at" value="${at}"></label>
      <label class="dm-month" ${byMonth ? '' : 'hidden'}>Месяц и год<input type="month" name="month" value="${month}"></label>
      <p class="hint dm-month" ${byMonth ? '' : 'hidden'}>Игроки увидят «${esc(monthName(month))} · дата уточняется». Точную дату добавите позже — «Изменить» на странице турнира.</p></div>
    <label>Место<input name="place" maxlength="60" value="${esc(t?.place || '')}" placeholder="Например: 3 этаж, у окна"></label>
    <div class="tf-sec"><small class="tf-lbl">Вид турнира</small><div class="tf-fmt">${[['ko', '🏆', 'Олимпийская', 'на вылет'], ['groups', '🗂', 'Группы', '+ плей-офф'], ['rr', '🔄', 'Круг', 'все со всеми']].map(([k, ic, v, d]) => `<label><input type="radio" name="format" value="${k}" ${(t?.format || 'ko') === k ? 'checked' : ''}><span><i>${ic}</i><b>${v}</b><small>${d}</small></span></label>`).join('')}</div></div>
    <div class="two"><label>До скольких побед<select name="best_of">${[[3, 'до 2 побед'], [5, 'до 3 побед'], [7, 'до 4 побед']].map(([v, l]) => `<option value="${v}" ${(t?.best_of || 5) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Партия до<select name="points_to">${[11, 21].map(v => `<option ${(t?.points_to || 11) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="tf-sec"><small class="tf-lbl">Призы</small>
      <div class="tf-seg2"><label><input type="radio" name="pmode" value="none" ${prizes ? '' : 'checked'}><span>Без призов</span></label><label><input type="radio" name="pmode" value="yes" ${prizes ? 'checked' : ''}><span>🎁 Есть призы</span></label></div>
      <div class="pz-box" ${prizes ? '' : 'hidden'}><textarea name="prizes" maxlength="200" rows="2" placeholder="Например: 1 место — кубок и 1000 PC, 2–3 место — медали">${esc(prizes)}</textarea>
        <div class="pz-chips">${['🏆 Кубок', '🥇 Медали', '🪙 Пинг-коины', '🎁 Подарки', '📜 Грамоты'].map(x => `<button type="button" class="chip" data-pz="${x}">${x}</button>`).join('')}</div></div>
      <p class="hint pz-none" ${prizes ? 'hidden' : ''}>Про призы нигде не будет написано.</p></div>
    <label>Описание (необязательно)<textarea name="note" maxlength="300" rows="2" placeholder="Взнос, что взять с собой">${esc(t?.config?.note || '')}</textarea></label>
    <button class="btn primary full">${t ? 'Сохранить' : '📣 Открыть запись'}</button></form>`, sh => {
    const f = sh.querySelector('form');
    const sync = () => {
      const m = f.dmode.value === 'month', p = f.pmode.value === 'yes';
      sh.querySelectorAll('.dm-exact').forEach(x => { x.hidden = m; }); sh.querySelectorAll('.dm-month').forEach(x => { x.hidden = !m; });
      sh.querySelector('.dm-month.hint').textContent = `Игроки увидят «${monthName(f.month.value || month)} · дата уточняется». Точную дату добавите позже — «Изменить» на странице турнира.`;
      sh.querySelector('.pz-box').hidden = !p; sh.querySelector('.pz-none').hidden = p;
    };
    f.addEventListener('change', sync);
    // быстрые варианты призов дописываются в поле
    sh.querySelectorAll('[data-pz]').forEach(b => b.onclick = () => { const v = f.prizes.value.trim(); f.prizes.value = v ? `${v}, ${b.dataset.pz}` : b.dataset.pz; f.prizes.focus(); });
  });
}
async function tourQr(t) {
  const code = S.printCode?.club === S.club.id ? S.printCode.code : (S.printCode = { club: S.club.id, code: await S.store.inviteCode(S.club.id) }).code;
  return makeQr(tourLink(t, code));
}
const qrName = s => (s || 'ponghub').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ponghub';
const qrFile = t => `qr-${qrName(t.name || 'turnir')}`;
async function downloadTourQr(t, kind) { return saveQr(await tourQr(t), qrFile(t), kind); }
// QR файлом (с логотипом): SVG — вектор (любой размер без потери качества), PNG — 3000×3000
async function saveQr(q, file, kind) {
  if (kind === 'svg') return download(file + '.svg', `<?xml version="1.0" encoding="UTF-8"?>\n${qrSvg(q, { margin: 4, size: 1000 })}`, 'image/svg+xml');
  download(file + '.png', await qrPng(q), 'image/png');
}
async function renderTourQr() {
  const el = document.getElementById('t-qr'); if (!el) return;
  const t = tById(el.dataset.t); if (!t) return;
  try { el.innerHTML = qrSvg(await tourQr(t)); } catch { el.innerHTML = '<div class="muted small">QR-код не загрузился</div>'; }
}
// плакат турнира А4 — в стиле рекламного плаката клуба
function tourSheet(t) {
  return `<div class="prn-a4"><div class="prn-in prn-poster prn-tour">
    <div class="prn-logo"><img src="${logo()}" alt="">PONGHUB</div>
    <div class="prn-club">${esc(S.club.name)}</div>
    <h3><span class="prn-fit"><em>Турнир</em></span><span class="prn-fit">${esc(t.name)}</span></h3>
    <div class="prn-when"><span class="prn-fit">📅 ${esc(tWhen(t))}</span>${t.place ? `<span class="prn-fit">📍 ${esc(t.place)}</span>` : ''}${t.config?.prizes ? `<span class="prn-fit prn-prize">🎁 ${esc(t.config.prizes)}</span>` : ''}</div>
    <div class="prn-qrbox"><div class="prn-qr" data-prn="tour" data-t="${t.id}"></div></div>
    <div class="prn-scan">📷 Наведи камеру — и запишись</div>
    <div class="prn-steps"><div><i>1</i>Наведи камеру на QR-код</div><div><i>2</i>Нажми «Записаться»</div><div><i>3</i>Приходи играть!</div></div>
  </div></div>`;
}
async function printTour(t) {
  let el = document.getElementById('print-area');
  if (!el) { el = document.createElement('div'); el.id = 'print-area'; document.body.appendChild(el); }
  el.innerHTML = tourSheet(t);
  const box = el.querySelector('[data-prn=tour]');
  box.innerHTML = qrSvg(await tourQr(t));
  await document.fonts?.ready;
  el.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:794px';   // ширина листа А4 при печати (210 мм)
  fitPrint(el);
  el.style.cssText = '';
  await new Promise(res => setTimeout(res, 300));
  window.print();
}

// ───────────── Турнир по QR для того, кто ещё не в клубе ─────────────
// Одно сканирование: видит турнир → «Записаться» (заявка в клуб уходит сама) → после одобрения он сразу в списке участников.
function viewTournamentPublic(r) {
  return `<div id="tp-box" data-t="${esc(r.args[0])}" data-code="${esc(r.q.get('code') || '')}"><div class="empty"><span class="spin"></span></div></div>`;
}
const tpPerks = t => [
  ['🏆', 'Личный рейтинг и лиги', 'от бронзы до алмаза — каждый матч на счету'],
  ['🗓', 'Все турниры клуба', 'текущие и будущие — запись в одно касание'],
  ['👑', 'Стань лидером коворкинга', 'сезоны каждый месяц и звание чемпиона'],
  ['⚔️', 'Вызовы на матч', 'зови коллег сыграть — им придёт уведомление'],
  ...(t.club.pred ? [['🎯', 'Прогнозы на матчи', 'ставь пинг-коины на победы и поражения игроков']] : []),
  // задания и бонус дня — пока только у тестировщиков; в рассказе появятся, когда Магазин откроют всем
  ...((S.ctx?.platform?.features?.shop ?? 'all') === 'all' ? [['🎁', 'Задания и бонус дня', 'выполняй — получай пинг-коины']] : []),
];
async function renderTournamentPublic() {
  const box = document.getElementById('tp-box'); if (!box) return;
  let t;
  try { t = await S.store.rpc('tournament_public', { tid: box.dataset.t, p_code: box.dataset.code || null }); }
  catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!box.isConnected) return;
  S.tp = t;
  const signed = t.me_registered || t.me_pending, open = t.status === 'open';
  const push = await pushState();
  const step = (n, done, title, body) => `<div class="tp-step ${done ? 'done' : ''}"><i>${done ? '✓' : n}</i><div><b>${title}</b>${body}</div></div>`;
  const install = isStandalone() ? '' : S.installEvt ? '<button class="btn sm primary" data-act="install">Установить</button>'
    : isIOS() ? '<small>В Safari: «Поделиться» ⬆︎ → «На экран „Домой“». Затем откройте PongHub с иконки и войдите.</small>' : '<small>Меню браузера ⋮ → «Установить приложение».</small>';
  const pushBody = push === 'on' ? '<small>Включены — расскажем о турнире и новостях клуба.</small>'
    : push === 'ios-install' ? '<small>На iPhone — после установки: откройте PongHub с иконки и включите в Профиле.</small>'
    : push === 'denied' ? '<small>Запрещены в настройках телефона — разрешите их для PongHub.</small>'
    : push === 'off' ? '<button class="btn sm primary" data-act="tp-push">🔔 Включить</button>' : '<small>Недоступны в этом браузере.</small>';
  box.innerHTML = `<section class="hero table-card t-hero">
      <div class="muted small">${esc(t.club.name)}</div>
      <div class="t-title"><h1>${esc(t.name)}</h1><span class="badge ok">${open ? 'запись открыта' : t.status === 'active' ? 'идёт' : 'завершён'}</span></div>
      <div class="t-when"><span>📅 ${esc(tWhen(t))}</span>${t.place ? `<span>📍 ${esc(t.place)}</span>` : ''}</div>
      <div class="chips"><span class="chip">${FORMATS[t.format].split(' (')[0]}</span><span class="chip">до ${winsNeeded(t.best_of)} ${plural(winsNeeded(t.best_of), 'победы', 'побед', 'побед')}</span><span class="chip">записались: ${t.registered_count}</span></div>
      ${t.config?.prizes ? `<p class="t-prize">🎁 <b>Призы:</b> ${esc(t.config.prizes)}</p>` : ''}
      ${t.config?.note ? `<p class="bio">${esc(t.config.note)}</p>` : ''}
    </section>
    ${!open ? '<div class="card empty">Запись на этот турнир закрыта. Вступайте в клуб — не пропустите следующий!</div>'
    : signed ? `<section class="card t-sign on"><div><b>${t.me_registered ? 'Вы в списке участников 🎉' : 'Вы записаны! 🎉'}</b>
        <small class="muted">${t.me_registered ? 'Сетку составят в день турнира по рейтингу.' : 'Заявка в клуб отправлена — как только владелец её примет, вы автоматически окажетесь в списке участников. Сканировать QR ещё раз не нужно.'}</small></div>
        <button class="btn ghost sm" data-act="tp-join" data-on="0">Отменить запись</button></section>`
    : `<section class="card t-sign"><div><b>Хотите сыграть?</b><small class="muted">Одно нажатие — и вы записаны.${t.my_status === 'active' ? '' : ' Заявка в клуб уйдёт вместе с записью.'}</small></div>
        <button class="btn primary big full" data-act="tp-join" data-on="1">✍️ Записаться на турнир</button></section>`}
    ${signed ? `<section class="card tp-steps"><div class="card-h"><h3>Чтобы ничего не пропустить</h3></div>
      ${step(1, isStandalone(), 'Добавьте PongHub на экран «Домой»', install)}
      ${step(2, push === 'on', 'Включите уведомления', pushBody)}</section>` : ''}
    ${t.my_status === 'active' ? '' : `<section class="card tp-club"><div class="card-h"><h3>Добро пожаловать в «${esc(t.club.name)}»</h3></div>
      <p class="muted small">${t.my_status === 'pending' ? 'Заявка в клуб отправлена. После одобрения вам откроется:' : 'Вступив в клуб, вы получите:'}</p>
      ${tpPerks(t).map(([ic, b, s]) => `<div class="tp-perk"><span>${ic}</span><div><b>${b}</b><small>${s}</small></div></div>`).join('')}</section>`}`;
}

// ───────────── Календарь ─────────────
function upcomingItems() {
  const now = Date.now() - 3 * 36e5;
  const ev = S.data.events.filter(e => Date.parse(e.starts_at) >= now).map(e => ({ kind: 'event', t: Date.parse(e.starts_at), e }));
  const tours = S.data.tournaments.filter(t => t.status === 'open').map(t => ({ kind: 'tour', t: Date.parse(t.starts_at || t.date) || Date.now(), tour: t }));
  return [...ev, ...tours].sort((a, b) => a.t - b.t);
}
function eventRow(it) {
  if (it.kind === 'tour') {
    const t = it.tour, d = new Date(it.t);
    return `<div class="ev"><div class="ev-date"><b>${tMonthOnly(t) ? '?' : d.getDate()}</b><small>${d.toLocaleDateString('ru-RU', { month: 'short' })}</small></div>
      <a href="#/tournament/${t.id}" class="ev-body"><b>🏆 ${esc(t.name)}</b><small class="muted">${esc(tWhen(t))}${t.place ? ' · ' + esc(t.place) : ''}</small>
        <div class="ev-people">${tReg(t).slice(0, 8).map(id => ava(P(id), 'xs')).join('')}<small class="muted">записались: ${tReg(t).length}</small></div></a>
      <div class="ev-act">${signupBtn(t, 'sm')}</div></div>`;
  }
  const e = it.e;
  const going = (e.attendees || []).includes(S.me.id);
  const d = new Date(e.starts_at);
  return `<div class="ev">
    <div class="ev-date"><b>${d.getDate()}</b><small>${d.toLocaleDateString('ru-RU', { month: 'short' })}</small></div>
    <div class="ev-body"><b>${esc(e.title)}</b><small class="muted">${d.toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}${e.place ? ' · ' + esc(e.place) : ''}</small>
      ${e.note ? `<small>${esc(e.note)}</small>` : ''}
      <div class="ev-people">${(e.attendees || []).map(id => ava(P(id), 'xs')).join('')}<small class="muted">${(e.attendees || []).length ? `${e.attendees.length} ${plural(e.attendees.length, 'идёт', 'идут', 'идут')}` : 'пока никто не отметился'}</small></div></div>
    <div class="ev-act"><button class="btn sm ${going ? 'primary' : ''}" data-act="rsvp" data-id="${e.id}">${going ? '✓ Иду' : 'Пойду'}</button>
      ${isAdmin() ? `<button class="btn xs ghost" data-act="del-event" data-id="${e.id}">Удалить</button>` : ''}</div>
  </div>`;
}
function viewCalendar() {
  const up = upcomingItems();
  const past = S.data.events.filter(e => Date.parse(e.starts_at) < Date.now() - 3 * 36e5).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)).slice(0, 10);
  return `<div class="page-h"><h1>Календарь</h1>${isAdmin() ? '<button class="btn primary sm" data-act="new-event">+ Событие</button>' : ''}</div>
    <section class="card">${up.map(eventRow).join('') || '<div class="empty">Ближайших событий нет</div>'}</section>
    ${past.length ? `<details class="card"><summary>Прошедшие</summary>${past.map(e => eventRow({ e })).join('')}</details>` : ''}`;
}

// ───────────── Правила рейтинга ─────────────
function viewRules() {
  if (!isAdmin()) return '<div class="empty">Раздел доступен только владельцу клуба</div>';
  const s = settings();
  const diffs = [-30, -15, 0, 15, 30];
  const row = (k, label) => `<tr><td class="l">${label}</td>${diffs.map(d => { const e = expected(0, d, s.spread); return `<td><span class="up">+${(k * (1 - e)).toFixed(2)}</span><br><span class="down">−${(k * e).toFixed(2)}</span></td>`; }).join('')}</tr>`;
  if (s.system !== 'elo') {
    const ds = [-30, -15, 0, 15, 30];
    const r0 = 50;
    return `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div>
    <section class="card prose">
      <h1>Как считается рейтинг</h1>
      <p>Как в любительских лигах по настольному теннису (ТТВ, «Тайфун»): <b>победа даёт больше, чем отнимает поражение</b>, поэтому активная игра окупается.</p>
      <ul>
        <li>Каждый начинает с <b>${s.initialRating}</b>.</li>
        <li><b>Победа над равным</b> — <b class="up">+${s.leagueWin}</b>. За каждое очко, на которое соперник сильнее, — ещё +${s.leagueWinSlope}; слабее — на столько же меньше (не больше +${s.leagueWinMax} и не меньше 0).</li>
        <li><b>Поражение от равного</b> — <b class="down">−${s.leagueLoss}</b>. Проиграть сильному дешевле (на ${s.leagueLossSlope} за очко разницы), слабому — дороже (не больше −${s.leagueLossMax}). Проигрыш намного более сильному — 0.</li>
        <li>${+s.leagueFreeMult === 1 ? 'Свободные и турнирные игры считаются <b>одинаково</b>.' : `Свободная игра весит <b>×${s.leagueFreeMult}</b> от турнирной.`} Счёт (3:0 или 3:2) не важен — важна победа.</li>
        <li><b>Свободная игра</b> считается от вашего текущего рейтинга: выиграли — рейтинг сразу вырос, и следующий матч считается уже от нового.</li>
        <li><b>Турнир</b> — как в лигах: все его матчи считаются от рейтинга на момент начала турнира, а итог становится вашим новым рейтингом.</li>
        ${s.decayEnabled ? `<li><b>Пауза в игре:</b> после ${s.decayGraceDays} дней без матчей рейтинг снижается на ${s.decayPerWeek} в неделю, но не ниже стартового.</li>` : ''}
        <li><b>Парные игры 2×2</b> — по той же формуле, в отдельном парном рейтинге, по среднему рейтингу команд.</li>
        <li>Рейтинг пересчитывается по всей истории, поэтому исправление матча обновляет всё автоматически.</li>
      </ul>
      <h3>Сколько очков за матч</h3>
      <p class="muted small">Для игрока с рейтингом ${r0}. Колонки — насколько соперник сильнее (+) или слабее (−). Сверху — победа, снизу — поражение.</p>
      <div class="tbl-wrap"><table class="tbl rules"><thead><tr><th class="l">Соперник</th>${ds.map(d => `<th>${d > 0 ? '+' : ''}${d}</th>`).join('')}</tr></thead><tbody>
        <tr><td class="l">Матч</td>${ds.map(d => `<td><span class="up">+${leagueDelta(s, r0, r0 + d, false).win.toFixed(2)}</span><br><span class="down">−${leagueDelta(s, r0 + d, r0, false).loss.toFixed(2)}</span></td>`).join('')}</tr></tbody></table></div>
      <h3>Лиги</h3>
      <div class="chips">${LEAGUES.map((l, i) => `<span class="league ${l.cls}">${l.name} ${l.min === -Infinity ? `< ${LEAGUES[1].min}` : `${l.min}${LEAGUES[i + 1] ? '–' + LEAGUES[i + 1].min : '+'}`}</span>`).join('')}</div>
    </section>`;
  }
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
      ${s.decayEnabled ? `<li><b>Пауза в игре:</b> после ${s.decayGraceDays} дней без матчей рейтинг снижается на ${s.decayPerWeek} в неделю, но не ниже стартового. Первый же матч останавливает снижение.</li>` : ''}
      <li><b>Парные игры 2×2</b> считаются в отдельном парном рейтинге (вес до ${s.kDoubles}), по среднему рейтингу команд.</li>
    </ul>
    <h3>Сколько очков за турнирный матч</h3>
    <p class="muted small">Колонки — насколько рейтинг соперника выше (+) или ниже (−) вашего. Сверху — за победу, снизу — за поражение (для опытного игрока, счёт 3:1).</p>
    <div class="tbl-wrap"><table class="tbl rules"><thead><tr><th class="l">Соперник</th>${diffs.map(d => `<th>${d > 0 ? '+' : ''}${d}</th>`).join('')}</tr></thead><tbody>
      ${row(s.kTournament, 'Турнир')}${row(s.kFree, 'Свободная')}</tbody></table></div>
    <h3>Лиги</h3>
    <div class="chips">${LEAGUES.map((l, i) => `<span class="league ${l.cls}">${l.name} ${l.min === -Infinity ? `< ${LEAGUES[1].min}` : `${l.min}${LEAGUES[i + 1] ? '–' + LEAGUES[i + 1].min : '+'}`}</span>`).join('')}</div>
  </section>`;
}

// ───────────── Прогнозы ─────────────
const predOn = () => settings().predEnabled !== false;
const fmtC = n => Math.round(n || 0).toLocaleString('ru-RU');
function chanceFor(r) {
  const R = id => (id ? ratingOf(id) : null);
  const avg = (...ids) => { const v = ids.map(R).filter(x => x != null); return v.reduce((a, b) => a + b, 0) / v.length; };
  return expected(avg(r.player1_id, r.player3_id), avg(r.player2_id, r.player4_id), S.A.S.spread || 50);
}
const evName = (e, side) => (side === 1 ? [e.player1_id, e.player3_id] : [e.player2_id, e.player4_id]).filter(Boolean).map(id => P(id).nickname).join(' + ');
const evPlayers = e => [e.player1_id, e.player2_id, e.player3_id, e.player4_id].filter(Boolean);
const myPred = e => S.data.predictions.find(p => p.event_id === e.id && p.user_id === S.me.id);
// все мои прогнозы на матч (их может быть несколько — на любого из игроков)
const myPreds = e => S.data.predictions.filter(p => p.event_id === e.id && p.user_id === S.me.id);
const myPredsLine = (e, name) => { const m = myPreds(e); if (!m.length) return ''; return `Ваши прогнозы: ${m.map(p => `<b>${esc(name(p.side))}</b> ${p.stake} × ${p.odds}`).join(' · ')}`; };

function predRow(e) {
  const my = myPred(e), mine = evPlayers(e).includes(S.me.id);
  const mineBets = myPreds(e);
  const right = mine ? '<span class="muted small">ваш матч</span>'
    : evOpen(e) ? `${mineBets.length ? `<span class="pr-my">ваших: ${mineBets.length}</span>` : ''}<button class="btn sm primary" data-act="predict" data-id="${e.id}">${mineBets.length ? '+ ещё' : 'Прогноз'}</button>`
      : my ? `<span class="pr-my">ваш: ${esc(evName(e, my.side))} · ${my.stake}</span>` : '<span class="muted small">приём закрыт</span>';
  return `<div class="pr-row"><div class="rn"><b>${esc(evName(e, 1))} <span class="muted">×${e.odds1}</span></b><b>${esc(evName(e, 2))} <span class="muted">×${e.odds2}</span></b>
    <small class="muted">${e.source === 'live' ? (e.closes_at ? `● игра идёт · приём ещё ${evLeft(e)} мин` : '● идёт к столу') : '⚔️ вызов принят'} · прогнозов: ${e.bets_count}</small></div>${right}</div>`;
}

function predHomeBlock() {
  if (!predOn()) return '';
  const open = S.data.predEvents.filter(evOpen);
  const recent = S.data.predictions.filter(p => p.user_id === S.me.id && ['won', 'lost', 'refunded'].includes(p.status) && Date.now() - Date.parse(p.settled_at || p.created_at) < 3 * DAY).slice(0, 2);
  if (!open.length && !recent.length) return '';
  const res = p => { const e = S.data.predEvents.find(x => x.id === p.event_id); return `<div class="pr-res ${p.status}"><b>${p.status === 'won' ? `Прогноз сыграл <span class="up">+${p.payout} PC</span>` : p.status === 'lost' ? `Не сыграл <span class="down">−${p.stake} PC</span>` : `Возврат ${p.stake} PC`}</b><small class="muted">${e ? `${esc(evName(e, 1))} — ${esc(evName(e, 2))}` : ''}</small></div>`; };
  return `<section class="card pred-home"><div class="card-h"><h3>🎯 Прогнозы</h3><a href="#/predict" class="link">Все →</a></div>
    ${recent.map(res).join('')}${open.slice(0, 3).map(predRow).join('')}</section>`;
}

function openPredict(eid) {
  const e = S.data.predEvents.find(x => x.id === eid);
  if (!e) return;
  const s = settings(), min = s.predMin ?? 10, max = s.predMax ?? 500;
  const bal = S.coins ?? 0;
  const st = { side: e.chance1 >= 0.5 ? 1 : 2, stake: Math.min(100, bal, max) };
  const draw = sh => {
    const fresh = S.data.predEvents.find(x => x.id === eid); if (fresh) Object.assign(e, fresh);
    const odds = st.side === 1 ? e.odds1 : e.odds2;
    sh.querySelector('.pd-body').innerHTML = `<h3>🎯 Прогноз на матч</h3>
      <div class="pd-vs"><div><b>${esc(evName(e, 1))}</b><small>${pct(e.chance1)}</small></div><span>vs</span><div><b>${esc(evName(e, 2))}</b><small>${pct(1 - e.chance1)}</small></div></div>
      <div class="pd-bar"><i style="width:${e.chance1 * 100}%"></i></div>
      <small class="muted">${e.source === 'live' ? '● Коэффициенты меняются по ходу игры — ставка фиксируется по текущему.' : 'Шансы по рейтингу. Чем меньше шанс — тем выше коэффициент.'}</small>
      <div class="pd-sides">${[1, 2].map(sd => `<button type="button" class="pd-side s${sd} ${st.side === sd ? 'on' : ''}" data-side="${sd}"><span>${esc(evName(e, sd))}</span><b>×${sd === 1 ? e.odds1 : e.odds2}</b></button>`).join('')}</div>
      <div class="pd-stakes">${[min, 50, 100, 250, max].filter((v, i, a) => v >= min && v <= max && a.indexOf(v) === i).map(v => `<button type="button" class="chip ${st.stake === v ? 'on' : ''}" data-stake="${v}">${v}</button>`).join('')}
        <input type="number" min="${min}" max="${max}" value="${st.stake}" class="pd-input" aria-label="Своя сумма"></div>
      <div class="pd-sum">Ставка <b>${st.stake} PC</b> · выигрыш <b class="up">${Math.round(st.stake * odds)} PC</b><small class="muted">На счёте: ${fmtC(bal)} PC</small></div>
      <div class="mf-err"></div>
      <button class="btn primary big" data-go="1">Поставить на ${esc(evName(e, st.side))}</button>
      <small class="muted center">Сделанный прогноз нельзя изменить или отменить — можно поставить ещё, на любого игрока. Баллы не влияют на рейтинг.</small>`;
  };
  openModal('<div class="pd-body stack"></div>', sh => {
    draw(sh);
    // пришли новые данные (очко в игре) — обновляем коэффициенты прямо в окне
    S.modalRefresh = () => { if (sh.isConnected) { const ae = document.activeElement; if (!(ae && ae.classList.contains('pd-input'))) draw(sh); } else S.modalRefresh = null; };
    sh.addEventListener('click', async ev => {
      const sd = ev.target.closest('[data-side]'); if (sd) { st.side = +sd.dataset.side; return draw(sh); }
      const sk = ev.target.closest('[data-stake]'); if (sk) { st.stake = +sk.dataset.stake; return draw(sh); }
      if (ev.target.closest('[data-go]')) {
        const btn = ev.target.closest('button');
        btn.disabled = true;
        try {
          S.coins = await S.store.rpc('place_prediction', { eid: e.id, pick: st.side, amount: st.stake });
          closeModal(); await refresh(); toast(`Прогноз принят: ${st.stake} PC на ${evName(e, st.side)} 🎯`);
        } catch (er) { sh.querySelector('.mf-err').textContent = er.message; btn.disabled = false; }
      }
    });
    sh.addEventListener('change', ev => { if (ev.target.classList.contains('pd-input')) { st.stake = Math.max(min, Math.min(max, Math.round(+ev.target.value || min))); draw(sh); } });
  });
}

function predAchievements() {
  const mine = S.data.predictions.filter(p => p.user_id === S.me.id).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const settled = mine.filter(p => ['won', 'lost'].includes(p.status));
  let run = 0, best = 0; for (const p of settled) { run = p.status === 'won' ? run + 1 : 0; best = Math.max(best, run); }
  return [
    { name: 'Первый прогноз', desc: 'Сделать прогноз', ok: mine.length >= 1 },
    { name: 'Провидец', desc: '5 верных подряд', ok: best >= 5, prog: [best, 5] },
    { name: 'Против толпы', desc: 'Угадать на ×3 и выше', ok: settled.some(p => p.status === 'won' && +p.odds >= 3) },
    { name: 'Болельщик', desc: '50 прогнозов', ok: mine.length >= 50, prog: [mine.length, 50] },
    { name: 'Магнат', desc: '5 000 PC на счёте', ok: (S.coins || 0) >= 5000, prog: [S.coins || 0, 5000] },
  ];
}

function viewPredict() {
  if (!predOn()) return '<div class="empty">Прогнозы выключены владельцем клуба</div>';
  const open = S.data.predEvents.filter(evOpen);
  const mine = S.data.predictions.filter(p => p.user_id === S.me.id);
  const active = mine.filter(p => p.status === 'open');
  const history = mine.filter(p => p.status !== 'open').slice(0, 30);
  const settled = mine.filter(p => ['won', 'lost'].includes(p.status));
  const acc = settled.length ? settled.filter(p => p.status === 'won').length / settled.length : 0;
  const evOf = p => S.data.predEvents.find(e => e.id === p.event_id);
  const line = p => { const e = evOf(p); return `<div class="pr-hist ${p.status}"><div class="rn"><b>${e ? `${esc(evName(e, 1))} — ${esc(evName(e, 2))}` : 'Матч'}</b><small class="muted">на ${e ? esc(evName(e, p.side)) : '—'} · ${p.stake} PC × ${p.odds} · ${fmtDT(p.created_at)}</small></div>
    <b class="${p.status === 'won' ? 'up' : p.status === 'lost' ? 'down' : 'muted'}">${p.status === 'won' ? '+' + p.payout : p.status === 'lost' ? '−' + p.stake : p.status === 'refunded' ? 'возврат' : 'ждём'}</b></div>`; };
  return `<div class="page-h"><h1>🎯 Прогнозы</h1></div>
    <section class="hero table-card coin-hero"><div class="coin-top"><div><small>Ваш счёт</small><div class="big-num">${fmtC(S.coins)} <span class="pc">PC</span></div></div>
      <div class="coin-stats"><div><b>${settled.length}</b><small>прогнозов</small></div><div><b>${pct(acc)}</b><small>верных</small></div></div></div>
      <p class="muted small">Пинг-коины — игровые баллы. Их нельзя купить, и они никак не влияют на рейтинг. ${feature('shop') ? 'Пополнить: <a class="link" href="#/shop?tab=bonus">бонус дня</a>, +15 за матч, призы турниров. Потратить — в <a class="link" href="#/shop">магазине</a>.' : `Каждый понедельник +${settings().predWeekly ?? 100} PC всем.`}</p></section>
    <section class="card"><div class="card-h"><h3>Открытые прогнозы</h3></div>${open.map(predRow).join('') || '<div class="empty small">Сейчас открытых нет. Прогноз открывается, когда начинается живой счёт или принят вызов.</div>'}</section>
    ${active.length ? `<section class="card"><div class="card-h"><h3>Ждут результата</h3></div>${active.map(line).join('')}</section>` : ''}
    <section class="card"><div class="card-h"><h3>🏆 Лучшие прогнозисты</h3><div class="seg sm"><button class="on" data-act="pred-board" data-p="month">месяц</button><button data-act="pred-board" data-p="all">всё время</button></div></div>
      <div id="pred-board" data-period="month"><div class="muted small">Загружаю…</div></div></section>
    <section class="card"><div class="card-h"><h3>Достижения прогнозиста</h3></div><div class="ach-grid">${predAchievements().map(a => `<div class="ach ${a.ok ? 'ok' : ''}"><span class="ach-i">🎯</span><b>${a.name}</b><small>${a.desc}</small>${!a.ok && a.prog ? `<div class="bar thin"><i style="width:${Math.min(100, a.prog[0] / a.prog[1] * 100)}%"></i></div>` : ''}</div>`).join('')}</div></section>
    ${history.length ? `<section class="card"><div class="card-h"><h3>История</h3></div>${history.map(line).join('')}</section>` : ''}`;
}

async function renderPredBoard() {
  const box = document.getElementById('pred-board');
  if (!box) return;
  const d = new Date();
  const since = box.dataset.period === 'month' ? new Date(d.getFullYear(), d.getMonth(), 1).toISOString() : null;
  let rows = [];
  try { rows = await S.store.rpc('coin_leaderboard', { since }); } catch { box.innerHTML = '<div class="empty small">Таблица появится после обновления базы</div>'; return; }
  rows = rows.filter(r => S.byId.has(r.user_id)).sort((a, b) => (since ? b.profit - a.profit : b.balance - a.balance));
  if (document.getElementById('pred-board') !== box) return;
  box.innerHTML = rows.map((r, i) => `<div class="rank-row pr-who ${r.user_id === S.me.id ? 'me' : ''}" data-act="pred-user" data-id="${r.user_id}"><span class="pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${ava(P(r.user_id), 'sm')}
    <span class="rn"><b>${esc(P(r.user_id).nickname)}</b><small>${r.bets ? `${Math.round(r.wins / r.bets * 100)}% верных · ${r.bets} прогн.` : 'ещё без прогнозов'}</small></span>
    <span class="rr"><b>${fmtC(since ? r.profit : r.balance)}</b><small class="muted">${since ? 'за месяц' : 'PC'}</small></span></div>`).join('') || '<div class="empty small">Пока никто не делал прогнозов</div>';
  if (rows.length) box.insertAdjacentHTML('beforeend', '<p class="muted small center">Нажмите на игрока — увидите его прогнозы</p>');
}

// прогнозы другого игрока: на какие матчи, на кого, сколько и чем закончилось
async function openPredUser(uid) {
  const p = P(uid);
  openModal(`<div class="stack"><a href="#/player/${uid}" class="pu-h">${ava(p, 'md')}<div class="rn"><h3>${esc(p.nickname)}</h3><small class="muted">прогнозы в клубе · профиль →</small></div></a><div id="pu-box"><div class="empty small"><span class="spin"></span></div></div></div>`);
  let list;
  try { list = await S.store.rpc('player_predictions', { uid }); } catch { list = null; }
  const box = document.getElementById('pu-box');
  if (!box) return;
  if (!list) { box.innerHTML = '<div class="empty small">Чужие прогнозы появятся после обновления базы (миграция 29)</div>'; return; }
  const settled = list.filter(x => ['won', 'lost'].includes(x.status)), won = settled.filter(x => x.status === 'won');
  const profit = settled.reduce((a, x) => a + (x.status === 'won' ? x.payout - x.stake : -x.stake), 0);
  const line = x => { const e = x.event; return `<div class="pr-hist ${x.status}"><div class="rn"><b>${esc(evName(e, 1))} — ${esc(evName(e, 2))}</b><small class="muted">на <b>${esc(evName(e, x.side))}</b> · ${x.stake} PC × ${x.odds} · ${fmtDT(x.created_at)}</small></div>
    <b class="${x.status === 'won' ? 'up' : x.status === 'lost' ? 'down' : 'muted'}">${x.status === 'won' ? '+' + x.payout : x.status === 'lost' ? '−' + x.stake : x.status === 'refunded' ? 'возврат' : 'ждём'}</b></div>`; };
  box.innerHTML = `<div class="stat-grid in pu-stats"><div><b>${settled.length}</b><small>прогнозов</small></div><div><b>${pct(settled.length ? won.length / settled.length : 0)}</b><small>верных</small></div><div><b class="${profit >= 0 ? 'up' : 'down'}">${profit >= 0 ? '+' : '−'}${fmtC(Math.abs(profit))}</b><small>итог, PC</small></div></div>
    <div class="pu-list">${list.map(line).join('') || '<div class="empty small">Пока без прогнозов</div>'}</div>`;
}

// ───────────── Объявления ─────────────
const seenAt = () => +(lsGet('ponghub_seen_ann') || 0);
const annForMe = a => !a.recipients?.length || a.recipients.includes(S.me?.id) || isAdmin();
const unreadCount = () => (S.data?.announcements || []).filter(a => annForMe(a) && Date.parse(a.created_at) > seenAt() && a.created_by !== S.me?.id).length;

function viewInbox() {
  const pc = pendingCounts();
  const last = seenAt();
  const list = S.data.announcements.filter(annForMe);
  setTimeout(() => { lsSet('ponghub_seen_ann', String(Date.now())); if (!pc.total) document.querySelector('.top .dot')?.remove(); }, 0);
  return `<div class="page-h"><h1>Уведомления</h1>${isAdmin() ? '<button class="btn primary sm" data-act="new-ann">📢 Написать</button>' : ''}</div>
    ${pc.total ? `<a href="#/admin" class="alert">🔔 Ждут вашего решения: ${pc.users ? `${pc.users} ${plural(pc.users, 'заявка', 'заявки', 'заявок')}` : ''}${pc.users && pc.matches ? ', ' : ''}${pc.matches ? `${pc.matches} ${plural(pc.matches, 'матч', 'матча', 'матчей')} на подтверждение` : ''} →</a>` : ''}
    ${isAdmin() ? '<p class="muted small">Объявление можно отправить всем или выбранным игрокам — его увидят и получат push-уведомлением только они. Писать и удалять можете только вы.</p>' : ''}
    ${list.map(a => `<article class="card ann ${Date.parse(a.created_at) > last && a.created_by !== S.me.id ? 'new' : ''}">
      <div class="ann-h">${ava(P(a.created_by), 'sm')}<div class="rn"><b>${esc(a.title || (a.recipients?.length ? 'Личное сообщение' : 'Объявление клуба'))}</b><small class="muted">${esc(P(a.created_by).nickname)} · ${fmtDT(a.created_at)}</small>
        ${a.recipients?.length ? `<small class="ann-to">${isAdmin() ? '✉️ Для: ' + a.recipients.map(id => esc(P(id).nickname)).join(', ') : '✉️ Лично вам'}</small>` : ''}</div>
        ${isAdmin() ? `<button class="btn xs ghost danger" data-act="del-ann" data-id="${a.id}">Удалить</button>` : ''}</div>
      <p class="ann-body">${esc(a.body).replace(/\n/g, '<br>')}</p>
    </article>`).join('') || '<div class="empty">Объявлений пока нет</div>'}`;
}

function openAnnForm() {
  const people = S.data.profiles.filter(p => p.status === 'approved' && p.id !== S.me.id).sort((a, b) => a.nickname.localeCompare(b.nickname));
  openModal(`<form data-form="ann" class="stack"><h3>📢 Новое объявление</h3>
    <div class="seg"><button type="button" class="on" data-to="all">👥 Всем</button><button type="button" data-to="some">✉️ Выбрать игроков</button></div>
    <div class="pick-list ann-pick" hidden>${people.map(p => `<label class="pick"><input type="checkbox" name="to" value="${p.id}"><span>${ava(p, 'xs')} ${esc(p.nickname)}</span></label>`).join('') || '<p class="muted small">Других участников пока нет</p>'}</div>
    <label>Заголовок<input name="title" maxlength="60" placeholder="Например: Турнир в пятницу"></label>
    <label>Текст<textarea name="body" rows="5" maxlength="1000" required placeholder="Что хотите сообщить"></textarea></label>
    <p class="muted small" id="ann-hint">Получат все участники клуба: push-уведомлением и в ленте под колокольчиком.</p>
    <button class="btn primary" id="ann-send">Отправить всем</button></form>`, sh => {
    const f = sh.querySelector('form');
    const sync = () => {
      const some = f.dataset.to === 'some', n = f.querySelectorAll('[name=to]:checked').length;
      sh.querySelector('.ann-pick').hidden = !some;
      sh.querySelectorAll('[data-to]').forEach(b => b.classList.toggle('on', b.dataset.to === (some ? 'some' : 'all')));
      sh.querySelector('#ann-hint').textContent = some ? 'Увидят и получат уведомление только выбранные игроки.' : 'Получат все участники клуба: push-уведомлением и в ленте под колокольчиком.';
      sh.querySelector('#ann-send').textContent = some ? (n ? `Отправить выбранным (${n})` : 'Выберите получателей') : 'Отправить всем';
    };
    f.dataset.to = 'all';
    sh.addEventListener('click', e => { const b = e.target.closest('[data-to]'); if (b) { f.dataset.to = b.dataset.to; sync(); } });
    f.addEventListener('change', sync);
  });
}

// ───────────── Живой счёт ─────────────
S.liveLocal = {};
let liveQueue = Promise.resolve();
const liveLog = l => (l.scorer_id === S.me?.id && S.liveLocal[l.id]) || l.log || [];
const sideIds = (l, side) => (l.kind === 'doubles' ? [side ? l.player2_id : l.player1_id, side ? l.player4_id : l.player3_id] : [side ? l.player2_id : l.player1_id]);
const sideName = (l, side) => sideIds(l, side).map(id => P(id).nickname).join(' + ');

function liveBlock() {
  if (!S.data.live.length) return '';
  return `<section class="card live-now"><div class="card-h"><h3><span class="live">●</span> Сейчас играют</h3></div>
    ${S.data.live.map(l => { if (l.scoring === false) return `<a href="#/live/${l.id}" class="live-row">
      <span class="lr-name">${esc(sideName(l, 0))}</span><span class="lr-score"><small>идёт</small><b>⏱ ${minsAgo(l.created_at)}′</b></span><span class="lr-name right">${esc(sideName(l, 1))}</span></a>`;
      const g = replayLive(liveLog(l), l.best_of, l.points_to, l.first_server); return `<a href="#/live/${l.id}" class="live-row">
      <span class="lr-name ${g.cur[0] > g.cur[1] ? 'lead' : ''}">${esc(sideName(l, 0))}</span>
      <span class="lr-score"><small>${g.won[0]}:${g.won[1]}</small><b>${g.cur[0]}:${g.cur[1]}</b></span>
      <span class="lr-name right ${g.cur[1] > g.cur[0] ? 'lead' : ''}">${esc(sideName(l, 1))}</span></a>`; }).join('')}
  </section>`;
}

const minsAgo = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
// приём открыт, пока жив сам матч: игра ещё идёт / вызов принят и не сыгран
const evAlive = e => e.source === 'live' ? S.data.live.some(l => l.id === e.source_id && l.status === 'live')
  // прогноз «на вызов» живёт, пока эти двое не начали игру (тогда прогнозы — на саму игру)
  : e.source === 'challenge' ? S.data.challenges.some(c => c.id === e.source_id && c.status === 'accepted' && !c.match_id)
    && !S.data.live.some(l => l.status === 'live' && [l.player1_id, l.player2_id].sort().join() === [e.player1_id, e.player2_id].sort().join()) : true;
const evOpen = e => e && e.status === 'open' && (!e.closes_at || Date.now() < Date.parse(e.closes_at)) && evAlive(e);
const evLeft = e => (e?.closes_at ? Math.max(0, Math.ceil((Date.parse(e.closes_at) - Date.now()) / 60000)) : null);

function viewLiveNoScore(l) {
  const ev = S.data.predEvents.find(e => e.source_id === l.id);
  const ids = [l.player1_id, l.player2_id, l.player3_id, l.player4_id];
  const imPlayer = ids.includes(S.me.id);
  const canFinish = imPlayer || l.started_by === S.me.id || isAdmin();
  const myP = ev && myPreds(ev)[0];
  const t = l.tournament_id ? tById(l.tournament_id) : null;
  const card = side => `<div class="lv-panel p${side}"><div class="lv-who">${sideIds(l, side).map(id => ava(P(id), 'sm')).join('')}<b>${esc(sideName(l, side))}</b></div></div>`;
  const need = winsNeeded(l.best_of);
  return `<div class="page-h"><a href="#/home" class="back">← Главная</a><span class="live">● LIVE</span></div>
    <div class="lv-meta">${l.kind === 'doubles' ? 'Пары 2×2' : t ? '🏆 ' + esc(t.name) : 'Свободная игра'} · до ${need} ${plural(need, 'победы', 'побед', 'побед')} · партия до ${l.points_to}</div>
    <div class="lv-board">${card(0)}<div class="lv-sets-score ns">⏱ ${minsAgo(l.created_at)} мин</div>${card(1)}</div>
    <div class="card ns-info">Игра идёт без ведения счёта. Итоговый счёт внесут после игры.</div>
    ${ev ? `<div class="card lv-pred">🎯 <span>${myP ? myPredsLine(ev, sd => sideName(l, sd - 1)) : evOpen(ev) ? `Приём прогнозов ещё ${evLeft(ev)} мин · уже ${ev.bets_count}` : `Прогнозов: ${ev.bets_count} · приём закрыт`}</span>
      ${!imPlayer && evOpen(ev) ? `<button class="btn sm primary" data-act="predict" data-id="${ev.id}">${myP ? '+ ещё ' : ''}×${ev.odds1} / ×${ev.odds2}</button>` : ''}</div>` : ''}
    ${canFinish ? `<div class="stack"><button class="btn primary big" data-act="live-final" data-id="${l.id}">🏁 Внести итоговый счёт</button>
      <button class="btn ghost danger" data-act="live-cancel" data-id="${l.id}">Отменить игру</button></div>`
      : '<p class="muted small center">Итоговый счёт внесёт кто-то из игроков.</p>'}`;
}

function viewLive(r) {
  const l = S.data.live.find(x => x.id === r.args[0]);
  if (!l) return `<div class="page-h"><a href="#/home" class="back">← Главная</a></div><div class="empty">Эта игра уже завершена или отменена.</div>`;
  if (l.scoring === false) return viewLiveNoScore(l);
  const log = liveLog(l);
  const g = replayLive(log, l.best_of, l.points_to, l.first_server);
  const scorer = l.scorer_id === S.me.id;
  // до первого очка счёт не начинается, пока не выбрали, кто подаёт
  const needServe = !log.length && !(S.served || {})[l.id];
  // пауза в игре: очки не добавляются, на табло — таймер и сетка турнира
  const paused = livePaused(l);
  const t = l.tournament_id ? tById(l.tournament_id) : null;
  const panel = side => {
    const ids = sideIds(l, side);
    const flag = g.matchPoint[side] ? 'Матчпоинт' : '';
    return `<div class="lv-panel p${side} ${g.winner === side ? 'won' : ''}">
      <div class="lv-who">${ids.map(id => ava(P(id), 'sm')).join('')}<b>${esc(sideName(l, side))}</b>${g.winner === null && g.server === side && !needServe ? '<span class="lv-serve" title="Подаёт">🏓</span>' : ''}</div>
      <div class="lv-pts">${g.cur[side]}</div>
      <div class="lv-sub"><span>партии: <b>${g.won[side]}</b></span>${flag ? `<span class="lv-flag">${flag}</span>` : ''}</div>
      ${scorer && g.winner === null && !needServe && !paused ? `<div class="lv-btns"><button class="btn lv-minus" data-act="live-minus" data-id="${l.id}" data-side="${side}" aria-label="Минус очко">−</button><button class="btn lv-plus" data-act="live-pt" data-id="${l.id}" data-side="${side}">+1</button></div>` : ''}
    </div>`;
  };
  const sets = g.sets.map((x, i) => `<span>П${i + 1} <b>${x[0]}:${x[1]}</b></span>`).join('');
  const ev = S.data.predEvents.find(e => e.source_id === l.id);
  const imPlayer = [l.player1_id, l.player2_id, l.player3_id, l.player4_id].includes(S.me.id);
  const myP = ev && myPreds(ev)[0];
  const predBar = !ev ? '' : `<div class="card lv-pred">🎯 <span>${myP ? myPredsLine(ev, sd => sideName(l, sd - 1)) : ev.status === 'open' ? `Прогнозы открыты · коэффициенты меняются по ходу игры · уже ${ev.bets_count}` : `Прогнозов: ${ev.bets_count} · приём закрыт`}</span>
    ${!imPlayer && ev.status === 'open' ? `<button class="btn sm primary" data-act="predict" data-id="${ev.id}">${myP ? '+ ещё ' : ''}×${ev.odds1} / ×${ev.odds2}</button>` : ''}</div>`;
  return `<div class="page-h"><a href="#/home" class="back">← Главная</a><span class="live">● LIVE</span></div>
    <div class="lv-meta">${tableOf(l) || l.table_no ? `Стол ${tableOf(l) || l.table_no} · ` : ''}${l.kind === 'doubles' ? 'Пары 2×2' : t ? '🏆 ' + esc(t.name) : l.type === 'tournament' ? 'Турнирный матч' : 'Свободная игра'} · до ${g.need} ${plural(g.need, 'победы', 'побед', 'побед')} · партия до ${l.points_to}${g.deuce && g.winner === null ? ' · <b>баланс</b>' : ''}</div>
    ${scorer && needServe ? `<div class="card lv-first"><b>🏓 Кто подаёт первым?</b><span class="muted small">Разыграйте подачу и нажмите на того, кто начинает</span><div class="lv-first-btns">${[0, 1].map(sd => `<button class="lv-first-b p${sd}" data-act="live-first" data-id="${l.id}" data-side="${sd}">${sideIds(l, sd).map(id => ava(P(id), 'sm')).join('')}<b>${esc(sideName(l, sd))}</b></button>`).join('')}</div></div>` : ''}
    ${predBar}
    ${paused ? `<div class="lv-pause"><span class="muted small">⏸ Пауза в игре — на табло показана сетка</span><b data-until="${esc(l.paused_until)}">${pauseLeft(l)}</b>
      ${scorer ? `<div class="row-btns"><button class="btn ghost" data-act="live-pause" data-id="${l.id}" data-m="1">+1 минута</button><button class="btn primary" data-act="live-resume" data-id="${l.id}">▶ Продолжить</button></div>` : ''}</div>` : ''}
    <div class="lv-board">${panel(0)}<div class="lv-sets-score">${g.won[0]}<i>:</i>${g.won[1]}</div>${panel(1)}</div>
    ${sets ? `<div class="lv-sets">${sets}</div>` : ''}
    ${g.winner !== null ? `<div class="card lv-done"><h3>🏁 Матч окончен</h3><p>Победа: <b>${esc(sideName(l, g.winner))}</b> · ${g.won[0]}:${g.won[1]}</p>
      ${scorer ? `<div class="row-btns"><button class="btn ghost" data-act="live-undo" data-id="${l.id}">↶ Вернуть последнее очко</button><button class="btn primary" data-act="live-save" data-id="${l.id}">Сохранить результат</button></div>` : '<p class="muted small">Счётчик сохранит результат.</p>'}</div>` : ''}
    ${scorer ? `<div class="row-btns lv-tools">${g.winner === null && log.length ? `<button class="btn ghost" data-act="live-undo" data-id="${l.id}">↶ Отменить последнее</button>` : ''}<button class="btn ghost danger" data-act="live-cancel" data-id="${l.id}">Отменить игру</button></div>
      ${g.winner === null && log.length && !paused ? `<button class="btn full lv-pausebtn" data-act="live-pause" data-id="${l.id}">⏸ Пауза — показать сетку на табло</button>` : ''}
      ${isAdmin() ? `<button class="btn ghost full" data-act="screen-freeze" data-m="10">📺 Стоп-кадр табло на 10 минут</button>` : ''}
      ${g.winner === null ? (g.cur[0] + g.cur[1] === 0 ? `<button class="btn ghost full" data-act="live-pass" data-id="${l.id}">🔁 Передать роль секунданта</button>` : '<p class="muted small lv-lock">🔒 Передать роль секунданта можно в перерыве между партиями</p>') : ''}`
      : `<div class="card lv-viewer"><span class="muted small">Счёт ведёт ${esc(P(l.scorer_id).nickname)}. Обновляется сам.</span>${isEditor() || l.started_by === S.me.id ? `<button class="btn sm" data-act="live-take" data-id="${l.id}">Взять счёт на себя</button>` : ''}</div>`}`;
}

function pushLive(l, log) {
  S.liveLocal[l.id] = log;
  render();
  if (navigator.vibrate) navigator.vibrate(15);
  liveQueue = liveQueue.then(() => S.store.update('live_matches', l.id, { log, updated_at: new Date().toISOString() })).catch(e => toast(e.message, 'err'));
}

// свободный стол турнира: стол занят, если идёт игра этого турнира, которую ведёт его секундант
function tableScorer(tid) {
  const t = tid && tById(tid), sc = t?.config?.scorers || [];
  if (!sc.length) return null;
  const busy = new Set(S.data.live.filter(l => l.tournament_id === tid).map(l => l.scorer_id));
  return sc.find(x => x && !busy.has(x)) || sc.find(Boolean) || null;
}
const tableOf = l => { const t = l.tournament_id && tById(l.tournament_id); const k = (t?.config?.scorers || []).indexOf(l.scorer_id); return k >= 0 && (t.config.tables || 1) > 1 ? k + 1 : null; };

const livePaused = l => !!(l.paused_until && Date.parse(l.paused_until) > Date.now());
const pauseLeft = l => { const s = Math.max(0, Math.round((Date.parse(l.paused_until) - Date.now()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// таймеры паузы на экране тикают сами; кончилась пауза — перерисовываем
setInterval(() => {
  document.querySelectorAll('[data-until]').forEach(el => {
    const s = Math.round((Date.parse(el.dataset.until) - Date.now()) / 1000);
    if (s <= 0) { el.removeAttribute('data-until'); if (!$modal.classList.contains('open')) render(); return; }
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
}, 1000);

async function saveLive(l, btn) {
  const log = liveLog(l);
  const g = replayLive(log, l.best_of, l.points_to, l.first_server);
  if (g.winner === null) return;
  const editor = isAdmin() || (isEditor() && [l.player1_id, l.player2_id, l.player3_id, l.player4_id].includes(S.me.id));
  const row = {
    kind: l.kind, type: l.type, player1_id: l.player1_id, player2_id: l.player2_id, player3_id: l.player3_id, player4_id: l.player4_id,
    tournament_id: l.tournament_id, stage: l.stage, grp: l.grp, round: l.round, slot: l.slot,
    sets: g.sets, sets1: g.won[0], sets2: g.won[1], winner_id: g.winner === 0 ? l.player1_id : l.player2_id,
    best_of: l.best_of, points_to: l.points_to, rated: l.rated, played_at: new Date().toISOString(), note: '',
    status: editor ? 'approved' : 'pending', submitted_by: S.me.id, ...(l.is_test ? { is_test: true } : {}),
  };
  await busy(btn, async () => {
    await liveQueue;
    const m = await S.store.insert('matches', row);
    await S.store.update('live_matches', l.id, { status: 'finished', match_id: m.id, log });
    if (l.challenge_id) await S.store.update('challenges', l.challenge_id, { status: 'done', match_id: m.id }).catch(() => {});
    delete S.liveLocal[l.id];
    toast(editor ? 'Матч сохранён, рейтинг пересчитан' : 'Результат отправлен на подтверждение');
    await refresh();
    go(l.tournament_id ? `#/tournament/${l.tournament_id}` : '#/home');
  });
}

// ───────────── Вызовы на матч ─────────────
function challengesBlock() {
  const me = S.me.id;
  const list = S.data.challenges.filter(c => (c.from_id === me || c.to_id === me) && ['pending', 'accepted'].includes(c.status))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!list.length) return '';
  const row = c => {
    const incoming = c.to_id === me, other = P(incoming ? c.from_id : c.to_id);
    const msg = c.message ? `<small class="muted">«${esc(c.message)}»</small>` : '';
    let text, btns;
    if (c.status === 'pending' && incoming) {
      text = `<b>${esc(other.nickname)}</b> вызывает вас на матч`;
      btns = `<button class="btn sm primary" data-act="ch-accept" data-id="${c.id}">Принять</button><button class="btn sm ghost" data-act="ch-decline" data-id="${c.id}">Отказать</button>`;
    } else if (c.status === 'pending') {
      text = `Вы вызвали <b>${esc(other.nickname)}</b> · ждём ответа`;
      btns = `<button class="btn sm ghost" data-act="ch-cancel" data-id="${c.id}">Отменить</button>`;
    } else {
      const live = S.data.live.find(l => l.challenge_id === c.id && l.status === 'live');
      if (live) return `<div class="ch-row">${ava(other, 'md')}<div class="rn"><span>🔴 Идёт ваша игра с <b>${esc(other.nickname)}</b></span><small class="muted">Все видят её в «Лайве»</small></div>
        <div class="ch-btns"><a class="btn sm primary" href="#/live/${live.id}">Открыть игру</a></div></div>`;
      return `<div class="ch-row ch-go">${ava(other, 'md')}<div class="rn"><span>Вызов принят: вы и <b>${esc(other.nickname)}</b> — к столу!</span>${msg}</div>
        <ol class="ch-steps"><li>Подойдите к столу и нажмите <b>«▶ Начать игру»</b></li><li>Выберите, до скольких побед и до скольких очков играете</li><li><b>«Вести счёт»</b> — счёт по ходу ведёт один из вас или третий человек; <b>«Счёт в конце»</b> — внесёте итог после игры</li></ol>
        <small class="muted ch-why">Игра сразу появится у всех в «Лайве» — болельщики смогут сделать прогноз.</small>
        <div class="ch-btns"><button class="btn primary" data-act="ch-start" data-id="${c.id}">▶ Начать игру</button><button class="btn sm ghost" data-act="ch-result" data-id="${c.id}">Уже сыграли — внести счёт</button><button class="btn sm ghost" data-act="ch-cancel" data-id="${c.id}">Отменить</button></div></div>`;
    }
    return `<div class="ch-row">${ava(other, 'md')}<div class="rn"><span>${text}</span>${msg}</div><div class="ch-btns">${btns}</div></div>`;
  };
  return `<section class="card challenges"><div class="card-h"><h3>⚔️ Вызовы</h3></div>${list.map(row).join('')}</section>`;
}

function challengeStats(id) {
  const cs = S.data.challenges;
  return {
    sent: cs.filter(c => c.from_id === id).length,
    accepted: cs.filter(c => c.to_id === id && ['accepted', 'done'].includes(c.status)).length,
  };
}

function openChallengeForm(toId) {
  const p = P(toId);
  const open = S.data.challenges.find(c => c.from_id === S.me.id && c.to_id === toId && ['pending', 'accepted'].includes(c.status));
  if (open) return toast(`У вас уже есть активный вызов для ${p.nickname}`, 'warn');
  const h = headToHead(S.A, S.me.id, toId);
  openModal(`<form data-form="challenge" class="stack"><input type="hidden" name="to" value="${toId}">
    <h3>Вызов на матч</h3>
    <div class="ch-vs">${ava(S.me, 'lg')}<b>vs</b>${ava(p, 'lg')}</div>
    <p class="center muted small">Личные встречи ${h.wa}:${h.wb} · шанс по рейтингу ${pct(expected(ratingOf(S.me.id), ratingOf(toId), S.A.S.spread))}</p>
    <label>Сообщение<input name="message" maxlength="80" placeholder="Например: реванш после обеда?"></label>
    <button class="btn primary">⚔️ Вызвать ${esc(p.nickname)}</button></form>`);
}

// ───────────── Итоги недели ─────────────
function weekCard() {
  const w = weekSummary(S.A, S.D, S.data.profiles);
  if (!w.matches) return '';
  const range = `${fmtDate(w.from)} – ${fmtDate(w.to - 1)}`;
  const item = (icon, label, val) => `<div class="wk-item"><span>${icon}</span><div><small>${label}</small><b>${val}</b></div></div>`;
  return `<section class="card week"><div class="card-h"><h3>📊 Итоги недели</h3><span class="muted small">${range}</span></div>
    <div class="wk-grid">
      ${item('🏓', 'Сыграно', `${w.matches} ${plural(w.matches, 'матч', 'матча', 'матчей')}${w.doubles ? ` (пар: ${w.doubles})` : ''}`)}
      ${w.top ? item('📈', 'Рост недели', `${esc(P(w.top.id).nickname)} ${fmtD(w.top.g)}`) : ''}
      ${w.active ? item('🔋', 'Самый активный', `${esc(P(w.active.id).nickname)} · ${w.active.n}`) : ''}
      ${w.upset ? item('💥', 'Сенсация', `${esc(P(w.upset.w).nickname)} обыграл ${esc(P(w.upset.l).nickname)}`) : ''}
    </div></section>`;
}

// ───────────── Парные игры в профиле ─────────────
function doublesBlock(id) {
  const st = S.D.stats.get(id);
  if (!st || !st.matches) return '';
  const r = S.D.rating.get(id);
  const pos = rankingDoubles(S.D, S.data.profiles).findIndex(x => x.p.id === id) + 1;
  const partners = [...st.partners].map(([pid, o]) => ({ pid, ...o, n: o.w + o.l })).sort((a, b) => b.n - a.n || b.w - a.w).slice(0, 4);
  const recent = S.D.played.filter(m => players(m).includes(id)).slice(-5).reverse();
  return `<section class="card"><div class="card-h"><h3>👥 Парные игры 2×2</h3><a class="link" href="#/rating?mode=doubles">Парный рейтинг →</a></div>
    <div class="stat-grid in">
      <div><b>${fmtR(r)}</b><small>парный рейтинг</small></div>
      <div><b>${pos ? '#' + pos : '—'}</b><small>место</small></div>
      <div><b class="up">${st.wins}</b><small>побед</small></div>
      <div><b class="down">${st.losses}</b><small>поражений</small></div>
    </div>
    ${partners.length ? `<div class="card-h mt"><h3>Партнёры</h3></div>${partners.map(o => `<div class="opp-row">${ava(P(o.pid), 'sm')}<span class="rn"><b>${esc(P(o.pid).nickname)}</b><small>${o.n} ${plural(o.n, 'игра', 'игры', 'игр')} вместе</small></span><span class="h2h-score"><b class="up">${o.w}</b>:<b class="down">${o.l}</b></span></div>`).join('')}` : ''}
    ${recent.map(m => matchCard(m, id)).join('')}
  </section>`;
}

// ───────────── Сезоны ─────────────
function viewSeasons() {
  const list = S.seasons;
  const min = S.A.S.seasonMinMatches;
  const table = (t, live) => `
    <section class="card season ${live ? 'live-season' : ''}">
      <div class="card-h"><h3>${live ? '🔥 ' : '🏆 '}${monthName(t.key)}</h3><span class="muted small">${t.total} ${plural(t.total, 'матч', 'матча', 'матчей')}</span></div>
      ${t.champion ? `<div class="champ">${ava(P(t.champion.id), 'md')}<div><small>${live ? 'Сейчас лидирует' : 'Чемпион сезона'}</small><b>${esc(P(t.champion.id).nickname)}</b><span class="up">${fmtD(t.champion.gain)}</span></div></div>` : `<p class="muted small">Пока никто не сыграл ${min} ${plural(min, 'матч', 'матча', 'матчей')} — нужно для борьбы за титул.</p>`}
      ${live ? `<p class="small ssn-me">⏳ ${seasonMine(S.me.id)}</p>` : ''}
      ${t.eligible.slice(live ? 0 : 1, live ? 10 : 3).map((r, i) => `<a href="#/player/${r.id}" class="rank-row ${r.id === S.me.id ? 'me' : ''}"><span class="pos">${live ? i + 1 : i + 2}</span>${ava(P(r.id), 'sm')}<span class="rn"><b>${esc(P(r.id).nickname)}</b><small>${r.matches} ${plural(r.matches, 'матч', 'матча', 'матчей')} · ${r.wins}В</small></span><span class="rr">${delta(r.gain)}</span></a>`).join('')}
      ${live && t.rest.length ? `<p class="muted small mt">Ещё не набрали ${min} матча: ${t.rest.map(r => `${esc(P(r.id).nickname)} (${r.matches})`).join(', ')}</p>` : ''}
    </section>`;
  const cur = list.find(t => !t.finished);
  const past = list.filter(t => t.finished);
  return `<div class="page-h"><a href="#/rating" class="back">← Рейтинг</a></div>
    <h1>Сезоны</h1>
    <p class="muted small">Каждый месяц — отдельный сезон. Чемпион — тот, кто сильнее всех прибавил в рейтинге за месяц (нужно сыграть минимум ${min} ${plural(min, 'матч', 'матча', 'матчей')}). Общий рейтинг не обнуляется. 1-го числа всем приходит уведомление с итогами, а призёры получают значки в профиль: 🏆 чемпион, 🥈 и 🥉 — второе и третье места.</p>
    ${cur ? table(cur, true) : ''}
    ${past.length ? `<div class="sec-h"><h3>Прошлые сезоны</h3></div>${past.map(t => table(t, false)).join('')}` : ''}
    ${!list.length ? '<div class="empty">Сезоны появятся после первых матчей</div>' : ''}`;
}

// ───────────── Сезон: моё место, дни до конца, история по сезонам ─────────────
const seasonDaysLeft = () => { const d = new Date(); return Math.max(1, Math.ceil((new Date(d.getFullYear(), d.getMonth() + 1, 1) - d) / DAY)); };
function seasonPlace(t, id) {
  const i = t.eligible.findIndex(r => r.id === id);
  if (i >= 0) return { place: i + 1, row: t.eligible[i] };
  const row = t.rest.find(r => r.id === id);
  return row ? { place: null, row } : null;
}
function seasonMine(id) {
  const t = S.seasons.find(x => !x.finished);
  const min = S.A.S.seasonMinMatches;
  const left = `до конца сезона ${seasonDaysLeft()} ${plural(seasonDaysLeft(), 'день', 'дня', 'дней')}`;
  const sp = t && seasonPlace(t, id);
  if (!sp) return `Вы ещё не играли в этом сезоне · ${left}`;
  if (!sp.place) { const k = min - sp.row.matches; return `Ещё ${k} ${plural(k, 'матч', 'матча', 'матчей')} — и вы в борьбе за титул · ${left}`; }
  return `Вы ${sp.place}-й из ${t.eligible.length} · ${fmtD(sp.row.gain)} · ${left}`;
}
function seasonsBlock(id) {
  const rows = S.seasons.map(t => ({ t, sp: seasonPlace(t, id) })).filter(x => x.sp).slice(0, 6);
  if (!rows.length) return '';
  return `<section class="card"><div class="card-h"><h3>🗓 Сезоны</h3><a href="#/seasons" class="link">Все сезоны →</a></div>
    ${rows.map(({ t, sp }) => `<div class="opp-row"><span class="ssn-place ${sp.place && sp.place <= 3 && t.finished ? 'ssn-top' : ''}">${sp.place ? (t.finished && sp.place <= 3 ? ['🏆', '🥈', '🥉'][sp.place - 1] : '#' + sp.place) : '—'}</span>
      <span class="rn"><b>${monthName(t.key)}${t.finished ? '' : ' · идёт'}</b><small>${sp.row.matches} ${plural(sp.row.matches, 'матч', 'матча', 'матчей')} · ${sp.row.wins}В${sp.place ? '' : ' · мало матчей для титула'}</small></span>${delta(sp.row.gain)}</div>`).join('')}
  </section>`;
}

// ───────────── Значки: достижения + сезоны + турниры + вызовы ─────────────
function badgesOf(id, st = playerStats(id, S.A, S.data.tournaments)) {
  const out = [];
  for (const t of S.seasons) {
    if (!t.finished) continue;
    const i = t.eligible.findIndex(r => r.id === id);
    if (i >= 0 && i < 3 && t.eligible[i].gain > 0) out.push({ icon: ['🏆', '🥈', '🥉'][i], name: i ? `${i + 1}-е место сезона` : 'Чемпион сезона', desc: monthName(t.key), rank: 3 - i });
  }
  const cs = challengeStats(id);
  if (cs.sent >= 5) out.push({ icon: '🤺', name: 'Дуэлянт', desc: 'Бросить 5 вызовов на матч', rank: 0 });
  if (cs.accepted >= 5) out.push({ icon: '🛡️', name: 'Не боится вызовов', desc: 'Принять 5 вызовов', rank: 0 });
  for (const a of ACHIEVEMENTS) if (a.test(st)) out.push({ icon: a.icon, name: a.name, desc: a.desc, rank: 0 });
  return out.sort((a, b) => b.rank - a.rank);
}
// значки-кружочки в шапке профиля: нажмёшь — покажет, за что
function badgeStrip(list) {
  if (!list.length) return '';
  return `<div class="badge-strip">${list.map((b, i) => `<button class="bdg ${b.rank ? 'gold' : ''}" data-act="badge" data-i="${i}" title="${esc(b.name)}">${b.icon}</button>`).join('')}</div>`;
}

// ───────────── Игроки ─────────────
function lastPlayedMap() {
  const last = new Map();
  for (const m of S.data.matches) if (m.status === 'approved') for (const id of players(m)) if (id) last.set(id, Math.max(last.get(id) || 0, ts(m)));
  return last;
}
const idleDays = (last, id) => (last.get(id) ? Math.floor((Date.now() - last.get(id)) / DAY) : null);
const lastText = d => (d == null ? 'ещё не играл(а)' : d === 0 ? 'играл(а) сегодня' : d === 1 ? 'играл(а) вчера' : `играл(а) ${d} ${plural(d, 'день', 'дня', 'дней')} назад`);
const openChallenge = id => S.data.challenges.find(c => ((c.from_id === S.me.id && c.to_id === id) || (c.to_id === S.me.id && c.from_id === id)) && ['pending', 'accepted'].includes(c.status));
// соперники для вызова: ближе всех по рейтингу, сначала те, кто играет последний месяц
function suggestOpponents(n = 3) {
  const last = lastPlayedMap(), r = ratingOf(S.me.id);
  return S.data.profiles.filter(p => p.status === 'approved' && p.id !== S.me.id && !openChallenge(p.id))
    .map(p => { const d = idleDays(last, p.id); return { p, d, k: Math.abs(ratingOf(p.id) - r) + (d == null || d > 30 ? 100 : 0) }; })
    .sort((a, b) => a.k - b.k).slice(0, n);
}
// Не больше N игр подряд с одним соперником (защита от накрутки). Считаем свободные одиночные игры; возвращает, кто из двоих упёрся в лимит
const repCache = new WeakMap();
function repeatBlocked(a, b) {
  const lim = settings().repeatLimit ?? 2;
  if (!(lim > 0) || !S.data || isEditor() || !a || !b || a === b) return null;
  if (S.data.profiles.filter(p => p.status === 'approved').length < 3) return null;
  let c = repCache.get(S.data.matches);
  if (!c || c.lim !== lim) {
    const list = S.data.matches.filter(m => m.kind !== 'doubles' && !m.tournament_id && ['approved', 'pending'].includes(m.status))
      .sort((x, y) => Date.parse(y.played_at) - Date.parse(x.played_at) || Date.parse(y.created_at || 0) - Date.parse(x.created_at || 0));
    const by = new Map();
    for (const m of list) for (const [me, opp] of [[m.player1_id, m.player2_id], [m.player2_id, m.player1_id]]) { const l = by.get(me) || []; if (l.length < lim) { l.push(opp); by.set(me, l); } }
    c = { lim, by }; repCache.set(S.data.matches, c);
  }
  for (const [me, other] of [[a, b], [b, a]]) { const l = c.by.get(me) || []; if (l.length >= lim && l.every(o => o === other)) return me; }
  return null;
}
const repeatMsg = who => { const lim = settings().repeatLimit ?? 2; return `${who === S.me.id ? 'Вы уже сыграли' : `Игрок «${P(who).nickname}» уже сыграл`} с этим соперником ${lim} ${plural(lim, 'раз', 'раза', 'раз')} подряд. Сначала нужно сыграть с кем-то другим.`; };
function challengeBtn(id) {
  if (id === S.me.id) return '<span class="pl-me">это вы</span>';
  const c = openChallenge(id);
  if (c) return `<span class="pl-ch">${c.status === 'accepted' ? '⚔️ к столу' : c.from_id === S.me.id ? '⏳ вызван' : '⚔️ вызывает вас'}</span>`;
  if (repeatBlocked(S.me.id, id)) return `<button class="btn sm" disabled title="Сначала сыграйте с кем-то другим">⏸ Нужен другой соперник</button>`;
  return `<button class="btn sm primary" data-act="challenge" data-id="${id}">⚔️ Вызвать</button>`;
}
// напоминание на главной: давно не играли — вызовите кого-нибудь
function idleNudge() {
  if (S.me.status !== 'approved') return '';
  const d = idleDays(lastPlayedMap(), S.me.id);
  if (d != null && d < 10) return '';
  const opps = suggestOpponents(3);
  if (!opps.length) return '';
  const s = S.A.S;
  const head = d == null ? 'Вы ещё не сыграли ни одного матча' : `Вы не играли ${d} ${plural(d, 'день', 'дня', 'дней')}`;
  const why = d == null ? 'Вызовите кого-нибудь — первый матч сразу даст рейтинг и место в таблице.'
    : s.decayEnabled && d >= s.decayGraceDays ? 'Рейтинг понемногу снижается без игр — один матч это остановит.' : 'Стол скучает! Вызовите кого-нибудь на матч.';
  return `<section class="card nudge"><div class="card-h"><h3>🏓 ${head}</h3><a href="#/players" class="link">Все игроки →</a></div>
    <p class="muted small">${why}</p>
    ${opps.map(({ p }) => `<div class="plx-row"><a href="#/player/${p.id}" class="pl-main">${ava(p, 'sm')}<span class="rn"><b>${esc(p.nickname)}</b><small>${fmtR(ratingOf(p.id))} · шанс ${pct(expected(ratingOf(S.me.id), ratingOf(p.id), S.A.S.spread))}</small></span></a>${challengeBtn(p.id)}</div>`).join('')}
  </section>`;
}
function viewPlayers(r) {
  const sort = ['name', 'recent'].includes(r.q.get('sort')) ? r.q.get('sort') : 'rating';
  const last = lastPlayedMap();
  const pos = new Map(S.rank.map((x, i) => [x.p.id, x.g ? i + 1 : null]));
  const list = S.data.profiles.filter(p => p.status === 'approved');
  if (sort === 'name') list.sort((a, b) => a.nickname.localeCompare(b.nickname, 'ru'));
  else if (sort === 'recent') list.sort((a, b) => (last.get(b.id) || 0) - (last.get(a.id) || 0));
  else list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9) || ratingOf(b.id) - ratingOf(a.id));
  const row = p => {
    const top = badgesOf(p.id).slice(0, 3).map(b => b.icon).join('');
    const d = idleDays(last, p.id);
    return `<div class="plx-row" data-name="${esc((p.nickname + ' ' + (p.full_name || '')).toLowerCase())}">
      <a href="#/player/${p.id}" class="pl-main"><span class="pos">${pos.get(p.id) || '–'}</span>${ava(p, 'md')}
        <span class="rn"><b>${esc(p.nickname)}${top ? ` <i class="pl-bdg">${top}</i>` : ''}</b><small>${leagueOf(ratingOf(p.id)).name} · ${fmtR(ratingOf(p.id))} · <span class="${d == null || d > 14 ? 'idle' : ''}">${lastText(d)}</span></small></span></a>
      ${challengeBtn(p.id)}</div>`;
  };
  const qs = s => `#/players${s === 'rating' ? '' : '?sort=' + s}`;
  return `<div class="page-h"><h1>Игроки</h1><span class="muted small">${list.length} в клубе</span></div>
    <input type="search" class="pl-search" data-input="pl-search" placeholder="Найти по нику или имени" autocomplete="off">
    <div class="seg">${[['rating', 'По рейтингу'], ['name', 'По имени'], ['recent', 'Кто играл']].map(([k, l]) => `<a href="${qs(k)}" class="${sort === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <section class="card pl-list">${list.map(row).join('') || '<div class="empty">В клубе пока никого нет</div>'}<div class="empty" id="pl-none" hidden>Никого не нашли</div></section>
    <a href="#/invite" class="btn ghost full">✉️ ${isAdmin() ? 'Пригласить в клуб' : 'Пригласить друга в клуб'}</a>`;
}
function filterPlayers(q) {
  q = q.trim().toLowerCase();
  let n = 0;
  for (const el of document.querySelectorAll('.pl-list .plx-row')) { const ok = !q || el.dataset.name.includes(q); el.hidden = !ok; n += ok; }
  const none = document.getElementById('pl-none');
  if (none) none.hidden = n > 0;
}

// ───────────── Карточка игрока для чата ─────────────
async function sharePlayer(id, noPhoto = false) {
  const p = P(id), st = playerStats(id, S.A, S.data.tournaments), r = ratingOf(id), lg = leagueOf(r);
  const pos = S.rank.findIndex(x => x.p.id === id) + 1;
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3b7fd4'); g.addColorStop(1, '#1c4f9c');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 14; x.strokeRect(50, 50, W - 100, H - 100);
  x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 6; x.beginPath(); x.moveTo(540, 50); x.lineTo(540, H - 50); x.stroke();
  const img = (src, cors) => new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const logoImg = await img(logo());
  if (logoImg) x.drawImage(logoImg, 100, 100, 90, 90);
  x.fillStyle = '#fff'; x.textBaseline = 'middle';
  x.font = '800 54px "Barlow Condensed", sans-serif'; x.textAlign = 'left'; x.fillText('PONGHUB', 210, 147);
  const club = settings().clubName || 'PongHub';
  x.font = '500 34px Inter, sans-serif'; x.textAlign = 'right';
  let cl = club; while (x.measureText(cl).width > 480 && cl.length > 4) cl = cl.slice(0, -2) + '…';
  x.fillText(cl, 980, 147);
  // аватар: фото (если сервер разрешает) или эмодзи на цветном круге
  const cx = 540, cy = 400, R = 160;
  x.save(); x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.closePath();
  x.fillStyle = p.color || '#e63946'; x.fill(); x.clip();
  const photo = p.photo_url && !noPhoto ? await img(media(p.photo_url), true) : null;
  if (photo) { const k = Math.max(2 * R / photo.width, 2 * R / photo.height); x.drawImage(photo, cx - photo.width * k / 2, cy - photo.height * k / 2, photo.width * k, photo.height * k); }
  else { x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '160px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.fillText(p.avatar || (p.nickname || '?')[0], cx, cy + 10); }
  x.restore();
  x.strokeStyle = '#fff'; x.lineWidth = 10; x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.stroke();
  // ник, лига, место
  x.textAlign = 'center'; x.fillStyle = '#fff';
  let s = 110; do { x.font = `800 ${s}px "Barlow Condensed", sans-serif`; s -= 4; } while (x.measureText(p.nickname).width > 860 && s > 40);
  x.fillText(p.nickname, cx, 650);
  const LG = { bronze: '#c98a4b', silver: '#b8c2cf', gold: '#ffd166', platinum: '#7fe0d6', diamond: '#a5b4ff' };
  const tag = `${lg.name}${pos && st.matches ? ` · ${pos}-е место из ${S.rank.length}` : ''}`;
  x.font = '700 38px Inter, sans-serif';
  const tw = x.measureText(tag).width + 60;
  x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.roundRect(cx - tw / 2, 705, tw, 64, 32); x.fill();
  x.fillStyle = LG[lg.cls] || '#fff'; x.fillText(tag, cx, 739);
  // рейтинг
  x.fillStyle = '#16181d'; x.beginPath(); x.roundRect(340, 795, 400, 180, 36); x.fill();
  x.fillStyle = '#fff'; x.font = '800 116px "Barlow Condensed", sans-serif'; x.fillText(fmtR(r), cx, 865);
  x.font = '500 28px Inter, sans-serif'; x.fillStyle = 'rgba(255,255,255,.75)'; x.fillText('рейтинг', cx, 945);
  // цифры
  const nums = [[st.matches, 'матчей'], [st.wins, 'побед'], [pct(st.winRate), 'побед, %'], [st.bestStreak, 'лучшая серия']];
  nums.forEach(([v, l], i) => {
    const nx = 190 + i * 233;
    x.fillStyle = '#fff'; x.font = '800 72px "Barlow Condensed", sans-serif'; x.fillText(String(v), nx, 1040);
    x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '500 26px Inter, sans-serif'; x.fillText(l, nx, 1092);
  });
  // значки
  const bs = badgesOf(id, st).slice(0, 9);
  if (bs.length) {
    x.font = '56px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    const step = 88, x0 = cx - (bs.length - 1) * step / 2;
    bs.forEach((b, i) => x.fillText(b.icon, x0 + i * step, 1170));
  }
  x.font = '600 32px Inter, sans-serif'; x.fillStyle = '#7dffc4';
  x.fillText('Вызови меня на матч в PongHub! 🏓', cx, 1250);
  const blob = await new Promise(res => { try { c.toBlob(res, 'image/png'); } catch { res(null); } });
  // фото с чужого сервера могло «испачкать» холст — тогда рисуем заново с эмодзи
  if (!blob && photo) return sharePlayer(id, true);
  if (!blob) return toast('Не удалось сделать картинку', 'err');
  const link = `${linkBase()}#/player/${id}${S.club ? '?club=' + S.club.id : ''}`;
  const text = `${p.nickname} — ${fmtR(r)} в рейтинге «${club}», ${lg.name}. Вызови на матч: ${link}`;
  const file = new File([blob], 'ponghub-player.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: p.nickname, text }); } catch { /* закрыли меню */ }
  } else {
    download('ponghub-player.png', blob, 'image/png');
    await copyText(text);
    toast('Картинка сохранена, ссылка скопирована — отправьте в чат');
  }
}

// ───────────── Карточка результата ─────────────
async function shareMatch(m) {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1080;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 1080);
  g.addColorStop(0, '#3b7fd4'); g.addColorStop(1, '#1c4f9c');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1080);
  x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 14; x.strokeRect(50, 50, 980, 980);
  x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 6; x.beginPath(); x.moveTo(540, 50); x.lineTo(540, 1030); x.stroke();
  const logoImg = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = logo(); });
  if (logoImg) x.drawImage(logoImg, 100, 100, 90, 90);
  x.fillStyle = '#fff'; x.textBaseline = 'middle';
  x.font = '800 54px "Barlow Condensed", sans-serif'; x.textAlign = 'left'; x.fillText('PONGHUB', 210, 147);
  x.font = '500 34px Inter, sans-serif'; x.textAlign = 'right';
  x.fillText(isDoubles(m) ? 'Парная игра 2×2' : m.type === 'tournament' ? 'Турнирный матч' : 'Свободная игра', 980, 147);
  const w1 = m.winner_id === m.player1_id;
  const fit = (txt, max, size) => { let s2 = size; do { x.font = `800 ${s2}px "Barlow Condensed", sans-serif`; s2 -= 2; } while (x.measureText(txt).width > max && s2 > 30); };
  const name = (txt, cx, y, win) => { x.textAlign = 'center'; fit(txt, 400, 76); x.fillStyle = win ? '#fff' : 'rgba(255,255,255,.65)'; x.fillText(txt, cx, y); };
  name(teamName(m, 1), 290, 420, w1); name(teamName(m, 2), 790, 420, !w1);
  x.fillStyle = '#16181d'; x.beginPath(); x.roundRect(370, 500, 340, 200, 36); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '800 150px "Barlow Condensed", sans-serif'; x.fillText(`${m.sets1}:${m.sets2}`, 540, 605);
  if (m.sets?.length) { x.font = '600 40px Inter, sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(m.sets.map(s2 => s2.join(':')).join('   '), 540, 780); }
  const d = isDoubles(m) ? S.D.md.get(m.id) : S.A.md.get(m.id);
  if (d && m.rated !== false) {
    const ids = players(m), wid = ids.find(id => wonBy(m, id));
    x.font = '700 44px Inter, sans-serif'; x.fillStyle = '#7dffc4';
    x.fillText(`${teamName(m, w1 ? 1 : 2)}  ${fmtD(d.delta[wid])} к рейтингу`, 540, 860);
  }
  x.font = '500 32px Inter, sans-serif'; x.fillStyle = 'rgba(255,255,255,.75)';
  x.fillText(new Date(m.played_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + (settings().clubName || 'PongHub'), 540, 960);
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'ponghub-match.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'PongHub', text: `${teamName(m, 1)} ${m.sets1}:${m.sets2} ${teamName(m, 2)}` }); } catch { /* закрыли меню */ }
  } else {
    download('ponghub-match.png', blob, 'image/png');
    toast('Картинка сохранена — отправьте её в чат');
  }
}

// ───────────── Удаление с причиной ─────────────
const DELETE_REASONS = ['Ошибка при вводе — внесу заново', 'Матч не состоялся', 'Дубликат', 'Неверные игроки'];
function askReason(title, text) {
  return new Promise(res => {
    openModal(`<form class="stack" id="reason-form"><h3>${esc(title)}</h3><p class="muted small">${esc(text)}</p>
      <div class="reasons">${DELETE_REASONS.map((r, i) => `<label class="pick"><input type="radio" name="r" value="${esc(r)}" ${i === 0 ? 'checked' : ''}><span>${esc(r)}</span></label>`).join('')}
        <label class="pick"><input type="radio" name="r" value="other"><span>Другое…</span></label></div>
      <input name="other" maxlength="120" placeholder="Опишите причину" hidden>
      <p class="muted small">Причина сохранится в журнале изменений, владелец её увидит.</p>
      <div class="row-btns"><button type="button" class="btn ghost" id="rs-no">Отмена</button><button class="btn danger">Удалить</button></div></form>`, sh => {
      const f = sh.querySelector('form');
      f.addEventListener('change', () => { f.other.hidden = f.r.value !== 'other'; if (!f.other.hidden) f.other.focus(); });
      sh.querySelector('#rs-no').onclick = () => { closeModal(); res(null); };
      f.addEventListener('submit', e => {
        e.preventDefault(); e.stopPropagation();
        const v = f.r.value === 'other' ? f.other.value.trim() : f.r.value;
        if (!v) { f.other.focus(); return; }
        closeModal(); res(v);
      });
    });
  });
}

// ───────────── Журнал изменений ─────────────
function auditText(e) {
  const who = e.actor_id ? esc(P(e.actor_id).nickname) : 'Система';
  const m = e.new_data || e.old_data || {};
  const score = d => d ? `${esc(isDoubles(d) ? teamName(d, 1) : P(d.player1_id).nickname)} ${d.sets1}:${d.sets2} ${esc(isDoubles(d) ? teamName(d, 2) : P(d.player2_id).nickname)}` : '';
  if (e.table_name === 'matches') {
    if (e.action === 'insert') return `${who} внёс матч ${score(m)}${m.status === 'pending' ? ' (на подтверждение)' : ''}`;
    if (e.action === 'delete') return `${who} <b class="down">удалил</b> матч ${score(e.old_data)}`;
    const o = e.old_data, n = e.new_data;
    if (o.status !== n.status && n.status === 'approved') return `${who} подтвердил матч ${score(n)}`;
    if (o.sets1 !== n.sets1 || o.sets2 !== n.sets2 || JSON.stringify(o.sets) !== JSON.stringify(n.sets)) return `${who} <b>изменил счёт</b>: было ${score(o)} → стало ${score(n)}`;
    return `${who} изменил матч ${score(n)}`;
  }
  if (e.table_name === 'tournaments') return `${who} ${e.action === 'insert' ? 'создал' : e.action === 'delete' ? '<b class="down">удалил</b>' : 'изменил'} турнир «${esc(m.name)}»${e.action === 'update' && e.new_data?.status === 'finished' && e.old_data?.status !== 'finished' ? ' (завершён)' : ''}`;
  if (e.table_name === 'profiles') {
    const o = e.old_data || {}, n = e.new_data || {};
    if (o.status !== n.status) return `${who}: ${esc(o.nickname)} — статус «${o.status}» → «${n.status}»`;
    if (o.role !== n.role) return `${who}: ${esc(n.nickname)} — ${n.role === 'editor' ? 'назначен помощником' : 'больше не помощник'}`;
    if (o.initial_rating !== n.initial_rating) return `${who}: ${esc(n.nickname)} — стартовый рейтинг ${o.initial_rating ?? 'по умолчанию'} → ${n.initial_rating ?? 'по умолчанию'}`;
    return `${who}: ник «${esc(o.nickname)}» → «${esc(n.nickname)}»`;
  }
  if (e.table_name === 'settings') return `${who} изменил настройки рейтинга`;
  return `${who}: ${e.action} ${e.table_name}`;
}

async function renderAudit() {
  const box = document.getElementById('audit-box');
  if (!box) return;
  let list;
  try { list = await S.store.loadAudit(300); } catch (e) { box.innerHTML = `<div class="empty">Журнал станет доступен после обновления базы</div>`; return; }
  const onlyDel = box.dataset.filter === 'del';
  if (onlyDel) list = list.filter(e => e.action === 'delete');
  const existing = new Set(S.data.matches.map(m => m.id));
  box.innerHTML = list.map(e => `<div class="log-row ${e.action === 'delete' ? 'del' : ''}">
      <div class="log-main"><span>${auditText(e)}</span>${e.reason ? `<small class="log-reason">Причина: ${esc(e.reason)}</small>` : ''}<small class="muted">${fmtDT(e.at)}</small></div>
      ${e.action === 'delete' && e.table_name === 'matches' && !existing.has(e.record_id) ? `<button class="btn xs" data-act="restore-match" data-id="${e.id}">Восстановить</button>` : ''}
    </div>`).join('') || '<div class="empty">Записей пока нет</div>';
}

async function renderBackups() {
  const box = document.getElementById('backup-box');
  if (!box) return;
  let list = [];
  try { list = await S.store.listBackups(); } catch { /* */ }
  box.innerHTML = list.length
    ? list.map(f => `<div class="opp-row"><span class="rn"><b>${esc(f.name.replace('backup-', '').replace('.json', '').replace('T', ' '))}</b><small>${Math.round((f.metadata?.size || 0) / 1024)} КБ</small></span><button class="btn xs" data-act="get-backup" data-name="${esc(f.name)}">Скачать</button></div>`).join('')
    : '<p class="muted small">Копий пока нет. Первая появится в понедельник ночью — или нажмите «Сделать копию сейчас».</p>';
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
    <ul><li>Вы и помощники вносите результат сразу.</li><li>Игрок может отправить результат сам — он попадёт в рейтинг после подтверждения владельцем или помощником.</li><li>${settings().system !== 'elo' && +settings().leagueFreeMult === 1 ? 'Свободная игра считается в рейтинге так же, как турнирная.' : 'Свободная игра весит в рейтинге меньше турнирной.'}</li></ul>`)}
  ${sec('👥 Парные игры 2×2', `<p>«+» → <b>«Пары 2×2»</b>, выберите две команды и счёт. Парные игры считаются в <b>отдельном парном рейтинге</b> (вкладка «Парный 2×2» в рейтинге) и не трогают одиночный. Переключатель «Учитывать в парном рейтинге» можно выключить для разминочной игры.</p>`)}
  ${sec('⚔️ Вызов на матч', `<p>Откройте профиль соперника → <b>«Вызвать на матч»</b>. Ему придёт уведомление, он принимает или отказывается. После игры нажмите на главной <b>«Внести результат»</b>.</p>`)}
  ${sec('🏆 Сезоны и итоги недели', `<p>Каждый месяц — сезон: чемпион тот, кто сильнее всех вырос в рейтинге за месяц. Каждый понедельник приходят итоги прошлой недели. Если долго не играть, рейтинг понемногу снижается (но не ниже стартового).</p>`)}
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
  ${isAdmin() ? '<a href="#/rules" class="card menu-item">📐 <span>Как считается рейтинг</span><span>→</span></a>' : ''}`;
}

// ───────────── Профиль / настройки ─────────────
function viewMe() {
  const me = S.me;
  const myPos = S.rank.findIndex(x => x.p.id === me.id && x.g) + 1;
  let theme = 'light';
  try { theme = localStorage.getItem('ponghub_theme') || 'light'; } catch { /* */ }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  // разделы по смыслу: я и моя игра → мои вещи → управление клубом (владелец) → клубы → аккаунт → настройки
  const sub = t => `<small class="muted menu-sub">${t}</small>`;
  const group = (title, items) => items.join('') ? `<section class="card menu"><div class="menu-t">${title}</div>${items.join('')}</section>` : '';
  const pc = pendingCounts().total;
  return `<div class="page-h"><h1>Профиль</h1></div>
  <a href="#/player/${me.id}" class="card me-card">${ava(me, 'md')}<div><b>${esc(me.nickname)}</b> ${roleBadge(me)}<div class="muted small">${esc(me.full_name || '')} · моя статистика</div></div><span>→</span></a>
  ${group('Моя игра', [
    `<a class="menu-item" href="#/rating">🏆 <span>Рейтинг${sub(`${myPos ? `вы ${myPos}-й из ${S.rank.length} · ` : ''}одиночный, парный, сезоны`)}</span><span>→</span></a>`,
    '<a class="menu-item" href="#/matches">📋 <span>Матчи' + sub('все игры, ваши результаты') + '</span><span>→</span></a>',
    `<a class="menu-item" href="#/h2h/${me.id}">⚔️ <span>Личные встречи</span><span>→</span></a>`,
    '<a class="menu-item" href="#/calendar">📅 <span>Календарь игр</span><span>→</span></a>',
    predOn() ? '<a class="menu-item" href="#/predict">🎯 <span>Прогнозы</span><span>→</span></a>' : '',
  ])}
  ${group('Мои вещи', [
    feature('shop') ? `<a class="menu-item" href="#/shop">🛍️ <span>Магазин</span><small class="muted">${fmtC(S.coins)} PC</small></a><a class="menu-item cn-menu" href="#/shop" data-act="coll-open">🏆 <span>Коллекция</span>${lsGet(CN_KEY.visit) ? '<span>→</span>' : '<i class="cn-new">NEW</i>'}</a><a class="menu-item" href="#/inventory">🎒 <span>Мой инвентарь</span><span>→</span></a><a class="menu-item" href="#/racket">🏓 <span>Моя ракетка</span><span>→</span></a>` : '',
    feature('avatar') ? '<a class="menu-item" href="#/avatar">🧍 <span>Мой игрок</span><span>→</span></a>' : '',
  ])}
  ${isAdmin() ? group('Управление клубом', [
    `<a class="menu-item" href="#/admin">🛠️ <span>Заявки, игроки, матчи, табло${sub('настройки рейтинга и данные клуба')}</span>${pc ? `<i class="dot inline">${pc}</i>` : '<span>→</span>'}</a>`,
    '<a class="menu-item" href="#/invite">✉️ <span>Пригласить в клуб</span><span>→</span></a>',
    '<a class="menu-item" href="#/print">🖨 <span>Печать: плакат и домики на столы</span><span>→</span></a>',
    '<a class="menu-item" href="#/clubedit">🏠 <span>Клуб: название, адрес, карта</span><span>→</span></a>',
    '<a class="menu-item" href="#/rules">📐 <span>Как считается рейтинг</span><span>→</span></a>',
  ]) : ''}
  ${group('Клубы', [
    isAdmin() ? '' : '<a class="menu-item" href="#/invite">✉️ <span>Пригласить друга в клуб</span><span>→</span></a>',
    `<a class="menu-item" href="#/clubs">🏠 <span>Мои клубы</span><small class="muted">${(S.ctx?.clubs || []).filter(c => c.my_status === 'active').length}</small></a>`,
    '<a class="menu-item" href="#/map">🗺 <span>Клубы на карте</span><span>→</span></a>',
    isFounder() ? '<a class="menu-item" href="#/founder">🛡 <span>Платформа PongHub</span><span>→</span></a>' : '',
  ])}
  ${group('Аккаунт', [
    '<button class="menu-item" data-act="edit-profile">✏️ <span>Редактировать профиль</span></button>',
    S.ctx?.me?.telegram_id ? `<button class="menu-item" data-act="tg-unlink">${TG_ICON} <span>Telegram привязан${S.ctx.me.telegram_username ? ' · @' + esc(S.ctx.me.telegram_username) : ''}</span><small class="muted">отвязать</small></button>`
      : `<button class="menu-item" data-act="tg-link">${TG_ICON} <span>Привязать Telegram</span><small class="muted">вход в одно касание</small></button>`,
    S.store.mode === 'supabase' ? '<button class="menu-item" data-act="change-pass">🔑 <span>Сменить пароль</span></button>' : '',
    '<a class="menu-item" href="#/help">❓ <span>Как пользоваться</span><span>→</span></a>',
  ])}
  <section class="card"><div class="card-h"><h3>Оформление</h3></div>
    <div class="seg">${[['dark', '🌙 Тёмная'], ['light', '☀️ Светлая'], ['auto', '⚙️ Авто']].map(([k, l]) => `<button class="${theme === k ? 'on' : ''}" data-act="theme" data-v="${k}">${l}</button>`).join('')}</div>
  </section>
  <section class="card" id="push-box"><div class="card-h"><h3>🔔 Уведомления</h3></div><div class="muted small">Проверяю…</div></section>
  ${standalone ? '' : `<section class="card"><div class="card-h"><h3>📲 Установить на телефон</h3></div>
    ${S.installEvt ? '<button class="btn primary full" data-act="install">Установить приложение</button>' : ios
      ? '<p class="small">В Safari нажмите <b>«Поделиться»</b> <span class="kbd">⬆︎</span>, затем <b>«На экран „Домой“»</b>.</p>'
      : '<p class="small">Откройте меню браузера <span class="kbd">⋮</span> и выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.</p>'}</section>`}
  ${S.store.sandbox ? `<section class="card"><div class="card-h"><h3>🧪 Песочница</h3></div>
    <p class="muted small">Тестовая копия: ваш клуб и боты живут только на этом устройстве.</p>
    ${sandboxButtons()}
    <div class="row-btns"><button class="btn ghost" data-act="sb-reset">↺ Начать заново</button></div></section>`
  : S.store.mode === 'demo' ? `<section class="card"><div class="card-h"><h3>Демо-режим</h3></div>
    <p class="muted small">Сейчас вы вошли как демо-пользователь. Данные хранятся только в этом браузере.</p>
    <div class="row-btns"><button class="btn" data-act="logout">Сменить роль</button><button class="btn ghost" data-act="demo-reset">Сбросить демо-данные</button></div></section>` : ''}
  ${!isAdmin() ? '<button class="btn ghost full danger-text" data-act="leave-club">🚪 Покинуть клуб</button>' : ''}
  <button class="btn ghost full danger-text" data-act="logout">Выйти из аккаунта</button>
  <p class="muted small center ver">PongHub · v2.0</p>`;
}

// ───────────── Клубы ─────────────
const ROLE_LABEL = { owner: '👑 владелец', helper: '✍️ помощник', player: 'игрок' };
const clubPlace = c => [c.city, c.address].filter(Boolean).map(esc).join(' · ');
// в песочнице все ссылки и QR ведут только в песочницу: настоящая регистрация и настоящие клубы недоступны
const linkBase = () => `${location.origin}${location.pathname}${S.store?.sandbox && !SANDBOX_HOSTED ? '?sandbox=1' : ''}`;
const inviteLink = code => `${linkBase()}#/join/${code}`;
const appLink = () => S.store?.sandbox ? linkBase() : `${linkBase()}#/register`;
const KAZAN = [55.7963, 49.1088];

function loadScript(src) {
  return new Promise((res, rej) => {
    const ex = document.querySelector(`script[src="${src}"]`);
    if (ex) { if (ex.dataset.ok) res(); else ex.addEventListener('load', () => res()); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = () => { s.dataset.ok = '1'; res(); }; s.onerror = () => rej(new Error('Не удалось загрузить карту. Проверьте интернет'));
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}
// Карта: открытая карта OpenStreetMap (сервис OpenFreeMap, без ключей и лимитов), показ — MapLibre.
// Снаружи простой интерфейс: setView, pin, onClick, fit. Координаты — [широта, долгота].
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
async function maplibre() {
  loadCss('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css');
  await loadScript('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js');
  return window.maplibregl;
}
async function makeMap(el, center, zoom) {
  const ml = await maplibre();
  if (!el.isConnected) return null;
  const ll2 = ll => [+ll[1], +ll[0]];
  const map = new ml.Map({ container: el, style: MAP_STYLE, center: ll2(center), zoom, attributionControl: { compact: true }, cooperativeGestures: false });
  map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-left');
  // подпись карты — свёрнутым значком «i»
  map.once('load', () => el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
  // подписи на карте — по-русски, где есть русское название
  map.on('styledata', () => {
    for (const l of map.getStyle()?.layers || []) {
      if (l.type === 'symbol' && l.layout?.['text-field'] && !l._ru) {
        try { map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ru'], ['get', 'name']]); l._ru = 1; } catch { /* */ }
      }
    }
  });
  return {
    setView: (ll, z) => map.jumpTo({ center: ll2(ll), zoom: z ?? map.getZoom() }),
    pin(ll, o = {}) {
      const div = document.createElement('div');
      div.className = 'club-pin' + (o.mine ? ' mine' : '');
      div.innerHTML = '<span><i>🏓</i></span>';
      const m = new ml.Marker({ element: div, draggable: !!o.draggable, anchor: 'bottom' }).setLngLat(ll2(ll)).addTo(map);
      if (o.popup) m.setPopup(new ml.Popup({ offset: 30, closeButton: false }).setHTML(o.popup));
      if (o.onDrag) m.on('dragend', () => { const p = m.getLngLat(); o.onDrag([p.lat, p.lng]); });
      return { move: p => m.setLngLat(ll2(p)), open: () => { if (!m.getPopup()?.isOpen()) m.togglePopup(); } };
    },
    onClick: cb => map.on('click', e => cb([e.lngLat.lat, e.lngLat.lng])),
    fit: lls => { const b = new ml.LngLatBounds(); lls.forEach(ll => b.extend(ll2(ll))); map.fitBounds(b, { padding: 40, maxZoom: 14, duration: 0 }); },
  };
}

// Подсказки адреса — Photon (открытая база OpenStreetMap, бесплатно)
async function addrSuggest(q) {
  const res = await fetch(`https://photon.komoot.io/api/?limit=6&lat=${KAZAN[0]}&lon=${KAZAN[1]}&q=${encodeURIComponent(q)}`);
  const seen = new Set();
  return ((await res.json()).features || []).map(f => {
    const p = f.properties || {};
    const city = p.city || p.town || p.village || p.state || '';
    const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(', ') : (p.name || '');
    const place = p.street && p.name && p.osm_key !== 'building' && p.osm_key !== 'place' ? ` (${p.name})` : '';
    return { title: [street + place, city].filter(Boolean).join(' · '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], city, address: street };
  }).filter(x => x.title && !seen.has(x.title) && seen.add(x.title));
}
async function addrResolve(it) { return it; }

// каркас для экранов вне клуба (выбор клуба, карта, страница клуба, панель создателя)
function bare(body, back = S.club ? '#/home' : '') {
  return `<header class="top"><a href="${S.club ? '#/home' : '#/clubs'}" class="brand"><img src="${logo()}" alt="" width="30" height="30"><span>PongHub</span></a>
    <div class="top-actions">${S.store.mode === 'demo' ? `<span class="demo-pill">${S.store.sandbox ? 'ПЕСОЧНИЦА' : 'ДЕМО'}</span>` : ''}${back ? `<a href="${back}" class="btn ghost sm">← ${back === '#/home' ? 'В клуб' : 'Назад'}</a>` : ''}</div></header>
    <main class="page">${body}</main>`;
}

// пока создатель переносит клуб — для тех, кто был в PongHub до клубов
function waitView() {
  return `<div class="auth-wrap"><div class="auth-card center">
    <div class="gate-emoji">🔄</div><h2>PongHub обновляется</h2>
    <p class="muted">Теперь в приложении есть клубы. Ваш клуб уже переезжает: все матчи, рейтинг и пинг-коины сохранятся. Загляните через несколько минут.</p>
    <div class="row-btns"><button class="btn primary" data-act="refresh">Проверить снова</button><button class="btn ghost" data-act="logout">Выйти</button></div>
  </div></div>`;
}

function clubRow(c) {
  const cur = S.club?.id === c.id;
  return `<button class="club-row ${cur ? 'cur' : ''}" data-act="switch-club" data-id="${c.id}">
    <span class="club-ic">🏓</span><span class="club-txt"><b>${esc(c.name)}</b><small class="muted">${clubPlace(c) || esc(c.code)}</small></span>
    <span class="club-role">${cur ? '✓ ' : ''}${ROLE_LABEL[c.my_role] || ''}</span></button>`;
}

function viewClubs() {
  const my = S.ctx?.clubs || [];
  const active = my.filter(c => c.my_status === 'active'), pend = my.filter(c => c.my_status === 'pending');
  return bare(`<div class="page-h"><h1>${active.length ? 'Мои клубы' : 'Выберите клуб'}</h1></div>
    ${active.length ? '' : `<p class="muted">Привет, <b>${esc(S.ctx.me.nickname)}</b>! Вступите в клуб по приглашению, найдите свой клуб или создайте новый.</p>`}
    ${active.length ? `<section class="card club-list">${active.map(clubRow).join('')}</section>` : ''}
    ${pend.length ? `<section class="card"><div class="card-h"><h3>⏳ Заявки</h3></div>${pend.map(c => `<div class="req"><div class="rn"><b>${esc(c.name)}</b><small class="muted">Ждём решения клуба</small></div>
      <div class="req-btns"><button class="btn ghost sm" data-act="cancel-request" data-id="${c.id}">Отозвать</button></div></div>`).join('')}</section>` : ''}
    <form class="card stack" data-form="join-code"><div class="card-h"><h3>✉️&nbsp; У меня есть приглашение</h3></div>
      <label>Код приглашения<input name="code" required minlength="6" maxlength="20" placeholder="Например, K7Q2M9XA" autocapitalize="characters" autocomplete="off"></label>
      <button class="btn primary">Найти клуб</button></form>
    <section class="card"><div class="card-h"><h3>🔍&nbsp; Найти клуб</h3></div>
      <input type="search" data-input="dir-search" placeholder="Город, адрес, название или ID клуба" autocomplete="off">
      <div id="dir-box" class="dir-box"><div class="muted small">Загружаю…</div></div></section>
    <div class="row-btns"><a class="btn" href="#/map">🗺 Клубы на карте</a>${feature('newclub') ? '<a class="btn primary" href="#/newclub">＋ Создать клуб</a>' : ''}</div>
    ${feature('newclub') ? '' : '<p class="muted small center">Создание новых клубов пока закрыто. Вступайте в существующие — по приглашению или через поиск.</p>'}
    ${isFounder() ? '<a class="card menu-item" href="#/founder">🛡 <span>Платформа PongHub</span><span>→</span></a>' : ''}
    ${S.club ? '' : '<button class="btn ghost full danger-text" data-act="logout">Выйти из аккаунта</button>'}`);
}

function dirButton(c) {
  if (c.my_status === 'active') return `<button class="btn sm" data-act="switch-club" data-id="${c.id}">Открыть</button>`;
  if (c.my_status === 'pending') return '<span class="badge warn">заявка отправлена</span>';
  return `<button class="btn primary sm" data-act="request-join" data-id="${c.id}">Отправить заявку</button>`;
}
function dirItem(c) {
  return `<div class="dir-item"><a href="#/club/${c.id}" class="rn"><b>${esc(c.name)}</b><small class="muted">${clubPlace(c) || esc(c.code)} · ${c.players} ${plural(c.players, 'игрок', 'игрока', 'игроков')}</small></a>${dirButton(c)}</div>`;
}
let dirTimer;
async function renderDirectory(q = '') {
  const box = document.getElementById('dir-box');
  if (!box) return;
  // общий список клубов не показываем — только результаты поиска
  if (q.trim().length < 2) { box.innerHTML = '<div class="muted small">Введите город, адрес, название или ID клуба — или откройте карту.</div>'; return; }
  try {
    const rows = await S.store.directory(q);
    if (!box.isConnected) return;
    box.innerHTML = rows.length ? rows.slice(0, 30).map(dirItem).join('') : `<div class="empty small">${q ? 'Ничего не нашли. Проверьте название или попросите у клуба код приглашения' : 'Пока нет открытых клубов'}</div>`;
  } catch (e) { box.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
}

// ── создание и настройки клуба ──
function clubForm(c = {}, edit = false) {
  return `<label>Название клуба<input name="name" required minlength="2" maxlength="60" value="${esc(c.name || '')}" placeholder="Например, Коворкинг «Точка»"></label>
    <label>Адрес — начните вводить и выберите подсказку<input name="address" maxlength="100" value="${esc(c.address || '')}" placeholder="Например, Казань, Баумана 44" autocomplete="off" data-input="addr"></label>
    <div id="geo-res" class="geo-res"></div>
    <label>Город<input name="city" maxlength="40" value="${esc(c.city || '')}" placeholder="Заполнится сам по адресу"></label>
    <div><b class="small">Точка на карте — ставится по адресу, можно поправить нажатием</b>
      <div id="pick-map" class="club-map" data-lat="${c.lat ?? ''}" data-lng="${c.lng ?? ''}"></div>
      <small class="muted" id="pick-hint">${c.lat != null ? 'Точка выбрана. Можно передвинуть' : 'Точка не выбрана — клуб не появится на карте'}</small>
      <input type="hidden" name="lat" value="${c.lat ?? ''}"><input type="hidden" name="lng" value="${c.lng ?? ''}"></div>
    <label>Пара слов о клубе<textarea name="description" maxlength="300" rows="2" placeholder="Когда играете, как найти стол">${esc(c.description || '')}</textarea></label>
    <label class="switch"><input type="checkbox" name="visible" ${c.visible !== false ? 'checked' : ''}><i></i><span>Показывать клуб на карте и в поиске</span></label>
    <small class="muted">Если выключить — в клуб можно попасть только по приглашению.</small>
    <button class="btn primary big">${edit ? 'Сохранить' : 'Создать клуб'}</button>`;
}

function viewNewClub() {
  if (!feature('newclub')) return bare(`<div class="page-h"><h1>Новый клуб</h1></div>
    <section class="card stack center"><b>Создание новых клубов пока закрыто</b>
    <p class="muted small">Скоро откроем. А пока можно вступить в существующий клуб: по приглашению от друга или найти клуб рядом.</p>
    <a class="btn primary" href="#/clubs">Найти клуб</a></section>`, '#/clubs');
  return bare(`<div class="page-h"><h1>Новый клуб</h1></div>
    <p class="muted small">Создать клуб может любой — бесплатно. Вы станете его владельцем: принимаете участников, подтверждаете результаты, проводите турниры.</p>
    <form class="card stack" data-form="new-club">${clubForm()}</form>`, '#/clubs');
}

function viewClubEdit() {
  if (!isAdmin()) return '<div class="empty">Настройки клуба доступны только владельцу клуба</div>';
  const c = S.store.club || S.club;
  const others = S.data.profiles.filter(p => p.status === 'approved' && p.id !== S.me.id && !p.is_test).sort((a, b) => a.nickname.localeCompare(b.nickname));
  return `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div>
    <div class="page-h"><h1>Клуб</h1><span class="badge">${esc(c.code)}</span></div>
    <form class="card stack" data-form="club-edit">${clubForm(c, true)}</form>
    <section class="card stack"><div class="card-h"><h3>👑 Передать клуб</h3></div>
      <p class="muted small">Если вы уходите, передайте клуб другому участнику. Он получит все права, а вы станете помощником.</p>
      <label>Кому<select id="tr-to"><option value="">— выберите участника —</option>${others.map(p => `<option value="${p.id}">${esc(p.nickname)}</option>`).join('')}</select></label>
      <label>Для подтверждения введите название клуба<input id="tr-name" placeholder="${esc(c.name)}" autocomplete="off"></label>
      <button class="btn danger" data-act="transfer-club">Передать клуб</button></section>`;
}

async function mountPickMap() {
  const el = document.getElementById('pick-map');
  if (!el || el.dataset.ready) return;
  el.dataset.ready = '1';
  const lat = parseFloat(el.dataset.lat), lng = parseFloat(el.dataset.lng);
  const has = !Number.isNaN(lat) && !Number.isNaN(lng);
  let map;
  try { map = await makeMap(el, has ? [lat, lng] : KAZAN, has ? 16 : 11); } catch (e) { el.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; return; }
  if (!map) return;
  const form = el.closest('form');
  let marker = null;
  const set = ll => {
    if (!marker) marker = map.pin(ll, { mine: true, draggable: true, onDrag: set });
    else marker.move(ll);
    form.lat.value = (+ll[0]).toFixed(6); form.lng.value = (+ll[1]).toFixed(6);
    document.getElementById('pick-hint').textContent = 'Точка выбрана. Можно передвинуть';
  };
  if (has) set([lat, lng]);
  map.onClick(set);
  el._set = (ll, z) => { set(ll); map.setView(ll, z || 15.5); };
  if (!has && navigator.geolocation) navigator.geolocation.getCurrentPosition(p => { if (!form.lat.value) map.setView([p.coords.latitude, p.coords.longitude], 14); }, () => {}, { timeout: 5000 });
}

let addrTimer, addrItems = [];
function addrInput(inp) {
  clearTimeout(addrTimer);
  const box = document.getElementById('geo-res');
  const q = inp.value.trim();
  if (q.length < 3) { box.innerHTML = ''; return; }
  addrTimer = setTimeout(async () => {
    try {
      addrItems = await addrSuggest(q);
      if (inp.value.trim() !== q) return;
      box.innerHTML = addrItems.map((x, i) => `<button type="button" class="geo-item" data-act="addr-pick" data-i="${i}">📍 ${esc(x.title)}</button>`).join('');
    } catch { box.innerHTML = ''; }
  }, 350);
}
async function addrPick(i) {
  const box = document.getElementById('geo-res');
  const form = document.querySelector('[data-form=new-club], [data-form=club-edit]');
  try {
    const r = await addrResolve(addrItems[i]);
    if (r.address) form.address.value = r.address;
    if (r.city) form.city.value = r.city;
    document.getElementById('pick-map')?._set?.([r.lat, r.lng]);
    box.innerHTML = '';
  } catch (e) { toast(e.message, 'err'); }
}

// ── приглашение ──
function viewInvite(r) {
  const c = S.store.club || S.club;
  if (!isAdmin()) return `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div>
    <div class="page-h"><h1>Пригласить друга</h1></div>
    <p class="muted small">Друг наводит камеру на QR-код или открывает ссылку, регистрируется — и заявка в «${esc(c.name)}» уходит сама, никаких кодов. В клуб его примет владелец.</p>
    <section class="card stack" id="invite-box" data-mode="player"><div class="muted small">Загружаю приглашение…</div></section>`;
  return `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div>
    ${r.q.get('new') ? `<section class="hero table-card club-hero"><h2>Клуб создан 🎉</h2><p>${esc(c.name)}${c.city ? ' · ' + esc(c.city) : ''}</p></section>` : '<div class="page-h"><h1>Пригласить в клуб</h1></div>'}
    <p class="muted small">По ссылке или QR-коду «Вступить в клуб» человек регистрируется — и заявка в ваш клуб уходит сама, код вводить не нужно. В клуб он попадёт, когда вы её примете (вкладка «Заявки»). Код — для тех, кто уже скачал приложение.</p>
    ${S.store.sandbox ? `<section class="card sb-guide"><div class="card-h"><h3>🧪 Песочница</h3></div><p class="muted small">Это образец. В песочнице ссылка и QR ведут только в песочницу, а не в настоящее приложение: по ним нельзя ни зарегистрироваться, ни вступить в настоящий клуб. Отправьте приглашение ботам, и они пришлют заявки.</p><button class="btn primary full" data-act="sb-bots">🤖 Пригласить ботов</button></section>` : ''}
    <section class="card stack" id="invite-box"><div class="muted small">Загружаю приглашение…</div></section>
    <section class="card"><div class="card-h"><h3>ID клуба для поиска</h3><span class="badge">${esc(c.code)}</span></div>
      <p class="muted small">По этому ID клуб находят в поиске и подают заявку — её подтверждаете вы.</p></section>
    ${r.q.get('new') ? '<a class="btn primary full" href="#/home">Перейти в клуб →</a>' : ''}`;
}

async function renderInvite() {
  const box = document.getElementById('invite-box');
  if (!box) return;
  try {
    const code = await S.store.inviteCode(S.club.id);
    const link = inviteLink(code);
    box.dataset.link = link;
    if (box.dataset.mode === 'player') {
      box.innerHTML = `<div class="center"><b>🏓 QR: вступить в «${esc(S.club.name)}»</b><div id="qr" class="qr-box qr-big"></div><small class="muted">Покажите экран другу — пусть наведёт камеру</small></div>
        <div class="row-btns"><button class="btn primary" data-act="share-invite" data-link="${esc(link)}">📤 Отправить ссылку</button><button class="btn" data-act="copy" data-text="${esc(link)}">Скопировать</button><button class="btn" data-act="inv-qr" data-k="club" data-f="png">⬇️ QR картинкой</button></div>`;
      return drawQr(document.getElementById('qr'), link);
    }
    box.innerHTML = `<div><b class="small">Ссылка-приглашение</b><div class="copy-row"><span class="mono">${esc(link)}</span></div>
        <div class="row-btns"><button class="btn primary" data-act="share-invite" data-link="${esc(link)}">Поделиться</button><button class="btn" data-act="copy" data-text="${esc(link)}">Скопировать</button></div></div>
      <div><b class="small">Код приглашения</b><div class="invite-code">${esc(code)}</div></div>
      <div class="inv-qrs">
        <div class="inv-qr"><b>🏓 Вступить в клуб</b><small class="muted">${S.store.sandbox ? 'образец, ведёт только в песочницу' : `регистрация + заявка в «${esc(S.club.name)}»`}</small><div id="qr" class="qr-box"></div>
          <div class="row-btns"><button class="btn sm" data-act="inv-qr" data-k="club" data-f="svg">⬇️ SVG</button><button class="btn sm" data-act="inv-qr" data-k="club" data-f="png">⬇️ PNG</button></div></div>
        <div class="inv-qr"><b>📲 Только приложение</b><small class="muted">${S.store.sandbox ? 'образец, ведёт только в песочницу' : 'регистрация в PongHub, без клуба'}</small><div id="qr-app" class="qr-box"></div>
          <div class="row-btns"><button class="btn sm" data-act="inv-qr" data-k="app" data-f="svg">⬇️ SVG</button><button class="btn sm" data-act="inv-qr" data-k="app" data-f="png">⬇️ PNG</button></div></div>
      </div>
      <a class="btn full" href="#/print">🖨 Плакат и домики для столов</a>
      <button class="btn ghost sm" data-act="rotate-invite">Сменить ссылку и код</button>
      <small class="muted">Если код попал не туда — смените его. Старые ссылка, код и QR перестанут работать, участники клуба останутся.</small>`;
    await drawQr(document.getElementById('qr'), link);
    await drawQr(document.getElementById('qr-app'), appLink());
  } catch (e) { box.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
}


// ── карта клубов ──
function viewMap() {
  return bare(`<div class="page-h"><h1>Клубы на карте</h1><button class="btn ghost sm" data-act="map-locate">📍 Рядом</button></div>
    <input type="search" data-input="map-search" placeholder="Название, город или ID клуба" autocomplete="off">
    <div id="club-map" class="club-map big"></div>
    <section class="card" id="map-list"><div class="muted small">Загружаю клубы…</div></section>`, S.club ? '#/home' : '#/clubs');
}
let mapState = null;
async function renderMap() {
  const el = document.getElementById('club-map');
  if (!el || el.dataset.ready) return;
  el.dataset.ready = '1';
  let rows = [];
  try { rows = await S.store.directory(''); } catch (e) { document.getElementById('map-list').innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
  const geo = rows.filter(c => c.lat != null && c.lng != null);
  let map;
  try { map = await makeMap(el, geo.length ? [geo[0].lat, geo[0].lng] : KAZAN, 11); } catch (e) { el.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
  mapState = { rows, map, markers: new Map() };
  if (map) {
    for (const c of geo) {
      const m = map.pin([c.lat, c.lng], { mine: c.my_status === 'active', popup: `<b>${esc(c.name)}</b><br>${c.players} ${plural(c.players, 'игрок', 'игрока', 'игроков')} · ${c.matches} ${plural(c.matches, 'матч', 'матча', 'матчей')}<br><a href="#/club/${c.id}">Открыть страницу клуба →</a>` });
      mapState.markers.set(c.id, m);
    }
    if (geo.length > 1) map.fit(geo.map(c => [c.lat, c.lng]));
  }
  renderMapList('');
}
function renderMapList(q) {
  const box = document.getElementById('map-list');
  if (!box || !mapState) return;
  const t = q.trim().toLowerCase();
  const rows = mapState.rows.filter(c => !t || c.name.toLowerCase().includes(t) || (c.city || '').toLowerCase().includes(t) || (c.address || '').toLowerCase().includes(t) || c.code.toLowerCase() === t || c.code.toLowerCase() === 'ph-' + t);
  box.innerHTML = rows.length ? rows.map(dirItem).join('') : '<div class="empty small">Клубов не найдено</div>';
  if (t && rows.length && mapState.map) {
    const g = rows.filter(c => c.lat != null);
    if (g.length === 1) { mapState.map.setView([g[0].lat, g[0].lng], 15); mapState.markers.get(g[0].id)?.open(); }
    else if (g.length > 1) mapState.map.fit(g.map(c => [c.lat, c.lng]));
  }
}

// ── страница клуба (для всех вошедших; без почты и личных данных) ──
function viewClubPage(r) {
  return bare(`<div id="club-page"><div class="empty">Загружаю клуб…</div></div>`, S.club ? '#/home' : '#/map');
}
async function renderClubPage(id, code = null, auto = false, table = null, tour = false) {
  const box = document.getElementById('club-page');
  if (!box) return;
  let d;
  try { d = await S.store.clubPublic(id, code); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!box.isConnected) return;
  // пришли по QR (плакат, приглашение, стол) — заявка уходит сама, один раз
  if (auto && (!d.my_status || d.my_status === 'former') && !(S.autoJoined ||= new Set()).has(id)) {
    S.autoJoined.add(id);
    try { await S.store.requestJoin(id, code || null); S.ctx = await S.store.loadContext(); toast('Заявка отправлена — клуб рассмотрит её'); }
    catch (e) { toast(e.message, 'err'); }
    return renderClubPage(id, code, false, table, tour);
  }
  const st = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  const pool = d.players.filter(p => ['approved', 'archived', 'deleted'].includes(p.status));
  const A = analyze(pool, d.matches, st);
  const rank = ranking(A, d.players).filter(x => x.g > 0);
  const c = d.club;
  const cd = new Date(c.created_at);
  const since = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][cd.getMonth()] + ' ' + cd.getFullYear();
  const active = d.players.filter(p => p.status === 'approved').length;
  const btn = d.my_status === 'active' ? `<button class="btn primary big full" data-act="switch-club" data-id="${c.id}">Открыть клуб</button>`
    : d.my_status === 'pending' ? `<div class="card row-btns"><span>⏳ Заявка отправлена</span><button class="btn ghost sm" data-act="cancel-request" data-id="${c.id}">Отозвать</button></div>
      <p class="muted small center">${table ? `Как только владелец примет заявку, снова наведите камеру на QR-код стола ${esc(table)} — и сразу к игре.` : tour ? 'Как только владелец примет заявку, снова наведите камеру на QR-код турнира — и запишитесь.' : 'Как только владелец примет заявку, клуб откроется — мы пришлём уведомление.'}</p>`
    : `${code ? '<p class="muted small center">✉️ Вас пригласили в этот клуб. Отправьте заявку — в клуб вы попадёте, когда её примут.</p>' : ''}<button class="btn primary big full" data-act="request-join" data-id="${c.id}" data-code="${esc(code || '')}">Отправить заявку</button>`;
  const fin = d.tournaments.filter(t => t.status === 'finished' && t.results?.gold).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const nick = pid => d.players.find(p => p.id === pid)?.nickname || 'Игрок';
  box.innerHTML = `<section class="hero table-card club-hero"><h2>${esc(c.name)}</h2><p>${clubPlace(c)}</p>
      <p class="small">${active} ${plural(active, 'игрок', 'игрока', 'игроков')} · ${d.matches.length} ${plural(d.matches.length, 'матч', 'матча', 'матчей')} · с ${since}</p>
      <span class="badge">${esc(c.code)}</span></section>
    ${c.description ? `<p>${esc(c.description)}</p>` : ''}
    ${btn}
    <section class="card"><div class="card-h"><h3>Рейтинг клуба</h3></div>
      ${rank.length ? rank.slice(0, 30).map((x, i) => `<div class="rk-row"><b class="rk-pos">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</b>${ava(x.p, 'sm')}<span class="rn"><b>${esc(x.p.nickname)}</b><small class="muted">${x.g} ${plural(x.g, 'игра', 'игры', 'игр')}</small></span><b class="pl-r">${fmtR(x.r)}</b></div>`).join('') : '<div class="empty small">Матчей пока нет</div>'}</section>
    ${fin.length ? `<section class="card"><div class="card-h"><h3>Турниры</h3></div>${fin.slice(0, 10).map(t => `<div class="req"><div class="rn"><b>${esc(t.name)}</b><small class="muted">🥇 ${esc(nick(t.results.gold))}${t.results.silver ? ' · 🥈 ' + esc(nick(t.results.silver)) : ''}${t.date ? ' · ' + fmtDate(t.date) : ''}</small></div></div>`).join('')}</section>` : ''}
    ${c.lat != null ? `<div id="club-mini-map" class="club-map" data-lat="${c.lat}" data-lng="${c.lng}"></div>` : ''}`;
  const mm = document.getElementById('club-mini-map');
  if (mm) { try { const map = await makeMap(mm, [c.lat, c.lng], 15); map?.pin([c.lat, c.lng]); } catch { mm.remove(); } }
}

// ── вход по ссылке-приглашению ──
function viewJoin() {
  return `<div class="auth-wrap"><div class="auth-card center"><div class="gate-emoji">✉️</div><h2>Ищем клуб…</h2><div class="spin big"></div></div></div>`;
}
// ссылка / код / QR только находят клуб — заявку человек отправляет сам
async function openInvite(code) {
  try {
    const cid = await S.store.clubByInvite(code);
    location.replace(`#/club/${cid}?code=${encodeURIComponent(code)}&auto=1`);
  } catch (e) { toast(e.message, 'err'); location.replace(S.club ? '#/home' : '#/clubs'); }
}

// ── панель создателя PongHub ──
function viewFounder() {
  if (!isFounder()) return bare('<div class="empty">Раздел только для создателя PongHub</div>');
  return bare(`<div class="page-h"><h1>Платформа PongHub</h1></div><div id="founder-box"><div class="empty">Загружаю…</div></div>`);
}
async function renderFounder() {
  const box = document.getElementById('founder-box');
  if (!box) return;
  try {
    const [st, clubs, un] = await Promise.all([S.store.founderStats(), S.store.founderClubs(), S.store.founderUnassigned()]);
    if (!box.isConnected) return;
    const opts = clubs.filter(c => !c.blocked).map(c => `<option value="${c.id}" ${S.club?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const legacyRows = st.legacy_rows > 0 && !st.migration_done;
    box.innerHTML = `<div class="stat-tiles">${[[st.clubs, plural(st.clubs, 'клуб', 'клуба', 'клубов')], [st.users, plural(st.users, 'игрок', 'игрока', 'игроков')], [st.matches, plural(st.matches, 'матч', 'матча', 'матчей')]].map(([v, l]) => `<div class="card tile"><b>${v}</b><small class="muted">${l}</small></div>`).join('')}</div>
      ${!clubs.length ? `<section class="card stack step-card"><div class="card-h"><h3>Шаг 1. Создайте клуб</h3></div><p class="muted small">Сначала создайте клуб коворкинга — вы станете его владельцем. Потом вернитесь сюда, чтобы добавить ребят и перенести историю.</p><a class="btn primary" href="#/newclub">＋ Создать клуб</a></section>` : ''}
      ${clubs.length && un.length ? `<section class="card stack step-card"><div class="card-h"><h3>Участники без клуба · ${un.length}</h3></div>
        <p class="muted small">Отметьте, кого добавить. Роль помощника и стартовый рейтинг перенесутся. Тем, кто был заявкой и ещё не принят, галочка не стоит.</p>
        <label class="switch"><input type="checkbox" data-act-change="founder-all"><i></i><span>Отметить всех</span></label>
        <div class="un-list">${un.map(p => `<label class="un-row"><input type="checkbox" class="un-cb" value="${p.id}" ${p.legacy && p.old_status !== 'pending' ? 'checked' : ''}>${ava(p, 'sm')}<span class="rn"><b>${esc(p.nickname)}</b><small class="muted">${esc(p.full_name || '')}${p.old_role === 'editor' ? ' · помощник' : ''}${p.old_status === 'archived' ? ' · в архиве' : ''}${p.old_status === 'pending' ? ' · была заявка' : ''}${p.legacy ? '' : ' · новый'}</small></span></label>`).join('')}</div>
        <label>В какой клуб<select id="un-club">${opts}</select></label>
        <button class="btn primary" data-act="founder-add">Добавить отмеченных в клуб</button></section>` : ''}
      ${clubs.length && legacyRows ? `<section class="card stack step-card"><div class="card-h"><h3>Перенести историю коворкинга</h3></div>
        <p class="muted small">Все матчи, турниры, календарь, прогнозы, пинг-коины, журнал и настройки рейтинга, что были до клубов, перейдут в выбранный клуб. Это делается один раз. У ребят сохранятся рейтинг, места и коины.</p>
        <label>В какой клуб<select id="hist-club">${opts}</select></label>
        <button class="btn primary" data-act="founder-history">Перенести всю историю в этот клуб</button></section>` : ''}
      ${!st.migration_done && !legacyRows && clubs.length ? '<section class="card"><p class="muted small">Истории до клубов нет — переносить нечего.</p></section>' : ''}
      <section class="card stack"><div class="card-h"><h3>🎁 Подарки</h3></div>
        <p class="muted small">Эксклюзивные ракетки: их нет в магазине и их нельзя заработать. Выберите ракетку и игрока — ему придёт уведомление с этой ракеткой. Забрать подарок обратно тоже можно.</p>
        <button class="btn primary" data-act="gift-open">Подарить ракетку</button></section>
      <section class="card stack"><div class="card-h"><h3>🚀 Обновления</h3></div>
        <p class="muted small">Новые функции сначала видны только вам и тестировщикам, которых вы выберете. Проверьте их — и включите для всех.</p>
        ${[['shop', '🛍️ Магазин и новая экономика', 'Магазин, моя ракетка, бонус дня, +15 за матч, призы турниров, награды за лиги. При включении для всех: балансы × 0,3, старт 300 PC, ставка до 300, еженедельные +100 отменяются.'],
           ['resale', '♻️ Продажа вещей', 'Купленное в магазине можно продать обратно за 30% от цены покупки. Стартовое основание и награды не продаются.'],
           ['newclub', '🏗️ Создание новых клубов', 'Кнопка «Создать клуб» есть у вас и у тестировщиков. У остальных её нет: они могут вступать в существующие клубы. Откройте для всех, когда будете готовы, и закройте обратно в любой момент. Уже созданные клубы не затрагиваются.'],
           ['avatar', '🧍 3D-игрок', 'Свой 3D-игрок: парень или девушка, форма из магазина, ракетка в руке, жесты. Виден в профиле. Хват ракетки настраивается в редакторе ниже.']].map(([k, t, d]) => {
          const mode = S.ctx?.platform?.features?.[k] ?? 'all';
          return `<div class="pl-row"><div class="pl-top"><span class="rn"><b>${t}</b><small class="muted">${d}</small></span></div>
            <div class="pl-ctl"><span class="badge ${mode === 'all' ? 'ok' : 'warn'}">${mode === 'all' ? 'включено у всех' : 'у вас и тестировщиков'}</span>
            ${mode === 'all' ? (k === 'newclub' ? `<button class="btn sm danger ghost" data-act="feature-close" data-k="${k}">Закрыть для всех</button>` : '') : `<button class="btn sm ghost" data-act="feature-testers" data-k="${k}">👥 Тестировщики</button><button class="btn sm primary" data-act="feature-all" data-k="${k}">${k === 'newclub' ? 'Открыть для всех' : 'Включить для всех'}</button>`}${k === 'shop' ? `<button class="btn sm ghost" data-act="announce-coll">📣 Уведомить о коллекции</button>` : ''}</div></div>`;
        }).join('')}
        <div class="pl-row"><div class="pl-top"><span class="rn"><b>✋ Хват ракетки у 3D-игрока</b><small class="muted">Редактор: как игрок держит ракетку — у всех игроков сразу. Работает с телефона и компьютера.</small></span></div>
          <div class="pl-ctl"><a class="btn sm ghost" href="#/player/grip">Открыть редактор</a></div></div></section>
      <section class="card"><div class="card-h"><h3>Все клубы</h3></div>
        ${clubs.map(c => `<div class="pl-row ${c.blocked ? 'arch' : ''}"><div class="pl-top"><span class="rn"><b>${esc(c.name)}</b><small class="muted">${esc(c.code)} · ${esc(c.city || 'город не указан')} · владелец ${esc(c.owner_nick || '—')}</small>
          <small class="muted">${c.players} ${plural(c.players, 'игрок', 'игрока', 'игроков')} · ${c.matches} ${plural(c.matches, 'матч', 'матча', 'матчей')}${c.pending ? ` · заявок: ${c.pending}` : ''}${c.last_match ? ' · последний матч ' + fmtDate(c.last_match) : ''}${c.visible ? '' : ' · скрыт с карты'}</small></span></div>
          <div class="pl-ctl"><a class="btn xs ghost" href="#/club/${c.id}">Страница</a><button class="btn xs ghost" data-act="founder-block" data-id="${c.id}" data-v="${c.blocked ? '0' : '1'}">${c.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
          <button class="btn xs ghost danger" data-act="founder-delete" data-id="${c.id}" data-name="${esc(c.name)}">Удалить</button></div></div>`).join('') || '<div class="empty small">Клубов пока нет</div>'}</section>`;
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// меню клубов из шапки
function openClubMenu() {
  const my = S.ctx?.clubs || [];
  const active = my.filter(c => c.my_status === 'active'), pend = my.filter(c => c.my_status === 'pending');
  openModal(`<h3>Мои клубы</h3><div class="club-list">${active.map(clubRow).join('')}</div>
    ${pend.length ? `<p class="muted small">⏳ Ждут решения: ${pend.map(c => esc(c.name)).join(', ')}</p>` : ''}
    <div class="menu">
      <a class="menu-item" href="#/invite">✉️ <span>${isAdmin() ? 'Пригласить в клуб' : 'Пригласить друга в клуб'}</span></a>
      <a class="menu-item" href="#/clubs">🔍 <span>Вступить или найти клуб</span></a>
      ${feature('newclub') ? '<a class="menu-item" href="#/newclub">＋ <span>Создать клуб</span></a>' : ''}
      <a class="menu-item" href="#/map">🗺 <span>Клубы на карте</span></a>
      ${isFounder() ? '<a class="menu-item" href="#/founder">🛡 <span>Платформа PongHub</span></a>' : ''}
    </div>`);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
  catch { window.prompt('Скопируйте:', text); }
}

// ── вход и привязка через Telegram ──
const TG_ICON = '<svg class="ic tg-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2 1.8 11.7c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3z"/></svg>';
let tgTimer = null;
async function tgFlow(purpose) {
  let st;
  try { st = await S.store.tgStart(purpose); } catch (e) { toast(e.message, 'err'); return; }
  const link = purpose === 'link';
  openModal(`<div class="tg-flow center">
      <div class="gate-emoji">✈️</div><h3>${link ? 'Привязать Telegram' : 'Вход через Telegram'}</h3>
      <ol class="tg-steps"><li>Нажмите кнопку — откроется бот <b>@${esc(st.bot)}</b></li><li>В Telegram нажмите <b>«Старт»</b>, затем <b>«${link ? 'Да, привязать' : 'Да, войти'}»</b></li><li>Вернитесь сюда — ${link ? 'Telegram привяжется' : 'вход выполнится'} сам</li></ol>
      <a class="btn tg-btn big full" href="${esc(st.url)}" target="_blank" rel="noopener">${TG_ICON} Открыть Telegram</a>
      <p class="muted small" id="tg-status"><span class="spin"></span> Ждём подтверждения в Telegram…</p>
    </div>`);
  const stop = () => { clearInterval(tgTimer); tgTimer = null; document.removeEventListener('visibilitychange', check); };
  let busyPoll = false;
  async function check() {
    if (busyPoll || document.hidden) return;
    if (!$modal.classList.contains('open') || !document.getElementById('tg-status')) return stop();
    busyPoll = true;
    try {
      const r = await S.store.tgPoll(st.token);
      const box = document.getElementById('tg-status');
      if (r.status === 'ok') { stop(); box.textContent = 'Входим…'; await S.store.tgSignIn(r.token_hash); closeModal(); toast('Вы вошли через Telegram ✈️'); }
      else if (r.status === 'linked') { stop(); closeModal(); await refresh(); toast('Telegram привязан ✈️'); }
      else if (['expired', 'missing', 'used'].includes(r.status)) { stop(); box.textContent = 'Время вышло. Закройте окно и попробуйте снова.'; }
      else if (r.status === 'failed') { stop(); box.textContent = r.error || 'Не получилось. Попробуйте снова.'; }
    } catch (e) { /* связь пропала — попробуем ещё раз */ } finally { busyPoll = false; }
  }
  clearInterval(tgTimer);
  tgTimer = setInterval(check, 2000);
  document.addEventListener('visibilitychange', check);
}

// ── табло клуба ──
const TV_THEMES = [['night', 'Ночь'], ['table', 'Стол'], ['red', 'Бордо'], ['green', 'Корт'], ['graphite', 'Графит'], ['light', 'Светлый']];
async function renderScreens() {
  const box = document.getElementById('screens-box');
  if (!box) return;
  try {
    const list = await S.store.listScreens(S.club.id);
    if (!box.isConnected) return;
    const fr = list.map(s => s.frozen_until).filter(x => x && Date.parse(x) > Date.now()).sort().pop();
    const freezeBox = list.length ? `<div class="tv-freeze ${fr ? 'on' : ''}"><div><b>${fr ? '⏸ Стоп-кадр включён' : '📺 Стоп-кадр табло'}</b><small class="muted">${fr ? `табло ничего не меняет на экране · ещё <span data-until="${esc(fr)}">${pauseLeft({ paused_until: fr })}</span>` : 'табло замрёт на текущей картинке — ничего не переключит и не обновит'}</small></div>
      ${fr ? '<button class="btn primary" data-act="screen-freeze" data-m="0">▶ Продолжить показ</button>' : '<div class="row-btns"><button class="btn sm" data-act="screen-freeze" data-m="5">5 мин</button><button class="btn sm" data-act="screen-freeze" data-m="15">15 мин</button><button class="btn sm" data-act="screen-freeze" data-m="60">1 час</button></div>'}</div>
      <a href="#/print" class="btn ghost full">🖨 Плакат и домики с QR для столов</a>` : '';
    box.innerHTML = freezeBox + `<div class="card-h"><h3>Подключённые табло</h3></div>` + (list.length ? list.map(s => {
      const online = s.last_seen && Date.now() - Date.parse(s.last_seen) < 3 * 60e3;
      return `<div class="pl-row"><div class="pl-top"><span class="tv-ic">📺</span><span class="rn"><b>${esc(s.name)}</b><small class="muted">${online ? '🟢 в сети' : s.last_seen ? '⚪ не в сети · был ' + fmtDT(s.last_seen) : '⚪ ещё не выходило в сеть'}</small></span></div>
        <div class="pl-ctl"><label class="init">Фон<select data-act-change="screen-theme" data-id="${s.id}">${TV_THEMES.map(([k, l]) => `<option value="${k}" ${s.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <button class="btn xs ghost danger" data-act="screen-remove" data-id="${s.id}">Отключить</button></div></div>`;
    }).join('') : '<div class="empty small">Пока нет подключённых табло</div>');
  } catch (e) { box.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; }
}

const CLUB_FREE = { clubs: viewClubs, club: viewClubPage, map: viewMap, newclub: viewNewClub, join: viewJoin, founder: viewFounder };

const CLUB_ACT = {
  'av-play': el => AV?.ctl?.play(el.dataset.v),
  'av-tool': el => { const v = el.dataset.v; if (v === 'big') { AV.big = !AV.big; document.getElementById('av-stage')?.classList.toggle('big', AV.big); document.body.classList.toggle('av-big', AV.big); setTimeout(() => AV.ctl?.resize(), 50); return; } AV?.ctl?.[v]?.(); },
  'av-gender': async el => { await busy(el, async () => { await S.store.rpc('set_avatar3d', { p: el.dataset.v }); S.ctx.me.avatar3d = el.dataset.v; }); render(); },
  'av-selfie': () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'user');
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const btn = document.querySelector('[data-act="av-selfie"]'), stage = document.getElementById('av-stage');
      stage?.classList.add('av-busy'); toast('Нейросеть рисует лицо… это 10–30 секунд');
      try {
        await busy(btn, async () => {
          const img = await createImageBitmap(f), k = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const { faceBase } = await import('./player3d.js');
          const base = await faceBase(S.ctx.me.avatar3d || 'boy');
          const r = await S.store.faceCall({ selfie: c.toDataURL('image/jpeg', .88), base });
          S.ctx.me.face = r.face; AV?.ctl?.setFace(r.face); AV?.ctl?.face();
          toast(`Готово! Осталось попыток сегодня: ${r.left}`);
        });
      } finally { stage?.classList.remove('av-busy'); render(); }
    };
    inp.click();
  },
  'av-noface': async el => { await busy(el, async () => { await S.store.faceCall({ reset: true }); S.ctx.me.face = null; AV?.ctl?.setFace(null); }); render(); },
  'av-wear': async el => { await busy(el, async () => { await S.store.equipItem(el.dataset.slot, el.dataset.k || null); await ensureShop(true); }); AV?.ctl?.look(S.shop?.loadout); render(); },
  'feature-testers': async el => {
    const k = el.dataset.k, title = { shop: 'Магазин', resale: 'Продажа вещей', avatar: '3D-игрок', newclub: 'Создание клубов' }[k] || k;
    let found = [], testers = [];
    const row = (u, on) => `<div class="pl-row"><div class="pl-top"><span class="rn"><b>${esc(u.nickname)}</b><small class="muted">${esc(u.full_name || '')}${u.clubs ? ' · ' + esc(u.clubs) : ''}</small></span></div>
      <div class="pl-ctl"><button class="btn xs ${on ? 'ghost' : 'primary'}" data-ts="${u.id}" data-on="${on ? 0 : 1}">${on ? 'Убрать' : 'Дать доступ'}</button></div></div>`;
    async function load() {
      testers = await S.store.rpc('founder_feature_testers', { fname: k }) || [];
      const box = document.getElementById('ts-list'); if (!box) return;
      box.innerHTML = testers.length ? testers.map(u => row(u, true)).join('') : '<p class="muted small">Пока никого — найдите игроков ниже.</p>';
      bind(box); drawFound();
    }
    function drawFound() { const box = document.getElementById('ts-found'); if (!box) return; const ids = new Set(testers.map(t => t.id)); box.innerHTML = found.filter(u => !ids.has(u.id)).map(u => row(u, false)).join(''); bind(box); }
    async function search(q) { found = await S.store.rpc('founder_search_users', { q }) || []; drawFound(); }
    function bind(box) { box.querySelectorAll('[data-ts]').forEach(b => b.onclick = () => busy(b, async () => { await S.store.rpc('founder_set_tester', { fname: k, uid: b.dataset.ts, on_: b.dataset.on === '1' }); await load(); toast(b.dataset.on === '1' ? 'Доступ выдан' : 'Доступ убран'); })); }
    openModal(`<div class="stack"><h3>👥 Тестировщики: ${esc(title)}</h3>
      <p class="muted small">Игроки, которым нововведение откроется раньше всех. Поиск — по всем зарегистрированным, из любого клуба.</p>
      <div id="ts-list" class="stack"></div>
      <label>Найти игрока<input id="ts-q" placeholder="Ник или имя" autocomplete="off"></label>
      <div id="ts-found" class="stack"></div></div>`, () => { load(); search(''); });
    setTimeout(() => { const q = document.getElementById('ts-q'); if (q) { let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => search(q.value.trim()), 250); }; } }, 50);
  },
  'gift-open': async () => {
    await loadThree().catch(() => {});
    const gifts = ITEMS.filter(i => i.gift); let cur = gifts[0].id, found = [], owners = [];
    const item = () => byId(cur);
    const row = (u, has) => `<div class="pl-row"><div class="pl-top"><span class="rn"><b>${esc(u.nickname)}</b><small class="muted">${esc(u.full_name || '')}${u.clubs ? ' · ' + esc(u.clubs) : ''}</small></span></div>
      <div class="pl-ctl"><button class="btn xs ${has ? 'ghost' : 'primary'}" data-gf="${u.id}" data-has="${has ? 1 : 0}">${has ? 'Забрать' : 'Подарить'}</button></div></div>`;
    function drawPick() {
      const box = document.getElementById('gf-pick'); if (!box) return; box.innerHTML = '';
      for (const g of gifts) { const b = document.createElement('button'); b.type = 'button'; b.className = 'gf-opt' + (g.id === cur ? ' on' : ''); b.append(thumbEl(g, 'FL', true)); b.insertAdjacentHTML('beforeend', `<b>${esc(g.name)}</b>`); b.onclick = () => { cur = g.id; drawPick(); loadOwners(); }; box.appendChild(b); }
    }
    function bind(box) { box.querySelectorAll('[data-gf]').forEach(b => b.onclick = () => busy(b, async () => {
      const has = b.dataset.has === '1';
      if (has) { if (!(await confirmDialog(`Забрать «${item().name}»? Если она надета, у игрока вернётся стартовое основание.`, 'Забрать', true))) return; await S.store.rpc('founder_revoke_gift', { uid: b.dataset.gf, item: cur }); }
      else await S.store.rpc('founder_gift_item', { uid: b.dataset.gf, item: cur });
      await loadOwners(); toast(has ? 'Подарок забран' : `Отправлено: ${item().name} 🎁`);
    })); }
    async function loadOwners() {
      owners = await S.store.rpc('founder_gift_owners', { item: cur }) || [];
      const box = document.getElementById('gf-owners'); if (!box) return;
      box.innerHTML = owners.length ? `<div class="gf-h">Уже подарено · ${owners.length}</div>` + owners.map(u => row(u, true)).join('') : '<p class="muted small">Эту ракетку пока никому не дарили.</p>';
      bind(box); drawFound();
    }
    function drawFound() { const box = document.getElementById('gf-found'); if (!box) return; const ids = new Set(owners.map(o => o.id)); box.innerHTML = found.filter(u => !ids.has(u.id)).map(u => row(u, false)).join(''); bind(box); }
    async function search(q) { found = await S.store.rpc('founder_search_users', { q }) || []; drawFound(); }
    openModal(`<div class="stack"><h3>🎁 Подарить ракетку</h3>
      <p class="muted small">1. Выберите ракетку. 2. Найдите игрока и нажмите «Подарить» — ему придёт уведомление именно с этой ракеткой.</p>
      <div class="gf-pick" id="gf-pick"></div><div id="gf-owners" class="stack"></div>
      <label>Найти игрока<input id="gf-q" placeholder="Ник или имя" autocomplete="off"></label><div id="gf-found" class="stack"></div></div>`, () => { drawPick(); loadOwners(); search(''); });
    setTimeout(() => { const q = document.getElementById('gf-q'); if (q) { let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => search(q.value.trim()), 250); }; } }, 50);
  },
  'feature-all': async el => {
    const k = el.dataset.k;
    const warn = k === 'newclub' ? 'Открыть создание клубов для всех? Любой зарегистрированный человек сможет создать свой клуб. Закрыть обратно можно в любой момент.' : k === 'shop' ? 'Включить магазин и новую экономику для всех? Балансы всех игроков пересчитаются × 0,3, стартовый баланс станет 300 PC. Отменить пересчёт нельзя.' : 'Включить для всех?';
    if (!(await confirmDialog(warn, 'Включить для всех'))) return;
    await busy(el, async () => { await S.store.rpc('founder_set_feature', { fname: k, mode: 'all' }); await reload(); render(); toast('Включено для всех 🚀'); });
  },
  'feature-close': async el => {
    if (!(await confirmDialog('Закрыть создание клубов для всех, кроме вас и тестировщиков? Уже созданные клубы останутся.', 'Закрыть', true))) return;
    await busy(el, async () => { await S.store.rpc('founder_set_feature', { fname: el.dataset.k, mode: 'founder' }); await reload(); render(); toast('Закрыто. Доступ только у вас и тестировщиков'); });
  },
  'screen-remove': async el => {
    if (!(await confirmDialog('Отключить это табло? Чтобы вернуть, понадобится новый код с телевизора.', 'Отключить', true))) return;
    await busy(el, async () => { await S.store.rpc('screen_remove', { sid: el.dataset.id }); await renderScreens(); toast('Табло отключено'); });
  },
  'tg-login': () => tgFlow('login'),
  'tg-link': () => tgFlow('link'),
  'tg-unlink': async el => {
    if (!(await confirmDialog('Отвязать Telegram? Входить можно будет только по почте и паролю.', 'Отвязать'))) return;
    await busy(el, async () => { await S.store.tgUnlink(); await refresh(); toast('Telegram отвязан'); });
  },
  'club-menu': () => openClubMenu(),
  'switch-club': el => switchClub(el.dataset.id),
  'request-join': el => busy(el, async () => { await S.store.requestJoin(el.dataset.id, el.dataset.code || null); S.ctx = await S.store.loadContext(); toast('Заявка отправлена — клуб рассмотрит её'); render(); }),
  'cancel-request': el => busy(el, async () => { await S.store.cancelRequest(el.dataset.id); S.ctx = await S.store.loadContext(); toast('Заявка отозвана'); render(); }),
  'leave-club': async () => {
    if (!(await confirmDialog(`Покинуть клуб «${settings().clubName}»? Ваши матчи останутся в истории клуба. Вернуться можно по приглашению.`, 'Покинуть', true))) return;
    await busy(null, async () => { await S.store.leaveClub(S.club.id); lsSet('ponghub_club', ''); await reload(); location.hash = '#/clubs'; render(); toast('Вы покинули клуб'); });
  },
  copy: el => copyText(el.dataset.text),
  'share-invite': async el => {
    const link = el.dataset.link, name = settings().clubName;
    if (navigator.share) { try { await navigator.share({ title: name, text: `Вступай в клуб «${name}» в PongHub 🏓`, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copyText(link);
  },
  'rotate-invite': async el => {
    if (!(await confirmDialog('Сменить ссылку и код? Старые ссылка, код и QR перестанут работать — и на распечатанных плакатах и домиках тоже (их надо будет напечатать заново).', 'Сменить'))) return;
    await busy(el, async () => { await S.store.rotateInvite(S.club.id); S.printCode = null; await renderInvite(); toast('Новая ссылка готова'); });
  },
  'inv-qr': el => busy(el, async () => {
    const club = el.dataset.k === 'club', link = club ? document.getElementById('invite-box').dataset.link : appLink();
    await saveQr(await makeQr(link), club ? `qr-vstupit-${qrName(S.club.name)}` : 'qr-ponghub', el.dataset.f);
  }),
  'print-sheets': el => busy(el, () => printSheets(el.dataset.what)),
  'transfer-club': async el => {
    const to = document.getElementById('tr-to').value, name = document.getElementById('tr-name').value.trim();
    const c = S.store.club || S.club;
    if (!to) return toast('Выберите, кому передать клуб', 'err');
    if (name !== c.name) return toast('Название клуба введено неверно', 'err');
    if (!(await confirmDialog(`Передать клуб «${c.name}» игроку ${P(to).nickname}? Вы станете помощником.`, 'Передать', true))) return;
    await busy(el, async () => { await S.store.transferClub(c.id, to); await reload(); location.hash = '#/home'; render(); toast('Клуб передан'); });
  },
  'addr-pick': el => addrPick(+el.dataset.i),
  'map-locate': () => {
    if (!navigator.geolocation || !mapState?.map) return toast('Не удалось определить местоположение', 'err');
    navigator.geolocation.getCurrentPosition(p => mapState.map.setView([p.coords.latitude, p.coords.longitude], 13), () => toast('Разрешите доступ к геолокации', 'err'), { timeout: 8000 });
  },
  'founder-add': el => busy(el, async () => {
    const ids = [...document.querySelectorAll('.un-cb:checked')].map(x => x.value);
    const cid = document.getElementById('un-club').value;
    if (!ids.length) throw new Error('Отметьте хотя бы одного человека');
    const n = await S.store.founderAddMembers(cid, ids);
    await reload(); render(); toast(`Добавлено в клуб: ${n}`);
  }),
  'founder-history': async el => {
    const sel = document.getElementById('hist-club');
    if (!(await confirmDialog(`Перенести всю историю (матчи, турниры, рейтинг, пинг-коины) в клуб «${sel.selectedOptions[0].textContent}»? Это делается один раз.`, 'Перенести'))) return;
    await busy(el, async () => { const r = await S.store.founderTransferHistory(sel.value); await reload(); render(); toast(`Перенесено: ${r.matches} ${plural(r.matches, 'матч', 'матча', 'матчей')}, ${r.tournaments} ${plural(r.tournaments, 'турнир', 'турнира', 'турниров')}`); });
  },
  'founder-block': el => busy(el, async () => { await S.store.founderBlockClub(el.dataset.id, el.dataset.v === '1'); await renderFounder(); toast(el.dataset.v === '1' ? 'Клуб заблокирован' : 'Клуб разблокирован'); }),
  'founder-delete': async el => {
    const name = el.dataset.name;
    openModal(`<h3>Удалить клуб?</h3><p class="muted">Клуб «${esc(name)}» будет удалён вместе со всеми матчами, турнирами и пинг-коинами. Отменить нельзя.</p>
      <label>Для подтверждения введите название<input id="del-name" autocomplete="off"></label>
      <div class="row-btns"><button class="btn ghost" data-act="close">Отмена</button><button class="btn danger" id="del-yes">Удалить навсегда</button></div>`, sh => {
      sh.querySelector('#del-yes').onclick = () => busy(sh.querySelector('#del-yes'), async () => { await S.store.founderDeleteClub(el.dataset.id, sh.querySelector('#del-name').value.trim()); closeModal(); await reload(); render(); toast('Клуб удалён'); });
    });
  },
};

const CLUB_CHANGE = {
  'screen-theme': el => busy(null, async () => { await S.store.rpc('screen_set', { sid: el.dataset.id, p_theme: el.value }); toast('Фон табло изменён'); }),
  'founder-all': el => document.querySelectorAll('.un-cb').forEach(x => { x.checked = el.checked; }),
};

const clubFields = fd => ({
  name: fd.get('name').trim(), city: fd.get('city').trim(), address: fd.get('address').trim(), description: fd.get('description').trim(),
  lat: fd.get('lat') ? +fd.get('lat') : null, lng: fd.get('lng') ? +fd.get('lng') : null, visible: fd.get('visible') === 'on',
});
const CLUB_FORMS = {
  'screen-pair': async (f, fd) => { await S.store.rpc('screen_pair', { cid: S.club.id, p_code: fd.get('code'), p_name: fd.get('name').trim() || null }); f.reset(); await renderScreens(); toast('Табло подключено 📺'); },
  'join-code': async (f, fd) => { await openInvite(fd.get('code').trim()); },
  'new-club': async (f, fd) => {
    if (!feature('newclub')) throw new Error('Создание новых клубов пока закрыто. Скоро откроем');
    const cid = await S.store.createClub(clubFields(fd));
    lsSet('ponghub_club', cid);
    await reload();
    location.hash = '#/invite?new=1';
  },
  'club-edit': async (f, fd) => { await S.store.updateClub(S.club.id, clubFields(fd)); await reload(); render(); toast('Клуб сохранён'); },
};

// ───────────── Магазин ─────────────
// Каталог и 3D — в shop-catalog.js / shop3d.js. Цены и покупки проверяет база (buy_item), награды за лиги — функция notify.
const SHOP = { region: 'cn', kind: 'blade', color: 'red' };
const RG_ICON = { cn: '🇨🇳', eu: '🇪🇺', jp: '🇯🇵', acc: '🧻', wear: '👟', skin: '🏆' };
const SHOP_REGIONS = ['cn', 'eu', 'jp', 'acc', 'wear', 'skin'];
let threeAsked = false;
function ensureThree() {
  if (window.THREE || threeAsked) return;
  threeAsked = true;
  loadThree().then(() => { if (['shop', 'racket', 'player', 'inventory'].includes(route().name)) render(); }).catch(() => {});
}
async function ensureShop(force = false) {
  if (S.shop && !force) return S.shop;
  try { S.shop = await S.store.shopState(); S.coins = S.shop.balance; } catch (e) { S.shop = null; throw e; }
  // цены и условия скинов — как в базе (их проверяет и сервер), а не зашитые в приложение
  try { for (const r of await S.store.skinItems()) { const it = byId(r.id); if (it) { it.price = r.price; if (r.unlock?.kind && r.unlock.n) it.unlock = { kind: r.unlock.kind, n: +r.unlock.n }; } } } catch { /* останутся из приложения */ }
  return S.shop;
}
const owns = key => !!S.shop?.items?.includes(key);
const ownsAny = it => it.colors ? it.colors.some(c => owns(`${it.id}:${c.key}`)) : owns(it.id);
const shopBars = it => it.s == null ? '' : `<div class="sh-bars">${[['Скорость', it.s, '#e63946'], ['Вращение', it.w, '#2563b8'], ['Контроль', it.c, '#12a061']].map(([l, v, c]) => `<div class="sh-bar">${l}<i><b style="width:${v * 10}%;background:${c}"></b></i><span>${String(v).replace('.', ',')}</span></div>`).join('')}</div>`;
const shopTags = it => `<div class="sh-tags"><span class="sh-tag ${STYLE[it.style][1]}">${STYLE[it.style][0]}</span>${it.type === 'blade' ? `<span class="sh-tag">${esc(it.layers)}</span>` : it.type === 'rubber' ? `<span class="sh-tag">${esc(it.rubber)}</span><span class="sh-tag">${esc(it.sponge)}</span>` : ''}</div>`;
const WEAR_3D = ['shirt', 'shorts', 'shoes', 'socks', 'wrist', 'head'];
const thumbEl = (it, color, big) => {
  const el = thumb(it, color, big); el.classList.add(big ? 'sh-pic-img' : 'sh-thumb-img');
  // форма: сначала рисунок, затем — снимок вещи на 3D-игроке (только у кого открыт 3D-игрок)
  if (WEAR_3D.includes(it.type) && feature('avatar')) {
    import('./player3d.js').then(m => m.wearShot(keyOf(it, color), big ? 512 : 256)).then(url => {
      if (!url) return; const im = new Image(); im.onload = () => { const x = el.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, el.width, el.height); x.drawImage(im, 0, 0, el.width, el.height); }; im.src = url;
    }).catch(() => {});
  }
  return el;
};

function shopHeader(tab) {
  return `<div class="page-h"><h1>🛍️ Магазин</h1></div><div class="sh-hbtns"><a href="#/inventory" class="btn sm">🎒 Мой инвентарь</a><a href="#/racket" class="btn sm">🏓 Моя ракетка</a></div>
    <section class="hero table-card sh-hero"><div><small>Ваш счёт в этом клубе</small><div class="big-num">${fmtC(S.coins)} <span class="pc">PC</span></div></div>
      <div class="seg sh-seg"><a href="#/shop" class="${tab === 'shop' ? 'on' : ''}">Товары</a><a href="#/shop?tab=bonus" class="${tab === 'bonus' ? 'on' : ''}">Бонусы${S.shop && !S.shop.streak.claimed ? ' <i class="dot inline">1</i>' : ''}</a></div></section>`;
}

function viewShop(r) {
  ensureThree();
  if (!S.shop) return `${shopHeader('shop')}<div class="empty"><span class="spin"></span></div>`;
  if (r.q.get('tab') === 'bonus') return shopHeader('bonus') + bonusBody();
  const reg = SHOP.region, racketRegion = ['cn', 'eu', 'jp'].includes(reg);
  if (reg === 'skin') lsSet(CN_KEY.visit, '1');
  return `${shopHeader('shop')}
    <div class="sh-chips">${SHOP_REGIONS.map(k => `<button data-act="sh-region" data-v="${k}" class="${k === reg ? 'on' : ''}">${RG_ICON[k]} ${RG[k]}</button>`).join('')}</div>
    <div class="sh-region rh-${reg}"><b>${RG[reg]}</b><small>${RGSUB[reg]}</small></div>
    ${racketRegion ? `<div class="seg"><button data-act="sh-kind" data-v="blade" class="${SHOP.kind === 'blade' ? 'on' : ''}">Основания</button><button data-act="sh-kind" data-v="rubber" class="${SHOP.kind === 'rubber' ? 'on' : ''}">Накладки</button></div>` : ''}
    ${racketRegion && SHOP.kind === 'rubber' ? `<div class="sh-colors">Цвет: ${RUBBER_COLORS.map(c => `<button data-act="sh-color" data-v="${c.key}" class="${SHOP.color === c.key ? 'on' : ''}" style="background:${c.hex}" aria-label="${c.name}"></button>`).join('')}<span>${colorOf({ colors: RUBBER_COLORS }, SHOP.color).name}${SHOP.color === 'blue' ? ' · +60 PC' : ''}</span></div>` : ''}
    <div class="sh-list" id="sh-list"></div>`;
}

// ───────────── Мой инвентарь: всё, что уже куплено или подарено, по категориям ─────────────
const INV = { cat: 'all' };
const INV_CATS = [['blade', '🏓', 'Ракетки', ['blade']], ['rubber', '🟥', 'Накладки', ['rubber']], ['grip', '🧤', 'Ручки и ленты', ['grip', 'tape']], ['ball', '⚪', 'Мячи', ['ball']],
  ['acc', '🎒', 'Аксессуары', ['case', 'head', 'wrist']], ['wear', '👕', 'Одежда', ['shirt', 'shorts', 'socks', 'cap']], ['shoes', '👟', 'Обувь', ['shoes']]];
function invGroups() {
  const worn = new Set(Object.values(S.shop?.loadout || {})), seen = new Map();
  for (const k of S.shop?.items || []) {
    const { it, color } = parseKey(k); if (!it) continue;
    const id = it.type === 'blade' && it.handles ? it.id : k;   // у основания формы ручки — одна карточка
    const cur = seen.get(id);
    if (!cur || (worn.has(k) && !cur.worn)) seen.set(id, { it, color: color || null, k, worn: worn.has(k) });
  }
  return INV_CATS.map(([key, icon, name, types]) => ({ key, icon, name, list: [...seen.values()].filter(x => types.includes(x.it.type)).sort((a, b) => (b.worn - a.worn) || a.it.name.localeCompare(b.it.name, 'ru')) }));
}
function viewInventory() {
  ensureThree();
  const head = `<div class="page-h"><h1>🎒 Мой инвентарь</h1></div><div class="sh-hbtns"><a href="#/shop" class="btn sm">🛍️ Магазин</a><a href="#/racket" class="btn sm">🏓 Моя ракетка</a></div>`;
  if (!S.shop) return `${head}<div class="empty"><span class="spin"></span></div>`;
  const gr = invGroups(), total = gr.reduce((n, g) => n + g.list.length, 0);
  return `${head}<p class="muted small">Всё, что у вас уже есть, — в одном месте. Нажмите на вещь, чтобы надеть её или посмотреть в 3D.</p>
    <div class="sh-chips"><button data-act="inv-cat" data-v="all" class="${INV.cat === 'all' ? 'on' : ''}">Всё · ${total}</button>${gr.filter(g => g.list.length).map(g => `<button data-act="inv-cat" data-v="${g.key}" class="${INV.cat === g.key ? 'on' : ''}">${g.icon} ${g.name} · ${g.list.length}</button>`).join('')}</div>
    <div id="inv-list"></div>`;
}
function renderInventory() {
  const box = document.getElementById('inv-list'); if (!box) return;
  box.innerHTML = '';
  const gr = invGroups().filter(g => g.list.length && (INV.cat === 'all' || INV.cat === g.key));
  if (!gr.length) { box.innerHTML = '<div class="empty">Здесь пока пусто. <a href="#/shop" class="link">Загляните в магазин →</a></div>'; return; }
  for (const g of gr) {
    const sec = document.createElement('section'); sec.className = 'inv-sec';
    sec.innerHTML = `<h3 class="inv-h">${g.icon} ${g.name} <small class="muted">${g.list.length}</small></h3><div class="inv-grid"></div>`;
    const grid = sec.querySelector('.inv-grid');
    for (const { it, color, worn } of g.list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'inv-it' + (worn ? ' on' : ''); b.dataset.act = 'sh-open'; b.dataset.id = it.id; if (color) b.dataset.color = color;
      const th = document.createElement('span'); th.className = 'inv-th'; th.appendChild(thumbEl(it, color)); b.appendChild(th);
      const col = it.colors && !(it.type === 'blade' && it.handles) ? colorOf(it, color)?.name : '';
      b.insertAdjacentHTML('beforeend', `<b>${esc(it.name)}</b><small class="muted">${esc(col || it.brand || '')}</small>${worn ? '<i class="inv-on">надето</i>' : it.gift ? '<i class="inv-gift">🎁 подарок</i>' : ''}`);
      grid.appendChild(b);
    }
    box.appendChild(sec);
  }
}
// ───────────── Подарок от создателя: уведомление с той самой ракеткой ─────────────
let giftAt = 0;
async function maybeGiftNotice() {
  if (S.me?.status !== 'approved' || document.getElementById('gift-overlay') || Date.now() - giftAt < 30000) return;
  giftAt = Date.now();
  let list = []; try { list = await S.store.rpc('my_gifts') || []; } catch { return; }
  const items = list.map(g => byId(g.item_id)).filter(Boolean);
  if (!items.length || document.getElementById('gift-overlay')) return;
  await loadThree().catch(() => {});
  await ensureShop(true).catch(() => {});
  const ov = document.createElement('div'); ov.id = 'gift-overlay'; ov.className = 'cn-ov';
  ov.innerHTML = `<div class="cn-pop gift-pop" role="dialog" aria-label="Подарок"><span class="cn-tag">Подарок</span>
    <h2>${items.length > 1 ? 'Вам подарили<br>ракетки' : 'Вам подарили<br>ракетку'}</h2><p>Эксклюзив от создателя PongHub. Таких нет в магазине.</p>
    <div class="gift-items">${items.map(it => `<div class="gift-it" data-id="${it.id}"><b>${esc(it.name)}</b><small>${esc(it.material)}</small></div>`).join('')}</div>
    <button class="cn-go" type="button" data-gift="go">Посмотреть</button><button class="cn-later" type="button" data-gift="close">Закрыть</button></div>`;
  ov.querySelectorAll('.gift-it').forEach(el => { const it = byId(el.dataset.id); const im = thumb(it, 'FL', true); im.className = 'gift-img'; el.prepend(im); });
  const close = () => { ov.remove(); S.store.rpc('gifts_seen').catch(() => {}); };
  ov.addEventListener('click', e => {
    const a = e.target.closest('[data-gift]')?.dataset.gift;
    if (a === 'go') { close(); if (feature('shop')) { SHOP.region = 'skin'; location.hash = '#/shop'; } else toast('Ракетка уже в вашей коллекции — она появится, когда откроется магазин'); }
    else if (a === 'close' || e.target === ov) close();
  });
  document.body.appendChild(ov);
}
// ───────────── Напоминание о коллекции скинов ─────────────
const CN_KEY = { seen: 'ph_coll_seen', later: 'ph_coll_later', visit: 'ph_coll_visit' };
function maybeCollectionNotice() {
  if (!feature('shop') || S.me?.status !== 'approved' || !S.shop || route().name !== 'home') return;
  if (document.getElementById('cn-overlay') || lsGet(CN_KEY.seen)) return;
  let later = null; try { later = JSON.parse(lsGet(CN_KEY.later) || 'null'); } catch { /* */ }
  if (later && (later.n >= 3 || Date.now() - later.at < 864e5)) return;
  showCollectionNotice().catch(() => {});
}
async function showCollectionNotice() {
  await loadThree().catch(() => {});
  if (document.getElementById('cn-overlay')) return;
  const minWear = Math.min(...ITEMS.filter(it => it.skin && ['shirt', 'shorts'].includes(it.type)).map(it => it.price));
  const tiles = [['skin-b1', 'g', 'Obsidian Gold'], ['skin-b2', 's', 'Mirror Silver'], ['skin-b3', 'b', 'Bronze Forge']];
  const ov = document.createElement('div'); ov.id = 'cn-overlay'; ov.className = 'cn-ov';
  ov.innerHTML = `<div class="cn-pop" role="dialog" aria-label="Новая коллекция"><span class="cn-tag">Новинка</span>
    <h2>Коллекция<br>PongHub</h2><p>Эксклюзивные скины для ракетки и игрока. Только внешний вид, на игру не влияют.</p>
    <div class="cn-items">${tiles.map(([id, c, n]) => `<div class="cn-sk ${c}" data-id="${id}"><b>${n}</b></div>`).join('')}</div>
    <div class="cn-how"><div><em>🪙</em><span><b>Купить за PC</b>Ракетки, джерси, шорты: от ${fmtC(minWear)} PC</span></div><div><em>🏆</em><span><b>Или получить бесплатно</b>За рейтинг, победы и сыгранные матчи</span></div></div>
    <button class="cn-go" type="button" data-cn="go">Смотреть коллекцию</button><button class="cn-later" type="button" data-cn="later">Напомнить позже</button></div>`;
  // настоящие 3D-снимки ракеток — те же, что в кабинете магазина
  ov.querySelectorAll('.cn-sk').forEach(el => { const it = byId(el.dataset.id); if (it) { const im = thumb(it, 'FL', true); im.className = 'cn-img'; el.prepend(im); } });
  const close = () => ov.remove();
  ov.addEventListener('click', e => {
    const a = e.target.closest('[data-cn]')?.dataset.cn;
    if (a === 'go') { lsSet(CN_KEY.seen, '1'); lsSet(CN_KEY.visit, '1'); SHOP.region = 'skin'; close(); location.hash = '#/shop'; }
    else if (a === 'later' || e.target === ov) { let l = null; try { l = JSON.parse(lsGet(CN_KEY.later) || 'null'); } catch { /* */ } lsSet(CN_KEY.later, JSON.stringify({ n: (l?.n || 0) + 1, at: Date.now() })); close(); }
  });
  document.body.appendChild(ov);
}

// ───────────── Коллекция: скины за достижения ─────────────
const SKIN_GROUPS = [['🏓 Ракетки', ['blade', 'rubber']], ['👕 Одежда', ['shirt', 'shorts']]];
const lcFirst = t => t.charAt(0).toLowerCase() + t.slice(1);
const skinOpen = it => (S.skin?.unlocked || []).includes(it.id) || ownsAny(it);
async function loadSkins(force = false) {
  if (!feature('shop')) return null;
  if (!force && S.skin && Date.now() - (S.skinAt || 0) < 45000) return S.skin;
  try {
    const res = await S.store.claimSkins(); S.skin = res; S.skinAt = Date.now();
    if (res.granted?.length) {
      await ensureShop(true);
      toast('🎁 Открыт новый скин: ' + res.granted.map(id => byId(id)?.name).filter(Boolean).join(', '));
    }
  } catch (e) { console.warn('claimSkins', e); if (!S.skin) S.skin = { stats: null, unlocked: [] }; }
  return S.skin;
}
const fmtStat = (k, v) => k === 'rating' ? String(Math.round(v * 10) / 10).replace('.', ',') : Math.round(v).toLocaleString('ru-RU');
function skinProgress(it) {
  if (!it.unlock) return { now: 0, pct: 100, text: '' };
  const st = S.skin?.stats, u = it.unlock, now = st ? unlockNow(u, st) : 0, pct = Math.max(0, Math.min(100, now / u.n * 100));
  return { now, pct, text: st ? `${fmtStat(u.kind, now)} из ${fmtStat(u.kind, u.n)}` : S.skin ? 'пока не удалось проверить' : 'проверяю…' };
}
function renderSkinList(box) {
  const st = S.skin?.stats, all = ITEMS.filter(it => it.skin && (!it.gift || ownsAny(it))), open = all.filter(skinOpen).length;
  box.innerHTML = `<div class="sk-stats card"><b>Ваш прогресс</b><div class="sk-chips">
      <span>⭐ Рейтинг <b>${st ? fmtStat('rating', st.rating) : '…'}</b></span><span>🏆 Победы <b>${st ? st.wins : '…'}</b></span><span>🏓 Матчи <b>${st ? st.matches : '…'}</b></span><span>🪙 Заработано <b>${st ? fmtStat('coins', st.coins) : '…'} PC</b></span></div>
      <small class="muted">Открыто ${open} из ${all.length}. Каждый скин можно купить за PC или получить бесплатно, выполнив условие. На игру они не влияют, только внешний вид.</small></div>`;
  for (const [title, types] of SKIN_GROUPS) {
    const items = all.filter(it => types.includes(it.type));
    const h = document.createElement('h4'); h.className = 'sk-h'; h.textContent = title; box.appendChild(h);
    for (const it of items) {
      const ok = skinOpen(it), pr = skinProgress(it), color = it.colors[0].key;
      const el = document.createElement('button'); el.className = 'sh-item sk-item' + (ok ? ' open' : ' lock'); el.dataset.act = 'sh-open'; el.dataset.id = it.id; el.dataset.color = it.type === 'blade' ? 'FL' : color;
      const th = document.createElement('span'); th.className = 'sh-thumb'; th.appendChild(thumbEl(it, it.type === 'blade' ? 'FL' : color));
      const body = document.createElement('span'); body.className = 'sh-body';
      body.innerHTML = `<span class="sh-top"><span><small class="sh-brand">${esc(it.brand)} · ${it.colors.length > 1 ? it.colors.length + ' ' + (it.handles ? 'формы ручки' : 'цвета') : 'эксклюзив'}</small><b class="sh-name">${esc(it.name)}</b></span>
        <span class="sk-badge ${ok ? 'ok' : 'price'}">${ok ? '✓ открыто' : fmtC(it.price) + ' PC'}</span></span>
        ${ok ? '' : `<span class="sk-cond">или бесплатно: ${esc(lcFirst(unlockText(it.unlock)))}</span><span class="sk-bar"><i style="width:${pr.pct}%"></i></span><small class="muted">у вас ${esc(pr.text)}</small>`}`;
      el.append(th, body); box.appendChild(el);
    }
  }
}
function renderShopList() {
  const box = document.getElementById('sh-list');
  if (!box) return;
  const reg = SHOP.region, racketRegion = ['cn', 'eu', 'jp'].includes(reg);
  if (reg === 'skin') { renderSkinList(box); return; }
  const list = ITEMS.filter(it => it.region === reg && !it.reward && (!it.gift || ownsAny(it)) && (!racketRegion || it.type === SHOP.kind));
  for (const it of list) {
    const color = it.type === 'rubber' ? SHOP.color : null;
    const own = it.type === 'rubber' ? owns(keyOf(it, color)) : it.handles ? ownsAny(it) : false;
    const any = ownsAny(it);
    const el = document.createElement('button');
    el.className = 'sh-item'; el.dataset.act = 'sh-open'; el.dataset.id = it.id; if (color) el.dataset.color = color;
    const th = document.createElement('span'); th.className = 'sh-thumb'; th.appendChild(thumbEl(it, color));
    const body = document.createElement('span'); body.className = 'sh-body';
    body.innerHTML = `<span class="sh-top"><span><small class="sh-brand">${esc(it.brand)}</small><b class="sh-name">${esc(it.name)}</b></span>
      ${own ? '<span class="sh-price own">✓ куплено</span>' : `<span class="sh-price">${it.colors && it.type !== 'rubber' ? '<small>от</small> ' : ''}${fmtC(priceOf(it, color))} <small>PC</small></span>`}</span>
      ${shopTags(it)}${it.colors && it.type !== 'rubber' && !it.handles ? `<span class="sh-dots">${it.colors.map(c => `<i style="background:${c.hex}"></i>`).join('')}</span>` : ''}${shopBars(it)}
      ${!own && any && !it.handles && it.type !== 'rubber' ? '<span class="sh-tags"><span class="sh-tag uni">есть у вас</span></span>' : ''}`;
    el.append(th, body); box.appendChild(el);
  }
}

// что показать в живом 3D в карточке предмета
function previewCfg(it, k) {
  if (it.type === 'blade') return { blade: k };
  if (it.type === 'rubber') return { blade: 'cn-b1:FL', fh: k, bh: k };
  if (it.type === 'grip') return { blade: 'eu-b1:FL', grip: k };
  if (it.type === 'tape') return { blade: 'cn-b5:FL', fh: 'cn-r5:red', bh: 'cn-r5:black', tape: k };
  return null;
}
function openShopItem(it, color, mode = 'buy') {
  let sel = colorOf(it, color)?.key || null, focus = null;
  openModal('<div id="sh-sheet"></div>', () => draw());
  function draw() {
    const box = document.getElementById('sh-sheet'); if (!box) return;
    const k = keyOf(it, sel), own = owns(k), price = priceOf(it, sel);
    const skinSpec = it.skin ? [it.gift ? ['Получено', 'Подарок от создателя PongHub'] : ['Бесплатно', unlockText(it.unlock)], ['Статус', skinOpen(it) ? 'Открыто ✓' : 'Не открыто — ' + skinProgress(it).text], ['Цена', fmtC(it.price) + ' PC']] : null;
    const spec = skinSpec ? skinSpec : it.type === 'blade' ? [['Слои', it.layers], ['Материал', it.material], ['Класс', it.cls], ['Вес', it.wt + ' г'], ['Толщина', String(it.th).replace('.', ',') + ' мм'], ['Стиль', STYLE[it.style][0]]]
      : it.type === 'rubber' ? [['Тип', it.rubber], ['Губка', it.sponge], ['Жёсткость губки', it.hard], ['Дуга полёта', it.arc], ['Липкость', it.tack], ['Вес листа', '≈ ' + it.wt + ' г'], ['Цвет', colorOf(it, sel).name]]
      : [['Цвет', colorOf(it, sel)?.name || '—']];
    box.innerHTML = `<div class="sh-pic" id="sh-pic"></div>
      <small class="sh-brand">${esc(it.brand)} · ${RG[it.region] || 'Награда'}</small><h3 class="sh-title">${esc(it.name)}</h3>${shopTags(it)}
      <p class="muted">${esc(it.desc)}</p>${shopBars(it)}
      ${it.handles ? `<div><b class="small">Форма ручки</b><div class="sh-hsel">${it.colors.map(c => `<button data-hk="${c.key}" class="${sel === c.key ? 'on' : ''}">${c.key}<small>${c.extra ? '+' + c.extra : 'база'}</small></button>`).join('')}</div><small class="muted">${esc(colorOf(it, sel).name)}</small></div>`
        : it.colors && it.colors.length > 1 ? `<div class="sh-colors">${it.colors.map(c => `<button data-hk="${c.key}" class="${sel === c.key ? 'on' : ''}" style="background:${c.hex}" aria-label="${esc(c.name)}"></button>`).join('')}<span>${esc(colorOf(it, sel).name)}${colorOf(it, sel).extra ? ` · +${colorOf(it, sel).extra} PC` : ''}</span></div>` : ''}
      <div class="sh-spec">${spec.map(([a, b]) => `<div>${a}<b>${esc(b)}</b></div>`).join('')}</div>
      <div id="sk-info" class="stack"></div><div id="sh-act" class="sh-act"></div>`;
    const pic = box.querySelector('#sh-pic'), cfg3d = previewCfg(it, k);
    if (window.THREE && cfg3d) { pic.classList.add('sh-3d'); mountViewer(pic, cfg3d, focus ? { apply: focus, zoom: .8 } : { zoom: .8 }); focus = null; }
    else pic.appendChild(thumbEl(it, sel, true));
    box.querySelectorAll('[data-hk]').forEach(b => b.onclick = () => { sel = b.dataset.hk; if (it.type === 'rubber') SHOP.color = sel; focus = it.handles ? 'grip' : null; draw(); });
    const act = box.querySelector('#sh-act');
    const can = !!EQUIP[it.type];
    if (mode.startsWith('reward:')) {
      act.innerHTML = own ? '<button class="btn full" disabled>Уже есть — выберите другой</button>' : `<button class="btn primary full" id="sh-rw">Забрать бесплатно</button>`;
      act.querySelector('#sh-rw')?.addEventListener('click', e => busy(e.currentTarget, async () => {
        await S.store.claimLeague(mode.slice(7), k); await ensureShop(true); closeModal(); toast('Награда получена 🎁'); render();
      }));
      return;
    }
    const info = box.querySelector('#sk-info');
    if (it.skin) {
      const wearT = ['shirt', 'shorts'].includes(it.type), pr = skinProgress(it);
      if (own) {
        const slot = wearT ? it.type : null, worn = Object.values(S.shop.loadout || {}).includes(k);
        act.innerHTML = `<button class="btn primary full" id="sk-eq">${worn ? 'Уже надето' : wearT ? 'Надеть на игрока' : 'Поставить на ракетку'}</button>`;
        act.querySelector('#sk-eq').onclick = e => wearT ? busy(e.currentTarget, async () => { S.shop.loadout = await S.store.equipItem(slot, k); closeModal(); toast('Надето ✓'); go('#/avatar'); }) : askEquip(it, k, act);
        return;
      }
      info.innerHTML = `<div class="sk-lock"><b>🆓 Бесплатно: ${esc(lcFirst(unlockText(it.unlock)))}</b><span class="sk-bar"><i style="width:${pr.pct}%"></i></span><small class="muted">у вас ${esc(pr.text)} — или купите ниже за PC</small></div>${wearT && feature('avatar') ? `<a class="btn full" href="#/avatar?try=${encodeURIComponent(k)}" data-act="close">👀 Примерить на игроке</a>` : ''}`;
    }
    if (own) {
      const paid = S.shop.paid?.[k] || 0, back = Math.round(paid * 0.3), worn = Object.values(S.shop.loadout || {}).includes(k);
      act.innerHTML = (can ? `<button class="btn primary full" id="sh-eq">${worn ? 'Уже на ракетке' : 'Поставить на ракетку'}</button>` : '<button class="btn full" disabled>Уже у вас</button>')
        + (feature('resale') && paid > 0 ? `<button class="btn ghost full" id="sh-sell">Продать за ${fmtC(back)} PC <small class="muted">(30% от ${fmtC(paid)})</small></button>` : '');
      act.querySelector('#sh-eq')?.addEventListener('click', () => askEquip(it, k, act));
      act.querySelector('#sh-sell')?.addEventListener('click', () => {
        if (worn) { toast('Сначала снимите эту деталь с ракетки', 'err'); return; }
        act.innerHTML = `<p class="small">Продать <b>${esc(it.name)}</b> за <b>${fmtC(back)} PC</b>? Вещь исчезнет из ваших.</p><div class="row-btns"><button class="btn ghost" id="sl-no">Отмена</button><button class="btn danger" id="sl-yes">Продать</button></div>`;
        act.querySelector('#sl-no').onclick = () => draw();
        act.querySelector('#sl-yes').onclick = e => busy(e.currentTarget, async () => { const r = await S.store.sellItem(k); await ensureShop(true); closeModal(); render(); toast(`Продано: +${fmtC(r.amount)} PC`); });
      });
    } else {
      act.innerHTML = `<button class="btn primary full" id="sh-buy" ${S.coins < price ? 'disabled' : ''}>${S.coins < price ? `Не хватает ${fmtC(price - S.coins)} PC` : `Купить за ${fmtC(price)} PC`}</button>`;
      act.querySelector('#sh-buy').addEventListener('click', () => {
        act.innerHTML = `<p class="muted small">Списать <b>${fmtC(price)} PC</b>? Останется ${fmtC(S.coins - price)} PC.</p><div class="row-btns"><button class="btn ghost" id="sh-no">Отмена</button><button class="btn primary" id="sh-yes">Купить</button></div>`;
        act.querySelector('#sh-no').onclick = () => draw();
        act.querySelector('#sh-yes').onclick = e => busy(e.currentTarget, async () => {
          S.coins = await S.store.buyItem(k); S.shop.items.push(k); S.shop.balance = S.coins; (S.shop.paid = S.shop.paid || {})[k] = price;
          act.innerHTML = `<p class="small">🎉 <b>${esc(it.name)}</b> теперь ваша.</p>${can ? '<button class="btn primary full" id="sh-eq">Поставить на ракетку</button>' : '<button class="btn full" id="sh-ok">Отлично</button>'}`;
          act.querySelector('#sh-eq')?.addEventListener('click', () => askEquip(it, k, act));
          act.querySelector('#sh-ok')?.addEventListener('click', () => { closeModal(); render(); });
        });
      });
    }
  }
}
function askEquip(it, k, act) {
  if (it.type !== 'rubber') return doEquip(EQUIP[it.type], k);
  act.innerHTML = `<p class="small">На какую сторону поставить?</p><div class="row-btns"><button class="btn" id="eq-fh">Сторона 1</button><button class="btn" id="eq-bh">Сторона 2</button></div>`;
  act.querySelector('#eq-fh').onclick = () => doEquip('fh', k);
  act.querySelector('#eq-bh').onclick = () => doEquip('bh', k);
}
async function doEquip(slot, k) {
  await busy(null, async () => {
    S.shop.loadout = await S.store.equipItem(slot, k);
    closeModal(); S.applySlot = slot;
    if (route().name === 'racket') render(); else location.hash = '#/racket';
    toast('Установлено на ракетку ✓');
  });
}

// ── моя ракетка ──
function viewRacket() {
  ensureThree();
  if (!S.shop) return '<div class="page-h"><h1>🏓 Моя ракетка</h1></div><div class="empty"><span class="spin"></span></div>';
  const lo = S.shop.loadout || {};
  const bk = parseKey(lo.blade || STARTER), bl = bk.it;
  const part = s => parseKey(lo[s]);
  const fh = part('fh'), bh = part('bh'), grip = part('grip'), tape = part('tape');
  const total = priceOf(bl, bk.color) + [fh, bh, grip, tape].reduce((a, x) => a + (x.it ? priceOf(x.it, x.color) : 0), 0);
  const rubs = [fh, bh].filter(x => x.it);
  const avg = k => ((bl[k] * 1.2 + rubs.reduce((a, x) => a + x.it[k], 0)) / (1.2 + rubs.length)).toFixed(1).replace('.', ',');
  const slot = (label, x, s, empty) => `<div class="sh-slot"><span class="sh-sw" style="background:${x.it ? (x.it.type === 'blade' ? x.it.look.face : colorOf(x.it, x.color).hex) : 'var(--line)'}"></span><span class="rn"><small class="muted">${label}</small><b>${x.it ? esc(`${x.it.brand} ${x.it.name}`) + (x.it.handles ? ' · ' + x.color : '') : empty}</b></span><a class="btn sm ghost" href="#/shop" data-act="sh-goto" data-slot="${s}">${x.it ? 'Сменить' : 'Купить'}</a>${x.it && s !== 'blade' ? `<button class="btn sm ghost" data-act="sh-unequip" data-slot="${s}" aria-label="Снять">✕</button>` : ''}</div>`;
  const owned = (S.shop.items || []).map(parseKey).filter(x => x.it);
  return `<div class="page-h"><h1>🏓 Моя ракетка</h1><a href="#/shop" class="btn sm">🛍️ Магазин</a></div>
    <div class="sh-viewer" id="sh-viewer"><div class="sh-vside" id="sh-vside">Сторона 1</div>
      <div class="sh-vtools"><button data-act="sh-v" data-v="flip" aria-label="Перевернуть">⟲</button><button data-act="sh-v" data-v="in" aria-label="Ближе">+</button><button data-act="sh-v" data-v="out" aria-label="Дальше">−</button></div>
      <div class="sh-vhint">${window.THREE ? 'Потяните, чтобы повернуть' : 'Загружаю 3D…'}</div></div>
    <div class="sh-totals"><div>Скорость<b>${avg('s')}</b></div><div>Вращение<b>${avg('w')}</b></div><div>Контроль<b>${avg('c')}</b></div></div>
    <section class="card sh-slots">
      ${slot('Основание', bk, 'blade', '')}
      ${slot('Сторона 1', fh, 'fh', 'нет накладки')}
      ${slot('Сторона 2', bh, 'bh', 'нет накладки')}
      ${slot('Обмотка', grip, 'grip', 'нет')}
      ${slot('Торцевая лента', tape, 'tape', 'нет')}
      <div class="sh-cost"><small class="muted">Стоимость сборки</small><b>${fmtC(total)} PC</b></div>
    </section>
    <section class="card"><div class="card-h"><h3>Мои детали</h3><small class="muted">нажмите, чтобы поставить</small></div><div class="sh-strip" id="sh-inv"></div></section>
    ${owned.some(x => !EQUIP[x.it.type]) ? '<section class="card"><div class="card-h"><h3>Гардероб</h3></div><div class="sh-strip" id="sh-ward"></div></section>' : ''}`;
}
let racketCtl = null;
function mountRacket() {
  const el = document.getElementById('sh-viewer');
  const fill = (id, list) => {
    const box = document.getElementById(id); if (!box) return;
    for (const { it, color } of list) {
      const k = keyOf(it, color);
      const b = document.createElement('button'); b.className = Object.values(S.shop.loadout || {}).includes(k) ? 'on' : ''; b.dataset.act = 'sh-open'; b.dataset.id = it.id; if (color) b.dataset.color = color;
      b.appendChild(thumbEl(it, color)); b.append(`${it.name}${it.colors && !it.handles ? ' · ' + colorOf(it, color).name : it.handles ? ' · ' + color : ''}`);
      box.appendChild(b);
    }
  };
  const owned = (S.shop?.items || []).map(parseKey).filter(x => x.it);
  fill('sh-inv', owned.filter(x => EQUIP[x.it.type]));
  fill('sh-ward', owned.filter(x => !EQUIP[x.it.type]));
  if (!el || !window.THREE) return;
  const lo = S.shop.loadout || {};
  racketCtl = mountViewer(el, { blade: lo.blade || STARTER, fh: lo.fh, bh: lo.bh, grip: lo.grip, tape: lo.tape }, {
    apply: S.applySlot, onSide: n => { const s = document.getElementById('sh-vside'); if (s && s.dataset.n !== String(n)) { s.dataset.n = n; s.textContent = 'Сторона ' + n; } },
  });
  S.applySlot = null;
}

// ── бонусы и награды за лиги ──
// задания недели: прогресс считает сервер по подтверждённым матчам
function tasksCard() {
  const W = S.tasks; if (!W) return '';
  const done = t => t.have >= t.goal, got = t => (W.claimed || []).includes(t.key);
  const ready = W.tasks.filter(t => done(t) && !got(t)).length, total = W.tasks.reduce((a, t) => a + t.reward, 0);
  const left = Math.max(0, 7 - ((new Date().getDay() + 6) % 7));
  return `<section class="card wt"><div class="card-h"><h3>🎯 Задания недели</h3><small class="muted">до ${total} PC · обновятся через ${left} ${plural(left, 'день', 'дня', 'дней')}</small></div>
    ${W.tasks.map(t => `<div class="wt-q ${got(t) ? 'got' : done(t) ? 'done' : ''}"><span class="wt-ic">${t.icon}</span><div><b>${esc(t.title)}</b><small>${t.have} из ${t.goal}</small><div class="wt-bar"><i style="width:${Math.round(t.have / t.goal * 100)}%"></i></div></div>
      <div class="wt-rw">+${t.reward}${got(t) ? '<span class="muted">✓ получено</span>' : done(t) ? `<button class="btn xs primary" data-act="task-claim" data-k="${t.key}">Забрать</button>` : '<span class="muted">в процессе</span>'}</div></div>`).join('')}
    ${ready ? '' : '<p class="muted small">Задания проверяются по подтверждённым матчам клуба.</p>'}</section>`;
}
function bonusBody() {
  const sk = S.shop.streak, d = sk.day;
  const r = ratingOf(S.me.id);
  const LG = { silver: LEAGUES[1], gold: LEAGUES[2], platinum: LEAGUES[3], diamond: LEAGUES[4] };
  return `${tasksCard()}<section class="card sh-streak-card"><div class="card-h"><h3>🔥 Серия: день ${d} из 7</h3></div>
      <p class="muted small">Заходите каждый день — бонус растёт до 120 PC. После 7-го дня серия начинается заново. Пропустили день — тоже с начала.</p>
      <div class="sh-streak">${STREAK.map((v, i) => { const n = i + 1, got = n < d || (n === d && sk.claimed), today = n === d && !sk.claimed; return `<div class="sh-day ${got ? 'got' : today ? 'today' : ''}">День ${n}<b>${v}</b>${got ? '✓' : today ? 'сегодня' : 'PC'}</div>`; }).join('')}</div>
      <button class="btn primary full" data-act="sh-claim" ${sk.claimed ? 'disabled' : ''}>${sk.claimed ? 'Получено — приходите завтра' : `Забрать ${STREAK[d - 1]} PC`}</button></section>
    <section class="card"><div class="card-h"><h3>🏆 Награды за лигу</h3></div>
      <p class="muted small">Дошли до новой лиги — заберите предмет бесплатно. Один раз за каждую лигу. Ваш рейтинг: <b>${fmtR(r)}</b>.</p>
      <div class="sh-ladder">${LEAGUE_REWARDS.map(w => {
        const l = LG[w.league], got = S.shop.rewards?.[w.league], can = !got && r >= l.min;
        const gi = got ? parseKey(got) : null;
        return `<div class="sh-rung"><span class="league ${l.cls}">${l.name}</span><span class="rn"><b>${esc(w.text)}</b><small class="muted">${got ? 'получено: ' + esc(gi.it ? gi.it.brand + ' ' + gi.it.name : got) : `от рейтинга ${l.min}`}</small></span>
          ${got ? '<span class="badge ok">✓</span>' : can ? `<button class="btn sm primary" data-act="sh-reward" data-v="${w.league}">Выбрать</button>` : '<span class="badge">🔒</span>'}</div>`;
      }).join('')}</div></section>
    <section class="card"><div class="card-h"><h3>Как ещё заработать</h3></div><ul class="muted small sh-earn">
      <li><b>Прогнозы</b> на матчи — <a class="link" href="#/predict">открыть</a></li><li><b>+15 PC</b> за каждый подтверждённый матч (до 3 в день)</li><li><b>Турниры:</b> 1-е место 500, 2-е 300, 3-е 150 PC</li></ul></section>`;
}
function openRewardPicker(league) {
  const w = LEAGUE_REWARDS.find(x => x.league === league);
  const opts = [];
  for (const it of ITEMS) {
    if (it.reward || it.skin || !w.types.includes(it.type)) continue;
    for (const c of it.colors || [{ key: null, extra: 0 }]) if (priceOf(it, c.key) <= w.cap && !owns(keyOf(it, c.key))) opts.push({ it, color: c.key });
  }
  openModal(`<h3>Награда: ${esc(w.name)}</h3><p class="muted small">${esc(w.text)}. Выберите, что забрать.</p><div class="sh-pick" id="sh-pick"></div>`, sh => {
    const box = sh.querySelector('#sh-pick');
    const seen = new Set();
    for (const { it, color } of opts) {
      if (it.handles && seen.has(it.id)) continue; seen.add(it.id);
      const b = document.createElement('button'); b.className = 'sh-item';
      const th = document.createElement('span'); th.className = 'sh-thumb'; th.appendChild(thumbEl(it, color));
      const body = document.createElement('span'); body.className = 'sh-body'; body.innerHTML = `<small class="sh-brand">${esc(it.brand)}</small><b class="sh-name">${esc(it.name)}</b><span class="muted small">${it.colors && !it.handles ? colorOf(it, color).name + ' · ' : ''}обычно ${fmtC(priceOf(it, color))} PC</span>`;
      b.append(th, body);
      b.onclick = () => { closeModal(); setTimeout(() => openShopItem(it, color, 'reward:' + league), 50); };
      box.appendChild(b);
    }
    if (!opts.length) box.innerHTML = '<div class="empty small">Подходящих предметов нет — у вас уже всё есть</div>';
  });
}

const SHOP_ACT = {
  'sh-region': el => { SHOP.region = el.dataset.v; render(); },
  'sh-kind': el => { SHOP.kind = el.dataset.v; render(); },
  'sh-color': el => { SHOP.color = el.dataset.v; render(); },
  'shop-open': () => { if (SHOP.region === 'skin') { SHOP.region = 'cn'; if (route().name === 'shop') render(); } },
  'coll-open': () => { SHOP.region = 'skin'; lsSet(CN_KEY.visit, '1'); if (route().name === 'shop') render(); },
  'announce-coll': async el => {
    if (!(await confirmDialog('Отправить push «Новая коллекция скинов» всем, у кого сейчас открыт магазин (вам и тестировщикам, а после запуска для всех — всем игрокам)?', 'Отправить'))) return;
    await busy(el, async () => { const r = await S.store.announce('collection'); toast(`Уведомление отправлено: ${r?.sent ?? 0}`); });
  },
  'sk-back': () => { SHOP.region = 'skin'; location.hash = '#/shop'; },
  'inv-cat': el => { INV.cat = el.dataset.v; render(); },
  'sh-open': el => { const it = byId(el.dataset.id); if (it) openShopItem(it, el.dataset.color || null); },
  'sh-claim': el => busy(el, async () => { const r = await S.store.claimDaily(); S.coins = r.balance; await ensureShop(true); render(); toast(`+${r.amount} PC 🔥`); }),
  'sh-reward': el => openRewardPicker(el.dataset.v),
  'sh-unequip': el => busy(el, async () => { S.shop.loadout = await S.store.equipItem(el.dataset.slot, null); render(); }),
  'sh-goto': el => { const s = el.dataset.slot; const cur = parseKey(S.shop.loadout?.[s]).it; if (s === 'grip' || s === 'tape') SHOP.region = 'acc'; else { SHOP.kind = s === 'blade' ? 'blade' : 'rubber'; if (cur) SHOP.region = cur.region; } },
  'sh-v': el => { const v = el.dataset.v; if (v === 'flip') racketCtl?.flip(); else if (v === 'in') racketCtl?.zoomIn(); else racketCtl?.zoomOut(); },
};

// ракетка игрока — картинкой в профиле
// ───────────── 3D-игрок ─────────────
let AV = null;
// лицо по селфи отложено: нужна платная нейросеть (Gemini без оплаты не рисует картинки)
const FACE_ON = false;
const WEAR = [['shirt', 'Футболка'], ['shorts', 'Шорты'], ['shoes', 'Кроссовки'], ['socks', 'Носки'], ['wrist', 'Напульсники'], ['head', 'Повязка']];
function viewAvatar(r) {
  const a = r.args[0], grip = a === 'grip', other = a && !grip && a !== S.me.id;
  if (grip && !isFounder()) return viewHome(r);
  const p = other ? S.byId.get(a) : S.ctx.me;
  if (!p) return '<div class="empty">Игрок не найден</div>';
  const mine = !other && !grip, lo = (other ? p.loadout : S.shop?.loadout) || p.loadout || {}, owned = S.shop?.items || [];
  const gender = p.avatar3d || 'boy';
  const tryIt = mine && r.q.get('try') ? parseKey(r.q.get('try')).it : null;
  const title = grip ? '✋ Хват ракетки' : mine ? '🧍 Мой игрок' : '🧍 ' + esc(p.nickname);
  const wearBox = mine ? WEAR.map(([slot, name]) => {
    const mineItems = owned.filter(k => byId(k.split(':')[0])?.type === slot);
    return `<div class="stack"><b class="small">${name}</b>${mineItems.length ? `<div class="av-wear">${mineItems.map(k => { const { it, color } = parseKey(k); const c = colorOf(it, color); return `<button class="av-w ${lo[slot] === k ? 'on' : ''}" data-act="av-wear" data-slot="${slot}" data-k="${esc(k)}"><i style="background:${c.hex}"></i>${esc(it.name)}<small>${esc(c.name)}</small></button>`; }).join('')}${lo[slot] ? `<button class="av-w" data-act="av-wear" data-slot="${slot}" data-k="">Снять</button>` : ''}</div>` : `<small class="muted">Пока нет — <a href="#/shop" class="link">купить в магазине</a></small>`}</div>`;
  }).join('') : '';
  return `${tryIt ? `<div class="card sk-try">👀 Примерка: <b>${esc(tryIt.name)}</b><br><small class="muted">${esc(unlockText(tryIt.unlock))}</small> <a href="#/shop" class="link" data-act="sk-back">К коллекции →</a></div>` : ''}<div class="page-h"><h1>${title}</h1>${mine ? '<a href="#/racket" class="btn sm">🏓 Ракетка</a>' : ''}</div>
    <div class="av-stage ${AV?.big ? 'big' : ''}" id="av-stage"><div class="av-load" id="av-load"><span class="spin"></span></div>
      <div class="av-tools"><button data-act="av-tool" data-v="flip" aria-label="Повернуть">⟲</button><button data-act="av-tool" data-v="face" aria-label="Лицо крупно">🔍</button><button data-act="av-tool" data-v="full" aria-label="Во весь рост">⤢</button><button data-act="av-tool" data-v="big" aria-label="Во весь экран">⛶</button></div>
      ${grip ? '' : `<div class="av-emotes"><button data-act="av-play" data-v="win">🏆 Победа</button><button data-act="av-play" data-v="swing">🏓 Удар</button><button data-act="av-play" data-v="wave">👋 Привет</button><button data-act="av-play" data-v="clap">👏 Хлопки</button></div>`}</div>
    ${mine ? `<section class="card stack"><b class="small">Персонаж</b><div class="av-who"><button class="${gender === 'boy' ? 'on' : ''}" data-act="av-gender" data-v="boy">Парень</button><button class="${gender === 'girl' ? 'on' : ''}" data-act="av-gender" data-v="girl">Девушка</button></div>
      ${FACE_ON ? `<div class="row-btns"><button class="btn primary" data-act="av-selfie">📸 Лицо по селфи</button>${S.ctx.me.face ? '<button class="btn ghost" data-act="av-noface">Убрать лицо</button>' : ''}</div>
      <p class="muted small">Сделайте селфи анфас при хорошем свете — нейросеть нарисует ваше лицо на игроке. До 10 попыток в день.</p>` : ''}</section>
      <section class="card stack"><div class="card-h"><h3>👕 Форма</h3><a href="#/shop" class="link">Магазин →</a></div>${wearBox}</section>` : ''}
    ${grip ? `<section class="card stack" id="av-grip"></section>` : ''}`;
}
async function mountAvatarView(r) {
  const el = document.getElementById('av-stage'); if (!el) return;
  const a = r.args[0], grip = a === 'grip', other = a && !grip && a !== S.me.id;
  if (!other && !S.shop && feature('shop')) { try { await ensureShop(); } catch { /* без магазина — базовая форма */ } }
  const p = other ? S.byId.get(a) : S.ctx.me;
  let lo = (other ? p?.loadout : S.shop?.loadout) || p?.loadout || {};
  const tk = !other && !grip ? r.q.get('try') : null, ti = tk ? parseKey(tk).it : null;
  if (ti) lo = { ...lo, [ti.type === 'rubber' ? 'fh' : ti.type]: tk };
  if (!other && !grip) loadSkins().then(g => { if (g?.granted?.length && route().name === 'avatar') render(); });
  try {
    const { mountAvatar, RK } = await import('./player3d.js');
    const ctl = await mountAvatar(el, { gender: p?.avatar3d || 'boy', face: p?.face || null, loadout: lo, grip: S.ctx.platform?.grip || {}, tune: grip });
    AV = { ...(AV || {}), ctl, RK, lo };
    document.getElementById('av-load')?.remove();
    if (grip) mountGripPanel(ctl, RK);
  } catch (e) { const l = document.getElementById('av-load'); if (l) l.innerHTML = `<span class="muted small">${esc(e.message || '3D не загрузилось')}</span>`; }
}
function mountGripPanel(ctl, RK) {
  const box = document.getElementById('av-grip'); if (!box) return;
  const F = [['tilt', 'Наклон ракетки в ладони', -3.14, 3.14, .01], ['spin', 'Поворот вокруг ручки', -3.14, 3.14, .01], ['pitch', 'Наклон вперёд / назад', -3.14, 3.14, .01], ['roll', 'Завалить вбок', -3.14, 3.14, .01],
    ['slide', 'Ракетка вперёд — назад из руки, см', -15, 15, .1], ['sx', 'Ракетка вбок, см', -10, 10, .1], ['sz', 'От накладки — к накладке, см', -10, 10, .1],
    ['grip', 'Сдвиг вдоль ручки, см', -8, 10, .1], ['side', 'Сдвиг вдоль кулака, см', -5, 5, .1], ['ox', 'Сдвиг вбок, см', -5, 5, .1], ['oz', 'Сдвиг к ладони, см', -5, 5, .1],
    ['curl', 'Сжатие пальцев', 0, 1.6, .01], ['fside', 'Пальцы влево — вправо', -1.2, 1.2, .01], ['thumb', 'Сжатие большого пальца', 0, 1.6, .01], ['tside', 'Большой палец влево — вправо', -1.2, 1.2, .01],
    ['wx', 'Кисть вверх — вниз', -1.2, 1.2, .01], ['wz', 'Кисть влево — вправо', -1.2, 1.2, .01]];
  box.innerHTML = `<p class="muted small">Как игрок держит ракетку — у всех игроков. Вертите кисть пальцем, приближайте колёсиком. «Сохранить для всех» — и так будет у каждого.</p>
    <div class="av-btns"><button class="btn sm ghost" id="g-full">Общий план</button><button class="btn sm ghost" id="g-swing">Показать удар</button></div>
    ${F.map(([k, l, a, b, st]) => `<label class="av-sl">${l}<span><input type="range" data-g="${k}" min="${a}" max="${b}" step="${st}" value="${RK[k] ?? 0}"><b id="gv-${k}">${(+(RK[k] ?? 0)).toFixed(2)}</b></span></label>`).join('')}
    <button class="btn primary full" id="g-save">Сохранить для всех</button>`;
  box.querySelectorAll('[data-g]').forEach(i => i.oninput = () => { RK[i.dataset.g] = +i.value; document.getElementById('gv-' + i.dataset.g).textContent = (+i.value).toFixed(2); ctl.regrip(); });
  let full = false;
  document.getElementById('g-full').onclick = e => { full = !full; ctl.tuneFull(full); e.target.textContent = full ? 'Крупно — кисть' : 'Общий план'; };
  document.getElementById('g-swing').onclick = () => ctl.play('swing');
  document.getElementById('g-save').onclick = e => busy(e.currentTarget, async () => {
    const g = {}; F.forEach(([k]) => g[k] = +(+(RK[k] ?? 0)).toFixed(2));
    await S.store.rpc('founder_set_grip', { p: g }); S.ctx.platform.grip = g; toast('Хват сохранён для всех ✓');
  });
}

function playerRacketCard(p) {
  const lo = p.loadout || {};
  if (!lo.blade) return '';
  const bl = parseKey(lo.blade).it;
  const rub = s => { const x = parseKey(lo[s]); return x.it ? `${x.it.brand} ${x.it.name} (${colorOf(x.it, x.color).name})` : 'без накладки'; };
  return `<section class="card sh-prk"><div class="card-h"><h3>🏓 Ракетка</h3>${p.id === S.me.id ? '<a href="#/racket" class="link">Собрать →</a>' : ''}</div>
    <div class="sh-prk-row"><div class="sh-prk-img" data-racket='${esc(JSON.stringify(lo))}'></div>
    <div class="small"><b>${esc(bl ? bl.brand + ' ' + bl.name : '')}</b> · ${esc(parseKey(lo.blade).color || 'FL')}<br><span class="muted">1: ${esc(rub('fh'))}<br>2: ${esc(rub('bh'))}</span></div></div></section>`;
}
function mountPlayerRackets() {
  if (!window.THREE) return;
  document.querySelectorAll('.sh-prk-img[data-racket]').forEach(el => {
    if (el.dataset.done) return; el.dataset.done = '1';
    try { const lo = JSON.parse(el.dataset.racket); const url = racketShot({ blade: lo.blade, fh: lo.fh, bh: lo.bh, grip: lo.grip, tape: lo.tape }); if (url) el.innerHTML = `<img src="${url}" alt="Ракетка">`; } catch { /* */ }
  });
}

// ракетка и игрок на главной: ракетка крутится в рамке, игрок по грудь смотрит в камеру
// компьютер: колонки главной разной высоты — переносим нижние блоки (Топ-5, события, итоги, матчи) в более короткую
function balanceHome() {
  const cols = document.querySelectorAll('.bento-2 > .h-col');
  if (cols.length !== 2) return;
  const gap = 16, H = () => [cols[0].offsetHeight, cols[1].offsetHeight];
  for (let n = 0; n < 8; n++) {
    const [h0, h1] = H(), [a, b] = h0 >= h1 ? cols : [cols[1], cols[0]], diff = Math.abs(h0 - h1);
    // из более длинной колонки — блок, который лучше всего сократит разницу
    const best = [...a.querySelectorAll(':scope > .mv')].filter(el => el.offsetHeight + gap < diff).sort((x, y) => y.offsetHeight - x.offsetHeight)[0];
    if (!best) break;
    b.appendChild(best);
  }
  // всё ещё длиннее — укорачиваем историю матчей (не меньше трёх; остальные — по кнопке «Все →»)
  const ms = document.querySelector('.h-matches');
  for (let n = 0; ms && n < 10; n++) {
    const [h0, h1] = H(), longer = h0 >= h1 ? cols[0] : cols[1], cards = ms.querySelectorAll(':scope > .mcard:not([hidden])');
    const last = cards[cards.length - 1];
    if (!longer.contains(ms) || cards.length <= 3 || !last || Math.abs(h0 - h1) < last.offsetHeight + 12) break;
    last.hidden = true;
  }
}
async function mountHome3D() {
  const rk = document.getElementById('hm-rk'), pl = document.getElementById('hm-pl');
  if (!rk && !pl) return;
  // покрутили пальцем — это не нажатие: переход по ссылке только при коротком касании
  for (const el of [rk, pl?.closest('a')].filter(Boolean)) {
    if (el.dataset.nd) continue; el.dataset.nd = '1'; let x0 = 0, y0 = 0, moved = false;
    el.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; moved = false; });
    el.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 6) moved = true; });
    el.addEventListener('click', e => { if (moved) { e.preventDefault(); moved = false; } });
  }
  try {
    await loadThree();
    if (rk && rk.isConnected) { const lo = S.shop?.loadout || {}; mountViewer(rk, { blade: lo.blade || STARTER, fh: lo.fh, bh: lo.bh, grip: lo.grip, tape: lo.tape }, { fit: true }); }
    if (pl && pl.isConnected) {
      const { mountAvatar } = await import('./player3d.js');
      if (!pl.isConnected) return;
      const ctl = await mountAvatar(pl, { gender: S.ctx.me.avatar3d || 'boy', face: S.ctx.me.face || null, loadout: S.shop?.loadout || S.ctx.me.loadout || {}, grip: S.ctx.platform?.grip || {}, bust: !pl.dataset.full, still: !!pl.dataset.full });
      ctl.resize();
    }
  } catch { /* без 3D главная работает как обычно */ }
}

// ───────────── Быстрый старт по QR на столе ─────────────
// ссылка из QR: #/play/<клуб>/<стол>. Выбрал соперника — игра началась, стол известен.
const PLAY = { opp: null, bestOf: 5 };
function viewPlay(r) {
  const [cid, no] = r.args, n = Math.max(1, +no || 1);
  if (cid && S.club?.id !== cid) {
    if ((S.ctx?.clubs || []).some(c => c.id === cid && c.my_status === 'active')) { setTimeout(() => switchClub(cid), 0); return '<div class="empty"><span class="spin"></span></div>'; }
    // не в клубе — страница клуба, заявка уходит сама; после «принять» сканируют стол снова
    const code = r.q.get('code');
    setTimeout(() => location.replace(`#/club/${cid}?auto=1&table=${n}${code ? '&code=' + encodeURIComponent(code) : ''}`), 0);
    return '<div class="empty"><span class="spin"></span></div>';
  }
  const me = S.me, busyT = S.data.live.find(l => l.status === 'live' && l.table_no === n);
  // сверху — с кем играли недавно, дальше — по рейтингу
  const recent = [...new Set(S.data.matches.filter(m => players(m).includes(me.id)).sort((a, b) => ts(b) - ts(a)).flatMap(m => players(m)).filter(id => id !== me.id))];
  const others = S.rank.map(x => x.p.id).filter(id => id !== me.id && !recent.includes(id));
  const list = [...recent, ...others].map(id => P(id)).filter(p => p && p.id);
  return `<div class="page-h"><h1>Игра за столом ${n}</h1></div>
    <p class="muted small">${esc(S.club?.name || '')} · ${busyT ? `<b class="down">за столом уже идёт игра: ${esc(sideName(busyT, 0))} — ${esc(sideName(busyT, 1))}</b>` : 'стол свободен ✓'}</p>
    <section class="card pq-me">${ava(me, 'md')}<div><b>Вы — ${esc(me.nickname)}</b><small class="muted">рейтинг ${fmtR(ratingOf(me.id))}</small></div></section>
    <div class="tf-lbl">С кем играете?</div>
    <div class="pq-list">${list.map(p => `<button class="pq-p ${PLAY.opp === p.id ? 'on' : ''}" data-act="pq-opp" data-id="${p.id}">${ava(p, 'sm')}<b>${esc(p.nickname)}</b><small>${recent.includes(p.id) ? 'играли недавно' : fmtR(ratingOf(p.id))}</small></button>`).join('')}</div>
    <div class="tf-lbl">Играем до</div>
    <div class="seg">${[[3, '2 побед'], [5, '3 побед'], [7, '4 побед']].map(([v, t]) => `<button data-act="pq-bo" data-v="${v}" class="${PLAY.bestOf === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="pq-go"><button class="btn primary big full" data-act="pq-start" data-t="${n}" data-s="1" ${PLAY.opp ? '' : 'disabled'}>▶ Начать — вести счёт</button>
      <button class="btn full" data-act="pq-start" data-t="${n}" data-s="0" ${PLAY.opp ? '' : 'disabled'}>⏱ Начать — счёт в конце</button></div>`;
}
// ───────────── Печать для клуба (только владелец): плакат А4 и «домики» на столы ─────────────
// QR ведут только в этот клуб: плакат — ссылка-приглашение (заявка уходит сама после регистрации),
// домик — «Игра за столом» этого клуба (с кодом приглашения, чтобы новичок сразу подал заявку).
const tablesN = () => Math.max(1, Math.min(12, +(lsGet('ponghub_tables') || 1)));
const tableLink = (n, code) => `${linkBase()}#/play/${S.club.id}/${n}${code ? '?code=' + encodeURIComponent(code) : ''}`;
function posterSheet() {
  return `<div class="prn-a4"><div class="prn-in prn-poster">
    <div class="prn-logo"><img src="${logo()}" alt="">PONGHUB</div>
    <div class="prn-club">${esc(S.club.name)}</div>
    <h3><span class="prn-fit">Играешь</span><span class="prn-fit">в <em>пинг-понг?</em></span></h3>
    <div class="prn-qrbox"><div class="prn-qr" data-prn="join"></div></div>
    <div class="prn-scan">📷 Наведи камеру телефона</div>
    <div class="prn-steps"><div><i>1</i>Наведи камеру на QR-код</div><div><i>2</i>Создай аккаунт за минуту</div><div><i>3</i>Заявка в клуб уйдёт сама</div></div>
  </div></div>`;
}
function tentSheet(n) {
  const half = pos => `<div class="prn-half ${pos}"><div class="prn-logo"><img src="${logo()}" alt="">PONGHUB</div>
    <div class="prn-row"><div class="prn-qrbox"><div class="prn-qr" data-prn="table" data-n="${n}"></div></div>
    <div class="prn-txt"><div class="prn-t1">${esc(S.club.name)}</div><div class="prn-t2 prn-fit">Стол ${n}</div><div class="prn-t3 prn-fit"><span>Наведи камеру</span><span>—</span><span>Сыграй матч</span></div><div class="prn-t4">Соперник, формат, счёт на табло — всё в телефоне.</div></div></div></div>`;
  return `<div class="prn-a4"><div class="prn-in prn-tent">${half('prn-up')}<div class="prn-fold"><span>сгиб</span></div>${half('prn-down')}</div></div>`;
}
function viewPrint() {
  if (!isAdmin()) return '<div class="empty">Печать доступна только владельцу клуба</div>';
  const n = tablesN();
  return `<div class="page-h"><a href="#/me" class="back">← Профиль</a></div><h1>Печать для клуба</h1>
    <p class="muted small">QR-коды ведут только в «${esc(S.club.name)}». Печатайте на А4, масштаб 100%, без полей.</p>
    ${S.store.sandbox ? '<div class="alert info">🧪 Образец для показа. В песочнице QR-коды ведут только в песочницу, а не в настоящее приложение.</div>' : ''}
    <section class="card"><div class="card-h"><h3>📣 Рекламный плакат</h3></div>
      <p class="muted small">Человек наводит камеру → регистрируется → заявка в клуб уходит сама. Вам придёт уведомление — примите её во вкладке «Заявки».</p>
      <div class="prn-prev">${posterSheet()}</div>
      <button class="btn primary full" data-act="print-sheets" data-what="poster">🖨 Печать плаката</button></section>
    <section class="card"><div class="card-h"><h3>🏓 Домик на стол</h3></div>
      <p class="muted small">Сложите лист пополам по пунктиру — домик стоит на столе, QR видно с двух сторон. Наведя камеру, игрок сразу попадает в «Игру за столом»: выбирает соперника и формат. Если он ещё не в клубе — регистрируется, заявка уходит сама, а после вашего «Принять» он снова сканирует стол и играет. Лучше плотная бумага 160–200 г/м².</p>
      <div class="row-btns"><span>Столов:</span><button class="btn sm" data-act="tb-n" data-v="${n - 1}">−</button><b>${n}</b><button class="btn sm" data-act="tb-n" data-v="${n + 1}">+</button></div>
      <div class="prn-prev">${tentSheet(1)}</div>
      <button class="btn primary full" data-act="print-sheets" data-what="tables">🖨 Печать домиков · ${n} ${plural(n, 'лист', 'листа', 'листов')}</button></section>
    <p class="muted small">Если сменить ссылку приглашения (Профиль → Пригласить), старые плакаты и домики перестанут принимать новичков — участники клуба будут играть по ним как раньше. Тогда просто распечатайте заново.</p>`;
}
async function fillPrintQr(root) {
  const code = S.printCode?.club === S.club.id ? S.printCode.code : (S.printCode = { club: S.club.id, code: await S.store.inviteCode(S.club.id) }).code;
  await Promise.all([...root.querySelectorAll('[data-prn]')].map(el =>
    drawQr(el, el.dataset.prn === 'join' ? inviteLink(code) : tableLink(el.dataset.n, code))));
}
// если на телефоне увеличен шрифт, надписи уменьшаются, пока не влезут: строка — по ширине, плакат — по высоте (за счёт QR)
function fitPrint(root) {
  for (const el of root.querySelectorAll('.prn-fit')) {
    el.style.fontSize = '';
    // размер в долях ширины листа (cqw) — тогда на принтере будет так же, как на экране
    el.style.whiteSpace = el.style.textWrap = el.style.lineHeight = '';
    const sheet = el.closest('.prn-a4').clientWidth, base = parseFloat(getComputedStyle(el).fontSize);
    // запас 6%: принтер и телефон рисуют шрифт чуть шире, чем при замере
    const rg = document.createRange(); rg.selectNodeContents(el);
    const over = () => rg.getBoundingClientRect().width > el.parentElement.clientWidth * 0.94;   // ширина самого текста против места в строке (блок бывает «по ширине текста»)
    let k = 1;
    while (over() && k > 0.5) { k -= 0.04; el.style.fontSize = `${base * k / sheet * 100}cqw`; }
    if (over()) { el.style.whiteSpace = 'normal'; el.style.textWrap = 'balance'; el.style.lineHeight = '1.05'; el.style.fontSize = `${base * 0.44 / sheet * 100}cqw`; }   // очень длинное название — в две строки, а не обрезка
  }
  // домик: если половина не вмещает надписи, уменьшаем их понемногу
  for (const half of root.querySelectorAll('.prn-half')) {
    const els = [...half.querySelectorAll('.prn-t2, .prn-t3, .prn-t4')], sheet = half.closest('.prn-a4').clientWidth;
    const base = els.map(el => parseFloat(getComputedStyle(el).fontSize));
    const need = () => [...half.children].reduce((a, c) => a + c.offsetHeight, 0) + parseFloat(getComputedStyle(half).rowGap || 0) * (half.children.length - 1);
    let k = 1;
    while (need() > half.clientHeight * 0.94 && k > 0.55) { k -= 0.05; els.forEach((el, i) => { el.style.fontSize = `${base[i] * k / sheet * 100}cqw`; }); }
  }
  for (const sh of root.querySelectorAll('.prn-poster')) {
    const box = sh.querySelector('.prn-qrbox');
    box.style.width = '';
    let w = 44;
    // всё, включая шаги внизу, должно поместиться внутри рамки с запасом
    // + запас по высоте: телефон при печати рисует текст чуть крупнее, чем при замере
    const st = sh.querySelector('.prn-steps');
    const over = () => sh.scrollHeight > sh.clientHeight + 1 || (st && st.getBoundingClientRect().top - st.previousElementSibling.getBoundingClientRect().bottom < sh.clientHeight * 0.03);
    while (over() && w > 22) { w -= 2; box.style.width = `${w}cqw`; }
  }
}
async function renderPrint() {
  const host = document.querySelector('.page');
  if (!host || !isAdmin()) return;
  await document.fonts?.ready;
  fitPrint(host);
  try { await fillPrintQr(host); } catch (e) { toast(e.message, 'err'); }
}
async function printSheets(what) {
  let el = document.getElementById('print-area');
  if (!el) { el = document.createElement('div'); el.id = 'print-area'; document.body.appendChild(el); }
  el.innerHTML = what === 'poster' ? posterSheet() : Array.from({ length: tablesN() }, (_, k) => tentSheet(k + 1)).join('');
  await fillPrintQr(el);
  await document.fonts?.ready;
  // на экране область печати скрыта — на миг выводим её за край экрана, чтобы измерить и подогнать надписи
  el.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:794px';   // ширина листа А4 при печати (210 мм)
  fitPrint(el);
  el.style.cssText = '';
  await new Promise(res => setTimeout(res, 300));
  window.print();
}

// ───────────── Админка ─────────────
function viewAdmin(r) {
  if (!isAdmin()) return '<div class="empty">Управление клубом доступно только владельцу</div>';
  const tabs = isAdmin() ? [['reqs', 'Заявки'], ['matches', 'Матчи'], ['players', 'Игроки'], ['screens', 'Табло'], ['log', 'Журнал'], ['rating', 'Рейтинг'], ['data', 'Данные']] : [['matches', 'Матчи']];
  const tab = tabs.some(t => t[0] === r.args[0]) ? r.args[0] : tabs[0][0];
  const pc = pendingCounts();
  const cnt = { reqs: pc.users, matches: pc.matches };
  let body = '';
  if (tab === 'reqs') {
    const pend = S.data.profiles.filter(p => p.status === 'pending');
    const rej = S.data.profiles.filter(p => p.status === 'rejected');
    body = `<section class="card">${pend.map(p => `<div class="req">${ava(p, 'md')}<div class="rn"><b>${esc(p.nickname)}</b><small>${esc(p.full_name || '')}</small><small class="muted">${esc(S.emails.get(p.id) || '')} · ${fmtDate(p.joined_at || p.created_at)}</small></div>
      <div class="req-btns"><button class="btn primary sm" data-act="approve-user" data-id="${p.id}">Принять</button><button class="btn ghost sm" data-act="reject-user" data-id="${p.id}">Отклонить</button></div></div>`).join('') || '<div class="empty">Новых заявок нет 👌</div>'}</section>
      ${rej.length ? `<details class="card"><summary>Отклонённые (${rej.length})</summary>${rej.map(p => `<div class="req">${ava(p, 'sm')}<div class="rn"><b>${esc(p.nickname)}</b><small class="muted">${esc(S.emails.get(p.id) || '')}</small></div><div class="req-btns"><button class="btn sm" data-act="approve-user" data-id="${p.id}">Принять</button><button class="btn sm ghost danger" data-act="delete-user" data-id="${p.id}">Удалить</button></div></div>`).join('')}</details>` : ''}`;
  } else if (tab === 'matches') {
    const pend = S.data.matches.filter(m => m.status === 'pending').sort((a, b) => ts(b) - ts(a));
    body = `<p class="muted small">Результаты, которые игроки отправили сами. В рейтинг они попадут только после подтверждения.</p>
      ${pend.map(m => `<div class="pend">${matchCard(m)}<div class="row-btns"><span class="muted small">Отправил: ${esc(P(m.submitted_by).nickname)}</span><button class="btn ghost sm" data-act="reject-match" data-id="${m.id}">Отклонить</button><button class="btn primary sm" data-act="approve-match" data-id="${m.id}">Подтвердить</button></div></div>`).join('') || '<div class="empty">Нечего подтверждать 👌</div>'}`;
  } else if (tab === 'players') {
    const list = S.data.profiles.filter(p => p.status === 'approved' || p.status === 'archived').sort((a, b) => (a.status > b.status) - (a.status < b.status) || a.nickname.localeCompare(b.nickname));
    const testCount = S.data.profiles.filter(p => p.is_test).length;
    body = `<section class="card test-card"><div class="card-h"><h3>🧪 Тестовый режим</h3>
        <label class="switch"><input type="checkbox" data-act-change="test-mode" ${S.testMode ? 'checked' : ''}><i></i><span>${S.testMode ? 'Включён' : 'Выключен'}</span></label></div>
      <p class="muted small">Попробуйте всё в деле: создайте тестовых игроков, сыграйте ими матчи, турнир, живой счёт. Это видите только вы, в общий рейтинг не идёт, уведомления никому не приходят.</p>
      ${S.testMode ? `<div class="row-btns"><button class="btn sm" data-act="test-create">+ Создать 4 тестовых игроков</button>${testCount ? `<button class="btn sm danger" data-act="test-purge">🗑️ Удалить все тестовые данные</button>` : ''}</div>
        ${testCount ? `<p class="muted small">Тестовых игроков: ${testCount}. Удаление сотрёт их, их матчи и турниры и записи о них в журнале — бесследно.</p>` : ''}` : ''}
    </section>
    <p class="muted small">«Помощник» может сразу вносить результаты своих матчей — без подтверждения. Права можно включить и выключить в любой момент. Передать клуб другому участнику — в разделе <a class="link" href="#/clubedit">Клуб</a>.</p>
      <section class="card">${list.map(p => `<div class="pl-row ${p.status === 'archived' ? 'arch' : ''}">
        <div class="pl-top">${ava(p, 'sm')}<div class="rn"><b>${esc(p.nickname)}</b><small class="muted">${esc(p.full_name || '')} · ${esc(S.emails.get(p.id) || '')}</small></div><span class="pl-r">${fmtR(ratingOf(p.id))}</span></div>
        ${p.role === 'admin' ? '<div class="muted small">👑 Владелец клуба</div>' : `<div class="pl-ctl">
          <label class="switch"><input type="checkbox" data-act-change="toggle-editor" data-id="${p.id}" ${p.role === 'editor' ? 'checked' : ''} ${p.status === 'archived' ? 'disabled' : ''}><i></i><span>Помощник</span></label>
          <label class="init">Старт<input type="number" step="0.5" min="0" value="${p.initial_rating ?? ''}" placeholder="${settings().initialRating}" data-act-change="set-initial" data-id="${p.id}"></label>
          <button class="btn xs ghost" data-act="${p.status === 'archived' ? 'restore-user' : 'archive-user'}" data-id="${p.id}">${p.status === 'archived' ? 'Вернуть' : 'В архив'}</button>
          <button class="btn xs ghost danger" data-act="delete-user" data-id="${p.id}">Убрать из клуба</button>
        </div>`}</div>`).join('')}</section>
      <p class="muted small">«В архив» скрывает игрока из рейтинга, но сохраняет историю его матчей.</p>`;
  } else if (tab === 'log') {
    const del = r.q.get('f') === 'del';
    body = `<p class="muted small">Все изменения: кто внёс, исправил или удалил матч, турнир, права и настройки. Удалённый матч можно восстановить. Если матч удалил помощник, вам приходит уведомление с причиной.</p>
      <div class="seg"><a href="#/admin/log" class="${del ? '' : 'on'}">Всё</a><a href="#/admin/log?f=del" class="${del ? 'on' : ''}">Только удаления</a></div>
      <section class="card" id="audit-box" data-filter="${del ? 'del' : ''}"><div class="muted small">Загружаю…</div></section>`;
  } else if (tab === 'rating') {
    const s = settings();
    const f = (k, label, hint, step = 1) => `<label>${label}<input type="number" name="${k}" value="${s[k]}" step="${step}" min="0"><small class="muted">${hint}</small></label>`;
    const sys = s.system === 'elo' ? 'elo' : 'league';
    body = `<form data-form="settings" class="card stack" data-sys="${sys}">
      <label>Название клуба<input name="clubName" value="${esc(s.clubName)}" maxlength="30"></label>
      ${f('initialRating', 'Стартовый рейтинг', 'С какого рейтинга начинают новые игроки', 0.5)}
      <div><b class="small">Система расчёта</b>
        <div class="seg sys-seg"><label class="${sys === 'league' ? 'on' : ''}"><input type="radio" name="system" value="league" ${sys === 'league' ? 'checked' : ''} hidden>Как в лиге</label><label class="${sys === 'elo' ? 'on' : ''}"><input type="radio" name="system" value="elo" ${sys === 'elo' ? 'checked' : ''} hidden>Эло</label></div>
        <small class="muted only-league">Как в любительских лигах (ТТВ, «Тайфун»): победа ≈ +2, поражение ≈ −1, поправка на разницу рейтингов. Свободные игры — от текущего рейтинга, матчи турнира — от рейтинга на начало турнира.</small>
        <small class="muted only-elo">Классическая Эло: сколько получил победитель, столько потерял проигравший; бонус новичкам и поправка на счёт.</small></div>
      <div class="stack only-league">
        ${f('leagueWin', 'Победа над равным', 'Сколько даёт победа над соперником с таким же рейтингом', 0.1)}
        ${f('leagueWinSlope', 'Поправка к победе за 1 очко разницы', 'Победа над сильным дороже, над слабым дешевле — на столько за каждое очко', 0.005)}
        ${f('leagueWinMax', 'Максимум за победу', '', 0.5)}
        ${f('leagueLoss', 'Поражение от равного', 'Сколько отнимает поражение от соперника с таким же рейтингом', 0.1)}
        ${f('leagueLossSlope', 'Поправка к поражению за 1 очко разницы', 'Поражение от сильного дешевле, от слабого дороже', 0.005)}
        ${f('leagueLossMax', 'Максимум потери за поражение', '', 0.5)}
        ${f('leagueFreeMult', 'Вес свободной игры', '1 — как турнир, 0.5 — вдвое меньше', 0.1)}
      </div>
      <div class="stack only-elo">
        ${f('kTournament', 'Вес турнирного матча (K)', 'Максимум очков за турнирный матч', 0.5)}
        ${f('kFree', 'Вес свободной игры (K)', 'Максимум очков за обычную игру', 0.5)}
        ${f('spread', 'Масштаб разницы', 'При такой разнице рейтингов фаворит побеждает в ~10 раз чаще', 1)}
        ${f('newcomerGames', 'Матчей «новичка»', 'Сколько первых матчей рейтинг меняется быстрее', 1)}
        ${f('newcomerMult', 'Ускорение для новичков', 'Множитель для первых матчей', 0.1)}
        <label class="switch"><input type="checkbox" name="marginBonus" ${s.marginBonus ? 'checked' : ''}><i></i><span>Учитывать счёт (3:0 весит больше, чем 3:2)</span></label>
        ${f('kDoubles', 'Вес парной игры 2×2 (K)', 'Максимум очков парного рейтинга за игру', 0.5)}
      </div>
      <hr><b class="small">Снижение рейтинга без игр</b>
      <label class="switch"><input type="checkbox" name="decayEnabled" ${s.decayEnabled ? 'checked' : ''}><i></i><span>Включено</span></label>
      ${f('decayGraceDays', 'Дней без игр без штрафа', 'После этого рейтинг начинает снижаться', 1)}
      ${f('decayPerWeek', 'Минус за каждую неделю', 'Рейтинг не опускается ниже стартового', 0.1)}
      ${f('seasonMinMatches', 'Матчей для борьбы за титул сезона', 'Минимум матчей за месяц, чтобы стать чемпионом', 1)}
      <hr><b class="small">🏓 Напоминания</b>
      <label class="switch"><input type="checkbox" name="remindIdle" ${s.remindIdle !== false ? 'checked' : ''}><i></i><span>Напоминать тем, кто давно не играл (через 14, 30 и 60 дней), и предлагать соперника для вызова</span></label>
      <hr><b class="small">🔁 Повторные игры</b>
      ${f('repeatLimit', 'Игр подряд с одним соперником, максимум', 'Потом каждому из двоих нужно сыграть с кем-то другим. 0 — без ограничения. Не действует на турниры, парные игры и на игры владельца и помощников.', 1)}
      <hr><b class="small">🎯 Прогнозы на матчи</b>
      <label class="switch"><input type="checkbox" name="predEnabled" ${s.predEnabled ? 'checked' : ''}><i></i><span>Включены</span></label>
      ${f('predStart', 'Стартовый баланс, PC', 'Сколько пинг-коинов получает каждый в начале', 50)}
      ${f('predMin', 'Минимальная ставка, PC', '', 5)}
      ${f('predMax', 'Максимальная ставка, PC', '', 50)}
      ${f('predWindowMin', 'Приём прогнозов в игре без счёта, мин', 'Сколько минут после старта можно ставить, если счёт не ведут', 1)}
      <hr>
      <div><b class="small">Иконка приложения</b><div class="icon-pick">${Object.entries(ICON_VARIANTS).map(([k, l]) => `<label><input type="radio" name="icon" value="${k}" ${iconChoice() === k ? 'checked' : ''}><img src="icons/${k}.svg" alt="" width="64" height="64"><span>${l}</span></label>`).join('')}</div>
        <small class="muted">Меняется в приложении сразу. На главном экране телефона иконка обновится после переустановки.</small></div>
      <div class="calc" id="calc"></div>
      <div class="row-btns"><button type="button" class="btn ghost" data-act="settings-default">По умолчанию</button><button class="btn primary">Сохранить и пересчитать</button></div>
    </form>`;
  } else if (tab === 'screens') {
    body = `<section class="card stack"><div class="card-h"><h3>📺 Подключить табло</h3></div>
        <ol class="tv-how"><li>На телевизоре или компьютере у стола откройте <b class="mono">${esc(location.host)}/#/tv</b></li><li>На экране появится код из 6 цифр</li><li>Введите его здесь</li></ol>
        <form data-form="screen-pair" class="stack"><label>Код с экрана<input name="code" inputmode="numeric" required minlength="6" maxlength="7" placeholder="123 456" autocomplete="off"></label>
          <label>Название (необязательно)<input name="name" maxlength="30" placeholder="Например, Табло у стола"></label>
          <button class="btn primary">Подключить табло</button></form></section>
      <section class="card" id="screens-box"><div class="muted small">Загружаю…</div></section>
      <p class="muted small">Табло само показывает текущую игру с живым счётом, итоги матча и прогнозов, а в перерывах — турнирную сетку и кто играет следом. Изменить оно ничего не может.</p>`;
  } else if (tab === 'data') {
    body = `<section class="card stack">
      <p class="muted small">Выгрузки открываются в Excel и Google Таблицах.</p>
      <button class="btn" data-act="export-rating">📊 Рейтинг (Excel/CSV)</button>
      <button class="btn" data-act="export-matches">📋 Все матчи (Excel/CSV)</button>
      <button class="btn ghost" data-act="export-json">💾 Полная резервная копия (JSON)</button>
    </section>
    <section class="card"><div class="card-h"><h3>🗄️ Автоматические копии</h3><button class="btn sm" data-act="backup-now">Сделать копию сейчас</button></div>
      <p class="muted small">Каждый понедельник ночью база сама сохраняет полную копию. Хранятся 12 последних (≈ 3 месяца).</p>
      <div id="backup-box"><div class="muted small">Загружаю…</div></div></section>
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
  const sys = fd.get('system') === 'elo' ? 'elo' : 'league';
  form.dataset.sys = sys;
  form.querySelectorAll('.sys-seg label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
  if (sys === 'league') {
    for (const k of ['leagueWin', 'leagueWinSlope', 'leagueWinMax', 'leagueLoss', 'leagueLossSlope', 'leagueLossMax', 'leagueFreeMult']) s[k] = +fd.get(k) || 0;
    const me = 50;
    const W = o => leagueDelta(s, me, o, false).win.toFixed(2), L = o => leagueDelta(s, o, me, false).loss.toFixed(2);
    el.innerHTML = `<b>Примеры для игрока с рейтингом ${me}:</b>
      <div>Обыграл равного (50): <span class="up">+${W(50)}</span> · проиграл ему: <span class="down">−${L(50)}</span></div>
      <div>Обыграл сильного (80): <span class="up">+${W(80)}</span> · проиграл ему: <span class="down">−${L(80)}</span></div>
      <div>Обыграл слабого (20): <span class="up">+${W(20)}</span> · проиграл ему: <span class="down">−${L(20)}</span></div>
      <div class="muted">Свободная игра: ×${s.leagueFreeMult}</div>`;
    return;
  }
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
  const ex = [].concat(exclude || []);
  return S.data.profiles.filter(p => p.status === 'approved' && (p.id === sel || !ex.includes(p.id))).sort((a, b) => a.nickname.localeCompare(b.nickname))
    .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nickname)} · ${fmtR(ratingOf(p.id))}</option>`).join('');
}

function openMatchForm(opts = {}) {
  const m0 = opts.match || null;
  const fx = opts.fixed || {};
  const editor = isAdmin();  // только владелец вносит любые матчи и правит их
  const trusted = ids => isAdmin() || (isEditor() && ids.includes(S.me.id));  // помощник: свои матчи засчитываются сразу
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
    kind: m0?.kind || fx.kind || 'singles',
    p3: m0?.player3_id || fx.player3_id || '', p4: m0?.player4_id || fx.player4_id || '',
    rated: m0 ? m0.rated !== false : true,
    start: !!opts.start,
  };
  const lockPlayers = !!(fx.player1_id || m0?.tournament_id);
  const canDoubles = !fx.player1_id && !m0?.tournament_id && !fx.tournament_id && !(m0 && m0.kind !== 'doubles');
  const team = n => (st.kind === 'doubles'
    ? [n === 1 ? st.p1 : st.p2, n === 1 ? st.p3 : st.p4].filter(Boolean).map(id => P(id).nickname).join(' + ') || `Команда ${n}`
    : (n === 1 ? st.p1 : st.p2) ? P(n === 1 ? st.p1 : st.p2).nickname : `Игрок ${n}`);
  const lockFormat = !!(fx.tournament_id || m0?.tournament_id || fx.liveId);
  const lockP1 = !editor;
  const tour = tById(fx.tournament_id || m0?.tournament_id);

  const summary = () => {
    const need = winsNeeded(st.bestOf);
    let a = 0, b = 0;
    if (st.simple) { a = +st.s1 || 0; b = +st.s2 || 0; }
    else st.sets.forEach(([x, y]) => { if (x !== '' && y !== '' && +x !== +y) (+x > +y ? a++ : b++); });
    const n1 = team(1), n2 = team(2);
    const win = a >= need ? n1 : b >= need ? n2 : null;
    return `<b>${a}:${b}</b> ${win ? `— победа <b>${esc(win)}</b>` : `<span class="muted">(до ${need} ${plural(need, 'победы', 'побед', 'побед')})</span>`}`;
  };

  const fmtRow = () => `<div class="fmt-row">
        <div><small class="muted">Играем до</small><div class="seg sm">${[[1, '1'], [3, '2'], [5, '3'], [7, '4']].map(([v, l]) => `<button type="button" data-k="bestOf" data-v="${v}" class="${st.bestOf === v ? 'on' : ''}" ${lockFormat ? 'disabled' : ''}>${l}</button>`).join('')}</div><small class="muted">побед в партиях</small></div>
        <div><small class="muted">Партия до</small><div class="seg sm">${[11, 21].map(v => `<button type="button" data-k="pointsTo" data-v="${v}" class="${st.pointsTo === v ? 'on' : ''}" ${lockFormat ? 'disabled' : ''}>${v}</button>`).join('')}<input type="number" class="pts-custom" min="5" max="50" value="${[11, 21].includes(st.pointsTo) ? '' : st.pointsTo}" placeholder="др." ${lockFormat ? 'disabled' : ''}></div><small class="muted">очков</small></div>
      </div>`;
  const draw = sh => {
    const rows = Array.from({ length: st.bestOf }, (_, i) => st.sets[i] || ['', '']);
    st.sets = rows;
    // вызов принят → «Начать игру»: игроки уже выбраны, остаётся формат и как вести счёт
    if (st.start) return void (sh.querySelector('.mf-body').innerHTML = `
      <h3>▶ Начать игру</h3>
      <div class="ms-vs">${ava(P(st.p1), 'md')}<b>${esc(team(1))}</b><span>vs</span><b>${esc(team(2))}</b>${ava(P(st.p2), 'md')}</div>
      <small class="tf-lbl">1. Формат</small>
      ${fmtRow()}
      <small class="tf-lbl">2. Как ведём счёт</small>
      <button type="button" class="btn primary big full ms-opt" data-mf="live"><b>📱 Вести счёт по ходу</b><small>Очки отмечает один из вас или третий человек — все видят счёт вживую</small></button>
      <button type="button" class="btn big full ms-opt" data-mf="live-noscore"><b>⏱ Счёт в конце</b><small>Играете спокойно, итог внесёте после игры</small></button>
      <div class="mf-err"></div>
      <p class="muted small center">Игра сразу появится у всех в «Лайве» — можно будет сделать прогноз.</p>
      <button type="button" class="btn ghost sm full" data-mf="past">Уже сыграли? Внести результат</button>`);
    sh.querySelector('.mf-body').innerHTML = `
      <h3>${m0 ? 'Изменить матч' : editor ? 'Новый матч' : 'Результат матча'}</h3>
      ${tour ? `<div class="chip">🏆 ${esc(tour.name)}</div>` : ''}
      ${!editor ? `<p class="muted small">${isEditor() ? 'Вы помощник: результат вашего матча засчитается сразу. Чужие матчи уходят на подтверждение владельцу.' : 'Результат попадёт в рейтинг после подтверждения владельцем клуба.'}</p>` : ''}
      ${canDoubles && !m0 ? `<div class="seg"><button type="button" data-k="kind" data-v="singles" class="${st.kind === 'singles' ? 'on' : ''}">🏓 1×1</button><button type="button" data-k="kind" data-v="doubles" class="${st.kind === 'doubles' ? 'on' : ''}">👥 Пары 2×2</button></div>` : ''}
      ${st.kind === 'doubles' ? `<div class="teams">
          <div class="team-box"><small>Команда 1</small>
            <select name="p1" ${lockP1 || lockPlayers ? 'disabled' : ''}><option value="">Игрок</option>${playerOptions(st.p1, [st.p2, st.p3, st.p4])}</select>
            <select name="p3" ${lockPlayers ? 'disabled' : ''}><option value="">Партнёр</option>${playerOptions(st.p3, [st.p1, st.p2, st.p4])}</select></div>
          <span class="vs">vs</span>
          <div class="team-box"><small>Команда 2</small>
            <select name="p2" ${lockPlayers ? 'disabled' : ''}><option value="">Игрок</option>${playerOptions(st.p2, [st.p1, st.p3, st.p4])}</select>
            <select name="p4" ${lockPlayers ? 'disabled' : ''}><option value="">Партнёр</option>${playerOptions(st.p4, [st.p1, st.p2, st.p3])}</select></div>
        </div>
        <label class="switch"><input type="checkbox" name="rated" ${st.rated ? 'checked' : ''}><i></i><span>Учитывать в парном рейтинге</span></label>
        <p class="hint">Парные игры идут в <b>отдельный парный рейтинг</b> и не влияют на одиночный. Выключите, если игра была просто «для разминки».</p>`
      : `<div class="vs-pick">
        <select name="p1" ${lockPlayers || lockP1 ? 'disabled' : ''}><option value="">Игрок 1</option>${playerOptions(st.p1, st.p2)}</select>
        <span>vs</span>
        <select name="p2" ${lockPlayers ? 'disabled' : ''}><option value="">Игрок 2</option>${playerOptions(st.p2, st.p1)}</select>
      </div>`}
      ${editor && !lockFormat && st.kind === 'singles' ? `<div class="seg"><button type="button" data-k="type" data-v="free" class="${st.type === 'free' ? 'on' : ''}">Свободная игра</button><button type="button" data-k="type" data-v="tournament" class="${st.type === 'tournament' ? 'on' : ''}">Турнирный матч</button></div>
        ${st.type === 'tournament' ? '<p class="hint">Для турнира, созданного в приложении, счёт вносится на странице турнира. Здесь — разовый важный матч или матч турнира вне приложения: он просто весит в рейтинге больше.</p>' : ''}` : ''}
      ${fmtRow()}
      <label class="switch"><input type="checkbox" name="simple" ${st.simple ? 'checked' : ''}><i></i><span>Знаю только итоговый счёт по партиям</span></label>
      ${st.simple ? `<div class="sets-simple"><input type="number" name="s1" min="0" max="4" value="${st.s1}" placeholder="0"><span>:</span><input type="number" name="s2" min="0" max="4" value="${st.s2}" placeholder="0"></div>`
        : `<div class="sets-grid"><div class="sg-h"><span></span><span>${esc(team(1))}</span><span>${esc(team(2))}</span></div>
          ${rows.map((s, i) => `<div class="sg-row"><span>Партия ${i + 1}</span><input type="number" inputmode="numeric" min="0" max="99" data-set="${i}" data-side="0" value="${s[0]}"><input type="number" inputmode="numeric" min="0" max="99" data-set="${i}" data-side="1" value="${s[1]}"></div>`).join('')}</div>`}
      <div class="mf-sum">${summary()}</div>
      <label>Дата и время<input type="datetime-local" name="date" value="${st.date}"></label>
      <label>Комментарий<input name="note" value="${esc(st.note)}" maxlength="140" placeholder="необязательно"></label>
      <div class="mf-err"></div>
      <div class="row-btns">${m0 && editor ? '<button type="button" class="btn danger ghost" data-mf="delete">Удалить</button>' : ''}<button type="button" class="btn primary" data-mf="save">${editor ? 'Сохранить' : isEditor() ? 'Внести' : 'Отправить'}</button></div>
      ${!m0 && !fx.liveId && (editor || !lockFormat) ? `<div class="live-start"><span class="muted small">Игра только начинается?</span>
        ${fx.tournament_id && tById(fx.tournament_id)?.config?.scoring === 'final' ? '' : '<button type="button" class="btn full live-btn" data-mf="live">▶ Игра началась — вести счёт</button>'}
        <button type="button" class="btn full live-btn alt" data-mf="live-noscore">⏱ Игра началась — счёт в конце</button>
        <span class="muted small">Всем придёт уведомление, можно будет сделать прогноз. Без счётчика итог внесёте после игры.</span></div>` : ''}`;
  };

  openModal('<div class="mf-body"></div>', sh => {
    draw(sh);
    sh.addEventListener('click', async e => {
      const b = e.target.closest('[data-k]');
      if (b && !b.disabled) { const k = b.dataset.k; st[k] = k === 'type' || k === 'kind' ? b.dataset.v : +b.dataset.v; if (k === 'kind' && st.kind === 'doubles' && st.bestOf === 5) st.bestOf = 3; draw(sh); return; }
      const act = e.target.closest('[data-mf]')?.dataset.mf;
      if (act === 'save') saveMatch(e.target.closest('button'));
      if (act === 'live') startLive(e.target.closest('button'), true);
      if (act === 'live-noscore') startLive(e.target.closest('button'), false);
      if (act === 'past') { st.start = false; draw(sh); }
      if (act === 'delete') {
        const reason = await askReason('Удалить матч?', 'Рейтинг будет пересчитан. Укажите причину.');
        if (reason) await busy(null, async () => { await S.store.deleteMatch(m0.id, reason); toast('Матч удалён'); await refresh(); });
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
      if (['p1', 'p2', 'p3', 'p4'].includes(t.name)) { st[t.name] = t.value; draw(sh); }
      if (t.name === 'rated') st.rated = t.checked;
      if (t.name === 'simple') { st.simple = t.checked; draw(sh); }
      if (t.classList.contains('pts-custom') && +t.value >= 5) { st.pointsTo = +t.value; draw(sh); }
    });
  });

  function checkPlayers(err) {
    if (st.kind === 'doubles') {
      const ids = [st.p1, st.p2, st.p3, st.p4];
      if (ids.some(x => !x)) return err('Выберите всех четырёх игроков');
      if (new Set(ids).size < 4) return err('Один игрок не может быть в двух местах сразу');
    } else {
      if (!st.p1 || !st.p2) return err('Выберите обоих игроков');
      if (st.p1 === st.p2) return err('Игрок не может играть сам с собой');
    }
    return true;
  }

  async function startLive(btn, scoring = true) {
    const err = msg => { $modal.querySelector('.mf-err').textContent = msg; return false; };
    if (checkPlayers(err) !== true) return;
    const dbl = st.kind === 'doubles';
    if (!dbl && !(fx.tournament_id || m0?.tournament_id) && st.type !== 'tournament') { const w = repeatBlocked(st.p1, st.p2); if (w) return err(repeatMsg(w)); }
    const row = {
      kind: st.kind, type: (fx.tournament_id || m0?.tournament_id) ? 'tournament' : dbl ? 'free' : st.type,
      player1_id: st.p1, player2_id: st.p2, player3_id: dbl ? st.p3 : null, player4_id: dbl ? st.p4 : null,
      best_of: st.bestOf, points_to: st.pointsTo, rated: dbl ? st.rated : true,
      tournament_id: fx.tournament_id ?? null, stage: fx.stage ?? null, grp: fx.grp ?? null, round: fx.round ?? null, slot: fx.slot ?? null,
      challenge_id: fx.challengeId ?? null, first_server: 0, log: [], status: 'live', scorer_id: tableScorer(fx.tournament_id) || S.me.id, started_by: S.me.id, scoring,
      ...testFlag(),
    };
    await busy(btn, async () => {
      const l = await S.store.insert('live_matches', row);
      if (predOn()) await S.store.rpc('create_pred_event', { src: 'live', src_id: l.id, chance: chanceFor(row) }).catch(() => {});
      closeModal(); await refresh(); go(`#/live/${l.id}`);
    });
  }

  async function saveMatch(btn) {
    const err = msg => { $modal.querySelector('.mf-err').textContent = msg; };
    const dbl = st.kind === 'doubles';
    if (dbl) {
      const ids = [st.p1, st.p2, st.p3, st.p4];
      if (ids.some(x => !x)) return err('Выберите всех четырёх игроков');
      if (new Set(ids).size < 4) return err('Один игрок не может быть в двух местах сразу');
      if (!editor && !ids.includes(S.me.id)) return err('Можно отправить только игру, в которой вы участвовали');
    } else {
      if (!st.p1 || !st.p2) return err('Выберите обоих игроков');
      if (st.p1 === st.p2) return err('Игрок не может играть сам с собой');
    }
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
    if (!dbl && !m0 && !fx.liveId && !(fx.tournament_id || m0?.tournament_id) && st.type !== 'tournament' && !S.data.live.some(l => l.status === 'live' && [l.player1_id, l.player2_id].sort().join() === [st.p1, st.p2].sort().join())) { const w = repeatBlocked(st.p1, st.p2); if (w) return err(repeatMsg(w)); }
    const row = {
      player1_id: st.p1, player2_id: st.p2, type: (fx.tournament_id || m0?.tournament_id) ? 'tournament' : st.type,
      tournament_id: fx.tournament_id ?? m0?.tournament_id ?? null,
      stage: fx.stage ?? m0?.stage ?? null, grp: fx.grp ?? m0?.grp ?? null, round: fx.round ?? m0?.round ?? null, slot: fx.slot ?? m0?.slot ?? null,
      sets, sets1: s1, sets2: s2, winner_id: s1 > s2 ? st.p1 : st.p2,
      best_of: st.bestOf, points_to: st.pointsTo, played_at: new Date(st.date).toISOString(), note: st.note.trim(),
      status: trusted(st.kind === 'doubles' ? [st.p1, st.p2, st.p3, st.p4] : [st.p1, st.p2]) ? 'approved' : 'pending',
      ...(dbl ? { kind: 'doubles', player3_id: st.p3, player4_id: st.p4, rated: st.rated, type: 'free' } : {}),
    };
    await busy(btn, async () => {
      if (m0) await S.store.update('matches', m0.id, row);
      else {
        const saved = await S.store.insert('matches', { ...row, submitted_by: S.me.id, ...testFlag() });
        // счёт внесён — идущая игра этих же игроков и принятый вызов закрываются (в базе это делает и триггер, миграция 33)
        const same = x => { const a = [x.player1_id, x.player2_id, x.player3_id, x.player4_id].filter(Boolean).sort().join(), b = [row.player1_id, row.player2_id, row.player3_id, row.player4_id].filter(Boolean).sort().join(); return a === b; };
        const liveId = fx.liveId || S.data.live.find(l => l.status === 'live' && !l.match_id && (l.tournament_id || null) === row.tournament_id && same(l))?.id;
        const chId = fx.challengeId || (!row.tournament_id && !dbl ? S.data.challenges.find(c => c.status === 'accepted' && !c.match_id && same({ player1_id: c.from_id, player2_id: c.to_id }))?.id : null);
        if (chId) await S.store.update('challenges', chId, { status: 'done', match_id: saved.id }).catch(() => {});
        if (liveId) { await S.store.update('live_matches', liveId, { status: 'finished', match_id: saved.id }).catch(() => {}); delete S.liveLocal[liveId]; }
      }
      closeModal();
      toast(row.status === 'approved' ? 'Матч сохранён, рейтинг пересчитан' : 'Результат отправлен владельцу на подтверждение');
      if (m0 && m0.stage === 'ko' && m0.winner_id !== row.winner_id) toast('Победитель изменился — проверьте следующие раунды сетки', 'warn');
      await refresh();
    });
  }
}

function openMatchDetail(id) {
  const m = S.data.matches.find(x => x.id === id);
  if (!m) return;
  if (isDoubles(m)) return openDoublesDetail(m);
  const d = S.A.md.get(m.id);
  const a = P(m.player1_id), b = P(m.player2_id);
  const t = m.tournament_id ? tById(m.tournament_id) : null;
  const side = p => `<a href="#/player/${p.id}" class="md-p ${m.winner_id === p.id ? 'win' : ''}" data-act="close">${ava(p, 'lg')}<b>${esc(p.nickname)}</b>
    ${d ? `<small>${fmtR(d.before[p.id])} → ${fmtR(d.after[p.id])}</small>${delta(d.delta[p.id])}<small class="muted">шанс ${pct(d.exp[p.id])}</small>` : ''}</a>`;
  const canEdit = isAdmin() || (m.status === 'pending' && m.submitted_by === S.me.id);
  openModal(`
    <div class="md">
      <div class="mmeta center"><span class="badge ${m.type === 'tournament' ? 'tour' : 'free'}">${m.type === 'tournament' ? 'Турнир' : 'Свободная игра'}</span>${t ? `<a href="#/tournament/${t.id}" data-act="close" class="tname">${esc(t.name)}</a>` : ''}</div>
      <div class="md-top">${side(a)}<div class="md-score"><b>${m.sets1}:${m.sets2}</b></div>${side(b)}</div>
      ${m.sets?.length ? `<div class="md-sets">${m.sets.map((s, i) => `<div><small>П${i + 1}</small><span class="${s[0] > s[1] ? 'w' : ''}">${s[0]}</span><span class="${s[1] > s[0] ? 'w' : ''}">${s[1]}</span></div>`).join('')}</div>` : ''}
      <div class="muted small center">${fmtDT(m.played_at)} · до ${winsNeeded(m.best_of)} ${plural(winsNeeded(m.best_of), 'победы', 'побед', 'побед')}, партия до ${m.points_to}${m.status === 'pending' ? ' · ⏳ ждёт подтверждения' : ''}</div>
      ${m.note ? `<p class="center">«${esc(m.note)}»</p>` : ''}
      <div class="row-btns">
        <a class="btn ghost" href="#/h2h/${a.id}/${b.id}" data-act="close">⚔️ Все встречи</a>
        ${m.status === 'approved' ? `<button class="btn ghost" data-act="share-match" data-id="${m.id}">📤 Поделиться</button>` : ''}
        ${canEdit && isAdmin() ? `<button class="btn" data-act="edit-match" data-id="${m.id}">✏️ Изменить</button>` : ''}
        ${canEdit && !isAdmin() ? `<button class="btn danger ghost" data-act="withdraw-match" data-id="${m.id}">Отозвать</button>` : ''}
        ${isAdmin() && m.status === 'pending' ? `<button class="btn primary" data-act="approve-match" data-id="${m.id}">Подтвердить</button>` : ''}
      </div>
    </div>`);
}

function openDoublesDetail(m) {
  const d = S.D.md.get(m.id);
  const w1 = m.winner_id === m.player1_id;
  const pl = id => `<a href="#/player/${id}" class="dd-p" data-act="close">${ava(P(id), 'md')}<span><b>${esc(P(id).nickname)}</b>${d && m.rated !== false ? `<small>${fmtR(d.before[id])} → ${fmtR(d.after[id])} ${delta(d.delta[id], 'xs')}</small>` : ''}</span></a>`;
  const canEdit = isAdmin() || (m.status === 'pending' && m.submitted_by === S.me.id);
  openModal(`<div class="md">
    <div class="mmeta center"><span class="badge dbl">Пары 2×2</span>${m.rated === false ? '<span class="badge">без рейтинга</span>' : ''}</div>
    <div class="dd-top"><div class="dd-team ${w1 ? 'win' : ''}">${pl(m.player1_id)}${pl(m.player3_id)}</div>
      <div class="md-score"><b>${m.sets1}:${m.sets2}</b></div>
      <div class="dd-team ${!w1 ? 'win' : ''}">${pl(m.player2_id)}${pl(m.player4_id)}</div></div>
    ${m.sets?.length ? `<div class="md-sets">${m.sets.map((s2, i) => `<div><small>П${i + 1}</small><span class="${s2[0] > s2[1] ? 'w' : ''}">${s2[0]}</span><span class="${s2[1] > s2[0] ? 'w' : ''}">${s2[1]}</span></div>`).join('')}</div>` : ''}
    <div class="muted small center">${fmtDT(m.played_at)}${d && m.rated !== false ? ` · шанс команды 1 был ${pct(d.expA)}` : ''}${m.status === 'pending' ? ' · ⏳ ждёт подтверждения' : ''}</div>
    ${m.note ? `<p class="center">«${esc(m.note)}»</p>` : ''}
    <div class="row-btns">
      ${m.status === 'approved' ? `<button class="btn ghost" data-act="share-match" data-id="${m.id}">📤 Поделиться</button>` : ''}
      ${canEdit && isAdmin() ? `<button class="btn" data-act="edit-match" data-id="${m.id}">✏️ Изменить</button>` : ''}
      ${canEdit && !isAdmin() ? `<button class="btn danger ghost" data-act="withdraw-match" data-id="${m.id}">Отозвать</button>` : ''}
      ${isAdmin() && m.status === 'pending' ? `<button class="btn primary" data-act="approve-match" data-id="${m.id}">Подтвердить</button>` : ''}
    </div></div>`);
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

function openTournamentForm(pre = null) {
  const players = S.rank.map(x => x.p);
  const reg = pre ? tReg(pre) : [];
  const opt = (sel) => `<option value="">— никто —</option>${players.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.nickname)}</option>`).join('')}`;
  openModal(`<form data-form="tournament" class="stack tf" ${pre ? `data-t="${pre.id}"` : ''}>
    <div class="tf-main"><h3>${pre ? 'Начать турнир' : 'Новый турнир'}</h3>
    ${pre ? `<p class="muted small">Отмечены записавшиеся (${reg.length}). Можно добавить или убрать игроков.</p>` : ''}
    <label>Название<input name="name" required maxlength="60" value="${esc(pre?.name || '')}" placeholder="Например: Кубок офиса"></label>
    <div class="tf-sec"><small class="tf-lbl">Вид турнира</small><div class="tf-fmt">${[['ko', '🏆', 'Олимпийская', 'на вылет'], ['groups', '🗂', 'Группы', '+ плей-офф'], ['rr', '🔄', 'Круг', 'все со всеми']].map(([k, ic, v, d], n) => `<label><input type="radio" name="format" value="${k}" ${(pre ? pre.format === k : n === 0) ? 'checked' : ''}><span><i>${ic}</i><b>${v}</b><small>${d}</small></span></label>`).join('')}</div><p class="hint" id="fmt-hint"></p></div>
    <div class="tf-sec"><small class="tf-lbl">Участники</small><button type="button" class="tf-pick" id="t-open"><span class="tf-stack" id="t-stack"></span><b id="t-cnt">0 игроков</b><span class="tf-go">Выбрать игроков ›</span></button></div>
    <div class="two only-groups"><label>Игроков в группе<input type="number" name="gsize" value="4" min="2" max="16"></label><input type="hidden" name="groups" value="2"><label>Выходят из группы<select name="advance"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option><option value="4">4</option></select></label></div>
    <p class="hint only-groups" id="grp-hint"></p>
    <div class="tf-sec"><div class="tf-row2"><div><small class="tf-lbl">Столов</small><div class="tf-step"><button type="button" data-step="-1">−</button><input type="number" name="tables" value="1" min="1" max="8" readonly><button type="button" data-step="1">+</button></div></div>
      <div><small class="tf-lbl">Счёт</small><div class="tf-seg2"><label><input type="radio" name="scoring" value="points" checked><span>По очкам</span></label><label><input type="radio" name="scoring" value="final"><span>Только итог</span></label></div></div></div>
    <div id="tf-scorers"></div>
    <p class="hint">Пары по столам назначает система: закончилась игра — на свободный стол встаёт следующая пара. Роль секунданта можно передать в перерыве между партиями.</p></div>
    <div class="two"><label>До скольких побед<select name="best_of">${[[3, 'до 2 побед'], [5, 'до 3 побед'], [7, 'до 4 побед']].map(([v, l]) => `<option value="${v}" ${(pre?.best_of || 5) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Партия до<select name="points_to">${[11, 21].map(v => `<option ${(pre?.points_to || 11) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <label class="switch only-ko tf-switch"><input type="checkbox" name="thirdPlace" checked><i></i><span>Матч за 3-е место</span></label>
    <input type="hidden" name="date" value="${new Date().toISOString().slice(0, 10)}"><input type="hidden" name="place" value="${esc(pre?.place || '')}">
    <button class="btn primary full tf-create">${pre ? '▶ Начать турнир' : '🏆 Создать турнир'}</button></div>
    <div class="tf-players" hidden><div class="tf-ph"><button type="button" class="tf-back" id="t-back">←</button><h3>Выбор игроков</h3></div><input class="tf-search" placeholder="🔍 Найти игрока">
      <div class="tf-all"><span>Выбрано <b id="t-cnt2">0</b> из ${players.length}</span><a id="t-all">Все</a><a id="t-none">Никого</a></div>
      <div class="tf-list">${players.map(p => `<label class="tf-p" data-n="${esc(p.nickname.toLowerCase())}"><input type="checkbox" name="participants" value="${p.id}" ${reg.includes(p.id) ? 'checked' : ''}>${ava(p, 'sm')}<b>${esc(p.nickname)}</b><small>${fmtR(ratingOf(p.id))}</small><i>✓</i></label>`).join('')}</div>
      <button type="button" class="btn primary full tf-done" id="t-done">Готово</button></div></form>`, sh => {
    const f = sh.querySelector('form'), main = sh.querySelector('.tf-main'), pl = sh.querySelector('.tf-players');
    const fmt = () => f.querySelector('[name=format]:checked').value;
    const chosen = () => [...f.querySelectorAll('[name=participants]:checked')].map(x => x.value);
    const sync = () => {
      const F = fmt(), ids = chosen();
      sh.querySelectorAll('.only-groups').forEach(x => x.style.display = F === 'groups' ? '' : 'none');
      sh.querySelectorAll('.only-ko').forEach(x => x.style.display = F === 'rr' ? 'none' : '');
      sh.querySelector('#fmt-hint').innerHTML = FORMAT_HELP[F];
      sh.querySelector('#t-cnt').textContent = `${ids.length} ${plural(ids.length, 'игрок', 'игрока', 'игроков')}`;
      sh.querySelector('#t-cnt2').textContent = ids.length;
      sh.querySelector('#t-stack').innerHTML = ids.slice(0, 6).map(id => ava(P(id), 'xs')).join('');
      // как поделятся группы (любое число игроков — как можно ровнее)
      // число групп считается из «игроков в группе»: 11 игроков по 4 → 3 группы (4, 4, 3)
      const size = Math.max(2, +f.gsize.value || 4), g = Math.max(1, Math.min(Math.round(ids.length / size) || 1, Math.floor(ids.length / 2) || 1));
      f.groups.value = g;
      const sizes = Array.from({ length: g }, (_, k) => Math.floor(ids.length / g) + (k < ids.length % g ? 1 : 0));
      sh.querySelector('#grp-hint').textContent = ids.length >= 2 ? `${ids.length} ${plural(ids.length, 'игрок', 'игрока', 'игроков')} → ${sizes.map((n, k) => `группа ${String.fromCharCode(1040 + k)}: ${n}`).join(', ')}. Сильных система разводит по разным группам.` : '';
      // секундант на каждый стол (при счёте «только итог» не нужен)
      const T = Math.max(1, Math.min(8, +f.tables.value || 1)), box = sh.querySelector('#tf-scorers');
      const prev = [...box.querySelectorAll('select')].map(x => x.value);
      box.innerHTML = f.querySelector('[name=scoring]:checked').value === 'points' ? `<small class="tf-lbl">Секундант на каждом столе</small>${Array.from({ length: T }, (_, k) => `<label class="tf-sc"><span>Стол ${k + 1}</span><select name="scorer">${opt(prev[k] ?? (k === 0 ? S.me.id : ''))}</select></label>`).join('')}` : '';
    };
    f.addEventListener('change', e => { if (e.target.name !== 'scorer') sync(); }); f.addEventListener('input', e => { if (['gsize', 'tables'].includes(e.target.name)) sync(); }); sync();
    const show = on => { main.hidden = on; pl.hidden = !on; sh.scrollTop = 0; };
    sh.querySelector('#t-open').onclick = () => show(true);
    sh.querySelector('#t-back').onclick = () => { show(false); sync(); };
    sh.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { f.tables.value = Math.max(1, Math.min(8, (+f.tables.value || 1) + +b.dataset.step)); sync(); });
    sh.querySelector('#t-done').onclick = () => { show(false); sync(); };
    sh.querySelector('#t-all').onclick = () => { f.querySelectorAll('[name=participants]').forEach(x => x.checked = true); sync(); };
    sh.querySelector('#t-none').onclick = () => { f.querySelectorAll('[name=participants]').forEach(x => x.checked = false); sync(); };
    sh.querySelector('.tf-search').oninput = e => { const q = e.target.value.trim().toLowerCase(); pl.querySelectorAll('.tf-p').forEach(x => x.style.display = !q || x.dataset.n.includes(q) ? '' : 'none'); };
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
  'live-pause': el => busy(el, async () => {
    const l = S.data.live.find(x => x.id === el.dataset.id); if (!l) return;
    const from = livePaused(l) && el.dataset.m ? Date.parse(l.paused_until) : Date.now();
    await S.store.update('live_matches', l.id, { paused_until: new Date(from + 60e3).toISOString() }); await refresh();
  }),
  'live-resume': el => busy(el, async () => { await S.store.update('live_matches', el.dataset.id, { paused_until: null }); await refresh(); }),
  'live-pt': el => { const l = S.data.live.find(x => x.id === el.dataset.id); if (livePaused(l)) return toast('Пауза — сначала «Продолжить»', 'warn'); const log = liveLog(l); if (replayLive(log, l.best_of, l.points_to, l.first_server).winner === null) pushLive(l, [...log, +el.dataset.side]); },
  'live-minus': el => {
    const l = S.data.live.find(x => x.id === el.dataset.id); const log = [...liveLog(l)]; const side = +el.dataset.side;
    // убираем последнее очко этой стороны в текущей партии
    const g = replayLive(log, l.best_of, l.points_to, l.first_server);
    if (!g.cur[side]) return toast('В этой партии у игрока ещё нет очков', 'warn');
    const i = log.lastIndexOf(side); log.splice(i, 1); pushLive(l, log);
  },
  'live-undo': el => { const l = S.data.live.find(x => x.id === el.dataset.id); const log = liveLog(l); if (log.length) pushLive(l, log.slice(0, -1)); },
  'live-first': el => busy(el, async () => { await S.store.update('live_matches', el.dataset.id, { first_server: +el.dataset.side }); (S.served = S.served || {})[el.dataset.id] = true; await refresh(); }),
  // передать роль секунданта: только в перерыве (в текущей партии ещё нет очков)
  'live-pass': el => {
    const l = S.data.live.find(x => x.id === el.dataset.id); if (!l) return;
    const busyIds = new Set([l.player1_id, l.player2_id, l.player3_id, l.player4_id, l.scorer_id]);
    const list = S.rank.map(x => x.p).filter(p => !busyIds.has(p.id));
    openModal(`<h3>Кому передать роль секунданта?</h3><p class="muted small">Новый секундант продолжит вести счёт с того же места.</p>
      <div class="pick-list">${list.map(p => `<button class="pick" data-to="${p.id}"><span>${ava(p, 'xs')} ${esc(p.nickname)}</span></button>`).join('')}</div>`, sh => {
      sh.querySelectorAll('[data-to]').forEach(b => b.onclick = () => busy(b, async () => {
        const cur = S.data.live.find(x => x.id === l.id), g = replayLive(liveLog(cur), cur.best_of, cur.points_to, cur.first_server);
        if (g.cur[0] + g.cur[1] > 0) throw new Error('Партия уже идёт — передать можно в перерыве');
        await S.store.update('live_matches', l.id, { scorer_id: b.dataset.to });
        // стол турнира теперь закреплён за новым секундантом (может только владелец клуба)
        const t = l.tournament_id && tById(l.tournament_id);
        if (t && isAdmin() && (t.config.scorers || []).includes(l.scorer_id)) await S.store.update('tournaments', t.id, { config: { ...t.config, scorers: t.config.scorers.map(x => x === l.scorer_id ? b.dataset.to : x) } });
        closeModal(); await refresh(); toast(`Секундант теперь ${P(b.dataset.to).nickname}`);
      }));
    });
  },
  'task-claim': el => busy(el, async () => {
    S.coins = await S.store.rpc('claim_weekly_task', { cid: S.club.id, p_task: el.dataset.k });
    if (S.shop) S.shop.balance = S.coins;
    S.tasks = await S.store.rpc('weekly_tasks', { cid: S.club.id }); render(); toast('Награда получена 🎯');
  }),
  'pq-opp': el => { PLAY.opp = el.dataset.id; render(); },
  'pq-bo': el => { PLAY.bestOf = +el.dataset.v; render(); },
  'tb-n': el => { lsSet('ponghub_tables', String(Math.max(1, Math.min(12, +el.dataset.v)))); render(); },
  'pq-start': el => busy(el, async () => {
    if (!PLAY.opp) throw new Error('Выберите соперника');
    { const w = repeatBlocked(S.me.id, PLAY.opp); if (w) throw new Error(repeatMsg(w)); }
    const row = { kind: 'singles', type: 'free', player1_id: S.me.id, player2_id: PLAY.opp, player3_id: null, player4_id: null, best_of: PLAY.bestOf, points_to: 11, rated: true,
      tournament_id: null, stage: null, grp: null, round: null, slot: null, challenge_id: null, first_server: 0, log: [], status: 'live', scorer_id: S.me.id, started_by: S.me.id,
      scoring: el.dataset.s === '1', table_no: +el.dataset.t, ...testFlag() };
    const l = await S.store.insert('live_matches', row);
    if (predOn()) await S.store.rpc('create_pred_event', { src: 'live', src_id: l.id, chance: chanceFor(row) }).catch(() => {});
    PLAY.opp = null; await refresh(); go(`#/live/${l.id}`);
  }),
  'screen-freeze': el => busy(el, async () => {
    const m = +el.dataset.m; await S.store.rpc('screen_freeze', { cid: S.club.id, minutes: m });
    toast(m ? `Табло замерло на ${m} мин ⏸` : 'Табло снова показывает всё ▶'); renderScreens();
  }),
  'live-take': el => busy(el, async () => { await S.store.update('live_matches', el.dataset.id, { scorer_id: S.me.id }); await refresh(); toast('Теперь счёт ведёте вы'); }),
  'live-cancel': async el => {
    if (!(await confirmDialog('Отменить игру? Счёт не сохранится.', 'Отменить игру', true))) return;
    await busy(el, async () => { await S.store.update('live_matches', el.dataset.id, { status: 'cancelled' }); delete S.liveLocal[el.dataset.id]; await refresh(); go('#/home'); });
  },
  'live-save': el => saveLive(S.data.live.find(x => x.id === el.dataset.id), el),
  'live-final': el => {
    const l = S.data.live.find(x => x.id === el.dataset.id);
    openMatchForm({ fixed: { player1_id: l.player1_id, player2_id: l.player2_id, player3_id: l.player3_id, player4_id: l.player4_id, kind: l.kind,
      type: l.type, tournament_id: l.tournament_id, stage: l.stage, grp: l.grp, round: l.round, slot: l.slot, best_of: l.best_of, points_to: l.points_to,
      challengeId: l.challenge_id, liveId: l.id } });
  },
  challenge: el => { const w = repeatBlocked(S.me.id, el.dataset.id); if (w) return toast(repeatMsg(w), 'err'); openChallengeForm(el.dataset.id); },
  'share-player': el => busy(el, () => sharePlayer(el.dataset.id)),
  badge: el => { const b = S.badges?.[+el.dataset.i]; if (b) openModal(`<div class="center stack"><div class="bdg-big">${b.icon}</div><h3>${esc(b.name)}</h3><p class="muted">${esc(b.desc)}</p><button class="btn primary" data-act="close">Понятно</button></div>`); },
  'ch-accept': el => busy(el, async () => {
    const c = await S.store.update('challenges', el.dataset.id, { status: 'accepted', responded_at: new Date().toISOString() });
    if (predOn()) await S.store.rpc('create_pred_event', { src: 'challenge', src_id: c.id, chance: chanceFor({ player1_id: c.from_id, player2_id: c.to_id }) }).catch(() => {});
    await refresh(); toast('Вызов принят! У стола нажмите «▶ Начать игру» 🏓');
  }),
  'ch-decline': el => busy(el, async () => { await S.store.update('challenges', el.dataset.id, { status: 'declined', responded_at: new Date().toISOString() }); await refresh(); }),
  'ch-cancel': el => busy(el, async () => { await S.store.update('challenges', el.dataset.id, { status: 'cancelled' }); await refresh(); }),
  'ch-result': el => {
    const c = S.data.challenges.find(x => x.id === el.dataset.id);
    const other = c.from_id === S.me.id ? c.to_id : c.from_id;
    openMatchForm({ fixed: { player1_id: S.me.id, player2_id: other, type: 'free', challengeId: c.id } });
  },
  'ch-start': el => {
    const c = S.data.challenges.find(x => x.id === el.dataset.id);
    const other = c.from_id === S.me.id ? c.to_id : c.from_id;
    openMatchForm({ start: true, fixed: { player1_id: S.me.id, player2_id: other, type: 'free', challengeId: c.id } });
  },
  'new-ann': () => openAnnForm(),
  predict: el => openPredict(el.dataset.id),
  'pred-user': el => openPredUser(el.dataset.id),
  'pred-board': el => { document.getElementById('pred-board').dataset.period = el.dataset.p; document.querySelectorAll('[data-act=pred-board]').forEach(b => b.classList.toggle('on', b === el)); renderPredBoard(); },
  'del-ann': async el => { if (await confirmDialog('Удалить объявление? Оно пропадёт из ленты у всех.', 'Удалить', true)) await busy(el, async () => { await S.store.remove('announcements', el.dataset.id); await refresh(); }); },
  'test-create': el => busy(el, async () => { const n = await S.store.createTestPlayers(4); await refresh(); toast(`Создано тестовых игроков: ${n}`); }),
  'test-purge': async el => {
    if (!(await confirmDialog('Удалить всех тестовых игроков, их матчи, турниры, живые игры и записи о них в журнале? Настоящие данные не пострадают.', 'Удалить всё тестовое', true))) return;
    await busy(el, async () => { await S.store.purgeTest(); await refresh(); toast('Тестовые данные удалены без следа'); });
  },
  'restore-match': el => busy(el, async () => { await S.store.restoreMatch(+el.dataset.id); await refresh(); toast('Матч восстановлен'); }),
  'backup-now': el => busy(el, async () => { await S.store.backupNow(); toast('Резервная копия сохранена'); renderBackups(); }),
  'get-backup': el => busy(el, async () => { location.href = await S.store.backupUrl(el.dataset.name); }),
  'share-match': el => busy(el, async () => { await shareMatch(S.data.matches.find(m => m.id === el.dataset.id)); }),
  'ios-hint-later': () => { lsSet('ponghub_ios_hint_until', String(Date.now() + 3 * DAY)); document.querySelector('.ios-hint')?.remove(); },
  'push-on': el => busy(el, async () => { await enablePush(); toast('Уведомления включены 🔔'); renderPushBox(); }),
  'push-off': el => busy(el, async () => { await disablePush(); toast('Уведомления выключены'); renderPushBox(); }),
  'push-test': el => busy(el, async () => { await S.store.testPush(); toast('Отправлено — уведомление придёт через пару секунд'); }),
  logout: async () => { closeModal(); await disablePush().catch(() => {}); await S.store.signOut(); S.user = null; S.me = null; await reload(); location.hash = '#/login'; render(); },
  'demo-as': async el => { await S.store.signInAs(el.dataset.id); },
  'sb-bots': el => busy(el, async () => { const n = S.store.botsRequest(S.club.id); toast(n ? `🤖 ${n} ботов получили приглашение — заявки придут через пару секунд` : 'Все боты уже в клубе'); }),
  'sb-play': el => busy(el, async () => { S.store.botsPlay(S.club.id); toast('🏓 Боты сыграли 10 матчей — загляните в рейтинг'); }),
  'sb-live': el => busy(el, async () => { const id = S.store.botLive(S.club.id); go(`#/live/${id}`); }),
  'sb-hide': () => { lsSet('ponghub_sb_guide', 'hide'); render(); },
  'sb-reset': async () => { if (await confirmDialog('Начать песочницу заново? Ваш тестовый клуб и матчи удалятся.', 'Начать заново', true)) { S.store.reset(); await S.store.signOut(); location.hash = '#/login'; } },
  'demo-reset': async () => { if (await confirmDialog('Вернуть демо-данные к исходным?')) { S.store.reset(); await refresh(); toast('Демо-данные сброшены'); } },
  'add-match': () => openMatchForm(),
  match: el => openMatchDetail(el.dataset.id),
  'edit-match': el => { const m = S.data.matches.find(x => x.id === el.dataset.id); closeModal(); openMatchForm({ match: m }); },
  'withdraw-match': async el => { if (await confirmDialog('Отозвать отправленный результат?', 'Отозвать', true)) await busy(el, async () => { await S.store.deleteMatch(el.dataset.id, 'Отозван игроком'); closeModal(); await refresh(); toast('Результат отозван'); }); },
  'approve-match': el => busy(el, async () => { await S.store.update('matches', el.dataset.id, { status: 'approved' }); closeModal(); await refresh(); toast('Матч подтверждён'); }),
  'reject-match': async el => { const reason = await askReason('Отклонить результат?', 'Он будет удалён. Укажите причину.'); if (reason) await busy(el, async () => { await S.store.deleteMatch(el.dataset.id, 'Отклонён: ' + reason); await refresh(); toast('Результат отклонён'); }); },
  'approve-user': el => busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'approved' }); await refresh(); toast('Игрок принят в клуб 🎉'); }),
  'reject-user': async el => { if (await confirmDialog('Отклонить заявку?', 'Отклонить', true)) await busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'rejected' }); await refresh(); }); },
  'archive-user': async el => { if (await confirmDialog('Перенести игрока в архив? Его матчи сохранятся, но он пропадёт из рейтинга.')) await busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'archived', role: 'player' }); await refresh(); }); },
  'delete-user': async el => {
    const p = P(el.dataset.id);
    const games = S.A.games.get(p.id) || 0;
    const ok = await confirmDialog(`Убрать «${p.nickname}» из клуба? Аккаунт останется — он сможет вступить снова по приглашению. ${games ? `Его ${games} ${plural(games, 'матч', 'матча', 'матчей')} останутся в истории, рейтинг остальных не изменится.` : ''}`, 'Убрать', true);
    if (!ok) return;
    await busy(el, async () => { await S.store.adminDeletePlayer(p.id); await refresh(); toast('Игрок убран из клуба'); });
  },
  'restore-user': el => busy(el, async () => { await S.store.update('profiles', el.dataset.id, { status: 'approved' }); await refresh(); }),
  'edit-profile': () => openProfileForm(),
  'change-pass': () => openModal(`<form data-form="newpass" class="stack"><h3>Новый пароль</h3><label>Пароль<input name="password" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn primary">Сохранить</button></form>`),
  theme: el => { try { localStorage.setItem('ponghub_theme', el.dataset.v); } catch { /* */ } applyTheme(); render(); },
  install: async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; render(); },
  'h2h-pick': () => go(`#/h2h/${S.me.id}`),
  'new-tournament': () => openModal(`<div class="stack"><h3>Новый турнир</h3>
    <button class="btn primary big full" data-act="t-announce">📅 Объявить заранее<small style="display:block;font-weight:500;opacity:.9">дата, место и запись участников</small></button>
    <button class="btn big full" data-act="t-now">▶ Начать сейчас<small style="display:block;font-weight:500;opacity:.8">выбрать игроков и сразу сетку</small></button></div>`),
  't-announce': () => openAnnounceForm(),
  't-now': () => openTournamentForm(),
  't-edit': el => openAnnounceForm(tById(el.dataset.t)),
  't-start': el => openTournamentForm(tById(el.dataset.t)),
  'tp-join': el => busy(el, async () => {
    const box = document.getElementById('tp-box'), on = el.dataset.on === '1';
    await S.store.rpc('tournament_join', { tid: box.dataset.t, p_code: box.dataset.code || null, p_on: on });
    S.ctx = await S.store.loadContext();
    toast(on ? 'Вы записаны на турнир ✍️' : 'Запись отменена');
    await renderTournamentPublic();
  }),
  'tp-push': el => busy(el, async () => { await enablePush(); toast('Уведомления включены 🔔'); await renderTournamentPublic(); }),
  't-signup': el => busy(el, async () => { await S.store.tournamentSignup(el.dataset.t, el.dataset.on === '1'); await refresh(); toast(el.dataset.on === '1' ? 'Вы записаны на турнир ✍️' : 'Запись отменена'); }),
  't-qr-svg': el => busy(el, () => downloadTourQr(tById(el.dataset.t), 'svg')),
  't-qr-png': el => busy(el, () => downloadTourQr(tById(el.dataset.t), 'png')),
  't-poster': el => busy(el, () => printTour(tById(el.dataset.t))),
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
      if (isAdmin() && await confirmDialog('Этот результат больше не соответствует сетке (изменился победитель предыдущего раунда). Удалить его?', 'Удалить', true))
        await busy(null, async () => { await S.store.deleteMatch(c.conflict.id, 'Устарел после изменения сетки'); await refresh(); });
      return;
    }
    if (c.match && !(isAdmin() && t.status === 'active')) return openMatchDetail(c.match.id);
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
    const reason = await askReason('Удалить турнир?', 'Вместе со всеми его матчами. Рейтинг будет пересчитан.');
    if (!reason) return;
    await busy(el, async () => { await S.store.deleteTournament(el.dataset.t, reason); go('#/tournaments'); await refresh(); toast('Турнир удалён'); });
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
  'test-mode': async el => {
    lsSet('ponghub_testmode', el.checked ? '1' : '0');
    await refresh();
    toast(el.checked ? 'Тестовый режим включён' : 'Тестовый режим выключен — тестовые данные скрыты');
  },
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
  'sb-start': async (f, fd) => {
    const nickname = fd.get('nickname').trim();
    if (!(await S.store.nicknameAvailable(nickname))) throw new Error('Такой ник уже у бота — выберите другой');
    await S.store.signUp({ email: `me-${Date.now()}@sandbox.ponghub.app`, password: String(Math.random()), nickname, full_name: nickname });
    lsSet('ponghub_join', ''); lsSet('ponghub_after', '');
    location.hash = '#/newclub';
  },
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
    for (const k of ['initialRating', 'kTournament', 'kFree', 'spread', 'newcomerGames', 'newcomerMult', 'kDoubles', 'decayGraceDays', 'decayPerWeek', 'seasonMinMatches',
      'leagueWin', 'leagueWinSlope', 'leagueWinMax', 'leagueLoss', 'leagueLossSlope', 'leagueLossMax', 'leagueFreeMult']) s[k] = +fd.get(k);
    s.system = fd.get('system') === 'elo' ? 'elo' : 'league';
    s.decayEnabled = !!fd.get('decayEnabled');
    s.predEnabled = !!fd.get('predEnabled');
    s.remindIdle = !!fd.get('remindIdle');
    for (const k of ['predStart', 'predMin', 'predMax', 'predWindowMin']) s[k] = Math.round(+fd.get(k) || 0);
    s.repeatLimit = Math.max(0, Math.round(+fd.get('repeatLimit') || 0));
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
    const scoring = fd.get('scoring') === 'final' ? 'final' : 'points';
    const config = { thirdPlace: !!fd.get('thirdPlace'), tables: Math.max(1, Math.min(8, +fd.get('tables') || 1)), scoring,
      scorers: scoring === 'points' ? fd.getAll('scorer').map(x => x || null) : [] };
    if (format === 'ko') config.slots = slotsFromSeeds(sorted);
    if (format === 'groups') {
      const g = Math.max(1, Math.min(+fd.get('groups') || 1, Math.floor(ids.length / 2)));
      config.groups = snakeGroups(sorted, g);
      config.advance = Math.min(+fd.get('advance') || 2, Math.min(...config.groups.map(x => x.length)));
    }
    const row = { name: fd.get('name').trim(), date: fd.get('date') || null, place: (fd.get('place') || '').trim(), format,
      best_of: +fd.get('best_of'), points_to: +fd.get('points_to'), status: 'active', participants: sorted, results: null };
    const pre = f.dataset.t && tById(f.dataset.t);
    const t = pre ? (await S.store.update('tournaments', pre.id, { ...row, config: { ...config, note: pre.config?.note, prizes: pre.config?.prizes } }), pre)
      : await S.store.insert('tournaments', { ...row, config, created_by: S.me.id, ...testFlag() });
    closeModal(); await refresh(); go(`#/tournament/${t.id}`); toast(pre ? 'Турнир начался! 🏓' : 'Турнир создан!');
  },
  't-announce': async (f, fd) => {
    const byMonth = fd.get('dmode') === 'month';
    let when;
    if (byMonth) {
      const m = fd.get('month');
      if (!/^\d{4}-\d{2}$/.test(m || '')) throw new Error('Выберите месяц и год');
      when = { starts_at: null, date: `${m}-01` };
    } else {
      const at = new Date(fd.get('starts_at'));
      if (isNaN(at)) throw new Error('Укажите дату и время');
      when = { starts_at: at.toISOString(), date: toLocalInput(at).slice(0, 10) };
    }
    const row = { name: fd.get('name').trim(), ...when, place: fd.get('place').trim(), format: fd.get('format'), best_of: +fd.get('best_of'), points_to: +fd.get('points_to') };
    const extra = { note: fd.get('note').trim() || null, prizes: fd.get('pmode') === 'yes' ? fd.get('prizes').trim() || null : null, dateMode: byMonth ? 'month' : 'exact' };
    const old = f.dataset.t && tById(f.dataset.t);
    const t = old ? (await S.store.update('tournaments', old.id, { ...row, config: { ...old.config, ...extra } }), old)
      : await S.store.insert('tournaments', { ...row, status: 'open', participants: [], registered: [], config: extra, results: null, created_by: S.me.id, ...testFlag() });
    closeModal(); await refresh(); go(`#/tournament/${t.id}`); toast(old ? 'Сохранено' : 'Запись на турнир открыта 📣');
  },
  ann: async (f, fd) => {
    const body = fd.get('body').trim();
    if (!body) throw new Error('Напишите текст объявления');
    const some = f.dataset.to === 'some';
    const to = fd.getAll('to');
    if (some && !to.length) throw new Error('Выберите хотя бы одного игрока');
    await S.store.insert('announcements', { title: fd.get('title').trim() || null, body, created_by: S.me.id, recipients: some ? to : null, ...testFlag() });
    closeModal(); await refresh(); toast(some ? `Отправлено: ${to.length} ${plural(to.length, 'игроку', 'игрокам', 'игрокам')} ✉️` : 'Объявление отправлено всем 📢');
  },
  challenge: async (f, fd) => {
    await S.store.insert('challenges', { from_id: S.me.id, to_id: fd.get('to'), status: 'pending', message: fd.get('message').trim() || null, ...testFlag() });
    closeModal(); await refresh(); toast('Вызов отправлен ⚔️');
  },
  event: async (f, fd) => {
    await S.store.insert('events', { title: fd.get('title').trim(), starts_at: new Date(fd.get('starts_at')).toISOString(), place: fd.get('place').trim(), note: fd.get('note').trim(), attendees: [S.me.id], created_by: S.me.id });
    closeModal(); await refresh(); toast('Событие добавлено');
  },
};

Object.assign(ACT, CLUB_ACT, SHOP_ACT);
Object.assign(CHANGE, CLUB_CHANGE);
Object.assign(FORMS, CLUB_FORMS);

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
  const inp = e.target.closest('[data-input]');
  if (inp?.dataset.input === 'dir-search') { clearTimeout(dirTimer); dirTimer = setTimeout(() => renderDirectory(inp.value), 300); }
  if (inp?.dataset.input === 'map-search') renderMapList(inp.value);
  if (inp?.dataset.input === 'pl-search') filterPlayers(inp.value);
  if (inp?.dataset.input === 'addr') addrInput(inp);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset?.input === 'addr') e.preventDefault();
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
const isIOS = () => !/android/i.test(navigator.userAgent) && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function b64ToBytes(b64) {
  const raw = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
// ───────────── Окна при входе: «Что нового» и напоминание об уведомлениях ─────────────
const WHATS_NEW = {
  id: '2026-10-players',
  title: 'Игроки, значки и сезоны 🎉',
  items: [
    ['👥', 'Вкладка «Игроки»', 'Все участники клуба в одном списке: поиск, кто когда играл и кнопка «Вызвать» прямо в строке.'],
    ['📤', 'Карточка игрока для чата', 'В профиле любого игрока — «Карточка в чат»: картинка с рейтингом, лигой и значками и ссылка, чтобы вызвать на матч.'],
    ['🏅', 'Значки в профиле', 'Достижения, титулы сезонов и вызовы — значками под ником. Нажмите на значок, чтобы узнать, за что он.'],
    ['🗓', 'Сезоны', 'Ваше место в текущем сезоне и сколько дней до конца. Призёры месяца получают 🏆 🥈 🥉 в профиль.'],
    ['🔔', 'Напоминания', 'Давно не играли — придёт напоминание с соперником по силам, которого можно вызвать.'],
  ],
  cta: ['Открыть игроков', '#/players'],
};

async function startupModals() {
  if (route().name === 'tv') return;
  if (!S.club || !S.me || S.me.status !== 'approved' || S.startupDone === S.me.id) return;
  S.startupDone = S.me.id;
  if (lsGet('ponghub_seen_news') !== WHATS_NEW.id) return showWhatsNew();
  await maybeAskPush();
}

function showWhatsNew() {
  lsSet('ponghub_seen_news', WHATS_NEW.id);
  const close = () => { lsSet('ponghub_seen_news', WHATS_NEW.id); closeModal(); setTimeout(maybeAskPush, 400); };
  openModal(`<div class="wn">
    <div class="wn-badge">Обновление</div>
    <h3>${WHATS_NEW.title}</h3>
    ${WHATS_NEW.items.map(([ic, t, d]) => `<div class="wn-item"><span>${ic}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    <div class="wn-btns"><button class="btn ghost" id="wn-ok">Понятно</button><button class="btn primary" id="wn-go">${WHATS_NEW.cta[0]}</button></div>
  </div>`, sh => {
    sh.classList.add('center-sheet');
    sh.querySelector('#wn-ok').onclick = close;
    sh.querySelector('#wn-go').onclick = () => { close(); location.hash = WHATS_NEW.cta[1]; };
    sh.querySelector('.sheet-x').onclick = close;
  });
}

async function maybeAskPush() {
  if (S.store.mode === 'demo' || $modal.classList.contains('open')) return;
  if (Date.now() < +(lsGet('ponghub_push_later') || 0)) return;
  const st = await pushState();
  if (!['off', 'ios-install', 'denied'].includes(st)) return;
  const later = () => { lsSet('ponghub_push_later', String(Date.now() + 3 * DAY)); closeModal(); };
  const body = {
    off: `<p>Чтобы не пропустить <b>вызов на матч</b>, открытые <b>прогнозы</b> и <b>итоги недели</b>, включите уведомления — это одно нажатие.</p>
      <div class="wn-btns"><button class="btn ghost" id="pn-later">Позже</button><button class="btn primary" id="pn-on">🔔 Включить</button></div>`,
    'ios-install': `<p>На iPhone уведомления работают только в установленном приложении. Нажмите <b>«Поделиться» ⬆︎</b> внизу Safari → <b>«На экран „Домой“»</b>, откройте PongHub с иконки и включите уведомления в Профиле.</p>
      <div class="wn-btns"><button class="btn primary" id="pn-later">Понятно</button></div>`,
    denied: `<p>Уведомления для PongHub сейчас запрещены в настройках. Откройте <b>Настройки телефона → Уведомления</b> (или настройки сайта в браузере) и разрешите их для PongHub — тогда вы не пропустите вызовы, прогнозы и итоги.</p>
      <div class="wn-btns"><button class="btn primary" id="pn-later">Понятно</button></div>`,
  }[st];
  openModal(`<div class="wn pn"><div class="pn-ic">🔔</div><h3>Включите уведомления</h3>${body}</div>`, sh => {
    sh.classList.add('center-sheet');
    sh.querySelector('#pn-later').onclick = later;
    sh.querySelector('.sheet-x').onclick = later;
    sh.querySelector('#pn-on')?.addEventListener('click', ev => busy(ev.target, async () => { await enablePush(); closeModal(); toast('Уведомления включены 🔔'); }));
  });
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
  // название клуба в шапке: уменьшаем шрифт (до 16px), не влезло — переносим на две строки
  document.querySelectorAll('.club-switch span').forEach(el => {
    el.style.fontSize = ''; el.classList.remove('wrap');
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 16) { size -= 1; el.style.fontSize = size + 'px'; }
    if (el.scrollWidth > el.clientWidth) {
      el.classList.add('wrap');
      while (el.scrollHeight > el.clientHeight + 1 && size > 12) { size -= 1; el.style.fontSize = size + 'px'; }
    }
  });
  // «Привет, ник» в плитке: уменьшаем; совсем длинный ник — на свою строку под «Привет,» и тоже по ширине
  document.querySelectorAll('.bt-hi').forEach(el => {
    el.style.fontSize = ''; el.classList.remove('hi2'); const nb = el.querySelector('b'); if (nb) nb.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > 12) { size -= .5; el.style.fontSize = size + 'px'; }
    if (el.scrollWidth <= el.clientWidth + 1) return;
    el.classList.add('hi2'); el.style.fontSize = '';
    const b = el.querySelector('b'); b.style.fontSize = ''; size = parseFloat(getComputedStyle(b).fontSize);
    while (b.scrollWidth > el.clientWidth + 1 && size > 9) { size -= .5; b.style.fontSize = size + 'px'; }
  });
  document.querySelectorAll('.hero-nick').forEach(el => {
    el.style.fontSize = ''; el.classList.remove('wrap');
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 18) { size -= 1; el.style.fontSize = size + 'px'; }
    if (el.scrollWidth > el.clientWidth) el.classList.add('wrap');
  });
}
addEventListener('resize', () => fitNicks());

function afterRender(r) {
  maybeCollectionNotice();
  maybeGiftNotice();
  fitNicks();
  document.fonts?.ready.then(fitNicks);
  if (r.name === 'me') renderPushBox();
  if (r.name === 'predict') renderPredBoard();
  if (r.name === 'admin' && r.args[0] === 'log') renderAudit();
  if (r.name === 'admin' && r.args[0] === 'data') renderBackups();
  if (r.name === 'admin' && r.args[0] === 'screens') renderScreens();
  if (r.name === 'inventory') { if (!S.shop && feature('shop')) ensureShop().then(render).catch(e => toast(e.message, 'err')); else renderInventory(); }
  if (r.name === 'shop') { if (!S.shop && feature('shop')) ensureShop().then(render).catch(e => toast(e.message, 'err')); else { renderShopList(); if (SHOP.region === 'skin') loadSkins().then(() => { if (route().name === 'shop' && SHOP.region === 'skin') renderShopList(); }); } }
  if (r.name === 'racket') { if (!S.shop && feature('shop')) ensureShop().then(render).catch(e => toast(e.message, 'err')); else mountRacket(); }
  if (r.name === 'player' && feature('shop')) { ensureThree(); mountPlayerRackets(); }
  if (r.name === 'avatar' && feature('avatar')) mountAvatarView(r);
  if (r.name === 'home') { mountHome3D(); requestAnimationFrame(balanceHome); }
  if (r.name === 'print' || r.name === 'tables') renderPrint();
  if (r.name === 'tournament' && isAdmin()) renderTourQr();
  if (r.name === 'tournament') renderTournamentPublic();
  if (document.getElementById('dir-box')) renderDirectory(document.querySelector('[data-input=dir-search]')?.value || '');
  if (document.getElementById('pick-map')) mountPickMap();
  if (r.name === 'invite') renderInvite();
  if (r.name === 'map') renderMap();
  if (r.name === 'club' && r.args[0]) renderClubPage(r.args[0], r.q.get('code'), r.q.get('auto') === '1', r.q.get('table'), r.q.get('tour') === '1');
  if (r.name === 'founder') renderFounder();
  if (r.name === 'join' && r.args[0] && S.user) openInvite(r.args[0]);
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
      setTimeout(startupModals, 800);
    }
  });
  S.store.subscribe(async () => {
    await reload();
    // не перерисовываем, пока человек что-то печатает в форме на странице
    const ae = document.activeElement;
    if (ae && $app.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
    if (!$modal.classList.contains('open')) render(); else S.modalRefresh?.();
  });
  // открыли из фона: если вышла новая версия — перезагружаемся, иначе просто обновляем данные
  let appVer = null;
  const verOf = async () => { try { return ((await (await fetch('sw.js', { cache: 'no-store' })).text()).match(/CACHE = '([^']+)'/) || [])[1] || null; } catch { return null; } };
  verOf().then(v => { appVer = v; });
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    const v = await verOf();
    if (appVer && v && v !== appVer && !$modal.classList.contains('open')) { location.reload(); return; }
    if (S.user) { await reload(); if (!$modal.classList.contains('open')) render(); }
  });
  addEventListener('hashchange', () => { closeModal(); render(); });
  // окно растянули до компьютерной ширины или сузили до телефонной — перерисовываем раскладку
  matchMedia('(min-width: 1024px)').addEventListener?.('change', () => { if (!$modal.classList.contains('open')) render(); });
  render();
  document.getElementById('splash')?.remove();
  setTimeout(startupModals, 800);
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
boot();

// iOS: запрет масштабирования щипком (в установленном приложении иначе экран «растягивается» как в браузере)
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
