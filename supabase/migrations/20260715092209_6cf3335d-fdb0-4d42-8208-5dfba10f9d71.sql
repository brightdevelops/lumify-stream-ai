
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS is_auto_reply boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.support_autoreply_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggers text[] NOT NULL,
  response text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_autoreply_rules TO authenticated;
GRANT ALL ON public.support_autoreply_rules TO service_role;

ALTER TABLE public.support_autoreply_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read rules" ON public.support_autoreply_rules
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins write rules" ON public.support_autoreply_rules
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.site_settings (key, value) VALUES ('autoreply_enabled', true)
  ON CONFLICT (key) DO NOTHING;

INSERT INTO public.support_autoreply_rules (triggers, response, sort_order) VALUES
  (ARRAY['hi','hello','hey','yo','good morning','good afternoon','good evening'],
   'Hi there 👋 Thanks for reaching out to Lumify! An inventor will follow up shortly — feel free to share more details about what you need.', 10),
  (ARRAY['price','pricing','cost','how much','fee'],
   'You can see current pricing on our site. Credits are used to unlock streams — let me know which plan you''re looking at and I can help further.', 20),
  (ARRAY['refund','money back','chargeback'],
   'Refund requests are reviewed within 24–48 hours. Please share your transaction ID or the email on your account and we''ll look into it right away.', 30),
  (ARRAY['password','forgot password','reset password','can''t sign in','cant sign in','can''t login','cant login'],
   'You can reset your password from the sign-in page — tap "Forgot password" and we''ll email you a reset link. If it doesn''t arrive, check spam or reply here with your account email.', 40),
  (ARRAY['payment failed','declined','card declined','transaction failed','payment not working'],
   'Sorry about the payment trouble! Please share the transaction ID or the email you used and we''ll look into it. You can also try a different card or the crypto option.', 50),
  (ARRAY['crypto','usdt','bitcoin','btc','eth'],
   'Yes — we accept crypto payments (USDT, BTC, ETH and more). Choose the crypto option at checkout and follow the on-screen instructions.', 60),
  (ARRAY['thank you','thanks','thx','appreciate'],
   'You''re welcome! Happy to help — reach out anytime. 🙌', 70);
