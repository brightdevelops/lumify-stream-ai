import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center ${className}`}>
      <span className="font-display text-2xl tracking-tight text-primary">Lumify</span>
    </Link>
  );
}
