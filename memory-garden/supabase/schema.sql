-- =====================================================================
-- 기억 정원 · Supabase 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 안전하게 만들었어요(이미 있는 것은 건너뛰거나 바꿔요).
--
-- 접근 원칙
--  · 다른 사람의 기억 행(memories)은 클라이언트가 직접 SELECT 할 수 없어요(RLS).
--    오직 아래 security definer 함수만 정해진 필드를 돌려줘요.
--  · 비공개 기억은 작성자 말고는 존재·위치·내용 어느 것도 받을 수 없어요.
--  · 타인 공개 기억의 사진·제목·본문은 "현장 반경 안에서 처음 열기(open_memory)"
--    를 통과해 discoveries 행이 생긴 뒤에만 돌려줘요. 사진도 같은 규칙(Storage RLS).
--  · 반경·정확도 기준은 app_config 표 한 곳에서 바꿔요.
-- =====================================================================

-- ---------- 설정값 ----------
create table if not exists public.app_config (
  key   text primary key,
  value jsonb not null,
  note  text
);
insert into public.app_config (key, value, note) values
  ('unlock_radius_m', '50',  '타인 기억을 처음 열 수 있는 반경(m). 디자인 기준값 · 확정 아님'),
  ('max_accuracy_m',  '60',  '위치 오차가 이보다 크면 열기·심기를 막아요(m). 열람 반경과 별개'),
  ('nearby_km',       '3',   '지도에 핀을 불러오는 범위(km)'),
  ('require_login',   '1',   '1이면 기억 심기·처음 열기에 로그인(익명 아님)이 필요해요. 0이면 익명도 가능')
on conflict (key) do nothing;
alter table public.app_config enable row level security;
drop policy if exists "config readable" on public.app_config;
create policy "config readable" on public.app_config for select to anon, authenticated using (true);

create or replace function public.cfg_num(k text, fallback double precision)
returns double precision language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::double precision from public.app_config where key = k), fallback)
$$;

-- 로그인(카카오 등)한 사용자인가? 익명 로그인은 둘러보기만.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and (public.cfg_num('require_login', 1) = 0
          or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
$$;

-- ---------- 프로필 ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  nickname   text not null default '정원사' check (char_length(nickname) between 1 and 12),
  avatar     text not null default 'char-lavender' check (char_length(avatar) <= 40),  -- 기본 캐릭터 키 또는 'me'
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 300),          -- 꾸민 캐릭터 이미지(공개 버킷)
  created_at timestamptz not null default now()
);
-- 개인 꽃잎 색(2026-11-25 추가): 내 꽃밭의 꽃 색, 다른 사람이 모은 꽃밭에서 내 기억 부분의 색
alter table public.profiles add column if not exists petal text not null default 'bloom';
alter table public.profiles drop constraint if exists profiles_petal_check;
alter table public.profiles add constraint profiles_petal_check check (petal in ('bloom','coral','rose','butter','mint','blue','lav','plum'));
alter table public.profiles enable row level security;
drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles readable"   on public.profiles for select to authenticated using (true);
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, '정원사 ' || lpad((floor(random() * 10000))::int::text, 4, '0'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 기억 ----------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 40),
  story       text not null check (char_length(story) between 1 and 120),
  place_name  text not null check (char_length(place_name) between 1 and 40),
  hint        text check (hint is null or char_length(hint) <= 60),
  photo_path  text check (photo_path is null or char_length(photo_path) <= 200),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  accuracy_m  real,
  visibility  text not null default 'public' check (visibility in ('public', 'private')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists memories_geo_idx  on public.memories (lat, lng) where visibility = 'public';
create index if not exists memories_user_idx on public.memories (user_id, created_at desc);
alter table public.memories enable row level security;

-- 내 기억만 직접 읽고·고치고·지울 수 있어요. 새 기억은 plant_memory() 로만.
drop policy if exists "memories select own" on public.memories;
drop policy if exists "memories update own" on public.memories;
drop policy if exists "memories delete own" on public.memories;
create policy "memories select own" on public.memories for select to authenticated using (user_id = auth.uid());
create policy "memories update own" on public.memories for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "memories delete own" on public.memories for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.memories from anon, authenticated;
-- 좌표·사진·작성자는 심은 뒤 못 바꿔요. 공개 범위·글·힌트·장소명만.
grant update (title, story, place_name, hint, visibility, updated_at) on public.memories to authenticated;
revoke all on public.memories from anon;

-- ---------- 발견(=재열람 권한) ----------
create table if not exists public.discoveries (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users on delete cascade,
  memory_id     uuid references public.memories on delete set null,  -- 지워지면 비식별 흔적만 남아요
  first_dist_m  integer,
  discovered_at timestamptz not null default now(),
  unique (user_id, memory_id)
);
create index if not exists discoveries_memory_idx on public.discoveries (memory_id);
alter table public.discoveries enable row level security;
drop policy if exists "discoveries select own" on public.discoveries;
create policy "discoveries select own" on public.discoveries for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.discoveries from anon, authenticated;   -- open_memory() 로만 생겨요

-- ---------- 답장 · 마음 ----------
create table if not exists public.replies (
  id         bigint generated always as identity primary key,
  memory_id  uuid not null references public.memories on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  body       text not null check (char_length(body) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists replies_memory_idx on public.replies (memory_id, created_at);
create table if not exists public.hearts (
  memory_id  uuid not null references public.memories on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (memory_id, user_id)
);
alter table public.replies enable row level security;
alter table public.hearts  enable row level security;

-- 지금 이 사람이 이 기억을 볼 수 있나? (내 기억, 또는 발견했고 아직 공개 중인 타인 기억)
create or replace function public.can_view_memory(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memories m
    where m.id = mid
      and (m.user_id = auth.uid()
           or (m.visibility = 'public'
               and exists (select 1 from public.discoveries d where d.memory_id = m.id and d.user_id = auth.uid())))
  )
$$;

drop policy if exists "replies select" on public.replies;
drop policy if exists "replies insert" on public.replies;
drop policy if exists "replies delete own" on public.replies;
create policy "replies select"     on public.replies for select to authenticated using (public.can_view_memory(memory_id));
create policy "replies insert"     on public.replies for insert to authenticated with check (user_id = auth.uid() and public.can_view_memory(memory_id));
create policy "replies delete own" on public.replies for delete to authenticated using (user_id = auth.uid());
revoke update on public.replies from anon, authenticated;

drop policy if exists "hearts select own" on public.hearts;
drop policy if exists "hearts insert" on public.hearts;
drop policy if exists "hearts delete own" on public.hearts;
create policy "hearts select own" on public.hearts for select to authenticated using (user_id = auth.uid());
create policy "hearts insert"     on public.hearts for insert to authenticated with check (user_id = auth.uid() and public.can_view_memory(memory_id));
create policy "hearts delete own" on public.hearts for delete to authenticated using (user_id = auth.uid());
revoke update on public.hearts from anon, authenticated;
revoke all on public.replies, public.hearts, public.discoveries, public.profiles from anon;

-- ---------- 계산 도우미 ----------
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- 볼 수 있는 기억의 전체 내용(JSON). 권한 확인은 부르는 쪽에서 끝낸 뒤에만 써요.
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

-- ---------- 앱이 부르는 함수 ----------
-- 설정값(반경 등)
create or replace function public.app_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unlock_radius_m', public.cfg_num('unlock_radius_m', 50),
    'max_accuracy_m',  public.cfg_num('max_accuracy_m', 60),
    'nearby_km',       public.cfg_num('nearby_km', 3),
    'require_login',   public.cfg_num('require_login', 1) = 1)
$$;

-- 지도 핀: 내 기억 + 근처 타인 공개 기억.
-- 발견 전 타인 기억은 존재·장소명·힌트·대략 좌표·거리만. 제목·사진·본문·작성자는 없음.
create or replace function public.nearby_memories(p_lat double precision, p_lng double precision)
returns table (
  id uuid, state text, lat double precision, lng double precision, distance_m integer,
  place_name text, hint text, title text, photo_path text, visibility text, created_at timestamptz,
  author_nickname text, author_avatar text, author_avatar_url text
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
    case when m.user_id = me or d.id is not null then p.avatar_url end
  from public.memories m
  left join public.discoveries d on d.memory_id = m.id and d.user_id = me
  left join public.profiles p on p.id = m.user_id
  where m.lat between p_lat - dlat and p_lat + dlat
    and m.lng between p_lng - dlng and p_lng + dlng
    and (m.user_id = me or m.visibility = 'public')
  order by public.distance_m(p_lat, p_lng, m.lat, m.lng)
  limit 300;
end $$;

-- 기억 한 개: 볼 수 있으면 전체, 발견 전 공개 기억이면 잠긴 정보만, 그 밖엔 unavailable.
-- 공유 링크(#/s/:id)도 이 함수를 써서 링크로 현장 제한을 우회할 수 없어요.
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
  if not found or m.id is null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if m.user_id = me then
    return jsonb_build_object('status', 'mine', 'memory', public._memory_json(p_id));
  end if;
  if m.visibility <> 'public' then
    -- 발견했던 사람에게도 내용·작성자는 숨기고 상태만
    return jsonb_build_object('status', case when had_discovery then 'gone' else 'unavailable' end);
  end if;
  if had_discovery then
    return jsonb_build_object('status', 'discovered', 'memory', public._memory_json(p_id));
  end if;
  return jsonb_build_object('status', 'locked', 'memory', jsonb_build_object(
    'id', m.id, 'place_name', m.place_name, 'hint', m.hint,
    'lat', round(m.lat::numeric, 4), 'lng', round(m.lng::numeric, 4)));
end $$;

-- 처음 열기: 서버가 거리·정확도를 확인하고 통과하면 발견 기록을 남겨요.
create or replace function public.open_memory(p_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m  public.memories%rowtype;
  dist double precision;
  radius double precision := public.cfg_num('unlock_radius_m', 50);
  max_acc double precision := public.cfg_num('max_accuracy_m', 60);
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  select * into m from public.memories where id = p_id;
  if m.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if m.user_id = me then return jsonb_build_object('status', 'mine', 'memory', public._memory_json(p_id)); end if;
  if exists (select 1 from public.discoveries where user_id = me and memory_id = p_id) then
    if m.visibility <> 'public' then return jsonb_build_object('status', 'gone'); end if;
    return jsonb_build_object('status', 'discovered', 'memory', public._memory_json(p_id));
  end if;
  if m.visibility <> 'public' then return jsonb_build_object('status', 'unavailable'); end if;
  if not public.is_member() then return jsonb_build_object('status', 'login_required'); end if;
  if p_lat is null or p_lng is null then return jsonb_build_object('status', 'need_location'); end if;
  if p_accuracy is null or p_accuracy > max_acc then
    return jsonb_build_object('status', 'low_accuracy', 'max_accuracy_m', max_acc);
  end if;
  dist := public.distance_m(p_lat, p_lng, m.lat, m.lng);
  if dist > radius then
    return jsonb_build_object('status', 'too_far', 'distance_m', round(dist), 'radius_m', radius);
  end if;
  insert into public.discoveries (user_id, memory_id, first_dist_m)
  values (me, p_id, round(dist)) on conflict (user_id, memory_id) do nothing;
  return jsonb_build_object('status', 'discovered', 'first', true, 'memory', public._memory_json(p_id));
end $$;

-- 내 정원: 내가 심은 기억 + 모은 기억(지워졌거나 비공개면 비식별 흔적만)
create or replace function public.my_garden()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'mine', coalesce((select jsonb_agg(public._memory_json(m.id) order by m.created_at desc)
                      from public.memories m where m.user_id = me), '[]'::jsonb),
    'collected', coalesce((select jsonb_agg(
        case when m.id is not null and m.visibility = 'public'
             then jsonb_build_object('gone', false, 'discovered_at', d.discovered_at, 'memory', public._memory_json(m.id))
             else jsonb_build_object('gone', true,  'discovered_at', d.discovered_at, 'trace_id', d.id) end
        order by d.discovered_at)
      from public.discoveries d left join public.memories m on m.id = d.memory_id
      where d.user_id = me), '[]'::jsonb));
end $$;

-- 기억 심기: 좌표 정확도 확인 후 저장. 사진은 먼저 내 폴더(memory-photos/<uid>/...)에 올려요.
create or replace function public.plant_memory(
  p_title text, p_story text, p_place text, p_hint text, p_photo_path text,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_visibility text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  max_acc double precision := public.cfg_num('max_accuracy_m', 60);
  new_id uuid;
  recent int;
begin
  if me is null then raise exception 'auth required' using errcode = '42501'; end if;
  if not public.is_member() then raise exception 'login required' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null then raise exception 'location required' using errcode = '22023'; end if;
  if p_accuracy is null or p_accuracy > max_acc then raise exception 'low accuracy' using errcode = '22023'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> me::text then
    raise exception 'photo must be in your folder' using errcode = '42501';
  end if;
  -- 도배 방지: 1분에 5개까지
  select count(*) into recent from public.memories where user_id = me and created_at > now() - interval '1 minute';
  if recent >= 5 then raise exception 'too many' using errcode = '54000'; end if;
  insert into public.memories (user_id, title, story, place_name, hint, photo_path, lat, lng, accuracy_m, visibility)
  values (me, left(btrim(p_title), 40), btrim(p_story), left(btrim(p_place), 40), nullif(left(btrim(coalesce(p_hint, '')), 60), ''),
          p_photo_path, p_lat, p_lng, p_accuracy, coalesce(p_visibility, 'public'))
  returning id into new_id;
  return public._memory_json(new_id);
end $$;

-- 함수 실행 권한: 로그인(익명 포함)한 사용자만
revoke execute on function public.nearby_memories(double precision, double precision) from public, anon;
revoke execute on function public.memory_detail(uuid) from public, anon;
revoke execute on function public.open_memory(uuid, double precision, double precision, double precision) from public, anon;
revoke execute on function public.my_garden() from public, anon;
revoke execute on function public.plant_memory(text, text, text, text, text, double precision, double precision, double precision, text) from public, anon;
revoke execute on function public.can_view_memory(uuid) from public, anon;
grant execute on function public.nearby_memories(double precision, double precision) to authenticated;
grant execute on function public.memory_detail(uuid) to authenticated;
grant execute on function public.open_memory(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.my_garden() to authenticated;
grant execute on function public.plant_memory(text, text, text, text, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.can_view_memory(uuid) to authenticated;
grant execute on function public.app_settings() to anon, authenticated;
grant execute on function public.is_member() to authenticated;

-- ---------- 사진 저장소 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-photos', 'memory-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_view_photo(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select split_part(object_name, '/', 1) = auth.uid()::text
      or exists (select 1 from public.memories m where m.photo_path = object_name and public.can_view_memory(m.id))
$$;
grant execute on function public.can_view_photo(text) to authenticated;

drop policy if exists "mg photos insert own" on storage.objects;
drop policy if exists "mg photos select viewable" on storage.objects;
drop policy if exists "mg photos delete own" on storage.objects;
drop policy if exists "mg avatars select own" on storage.objects;
drop policy if exists "mg avatars insert own" on storage.objects;
drop policy if exists "mg avatars update own" on storage.objects;
drop policy if exists "mg avatars delete own" on storage.objects;
create policy "mg photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-photos' and split_part(name, '/', 1) = auth.uid()::text);
create policy "mg photos select viewable" on storage.objects for select to authenticated
  using (bucket_id = 'memory-photos' and public.can_view_photo(name));
create policy "mg photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'memory-photos' and split_part(name, '/', 1) = auth.uid()::text);
-- 꾸민 캐릭터 그림은 공개(작성자 표시용). 자기 폴더에만 쓸 수 있어요.
create policy "mg avatars select own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy "mg avatars insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy "mg avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy "mg avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

-- ---------- 마케팅(이메일) 수신 동의 ----------
-- 정보통신망법: 광고성 정보는 로그인 동의와 별개로 '선택' 동의를 받고, 동의·철회 시각을 남겨요.
-- 시각은 서버가 기록해요(클라이언트 값은 무시).
create table if not exists public.marketing_consents (
  user_id       uuid primary key default auth.uid() references auth.users on delete cascade,
  opt_in        boolean not null default false,
  channel       text not null default 'email' check (channel in ('email')),
  asked_at      timestamptz not null default now(),
  consented_at  timestamptz,
  withdrawn_at  timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.marketing_consents enable row level security;
drop policy if exists "consent select own" on public.marketing_consents;
drop policy if exists "consent insert own" on public.marketing_consents;
drop policy if exists "consent update own" on public.marketing_consents;
create policy "consent select own" on public.marketing_consents for select to authenticated using (user_id = auth.uid());
create policy "consent insert own" on public.marketing_consents for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy "consent update own" on public.marketing_consents for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.marketing_consents from anon;

create or replace function public.marketing_stamp()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.asked_at := now();
    new.consented_at := case when new.opt_in then now() end;
    new.withdrawn_at := null;
  else
    new.user_id := old.user_id; new.asked_at := old.asked_at;
    new.consented_at := case when new.opt_in and not old.opt_in then now() when new.opt_in then old.consented_at else old.consented_at end;
    new.withdrawn_at := case when not new.opt_in and old.opt_in then now() when new.opt_in then null else old.withdrawn_at end;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists marketing_stamp on public.marketing_consents;
create trigger marketing_stamp before insert or update on public.marketing_consents
  for each row execute function public.marketing_stamp();

-- 메일 도구로 내보낼 목록: 대시보드 SQL Editor 에서만 조회(앱·API로는 접근 불가한 admin 스키마)
--   select * from admin.marketing_audience;
create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;
create or replace view admin.marketing_audience as
  select u.email, p.nickname, c.consented_at
  from public.marketing_consents c
  join auth.users u on u.id = c.user_id
  left join public.profiles p on p.id = c.user_id
  where c.opt_in and u.email is not null and u.email <> ''
  order by c.consented_at;
revoke all on admin.marketing_audience from public, anon, authenticated;

-- =====================================================================
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

-- 2026-11-26 알림
-- Supabase SQL Editor에 이 파일 내용을 붙여 한 번 실행하면 돼요(schema.sql 맨 아래에도 같은 내용이 있어요).
-- 여러 번 실행해도 안전해요.
--
-- 내 기억에 이런 일이 생기면 앱 안 알림함에 쌓여요.
--   reply   : 누군가 답장을 남겼어요(답장 쓴 사람 이름은 원래 기억 화면에도 보이니 알림에도 보여요)
--   collect : 누군가 현장에서 내 기억을 발견해 정원에 담았어요
--   heart   : 누군가 마음(좋아요)을 보냈어요
-- 담기·마음은 누가 했는지 보여 주지 않아요. 현장에서만 담을 수 있어서, 이름이 보이면 그 사람이
-- 언제 어디에 있었는지가 드러나기 때문이에요.
-- 종류마다 설정에서 끌 수 있어요(notification_prefs). 끈 종류는 알림이 아예 만들어지지 않아요.

-- ---------- 알림 설정 ----------
create table if not exists public.notification_prefs (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  reply      boolean not null default true,
  collect    boolean not null default true,
  heart      boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "nprefs select own" on public.notification_prefs;
drop policy if exists "nprefs insert own" on public.notification_prefs;
drop policy if exists "nprefs update own" on public.notification_prefs;
create policy "nprefs select own" on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy "nprefs insert own" on public.notification_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "nprefs update own" on public.notification_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notification_prefs from anon;

-- ---------- 알림 ----------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,          -- 받는 사람(기억 주인)
  actor_id   uuid references auth.users on delete set null,                   -- 한 사람(담기·마음은 화면에 안 보여요)
  kind       text not null check (kind in ('reply', 'collect', 'heart')),
  memory_id  uuid references public.memories on delete cascade,
  body       text check (body is null or char_length(body) <= 80),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
-- 마음은 같은 사람이 껐다 켜도 알림이 한 번만 가요
create unique index if not exists notifications_heart_once on public.notifications (user_id, actor_id, memory_id) where kind = 'heart';
alter table public.notifications enable row level security;
drop policy if exists "notif select own" on public.notifications;
drop policy if exists "notif delete own" on public.notifications;
create policy "notif select own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif delete own" on public.notifications for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.notifications from anon, authenticated;   -- 아래 트리거·함수로만 생기고 읽음 처리돼요

create or replace function public._notify(p_memory uuid, p_actor uuid, p_kind text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare owner uuid; ok boolean;
begin
  if p_memory is null or p_actor is null then return; end if;
  select user_id into owner from public.memories where id = p_memory;
  if owner is null or owner = p_actor then return; end if;                 -- 내 기억에 내가 한 일은 알리지 않아요
  select case p_kind when 'reply' then reply when 'collect' then collect else heart end
    into ok from public.notification_prefs where user_id = owner;
  if ok is false then return; end if;                                        -- 설정에서 끈 종류(설정이 없으면 켜짐)
  insert into public.notifications (user_id, actor_id, kind, memory_id, body)
  values (owner, p_actor, p_kind, p_memory, left(p_body, 80))
  on conflict do nothing;
end $$;
revoke all on function public._notify(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public._notify_reply() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public._notify(new.memory_id, new.user_id, 'reply', new.body); return null; end $$;
create or replace function public._notify_heart() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public._notify(new.memory_id, new.user_id, 'heart', null); return null; end $$;
create or replace function public._notify_collect() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public._notify(new.memory_id, new.user_id, 'collect', null); return null; end $$;

drop trigger if exists notify_reply on public.replies;
create trigger notify_reply after insert on public.replies for each row execute function public._notify_reply();
drop trigger if exists notify_heart on public.hearts;
create trigger notify_heart after insert on public.hearts for each row execute function public._notify_heart();
drop trigger if exists notify_collect on public.discoveries;
create trigger notify_collect after insert on public.discoveries for each row execute function public._notify_collect();

-- 알림함: 최근 60개 + 안 읽은 개수. 답장한 사람 이름·캐릭터만 담고, 담기·마음은 사람 정보를 빼요.
create or replace function public.my_notifications()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'unread', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'items', coalesce((select json_agg(x order by x.created_at desc) from (
      select n.id, n.kind, n.memory_id, n.created_at, n.read_at is not null as read,
             case when n.kind = 'reply' then n.body end as body,
             m.title, m.place_name, m.photo_path,
             case when n.kind = 'reply' then p.nickname end as actor_nickname,
             case when n.kind = 'reply' then p.avatar end as actor_avatar,
             case when n.kind = 'reply' then p.avatar_url end as actor_avatar_url
      from public.notifications n
      left join public.memories m on m.id = n.memory_id
      left join public.profiles p on p.id = n.actor_id
      where n.user_id = auth.uid()
      order by n.created_at desc
      limit 60) x), '[]'::json));
$$;

-- 읽음 처리: p_ids가 비어 있으면 전부
create or replace function public.read_notifications(p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare k integer;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics k = row_count; return k;
end $$;

grant execute on function public.my_notifications() to authenticated;
grant execute on function public.read_notifications(bigint[]) to authenticated;
revoke execute on function public.my_notifications() from anon;
revoke execute on function public.read_notifications(bigint[]) from anon;
