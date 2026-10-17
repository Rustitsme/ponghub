-- PongHub — миграция 14: табло клуба для телевизора и правило секунданта.
--
-- Табло — устройство без аккаунта: открывает /#/tv, получает секретный токен и код из 6 цифр.
-- Владелец клуба вводит код в «Управлении → Табло» — табло привязано к клубу.
-- Данные табло получает только через screen_state(токен): текущие игры, итоги, прогнозы, сетку, рейтинг.
-- Изменить табло ничего не может.
-- Скрипт можно запускать повторно.

create table if not exists public.club_screens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  pair_code text unique,
  club_id uuid references public.clubs(id) on delete cascade,
  name text not null default 'Табло',
  theme text not null default 'night' check (theme in ('night', 'table', 'red', 'green', 'graphite', 'light')),
  created_at timestamptz not null default now(),
  paired_at timestamptz,
  last_seen timestamptz
);
alter table public.club_screens enable row level security;
drop policy if exists screens_select on public.club_screens;
create policy screens_select on public.club_screens for select using (public.is_club_admin(club_id));
revoke insert, update, delete on public.club_screens from anon, authenticated;

-- 1. Телевизор: новый токен и код для привязки
create or replace function public.screen_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; c text; n int := 0;
begin
  delete from club_screens where club_id is null and created_at < now() - interval '1 day';
  if (select count(*) from club_screens where club_id is null and created_at > now() - interval '10 minutes') > 200 then
    raise exception 'Слишком много запросов, попробуйте позже';
  end if;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from club_screens where pair_code = c);
    n := n + 1; if n > 50 then raise exception 'Попробуйте ещё раз'; end if;
  end loop;
  insert into club_screens (token, pair_code) values (t, c);
  return jsonb_build_object('token', t, 'code', c);
end $$;

-- 2. Владелец клуба вводит код с экрана телевизора
create or replace function public.screen_pair(cid uuid, p_code text, p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  update club_screens set club_id = cid, pair_code = null, paired_at = now(),
         name = coalesce(nullif(trim(p_name), ''), name)
   where pair_code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g') and club_id is null
     and created_at > now() - interval '1 day'
  returning id into sid;
  if sid is null then raise exception 'Код не найден. Проверьте цифры на экране телевизора'; end if;
  return sid;
end $$;

create or replace function public.screen_set(sid uuid, p_theme text default null, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select club_id into cid from club_screens where id = sid;
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  update club_screens set theme = coalesce(p_theme, theme), name = coalesce(nullif(trim(p_name), ''), name) where id = sid;
end $$;

create or replace function public.screen_remove(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select club_id into cid from club_screens where id = sid;
  if not public.is_club_admin(cid) then raise exception 'not allowed'; end if;
  delete from club_screens where id = sid;
end $$;

-- 3. Всё, что показывает табло. full = true — ещё и игроки, матчи, турниры (для рейтинга и сетки)
create or replace function public.screen_state(p_token text, p_full boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s club_screens; c clubs; res jsonb; recent live_matches;
begin
  select * into s from club_screens where token = p_token;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if s.club_id is null then return jsonb_build_object('status', 'pairing', 'code', s.pair_code); end if;
  select * into c from clubs where id = s.club_id;
  if c.blocked then return jsonb_build_object('status', 'blocked'); end if;
  if s.last_seen is null or s.last_seen < now() - interval '1 minute' then
    update club_screens set last_seen = now() where id = s.id;
  end if;

  -- последняя завершённая игра (для экрана итогов, ~1 минута)
  select * into recent from live_matches
   where club_id = s.club_id and not is_test and status = 'finished' and updated_at > now() - interval '75 seconds'
   order by updated_at desc limit 1;

  res := jsonb_build_object(
    'status', 'ok',
    'now', now(),
    'screen', jsonb_build_object('id', s.id, 'name', s.name, 'theme', s.theme),
    'club', jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code),
    'live', coalesce((select jsonb_agg(to_jsonb(l) order by l.updated_at desc) from live_matches l
                       where l.club_id = s.club_id and not l.is_test and l.status = 'live'), '[]'),
    'recent', case when recent.id is null then null else to_jsonb(recent) end,
    'recent_match', case when recent.match_id is null then null else
                      (select to_jsonb(m) from matches m where m.id = recent.match_id) end,
    'preds', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', e.id, 'source_id', e.source_id, 'status', e.status, 'odds1', e.odds1, 'odds2', e.odds2,
                 'pool1', e.pool1, 'pool2', e.pool2, 'bets', e.bets_count, 'winner_side', e.winner_side,
                 'count1', (select count(*) from predictions p where p.event_id = e.id and p.side = 1),
                 'count2', (select count(*) from predictions p where p.event_id = e.id and p.side = 2),
                 'winners', coalesce((select jsonb_agg(jsonb_build_object('nick', pr.nickname, 'stake', p.stake, 'odds', p.odds, 'payout', p.payout) order by p.payout desc)
                              from (select * from predictions p where p.event_id = e.id and p.status = 'won' order by p.payout desc limit 6) p
                              join profiles pr on pr.id = p.user_id), '[]')))
               from pred_events e where e.club_id = s.club_id and not e.is_test
                 and e.source_id in (select id from live_matches where club_id = s.club_id and (status = 'live' or id = recent.id))), '[]'),
    'next', coalesce((select jsonb_agg(jsonb_build_object('a', ch.from_id, 'b', ch.to_id) order by ch.responded_at)
               from challenges ch where ch.club_id = s.club_id and not ch.is_test and ch.status = 'accepted'), '[]')
  );

  if p_full then
    res := res || jsonb_build_object(
      'settings', c.settings,
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'nickname', p.nickname, 'avatar', p.avatar, 'color', p.color, 'photo_url', p.photo_url,
          'initial_rating', m.initial_rating, 'created_at', p.created_at,
          'status', case when p.status = 'deleted' then 'deleted' when m.status = 'active' then 'approved' else 'archived' end))
        from club_members m join profiles p on p.id = m.user_id
        where m.club_id = s.club_id and m.status in ('active', 'archived', 'former') and not p.is_test), '[]'),
      'matches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'played_at', x.played_at, 'created_at', x.created_at, 'type', x.type, 'kind', x.kind,
          'tournament_id', x.tournament_id, 'stage', x.stage, 'grp', x.grp, 'round', x.round, 'slot', x.slot,
          'player1_id', x.player1_id, 'player2_id', x.player2_id, 'player3_id', x.player3_id, 'player4_id', x.player4_id,
          'sets', x.sets, 'sets1', x.sets1, 'sets2', x.sets2, 'winner_id', x.winner_id, 'rated', x.rated,
          'best_of', x.best_of, 'points_to', x.points_to, 'status', x.status))
        from matches x where x.club_id = s.club_id and x.status = 'approved' and not x.is_test), '[]'),
      'tournaments', coalesce((select jsonb_agg(to_jsonb(t) - 'created_by') from tournaments t
        where t.club_id = s.club_id and not t.is_test and (t.status = 'active' or t.created_at > now() - interval '2 days')), '[]')
    );
  end if;
  return res;
end $$;

revoke all on function public.screen_start() from public;
grant execute on function public.screen_start() to anon, authenticated;
revoke all on function public.screen_state(text, boolean) from public;
grant execute on function public.screen_state(text, boolean) to anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['screen_pair(uuid, text, text)', 'screen_set(uuid, text, text)', 'screen_remove(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Секундант: менять живую игру может тот, кто ведёт счёт, кто её начал, владелец и помощник.
-- Остальные участники только смотрят (перехватить счёт — «Взять счёт на себя» — могут те же).
drop policy if exists live_update on public.live_matches;
create policy live_update on public.live_matches for update
  using (public.is_member(club_id) and (scorer_id = auth.uid() or started_by = auth.uid() or scorer_id is null or public.is_club_editor(club_id)))
  with check (public.is_member(club_id));

-- время последнего изменения живой игры — всегда точное (табло по нему понимает, что матч только что закончился)
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists live_touch on public.live_matches;
create trigger live_touch before update on public.live_matches for each row execute function public.touch_updated_at();
