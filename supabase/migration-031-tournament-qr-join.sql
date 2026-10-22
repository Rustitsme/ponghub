-- PongHub — миграция 31: запись на турнир по QR одним сканированием.
-- • Новичок (ещё не в клубе) видит страницу турнира и нажимает «Записаться»: уходит заявка в клуб,
--   а он попадает в tournaments.pending_reg — «ждёт одобрения в клуб».
-- • Как только владелец принимает заявку, он автоматически переходит в список участников (registered).
--   Отклонили заявку или отозвал её — пропадает из pending_reg.
-- Нужна миграция 28 (запись на турниры). Скрипт можно запускать повторно.

alter table public.tournaments add column if not exists pending_reg uuid[] not null default '{}';

-- страница турнира для того, кто пришёл по QR (участник клуба или по коду приглашения / видимый клуб)
create or replace function public.tournament_public(tid uuid, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t tournaments; c clubs; me uuid := auth.uid();
begin
  if me is null then raise exception 'Войдите в аккаунт'; end if;
  select * into t from tournaments where id = tid and not is_test;
  if not found then raise exception 'Турнир не найден'; end if;
  select * into c from clubs where id = t.club_id;
  if c.blocked or not (c.visible or public.is_member(c.id) or public.invite_ok(c.id, p_code)) then raise exception 'Турнир не найден'; end if;
  return jsonb_build_object(
    'id', t.id, 'name', t.name, 'status', t.status, 'starts_at', t.starts_at, 'date', t.date, 'place', t.place,
    'format', t.format, 'best_of', t.best_of, 'points_to', t.points_to, 'config', t.config,
    'registered_count', coalesce(array_length(t.registered, 1), 0),
    'me_registered', me = any(t.registered), 'me_pending', me = any(t.pending_reg),
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'pred', coalesce((c.settings->>'predEnabled')::boolean, true)),
    'my_status', (select m.status from club_members m where m.club_id = c.id and m.user_id = me));
end $$;
revoke all on function public.tournament_public(uuid, text) from public, anon;
grant execute on function public.tournament_public(uuid, text) to authenticated;

-- записаться / отменить: участник клуба — сразу в список; новичок — заявка в клуб + «ждёт одобрения»
create or replace function public.tournament_join(tid uuid, p_code text default null, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tournaments; me uuid := auth.uid(); st text;
begin
  if me is null then raise exception 'Войдите в аккаунт'; end if;
  select * into t from tournaments where id = tid and not is_test for update;
  if not found then raise exception 'Турнир не найден'; end if;
  if t.status <> 'open' then raise exception 'Запись на этот турнир закрыта'; end if;
  if not p_on then
    update tournaments set registered = array_remove(registered, me), pending_reg = array_remove(pending_reg, me) where id = tid;
    return public.tournament_public(tid, p_code);
  end if;
  select status into st from club_members where club_id = t.club_id and user_id = me;
  if st = 'active' then
    update tournaments set registered = case when me = any(registered) then registered else array_append(registered, me) end where id = tid;
  else
    perform public.request_join(t.club_id, p_code);   -- проверит код приглашения / видимость клуба
    update tournaments set pending_reg = case when me = any(pending_reg) then pending_reg else array_append(pending_reg, me) end where id = tid;
  end if;
  return public.tournament_public(tid, p_code);
end $$;
revoke all on function public.tournament_join(uuid, text, boolean) from public, anon;
grant execute on function public.tournament_join(uuid, text, boolean) to authenticated;

-- приняли в клуб — сразу участник объявленных турниров, куда записывался; отказ — убираем из ожидания
create or replace function public.tournament_pending_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update tournaments set pending_reg = array_remove(pending_reg, old.user_id) where club_id = old.club_id and old.user_id = any(pending_reg);
    return old;
  end if;
  if new.status = 'active' then
    update tournaments set registered = case when new.user_id = any(registered) then registered else array_append(registered, new.user_id) end,
                           pending_reg = array_remove(pending_reg, new.user_id)
      where club_id = new.club_id and status = 'open' and new.user_id = any(pending_reg);
  elsif new.status <> 'pending' then
    update tournaments set pending_reg = array_remove(pending_reg, new.user_id) where club_id = new.club_id and new.user_id = any(pending_reg);
  end if;
  return new;
end $$;
drop trigger if exists tournament_pending_sync on public.club_members;
create trigger tournament_pending_sync after update of status or delete on public.club_members
  for each row execute function public.tournament_pending_sync();
