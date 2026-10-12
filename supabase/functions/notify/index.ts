// PongHub — рассылка push-уведомлений (Supabase Edge Function).
// Вызывается: 1) базой данных при изменениях (с секретом), 2) приложением: {action: 'vapid' | 'test'}.
// Ключи VAPID создаются автоматически при первом запуске и хранятся в таблице app_secrets.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

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
  const { data } = await sb.from('profiles').select('id, nickname, role, status');
  return data ?? [];
}

async function timezone(): Promise<string> {
  const { data } = await sb.from('settings').select('data').eq('id', 1).maybeSingle();
  return data?.data?.timezone || 'Europe/Moscow';
}

// deno-lint-ignore no-explicit-any
async function onChange(table: string, type: string, r: any, o: any) {
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

  if (table === 'matches') {
    const score = `${nick(r.player1_id)} ${r.sets1}:${r.sets2} ${nick(r.player2_id)}`;
    if (type === 'INSERT' && r.status === 'pending')
      return send(except(editors, r.submitted_by), { title: 'Результат ждёт подтверждения', body: score, url: '#/admin/matches', tag: 'pending' });
    const becameApproved = r.status === 'approved' && (type === 'INSERT' || o?.status !== 'approved');
    if (becameApproved) {
      const players = [r.player1_id, r.player2_id];
      return send(type === 'INSERT' ? except(players, r.submitted_by) : players, {
        title: r.type === 'tournament' ? '🏆 Турнирный матч засчитан' : '🏓 Матч засчитан',
        body: `${score} · рейтинг обновлён`,
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* пустое тело */ }

  // база должна знать адрес функции, чтобы присылать события
  await sb.from('app_secrets').upsert({ key: 'functions_url', value: `${SB_URL}/functions/v1` });

  if (body.action === 'vapid') return json({ publicKey: await initVapid() });

  if (body.action === 'test') {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data } = await sb.auth.getUser(jwt);
    if (!data.user) return json({ error: 'unauthorized' }, 401);
    const sent = await send([data.user.id], { title: 'PongHub', body: 'Уведомления работают! 🏓', url: '#/me' });
    return json({ sent });
  }

  if (body.secret && body.secret === (await getSecret('webhook_secret'))) {
    await onChange(String(body.table), String(body.type), body.record, body.old_record);
    return json({ ok: true });
  }
  return json({ error: 'forbidden' }, 403);
});
