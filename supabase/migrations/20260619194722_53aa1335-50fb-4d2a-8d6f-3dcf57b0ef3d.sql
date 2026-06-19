CREATE OR REPLACE FUNCTION public.admin_list_crypto_invoices(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, full_name text, order_id text, pack_id text, credits integer, price_usd numeric, amount_ngn integer, status text, invoice_url text, paid_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT pr.is_admin FROM public.profiles pr WHERE pr.id = auth.uid()), false)
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
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_payment_issues(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, full_name text, method text, order_reference text, pack_id text, message text, status text, admin_note text, resolved_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT pr.is_admin FROM public.profiles pr WHERE pr.id = auth.uid()), false)
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
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_update_payment_issue(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT pr.is_admin FROM public.profiles pr WHERE pr.id = auth.uid()), false)
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
END; $function$;