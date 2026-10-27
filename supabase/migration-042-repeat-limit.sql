-- PongHub — миграция 42: не больше N игр подряд с одним и тем же соперником (по умолчанию 2).
-- Чтобы играть с ним дальше, каждому из двоих нужно сначала сыграть с кем-то другим. Это против накрутки рейтинга.
-- Правило:
-- • считаются свободные одиночные игры, подтверждённые и ждущие подтверждения; турниры и парные игры не считаются;
-- • смотрим последние N игр каждого из двоих: если все они именно с этим соперником, новая игра между ними закрыта;
-- • не действует на владельца и помощников, в клубах меньше 3 игроков и в тестовых данных;
-- • завершение уже начатой игры не блокируется (проверка делается при старте игры);
-- • N меняется в настройках клуба (поле repeatLimit), 0 выключает правило.
-- Скрипт можно запускать повторно.

-- кто из двоих уже упёрся в лимит (id игрока) или null, если играть можно
create or replace function public.repeat_blocked(cid uuid, a uuid, b uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare lim int; me uuid; other uuid; n int;
begin
  lim := coalesce(nullif(trim((select settings->>'repeatLimit' from clubs where id = cid)), '')::int, 2);
  if lim <= 0 or a is null or b is null or a = b then return null; end if;
  if (select count(*) from club_members where club_id = cid and status = 'active') < 3 then return null; end if;
  foreach me in array array[a, b] loop
    other := case when me = a then b else a end;
    select count(*) into n from (
      select case when m.player1_id = me then m.player2_id else m.player1_id end as opp
      from matches m
      where m.club_id = cid and m.kind = 'singles' and m.tournament_id is null and not m.is_test
        and m.status in ('approved', 'pending') and me in (m.player1_id, m.player2_id)
      order by m.played_at desc, m.created_at desc limit lim
    ) t where t.opp = other;
    if n >= lim then return me; end if;
  end loop;
  return null;
end $$;

create or replace function public.repeat_msg(cid uuid, who uuid) returns text
language sql stable security definer set search_path = public as $$
  select format('Игрок «%s» уже сыграл с этим соперником %s %s подряд. Сначала нужно сыграть с кем-то другим.',
    (select nickname from profiles where id = who), l,
    case when l % 10 = 1 and l % 100 <> 11 then 'раз' when l % 10 between 2 and 4 and l % 100 not between 12 and 14 then 'раза' else 'раз' end)
  from (select coalesce(nullif(trim((select settings->>'repeatLimit' from clubs where id = cid)), '')::int, 2) as l) x;
$$;

-- старт живой игры
create or replace function public.live_repeat_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if new.kind is distinct from 'singles' or new.tournament_id is not null or new.is_test then return new; end if;
  if public.is_club_editor(new.club_id) then return new; end if;
  who := public.repeat_blocked(new.club_id, new.player1_id, new.player2_id);
  if who is not null then raise exception '%', public.repeat_msg(new.club_id, who); end if;
  return new;
end $$;
drop trigger if exists live_repeat_guard on public.live_matches;
create trigger live_repeat_guard before insert on public.live_matches for each row execute function public.live_repeat_guard();

-- внесение результата без живой игры
create or replace function public.matches_repeat_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if new.kind is distinct from 'singles' or new.tournament_id is not null or new.is_test or new.status not in ('approved', 'pending') then return new; end if;
  if public.is_club_editor(new.club_id) then return new; end if;
  -- это итог идущей игры этих же двоих: она была допущена при старте
  if exists (select 1 from live_matches l where l.club_id = new.club_id and l.status = 'live'
             and ((l.player1_id = new.player1_id and l.player2_id = new.player2_id) or (l.player1_id = new.player2_id and l.player2_id = new.player1_id))) then
    return new;
  end if;
  who := public.repeat_blocked(new.club_id, new.player1_id, new.player2_id);
  if who is not null then raise exception '%', public.repeat_msg(new.club_id, who); end if;
  return new;
end $$;
drop trigger if exists matches_repeat_guard on public.matches;
create trigger matches_repeat_guard before insert on public.matches for each row execute function public.matches_repeat_guard();

revoke all on function public.repeat_blocked(uuid, uuid, uuid) from public, anon;
revoke all on function public.repeat_msg(uuid, uuid) from public, anon;
