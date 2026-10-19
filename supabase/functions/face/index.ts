// PongHub — лицо 3D-игрока по селфи (Supabase Edge Function).
// Приложение присылает селфи и снимок лица модели спереди; Gemini перерисовывает лицо модели «под человека»,
// сохраняя кадр (глаза, нос, рот на тех же местах) — поэтому картинку можно наложить на голову без подгонки.
// Результат: storage faces/<id>.jpg, ссылка — в profiles.face. Ключ: секрет GEMINI_API_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = 'gemini-2.5-flash-image';
const DAILY = 10;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PROMPT = `Image 1 is a front render of a stylized 3D cartoon game character's head. Image 2 is a selfie of a real person.
Repaint image 1 so the character looks like the person from image 2: same face shape, eyes and eye color, eyebrows, nose, lips, skin tone, facial hair (beard, mustache, stubble), hair color and hairline, glasses if any.
STRICT RULES: keep exactly the same framing, camera, head size and position as image 1 — eyes, nose, mouth and chin must stay at the same pixel positions. Perfectly frontal, neutral relaxed expression with a slight smile, eyes looking straight at the camera, mouth closed.
Keep the same stylized 3D cartoon look, soft even studio light, no shadows on the face, same plain background as image 1. No text, no frame. Output one square image.`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!KEY) return json({ error: 'Нейросеть не настроена' }, 500);
    const auth = req.headers.get('Authorization') || '';
    const user = createClient(SB_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u } = await user.auth.getUser();
    const me = u?.user?.id; if (!me) return json({ error: 'Войдите в приложение' }, 401);
    const { data: on } = await sb.rpc('feature_on', { fname: 'avatar', uid: me });
    if (!on) return json({ error: 'Пока недоступно' }, 403);
    const { selfie, base, reset } = await req.json();
    if (reset) {
      await sb.storage.from('faces').remove([`${me}.jpg`]);
      await sb.from('profiles').update({ face: null }).eq('id', me);
      return json({ face: null });
    }
    if (!selfie || !base || selfie.length > 3_000_000 || base.length > 2_000_000) return json({ error: 'Фото не подошло — попробуйте другое' }, 400);
    // не больше DAILY попыток в сутки на человека
    const { data: p } = await sb.from('profiles').select('face_day, face_n').eq('id', me).single();
    const today = new Date().toISOString().slice(0, 10), n = p?.face_day === today ? (p.face_n || 0) : 0;
    if (n >= DAILY) return json({ error: `На сегодня попытки закончились (${DAILY} в день). Завтра можно снова.` }, 429);

    const img = (b64: string) => ({ inline_data: { mime_type: 'image/jpeg', data: b64.replace(/^data:[^,]+,/, '') } });
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, img(base), img(selfie)] }], generationConfig: { responseModalities: ['IMAGE'] } }),
    });
    const out = await r.json();
    if (!r.ok) { const why = String(out?.error?.message || '').slice(0, 300); console.error('gemini', r.status, why); return json({ error: (r.status === 429 ? 'Нейросеть сейчас занята — попробуйте через минуту' : 'Нейросеть не ответила — попробуйте ещё раз'), why }, 502); }
    const part = out?.candidates?.[0]?.content?.parts?.find((x: { inlineData?: unknown }) => x.inlineData);
    if (!part) return json({ error: 'Не получилось распознать лицо — сделайте селфи анфас при хорошем свете' }, 422);
    const bytes = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
    const { error: up } = await sb.storage.from('faces').upload(`${me}.jpg`, bytes, { contentType: part.inlineData.mimeType || 'image/png', upsert: true });
    if (up) throw up;
    const face = `${SB_URL}/storage/v1/object/public/faces/${me}.jpg?v=${Date.now()}`;
    await sb.from('profiles').update({ face, face_day: today, face_n: n + 1 }).eq('id', me);
    return json({ face, left: DAILY - n - 1 });
  } catch (e) {
    console.error(e); return json({ error: 'Ошибка — попробуйте ещё раз' }, 500);
  }
});
