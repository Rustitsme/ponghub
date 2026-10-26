-- PongHub — миграция 37: один матч — одни прогнозы.
-- Раньше: вызов принят → открывались прогнозы «на вызов»; игру начали → открывались ещё одни, «на игру».
-- Первые не закрывались, и на уже идущий матч можно было сделать прогноз.
-- Теперь: игру начали (по вызову или просто те же двое при принятом вызове) — прогнозы вызова переходят на эту игру
-- (сделанные ставки сохраняются), второго события нет. Скрипт можно запускать повторно.

create or replace function public.create_pred_event(src text, src_id uuid, chance numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  eid uuid; c numeric := least(0.95, greatest(0.05, chance));
  l live_matches; ch challenges; cid uuid; ce pred_events;
begin
  if src = 'live' then select club_id into cid from live_matches where id = src_id;
  elsif src = 'challenge' then select club_id into cid from challenges where id = src_id; end if;
  if cid is null or not public.is_member(cid) then raise exception 'not allowed'; end if;
  if coalesce((select (settings->>'predEnabled')::boolean from clubs where id = cid), true) = false then return null; end if;
  select id into eid from pred_events where source_id = src_id;
  if eid is not null then return eid; end if;
  if src = 'live' then
    select * into l from live_matches where id = src_id and status = 'live';
    if not found or jsonb_array_length(l.log) > 0 then return null; end if;
    -- прогнозы принятого вызова между этими же игроками переносим на игру
    if l.kind = 'singles' and l.tournament_id is null then
      select e.* into ce from pred_events e join challenges x on x.id = e.source_id
        where e.source = 'challenge' and e.status in ('open', 'closed') and x.club_id = cid and x.status = 'accepted' and x.match_id is null
          and (x.id = l.challenge_id or (x.from_id = l.player1_id and x.to_id = l.player2_id) or (x.from_id = l.player2_id and x.to_id = l.player1_id))
        order by (x.id = l.challenge_id) desc limit 1;
      if found then
        if ce.player1_id <> l.player1_id then   -- в игре игроки в другом порядке — разворачиваем стороны и ставки
          update predictions set side = 3 - side where event_id = ce.id;
          update pred_events set player1_id = player2_id, player2_id = player1_id, chance1 = 1 - chance1,
                                 odds1 = odds2, odds2 = odds1, pool1 = pool2, pool2 = pool1 where id = ce.id;
        end if;
        update pred_events set source = 'live', source_id = src_id, status = 'open',
          closes_at = case when l.scoring then null else now() + make_interval(mins => public.pred_setting(cid, 'predWindowMin', 3)) end
          where id = ce.id;
        return ce.id;
      end if;
    end if;
    insert into pred_events (club_id, source, source_id, kind, player1_id, player2_id, player3_id, player4_id, tournament_id, chance1, odds1, odds2, is_test, created_by, closes_at)
    values (cid, 'live', src_id, l.kind, l.player1_id, l.player2_id, l.player3_id, l.player4_id, l.tournament_id, c,
            least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), l.is_test, auth.uid(),
            case when l.scoring then null else now() + make_interval(mins => public.pred_setting(cid, 'predWindowMin', 3)) end)
    returning id into eid;
  elsif src = 'challenge' then
    select * into ch from challenges where id = src_id and status = 'accepted';
    if not found then return null; end if;
    insert into pred_events (club_id, source, source_id, player1_id, player2_id, chance1, odds1, odds2, is_test, created_by)
    values (cid, 'challenge', src_id, ch.from_id, ch.to_id, c, least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), ch.is_test, auth.uid())
    returning id into eid;
  end if;
  return eid;
end $$;

-- разовая уборка: если игра этих двоих уже идёт, прогнозы «на вызов» закрываем для новых ставок
-- (сделанные ставки рассчитаются, когда внесут счёт — вызов закроется вместе с матчем, миграция 33)
update pred_events e set status = 'closed'
  from challenges x
  where e.source = 'challenge' and e.source_id = x.id and e.status = 'open' and x.status = 'accepted' and x.match_id is null
    and exists (select 1 from live_matches l where l.club_id = x.club_id and l.status = 'live' and l.kind = 'singles'
                and ((l.player1_id = x.from_id and l.player2_id = x.to_id) or (l.player1_id = x.to_id and l.player2_id = x.from_id)));
