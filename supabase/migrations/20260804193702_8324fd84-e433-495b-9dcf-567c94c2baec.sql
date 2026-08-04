ALTER TABLE public.api_requests ALTER COLUMN api_key_id DROP NOT NULL;
ALTER TABLE public.api_requests DROP CONSTRAINT IF EXISTS api_requests_api_key_id_fkey;
ALTER TABLE public.api_requests ADD CONSTRAINT api_requests_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;