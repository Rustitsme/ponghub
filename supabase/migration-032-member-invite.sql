-- PongHub — миграция 32: приглашать в клуб может каждый участник.
-- Участник получает QR / ссылку вступления в свой клуб (тот же код приглашения клуба).
-- Друг регистрируется — заявка в клуб уходит сама, а принимает её владелец, как обычно.
-- Сменить код по-прежнему может только владелец. Скрипт можно запускать повторно.

create or replace function public.club_invite_code(cid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_member(cid) then raise exception 'Пригласить может только участник клуба'; end if;
  select code into c from club_invites where club_id = cid;
  if c is null then
    c := public.new_invite_code();
    insert into club_invites (club_id, code) values (cid, c) on conflict (club_id) do nothing;
    select code into c from club_invites where club_id = cid;
  end if;
  return c;
end $$;
revoke all on function public.club_invite_code(uuid) from public, anon;
grant execute on function public.club_invite_code(uuid) to authenticated;
