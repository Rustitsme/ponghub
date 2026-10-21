-- PongHub — миграция 26: пауза в игре, стоп-кадр табло, номер стола, задания недели.
-- • live_matches.paused_until — «пауза в игре» (во время матча): табло показывает таймер и сетку, очки не добавляются.
-- • live_matches.table_no — стол, за которым идёт игра (быстрый старт по QR на столе).
-- • club_screens.frozen_until — «стоп-кадр»: табло замирает на текущей картинке до этого времени (или пока не снимут).
-- • Задания недели: 4 задания с понедельника, прогресс по подтверждённым матчам клуба, награда — пинг-коины (проверяет сервер).
-- Скрипт можно запускать повторно.

alter table public.live_matches add column if not exists paused_until timestamptz;
alter table public.live_matches add column if not exists table_no int;
alter table public.club_screens add column if not exists frozen_until timestamptz;

-- стоп-кадр: включает/снимает владелец клуба (minutes = 0 — снять)
create or replace function public.screen_freeze(cid uuid, minutes int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare until timestamptz := case when minutes > 0 then now() + make_interval(mins => least(minutes, 180)) else null end;
begin
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  update club_screens set frozen_until = until where club_id = cid;
  return until;
end $$;
grant execute on function public.screen_freeze(uuid, int) to authenticated;

-- табло спрашивает свои флаги отдельно (лёгкий запрос каждые 2 секунды)
create or replace function public.screen_flags(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('frozen_until', frozen_until, 'now', now()) from club_screens where token = p_token;
$$;
revoke all on function public.screen_flags(text) from public;
grant execute on function public.screen_flags(text) to anon, authenticated;

-- ── задания недели ──
alter table public.coin_tx drop constraint if exists coin_tx_kind_check;
alter table public.coin_tx add constraint coin_tx_kind_check
  check (kind in ('start', 'weekly', 'daily', 'bet', 'payout', 'refund', 'adjust', 'shop', 'streak', 'match', 'prize', 'convert', 'sell', 'task'));

create table if not exists public.task_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  week date not null,
  task text not null,
  amount int not null,
  created_at timestamptz not null default now(),
  primary key (user_id, club_id, week, task)
);
alter table public.task_claims enable row level security;
drop policy if exists task_claims_select on public.task_claims;
create policy task_claims_select on public.task_claims for select using (user_id = auth.uid());

-- прогресс по заданиям этой недели (понедельник по Москве)
create or replace function public.weekly_tasks(cid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); wk date := date_trunc('week', public.moscow_today())::date;
  opps uuid[] := '{}'; games int := 0; clean int := 0; best int := 0; run int := 0; m record; o uuid; won boolean;
begin
  if me is null or not public.is_member(cid) then raise exception 'not allowed'; end if;
  for m in select * from matches x
    where x.club_id = cid and x.status = 'approved' and not x.is_test and coalesce(x.kind, 'singles') = 'singles'
      and me in (x.player1_id, x.player2_id) and (x.played_at at time zone 'Europe/Moscow')::date >= wk
    order by x.played_at
  loop
    games := games + 1;
    o := case when m.player1_id = me then m.player2_id else m.player1_id end;
    if not o = any(opps) then opps := opps || o; end if;
    won := m.winner_id = me;
    if won and coalesce(case when m.player1_id = me then m.sets2 else m.sets1 end, 1) = 0 then clean := clean + 1; end if;
    if won then run := run + 1; best := greatest(best, run); else run := 0; end if;
  end loop;
  return jsonb_build_object('week', wk, 'tasks', jsonb_build_array(
    jsonb_build_object('key', 'opp3', 'icon', '🤝', 'title', 'Сыграй с 3 разными игроками', 'goal', 3, 'have', least(cardinality(opps), 3), 'reward', 100),
    jsonb_build_object('key', 'streak3', 'icon', '🔥', 'title', 'Выиграй 3 матча подряд', 'goal', 3, 'have', least(best, 3), 'reward', 150),
    jsonb_build_object('key', 'clean', 'icon', '💪', 'title', 'Выиграй матч всухую — не отдав ни одной партии', 'goal', 1, 'have', least(clean, 1), 'reward', 200),
    jsonb_build_object('key', 'play10', 'icon', '🏓', 'title', 'Сыграй 10 матчей за неделю', 'goal', 10, 'have', least(games, 10), 'reward', 150)),
    'claimed', coalesce((select jsonb_agg(task) from task_claims where user_id = me and club_id = cid and week = wk), '[]'));
end $$;
grant execute on function public.weekly_tasks(uuid) to authenticated;

-- забрать награду: сервер сам проверяет, что задание выполнено, и что его ещё не забирали
create or replace function public.claim_weekly_task(cid uuid, p_task text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); st jsonb; t jsonb; wk date;
begin
  if me is null or not public.feature_on('shop', me) then raise exception 'Пока недоступно'; end if;
  st := public.weekly_tasks(cid); wk := (st->>'week')::date;
  select x into t from jsonb_array_elements(st->'tasks') x where x->>'key' = p_task;
  if t is null then raise exception 'Такого задания нет'; end if;
  if (t->>'have')::int < (t->>'goal')::int then raise exception 'Задание ещё не выполнено'; end if;
  insert into task_claims (user_id, club_id, week, task, amount) values (me, cid, wk, p_task, (t->>'reward')::int);
  perform public.ensure_wallet(cid);
  insert into coin_tx (club_id, user_id, amount, kind) values (cid, me, (t->>'reward')::int, 'task');
  return public.coin_balance(me, cid);
exception when unique_violation then
  raise exception 'Награда за это задание уже получена';
end $$;
grant execute on function public.claim_weekly_task(uuid, text) to authenticated;

select 'M26:' || (select count(*) from information_schema.columns where (table_name = 'live_matches' and column_name in ('paused_until', 'table_no')) or (table_name = 'club_screens' and column_name = 'frozen_until'))::text as r;
