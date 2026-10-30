// PongHub — рассылка push-уведомлений (Supabase Edge Function).
// Вызывается: 1) базой данных при изменениях (с секретом), 2) приложением: {action: 'vapid' | 'test'}.
// Ключи VAPID создаются автоматически при первом запуске и хранятся в таблице app_secrets.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';
// Тот же движок рейтинга, что и в приложении: engine.js — копия js/engine.js (обновлять вместе)
import { analyze, analyzeDoubles, weekSummary, seasonTable, monthKey, monthName, LEAGUES, playerStats } from './engine.js';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function getSecret(key: string): Promise<string | null> {
  const { data } = await sb.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

let vapidPublic: string | null = null;
async function initVapid(): Promise<string> {
  if (vapidPublic) return vapidPublic;
  let pub = await getSecret('vapid_public');
  let priv = await getSecret('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    // одной вставкой и без перезаписи — если два запроса пришли одновременно, пара ключей не перемешается
    await sb.from('app_secrets').upsert(
      [{ key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }],
      { onConflict: 'key', ignoreDuplicates: true },
    );
    pub = await getSecret('vapid_public');
    priv = await getSecret('vapid_private');
  }
  webpush.setVapidDetails('mailto:noreply@ponghub.app', pub!, priv!);
  vapidPublic = pub!;
  return pub!;
}

type Msg = { title: string; body: string; url?: string; tag?: string };

async function sendPush(userIds: (string | null | undefined)[], msg: Msg): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  if (!ids.length) return 0;
  await initVapid();
  const { data: subs } = await sb.from('push_subscriptions').select('*').in('user_id', ids);
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
        { TTL: 86400 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('push error', code, (e as { body?: string }).body);
    }
  }));
  return sent;
}

// участники клуба в привычном виде: роль admin/editor/player, статус approved/pending/archived
const ROLE: Record<string, string> = { owner: 'admin', helper: 'editor', player: 'player' };
const STATUS: Record<string, string> = { active: 'approved', pending: 'pending', archived: 'archived', former: 'archived' };
async function members(clubId: string) {
  const { data } = await sb.from('club_members').select('role, status, initial_rating, joined_at, profile:profiles(*)').eq('club_id', clubId);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).filter((m: any) => m.profile && !m.profile.is_test).map((m: any) => ({
    ...m.profile, role: ROLE[m.role] ?? 'player', initial_rating: m.initial_rating, joined_at: m.joined_at,
    status: m.profile.status === 'deleted' ? 'deleted' : STATUS[m.status] ?? 'archived',
  }));
}

async function club(clubId: string) {
  const { data } = await sb.from('clubs').select('id, name, settings, blocked').eq('id', clubId).maybeSingle();
  return data;
}

// ссылка из уведомления открывает нужный клуб
const inClub = (url: string, clubId: string) => url + (url.includes('?') ? '&' : '?') + 'club=' + clubId;

// deno-lint-ignore no-explicit-any
async function onChange(table: string, type: string, r: any, o: any, actor: string | null = null, reason: string | null = null) {
  const clubId: string | null = r?.club_id ?? o?.club_id ?? null;
  if (!clubId) return;  // данные вне клуба (до переноса истории) — без уведомлений
  const cl = await club(clubId);
  if (!cl || cl.blocked) return;
  const ps = await members(clubId);
  const send = (ids: (string | null | undefined)[], msg: Msg) => sendPush(ids, { ...msg, url: inClub(msg.url ?? '#/home', clubId) });
  const nick = (id: string) => ps.find((p) => p.id === id)?.nickname ?? 'Игрок';
  const approved = ps.filter((p) => p.status === 'approved');
  const admins = approved.filter((p) => p.role === 'admin').map((p) => p.id);
  const editors = approved.filter((p) => p.role === 'admin' || p.role === 'editor').map((p) => p.id);
  const all = approved.map((p) => p.id);
  const except = (ids: string[], ...skip: (string | null)[]) => ids.filter((id) => !skip.includes(id));

  if (table === 'club_members') {
    const who = ps.find((p) => p.id === r.user_id)?.nickname
      ?? (await sb.from('profiles').select('nickname').eq('id', r.user_id).maybeSingle()).data?.nickname ?? 'Игрок';
    if (r.status === 'pending' && (type === 'INSERT' || o?.status !== 'pending'))
      return send(admins, { title: 'Новая заявка в клуб', body: `${who} хочет вступить в «${cl.name}»${r.via === 'invite' ? ' (по приглашению)' : ''}`, url: '#/admin/reqs', tag: 'reqs' });
    if (type === 'UPDATE' && o?.status === 'pending' && r.status === 'active')
      return send([r.user_id], { title: `Добро пожаловать в «${cl.name}»! 🏓`, body: 'Заявка одобрена — заходите', url: '#/home' });
    if (type === 'UPDATE' && o?.role !== 'helper' && r.role === 'helper')
      return send([r.user_id], { title: 'Вы теперь помощник ✍️', body: `В клубе «${cl.name}» можете сразу вносить результаты своих матчей`, url: '#/home' });
    if (type === 'UPDATE' && o?.role !== 'owner' && r.role === 'owner')
      return send([r.user_id], { title: 'Вам передали клуб 👑', body: `Теперь вы управляете клубом «${cl.name}»`, url: '#/admin' });
    return;
  }

  if (table === 'pred_events' && type === 'INSERT') {
    const players = [r.player1_id, r.player2_id, r.player3_id, r.player4_id].filter(Boolean);
    const name = (side: number) => side === 1
      ? [r.player1_id, r.player3_id].filter(Boolean).map(nick).join(' + ')
      : [r.player2_id, r.player4_id].filter(Boolean).map(nick).join(' + ');
    return send(except(all, ...players, r.created_by), { title: '🎯 Можно сделать прогноз', body: `${name(1)} ×${r.odds1} — ${name(2)} ×${r.odds2}. ${r.closes_at ? 'Игра началась — приём прогнозов несколько минут!' : 'Успейте до первого очка!'}`, url: '#/predict', tag: 'pred-' + r.id });
  }

  if (table === 'predictions' && type === 'UPDATE' && o?.status === 'open') {
    if (r.status === 'won') return send([r.user_id], { title: `🎯 Прогноз сыграл: +${r.payout} PC`, body: `Ставка ${r.stake} × ${r.odds}`, url: '#/predict', tag: 'pred-res-' + r.id });
    if (r.status === 'refunded') return send([r.user_id], { title: 'Прогноз возвращён', body: `Матч отменён — ${r.stake} PC вернулись на счёт`, url: '#/predict' });
    return;
  }

  if (table === 'announcements' && type === 'INSERT') {
    const text = String(r.body ?? '');
    const to = Array.isArray(r.recipients) && r.recipients.length ? r.recipients : all;
    return send(except(to, r.created_by), { title: r.title ? `📢 ${r.title}` : to === all ? `📢 Объявление · ${cl.name}` : `✉️ Сообщение · ${cl.name}`, body: text.length > 180 ? text.slice(0, 177) + '…' : text, url: '#/inbox', tag: 'ann-' + r.id });
  }

  if (table === 'challenges') {
    if (type === 'INSERT' && r.status === 'pending')
      return send([r.to_id], { title: '⚔️ Вызов на матч', body: `${nick(r.from_id)} вызывает вас на матч${r.message ? ': «' + r.message + '»' : ''}`, url: '#/home', tag: 'challenge' });
    if (type === 'UPDATE' && o?.status === 'pending' && r.status === 'accepted')
      return send([r.from_id], { title: '✅ Вызов принят', body: `${nick(r.to_id)} принял ваш вызов — к столу!`, url: '#/home' });
    if (type === 'UPDATE' && o?.status === 'pending' && r.status === 'declined')
      return send([r.from_id], { title: 'Вызов отклонён', body: `${nick(r.to_id)} сейчас не может сыграть`, url: '#/home' });
    return;
  }

  if (table === 'matches' && type === 'DELETE') {
    // о каждом удалении, сделанном не владельцем, — уведомление владельцу (матчи удалённого турнира не дублируем)
    if (!o || o.tournament_id || admins.includes(actor) || !actor) return;
    const sc = o.kind === 'doubles'
      ? `${nick(o.player1_id)} + ${nick(o.player3_id)} ${o.sets1}:${o.sets2} ${nick(o.player2_id)} + ${nick(o.player4_id)}`
      : `${nick(o.player1_id)} ${o.sets1}:${o.sets2} ${nick(o.player2_id)}`;
    return send(admins, { title: `🗑️ ${nick(actor)} удалил матч`, body: `${sc}. Причина: ${reason || 'не указана'}`, url: '#/admin/log', tag: 'audit' });
  }

  if (table === 'matches') {
    const dbl = r.kind === 'doubles';
    const score = dbl
      ? `${nick(r.player1_id)} + ${nick(r.player3_id)} ${r.sets1}:${r.sets2} ${nick(r.player2_id)} + ${nick(r.player4_id)}`
      : `${nick(r.player1_id)} ${r.sets1}:${r.sets2} ${nick(r.player2_id)}`;
    if (type === 'INSERT' && r.status === 'pending')
      return send(except(admins, r.submitted_by), { title: 'Результат ждёт подтверждения', body: score, url: '#/admin/matches', tag: 'pending' });
    const becameApproved = r.status === 'approved' && (type === 'INSERT' || o?.status !== 'approved');
    if (becameApproved) {
      const players = dbl ? [r.player1_id, r.player2_id, r.player3_id, r.player4_id] : [r.player1_id, r.player2_id];
      return send(type === 'INSERT' ? except(players, r.submitted_by) : players, {
        title: dbl ? '👥 Парная игра засчитана' : r.type === 'tournament' ? '🏆 Турнирный матч засчитан' : '🏓 Матч засчитан',
        body: `${score}${r.rated === false ? ' · без рейтинга' : ' · рейтинг обновлён'}`,
        url: '#/matches',
      });
    }
    return;
  }

  if (table === 'tournaments') {
    // объявлен заранее — всем в клубе: открыта запись
    if (type === 'INSERT' && r.status === 'open') {
      return send(except(all, r.created_by), { title: `🏆 Запись на турнир «${r.name}»`, body: `${tourWhen(r, cl)}${r.place ? ' · ' + r.place : ''} — записывайтесь!`, url: `#/tournament/${r.id}` });
    }
    // дата была «уточняется» — владелец назначил точную
    if (type === 'UPDATE' && r.status === 'open' && !o?.starts_at && r.starts_at)
      return send(except(all, r.created_by), { title: `📅 Назначена дата турнира «${r.name}»`, body: `${tourWhen(r, cl)}${r.place ? ' · ' + r.place : ''}`, url: `#/tournament/${r.id}` });
    if (type === 'INSERT')
      return send(except(r.participants ?? [], r.created_by), { title: 'Новый турнир', body: `«${r.name}» — вы в списке участников`, url: `#/tournament/${r.id}` });
    if (type === 'UPDATE' && o?.status === 'open' && r.status === 'active')
      return send(except(r.participants ?? [], r.created_by), { title: `🏓 Турнир «${r.name}» начался`, body: 'Сетка готова — вы в списке участников', url: `#/tournament/${r.id}` });
    if (type === 'UPDATE' && o?.status !== 'finished' && r.status === 'finished' && r.results?.gold)
      return send(all, { title: '🏆 Итоги турнира готовы', body: `«${r.name}»: победитель — ${nick(r.results.gold)}. Откройте и посмотрите, кто как сыграл и сколько набрал в рейтинге`, url: `#/tournament/${r.id}` });
    return;
  }

  if (table === 'events' && type === 'INSERT') {
    const when = new Date(r.starts_at).toLocaleString('ru-RU', {
      timeZone: cl.settings?.timezone || 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    return send(except(all, r.created_by), { title: `📅 ${r.title}`, body: `${when}${r.place ? ' · ' + r.place : ''}`, url: '#/calendar' });
  }
}

// когда турнир: точная дата со временем или «ноябрь 2026 · дата уточняется»
// deno-lint-ignore no-explicit-any
function tourWhen(r: any, cl: any) {
  if (r.config?.dateMode === 'month' && r.date) return `${monthName(String(r.date).slice(0, 7))} · дата уточняется`;
  if (!r.starts_at) return '';
  return new Date(r.starts_at).toLocaleString('ru-RU', {
    timeZone: cl.settings?.timezone || 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

// ───────────── Задачи по расписанию (по каждому клубу отдельно) ─────────────
async function clubsList() {
  const { data } = await sb.from('clubs').select('id, name, settings').eq('blocked', false);
  return data ?? [];
}

async function loadClub(c: { id: string; settings: Record<string, unknown> }) {
  const [profiles, m] = await Promise.all([members(c.id), sb.from('matches').select('*').eq('club_id', c.id)]);
  // тестовые данные владельца в итоги не попадают
  return { profiles, matches: (m.data ?? []).filter((x) => !x.is_test), settings: c.settings ?? {} };
}

async function weeklyDigest() {
  let total = 0;
  for (const c of await clubsList()) {
    const { profiles, matches, settings } = await loadClub(c);
    const pool = profiles.filter((p) => ['approved', 'archived', 'deleted'].includes(p.status));
    const A = analyze(pool, matches, settings), D = analyzeDoubles(pool, matches, settings);
    const w = weekSummary(A, D, profiles);
    if (!w.matches) continue;
    const nick = (id: string) => profiles.find((p) => p.id === id)?.nickname ?? 'Игрок';
    const parts = [`${w.matches} ${w.matches % 10 === 1 && w.matches % 100 !== 11 ? 'матч' : 'матчей'}`];
    if (w.top) parts.push(`рост недели — ${nick(w.top.id)} (+${w.top.g.toFixed(1)})`);
    if (w.active) parts.push(`больше всех сыграл ${nick(w.active.id)}`);
    if (w.upset) parts.push(`сенсация: ${nick(w.upset.w)} обыграл ${nick(w.upset.l)}`);
    const all = profiles.filter((p) => p.status === 'approved').map((p) => p.id);
    total += await sendPush(all, { title: `📊 Итоги недели · ${c.name}`, body: parts.join(' · '), url: inClub('#/home', c.id), tag: 'weekly-' + c.id });
  }
  return total;
}

async function seasonDigest() {
  let total = 0;
  for (const c of await clubsList()) {
    const { profiles, matches, settings } = await loadClub(c);
    const pool = profiles.filter((p) => ['approved', 'archived', 'deleted'].includes(p.status));
    const A = analyze(pool, matches, settings);
    const key = monthKey(Date.now() - 864e5);  // прошлый месяц
    const t = seasonTable(A, profiles, key);
    if (!t.champion) continue;
    const nick = (id: string) => profiles.find((p) => p.id === id)?.nickname ?? 'Игрок';
    const all = profiles.filter((p) => p.status === 'approved').map((p) => p.id);
    total += await sendPush(all, { title: `🏆 Сезон: ${monthName(key)} · ${c.name}`, body: `Чемпион — ${nick(t.champion.id)} (+${t.champion.gain.toFixed(1)} за месяц). Новый сезон уже начался!`, url: inClub('#/seasons', c.id), tag: 'season-' + c.id });
  }
  return total;
}

// Напоминание тем, кто давно не играл: раз в день проверяем отметки (14, 30, 60 дней без игр;
// новичку без матчей — через 3 и 10 дней после вступления) и предлагаем соперника по силам для вызова.
const IDLE_DAYS = [14, 30, 60];
const NEWBIE_DAYS = [3, 10];
async function idleReminders() {
  let total = 0;
  const now = Date.now();
  const days = (t: number) => Math.floor((now - t) / 864e5);
  for (const c of await clubsList()) {
    const { profiles, matches, settings } = await loadClub(c);
    if (settings.remindIdle === false) continue;
    const pool = profiles.filter((p) => ['approved', 'archived', 'deleted'].includes(p.status));
    const A = analyze(pool, matches, settings);
    const rating = (id: string) => A.rating.get(id) ?? A.S.initialRating;
    const last = new Map<string, number>();
    for (const m of matches) {
      if (m.status !== 'approved') continue;
      for (const id of [m.player1_id, m.player2_id, m.player3_id, m.player4_id]) if (id) last.set(id, Math.max(last.get(id) ?? 0, Date.parse(m.played_at)));
    }
    const active = profiles.filter((p) => p.status === 'approved');
    // соперников предлагаем из тех, кто играл последний месяц
    const playing = active.filter((p) => last.has(p.id) && days(last.get(p.id)!) < 30);
    for (const p of active) {
      const t = last.get(p.id);
      const d = t ? days(t) : days(Date.parse(p.joined_at));
      if (!(t ? IDLE_DAYS : NEWBIE_DAYS).includes(d)) continue;
      const r = rating(p.id);
      const opp = playing.filter((o) => o.id !== p.id).sort((a, b) => Math.abs(rating(a.id) - r) - Math.abs(rating(b.id) - r))[0];
      const call = opp ? `Вызовите ${opp.nickname} на матч — вы примерно равны по силе.` : 'Вызовите кого-нибудь на матч!';
      const decay = t && A.S.decayEnabled && d >= A.S.decayGraceDays ? ' Рейтинг снижается без игр — один матч это остановит.' : '';
      total += await sendPush([p.id], {
        title: t ? `🏓 ${d} дней без пинг-понга` : `🏓 Пора сыграть первый матч`,
        body: t ? `Стол в «${c.name}» скучает. ${call}${decay}` : `Вы в клубе «${c.name}», но ещё не сыграли. ${call}`,
        url: inClub(opp ? `#/player/${opp.id}` : '#/players', c.id),
        tag: 'idle-' + c.id,
      });
    }
  }
  return total;
}

async function backup(): Promise<string> {
  const tables = ['clubs', 'club_members', 'profiles', 'matches', 'tournaments', 'events', 'challenges', 'settings', 'coin_tx'];
  const out: Record<string, unknown> = { created_at: new Date().toISOString() };
  for (const t of tables) out[t] = (await sb.from(t).select('*')).data ?? [];
  const name = `backup-${new Date().toISOString().slice(0, 16).replace(':', '-')}.json`;
  const { error } = await sb.storage.from('backups').upload(name, new Blob([JSON.stringify(out)], { type: 'application/json' }), { upsert: true });
  if (error) throw error;
  // храним 12 последних копий (около трёх месяцев)
  const { data: list } = await sb.storage.from('backups').list('', { sortBy: { column: 'name', order: 'desc' }, limit: 100 });
  const old = (list ?? []).slice(12).map((f) => f.name);
  if (old.length) await sb.storage.from('backups').remove(old);
  return name;
}

async function isAdminRequest(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data } = await sb.auth.getUser(jwt);
  if (!data.user) return null;
  const { data: p } = await sb.from('profiles').select('is_founder').eq('id', data.user.id).maybeSingle();
  return p?.is_founder ? data.user : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* пустое тело */ }

  // база должна знать адрес функции, чтобы присылать события
  await sb.from('app_secrets').upsert({ key: 'functions_url', value: `${SB_URL}/functions/v1` });

  if (body.action === 'vapid') return json({ publicKey: await initVapid() });
  if (body.action === 'ping') { await sb.from('settings').select('id').limit(1); return json({ ok: true }); }
  if (body.action === 'backup') {
    if (!(await isAdminRequest(req))) return json({ error: 'forbidden' }, 403);
    return json({ name: await backup() });
  }

  // награда за лигу: рейтинг проверяем здесь, на сервере, по тем же правилам, что и в приложении
  if (body.action === 'league_reward') {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: au } = await sb.auth.getUser(jwt);
    if (!au.user) return json({ error: 'Войдите в аккаунт' }, 401);
    const uid = au.user.id, cid = String(body.cid ?? ''), league = String(body.league ?? ''), item = String(body.item ?? '');
    const lmin = (name: string) => LEAGUES.find((l: { name: string }) => l.name === name)?.min ?? Infinity;
    const RW: Record<string, { types: string[]; cap: number; min: number; bonus?: string; name: string }> = {
      silver: { types: ['grip', 'tape', 'ball'], cap: 250, min: lmin('Серебро'), name: 'Серебро' },
      gold: { types: ['rubber'], cap: 1000, min: lmin('Золото'), bonus: 'rw-tape-gold:gold', name: 'Золото' },
      platinum: { types: ['blade'], cap: 3000, min: lmin('Платина'), name: 'Платина' },
      diamond: { types: ['shoes'], cap: 1e9, min: lmin('Алмаз'), name: 'Алмаз' },
    };
    const rw = RW[league];
    if (!rw) return json({ error: 'Нет такой награды' }, 400);
    // магазин включён для всех — или это создатель (тестирует раньше всех)
    const { data: feat } = await sb.from('platform').select('value').eq('key', 'features').maybeSingle();
    const mode = feat?.value?.shop ?? 'all';
    if (mode !== 'all') {
      const { data: me } = await sb.from('profiles').select('is_founder').eq('id', uid).maybeSingle();
      if (!(mode === 'founder' && me?.is_founder)) return json({ error: 'Магазин пока недоступен' }, 403);
    }
    const { data: mem } = await sb.from('club_members').select('status').eq('club_id', cid).eq('user_id', uid).maybeSingle();
    if (mem?.status !== 'active') return json({ error: 'Вы не участник этого клуба' }, 403);
    const { data: got } = await sb.from('league_rewards').select('item_key').eq('user_id', uid).eq('league', league).maybeSingle();
    if (got) return json({ error: 'Эта награда уже получена' }, 400);
    const c = await club(cid);
    if (!c) return json({ error: 'Клуб не найден' }, 404);
    const { profiles, matches, settings } = await loadClub(c);
    const A = analyze(profiles.filter((p) => ['approved', 'archived', 'deleted'].includes(p.status)), matches, settings);
    const r = A.rating.get(uid) ?? A.S.initialRating;
    if (r < rw.min) return json({ error: `Награда откроется в лиге «${rw.name}» — рейтинг от ${rw.min}` }, 400);
    const [iid, v] = item.split(':');
    const { data: it } = await sb.from('shop_items').select('*').eq('id', iid).maybeSingle();
    if (!it || !it.for_sale || !rw.types.includes(it.type) || !(v in (it.variants ?? {})) || it.price + Number(it.variants[v] ?? 0) > rw.cap)
      return json({ error: 'Этот предмет нельзя выбрать в награду' }, 400);
    const { data: own } = await sb.from('user_items').select('item_key').eq('user_id', uid).eq('item_key', item).maybeSingle();
    if (own) return json({ error: 'Этот предмет у вас уже есть — выберите другой' }, 400);
    await sb.from('user_items').insert({ user_id: uid, item_key: item, club_id: cid, price: 0, source: 'reward' });
    if (rw.bonus) await sb.from('user_items').upsert({ user_id: uid, item_key: rw.bonus, club_id: cid, price: 0, source: 'reward' }, { onConflict: 'user_id,item_key', ignoreDuplicates: true });
    await sb.from('league_rewards').insert({ user_id: uid, league, item_key: item, club_id: cid });
    return json({ ok: true });
  }


  // push-объявление для создателя: «новая коллекция скинов» — тем, у кого сейчас открыт магазин
  if (body.action === 'announce') {
    const adm = await isAdminRequest(req);
    if (!adm) return json({ error: 'forbidden' }, 403);
    if (body.kind !== 'collection') return json({ error: 'unknown' }, 400);
    const { data: feat } = await sb.from('platform').select('value').eq('key', 'features').maybeSingle();
    let ids: string[] = [];
    if ((feat?.value?.shop ?? 'all') === 'all') {
      const { data: ps } = await sb.from('profiles').select('id').eq('status', 'approved');
      ids = (ps ?? []).map((p: { id: string }) => p.id);
    } else {
      const { data: ts } = await sb.from('feature_testers').select('user_id').eq('feature', 'shop');
      ids = [adm.id, ...(ts ?? []).map((t: { user_id: string }) => t.user_id)];
    }
    const sent = await sendPush(ids, { title: '🏆 Новая коллекция скинов', body: 'Чёрно-золотые ракетки, джерси и шорты. Купите за PC или откройте бесплатно за победы и рейтинг.', url: '#/shop', tag: 'collection' });
    return json({ ok: true, sent, to: ids.length });
  }

  // коллекция скинов: условия (рейтинг, победы, матчи, заработанные PC) проверяем на сервере и сами выдаём открытое
  if (body.action === 'claim_skins') {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: au } = await sb.auth.getUser(jwt);
    if (!au.user) return json({ error: 'Войдите в аккаунт' }, 401);
    const uid = au.user.id;
    const { data: feat } = await sb.from('platform').select('value').eq('key', 'features').maybeSingle();
    const mode = feat?.value?.shop ?? 'all';
    if (mode !== 'all') {
      const { data: me } = await sb.from('profiles').select('is_founder').eq('id', uid).maybeSingle();
      const { data: tst } = await sb.from('feature_testers').select('user_id').eq('feature', 'shop').eq('user_id', uid).maybeSingle();
      if (!(mode === 'founder' && (me?.is_founder || tst))) return json({ error: 'Магазин пока недоступен' }, 403);
    }
    const { data: mems } = await sb.from('club_members').select('club_id').eq('user_id', uid).eq('status', 'active');
    let rating = 0, wins = 0, matches = 0;
    for (const m of mems ?? []) {
      const c = await club(m.club_id);
      if (!c) continue;
      const { profiles, matches: ms, settings } = await loadClub(c);
      const A = analyze(profiles.filter((p) => ['approved', 'archived', 'deleted'].includes(p.status)), ms, settings);
      const st = playerStats(uid, A, []);
      rating = Math.max(rating, A.rating.get(uid) ?? A.S.initialRating);
      wins += st.wins; matches += st.matches;
    }
    const { data: tx } = await sb.from('coin_tx').select('amount, kind').eq('user_id', uid).gt('amount', 0).in('kind', ['match', 'prize', 'streak', 'daily', 'weekly', 'payout']);
    const coins = (tx ?? []).reduce((a: number, t: { amount: number }) => a + t.amount, 0);
    const stats = { rating: Math.round(rating * 10) / 10, wins, matches, coins };
    const { data: sk } = await sb.from('shop_items').select('id, variants, unlock').not('unlock', 'is', null);
    const { data: have } = await sb.from('user_items').select('item_key').eq('user_id', uid);
    const owned = new Set((have ?? []).map((x: { item_key: string }) => x.item_key));
    const unlocked: string[] = [], granted: string[] = [];
    for (const it of sk ?? []) {
      const u = it.unlock as { kind: string; n: number };
      if ((stats as Record<string, number>)[u.kind] >= u.n) {
        unlocked.push(it.id);
        const keys = Object.keys(it.variants ?? {}).map((v) => `${it.id}:${v}`).filter((k) => !owned.has(k));
        if (keys.length) {
          await sb.from('user_items').upsert(keys.map((k) => ({ user_id: uid, item_key: k, club_id: mems?.[0]?.club_id ?? null, price: 0, source: 'reward' })), { onConflict: 'user_id,item_key', ignoreDuplicates: true });
          granted.push(it.id);
        }
      }
    }
    return json({ ok: true, stats, unlocked, granted });
  }

  if (body.action === 'test') {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data } = await sb.auth.getUser(jwt);
    if (!data.user) return json({ error: 'unauthorized' }, 401);
    const sent = await sendPush([data.user.id], { title: 'PongHub', body: 'Уведомления работают! 🏓', url: '#/me' });
    return json({ sent });
  }

  if (body.secret && body.secret === (await getSecret('webhook_secret'))) {
    if (body.job === 'weekly') return json({ sent: await weeklyDigest() });
    if (body.job === 'season') return json({ sent: await seasonDigest() });
    if (body.job === 'idle') return json({ sent: await idleReminders() });
    if (body.job === 'backup') return json({ name: await backup() });
    await onChange(String(body.table), String(body.type), body.record, body.old_record, (body.actor as string) ?? null, (body.reason as string) ?? null);
    return json({ ok: true });
  }
  return json({ error: 'forbidden' }, 403);
});
