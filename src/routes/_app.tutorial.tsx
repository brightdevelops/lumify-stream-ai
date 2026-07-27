import { createFileRoute } from "@tanstack/react-router";
import { GraduationCap, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_app/tutorial")({
  head: () => ({
    meta: [
      { title: "Tutorial — Lumify" },
      { name: "description", content: "Learn how to set up your camera, go live, and use Lumify with OBS." },
      { property: "og:title", content: "Tutorial — Lumify" },
      { property: "og:description", content: "Step-by-step tutorials for streaming with Lumify." },
    ],
  }),
  component: TutorialPage,
});

const videos = [
  { title: "Getting started with Lumify", desc: "Create your account, top up your wallet, and go live for the first time.", url: "" },
  { title: "Connecting Lumify to OBS", desc: "Copy your OBS browser source URL and stream your AI persona anywhere.", url: "" },
  { title: "Choosing the right mode & realism", desc: "When to use Realistic vs Stylized and how the realism slider affects your look.", url: "" },
];

function TutorialPage() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <div className="h-11 w-11 rounded-xl bg-primary/10 grid place-items-center text-primary">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-[32px] leading-tight">Tutorial</h1>
          <p className="mt-1 text-[14px] text-[color:var(--muted-foreground)]">
            Short videos to help you get the most out of Lumify.
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => (
          <div key={v.title} className="card-lift rounded-2xl border border-[color:var(--border-soft)] bg-card overflow-hidden">
            <div className="aspect-video bg-[color:var(--sidebar)] grid place-items-center text-[color:var(--faint)]">
              <PlayCircle className="h-10 w-10" />
            </div>
            <div className="p-4">
              <div className="font-semibold text-[15px]">{v.title}</div>
              <p className="mt-1 text-[13px] text-[color:var(--muted-foreground)]">{v.desc}</p>
              <div className="mt-3 eyebrow text-[10px] text-[color:var(--faint)]">Coming soon</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
