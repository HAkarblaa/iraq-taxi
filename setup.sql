begin;
create schema if not exists taxi_private;
revoke all on schema taxi_private from public, anon;
grant usage on schema taxi_private to authenticated;

create table if not exists public.taxi_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','driver','admin')),
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text not null default '' check (char_length(phone) <= 20),
  governorate text not null default 'karbala' check (governorate in ('baghdad','basra','nineveh','erbil','najaf','karbala','babylon','anbar','diyala','dhiqar','maysan','muthanna','qadisiyah','wasit','saladin','kirkuk','duhok','sulaymaniyah','halabja')),
  car_make text not null default '' check (char_length(car_make) <= 80),
  plate text not null default '' check (char_length(plate) <= 30),
  is_approved boolean not null default false,
  is_online boolean not null default false,
  driver_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.taxi_fares (
  service text primary key check (service in ('economy','comfort')),
  label text not null,
  base_fare integer not null check (base_fare between 0 and 1000000),
  per_km integer not null check (per_km between 0 and 100000),
  minimum_fare integer not null check (minimum_fare between 0 and 1000000)
);
insert into public.taxi_fares values
 ('economy','اقتصادي',2000,750,3000),
 ('comfort','مريح',3000,1000,4000)
on conflict (service) do nothing;

create table if not exists public.taxi_rides (
  id uuid primary key,
  customer_id uuid not null references public.taxi_profiles(id) on delete restrict,
  driver_id uuid references public.taxi_profiles(id) on delete restrict,
  governorate text not null check (governorate in ('baghdad','basra','nineveh','erbil','najaf','karbala','babylon','anbar','diyala','dhiqar','maysan','muthanna','qadisiyah','wasit','saladin','kirkuk','duhok','sulaymaniyah','halabja')),
  service text not null references public.taxi_fares(service),
  pickup_lat double precision not null check (pickup_lat between 28 and 38),
  pickup_lng double precision not null check (pickup_lng between 38 and 49),
  destination_lat double precision not null check (destination_lat between 28 and 38),
  destination_lng double precision not null check (destination_lng between 38 and 49),
  pickup_text text not null check (char_length(pickup_text) between 1 and 200),
  destination_text text not null check (char_length(destination_text) between 1 and 200),
  distance_km numeric(8,2) not null check (distance_km > 0),
  estimated_fare integer not null check (estimated_fare >= 0),
  status text not null default 'pending' check (status in ('pending','accepted','arrived','ongoing','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists taxi_customer_active on public.taxi_rides(customer_id)
 where status in ('pending','accepted','arrived','ongoing');
create unique index if not exists taxi_driver_active on public.taxi_rides(driver_id)
 where driver_id is not null and status in ('accepted','arrived','ongoing');
create index if not exists taxi_rides_customer_history on public.taxi_rides(customer_id,created_at desc);
create index if not exists taxi_rides_driver_history on public.taxi_rides(driver_id,created_at desc);
create index if not exists taxi_rides_pending_region on public.taxi_rides(governorate,created_at desc) where status='pending';

create table if not exists public.taxi_driver_locations (
  driver_id uuid primary key references public.taxi_profiles(id) on delete cascade,
  latitude double precision not null check (latitude between 28 and 38),
  longitude double precision not null check (longitude between 38 and 49),
  updated_at timestamptz not null default now()
);
create table if not exists public.taxi_deletion_requests (
  user_id uuid primary key references public.taxi_profiles(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create or replace function taxi_private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.taxi_profiles where id=auth.uid();
$$;
create or replace function taxi_private.can_dispatch(region text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.taxi_profiles where id=auth.uid()
    and role='driver' and is_approved and is_online and governorate=region
    and driver_seen_at > now()-interval '2 minutes');
$$;
create or replace function taxi_private.can_contact(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.taxi_rides
    where status in ('accepted','arrived','ongoing') and
      ((customer_id=auth.uid() and driver_id=target) or (driver_id=auth.uid() and customer_id=target)));
$$;
create or replace function taxi_private.new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare requested text;
begin
  requested := case when new.raw_user_meta_data->>'requested_role'='driver' then 'driver' else 'customer' end;
  insert into public.taxi_profiles(id,role,full_name,phone,governorate,car_make,plate,is_approved)
  values(new.id,requested,left(coalesce(new.raw_user_meta_data->>'full_name',''),80),
    left(coalesce(new.raw_user_meta_data->>'phone',''),20),
    case when new.raw_user_meta_data->>'governorate' in ('baghdad','basra','nineveh','erbil','najaf','karbala','babylon','anbar','diyala','dhiqar','maysan','muthanna','qadisiyah','wasit','saladin','kirkuk','duhok','sulaymaniyah','halabja') then new.raw_user_meta_data->>'governorate' else 'karbala' end,
    left(coalesce(new.raw_user_meta_data->>'car_make',''),80),
    left(coalesce(new.raw_user_meta_data->>'plate',''),30),requested='customer')
  on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists taxi_auth_user_created on auth.users;
create trigger taxi_auth_user_created after insert on auth.users for each row execute function taxi_private.new_user();

alter table public.taxi_profiles enable row level security;
alter table public.taxi_fares enable row level security;
alter table public.taxi_rides enable row level security;
alter table public.taxi_driver_locations enable row level security;
alter table public.taxi_deletion_requests enable row level security;
revoke all on public.taxi_profiles,public.taxi_rides,public.taxi_fares,public.taxi_driver_locations,public.taxi_deletion_requests from anon,authenticated;
grant select on public.taxi_profiles,public.taxi_rides,public.taxi_driver_locations,public.taxi_deletion_requests to authenticated;
grant select on public.taxi_fares to anon,authenticated;

drop policy if exists taxi_profiles_read on public.taxi_profiles;
create policy taxi_profiles_read on public.taxi_profiles for select to authenticated
 using(id=(select auth.uid()) or (select taxi_private.my_role())='admin' or taxi_private.can_contact(id));
drop policy if exists taxi_fares_read on public.taxi_fares;
create policy taxi_fares_read on public.taxi_fares for select to anon,authenticated using(true);
drop policy if exists taxi_rides_read on public.taxi_rides;
create policy taxi_rides_read on public.taxi_rides for select to authenticated
 using(customer_id=(select auth.uid()) or driver_id=(select auth.uid())
   or (select taxi_private.my_role())='admin' or (status='pending' and taxi_private.can_dispatch(governorate)));
drop policy if exists taxi_locations_read on public.taxi_driver_locations;
create policy taxi_locations_read on public.taxi_driver_locations for select to authenticated
 using(driver_id=(select auth.uid()) or (select taxi_private.my_role())='admin'
   or (updated_at > now()-interval '2 minutes' and exists(select 1 from public.taxi_rides
     where customer_id=(select auth.uid()) and taxi_rides.driver_id=taxi_driver_locations.driver_id
     and status in ('accepted','arrived','ongoing'))));
drop policy if exists taxi_deletion_read on public.taxi_deletion_requests;
create policy taxi_deletion_read on public.taxi_deletion_requests for select to authenticated
 using(user_id=(select auth.uid()) or (select taxi_private.my_role())='admin');

create or replace function taxi_private.save_profile(p_name text,p_phone text,p_region text,p_car text,p_plate text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.taxi_profiles;
begin
  select * into actor from public.taxi_profiles where id=auth.uid() for update;
  if not found then raise exception 'يلزم تسجيل الدخول'; end if;
  if char_length(trim(p_name)) not between 2 and 80 or p_phone !~ '^\+?[0-9]{8,15}$'
    or char_length(p_region) not between 1 and 40 or char_length(coalesce(p_car,''))>80
    or char_length(coalesce(p_plate,''))>30 then raise exception 'تحقق من بيانات الملف الشخصي'; end if;
  if actor.role='driver' and p_region<>actor.governorate and exists(select 1 from public.taxi_rides where driver_id=actor.id and status in ('accepted','arrived','ongoing'))
    then raise exception 'أكمل الرحلة الحالية قبل تغيير المحافظة'; end if;
  update public.taxi_profiles set full_name=trim(p_name),phone=p_phone,governorate=p_region,
    car_make=coalesce(p_car,''),plate=coalesce(p_plate,''),updated_at=now() where id=actor.id returning * into actor;
  return to_jsonb(actor);
end;
$$;
create or replace function taxi_private.set_online(p_online boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.taxi_profiles;
begin
  select * into actor from public.taxi_profiles where id=auth.uid() for update;
  if not found or actor.role<>'driver' then raise exception 'خاص بحساب السائق'; end if;
  if p_online and (not actor.is_approved or actor.car_make='' or actor.plate='') then raise exception 'حساب السائق يحتاج موافقة الإدارة وبيانات السيارة'; end if;
  update public.taxi_profiles set is_online=p_online,driver_seen_at=now(),updated_at=now() where id=actor.id returning * into actor;
  if not p_online then delete from public.taxi_driver_locations where driver_id=actor.id; end if;
  return to_jsonb(actor);
end;
$$;
create or replace function taxi_private.create_ride(p_id uuid,p_region text,p_service text,p_pick_lat double precision,p_pick_lng double precision,p_dest_lat double precision,p_dest_lng double precision,p_pick_text text,p_dest_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.taxi_profiles; fare public.taxi_fares; ride public.taxi_rides; distance numeric; price integer;
begin
  select * into actor from public.taxi_profiles where id=auth.uid();
  if not found or actor.role<>'customer' then raise exception 'الطلب يحتاج حساب زبون'; end if;
  if actor.phone !~ '^\+?[0-9]{8,15}$' or char_length(actor.full_name)<2 then raise exception 'أكمل الاسم ورقم الهاتف في ملفك'; end if;
  select * into ride from public.taxi_rides where id=p_id;
  if found then
    if ride.customer_id<>actor.id then raise exception 'معرّف طلب غير صالح'; end if;
    return to_jsonb(ride);
  end if;
  if p_id is null or p_pick_lat is null or p_pick_lng is null or p_dest_lat is null or p_dest_lng is null
    or p_pick_lat not between 28 and 38 or p_dest_lat not between 28 and 38
    or p_pick_lng not between 38 and 49 or p_dest_lng not between 38 and 49
    or char_length(trim(p_region)) not between 1 and 40 or char_length(trim(p_pick_text)) not between 1 and 200
    or char_length(trim(p_dest_text)) not between 1 and 200 then raise exception 'حدد نقطتي الرحلة وبياناتهما داخل نطاق الخدمة'; end if;
  select * into fare from public.taxi_fares where service=p_service;
  if not found then raise exception 'نوع الخدمة غير متاح'; end if;
  distance:=round((6371*2*asin(sqrt(least(1.0,power(sin(radians(p_dest_lat-p_pick_lat)/2),2)+cos(radians(p_pick_lat))*cos(radians(p_dest_lat))*power(sin(radians(p_dest_lng-p_pick_lng)/2),2)))))::numeric,2);
  if distance<0.1 then raise exception 'نقطتا الرحلة متقاربتان جدًا'; end if;
  price:=greatest(fare.minimum_fare,(ceil((fare.base_fare+distance*fare.per_km)/250.0)*250)::integer);
  begin
    insert into public.taxi_rides(id,customer_id,governorate,service,pickup_lat,pickup_lng,destination_lat,destination_lng,pickup_text,destination_text,distance_km,estimated_fare)
      values(p_id,actor.id,p_region,p_service,p_pick_lat,p_pick_lng,p_dest_lat,p_dest_lng,trim(p_pick_text),trim(p_dest_text),distance,price)
      on conflict(id) do nothing returning * into ride;
  exception when unique_violation then raise exception 'عندك طلب نشط، افتحه من طلباتي'; end;
  if ride.id is null then select * into ride from public.taxi_rides where id=p_id and customer_id=actor.id; end if;
  if ride.id is null then raise exception 'تعذر إنشاء الطلب'; end if;
  return to_jsonb(ride);
end;
$$;
create or replace function taxi_private.accept_ride(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.taxi_profiles; ride public.taxi_rides;
begin
  select * into actor from public.taxi_profiles where id=auth.uid() for update;
  if not found or actor.role<>'driver' or not actor.is_approved or not actor.is_online
    or actor.driver_seen_at is null or actor.driver_seen_at<=now()-interval '2 minutes' then raise exception 'فعّل حساب السائق واتصالك أولًا'; end if;
  select * into ride from public.taxi_rides where id=p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if ride.driver_id=actor.id and ride.status in ('accepted','arrived','ongoing') then return to_jsonb(ride); end if;
  if ride.status<>'pending' or ride.governorate<>actor.governorate then raise exception 'الطلب غير متاح لك الآن'; end if;
  if exists(select 1 from public.taxi_rides where driver_id=actor.id and status in ('accepted','arrived','ongoing')) then raise exception 'أكمل رحلتك الحالية أولًا'; end if;
  update public.taxi_rides set driver_id=actor.id,status='accepted',updated_at=now() where id=p_id returning * into ride;
  return to_jsonb(ride);
end;
$$;
create or replace function taxi_private.transition_ride(p_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); role_name text:=taxi_private.my_role(); ride public.taxi_rides; permitted boolean:=false;
begin
  if actor is null then raise exception 'يلزم تسجيل الدخول'; end if;
  select * into ride from public.taxi_rides where id=p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if actor<>ride.customer_id and actor is distinct from ride.driver_id and role_name is distinct from 'admin' then raise exception 'غير مخول'; end if;
  if ride.status=p_status then return to_jsonb(ride); end if;
  if p_status='cancelled' then
    permitted:=(role_name='admin' and ride.status in ('pending','accepted','arrived','ongoing'))
      or (actor=ride.customer_id and ride.status in ('pending','accepted'))
      or (actor=ride.driver_id and ride.status in ('accepted','arrived'));
  elsif actor=ride.driver_id then
    permitted:=(ride.status='accepted' and p_status='arrived') or (ride.status='arrived' and p_status='ongoing') or (ride.status='ongoing' and p_status='completed');
  end if;
  if not coalesce(permitted,false) then raise exception 'تغيير حالة غير مسموح'; end if;
  update public.taxi_rides set status=p_status,updated_at=now(),completed_at=case when p_status='completed' then now() else completed_at end
    where id=p_id returning * into ride;
  if p_status in ('completed','cancelled') and ride.driver_id is not null then delete from public.taxi_driver_locations where driver_id=ride.driver_id; end if;
  return to_jsonb(ride);
end;
$$;
create or replace function taxi_private.approve_driver(p_id uuid,p_approved boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare driver public.taxi_profiles;
begin
  if taxi_private.my_role() is distinct from 'admin' then raise exception 'خاص بالإدارة'; end if;
  select * into driver from public.taxi_profiles where id=p_id and role='driver' for update;
  if not found then raise exception 'السائق غير موجود'; end if;
  if p_approved and (driver.car_make='' or driver.plate='' or driver.phone !~ '^\+?[0-9]{8,15}$') then raise exception 'بيانات السائق أو السيارة ناقصة'; end if;
  update public.taxi_profiles set is_approved=p_approved,is_online=case when p_approved then is_online else false end,updated_at=now() where id=p_id returning * into driver;
  if not p_approved then delete from public.taxi_driver_locations where driver_id=p_id; end if;
  return to_jsonb(driver);
end;
$$;
create or replace function taxi_private.save_fare(p_service text,p_base integer,p_per_km integer,p_minimum integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare fare public.taxi_fares;
begin
  if taxi_private.my_role() is distinct from 'admin' then raise exception 'خاص بالإدارة'; end if;
  update public.taxi_fares set base_fare=p_base,per_km=p_per_km,minimum_fare=p_minimum where service=p_service returning * into fare;
  if not found then raise exception 'الخدمة غير موجودة'; end if;
  return to_jsonb(fare);
end;
$$;
create or replace function taxi_private.share_location(p_lat double precision,p_lng double precision) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if taxi_private.my_role() is distinct from 'driver' then raise exception 'خاص بالسائق'; end if;
  if p_lat is null and p_lng is null then delete from public.taxi_driver_locations where driver_id=auth.uid();return true; end if;
  if p_lat is null or p_lng is null or p_lat not between 28 and 38 or p_lng not between 38 and 49 then raise exception 'الموقع خارج نطاق الخدمة'; end if;
  if not exists(select 1 from public.taxi_profiles where id=auth.uid() and is_approved and is_online) then raise exception 'فعّل اتصال السائق أولًا'; end if;
  insert into public.taxi_driver_locations(driver_id,latitude,longitude,updated_at) values(auth.uid(),p_lat,p_lng,now())
    on conflict(driver_id) do update set latitude=p_lat,longitude=p_lng,updated_at=now();
  return true;
end;
$$;
create or replace function taxi_private.statistics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); role_name text:=taxi_private.my_role(); result jsonb;
begin
  if actor is null or role_name is null then raise exception 'يلزم تسجيل الدخول'; end if;
  select jsonb_build_object('completed',count(*) filter(where status='completed'),
    'active',count(*) filter(where status in ('pending','accepted','arrived','ongoing')),
    'earnings',coalesce(sum(estimated_fare) filter(where status='completed'),0),
    'today',coalesce(sum(estimated_fare) filter(where status='completed' and (completed_at at time zone 'Asia/Baghdad')::date=(now() at time zone 'Asia/Baghdad')::date),0))
    into result from public.taxi_rides where role_name='admin' or (role_name='driver' and driver_id=actor) or (role_name='customer' and customer_id=actor);
  if role_name='admin' then result:=result||jsonb_build_object('drivers',(select count(*) from public.taxi_profiles where role='driver'),'pending_drivers',(select count(*) from public.taxi_profiles where role='driver' and not is_approved)); end if;
  return result;
end;
$$;
create or replace function taxi_private.request_deletion() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'يلزم تسجيل الدخول'; end if;
  if exists(select 1 from public.taxi_rides where (customer_id=auth.uid() or driver_id=auth.uid()) and status in ('pending','accepted','arrived','ongoing')) then raise exception 'أكمل أو ألغِ الرحلة الحالية أولًا'; end if;
  insert into public.taxi_deletion_requests(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  return true;
end;
$$;

-- Public RPCs are invoker wrappers. Privileged work and authorization stay in the private schema.
create or replace function public.taxi_save_profile(p_name text,p_phone text,p_region text,p_car text,p_plate text) returns jsonb language sql security invoker set search_path='' as $$select taxi_private.save_profile(p_name,p_phone,p_region,p_car,p_plate);$$;
create or replace function public.taxi_set_online(p_online boolean) returns jsonb language sql security invoker set search_path='' as $$select taxi_private.set_online(p_online);$$;
create or replace function public.taxi_create_ride(p_id uuid,p_region text,p_service text,p_pick_lat double precision,p_pick_lng double precision,p_dest_lat double precision,p_dest_lng double precision,p_pick_text text,p_dest_text text) returns jsonb language sql security invoker set search_path='' as $$select taxi_private.create_ride(p_id,p_region,p_service,p_pick_lat,p_pick_lng,p_dest_lat,p_dest_lng,p_pick_text,p_dest_text);$$;
create or replace function public.taxi_accept_ride(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select taxi_private.accept_ride(p_id);$$;
create or replace function public.taxi_transition_ride(p_id uuid,p_status text) returns jsonb language sql security invoker set search_path='' as $$select taxi_private.transition_ride(p_id,p_status);$$;
create or replace function public.taxi_approve_driver(p_id uuid,p_approved boolean) returns jsonb language sql security invoker set search_path='' as $$select taxi_private.approve_driver(p_id,p_approved);$$;
create or replace function public.taxi_save_fare(p_service text,p_base integer,p_per_km integer,p_minimum integer) returns jsonb language sql security invoker set search_path='' as $$select taxi_private.save_fare(p_service,p_base,p_per_km,p_minimum);$$;
create or replace function public.taxi_share_location(p_lat double precision,p_lng double precision) returns boolean language sql security invoker set search_path='' as $$select taxi_private.share_location(p_lat,p_lng);$$;
create or replace function public.taxi_statistics() returns jsonb language sql security invoker set search_path='' as $$select taxi_private.statistics();$$;
create or replace function public.taxi_request_deletion() returns boolean language sql security invoker set search_path='' as $$select taxi_private.request_deletion();$$;

revoke execute on all functions in schema taxi_private from public,anon;
grant execute on all functions in schema taxi_private to authenticated;
revoke execute on function taxi_private.new_user() from authenticated;
-- Scope public grants to this application's functions only.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'taxi\_%' escape '\' loop
  execute format('revoke execute on function %s from public,anon',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end;$$;

do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='taxi_rides') then alter publication supabase_realtime add table public.taxi_rides; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='taxi_profiles') then alter publication supabase_realtime add table public.taxi_profiles; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='taxi_driver_locations') then alter publication supabase_realtime add table public.taxi_driver_locations; end if;
 end if;
end;$$;
notify pgrst, 'reload schema';
commit;
