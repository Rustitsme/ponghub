-- PongHub — миграция 17: продажа купленных вещей обратно за 30% от цены покупки.
-- За флажком features.resale: сначала только у создателя, у всех — его кнопкой.
-- Продать можно только купленное в магазине (не стартовое и не награды) и не надетое на ракетку.
-- Деньги приходят в клуб, где вещь покупали (если вы ещё в нём), иначе — в текущий.
-- Скрипт можно запускать повторно.

update public.platform set value = coalesce(value, '{}') || '{"resale": "founder"}' where key = 'features' and not (value ? 'resale');

alter table public.coin_tx drop constraint if exists coin_tx_kind_check;
alter table public.coin_tx add constraint coin_tx_kind_check
  check (kind in ('start', 'weekly', 'daily', 'bet', 'payout', 'refund', 'adjust', 'shop', 'streak', 'match', 'prize', 'convert', 'sell'));

create or replace function public.sell_item(cid uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ui user_items; lo jsonb; back int; target uuid;
begin
  if not public.is_member(cid) or not public.feature_on('resale', me) then raise exception 'Продажа пока недоступна'; end if;
  select * into ui from user_items where user_id = me and item_key = p_key;
  if not found then raise exception 'Этой вещи у вас нет'; end if;
  if ui.source <> 'shop' or ui.price <= 0 then raise exception 'Стартовое основание и награды продать нельзя'; end if;
  select coalesce(loadout, '{}') into lo from profiles where id = me;
  if exists (select 1 from jsonb_each_text(lo) where value = p_key) then raise exception 'Сначала снимите эту деталь с ракетки'; end if;
  back := round(ui.price * 0.3);
  target := case when ui.club_id is not null and public.is_member(ui.club_id) then ui.club_id else cid end;
  delete from user_items where user_id = me and item_key = p_key;
  perform public.ensure_wallet(target);
  insert into coin_tx (club_id, user_id, amount, kind) values (target, me, back, 'sell');
  return jsonb_build_object('amount', back, 'club_id', target, 'balance', public.coin_balance(me, cid));
end $$;
revoke all on function public.sell_item(uuid, text) from public, anon;
grant execute on function public.sell_item(uuid, text) to authenticated;

-- при запуске магазина для всех тестовые продажи создателя тоже обнуляются
create or replace function public.launch_economy_v2() returns void
language plpgsql security definer set search_path = public as $$
declare f uuid[];
begin
  if (select value from platform where key = 'economy_v2') = 'true'::jsonb then return; end if;
  select coalesce(array_agg(id), '{}') into f from profiles where is_founder;
  delete from coin_tx where user_id = any(f) and kind in ('shop', 'streak', 'match', 'prize', 'sell')
     or (user_id = any(f) and kind = 'adjust' and ref = '00000000-0000-0000-0000-0000000007e5');
  delete from user_items where user_id = any(f) and source in ('shop', 'reward');
  delete from daily_claims where user_id = any(f);
  delete from league_rewards where user_id = any(f);
  update profiles set loadout = '{"blade": "cn-b1:FL"}' where id = any(f);
  insert into coin_tx (club_id, user_id, amount, kind)
    select club_id, user_id, round(sum(amount) * 0.3)::int - sum(amount)::int, 'convert'
    from coin_tx where club_id is not null
    group by club_id, user_id having sum(amount) > 0;
  update clubs set settings = (coalesce(settings, '{}') - 'predWeekly' - 'predDaily') || '{"predStart": 300, "predMax": 300}';
  update platform set value = 'true' where key = 'economy_v2';
end $$;
revoke all on function public.launch_economy_v2() from public, anon, authenticated;

-- состояние магазина: + цена покупки каждой вещи (для продажи)
-- состояние магазина для текущего игрока; при первом входе — стартовое основание
create or replace function public.shop_state(cid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); last daily_claims; today date := public.moscow_today(); nxt int; lo jsonb;
begin
  if me is null or not public.feature_on('shop', me) then raise exception 'Магазин пока недоступен'; end if;
  if not exists (select 1 from user_items where user_id = me) then
    insert into user_items (user_id, item_key, club_id, price, source) values (me, 'cn-b1:FL', cid, 0, 'starter') on conflict do nothing;
  end if;
  select loadout into lo from profiles where id = me;
  if coalesce(lo->>'blade', '') = '' then
    perform set_config('app.loadout', '1', true);
    update profiles set loadout = coalesce(loadout, '{}') || '{"blade":"cn-b1:FL"}' where id = me;
    select loadout into lo from profiles where id = me;
  end if;
  select * into last from daily_claims where user_id = me order by day desc limit 1;
  nxt := case when last.day = today then last.streak
              when last.day = today - 1 then case when last.streak >= 7 then 1 else last.streak + 1 end
              else 1 end;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(item_key order by created_at) from user_items where user_id = me), '[]'),
    'paid', coalesce((select jsonb_object_agg(item_key, case when source = 'shop' then price else 0 end) from user_items where user_id = me), '{}'),
    'loadout', lo,
    'balance', case when cid is null then 0 else public.ensure_wallet(cid) end,
    'streak', jsonb_build_object('day', nxt, 'claimed', coalesce(last.day = today, false)),
    'rewards', coalesce((select jsonb_object_agg(league, item_key) from league_rewards where user_id = me), '{}')
  );
end $$;

