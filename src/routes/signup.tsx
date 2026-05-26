import { createFileRoute } from "@tanstack/react-router";
import { AuthShell } from "@/components/AuthShell";

export const Route = createFileRoute("/signup")({
  component: () => <AuthShell mode="signup" title="Create your account" subtitle="Start streaming with intelligent light." />,
});
