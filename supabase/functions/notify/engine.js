// Рейтинговый движок, статистика и достижения.
// Рейтинг не хранится в базе — он каждый раз пересчитывается из истории матчей.
// Поэтому исправление/удаление любого матча автоматически пересчитывает всё корректно.

export const DEFAULT_SETTINGS = {
  clubName: 'PongHub',
  initialRating: 40,   // стартовый рейтинг по умолчанию
  spread: 50,          // «масштаб»: разница в 50 очков ≈ шанс 10 к 1
  kTournament: 8,      // максимальное изменение за турнирный матч
  kFree: 4,            // максимальное изменение за свободную игру
  kDoubles: 4,         // максимальное изменение за парную игру (отдельный рейтинг)
  newcomerGames: 10,   // первые N матчей рейтинг двигается быстрее
  newcomerMult: 1.5,
  marginBonus: true,   // 3:0 весит чуть больше, чем 3:2
  minRating: 1,
  decayEnabled: true,  // снижение рейтинга, если долго не играть
  decayGraceDays: 30,  // сколько дней без игр не наказываются
  decayPerWeek: 0.5,   // минус за каждую следующую неделю (не ниже стартового рейтинга)
  seasonMinMatches: 3, // минимум матчей за месяц, чтобы бороться за звание чемпиона сезона
};

export const LEAGUES = [
  { min: -Infinity, name: 'Бронза', cls: 'bronze' },
  { min: 45, name: 'Серебро', cls: 'silver' },
  { min: 55, name: 'Золото', cls: 'gold' },
  { min: 70, name: 'Платина', cls: 'platinum' },
  { min: 90, name: 'Алмаз', cls: 'diamond' },
];

export function leagueOf(r) {
  let l = LEAGUES[0];
  for (const x of LEAGUES) if (r >= x.min) l = x;
  return l;
}

export function nextLeague(r) {
  return LEAGUES.find(x => x.min > r) || null;
}

export function expected(ra, rb, spread) {
  return 1 / (1 + Math.pow(10, (rb - ra) / spread));
}

export function winsNeeded(bestOf) {
  return Math.ceil((bestOf || 1) / 2);
}

export function marginFactor(w, l, bestOf) {
  const need = winsNeeded(bestOf || (2 * w - 1));
  if (need <= 1) return 1;
  return 0.9 + 0.2 * ((w - l) - 1) / (need - 1);
}

export const ts = m => Date.parse(m.played_at) || 0;
export const DAY = 864e5;
export const isDoubles = m => m.kind === 'doubles';

export function sortMatches(ms) {
  return [...ms].sort((a, b) => ts(a) - ts(b) || (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
}

const startRating = (p, S) => (p && p.initial_rating != null && p.initial_rating !== '' ? +p.initial_rating : S.initialRating);

/**
 * Полный пересчёт одиночного рейтинга по всем подтверждённым матчам 1×1.
 * now — момент, до которого считается снижение за неактивность.
 */
export function analyze(profiles, matches, settings, now = Date.now()) {
  const S = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const rating = new Map(), games = new Map(), history = new Map(), start = new Map();
  const last = new Map(), decayWeeks = new Map(), decayTotal = new Map();
  const active = new Set(profiles.filter(p => p.status === 'approved').map(p => p.id));
  const ensure = (id, p) => {
    if (rating.has(id)) return;
    const r0 = startRating(p, S);
    rating.set(id, r0); start.set(id, r0); games.set(id, 0); decayTotal.set(id, 0);
    history.set(id, [{ t: p ? Date.parse(p.created_at) || 0 : 0, r: r0, init: true }]);
  };
  profiles.forEach(p => ensure(p.id, p));

  // Снижение: после decayGraceDays без игр — минус decayPerWeek за каждую неделю, но не ниже стартового рейтинга
  const decayTo = (id, t) => {
    if (!S.decayEnabled || !last.has(id)) return;
    const weeks = Math.floor(((t - last.get(id)) / DAY - S.decayGraceDays) / 7);
    const done = decayWeeks.get(id) || 0;
    if (weeks <= done) return;
    decayWeeks.set(id, weeks);
    const r = rating.get(id), floor = start.get(id);
    if (r <= floor) return;
    const nr = Math.max(floor, r - (weeks - done) * S.decayPerWeek);
    rating.set(id, nr);
    decayTotal.set(id, decayTotal.get(id) + (r - nr));
    history.get(id).push({ t: last.get(id) + (S.decayGraceDays + weeks * 7) * DAY, r: nr, decay: true });
  };

  const md = new Map();
  const played = sortMatches(matches.filter(m =>
    !isDoubles(m) && m.status === 'approved' && m.winner_id && m.player1_id && m.player2_id));

  for (const m of played) {
    const a = m.player1_id, b = m.player2_id, t = ts(m);
    ensure(a); ensure(b);
    decayTo(a, t); decayTo(b, t);
    const ra = rating.get(a), rb = rating.get(b);

    let leader = null, best = -Infinity;
    for (const [id, r] of rating) if (active.has(id) && games.get(id) > 0 && r > best) { best = r; leader = id; }

    const ea = expected(ra, rb, S.spread);
    let na = ra, nb = rb;
    if (m.rated !== false) {
      const sa = m.winner_id === a ? 1 : 0;
      const K = m.type === 'tournament' ? +S.kTournament : +S.kFree;
      const w = Math.max(m.sets1 || 0, m.sets2 || 0), l = Math.min(m.sets1 || 0, m.sets2 || 0);
      const f = S.marginBonus && w > 0 ? marginFactor(w, l, m.best_of) : 1;
      const ka = K * f * (games.get(a) < S.newcomerGames ? +S.newcomerMult : 1);
      const kb = K * f * (games.get(b) < S.newcomerGames ? +S.newcomerMult : 1);
      na = Math.max(+S.minRating, ra + ka * (sa - ea));
      nb = Math.max(+S.minRating, rb + kb * ((1 - sa) - (1 - ea)));
      rating.set(a, na); rating.set(b, nb);
      games.set(a, games.get(a) + 1); games.set(b, games.get(b) + 1);
      last.set(a, t); last.set(b, t); decayWeeks.set(a, 0); decayWeeks.set(b, 0);
    }
    md.set(m.id, {
      before: { [a]: ra, [b]: rb },
      after: { [a]: na, [b]: nb },
      delta: { [a]: na - ra, [b]: nb - rb },
      exp: { [a]: ea, [b]: 1 - ea },
      leaderBefore: leader,
    });
    history.get(a).push({ t, r: na, matchId: m.id });
    history.get(b).push({ t, r: nb, matchId: m.id });
  }
  for (const id of rating.keys()) decayTo(id, now);
  return { rating, games, history, md, played, decayTotal, S };
}

/**
 * Отдельный парный рейтинг (2×2). Команда 1 = player1 + player3, команда 2 = player2 + player4.
 * Шанс считается по среднему рейтингу команд, каждый игрок получает своё изменение.
 */
export function analyzeDoubles(profiles, matches, settings) {
  const S = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const rating = new Map(), games = new Map(), history = new Map(), stats = new Map();
  const ensure = (id, p) => {
    if (rating.has(id)) return;
    rating.set(id, +S.initialRating); games.set(id, 0);
    history.set(id, [{ t: p ? Date.parse(p.created_at) || 0 : 0, r: +S.initialRating, init: true }]);
    stats.set(id, { matches: 0, wins: 0, losses: 0, partners: new Map() });
  };
  profiles.forEach(p => ensure(p.id, p));
  const md = new Map();
  const played = sortMatches(matches.filter(m =>
    isDoubles(m) && m.status === 'approved' && m.winner_id && m.player1_id && m.player2_id && m.player3_id && m.player4_id));
  for (const m of played) {
    const A = [m.player1_id, m.player3_id], B = [m.player2_id, m.player4_id];
    [...A, ...B].forEach(id => ensure(id));
    const winA = m.winner_id === m.player1_id || m.winner_id === m.player3_id;
    const before = {}, after = {}, delta = {};
    [...A, ...B].forEach(id => { before[id] = after[id] = rating.get(id); delta[id] = 0; });
    const avg = ids => (rating.get(ids[0]) + rating.get(ids[1])) / 2;
    const eA = expected(avg(A), avg(B), S.spread);
    if (m.rated !== false) {
      const w = Math.max(m.sets1 || 0, m.sets2 || 0), l = Math.min(m.sets1 || 0, m.sets2 || 0);
      const f = S.marginBonus && w > 0 ? marginFactor(w, l, m.best_of) : 1;
      const apply = (ids, score, e) => ids.forEach(id => {
        const k = +S.kDoubles * f * (games.get(id) < S.newcomerGames ? +S.newcomerMult : 1);
        const nr = Math.max(+S.minRating, rating.get(id) + k * (score - e));
        after[id] = nr; delta[id] = nr - rating.get(id);
      });
      apply(A, winA ? 1 : 0, eA);
      apply(B, winA ? 0 : 1, 1 - eA);
      [...A, ...B].forEach(id => { rating.set(id, after[id]); games.set(id, games.get(id) + 1); history.get(id).push({ t: ts(m), r: after[id], matchId: m.id }); });
    }
    const note = (ids, won) => ids.forEach((id, i) => {
      const st = stats.get(id), mate = ids[1 - i];
      st.matches++; won ? st.wins++ : st.losses++;
      const ps = st.partners.get(mate) || { w: 0, l: 0 };
      won ? ps.w++ : ps.l++;
      st.partners.set(mate, ps);
    });
    note(A, winA); note(B, !winA);
    md.set(m.id, { before, after, delta, expA: eA, winA });
  }
  return { rating, games, history, stats, md, played, S };
}

export function rankingDoubles(D, profiles) {
  return profiles
    .filter(p => p.status === 'approved' && (D.stats.get(p.id)?.matches || 0) > 0)
    .map(p => ({ p, r: D.rating.get(p.id), g: D.stats.get(p.id).matches, st: D.stats.get(p.id) }))
    .sort((x, y) => y.r - x.r);
}

/** Рейтинг игрока на момент времени t (для «изменение за 30 дней»). */
export function ratingAt(A, id, t) {
  const h = A.history.get(id) || [];
  let r = h.length ? h[0].r : A.S.initialRating;
  for (const x of h) { if (x.init || x.t <= t) r = x.r; else break; }
  return r;
}

export function ranking(A, profiles) {
  return profiles
    .filter(p => p.status === 'approved')
    .map(p => ({ p, r: A.rating.get(p.id) ?? A.S.initialRating, g: A.games.get(p.id) || 0 }))
    .sort((x, y) => (y.g > 0) - (x.g > 0) || y.r - x.r || x.p.nickname.localeCompare(y.p.nickname));
}

/** Партии с точки зрения игрока id. */
export function setsFor(m, id) {
  const me1 = m.player1_id === id;
  const sets = (m.sets || []).map(s => (me1 ? [s[0], s[1]] : [s[1], s[0]]));
  return { me1, sets, my: me1 ? m.sets1 : m.sets2, op: me1 ? m.sets2 : m.sets1, opp: me1 ? m.player2_id : m.player1_id };
}

export function playerStats(id, A, tournaments = []) {
  const ms = A.played.filter(m => m.player1_id === id || m.player2_id === id);
  const s = {
    matches: ms.length, wins: 0, losses: 0, setsW: 0, setsL: 0, ptsW: 0, ptsL: 0,
    streak: 0, streakType: null, bestStreak: 0, peak: A.rating.get(id) ?? A.S.initialRating,
    deciderW: 0, deciderL: 0, closeW: 0, closeL: 0,
    strongW: 0, strongL: 0, equalW: 0, equalL: 0, weakW: 0, weakL: 0,
    tourW: 0, tourL: 0, freeW: 0, freeL: 0,
    comebacks: 0, sweeps: 0, giant: 0, beatLeader: 0, longSetWin: 0,
    biggestWin: null, form: [], opponents: new Map(), days: new Set(),
    medals: { gold: 0, silver: 0, bronze: 0 }, tournamentsPlayed: 0, list: ms,
  };
  let cur = 0, curType = null;
  for (const m of ms) {
    const { sets, my, op, opp } = setsFor(m, id);
    const won = m.winner_id === id;
    const d = A.md.get(m.id);
    s.days.add(new Date(ts(m)).toDateString());
    won ? s.wins++ : s.losses++;
    s.setsW += my || 0; s.setsL += op || 0;
    for (const [x, y] of sets) {
      s.ptsW += +x || 0; s.ptsL += +y || 0;
      if (Math.abs(x - y) === 2 && Math.max(x, y) >= (m.points_to || 11)) (x > y ? s.closeW++ : s.closeL++);
      if (x > y && x > (m.points_to || 11)) s.longSetWin++;
    }
    if (m.best_of > 1 && (my + op) === m.best_of) won ? s.deciderW++ : s.deciderL++;
    const need = winsNeeded(m.best_of);
    if (won && need >= 2 && sets.length) {
      let a = 0, b = 0, down = false;
      for (const [x, y] of sets) { x > y ? a++ : b++; if (b - a >= need - 1 && a === 0) down = true; }
      if (down) s.comebacks++;
    }
    if (won && op === 0 && my >= 2) s.sweeps++;
    if (d) {
      const diff = d.before[opp] - d.before[id];
      if (diff >= 5) won ? s.strongW++ : s.strongL++;
      else if (diff <= -5) won ? s.weakW++ : s.weakL++;
      else won ? s.equalW++ : s.equalL++;
      if (won && diff >= 15) s.giant++;
      if (won && d.leaderBefore === opp) s.beatLeader++;
      if (won && (!s.biggestWin || diff > s.biggestWin.diff)) s.biggestWin = { diff, m };
      s.peak = Math.max(s.peak, d.after[id]);
    }
    m.type === 'tournament' ? (won ? s.tourW++ : s.tourL++) : (won ? s.freeW++ : s.freeL++);
    const o = s.opponents.get(opp) || { w: 0, l: 0 };
    won ? o.w++ : o.l++;
    s.opponents.set(opp, o);
    const type = won ? 'W' : 'L';
    if (type === curType) cur++; else { cur = 1; curType = type; }
    if (type === 'W') s.bestStreak = Math.max(s.bestStreak, cur);
    s.form.push(type);
  }
  s.streak = cur; s.streakType = curType;
  s.form = s.form.slice(-10);
  for (const t of tournaments) {
    if (!(t.participants || []).includes(id)) continue;
    s.tournamentsPlayed++;
    const r = t.status === 'finished' && t.results;
    if (!r) continue;
    if (r.gold === id) s.medals.gold++;
    if (r.silver === id) s.medals.silver++;
    if ((r.bronze || []).includes(id)) s.medals.bronze++;
  }
  s.winRate = s.matches ? s.wins / s.matches : 0;
  return s;
}

export const ACHIEVEMENTS = [
  { key: 'first', icon: '🏓', name: 'Первая победа', desc: 'Выиграть первый матч', test: s => s.wins >= 1 },
  { key: 'w10', icon: '💪', name: 'Десятка', desc: '10 побед', test: s => s.wins >= 10, prog: s => [s.wins, 10] },
  { key: 'w50', icon: '🦾', name: 'Полтинник', desc: '50 побед', test: s => s.wins >= 50, prog: s => [s.wins, 50] },
  { key: 'm100', icon: '🏃', name: 'Марафонец', desc: 'Сыграть 100 матчей', test: s => s.matches >= 100, prog: s => [s.matches, 100] },
  { key: 's5', icon: '🔥', name: 'В огне', desc: '5 побед подряд', test: s => s.bestStreak >= 5, prog: s => [s.bestStreak, 5] },
  { key: 's10', icon: '☄️', name: 'Неудержимый', desc: '10 побед подряд', test: s => s.bestStreak >= 10, prog: s => [s.bestStreak, 10] },
  { key: 'sweep', icon: '🧹', name: 'Всухую', desc: 'Выиграть матч, не отдав ни одной партии', test: s => s.sweeps >= 1 },
  { key: 'comeback', icon: '🔄', name: 'Камбэк', desc: 'Выиграть, проигрывая 0:2 (или 0:1 до двух побед)', test: s => s.comebacks >= 1 },
  { key: 'giant', icon: '🗡️', name: 'Гроза фаворитов', desc: 'Обыграть соперника с рейтингом на 15+ выше', test: s => s.giant >= 1 },
  { key: 'king', icon: '👑', name: 'Свергнуть короля', desc: 'Обыграть лидера рейтинга', test: s => s.beatLeader >= 1 },
  { key: 'nerves', icon: '🧊', name: 'Стальные нервы', desc: 'Выиграть 5 решающих партий', test: s => s.deciderW >= 5, prog: s => [s.deciderW, 5] },
  { key: 'deuce', icon: '⚖️', name: 'Больше-меньше', desc: 'Выиграть партию на балансе (12:10 и дальше)', test: s => s.longSetWin >= 1 },
  { key: 'champ', icon: '🏆', name: 'Чемпион', desc: 'Выиграть турнир', test: s => s.medals.gold >= 1 },
  { key: 'podium', icon: '🎖️', name: 'Призёр', desc: 'Попасть в тройку на турнире', test: s => s.medals.gold + s.medals.silver + s.medals.bronze >= 1 },
  { key: 'regular', icon: '📅', name: 'Завсегдатай', desc: 'Играть в 10 разных дней', test: s => s.days.size >= 10, prog: s => [s.days.size, 10] },
];

/** Подсказки «над чем работать» — простые правила на основе статистики. */
export function insights(s) {
  const out = [];
  const pct = (w, l) => (w + l ? w / (w + l) : null);
  const dec = pct(s.deciderW, s.deciderL);
  const close = pct(s.closeW, s.closeL);
  const strong = pct(s.strongW, s.strongL);
  const weak = pct(s.weakW, s.weakL);
  if (s.matches < 5) {
    out.push({ tone: 'info', text: 'Сыграйте хотя бы 5 матчей — тогда анализ станет точнее.' });
    return out;
  }
  if (dec !== null && s.deciderW + s.deciderL >= 3) {
    if (dec < 0.4) out.push({ tone: 'bad', text: `В решающих партиях вы выигрываете лишь ${Math.round(dec * 100)}%. Стоит поработать над концовками и психологией.` });
    else if (dec > 0.6) out.push({ tone: 'good', text: `Решающие партии — ваша сильная сторона: ${Math.round(dec * 100)}% побед.` });
  }
  if (close !== null && s.closeW + s.closeL >= 4) {
    if (close < 0.4) out.push({ tone: 'bad', text: `Партии «на балансе» чаще уходят сопернику (${Math.round(close * 100)}% побед). Тренируйте подачу и приём в концовке.` });
    else if (close > 0.6) out.push({ tone: 'good', text: `Вы хорошо дожимаете партии на балансе — ${Math.round(close * 100)}% побед.` });
  }
  if (weak !== null && s.weakW + s.weakL >= 3 && weak < 0.6)
    out.push({ tone: 'bad', text: `Вы теряете очки против более слабых соперников (${Math.round(weak * 100)}% побед). Это самые «дорогие» поражения для рейтинга.` });
  if (strong !== null && s.strongW + s.strongL >= 3) {
    if (strong >= 0.4) out.push({ tone: 'good', text: `Против сильных вы выигрываете ${Math.round(strong * 100)}% — рейтинг, скорее всего, пойдёт вверх.` });
    else if (strong < 0.15) out.push({ tone: 'info', text: 'Против сильных соперников пока тяжело. Играйте с ними чаще — проигрыш сильному почти не снижает рейтинг.' });
  }
  const recent = s.form.filter(x => x === 'W').length / (s.form.length || 1);
  if (s.form.length >= 6) {
    if (recent > s.winRate + 0.15) out.push({ tone: 'good', text: 'Форма растёт: в последних матчах вы выигрываете заметно чаще, чем в среднем.' });
    else if (recent < s.winRate - 0.15) out.push({ tone: 'bad', text: 'Последние матчи хуже вашего среднего уровня — возможно, стоит отдохнуть или сменить тактику.' });
  }
  if (!out.length) out.push({ tone: 'info', text: 'Ровная игра без явных провалов. Чтобы расти — чаще играйте с теми, кто выше вас в рейтинге.' });
  return out;
}

export function playerOfMonth(A, profiles, now = Date.now()) {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const gain = new Map();
  for (const m of A.played) {
    if (ts(m) < start) continue;
    const md = A.md.get(m.id);
    for (const id of [m.player1_id, m.player2_id]) gain.set(id, (gain.get(id) || 0) + md.delta[id]);
  }
  const ok = new Set(profiles.filter(p => p.status === 'approved').map(p => p.id));
  let best = null;
  for (const [id, g] of gain) if (ok.has(id) && g > 0 && (!best || g > best.g)) best = { id, g };
  return best;
}

export function headToHead(A, a, b) {
  const ms = A.played.filter(m => (m.player1_id === a && m.player2_id === b) || (m.player1_id === b && m.player2_id === a));
  let wa = 0, wb = 0, sa = 0, sb = 0;
  for (const m of ms) {
    m.winner_id === a ? wa++ : wb++;
    const f = setsFor(m, a);
    sa += f.my || 0; sb += f.op || 0;
  }
  return { ms, wa, wb, sa, sb };
}

/** Проверка счёта партии. Возвращает текст ошибки или null. */
export function validateSet(x, y, pointsTo) {
  x = +x; y = +y;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return 'Введите целые числа';
  if (x === y) return 'В партии не может быть ничьей';
  const hi = Math.max(x, y), lo = Math.min(x, y);
  if (hi < pointsTo) return `Партия идёт до ${pointsTo} очков`;
  if (lo >= pointsTo - 1) { if (hi - lo !== 2) return `На балансе (${pointsTo - 1}:${pointsTo - 1}) нужно выиграть ровно 2 очка подряд`; }
  else if (hi !== pointsTo) return `При счёте ${lo} у проигравшего победитель набирает ровно ${pointsTo}`;
  return null;
}

// ───────────── Сезоны и итоги недели ─────────────

export const monthKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const monthBounds = key => { const [y, m] = key.split('-').map(Number); return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()]; };
export const monthName = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };

/** Таблица одного сезона (месяца): прирост рейтинга за месяц среди сыгравших не меньше seasonMinMatches. */
export function seasonTable(A, profiles, key, now = Date.now()) {
  const [from, to] = monthBounds(key);
  const end = Math.min(to, now);
  const count = new Map(), wins = new Map();
  for (const m of A.played) {
    const t = ts(m);
    if (t < from || t >= to || m.rated === false) continue;
    for (const id of [m.player1_id, m.player2_id]) {
      count.set(id, (count.get(id) || 0) + 1);
      if (m.winner_id === id) wins.set(id, (wins.get(id) || 0) + 1);
    }
  }
  const ok = new Set(profiles.filter(p => p.status === 'approved' || p.status === 'archived').map(p => p.id));
  const rows = [...count].filter(([id]) => ok.has(id)).map(([id, n]) => ({
    id, matches: n, wins: wins.get(id) || 0,
    gain: ratingAt(A, id, end - 1) - ratingAt(A, id, from - 1),
  }));
  const min = +A.S.seasonMinMatches || 1;
  const eligible = rows.filter(r => r.matches >= min).sort((a, b) => b.gain - a.gain);
  const rest = rows.filter(r => r.matches < min).sort((a, b) => b.matches - a.matches);
  const total = A.played.filter(m => { const t = ts(m); return t >= from && t < to; }).length;
  return { key, eligible, rest, champion: eligible[0] || null, total, finished: now >= to };
}

/** Все сезоны от первого матча до текущего месяца (новые сверху). */
export function seasons(A, profiles, now = Date.now()) {
  if (!A.played.length) return [];
  const keys = [];
  let d = new Date(ts(A.played[0])); d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (d.getTime() <= now) { keys.push(monthKey(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return keys.reverse().map(k => seasonTable(A, profiles, k, now));
}

/** Итоги прошлой недели (пн–вс): матчи, кто вырос сильнее всех, самый активный, главная сенсация. */
export function weekSummary(A, D, profiles, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const monday = d.getTime() - ((d.getDay() + 6) % 7) * DAY;
  const from = monday - 7 * DAY, to = monday;
  const inWeek = m => { const t = ts(m); return t >= from && t < to; };
  const singles = A.played.filter(inWeek), doubles = (D ? D.played : []).filter(inWeek);
  const ok = new Set(profiles.filter(p => p.status === 'approved').map(p => p.id));
  const count = new Map();
  for (const m of singles) for (const id of [m.player1_id, m.player2_id]) count.set(id, (count.get(id) || 0) + 1);
  for (const m of doubles) for (const id of [m.player1_id, m.player2_id, m.player3_id, m.player4_id]) count.set(id, (count.get(id) || 0) + 1);
  let top = null, active = null, upset = null;
  for (const [id, n] of count) {
    if (!ok.has(id)) continue;
    if (!active || n > active.n) active = { id, n };
    const g = ratingAt(A, id, to - 1) - ratingAt(A, id, from - 1);
    if (g > 0.005 && (!top || g > top.g)) top = { id, g };
  }
  for (const m of singles) {
    const md = A.md.get(m.id); if (!md || m.rated === false) continue;
    const w = m.winner_id, l = w === m.player1_id ? m.player2_id : m.player1_id;
    const diff = md.before[l] - md.before[w];
    if (diff > 0 && (!upset || diff > upset.diff)) upset = { m, w, l, diff };
  }
  return { from, to, matches: singles.length + doubles.length, singles: singles.length, doubles: doubles.length, top, active, upset };
}
