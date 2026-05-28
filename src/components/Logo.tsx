import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

export function Logo({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const to = user ? "/dashboard" : "/";
  return (
    <Link to={to} className={`inline-flex items-center ${className}`}>
      <span className="font-display text-2xl tracking-tight text-primary">Lumify</span>
    </Link>
  );
}
