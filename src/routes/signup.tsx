import { createFileRoute } from "@tanstack/react-router";
import { AuthShell } from "@/components/AuthShell";

export const Route = createFileRoute("/signup")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  component: () => <AuthShell mode="signup" title="Create your account" subtitle="Start streaming with intelligent light." />,
});
