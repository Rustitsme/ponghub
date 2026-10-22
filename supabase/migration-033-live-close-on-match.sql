-- PongHub — миграция 33: внесли счёт — живая игра закрывается сама.
-- Раньше: игрок без прав (или соперник, а не тот, кто начал игру) отправлял счёт на подтверждение,
-- а игра оставалась «в лайве» — владелец вносил счёт ещё раз, и появлялся дубль матча.
-- Теперь любой внесённый матч (и на подтверждение тоже) закрывает идущую игру этих же игроков
-- и отмечает сыгранным принятый вызов между ними. Скрипт можно запускать повторно.

create or replace function public.live_close_on_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl uuid[] := array_remove(array[new.player1_id, new.player2_id, new.player3_id, new.player4_id], null);
begin
  update live_matches l set status = 'finished', match_id = new.id
    where l.club_id = new.club_id and l.status = 'live' and l.match_id is null
      and l.is_test = new.is_test and l.tournament_id is not distinct from new.tournament_id
      and array_remove(array[l.player1_id, l.player2_id, l.player3_id, l.player4_id], null) @> pl
      and pl @> array_remove(array[l.player1_id, l.player2_id, l.player3_id, l.player4_id], null);
  if new.tournament_id is null and new.kind is distinct from 'doubles' then
    update challenges c set status = 'done', match_id = new.id
      where c.club_id = new.club_id and c.status = 'accepted' and c.match_id is null
        and ((c.from_id = new.player1_id and c.to_id = new.player2_id) or (c.from_id = new.player2_id and c.to_id = new.player1_id));
  end if;
  return new;
end $$;
drop trigger if exists live_close_on_match on public.matches;
create trigger live_close_on_match after insert on public.matches
  for each row execute function public.live_close_on_match();

-- разовая уборка: «зависшие» игры, счёт которых уже внесли после их начала
update live_matches l set status = 'finished', match_id = m.id
  from matches m
  where l.status = 'live' and l.match_id is null and m.club_id = l.club_id
    and m.tournament_id is not distinct from l.tournament_id and m.created_at >= l.created_at
    and array_remove(array[m.player1_id, m.player2_id, m.player3_id, m.player4_id], null) @> array_remove(array[l.player1_id, l.player2_id, l.player3_id, l.player4_id], null)
    and array_remove(array[l.player1_id, l.player2_id, l.player3_id, l.player4_id], null) @> array_remove(array[m.player1_id, m.player2_id, m.player3_id, m.player4_id], null);
