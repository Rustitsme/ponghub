-- PongHub — миграция 12: вход и регистрация через Telegram, привязка Telegram к аккаунту.
-- Как работает: приложение получает одноразовый код → человек открывает бота t.me/<бот>?start=<код> и жмёт «Старт» →
-- бот (функция tg) запоминает, кто это → приложение обменивает код на вход в аккаунт.
-- Всё, что связано с кодами, делает только функция tg (служебный доступ); приложению таблица не видна.
-- Скрипт можно запускать повторно.

alter table public.profiles add column if not exists telegram_id bigint;
alter table public.profiles add column if not exists telegram_username text;
create unique index if not exists profiles_telegram_uq on public.profiles (telegram_id) where telegram_id is not null;

create table if not exists public.tg_logins (
  token text primary key,
  purpose text not null check (purpose in ('login', 'link')),
  user_id uuid references public.profiles(id) on delete cascade,   -- для привязки: чей аккаунт
  tg_id bigint,
  tg_username text,
  tg_name text,
  status text not null default 'new' check (status in ('new', 'confirmed', 'used', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
alter table public.tg_logins enable row level security;
revoke all on public.tg_logins from anon, authenticated;

-- Telegram-поля профиля меняет только функция tg (служебный доступ) или создатель
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- изменения из панели Supabase / служебных функций
  if not public.is_founder() then
    new.role := old.role;
    new.status := old.status;
    new.initial_rating := old.initial_rating;
    new.is_founder := old.is_founder;
    new.legacy := old.legacy;
    new.is_test := old.is_test;
    -- отвязать свой Telegram можно, привязать — только через бота
    if new.telegram_id is distinct from old.telegram_id and new.telegram_id is not null then new.telegram_id := old.telegram_id; end if;
    if new.telegram_id is null then new.telegram_username := null; else new.telegram_username := old.telegram_username; end if;
  end if;
  if old.id = auth.uid() and old.is_founder then new.is_founder := true; end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

-- старые коды чистим раз в сутки
create or replace function public.tg_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from tg_logins where created_at < now() - interval '1 day';
$$;
revoke all on function public.tg_cleanup() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ponghub-tg-cleanup') then perform cron.unschedule('ponghub-tg-cleanup'); end if;
end $$;
select cron.schedule('ponghub-tg-cleanup', '30 3 * * *', $$select public.tg_cleanup()$$);
