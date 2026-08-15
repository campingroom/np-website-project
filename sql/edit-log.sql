-- ══════════════════════════════════════════════════════════════════════════
--  ประวัติการแก้ไขเว็บไซต์ (แชร์ทุกเครื่อง) — โรงเรียนบ้านหนองสระพังโนนสะอาด
--  รันไฟล์นี้ครั้งเดียวใน Supabase → SQL Editor → New query → Run
--  เขียน/อ่านได้เฉพาะผู้ที่ล็อกอินเป็นผู้ดูแล (authenticated) เท่านั้น
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.edit_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  text       text not null,
  by_name    text,
  user_id    uuid default auth.uid()
);

create index if not exists edit_log_created_idx on public.edit_log (created_at desc);

alter table public.edit_log enable row level security;

drop policy if exists edit_log_read  on public.edit_log;
drop policy if exists edit_log_write on public.edit_log;

create policy edit_log_read  on public.edit_log
  for select to authenticated using (true);

create policy edit_log_write on public.edit_log
  for insert to authenticated with check (true);

-- เก็บเฉพาะ 200 รายการล่าสุด (เรียกเองเป็นครั้งคราว หรือผูกกับ cron ก็ได้)
create or replace function public.trim_edit_log()
returns void
language sql security definer set search_path = public as $$
  delete from edit_log
  where id not in (select id from edit_log order by created_at desc limit 200);
$$;

revoke all on function public.trim_edit_log() from public;
grant execute on function public.trim_edit_log() to authenticated;

-- ตรวจสอบ: select * from public.edit_log order by created_at desc limit 20;
