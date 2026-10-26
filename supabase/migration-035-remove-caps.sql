-- PongHub — миграция 35: головные уборы (кепки, шапка, панама) убраны из коллекции скинов.
-- Скрипт можно запускать повторно.
delete from public.user_items where item_key like 'skin-c%';
update public.profiles set loadout = loadout - 'cap' where loadout ? 'cap';
delete from public.shop_items where id like 'skin-c%';
