// PongHub — рассылка push-уведомлений (Supabase Edge Function).
// Вызывается: 1) базой данных при изменениях (с секретом), 2) приложением: {action: 'vapid' | 'test'}.
// Ключи VAPID создаются автоматически при первом запуске и хранятся в таблице app_secrets.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';
// Тот же движок рейтинга, что и в приложении: engine.js — копия js/engine.js (обновлять вместе)
import { analyze, analyzeDoubles, weekSummary, seasonTable, monthKey, monthName } from './engine.js';

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

async function send(userIds: (string | null | undefined)[], msg: Msg): Promise<number> {
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

async function profiles() {
  const { data } = await sb.from('profiles').select('id, nickname, role, status, is_test');
  return (data ?? []).filter((p) => !p.is_test);
}

async function timezone(): Promise<string> {
  const { data } = await sb.from('settings').select('data').eq('id', 1).maybeSingle();
  return data?.data?.timezone || 'Europe/Moscow';
}

// deno-lint-ignore no-explicit-any
async function onChange(table: string, type: string, r: any, o: any, actor: string | null = null, reason: string | null = null) {
  const ps = await profiles();
  const nick = (id: string) => ps.find((p) => p.id === id)?.nickname ?? 'Игрок';
  const approved = ps.filter((p) => p.status === 'approved');
  const admins = approved.filter((p) => p.role === 'admin').map((p) => p.id);
  const editors = approved.filter((p) => p.role === 'admin' || p.role === 'editor').map((p) => p.id);
  const all = approved.map((p) => p.id);
  const except = (ids: string[], ...skip: (string | null)[]) => ids.filter((id) => !skip.includes(id));

  if (table === 'profiles') {
    if (type === 'INSERT' && r.status === 'pending')
      return send(admins, { title: 'Новая заявка', body: `${r.nickname} хочет вступить в клуб`, url: '#/admin/reqs', tag: 'reqs' });
    if (type === 'UPDATE' && o?.status !== 'approved' && r.status === 'approved')
      return send([r.id], { title: 'Добро пожаловать в PongHub! 🏓', body: 'Ваша заявка одобрена — заходите', url: '#/home' });
    if (type === 'UPDATE' && o?.role !== 'editor' && r.role === 'editor')
      return send([r.id], { title: 'Вы теперь помощник ✍️', body: 'Можете вносить результаты и вести турниры', url: '#/admin' });
    return;
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
      return send(except(editors, r.submitted_by), { title: 'Результат ждёт подтверждения', body: score, url: '#/admin/matches', tag: 'pending' });
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
      timeZone: await timezone(), weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    return send(except(all, r.created_by), { title: `📅 ${r.title}`, body: `${when}${r.place ? ' · ' + r.place : ''}`, url: '#/calendar' });
  }
}

// ───────────── Задачи по расписанию ─────────────
async function loadAll() {
  const [p, m, s] = await Promise.all([
    sb.from('profiles').select('*'), sb.from('matches').select('*'), sb.from('settings').select('data').eq('id', 1).maybeSingle(),
  ]);
  // тестовые данные владельца в итоги не попадают
  return { profiles: (p.data ?? []).filter((x) => !x.is_test), matches: (m.data ?? []).filter((x) => !x.is_test), settings: s.data?.data ?? {} };
}

async function weeklyDigest() {
  const { profiles, matches, settings } = await loadAll();
  const pool = profiles.filter((p) => ['approved', 'archived', 'deleted'].includes(p.status));
  const A = analyze(pool, matches, settings), D = analyzeDoubles(pool, matches, settings);
  const w = weekSummary(A, D, profiles);
  if (!w.matches) return 0;
  const nick = (id: string) => profiles.find((p) => p.id === id)?.nickname ?? 'Игрок';
  const parts = [`${w.matches} ${w.matches % 10 === 1 && w.matches % 100 !== 11 ? 'матч' : 'матчей'}`];
  if (w.top) parts.push(`рост недели — ${nick(w.top.id)} (+${w.top.g.toFixed(1)})`);
  if (w.active) parts.push(`больше всех сыграл ${nick(w.active.id)}`);
  if (w.upset) parts.push(`сенсация: ${nick(w.upset.w)} обыграл ${nick(w.upset.l)}`);
  const all = profiles.filter((p) => p.status === 'approved').map((p) => p.id);
  return send(all, { title: '📊 Итоги недели', body: parts.join(' · '), url: '#/home', tag: 'weekly' });
}

async function seasonDigest() {
  const { profiles, matches, settings } = await loadAll();
  const pool = profiles.filter((p) => ['approved', 'archived', 'deleted'].includes(p.status));
  const A = analyze(pool, matches, settings);
  const key = monthKey(Date.now() - 864e5);  // прошлый месяц
  const t = seasonTable(A, profiles, key);
  if (!t.champion) return 0;
  const nick = (id: string) => profiles.find((p) => p.id === id)?.nickname ?? 'Игрок';
  const all = profiles.filter((p) => p.status === 'approved').map((p) => p.id);
  return send(all, { title: `🏆 Сезон: ${monthName(key)}`, body: `Чемпион — ${nick(t.champion.id)} (+${t.champion.gain.toFixed(1)} за месяц). Новый сезон уже начался!`, url: '#/seasons', tag: 'season' });
}

async function backup(): Promise<string> {
  const tables = ['profiles', 'matches', 'tournaments', 'events', 'challenges', 'settings'];
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
  const { data: p } = await sb.from('profiles').select('role, status').eq('id', data.user.id).maybeSingle();
  return p?.role === 'admin' && p?.status === 'approved' ? data.user : null;
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

  if (body.action === 'test') {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data } = await sb.auth.getUser(jwt);
    if (!data.user) return json({ error: 'unauthorized' }, 401);
    const sent = await send([data.user.id], { title: 'PongHub', body: 'Уведомления работают! 🏓', url: '#/me' });
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
