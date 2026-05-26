import { createFileRoute } from "@tanstack/react-router";
import { AuthShell } from "@/components/AuthShell";

export const Route = createFileRoute("/login")({
  component: () => <AuthShell mode="login" title="Welcome back" subtitle="Log in to keep streaming." />,
});
