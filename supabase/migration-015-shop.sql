-- PongHub — миграция 15: магазин и новая экономика пинг-коинов.
--
-- • Магазин: каталог с ценами (shop_items — цены проверяются здесь, а не в приложении), покупки за PC клуба,
--   инвентарь игрока (user_items) и его ракетка (profiles.loadout). Инвентарь общий для всех клубов игрока.
-- • Старт: 300 PC в клубе (было 1000) и бесплатное стартовое основание. Текущие балансы × 0,3 (один раз).
-- • Ежедневная серия: 20 → 30 → 40 → 50 → 60 → 80 → 120, после 7-го дня — снова с 20; пропуск — с начала.
-- • +15 PC за подтверждённый матч (до 3 в день), призы турниров 500 / 300 / 150.
-- • Еженедельные +100 и «+50 при нуле» отменены. Ставка — до 300 PC.
-- • Награды за лиги выдаёт функция notify (проверяет рейтинг на сервере).
-- • ВСЁ ЭТО ЗА ФЛАЖКОМ: пока features.shop = 'founder', магазин и новые бонусы работают только у создателя,
--   у остальных — по-старому. Создатель включает для всех кнопкой (founder_set_feature) — тогда же один раз
--   пересчитываются балансы × 0,3 и меняются настройки клубов (старт 300, ставка до 300).
-- Скрипт можно запускать повторно.

-- ═════════════ Флажки функций: сначала у создателя, потом у всех ═════════════
insert into public.platform (key, value) values ('features', '{"shop": "founder"}') on conflict (key) do nothing;
update public.platform set value = coalesce(value, '{}') || '{"shop": "founder"}' where key = 'features' and not (value ? 'shop');

create or replace function public.feature_on(fname text, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce((select value->>fname from platform where key = 'features'), 'all')
    when 'all' then true
    when 'founder' then coalesce((select is_founder from profiles where id = uid), false)
    else false end;
$$;

-- ═════════════ Каталог ═════════════
create table if not exists public.shop_items (
  id text primary key,
  type text not null,
  price int not null,
  variants jsonb not null default '{}',   -- вариант (цвет / форма ручки) → доплата
  for_sale boolean not null default true
);
alter table public.shop_items enable row level security;
drop policy if exists shop_items_select on public.shop_items;
create policy shop_items_select on public.shop_items for select to authenticated using (true);

insert into public.shop_items (id, type, price, variants, for_sale) values
  ('cn-b1', 'blade', 1200, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('cn-b2', 'blade', 1550, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('cn-b3', 'blade', 1950, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('cn-b4', 'blade', 2750, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('cn-b5', 'blade', 3950, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('cn-r1', 'rubber', 600, '{"red":0,"black":0,"blue":60}', true),
  ('cn-r2', 'rubber', 650, '{"red":0,"black":0,"blue":60}', true),
  ('cn-r3', 'rubber', 750, '{"red":0,"black":0,"blue":60}', true),
  ('cn-r4', 'rubber', 950, '{"red":0,"black":0,"blue":60}', true),
  ('cn-r5', 'rubber', 1300, '{"red":0,"black":0,"blue":60}', true),
  ('eu-b1', 'blade', 1650, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('eu-b2', 'blade', 2200, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('eu-b3', 'blade', 3000, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('eu-b4', 'blade', 4150, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('eu-b5', 'blade', 6000, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('eu-r1', 'rubber', 750, '{"red":0,"black":0,"blue":60}', true),
  ('eu-r2', 'rubber', 850, '{"red":0,"black":0,"blue":60}', true),
  ('eu-r3', 'rubber', 1050, '{"red":0,"black":0,"blue":60}', true),
  ('eu-r4', 'rubber', 1200, '{"red":0,"black":0,"blue":60}', true),
  ('eu-r5', 'rubber', 1450, '{"red":0,"black":0,"blue":60}', true),
  ('jp-b1', 'blade', 1900, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('jp-b2', 'blade', 2450, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('jp-b3', 'blade', 3300, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('jp-b4', 'blade', 6200, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('jp-b5', 'blade', 9200, '{"FL":0,"ST":60,"AN":100,"CS":150}', true),
  ('jp-r1', 'rubber', 900, '{"red":0,"black":0,"blue":60}', true),
  ('jp-r2', 'rubber', 1000, '{"red":0,"black":0,"blue":60}', true),
  ('jp-r3', 'rubber', 950, '{"red":0,"black":0,"blue":60}', true),
  ('jp-r4', 'rubber', 1450, '{"red":0,"black":0,"blue":60}', true),
  ('jp-r5', 'rubber', 2000, '{"red":0,"black":0,"blue":60}', true),
  ('acc-g1', 'grip', 180, '{"blue":0,"white":0,"red":0}', true),
  ('acc-g2', 'grip', 250, '{"black":0,"red":0,"mint":0,"pink":0}', true),
  ('acc-g3', 'grip', 400, '{"brown":0,"black":0,"gold":150}', true),
  ('acc-t1', 'tape', 150, '{"black":0,"blue":0,"red":0,"silver":50}', true),
  ('acc-b1', 'ball', 180, '{"white":0,"orange":0}', true),
  ('acc-b2', 'ball', 250, '{"white":0}', true),
  ('acc-b3', 'ball', 400, '{"white":0}', true),
  ('acc-c1', 'case', 450, '{"navy":0,"black":0,"red":0}', true),
  ('acc-c2', 'case', 1050, '{"black":0,"white":0,"carbon":200}', true),
  ('wr-t1', 'shirt', 900, '{"white":0,"black":0,"red":0}', true),
  ('wr-t2', 'shirt', 1100, '{"blue":0,"red":0,"black":0}', true),
  ('wr-t3', 'shirt', 1350, '{"blue":0,"white":0,"yellow":0}', true),
  ('wr-t4', 'shirt', 1500, '{"blue":0,"yellow":0,"black":0}', true),
  ('wr-t5', 'shirt', 1650, '{"orange":0,"black":0}', true),
  ('wr-t6', 'shirt', 1900, '{"white":0,"navy":0,"red":0,"gold":400}', true),
  ('wr-t7', 'shirt', 2300, '{"red":0,"yellow":0}', true),
  ('wr-s1', 'shorts', 700, '{"black":0,"navy":0}', true),
  ('wr-s2', 'shorts', 950, '{"black":0,"blue":0}', true),
  ('wr-s3', 'shorts', 1050, '{"blue":0,"black":0}', true),
  ('wr-s4', 'shorts', 1300, '{"black":0,"navy":0,"white":0}', true),
  ('wr-s5', 'shorts', 1550, '{"red":0}', true),
  ('wr-f1', 'shoes', 2900, '{"wb":0,"black":0}', true),
  ('wr-f2', 'shoes', 3300, '{"wb":0,"navy":0}', true),
  ('wr-f3', 'shoes', 3800, '{"white":0,"purple":0}', true),
  ('wr-f4', 'shoes', 5200, '{"wb":0,"bg":500}', true),
  ('wr-f5', 'shoes', 6300, '{"wr":0,"neon":500}', true),
  ('rw-tape-gold', 'tape', 0, '{"gold":0}', false)
on conflict (id) do update set type = excluded.type, price = excluded.price, variants = excluded.variants, for_sale = excluded.for_sale;

-- ═════════════ Инвентарь, ракетка, серия, награды ═════════════
create table if not exists public.user_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_key text not null,                      -- 'cn-b3:FL', 'cn-r5:blue', 'wr-t6:gold'
  club_id uuid references public.clubs(id) on delete set null,
  price int not null default 0,
  source text not null default 'shop' check (source in ('shop', 'starter', 'reward')),
  created_at timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table public.user_items enable row level security;
drop policy if exists user_items_select on public.user_items;
create policy user_items_select on public.user_items for select using (user_id = auth.uid());

alter table public.profiles add column if not exists loadout jsonb not null default '{}';

create table if not exists public.daily_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  streak int not null,
  amount int not null,
  club_id uuid references public.clubs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.daily_claims enable row level security;
drop policy if exists daily_claims_select on public.daily_claims;
create policy daily_claims_select on public.daily_claims for select using (user_id = auth.uid());

create table if not exists public.league_rewards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  league text not null check (league in ('silver', 'gold', 'platinum', 'diamond')),
  item_key text not null,
  club_id uuid references public.clubs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, league)
);
alter table public.league_rewards enable row level security;
drop policy if exists league_rewards_select on public.league_rewards;
create policy league_rewards_select on public.league_rewards for select using (user_id = auth.uid());

-- новые виды операций с пинг-коинами
alter table public.coin_tx drop constraint if exists coin_tx_kind_check;
alter table public.coin_tx add constraint coin_tx_kind_check
  check (kind in ('start', 'weekly', 'daily', 'bet', 'payout', 'refund', 'adjust', 'shop', 'streak', 'match', 'prize', 'convert'));

-- ракетку (loadout) меняет только equip_item / сервер
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.is_founder() then
    new.role := old.role;
    new.status := old.status;
    new.initial_rating := old.initial_rating;
    new.is_founder := old.is_founder;
    new.legacy := old.legacy;
    new.is_test := old.is_test;
    if new.telegram_id is distinct from old.telegram_id and new.telegram_id is not null then new.telegram_id := old.telegram_id; end if;
    if new.telegram_id is null then new.telegram_username := null; else new.telegram_username := old.telegram_username; end if;
    if coalesce(current_setting('app.loadout', true), '') <> '1' then new.loadout := old.loadout; end if;
  end if;
  if old.id = auth.uid() and old.is_founder then new.is_founder := true; end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

-- ═════════════ Кошелёк: старт 300, стартовое основание ═════════════
create or replace function public.ensure_wallet(cid uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(cid) then return 0; end if;
  if not exists (select 1 from coin_tx where user_id = auth.uid() and club_id = cid and kind in ('start', 'convert')) then
    insert into coin_tx (club_id, user_id, amount, kind) values (cid, auth.uid(), public.pred_setting(cid, 'predStart', 300), 'start');
  end if;
  return public.coin_balance(auth.uid(), cid);
end $$;

create or replace function public.moscow_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Moscow')::date $$;

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
    'loadout', lo,
    'balance', case when cid is null then 0 else public.ensure_wallet(cid) end,
    'streak', jsonb_build_object('day', nxt, 'claimed', coalesce(last.day = today, false)),
    'rewards', coalesce((select jsonb_object_agg(league, item_key) from league_rewards where user_id = me), '{}')
  );
end $$;

-- покупка: цена и вариант — из shop_items; списание — с кошелька клуба
create or replace function public.buy_item(cid uuid, p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); it shop_items; vid text := split_part(p_key, ':', 1); var text := split_part(p_key, ':', 2); price int; bal int;
begin
  if not public.is_member(cid) or not public.feature_on('shop', me) then raise exception 'not allowed'; end if;
  select * into it from shop_items where id = vid;
  if not found or not it.for_sale then raise exception 'Этот предмет не продаётся'; end if;
  if not (it.variants ? var) then raise exception 'Нет такого варианта'; end if;
  if exists (select 1 from user_items where user_id = me and item_key = p_key) then raise exception 'Уже куплено'; end if;
  price := it.price + coalesce((it.variants->>var)::int, 0);
  perform public.ensure_wallet(cid);
  bal := public.coin_balance(me, cid);
  if bal < price then raise exception 'Не хватает % PC', price - bal; end if;
  insert into user_items (user_id, item_key, club_id, price, source) values (me, p_key, cid, price, 'shop');
  insert into coin_tx (club_id, user_id, amount, kind) values (cid, me, -price, 'shop');
  return bal - price;
end $$;

-- поставить деталь на ракетку: blade / fh / bh / grip / tape (null — снять, кроме основания)
create or replace function public.equip_item(p_slot text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text; lo jsonb;
begin
  if me is null or p_slot not in ('blade', 'fh', 'bh', 'grip', 'tape') or not public.feature_on('shop', me) then raise exception 'not allowed'; end if;
  if p_key is null then
    if p_slot = 'blade' then raise exception 'Основание снять нельзя'; end if;
  else
    if not exists (select 1 from user_items where user_id = me and item_key = p_key) then raise exception 'Сначала купите эту деталь'; end if;
    select type into t from shop_items where id = split_part(p_key, ':', 1);
    if not ((p_slot = 'blade' and t = 'blade') or (p_slot in ('fh', 'bh') and t = 'rubber') or (p_slot = 'grip' and t = 'grip') or (p_slot = 'tape' and t = 'tape')) then
      raise exception 'Эта деталь сюда не ставится';
    end if;
  end if;
  select coalesce(loadout, '{}') into lo from profiles where id = me;
  -- одна накладка — одна сторона
  if p_slot = 'fh' and lo->>'bh' = p_key then lo := lo - 'bh'; end if;
  if p_slot = 'bh' and lo->>'fh' = p_key then lo := lo - 'fh'; end if;
  lo := case when p_key is null then lo - p_slot else lo || jsonb_build_object(p_slot, p_key) end;
  perform set_config('app.loadout', '1', true);
  update profiles set loadout = lo where id = me;
  return lo;
end $$;

-- ежедневный бонус: серия до 7 дней, затем заново
create or replace function public.claim_daily(cid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); last daily_claims; today date := public.moscow_today(); n int; amt int;
  arr int[] := array[20, 30, 40, 50, 60, 80, 120];
begin
  if not public.is_member(cid) or not public.feature_on('shop', me) then raise exception 'not allowed'; end if;
  select * into last from daily_claims where user_id = me order by day desc limit 1;
  if last.day = today then raise exception 'Бонус за сегодня уже получен — приходите завтра'; end if;
  n := case when last.day = today - 1 and last.streak < 7 then last.streak + 1 else 1 end;
  amt := arr[n];
  perform public.ensure_wallet(cid);
  insert into daily_claims (user_id, day, streak, amount, club_id) values (me, today, n, amt, cid);
  insert into coin_tx (club_id, user_id, amount, kind) values (cid, me, amt, 'streak');
  return jsonb_build_object('streak', n, 'amount', amt, 'balance', public.coin_balance(me, cid));
end $$;

-- +15 PC каждому игроку подтверждённого матча (до 3 матчей в день в клубе)
create or replace function public.coin_on_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare p uuid; day0 timestamptz := (public.moscow_today()::timestamp at time zone 'Europe/Moscow');
begin
  if new.club_id is null or new.is_test or new.status <> 'approved' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then return new; end if;
  if current_setting('app.bulk', true) = '1' then return new; end if;
  foreach p in array array[new.player1_id, new.player2_id, new.player3_id, new.player4_id] loop
    continue when p is null or not public.feature_on('shop', p);
    if (select count(*) from coin_tx where user_id = p and club_id = new.club_id and kind = 'match' and created_at >= day0) < 3 then
      insert into coin_tx (club_id, user_id, amount, kind, ref) values (new.club_id, p, 15, 'match', new.id);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists match_coins on public.matches;
create trigger match_coins after insert or update of status on public.matches for each row execute function public.coin_on_match();

-- призы турнира: 1-е место 500, 2-е 300, 3-е 150
create or replace function public.coin_on_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := new.results; b jsonb; p uuid;
begin
  if new.club_id is null or new.is_test or new.status <> 'finished' or old.status = 'finished' or r is null then return new; end if;
  -- призы — только тем, у кого включена новая экономика
  if r->>'gold' is not null and not public.feature_on('shop', (r->>'gold')::uuid) then r := r - 'gold'; end if;
  if r->>'silver' is not null and not public.feature_on('shop', (r->>'silver')::uuid) then r := r - 'silver'; end if;
  if r->>'gold' is not null then
    insert into coin_tx (club_id, user_id, amount, kind, ref) select new.club_id, (r->>'gold')::uuid, 500, 'prize', new.id
      where not exists (select 1 from coin_tx where kind = 'prize' and ref = new.id and user_id = (r->>'gold')::uuid);
  end if;
  if r->>'silver' is not null then
    insert into coin_tx (club_id, user_id, amount, kind, ref) select new.club_id, (r->>'silver')::uuid, 300, 'prize', new.id
      where not exists (select 1 from coin_tx where kind = 'prize' and ref = new.id and user_id = (r->>'silver')::uuid);
  end if;
  b := r->'bronze';
  if b is not null and jsonb_typeof(b) = 'array' then
    for p in select (x #>> '{}')::uuid from jsonb_array_elements(b) x loop
      continue when not public.feature_on('shop', p);
      insert into coin_tx (club_id, user_id, amount, kind, ref) select new.club_id, p, 150, 'prize', new.id
        where not exists (select 1 from coin_tx where kind = 'prize' and ref = new.id and user_id = p);
    end loop;
  elsif b is not null and jsonb_typeof(b) = 'string' and public.feature_on('shop', (b #>> '{}')::uuid) then
    insert into coin_tx (club_id, user_id, amount, kind, ref) select new.club_id, (b #>> '{}')::uuid, 150, 'prize', new.id
      where not exists (select 1 from coin_tx where kind = 'prize' and ref = new.id and user_id = (b #>> '{}')::uuid);
  end if;
  return new;
end $$;
drop trigger if exists tournament_coins on public.tournaments;
create trigger tournament_coins after update of status on public.tournaments for each row execute function public.coin_on_tournament();

-- еженедельные и «при нуле» бонусы: пока магазин не включён для всех — работают по-старому (кроме создателя)
create or replace function public.coin_bonuses(what text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select value->>'shop' from platform where key = 'features'), 'all') = 'all' then return; end if;
  if what = 'weekly' then
    insert into coin_tx (club_id, user_id, amount, kind)
      select m.club_id, m.user_id, public.pred_setting(m.club_id, 'predWeekly', 100), 'weekly'
      from club_members m join profiles p on p.id = m.user_id join clubs c on c.id = m.club_id
      where m.status = 'active' and not p.is_test and not p.is_founder and not c.blocked
        and exists (select 1 from coin_tx t where t.user_id = m.user_id and t.club_id = m.club_id);
  elsif what = 'daily' then
    insert into coin_tx (club_id, user_id, amount, kind)
      select m.club_id, m.user_id, public.pred_setting(m.club_id, 'predDaily', 50), 'daily'
      from club_members m join profiles p on p.id = m.user_id join clubs c on c.id = m.club_id
      where m.status = 'active' and not p.is_test and not p.is_founder and not c.blocked
        and exists (select 1 from coin_tx t where t.user_id = m.user_id and t.club_id = m.club_id)
        and public.coin_balance(m.user_id, m.club_id) <= 0;
  end if;
end $$;

-- включение для всех (один раз): балансы × 0,3, настройки клубов — старт 300, ставка до 300
create or replace function public.launch_economy_v2() returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select value from platform where key = 'economy_v2') = 'true'::jsonb then return; end if;
  insert into coin_tx (club_id, user_id, amount, kind)
    select club_id, user_id, round(sum(amount) * 0.3)::int - sum(amount)::int, 'convert'
    from coin_tx where club_id is not null
    group by club_id, user_id having sum(amount) > 0;
  update clubs set settings = (coalesce(settings, '{}') - 'predWeekly' - 'predDaily') || '{"predStart": 300, "predMax": 300}';
  update platform set value = 'true' where key = 'economy_v2';
end $$;
revoke all on function public.launch_economy_v2() from public, anon, authenticated;

-- создатель: включить функцию только себе ('founder') или всем ('all')
create or replace function public.founder_set_feature(fname text, mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then raise exception 'not allowed'; end if;
  if mode not in ('founder', 'all') then raise exception 'Неизвестный режим'; end if;
  if fname = 'shop' and mode = 'all' then perform public.launch_economy_v2(); end if;
  update platform set value = coalesce(value, '{}') || jsonb_build_object(fname, mode) where key = 'features';
  return (select value from platform where key = 'features');
end $$;

insert into public.platform (key, value) values ('economy_v2', 'false') on conflict (key) do nothing;

do $$
declare f text;
begin
  foreach f in array array['shop_state(uuid)', 'buy_item(uuid, text)', 'equip_item(text, text)', 'claim_daily(uuid)', 'founder_set_feature(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.coin_on_match() from public, anon, authenticated;
revoke all on function public.coin_on_tournament() from public, anon, authenticated;
