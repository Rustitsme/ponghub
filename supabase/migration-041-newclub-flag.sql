-- PongHub — миграция 41: создание новых клубов закрыто — пока создатель не откроет.
-- • Нововведение 'newclub' работает как остальные: 'founder' = только создатель и выбранные тестировщики, 'all' = все.
-- • Сейчас ставится 'founder': новые клубы создавать могут только вы и тестировщики. Уже существующие клубы не затрагиваются.
-- • Открыть для всех и закрыть обратно — кнопкой в «Платформа PongHub» → «Обновления».
-- Скрипт можно запускать повторно.

insert into public.platform (key, value) values ('features', '{"newclub": "founder"}') on conflict (key) do nothing;
update public.platform set value = coalesce(value, '{}') || '{"newclub": "founder"}' where key = 'features' and not (value ? 'newclub');

create or replace function public.create_club(p_name text, p_city text, p_address text, p_lat double precision,
                                              p_lng double precision, p_visible boolean, p_description text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if not found or me.status in ('deleted', 'rejected') then raise exception 'not allowed'; end if;
  if not public.feature_on('newclub', auth.uid()) then raise exception 'Создание новых клубов пока закрыто. Скоро откроем'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Введите название клуба'; end if;
  if not me.is_founder and (select count(*) from clubs where owner_id = auth.uid()) >= 10 then
    raise exception 'Можно быть владельцем не более 10 клубов';
  end if;
  insert into clubs (code, name, city, address, lat, lng, visible, description, owner_id, created_by)
  values (public.new_club_code(), trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_address), ''), p_lat, p_lng,
          coalesce(p_visible, true), nullif(trim(p_description), ''), auth.uid(), auth.uid())
  returning id into cid;
  insert into club_invites (club_id, code) values (cid, public.new_invite_code());
  insert into club_members (club_id, user_id, role, status, via) values (cid, auth.uid(), 'owner', 'active', 'created');
  return cid;
end $$;
revoke all on function public.create_club(text, text, text, double precision, double precision, boolean, text) from public, anon;
grant execute on function public.create_club(text, text, text, double precision, double precision, boolean, text) to authenticated;
