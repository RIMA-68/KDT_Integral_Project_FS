-- 2026-11-25 개인 꽃잎 색 추가 (schema.sql 전체를 다시 실행하지 않고 이 파일만 SQL Editor에 붙여 실행해도 돼요)
-- 여러 번 실행해도 안전해요.
-- 개인 꽃잎 색(2026-11-25 추가): 내 꽃밭의 꽃 색, 다른 사람이 모은 꽃밭에서 내 기억 부분의 색
alter table public.profiles add column if not exists petal text not null default 'bloom';
alter table public.profiles drop constraint if exists profiles_petal_check;
alter table public.profiles add constraint profiles_petal_check check (petal in ('bloom','coral','rose','butter','mint','blue','lav','plum'));

create or replace function public._memory_json(mid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'mine', m.user_id = auth.uid(), 'title', m.title, 'story', m.story,
    'place_name', m.place_name, 'hint', m.hint, 'photo_path', m.photo_path,
    'visibility', m.visibility, 'created_at', m.created_at,
    -- 좌표는 지도 핀용(소수 4자리 ≈ 10m). 화면 글자로는 쓰지 않아요.
    'lat', round(m.lat::numeric, 4), 'lng', round(m.lng::numeric, 4),
    'author', jsonb_build_object('nickname', p.nickname, 'avatar', p.avatar, 'avatar_url', p.avatar_url, 'petal', coalesce(p.petal, 'bloom')),
    'hearts', (select count(*) from public.hearts h where h.memory_id = m.id),
    'liked',  exists (select 1 from public.hearts h where h.memory_id = m.id and h.user_id = auth.uid()),
    'first_dist_m', (select d.first_dist_m from public.discoveries d where d.memory_id = m.id and d.user_id = auth.uid()),
    'replies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'body', r.body, 'created_at', r.created_at, 'mine', r.user_id = auth.uid(),
        'nickname', rp.nickname, 'avatar', rp.avatar, 'avatar_url', rp.avatar_url) order by r.created_at)
      from public.replies r left join public.profiles rp on rp.id = r.user_id where r.memory_id = m.id), '[]'::jsonb)
  )
  from public.memories m left join public.profiles p on p.id = m.user_id
  where m.id = mid
$$;
revoke execute on function public._memory_json(uuid) from public, anon, authenticated;
