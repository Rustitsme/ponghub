// Ежедневная проверка (Vercel Cron): обращаемся к базе, чтобы бесплатный Supabase
// не ставил проект на паузу после недели без активности.
const SUPABASE_URL = 'https://iprhrrmejvhkkyqogiyn.supabase.co';
const KEY = 'sb_publishable_Qh-4DSD8azE69_LERTRSqQ_MvFKVgrY';

module.exports = async (req, res) => {
  try {
    const db = await fetch(`${SUPABASE_URL}/rest/v1/rpc/nickname_available`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: 'keepalive-check' }),
    });
    const fn = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ping' }),
    });
    res.status(200).json({ ok: db.ok && fn.ok, db: db.status, fn: fn.status, at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
