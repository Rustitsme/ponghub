-- PongHub — миграция 23: тихое скрытие игрока (по решению создателя).
-- Скрытый игрок (profiles.shadow) сам пользуется приложением как обычно и видит свои игры, но:
--  • другие участники клуба не видят ни его, ни его игр, вызовов, живых игр и прогнозов;
--  • его игры не идут в общий рейтинг, на табло и в уведомления (строки с ним помечаются is_test);
--  • ему не приходят push-уведомления (подписки удаляются, новые молча не сохраняются).
-- Владелец клуба по-прежнему видит всё (как тестовые данные). Кнопка «Удалить тестовое» скрытого не трогает.
-- Снять скрытие: update profiles set shadow = false where id = '...'; (строки останутся is_test — вернуть отдельно).
-- Скрипт можно запускать повторно.

alter table public.profiles add column if not exists shadow boolean not null default false;

-- есть ли среди участников скрытый игрок (кроме меня самого)
create or replace function public.has_shadow(ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = any(ids) and shadow);
$$;
create or replace function public.shadow_other(ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = any(ids) and shadow and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
$$;
-- строки с участием скрытого игрока — скрытые (is_test): не видны другим, не в рейтинге, без уведомлений
create or replace function public.shadow_mark() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  if public.has_shadow(array[(j->>'player1_id')::uuid, (j->>'player2_id')::uuid, (j->>'player3_id')::uuid, (j->>'player4_id')::uuid,
                             (j->>'from_id')::uuid, (j->>'to_id')::uuid]) then new.is_test := true; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['matches', 'live_matches', 'challenges', 'pred_events'] loop
    execute format('drop trigger if exists aa_shadow_mark on public.%I', t);
    execute format('create trigger aa_shadow_mark before insert or update on public.%I for each row execute function public.shadow_mark()', t);
  end loop;
end $$;

-- видимость: скрытые строки видит владелец клуба и сам скрытый игрок
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)
  or (auth.uid() in (player1_id, player2_id, player3_id, player4_id) and public.has_shadow(array[auth.uid()]))));
drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert with check (
  public.all_in_club(club_id, array[player1_id, player2_id, player3_id, player4_id])
  and (not is_test or public.is_club_admin(club_id) or public.has_shadow(array[player1_id, player2_id, player3_id, player4_id])) and (
    public.is_club_admin(club_id)
    or (public.is_club_editor(club_id) and status = 'approved' and type = 'free' and tournament_id is null and submitted_by = auth.uid()
        and auth.uid() in (player1_id, player2_id, player3_id, player4_id))
    or (public.is_member(club_id) and status = 'pending' and type = 'free' and tournament_id is null and submitted_by = auth.uid())
  )
);
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)
  or (auth.uid() in (from_id, to_id) and public.has_shadow(array[auth.uid()]))));
drop policy if exists challenges_insert on public.challenges;
create policy challenges_insert on public.challenges for insert with check (
  public.is_member(club_id) and from_id = auth.uid() and status = 'pending' and public.all_in_club(club_id, array[to_id])
  and (not is_test or public.is_club_admin(club_id) or public.has_shadow(array[from_id, to_id]))
);
drop policy if exists live_select on public.live_matches;
create policy live_select on public.live_matches for select using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)
  or (auth.uid() in (player1_id, player2_id, player3_id, player4_id, started_by) and public.has_shadow(array[auth.uid()]))));
drop policy if exists live_insert on public.live_matches;
create policy live_insert on public.live_matches for insert with check (
  public.is_member(club_id) and started_by = auth.uid() and (type = 'free' or public.is_club_admin(club_id))
  and (not is_test or public.is_club_admin(club_id) or public.has_shadow(array[player1_id, player2_id, player3_id, player4_id]))
  and public.all_in_club(club_id, array[player1_id, player2_id, player3_id, player4_id])
);
drop policy if exists pred_events_select on public.pred_events;
create policy pred_events_select on public.pred_events for select using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)
  or (auth.uid() in (player1_id, player2_id, player3_id, player4_id) and public.has_shadow(array[auth.uid()]))));

-- профиль и членство скрытого не видны другим (кроме владельца клуба и основателя)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or public.is_founder()
  or exists (
    select 1 from club_members a join club_members b on b.club_id = a.club_id
    join clubs c on c.id = a.club_id and not c.blocked
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = profiles.id
      and (b.status <> 'pending' or a.role = 'owner')
      and (not profiles.is_test or a.role = 'owner')
      and (not profiles.shadow or a.role = 'owner')
  )
);
drop policy if exists members_select on public.club_members;
create policy members_select on public.club_members for select using (
  user_id = auth.uid() or public.is_founder()
  or (public.is_member(club_id) and (status <> 'pending' or public.is_club_admin(club_id))
      and (not public.has_shadow(array[user_id]) or public.is_club_admin(club_id)))
);

-- push: скрытому ничего не отправляется — подписки не хранятся
create or replace function public.shadow_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.has_shadow(array[new.user_id]) then return null; end if;
  return new;
end $$;
drop trigger if exists aa_shadow_push on public.push_subscriptions;
create trigger aa_shadow_push before insert or update on public.push_subscriptions for each row execute function public.shadow_push();

-- «Удалить тестовое» не трогает скрытых игроков и их игры
create or replace function public.admin_purge_test(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; evs uuid[];
begin
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  select coalesce(array_agg(p.id), '{}') into ids from profiles p join club_members m on m.user_id = p.id and m.club_id = cid where p.is_test and not p.shadow;
  select coalesce(array_agg(id), '{}') into evs from pred_events
    where club_id = cid and ((is_test and not public.has_shadow(array[player1_id, player2_id, player3_id, player4_id])) or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids));
  delete from coin_tx where club_id = cid and (ref = any(evs) or user_id = any(ids));
  delete from pred_events where id = any(evs);
  delete from live_matches where club_id = cid and ((is_test and not public.has_shadow(array[player1_id, player2_id, player3_id, player4_id])) or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids));
  delete from challenges where club_id = cid and ((is_test and not public.has_shadow(array[from_id, to_id])) or from_id = any(ids) or to_id = any(ids));
  delete from matches where club_id = cid and ((is_test and not public.has_shadow(array[player1_id, player2_id, player3_id, player4_id])) or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids));
  delete from tournaments where club_id = cid and is_test;
  delete from announcements where club_id = cid and is_test;
  delete from profiles where id = any(ids);
  delete from audit_log where club_id = cid and (
    ((coalesce((new_data->>'is_test')::boolean, false) or coalesce((old_data->>'is_test')::boolean, false))
      and not exists (select 1 from profiles s where s.shadow and s.id::text in (new_data->>'player1_id', new_data->>'player2_id', old_data->>'player1_id', old_data->>'player2_id', new_data->>'from_id', new_data->>'to_id')))
    or new_data->>'player1_id' = any(ids::text[]) or old_data->>'player1_id' = any(ids::text[])
    or new_data->>'player2_id' = any(ids::text[]) or old_data->>'player2_id' = any(ids::text[])
    or record_id = any(ids::text[]) or new_data->>'user_id' = any(ids::text[]) or old_data->>'user_id' = any(ids::text[]));
end $$;

-- скрыть игрока: profiles.shadow = true, удалить его push-подписки, пометить его прошлые игры
create or replace function public.shadow_apply(uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n1 int; n2 int; n3 int; n4 int;
begin
  if auth.uid() is not null and not public.is_founder() then raise exception 'not allowed'; end if;
  update profiles set shadow = true where id = uid;
  delete from push_subscriptions where user_id = uid;
  update matches set is_test = true where uid in (player1_id, player2_id, player3_id, player4_id) and not is_test; get diagnostics n1 = row_count;
  update live_matches set is_test = true where uid in (player1_id, player2_id, player3_id, player4_id) and not is_test; get diagnostics n2 = row_count;
  update challenges set is_test = true where uid in (from_id, to_id) and not is_test; get diagnostics n3 = row_count;
  update pred_events set is_test = true where uid in (player1_id, player2_id, player3_id, player4_id) and not is_test; get diagnostics n4 = row_count;
  return jsonb_build_object('matches', n1, 'live', n2, 'challenges', n3, 'preds', n4);
end $$;
revoke all on function public.shadow_apply(uuid) from public, anon, authenticated;
