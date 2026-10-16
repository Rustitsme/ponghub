-- PongHub — миграция 13: поиск клубов и по адресу (не только по названию, городу и ID).
-- Скрипт можно запускать повторно.

create or replace function public.club_directory(q text default null)
returns table (id uuid, code text, name text, city text, address text, lat double precision, lng double precision,
               description text, players int, matches int, created_at timestamptz, my_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  return query
    select c.id, c.code, c.name, c.city, c.address, c.lat, c.lng, c.description,
      (select count(*) from club_members m join profiles p on p.id = m.user_id where m.club_id = c.id and m.status = 'active' and not p.is_test)::int,
      (select count(*) from matches x where x.club_id = c.id and x.status = 'approved' and not x.is_test)::int,
      c.created_at,
      (select m.status from club_members m where m.club_id = c.id and m.user_id = auth.uid())
    from clubs c
    where not c.blocked and (c.visible or exists (select 1 from club_members m where m.club_id = c.id and m.user_id = auth.uid()))
      and (coalesce(trim(q), '') = '' or c.name ilike '%' || trim(q) || '%' or c.code = upper(trim(q))
           or c.code = 'PH-' || upper(trim(q)) or c.city ilike '%' || trim(q) || '%' or c.address ilike '%' || trim(q) || '%')
    order by 9 desc
    limit 200;
end $$;
