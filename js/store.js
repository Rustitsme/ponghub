// Слой данных: Supabase (боевой режим) или localStorage (демо-режим, если база не настроена).
import { CONFIG } from './config.js';
import { parseKey, priceOf, SKINS } from './shop-catalog.js';
import { analyze, playerStats, DEFAULT_SETTINGS, replayLive } from './engine.js';

const TABLES = ['profiles', 'matches', 'tournaments', 'events', 'challenges', 'live_matches', 'announcements', 'pred_events', 'predictions', 'coin_tx', 'clubs', 'club_members', 'platform'];
// данные, которые принадлежат клубу (club_id подставляется автоматически)
const CLUB_TABLES = ['matches', 'tournaments', 'events', 'challenges', 'live_matches', 'announcements', 'pred_events', 'predictions', 'coin_tx'];
// роли и статусы участника клуба → в привычные приложению значения профиля
const ROLE_OUT = { owner: 'admin', helper: 'editor', player: 'player' };
const ROLE_IN = { admin: 'owner', editor: 'helper', player: 'player' };
const STATUS_IN = { approved: 'active', archived: 'archived', rejected: 'rejected', pending: 'pending' };
export function overlayMember(p, m) {
  if (!m) return p;
  const status = p.status === 'deleted' ? 'deleted'
    : { active: 'approved', pending: 'pending', archived: 'archived', former: 'archived' }[m.status] || 'archived';
  return { ...p, role: ROLE_OUT[m.role] || 'player', status, initial_rating: m.initial_rating, club_status: m.status, joined_at: m.joined_at };
}
// ── Доступ к базе с VPN и без ──
// В России адреса Supabase часто блокируют, а сайт открывается. Тогда ходим в базу через свой сайт:
// Vercel пересылает /sb/… в Supabase (vercel.json). Напрямую — если база доступна (быстрее и с живыми обновлениями).
const PROXY = () => `${location.origin}/sb`;
let BASE = CONFIG.SUPABASE_URL;
// фото из хранилища — тем же путём, что и база
export const media = u => (u && BASE !== CONFIG.SUPABASE_URL && u.startsWith(CONFIG.SUPABASE_URL) ? BASE + u.slice(CONFIG.SUPABASE_URL.length) : u);
async function reachable(url, ms) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY }, signal: c.signal, cache: 'no-store' }); return r.ok; }
  catch { return false; } finally { clearTimeout(t); }
}
async function pickBase() {
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
  // в прошлый раз напрямую не вышло — сразу через сайт, а прямой путь проверяем в фоне на следующий запуск
  if (lsGet('ponghub_route') === 'proxy') { reachable(CONFIG.SUPABASE_URL, 4000).then(ok => ok && lsSet('ponghub_route', 'direct')); return PROXY(); }
  if (await reachable(CONFIG.SUPABASE_URL, 3000)) { lsSet('ponghub_route', 'direct'); return CONFIG.SUPABASE_URL; }
  lsSet('ponghub_route', 'proxy');
  return PROXY();
}

// функции, которым нужен текущий клуб
const RPC_CID = new Set(['ensure_wallet', 'coin_leaderboard', 'player_predictions']);

// Песочница (?sandbox=1): своя копия приложения в браузере тестировщика — свой клуб и боты, реальная база не трогается
// Песочница живёт на отдельном адресе, в имени которого есть слово sandbox (например ponghub-sandbox.vercel.app).
// Там это всегда песочница: убрать что-то из ссылки нельзя, а localStorage у адреса свой, отдельный от настоящего приложения.
const HOST_SANDBOX = (() => { try { return /(^|[.-])sandbox([.-]|$)/i.test(location.hostname); } catch { return false; } })();
export const SANDBOX_HOSTED = HOST_SANDBOX;
export const SANDBOX = (() => {
  try {
    if (HOST_SANDBOX) return true;
    const q = new URLSearchParams(location.search);
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    // на настоящем адресе ссылка ?sandbox=1 перенаправляет на отдельный адрес песочницы (если он задан в config.js)
    if (q.has('sandbox') && CONFIG.SANDBOX_URL && !local) { location.replace(CONFIG.SANDBOX_URL); return false; }
    if (q.has('sandbox')) localStorage.setItem('ponghub_sandbox', '1');
    if (q.has('nosandbox')) localStorage.removeItem('ponghub_sandbox');   // служебная ссылка владельца: вернуться в обычное приложение
    return localStorage.getItem('ponghub_sandbox') === '1' && (!CONFIG.SANDBOX_URL || local);
  } catch { return false; }
})();

export async function createStore() {
  if (SANDBOX) return new LocalStore(true);
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    const s = new SupaStore();
    await s.connect();
    return s;
  }
  return new LocalStore();
}

function translateError(e) {
  const msg = (e && (e.message || e.error_description)) || String(e);
  const map = [
    [/Invalid login credentials/i, 'Неверный email или пароль'],
    [/Email not confirmed/i, 'Email не подтверждён — проверьте почту (письмо от Supabase)'],
    [/User already registered/i, 'Этот email уже зарегистрирован'],
    [/Password should be at least/i, 'Пароль слишком короткий (минимум 6 символов)'],
    [/rate limit/i, 'Слишком много попыток. Подождите минуту и попробуйте снова'],
    [/row-level security|permission denied/i, 'Недостаточно прав для этого действия'],
    [/Failed to fetch|NetworkError/i, 'Нет связи с сервером. Проверьте интернет'],
    [/duplicate key.*nickname/i, 'Такой ник уже занят'],
  ];
  for (const [re, ru] of map) if (re.test(msg)) return new Error(ru);
  return new Error(msg);
}

class SupaStore {
  mode = 'supabase';

  async connect() {
    const [{ createClient }, base] = await Promise.all([import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm'), pickBase()]);
    BASE = base; this.proxy = base !== CONFIG.SUPABASE_URL;
    this.sb = createClient(base, CONFIG.SUPABASE_ANON_KEY, {
      // ключ сессии — один и тот же при любом пути, чтобы при включении/выключении VPN не выкидывало из аккаунта
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: `sb-${new URL(CONFIG.SUPABASE_URL).hostname.split('.')[0]}-auth-token` },
    });
  }

  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user || null;
  }

  onAuth(cb) {
    this.sb.auth.onAuthStateChange((event, session) => cb(event, session?.user || null));
  }

  redirectUrl() { return location.origin + location.pathname; }

  async signUp({ email, password, nickname, full_name }) {
    const { data, error } = await this.sb.auth.signUp({
      email, password,
      options: { data: { nickname, full_name }, emailRedirectTo: this.redirectUrl() },
    });
    if (error) throw translateError(error);
    return { user: data.user, needsConfirm: !data.session };
  }

  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw translateError(error);
    return data.user;
  }

  async signOut() { await this.sb.auth.signOut(); }

  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: this.redirectUrl() });
    if (error) throw translateError(error);
  }

  async updatePassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw translateError(error);
  }

  async nicknameAvailable(n) {
    const { data, error } = await this.sb.rpc('nickname_available', { n });
    if (error) throw translateError(error);
    return data;
  }

  // контекст: мой профиль, мои клубы, флаги платформы
  async loadContext() {
    const { data: { user } } = await this.sb.auth.getUser();
    if (!user) return null;
    const [me, mem, pl, mf] = await Promise.all([
      this.sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      this.sb.from('club_members').select('*, club:clubs(*)').eq('user_id', user.id),
      this.sb.from('platform').select('*'),
      this.sb.rpc('my_features'),
    ]);
    if (me.error) throw translateError(me.error);
    const platform = Object.fromEntries((pl.data || []).map(r => [r.key, r.value]));
    const clubs = (mem.data || []).filter(m => m.club && ['active', 'pending'].includes(m.status))
      .map(m => ({ ...m.club, my_role: m.role, my_status: m.status }));
    // нововведения, открытые мне (тестировщикам — раньше всех)
    return { me: me.data, clubs, platform, myFeatures: mf.error ? [] : (mf.data || []) };
  }

  setClub(club) { this.club = club || null; this.cid = club?.id || null; }

  async loadAll() {
    const cid = this.cid;
    const q = t => this.sb.from(t).select('*').eq('club_id', cid);
    const [mem, m, t, e, c, l, a, pe, pr, cl] = await Promise.all([
      this.sb.from('club_members').select('*, profile:profiles(*)').eq('club_id', cid),
      q('matches'), q('tournaments'), q('events'), q('challenges'),
      q('live_matches').eq('status', 'live'),
      q('announcements').order('created_at', { ascending: false }).limit(100),
      q('pred_events').order('created_at', { ascending: false }).limit(150),
      q('predictions').order('created_at', { ascending: false }).limit(300),
      this.sb.from('clubs').select('*').eq('id', cid).maybeSingle(),
    ]);
    for (const r of [mem, m, t, e, cl]) if (r.error) throw translateError(r.error);
    if (cl.data) this.club = cl.data;
    const profiles = (mem.data || []).filter(x => x.profile).map(x => overlayMember(x.profile, x));
    const settings = { ...(this.club?.settings || {}), clubName: this.club?.name };
    return { profiles, matches: m.data, tournaments: t.data, events: e.data, challenges: c.error ? [] : c.data, live: l.error ? [] : l.data, announcements: a.error ? [] : a.data, predEvents: pe.error ? [] : pe.data, predictions: pr.error ? [] : pr.data, settings };
  }

  withClub(table, row) { return CLUB_TABLES.includes(table) && !row.club_id ? { ...row, club_id: this.cid } : row; }

  async insert(table, row) {
    const { data, error } = await this.sb.from(table).insert(this.withClub(table, row)).select().single();
    if (error) throw translateError(error);
    return data;
  }

  async insertMany(table, rows) {
    if (!rows.length) return [];
    const { data, error } = await this.sb.from(table).insert(rows.map(r => this.withClub(table, r))).select();
    if (error) throw translateError(error);
    return data;
  }

  async update(table, id, patch) {
    if (table === 'profiles') {
      const { role, status, initial_rating, ...rest } = patch;
      if (role !== undefined || status !== undefined || initial_rating !== undefined) {
        await this.rpc('set_member', {
          cid: this.cid, uid: id, p_role: role ? ROLE_IN[role] : null, p_status: status ? STATUS_IN[status] : null,
          p_initial: initial_rating ?? null, p_clear_initial: initial_rating === null,
        });
      }
      if (!Object.keys(rest).length) return { id, ...patch };
      patch = rest;
    }
    const { data, error } = await this.sb.from(table).update(patch).eq('id', id).select();
    if (error) throw translateError(error);
    if (!data.length) throw new Error('Недостаточно прав для этого действия');
    return data[0];
  }

  async remove(table, id) {
    const { error } = await this.sb.from(table).delete().eq('id', id);
    if (error) throw translateError(error);
  }

  async saveSettings(data) {
    const { clubName, ...settings } = data;
    await this.rpc('update_club', { cid: this.cid, patch: { settings, ...(clubName && clubName !== this.club?.name ? { name: clubName } : {}) } });
  }

  async toggleRsvp(eventId) {
    const { error } = await this.sb.rpc('toggle_rsvp', { event_id: eventId });
    if (error) throw translateError(error);
  }

  // запись на турнир (пока запись открыта) — сам участник клуба
  async tournamentSignup(tid, on) { return this.rpc('tournament_signup', { tid, p_on: on }); }

  async rpc(name, args = {}) {
    if (RPC_CID.has(name)) args = { cid: this.cid, ...args };
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw translateError(error);
    return data;
  }

  async createTestPlayers(n) {
    const { data, error } = await this.sb.rpc('admin_create_test_players', { cid: this.cid, n });
    if (error) throw translateError(error);
    return data;
  }

  async purgeTest() {
    const { error } = await this.sb.rpc('admin_purge_test', { cid: this.cid });
    if (error) throw translateError(error);
  }

  async deleteMatch(id, reason) {
    const { error } = await this.sb.rpc('delete_match', { mid: id, reason });
    if (error) throw translateError(error);
  }

  async deleteTournament(id, reason) {
    const { error } = await this.sb.rpc('delete_tournament', { tid: id, reason });
    if (error) throw translateError(error);
  }

  async loadAudit(limit = 300) {
    const { data, error } = await this.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit);
    if (error) throw translateError(error);
    return data;
  }

  async restoreMatch(logId) {
    const { error } = await this.sb.rpc('restore_match', { log_id: logId });
    if (error) throw translateError(error);
  }

  async listBackups() {
    const { data, error } = await this.sb.storage.from('backups').list('', { sortBy: { column: 'name', order: 'desc' }, limit: 50 });
    if (error) throw translateError(error);
    return (data || []).filter(f => f.name.endsWith('.json'));
  }

  async backupUrl(name) {
    const { data, error } = await this.sb.storage.from('backups').createSignedUrl(name, 120, { download: name });
    if (error) throw translateError(error);
    return data.signedUrl;
  }

  async backupNow() {
    const { data, error } = await this.sb.functions.invoke('notify', { body: { action: 'backup' } });
    if (error || !data?.name) throw new Error('Не удалось сделать резервную копию');
    return data.name;
  }

  // убрать из клуба (владелец клуба). Матчи остаются в истории
  async adminDeletePlayer(id) { await this.rpc('remove_member', { cid: this.cid, uid: id }); }

  // полностью удалить аккаунт (основатель)
  async founderDeletePlayer(id) {
    const { data: files } = await this.sb.storage.from('avatars').list(id);
    if (files?.length) await this.sb.storage.from('avatars').remove(files.map(f => `${id}/${f.name}`));
    const { error } = await this.sb.rpc('admin_delete_player', { target: id });
    if (error) throw translateError(error);
  }

  async adminEmails() {
    const { data, error } = await this.sb.rpc('admin_emails');
    if (error) return new Map();
    return new Map((data || []).map(r => [r.id, r.email?.endsWith('@telegram.ponghub.app') ? 'вход через Telegram' : r.email]));
  }

  // ── магазин ──
  shopState() { return this.rpc('shop_state', { cid: this.cid }); }
  // цены и условия скинов коллекции — из базы (владелец меняет их одним запросом в Supabase)
  async skinItems() { const { data } = await this.sb.from('shop_items').select('id, price, unlock').not('unlock', 'is', null); return data || []; }
  buyItem(key) { return this.rpc('buy_item', { cid: this.cid, p_key: key }); }
  equipItem(slot, key) { return this.rpc('equip_item', { p_slot: slot, p_key: key }); }
  claimDaily() { return this.rpc('claim_daily', { cid: this.cid }); }
  sellItem(key) { return this.rpc('sell_item', { cid: this.cid, p_key: key }); }
  async claimLeague(league, item) {
    const { data, error } = await this.sb.functions.invoke('notify', { body: { action: 'league_reward', cid: this.cid, league, item } });
    if (error) { let msg = 'Не удалось получить награду'; try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch { /* */ } throw new Error(msg); }
    return data;
  }

  // push-объявление (только создатель): kind = 'collection'
  async announce(kind) {
    const { data, error } = await this.sb.functions.invoke('notify', { body: { action: 'announce', kind } });
    if (error) { let msg = 'Не удалось отправить'; try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch { /* */ } throw new Error(msg); }
    return data;
  }
  // коллекция скинов: сервер считает рейтинг, победы, матчи и заработанные PC и сам выдаёт открытое
  async claimSkins() {
    const { data, error } = await this.sb.functions.invoke('notify', { body: { action: 'claim_skins' } });
    if (error) { let msg = 'Не удалось проверить достижения'; try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch { /* */ } throw new Error(msg); }
    return data;
  }

  async listScreens(cid) {
    const { data, error } = await this.sb.from('club_screens').select('id, name, theme, last_seen, paired_at').eq('club_id', cid).order('paired_at');
    if (error) throw translateError(error);
    return data || [];
  }

  // ── Лицо 3D-игрока по селфи ──
  async faceCall(body) {
    if (!this.sb) throw new Error('В демо-режиме недоступно');
    const { data, error } = await this.sb.functions.invoke('face', { body });
    if (error) {
      let msg = 'Не получилось — попробуйте ещё раз';
      try { const j = await error.context?.json(); if (j?.error) msg = j.error + (j.why ? ` (${j.why})` : ''); } catch { /* */ }
      throw new Error(msg);
    }
    return data;
  }

  // ── Telegram ──
  async tgCall(body) {
    const { data, error } = await this.sb.functions.invoke('tg', { body });
    if (error) {
      let msg = 'Вход через Telegram сейчас недоступен';
      try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch { /* */ }
      throw new Error(msg);
    }
    return data;
  }
  tgStart(purpose) { return this.tgCall({ action: 'start', purpose }); }
  tgPoll(token) { return this.tgCall({ action: 'poll', token }); }
  tgUnlink() { return this.tgCall({ action: 'unlink' }); }
  async tgSignIn(tokenHash) {
    const { error } = await this.sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw translateError(error);
  }

  // ── клубы ──
  async createClub(c) { return this.rpc('create_club', { p_name: c.name, p_city: c.city || null, p_address: c.address || null, p_lat: c.lat ?? null, p_lng: c.lng ?? null, p_visible: c.visible !== false, p_description: c.description || null }); }
  async updateClub(cid, patch) { return this.rpc('update_club', { cid, patch }); }
  async clubByInvite(code) { return this.rpc('club_by_invite', { p_code: code }); }
  async requestJoin(cid, code = null) { return this.rpc('request_join', { cid, p_code: code }); }
  async cancelRequest(cid) { return this.rpc('cancel_request', { cid }); }
  async leaveClub(cid) { return this.rpc('leave_club', { cid }); }
  async transferClub(cid, uid) { return this.rpc('transfer_club', { cid, uid }); }
  async directory(q = '') { return (await this.rpc('club_directory', { q })) || []; }
  async clubPublic(cid, code = null) { return this.rpc('club_public', { cid, p_code: code }); }
  async inviteCode(cid) {
    const { data, error } = await this.sb.from('club_invites').select('code').eq('club_id', cid).maybeSingle();
    if (error) throw translateError(error);
    return data?.code || this.rpc('club_invite_code', { cid });   // участник клуба (не владелец) — через функцию
  }
  async rotateInvite(cid) { return this.rpc('rotate_invite', { cid }); }
  async founderStats() { return this.rpc('founder_stats'); }
  async founderClubs() { return (await this.rpc('founder_clubs')) || []; }
  async founderUnassigned() { return (await this.rpc('founder_unassigned')) || []; }
  async founderAddMembers(cid, uids) { return this.rpc('founder_add_members', { cid, uids }); }
  async founderTransferHistory(cid) { return this.rpc('founder_transfer_history', { cid }); }
  async founderBlockClub(cid, blocked) { return this.rpc('founder_block_club', { cid, p_blocked: blocked }); }
  async founderDeleteClub(cid, name) { return this.rpc('founder_delete_club', { cid, p_name: name }); }

  async uploadAvatar(blob) {
    const { data: { user } } = await this.sb.auth.getUser();
    const path = `${user.id}/${Date.now()}.jpg`;
    const { error } = await this.sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw translateError(error);
    // в базе храним настоящий адрес хранилища (показываем через media())
    const u = this.sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    return u.startsWith(BASE) ? CONFIG.SUPABASE_URL + u.slice(BASE.length) : u;
  }

  async pushPublicKey() {
    const { data, error } = await this.sb.functions.invoke('notify', { body: { action: 'vapid' } });
    if (error || !data?.publicKey) throw new Error('Сервис уведомлений ещё не настроен');
    return data.publicKey;
  }

  async savePushSub(sub) {
    const { data: { user } } = await this.sb.auth.getUser();
    const row = { user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, ua: navigator.userAgent.slice(0, 200) };
    const { error } = await this.sb.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if (error) throw translateError(error);
  }

  async deletePushSub(endpoint) {
    await this.sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }

  async testPush() {
    const { data, error } = await this.sb.functions.invoke('notify', { body: { action: 'test' } });
    if (error) throw new Error('Не удалось отправить тестовое уведомление');
    if (!data?.sent) throw new Error('Подписка не найдена — выключите и снова включите уведомления');
  }

  subscribe(cb) {
    let timer;
    // через сайт живой канал не проходит — обновляемся сами, пока приложение на экране
    if (this.proxy) { setInterval(() => { if (!document.hidden) cb(); }, 15000); return; }
    const ch = this.sb.channel('ponghub-all');
    for (const t of TABLES)
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
        clearTimeout(timer); timer = setTimeout(cb, 400);
      });
    ch.subscribe();
  }
}

// ───────────────────────── Демо-режим ─────────────────────────

const LS_KEY = 'ponghub_demo_v1', SB_KEY = 'ponghub_sandbox_v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

class LocalStore {
  mode = 'demo';
  listeners = [];

  constructor(sandbox = false) {
    this.sandbox = sandbox; this.key = sandbox ? SB_KEY : LS_KEY;
    try { this.db = JSON.parse(localStorage.getItem(this.key)); } catch { this.db = null; }
    if (!this.db || !this.db.clubs) { this.db = sandbox ? seedSandbox() : seedDemo(); this.save(); }
    if (sandbox) setTimeout(() => this.botResume(), 1500);
  }

  save() { try { localStorage.setItem(this.key, JSON.stringify(this.db)); } catch { /* приватный режим */ } }
  reset(opts) { this.db = this.sandbox ? seedSandbox() : seedDemo(opts); this.save(); }
  notify() { this.save(); this.onChange?.(); }

  // ── боты песочницы ──
  bots() { return this.db.profiles.filter(p => p.bot); }
  botMembers(cid = this.cid) { return this.bots().filter(b => this.mem(cid, b.id)?.status === 'active'); }
  // боты по приглашению отправляют заявки в клуб — по одной, как живые люди
  botsRequest(cid = this.cid, n = 6) {
    const free = this.bots().filter(b => !this.mem(cid, b.id)).slice(0, n);
    free.forEach((b, i) => setTimeout(() => {
      if (this.mem(cid, b.id)) return;
      this.db.club_members.push({ club_id: cid, user_id: b.id, role: 'player', status: 'pending', via: 'invite', joined_at: new Date().toISOString() });
      this.notify();
    }, 700 + i * 900));
    return free.length;
  }
  botSets(a, b, bestOf = 5, pointsTo = 11) {
    const sk = id => this.db.profiles.find(p => p.id === id)?.skill ?? 0.5;
    const need = Math.ceil(bestOf / 2), sets = []; let s1 = 0, s2 = 0;
    while (s1 < need && s2 < need) {
      const aw = Math.random() < 0.5 + (sk(a) - sk(b)) * 0.45, lo = Math.random() < 0.2 ? pointsTo - 1 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * (pointsTo - 1));
      const hi = lo >= pointsTo - 1 ? lo + 2 : pointsTo;
      sets.push(aw ? [hi, lo] : [lo, hi]); aw ? s1++ : s2++;
    }
    return { sets, sets1: s1, sets2: s2, winner_id: s1 > s2 ? a : b, best_of: bestOf, points_to: pointsTo };
  }
  // боты сыграли между собой (за последние дни) — у клуба появляются рейтинг, история, серии
  botsPlay(cid = this.cid, n = 10) {
    const ids = this.botMembers(cid).map(b => b.id);
    if (ids.length < 2) throw new Error('Сначала примите в клуб хотя бы двух ботов');
    for (let k = 0; k < n; k++) {
      const a = ids[Math.floor(Math.random() * ids.length)]; let b = a; while (b === a) b = ids[Math.floor(Math.random() * ids.length)];
      const t = new Date(Date.now() - (n - k) * 3.6e6 * (2 + Math.random() * 4)).toISOString();
      this.db.matches.push({ id: uid(), club_id: cid, kind: 'singles', type: 'free', tournament_id: null, stage: null, grp: null, round: null, slot: null, player1_id: a, player2_id: b,
        ...this.botSets(a, b, Math.random() < 0.6 ? 5 : 3), status: 'approved', submitted_by: a, played_at: t, created_at: t, note: '' });
    }
    this.notify(); return n;
  }
  // два бота начинают живую игру: счёт идёт сам, очко за очком; в конце матч попадает в историю
  botLive(cid = this.cid) {
    const ids = this.botMembers(cid).map(b => b.id).filter(id => !(this.db.live_matches || []).some(l => l.status === 'live' && [l.player1_id, l.player2_id].includes(id)));
    if (ids.length < 2) throw new Error('Нужны хотя бы два свободных бота в клубе');
    const [a, b] = ids.sort(() => Math.random() - 0.5);
    const l = { id: uid(), club_id: cid, kind: 'singles', type: 'free', player1_id: a, player2_id: b, player3_id: null, player4_id: null, best_of: 3, points_to: 11, rated: true,
      tournament_id: null, challenge_id: null, first_server: 0, log: [], status: 'live', scorer_id: a, started_by: a, scoring: true, bot: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    (this.db.live_matches = this.db.live_matches || []).push(l);
    this.notify(); this.botTick(l.id); return l.id;
  }
  botTick(id) {
    setTimeout(() => {
      const l = (this.db.live_matches || []).find(x => x.id === id);
      if (!l || l.status !== 'live' || !this.db.profiles.find(p => p.id === l.scorer_id)?.bot) return;   // счёт взял человек — бот больше не считает
      const sk = pid => this.db.profiles.find(p => p.id === pid)?.skill ?? 0.5;
      l.log.push(Math.random() < 0.5 + (sk(l.player1_id) - sk(l.player2_id)) * 0.3 ? 0 : 1); l.updated_at = new Date().toISOString();
      const g = replayLive(l.log, l.best_of, l.points_to, l.first_server);
      if (g.winner !== null) {
        const m = { id: uid(), club_id: l.club_id, kind: 'singles', type: 'free', tournament_id: null, stage: null, grp: null, round: null, slot: null, player1_id: l.player1_id, player2_id: l.player2_id,
          sets: g.sets, sets1: g.won[0], sets2: g.won[1], winner_id: g.winner === 0 ? l.player1_id : l.player2_id, best_of: l.best_of, points_to: l.points_to, status: 'approved', submitted_by: l.scorer_id,
          played_at: new Date().toISOString(), created_at: new Date().toISOString(), note: '' };
        this.db.matches.push(m); Object.assign(l, { status: 'finished', match_id: m.id });
        (this.db.pred_events || []).filter(e => e.source === 'live' && e.source_id === l.id).forEach(e => { e.match_id = m.id; if (e.status === 'open') e.status = 'closed'; });
        this.predSettle(e => e.match_id === m.id, m.id); this.notify(); return;
      }
      this.notify(); this.botTick(id);
    }, 1600 + Math.random() * 1400);
  }
  botResume() { (this.db.live_matches || []).filter(l => l.bot && l.status === 'live').forEach(l => this.botTick(l.id)); }

  async currentUser() {
    const id = this.db.session;
    return id ? { id, email: this.db.users.find(u => u.id === id)?.email } : null;
  }

  onAuth(cb) { this.listeners.push(cb); }
  emit(ev) { this.currentUser().then(u => this.listeners.forEach(cb => cb(ev, u))); }

  async signUp({ email, password, nickname, full_name }) {
    if (this.db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw new Error('Этот email уже зарегистрирован');
    if (!(await this.nicknameAvailable(nickname))) throw new Error('Такой ник уже занят');
    const id = uid();
    this.db.users.push({ id, email, password });
    this.db.profiles.push({ id, nickname, full_name, avatar: '🏓', color: '#e63946', role: 'player', status: 'approved', initial_rating: null, created_at: new Date().toISOString() });
    this.db.session = id;
    this.save(); this.emit('SIGNED_IN');
    return { user: { id }, needsConfirm: false };
  }

  async signIn(email, password) {
    const u = this.db.users.find(x => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
    if (!u) throw new Error('Неверный email или пароль');
    this.db.session = u.id; this.save(); this.emit('SIGNED_IN');
    return u;
  }

  async signInAs(id) { this.db.session = id; this.save(); this.emit('SIGNED_IN'); }
  async signOut() { this.db.session = null; this.save(); this.emit('SIGNED_OUT'); }
  async resetPassword() { throw new Error('В демо-режиме восстановление пароля недоступно'); }
  async updatePassword(pw) { const u = this.db.users.find(x => x.id === this.db.session); if (u) u.password = pw; this.save(); }
  async nicknameAvailable(n) { return !this.db.profiles.some(p => p.nickname.toLowerCase() === n.trim().toLowerCase()); }

  async tgStart() { throw new Error('Вход через Telegram работает только с подключённой базой'); }
  async tgPoll() { return { status: 'expired' }; }
  async tgUnlink() {}
  async tgSignIn() {}

  // ── клубы (упрощённая копия серверной логики) ──
  mem(cid, uid) { return this.db.club_members.find(m => m.club_id === cid && m.user_id === uid); }
  role(cid) { const c = this.db.clubs.find(x => x.id === cid); const m = this.mem(cid, this.db.session); return c && !c.blocked && m?.status === 'active' ? m.role : null; }
  needAdmin(cid) { if (this.role(cid) !== 'owner') throw new Error('Недостаточно прав для этого действия'); }
  founder() { return !!this.db.profiles.find(p => p.id === this.db.session)?.is_founder; }
  needFounder() { if (!this.founder()) throw new Error('Недостаточно прав для этого действия'); }
  code(n) { const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)]; return s; }

  async loadContext() {
    const me = this.db.profiles.find(p => p.id === this.db.session);
    if (!me) return null;
    const clubs = this.db.club_members.filter(m => m.user_id === me.id && ['active', 'pending'].includes(m.status))
      .map(m => ({ ...this.db.clubs.find(c => c.id === m.club_id), my_role: m.role, my_status: m.status })).filter(c => c.id);
    const tf = (this.db.feature_testers || []).filter(t => t.user_id === me.id).map(t => t.feature);
    return JSON.parse(JSON.stringify({ me, clubs, platform: this.db.platform, myFeatures: tf }));
  }
  setClub(club) { this.club = club || null; this.cid = club?.id || null; }

  async loadAll() {
    const c = JSON.parse(JSON.stringify(this.db));
    const cid = this.cid, own = this.role(cid) === 'owner';
    const inC = r => r.club_id === cid;
    const club = c.clubs.find(x => x.id === cid) || {};
    const profiles = c.club_members.filter(m => m.club_id === cid && (m.status !== 'pending' || own))
      .map(m => overlayMember(c.profiles.find(p => p.id === m.user_id), m)).filter(p => p && p.id && (!p.is_test || own));
    return { profiles, matches: c.matches.filter(inC), tournaments: c.tournaments.filter(inC), events: c.events.filter(inC), challenges: (c.challenges || []).filter(inC), live: (c.live_matches || []).filter(x => inC(x) && x.status === 'live'), announcements: [...(c.announcements || [])].filter(inC).reverse().filter(a => own || !a.recipients || a.recipients.includes(c.session)),
      predEvents: [...(c.pred_events || [])].filter(inC).reverse(), predictions: (c.predictions || []).filter(x => inC(x) && x.user_id === c.session).reverse(), settings: { ...(club.settings || {}), clubName: club.name } };
  }

  async createClub(c) {
    if (this.db.platform?.features?.newclub === 'founder' && !this.founder() && !(this.db.feature_testers || []).some(t => t.feature === 'newclub' && t.user_id === this.db.session)) throw new Error('Создание новых клубов пока закрыто. Скоро откроем');
    const id = uid();
    this.db.clubs.push({ id, code: 'PH-' + this.code(4), name: c.name.trim(), city: c.city || null, address: c.address || null, lat: c.lat ?? null, lng: c.lng ?? null, description: c.description || null, visible: c.visible !== false, blocked: false, owner_id: this.db.session, settings: {}, created_at: new Date().toISOString() });
    this.db.invites[id] = this.code(8);
    this.db.club_members.push({ club_id: id, user_id: this.db.session, role: 'owner', status: 'active', via: 'created', joined_at: new Date().toISOString() });
    this.save(); return id;
  }
  async updateClub(cid, patch) {
    if (this.role(cid) !== 'owner' && !this.founder()) throw new Error('Недостаточно прав для этого действия');
    Object.assign(this.db.clubs.find(c => c.id === cid), patch); this.save();
  }
  inviteOk(cid, code) { return !!code && this.db.invites[cid] === String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  async clubByInvite(code) {
    const k = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cid = Object.keys(this.db.invites).find(id => this.db.invites[id] === k && !this.db.clubs.find(c => c.id === id)?.blocked);
    if (!cid) throw new Error('Код приглашения не найден или устарел');
    return cid;
  }
  async requestJoin(cid, code = null) {
    const c = this.db.clubs.find(x => x.id === cid), inv = this.inviteOk(cid, code);
    if (!c || c.blocked || !(c.visible || inv)) throw new Error('Клуб не найден');
    const m = this.mem(cid, this.db.session), via = inv ? 'invite' : 'request';
    if (m?.status === 'active' || m?.status === 'pending') return;
    if (m) Object.assign(m, { status: 'pending', via }); else this.db.club_members.push({ club_id: cid, user_id: this.db.session, role: 'player', status: 'pending', via, joined_at: new Date().toISOString() });
    this.save();
  }
  async cancelRequest(cid) { this.db.club_members = this.db.club_members.filter(m => !(m.club_id === cid && m.user_id === this.db.session && m.status === 'pending')); this.save(); }
  async leaveClub(cid) { await this.adminDeletePlayer(this.db.session, cid, true); }
  async transferClub(cid, to) {
    if (this.role(cid) !== 'owner' && !this.founder()) throw new Error('Недостаточно прав для этого действия');
    if (this.mem(cid, to)?.status !== 'active') throw new Error('Передать можно только участнику клуба');
    this.db.club_members.filter(m => m.club_id === cid && m.role === 'owner').forEach(m => { m.role = 'helper'; });
    this.mem(cid, to).role = 'owner'; this.db.clubs.find(c => c.id === cid).owner_id = to; this.save();
  }
  clubRow(c) {
    return { id: c.id, code: c.code, name: c.name, city: c.city, address: c.address, lat: c.lat, lng: c.lng, description: c.description, created_at: c.created_at,
      players: this.db.club_members.filter(m => m.club_id === c.id && m.status === 'active').length,
      matches: this.db.matches.filter(m => m.club_id === c.id && m.status === 'approved' && !m.is_test).length,
      my_status: this.mem(c.id, this.db.session)?.status || null };
  }
  async directory(q = '') {
    const t = q.trim().toLowerCase();
    return this.db.clubs.filter(c => !c.blocked && (c.visible || this.mem(c.id, this.db.session)))
      .filter(c => !t || c.name.toLowerCase().includes(t) || (c.city || '').toLowerCase().includes(t) || (c.address || '').toLowerCase().includes(t) || c.code.toLowerCase() === t || c.code.toLowerCase() === 'ph-' + t)
      .map(c => this.clubRow(c)).sort((a, b) => b.players - a.players);
  }
  async clubPublic(cid, code = null) {
    const c = this.db.clubs.find(x => x.id === cid);
    if (!c || c.blocked || !(c.visible || this.role(cid) || this.founder() || this.inviteOk(cid, code))) throw new Error('Клуб не найден');
    const players = this.db.club_members.filter(m => m.club_id === cid && m.status !== 'pending').map(m => {
      const p = this.db.profiles.find(x => x.id === m.user_id);
      return p && !p.is_test && { id: p.id, nickname: p.nickname, avatar: p.avatar, color: p.color, photo_url: p.photo_url, initial_rating: m.initial_rating, created_at: p.created_at, status: m.status === 'active' ? 'approved' : m.status === 'archived' ? 'archived' : 'deleted' };
    }).filter(Boolean);
    return JSON.parse(JSON.stringify({ club: this.clubRow(c), settings: c.settings, my_status: this.mem(cid, this.db.session)?.status || null, players,
      matches: this.db.matches.filter(m => m.club_id === cid && m.status === 'approved' && !m.is_test),
      tournaments: this.db.tournaments.filter(t => t.club_id === cid && !t.is_test).map(t => ({ id: t.id, name: t.name, date: t.date, status: t.status, results: t.results, created_at: t.created_at })) }));
  }
  async inviteCode(cid) { if (!this.role(cid)) throw new Error('Пригласить может только участник клуба'); return this.db.invites[cid]; }
  async rotateInvite(cid) { this.needAdmin(cid); this.db.invites[cid] = this.code(8); this.save(); return this.db.invites[cid]; }
  unassigned() { return this.db.profiles.filter(p => !p.is_test && !['deleted', 'rejected'].includes(p.status) && !this.db.club_members.some(m => m.user_id === p.id && ['active', 'pending'].includes(m.status))); }
  async founderStats() {
    this.needFounder();
    return { clubs: this.db.clubs.length, users: this.db.profiles.filter(p => !p.is_test && !['deleted', 'rejected'].includes(p.status)).length, matches: this.db.matches.filter(m => !m.is_test).length,
      unassigned: this.unassigned().length, legacy_rows: this.db.matches.filter(m => !m.club_id).length + this.db.tournaments.filter(t => !t.club_id).length, migration_done: this.db.platform.migration_done };
  }
  async founderClubs() {
    this.needFounder();
    return this.db.clubs.map(c => ({ id: c.id, code: c.code, name: c.name, city: c.city, visible: c.visible, blocked: c.blocked, owner_id: c.owner_id, owner_nick: this.db.profiles.find(p => p.id === c.owner_id)?.nickname,
      players: this.db.club_members.filter(m => m.club_id === c.id && m.status === 'active').length, pending: this.db.club_members.filter(m => m.club_id === c.id && m.status === 'pending').length,
      matches: this.db.matches.filter(m => m.club_id === c.id && !m.is_test).length, last_match: this.db.matches.filter(m => m.club_id === c.id).map(m => m.played_at).sort().pop() || null, created_at: c.created_at }));
  }
  async founderUnassigned() {
    this.needFounder();
    return this.unassigned().map(p => ({ id: p.id, nickname: p.nickname, full_name: p.full_name, avatar: p.avatar, color: p.color, photo_url: p.photo_url, old_role: p.role, old_status: p.status, legacy: !!p.legacy, created_at: p.created_at }))
      .sort((a, b) => (b.legacy - a.legacy) || a.nickname.localeCompare(b.nickname));
  }
  async founderAddMembers(cid, uids) {
    this.needFounder();
    let n = 0;
    for (const id of uids) {
      const p = this.db.profiles.find(x => x.id === id);
      if (!p || p.is_test || ['deleted', 'rejected'].includes(p.status)) continue;
      const role = ['editor', 'admin'].includes(p.role) ? 'helper' : 'player', status = p.status === 'archived' ? 'archived' : 'active';
      const m = this.mem(cid, id);
      if (m) { if (m.role !== 'owner') Object.assign(m, { role, status }); else m.status = 'active'; if (m.initial_rating == null) m.initial_rating = p.initial_rating; }
      else this.db.club_members.push({ club_id: cid, user_id: id, role, status, initial_rating: p.initial_rating, via: 'founder', joined_at: new Date().toISOString() });
      n++;
    }
    this.save(); return n;
  }
  async founderTransferHistory(cid) {
    this.needFounder();
    if (this.db.platform.migration_done) throw new Error('История уже перенесена');
    let nm = 0, nt = 0;
    for (const t of ['matches', 'tournaments', 'events', 'challenges', 'live_matches', 'announcements', 'pred_events', 'predictions', 'coin_tx', 'audit'])
      for (const r of this.db[t] || []) if (!r.club_id) { r.club_id = cid; if (t === 'matches') nm++; if (t === 'tournaments') nt++; }
    const club = this.db.clubs.find(c => c.id === cid);
    club.settings = { ...(this.db.settings || {}), ...(club.settings || {}) };
    const seen = new Set();
    this.db.matches.filter(m => m.club_id === cid).forEach(m => [m.player1_id, m.player2_id, m.player3_id, m.player4_id].forEach(x => x && seen.add(x)));
    for (const p of this.db.profiles) {
      if (p.is_test) { if (!this.mem(cid, p.id)) this.db.club_members.push({ club_id: cid, user_id: p.id, role: 'player', status: 'active', via: 'history', joined_at: new Date().toISOString() }); continue; }
      if (seen.has(p.id) && !this.mem(cid, p.id)) this.db.club_members.push({ club_id: cid, user_id: p.id, role: 'player', status: 'former', initial_rating: p.initial_rating, via: 'history', joined_at: new Date().toISOString() });
    }
    this.db.platform.migration_done = true;
    this.save(); return { matches: nm, tournaments: nt };
  }
  async founderBlockClub(cid, blocked) { this.needFounder(); this.db.clubs.find(c => c.id === cid).blocked = blocked; this.save(); }
  async founderDeleteClub(cid, name) {
    this.needFounder();
    const c = this.db.clubs.find(x => x.id === cid);
    if (!c || c.name !== name) throw new Error('Название не совпадает');
    this.db.clubs = this.db.clubs.filter(x => x.id !== cid);
    this.db.club_members = this.db.club_members.filter(m => m.club_id !== cid);
    for (const t of ['matches', 'tournaments', 'events', 'challenges', 'live_matches', 'announcements', 'pred_events', 'predictions', 'coin_tx', 'audit']) this.db[t] = (this.db[t] || []).filter(r => r.club_id !== cid);
    this.save();
  }

  async insert(table, row) {
    const r = { id: uid(), created_at: new Date().toISOString(), ...(CLUB_TABLES.includes(table) ? { club_id: this.cid } : {}), ...row };
    (this.db[table] = this.db[table] || []).push(r); this.save();
    // песочница: бот принимает вызов через пару секунд
    if (this.sandbox && table === 'challenges' && this.db.profiles.find(p => p.id === r.to_id)?.bot)
      setTimeout(() => { if (r.status === 'pending') { Object.assign(r, { status: 'accepted', responded_at: new Date().toISOString() }); this.notify(); } }, 2500);
    return r;
  }

  async insertMany(table, rows) { const out = []; for (const r of rows) out.push(await this.insert(table, r)); return out; }

  async update(table, id, patch) {
    if (table === 'profiles') {
      const { role, status, initial_rating, ...rest } = patch;
      if (role !== undefined || status !== undefined || initial_rating !== undefined) {
        this.needAdmin(this.cid);
        const m = this.mem(this.cid, id);
        if (!m) throw new Error('Участник не найден');
        if (m.role === 'owner' && ((role && role !== 'admin') || (status && status !== 'approved'))) throw new Error('Сначала передайте клуб другому участнику');
        if (status === 'rejected') this.db.club_members = this.db.club_members.filter(x => x !== m);
        else {
          if (role) m.role = ROLE_IN[role];
          if (status) m.status = STATUS_IN[status];
          if (initial_rating !== undefined) m.initial_rating = initial_rating;
        }
        this.save();
      }
      if (!Object.keys(rest).length) return { id, ...patch };
      patch = rest;
    }
    const r = this.db[table].find(x => x.id === id);
    if (!r) throw new Error('Запись не найдена');
    Object.assign(r, patch);
    if (table === 'live_matches') r.updated_at = new Date().toISOString();
    if (table === 'live_matches' || table === 'challenges') {
      const f = e => e.source_id === id;
      if (['cancelled', 'declined'].includes(r.status)) this.predCancel(f);
      else if (r.match_id) this.predSettle(f, r.match_id);
      else if ((r.log || []).length) (this.db.pred_events || []).filter(f).forEach(e => { if (e.status === 'open') e.status = 'closed'; });
    }
    if (table === 'matches' && r.status === 'approved') this.predSettle(e => e.match_id === id, id);
    this.save();
    return r;
  }

  async remove(table, id) {
    this.db[table] = this.db[table].filter(x => x.id !== id);
    if (table === 'tournaments') this.db.matches = this.db.matches.filter(m => m.tournament_id !== id);
    this.save();
  }

  async saveSettings(data) {
    const { clubName, ...settings } = data;
    this.needAdmin(this.cid);
    const c = this.db.clubs.find(x => x.id === this.cid);
    c.settings = settings; if (clubName) c.name = clubName;
    this.save();
  }

  async toggleRsvp(eventId) {
    const e = this.db.events.find(x => x.id === eventId);
    const me = this.db.session;
    e.attendees = e.attendees.includes(me) ? e.attendees.filter(x => x !== me) : [...e.attendees, me];
    this.save();
  }

  async tournamentSignup(tid, on) {
    const t = this.db.tournaments.find(x => x.id === tid), me = this.db.session;
    if (!t) throw new Error('Турнир не найден');
    if (t.status !== 'open') throw new Error('Запись на этот турнир закрыта');
    const reg = (t.registered || []).filter(x => x !== me);
    t.registered = on ? [...reg, me] : reg;
    this.save(); return t.registered;
  }

  // ── прогнозы в демо-режиме (упрощённая копия серверной логики) ──
  coinBal(uid) { return (this.db.coin_tx || []).filter(t => t.user_id === uid && t.club_id === this.cid).reduce((a, t) => a + t.amount, 0); }
  tx(user_id, amount, kind, ref = null) { (this.db.coin_tx = this.db.coin_tx || []).push({ id: uid(), club_id: this.cid, user_id, amount, kind, ref, created_at: new Date().toISOString() }); }
  predSetting(k, d) { return this.db.clubs.find(c => c.id === this.cid)?.settings?.[k] ?? d; }
  async listScreens(cid) { return (this.db.screens || []).filter(s => s.club_id === cid); }
  // ── магазин (демо: та же логика, что в базе) ──
  async skinItems() { return []; }
  shopDb() { const d = this.db; d.user_items = d.user_items || []; d.daily = d.daily || []; d.league_rewards = d.league_rewards || []; return d; }
  async shopState() {
    const d = this.shopDb(), me = this.db.session, p = d.profiles.find(x => x.id === me);
    if (!d.user_items.some(x => x.user_id === me)) d.user_items.push({ user_id: me, item_key: 'cn-b1:FL', source: 'starter', created_at: new Date().toISOString() });
    p.loadout = p.loadout || {}; if (!p.loadout.blade) p.loadout.blade = 'cn-b1:FL';
    const today = new Date().toISOString().slice(0, 10), yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const last = d.daily.filter(x => x.user_id === me).sort((a, b) => b.day.localeCompare(a.day))[0];
    const day = !last ? 1 : last.day === today ? last.streak : last.day === yest ? (last.streak >= 7 ? 1 : last.streak + 1) : 1;
    const balance = await this.rpc('ensure_wallet');
    this.save();
    return JSON.parse(JSON.stringify({ items: d.user_items.filter(x => x.user_id === me).map(x => x.item_key), paid: Object.fromEntries(d.user_items.filter(x => x.user_id === me).map(x => [x.item_key, x.source === 'shop' ? x.price || 0 : 0])), loadout: p.loadout, balance, streak: { day, claimed: last?.day === today }, rewards: Object.fromEntries(d.league_rewards.filter(x => x.user_id === me).map(x => [x.league, x.item_key])) }));
  }
  async buyItem(key) {
    const d = this.shopDb(), me = this.db.session;
    const { it, color } = parseKey(key);
    const price = it && !it.reward && it.colors?.some(c => c.key === color) ? priceOf(it, color) : null;
    if (price == null) throw new Error('Этот предмет не продаётся');
    if (d.user_items.some(x => x.user_id === me && x.item_key === key)) throw new Error('Уже куплено');
    await this.rpc('ensure_wallet');
    const bal = this.coinBal(me); if (bal < price) throw new Error(`Не хватает ${price - bal} PC`);
    d.user_items.push({ user_id: me, item_key: key, club_id: this.cid, price, source: 'shop', created_at: new Date().toISOString() });
    this.tx(me, -price, 'shop'); this.save(); return bal - price;
  }
  async equipItem(slot, key) {
    const d = this.shopDb(), me = this.db.session, p = d.profiles.find(x => x.id === me);
    if (key && !d.user_items.some(x => x.user_id === me && x.item_key === key)) throw new Error('Сначала купите эту деталь');
    const lo = { ...(p.loadout || {}) };
    if (slot === 'fh' && lo.bh === key) delete lo.bh;
    if (slot === 'bh' && lo.fh === key) delete lo.fh;
    if (key) lo[slot] = key; else delete lo[slot];
    p.loadout = lo; this.save(); return lo;
  }
  async claimDaily() {
    const d = this.shopDb(), me = this.db.session, arr = [20, 30, 40, 50, 60, 80, 120];
    const today = new Date().toISOString().slice(0, 10), yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const last = d.daily.filter(x => x.user_id === me).sort((a, b) => b.day.localeCompare(a.day))[0];
    if (last?.day === today) throw new Error('Бонус за сегодня уже получен — приходите завтра');
    const n = last?.day === yest && last.streak < 7 ? last.streak + 1 : 1;
    await this.rpc('ensure_wallet');
    d.daily.push({ user_id: me, day: today, streak: n, amount: arr[n - 1] }); this.tx(me, arr[n - 1], 'streak'); this.save();
    return { streak: n, amount: arr[n - 1], balance: this.coinBal(me) };
  }
  async sellItem(key) {
    const d = this.shopDb(), me = this.db.session, p = d.profiles.find(x => x.id === me);
    const ui = d.user_items.find(x => x.user_id === me && x.item_key === key);
    if (!ui) throw new Error('Этой вещи у вас нет');
    if (ui.source !== 'shop' || !ui.price) throw new Error('Стартовое основание и награды продать нельзя');
    if (Object.values(p.loadout || {}).includes(key)) throw new Error('Сначала снимите эту деталь с ракетки');
    const back = Math.round(ui.price * 0.3);
    d.user_items = d.user_items.filter(x => x !== ui); this.tx(me, back, 'sell'); this.save();
    return { amount: back, balance: this.coinBal(me) };
  }
  async claimLeague(league, item) {
    const d = this.shopDb(), me = this.db.session;
    if (d.league_rewards.some(x => x.user_id === me && x.league === league)) throw new Error('Эта награда уже получена');
    if (d.user_items.some(x => x.user_id === me && x.item_key === item)) throw new Error('Этот предмет у вас уже есть — выберите другой');
    d.user_items.push({ user_id: me, item_key: item, source: 'reward', created_at: new Date().toISOString() });
    if (league === 'gold' && !d.user_items.some(x => x.user_id === me && x.item_key === 'rw-tape-gold:gold')) d.user_items.push({ user_id: me, item_key: 'rw-tape-gold:gold', source: 'reward', created_at: new Date().toISOString() });
    d.league_rewards.push({ user_id: me, league, item_key: item }); this.save(); return { ok: true };
  }
  async announce() { return { sent: 0 }; }
  async claimSkins() {
    const d = this.shopDb(), me = this.db.session;
    const pool = d.profiles.filter(p => ['approved', 'archived', 'deleted'].includes(p.status));
    const ms = d.matches.filter(m => !this.cid || m.club_id === this.cid);
    let rating = 40, wins = 0, matches = 0;
    try { const A = analyze(pool, ms, { ...DEFAULT_SETTINGS, ...((this.club && this.club.settings) || {}) }); rating = A.rating.get(me) ?? A.S.initialRating; const st = playerStats(me, A, []); wins = st.wins; matches = st.matches; } catch { /* */ }
    const coins = (d.coin_tx || []).filter(t => t.user_id === me && t.amount > 0 && ['match', 'prize', 'streak', 'daily', 'weekly', 'payout'].includes(t.kind)).reduce((a, t) => a + t.amount, 0);
    const stats = { rating: Math.round(rating * 10) / 10, wins, matches, coins }, unlocked = [], granted = [];
    for (const it of SKINS) {
      if ((stats[it.unlock.kind] || 0) < it.unlock.n) continue;
      unlocked.push(it.id);
      let add = false;
      for (const c of it.colors) { const k = `${it.id}:${c.key}`; if (!d.user_items.some(x => x.user_id === me && x.item_key === k)) { d.user_items.push({ user_id: me, item_key: k, source: 'reward', price: 0, created_at: new Date().toISOString() }); add = true; } }
      if (add) granted.push(it.id);
    }
    this.save(); return { ok: true, stats, unlocked, granted };
  }
  screenRpc(name, a) {
    const S = this.db.screens = this.db.screens || [];
    if (name === 'screen_start') {
      const s = { id: uid(), token: uid(), pair_code: String(Math.floor(100000 + Math.random() * 900000)), club_id: null, name: 'Табло', theme: 'night', created_at: new Date().toISOString() };
      S.push(s); this.save(); return { token: s.token, code: s.pair_code };
    }
    if (name === 'screen_pair') {
      this.needAdmin(a.cid);
      const s = S.find(x => x.pair_code === String(a.p_code).replace(/\D/g, '') && !x.club_id);
      if (!s) throw new Error('Код не найден. Проверьте цифры на экране телевизора');
      Object.assign(s, { club_id: a.cid, pair_code: null, paired_at: new Date().toISOString(), name: a.p_name || s.name }); this.save(); return s.id;
    }
    if (name === 'screen_set') { const s = S.find(x => x.id === a.sid); this.needAdmin(s.club_id); if (a.p_theme) s.theme = a.p_theme; this.save(); return; }
    if (name === 'screen_remove') { const s = S.find(x => x.id === a.sid); this.needAdmin(s.club_id); this.db.screens = S.filter(x => x !== s); this.save(); return; }
    if (name === 'screen_state') {
      // табло в демо читает localStorage заново — его открывают в отдельной вкладке
      try { const fresh = JSON.parse(localStorage.getItem(LS_KEY)); if (fresh) this.db = fresh; } catch { /* */ }
      const s = (this.db.screens || []).find(x => x.token === a.p_token);
      if (!s) return { status: 'unknown' };
      if (!s.club_id) return { status: 'pairing', code: s.pair_code };
      s.last_seen = new Date().toISOString(); this.save();
      const cid = s.club_id, c = this.db.clubs.find(x => x.id === cid);
      const now = Date.now();
      const live = (this.db.live_matches || []).filter(l => l.club_id === cid && l.status === 'live' && !l.is_test);
      const recent = (this.db.live_matches || []).filter(l => l.club_id === cid && l.status === 'finished' && now - Date.parse(l.updated_at || l.created_at) < 75e3).pop() || null;
      const evIds = new Set([...live.map(l => l.id), recent?.id].filter(Boolean));
      const preds = (this.db.pred_events || []).filter(e => evIds.has(e.source_id)).map(e => {
        const pr = (this.db.predictions || []).filter(p => p.event_id === e.id);
        return { ...e, bets: e.bets_count, count1: pr.filter(p => p.side === 1).length, count2: pr.filter(p => p.side === 2).length,
          winners: pr.filter(p => p.status === 'won').map(p => ({ nick: this.db.profiles.find(x => x.id === p.user_id)?.nickname, stake: p.stake, odds: p.odds, payout: p.payout })) };
      });
      const res = { status: 'ok', now: new Date().toISOString(), screen: { id: s.id, name: s.name, theme: s.theme }, club: { id: c.id, name: c.name, code: c.code },
        live, recent, recent_match: recent?.match_id ? this.db.matches.find(m => m.id === recent.match_id) : null, preds,
        next: (this.db.challenges || []).filter(x => x.club_id === cid && x.status === 'accepted').map(x => ({ a: x.from_id, b: x.to_id })) };
      if (a.p_full) {
        res.settings = c.settings || {};
        res.players = this.db.club_members.filter(m => m.club_id === cid && m.status !== 'pending').map(m => {
          const p = this.db.profiles.find(x => x.id === m.user_id);
          return p && !p.is_test && { ...p, initial_rating: m.initial_rating, status: p.status === 'deleted' ? 'deleted' : m.status === 'active' ? 'approved' : 'archived' };
        }).filter(Boolean);
        res.matches = this.db.matches.filter(m => m.club_id === cid && m.status === 'approved' && !m.is_test);
        res.tournaments = this.db.tournaments.filter(x => x.club_id === cid && !x.is_test);
      }
      return JSON.parse(JSON.stringify(res));
    }
  }
  async rpc(name, a = {}) {
    if (name.startsWith('screen_')) return this.screenRpc(name, a);
    if (name === 'founder_search_users' || name === 'founder_feature_testers') {
      this.needFounder(); const t = this.db.feature_testers || [];
      const list = name === 'founder_feature_testers' ? this.db.profiles.filter(p => t.some(x => x.feature === a.fname && x.user_id === p.id))
        : this.db.profiles.filter(p => !a.q || (p.nickname + ' ' + (p.full_name || '')).toLowerCase().includes(a.q.toLowerCase())).slice(0, 30);
      return list.map(p => ({ id: p.id, nickname: p.nickname, full_name: p.full_name, clubs: this.db.club_members.filter(m => m.user_id === p.id && m.status === 'active').map(m => this.db.clubs.find(c => c.id === m.club_id)?.name).filter(Boolean).join(', ') }));
    }
    if (name === 'founder_set_tester') {
      this.needFounder(); const t = this.db.feature_testers = (this.db.feature_testers || []).filter(x => !(x.feature === a.fname && x.user_id === a.uid));
      if (a.on_) t.push({ feature: a.fname, user_id: a.uid }); this.save(); return t.filter(x => x.feature === a.fname).length;
    }
    if (name === 'founder_set_grip') { this.needFounder(); this.db.platform.grip = a.p; this.save(); return a.p; }
    if (name === 'tournament_public' || name === 'tournament_join') {
      const t = this.db.tournaments.find(x => x.id === a.tid), me = this.db.session;
      if (!t) throw new Error('Турнир не найден');
      const st = () => this.db.club_members.find(m => m.club_id === t.club_id && m.user_id === me)?.status || null;
      if (name === 'tournament_join') {
        if (t.status !== 'open') throw new Error('Запись на этот турнир закрыта');
        t.registered = (t.registered || []).filter(x => x !== me); t.pending_reg = (t.pending_reg || []).filter(x => x !== me);
        if (a.p_on) { if (st() === 'active') t.registered.push(me); else { await this.requestJoin(t.club_id, a.p_code); t.pending_reg.push(me); } }
        this.save();
      }
      const c = this.db.clubs.find(x => x.id === t.club_id);
      return { id: t.id, name: t.name, status: t.status, starts_at: t.starts_at || null, date: t.date, place: t.place, format: t.format, best_of: t.best_of, points_to: t.points_to, config: t.config || {},
        registered_count: (t.registered || []).length, me_registered: (t.registered || []).includes(me), me_pending: (t.pending_reg || []).includes(me),
        club: { id: c.id, name: c.name, pred: (c.settings || {}).predEnabled !== false }, my_status: st() };
    }
    if (name === 'player_predictions') {
      const evs = new Map((this.db.pred_events || []).filter(e => e.club_id === this.cid).map(e => [e.id, e]));
      return (this.db.predictions || []).filter(p => p.user_id === a.uid && evs.has(p.event_id))
        .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at)).slice(0, 100).map(p => ({ ...p, event: evs.get(p.event_id) }));
    }
    // демо: задания недели и стоп-кадр
    if (name === 'weekly_tasks') {
      const me = this.db.session, d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const ms = this.db.matches.filter(m => m.club_id === this.cid && m.status === 'approved' && !m.is_test && (m.kind || 'singles') === 'singles' && [m.player1_id, m.player2_id].includes(me) && Date.parse(m.played_at) >= +d).sort((x, y) => Date.parse(x.played_at) - Date.parse(y.played_at));
      let best = 0, run = 0; const opp = new Set(); let clean = 0;
      for (const m of ms) { opp.add(m.player1_id === me ? m.player2_id : m.player1_id); const w = m.winner_id === me; if (w && (m.player1_id === me ? m.sets2 : m.sets1) === 0) clean++; run = w ? run + 1 : 0; best = Math.max(best, run); }
      const wk = d.toISOString().slice(0, 10), claimed = (this.db.task_claims || []).filter(c => c.user_id === me && c.club_id === this.cid && c.week === wk).map(c => c.task);
      return { week: wk, claimed, tasks: [
        { key: 'opp3', icon: '🤝', title: 'Сыграй с 3 разными игроками', goal: 3, have: Math.min(opp.size, 3), reward: 100 },
        { key: 'streak3', icon: '🔥', title: 'Выиграй 3 матча подряд', goal: 3, have: Math.min(best, 3), reward: 150 },
        { key: 'clean', icon: '💪', title: 'Выиграй матч всухую — не отдав ни одной партии', goal: 1, have: Math.min(clean, 1), reward: 200 },
        { key: 'play10', icon: '🏓', title: 'Сыграй 10 матчей за неделю', goal: 10, have: Math.min(ms.length, 10), reward: 150 }] };
    }
    if (name === 'claim_weekly_task') {
      const st = await this.rpc('weekly_tasks', { cid: a.cid }), t = st.tasks.find(x => x.key === a.p_task), me = this.db.session;
      if (!t || t.have < t.goal) throw new Error('Задание ещё не выполнено');
      if (st.claimed.includes(t.key)) throw new Error('Награда за это задание уже получена');
      (this.db.task_claims = this.db.task_claims || []).push({ user_id: me, club_id: this.cid, week: st.week, task: t.key });
      this.tx(me, t.reward, 'task'); this.save(); return this.coinBal(me);
    }
    if (name === 'screen_freeze') { const until = a.minutes > 0 ? new Date(Date.now() + a.minutes * 60e3).toISOString() : null; (this.db.screens || []).filter(x => x.club_id === a.cid).forEach(x => { x.frozen_until = until; }); this.save(); return until; }
    if (name === 'screen_flags') { const sc = (this.db.screens || []).find(x => x.token === a.p_token); return { frozen_until: sc?.frozen_until || null, now: new Date().toISOString() }; }
    if (name === 'set_avatar3d') { const me = this.db.profiles.find(p => p.id === this.db.session); me.avatar3d = a.p; this.save(); return a.p; }
    if (name === 'founder_set_feature') { this.needFounder(); this.db.platform.features = { ...(this.db.platform.features || {}), [a.fname]: a.mode }; this.save(); return this.db.platform.features; }
    const me = this.db.session;
    this.db.pred_events = this.db.pred_events || []; this.db.predictions = this.db.predictions || [];
    if (name === 'ensure_wallet') { if (!this.role(this.cid)) return 0; if (!(this.db.coin_tx || []).some(t => t.user_id === me && t.club_id === this.cid && ['start', 'convert'].includes(t.kind))) { this.tx(me, this.predSetting('predStart', 300), 'start'); this.save(); } return this.coinBal(me); }
    if (name === 'create_pred_event') {
      const ex = this.db.pred_events.find(e => e.source_id === a.src_id); if (ex) return ex.id;
      const srcRow = a.src === 'live' ? (this.db.live_matches || []).find(x => x.id === a.src_id) : (this.db.challenges || []).find(x => x.id === a.src_id);
      if (!srcRow) return null;
      const c = Math.min(0.95, Math.max(0.05, a.chance));
      // игру начали — прогнозы принятого вызова этих же двоих переходят на неё (как миграция 37)
      if (a.src === 'live' && srcRow.kind !== 'doubles' && !srcRow.tournament_id) {
        const pair = [srcRow.player1_id, srcRow.player2_id].sort().join();
        const ce = this.db.pred_events.find(e => e.source === 'challenge' && ['open', 'closed'].includes(e.status) && (this.db.challenges || []).some(x => x.id === e.source_id && x.status === 'accepted' && !x.match_id && [x.from_id, x.to_id].sort().join() === pair));
        if (ce) {
          if (ce.player1_id !== srcRow.player1_id) {
            this.db.predictions.filter(p => p.event_id === ce.id).forEach(p => { p.side = 3 - p.side; });
            Object.assign(ce, { player1_id: ce.player2_id, player2_id: ce.player1_id, chance1: 1 - ce.chance1, odds1: ce.odds2, odds2: ce.odds1, pool1: ce.pool2, pool2: ce.pool1 });
          }
          Object.assign(ce, { source: 'live', source_id: a.src_id, status: 'open', closes_at: srcRow.scoring === false ? new Date(Date.now() + this.predSetting('predWindowMin', 3) * 6e4).toISOString() : null });
          this.save(); return ce.id;
        }
      }
      const ev = { id: uid(), club_id: this.cid, source: a.src, source_id: a.src_id, kind: srcRow.kind || 'singles', player1_id: srcRow.player1_id || srcRow.from_id, player2_id: srcRow.player2_id || srcRow.to_id, player3_id: srcRow.player3_id || null, player4_id: srcRow.player4_id || null,
        tournament_id: srcRow.tournament_id || null, closes_at: srcRow.scoring === false ? new Date(Date.now() + this.predSetting('predWindowMin', 3) * 6e4).toISOString() : null, chance1: c, odds1: Math.min(10, Math.round(100 / c) / 100), odds2: Math.min(10, Math.round(100 / (1 - c)) / 100), status: 'open', bets_count: 0, pool1: 0, pool2: 0, is_test: !!srcRow.is_test, created_by: me, created_at: new Date().toISOString() };
      this.db.pred_events.push(ev); this.save(); return ev.id;
    }
    if (name === 'place_prediction') {
      const e = this.db.pred_events.find(x => x.id === a.eid);
      if (!e || e.status !== 'open') throw new Error('Приём прогнозов закрыт');
      if (e.closes_at && Date.now() > Date.parse(e.closes_at)) { e.status = 'closed'; this.save(); throw new Error('Время приёма прогнозов вышло'); }
      if ([e.player1_id, e.player2_id, e.player3_id, e.player4_id].includes(me)) throw new Error('На свой матч прогноз сделать нельзя');
      if (e.source === 'live') { const l = (this.db.live_matches || []).find(x => x.id === e.source_id); if (!l || l.status !== 'live' || (l.log || []).length) { e.status = 'closed'; this.save(); throw new Error('Игра уже началась — приём прогнозов закрыт'); } }
      const min = this.predSetting('predMin', 10), max = this.predSetting('predMax', 300);
      if (a.amount < min || a.amount > max) throw new Error(`Ставка от ${min} до ${max} PC`);
      await this.rpc('ensure_wallet');
      if (this.coinBal(me) < a.amount) throw new Error(`Недостаточно пинг-коинов (у вас ${this.coinBal(me)})`);
      this.db.predictions.push({ id: uid(), club_id: this.cid, event_id: e.id, user_id: me, side: a.pick, stake: a.amount, odds: a.pick === 1 ? e.odds1 : e.odds2, status: 'open', created_at: new Date().toISOString() });
      this.tx(me, -a.amount, 'bet', e.id);
      e.bets_count++; e['pool' + a.pick] += a.amount; this.save(); return this.coinBal(me);
    }
    if (name === 'coin_leaderboard') {
      const since = a.since ? Date.parse(a.since) : 0;
      const cid = this.cid, mine = (this.db.coin_tx || []).filter(t => t.club_id === cid);
      const ids = [...new Set(mine.map(t => t.user_id))].filter(id => this.mem(cid, id)?.status === 'active');
      return ids.map(id => {
        const tx = mine.filter(t => t.user_id === id), pr = this.db.predictions.filter(p => p.club_id === cid && p.user_id === id && Date.parse(p.created_at) >= since);
        return { user_id: id, balance: tx.reduce((s, t) => s + t.amount, 0), profit: tx.filter(t => ['bet', 'payout', 'refund'].includes(t.kind) && Date.parse(t.created_at) >= since).reduce((s, t) => s + t.amount, 0),
          bets: pr.filter(p => ['won', 'lost'].includes(p.status)).length, wins: pr.filter(p => p.status === 'won').length };
      });
    }
    throw new Error('Неизвестная операция ' + name);
  }
  predSettle(eventFilter, matchId) {
    const m = this.db.matches.find(x => x.id === matchId);
    for (const e of (this.db.pred_events || []).filter(eventFilter)) {
      e.match_id = matchId; if (e.status === 'open') e.status = 'closed';
      if (!m || m.status !== 'approved' || e.status === 'settled') continue;
      const side = [e.player1_id, e.player3_id].includes(m.winner_id) ? 1 : 2;
      for (const p of this.db.predictions.filter(x => x.event_id === e.id && x.status === 'open')) {
        if (p.side === side) { p.status = 'won'; p.payout = Math.round(p.stake * p.odds); this.tx(p.user_id, p.payout, 'payout', e.id); } else { p.status = 'lost'; p.payout = 0; }
      }
      e.status = 'settled'; e.winner_side = side;
    }
  }
  predCancel(eventFilter) {
    for (const e of (this.db.pred_events || []).filter(eventFilter)) {
      if (e.status === 'settled') continue;
      for (const p of this.db.predictions.filter(x => x.event_id === e.id && x.status === 'open')) { p.status = 'refunded'; p.payout = p.stake; this.tx(p.user_id, p.stake, 'refund', e.id); }
      e.status = 'cancelled';
    }
  }

  async createTestPlayers(n) {
    let k = 0, made = 0;
    while (made < n) {
      k++;
      if (this.db.profiles.some(p => p.nickname === 'Тест ' + k)) continue;
      const id = uid();
      this.db.profiles.push({ id, nickname: 'Тест ' + k, full_name: 'Тестовый игрок', avatar: '🧪', color: '#8ab4f8', role: 'player', status: 'approved', is_test: true, created_at: new Date().toISOString() });
      this.db.club_members.push({ club_id: this.cid, user_id: id, role: 'player', status: 'active', via: 'test', joined_at: new Date().toISOString() });
      made++;
    }
    this.save(); return made;
  }
  async purgeTest() {
    const ids = new Set(this.db.profiles.filter(p => p.is_test).map(p => p.id));
    const touches = r => r.is_test || [r.player1_id, r.player2_id, r.player3_id, r.player4_id, r.from_id, r.to_id].some(x => ids.has(x));
    for (const t of ['matches', 'live_matches', 'challenges', 'tournaments', 'announcements']) this.db[t] = (this.db[t] || []).filter(r => !touches(r));
    this.db.profiles = this.db.profiles.filter(p => !p.is_test);
    this.db.club_members = this.db.club_members.filter(m => !ids.has(m.user_id));
    this.db.audit = (this.db.audit || []).filter(e => !touches(e.old_data || {}) && !touches(e.new_data || {}));
    this.save();
  }
  log(action, table, old, neu, reason) {
    (this.db.audit = this.db.audit || []).unshift({ id: (this.db.audit[0]?.id || 0) + 1, club_id: this.cid, at: new Date().toISOString(), actor_id: this.db.session, action, table_name: table, record_id: (neu || old).id, old_data: old, new_data: neu, reason });
  }
  async deleteMatch(id, reason) {
    this.predCancel(e => e.match_id === id);
    const m = this.db.matches.find(x => x.id === id);
    this.db.matches = this.db.matches.filter(x => x.id !== id);
    if (m) this.log('delete', 'matches', m, null, reason);
    this.save();
  }
  async deleteTournament(id, reason) {
    this.db.matches.filter(m => m.tournament_id === id).forEach(m => this.log('delete', 'matches', m, null, reason));
    const t = this.db.tournaments.find(x => x.id === id);
    if (t) this.log('delete', 'tournaments', t, null, reason);
    await this.remove('tournaments', id);
  }
  async loadAudit() { return JSON.parse(JSON.stringify((this.db.audit || []).filter(e => e.club_id === this.cid))); }
  async restoreMatch(logId) {
    const e = (this.db.audit || []).find(x => x.id === logId);
    if (e && !this.db.matches.some(m => m.id === e.old_data.id)) { this.db.matches.push({ ...e.old_data }); this.log('insert', 'matches', null, e.old_data, 'Восстановлен из журнала'); this.save(); }
  }
  async listBackups() { return []; }
  async backupUrl() { throw new Error('В демо-режиме резервных копий нет'); }
  async backupNow() { throw new Error('В демо-режиме резервных копий нет'); }
  async adminDeletePlayer(id, cid = this.cid, self = false) {
    if (!self) this.needAdmin(cid);
    const m = this.mem(cid, id);
    if (!m) return;
    if (m.role === 'owner') throw new Error('Сначала передайте клуб другому участнику');
    const played = this.db.matches.some(x => x.club_id === cid && [x.player1_id, x.player2_id, x.player3_id, x.player4_id].includes(id));
    if (played) Object.assign(m, { status: 'former', role: 'player' }); else this.db.club_members = this.db.club_members.filter(x => x !== m);
    this.save();
  }
  async founderDeletePlayer(id) {
    this.needFounder();
    const p = this.db.profiles.find(x => x.id === id);
    Object.assign(p, { nickname: 'Бывший игрок ' + id.slice(-4), full_name: null, photo_url: null, bio: null, hand: null, avatar: '👤', color: '#adb5bd', role: 'player', status: 'deleted' });
    this.db.users = this.db.users.filter(u => u.id !== id);
    this.save();
  }
  async adminEmails() { return new Map(this.db.users.map(u => [u.id, u.email])); }
  async uploadAvatar(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  }
  async pushPublicKey() { throw new Error('Уведомления работают только после подключения базы'); }
  async savePushSub() {}
  async deletePushSub() {}
  async testPush() {}
  subscribe(cb) { this.onChange = cb; }
}

// Песочница: только боты; клуб тестировщик создаёт сам
function seedSandbox() {
  const now = Date.now(), day = 864e5;
  const bots = [['Ace', 'Антон', '🤖', '#2563b8', 0.85], ['Spin_Master', 'Вика', '🌀', '#2a9d8f', 0.8], ['Viper', 'Денис', '🐍', '#12a061', 0.7], ['Rocket', 'Ильдар', '🚀', '#e63946', 0.65],
    ['Lefty', 'Алина', '🦄', '#c77dff', 0.6], ['Wall', 'Сергей', '🧱', '#8ab4f8', 0.55], ['Smash', 'Артём', '🔥', '#f4a261', 0.5], ['Rookie', 'Максим', '🐣', '#06d6a0', 0.35]];
  const profiles = bots.map(([nickname, full_name, avatar, color, skill], i) => ({ id: 'bot-' + (i + 1), nickname, full_name, avatar, color, skill, bot: true, role: 'player', status: 'approved',
    hand: i === 4 ? 'left' : 'right', bio: 'Бот песочницы', initial_rating: null, created_at: new Date(now - 30 * day).toISOString() }));
  const users = profiles.map(p => ({ id: p.id, email: p.id + '@sandbox.ponghub.app', password: uid() }));
  return { users, profiles, matches: [], tournaments: [], events: [], challenges: [], audit: [], settings: {}, clubs: [], invites: {}, club_members: [],
    platform: { migration_done: true, features: { shop: 'all', resale: 'all', avatar: 'all' } }, session: null };
}

function seedDemo(opts = {}) {
  // Детерминированный генератор, чтобы демо выглядело одинаково
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const day = 864e5;
  const now = Date.now();
  const people = [
    ['Rustam', 'Рустам', '😎', '#e63946', 1.0, 'admin'],
    ['Smash', 'Артём', '🔥', '#f4a261', 0.9, 'editor'],
    ['Topspin', 'Дмитрий', '🌀', '#2a9d8f', 0.85, 'player'],
    ['Kirill_K', 'Кирилл', '🦊', '#e76f51', 0.7, 'player'],
    ['Wall', 'Сергей', '🧱', '#8ab4f8', 0.65, 'player'],
    ['Lefty', 'Алина', '🦄', '#c77dff', 0.6, 'player'],
    ['Backhand', 'Игорь', '⚡', '#ffd166', 0.5, 'player'],
    ['Rookie', 'Максим', '🐣', '#06d6a0', 0.35, 'player'],
  ];
  const profiles = people.map(([nickname, full_name, avatar, color, , role], i) => ({
    id: 'demo-' + (i + 1), nickname, full_name, avatar, color, role, status: 'approved',
    hand: i === 5 ? 'left' : 'right', bio: '', initial_rating: i === 0 ? 50 : null,
    created_at: new Date(now - 75 * day).toISOString(),
  }));
  profiles.push({ id: 'demo-9', nickname: 'NewGuy', full_name: 'Олег Новиков', avatar: '🏓', color: '#adb5bd', role: 'player', status: 'pending', initial_rating: null, created_at: new Date(now - day).toISOString() });
  const users = profiles.map((p, i) => ({ id: p.id, email: `demo${i + 1}@ponghub.app`, password: 'demo123' }));
  const skill = Object.fromEntries(people.map((x, i) => ['demo-' + (i + 1), x[4]]));

  const playSet = (pa, pb, to = 11) => {
    const aWins = rnd() < 0.5 + (pa - pb) * 0.45;
    let lo = Math.floor(rnd() * (to - 1));
    let hi = to;
    if (rnd() < 0.18) { lo = to - 1 + Math.floor(rnd() * 3); hi = lo + 2; }
    return aWins ? [hi, lo] : [lo, hi];
  };
  const makeMatch = (a, b, t, extra = {}) => {
    const bestOf = extra.best_of || (rnd() < 0.7 ? 5 : 3);
    const need = Math.ceil(bestOf / 2);
    const sets = []; let s1 = 0, s2 = 0;
    while (s1 < need && s2 < need) { const s = playSet(skill[a], skill[b]); sets.push(s); s[0] > s[1] ? s1++ : s2++; }
    return {
      id: uid(), type: 'free', tournament_id: null, stage: null, grp: null, round: null, slot: null,
      player1_id: a, player2_id: b, sets, sets1: s1, sets2: s2, winner_id: s1 > s2 ? a : b,
      best_of: bestOf, points_to: 11, status: 'approved', submitted_by: 'demo-1',
      played_at: new Date(t).toISOString(), created_at: new Date(t).toISOString(), note: '', ...extra,
    };
  };
  const ids = profiles.filter(p => p.status === 'approved').map(p => p.id);
  const matches = [];
  for (let k = 0; k < 46; k++) {
    const a = ids[Math.floor(rnd() * ids.length)];
    let b = a; while (b === a) b = ids[Math.floor(rnd() * ids.length)];
    matches.push(makeMatch(a, b, now - (70 - k * 1.45) * day - rnd() * 3e7));
  }
  // Завершённый турнир (олимпийка на 8)
  const t1 = 'demo-t1', t1Time = now - 30 * day;
  const seeds = ['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5', 'demo-6', 'demo-7', 'demo-8'];
  const slots = [seeds[0], seeds[7], seeds[3], seeds[4], seeds[1], seeds[6], seeds[2], seeds[5]];
  let cur = slots; let r = 0; const tm = [];
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i < cur.length / 2; i++) {
      const m = makeMatch(cur[2 * i], cur[2 * i + 1], t1Time + r * 36e5 + i * 6e5,
        { type: 'tournament', tournament_id: t1, stage: 'ko', round: r, slot: i, best_of: 5 });
      tm.push(m); next.push(m.winner_id);
    }
    cur = next; r++;
  }
  const semis = tm.filter(m => m.round === 1);
  const third = makeMatch(semis[0].winner_id === semis[0].player1_id ? semis[0].player2_id : semis[0].player1_id,
    semis[1].winner_id === semis[1].player1_id ? semis[1].player2_id : semis[1].player1_id,
    t1Time + 2 * 36e5, { type: 'tournament', tournament_id: t1, stage: 'ko3', round: 0, slot: 0, best_of: 5 });
  tm.push(third);
  const fin = tm.find(m => m.round === 2);
  matches.push(...tm);
  // Активный круговой турнир
  const t2 = 'demo-t2', t2ids = ['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-6'];
  const t2Time = now - 2 * day;
  let n = 0;
  for (let i = 0; i < t2ids.length; i++) for (let j = i + 1; j < t2ids.length; j++) {
    if (n++ >= 6) break;
    matches.push(makeMatch(t2ids[i], t2ids[j], t2Time + n * 9e5, { type: 'tournament', tournament_id: t2, stage: 'rr', best_of: 3 }));
  }
  matches.push({ ...makeMatch('demo-7', 'demo-8', now - 3 * 36e5), status: 'pending', submitted_by: 'demo-7' });
  // Парные игры 2×2
  const quads = [['demo-1', 'demo-5', 'demo-2', 'demo-6'], ['demo-3', 'demo-4', 'demo-1', 'demo-8'], ['demo-2', 'demo-7', 'demo-3', 'demo-5'], ['demo-1', 'demo-5', 'demo-3', 'demo-4'], ['demo-6', 'demo-2', 'demo-4', 'demo-7']];
  quads.forEach(([a, c, b, d], k) => matches.push(makeMatch(a, b, now - (20 - k * 3) * day, { kind: 'doubles', player3_id: c, player4_id: d, best_of: 3 })));
  const challenges = [
    { id: uid(), from_id: 'demo-4', to_id: 'demo-1', status: 'pending', message: 'Реванш за кубок?', match_id: null, created_at: new Date(now - 2 * 36e5).toISOString() },
    { id: uid(), from_id: 'demo-1', to_id: 'demo-3', status: 'accepted', message: '', match_id: null, created_at: new Date(now - day).toISOString() },
  ];

  const tournaments = [
    { id: t1, name: 'Осенний кубок', date: new Date(t1Time).toISOString().slice(0, 10), place: 'Офис, 3 этаж', format: 'ko', best_of: 5, points_to: 11, status: 'finished', participants: seeds, config: { slots, thirdPlace: true }, results: { gold: fin.winner_id, silver: fin.winner_id === fin.player1_id ? fin.player2_id : fin.player1_id, bronze: [third.winner_id] }, created_by: 'demo-1', created_at: new Date(t1Time - day).toISOString() },
    { id: t2, name: 'Пятничная лига', date: new Date(t2Time).toISOString().slice(0, 10), place: 'Офис, 3 этаж', format: 'rr', best_of: 3, points_to: 11, status: 'active', participants: t2ids, config: {}, results: null, created_by: 'demo-1', created_at: new Date(t2Time - day).toISOString() },
  ];
  const events = [
    { id: uid(), title: 'Вечерняя игра', starts_at: new Date(now + 2 * day).toISOString(), place: 'Офис, 3 этаж', note: 'Берите свои ракетки', attendees: ['demo-1', 'demo-2', 'demo-5'], created_by: 'demo-1', created_at: new Date().toISOString() },
    { id: uid(), title: 'Зимний кубок', starts_at: new Date(now + 12 * day).toISOString(), place: 'Спортклуб «Ракетка»', note: 'Олимпийская система, до 3 побед', attendees: ['demo-1'], created_by: 'demo-1', created_at: new Date().toISOString() },
  ];
  profiles[0].is_founder = true;
  // ещё два клуба — для карты и поиска
  const extra = [['demo-x1', 'Gilm', '🦅', '#2563b8'], ['demo-x2', 'Arsen', '🐺', '#6a4c93'], ['demo-x3', 'Liya', '🌸', '#ff70a6']];
  for (const [id, nickname, avatar, color] of extra) {
    profiles.push({ id, nickname, full_name: '', avatar, color, role: 'player', status: 'approved', initial_rating: null, created_at: new Date(now - 40 * day).toISOString() });
    users.push({ id, email: id + '@ponghub.app', password: 'demo123' });
  }
  const clubs = [
    { id: 'demo-club', code: 'PH-7K2Q', name: 'Коворкинг «Точка»', city: 'Казань', address: 'ул. Баумана, 44', lat: 55.7887, lng: 49.1221, description: 'Стол на 3 этаже, играем в обед и после 18:00', visible: true, blocked: false, owner_id: 'demo-1', settings: {}, created_at: new Date(now - 80 * day).toISOString() },
    { id: 'demo-club2', code: 'PH-3XM8', name: 'IT-Парк Пинг', city: 'Казань', address: 'ул. Петербургская, 52', lat: 55.7744, lng: 49.1426, description: '', visible: true, blocked: false, owner_id: 'demo-x1', settings: {}, created_at: new Date(now - 60 * day).toISOString() },
    { id: 'demo-club3', code: 'PH-5RT1', name: 'СК «Ракетка»', city: 'Казань', address: 'пр. Победы, 78', lat: 55.7531, lng: 49.2163, description: '', visible: true, blocked: false, owner_id: 'demo-x3', settings: {}, created_at: new Date(now - 50 * day).toISOString() },
  ];
  const invites = { 'demo-club': 'K7Q2M9XA', 'demo-club2': 'P4W8N2TR', 'demo-club3': 'Z5H3L7QC' };
  const club_members = [
    { club_id: 'demo-club2', user_id: 'demo-x1', role: 'owner', status: 'active' }, { club_id: 'demo-club2', user_id: 'demo-x2', role: 'player', status: 'active' },
    { club_id: 'demo-club3', user_id: 'demo-x3', role: 'owner', status: 'active' }, { club_id: 'demo-club3', user_id: 'demo-x2', role: 'player', status: 'active' },
  ];
  const xm = [];
  for (let k = 0; k < 8; k++) { const a = k % 2 ? 'demo-x1' : 'demo-x2'; const m = makeMatch(a, a === 'demo-x1' ? 'demo-x2' : 'demo-x1', now - (20 - k) * day); m.club_id = 'demo-club2'; m.submitted_by = 'demo-x1'; xm.push(m); }
  if (opts.legacy) {
    // как до клубов: всё без клуба, основатель переносит сам
    profiles.forEach(p => { if (!p.id.startsWith('demo-x')) p.legacy = true; });
    return { users, profiles, matches: [...matches, ...xm], tournaments, events, challenges, audit: [], settings: { clubName: 'Коворкинг' }, clubs: clubs.slice(1), invites, club_members, platform: { migration_done: false }, session: null };
  }
  for (const r of [...matches, ...tournaments, ...events, ...challenges]) r.club_id = 'demo-club';
  profiles.forEach(p => {
    if (p.id.startsWith('demo-x')) return;
    club_members.push({ club_id: 'demo-club', user_id: p.id, role: p.role === 'admin' ? 'owner' : p.role === 'editor' ? 'helper' : 'player', status: p.status === 'pending' ? 'pending' : 'active', initial_rating: p.initial_rating });
  });
  club_members.push({ club_id: 'demo-club2', user_id: 'demo-4', role: 'player', status: 'active' });
  return { users, profiles, matches: [...matches, ...xm], tournaments, events, challenges, audit: [], settings: {}, clubs, invites, club_members, platform: { migration_done: true, features: { newclub: 'founder', shop: 'founder', resale: 'founder', avatar: 'founder' } }, session: null };
}
