-- PongHub — миграция 2: владелец может удалить игрока, не трогая рейтинг остальных.
-- Аккаунт удаляется, профиль обезличивается («Бывший игрок»), матчи остаются в истории.

-- профиль больше не исчезает вместе с аккаунтом (иначе каскадом стирались бы матчи)
alter table public.profiles drop constraint if exists profiles_id_fkey;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending', 'approved', 'rejected', 'archived', 'deleted'));

-- удалённых видно участникам (как «Бывший игрок»), чтобы рейтинг у всех считался одинаково
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin() or (public.is_approved() and status in ('approved', 'archived', 'deleted')));

-- админ может удалить фото любого игрока
drop policy if exists avatars_admin_delete on storage.objects;
create policy avatars_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_admin());

create or replace function public.admin_delete_player(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if target = auth.uid() then raise exception 'Нельзя удалить самого себя'; end if;
  delete from push_subscriptions where user_id = target;
  update profiles set
    nickname = 'Бывший игрок ' || right(target::text, 4),
    full_name = null, photo_url = null, bio = null, hand = null,
    avatar = '👤', color = '#adb5bd', role = 'player', status = 'deleted'
  where id = target;
  delete from auth.users where id = target;
end $$;
revoke all on function public.admin_delete_player(uuid) from public, anon;
grant execute on function public.admin_delete_player(uuid) to authenticated;
