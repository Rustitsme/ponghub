-- PongHub — миграция 8: прогнозы на матчи за внутренние баллы («пинг-коины», PC).
-- Баллы не покупаются и не влияют на рейтинг. Баланс, приём ставок и выплаты — только на сервере.

-- ───────────── Таблицы ─────────────
create table if not exists public.coin_tx (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount int not null,
  kind text not null check (kind in ('start', 'weekly', 'daily', 'bet', 'payout', 'refund', 'adjust')),
  ref uuid,
  created_at timestamptz not null default now()
);
create index if not exists coin_tx_user_idx on public.coin_tx (user_id);
alter table public.coin_tx enable row level security;
drop policy if exists coin_tx_select on public.coin_tx;
create policy coin_tx_select on public.coin_tx for select using (user_id = auth.uid() or public.is_admin());

create table if not exists public.pred_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('live', 'challenge')),
  source_id uuid not null unique,
  kind text not null default 'singles',
  player1_id uuid not null references public.profiles(id) on delete cascade,
  player2_id uuid not null references public.profiles(id) on delete cascade,
  player3_id uuid references public.profiles(id) on delete cascade,
  player4_id uuid references public.profiles(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  chance1 numeric not null,
  odds1 numeric not null,
  odds2 numeric not null,
  status text not null default 'open' check (status in ('open', 'closed', 'settled', 'cancelled')),
  winner_side int,
  match_id uuid references public.matches(id) on delete set null,
  bets_count int not null default 0,
  pool1 int not null default 0,
  pool2 int not null default 0,
  is_test boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.pred_events enable row level security;
drop policy if exists pred_events_select on public.pred_events;
create policy pred_events_select on public.pred_events for select using (public.is_approved() and (not is_test or public.is_admin()));

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pred_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  side int not null check (side in (1, 2)),
  stake int not null check (stake > 0),
  odds numeric not null,
  payout int,
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'refunded')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (event_id, user_id)
);
alter table public.predictions enable row level security;
drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions for select using (user_id = auth.uid() or public.is_admin());

-- ───────────── Настройки (из settings.data, с значениями по умолчанию) ─────────────
create or replace function public.pred_setting(k text, def int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (data->>k)::numeric::int from settings where id = 1), def);
$$;

create or replace function public.coin_balance(uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from coin_tx where user_id = uid;
$$;

-- Стартовый баланс выдаётся при первом обращении
create or replace function public.ensure_wallet() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then return 0; end if;
  if not exists (select 1 from coin_tx where user_id = auth.uid()) then
    insert into coin_tx (user_id, amount, kind) values (auth.uid(), public.pred_setting('predStart', 1000), 'start');
  end if;
  return public.coin_balance(auth.uid());
end $$;
grant execute on function public.ensure_wallet() to authenticated;

-- ───────────── Открыть прогноз (из живого матча или принятого вызова) ─────────────
create or replace function public.create_pred_event(src text, src_id uuid, chance numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  eid uuid; c numeric := least(0.95, greatest(0.05, chance));
  l live_matches; ch challenges;
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  if coalesce((select (data->>'predEnabled')::boolean from settings where id = 1), true) = false then return null; end if;
  select id into eid from pred_events where source_id = src_id;
  if eid is not null then return eid; end if;
  if src = 'live' then
    select * into l from live_matches where id = src_id and status = 'live';
    if not found or jsonb_array_length(l.log) > 0 then return null; end if;
    insert into pred_events (source, source_id, kind, player1_id, player2_id, player3_id, player4_id, tournament_id, chance1, odds1, odds2, is_test, created_by)
    values ('live', src_id, l.kind, l.player1_id, l.player2_id, l.player3_id, l.player4_id, l.tournament_id, c,
            least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), l.is_test, auth.uid())
    returning id into eid;
  elsif src = 'challenge' then
    select * into ch from challenges where id = src_id and status = 'accepted';
    if not found then return null; end if;
    insert into pred_events (source, source_id, player1_id, player2_id, chance1, odds1, odds2, is_test, created_by)
    values ('challenge', src_id, ch.from_id, ch.to_id, c, least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), ch.is_test, auth.uid())
    returning id into eid;
  end if;
  return eid;
end $$;
grant execute on function public.create_pred_event(text, uuid, numeric) to authenticated;

-- ───────────── Сделать прогноз ─────────────
create or replace function public.place_prediction(eid uuid, pick int, amount int) returns int
language plpgsql security definer set search_path = public as $$
declare e pred_events; l live_matches; bal int;
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  select * into e from pred_events where id = eid for update;
  if not found or e.status <> 'open' then raise exception 'Приём прогнозов закрыт'; end if;
  if e.is_test and not public.is_admin() then raise exception 'not allowed'; end if;
  if auth.uid() in (e.player1_id, e.player2_id, coalesce(e.player3_id, e.player1_id), coalesce(e.player4_id, e.player1_id)) then
    raise exception 'На свой матч прогноз сделать нельзя';
  end if;
  if e.source = 'live' then
    select * into l from live_matches where id = e.source_id;
    if not found or l.status <> 'live' or jsonb_array_length(l.log) > 0 then
      update pred_events set status = 'closed' where id = eid and status = 'open';
      raise exception 'Игра уже началась — приём прогнозов закрыт';
    end if;
  end if;
  if pick not in (1, 2) then raise exception 'Выберите победителя'; end if;
  if amount < public.pred_setting('predMin', 10) or amount > public.pred_setting('predMax', 500) then
    raise exception 'Ставка от % до % PC', public.pred_setting('predMin', 10), public.pred_setting('predMax', 500);
  end if;
  perform public.ensure_wallet();
  bal := public.coin_balance(auth.uid());
  if bal < amount then raise exception 'Недостаточно пинг-коинов (у вас %)', bal; end if;
  insert into predictions (event_id, user_id, side, stake, odds)
  values (eid, auth.uid(), pick, amount, case when pick = 1 then e.odds1 else e.odds2 end);
  insert into coin_tx (user_id, amount, kind, ref) values (auth.uid(), -amount, 'bet', eid);
  update pred_events set bets_count = bets_count + 1,
    pool1 = pool1 + case when pick = 1 then amount else 0 end,
    pool2 = pool2 + case when pick = 2 then amount else 0 end
  where id = eid;
  return bal - amount;
exception when unique_violation then
  raise exception 'Вы уже сделали прогноз на этот матч';
end $$;
grant execute on function public.place_prediction(uuid, int, int) to authenticated;

-- ───────────── Расчёт и возврат ─────────────
create or replace function public.settle_pred_event(eid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e pred_events; m matches; side int; p predictions;
begin
  select * into e from pred_events where id = eid for update;
  if not found or e.status in ('settled', 'cancelled') or e.match_id is null then return; end if;
  select * into m from matches where id = e.match_id;
  if not found or m.status <> 'approved' then return; end if;
  side := case when m.winner_id in (e.player1_id, coalesce(e.player3_id, e.player1_id)) then 1 else 2 end;
  for p in select * from predictions where event_id = eid and status = 'open' loop
    if p.side = side then
      update predictions set status = 'won', payout = round(p.stake * p.odds), settled_at = now() where id = p.id;
      insert into coin_tx (user_id, amount, kind, ref) values (p.user_id, round(p.stake * p.odds)::int, 'payout', eid);
    else
      update predictions set status = 'lost', payout = 0, settled_at = now() where id = p.id;
    end if;
  end loop;
  update pred_events set status = 'settled', winner_side = side, settled_at = now() where id = eid;
end $$;

create or replace function public.cancel_pred_event(eid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p predictions;
begin
  for p in select * from predictions where event_id = eid and status = 'open' loop
    update predictions set status = 'refunded', payout = p.stake, settled_at = now() where id = p.id;
    insert into coin_tx (user_id, amount, kind, ref) values (p.user_id, p.stake, 'refund', eid);
  end loop;
  update pred_events set status = 'cancelled', settled_at = now() where id = eid and status in ('open', 'closed');
end $$;

-- Живой матч: первое очко закрывает приём; сохранение — привязка к матчу; отмена — возврат
create or replace function public.pred_on_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  select id into eid from pred_events where source = 'live' and source_id = new.id;
  if eid is null then return new; end if;
  if new.status = 'cancelled' then perform public.cancel_pred_event(eid);
  elsif new.match_id is not null then
    update pred_events set match_id = new.match_id, status = case when status = 'open' then 'closed' else status end where id = eid;
    perform public.settle_pred_event(eid);
  elsif jsonb_array_length(new.log) > 0 then
    update pred_events set status = 'closed' where id = eid and status = 'open';
  end if;
  return new;
end $$;
drop trigger if exists live_pred on public.live_matches;
create trigger live_pred after update on public.live_matches for each row execute function public.pred_on_live();

-- Вызов: матч внесён — привязка; отменён/отклонён — возврат
create or replace function public.pred_on_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  select id into eid from pred_events where source = 'challenge' and source_id = new.id;
  if eid is null then return new; end if;
  if new.status in ('cancelled', 'declined') then perform public.cancel_pred_event(eid);
  elsif new.match_id is not null then
    update pred_events set match_id = new.match_id, status = case when status = 'open' then 'closed' else status end where id = eid;
    perform public.settle_pred_event(eid);
  end if;
  return new;
end $$;
drop trigger if exists challenge_pred on public.challenges;
create trigger challenge_pred after update on public.challenges for each row execute function public.pred_on_challenge();

-- Матч подтверждён — расчёт; удалён — возврат
create or replace function public.pred_on_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if tg_op = 'DELETE' then
    for eid in select id from pred_events where match_id = old.id and status <> 'settled' loop perform public.cancel_pred_event(eid); end loop;
    return old;
  end if;
  if new.status = 'approved' then
    for eid in select id from pred_events where match_id = new.id loop perform public.settle_pred_event(eid); end loop;
  end if;
  return new;
end $$;
drop trigger if exists match_pred on public.matches;
create trigger match_pred after update or delete on public.matches for each row execute function public.pred_on_match();

-- ───────────── Таблица прогнозистов ─────────────
create or replace function public.coin_leaderboard(since timestamptz default null)
returns table (user_id uuid, balance int, profit int, bets int, wins int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_approved() then return; end if;
  return query
    select p.id,
      coalesce((select sum(amount) from coin_tx t where t.user_id = p.id), 0)::int,
      coalesce((select sum(amount) from coin_tx t where t.user_id = p.id and t.kind in ('bet', 'payout', 'refund') and (since is null or t.created_at >= since)), 0)::int,
      (select count(*) from predictions r where r.user_id = p.id and r.status in ('won', 'lost') and (since is null or r.created_at >= since))::int,
      (select count(*) from predictions r where r.user_id = p.id and r.status = 'won' and (since is null or r.created_at >= since))::int
    from profiles p
    where p.status = 'approved' and (not p.is_test or public.is_admin())
      and exists (select 1 from coin_tx t where t.user_id = p.id);
end $$;
grant execute on function public.coin_leaderboard(timestamptz) to authenticated;

-- ───────────── Бонусы по расписанию ─────────────
create or replace function public.coin_bonuses(what text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if what = 'weekly' then
    insert into coin_tx (user_id, amount, kind)
      select p.id, public.pred_setting('predWeekly', 100), 'weekly' from profiles p
      where p.status = 'approved' and not p.is_test and exists (select 1 from coin_tx t where t.user_id = p.id);
  elsif what = 'daily' then
    insert into coin_tx (user_id, amount, kind)
      select p.id, public.pred_setting('predDaily', 50), 'daily' from profiles p
      where p.status = 'approved' and not p.is_test and exists (select 1 from coin_tx t where t.user_id = p.id)
        and public.coin_balance(p.id) <= 0;
  end if;
end $$;
revoke all on function public.coin_bonuses(text) from public, anon, authenticated;
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname in ('ponghub-coins-weekly', 'ponghub-coins-daily') loop perform cron.unschedule(j.jobname); end loop;
end $$;
select cron.schedule('ponghub-coins-weekly', '0 6 * * 1', $$select public.coin_bonuses('weekly')$$);
select cron.schedule('ponghub-coins-daily', '0 5 * * *', $$select public.coin_bonuses('daily')$$);

-- ───────────── Уведомления и живые обновления ─────────────
drop trigger if exists pred_events_notify on public.pred_events;
create trigger pred_events_notify after insert on public.pred_events for each row execute function public.notify_change();
drop trigger if exists predictions_notify on public.predictions;
create trigger predictions_notify after update on public.predictions for each row execute function public.notify_change();
do $$
declare t text;
begin
  foreach t in array array['pred_events', 'predictions', 'coin_tx'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ───────────── Очистка тестового — вместе с прогнозами на тестовые матчи ─────────────
create or replace function public.admin_purge_test() returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; evs uuid[];
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select coalesce(array_agg(id), '{}') into ids from profiles where is_test;
  select coalesce(array_agg(id), '{}') into evs from pred_events
    where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from coin_tx where ref = any(evs) or user_id = any(ids);
  delete from pred_events where id = any(evs);
  delete from live_matches where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from challenges where is_test or from_id = any(ids) or to_id = any(ids);
  delete from matches where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from tournaments where is_test;
  delete from announcements where is_test;
  delete from profiles where is_test;
  delete from audit_log where coalesce((new_data->>'is_test')::boolean, false) or coalesce((old_data->>'is_test')::boolean, false)
    or new_data->>'player1_id' = any(ids::text[]) or old_data->>'player1_id' = any(ids::text[])
    or new_data->>'player2_id' = any(ids::text[]) or old_data->>'player2_id' = any(ids::text[])
    or record_id = any(ids::text[]);
end $$;
