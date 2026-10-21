-- PongHub — миграция 25: несколько прогнозов на один матч + уборка зависших прогнозов.
-- • Прогноз нельзя изменить или отменить, но можно поставить ещё — на любого из игроков, по текущему коэффициенту.
-- • Прогнозы на игры, которых уже нет (отменены, удалены, турнир закрыт без матча), закрываются с возвратом ставок.
-- Скрипт можно запускать повторно.

-- снимаем ограничение «один прогноз на матч»
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.predictions'::regclass and contype = 'u' loop
    execute format('alter table public.predictions drop constraint %I', c);
  end loop;
end $$;
create index if not exists predictions_event_user on public.predictions (event_id, user_id);

-- зависшие прогнозы: живой игры больше нет, а приём всё ещё открыт/закрыт без матча — возвращаем ставки
do $$ declare e record; begin
  for e in select pe.id from pred_events pe
    where pe.status in ('open', 'closed') and pe.match_id is null and pe.source = 'live'
      and not exists (select 1 from live_matches l where l.id = pe.source_id and l.status = 'live')
  loop perform public.cancel_pred_event(e.id); end loop;
end $$;

-- живая игра удалена целиком — тоже вернуть ставки
create or replace function public.pred_on_live_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  for eid in select id from pred_events where source = 'live' and source_id = old.id and status in ('open', 'closed') and match_id is null loop
    perform public.cancel_pred_event(eid);
  end loop;
  return old;
end $$;
drop trigger if exists live_pred_delete on public.live_matches;
create trigger live_pred_delete before delete on public.live_matches for each row execute function public.pred_on_live_delete();

select 'M25:' || (select count(*) from pg_constraint where conrelid = 'public.predictions'::regclass and contype = 'u')::text
  || ' open=' || (select count(*) from pred_events where status = 'open')::text as r;
