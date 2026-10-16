// PongHub — вход и регистрация через Telegram (Supabase Edge Function «tg», Verify JWT: OFF).
//
// Приложение:  {action:'start', purpose:'login'|'link'}  → { token, url }   (link — с токеном входа в заголовке)
//              {action:'poll', token}                      → { status } | { status:'ok', token_hash } (для login)
//              {action:'unlink'}                           → отвязать Telegram от своего аккаунта
//              {action:'setup'}                            → (создатель) подключить бота: адрес вебхука
// Telegram:    вебхук с сообщением «/start <код>» (проверяется секретным заголовком).
// Нужен секрет функции TELEGRAM_BOT_TOKEN (токен бота от @BotFather).
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const BOT = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const sb = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const TTL_MIN = 10;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function tg(method: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return await r.json();
}

async function secret(key: string): Promise<string | null> {
  const { data } = await sb.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

// имя бота и секрет вебхука; при первом обращении бот подключается сам
async function setup(force = false): Promise<string> {
  let name = await secret('tg_bot_username');
  if (name && !force) return name;
  const me = await tg('getMe');
  if (!me.ok) throw new Error('Неверный токен бота');
  name = me.result.username as string;
  let hook = await secret('tg_webhook_secret');
  if (!hook) {
    hook = crypto.randomUUID().replace(/-/g, '');
    await sb.from('app_secrets').upsert({ key: 'tg_webhook_secret', value: hook });
  }
  const r = await tg('setWebhook', { url: `${SB_URL}/functions/v1/tg`, secret_token: hook, allowed_updates: ['message', 'callback_query'] });
  if (!r.ok) throw new Error('Не удалось подключить бота: ' + (r.description ?? ''));
  await tg('setMyCommands', { commands: [{ command: 'start', description: 'Войти в PongHub' }] });
  await sb.from('app_secrets').upsert({ key: 'tg_bot_username', value: name });
  return name;
}

async function userFrom(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  if (!jwt) return null;
  const { data } = await sb.auth.getUser(jwt);
  return data.user ?? null;
}

const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
const fresh = (row: { created_at: string }) => Date.now() - Date.parse(row.created_at) < TTL_MIN * 60e3;

// ── сообщение боту: «/start <код>» → бот переспрашивает кнопкой (защита от чужих ссылок) ──
// deno-lint-ignore no-explicit-any
async function onMessage(msg: any) {
  const chat = msg?.chat?.id;
  if (!chat || !msg.from || msg.chat.type !== 'private') return;
  const m = String(msg.text ?? '').match(/^\/start\s+([a-z0-9]{24})$/);
  if (!m) return tg('sendMessage', { chat_id: chat, text: 'Это бот PongHub 🏓\nЧтобы войти, нажмите «Войти через Telegram» в приложении PongHub.' });
  const { data: row } = await sb.from('tg_logins').select('*').eq('token', m[1]).maybeSingle();
  if (!row || row.status !== 'new' || !fresh(row)) return tg('sendMessage', { chat_id: chat, text: 'Ссылка устарела. Нажмите «Войти через Telegram» в приложении ещё раз.' });
  const link = row.purpose === 'link';
  return tg('sendMessage', {
    chat_id: chat,
    text: (link ? 'Привязать этот Telegram к аккаунту PongHub?' : 'Войти в PongHub через этот Telegram?')
      + '\n\n⚠️ Подтверждайте, только если вы сами только что нажали кнопку в приложении PongHub. Если ссылку прислал кто-то другой — не нажимайте.',
    reply_markup: { inline_keyboard: [[{ text: link ? '✅ Да, привязать' : '✅ Да, войти', callback_data: 'ok:' + row.token }, { text: 'Отмена', callback_data: 'no:' + row.token }]] },
  });
}

// deno-lint-ignore no-explicit-any
async function onCallback(cq: any) {
  const from = cq?.from;
  const chat = cq?.message?.chat?.id;
  const done = (text: string) => Promise.all([
    tg('answerCallbackQuery', { callback_query_id: cq.id }),
    chat ? tg('editMessageText', { chat_id: chat, message_id: cq.message.message_id, text }) : null,
  ]);
  const m = String(cq?.data ?? '').match(/^(ok|no):([a-z0-9]{24})$/);
  if (!from || !m) return done('Не понял команду.');
  const { data: row } = await sb.from('tg_logins').select('*').eq('token', m[2]).maybeSingle();
  if (!row || row.status !== 'new' || !fresh(row)) return done('Ссылка устарела. Нажмите «Войти через Telegram» в приложении ещё раз.');
  if (m[1] === 'no') {
    await sb.from('tg_logins').update({ status: 'failed', error: 'Вход отменён в Telegram' }).eq('token', row.token);
    return done('Отменено.');
  }
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  if (row.purpose === 'link') {
    const { data: other } = await sb.from('profiles').select('id').eq('telegram_id', from.id).maybeSingle();
    if (other && other.id !== row.user_id) {
      await sb.from('tg_logins').update({ status: 'failed', error: 'Этот Telegram уже привязан к другому аккаунту PongHub' }).eq('token', row.token);
      return done('Этот Telegram уже привязан к другому аккаунту PongHub.');
    }
    await sb.from('profiles').update({ telegram_id: from.id, telegram_username: from.username ?? null }).eq('id', row.user_id);
    await sb.from('tg_logins').update({ status: 'used', tg_id: from.id, tg_username: from.username ?? null, tg_name: name }).eq('token', row.token);
    return done('✅ Telegram привязан к PongHub. Теперь можно входить через Telegram. Вернитесь в приложение.');
  }
  await sb.from('tg_logins').update({ status: 'confirmed', tg_id: from.id, tg_username: from.username ?? null, tg_name: name }).eq('token', row.token);
  return done('✅ Готово! Вернитесь в PongHub — вход выполнен.');
}

// ── обмен подтверждённого кода на вход ──
async function finishLogin(row: { token: string; tg_id: number; tg_username: string | null; tg_name: string | null }) {
  // атомарно забираем код, чтобы им нельзя было войти дважды
  const { data: took } = await sb.from('tg_logins').update({ status: 'used' }).eq('token', row.token).eq('status', 'confirmed').select('token');
  if (!took?.length) return { status: 'used' };
  let { data: p } = await sb.from('profiles').select('id, status').eq('telegram_id', row.tg_id).maybeSingle();
  let email: string | null = null;
  if (p) {
    if (p.status === 'deleted') return { status: 'failed', error: 'Аккаунт удалён' };
    const { data: u } = await sb.auth.admin.getUserById(p.id);
    email = u.user?.email ?? null;
  } else {
    // новый человек — создаём аккаунт; ник из Telegram (занятый ник база дополнит сама)
    email = `tg${row.tg_id}@telegram.ponghub.app`;
    const nick = (row.tg_username || row.tg_name || 'Игрок').replace(/[^A-Za-zА-Яа-яЁё0-9_\-. ]/g, '').slice(0, 20) || 'Игрок';
    const { data: cu, error } = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nickname: nick, full_name: row.tg_name } });
    if (error || !cu.user) return { status: 'failed', error: 'Не удалось создать аккаунт' };
    await sb.from('profiles').update({ telegram_id: row.tg_id, telegram_username: row.tg_username }).eq('id', cu.user.id);
    p = { id: cu.user.id, status: 'approved' };
  }
  if (!email) return { status: 'failed', error: 'Аккаунт не найден' };
  const { data: link, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !link?.properties?.hashed_token) return { status: 'failed', error: 'Не удалось выполнить вход' };
  return { status: 'ok', token_hash: link.properties.hashed_token };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!BOT) return json({ error: 'Вход через Telegram ещё не настроен' }, 503);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* пустое тело */ }

  // вебхук от Telegram
  const hookHeader = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (hookHeader) {
    if (hookHeader !== (await secret('tg_webhook_secret'))) return json({ error: 'forbidden' }, 403);
    try {
      if (body.callback_query) await onCallback(body.callback_query);
      else await onMessage(body.message);
    } catch (e) { console.error('tg webhook', e); }
    return json({ ok: true });
  }

  try {
    if (body.action === 'start') {
      const purpose = body.purpose === 'link' ? 'link' : 'login';
      let userId: string | null = null;
      if (purpose === 'link') {
        const u = await userFrom(req);
        if (!u) return json({ error: 'Войдите в аккаунт' }, 401);
        userId = u.id;
      }
      const bot = await setup();
      const token = newToken();
      await sb.from('tg_logins').insert({ token, purpose, user_id: userId });
      return json({ token, url: `https://t.me/${bot}?start=${token}`, bot });
    }

    if (body.action === 'poll') {
      const { data: row } = await sb.from('tg_logins').select('*').eq('token', String(body.token ?? '')).maybeSingle();
      if (!row) return json({ status: 'missing' });
      if (row.status === 'new') return json({ status: fresh(row) ? 'waiting' : 'expired' });
      if (row.status === 'failed') return json({ status: 'failed', error: row.error });
      if (row.purpose === 'link') return json({ status: row.status === 'used' ? 'linked' : 'waiting' });
      if (row.status === 'confirmed') return json(await finishLogin(row));
      return json({ status: 'used' });
    }

    if (body.action === 'unlink') {
      const u = await userFrom(req);
      if (!u) return json({ error: 'Войдите в аккаунт' }, 401);
      const { data: au } = await sb.auth.admin.getUserById(u.id);
      if (au.user?.email?.endsWith('@telegram.ponghub.app')) return json({ error: 'Аккаунт создан через Telegram — отвязать его нельзя, иначе вход пропадёт' }, 400);
      await sb.from('profiles').update({ telegram_id: null, telegram_username: null }).eq('id', u.id);
      return json({ ok: true });
    }

    if (body.action === 'setup') {
      const u = await userFrom(req);
      const { data: p } = u ? await sb.from('profiles').select('is_founder').eq('id', u.id).maybeSingle() : { data: null };
      if (!p?.is_founder) return json({ error: 'forbidden' }, 403);
      return json({ bot: await setup(true) });
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  return json({ error: 'unknown action' }, 400);
});
