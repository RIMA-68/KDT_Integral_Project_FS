-- 2026-11-26 신고 + 비밀번호 기억
-- Supabase SQL Editor에 이 파일 내용을 붙여 한 번 실행하면 돼요(schema.sql 맨 아래에도 같은 내용이 있어요).
-- 여러 번 실행해도 안전해요.
--
-- · 비밀번호 기억: 공개 기억(visibility = 'public')에 비밀번호(secret_hash)가 걸린 것.
--   현장(반경 안)에서 비밀번호까지 맞혀야 처음 열려요. 한 번 담으면 다른 발견 기억처럼 어디서든 다시 볼 수 있어요.
--   비밀번호는 bcrypt로만 저장(원문 저장 안 함). 틀리면 10분에 5번까지만 다시 시도할 수 있어요.
-- · 신고: 신고한 사람에게는 그 기억이 바로 숨겨져요. 서로 다른 N명(app_config.report_hide_count, 기본 3)이
--   신고하면 모두에게 임시로 숨겨요(hidden_at). 확인은 대시보드 SQL Editor에서:
--     select * from admin.reported_memories;
--   문제없으면 다시 보이게:  update public.memories set hidden_at = null where id = '<기억 id>';

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.memories add column if not exists secret_hash text;
alter table public.memories add column if not exists hidden_at timestamptz;

insert into public.app_config (key, value, note) values
  ('report_hide_count', '3', '서로 다른 사람 N명이 신고하면 모두에게 임시로 숨겨요')
on conflict (key) do nothing;

-- ---------- 신고 ----------
create table if not exists public.reports (
  id         bigint generated always as identity primary key,
  memory_id  uuid not null references public.memories on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  reason     text not null check (reason in ('spam', 'abuse', 'privacy', 'sexual', 'other')),
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (memory_id, user_id)
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;   -- report_memory() 로만

-- ---------- 비밀번호 시도 기록(무차별 대입 막기) ----------
create table if not exists public.secret_attempts (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users on delete cascade,
  memory_id uuid not null references public.memories on delete cascade,
  at        timestamptz not null default now()
);
create index if not exists secret_attempts_idx on public.secret_attempts (user_id, memory_id, at desc);
alter table public.secret_attempts enable row level security;
revoke all on public.secret_attempts from anon, authenticated;

-- 다른 사람에게 열려 있는 기억인가? (공개 + 숨김 아님 + 내가 신고하지 않음)
create or replace function public._open_to_me(m public.memories)
returns boolean language sql stable security definer set search_path = public as $$
  select m.visibility = 'public' and m.hidden_at is null
     and not exists (select 1 from public.reports r where r.memory_id = m.id and r.user_id = auth.uid())
$$;
revoke execute on function public._open_to_me(public.memories) from public, anon, authenticated;

create or replace function public.can_view_memory(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memories m
    where m.id = mid
      and (m.user_id = auth.uid()
           or (public._open_to_me(m)
               and exists (select 1 from public.discoveries d where d.memory_id = m.id and d.user_id = auth.uid())))
  )
$$;

create or replace function public._memory_json(mid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'mine', m.user_id = auth.uid(), 'title', m.title, 'story', m.story,
    'place_name', m.place_name, 'hint', m.hint, 'photo_path', m.photo_path,
    'visibility', m.visibility, 'secret', m.secret_hash is not null, 'created_at', m.created_at,
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

-- 지도 핀: 결과에 secret(비밀번호 기억 여부)이 더해져서 다시 만들어요.
drop function if exists public.nearby_memories(double precision, double precision);
create function public.nearby_memories(p_lat double precision, p_lng double precision)
returns table (
  id uuid, state text, lat double precision, lng double precision, distance_m integer,
  place_name text, hint text, title text, photo_path text, visibility text, created_at timestamptz,
  author_nickname text, author_avatar text, author_avatar_url text, secret boolean
) language plpgsql stable security definer set search_path = public as $$
declare
  km   double precision := public.cfg_num('nearby_km', 3);
  dlat double precision := km / 111.32;
  dlng double precision := km / (111.32 * greatest(cos(radians(p_lat)), 0.01));
  me   uuid := auth.uid();
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'invalid position' using errcode = '22023';
  end if;
  return query
  select m.id,
    case when m.user_id = me then 'mine'
         when d.id is not null then 'discovered'
         else 'undiscovered' end,
    round(m.lat::numeric, 4)::double precision, round(m.lng::numeric, 4)::double precision,
    round(public.distance_m(p_lat, p_lng, m.lat, m.lng))::int,
    m.place_name,
    m.hint,
    case when m.user_id = me or d.id is not null then m.title end,
    case when m.user_id = me or d.id is not null then m.photo_path end,
    case when m.user_id = me then m.visibility end,
    case when m.user_id = me or d.id is not null then m.created_at end,
    case when m.user_id = me or d.id is not null then p.nickname end,
    case when m.user_id = me or d.id is not null then p.avatar end,
    case when m.user_id = me or d.id is not null then p.avatar_url end,
    m.secret_hash is not null
  from public.memories m
  left join public.discoveries d on d.memory_id = m.id and d.user_id = me
  left join public.profiles p on p.id = m.user_id
  where m.lat between p_lat - dlat and p_lat + dlat
    and m.lng between p_lng - dlng and p_lng + dlng
    and (m.user_id = me or public._open_to_me(m))
  order by public.distance_m(p_lat, p_lng, m.lat, m.lng)
  limit 300;
end $$;

create or replace function public.memory_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m  public.memories%rowtype;
  had_discovery boolean;
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  select * into m from public.memories where id = p_id;
  select exists (select 1 from public.discoveries where user_id = me and memory_id = p_id) into had_discovery;
  if m.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if m.user_id = me then
    return jsonb_build_object('status', 'mine', 'memory', public._memory_json(p_id));
  end if;
  if not public._open_to_me(m) then
    return jsonb_build_object('status', case when had_discovery then 'gone' else 'unavailable' end);
  end if;
  if had_discovery then
    return jsonb_build_object('status', 'discovered', 'memory', public._memory_json(p_id));
  end if;
  return jsonb_build_object('status', 'locked', 'memory', jsonb_build_object(
    'id', m.id, 'place_name', m.place_name, 'hint', m.hint, 'secret', m.secret_hash is not null,
    'lat', round(m.lat::numeric, 4), 'lng', round(m.lng::numeric, 4)));
end $$;

-- 처음 열기: 거리·정확도 → (비밀번호 기억이면) 비밀번호 확인 → 발견 기록
create or replace function public.open_memory(p_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_secret text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m  public.memories%rowtype;
  dist double precision;
  radius double precision := public.cfg_num('unlock_radius_m', 50);
  max_acc double precision := public.cfg_num('max_accuracy_m', 60);
  fails int;
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  select * into m from public.memories where id = p_id;
  if m.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if m.user_id = me then return jsonb_build_object('status', 'mine', 'memory', public._memory_json(p_id)); end if;
  if exists (select 1 from public.discoveries where user_id = me and memory_id = p_id) then
    if not public._open_to_me(m) then return jsonb_build_object('status', 'gone'); end if;
    return jsonb_build_object('status', 'discovered', 'memory', public._memory_json(p_id));
  end if;
  if not public._open_to_me(m) then return jsonb_build_object('status', 'unavailable'); end if;
  if not public.is_member() then return jsonb_build_object('status', 'login_required'); end if;
  if p_lat is null or p_lng is null then return jsonb_build_object('status', 'need_location'); end if;
  if p_accuracy is null or p_accuracy > max_acc then
    return jsonb_build_object('status', 'low_accuracy', 'max_accuracy_m', max_acc);
  end if;
  dist := public.distance_m(p_lat, p_lng, m.lat, m.lng);
  if dist > radius then
    return jsonb_build_object('status', 'too_far', 'distance_m', round(dist), 'radius_m', radius);
  end if;
  if m.secret_hash is not null then
    select count(*) into fails from public.secret_attempts
      where user_id = me and memory_id = p_id and at > now() - interval '10 minutes';
    if fails >= 5 then return jsonb_build_object('status', 'secret_locked', 'retry_min', 10); end if;
    if p_secret is null or p_secret = '' then return jsonb_build_object('status', 'secret_required'); end if;
    if extensions.crypt(p_secret, m.secret_hash) <> m.secret_hash then
      insert into public.secret_attempts (user_id, memory_id) values (me, p_id);
      if fails + 1 >= 5 then return jsonb_build_object('status', 'secret_locked', 'retry_min', 10); end if;
      return jsonb_build_object('status', 'secret_wrong', 'left', 5 - fails - 1);
    end if;
  end if;
  insert into public.discoveries (user_id, memory_id, first_dist_m)
  values (me, p_id, round(dist)) on conflict (user_id, memory_id) do nothing;
  return jsonb_build_object('status', 'discovered', 'first', true, 'memory', public._memory_json(p_id));
end $$;

-- 예전 앱(비밀번호 칸 없음)이 부르는 4개짜리도 같은 규칙으로
create or replace function public.open_memory(p_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language sql volatile security definer set search_path = public as $$
  select public.open_memory(p_id, p_lat, p_lng, p_accuracy, null::text)
$$;

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
             else jsonb_build_object('gone', true,  'discovered_at', d.discovered_at, 'trace_id', d.id) end
        order by d.discovered_at)
      from public.discoveries d left join public.memories m on m.id = d.memory_id
      where d.user_id = me), '[]'::jsonb));
end $$;

-- 비밀번호 확인(4~20자)
create or replace function public._secret_ok(p text)
returns boolean language sql immutable as $$
  select p is not null and char_length(p) between 4 and 20
$$;

-- 기억 심기(비밀번호 칸 추가). 예전 9개짜리 plant_memory 는 그대로 둬요.
create or replace function public.plant_memory(
  p_title text, p_story text, p_place text, p_hint text, p_photo_path text,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_visibility text, p_secret text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  max_acc double precision := public.cfg_num('max_accuracy_m', 60);
  new_id uuid;
  recent int;
  vis text := coalesce(p_visibility, 'public');
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  if not public.is_member() then raise exception 'login required' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null then raise exception 'location required' using errcode = '22023'; end if;
  if p_accuracy is null or p_accuracy > max_acc then raise exception 'low accuracy' using errcode = '22023'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> me::text then
    raise exception 'photo must be in your folder' using errcode = '42501';
  end if;
  if p_secret is not null and vis = 'public' and not public._secret_ok(p_secret) then
    raise exception 'bad secret' using errcode = '22023';
  end if;
  select count(*) into recent from public.memories where user_id = me and created_at > now() - interval '1 minute';
  if recent >= 5 then raise exception 'too many' using errcode = '54000'; end if;
  insert into public.memories (user_id, title, story, place_name, hint, photo_path, lat, lng, accuracy_m, visibility, secret_hash)
  values (me, left(btrim(p_title), 40), btrim(p_story), left(btrim(p_place), 40), nullif(left(btrim(coalesce(p_hint, '')), 60), ''),
          p_photo_path, p_lat, p_lng, p_accuracy, vis,
          case when p_secret is not null and vis = 'public' then extensions.crypt(p_secret, extensions.gen_salt('bf')) end)
  returning id into new_id;
  return public._memory_json(new_id);
end $$;

-- 내 기억 공개 범위를 '비밀번호를 아는 사람만'으로 바꾸거나(새 비밀번호) 비밀번호를 없애요(null)
create or replace function public.set_memory_secret(p_id uuid, p_secret text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  if p_secret is not null and not public._secret_ok(p_secret) then raise exception 'bad secret' using errcode = '22023'; end if;
  update public.memories
     set secret_hash = case when p_secret is null then null else extensions.crypt(p_secret, extensions.gen_salt('bf')) end,
         visibility = case when p_secret is null then visibility else 'public' end,
         updated_at = now()
   where id = p_id and user_id = me;
  if not found then raise exception 'not yours' using errcode = '42501'; end if;
end $$;

-- 신고: 로그인한 사람만, 내 기억은 안 돼요. 누적 N명이면 모두에게 임시로 숨겨요.
create or replace function public.report_memory(p_id uuid, p_reason text, p_note text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m  public.memories%rowtype;
  n  int;
  hide_at double precision := public.cfg_num('report_hide_count', 3);
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  if not public.is_member() then return jsonb_build_object('status', 'login_required'); end if;
  select * into m from public.memories where id = p_id;
  if m.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if m.user_id = me then return jsonb_build_object('status', 'mine'); end if;
  insert into public.reports (memory_id, user_id, reason, note)
  values (p_id, me, p_reason, nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  on conflict (memory_id, user_id) do nothing;
  select count(*) into n from public.reports where memory_id = p_id;
  if n >= hide_at then update public.memories set hidden_at = coalesce(hidden_at, now()) where id = p_id; end if;
  return jsonb_build_object('status', 'ok');
end $$;

revoke execute on function public.open_memory(uuid, double precision, double precision, double precision, text) from public, anon;
revoke execute on function public.plant_memory(text, text, text, text, text, double precision, double precision, double precision, text, text) from public, anon;
revoke execute on function public.set_memory_secret(uuid, text) from public, anon;
revoke execute on function public.report_memory(uuid, text, text) from public, anon;
revoke execute on function public.nearby_memories(double precision, double precision) from public, anon;
grant execute on function public.open_memory(uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.plant_memory(text, text, text, text, text, double precision, double precision, double precision, text, text) to authenticated;
grant execute on function public.set_memory_secret(uuid, text) to authenticated;
grant execute on function public.report_memory(uuid, text, text) to authenticated;
grant execute on function public.nearby_memories(double precision, double precision) to authenticated;

-- 운영자 확인용(대시보드 SQL Editor 전용, 앱·API로는 접근 불가)
create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;
create or replace view admin.reported_memories as
  select m.id, m.title, m.place_name, p.nickname as author, count(r.*) as reports,
         string_agg(distinct r.reason, ', ') as reasons, max(r.created_at) as last_report, m.hidden_at
  from public.reports r
  join public.memories m on m.id = r.memory_id
  left join public.profiles p on p.id = m.user_id
  group by m.id, m.title, m.place_name, p.nickname, m.hidden_at
  order by max(r.created_at) desc;
revoke all on admin.reported_memories from public, anon, authenticated;
