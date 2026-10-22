-- PongHub — миграция 30: исправление типа матчей.
-- Игры, запущенные «без счёта» (счёт вносится в конце), по ошибке сохранялись как «турнирные», хотя были свободными.
-- Скрипт возвращает им тип «свободная игра»: только матчам вне турниров, у которых живая игра была свободной.
-- Рейтинг пересчитается сам (он всегда считается заново по истории матчей). Скрипт можно запускать повторно.

with fixed as (
  update public.matches m set type = 'free'
  from public.live_matches l
  where l.match_id = m.id and l.type = 'free' and m.type = 'tournament' and m.tournament_id is null
  returning m.id
)
select count(*) as "исправлено матчей" from fixed;
