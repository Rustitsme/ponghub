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

/** Таблица кругового турнира/группы. Очки как в ITTF: победа 2, поражение 1. */
export function standings(ids, matches) {
  const row = new Map(ids.map(id => [id, { id, p: 0, w: 0, l: 0, sw: 0, sl: 0, pw: 0, pl: 0, pts: 0 }]));
  const played = matches.filter(m => done(m) && row.has(m.player1_id) && row.has(m.player2_id));
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
  return { list, complete: played.length >= total, played: played.length, total };
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

/** Сетка плей-офф из итогов групп. Первые места встречаются со вторыми из других групп. */
export function playoffSlots(groupTables, advance) {
  const G = groupTables.length;
  const isPow2 = G >= 1 && (G & (G - 1)) === 0;
  if (advance === 2 && isPow2) {
    const pairs = groupTables.map((t, g) => [t[0], groupTables[(g + 1) % G][1]]);
    if (G === 1) return [groupTables[0][0], groupTables[0][1]];
    const order = seedPositions(G);
    return order.flatMap(k => pairs[k - 1]);
  }
  const seeds = [];
  for (let place = 0; place < advance; place++) for (const t of groupTables) if (t[place]) seeds.push(t[place]);
  return slotsFromSeeds(seeds);
}

/** Матч кругового этапа (или группы) между двумя игроками. */
export function findPairMatch(matches, stage, a, b, grp = null) {
  return matches.find(m => m.stage === stage && (grp === null || m.grp === grp) && samePair(m, a, b));
}
