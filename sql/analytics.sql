-- ══════════════════════════════════════════════════════════════════════════
--  สถิติผู้เข้าชมเว็บไซต์ — โรงเรียนบ้านหนองสระพังโนนสะอาด
--  รันไฟล์นี้ครั้งเดียวใน Supabase → SQL Editor → New query → Run
--  ปลอดภัย: เปิด RLS แต่ไม่มี policy ใด ๆ บนตาราง จึงอ่าน/เขียนตรงไม่ได้เลย
--  เว็บไซต์คุยกับตารางผ่านฟังก์ชัน 2 ตัวเท่านั้น (log_view / view_stats)
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.page_views (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  day        date        not null default ((now() at time zone 'Asia/Bangkok')::date),
  path       text,
  referrer   text,
  device     text,        -- 'mobile' | 'tablet' | 'desktop'
  visitor    text         -- รหัสสุ่มฝั่งเบราว์เซอร์ ไม่ใช่ข้อมูลส่วนบุคคล
);

create index if not exists page_views_day_idx     on public.page_views (day);
create index if not exists page_views_visitor_idx on public.page_views (visitor);

alter table public.page_views enable row level security;
-- ไม่สร้าง policy โดยเจตนา → anon key แตะตารางตรง ๆ ไม่ได้

-- ── บันทึกการเข้าชม 1 ครั้ง ────────────────────────────────────────────────
create or replace function public.log_view(
  p_path text, p_ref text, p_device text, p_visitor text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into page_views (path, referrer, device, visitor)
  values (
    left(coalesce(p_path, '/'), 200),
    left(coalesce(p_ref, ''), 300),
    left(coalesce(p_device, ''), 20),
    left(coalesce(p_visitor, ''), 40)
  );
end;
$$;

-- ── อ่านสถิติแบบสรุป (ไม่เปิดเผยข้อมูลรายแถว) ──────────────────────────────
create or replace function public.view_stats()
returns json
language sql security definer set search_path = public as $$
  with d as (select ((now() at time zone 'Asia/Bangkok')::date) as today)
  select json_build_object(
    'total',    (select count(*) from page_views),
    'today',    (select count(*) from page_views, d where day = d.today),
    'month',    (select count(*) from page_views, d where day >= date_trunc('month', d.today)::date),
    'visitors', (select count(distinct visitor) from page_views where visitor <> ''),
    'daily',    (select coalesce(json_agg(x order by x.day), '[]'::json) from (
                   select day, count(*) as views, count(distinct visitor) as visitors
                   from page_views, d
                   where day >= d.today - 29
                   group by day
                 ) x),
    'top_pages',(select coalesce(json_agg(y), '[]'::json) from (
                   select coalesce(path,'/') as path, count(*) as views
                   from page_views group by 1 order by 2 desc limit 8
                 ) y),
    'sources',  (select coalesce(json_agg(z), '[]'::json) from (
                   select case
                            when referrer is null or referrer = '' then 'เข้าตรง'
                            when referrer ilike '%facebook%' then 'Facebook'
                            when referrer ilike '%google%'   then 'Google'
                            when referrer ilike '%youtube%'  then 'YouTube'
                            when referrer ilike '%line%'     then 'LINE'
                            else 'อื่น ๆ' end as source,
                          count(*) as views
                   from page_views group by 1 order by 2 desc
                 ) z),
    'devices',  (select coalesce(json_agg(w), '[]'::json) from (
                   select coalesce(nullif(device,''),'ไม่ระบุ') as device, count(*) as views
                   from page_views group by 1 order by 2 desc
                 ) w)
  );
$$;

revoke all on function public.log_view(text,text,text,text) from public;
revoke all on function public.view_stats() from public;
grant execute on function public.log_view(text,text,text,text) to anon, authenticated;
grant execute on function public.view_stats() to anon, authenticated;

-- ตรวจสอบ: select public.view_stats();
