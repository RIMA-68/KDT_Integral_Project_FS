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
