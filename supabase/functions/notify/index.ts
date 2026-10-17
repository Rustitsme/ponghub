// PongHub — рассылка push-уведомлений (Supabase Edge Function).
// Вызывается: 1) базой данных при изменениях (с секретом), 2) приложением: {action: 'vapid' | 'test'}.
// Ключи VAPID создаются автоматически при первом запуске и хранятся в таблице app_secrets.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';
// Тот же движок рейтинга, что и в приложении: engine.js — копия js/engine.js (обновлять вместе)
import { analyze, analyzeDoubles, weekSummary, seasonTable, monthKey, monthName, LEAGUES } from './engine.js';

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
  const { data } = await sb.from('club_members').select('role, status, initial_rating, profile:profiles(*)').eq('club_id', clubId);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).filter((m: any) => m.profile && !m.profile.is_test).map((m: any) => ({
    ...m.profile, role: ROLE[m.role] ?? 'player', initial_rating: m.initial_rating,
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
    if (type === 'INSERT')
      return send(except(r.participants ?? [], r.created_by), { title: 'Новый турнир', body: `«${r.name}» — вы в списке участников`, url: `#/tournament/${r.id}` });
    if (type === 'UPDATE' && o?.status !== 'finished' && r.status === 'finished' && r.results?.gold)
      return send(all, { title: '🏆 Турнир завершён', body: `«${r.name}»: победитель — ${nick(r.results.gold)}`, url: `#/tournament/${r.id}` });
    return;
  }

  if (table === 'events' && type === 'INSERT') {
    const when = new Date(r.starts_at).toLocaleString('ru-RU', {
      timeZone: cl.settings?.timezone || 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    return send(except(all, r.created_by), { title: `📅 ${r.title}`, body: `${when}${r.place ? ' · ' + r.place : ''}`, url: '#/calendar' });
  }
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
    if (body.job === 'backup') return json({ name: await backup() });
    await onChange(String(body.table), String(body.type), body.record, body.old_record, (body.actor as string) ?? null, (body.reason as string) ?? null);
    return json({ ok: true });
  }
  return json({ error: 'forbidden' }, 403);
});
