-- PongHub — миграция 29: прогнозы другого игрока.
-- В «Прогнозах» можно нажать на игрока в таблице лучших прогнозистов и посмотреть, на какие матчи и как он ставил.
-- Сами прогнозы по-прежнему закрыты правилами доступа; эта функция отдаёт их только участникам того же клуба
-- и только по матчам этого клуба (тестовые — только владельцу). Скрипт можно запускать повторно.

create or replace function public.player_predictions(cid uuid, uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(cid) then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
        'id', p.id, 'side', p.side, 'stake', p.stake, 'odds', p.odds, 'payout', p.payout, 'status', p.status, 'created_at', p.created_at,
        'event', jsonb_build_object('id', e.id, 'player1_id', e.player1_id, 'player2_id', e.player2_id, 'player3_id', e.player3_id, 'player4_id', e.player4_id,
                                    'winner_side', e.winner_side, 'status', e.status)) as x
      from predictions p join pred_events e on e.id = p.event_id
      where p.user_id = uid and e.club_id = cid and (not e.is_test or public.is_club_admin(cid))
      order by p.created_at desc
      limit 100
    ) q), '[]'::jsonb);
end $$;
revoke all on function public.player_predictions(uuid, uuid) from public, anon;
grant execute on function public.player_predictions(uuid, uuid) to authenticated;
