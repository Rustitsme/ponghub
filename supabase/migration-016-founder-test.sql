-- PongHub — миграция 16: тест магазина у создателя перед запуском.
-- Создатель тестирует магазин раньше всех (с тестовыми PC). При «Включить для всех» всё тестовое у него
-- обнуляется: тестовые PC, покупки, бонусы дня, награды, начисления за матчи и турниры, — и он начинает как все.
-- Скрипт можно запускать повторно.

create or replace function public.launch_economy_v2() returns void
language plpgsql security definer set search_path = public as $$
declare f uuid[];
begin
  if (select value from platform where key = 'economy_v2') = 'true'::jsonb then return; end if;
  -- 1. убираем всё, что создатель накопил и купил во время теста
  select coalesce(array_agg(id), '{}') into f from profiles where is_founder;
  delete from coin_tx where user_id = any(f) and kind in ('shop', 'streak', 'match', 'prize')
     or (user_id = any(f) and kind = 'adjust' and ref = '00000000-0000-0000-0000-0000000007e5');
  delete from user_items where user_id = any(f) and source in ('shop', 'reward');
  delete from daily_claims where user_id = any(f);
  delete from league_rewards where user_id = any(f);
  update profiles set loadout = '{"blade": "cn-b1:FL"}' where id = any(f);
  -- 2. балансы всех × 0,3, настройки клубов — старт 300, ставка до 300
  insert into coin_tx (club_id, user_id, amount, kind)
    select club_id, user_id, round(sum(amount) * 0.3)::int - sum(amount)::int, 'convert'
    from coin_tx where club_id is not null
    group by club_id, user_id having sum(amount) > 0;
  update clubs set settings = (coalesce(settings, '{}') - 'predWeekly' - 'predDaily') || '{"predStart": 300, "predMax": 300}';
  update platform set value = 'true' where key = 'economy_v2';
end $$;
revoke all on function public.launch_economy_v2() from public, anon, authenticated;
