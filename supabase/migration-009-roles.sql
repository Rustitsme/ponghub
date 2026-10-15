-- PongHub — миграция 9: строгие роли.
-- Владелец — всё. Помощник — только вносит результаты СВОИХ свободных матчей (засчитываются сразу).
-- Игрок — отправляет результат на подтверждение; подтверждает, правит и удаляет только владелец.

drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert with check (
  (not is_test or public.is_admin()) and (
    public.is_admin()
    or (public.is_editor() and status = 'approved' and type = 'free' and tournament_id is null and submitted_by = auth.uid()
        and auth.uid() in (player1_id, player2_id, player3_id, player4_id))
    or (public.is_approved() and status = 'pending' and type = 'free' and tournament_id is null and submitted_by = auth.uid())
  )
);
drop policy if exists matches_update on public.matches;
create policy matches_update on public.matches for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists matches_delete on public.matches;
create policy matches_delete on public.matches for delete
  using (public.is_admin() or (submitted_by = auth.uid() and status = 'pending'));

create or replace function public.delete_match(mid uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = mid;
  if not found then return; end if;
  if not (public.is_admin() or (m.submitted_by = auth.uid() and m.status = 'pending')) then
    raise exception 'not allowed';
  end if;
  perform set_config('app.reason', coalesce(nullif(trim(reason), ''), 'Без причины'), true);
  delete from matches where id = mid;
end $$;

create or replace function public.delete_tournament(tid uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  perform set_config('app.reason', coalesce(nullif(trim(reason), ''), 'Без причины'), true);
  delete from tournaments where id = tid;
end $$;

drop policy if exists tournaments_write on public.tournaments;
create policy tournaments_write on public.tournaments for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists events_write on public.events;
create policy events_write on public.events for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists challenges_update on public.challenges;
create policy challenges_update on public.challenges for update
  using (auth.uid() in (from_id, to_id) or public.is_admin())
  with check (auth.uid() in (from_id, to_id) or public.is_admin());

drop policy if exists live_insert on public.live_matches;
create policy live_insert on public.live_matches for insert
  with check (public.is_approved() and started_by = auth.uid() and (type = 'free' or public.is_admin()) and (not is_test or public.is_admin()));
