-- Anya 的職缺追蹤：每位登入者自己的收藏、狀態與備註。
-- 在 Supabase SQL Editor 整份執行一次即可。
-- 網站只會使用 anon / publishable key；請不要把 service_role 放到 docs/config.js。

create table if not exists public.job_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id text not null,
  favorite boolean not null default false,
  status text,
  note text,
  fav_snapshot jsonb,
  seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id),
  constraint job_progress_job_id_len check (char_length(job_id) between 1 and 2048),
  constraint job_progress_status_check check (
    status is null or status in ('想投', '已投', '面試', '不考慮')
  ),
  constraint job_progress_note_len check (note is null or char_length(note) <= 20000)
);

comment on table public.job_progress is
  '每位使用者的職缺進度。job_id 是職缺網址。fav_snapshot 是收藏當下的職缺卡片，方便職缺下架後仍看得到。seen_at 是使用者打開職缺連結的時間，空值代表還沒看過。';

alter table public.job_progress add column if not exists seen_at timestamptz;

alter table public.job_progress enable row level security;
alter table public.job_progress force row level security;

-- 主鍵 (user_id, job_id) 已經能支援「只查自己的列」。
-- 政策使用 (select auth.uid())，讓 Postgres 每個陳述只計算一次。

drop policy if exists job_progress_select_own on public.job_progress;
create policy job_progress_select_own
  on public.job_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists job_progress_insert_own on public.job_progress;
create policy job_progress_insert_own
  on public.job_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists job_progress_update_own on public.job_progress;
create policy job_progress_update_own
  on public.job_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists job_progress_delete_own on public.job_progress;
create policy job_progress_delete_own
  on public.job_progress
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 未登入的 anon 沒有任何政策，也沒有資料表權限。
revoke all on table public.job_progress from public, anon;
grant select, insert, update, delete on table public.job_progress to authenticated;
grant all on table public.job_progress to service_role;
