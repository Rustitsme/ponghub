-- ═══════════════════════════════════════════════════════════════
--  PongHub — схема базы данных для Supabase
--  Скопируйте ВЕСЬ этот файл в Supabase → SQL Editor → New query → Run.
--  Скрипт можно запускать повторно — он ничего не сломает.
--
--  ВАЖНО: первый зарегистрировавшийся пользователь автоматически
--  становится владельцем клуба (админом). Зарегистрируйтесь первым!
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────── Таблицы ─────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  full_name text,
  avatar text default '🏓',
  color text default '#e63946',
  hand text,
  bio text,
  role text not null default 'player' check (role in ('player', 'editor', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'archived')),
  initial_rating numeric,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_nickname_uq on public.profiles (lower(nickname));

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date,
  place text,
  format text not null check (format in ('ko', 'rr', 'groups')),
  best_of int not null default 5,
  points_to int not null default 11,
  status text not null default 'active' check (status in ('active', 'finished')),
  participants uuid[] not null default '{}',
  config jsonb not null default '{}',
  results jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  played_at timestamptz not null default now(),
  type text not null default 'free' check (type in ('free', 'tournament')),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  stage text,
  grp int,
  round int,
  slot int,
  player1_id uuid not null references public.profiles(id) on delete cascade,
  player2_id uuid not null references public.profiles(id) on delete cascade,
  sets jsonb not null default '[]',
  sets1 int not null default 0,
  sets2 int not null default 0,
  winner_id uuid references public.profiles(id) on delete cascade,
  best_of int not null default 5,
  points_to int not null default 11,
  status text not null default 'approved' check (status in ('approved', 'pending', 'rejected')),
  submitted_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  check (player1_id <> player2_id)
);
create index if not exists matches_played_idx on public.matches (played_at);
create index if not exists matches_tournament_idx on public.matches (tournament_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  place text,
  note text,
  attendees uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'
);
insert into public.settings (id, data) values (1, '{}') on conflict (id) do nothing;

-- ───────────── Проверки ролей ─────────────

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved');
$$;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved' and role in ('editor', 'admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved' and role = 'admin');
$$;

-- ───────────── Регистрация: профиль создаётся автоматически ─────────────

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nick text;
  first_user boolean;
begin
  nick := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), split_part(new.email, '@', 1));
  if exists (select 1 from profiles where lower(nickname) = lower(nick)) then
    nick := nick || '_' || substr(new.id::text, 1, 4);
  end if;
  first_user := not exists (select 1 from profiles where role = 'admin');
  insert into profiles (id, nickname, full_name, role, status)
  values (
    new.id, nick, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    case when first_user then 'admin' else 'player' end,
    case when first_user then 'approved' else 'pending' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Обычный игрок не может сам поменять себе роль, статус или стартовый рейтинг
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- изменения из панели Supabase
  if not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
    new.initial_rating := old.initial_rating;
  end if;
  if old.id = auth.uid() and old.role = 'admin' then  -- админ не может случайно разжаловать себя
    new.role := 'admin';
    new.status := 'approved';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

-- ───────────── Вспомогательные функции для приложения ─────────────

create or replace function public.nickname_available(n text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where lower(nickname) = lower(trim(n)));
$$;
grant execute on function public.nickname_available(text) to anon, authenticated;

-- email-адреса видит только админ (чтобы понимать, кто подал заявку)
create or replace function public.admin_emails() returns table (id uuid, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query select u.id, u.email::text from auth.users u;
end $$;
grant execute on function public.admin_emails() to authenticated;

-- «Пойду / не пойду» на событие
create or replace function public.toggle_rsvp(event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  update events set attendees =
    case when auth.uid() = any(attendees) then array_remove(attendees, auth.uid())
         else array_append(attendees, auth.uid()) end
  where id = event_id;
end $$;
grant execute on function public.toggle_rsvp(uuid) to authenticated;

-- ───────────── Права доступа (Row Level Security) ─────────────

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.tournaments enable row level security;
alter table public.events enable row level security;
alter table public.settings enable row level security;

-- Профили: свой видно всегда; участники клуба видят друг друга; админ видит всех (включая заявки)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin() or (public.is_approved() and status in ('approved', 'archived')));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete using (public.is_admin());

-- Матчи: смотрят все участники; вносят админ и помощники;
-- игрок может только ОТПРАВИТЬ свой результат на подтверждение
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select using (public.is_approved());
drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert with check (
  public.is_editor()
  or (public.is_approved() and status = 'pending' and type = 'free' and tournament_id is null
      and submitted_by = auth.uid() and auth.uid() in (player1_id, player2_id))
);
drop policy if exists matches_update on public.matches;
create policy matches_update on public.matches for update using (public.is_editor()) with check (public.is_editor());
drop policy if exists matches_delete on public.matches;
create policy matches_delete on public.matches for delete
  using (public.is_editor() or (submitted_by = auth.uid() and status = 'pending'));

-- Турниры
drop policy if exists tournaments_select on public.tournaments;
create policy tournaments_select on public.tournaments for select using (public.is_approved());
drop policy if exists tournaments_write on public.tournaments;
create policy tournaments_write on public.tournaments for all using (public.is_editor()) with check (public.is_editor());

-- События календаря
drop policy if exists events_select on public.events;
create policy events_select on public.events for select using (public.is_approved());
drop policy if exists events_write on public.events;
create policy events_write on public.events for all using (public.is_editor()) with check (public.is_editor());

-- Настройки рейтинга: читают все, меняет только админ
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select using (public.is_approved());
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all using (public.is_admin()) with check (public.is_admin());

-- ───────────── Живые обновления (турнир обновляется у всех сразу) ─────────────
do $$
declare t text;
begin
  foreach t in array array['profiles', 'matches', 'tournaments', 'events', 'settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════
--  Фото профиля
-- ═══════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists photo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- каждый загружает файлы только в свою папку avatars/<свой id>/
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
--  Push-уведомления
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Служебные секреты. Политик нет → читать может только сервер (функция notify).
-- Ключи уведомлений функция создаёт сама при первом запуске.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (key, value)
values ('webhook_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

create extension if not exists pg_net;

-- При изменениях в таблицах база сообщает функции notify, а та рассылает уведомления
create or replace function public.notify_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  select value into fn_url from app_secrets where key = 'functions_url';
  select value into secret from app_secrets where key = 'webhook_secret';
  if fn_url is null then return coalesce(new, old); end if;  -- функция ещё не запускалась
  perform net.http_post(
    url := fn_url || '/notify',
    body := jsonb_build_object(
      'secret', secret, 'table', tg_table_name, 'type', tg_op,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'matches', 'tournaments', 'events'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_notify', t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.notify_change()', t || '_notify', t);
  end loop;
end $$;

-- ═══ Миграция 2 (удаление игрока) ═══
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
