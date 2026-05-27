-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role security-definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users view own role"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin: list all users with credits and totals
CREATE OR REPLACE FUNCTION public.admin_list_users_with_credits()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  balance integer,
  total_spent numeric,
  total_credits_used integer,
  is_admin boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.email,
    p.full_name,
    p.created_at,
    COALESCE(c.balance, 0) AS balance,
    COALESCE((SELECT SUM(amount) FROM public.transactions t WHERE t.user_id = p.id AND t.type = 'purchase'), 0) AS total_spent,
    COALESCE((SELECT SUM(credits) FROM public.transactions t WHERE t.user_id = p.id AND t.type = 'usage'), 0)::int AS total_credits_used,
    public.has_role(p.id, 'admin') AS is_admin
  FROM public.profiles p
  LEFT JOIN public.credits c ON c.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$$;

-- Grant admin to brightsolutionslab@gmail.com
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM public.profiles
WHERE email = 'brightsolutionslab@gmail.com'
ON CONFLICT DO NOTHING;