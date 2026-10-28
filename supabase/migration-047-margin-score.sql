-- PongHub — миграция 47: поправка на счёт в рейтинге (формула ΔR = K × (S − E) × множитель счёта).
-- Победа всухую весит на 20% больше, победа в решающей партии на 20% меньше. Проигравший, взявший хотя бы одну партию, теряет меньше.
-- Множитель одинаковый для обоих игроков, поэтому правило «сколько взял победитель, столько потерял проигравший» сохраняется.
-- Включается и выключается также в приложении: Управление клубом → Рейтинг → «Учитывать счёт». Скрипт можно запускать повторно.
update public.clubs
   set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('marginBonus', true, 'marginStrength', 0.2)
 where coalesce(settings->>'system', 'league') = 'elo';

select name, settings->>'marginBonus' as margin_bonus, settings->>'marginStrength' as margin_strength from public.clubs;
