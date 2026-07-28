import { createFileRoute } from "@tanstack/react-router";
import { AuthShell } from "@/components/AuthShell";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  component: () => <AuthShell mode="login" title="Welcome back" subtitle="Log in to keep streaming." />,
});
