ALTER TABLE public.page_visits ADD COLUMN IF NOT EXISTS ip text;
CREATE INDEX IF NOT EXISTS idx_page_visits_ip_created ON public.page_visits (ip, created_at DESC);