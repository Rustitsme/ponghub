-- PongHub — миграция 36: скины коллекции можно купить за PC (дорого) — и по-прежнему открыть бесплатно за достижения.
-- Цены — как в js/shop-catalog.js (SKIN_PRICE). Скрипт можно запускать повторно.
update public.shop_items s set price = v.price, for_sale = true
from (values
  ('skin-b1', 25000),
  ('skin-b2', 15000),
  ('skin-b3', 10000),
  ('skin-r1', 10000),
  ('skin-r2', 10000),
  ('skin-t1', 4000),
  ('skin-t2', 6000),
  ('skin-t3', 8000),
  ('skin-t4', 5000),
  ('skin-s1', 4000),
  ('skin-s2', 6000),
  ('skin-s3', 7000),
  ('skin-s4', 9000)
) as v(id, price)
where s.id = v.id;
