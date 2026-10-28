-- PongHub — миграция 45: ставки на обоих игроков, лимит 1000 PC на одного игрока, ставку можно добавлять.
-- • Снимается старое ограничение «один прогноз на матч» (то же, что миграция 25 — на случай, если она не запускалась).
-- • Лимит predMax (по умолчанию 1000) считается на каждого игрока отдельно: все ставки пользователя на одну сторону суммируются.
--   На другого игрока можно поставить свои 1000, а к уже сделанной ставке можно добавить ещё.
-- • Каждая добавленная ставка считается по коэффициенту на момент ставки (прежняя остаётся по прежнему).
-- • Клубам, где максимум стоял 500 (прежнее значение по умолчанию), он поднимается до 1000.
-- Скрипт можно запускать повторно.

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.predictions'::regclass and contype = 'u' loop
    execute format('alter table public.predictions drop constraint %I', c);
  end loop;
end $$;
create index if not exists predictions_event_user on public.predictions (event_id, user_id);

update public.clubs set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{predMax}', '1000'::jsonb)
  where (settings->>'predMax') is not null and (settings->>'predMax')::numeric = 500;

create or replace function public.place_prediction(eid uuid, pick int, amount int) returns int
language plpgsql security definer set search_path = public as $$
declare e pred_events; l live_matches; bal int; mx int; have int;
begin
  select * into e from pred_events where id = eid for update;
  if not found or not public.is_member(e.club_id) then raise exception 'not allowed'; end if;
  if e.status <> 'open' then raise exception 'Приём прогнозов закрыт'; end if;
  if e.is_test and not public.is_club_admin(e.club_id) then raise exception 'not allowed'; end if;
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
  -- лимит «на одного игрока»: все ставки пользователя на эту сторону вместе не больше predMax (по умолчанию 1000);
  -- на каждого из двух игроков лимит свой, а добавлять к ставке можно сколько угодно раз
  mx := public.pred_setting(e.club_id, 'predMax', 1000);
  select coalesce(sum(stake), 0) into have from predictions where event_id = eid and user_id = auth.uid() and side = pick;
  if amount < public.pred_setting(e.club_id, 'predMin', 10) then
    raise exception 'Минимальная ставка — % PC', public.pred_setting(e.club_id, 'predMin', 10);
  end if;
  if have + amount > mx then
    raise exception 'Лимит на одного игрока — % PC (уже поставлено %, можно ещё %)', mx, have, greatest(mx - have, 0);
  end if;
  perform public.ensure_wallet(e.club_id);
  bal := public.coin_balance(auth.uid(), e.club_id);
  if bal < amount then raise exception 'Недостаточно пинг-коинов (у вас %)', bal; end if;
  insert into predictions (club_id, event_id, user_id, side, stake, odds)
  values (e.club_id, eid, auth.uid(), pick, amount, case when pick = 1 then e.odds1 else e.odds2 end);
  insert into coin_tx (club_id, user_id, amount, kind, ref) values (e.club_id, auth.uid(), -amount, 'bet', eid);
  update pred_events set bets_count = bets_count + 1,
    pool1 = pool1 + case when pick = 1 then amount else 0 end,
    pool2 = pool2 + case when pick = 2 then amount else 0 end
  where id = eid;
  return bal - amount;
end $$;
