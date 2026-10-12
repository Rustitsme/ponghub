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
