-- PongHub — миграция 7: объявление всем или выбранным игрокам.
-- recipients = null — всем; иначе только перечисленным (и владельцу).
alter table public.announcements add column if not exists recipients uuid[];

drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select using (
  public.is_admin()
  or (public.is_approved() and not is_test and (recipients is null or auth.uid() = any(recipients)))
);
