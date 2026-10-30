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
