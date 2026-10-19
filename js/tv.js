// Табло клуба для телевизора (16:9). Открывается по адресу #/tv, без входа в аккаунт.
// Привязка: табло получает токен и код из 6 цифр → владелец клуба вводит код в «Управлении → Табло».
// Дальше табло само опрашивает screen_state(токен) и переключается: игра → итоги → перерыв.
import { analyze, ranking, leagueOf, replayLive, DEFAULT_SETTINGS, isDoubles, winsNeeded } from './engine.js';
import { koBracket, roundName, standings, pairings } from './tourney.js';
import { parseKey } from './shop-catalog.js';

const LS = 'ponghub_tv_token';
const POLL = 2000;            // как часто спрашиваем текущую игру
const FULL_EVERY = 60000;     // как часто обновляем рейтинг и сетку
const RESULT_SHOW = 40;       // сколько секунд показываем итоги матча
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
  root.addEventListener('click', () => { keepAwake(); if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); });
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
    } catch (e) {
      if (!T.data) box.innerHTML = `<div class="tvx-msg">${LOGO}<b>PongHub</b><span>Нет связи с сервером. Проверяю снова…</span></div>`;
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
    return { gender: p?.avatar3d || 'boy', loadout: p?.loadout || {}, nick: P(id).nickname, rating: fmtR(r), league: leagueOf(r), racket: racketName(p?.loadout) };
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
      try { const m = await import('./player3d.js'); await m.tvIntro(stage, { A: who(nl.player1_id, av), B: who(nl.player2_id, av), grip: av.grip }); } catch { /* без 3D */ } finally { showing = false; }
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
      try { const m = await import('./player3d.js'); await m.tvWinner(stage, { W: who(wId, av), score: `${Math.max(w1, w2)} : ${Math.min(w1, w2)}`, grip: av.grip }); } catch { /* без 3D */ } finally { showing = false; }
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
  const ava = p => p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : esc(p.avatar || (p.nickname || '?')[0]);
  const tour = id => T.full?.tournaments.find(t => t.id === id);
  const clock = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  function top(label, tagHtml) {
    const d = T.data;
    return `<div class="tvx-top"><div class="tvx-logo">${LOGO}</div>
      <div><div class="tvx-club">${esc(d.club.name)}</div><div class="tvx-crumb">${label}</div></div>
      ${tagHtml}<div class="tvx-clock">${clock()}</div></div>`;
  }
  function foot(lead) {
    const items = (T.rank || []).slice(0, 6).map((x, i) => `<span>${i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} ${esc(x.p.nickname)}<b>${fmtR(x.r)}</b></span>`).join('');
    return `<div class="tvx-foot">${lead || `<strong>Рейтинг клуба</strong>${items}`}<span class="tvx-brand">${LOGO}PONGHUB</span></div>`;
  }
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
      const ms = (T.full.matches || []).filter(m => m.tournament_id === active.id);
      if (active.config?.slots) {
        const br = koBracket(active.config.slots, ms, active.config.thirdPlace);
        br.rounds.forEach((row, r) => row.forEach(c => {
          if (c.a && c.b && !c.match && !c.bye && !(liveIds.has(c.a) && liveIds.has(c.b)))
            out.push({ a: c.a, b: c.b, label: `${P(c.a).nickname} — ${P(c.b).nickname}`, note: roundName(r, br.rounds.length).toLowerCase() });
        }));
        if (br.third && br.third.a && br.third.b && !br.third.match) out.push({ a: br.third.a, b: br.third.b, label: `${P(br.third.a).nickname} — ${P(br.third.b).nickname}`, note: 'за 3-е место' });
      } else {
        const groups = active.format === 'groups' ? (active.config?.groups || []).map((g, i) => ({ ids: g, stage: 'grp', grp: i })) : [{ ids: active.participants || [], stage: 'rr', grp: null }];
        for (const g of groups) for (const [a, b] of pairings(g.ids)) {
          const played = ms.some(m => m.stage === g.stage && (g.grp === null || m.grp === g.grp) && ((m.player1_id === a && m.player2_id === b) || (m.player1_id === b && m.player2_id === a)));
          if (!played && !(liveIds.has(a) && liveIds.has(b))) out.push({ a, b, label: `${P(a).nickname} — ${P(b).nickname}`, note: g.grp === null ? 'круговой' : `группа ${String.fromCharCode(1040 + g.grp)}` });
        }
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
    const flag = [0, 1].map(s => g.matchPoint[s] ? 'Матчбол · ' + sideName(l, s) : g.setPoint[s] ? 'Сетбол · ' + sideName(l, s) : '').find(Boolean) || '';
    const chips = g.sets.length ? '<span>Партии:</span>' + g.sets.map(([a, b]) => `<span class="tvx-chip"><b class="${a > b ? 'w1' : ''}">${a}</b> : <b class="${b > a ? 'w2' : ''}">${b}</b></span>`).join('') : '<span>Первая партия</span>';
    return `<section class="tvx-scr">${top(crumbFor(l), '<div class="tvx-live"><i></i>LIVE</div>')}
      <div class="tvx-main"><div class="tvx-court"><div class="tvx-duel">${panel(l, 0, g)}
        <div class="tvx-mid"><small>Партии</small><div class="tvx-sets"><b>${g.won[0]}</b><span>:</span><b>${g.won[1]}</b></div>
          ${flag ? `<div class="tvx-flag">${esc(flag)}</div>` : ''}<small>Партия ${g.sets.length + (g.winner === null ? 1 : 0)}</small></div>
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

  function breakScreen() {
    const active = (T.full?.tournaments || []).filter(t => t.status === 'active').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
    const nx = nextPairs()[0];
    let left, title, sub;
    if (active) {
      title = esc(active.name);
      const ms = (T.full.matches || []).filter(m => m.tournament_id === active.id);
      if (active.config?.slots) {
        sub = 'олимпийская система';
        const br = koBracket(active.config.slots, ms, active.config.thirdPlace);
        const rounds = br.rounds.slice(-3);
        const off = br.rounds.length - rounds.length;
        left = `<div class="tvx-bracket" style="grid-template-columns:repeat(${rounds.length},1fr)">${rounds.map((row, k) => `<div class="tvx-round"><h5>${esc(roundName(off + k, br.rounds.length))}</h5>${row.filter(c => !c.empty).map(c => {
          const nm = id => id ? esc(P(id).nickname) : '—';
          const sc = (id, n) => c.match ? (c.match.player1_id === id ? c.match.sets1 : c.match.sets2) : '';
          const isNext = nx && c.a && c.b && ((nx.a === c.a && nx.b === c.b) || (nx.a === c.b && nx.b === c.a));
          return `<div class="tvx-bm ${isNext ? 'now' : ''}"><div class="${c.winner && c.winner === c.a ? 'w' : ''}">${nm(c.a)}<span>${c.bye ? '' : sc(c.a)}</span></div><div class="${c.winner && c.winner === c.b ? 'w' : ''}">${c.bye ? 'проход' : nm(c.b)}<span>${c.bye ? '' : sc(c.b)}</span></div></div>`;
        }).join('')}</div>`).join('')}</div>`;
      } else {
        sub = active.format === 'groups' ? 'групповой этап' : 'круговой турнир';
        const ids = active.format === 'groups' ? (active.config?.groups || []).flat() : (active.participants || []);
        const tab = standings(ids, ms.filter(m => m.stage === 'rr' || m.stage === 'grp')).list.slice(0, 8);
        left = `<div class="tvx-card tvx-table"><h4>Таблица</h4><ol>${tab.map((x, i) => `<li><b>${i + 1}</b>${esc(P(x.id).nickname)}<span>${x.w}–${x.l}</span><em>${x.pts}</em></li>`).join('')}</ol></div>`;
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
    const right = nx ? `<div class="tvx-next"><small>Следом за этим столом</small><b>${esc(P(nx.a).nickname)}<br>—<br>${esc(P(nx.b).nickname)}</b><span>${esc(nx.note)}</span></div>`
      : `<div class="tvx-next">${qrCard()}</div>`;
    return `<section class="tvx-scr">${top(`${title} · ${sub}`, '<div class="tvx-tag">Перерыв</div>')}<div class="tvx-brk">${left}${right}</div>${foot()}</section>`;
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
    if (live.length) {
      if (Date.now() - T.rotAt > ROTATE) { T.rot++; T.rotAt = Date.now(); }
      html = liveScreen(live[T.rot % live.length]);
    } else if (d.recent && (Date.parse(d.now) - Date.parse(d.recent.updated_at)) / 1000 < RESULT_SHOW) {
      html = resultScreen(d.recent);
    } else html = breakScreen();
    // экран сменился — плавно
    const kind = live.length ? 'live' : d.recent && html.includes('tvx-res') ? 'res' : 'brk';
    box.innerHTML = html.replace('class="tvx-scr"', `class="tvx-scr${kind !== T.kind ? ' fade' : ''}"`);
    T.kind = kind;
    drawQr();
  }

  async function drawQr() {
    const el = document.getElementById('tvx-qr');
    if (!el || T.qr) return;
    try {
      const src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const qr = window.qrcode(0, 'M');
      qr.addData(`${location.origin}${location.pathname}#/club/${T.data.club.id}`); qr.make();
      T.qr = qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
      document.querySelectorAll('#tvx-qr').forEach(x => { x.innerHTML = T.qr; });
    } catch { /* без QR */ }
  }

  await tick();
  setInterval(tick, POLL);
  setInterval(() => { const c = box.querySelector('.tvx-clock'); if (c) c.textContent = clock(); }, 15000);
}
