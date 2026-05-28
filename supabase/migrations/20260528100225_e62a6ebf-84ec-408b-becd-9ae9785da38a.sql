
-- Stream sessions table for active stream monitoring
CREATE TABLE public.stream_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  credits_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.stream_sessions TO authenticated;
GRANT ALL ON public.stream_sessions TO service_role;

ALTER TABLE public.stream_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sessions" ON public.stream_sessions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all sessions" ON public.stream_sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_stream_sessions_active ON public.stream_sessions (last_heartbeat DESC) WHERE ended_at IS NULL;
CREATE INDEX idx_stream_sessions_user ON public.stream_sessions (user_id, started_at DESC);

-- Combined credit/revenue stats for admin
CREATE OR REPLACE FUNCTION public.admin_get_credit_stats()
RETURNS TABLE (
  credits_sold_today bigint, credits_sold_week bigint, credits_sold_month bigint,
  revenue_today numeric, revenue_week numeric, revenue_month numeric,
  total_credits_held bigint, total_credits_used bigint, active_streams bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(credits) FROM transactions WHERE type='purchase' AND created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(credits) FROM transactions WHERE type='purchase' AND created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(credits) FROM transactions WHERE type='purchase' AND created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(amount) FROM transactions WHERE type='purchase' AND created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(amount) FROM transactions WHERE type='purchase' AND created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(amount) FROM transactions WHERE type='purchase' AND created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(balance) FROM credits), 0),
    COALESCE((SELECT SUM(credits) FROM transactions WHERE type='usage'), 0),
    (SELECT COUNT(*) FROM stream_sessions WHERE ended_at IS NULL AND last_heartbeat > now() - interval '30 seconds');
END;
$$;

-- Extended users list including last_seen and total_purchased credits
CREATE OR REPLACE FUNCTION public.admin_list_users_full()
RETURNS TABLE (
  user_id uuid, email text, full_name text, created_at timestamptz,
  balance integer, total_credits_purchased bigint, total_credits_used bigint,
  total_spent numeric, last_seen timestamptz, is_admin boolean, is_streaming boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    p.id, p.email, p.full_name, p.created_at,
    COALESCE(c.balance, 0),
    COALESCE((SELECT SUM(credits) FROM transactions t WHERE t.user_id = p.id AND t.type='purchase'), 0),
    COALESCE((SELECT SUM(credits) FROM transactions t WHERE t.user_id = p.id AND t.type='usage'), 0),
    COALESCE((SELECT SUM(amount)  FROM transactions t WHERE t.user_id = p.id AND t.type='purchase'), 0),
    (SELECT MAX(created_at) FROM page_visits v WHERE v.user_id = p.id),
    public.has_role(p.id, 'admin'),
    EXISTS(SELECT 1 FROM stream_sessions s WHERE s.user_id = p.id AND s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds')
  FROM profiles p
  LEFT JOIN credits c ON c.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$$;

-- All transactions for credits monitor
CREATE OR REPLACE FUNCTION public.admin_list_transactions(p_limit integer DEFAULT 500, p_type text DEFAULT NULL)
RETURNS TABLE (
  id uuid, user_id uuid, user_email text, type text,
  credits integer, amount numeric, description text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT t.id, t.user_id, p.email, t.type::text, t.credits, t.amount, t.description, t.created_at
  FROM transactions t LEFT JOIN profiles p ON p.id = t.user_id
  WHERE (p_type IS NULL OR t.type::text = p_type)
  ORDER BY t.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Per-user transaction history
CREATE OR REPLACE FUNCTION public.admin_user_transactions(p_user uuid)
RETURNS TABLE (id uuid, type text, credits integer, amount numeric, description text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT t.id, t.type::text, t.credits, t.amount, t.description, t.created_at
  FROM transactions t WHERE t.user_id = p_user
  ORDER BY t.created_at DESC;
END;
$$;

-- Active streams right now
CREATE OR REPLACE FUNCTION public.admin_get_active_streams()
RETURNS TABLE (
  session_id uuid, user_id uuid, user_email text, full_name text,
  started_at timestamptz, last_heartbeat timestamptz,
  credits_used integer, credits_remaining integer, duration_seconds integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT s.id, s.user_id, p.email, p.full_name,
         s.started_at, s.last_heartbeat,
         s.credits_used, COALESCE(c.balance, 0),
         EXTRACT(EPOCH FROM (now() - s.started_at))::int
  FROM stream_sessions s
  LEFT JOIN profiles p ON p.id = s.user_id
  LEFT JOIN credits c ON c.user_id = s.user_id
  WHERE s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds'
  ORDER BY s.started_at DESC;
END;
$$;

-- Extended visitor stats: unique vs returning, registered vs anonymous
CREATE OR REPLACE FUNCTION public.admin_visitor_overview()
RETURNS TABLE (
  visits_today bigint, visits_week bigint, visits_month bigint,
  unique_today bigint, unique_week bigint, unique_month bigint,
  registered_visitors bigint, anonymous_visitors bigint,
  returning_visitors bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM page_visits WHERE created_at >= date_trunc('day', now())),
    (SELECT COUNT(*) FROM page_visits WHERE created_at >= now() - interval '7 days'),
    (SELECT COUNT(*) FROM page_visits WHERE created_at >= now() - interval '30 days'),
    (SELECT COUNT(DISTINCT COALESCE(ip, id::text)) FROM page_visits WHERE created_at >= date_trunc('day', now())),
    (SELECT COUNT(DISTINCT COALESCE(ip, id::text)) FROM page_visits WHERE created_at >= now() - interval '7 days'),
    (SELECT COUNT(DISTINCT COALESCE(ip, id::text)) FROM page_visits WHERE created_at >= now() - interval '30 days'),
    (SELECT COUNT(DISTINCT user_id) FROM page_visits WHERE user_id IS NOT NULL),
    (SELECT COUNT(DISTINCT ip) FROM page_visits WHERE user_id IS NULL AND ip IS NOT NULL),
    (SELECT COUNT(*) FROM (
      SELECT COALESCE(user_id::text, ip) k FROM page_visits
      WHERE COALESCE(user_id::text, ip) IS NOT NULL
      GROUP BY 1 HAVING COUNT(*) > 1
    ) r);
END;
$$;

-- Pages visited breakdown
CREATE OR REPLACE FUNCTION public.admin_top_pages(p_limit integer DEFAULT 20)
RETURNS TABLE (path text, visits bigint, unique_visitors bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT v.path, COUNT(*)::bigint, COUNT(DISTINCT COALESCE(v.ip, v.id::text))::bigint
  FROM page_visits v
  GROUP BY v.path
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
END;
$$;
