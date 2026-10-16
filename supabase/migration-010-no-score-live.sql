-- PongHub — миграция 10: «Игра началась — счёт в конце».
-- Живая игра без ведения счёта: всем видно, что идёт игра, прогнозы принимаются первые N минут,
-- итоговый счёт вносят после игры.

alter table public.live_matches add column if not exists scoring boolean not null default true;
alter table public.pred_events add column if not exists closes_at timestamptz;

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
    insert into pred_events (source, source_id, kind, player1_id, player2_id, player3_id, player4_id, tournament_id, chance1, odds1, odds2, is_test, created_by, closes_at)
    values ('live', src_id, l.kind, l.player1_id, l.player2_id, l.player3_id, l.player4_id, l.tournament_id, c,
            least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), l.is_test, auth.uid(),
            case when l.scoring then null else now() + make_interval(mins => public.pred_setting('predWindowMin', 3)) end)
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

create or replace function public.place_prediction(eid uuid, pick int, amount int) returns int
language plpgsql security definer set search_path = public as $$
declare e pred_events; l live_matches; bal int;
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  select * into e from pred_events where id = eid for update;
  if not found or e.status <> 'open' then raise exception 'Приём прогнозов закрыт'; end if;
  if e.is_test and not public.is_admin() then raise exception 'not allowed'; end if;
  if e.closes_at is not null and now() > e.closes_at then
    update pred_events set status = 'closed' where id = eid and status = 'open';
    raise exception 'Время приёма прогнозов вышло';
  end if;
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
