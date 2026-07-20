
-- 1) Payment receipts: append-only idempotency ledger independent of transactions
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  reference text NOT NULL,
  user_id uuid NOT NULL,
  credits integer NOT NULL,
  amount_ngn integer,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipts_provider_reference_key UNIQUE (provider, reference)
);

-- No grants to anon/authenticated: only service_role writes/reads.
GRANT ALL ON public.payment_receipts TO service_role;

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
-- No policies = no access for authenticated/anon. service_role bypasses RLS.

-- 2) Backfill from existing Flutterwave-tagged transactions
INSERT INTO public.payment_receipts (provider, reference, user_id, credits, amount_ngn, description, created_at)
SELECT 'flutterwave',
       substring(description from 'Flutterwave:([A-Za-z0-9_.\-]+)'),
       user_id,
       credits,
       COALESCE(amount_ngn, amount)::int,
       description,
       created_at
FROM public.transactions
WHERE type = 'purchase'
  AND description ~ 'Flutterwave:[A-Za-z0-9_.\-]+'
ON CONFLICT (provider, reference) DO NOTHING;

-- 3) Revoke anon/public EXECUTE on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.run_credit_integrity_check() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_profile_credits_from_wallet() FROM anon, PUBLIC;
