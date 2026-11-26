-- 2026-11-26 '나만 보기'로 바뀐 발견 기억의 꽃잎
-- Supabase SQL Editor에 이 파일 내용을 붙여 한 번 실행하면 돼요(schema.sql 맨 아래에도 같은 내용이 있어요).
-- 여러 번 실행해도 안전해요. 2026-11-26-report-secret.sql 을 먼저 실행해야 해요.
--
-- 내가 발견해 담은 다른 사람의 기억을 주인이 '나만 보기'로 바꾸면(= 기억을 다시 품으면)
-- 내 발견의 정원에서 그 꽃잎이 회색 흔적이 아니라 주인의 꽃잎 색 그대로, 옅은 실로 남아요.
-- 내용(사진·글·작성자 이름)은 여전히 보이지 않아요. 내려 주는 것은 folded 표시와 꽃잎 색 키뿐이에요.
-- 지워진 기억, 신고로 숨겨진 기억, 내가 신고한 기억은 예전처럼 회색 흔적이에요.

create or replace function public.my_garden()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'mine', coalesce((select jsonb_agg(public._memory_json(m.id) order by m.created_at desc)
                      from public.memories m where m.user_id = me), '[]'::jsonb),
    'collected', coalesce((select jsonb_agg(
        case when m.id is not null and public._open_to_me(m)
             then jsonb_build_object('gone', false, 'discovered_at', d.discovered_at, 'memory', public._memory_json(m.id))
             when m.id is not null and m.visibility = 'private' and m.hidden_at is null
                  and not exists (select 1 from public.reports r where r.memory_id = m.id and r.user_id = me)
             then jsonb_build_object('gone', true, 'folded', true, 'discovered_at', d.discovered_at, 'trace_id', d.id,
                                     'petal', (select p.petal from public.profiles p where p.id = m.user_id))
             else jsonb_build_object('gone', true,  'discovered_at', d.discovered_at, 'trace_id', d.id) end
        order by d.discovered_at)
      from public.discoveries d left join public.memories m on m.id = d.memory_id
      where d.user_id = me), '[]'::jsonb));
end $$;
revoke execute on function public.my_garden() from public, anon;
grant execute on function public.my_garden() to authenticated;
