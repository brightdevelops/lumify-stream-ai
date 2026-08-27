CREATE TABLE IF NOT EXISTS public.crypto_invoices (
  order_id        text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  package_id      text NOT NULL,
  credits         int  NOT NULL,
  amount_ngn      int  NOT NULL,
  amount_usd      numeric(12,2) NOT NULL,
  usd_ngn_rate    numeric(12,4) NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  cryptomus_uuid  text NULL,
  payer_currency  text NULL,
  payment_amount  numeric(20,8) NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crypto_invoices TO authenticated;
GRANT ALL ON public.crypto_invoices TO service_role;

ALTER TABLE public.crypto_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crypto_invoices_select_own" ON public.crypto_invoices;
CREATE POLICY "crypto_invoices_select_own"
  ON public.crypto_invoices FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS crypto_invoices_user_created_idx
  ON public.crypto_invoices (user_id, created_at DESC);