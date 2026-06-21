
-- Conversations table (groups messages into threads)
CREATE TABLE public.support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  type text NOT NULL CHECK (type IN ('chat','contact')),
  subject text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  unread_for_admin int NOT NULL DEFAULT 0,
  unread_for_user int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.support_conversations TO authenticated;
GRANT ALL ON public.support_conversations TO service_role;

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own conversations"
  ON public.support_conversations FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Users create own conversations"
  ON public.support_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins update conversations"
  ON public.support_conversations FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE INDEX idx_support_conv_user ON public.support_conversations(user_id, last_message_at DESC);
CREATE INDEX idx_support_conv_last ON public.support_conversations(last_message_at DESC);

-- Messages table
CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  type text NOT NULL CHECK (type IN ('chat','contact')),
  subject text,
  message text NOT NULL,
  sender text NOT NULL CHECK (sender IN ('user','admin')),
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own messages"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Users insert own user messages, admins insert admin messages"
  ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (
    (sender = 'user' AND auth.uid() = user_id)
    OR (
      sender = 'admin'
      AND (
        COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
        OR public.has_role(auth.uid(), 'admin')
      )
    )
  );

CREATE POLICY "Mark messages read"
  ON public.support_messages FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE INDEX idx_support_msg_conv ON public.support_messages(conversation_id, created_at);
CREATE INDEX idx_support_msg_user ON public.support_messages(user_id, created_at DESC);

-- Trigger: keep conversation summary in sync
CREATE OR REPLACE FUNCTION public.support_after_message_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_conversations
    SET last_message_at = NEW.created_at,
        last_message_preview = LEFT(NEW.message, 140),
        unread_for_admin = CASE WHEN NEW.sender = 'user' THEN unread_for_admin + 1 ELSE unread_for_admin END,
        unread_for_user  = CASE WHEN NEW.sender = 'admin' THEN unread_for_user + 1 ELSE unread_for_user END,
        updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_support_after_message_insert
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_after_message_insert();

-- Admin function: list all conversations with user context
CREATE OR REPLACE FUNCTION public.admin_list_support_conversations(p_limit int DEFAULT 200)
RETURNS TABLE (
  id uuid, user_id uuid, user_email text, full_name text,
  type text, subject text, last_message_at timestamptz,
  last_message_preview text, unread_for_admin int,
  credit_balance int, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT sc.id, sc.user_id, COALESCE(sc.user_email, p.email), p.full_name,
         sc.type, sc.subject, sc.last_message_at, sc.last_message_preview,
         sc.unread_for_admin, COALESCE(c.balance, 0), sc.created_at
  FROM support_conversations sc
  LEFT JOIN profiles p ON p.id = sc.user_id
  LEFT JOIN credits c ON c.user_id = sc.user_id
  ORDER BY sc.last_message_at DESC
  LIMIT LEAST(GREATEST(p_limit,1), 1000);
END; $$;

-- Admin mark conversation read
CREATE OR REPLACE FUNCTION public.admin_mark_conversation_read(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE support_conversations SET unread_for_admin = 0 WHERE id = p_conversation_id;
  UPDATE support_messages SET read = true
   WHERE conversation_id = p_conversation_id AND sender = 'user' AND read = false;
END; $$;

-- User mark conversation read
CREATE OR REPLACE FUNCTION public.mark_my_conversation_read(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE support_conversations
     SET unread_for_user = 0
   WHERE id = p_conversation_id AND user_id = auth.uid();
  UPDATE support_messages SET read = true
   WHERE conversation_id = p_conversation_id AND user_id = auth.uid()
     AND sender = 'admin' AND read = false;
END; $$;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_conversations;

-- updated_at trigger
CREATE TRIGGER trg_support_conv_updated
  BEFORE UPDATE ON public.support_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
