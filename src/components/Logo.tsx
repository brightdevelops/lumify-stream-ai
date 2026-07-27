import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

export function Logo({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const to = user ? "/dashboard" : "/";
  return (
    <Link to={to} className={`inline-flex items-center logo-serif ${className}`}>
      Lum<em>ify</em>
    </Link>
  );
}
