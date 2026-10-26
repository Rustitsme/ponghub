-- PongHub — миграция 40: перепроверка скинов, выданных бесплатно за достижения.
-- Раньше условия были легче, и сервер успел выдать скины по старым условиям. Теперь:
-- • все скины коллекции, полученные бесплатно (source = 'reward'), снимаются;
-- • при следующем открытии коллекции сервер сам заново выдаёт те, что заслужены по НОВЫМ условиям;
-- • купленные за PC скины (source = 'shop') не трогаем.
-- Снятые скины убираем и с ракетки/игрока (основание вернётся к стартовому). Скрипт можно запускать повторно.
do $$
begin
  delete from public.user_items where source = 'reward' and item_key like 'skin-%';
  perform set_config('app.loadout', '1', true);   -- разрешаем менять надетое (защита от ручной правки)
  update public.profiles p set loadout = coalesce((
      select jsonb_object_agg(e.key, e.value) from jsonb_each(p.loadout) e
      where not (e.value #>> '{}' like 'skin-%'
                 and not exists (select 1 from public.user_items u where u.user_id = p.id and u.item_key = e.value #>> '{}'))
    ), '{}'::jsonb)
    where p.loadout::text like '%skin-%';
end $$;
