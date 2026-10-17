-- PongHub — миграция 19: тестировщики нововведений + 3D-игрок (за флажком).
-- Тестировщики: создатель выбирает любых игроков (из всех клубов) и даёт им доступ к нововведению раньше всех.
-- 3D-игрок: features.avatar = 'founder'; хват ракетки (настройки из редактора) хранится в platform.grip;
-- на игрока надевается купленная форма (футболка, шорты, кроссовки) — слоты в loadout.
-- Скрипт можно запускать повторно.

create table if not exists public.feature_testers (
  feature text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (feature, user_id)
);
alter table public.feature_testers enable row level security;
drop policy if exists feature_testers_select on public.feature_testers;
create policy feature_testers_select on public.feature_testers for select to authenticated using (user_id = auth.uid() or public.is_founder());

-- нововведение включено: у всех / у создателя / у выбранных тестировщиков
create or replace function public.feature_on(fname text, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce((select value->>fname from platform where key = 'features'), 'all')
    when 'all' then true
    when 'founder' then coalesce((select is_founder from profiles where id = uid), false)
      or exists (select 1 from feature_testers where feature = fname and user_id = uid)
    else false end;
$$;

-- какие нововведения открыты мне (для приложения)
create or replace function public.my_features() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(k), '{}') from jsonb_object_keys(coalesce((select value from platform where key = 'features'), '{}')) k
  where public.feature_on(k, auth.uid());
$$;
grant execute on function public.my_features() to authenticated;

-- поиск по всем зарегистрированным игрокам (только создатель)
create or replace function public.founder_search_users(q text) returns table (id uuid, nickname text, full_name text, clubs text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  return query
    select p.id, p.nickname, p.full_name,
      (select string_agg(c.name, ', ' order by c.name) from club_members m join clubs c on c.id = m.club_id where m.user_id = p.id and m.status = 'active')
    from profiles p
    where coalesce(q, '') = '' or p.nickname ilike '%' || q || '%' or coalesce(p.full_name, '') ilike '%' || q || '%'
    order by p.nickname limit 30;
end $$;
grant execute on function public.founder_search_users(text) to authenticated;

create or replace function public.founder_feature_testers(fname text) returns table (id uuid, nickname text, full_name text, clubs text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  return query
    select p.id, p.nickname, p.full_name,
      (select string_agg(c.name, ', ' order by c.name) from club_members m join clubs c on c.id = m.club_id where m.user_id = p.id and m.status = 'active')
    from feature_testers t join profiles p on p.id = t.user_id
    where t.feature = fname order by t.added_at;
end $$;
grant execute on function public.founder_feature_testers(text) to authenticated;

create or replace function public.founder_set_tester(fname text, uid uuid, on_ boolean) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  if on_ then insert into feature_testers (feature, user_id) values (fname, uid) on conflict do nothing;
  else delete from feature_testers where feature = fname and user_id = uid; end if;
  return (select count(*) from feature_testers where feature = fname);
end $$;
grant execute on function public.founder_set_tester(text, uuid, boolean) to authenticated;

-- при запуске магазина для всех тестовые покупки тестировщиков тоже обнуляются (как у создателя)
create or replace function public.launch_economy_v2() returns void
language plpgsql security definer set search_path = public as $$
declare f uuid[];
begin
  if (select value from platform where key = 'economy_v2') = 'true'::jsonb then return; end if;
  select coalesce(array_agg(id), '{}') into f from profiles where is_founder or id in (select user_id from feature_testers where feature = 'shop');
  delete from coin_tx where user_id = any(f) and kind in ('shop', 'streak', 'match', 'prize', 'sell')
     or (user_id = any(f) and kind = 'adjust' and ref = '00000000-0000-0000-0000-0000000007e5');
  delete from user_items where user_id = any(f) and source in ('shop', 'reward');
  delete from daily_claims where user_id = any(f);
  delete from league_rewards where user_id = any(f);
  update profiles set loadout = '{"blade": "cn-b1:FL"}' where id = any(f);
  insert into coin_tx (club_id, user_id, amount, kind)
    select club_id, user_id, round(sum(amount) * 0.3)::int - sum(amount)::int, 'convert'
    from coin_tx where club_id is not null
    group by club_id, user_id having sum(amount) > 0;
  update clubs set settings = (coalesce(settings, '{}') - 'predWeekly' - 'predDaily') || '{"predStart": 300, "predMax": 300}';
  update platform set value = 'true' where key = 'economy_v2';
end $$;
revoke all on function public.launch_economy_v2() from public, anon, authenticated;

-- ═════════════ 3D-игрок ═════════════
update public.platform set value = coalesce(value, '{}') || '{"avatar": "founder"}' where key = 'features' and not (value ? 'avatar');
insert into public.platform (key, value) values ('grip', '{}') on conflict (key) do nothing;

alter table public.profiles add column if not exists avatar3d text check (avatar3d in ('boy', 'girl'));

create or replace function public.set_avatar3d(p text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.feature_on('avatar', auth.uid()) or p not in ('boy', 'girl') then raise exception 'not allowed'; end if;
  update profiles set avatar3d = p where id = auth.uid();
  return p;
end $$;
grant execute on function public.set_avatar3d(text) to authenticated;

-- хват ракетки: настройки из редактора (только создатель)
create or replace function public.founder_set_grip(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  insert into platform (key, value) values ('grip', p) on conflict (key) do update set value = excluded.value;
  return p;
end $$;
grant execute on function public.founder_set_grip(jsonb) to authenticated;

-- форма на игроке: футболка, шорты, кроссовки из купленного
create or replace function public.equip_item(p_slot text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text; lo jsonb; wear boolean := p_slot in ('shirt', 'shorts', 'shoes');
begin
  if me is null or p_slot not in ('blade', 'fh', 'bh', 'grip', 'tape', 'shirt', 'shorts', 'shoes') or not public.feature_on('shop', me) then raise exception 'not allowed'; end if;
  if wear and not public.feature_on('avatar', me) then raise exception 'not allowed'; end if;
  if p_key is null then
    if p_slot = 'blade' then raise exception 'Основание снять нельзя'; end if;
  else
    if not exists (select 1 from user_items where user_id = me and item_key = p_key) then raise exception 'Сначала купите эту вещь'; end if;
    select type into t from shop_items where id = split_part(p_key, ':', 1);
    if not ((p_slot = 'blade' and t = 'blade') or (p_slot in ('fh', 'bh') and t = 'rubber') or (p_slot = 'grip' and t = 'grip') or (p_slot = 'tape' and t = 'tape') or (wear and t = p_slot)) then
      raise exception 'Эта вещь сюда не ставится';
    end if;
  end if;
  select coalesce(loadout, '{}') into lo from profiles where id = me;
  if p_slot = 'fh' and lo->>'bh' = p_key then lo := lo - 'bh'; end if;
  if p_slot = 'bh' and lo->>'fh' = p_key then lo := lo - 'fh'; end if;
  lo := case when p_key is null then lo - p_slot else lo || jsonb_build_object(p_slot, p_key) end;
  perform set_config('app.loadout', '1', true);
  update profiles set loadout = lo where id = me;
  return lo;
end $$;
