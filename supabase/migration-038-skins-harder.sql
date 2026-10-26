-- PongHub — миграция 38: коллекция жёстче — новые условия открытия и цены скинов.
-- Кто уже открыл или купил вещь — она остаётся. Условия и цены — как в js/shop-catalog.js. Скрипт можно запускать повторно.
update public.shop_items s set unlock = jsonb_build_object('kind', v.kind, 'n', v.n), price = v.price, for_sale = true
from (values
  ('skin-b1', 'rating', 100, 40000),
  ('skin-b2', 'rating', 70, 25000),
  ('skin-b3', 'wins', 35, 15000),
  ('skin-r1', 'coins', 50000, 15000),
  ('skin-r2', 'wins', 50, 15000),
  ('skin-t1', 'wins', 30, 9000),
  ('skin-t2', 'rating', 75, 12000),
  ('skin-t3', 'wins', 60, 13000),
  ('skin-t4', 'rating', 95, 16000),
  ('skin-s1', 'matches', 60, 8000),
  ('skin-s2', 'wins', 45, 10000),
  ('skin-s3', 'coins', 15000, 11000),
  ('skin-s4', 'wins', 80, 14000)
) as v(id, kind, n, price)
where s.id = v.id;
