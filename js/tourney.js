// Логика турниров: олимпийская сетка, круговой турнир, группы + плей-офф.

export const FORMATS = {
  ko: 'Олимпийская система (на выбывание)',
  rr: 'Круговой (каждый с каждым)',
  groups: 'Группы + плей-офф',
};

export const nextPow2 = n => { let s = 1; while (s < n) s *= 2; return Math.max(2, s); };

/** Порядок посева в сетке: 1-й и 2-й сеянные встречаются только в финале. */
export function seedPositions(size) {
  let p = [1];
  while (p.length < size) { const m = p.length * 2 + 1; p = p.flatMap(x => [x, m - x]); }
  return p;
}

/** Сеянные игроки → расстановка по слотам первого раунда (null = свободный проход). */
export function slotsFromSeeds(seeds) {
  const size = nextPow2(seeds.length);
  return seedPositions(size).map(k => seeds[k - 1] || null);
}

export function roundName(r, rounds) {
  const left = rounds - r;
  if (left === 1) return 'Финал';
  if (left === 2) return '1/2 финала';
  if (left === 3) return '1/4 финала';
  if (left === 4) return '1/8 финала';
  return `Раунд ${r + 1}`;
}

const samePair = (m, a, b) => (m.player1_id === a && m.player2_id === b) || (m.player1_id === b && m.player2_id === a);
const done = m => m && m.status === 'approved' && m.winner_id;

/** Состояние сетки на выбывание по слотам первого раунда и сыгранным матчам. */
export function koBracket(slots, matches, thirdPlace) {
  const size = slots.length;
  const rounds = Math.log2(size);
  const res = [];
  for (let r = 0; r < rounds; r++) {
    const row = [];
    const n = size / 2 ** (r + 1);
    for (let i = 0; i < n; i++) {
      const a = r === 0 ? slots[2 * i] : res[r - 1][2 * i].winner;
      const b = r === 0 ? slots[2 * i + 1] : res[r - 1][2 * i + 1].winner;
      const aBye = r === 0 ? !slots[2 * i] : res[r - 1][2 * i].empty;
      const bBye = r === 0 ? !slots[2 * i + 1] : res[r - 1][2 * i + 1].empty;
      const cell = { r, i, a, b, match: null, winner: null, loser: null, bye: false, empty: false, conflict: null };
      const m = matches.find(x => x.stage === 'ko' && x.round === r && x.slot === i);
      if (aBye && bBye) cell.empty = true;
      else if (a && bBye) { cell.winner = a; cell.bye = true; }
      else if (b && aBye) { cell.winner = b; cell.bye = true; }
      else if (m) {
        if (a && b && samePair(m, a, b)) {
          cell.match = m;
          if (done(m)) { cell.winner = m.winner_id; cell.loser = m.winner_id === a ? b : a; }
        } else cell.conflict = m;
      }
      row.push(cell);
    }
    res.push(row);
  }
  let third = null;
  if (thirdPlace && rounds >= 2) {
    const semis = res[rounds - 2];
    const a = semis[0].loser, b = semis[1].loser;
    third = { a, b, match: null, winner: null, loser: null, r: 'third' };
    const m = matches.find(x => x.stage === 'ko3');
    if (m && a && b && samePair(m, a, b)) {
      third.match = m;
      if (done(m)) { third.winner = m.winner_id; third.loser = m.winner_id === a ? b : a; }
    } else if (m) third.conflict = m;
  }
  const fin = res[rounds - 1][0];
  return { rounds: res, third, champion: fin.winner, finalist: fin.loser, size };
}

export function koPlacings(br) {
  if (!br.champion) return null;
  const bronze = [];
  if (br.third && br.third.winner) bronze.push(br.third.winner);
  else if (br.rounds.length >= 2) br.rounds[br.rounds.length - 2].forEach(c => c.loser && bronze.push(c.loser));
  return { gold: br.champion, silver: br.finalist, bronze };
}

export function pairings(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}

/** Стадия дополнительных матчей для ничьей: круг — 'rrtb', группы — 'grptb'. */
export const tieStageOf = stage => (stage === 'rr' ? 'rrtb' : stage === 'grp' ? 'grptb' : null);

/**
 * Таблица кругового турнира/группы. Очки как в ITTF: победа 2, поражение 1.
 *
 * Без opts — простая таблица (при равенстве: очная встреча двоих, потом партии и очки).
 * С opts.matter — честное определение мест:
 *   • сначала считаем победы; ничья у мест выше matter (призовые места / выход из группы) должна быть решена;
 *   • ничья решается очными встречами внутри ничьей (у двоих — их матч), а если они не дали ответа
 *     (например, круг «A обыграл B, B — C, C — A») или включён режим «всегда доигрывать» — дополнительными матчами
 *     (opts.tbStage, round = номер круга) между теми, кто остался на равных; их повторяют, пока не определится порядок;
 *   • пока ничья не решена, игроки получают одно место на всех (rank), а в ties лежит, что нужно доиграть;
 *   • ничья ниже matter на призы не влияет — порядок по партиям и очкам, доигрывать не нужно.
 * matches — все матчи таблицы: основные и дополнительные (по stage).
 */
export function standings(ids, matches, opts = {}) {
  const { tbStage = null, matter = 0, strict = false } = opts;
  const isTb = m => tbStage && m.stage === tbStage;
  const mainMs = matches.filter(m => !isTb(m)), tbMs = matches.filter(isTb);
  const row = new Map(ids.map(id => [id, { id, p: 0, w: 0, l: 0, sw: 0, sl: 0, pw: 0, pl: 0, pts: 0 }]));
  const played = mainMs.filter(m => done(m) && row.has(m.player1_id) && row.has(m.player2_id));
  for (const m of played) {
    const A = row.get(m.player1_id), B = row.get(m.player2_id);
    A.p++; B.p++;
    A.sw += m.sets1 || 0; A.sl += m.sets2 || 0; B.sw += m.sets2 || 0; B.sl += m.sets1 || 0;
    for (const [x, y] of m.sets || []) { A.pw += +x; A.pl += +y; B.pw += +y; B.pl += +x; }
    if (m.winner_id === m.player1_id) { A.w++; B.l++; A.pts += 2; B.pts += 1; }
    else { B.w++; A.l++; B.pts += 2; A.pts += 1; }
  }
  const h2h = (a, b) => {
    const m = played.find(x => samePair(x, a, b));
    return m ? (m.winner_id === a ? -1 : 1) : 0;
  };
  const list = [...row.values()];
  list.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const tied = list.filter(x => x.pts === a.pts);
    if (tied.length === 2) { const h = h2h(a.id, b.id); if (h) return h; }
    const ra = a.sw / (a.sl || 0.5), rb = b.sw / (b.sl || 0.5);
    if (rb !== ra) return rb - ra;
    return (b.pw - b.pl) - (a.pw - a.pl);
  });
  const total = ids.length * (ids.length - 1) / 2;
  const complete = played.length >= total;
  const res = { list, complete, played: played.length, total, ties: [], tbRounds: [], resolved: true };
  list.forEach((r, i) => { r.rank = i + 1; r.tie = false; });
  if (!matter || !complete) return res;

  // ── честные места: кластеры по числу побед
  const tbDone = tbMs.filter(done);
  const winsIn = (group, ms) => {
    const w = new Map(group.map(id => [id, 0]));
    for (const m of ms) if (w.has(m.player1_id) && w.has(m.player2_id)) w.set(m.winner_id, (w.get(m.winner_id) || 0) + 1);
    return w;
  };
  const splitByWins = (group, w) => {
    const keys = [...new Set(group.map(id => w.get(id)))].sort((a, b) => b - a);
    return keys.map(k => group.filter(id => w.get(id) === k));
  };
  // доп. круги между теми, кто остался на равных; возвращает упорядоченные группы {ids, open}
  const extra = (group, round) => {
    const pairs = pairings(group).map(([a, b]) => ({ a, b, match: tbMs.find(m => m.round === round && samePair(m, a, b)) || null }));
    res.tbRounds.push({ ids: group, round, pairs });
    if (pairs.some(x => !(x.match && done(x.match)))) return [{ ids: group, open: true, round, need: pairs.filter(x => !(x.match && done(x.match))).map(x => [x.a, x.b]) }];
    const w = winsIn(group, tbDone.filter(m => m.round === round));
    return splitByWins(group, w).flatMap(g => (g.length === 1 ? [{ ids: g, open: false }] : extra(g, round + 1)));
  };
  const resolveCluster = ids2 => {
    if (!strict) {
      const w = winsIn(ids2, played);
      return splitByWins(ids2, w).flatMap(g => (g.length === 1 ? [{ ids: g, open: false }] : extra(g, 1)));
    }
    return extra(ids2, 1);
  };
  const byId = new Map(list.map(r => [r.id, r]));
  const clusters = [];
  for (const r of list) { const last = clusters[clusters.length - 1]; if (last && byId.get(last[0]).w === r.w) last.push(r.id); else clusters.push([r.id]); }
  const out = []; let pos = 1;
  for (const cl of clusters) {
    if (cl.length === 1 || pos > matter) cl.forEach((id, k) => out.push({ id, rank: pos + k, tie: false }));
    else for (const g of resolveCluster(cl)) {
      if (g.open) { g.ids.forEach(id => out.push({ id, rank: pos, tie: true })); res.ties.push({ ids: g.ids, from: pos, to: pos + g.ids.length - 1, round: g.round, need: g.need, wins: byId.get(g.ids[0]).w }); }
      else out.push({ id: g.ids[0], rank: pos, tie: false });
      pos += g.ids.length;
      continue;
    }
    pos = out.length + 1;
  }
  const order = new Map(out.map((o, i) => [o.id, i]));
  list.sort((a, b) => order.get(a.id) - order.get(b.id));
  out.forEach(o => { const r = byId.get(o.id); r.rank = o.rank; r.tie = o.tie; });
  res.resolved = !res.ties.length;
  return res;
}

/** Распределение по группам «змейкой» по рейтингу. */
export function snakeGroups(sortedIds, g) {
  const groups = Array.from({ length: g }, () => []);
  sortedIds.forEach((id, k) => {
    const row = Math.floor(k / g), col = k % g;
    groups[row % 2 ? g - 1 - col : col].push(id);
  });
  return groups;
}

/**
 * Сетка плей-офф из итогов групп.
 * Места «весят» одинаково: сначала все первые места (сильнейшие — выше), потом вторые и так далее. Внутри одного места игроков
 * переставляем так, чтобы одногруппники встретились как можно позже: в первом раунде — никогда (если это возможно),
 * лучше всего — только в финале. Сильные получают свободные проходы, если слотов больше, чем игроков.
 * strength — необязательная карта id → сила (больше = сильнее) для порядка внутри одного места.
 */
export function playoffSlots(groupTables, advance, strength = null) {
  const G = groupTables.length;
  if (G === 1) return slotsFromSeeds(groupTables[0].slice(0, Math.max(2, advance)));
  const tiers = [];
  for (let place = 0; place < advance; place++) {
    const tier = groupTables.map((t, g) => t[place] ? { id: t[place], g } : null).filter(Boolean);
    if (strength) tier.sort((a, b) => (strength.get(b.id) ?? 0) - (strength.get(a.id) ?? 0) || a.g - b.g);
    tiers.push(tier);
  }
  const seeds = tiers.flat();
  const size = nextPow2(seeds.length), pos = seedPositions(size), R = Math.log2(size);
  const slots = Array(size).fill(null);
  pos.forEach((sd, i) => { slots[i] = seeds[sd - 1] || null; });   // как в slotsFromSeeds: слот i занимает сеяный pos[i]
  const penalty = () => {
    let sum = 0;
    for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) {
      if (!slots[a] || !slots[b] || slots[a].g !== slots[b].g) continue;
      let x = a, y = b, r = 1;
      while ((x >> 1) !== (y >> 1)) { x >>= 1; y >>= 1; r++; }
      sum += 4 ** (R - r);
    }
    return sum;
  };
  const tierOf = new Map(); tiers.forEach((t, k) => t.forEach(x => tierOf.set(x, k)));
  let best = penalty();
  for (let pass = 0; pass < 40 && best > 0; pass++) {
    let improved = false;
    for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) {
      if (!slots[a] || !slots[b] || tierOf.get(slots[a]) !== tierOf.get(slots[b])) continue;
      [slots[a], slots[b]] = [slots[b], slots[a]];
      const pen = penalty();
      if (pen < best) { best = pen; improved = true; } else [slots[a], slots[b]] = [slots[b], slots[a]];
    }
    if (!improved) break;
  }
  return slots.map(x => (x ? x.id : null));
}

/** Матч кругового этапа (или группы) между двумя игроками. */
export function findPairMatch(matches, stage, a, b, grp = null) {
  return matches.find(m => m.stage === stage && (grp === null || m.grp === grp) && samePair(m, a, b));
}
