-- PongHub — миграция 20: 3D-игроки на табло (выход перед матчем, жест победителя).
-- Табло (без входа, по токену) получает для игроков матча: какого 3D-игрока они выбрали, их форму и ракетку,
-- открыт ли им 3D-игрок (флажок avatar) и общий хват ракетки. Только игроки клуба этого табло.
-- Скрипт можно запускать повторно.

create or replace function public.screen_avatars(p_token text, ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  select club_id into cid from club_screens where token = p_token;
  if cid is null then return jsonb_build_object('players', '[]'::jsonb); end if;
  return jsonb_build_object(
    'grip', coalesce((select value from platform where key = 'grip'), '{}'),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'avatar3d', p.avatar3d, 'loadout', coalesce(p.loadout, '{}'), 'on', public.feature_on('avatar', p.id)))
      from profiles p
      where p.id = any(ids) and exists (select 1 from club_members m where m.user_id = p.id and m.club_id = cid)
    ), '[]'));
end $$;
revoke all on function public.screen_avatars(text, uuid[]) from public;
grant execute on function public.screen_avatars(text, uuid[]) to anon, authenticated;
