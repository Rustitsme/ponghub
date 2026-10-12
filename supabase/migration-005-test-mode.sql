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
