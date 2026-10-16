// Слой данных: Supabase (боевой режим) или localStorage (демо-режим, если база не настроена).
import { CONFIG } from './config.js';

const TABLES = ['profiles', 'matches', 'tournaments', 'events', 'challenges', 'live_matches', 'announcements', 'pred_events', 'predictions', 'coin_tx'];

export async function createStore() {
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
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm');
    this.sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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

  async loadAll() {
    const q = t => this.sb.from(t).select('*');
    const [p, m, t, e, c, s, l, a, pe, pr] = await Promise.all([
      q('profiles'), q('matches'), q('tournaments'), q('events'), q('challenges'),
      this.sb.from('settings').select('data').eq('id', 1).maybeSingle(),
      this.sb.from('live_matches').select('*').eq('status', 'live'),
      this.sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(100),
      this.sb.from('pred_events').select('*').order('created_at', { ascending: false }).limit(150),
      this.sb.from('predictions').select('*').order('created_at', { ascending: false }).limit(300),
    ]);
    for (const r of [p, m, t, e, s]) if (r.error) throw translateError(r.error);
    // вызовы появятся после обновления базы — без таблицы приложение тоже работает
    return { profiles: p.data, matches: m.data, tournaments: t.data, events: e.data, challenges: c.error ? [] : c.data, live: l.error ? [] : l.data, announcements: a.error ? [] : a.data, predEvents: pe.error ? [] : pe.data, predictions: pr.error ? [] : pr.data, settings: s.data?.data || {} };
  }

  async insert(table, row) {
    const { data, error } = await this.sb.from(table).insert(row).select().single();
    if (error) throw translateError(error);
    return data;
  }

  async insertMany(table, rows) {
    if (!rows.length) return [];
    const { data, error } = await this.sb.from(table).insert(rows).select();
    if (error) throw translateError(error);
    return data;
  }

  async update(table, id, patch) {
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
    const { error } = await this.sb.from('settings').upsert({ id: 1, data });
    if (error) throw translateError(error);
  }

  async toggleRsvp(eventId) {
    const { error } = await this.sb.rpc('toggle_rsvp', { event_id: eventId });
    if (error) throw translateError(error);
  }

  async rpc(name, args = {}) {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw translateError(error);
    return data;
  }

  async createTestPlayers(n) {
    const { data, error } = await this.sb.rpc('admin_create_test_players', { n });
    if (error) throw translateError(error);
    return data;
  }

  async purgeTest() {
    const { error } = await this.sb.rpc('admin_purge_test');
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

  async adminDeletePlayer(id) {
    const { data: files } = await this.sb.storage.from('avatars').list(id);
    if (files?.length) await this.sb.storage.from('avatars').remove(files.map(f => `${id}/${f.name}`));
    const { error } = await this.sb.rpc('admin_delete_player', { target: id });
    if (error) throw translateError(error);
  }

  async adminEmails() {
    const { data, error } = await this.sb.rpc('admin_emails');
    if (error) return new Map();
    return new Map((data || []).map(r => [r.id, r.email]));
  }

  async uploadAvatar(blob) {
    const { data: { user } } = await this.sb.auth.getUser();
    const path = `${user.id}/${Date.now()}.jpg`;
    const { error } = await this.sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw translateError(error);
    return this.sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
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
    const ch = this.sb.channel('ponghub-all');
    for (const t of [...TABLES, 'settings'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
        clearTimeout(timer); timer = setTimeout(cb, 400);
      });
    ch.subscribe();
  }
}

// ───────────────────────── Демо-режим ─────────────────────────

const LS_KEY = 'ponghub_demo_v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

class LocalStore {
  mode = 'demo';
  listeners = [];

  constructor() {
    try { this.db = JSON.parse(localStorage.getItem(LS_KEY)); } catch { this.db = null; }
    if (!this.db) { this.db = seedDemo(); this.save(); }
  }

  save() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.db)); } catch { /* приватный режим */ } }
  reset() { this.db = seedDemo(); this.save(); }

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
    this.db.profiles.push({ id, nickname, full_name, avatar: '🏓', color: '#e63946', role: 'player', status: 'pending', initial_rating: null, created_at: new Date().toISOString() });
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

  async loadAll() {
    const c = JSON.parse(JSON.stringify(this.db));
    return { profiles: c.profiles, matches: c.matches, tournaments: c.tournaments, events: c.events, challenges: c.challenges || [], live: (c.live_matches || []).filter(x => x.status === 'live'), announcements: [...(c.announcements || [])].sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at)),
      predEvents: [...(c.pred_events || [])].reverse(), predictions: (c.predictions || []).filter(x => x.user_id === c.session).reverse(), settings: c.settings || {} };
  }

  async insert(table, row) {
    const r = { id: uid(), created_at: new Date().toISOString(), ...row };
    (this.db[table] = this.db[table] || []).push(r); this.save();
    return r;
  }

  async insertMany(table, rows) { const out = []; for (const r of rows) out.push(await this.insert(table, r)); return out; }

  async update(table, id, patch) {
    const r = this.db[table].find(x => x.id === id);
    if (!r) throw new Error('Запись не найдена');
    Object.assign(r, patch);
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

  async saveSettings(data) { this.db.settings = data; this.save(); }

  async toggleRsvp(eventId) {
    const e = this.db.events.find(x => x.id === eventId);
    const me = this.db.session;
    e.attendees = e.attendees.includes(me) ? e.attendees.filter(x => x !== me) : [...e.attendees, me];
    this.save();
  }

  // ── прогнозы в демо-режиме (упрощённая копия серверной логики) ──
  coinBal(uid) { return (this.db.coin_tx || []).filter(t => t.user_id === uid).reduce((a, t) => a + t.amount, 0); }
  tx(user_id, amount, kind, ref = null) { (this.db.coin_tx = this.db.coin_tx || []).push({ id: uid(), user_id, amount, kind, ref, created_at: new Date().toISOString() }); }
  predSetting(k, d) { return this.db.settings?.[k] ?? d; }
  async rpc(name, a = {}) {
    const me = this.db.session;
    this.db.pred_events = this.db.pred_events || []; this.db.predictions = this.db.predictions || [];
    if (name === 'ensure_wallet') { if (!(this.db.coin_tx || []).some(t => t.user_id === me)) { this.tx(me, this.predSetting('predStart', 1000), 'start'); this.save(); } return this.coinBal(me); }
    if (name === 'create_pred_event') {
      const ex = this.db.pred_events.find(e => e.source_id === a.src_id); if (ex) return ex.id;
      const srcRow = a.src === 'live' ? (this.db.live_matches || []).find(x => x.id === a.src_id) : (this.db.challenges || []).find(x => x.id === a.src_id);
      if (!srcRow) return null;
      const c = Math.min(0.95, Math.max(0.05, a.chance));
      const ev = { id: uid(), source: a.src, source_id: a.src_id, kind: srcRow.kind || 'singles', player1_id: srcRow.player1_id || srcRow.from_id, player2_id: srcRow.player2_id || srcRow.to_id, player3_id: srcRow.player3_id || null, player4_id: srcRow.player4_id || null,
        tournament_id: srcRow.tournament_id || null, closes_at: srcRow.scoring === false ? new Date(Date.now() + this.predSetting('predWindowMin', 3) * 6e4).toISOString() : null, chance1: c, odds1: Math.min(10, Math.round(100 / c) / 100), odds2: Math.min(10, Math.round(100 / (1 - c)) / 100), status: 'open', bets_count: 0, pool1: 0, pool2: 0, is_test: !!srcRow.is_test, created_by: me, created_at: new Date().toISOString() };
      this.db.pred_events.push(ev); this.save(); return ev.id;
    }
    if (name === 'place_prediction') {
      const e = this.db.pred_events.find(x => x.id === a.eid);
      if (!e || e.status !== 'open') throw new Error('Приём прогнозов закрыт');
      if (e.closes_at && Date.now() > Date.parse(e.closes_at)) { e.status = 'closed'; this.save(); throw new Error('Время приёма прогнозов вышло'); }
      if ([e.player1_id, e.player2_id, e.player3_id, e.player4_id].includes(me)) throw new Error('На свой матч прогноз сделать нельзя');
      if (e.source === 'live') { const l = (this.db.live_matches || []).find(x => x.id === e.source_id); if (!l || l.status !== 'live' || (l.log || []).length) { e.status = 'closed'; this.save(); throw new Error('Игра уже началась — приём прогнозов закрыт'); } }
      if (this.db.predictions.some(p => p.event_id === e.id && p.user_id === me)) throw new Error('Вы уже сделали прогноз на этот матч');
      const min = this.predSetting('predMin', 10), max = this.predSetting('predMax', 500);
      if (a.amount < min || a.amount > max) throw new Error(`Ставка от ${min} до ${max} PC`);
      await this.rpc('ensure_wallet');
      if (this.coinBal(me) < a.amount) throw new Error(`Недостаточно пинг-коинов (у вас ${this.coinBal(me)})`);
      this.db.predictions.push({ id: uid(), event_id: e.id, user_id: me, side: a.pick, stake: a.amount, odds: a.pick === 1 ? e.odds1 : e.odds2, status: 'open', created_at: new Date().toISOString() });
      this.tx(me, -a.amount, 'bet', e.id);
      e.bets_count++; e['pool' + a.pick] += a.amount; this.save(); return this.coinBal(me);
    }
    if (name === 'coin_leaderboard') {
      const since = a.since ? Date.parse(a.since) : 0;
      const ids = [...new Set((this.db.coin_tx || []).map(t => t.user_id))];
      return ids.map(id => {
        const tx = this.db.coin_tx.filter(t => t.user_id === id), pr = this.db.predictions.filter(p => p.user_id === id && Date.parse(p.created_at) >= since);
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
      this.db.profiles.push({ id: uid(), nickname: 'Тест ' + k, full_name: 'Тестовый игрок', avatar: '🧪', color: '#8ab4f8', role: 'player', status: 'approved', is_test: true, created_at: new Date().toISOString() });
      made++;
    }
    this.save(); return made;
  }
  async purgeTest() {
    const ids = new Set(this.db.profiles.filter(p => p.is_test).map(p => p.id));
    const touches = r => r.is_test || [r.player1_id, r.player2_id, r.player3_id, r.player4_id, r.from_id, r.to_id].some(x => ids.has(x));
    for (const t of ['matches', 'live_matches', 'challenges', 'tournaments', 'announcements']) this.db[t] = (this.db[t] || []).filter(r => !touches(r));
    this.db.profiles = this.db.profiles.filter(p => !p.is_test);
    this.db.audit = (this.db.audit || []).filter(e => !touches(e.old_data || {}) && !touches(e.new_data || {}));
    this.save();
  }
  log(action, table, old, neu, reason) {
    (this.db.audit = this.db.audit || []).unshift({ id: (this.db.audit[0]?.id || 0) + 1, at: new Date().toISOString(), actor_id: this.db.session, action, table_name: table, record_id: (neu || old).id, old_data: old, new_data: neu, reason });
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
  async loadAudit() { return JSON.parse(JSON.stringify(this.db.audit || [])); }
  async restoreMatch(logId) {
    const e = (this.db.audit || []).find(x => x.id === logId);
    if (e && !this.db.matches.some(m => m.id === e.old_data.id)) { this.db.matches.push({ ...e.old_data }); this.log('insert', 'matches', null, e.old_data, 'Восстановлен из журнала'); this.save(); }
  }
  async listBackups() { return []; }
  async backupUrl() { throw new Error('В демо-режиме резервных копий нет'); }
  async backupNow() { throw new Error('В демо-режиме резервных копий нет'); }
  async adminDeletePlayer(id) {
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
  subscribe() {}
}

function seedDemo() {
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
  return { users, profiles, matches, tournaments, events, challenges, audit: [], settings: {}, session: null };
}
