-- PongHub — миграция 43: эксклюзивные основания-подарки (Jet Black, Carbon Twill, Forged Carbon, Titanium Brushed, Pearl Ceramic).
-- Они не продаются и не открываются за достижения: создатель платформы сам выдаёт их выбранным игрокам из зоны «Платформа PongHub».
-- Получатель видит уведомление с той самой ракеткой, которая ему пришла. Скрипт можно запускать повторно.

-- 1. разрешаем источник 'gift' в user_items
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.user_items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%';
  if c is not null then execute format('alter table public.user_items drop constraint %I', c); end if;
  alter table public.user_items add constraint user_items_source_check check (source in ('shop', 'starter', 'reward', 'gift'));
end $$;

-- 2. каталог: цена 0, не продаются, условия открытия нет (unlock = null → claim_skins их не трогает)
insert into public.shop_items (id, type, price, variants, for_sale, unlock) values
  ('skin-g1', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, null),
  ('skin-g2', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, null),
  ('skin-g3', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, null),
  ('skin-g4', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, null),
  ('skin-g5', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, null)
on conflict (id) do update set for_sale = false, unlock = null, price = 0;

-- 3. журнал подарков: что и кому подарили, видел ли получатель уведомление
create table if not exists public.item_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
alter table public.item_gifts enable row level security;
drop policy if exists item_gifts_select on public.item_gifts;
create policy item_gifts_select on public.item_gifts for select using (user_id = auth.uid());

-- 4. подарить ракетку (только создатель). Выдаются все четыре формы ручки.
create or replace function public.founder_gift_item(uid uuid, item text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v jsonb; fresh boolean;
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  select variants into v from shop_items where id = item and id like 'skin-g%';
  if v is null then raise exception 'Такого подарка нет'; end if;
  fresh := not exists (select 1 from user_items where user_id = uid and item_key like item || ':%');
  insert into user_items (user_id, item_key, club_id, price, source)
    select uid, item || ':' || k, null, 0, 'gift' from jsonb_object_keys(v) k
    on conflict (user_id, item_key) do nothing;
  if fresh then insert into item_gifts (user_id, item_id) values (uid, item); end if;
  return fresh;
end $$;
revoke all on function public.founder_gift_item(uuid, text) from public, anon;
grant execute on function public.founder_gift_item(uuid, text) to authenticated;

-- 5. забрать подарок обратно: снимаем с ракетки (вернётся стартовое основание)
create or replace function public.founder_revoke_gift(uid uuid, item text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  if item not like 'skin-g%' then raise exception 'Такого подарка нет'; end if;
  perform set_config('app.loadout', '1', true);
  update profiles p set loadout = coalesce((
      select jsonb_object_agg(e.key, case when e.key = 'blade' and e.value #>> '{}' like item || ':%' then to_jsonb('cn-b1:FL'::text) else e.value end)
      from jsonb_each(p.loadout) e
      where e.key = 'blade' or e.value #>> '{}' not like item || ':%'
    ), '{}'::jsonb)
    where p.id = uid and p.loadout::text like '%' || item || ':%';
  delete from user_items where user_id = uid and item_key like item || ':%' and source = 'gift';
  delete from item_gifts where user_id = uid and item_id = item;
end $$;
revoke all on function public.founder_revoke_gift(uuid, text) from public, anon;
grant execute on function public.founder_revoke_gift(uuid, text) to authenticated;

-- 6. у кого уже есть эта ракетка
create or replace function public.founder_gift_owners(item text) returns table (id uuid, nickname text, full_name text, clubs text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  return query
    select p.id, p.nickname, p.full_name,
      (select string_agg(c.name, ', ' order by c.name) from club_members m join clubs c on c.id = m.club_id where m.user_id = p.id and m.status = 'active')
    from profiles p
    where exists (select 1 from user_items u where u.user_id = p.id and u.item_key like item || ':%' and u.source = 'gift')
    order by p.nickname;
end $$;
revoke all on function public.founder_gift_owners(text) from public, anon;
grant execute on function public.founder_gift_owners(text) to authenticated;

-- 7. уведомления получателя: непрочитанные подарки и отметка «прочитано»
create or replace function public.my_gifts() returns table (id uuid, item_id text)
language sql stable security definer set search_path = public as $$
  select g.id, g.item_id from item_gifts g where g.user_id = auth.uid() and g.seen_at is null order by g.created_at;
$$;
grant execute on function public.my_gifts() to authenticated;

create or replace function public.gifts_seen() returns void
language sql security definer set search_path = public as $$
  update item_gifts set seen_at = now() where user_id = auth.uid() and seen_at is null;
$$;
grant execute on function public.gifts_seen() to authenticated;
