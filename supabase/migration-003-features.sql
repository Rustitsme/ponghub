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
