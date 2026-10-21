-- PongHub — миграция 27: напоминания тем, кто давно не играл.
-- Каждый день в 09:00 UTC (12:00 по Москве) функция notify проверяет игроков всех клубов:
-- 14, 30 и 60 дней без матчей (новичку без матчей — 3 и 10 дней после вступления) — push с предложением вызвать соперника по силам.
-- Выключается в клубе: Управление → Рейтинг → «Напоминания».
-- Перед запуском переразверните функцию notify (supabase/functions/notify). Скрипт можно запускать повторно.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ponghub-idle') then perform cron.unschedule('ponghub-idle'); end if;
end $$;
select cron.schedule('ponghub-idle', '0 9 * * *', $$select public.call_notify('idle')$$);
