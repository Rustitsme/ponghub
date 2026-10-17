-- PongHub — миграция 18: ассортимент торцевых лент (Classic уже есть; добавляются Pro, Carbon, Neon).
-- Цены и доплаты за цвет — как в js/shop-catalog.js. Скрипт можно запускать повторно.

insert into public.shop_items (id, type, price, variants, for_sale) values
  ('acc-t2', 'tape', 220, '{"black":0,"white":0,"red":0,"green":0}', true),
  ('acc-t3', 'tape', 280, '{"graphite":0,"gold":60,"blue":0}', true),
  ('acc-t4', 'tape', 200, '{"lime":0,"pink":0,"cyan":0,"orange":0}', true)
on conflict (id) do update set type = excluded.type, price = excluded.price, variants = excluded.variants, for_sale = excluded.for_sale;
