-- PongHub — миграция 46: рейтинг клуба переводится на классическую систему Эло.
-- Победитель получает ровно столько, сколько теряет проигравший (у равных: свободная игра +2 / −2, турнир +3 / −3).
-- Масштаб 40: разница в 40 очков — сильный выигрывает в ~91% игр. Без бонуса новичкам и без поправки на счёт.
-- Рейтинг нигде не хранится, а считается по истории матчей, поэтому после включения все рейтинги пересчитаются сами.
-- Меняются только клубы, где сейчас стоит «как в лиге» (или система не выбрана). Скрипт можно запускать повторно.
update public.clubs
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
     'system', 'elo', 'spread', 40, 'kFree', 4, 'kTournament', 6, 'newcomerMult', 1, 'marginBonus', false)
 where coalesce(settings->>'system', 'league') <> 'elo';

select name, settings->>'system' as system, settings->>'spread' as spread, settings->>'kFree' as k_free, settings->>'kTournament' as k_tournament from public.clubs;
