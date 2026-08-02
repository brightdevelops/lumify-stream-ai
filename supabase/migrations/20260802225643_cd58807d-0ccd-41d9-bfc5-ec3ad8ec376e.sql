-- 1. Conversation triage fields
ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- 2. Topic classifier
CREATE OR REPLACE FUNCTION public.support_classify_topic(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_text,'')) ~ '(payment|credit|paid|korapay|flutterwave|transfer|refund|billing)' THEN 'payments'
    WHEN lower(coalesce(p_text,'')) ~ '(camera|stream|obs|video|lag|webcam|fps)' THEN 'camera'
    WHEN lower(coalesce(p_text,'')) ~ '(account|login|log in|sign in|password|email)' THEN 'account'
    ELSE 'other'
  END;
$$;

CREATE OR REPLACE FUNCTION public.support_after_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.support_conversations
    SET last_message_at = NEW.created_at,
        last_message_preview = LEFT(NEW.message, 140),
        unread_for_admin = CASE WHEN NEW.sender = 'user' THEN unread_for_admin + 1 ELSE unread_for_admin END,
        unread_for_user  = CASE WHEN NEW.sender = 'admin' THEN unread_for_user + 1 ELSE unread_for_user END,
        topic = CASE
                  WHEN NEW.sender = 'user' AND (topic IS NULL OR topic = 'other')
                    THEN public.support_classify_topic(coalesce(subject,'') || ' ' || NEW.message)
                  ELSE topic
                END,
        status = CASE WHEN NEW.sender = 'user' THEN 'open' ELSE status END,
        snoozed_until = CASE WHEN NEW.sender = 'user' THEN NULL ELSE snoozed_until END,
        updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;

-- Backfill topics for existing conversations
UPDATE public.support_conversations sc
SET topic = public.support_classify_topic(
      coalesce(sc.subject,'') || ' ' || coalesce((
        SELECT string_agg(m.message, ' ') FROM public.support_messages m
        WHERE m.conversation_id = sc.id AND m.sender = 'user'
      ), '')
    )
WHERE sc.topic IS NULL;

-- 3. Canned replies
CREATE TABLE IF NOT EXISTS public.support_canned_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_canned_replies TO authenticated;
GRANT ALL ON public.support_canned_replies TO service_role;

ALTER TABLE public.support_canned_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage canned replies" ON public.support_canned_replies;
CREATE POLICY "Admins manage canned replies"
  ON public.support_canned_replies FOR ALL TO authenticated
  USING (COALESCE((SELECT pr.is_admin FROM public.profiles pr WHERE pr.id = auth.uid()), false) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (COALESCE((SELECT pr.is_admin FROM public.profiles pr WHERE pr.id = auth.uid()), false) OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_canned_replies_updated ON public.support_canned_replies;
CREATE TRIGGER trg_canned_replies_updated BEFORE UPDATE ON public.support_canned_replies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.support_canned_replies (slug, body, sort_order) VALUES
  ('credited', 'Your account has been credited — please refresh your dashboard and you should see the new balance.', 1),
  ('payment-pending', 'Thanks for the payment. It is currently showing as pending on our provider''s side. We are verifying it now and will credit your account as soon as it confirms.', 2),
  ('camera-fix', 'Please make sure no other app is using your camera, then reload the Studio page and pick your camera again from the dropdown.', 3),
  ('obs-setup', 'In OBS: add a Browser source, paste your Lumify output link, set width 1280 and height 720, and tick "Control audio via OBS".', 4),
  ('apology', 'Apologies for the trouble and the delay — we are on it and will update you shortly.', 5)
ON CONFLICT (slug) DO NOTHING;

-- 4. Status action
CREATE OR REPLACE FUNCTION public.admin_set_conversation_status(p_conversation_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT pr.is_admin FROM profiles pr WHERE pr.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  IF p_status NOT IN ('open','resolved','snoozed') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE public.support_conversations
    SET status = p_status,
        snoozed_until = CASE WHEN p_status = 'snoozed' THEN now() + interval '24 hours' ELSE NULL END,
        updated_at = now()
  WHERE id = p_conversation_id;
END; $$;

REVOKE ALL ON FUNCTION public.admin_set_conversation_status(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_conversation_status(uuid, text) TO authenticated;

-- 5. Extended conversation list
DROP FUNCTION IF EXISTS public.admin_list_support_conversations(integer);
CREATE OR REPLACE FUNCTION public.admin_list_support_conversations(p_limit integer DEFAULT 200)
RETURNS TABLE(
  id uuid, user_id uuid, user_email text, full_name text, type text, subject text,
  last_message_at timestamptz, last_message_preview text, unread_for_admin integer,
  credit_balance integer, created_at timestamptz,
  topic text, status text, snoozed_until timestamptz,
  last_sender text, last_admin_was_auto boolean, unanswered_count integer,
  first_message_at timestamptz, message_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT pr.is_admin FROM profiles pr WHERE pr.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT m.conversation_id AS cid,
           min(m.created_at) AS first_at,
           count(*)::int AS msg_count,
           (SELECT m2.sender FROM public.support_messages m2
             WHERE m2.conversation_id = m.conversation_id
             ORDER BY m2.created_at DESC LIMIT 1) AS last_sender,
           (SELECT COALESCE(m3.is_auto_reply, false) FROM public.support_messages m3
             WHERE m3.conversation_id = m.conversation_id AND m3.sender = 'admin'
             ORDER BY m3.created_at DESC LIMIT 1) AS last_admin_auto,
           (SELECT count(*)::int FROM public.support_messages m4
             WHERE m4.conversation_id = m.conversation_id
               AND m4.sender = 'user'
               AND m4.created_at > COALESCE((SELECT max(m5.created_at) FROM public.support_messages m5
                    WHERE m5.conversation_id = m.conversation_id AND m5.sender = 'admin'), '-infinity'::timestamptz)
           ) AS unanswered
    FROM public.support_messages m
    GROUP BY m.conversation_id
  )
  SELECT sc.id,
         sc.user_id,
         COALESCE(sc.user_email, p.email),
         p.full_name,
         sc.type,
         sc.subject,
         sc.last_message_at,
         sc.last_message_preview,
         sc.unread_for_admin,
         COALESCE(c.balance, 0),
         sc.created_at,
         COALESCE(sc.topic, 'other'),
         COALESCE(sc.status, 'open'),
         sc.snoozed_until,
         COALESCE(a.last_sender, 'user'),
         COALESCE(a.last_admin_auto, false),
         COALESCE(a.unanswered, 0),
         COALESCE(a.first_at, sc.created_at),
         COALESCE(a.msg_count, 0)
  FROM public.support_conversations sc
  LEFT JOIN public.profiles p ON p.id = sc.user_id
  LEFT JOIN public.credits c ON c.user_id = sc.user_id
  LEFT JOIN agg a ON a.cid = sc.id
  ORDER BY sc.last_message_at DESC
  LIMIT LEAST(GREATEST(p_limit,1), 1000);
END; $$;

REVOKE ALL ON FUNCTION public.admin_list_support_conversations(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_support_conversations(integer) TO authenticated;

-- 6. Customer context
CREATE OR REPLACE FUNCTION public.admin_support_customer_context(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_result json;
BEGIN
  IF NOT COALESCE((SELECT pr.is_admin FROM profiles pr WHERE pr.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT p.id, p.email, p.created_at INTO v_profile FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN RETURN json_build_object('found', false); END IF;

  SELECT json_build_object(
    'found', true,
    'email', v_profile.email,
    'signed_up_at', v_profile.created_at,
    'balance', COALESCE((SELECT c.balance FROM public.credits c WHERE c.user_id = p_user_id), 0),
    'session_count', (SELECT count(*) FROM public.stream_sessions s WHERE s.user_id = p_user_id),
    'lifetime_topups_ngn', COALESCE((SELECT sum(t.amount_ngn) FROM public.transactions t
        WHERE t.user_id = p_user_id AND t.category = 'purchase'), 0),
    'transactions', COALESCE((SELECT json_agg(x) FROM (
        SELECT t.id, t.credits, t.amount_ngn, t.category, t.description, t.reference, t.created_at
        FROM public.transactions t WHERE t.user_id = p_user_id
        ORDER BY t.created_at DESC LIMIT 3
      ) x), '[]'::json),
    'last_session', (SELECT json_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at, 'credits_used', s.credits_used)
      FROM public.stream_sessions s WHERE s.user_id = p_user_id ORDER BY s.started_at DESC LIMIT 1)
  ) INTO v_result;

  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.admin_support_customer_context(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_support_customer_context(uuid) TO authenticated;