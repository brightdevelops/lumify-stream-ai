
-- 1) crypto_invoices
CREATE TABLE public.crypto_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id text NOT NULL UNIQUE,
  pack_id text NOT NULL,
  credits integer NOT NULL,
  price_usd numeric(10,2) NOT NULL,
  amount_ngn integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invoice_url text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crypto_invoices_user_id_idx ON public.crypto_invoices(user_id);
CREATE INDEX crypto_invoices_status_idx ON public.crypto_invoices(status);
CREATE INDEX crypto_invoices_created_at_idx ON public.crypto_invoices(created_at DESC);

GRANT SELECT ON public.crypto_invoices TO authenticated;
GRANT ALL ON public.crypto_invoices TO service_role;

ALTER TABLE public.crypto_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own crypto invoices"
  ON public.crypto_invoices FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all crypto invoices"
  ON public.crypto_invoices FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin')
         OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false));

-- 2) payment_issues
CREATE TABLE public.payment_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL,
  order_reference text,
  pack_id text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_note text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_issues_user_id_idx ON public.payment_issues(user_id);
CREATE INDEX payment_issues_status_idx ON public.payment_issues(status);
CREATE INDEX payment_issues_created_at_idx ON public.payment_issues(created_at DESC);

GRANT SELECT, INSERT ON public.payment_issues TO authenticated;
GRANT ALL ON public.payment_issues TO service_role;

ALTER TABLE public.payment_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own payment issues"
  ON public.payment_issues FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own payment issues"
  ON public.payment_issues FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read all payment issues"
  ON public.payment_issues FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin')
         OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false));

-- 3) updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER crypto_invoices_touch BEFORE UPDATE ON public.crypto_invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER payment_issues_touch BEFORE UPDATE ON public.payment_issues
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_list_crypto_invoices(p_status text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE(
  id uuid, user_id uuid, user_email text, full_name text,
  order_id text, pack_id text, credits int, price_usd numeric, amount_ngn int,
  status text, invoice_url text, paid_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT ci.id, ci.user_id, p.email, p.full_name,
         ci.order_id, ci.pack_id, ci.credits, ci.price_usd, ci.amount_ngn,
         ci.status, ci.invoice_url, ci.paid_at, ci.created_at
  FROM public.crypto_invoices ci
  LEFT JOIN public.profiles p ON p.id = ci.user_id
  WHERE p_status IS NULL OR ci.status = p_status
  ORDER BY ci.created_at DESC
  LIMIT LEAST(GREATEST(p_limit,1), 1000);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_payment_issues(p_status text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE(
  id uuid, user_id uuid, user_email text, full_name text,
  method text, order_reference text, pack_id text, message text,
  status text, admin_note text, resolved_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT pi.id, pi.user_id, p.email, p.full_name,
         pi.method, pi.order_reference, pi.pack_id, pi.message,
         pi.status, pi.admin_note, pi.resolved_at, pi.created_at
  FROM public.payment_issues pi
  LEFT JOIN public.profiles p ON p.id = pi.user_id
  WHERE p_status IS NULL OR pi.status = p_status
  ORDER BY pi.created_at DESC
  LIMIT LEAST(GREATEST(p_limit,1), 1000);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_payment_issue(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
  THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_status NOT IN ('open','in_progress','resolved','dismissed') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  UPDATE public.payment_issues
    SET status = p_status,
        admin_note = COALESCE(p_note, admin_note),
        resolved_by = CASE WHEN p_status IN ('resolved','dismissed') THEN auth.uid() ELSE resolved_by END,
        resolved_at = CASE WHEN p_status IN ('resolved','dismissed') THEN now() ELSE resolved_at END
  WHERE id = p_id;
END; $$;
