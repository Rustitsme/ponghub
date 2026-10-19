-- PongHub — миграция 22: лицо 3D-игрока по селфи.
-- profiles.face — ссылка на картинку лица (делает Edge Function face через Gemini), face_day/face_n — счётчик попыток в день.
-- Хранилище faces — публичное чтение, запись только через функцию. Табло получает face вместе с остальным.
-- Скрипт можно запускать повторно.

alter table public.profiles add column if not exists face text;
alter table public.profiles add column if not exists face_day date;
alter table public.profiles add column if not exists face_n int not null default 0;
insert into storage.buckets (id, name, public) values ('faces', 'faces', true) on conflict (id) do update set public = true;

create or replace function public.screen_avatars(p_token text, ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  select club_id into cid from club_screens where token = p_token;
  if cid is null then return jsonb_build_object('players', '[]'::jsonb); end if;
  return jsonb_build_object(
    'grip', coalesce((select value from platform where key = 'grip'), '{}'),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'avatar3d', p.avatar3d, 'face', p.face, 'loadout', coalesce(p.loadout, '{}'), 'on', public.feature_on('avatar', p.id)))
      from profiles p
      where p.id = any(ids) and exists (select 1 from club_members m where m.user_id = p.id and m.club_id = cid)
    ), '[]'));
end $$;
revoke all on function public.screen_avatars(text, uuid[]) from public;
grant execute on function public.screen_avatars(text, uuid[]) to anon, authenticated;
