-- PongHub — миграция 21: амуниция (носки, напульсники, повязки) в магазине и на 3D-игроке.
-- Цены — как в js/shop-catalog.js. Скрипт можно запускать повторно.

insert into public.shop_items (id, type, price, variants, for_sale) values
  ('wr-k1', 'socks', 250, '{"white":0,"black":0}', true),
  ('wr-k2', 'socks', 450, '{"white":0,"black":0,"blue":0,"red":0}', true),
  ('wr-w1', 'wrist', 300, '{"white":0,"black":0,"red":0,"blue":0}', true),
  ('wr-w2', 'wrist', 550, '{"red":0,"navy":0,"gold":200}', true),
  ('wr-h1', 'head', 350, '{"red":0,"black":0,"white":0,"blue":0}', true),
  ('wr-h2', 'head', 600, '{"orange":0,"lime":0,"pink":0}', true)
on conflict (id) do update set type = excluded.type, price = excluded.price, variants = excluded.variants, for_sale = excluded.for_sale;

create or replace function public.equip_item(p_slot text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text; lo jsonb; wear boolean := p_slot in ('shirt', 'shorts', 'shoes', 'socks', 'wrist', 'head');
begin
  if me is null or p_slot not in ('blade', 'fh', 'bh', 'grip', 'tape', 'shirt', 'shorts', 'shoes', 'socks', 'wrist', 'head') or not public.feature_on('shop', me) then raise exception 'not allowed'; end if;
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
