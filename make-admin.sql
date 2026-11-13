-- After you create and confirm your own account, replace the email below.
-- Run this privately in Supabase SQL Editor as the project owner.
update public.taxi_profiles
set role='admin',is_approved=true,is_online=false,updated_at=now()
where id=(select id from auth.users where email='YOUR_ADMIN_EMAIL');
-- Confirm that exactly one intended account became admin.
select id,full_name,role from public.taxi_profiles where role='admin';
