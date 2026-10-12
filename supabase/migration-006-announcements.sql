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
