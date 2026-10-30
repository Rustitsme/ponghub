// Табло клуба для телевизора (16:9). Открывается по адресу #/tv, без входа в аккаунт.
// Привязка: табло получает токен и код из 6 цифр → владелец клуба вводит код в «Управлении → Табло».
// Дальше табло само опрашивает screen_state(токен) и переключается: игра → итоги → перерыв.
import { analyze, ranking, leagueOf, replayLive, DEFAULT_SETTINGS, isDoubles, winsNeeded } from './engine.js';
import { koBracket, roundName, standings, pairings, findPairMatch, tieStageOf, tieOptsFor, tournamentSchedule } from './tourney.js';
import { parseKey } from './shop-catalog.js';
import { unlock, sfx, soundOn } from './sound.js';
import { media } from './store.js';
import { makeQr, qrSvg } from './qr.js';

const LS = 'ponghub_tv_token';
const POLL = 2000;            // как часто спрашиваем текущую игру
const FULL_EVERY = 60000;     // как часто обновляем рейтинг и сетку
const RESULT_SHOW = 40;       // сколько секунд показываем итоги матча
const RESULT_TOUR = 12;
const WELCOME = 12000;         // приветствие турнира на табло, мс       // турнирный матч: итог 12 секунд, дальше — сетка турнира
const ROTATE = 15000;         // несколько игр одновременно — меняем раз в 15 секунд

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtR = r => (Math.round((r ?? 0) * 10) / 10).toFixed(1);
const fmtN = n => Math.round(n || 0).toLocaleString('ru-RU');
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

const LOGO = '<svg viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" rx="26" fill="#2563b8"/><g transform="translate(60 60) rotate(-24)"><ellipse rx="45" ry="16" fill="none" stroke="#e63946" stroke-width="7"/></g><circle cx="60" cy="60" r="22" fill="#fff"/><g transform="translate(60 60) rotate(-24)"><path d="M-45 0 A45 16 0 0 0 45 0" fill="none" stroke="#e63946" stroke-width="7" stroke-linecap="round"/></g></svg>';

export async function startTV(root, store) {
  document.body.classList.add('tv-mode');
  document.getElementById('splash')?.remove();
  const T = { token: lsGet(LS), data: null, full: null, A: null, fullAt: 0, rot: 0, rotAt: 0, sig: '', qr: '' };
  root.innerHTML = `<div class="tvx-stage"><div class="tvx" id="tvx"><div class="tvx-msg">${LOGO}<b>PongHub</b><span>Подключаю табло…</span></div></div></div>`;
  const box = root.querySelector('#tvx');

  // экран не гаснет; по нажатию — во весь экран
  let lock = null;
  const keepAwake = async () => { try { if (!lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch { /* */ } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
  root.addEventListener('click', () => { if (VOICE.allowed && !soundOn()) { unlock(); document.getElementById('tvx-snd')?.remove(); sfx('point'); } keepAwake(); if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); });
  keepAwake();

  async function ensureToken() {
    if (T.token) return;
    const r = await store.rpc('screen_start');
    T.token = r.token; lsSet(LS, r.token);
  }

  async function tick() {
    try {
      await ensureToken();
      const needFull = !T.full || Date.now() - T.fullAt > FULL_EVERY;
      // стоп-кадр: табло замирает на текущей картинке — ничего не перерисовываем и не показываем
      try { const fl = await store.rpc('screen_flags', { p_token: T.token }); T.frozen = !!(fl?.frozen_until && Date.parse(fl.frozen_until) > Date.parse(fl.now)); } catch { T.frozen = false; }
      root.classList.toggle('tvx-frozen', T.frozen);
      if (T.frozen && T.data) return;
      let d = await store.rpc('screen_state', { p_token: T.token, p_full: needFull });
      if (d.status === 'unknown') { T.token = null; lsSet(LS, ''); return; }
      // закончилась или началась игра — сразу обновляем рейтинг и сетку
      const sig = (d.live || []).map(l => l.id).join(',') + '|' + (d.recent?.id || '');
      if (d.status === 'ok' && !needFull && sig !== T.sig && T.full) {
        d = await store.rpc('screen_state', { p_token: T.token, p_full: true });
      }
      T.sig = sig;
      if (d.status === 'ok' && d.players) {
        T.full = d; T.fullAt = Date.now();
        const st = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
        const pool = d.players.filter(p => ['approved', 'archived', 'deleted'].includes(p.status));
        T.A = analyze(pool, d.matches, st);
        T.rank = ranking(T.A, d.players).filter(x => x.g > 0);
      }
      T.data = d;
      draw();
      shows(d);
      voiceEvents(d);
    } catch (e) {
      if (!T.data) box.innerHTML = `<div class="tvx-msg">${LOGO}<b>PongHub</b><span>Нет связи с сервером. Проверяю снова…</span></div>`;
    }
  }

  // ── Звуки: выход, очко, гейм-пойнт, матч-пойнт, партия, победа (пока — если игроку открыт 3D-игрок) ──
  const VOICE = { allowed: false, ok: new Map(), st: new Map(), done: new Set() };
    async function voiceOk(l) {
    if (!VOICE.ok.has(l.id)) VOICE.ok.set(l.id, avatars(sideIds(l, 0).concat(sideIds(l, 1))).then(av => !!av?.players?.some(p => p.on)));
    const ok = await VOICE.ok.get(l.id);
    if (ok && !VOICE.allowed) { VOICE.allowed = true; if (!soundOn() && !document.getElementById('tvx-snd')) root.insertAdjacentHTML('beforeend', '<button id="tvx-snd" class="tvx-snd">🔊 Нажмите, чтобы включить звук</button>'); }
    return ok;
  }
  async function voiceEvents(d) {
    if (d.status !== 'ok' || !T.full) return;
    for (const l of d.live || []) {
      const g = replayLive(l.log || [], l.best_of, l.points_to, l.first_server), n = (l.log || []).length;
      const prev = VOICE.st.get(l.id); VOICE.st.set(l.id, { n, g });
      if (!prev || n <= prev.n || !(await voiceOk(l)) || showing) continue;
      if (g.winner !== null) continue; // победу играет итоговый экран
      const p = prev.g;
      if ([0, 1].some(k => g.won[k] > p.won[k])) { sfx('setwin'); continue; }
      if ([0, 1].some(k => g.matchPoint[k] && !p.matchPoint[k])) { sfx('matchpoint'); continue; }
      if ([0, 1].some(k => g.setPoint[k] && !p.setPoint[k])) { sfx('tension'); continue; }
      sfx('point');
    }
  }

  // ── 3D-игроки: выход перед матчем и жест победителя (если игрокам открыт 3D-игрок) ──
  const SEEN = { live: new Set(), res: new Set(), boot: true };
  let showing = false;
  const stage = root.querySelector('.tvx-stage');
  const racketName = lo => { const { it } = parseKey(lo?.blade || ''); return it ? `${it.brand} ${it.name}` : ''; };
  async function avatars(ids) { try { return await store.rpc('screen_avatars', { p_token: T.token, ids }); } catch { return null; } }
  function who(id, av) {
    const p = av?.players?.find(x => x.id === id), r = rating(id);
    return { gender: p?.avatar3d || 'boy', face: p?.face || null, photo: media(P(id).photo_url) || null, icon: P(id).avatar || '', loadout: p?.loadout || {}, nick: P(id).nickname, rating: fmtR(r), league: leagueOf(r), racket: racketName(p?.loadout) };
  }
  async function shows(d) {
    if (showing || d.status !== 'ok' || !T.full) return;
    const fresh = d.recent && (Date.parse(d.now) - Date.parse(d.recent.updated_at)) / 1000 < RESULT_SHOW;
    if (SEEN.boot) { (d.live || []).forEach(l => SEEN.live.add(l.id)); if (d.recent) SEEN.res.add(d.recent.id); SEEN.boot = false; return; }
    const nl = (d.live || []).find(l => !SEEN.live.has(l.id));
    if (nl) {
      SEEN.live.add(nl.id);
      if (isDoubles(nl) || (nl.log || []).length) return;
      const av = await avatars([nl.player1_id, nl.player2_id]);
      if (!av?.players?.some(p => p.on)) return;
      showing = true;
      try { const m = await import('./player3d.js'); const A = who(nl.player1_id, av), B = who(nl.player2_id, av); VOICE.allowed || voiceOk(nl);
      const cue = c => sfx({ names: 'whoosh', walk: 'entrance', cardA: 'hit', cardB: 'hit', go: 'go' }[c]);
      await m.tvIntro(stage, { A, B, grip: av.grip, cue }); } catch { /* без 3D */ } finally { showing = false; }
      return;
    }
    const rl = d.recent;
    if (rl && fresh && !SEEN.res.has(rl.id)) {
      SEEN.res.add(rl.id);
      if (isDoubles(rl)) return;
      const mm = d.recent_match, g = replayLive(rl.log || [], rl.best_of, rl.points_to, rl.first_server);
      const w1 = mm ? (mm.sets1 ?? 0) : g.won[0], w2 = mm ? (mm.sets2 ?? 0) : g.won[1];
      const wId = sideIds(rl, w1 >= w2 ? 0 : 1)[0];
      const av = await avatars([wId]);
      if (!av?.players?.some(p => p.on)) return;
      showing = true;
      try { const m = await import('./player3d.js'); const W = who(wId, av), sc = `${Math.max(w1, w2)} : ${Math.min(w1, w2)}`; VOICE.allowed = true;
      const cue = c => { if (c === 'win') sfx('victory'); };
      await m.tvWinner(stage, { W, score: sc, grip: av.grip, cue }); } catch { /* без 3D */ } finally { showing = false; }
    }
  }
  // вышла новая версия приложения — табло перезагружается само (между показами)
  let ver = null;
  setInterval(async () => { try { const v = ((await (await fetch('sw.js', { cache: 'no-store' })).text()).match(/CACHE = '([^']+)'/) || [])[1]; if (ver && v && v !== ver && !showing) location.reload(); ver = ver || v; } catch { /* */ } }, 300000);

  // ── помощники ──
  const P = id => T.full?.players.find(p => p.id === id) || { id, nickname: 'Игрок', avatar: '🏓' };
  const rating = id => T.A?.rating.get(id) ?? T.A?.S.initialRating ?? 40;
  const sideIds = (l, s) => (s === 0 ? [l.player1_id, l.player3_id] : [l.player2_id, l.player4_id]).filter(Boolean);
  const sideName = (l, s) => sideIds(l, s).map(id => P(id).nickname).join(' + ');
  const ava = p => p.photo_url ? `<img src="${esc(media(p.photo_url))}" alt="">` : esc(p.avatar || (p.nickname || '?')[0]);
  const tour = id => T.full?.tournaments.find(t => t.id === id);
  const clock = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  function top(label, tagHtml) {
    const d = T.data;
    return `<div class="tvx-top"><div class="tvx-logo">${LOGO}</div>
      <div><div class="tvx-club">${esc(d.club.name)}</div><div class="tvx-crumb">${label}</div></div>
      ${tagHtml}<div class="tvx-clock">${clock()}</div></div>`;
  }
  function foot(lead) {
    const list = T.rank || [];
    const items = list.map((x, i) => `<span>${i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} ${esc(x.p.nickname)}<b>${fmtR(x.r)}</b></span>`).join('');
    // бегущая строка: два одинаковых куска подряд — прокрутка по кругу без рывка; скорость от длины
    const body = lead ? `<div class="tvx-tick static">${lead}</div>`
      : `<strong>Рейтинг клуба</strong><div class="tvx-tick"><div class="tvx-tick-in" style="animation-duration:${Math.max(20, list.length * 4)}s">${items}${items}</div></div>`;
    return `<div class="tvx-foot">${body}<span class="tvx-brand">${LOGO}PONGHUB</span></div>`;
  }
  // ник любой длины влезает: шрифт уменьшается по длине, дальше — «…»
  const fitNick = (name, max = 3.6, min = 1.9, k = 34) => `<div class="tvx-nk" style="font-size:${Math.max(min, Math.min(max, k / Math.max(10, [...String(name)].length))).toFixed(2)}cqw">${esc(name)}</div>`;
  const avaTv = p => `<span class="tvx-av" style="--c:${esc(p.color || '#e63946')}">${p.photo_url ? `<img src="${esc(media(p.photo_url))}" alt="">` : esc(p.avatar || (p.nickname || '?')[0])}</span>`;
  function crumbFor(l) {
    const t = l.tournament_id ? tour(l.tournament_id) : null;
    const fmt = `до ${winsNeeded(l.best_of)} ${plural(winsNeeded(l.best_of), 'победы', 'побед', 'побед')}, партия до ${l.points_to}`;
    if (t) return `${esc(t.name)}${l.stage === 'ko' && t.config?.slots ? ' · ' + esc(roundName(l.round, Math.log2(t.config.slots.length))) : l.stage === 'ko3' ? ' · За 3-е место' : ''} · ${fmt}`;
    return `${isDoubles(l) ? 'Парная игра' : 'Свободная игра'} · ${fmt}`;
  }
  function predFor(liveId) { return (T.data.preds || []).find(e => e.source_id === liveId); }
  function oddsCard(e) {
    if (!e || !e.bets) return `<div class="tvx-card"><h4>Прогнозы зрителей</h4><p class="tvx-muted">Прогнозов пока нет</p></div>`;
    const total = (e.pool1 || 0) + (e.pool2 || 0), p1 = total ? Math.round(e.pool1 / total * 100) : 50;
    return `<div class="tvx-card"><h4>Прогнозы зрителей · ${fmtN(total)} PC</h4>
      <div class="tvx-odds"><i style="width:${p1}%"></i><i style="width:${100 - p1}%"></i></div>
      <div class="tvx-odds-l"><span>${p1}% <small>×${e.odds1}</small></span><span><small>×${e.odds2}</small> ${100 - p1}%</span></div></div>`;
  }
  function nextList() {
    const n = nextPairs();
    if (!n.length) return '';
    return `<div class="tvx-card tvx-list"><h4>Следом за этим столом</h4><ol>${n.slice(0, 3).map(x => `<li>${esc(x.label)}<span>${esc(x.note)}</span></li>`).join('')}</ol></div>`;
  }
  function qrCard() {
    return `<div class="tvx-card tvx-qr"><div class="tvx-qr-img" id="tvx-qr">${T.qr}</div><p>Хотите играть с нами?<b>Наведите камеру</b>и отправьте заявку в клуб</p></div>`;
  }

  // кто играет следом: турнир — ближайшие несыгранные пары; иначе — принятые вызовы
  function nextPairs() {
    const out = [];
    const active = (T.full?.tournaments || []).filter(t => t.status === 'active').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
    const liveIds = new Set((T.data.live || []).flatMap(l => [l.player1_id, l.player2_id]));
    if (active) {
      // порядок игр турнира — тот же, что в приложении: идущие игры пропускаем, дальше «на стол» → «готовятся» → остальные
      const ms = (T.full.matches || []).filter(m => m.tournament_id === active.id);
      for (const it of tournamentSchedule(active, ms, T.data.live || [])) {
        if (it.status === 'done' || it.status === 'live') continue;
        out.push({ a: it.a, b: it.b, label: `${P(it.a).nickname} — ${P(it.b).nickname}`, note: it.status === 'soon' ? `готовятся · ${it.note}` : it.note.charAt(0).toLowerCase() + it.note.slice(1), status: it.status });
      }
    }
    for (const n of T.data.next || []) out.push({ a: n.a, b: n.b, label: `${P(n.a).nickname} — ${P(n.b).nickname}`, note: 'вызов принят' });
    return out;
  }

  // ── экраны ──
  function liveScreen(l) {
    const e = predFor(l.id);
    if (l.scoring === false) {
      const mins = Math.max(0, Math.floor((Date.parse(T.data.now) - Date.parse(l.created_at)) / 60000));
      return `<section class="tvx-scr">${top(crumbFor(l), '<div class="tvx-live"><i></i>LIVE</div>')}
        <div class="tvx-main"><div class="tvx-court"><div class="tvx-duel">${panel(l, 0, null)}<div class="tvx-mid"><small>Идёт игра</small><div class="tvx-sets">${mins}<span>′</span></div><small>счёт внесут после игры</small></div>${panel(l, 1, null)}</div><div class="tvx-chips"></div></div>
        <div class="tvx-rail">${oddsCard(e)}${nextList()}${qrCard()}</div></div>${foot()}</section>`;
    }
    const g = replayLive(l.log || [], l.best_of, l.points_to, l.first_server);
    const chips = g.sets.length ? '<span>Партии:</span>' + g.sets.map(([a, b]) => `<span class="tvx-chip"><b class="${a > b ? 'w1' : ''}">${a}</b> : <b class="${b > a ? 'w2' : ''}">${b}</b></span>`).join('') : '<span>Первая партия</span>';
    return `<section class="tvx-scr">${top(crumbFor(l), '<div class="tvx-live"><i></i>LIVE</div>')}
      <div class="tvx-main"><div class="tvx-court"><div class="tvx-duel">${panel(l, 0, g)}
        <div class="tvx-mid"><small>Партии</small><div class="tvx-sets"><b>${g.won[0]}</b><span>:</span><b>${g.won[1]}</b></div>
<small>Партия ${g.sets.length + (g.winner === null ? 1 : 0)}</small></div>
        ${panel(l, 1, g)}</div><div class="tvx-chips">${chips}</div></div>
      <div class="tvx-rail">${oddsCard(e)}${nextList()}${qrCard()}</div></div>${foot()}</section>`;
  }
  function panel(l, s, g) {
    const ids = sideIds(l, s);
    const main = P(ids[0]);
    const r = ids.length > 1 ? null : rating(ids[0]);
    const lg = r != null ? leagueOf(r) : null;
    const serve = g && g.winner === null && (l.log || []).length && g.server === s;
    return `<div class="tvx-side p${s + 1}">
      <div class="tvx-who"><div class="tvx-ava">${ava(main)}</div><div><div class="tvx-nick">${esc(sideName(l, s))}</div>
        <div class="tvx-meta">${r != null ? `рейтинг ${fmtR(r)} <span class="tvx-league ${lg.cls}">${esc(lg.name)}</span>` : 'пара'}</div></div></div>
      ${g ? `<div class="tvx-points">${g.cur[s]}</div>` : '<div class="tvx-points tvx-dim">—</div>'}
      ${serve ? '<div class="tvx-serve"></div>' : ''}</div>`;
  }

  function resultScreen(rl) {
    const m = T.data.recent_match;
    const g = replayLive(rl.log || [], rl.best_of, rl.points_to, rl.first_server);
    const sets = m?.sets?.length ? m.sets : g.sets;
    const w1 = m ? (m.sets1 ?? 0) : g.won[0], w2 = m ? (m.sets2 ?? 0) : g.won[1];
    const win = w1 >= w2 ? 0 : 1, lose = 1 - win;
    const md = m && T.A?.md.get(m.id);
    const d = id => md?.delta?.[id];
    const wId = sideIds(rl, win)[0], lId = sideIds(rl, lose)[0];
    const deltas = md && !isDoubles(rl)
      ? `<div class="tvx-deltas"><span class="up">${esc(P(wId).nickname)} ${d(wId) >= 0 ? '+' : '−'}${Math.abs(d(wId)).toFixed(2)}</span><span class="dn">${esc(P(lId).nickname)} ${d(lId) >= 0 ? '+' : '−'}${Math.abs(d(lId)).toFixed(2)}</span></div>`
      : m?.status === 'pending' || !m ? '<div class="tvx-deltas"><span class="tvx-muted">рейтинг обновится после подтверждения</span></div>' : '';
    const e = predFor(rl.id);
    const total = e ? (e.pool1 || 0) + (e.pool2 || 0) : 0;
    const pct = total ? Math.round(e.pool1 / total * 100) : 50;
    const winners = e?.winners?.length
      ? e.winners.map(x => `<li>${esc(x.nick)}<span>ставка ${fmtN(x.stake)} × ${x.odds}</span><b>+${fmtN(x.payout)}</b></li>`).join('')
      : `<li class="tvx-muted">${e && e.status !== 'settled' ? 'Выигрыши начислятся после подтверждения матча' : 'Никто не угадал'}</li>`;
    const nx = nextPairs()[0];
    return `<section class="tvx-scr">${top(crumbFor(rl), '<div class="tvx-tag">Матч завершён</div>')}
      <div class="tvx-res"><div class="tvx-win"><div class="tvx-cup">🏆</div><h2>${esc(sideName(rl, win))}</h2>
        <div class="tvx-sc">победа ${Math.max(w1, w2)} : ${Math.min(w1, w2)}${sets.length ? ' · партии ' + sets.map(([a, b]) => `${a}:${b}`).join(' ') : ''}</div>${deltas}</div>
      ${e && e.bets ? `<div class="tvx-bets"><div class="tvx-card"><h4>Прогнозы на матч</h4><div class="tvx-pool"><b>${fmtN(total)} PC</b><span>поставили ${e.bets} ${plural(e.bets, 'человек', 'человека', 'человек')}</span></div></div>
        <div class="tvx-card tvx-split"><div class="row"><span>на ${esc(sideName(rl, 0))} · ${e.count1} чел.</span>${fmtN(e.pool1)} PC</div>
          <div class="tvx-odds"><i style="width:${pct}%"></i><i style="width:${100 - pct}%"></i></div>
          <div class="row"><span>на ${esc(sideName(rl, 1))} · ${e.count2} чел.</span>${fmtN(e.pool2)} PC</div></div>
        <div class="tvx-card tvx-list tvx-winners"><h4>Угадали — выигрыш</h4><ol>${winners}</ol></div></div>`
        : `<div class="tvx-bets"><div class="tvx-card tvx-list"><h4>Следом за этим столом</h4><ol>${nextPairs().slice(0, 4).map(x => `<li>${esc(x.label)}<span>${esc(x.note)}</span></li>`).join('') || '<li class="tvx-muted">Пока никто не записался</li>'}</ol></div>${qrCard()}</div>`}
      </div>${foot(nx ? `<strong>Следом за этим столом</strong><span>${esc(nx.label)} · ${esc(nx.note)}</span>` : null)}</section>`;
  }

  function activeTour() { return (T.full?.tournaments || []).filter(t => t.status === 'active').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]; }
  const HOW = { ko: ['Проиграл — выбыл', 'Победитель идёт дальше по сетке', 'Финал решает, кто чемпион'],
    rr: ['Каждый сыграет со всеми', 'Больше побед — выше место', 'Первый в таблице — чемпион'],
    groups: ['Игроки поделены на группы', 'В группе каждый играет с каждым', 'Лучшие из групп — в плей-офф'] };
  const FMT = { ko: '🏆 Олимпийская система', rr: '🔄 Каждый с каждым', groups: '🗂 Группы + плей-офф' };
  const plW = n => plural(n, 'победа', 'победы', 'побед');
  // олимпийка: всё дерево сразу, неизвестные соперники — «ждём победителя», следующая пара подсвечена
  function koTree(slots, ms, third, nx) {
    const br = koBracket(slots, ms, third), R = br.rounds.length, rounds = br.rounds.slice(-4), off = R - rounds.length;
    const nm = (id, c, side) => id ? `<div class="${c.winner === id && !c.bye ? 'w' : c.winner && !c.bye ? 'l' : ''}">${avaTv(P(id))}<span class="tvx-nk">${esc(P(id).nickname)}</span><span class="sc">${c.match && c.match.status === 'approved' ? (c.match.player1_id === id ? c.match.sets1 : c.match.sets2) : ''}</span></div>`
      : `<div class="tbd">${c.r === 0 ? 'свободный проход' : `ждём победителя`}</div>`;
    const isNx = c => nx && c.a && c.b && ((nx.a === c.a && nx.b === c.b) || (nx.a === c.b && nx.b === c.a));
    const cols = rounds.map((row, k) => `<div class="tvx-round"><h5>${esc(roundName(off + k, R))}</h5>${row.filter(c => !c.empty).map(c => `<div class="tvx-bm ${isNx(c) ? 'now' : ''}">${nm(c.a, c, 0)}${nm(c.b, c, 1)}</div>`).join('')}</div>`).join('');
    const champ = br.champion ? `<b>${esc(P(br.champion).nickname)}</b>` : '<b>?</b><span>определится в финале</span>';
    return `<div class="tvx-bracket" style="grid-template-columns:repeat(${rounds.length},minmax(0,1fr)) minmax(0,.7fr)">${cols}<div class="tvx-round"><h5>Чемпион</h5><div class="tvx-champ"><i>🏆</i>${champ}</div></div></div>`;
  }
  // большая олимпийка (8+ мест): зеркальная сетка — половина слева, половина справа, финал по центру;
  // «свободные проходы» не показываем — такие игроки сразу стоят во 2-м раунде; шрифт подстраивается под число матчей
  function koMirror(slots, ms, third, nx) {
    const br = koBracket(slots, ms, third), R = br.rounds.length;
    const isNx = c => nx && c.a && c.b && ((nx.a === c.a && nx.b === c.b) || (nx.a === c.b && nx.b === c.a));
    const nm = (id, c) => id ? `<div class="${c.winner === id && !c.bye ? 'w' : c.winner && !c.bye ? 'l' : ''}">${avaTv(P(id))}<span class="tvx-nk">${esc(P(id).nickname)}</span><span class="sc">${c.match && c.match.status === 'approved' ? (c.match.player1_id === id ? c.match.sets1 : c.match.sets2) : ''}</span></div>`
      : `<div class="tbd">ждём</div>`;
    const cell = c => `<div class="tvx-bm ${isNx(c) ? 'now' : ''}">${nm(c.a, c)}${nm(c.b, c)}</div>`;
    const shown = (c, r) => !c.empty && !(r === 0 && c.bye);
    const half = side => br.rounds.slice(0, R - 1).map((row, r) => { const h = row.length / 2; return { r, cells: (side ? row.slice(h) : row.slice(0, h)).filter(c => shown(c, r)) }; }).filter(x => x.cells.length);
    const L = half(0), Rt = half(1).reverse();
    const rows = Math.max(1, ...L.map(x => x.cells.length), ...Rt.map(x => x.cells.length));
    const fs = Math.max(.72, Math.min(1.35, 9.5 / rows)), py = Math.max(.1, Math.min(.42, 3.2 / rows));
    const col = x => `<div class="tvx-mcol"><h5>${esc(roundName(x.r, R))}</h5>${x.cells.map(cell).join('')}</div>`;
    const fin = br.rounds[R - 1][0];
    const champ = br.champion ? `<b>${esc(P(br.champion).nickname)}</b>` : '<b>?</b><span>чемпион</span>';
    const w = k => (1 + Math.max(0, L.length - 1 - k) * .18).toFixed(2);
    const colsCss = [...L.map((_, k) => `minmax(0,${w(k)}fr)`), 'minmax(0,1.15fr)', ...Rt.map((_, k) => `minmax(0,${w(Rt.length - 1 - k)}fr)`)].join(' ');
    return `<div class="tvx-mir" style="grid-template-columns:${colsCss};--fs:${fs.toFixed(2)}cqw;--py:${py.toFixed(2)}cqw">
      ${L.map(col).join('')}<div class="tvx-mfin"><h5>Финал</h5>${cell(fin)}<div class="tvx-champ"><i>🏆</i>${champ}</div></div>${Rt.map(col).join('')}</div>`;
  }
  // группа / круг: места и победы простыми словами
  function placesCard(title, sub, ids, ms, adv, opts) {
    const st = standings(ids, ms, opts);
    const lab = x => { const k = st.ties.find(tt => tt.ids.includes(x.id)); return k ? `${k.from}–${k.to}` : String(x.rank); };
    return `<div class="tvx-card tvx-gc"><h4>${title}<small>${sub}</small></h4>${st.list.map(x => `<div class="tvx-pl ${!x.tie && x.rank <= adv ? 'go' : ''} ${x.tie ? 'tied' : ''}"><span class="n">${lab(x)}</span>${avaTv(P(x.id))}<span class="tvx-nk">${esc(P(x.id).nickname)}</span><span class="wins"><b>${x.w}</b>${adv === 1 ? 'из ' + x.p : plW(x.w)}</span></div>`).join('')}
      <div class="left">${st.ties.length ? '⚖️ Ничья — нужны дополнительные матчи' : st.complete ? 'Все матчи сыграны ✓' : `Сыграно ${st.played} из ${st.total}`}</div></div>`;
  }
  // плей-офф для двух групп: 1-й одной группы против 2-го другой; имя появляется, когда группа доиграна
  function playoffCard(groups, ms, t) {
    const st = groups.map((g, i) => standings(g, ms.filter(m => (m.stage === 'grp' || m.stage === 'grptb') && m.grp === i), tieOptsFor(t, 'grp')));
    const who = (gi, place) => { const t = st[gi]; const L = String.fromCharCode(1040 + gi); return t.complete && t.resolved && t.list[place] ? `<div>${avaTv(P(t.list[place].id))}<span class="tvx-nk">${esc(P(t.list[place].id).nickname)}</span><span class="sc">${place + 1}-й ${L}</span></div>` : `<div class="tbd">${place + 1}-й в группе ${L}</div>`; };
    return `<div class="tvx-card tvx-gc"><h4>Плей-офф<small>пары заполнятся сами</small></h4>
      <div class="tvx-bm"><div class="tbd" style="font-style:normal">Полуфинал 1</div>${who(0, 0)}${who(1, 1)}</div>
      <div class="tvx-bm"><div class="tbd" style="font-style:normal">Полуфинал 2</div>${who(1, 0)}${who(0, 1)}</div>
      <div class="tvx-bm"><div class="tbd" style="font-style:normal">Финал</div><div class="tbd">победитель полуфинала 1</div><div class="tbd">победитель полуфинала 2</div></div></div>`;
  }
  const isPaused = l => l.paused_until && Date.parse(l.paused_until) > Date.parse(T.data.now);
  // пауза в игре: крупный таймер (идёт сам, без перерисовки) и сетка турнира, если игра турнирная
  function pauseScreen(l) {
    const g = replayLive(l.log || [], l.best_of, l.points_to, l.first_server);
    const left = Math.max(0, Math.round((Date.parse(l.paused_until) - Date.parse(T.data.now)) / 1000));
    T.pauseEnd = Date.now() + left * 1000;
    const t = l.tournament_id ? activeTour() : null;
    let grid = '';
    if (t && t.id === l.tournament_id) { const b = tourBody(t); grid = `<div class="tvx-pgrid">${b.left}</div>`; }
    return `<section class="tvx-scr">${top(crumbFor(l), '<div class="tvx-tag">Пауза</div>')}
      <div class="tvx-pause ${grid ? '' : 'solo'}"><div class="tvx-pbig"><b>⏸ ПАУЗА</b><strong class="tvx-ptime">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</strong>
        <small>${esc(sideName(l, 0))} — ${esc(sideName(l, 1))} · ${g.cur[0]}:${g.cur[1]} в партии ${g.sets.length + 1} · по партиям ${g.won[0]}:${g.won[1]}</small></div>${grid}</div>${foot()}</section>`;
  }
  function breakScreen() { return breakFrom(activeTour()); }
  function tourBody(active) { const r = breakParts(active); return r; }
  function breakFrom(active) {
    const p = breakParts(active), { left, title, sub, wide, nx } = p;
    if (wide) {
      const nxLine = nx ? `<div class="tvx-nxline"><small>Следом за этим столом</small><b>${esc(P(nx.a).nickname)}</b><em>—</em><b>${esc(P(nx.b).nickname)}</b><span>${esc(nx.note)}</span></div>` : '';
      return `<section class="tvx-scr">${top(`${title} · ${sub}`, '<div class="tvx-tag">Перерыв</div>')}<div class="tvx-wide">${nxLine}${left}</div>${foot()}</section>`;
    }
    const after = nextPairs().slice(1, 5);
    const right = nx ? `<div class="tvx-next"><small>Следом за этим столом</small>${fitNick(P(nx.a).nickname)}<em>—</em>${fitNick(P(nx.b).nickname)}<span>${esc(nx.note)}</span>${after.length ? `<ol class="tvx-after">${after.map(x => `<li>${esc(x.label)}<span>${esc(x.status === 'next' ? 'на стол · ' + x.note : x.note)}</span></li>`).join('')}</ol>` : ''}</div>`
      : `<div class="tvx-next">${qrCard()}</div>`;
    return `<section class="tvx-scr">${top(`${title} · ${sub}`, '<div class="tvx-tag">Перерыв</div>')}<div class="tvx-brk"><div class="tvx-left">${left}</div>${right}</div>${foot()}</section>`;
  }
  function breakParts(active) {
    const nx = nextPairs()[0];
    let left, title, sub, wide = false;
    if (active) {
      title = esc(active.name);
      const ms = (T.full.matches || []).filter(m => m.tournament_id === active.id);
      if (active.format === 'ko' && active.config?.slots) { sub = 'олимпийская система'; if (active.config.slots.length >= 8) { wide = true; left = koMirror(active.config.slots, ms, active.config.thirdPlace, nx); } else left = koTree(active.config.slots, ms, active.config.thirdPlace, nx); }
      else if (active.format === 'groups') {
        const groups = active.config?.groups || [], adv = active.config?.advance || 2;
        const koMs = ms.filter(m => m.stage === 'ko' || m.stage === 'ko3');
        if (active.config?.slots && koMs.length) { sub = 'плей-офф'; if (active.config.slots.length >= 8) { wide = true; left = koMirror(active.config.slots, koMs, active.config.thirdPlace, nx); } else left = koTree(active.config.slots, koMs, active.config.thirdPlace, nx); }
        else {
          sub = 'групповой этап';
          const n = groups.length, two = n === 2 && adv === 2, cols = n <= 3 ? n + (two ? 1 : 0) : Math.ceil(n / 2);
          left = `<div class="tvx-steps"><span class="on">Этап 1 · Группы</span><i>→</i><span>Этап 2 · Плей-офф</span><em>Из каждой группы в плей-офф выходят ${adv}</em></div>
            <div class="tvx-groups ${n > 4 ? 'dense' : ''}" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${groups.map((g, i) => placesCard(`Группа ${String.fromCharCode(1040 + i)}`, `${g.length} ${plural(g.length, 'игрок', 'игрока', 'игроков')} · каждый с каждым`, g, ms.filter(m => (m.stage === 'grp' || m.stage === 'grptb') && m.grp === i), adv, tieOptsFor(active, 'grp'))).join('')}${two ? playoffCard(groups, ms, active) : ''}</div>`;
        }
      } else {
        sub = 'каждый с каждым';
        const ids = active.participants || [], rrMs = ms.filter(m => m.stage === 'rr' || m.stage === 'rrtb'), st = standings(ids, rrMs, tieOptsFor(active, 'rr'));
        const left2 = tournamentSchedule(active, ms, T.data.live || []).filter(i => i.status !== 'done');
        left = `<div class="tvx-steps"><span class="on">Каждый играет со всеми</span><span>Больше побед — выше место</span><em>Сыграно ${st.played} из ${st.total}</em></div>
          <div class="tvx-rr">${placesCard('Места', 'у кого больше побед — тот выше', ids, rrMs, 1, tieOptsFor(active, 'rr'))}
          <div class="tvx-card tvx-gc"><h4>Порядок игр · осталось ${left2.length}</h4>${left2.slice(0, 7).map(it => `<div class="tvx-mr ${it.status === 'next' || it.status === 'live' ? 'now' : ''}"><span class="tvx-nk">${esc(P(it.a).nickname)}</span><b>—</b><span class="tvx-nk r">${esc(P(it.b).nickname)}</span></div>`).join('') || '<p class="tvx-muted">Все матчи сыграны</p>'}</div></div>`;
      }
    } else {
      title = 'Игры клуба'; sub = 'сегодня у стола';
      const last = [...(T.full?.matches || [])].sort((a, b) => Date.parse(b.played_at) - Date.parse(a.played_at)).slice(0, 6);
      left = `<div class="tvx-free"><div class="tvx-card tvx-list"><h4>Последние игры</h4><ol>${last.map(m => {
        const a = isDoubles(m) ? `${P(m.player1_id).nickname} + ${P(m.player3_id).nickname}` : P(m.player1_id).nickname;
        const b = isDoubles(m) ? `${P(m.player2_id).nickname} + ${P(m.player4_id).nickname}` : P(m.player2_id).nickname;
        return `<li>${esc(a)} ${m.sets1}:${m.sets2} ${esc(b)}<span>${new Date(m.played_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></li>`;
      }).join('') || '<li class="tvx-muted">Матчей пока нет</li>'}</ol></div>
        <div class="tvx-card tvx-list"><h4>Рейтинг клуба</h4><ol>${(T.rank || []).slice(0, 6).map((x, i) => `<li>${i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} ${esc(x.p.nickname)}<span>${fmtR(x.r)}</span></li>`).join('')}</ol></div></div>`;
    }
    return { left, title, sub, wide, nx };
  }
  // приветствие турнира: показывается при подключении табло и когда начинается новый турнир
  function welcomeScreen(t) {
    const ids = t.participants || [];
    return `<section class="tvx-scr">${top(esc(t.name) + ' · начинаем', '<div class="tvx-tag">Добро пожаловать</div>')}
      <div class="tvx-hello"><div><small>Сегодня в клубе</small><h1>${esc(t.name)}</h1><div class="fmt">${FMT[t.format] || ''} · ${ids.length} ${plural(ids.length, 'участник', 'участника', 'участников')}</div>
        <div class="who">${ids.map((id, k) => `<div style="animation-delay:${(.3 + k * .1).toFixed(2)}s">${avaTv(P(id))}<span class="tvx-nk">${esc(P(id).nickname)}</span></div>`).join('')}</div>
        <div class="how">${(HOW[t.format] || []).map((x, k) => `<span><b>${k + 1}</b>${x}</span>`).join('<i>→</i>')}</div></div></div>${foot()}</section>`;
  }

  function pairingScreen(code) {
    return `<div class="tvx-pair">${LOGO}<h1>Табло PongHub</h1>
      <p>В приложении PongHub: <b>Профиль → Управление клубом → Табло</b>, и введите код:</p>
      <div class="tvx-code">${esc(String(code).replace(/(\d{3})(\d{3})/, '$1 $2'))}</div>
      <p class="tvx-muted">Табло только показывает игры клуба — изменить оно ничего не может.</p></div>`;
  }

  function draw() {
    const d = T.data;
    if (!d) return;
    if (d.status === 'pairing') { box.dataset.bg = 'night'; box.innerHTML = pairingScreen(d.code); return; }
    if (d.status === 'blocked') { box.innerHTML = `<div class="tvx-msg">${LOGO}<b>PongHub</b><span>Клуб недоступен</span></div>`; return; }
    if (!T.full) return;
    box.dataset.bg = d.screen.theme || 'night';
    const live = d.live || [];
    let html;
    const tw = activeTour();
    if (tw && T.welcomed !== tw.id && !live.length) { T.welcomed = tw.id; T.welcomeUntil = Date.now() + WELCOME; }
    if (tw && !live.length && Date.now() < (T.welcomeUntil || 0)) html = welcomeScreen(tw);
    else if (live.some(isPaused)) html = pauseScreen(live.find(isPaused));
    else if (live.length) {
      if (Date.now() - T.rotAt > ROTATE) { T.rot++; T.rotAt = Date.now(); }
      html = liveScreen(live[T.rot % live.length]);
    } else if (d.recent && (Date.parse(d.now) - Date.parse(d.recent.updated_at)) / 1000 < RESULT_SHOW) {
      // турнирный матч: короткий итог, затем сетка турнира с подсвеченной следующей парой
      const age = (Date.parse(d.now) - Date.parse(d.recent.updated_at)) / 1000;
      html = d.recent.tournament_id && age > RESULT_TOUR ? breakScreen() : resultScreen(d.recent);
    } else html = breakScreen();
    // экран сменился — плавно
    const kind = live.length ? 'live' : d.recent && html.includes('tvx-res') ? 'res' : html.includes('tvx-hello') ? 'hello' : 'brk';
    // ничего не изменилось — не перерисовываем (иначе анимации и бегущая строка начинаются заново)
    if (html === T.lastHtml && kind === T.kind) return;
    T.lastHtml = html;
    box.innerHTML = html.replace('class="tvx-scr"', `class="tvx-scr${kind !== T.kind ? ' fade' : ''}"`);
    T.kind = kind;
    // ники «следом за столом»: уменьшаем шрифт, пока ник не влезет целиком
    box.querySelectorAll('.tvx-next .tvx-nk').forEach(el => {
      let f = parseFloat(el.style.fontSize) || 3.6;
      while (el.scrollWidth > el.clientWidth + 1 && f > 1.6) { f -= .1; el.style.fontSize = f.toFixed(2) + 'cqw'; }
    });
    drawQr();
  }

  async function drawQr() {
    const el = document.getElementById('tvx-qr');
    if (!el || T.qr) return;
    try {
      T.qr = qrSvg(await makeQr(`${location.origin}${location.pathname}${localStorage.getItem('ponghub_sandbox') === '1' && !/(^|[.-])sandbox([.-]|$)/i.test(location.hostname) ? '?sandbox=1' : ''}#/club/${T.data.club.id}`), { margin: 1 });
      document.querySelectorAll('#tvx-qr').forEach(x => { x.innerHTML = T.qr; });
    } catch { /* без QR */ }
  }

  await tick();
  setInterval(tick, POLL);
  setInterval(() => { const c = box.querySelector('.tvx-clock'); if (c) c.textContent = clock(); }, 15000);
  // таймер паузы идёт сам, раз в секунду
  setInterval(() => { const el = box.querySelector('.tvx-ptime'); if (!el || !T.pauseEnd) return; const left = Math.max(0, Math.round((T.pauseEnd - Date.now()) / 1000)); el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; }, 1000);
}
