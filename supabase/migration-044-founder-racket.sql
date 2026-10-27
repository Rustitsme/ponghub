-- PongHub — миграция 44: личные ракетки создателя «Founder Aurum» (чёрное золото) и «Founder Platinum» (платина).
-- Не продаётся, не открывается за достижения и не выдаётся через «Подарки»: принадлежит только создателю платформы.
-- Скрипт можно запускать повторно.
insert into public.shop_items (id, type, price, variants, for_sale, unlock) values
  ('skin-f1', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, null),
  ('skin-f2', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, null)
on conflict (id) do update set for_sale = false, unlock = null, price = 0;

insert into public.user_items (user_id, item_key, club_id, price, source)
  select p.id, f || ':' || v, null, 0, 'gift'
  from public.profiles p, unnest(array['skin-f1', 'skin-f2']) f, unnest(array['FL', 'ST', 'AN', 'CS']) v
  where p.is_founder
on conflict (user_id, item_key) do nothing;
