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

-- ═══ Миграция 8 (прогнозы) ═══
-- PongHub — миграция 8: прогнозы на матчи за внутренние баллы («пинг-коины», PC).
-- Баллы не покупаются и не влияют на рейтинг. Баланс, приём ставок и выплаты — только на сервере.

-- ───────────── Таблицы ─────────────
create table if not exists public.coin_tx (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount int not null,
  kind text not null check (kind in ('start', 'weekly', 'daily', 'bet', 'payout', 'refund', 'adjust')),
  ref uuid,
  created_at timestamptz not null default now()
);
create index if not exists coin_tx_user_idx on public.coin_tx (user_id);
alter table public.coin_tx enable row level security;
drop policy if exists coin_tx_select on public.coin_tx;
create policy coin_tx_select on public.coin_tx for select using (user_id = auth.uid() or public.is_admin());

create table if not exists public.pred_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('live', 'challenge')),
  source_id uuid not null unique,
  kind text not null default 'singles',
  player1_id uuid not null references public.profiles(id) on delete cascade,
  player2_id uuid not null references public.profiles(id) on delete cascade,
  player3_id uuid references public.profiles(id) on delete cascade,
  player4_id uuid references public.profiles(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  chance1 numeric not null,
  odds1 numeric not null,
  odds2 numeric not null,
  status text not null default 'open' check (status in ('open', 'closed', 'settled', 'cancelled')),
  winner_side int,
  match_id uuid references public.matches(id) on delete set null,
  bets_count int not null default 0,
  pool1 int not null default 0,
  pool2 int not null default 0,
  is_test boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.pred_events enable row level security;
drop policy if exists pred_events_select on public.pred_events;
create policy pred_events_select on public.pred_events for select using (public.is_approved() and (not is_test or public.is_admin()));

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pred_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  side int not null check (side in (1, 2)),
  stake int not null check (stake > 0),
  odds numeric not null,
  payout int,
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'refunded')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (event_id, user_id)
);
alter table public.predictions enable row level security;
drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions for select using (user_id = auth.uid() or public.is_admin());

-- ───────────── Настройки (из settings.data, с значениями по умолчанию) ─────────────
create or replace function public.pred_setting(k text, def int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (data->>k)::numeric::int from settings where id = 1), def);
$$;

create or replace function public.coin_balance(uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from coin_tx where user_id = uid;
$$;

-- Стартовый баланс выдаётся при первом обращении
create or replace function public.ensure_wallet() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then return 0; end if;
  if not exists (select 1 from coin_tx where user_id = auth.uid()) then
    insert into coin_tx (user_id, amount, kind) values (auth.uid(), public.pred_setting('predStart', 1000), 'start');
  end if;
  return public.coin_balance(auth.uid());
end $$;
grant execute on function public.ensure_wallet() to authenticated;

-- ───────────── Открыть прогноз (из живого матча или принятого вызова) ─────────────
create or replace function public.create_pred_event(src text, src_id uuid, chance numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  eid uuid; c numeric := least(0.95, greatest(0.05, chance));
  l live_matches; ch challenges;
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  if coalesce((select (data->>'predEnabled')::boolean from settings where id = 1), true) = false then return null; end if;
  select id into eid from pred_events where source_id = src_id;
  if eid is not null then return eid; end if;
  if src = 'live' then
    select * into l from live_matches where id = src_id and status = 'live';
    if not found or jsonb_array_length(l.log) > 0 then return null; end if;
    insert into pred_events (source, source_id, kind, player1_id, player2_id, player3_id, player4_id, tournament_id, chance1, odds1, odds2, is_test, created_by)
    values ('live', src_id, l.kind, l.player1_id, l.player2_id, l.player3_id, l.player4_id, l.tournament_id, c,
            least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), l.is_test, auth.uid())
    returning id into eid;
  elsif src = 'challenge' then
    select * into ch from challenges where id = src_id and status = 'accepted';
    if not found then return null; end if;
    insert into pred_events (source, source_id, player1_id, player2_id, chance1, odds1, odds2, is_test, created_by)
    values ('challenge', src_id, ch.from_id, ch.to_id, c, least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), ch.is_test, auth.uid())
    returning id into eid;
  end if;
  return eid;
end $$;
grant execute on function public.create_pred_event(text, uuid, numeric) to authenticated;

-- ───────────── Сделать прогноз ─────────────
create or replace function public.place_prediction(eid uuid, pick int, amount int) returns int
language plpgsql security definer set search_path = public as $$
declare e pred_events; l live_matches; bal int;
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  select * into e from pred_events where id = eid for update;
  if not found or e.status <> 'open' then raise exception 'Приём прогнозов закрыт'; end if;
  if e.is_test and not public.is_admin() then raise exception 'not allowed'; end if;
  if auth.uid() in (e.player1_id, e.player2_id, coalesce(e.player3_id, e.player1_id), coalesce(e.player4_id, e.player1_id)) then
    raise exception 'На свой матч прогноз сделать нельзя';
  end if;
  if e.source = 'live' then
    select * into l from live_matches where id = e.source_id;
    if not found or l.status <> 'live' or jsonb_array_length(l.log) > 0 then
      update pred_events set status = 'closed' where id = eid and status = 'open';
      raise exception 'Игра уже началась — приём прогнозов закрыт';
    end if;
  end if;
  if pick not in (1, 2) then raise exception 'Выберите победителя'; end if;
  if amount < public.pred_setting('predMin', 10) or amount > public.pred_setting('predMax', 500) then
    raise exception 'Ставка от % до % PC', public.pred_setting('predMin', 10), public.pred_setting('predMax', 500);
  end if;
  perform public.ensure_wallet();
  bal := public.coin_balance(auth.uid());
  if bal < amount then raise exception 'Недостаточно пинг-коинов (у вас %)', bal; end if;
  insert into predictions (event_id, user_id, side, stake, odds)
  values (eid, auth.uid(), pick, amount, case when pick = 1 then e.odds1 else e.odds2 end);
  insert into coin_tx (user_id, amount, kind, ref) values (auth.uid(), -amount, 'bet', eid);
  update pred_events set bets_count = bets_count + 1,
    pool1 = pool1 + case when pick = 1 then amount else 0 end,
    pool2 = pool2 + case when pick = 2 then amount else 0 end
  where id = eid;
  return bal - amount;
exception when unique_violation then
  raise exception 'Вы уже сделали прогноз на этот матч';
end $$;
grant execute on function public.place_prediction(uuid, int, int) to authenticated;

-- ───────────── Расчёт и возврат ─────────────
create or replace function public.settle_pred_event(eid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e pred_events; m matches; side int; p predictions;
begin
  select * into e from pred_events where id = eid for update;
  if not found or e.status in ('settled', 'cancelled') or e.match_id is null then return; end if;
  select * into m from matches where id = e.match_id;
  if not found or m.status <> 'approved' then return; end if;
  side := case when m.winner_id in (e.player1_id, coalesce(e.player3_id, e.player1_id)) then 1 else 2 end;
  for p in select * from predictions where event_id = eid and status = 'open' loop
    if p.side = side then
      update predictions set status = 'won', payout = round(p.stake * p.odds), settled_at = now() where id = p.id;
      insert into coin_tx (user_id, amount, kind, ref) values (p.user_id, round(p.stake * p.odds)::int, 'payout', eid);
    else
      update predictions set status = 'lost', payout = 0, settled_at = now() where id = p.id;
    end if;
  end loop;
  update pred_events set status = 'settled', winner_side = side, settled_at = now() where id = eid;
end $$;

create or replace function public.cancel_pred_event(eid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p predictions;
begin
  for p in select * from predictions where event_id = eid and status = 'open' loop
    update predictions set status = 'refunded', payout = p.stake, settled_at = now() where id = p.id;
    insert into coin_tx (user_id, amount, kind, ref) values (p.user_id, p.stake, 'refund', eid);
  end loop;
  update pred_events set status = 'cancelled', settled_at = now() where id = eid and status in ('open', 'closed');
end $$;

-- Живой матч: первое очко закрывает приём; сохранение — привязка к матчу; отмена — возврат
create or replace function public.pred_on_live() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  select id into eid from pred_events where source = 'live' and source_id = new.id;
  if eid is null then return new; end if;
  if new.status = 'cancelled' then perform public.cancel_pred_event(eid);
  elsif new.match_id is not null then
    update pred_events set match_id = new.match_id, status = case when status = 'open' then 'closed' else status end where id = eid;
    perform public.settle_pred_event(eid);
  elsif jsonb_array_length(new.log) > 0 then
    update pred_events set status = 'closed' where id = eid and status = 'open';
  end if;
  return new;
end $$;
drop trigger if exists live_pred on public.live_matches;
create trigger live_pred after update on public.live_matches for each row execute function public.pred_on_live();

-- Вызов: матч внесён — привязка; отменён/отклонён — возврат
create or replace function public.pred_on_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  select id into eid from pred_events where source = 'challenge' and source_id = new.id;
  if eid is null then return new; end if;
  if new.status in ('cancelled', 'declined') then perform public.cancel_pred_event(eid);
  elsif new.match_id is not null then
    update pred_events set match_id = new.match_id, status = case when status = 'open' then 'closed' else status end where id = eid;
    perform public.settle_pred_event(eid);
  end if;
  return new;
end $$;
drop trigger if exists challenge_pred on public.challenges;
create trigger challenge_pred after update on public.challenges for each row execute function public.pred_on_challenge();

-- Матч подтверждён — расчёт; удалён — возврат
create or replace function public.pred_on_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if tg_op = 'DELETE' then
    for eid in select id from pred_events where match_id = old.id and status <> 'settled' loop perform public.cancel_pred_event(eid); end loop;
    return old;
  end if;
  if new.status = 'approved' then
    for eid in select id from pred_events where match_id = new.id loop perform public.settle_pred_event(eid); end loop;
  end if;
  return new;
end $$;
drop trigger if exists match_pred on public.matches;
create trigger match_pred after update or delete on public.matches for each row execute function public.pred_on_match();

-- ───────────── Таблица прогнозистов ─────────────
create or replace function public.coin_leaderboard(since timestamptz default null)
returns table (user_id uuid, balance int, profit int, bets int, wins int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_approved() then return; end if;
  return query
    select p.id,
      coalesce((select sum(amount) from coin_tx t where t.user_id = p.id), 0)::int,
      coalesce((select sum(amount) from coin_tx t where t.user_id = p.id and t.kind in ('bet', 'payout', 'refund') and (since is null or t.created_at >= since)), 0)::int,
      (select count(*) from predictions r where r.user_id = p.id and r.status in ('won', 'lost') and (since is null or r.created_at >= since))::int,
      (select count(*) from predictions r where r.user_id = p.id and r.status = 'won' and (since is null or r.created_at >= since))::int
    from profiles p
    where p.status = 'approved' and (not p.is_test or public.is_admin())
      and exists (select 1 from coin_tx t where t.user_id = p.id);
end $$;
grant execute on function public.coin_leaderboard(timestamptz) to authenticated;

-- ───────────── Бонусы по расписанию ─────────────
create or replace function public.coin_bonuses(what text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if what = 'weekly' then
    insert into coin_tx (user_id, amount, kind)
      select p.id, public.pred_setting('predWeekly', 100), 'weekly' from profiles p
      where p.status = 'approved' and not p.is_test and exists (select 1 from coin_tx t where t.user_id = p.id);
  elsif what = 'daily' then
    insert into coin_tx (user_id, amount, kind)
      select p.id, public.pred_setting('predDaily', 50), 'daily' from profiles p
      where p.status = 'approved' and not p.is_test and exists (select 1 from coin_tx t where t.user_id = p.id)
        and public.coin_balance(p.id) <= 0;
  end if;
end $$;
revoke all on function public.coin_bonuses(text) from public, anon, authenticated;
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname in ('ponghub-coins-weekly', 'ponghub-coins-daily') loop perform cron.unschedule(j.jobname); end loop;
end $$;
select cron.schedule('ponghub-coins-weekly', '0 6 * * 1', $$select public.coin_bonuses('weekly')$$);
select cron.schedule('ponghub-coins-daily', '0 5 * * *', $$select public.coin_bonuses('daily')$$);

-- ───────────── Уведомления и живые обновления ─────────────
drop trigger if exists pred_events_notify on public.pred_events;
create trigger pred_events_notify after insert on public.pred_events for each row execute function public.notify_change();
drop trigger if exists predictions_notify on public.predictions;
create trigger predictions_notify after update on public.predictions for each row execute function public.notify_change();
do $$
declare t text;
begin
  foreach t in array array['pred_events', 'predictions', 'coin_tx'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ───────────── Очистка тестового — вместе с прогнозами на тестовые матчи ─────────────
create or replace function public.admin_purge_test() returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; evs uuid[];
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select coalesce(array_agg(id), '{}') into ids from profiles where is_test;
  select coalesce(array_agg(id), '{}') into evs from pred_events
    where is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids);
  delete from coin_tx where ref = any(evs) or user_id = any(ids);
  delete from pred_events where id = any(evs);
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

-- ═══ Миграция 9 (строгие роли) ═══
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

-- ═══ Миграция 10 (игра без счёта) ═══
-- PongHub — миграция 10: «Игра началась — счёт в конце».
-- Живая игра без ведения счёта: всем видно, что идёт игра, прогнозы принимаются первые N минут,
-- итоговый счёт вносят после игры.

alter table public.live_matches add column if not exists scoring boolean not null default true;
alter table public.pred_events add column if not exists closes_at timestamptz;

create or replace function public.create_pred_event(src text, src_id uuid, chance numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  eid uuid; c numeric := least(0.95, greatest(0.05, chance));
  l live_matches; ch challenges;
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  if coalesce((select (data->>'predEnabled')::boolean from settings where id = 1), true) = false then return null; end if;
  select id into eid from pred_events where source_id = src_id;
  if eid is not null then return eid; end if;
  if src = 'live' then
    select * into l from live_matches where id = src_id and status = 'live';
    if not found or jsonb_array_length(l.log) > 0 then return null; end if;
    insert into pred_events (source, source_id, kind, player1_id, player2_id, player3_id, player4_id, tournament_id, chance1, odds1, odds2, is_test, created_by, closes_at)
    values ('live', src_id, l.kind, l.player1_id, l.player2_id, l.player3_id, l.player4_id, l.tournament_id, c,
            least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), l.is_test, auth.uid(),
            case when l.scoring then null else now() + make_interval(mins => public.pred_setting('predWindowMin', 3)) end)
    returning id into eid;
  elsif src = 'challenge' then
    select * into ch from challenges where id = src_id and status = 'accepted';
    if not found then return null; end if;
    insert into pred_events (source, source_id, player1_id, player2_id, chance1, odds1, odds2, is_test, created_by)
    values ('challenge', src_id, ch.from_id, ch.to_id, c, least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), ch.is_test, auth.uid())
    returning id into eid;
  end if;
  return eid;
end $$;

create or replace function public.place_prediction(eid uuid, pick int, amount int) returns int
language plpgsql security definer set search_path = public as $$
declare e pred_events; l live_matches; bal int;
begin
  if not public.is_approved() then raise exception 'not allowed'; end if;
  select * into e from pred_events where id = eid for update;
  if not found or e.status <> 'open' then raise exception 'Приём прогнозов закрыт'; end if;
  if e.is_test and not public.is_admin() then raise exception 'not allowed'; end if;
  if e.closes_at is not null and now() > e.closes_at then
    update pred_events set status = 'closed' where id = eid and status = 'open';
    raise exception 'Время приёма прогнозов вышло';
  end if;
  if auth.uid() in (e.player1_id, e.player2_id, coalesce(e.player3_id, e.player1_id), coalesce(e.player4_id, e.player1_id)) then
    raise exception 'На свой матч прогноз сделать нельзя';
  end if;
  if e.source = 'live' then
    select * into l from live_matches where id = e.source_id;
    if not found or l.status <> 'live' or jsonb_array_length(l.log) > 0 then
      update pred_events set status = 'closed' where id = eid and status = 'open';
      raise exception 'Игра уже началась — приём прогнозов закрыт';
    end if;
  end if;
  if pick not in (1, 2) then raise exception 'Выберите победителя'; end if;
  if amount < public.pred_setting('predMin', 10) or amount > public.pred_setting('predMax', 500) then
    raise exception 'Ставка от % до % PC', public.pred_setting('predMin', 10), public.pred_setting('predMax', 500);
  end if;
  perform public.ensure_wallet();
  bal := public.coin_balance(auth.uid());
  if bal < amount then raise exception 'Недостаточно пинг-коинов (у вас %)', bal; end if;
  insert into predictions (event_id, user_id, side, stake, odds)
  values (eid, auth.uid(), pick, amount, case when pick = 1 then e.odds1 else e.odds2 end);
  insert into coin_tx (user_id, amount, kind, ref) values (auth.uid(), -amount, 'bet', eid);
  update pred_events set bets_count = bets_count + 1,
    pool1 = pool1 + case when pick = 1 then amount else 0 end,
    pool2 = pool2 + case when pick = 2 then amount else 0 end
  where id = eid;
  return bal - amount;
exception when unique_violation then
  raise exception 'Вы уже сделали прогноз на этот матч';
end $$;

-- ═══ Миграция 11 (платформа клубов) ═══
-- PongHub — миграция 11: платформа клубов.
--
-- • Аккаунт отдельно от клуба. Регистрация больше не требует одобрения.
-- • Клуб создаёт любой; роли — внутри клуба: owner (владелец клуба) / helper (помощник) / player.
-- • Основатель (profiles.is_founder) управляет платформой: видит все клубы, блокирует,
--   добавляет участников без клуба, один раз переносит историю коворкинга в клуб.
-- • Все данные (матчи, турниры, события, вызовы, живые игры, объявления, прогнозы, пинг-коины, журнал)
--   принадлежат клубу (club_id). Старые данные получают club_id = null до переноса основателем.
-- • Пинг-коины — отдельно в каждом клубе.
-- Скрипт можно запускать повторно.

-- ═════════════ Основатель и признак «был до клубов» ═════════════
alter table public.profiles add column if not exists is_founder boolean not null default false;
alter table public.profiles add column if not exists legacy boolean not null default false;
do $$
begin
  if not exists (select 1 from public.profiles where is_founder) then
    update public.profiles set is_founder = true where role = 'admin' and status = 'approved';
    update public.profiles set legacy = true where not is_test and status in ('approved', 'archived', 'pending');
  end if;
end $$;

create or replace function public.is_founder() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_founder);
$$;

-- ═════════════ Клубы ═════════════
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- публичный ID для поиска: PH-7K2Q
  name text not null check (length(trim(name)) between 2 and 60),
  city text,
  address text,
  lat double precision,
  lng double precision,
  description text,
  visible boolean not null default true,     -- показывать на карте и в поиске
  blocked boolean not null default false,    -- заблокирован основателем
  owner_id uuid references public.profiles(id) on delete set null,
  settings jsonb not null default '{}',      -- настройки рейтинга, прогнозов и т.д. (бывшая таблица settings)
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- секретный код приглашения — отдельно, чтобы его видел только владелец клуба
create table if not exists public.club_invites (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'player' check (role in ('owner', 'helper', 'player')),
  -- active — участник; pending — заявка; archived — скрыт из рейтинга; former — бывший (матчи остаются в истории)
  status text not null default 'active' check (status in ('active', 'pending', 'archived', 'former')),
  initial_rating numeric,
  via text,                                   -- invite / request / created / founder / history
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index if not exists club_members_user_idx on public.club_members (user_id);

-- служебные флаги платформы (читают все вошедшие)
create table if not exists public.platform (
  key text primary key,
  value jsonb not null
);
insert into public.platform (key, value) values ('migration_done', 'false') on conflict (key) do nothing;

-- ═════════════ Проверки прав внутри клуба ═════════════
create or replace function public.club_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from club_members m join clubs c on c.id = m.club_id
  where m.club_id = cid and m.user_id = auth.uid() and m.status = 'active' and not c.blocked;
$$;
create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select public.club_role(cid) is not null; $$;
create or replace function public.is_club_editor(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.club_role(cid) in ('owner', 'helper'), false); $$;
create or replace function public.is_club_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.club_role(cid) = 'owner', false); $$;

-- все перечисленные игроки — участники клуба (активные или в архиве)
create or replace function public.all_in_club(cid uuid, ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from unnest(ids) x where x is not null
      and not exists (select 1 from club_members m where m.club_id = cid and m.user_id = x and m.status in ('active', 'archived'))
  );
$$;

-- старые функции ролей: теперь означают основателя / наличие клуба (на случай забытых мест)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_founder(); $$;
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_founder(); $$;
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_founder() or exists (select 1 from club_members where user_id = auth.uid() and status = 'active');
$$;

-- ═════════════ club_id во всех данных ═════════════
do $$
declare t text;
begin
  foreach t in array array['matches', 'tournaments', 'events', 'challenges', 'live_matches', 'announcements',
                           'pred_events', 'predictions', 'coin_tx', 'audit_log'] loop
    execute format('alter table public.%I add column if not exists club_id uuid references public.clubs(id) on delete cascade', t);
    execute format('create index if not exists %I on public.%I (club_id)', t || '_club_idx', t);
  end loop;
end $$;

-- ═════════════ Регистрация: аккаунт сразу активен, без одобрения ═════════════
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare nick text;
begin
  nick := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), split_part(new.email, '@', 1));
  if exists (select 1 from profiles where lower(nickname) = lower(nick)) then
    nick := nick || '_' || substr(new.id::text, 1, 4);
  end if;
  insert into profiles (id, nickname, full_name, role, status)
  values (new.id, nick, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'player', 'approved');
  return new;
end $$;

-- служебные поля профиля меняет только основатель
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- изменения из панели Supabase / служебных функций
  if not public.is_founder() then
    new.role := old.role;
    new.status := old.status;
    new.initial_rating := old.initial_rating;
    new.is_founder := old.is_founder;
    new.legacy := old.legacy;
    new.is_test := old.is_test;
  end if;
  if old.id = auth.uid() and old.is_founder then new.is_founder := true; end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

-- ═════════════ Права доступа ═════════════
alter table public.clubs enable row level security;
alter table public.club_invites enable row level security;
alter table public.club_members enable row level security;
alter table public.platform enable row level security;

drop policy if exists platform_select on public.platform;
create policy platform_select on public.platform for select to authenticated using (true);

-- клуб видят его участники (и подавшие заявку) и основатель; остальные — через club_directory / club_public
drop policy if exists clubs_select on public.clubs;
create policy clubs_select on public.clubs for select using (
  public.is_founder() or exists (select 1 from club_members m where m.club_id = clubs.id and m.user_id = auth.uid() and m.status in ('active', 'pending'))
);
drop policy if exists invites_select on public.club_invites;
create policy invites_select on public.club_invites for select using (public.is_club_admin(club_id));

drop policy if exists members_select on public.club_members;
create policy members_select on public.club_members for select using (
  user_id = auth.uid() or public.is_founder()
  or (public.is_member(club_id) and (status <> 'pending' or public.is_club_admin(club_id)))
);

-- профили: свой; основатель; люди из общих клубов (заявки — только владельцу клуба; тестовые — только владельцу)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or public.is_founder()
  or exists (
    select 1 from club_members a join club_members b on b.club_id = a.club_id
    join clubs c on c.id = a.club_id and not c.blocked
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = profiles.id
      and (b.status <> 'pending' or a.role = 'owner')
      and (not profiles.is_test or a.role = 'owner')
  )
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_founder()) with check (id = auth.uid() or public.is_founder());
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete using (public.is_founder());

-- старая общая таблица настроек — только основателю (настройки теперь у клуба)
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select using (public.is_founder());
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all using (public.is_founder()) with check (public.is_founder());

-- матчи
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select
  using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)));
drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert with check (
  public.all_in_club(club_id, array[player1_id, player2_id, player3_id, player4_id])
  and (not is_test or public.is_club_admin(club_id)) and (
    public.is_club_admin(club_id)
    or (public.is_club_editor(club_id) and status = 'approved' and type = 'free' and tournament_id is null and submitted_by = auth.uid()
        and auth.uid() in (player1_id, player2_id, player3_id, player4_id))
    or (public.is_member(club_id) and status = 'pending' and type = 'free' and tournament_id is null and submitted_by = auth.uid())
  )
);
drop policy if exists matches_update on public.matches;
create policy matches_update on public.matches for update
  using (public.is_club_admin(club_id)) with check (public.is_club_admin(club_id));
drop policy if exists matches_delete on public.matches;
create policy matches_delete on public.matches for delete
  using (public.is_club_admin(club_id) or (public.is_member(club_id) and submitted_by = auth.uid() and status = 'pending'));

-- турниры и календарь
drop policy if exists tournaments_select on public.tournaments;
create policy tournaments_select on public.tournaments for select
  using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)));
drop policy if exists tournaments_write on public.tournaments;
create policy tournaments_write on public.tournaments for all
  using (public.is_club_admin(club_id)) with check (public.is_club_admin(club_id));
drop policy if exists events_select on public.events;
create policy events_select on public.events for select using (public.is_member(club_id));
drop policy if exists events_write on public.events;
create policy events_write on public.events for all
  using (public.is_club_admin(club_id)) with check (public.is_club_admin(club_id));

-- вызовы
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select
  using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)));
drop policy if exists challenges_insert on public.challenges;
create policy challenges_insert on public.challenges for insert with check (
  public.is_member(club_id) and from_id = auth.uid() and status = 'pending' and public.all_in_club(club_id, array[to_id])
  and (not is_test or public.is_club_admin(club_id))
);
drop policy if exists challenges_update on public.challenges;
create policy challenges_update on public.challenges for update
  using (public.is_member(club_id) and (auth.uid() in (from_id, to_id) or public.is_club_admin(club_id)))
  with check (public.is_member(club_id) and (auth.uid() in (from_id, to_id) or public.is_club_admin(club_id)));
drop policy if exists challenges_delete on public.challenges;
create policy challenges_delete on public.challenges for delete
  using (public.is_member(club_id) and (from_id = auth.uid() or public.is_club_admin(club_id)));

-- живые игры
drop policy if exists live_select on public.live_matches;
create policy live_select on public.live_matches for select
  using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)));
drop policy if exists live_insert on public.live_matches;
create policy live_insert on public.live_matches for insert with check (
  public.is_member(club_id) and started_by = auth.uid() and (type = 'free' or public.is_club_admin(club_id))
  and (not is_test or public.is_club_admin(club_id))
  and public.all_in_club(club_id, array[player1_id, player2_id, player3_id, player4_id])
);
drop policy if exists live_update on public.live_matches;
create policy live_update on public.live_matches for update
  using (public.is_member(club_id)) with check (public.is_member(club_id));
drop policy if exists live_delete on public.live_matches;
create policy live_delete on public.live_matches for delete
  using (public.is_member(club_id) and (started_by = auth.uid() or public.is_club_editor(club_id)));

-- объявления
drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select using (
  public.is_club_admin(club_id)
  or (public.is_member(club_id) and not is_test and (recipients is null or auth.uid() = any(recipients)))
);
drop policy if exists ann_insert on public.announcements;
create policy ann_insert on public.announcements for insert
  with check (public.is_club_admin(club_id) and created_by = auth.uid());
drop policy if exists ann_delete on public.announcements;
create policy ann_delete on public.announcements for delete using (public.is_club_admin(club_id));

-- прогнозы и пинг-коины (каждый видит свои; владелец клуба — все в своём клубе)
drop policy if exists coin_tx_select on public.coin_tx;
create policy coin_tx_select on public.coin_tx for select
  using ((user_id = auth.uid() and public.is_member(club_id)) or public.is_club_admin(club_id));
drop policy if exists pred_events_select on public.pred_events;
create policy pred_events_select on public.pred_events for select
  using (public.is_member(club_id) and (not is_test or public.is_club_admin(club_id)));
drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions for select
  using ((user_id = auth.uid() and public.is_member(club_id)) or public.is_club_admin(club_id));

-- журнал: владелец клуба — свой клуб; основатель — записи вне клубов
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select
  using (public.is_club_admin(club_id) or (club_id is null and public.is_founder()));

-- копии и фото — основатель
drop policy if exists backups_admin_read on storage.objects;
create policy backups_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_founder());
drop policy if exists avatars_admin_delete on storage.objects;
create policy avatars_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_founder());

-- ═════════════ Журнал: с клубом; настройки клуба пишутся как раньше («settings») ═════════════
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  cid uuid;
  tname text := tg_table_name;
begin
  if current_setting('app.bulk', true) = '1' then return coalesce(new, old); end if;  -- перенос истории
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
     and (o->>'role', o->>'status', o->>'initial_rating', o->>'nickname')
         is not distinct from (n->>'role', n->>'status', n->>'initial_rating', n->>'nickname') then
    return new;
  end if;
  if tg_table_name = 'clubs' then
    if (o->'settings') is not distinct from (n->'settings') then return new; end if;
    cid := (n->>'id')::uuid; tname := 'settings';
    o := jsonb_build_object('id', 1, 'data', o->'settings');
    n := jsonb_build_object('id', 1, 'data', n->'settings');
  elsif tg_table_name = 'club_members' then
    cid := coalesce(n->>'club_id', o->>'club_id')::uuid;
    if tg_op = 'UPDATE' and (o->>'role', o->>'status', o->>'initial_rating')
       is not distinct from (n->>'role', n->>'status', n->>'initial_rating') then return new; end if;
  else
    cid := coalesce(n->>'club_id', o->>'club_id')::uuid;
  end if;
  insert into audit_log (club_id, actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (cid, auth.uid(), lower(tg_op), tname,
          coalesce(n->>'id', o->>'id', n->>'user_id', o->>'user_id'), o, n,
          nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;

drop trigger if exists clubs_audit on public.clubs;
create trigger clubs_audit after update on public.clubs for each row execute function public.audit_trigger();
drop trigger if exists club_members_audit on public.club_members;
create trigger club_members_audit after insert or update or delete on public.club_members
  for each row execute function public.audit_trigger();

-- уведомления: при переносе истории в клуб — не рассылаем (сотни служебных изменений)
create or replace function public.notify_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  if coalesce((to_jsonb(coalesce(new, old))->>'is_test')::boolean, false) then return coalesce(new, old); end if;
  if current_setting('app.bulk', true) = '1' then return coalesce(new, old); end if;
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

-- уведомления о заявках/приёме в клуб
drop trigger if exists club_members_notify on public.club_members;
create trigger club_members_notify after insert or update on public.club_members
  for each row execute function public.notify_change();

-- ═════════════ Коды ═════════════
create or replace function public.gen_code(len int) returns text
language plpgsql volatile as $$
declare abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; s text := ''; i int;
begin
  for i in 1..len loop s := s || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
  return s;
end $$;

create or replace function public.new_club_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := 'PH-' || public.gen_code(4);
    exit when not exists (select 1 from clubs where code = c);
  end loop;
  return c;
end $$;

create or replace function public.new_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := public.gen_code(8);
    exit when not exists (select 1 from club_invites where code = c);
  end loop;
  return c;
end $$;

-- ═════════════ Клуб: создание, приглашение, заявки, участники ═════════════
create or replace function public.create_club(p_name text, p_city text, p_address text, p_lat double precision,
                                              p_lng double precision, p_visible boolean, p_description text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if not found or me.status in ('deleted', 'rejected') then raise exception 'not allowed'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Введите название клуба'; end if;
  if not me.is_founder and (select count(*) from clubs where owner_id = auth.uid()) >= 10 then
    raise exception 'Можно быть владельцем не более 10 клубов';
  end if;
  insert into clubs (code, name, city, address, lat, lng, visible, description, owner_id, created_by)
  values (public.new_club_code(), trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_address), ''), p_lat, p_lng,
          coalesce(p_visible, true), nullif(trim(p_description), ''), auth.uid(), auth.uid())
  returning id into cid;
  insert into club_invites (club_id, code) values (cid, public.new_invite_code());
  insert into club_members (club_id, user_id, role, status, via) values (cid, auth.uid(), 'owner', 'active', 'created');
  return cid;
end $$;

create or replace function public.update_club(cid uuid, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_club_admin(cid) or public.is_founder()) then raise exception 'not allowed'; end if;
  update clubs set
    name = case when patch ? 'name' and length(trim(patch->>'name')) >= 2 then trim(patch->>'name') else name end,
    city = case when patch ? 'city' then nullif(trim(patch->>'city'), '') else city end,
    address = case when patch ? 'address' then nullif(trim(patch->>'address'), '') else address end,
    description = case when patch ? 'description' then nullif(trim(patch->>'description'), '') else description end,
    lat = case when patch ? 'lat' then (patch->>'lat')::double precision else lat end,
    lng = case when patch ? 'lng' then (patch->>'lng')::double precision else lng end,
    visible = case when patch ? 'visible' then (patch->>'visible')::boolean else visible end,
    settings = case when patch ? 'settings' then patch->'settings' else settings end
  where id = cid;
end $$;

create or replace function public.rotate_invite(cid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := public.new_invite_code();
begin
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  insert into club_invites (club_id, code) values (cid, c)
    on conflict (club_id) do update set code = excluded.code, created_at = now();
  return c;
end $$;

-- приглашение (ссылка, код, QR) только находит клуб — даже скрытый с карты.
-- Заявку человек отправляет сам кнопкой; в клуб попадает, когда владелец клуба её примет.
drop function if exists public.join_by_invite(text);
create or replace function public.club_by_invite(p_code text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  select i.club_id into cid from club_invites i join clubs c on c.id = i.club_id
    where i.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and not c.blocked;
  if cid is null then raise exception 'Код приглашения не найден или устарел'; end if;
  return cid;
end $$;

create or replace function public.invite_ok(cid uuid, p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_code is not null and exists (select 1 from club_invites
    where club_id = cid and code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')));
$$;
revoke all on function public.invite_ok(uuid, text) from public, anon, authenticated;

-- заявка (клуб найден поиском или на карте)
drop function if exists public.request_join(uuid);
create or replace function public.request_join(cid uuid, p_code text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c clubs; m club_members; me profiles; inv boolean := public.invite_ok(cid, p_code);
begin
  select * into me from profiles where id = auth.uid();
  if not found or me.status in ('deleted', 'rejected') then raise exception 'not allowed'; end if;
  select * into c from clubs where id = cid;
  if not found or c.blocked or not (c.visible or inv) then raise exception 'Клуб не найден'; end if;
  select * into m from club_members where club_id = cid and user_id = auth.uid();
  if found and m.status in ('active', 'pending') then return; end if;
  insert into club_members (club_id, user_id, role, status, via)
    values (cid, auth.uid(), 'player', 'pending', case when inv then 'invite' else 'request' end)
    on conflict (club_id, user_id) do update set status = 'pending', via = excluded.via, joined_at = now();
end $$;

create or replace function public.cancel_request(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from club_members where club_id = cid and user_id = auth.uid() and status = 'pending';
end $$;

-- владелец клуба меняет участника: роль / статус / стартовый рейтинг. status 'rejected' — отклонить заявку
create or replace function public.set_member(cid uuid, uid uuid, p_role text default null, p_status text default null,
                                             p_initial numeric default null, p_clear_initial boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare m club_members;
begin
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  select * into m from club_members where club_id = cid and user_id = uid;
  if not found then raise exception 'Участник не найден'; end if;
  if m.role = 'owner' and (p_role is not null and p_role <> 'owner' or p_status is not null and p_status <> 'active') then
    raise exception 'Сначала передайте клуб другому участнику';
  end if;
  if p_role = 'owner' then raise exception 'Для этого есть «Передать клуб»'; end if;
  if p_status = 'rejected' then
    if m.status <> 'pending' then raise exception 'Это не заявка'; end if;
    delete from club_members where club_id = cid and user_id = uid;
    return;
  end if;
  update club_members set
    role = coalesce(p_role, role),
    status = coalesce(p_status, status),
    initial_rating = case when p_clear_initial then null else coalesce(p_initial, initial_rating) end
  where club_id = cid and user_id = uid;
end $$;

-- убрать из клуба (матчи остаются в истории, человек виден как бывший участник)
create or replace function public.remove_member(cid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_club_admin(cid) or uid = auth.uid() and public.is_member(cid)) then raise exception 'not allowed'; end if;
  if exists (select 1 from club_members where club_id = cid and user_id = uid and role = 'owner') then
    raise exception 'Сначала передайте клуб другому участнику';
  end if;
  if exists (select 1 from matches where club_id = cid and uid in (player1_id, player2_id, player3_id, player4_id)) then
    update club_members set status = 'former', role = 'player' where club_id = cid and user_id = uid;
  else
    delete from club_members where club_id = cid and user_id = uid;
  end if;
end $$;

create or replace function public.leave_club(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform public.remove_member(cid, auth.uid()); end $$;

-- передать клуб: новый владелец — участник клуба; прежний становится помощником
create or replace function public.transfer_club(cid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare old_owner uuid;
begin
  if not (public.is_club_admin(cid) or public.is_founder()) then raise exception 'not allowed'; end if;
  if not exists (select 1 from club_members where club_id = cid and user_id = uid and status = 'active') then
    raise exception 'Передать можно только участнику клуба';
  end if;
  select owner_id into old_owner from clubs where id = cid;
  update club_members set role = 'helper' where club_id = cid and role = 'owner';
  update club_members set role = 'owner' where club_id = cid and user_id = uid;
  update clubs set owner_id = uid where id = cid;
end $$;

-- emails: владелец клуба видит почту участников и заявок своих клубов; основатель — всех
create or replace function public.admin_emails() returns table (id uuid, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_founder() then
    return query select u.id, u.email::text from auth.users u;
  else
    return query select u.id, u.email::text from auth.users u
      where exists (select 1 from club_members b join club_members a on a.club_id = b.club_id
                    where b.user_id = u.id and a.user_id = auth.uid() and a.role = 'owner' and a.status = 'active');
  end if;
end $$;

-- ═════════════ Витрина: поиск, карта, страница клуба ═════════════
create or replace function public.club_directory(q text default null)
returns table (id uuid, code text, name text, city text, address text, lat double precision, lng double precision,
               description text, players int, matches int, created_at timestamptz, my_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  return query
    select c.id, c.code, c.name, c.city, c.address, c.lat, c.lng, c.description,
      (select count(*) from club_members m join profiles p on p.id = m.user_id where m.club_id = c.id and m.status = 'active' and not p.is_test)::int,
      (select count(*) from matches x where x.club_id = c.id and x.status = 'approved' and not x.is_test)::int,
      c.created_at,
      (select m.status from club_members m where m.club_id = c.id and m.user_id = auth.uid())
    from clubs c
    where not c.blocked and (c.visible or exists (select 1 from club_members m where m.club_id = c.id and m.user_id = auth.uid()))
      and (coalesce(trim(q), '') = '' or c.name ilike '%' || trim(q) || '%' or c.code = upper(trim(q))
           or c.code = 'PH-' || upper(trim(q)) or c.city ilike '%' || trim(q) || '%')
    order by 9 desc
    limit 200;
end $$;

-- публичная страница клуба: только ники, рейтинг (считается в приложении), турниры. Без почты и имён.
drop function if exists public.club_public(uuid);
create or replace function public.club_public(cid uuid, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clubs; res jsonb;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  select * into c from clubs where id = cid;
  if not found or c.blocked or not (c.visible or public.is_member(cid) or public.is_founder() or public.invite_ok(cid, p_code)) then
    raise exception 'Клуб не найден';
  end if;
  select jsonb_build_object(
    'club', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'city', c.city, 'address', c.address,
                               'lat', c.lat, 'lng', c.lng, 'description', c.description, 'created_at', c.created_at),
    'settings', c.settings,
    'my_status', (select m.status from club_members m where m.club_id = cid and m.user_id = auth.uid()),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nickname', p.nickname, 'avatar', p.avatar, 'color', p.color, 'photo_url', p.photo_url,
        'initial_rating', m.initial_rating, 'created_at', p.created_at,
        'status', case m.status when 'active' then 'approved' when 'archived' then 'archived' else 'deleted' end))
      from club_members m join profiles p on p.id = m.user_id
      where m.club_id = cid and m.status in ('active', 'archived', 'former') and not p.is_test), '[]'),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'played_at', x.played_at, 'created_at', x.created_at, 'type', x.type, 'kind', x.kind,
        'tournament_id', x.tournament_id, 'player1_id', x.player1_id, 'player2_id', x.player2_id,
        'player3_id', x.player3_id, 'player4_id', x.player4_id, 'sets', x.sets, 'sets1', x.sets1, 'sets2', x.sets2,
        'winner_id', x.winner_id, 'rated', x.rated, 'best_of', x.best_of, 'points_to', x.points_to, 'status', x.status))
      from matches x where x.club_id = cid and x.status = 'approved' and not x.is_test), '[]'),
    'tournaments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'date', t.date, 'status', t.status, 'results', t.results, 'created_at', t.created_at))
      from tournaments t where t.club_id = cid and not t.is_test), '[]')
  ) into res;
  return res;
end $$;

-- ═════════════ Основатель ═════════════
create or replace function public.founder_clubs()
returns table (id uuid, code text, name text, city text, visible boolean, blocked boolean, owner_id uuid, owner_nick text,
               players int, pending int, matches int, last_match timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  return query
    select c.id, c.code, c.name, c.city, c.visible, c.blocked, c.owner_id, (select nickname from profiles where profiles.id = c.owner_id),
      (select count(*) from club_members m join profiles p on p.id = m.user_id where m.club_id = c.id and m.status = 'active' and not p.is_test)::int,
      (select count(*) from club_members m where m.club_id = c.id and m.status = 'pending')::int,
      (select count(*) from matches x where x.club_id = c.id and not x.is_test)::int,
      (select max(played_at) from matches x where x.club_id = c.id),
      c.created_at
    from clubs c order by c.created_at;
end $$;

create or replace function public.founder_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'clubs', (select count(*) from clubs),
    'users', (select count(*) from profiles where not is_test and status not in ('deleted', 'rejected')),
    'matches', (select count(*) from matches where not is_test),
    'unassigned', (select count(*) from profiles p where not p.is_test and p.status not in ('deleted', 'rejected')
                     and not exists (select 1 from club_members m where m.user_id = p.id and m.status in ('active', 'pending'))),
    'legacy_rows', (select count(*) from matches where club_id is null) + (select count(*) from tournaments where club_id is null),
    'migration_done', (select value from platform where key = 'migration_done')
  );
end $$;

create or replace function public.founder_block_club(cid uuid, p_blocked boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  update clubs set blocked = p_blocked where id = cid;
end $$;

create or replace function public.founder_delete_club(cid uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  if not exists (select 1 from clubs where id = cid and name = p_name) then raise exception 'Название не совпадает'; end if;
  delete from clubs where id = cid;
end $$;

-- участники без клуба (для первого заполнения клуба)
create or replace function public.founder_unassigned()
returns table (id uuid, nickname text, full_name text, avatar text, color text, photo_url text, old_role text, old_status text,
               legacy boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  return query
    select p.id, p.nickname, p.full_name, p.avatar, p.color, p.photo_url, p.role, p.status, p.legacy, p.created_at
    from profiles p
    where not p.is_test and p.status not in ('deleted', 'rejected')
      and not exists (select 1 from club_members m where m.user_id = p.id and m.status in ('active', 'pending'))
    order by p.legacy desc, lower(p.nickname);
end $$;

-- добавить людей в клуб; роль и стартовый рейтинг переносятся из старого профиля
create or replace function public.founder_add_members(cid uuid, uids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  if not exists (select 1 from clubs where id = cid) then raise exception 'Клуб не найден'; end if;
  insert into club_members (club_id, user_id, role, status, initial_rating, via)
    select cid, p.id,
      case when p.role in ('editor', 'admin') then 'helper' else 'player' end,
      case when p.status = 'archived' then 'archived' else 'active' end,
      p.initial_rating, 'founder'
    from profiles p where p.id = any(uids) and not p.is_test and p.status not in ('deleted', 'rejected')
  on conflict (club_id, user_id) do update
    set status = case when club_members.role = 'owner' then 'active' else excluded.status end,
        role = case when club_members.role = 'owner' then 'owner' else excluded.role end,
        initial_rating = coalesce(club_members.initial_rating, excluded.initial_rating),
        via = case when club_members.via = 'created' then club_members.via else 'founder' end;
  get diagnostics n = row_count;
  return n;
end $$;

-- один раз: вся история коворкинга (матчи, турниры, рейтинг, пинг-коины, журнал, настройки) → в клуб
create or replace function public.founder_transfer_history(cid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nm int; nt int; s jsonb;
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  if (select value from platform where key = 'migration_done') = 'true'::jsonb then
    raise exception 'История уже перенесена';
  end if;
  if not exists (select 1 from clubs where id = cid) then raise exception 'Клуб не найден'; end if;
  perform set_config('app.bulk', '1', true);

  update matches set club_id = cid where club_id is null; get diagnostics nm = row_count;
  update tournaments set club_id = cid where club_id is null; get diagnostics nt = row_count;
  update events set club_id = cid where club_id is null;
  update challenges set club_id = cid where club_id is null;
  update live_matches set club_id = cid where club_id is null;
  update announcements set club_id = cid where club_id is null;
  update pred_events set club_id = cid where club_id is null;
  update predictions p set club_id = cid where club_id is null;
  update coin_tx set club_id = cid where club_id is null;
  update audit_log set club_id = cid where club_id is null;

  select data into s from settings where id = 1;
  update clubs set settings = coalesce(s, '{}') || coalesce(settings, '{}') where id = cid;

  -- тестовые игроки владельца — тоже в клуб (видны только владельцу клуба)
  insert into club_members (club_id, user_id, role, status, via)
    select cid, p.id, 'player', 'active', 'history' from profiles p where p.is_test
  on conflict do nothing;

  -- все, кто есть в истории, но не добавлен (удалённые, ушедшие), — «бывшие участники», чтобы рейтинг считался как раньше
  insert into club_members (club_id, user_id, role, status, initial_rating, via)
    select cid, p.id, 'player', 'former', p.initial_rating, 'history' from profiles p
    where not p.is_test and (
      exists (select 1 from matches x where x.club_id = cid and p.id in (x.player1_id, x.player2_id, x.player3_id, x.player4_id))
      or exists (select 1 from coin_tx t where t.club_id = cid and t.user_id = p.id))
  on conflict do nothing;

  update platform set value = 'true' where key = 'migration_done';
  perform set_config('app.bulk', '', true);
  insert into audit_log (club_id, actor_id, action, table_name, record_id, new_data, reason)
  values (cid, auth.uid(), 'update', 'settings', 'history', jsonb_build_object('matches', nm, 'tournaments', nt), 'История коворкинга перенесена в клуб');
  return jsonb_build_object('matches', nm, 'tournaments', nt);
end $$;

-- полностью удалить аккаунт (только основатель; матчи остаются как «Бывший игрок»)
create or replace function public.admin_delete_player(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  if target = auth.uid() then raise exception 'Нельзя удалить самого себя'; end if;
  if exists (select 1 from club_members where user_id = target and role = 'owner') then
    raise exception 'Человек — владелец клуба. Сначала передайте его клуб другому участнику';
  end if;
  delete from push_subscriptions where user_id = target;
  update club_members set status = 'former', role = 'player' where user_id = target;
  delete from club_members m where m.user_id = target
    and not exists (select 1 from matches x where x.club_id = m.club_id and target in (x.player1_id, x.player2_id, x.player3_id, x.player4_id));
  update profiles set
    nickname = 'Бывший игрок ' || right(target::text, 4),
    full_name = null, photo_url = null, bio = null, hand = null,
    avatar = '👤', color = '#adb5bd', role = 'player', status = 'deleted'
  where id = target;
  delete from auth.users where id = target;
end $$;

-- ═════════════ Существующие функции — с учётом клуба ═════════════
create or replace function public.toggle_rsvp(event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select club_id into cid from events where id = event_id;
  if not public.is_member(cid) then raise exception 'not allowed'; end if;
  update events set attendees =
    case when auth.uid() = any(attendees) then array_remove(attendees, auth.uid())
         else array_append(attendees, auth.uid()) end
  where id = event_id;
end $$;

create or replace function public.delete_match(mid uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = mid;
  if not found then return; end if;
  if not (public.is_club_admin(m.club_id) or (public.is_member(m.club_id) and m.submitted_by = auth.uid() and m.status = 'pending')) then
    raise exception 'not allowed';
  end if;
  perform set_config('app.reason', coalesce(nullif(trim(reason), ''), 'Без причины'), true);
  delete from matches where id = mid;
end $$;

create or replace function public.delete_tournament(tid uuid, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select club_id into cid from tournaments where id = tid;
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  perform set_config('app.reason', coalesce(nullif(trim(reason), ''), 'Без причины'), true);
  delete from tournaments where id = tid;
end $$;

create or replace function public.restore_match(log_id bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; rid uuid; cid uuid;
begin
  select old_data, club_id into d, cid from audit_log where id = log_id and action = 'delete' and table_name = 'matches';
  if d is null then raise exception 'Запись не найдена'; end if;
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  perform set_config('app.reason', 'Восстановлен из журнала', true);
  if d->>'tournament_id' is not null and not exists (select 1 from tournaments where id = (d->>'tournament_id')::uuid) then
    d := d || '{"tournament_id": null, "stage": null, "grp": null, "round": null, "slot": null}'::jsonb;
  end if;
  d := d || jsonb_build_object('club_id', cid);
  insert into matches select * from jsonb_populate_record(null::matches, d) on conflict (id) do nothing returning id into rid;
  return rid;
end $$;

-- тестовые игроки — в конкретном клубе
drop function if exists public.admin_create_test_players(int);
create or replace function public.admin_create_test_players(cid uuid, n int) returns int
language plpgsql security definer set search_path = public as $$
declare i int := 0; k int := 0; nick text; pid uuid;
  emo text[] := array['🧪', '🤖', '👾', '🦾', '🛸', '🎲', '🧩', '🪀'];
  col text[] := array['#8ab4f8', '#c77dff', '#06d6a0', '#f4a261', '#ffd166', '#ff70a6', '#2a9d8f', '#adb5bd'];
begin
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  while i < least(greatest(n, 1), 8) and k < 500 loop
    k := k + 1;
    nick := 'Тест ' || k;
    if not exists (select 1 from profiles where lower(nickname) = lower(nick)) then
      pid := gen_random_uuid();
      insert into profiles (id, nickname, full_name, avatar, color, role, status, is_test)
      values (pid, nick, 'Тестовый игрок', emo[1 + (k - 1) % 8], col[1 + (k - 1) % 8], 'player', 'approved', true);
      insert into club_members (club_id, user_id, role, status, via) values (cid, pid, 'player', 'active', 'test');
      i := i + 1;
    end if;
  end loop;
  return i;
end $$;
revoke all on function public.admin_create_test_players(uuid, int) from public, anon;
grant execute on function public.admin_create_test_players(uuid, int) to authenticated;

drop function if exists public.admin_purge_test();
create or replace function public.admin_purge_test(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; evs uuid[];
begin
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  select coalesce(array_agg(p.id), '{}') into ids from profiles p join club_members m on m.user_id = p.id and m.club_id = cid where p.is_test;
  select coalesce(array_agg(id), '{}') into evs from pred_events
    where club_id = cid and (is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids));
  delete from coin_tx where club_id = cid and (ref = any(evs) or user_id = any(ids));
  delete from pred_events where id = any(evs);
  delete from live_matches where club_id = cid and (is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids));
  delete from challenges where club_id = cid and (is_test or from_id = any(ids) or to_id = any(ids));
  delete from matches where club_id = cid and (is_test or player1_id = any(ids) or player2_id = any(ids) or player3_id = any(ids) or player4_id = any(ids));
  delete from tournaments where club_id = cid and is_test;
  delete from announcements where club_id = cid and is_test;
  delete from profiles where id = any(ids);
  delete from audit_log where club_id = cid and (coalesce((new_data->>'is_test')::boolean, false) or coalesce((old_data->>'is_test')::boolean, false)
    or new_data->>'player1_id' = any(ids::text[]) or old_data->>'player1_id' = any(ids::text[])
    or new_data->>'player2_id' = any(ids::text[]) or old_data->>'player2_id' = any(ids::text[])
    or record_id = any(ids::text[]) or new_data->>'user_id' = any(ids::text[]) or old_data->>'user_id' = any(ids::text[]));
end $$;
revoke all on function public.admin_purge_test(uuid) from public, anon;
grant execute on function public.admin_purge_test(uuid) to authenticated;

-- ═════════════ Прогнозы и пинг-коины — внутри клуба ═════════════
drop function if exists public.pred_setting(text, int);
create or replace function public.pred_setting(cid uuid, k text, def int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (settings->>k)::numeric::int from clubs where id = cid), def);
$$;

drop function if exists public.coin_balance(uuid);
create or replace function public.coin_balance(uid uuid, cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from coin_tx where user_id = uid and club_id = cid;
$$;

drop function if exists public.ensure_wallet();
create or replace function public.ensure_wallet(cid uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(cid) then return 0; end if;
  if not exists (select 1 from coin_tx where user_id = auth.uid() and club_id = cid) then
    insert into coin_tx (club_id, user_id, amount, kind) values (cid, auth.uid(), public.pred_setting(cid, 'predStart', 1000), 'start');
  end if;
  return public.coin_balance(auth.uid(), cid);
end $$;
grant execute on function public.ensure_wallet(uuid) to authenticated;

create or replace function public.create_pred_event(src text, src_id uuid, chance numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  eid uuid; c numeric := least(0.95, greatest(0.05, chance));
  l live_matches; ch challenges; cid uuid;
begin
  if src = 'live' then select club_id into cid from live_matches where id = src_id;
  elsif src = 'challenge' then select club_id into cid from challenges where id = src_id; end if;
  if cid is null or not public.is_member(cid) then raise exception 'not allowed'; end if;
  if coalesce((select (settings->>'predEnabled')::boolean from clubs where id = cid), true) = false then return null; end if;
  select id into eid from pred_events where source_id = src_id;
  if eid is not null then return eid; end if;
  if src = 'live' then
    select * into l from live_matches where id = src_id and status = 'live';
    if not found or jsonb_array_length(l.log) > 0 then return null; end if;
    insert into pred_events (club_id, source, source_id, kind, player1_id, player2_id, player3_id, player4_id, tournament_id, chance1, odds1, odds2, is_test, created_by, closes_at)
    values (cid, 'live', src_id, l.kind, l.player1_id, l.player2_id, l.player3_id, l.player4_id, l.tournament_id, c,
            least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), l.is_test, auth.uid(),
            case when l.scoring then null else now() + make_interval(mins => public.pred_setting(cid, 'predWindowMin', 3)) end)
    returning id into eid;
  elsif src = 'challenge' then
    select * into ch from challenges where id = src_id and status = 'accepted';
    if not found then return null; end if;
    insert into pred_events (club_id, source, source_id, player1_id, player2_id, chance1, odds1, odds2, is_test, created_by)
    values (cid, 'challenge', src_id, ch.from_id, ch.to_id, c, least(10, round(1 / c, 2)), least(10, round(1 / (1 - c), 2)), ch.is_test, auth.uid())
    returning id into eid;
  end if;
  return eid;
end $$;

create or replace function public.place_prediction(eid uuid, pick int, amount int) returns int
language plpgsql security definer set search_path = public as $$
declare e pred_events; l live_matches; bal int;
begin
  select * into e from pred_events where id = eid for update;
  if not found or not public.is_member(e.club_id) then raise exception 'not allowed'; end if;
  if e.status <> 'open' then raise exception 'Приём прогнозов закрыт'; end if;
  if e.is_test and not public.is_club_admin(e.club_id) then raise exception 'not allowed'; end if;
  if e.closes_at is not null and now() > e.closes_at then
    update pred_events set status = 'closed' where id = eid and status = 'open';
    raise exception 'Время приёма прогнозов вышло';
  end if;
  if auth.uid() in (e.player1_id, e.player2_id, coalesce(e.player3_id, e.player1_id), coalesce(e.player4_id, e.player1_id)) then
    raise exception 'На свой матч прогноз сделать нельзя';
  end if;
  if e.source = 'live' then
    select * into l from live_matches where id = e.source_id;
    if not found or l.status <> 'live' or jsonb_array_length(l.log) > 0 then
      update pred_events set status = 'closed' where id = eid and status = 'open';
      raise exception 'Игра уже началась — приём прогнозов закрыт';
    end if;
  end if;
  if pick not in (1, 2) then raise exception 'Выберите победителя'; end if;
  if amount < public.pred_setting(e.club_id, 'predMin', 10) or amount > public.pred_setting(e.club_id, 'predMax', 500) then
    raise exception 'Ставка от % до % PC', public.pred_setting(e.club_id, 'predMin', 10), public.pred_setting(e.club_id, 'predMax', 500);
  end if;
  perform public.ensure_wallet(e.club_id);
  bal := public.coin_balance(auth.uid(), e.club_id);
  if bal < amount then raise exception 'Недостаточно пинг-коинов (у вас %)', bal; end if;
  insert into predictions (club_id, event_id, user_id, side, stake, odds)
  values (e.club_id, eid, auth.uid(), pick, amount, case when pick = 1 then e.odds1 else e.odds2 end);
  insert into coin_tx (club_id, user_id, amount, kind, ref) values (e.club_id, auth.uid(), -amount, 'bet', eid);
  update pred_events set bets_count = bets_count + 1,
    pool1 = pool1 + case when pick = 1 then amount else 0 end,
    pool2 = pool2 + case when pick = 2 then amount else 0 end
  where id = eid;
  return bal - amount;
exception when unique_violation then
  raise exception 'Вы уже сделали прогноз на этот матч';
end $$;

create or replace function public.settle_pred_event(eid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e pred_events; m matches; side int; p predictions;
begin
  select * into e from pred_events where id = eid for update;
  if not found or e.status in ('settled', 'cancelled') or e.match_id is null then return; end if;
  select * into m from matches where id = e.match_id;
  if not found or m.status <> 'approved' then return; end if;
  side := case when m.winner_id in (e.player1_id, coalesce(e.player3_id, e.player1_id)) then 1 else 2 end;
  for p in select * from predictions where event_id = eid and status = 'open' loop
    if p.side = side then
      update predictions set status = 'won', payout = round(p.stake * p.odds), settled_at = now() where id = p.id;
      insert into coin_tx (club_id, user_id, amount, kind, ref) values (e.club_id, p.user_id, round(p.stake * p.odds)::int, 'payout', eid);
    else
      update predictions set status = 'lost', payout = 0, settled_at = now() where id = p.id;
    end if;
  end loop;
  update pred_events set status = 'settled', winner_side = side, settled_at = now() where id = eid;
end $$;

create or replace function public.cancel_pred_event(eid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p predictions; cid uuid;
begin
  select club_id into cid from pred_events where id = eid;
  for p in select * from predictions where event_id = eid and status = 'open' loop
    update predictions set status = 'refunded', payout = p.stake, settled_at = now() where id = p.id;
    insert into coin_tx (club_id, user_id, amount, kind, ref) values (cid, p.user_id, p.stake, 'refund', eid);
  end loop;
  update pred_events set status = 'cancelled', settled_at = now() where id = eid and status in ('open', 'closed');
end $$;

drop function if exists public.coin_leaderboard(timestamptz);
create or replace function public.coin_leaderboard(cid uuid, since timestamptz default null)
returns table (user_id uuid, balance int, profit int, bets int, wins int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(cid) then return; end if;
  return query
    select m.user_id,
      coalesce((select sum(amount) from coin_tx t where t.user_id = m.user_id and t.club_id = cid), 0)::int,
      coalesce((select sum(amount) from coin_tx t where t.user_id = m.user_id and t.club_id = cid and t.kind in ('bet', 'payout', 'refund') and (since is null or t.created_at >= since)), 0)::int,
      (select count(*) from predictions r where r.user_id = m.user_id and r.club_id = cid and r.status in ('won', 'lost') and (since is null or r.created_at >= since))::int,
      (select count(*) from predictions r where r.user_id = m.user_id and r.club_id = cid and r.status = 'won' and (since is null or r.created_at >= since))::int
    from club_members m join profiles p on p.id = m.user_id
    where m.club_id = cid and m.status = 'active' and (not p.is_test or public.is_club_admin(cid))
      and exists (select 1 from coin_tx t where t.user_id = m.user_id and t.club_id = cid);
end $$;
grant execute on function public.coin_leaderboard(uuid, timestamptz) to authenticated;

-- бонусы: каждому активному участнику с кошельком — в каждом его клубе отдельно
create or replace function public.coin_bonuses(what text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if what = 'weekly' then
    insert into coin_tx (club_id, user_id, amount, kind)
      select m.club_id, m.user_id, public.pred_setting(m.club_id, 'predWeekly', 100), 'weekly'
      from club_members m join profiles p on p.id = m.user_id join clubs c on c.id = m.club_id
      where m.status = 'active' and not p.is_test and not c.blocked
        and exists (select 1 from coin_tx t where t.user_id = m.user_id and t.club_id = m.club_id);
  elsif what = 'daily' then
    insert into coin_tx (club_id, user_id, amount, kind)
      select m.club_id, m.user_id, public.pred_setting(m.club_id, 'predDaily', 50), 'daily'
      from club_members m join profiles p on p.id = m.user_id join clubs c on c.id = m.club_id
      where m.status = 'active' and not p.is_test and not c.blocked
        and exists (select 1 from coin_tx t where t.user_id = m.user_id and t.club_id = m.club_id)
        and public.coin_balance(m.user_id, m.club_id) <= 0;
  end if;
end $$;
revoke all on function public.coin_bonuses(text) from public, anon, authenticated;

-- ═════════════ Права на вызов функций ═════════════
do $$
declare f text;
begin
  foreach f in array array[
    'create_club(text, text, text, double precision, double precision, boolean, text)', 'update_club(uuid, jsonb)',
    'rotate_invite(uuid)', 'club_by_invite(text)', 'request_join(uuid, text)', 'cancel_request(uuid)',
    'set_member(uuid, uuid, text, text, numeric, boolean)', 'remove_member(uuid, uuid)', 'leave_club(uuid)',
    'transfer_club(uuid, uuid)', 'club_directory(text)', 'club_public(uuid, text)',
    'founder_clubs()', 'founder_stats()', 'founder_block_club(uuid, boolean)', 'founder_delete_club(uuid, text)',
    'founder_unassigned()', 'founder_add_members(uuid, uuid[])', 'founder_transfer_history(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.gen_code(int) from public, anon, authenticated;
revoke all on function public.new_club_code() from public, anon, authenticated;
revoke all on function public.new_invite_code() from public, anon, authenticated;

-- ═════════════ Живые обновления ═════════════
do $$
declare t text;
begin
  foreach t in array array['clubs', 'club_members', 'platform'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
