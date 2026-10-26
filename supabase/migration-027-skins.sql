-- PongHub — миграция 27: коллекция скинов за достижения (ракетки, одежда, головные уборы).
-- Скины не продаются (for_sale = false): открываются сами, когда выполнено условие shop_items.unlock.
-- Условия: rating — рейтинг клуба, wins — победы, matches — сыгранные матчи, coins — заработанные PC за всё время.
-- Проверяет и выдаёт Edge Function notify (action claim_skins): рейтинг считается на сервере теми же правилами, что в приложении.
-- Новый слот на игроке — cap (головной убор). Скрипт можно запускать повторно.

alter table public.shop_items add column if not exists unlock jsonb;

insert into public.shop_items (id, type, price, variants, for_sale, unlock) values
  ('skin-b1', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, '{"kind":"rating","n":70}'),
  ('skin-b2', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, '{"kind":"rating","n":55}'),
  ('skin-b3', 'blade', 0, '{"FL":0,"ST":0,"AN":0,"CS":0}', false, '{"kind":"wins","n":10}'),
  ('skin-r1', 'rubber', 0, '{"gold":0}', false, '{"kind":"coins","n":5000}'),
  ('skin-r2', 'rubber', 0, '{"silver":0,"blue":0,"pink":0}', false, '{"kind":"wins","n":50}'),
  ('skin-t1', 'shirt', 0, '{"black":0,"grey":0,"white":0}', false, '{"kind":"wins","n":5}'),
  ('skin-t2', 'shirt', 0, '{"red":0,"blue":0,"black":0}', false, '{"kind":"rating","n":55}'),
  ('skin-t3', 'shirt', 0, '{"red":0,"blue":0,"green":0}', false, '{"kind":"wins","n":25}'),
  ('skin-t4', 'shirt', 0, '{"lime":0,"pink":0,"cyan":0}', false, '{"kind":"rating","n":70}'),
  ('skin-s1', 'shorts', 0, '{"blue":0,"light":0,"black":0}', false, '{"kind":"matches","n":10}'),
  ('skin-s2', 'shorts', 0, '{"red":0,"black":0,"blue":0}', false, '{"kind":"wins","n":15}'),
  ('skin-s3', 'shorts', 0, '{"green":0,"sand":0,"urban":0}', false, '{"kind":"coins","n":2000}'),
  ('skin-s4', 'shorts', 0, '{"blue":0,"black":0}', false, '{"kind":"wins","n":40}'),
  ('skin-c1', 'cap', 0, '{"red":0,"black":0,"white":0,"blue":0}', false, '{"kind":"wins","n":3}'),
  ('skin-c2', 'cap', 0, '{"black":0,"white":0,"gold":0}', false, '{"kind":"wins","n":10}'),
  ('skin-c3', 'cap', 0, '{"navy":0,"red":0,"green":0}', false, '{"kind":"matches","n":25}'),
  ('skin-c4', 'cap', 0, '{"black":0,"grey":0,"orange":0}', false, '{"kind":"coins","n":1000}'),
  ('skin-c5', 'cap', 0, '{"beige":0,"black":0,"green":0}', false, '{"kind":"wins","n":50}')
on conflict (id) do update set type = excluded.type, price = excluded.price, variants = excluded.variants, for_sale = excluded.for_sale, unlock = excluded.unlock;

create or replace function public.equip_item(p_slot text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text; lo jsonb; wear boolean := p_slot in ('shirt', 'shorts', 'shoes', 'socks', 'wrist', 'head', 'cap');
begin
  if me is null or p_slot not in ('blade', 'fh', 'bh', 'grip', 'tape', 'shirt', 'shorts', 'shoes', 'socks', 'wrist', 'head', 'cap') or not public.feature_on('shop', me) then raise exception 'not allowed'; end if;
  if wear and not public.feature_on('avatar', me) then raise exception 'not allowed'; end if;
  if p_key is null then
    if p_slot = 'blade' then raise exception 'Основание снять нельзя'; end if;
  else
    if not exists (select 1 from user_items where user_id = me and item_key = p_key) then raise exception 'Сначала купите эту вещь'; end if;
    select type into t from shop_items where id = split_part(p_key, ':', 1);
    if not ((p_slot = 'blade' and t = 'blade') or (p_slot in ('fh', 'bh') and t = 'rubber') or (p_slot = 'grip' and t = 'grip') or (p_slot = 'tape' and t = 'tape') or (wear and t = p_slot)) then
      raise exception 'Эта вещь сюда не ставится';
    end if;
  end if;
  select coalesce(loadout, '{}') into lo from profiles where id = me;
  if p_slot = 'fh' and lo->>'bh' = p_key then lo := lo - 'bh'; end if;
  if p_slot = 'bh' and lo->>'fh' = p_key then lo := lo - 'fh'; end if;
  lo := case when p_key is null then lo - p_slot else lo || jsonb_build_object(p_slot, p_key) end;
  perform set_config('app.loadout', '1', true);
  update profiles set loadout = lo where id = me;
  return lo;
end $$;
