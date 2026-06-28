REVOKE EXECUTE ON FUNCTION public.is_maintenance_mode() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_site_setting(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_maintenance_mode() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_site_setting(text, boolean) TO authenticated, service_role;