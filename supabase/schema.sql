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

-- ═══ Миграция 3 (пары, вызовы, журнал, копии, расписание) ═══
-- PongHub — миграция 3: пары 2×2, вызовы на матч, журнал изменений,
-- удаление с причиной и восстановление, резервные копии, итоги недели и сезонов по расписанию.
-- Скрипт можно запускать повторно.

-- ───────────── Парные игры ─────────────
alter table public.matches add column if not exists kind text not null default 'singles';
alter table public.matches drop constraint if exists matches_kind_check;
alter table public.matches add constraint matches_kind_check check (kind in ('singles', 'doubles'));
alter table public.matches add column if not exists player3_id uuid references public.profiles(id) on delete cascade;
alter table public.matches add column if not exists player4_id uuid references public.profiles(id) on delete cascade;
alter table public.matches add column if not exists rated boolean not null default true;

-- игрок может отправить на подтверждение и парный матч, если сам в нём участвовал
drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert with check (
  public.is_editor()
  or (public.is_approved() and status = 'pending' and type = 'free' and tournament_id is null
      and submitted_by = auth.uid() and auth.uid() in (player1_id, player2_id, player3_id, player4_id))
);

-- ───────────── Вызовы на матч ─────────────
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'done')),
  message text,
  match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
alter table public.challenges enable row level security;
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select using (public.is_approved());
drop policy if exists challenges_insert on public.challenges;
create policy challenges_insert on public.challenges for insert
  with check (public.is_approved() and from_id = auth.uid() and status = 'pending');
drop policy if exists challenges_update on public.challenges;
create policy challenges_update on public.challenges for update
  using (auth.uid() in (from_id, to_id) or public.is_editor())
  with check (auth.uid() in (from_id, to_id) or public.is_editor());
drop policy if exists challenges_delete on public.challenges;
create policy challenges_delete on public.challenges for delete using (from_id = auth.uid() or public.is_admin());

-- ───────────── Журнал изменений ─────────────
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  reason text
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select using (public.is_admin());

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- в профилях записываем только важное: роль, статус, стартовый рейтинг, ник
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
     and (o->>'role', o->>'status', o->>'initial_rating', o->>'nickname')
         is not distinct from (n->>'role', n->>'status', n->>'initial_rating', n->>'nickname') then
    return new;
  end if;
  insert into audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (auth.uid(), lower(tg_op), tg_table_name, coalesce(n->>'id', o->>'id'), o, n,
          nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;

drop trigger if exists matches_audit on public.matches;
create trigger matches_audit after insert or update or delete on public.matches
  for each row execute function public.audit_trigger();
drop trigger if exists tournaments_audit on public.tournaments;
create trigger tournaments_audit after insert or update or delete on public.tournaments
  for each row execute function public.audit_trigger();
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update or delete on public.profiles
  for each row execute function public.audit_trigger();
drop trigger if exists settings_audit on public.settings;
create trigger settings_audit after update on public.settings
  for each row execute function public.audit_trigger();

-- Удаление только с причиной — она попадает в журнал
create or replace function public.delete_match(mid uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = mid;
  if not found then return; end if;
  if not (public.is_editor() or (m.submitted_by = auth.uid() and m.status = 'pending')) then
    raise exception 'not allowed';
  end if;
  perform set_config('app.reason', coalesce(nullif(trim(reason), ''), 'Без причины'), true);
  delete from matches where id = mid;
end $$;
revoke all on function public.delete_match(uuid, text) from public, anon;
grant execute on function public.delete_match(uuid, text) to authenticated;

create or replace function public.delete_tournament(tid uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception 'not allowed'; end if;
  perform set_config('app.reason', coalesce(nullif(trim(reason), ''), 'Без причины'), true);
  delete from tournaments where id = tid;
end $$;
revoke all on function public.delete_tournament(uuid, text) from public, anon;
grant execute on function public.delete_tournament(uuid, text) to authenticated;

-- Восстановление удалённого матча из журнала (только владелец)
create or replace function public.restore_match(log_id bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; rid uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select old_data into d from audit_log where id = log_id and action = 'delete' and table_name = 'matches';
  if d is null then raise exception 'Запись не найдена'; end if;
  perform set_config('app.reason', 'Восстановлен из журнала', true);
  -- матч турнира, которого больше нет, восстанавливается как обычный
  if d->>'tournament_id' is not null and not exists (select 1 from tournaments where id = (d->>'tournament_id')::uuid) then
    d := d || '{"tournament_id": null, "stage": null, "grp": null, "round": null, "slot": null}'::jsonb;
  end if;
  insert into matches select * from jsonb_populate_record(null::matches, d) on conflict (id) do nothing returning id into rid;
  return rid;
end $$;
revoke all on function public.restore_match(bigint) from public, anon;
grant execute on function public.restore_match(bigint) to authenticated;

-- ───────────── Резервные копии ─────────────
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
drop policy if exists backups_admin_read on storage.objects;
create policy backups_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_admin());

-- ───────────── Уведомления: + вызовы, + удаления (с причиной и автором) ─────────────
create or replace function public.notify_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  select value into fn_url from app_secrets where key = 'functions_url';
  select value into secret from app_secrets where key = 'webhook_secret';
  if fn_url is null then return coalesce(new, old); end if;
  perform net.http_post(
    url := fn_url || '/notify',
    body := jsonb_build_object(
      'secret', secret, 'table', tg_table_name, 'type', tg_op,
      'record', case when tg_op <> 'DELETE' then to_jsonb(new) end,
      'old_record', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      'actor', auth.uid(),
      'reason', nullif(current_setting('app.reason', true), '')
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return coalesce(new, old);
end $$;

drop trigger if exists matches_notify on public.matches;
create trigger matches_notify after insert or update or delete on public.matches
  for each row execute function public.notify_change();
drop trigger if exists challenges_notify on public.challenges;
create trigger challenges_notify after insert or update on public.challenges
  for each row execute function public.notify_change();

-- ───────────── Расписание: итоги недели, сезона и резервная копия ─────────────
create or replace function public.call_notify(job text) returns void
language plpgsql security definer set search_path = public as $$
declare fn_url text; secret text;
begin
  select value into fn_url from app_secrets where key = 'functions_url';
  select value into secret from app_secrets where key = 'webhook_secret';
  if fn_url is null then return; end if;
  perform net.http_post(url := fn_url || '/notify',
    body := jsonb_build_object('secret', secret, 'job', job),
    headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 30000);
end $$;
revoke all on function public.call_notify(text) from public, anon, authenticated;

create extension if not exists pg_cron;
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname like 'ponghub-%' loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;
-- время в UTC: 07:00 UTC = 10:00 по Москве
select cron.schedule('ponghub-weekly', '0 7 * * 1', $$select public.call_notify('weekly')$$);
select cron.schedule('ponghub-season', '0 7 1 * *', $$select public.call_notify('season')$$);
select cron.schedule('ponghub-backup', '0 2 * * 1', $$select public.call_notify('backup')$$);

-- ───────────── Живые обновления ─────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'challenges') then
    alter publication supabase_realtime add table public.challenges;
  end if;
end $$;

-- ═══ Миграция 4 (живой счёт) ═══
-- PongHub — миграция 4: живой счёт. Кто-то со стороны ведёт счёт «+ / −», остальные видят его в реальном времени.

create table if not exists public.live_matches (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'singles' check (kind in ('singles', 'doubles')),
  type text not null default 'free' check (type in ('free', 'tournament')),
  player1_id uuid not null references public.profiles(id) on delete cascade,
  player2_id uuid not null references public.profiles(id) on delete cascade,
  player3_id uuid references public.profiles(id) on delete cascade,
  player4_id uuid references public.profiles(id) on delete cascade,
  best_of int not null default 5,
  points_to int not null default 11,
  rated boolean not null default true,
  tournament_id uuid references public.tournaments(id) on delete cascade,
  stage text, grp int, round int, slot int,
  challenge_id uuid references public.challenges(id) on delete set null,
  first_server int not null default 0,          -- 0 — подаёт игрок/команда 1, 1 — игрок/команда 2
  log jsonb not null default '[]',              -- кто выиграл каждое очко: [0, 1, 1, 0, ...]
  status text not null default 'live' check (status in ('live', 'finished', 'cancelled')),
  scorer_id uuid references public.profiles(id) on delete set null,
  started_by uuid references public.profiles(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.live_matches enable row level security;
drop policy if exists live_select on public.live_matches;
create policy live_select on public.live_matches for select using (public.is_approved());
drop policy if exists live_insert on public.live_matches;
create policy live_insert on public.live_matches for insert
  with check (public.is_approved() and started_by = auth.uid() and (type = 'free' or public.is_editor()));
-- вести счёт может любой участник клуба (например, подменить счётчика)
drop policy if exists live_update on public.live_matches;
create policy live_update on public.live_matches for update using (public.is_approved()) with check (public.is_approved());
drop policy if exists live_delete on public.live_matches;
create policy live_delete on public.live_matches for delete using (started_by = auth.uid() or public.is_editor());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_matches') then
    alter publication supabase_realtime add table public.live_matches;
  end if;
end $$;

-- Результат свободной игры может отправить на подтверждение любой участник клуба,
-- даже если сам не играл (например, тот, кто вёл счёт). В рейтинг он попадёт только после подтверждения.
drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert with check (
  public.is_editor()
  or (public.is_approved() and status = 'pending' and type = 'free' and tournament_id is null and submitted_by = auth.uid())
);

-- ═══ Миграция 5 (тестовый режим) ═══
-- PongHub — миграция 5: тестовый режим владельца.
-- Тестовые игроки, матчи, турниры и живые игры видит только владелец; они не участвуют
-- в общем рейтинге, не рассылают уведомления и удаляются одной кнопкой вместе с журналом.

alter table public.profiles add column if not exists is_test boolean not null default false;
alter table public.matches add column if not exists is_test boolean not null default false;
alter table public.tournaments add column if not exists is_test boolean not null default false;
alter table public.live_matches add column if not exists is_test boolean not null default false;
alter table public.challenges add column if not exists is_test boolean not null default false;

-- Скрываем тестовое от всех, кроме владельца
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin() or (public.is_approved() and not is_test and status in ('approved', 'archived', 'deleted')));
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select using (public.is_approved() and (not is_test or public.is_admin()));
drop policy if exists tournaments_select on public.tournaments;
create policy tournaments_select on public.tournaments for select using (public.is_approved() and (not is_test or public.is_admin()));
drop policy if exists live_select on public.live_matches;
create policy live_select on public.live_matches for select using (public.is_approved() and (not is_test or public.is_admin()));
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select using (public.is_approved() and (not is_test or public.is_admin()));

-- Тестовое создаёт только владелец
drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert with check (
  (not is_test or public.is_admin()) and (
    public.is_editor()
    or (public.is_approved() and status = 'pending' and type = 'free' and tournament_id is null and submitted_by = auth.uid())
  )
);

-- Уведомления о тестовом не отправляются
create or replace function public.notify_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  if coalesce((to_jsonb(coalesce(new, old))->>'is_test')::boolean, false) then return coalesce(new, old); end if;
  select value into fn_url from app_secrets where key = 'functions_url';
  select value into secret from app_secrets where key = 'webhook_secret';
  if fn_url is null then return coalesce(new, old); end if;
  perform net.http_post(
    url := fn_url || '/notify',
    body := jsonb_build_object(
      'secret', secret, 'table', tg_table_name, 'type', tg_op,
      'record', case when tg_op <> 'DELETE' then to_jsonb(new) end,
      'old_record', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      'actor', auth.uid(),
      'reason', nullif(current_setting('app.reason', true), '')
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return coalesce(new, old);
end $$;

-- Создать тестовых игроков (без аккаунтов — войти под ними нельзя)
create or replace function public.admin_create_test_players(n int) returns int
language plpgsql security definer set search_path = public as $$
declare i int := 0; k int := 0; nick text;
  emo text[] := array['🧪', '🤖', '👾', '🦾', '🛸', '🎲', '🧩', '🪀'];
  col text[] := array['#8ab4f8', '#c77dff', '#06d6a0', '#f4a261', '#ffd166', '#ff70a6', '#2a9d8f', '#adb5bd'];
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  while i < least(greatest(n, 1), 8) loop
    k := k + 1;
    nick := 'Тест ' || k;
    if not exists (select 1 from profiles where lower(nickname) = lower(nick)) then
      insert into profiles (id, nickname, full_name, avatar, color, role, status, is_test)
      values (gen_random_uuid(), nick, 'Тестовый игрок', emo[1 + (k - 1) % 8], col[1 + (k - 1) % 8], 'player', 'approved', true);
      i := i + 1;
    end if;
  end loop;
  return i;
end $$;
revoke all on function public.admin_create_test_players(int) from public, anon;
grant execute on function public.admin_create_test_players(int) to authenticated;

-- Удалить всё тестовое бесследно (включая записи журнала о нём)
create or replace function public.admin_purge_test() returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select coalesce(array_agg(id), '{}') into ids from profiles where is_test;
  delete from live_matches where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from challenges where is_test or from_id = any(ids) or to_id = any(ids);
  delete from matches where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from tournaments where is_test;
  delete from profiles where is_test;
  delete from audit_log where coalesce((new_data->>'is_test')::boolean, false) or coalesce((old_data->>'is_test')::boolean, false)
    or new_data->>'player1_id' = any(ids::text[]) or old_data->>'player1_id' = any(ids::text[])
    or new_data->>'player2_id' = any(ids::text[]) or old_data->>'player2_id' = any(ids::text[])
    or record_id = any(ids::text[]);
end $$;
revoke all on function public.admin_purge_test() from public, anon;
grant execute on function public.admin_purge_test() to authenticated;

-- ═══ Миграция 6 (объявления) ═══
-- PongHub — миграция 6: объявления владельца. Пишет только владелец, читают все участники,
-- при публикации всем приходит push-уведомление.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  is_test boolean not null default false
);
alter table public.announcements enable row level security;
drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select using (public.is_approved() and (not is_test or public.is_admin()));
drop policy if exists ann_insert on public.announcements;
create policy ann_insert on public.announcements for insert with check (public.is_admin() and created_by = auth.uid());
drop policy if exists ann_delete on public.announcements;
create policy ann_delete on public.announcements for delete using (public.is_admin());

drop trigger if exists announcements_notify on public.announcements;
create trigger announcements_notify after insert on public.announcements
  for each row execute function public.notify_change();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;

-- очистка тестовых данных теперь удаляет и тестовые объявления
create or replace function public.admin_purge_test() returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select coalesce(array_agg(id), '{}') into ids from profiles where is_test;
  delete from live_matches where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from challenges where is_test or from_id = any(ids) or to_id = any(ids);
  delete from matches where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from tournaments where is_test;
  delete from announcements where is_test;
  delete from profiles where is_test;
  delete from audit_log where coalesce((new_data->>'is_test')::boolean, false) or coalesce((old_data->>'is_test')::boolean, false)
    or new_data->>'player1_id' = any(ids::text[]) or old_data->>'player1_id' = any(ids::text[])
    or new_data->>'player2_id' = any(ids::text[]) or old_data->>'player2_id' = any(ids::text[])
    or record_id = any(ids::text[]);
end $$;

-- ═══ Миграция 7 (получатели объявлений) ═══
-- PongHub — миграция 7: объявление всем или выбранным игрокам.
-- recipients = null — всем; иначе только перечисленным (и владельцу).
alter table public.announcements add column if not exists recipients uuid[];

drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select using (
  public.is_admin()
  or (public.is_approved() and not is_test and (recipients is null or auth.uid() = any(recipients)))
);
