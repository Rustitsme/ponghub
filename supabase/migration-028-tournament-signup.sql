-- PongHub — миграция 28: турниры с записью заранее.
-- • Новый статус турнира 'open' — «запись открыта»: турнир объявлен заранее, сетки ещё нет.
-- • tournaments.starts_at — дата и время начала; tournaments.registered — кто записался.
-- • tournament_signup(tid, p_on) — участник клуба сам записывается или отменяет запись (пока запись открыта).
-- Запускает турнир владелец: выбирает игроков (по умолчанию — записавшихся), и турнир становится 'active'.
-- Скрипт можно запускать повторно.

alter table public.tournaments drop constraint if exists tournaments_status_check;
alter table public.tournaments add constraint tournaments_status_check check (status in ('open', 'active', 'finished'));
alter table public.tournaments add column if not exists starts_at timestamptz;
alter table public.tournaments add column if not exists registered uuid[] not null default '{}';

create or replace function public.tournament_signup(tid uuid, p_on boolean) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare t tournaments; me uuid := auth.uid();
begin
  select * into t from tournaments where id = tid for update;
  if not found then raise exception 'Турнир не найден'; end if;
  if not exists (select 1 from club_members where club_id = t.club_id and user_id = me and status = 'active') then
    raise exception 'Записаться может только участник клуба';
  end if;
  if t.status <> 'open' then raise exception 'Запись на этот турнир закрыта'; end if;
  update tournaments set registered = case
      when p_on then (case when me = any(registered) then registered else array_append(registered, me) end)
      else array_remove(registered, me) end
    where id = tid
    returning registered into t.registered;
  return t.registered;
end $$;
revoke all on function public.tournament_signup(uuid, boolean) from public, anon;
grant execute on function public.tournament_signup(uuid, boolean) to authenticated;
