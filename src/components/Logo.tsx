import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 ${className}`}>
      <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M12 2l2.6 6.4L21 10l-5 4.3L17.6 21 12 17.6 6.4 21 8 14.3 3 10l6.4-1.6L12 2z" />
        </svg>
      </span>
      <span className="font-display text-xl tracking-tight">Lumify</span>
    </Link>
  );
}
