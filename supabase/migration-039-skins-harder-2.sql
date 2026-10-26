-- PongHub — миграция 39: ещё жёстче условия четырёх скинов. Цены не меняются. Скрипт можно запускать повторно.
update public.shop_items s set unlock = jsonb_build_object('kind', v.kind, 'n', v.n)
from (values
  ('skin-r1', 'coins', 170000),
  ('skin-t1', 'wins', 65),
  ('skin-s1', 'matches', 200),
  ('skin-s3', 'coins', 150000)
) as v(id, kind, n)
where s.id = v.id;
