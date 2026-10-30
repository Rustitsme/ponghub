// Проверки логики турниров. Запуск: node tests/tourney.test.mjs
import assert from 'node:assert/strict';
import { standings, pairings, playoffSlots, koBracket, slotsFromSeeds } from '../js/tourney.js';

const mk = (a, b, w, extra = {}) => ({ id: Math.random().toString(36), status: 'approved', winner_id: w, player1_id: a, player2_id: b, sets1: w === a ? 3 : 1, sets2: w === a ? 1 : 3, sets: [], ...extra });
const O = { tbStage: 'rrtb', matter: 3 };

// круг «A > B > C > A»: у всех по победе, очная встреча ничего не решает → нужны доп. матчи между тремя
let ms = [mk('A', 'B', 'A', { stage: 'rr' }), mk('B', 'C', 'B', { stage: 'rr' }), mk('A', 'C', 'C', { stage: 'rr' })];
let r = standings(['A', 'B', 'C'], ms, O);
assert.equal(r.resolved, false);
assert.equal(r.ties.length, 1);
assert.equal(r.ties[0].need.length, 3);
assert.deepEqual(r.list.map(x => x.rank), [1, 1, 1]);
// дополнительный круг определяет порядок
ms.push(mk('A', 'B', 'A', { stage: 'rrtb', round: 1 }), mk('B', 'C', 'B', { stage: 'rrtb', round: 1 }), mk('A', 'C', 'A', { stage: 'rrtb', round: 1 }));
r = standings(['A', 'B', 'C'], ms, O);
assert.equal(r.resolved, true);
assert.deepEqual(r.list.map(x => x.id), ['A', 'B', 'C']);

// двое на равных: решает очная встреча, доигрывать не нужно (если режим не «всегда доигрывать»)
ms = [mk('A', 'B', 'A', { stage: 'rr' }), mk('A', 'C', 'C', { stage: 'rr' }), mk('B', 'C', 'B', { stage: 'rr' }), mk('A', 'D', 'A', { stage: 'rr' }), mk('B', 'D', 'B', { stage: 'rr' }), mk('C', 'D', 'C', { stage: 'rr' })];
// A: B,D (2 победы); B: C,D (2); C: A,D (2); D: 0 — круг на троих
r = standings(['A', 'B', 'C', 'D'], ms, O);
assert.equal(r.resolved, false);
const two = [mk('A', 'B', 'A', { stage: 'rr' })];
r = standings(['A', 'B'], two, { tbStage: 'rrtb', matter: 3 });
assert.equal(r.resolved, true);

// ничья ниже призовых мест не требует доигрывания
const ids5 = ['a', 'b', 'c', 'd', 'e'];
ms = pairings(ids5).map(([x, y]) => mk(x, y, ids5.indexOf(x) < ids5.indexOf(y) ? x : y, { stage: 'rr' }));
r = standings(ids5, ms, O);
assert.equal(r.resolved, true);

// плей-офф из групп: одногруппники не встречаются в 1-м раунде, а при двух выходящих — только в финале
const L = 'ABCDEFGH';
const meet = (slots, a, b) => { let x = slots.indexOf(a), y = slots.indexOf(b), r1 = 1; while ((x >> 1) !== (y >> 1)) { x >>= 1; y >>= 1; r1++; } return r1; };
for (const [G, K] of [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [8, 2], [2, 1], [4, 1], [3, 3], [4, 3]]) {
  const tables = Array.from({ length: G }, (_, g) => Array.from({ length: K }, (_, p) => L[g] + (p + 1)));
  const slots = playoffSlots(tables, K);
  const R = Math.log2(slots.length);
  for (let g = 0; g < G; g++) for (let p = 1; p <= K; p++) for (let q = p + 1; q <= K; q++) {
    const m = meet(slots, L[g] + p, L[g] + q);
    assert.notEqual(m, 1, `G=${G} K=${K}: ${L[g]}${p} и ${L[g]}${q} играют в 1-м раунде`);
    if (K === 2) assert.equal(m, R, `G=${G} K=2: одногруппники ${L[g]} встречаются раньше финала`);
  }
  assert.equal(slots.filter(Boolean).length, G * K);
}

// олимпийская: на каждого числа игроков сетка доигрывается до чемпиона, сеяные 1 и 2 — в разных половинах
for (let n = 2; n <= 17; n++) {
  const sl = slotsFromSeeds(Array.from({ length: n }, (_, i) => 's' + (i + 1)));
  assert.notEqual(sl.indexOf('s1') < sl.length / 2, sl.indexOf('s2') < sl.length / 2);
  let m2 = [], guard = 0;
  for (;;) {
    const br = koBracket(sl, m2, true); if (br.champion) break;
    let any = false;
    for (const row of br.rounds) for (const c of row) if (c.a && c.b && !c.match && !c.bye) { m2.push(mk(c.a, c.b, c.a, { stage: 'ko', round: c.r, slot: c.i })); any = true; }
    if (br.third && br.third.a && br.third.b && !br.third.match) { m2.push(mk(br.third.a, br.third.b, br.third.a, { stage: 'ko3' })); any = true; }
    assert.ok(any && ++guard < 20, `n=${n}: сетка зависла`);
  }
}
console.log('турниры: все проверки прошли');

// порядок игр: каждая пара ровно один раз, никто не играет подряд, если есть кому сыграть вместо него
import { roundRobinSchedule, scheduleStatus, tournamentSchedule } from '../js/tourney.js';
for (const [sizes, T] of [[[6], 1], [[6], 2], [[4, 4], 2], [[4, 4, 3], 1], [[4, 4, 4, 4], 3], [[5, 5], 2]]) {
  const tables = sizes.map((n, g) => ({ ids: Array.from({ length: n }, (_, i) => `g${g}p${i}`), stage: sizes.length > 1 ? 'grp' : 'rr', grp: sizes.length > 1 ? g : null }));
  const sc = roundRobinSchedule(tables, T);
  const need = tables.reduce((n, g) => n + pairings(g.ids).length, 0);
  assert.equal(sc.length, need);
  assert.equal(new Set(sc.map(x => [x.a, x.b].sort().join())).size, need);
  if (sizes.every(n => n >= 5) || sizes.length > 1) {
    let back = 0; for (let i = 1; i < sc.length; i++) if ([sc[i].a, sc[i].b].some(x => [sc[i - 1].a, sc[i - 1].b].includes(x))) back++;
    assert.equal(back, 0, `${sizes} столов ${T}: игроки играют подряд`);
  }
}
{
  const t = { id: 't', format: 'groups', participants: ['a', 'b', 'c', 'd'], config: { tables: 2, groups: [['a', 'b'], ['c', 'd']], advance: 1 } };
  const st = tournamentSchedule(t, [], []);
  assert.deepEqual(st.map(x => x.status), ['next', 'next']);
  const st2 = tournamentSchedule(t, [], [{ tournament_id: 't', status: 'live', player1_id: 'a', player2_id: 'b' }]);
  assert.deepEqual(st2.map(x => x.status), ['live', 'next']);
}
console.log('порядок игр: проверки прошли');

// группы → финальный круг: победители групп сразу в финале, вторые места играют круг за последнюю путёвку
import { circleFinal, circleSpots } from '../js/tourney.js';
{
  const grp = (a, b, w, g) => mk(a, b, w, { stage: 'grp', grp: g });
  const t = { id: 't', format: 'groups', participants: [], config: { tables: 2, advance: 2, finalMode: 'circle', finalSize: 4, groups: [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']] } };
  assert.equal(circleSpots(t), 1);
  let ms = [];
  for (const [g, L] of [[0, 'a'], [1, 'b'], [2, 'c']]) ms.push(grp(`${L}1`, `${L}2`, `${L}1`, g), grp(`${L}1`, `${L}3`, `${L}1`, g), grp(`${L}2`, `${L}3`, `${L}2`, g));
  let cf = circleFinal(t, ms);
  assert.equal(cf.ready, true);
  assert.deepEqual([...cf.winners].sort(), ['a1', 'b1', 'c1']);
  assert.deepEqual([...cf.pool].sort(), ['a2', 'b2', 'c2']);
  assert.equal(cf.finalists, null);                 // путёвка ещё не разыграна
  ms.push(mk('a2', 'b2', 'a2', { stage: 'qual' }), mk('a2', 'c2', 'c2', { stage: 'qual' }), mk('b2', 'c2', 'c2', { stage: 'qual' }));
  cf = circleFinal(t, ms);
  assert.deepEqual([...cf.finalists].sort(), ['a1', 'b1', 'c1', 'c2']);   // c2 выиграл оба матча
  // в финальном круге победитель определяется как в круге
  const fin = pairings(cf.finalists).map(([x, y]) => mk(x, y, x < y ? x : y, { stage: 'fin' }));
  const st = standings(cf.finalists, fin, { tbStage: 'fintb', matter: 3 });
  assert.equal(st.complete, true);
  const tb = tournamentSchedule(t, ms.concat(fin), []);
  assert.ok(tb.every(x => x.status === 'done'));
  // круг трёх вторых мест: ничья по победам требует дополнительных матчей
  const tie = [grp('a1', 'a2', 'a1', 0), grp('a1', 'a3', 'a1', 0), grp('a2', 'a3', 'a2', 0)];
  const t2 = { ...t, config: { ...t.config, groups: [['a1', 'a2', 'a3']], finalSize: 2 } };
  assert.equal(circleFinal(t2, tie).ready, true);
}
console.log('финальный круг: проверки прошли');

// финал «полуфиналы и финал» после борьбы за путёвку: сетка из 4 финалистов, 4 матча
import { finalSeeds } from '../js/tourney.js';
{
  const grp = (a, b, w, g) => mk(a, b, w, { stage: 'grp', grp: g });
  const t = { id: 't', format: 'groups', participants: [], config: { tables: 2, advance: 2, thirdPlace: true, finalMode: 'circle', finalType: 'ko', finalSize: 4, groups: [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']] } };
  let ms = [];
  for (const [g, L] of [[0, 'a'], [1, 'b'], [2, 'c']]) ms.push(grp(`${L}1`, `${L}2`, `${L}1`, g), grp(`${L}1`, `${L}3`, `${L}1`, g), grp(`${L}2`, `${L}3`, `${L}2`, g));
  ms.push(mk('a2', 'b2', 'a2', { stage: 'qual' }), mk('a2', 'c2', 'a2', { stage: 'qual' }), mk('b2', 'c2', 'b2', { stage: 'qual' }));
  const cf = circleFinal(t, ms);
  const seeds = finalSeeds(cf);
  assert.equal(seeds.length, 4);
  assert.equal(seeds[3], 'a2');                       // прошедший по борьбе за путёвку — последний сеяный
  const slots = slotsFromSeeds(seeds);                // 1-й с 4-м, 2-й с 3-м
  assert.equal(slots[1], 'a2');
  const t2 = { ...t, config: { ...t.config, slots } };
  const sched = tournamentSchedule(t2, ms, []);
  assert.deepEqual(sched.filter(x => x.status !== 'done').map(x => x.note), ['1/2 финала', '1/2 финала']);
  // сыграли: 2 полуфинала + финал + матч за 3-е = 4 матча
  let m2 = [...ms];
  for (let k = 0; k < 6; k++) {
    const br = koBracket(slots, m2.filter(m => m.stage === 'ko' || m.stage === 'ko3'), true);
    if (br.champion) break;
    for (const row of br.rounds) for (const c of row) if (c.a && c.b && !c.match && !c.bye) m2.push(mk(c.a, c.b, c.a, { stage: 'ko', round: c.r, slot: c.i }));
    if (br.third && br.third.a && br.third.b && !br.third.match) m2.push(mk(br.third.a, br.third.b, br.third.a, { stage: 'ko3' }));
  }
  assert.equal(m2.filter(m => m.stage === 'ko' || m.stage === 'ko3').length, 4);
}
console.log('финал на выбывание: проверки прошли');
