-- PongHub — миграция 24: коэффициенты прогнозов меняются по ходу живой игры.
-- Раньше приём закрывался на первом очке, а коэффициенты считались только по рейтингу.
-- Теперь на каждом очке шанс пересчитывается: рейтинг (стартовый шанс) + текущий счёт + форма в этом матче
-- (кто сколько очков уже взял). Ставку можно сделать по ходу игры — коэффициент фиксируется в момент ставки.
-- Приём закрывается, когда исход почти решён (шанс одной стороны выше 97%).
-- Скрипт можно запускать повторно.

-- шанс выиграть партию при счёте a:b (q — шанс выиграть одно очко)
create or replace function public.game_prob(q float8, a int, b int, pts int) returns float8
language plpgsql immutable as $$
declare n int := pts + 2; f float8[]; i int; j int; dz float8; v float8;
begin
  if a >= pts and a - b >= 2 then return 1; end if;
  if b >= pts and b - a >= 2 then return 0; end if;
  dz := q * q / (q * q + (1 - q) * (1 - q));             -- «ровно»: нужно выиграть два очка подряд
  if a >= pts - 1 and b >= pts - 1 then
    if a = b then return dz; elsif a > b then return q + (1 - q) * dz; else return q * dz; end if;
  end if;
  f := array_fill(0::float8, array[n * n]);
  for i in reverse pts .. 0 loop
    for j in reverse pts .. 0 loop
      if i >= pts - 1 and j >= pts - 1 then
        v := case when i = j then dz when i > j then q + (1 - q) * dz else q * dz end;
      elsif i >= pts then v := 1;
      elsif j >= pts then v := 0;
      else v := q * f[(i + 1) * n + j + 1] + (1 - q) * f[i * n + j + 2];
      end if;
      f[i * n + j + 1] := v;
    end loop;
  end loop;
  return f[a * n + b + 1];
end $$;

-- шанс выиграть матч: wa:wb по партиям, ga — шанс взять текущую партию, g — любую следующую
create or replace function public.match_prob(wa int, wb int, need int, ga float8, g float8) returns float8
language plpgsql immutable as $$
begin
  if wa >= need then return 1; end if;
  if wb >= need then return 0; end if;
  return ga * public.match_prob(wa + 1, wb, need, g, g) + (1 - ga) * public.match_prob(wa, wb + 1, need, g, g);
end $$;

-- шанс стороны 1 выиграть живую игру: c — стартовый шанс по рейтингу, log — очки по порядку (0/1)
create or replace function public.live_prob(c float8, log jsonb, best_of int, pts int) returns float8
language plpgsql immutable as $$
declare need int := (best_of + 1) / 2; a int := 0; b int := 0; wa int := 0; wb int := 0; pa int := 0; pb int := 0;
  s int; lo float8 := .02; hi float8 := .98; q0 float8; q float8; k int; K constant float8 := 40;
begin
  c := least(.97, greatest(.03, coalesce(c, .5)));
  for s in select (x)::int from jsonb_array_elements_text(coalesce(log, '[]')) x loop
    if wa >= need or wb >= need then exit; end if;
    if s = 0 then a := a + 1; pa := pa + 1; else b := b + 1; pb := pb + 1; end if;
    if a >= pts and a - b >= 2 then wa := wa + 1; a := 0; b := 0;
    elsif b >= pts and b - a >= 2 then wb := wb + 1; a := 0; b := 0; end if;
  end loop;
  -- шанс очка, при котором шанс на матч равен рейтинговому (подбор делением пополам)
  for k in 1 .. 40 loop
    q0 := (lo + hi) / 2;
    if public.match_prob(0, 0, need, public.game_prob(q0, 0, 0, pts), public.game_prob(q0, 0, 0, pts)) < c then lo := q0; else hi := q0; end if;
  end loop;
  -- форма в этом матче: чем больше сыграно очков, тем сильнее они сдвигают шанс
  q := least(.95, greatest(.05, (q0 * K + pa) / (K + pa + pb)));
  return public.match_prob(wa, wb, need, public.game_prob(q, a, b, pts), public.game_prob(q, 0, 0, pts));
end $$;

-- живая игра: на каждом очке — новые коэффициенты; исход почти решён — приём закрыт
create or replace function public.pred_on_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare e pred_events; p float8;
begin
  select * into e from pred_events where source = 'live' and source_id = new.id;
  if not found then return new; end if;
  if new.status = 'cancelled' then perform public.cancel_pred_event(e.id);
  elsif new.match_id is not null then
    update pred_events set match_id = new.match_id, status = case when status = 'open' then 'closed' else status end where id = e.id;
    perform public.settle_pred_event(e.id);
  elsif e.status = 'open' and jsonb_array_length(coalesce(new.log, '[]')) > 0 and new.log is distinct from old.log then
    p := public.live_prob(e.chance1, new.log, new.best_of, new.points_to);
    if p > .97 or p < .03 then
      update pred_events set status = 'closed' where id = e.id and status = 'open';
    else
      update pred_events set odds1 = least(10, greatest(1.01, round((1 / p)::numeric, 2))),
                             odds2 = least(10, greatest(1.01, round((1 / (1 - p))::numeric, 2))) where id = e.id;
    end if;
  end if;
  return new;
end $$;

-- прогноз: можно и по ходу игры, по текущему коэффициенту
create or replace function public.place_prediction(eid uuid, pick int, amount int) returns int
language plpgsql security definer set search_path = public as $$
declare e pred_events; l live_matches; bal int;
begin
  select * into e from pred_events where id = eid for update;
  if not found or not public.is_member(e.club_id) then raise exception 'not allowed'; end if;
  if e.status <> 'open' then raise exception 'Приём прогнозов закрыт'; end if;
  if e.is_test and not public.is_club_admin(e.club_id) and not public.has_shadow(array[auth.uid()]) then raise exception 'not allowed'; end if;
  if e.closes_at is not null and now() > e.closes_at then
    update pred_events set status = 'closed' where id = eid and status = 'open';
    raise exception 'Время приёма прогнозов вышло';
  end if;
  if auth.uid() in (e.player1_id, e.player2_id, coalesce(e.player3_id, e.player1_id), coalesce(e.player4_id, e.player1_id)) then
    raise exception 'На свой матч прогноз сделать нельзя';
  end if;
  if e.source = 'live' then
    select * into l from live_matches where id = e.source_id;
    if not found or l.status <> 'live' then
      update pred_events set status = 'closed' where id = eid and status = 'open';
      raise exception 'Игра уже закончилась — приём прогнозов закрыт';
    end if;
  end if;
  if pick not in (1, 2) then raise exception 'Выберите победителя'; end if;
  if amount < public.pred_setting(e.club_id, 'predMin', 10) or amount > public.pred_setting(e.club_id, 'predMax', 500) then
    raise exception 'Ставка от % до % PC', public.pred_setting(e.club_id, 'predMin', 10), public.pred_setting(e.club_id, 'predMax', 500);
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
exception when unique_violation then
  raise exception 'Вы уже сделали прогноз на этот матч';
end $$;

-- проверка: равные игроки, 0:0 → 50%; 10:5 в первой партии → заметно выше
select 'ODDS:' || round(public.live_prob(.5, '[]', 3, 11)::numeric, 3) || ' / ' ||
  round(public.live_prob(.5, '[0,0,0,0,0,0,0,0,0,0,1,1,1,1,1]', 3, 11)::numeric, 3) || ' / ' ||
  round(public.live_prob(.3, '[0,0,0,0,0,0,0,0,0,0,0,1,1,1,1]', 3, 11)::numeric, 3) as r;
