import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GraduationCap, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

type Tutorial = {
  id: string;
  title: string;
  description: string;
  video_url: string;
};

function TutorialPage() {
  const [items, setItems] = useState<Tutorial[] | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("tutorials")
        .select("id, title, description, video_url")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      setItems((data ?? []) as Tutorial[]);
    })();
  }, []);

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

      {items === null ? (
        <p className="text-sm text-[color:var(--muted-foreground)]">Loading tutorials…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--border-soft)] bg-card p-10 text-center">
          <PlayCircle className="h-10 w-10 mx-auto text-[color:var(--faint)] mb-3" />
          <p className="text-sm text-[color:var(--muted-foreground)]">No tutorials yet. Check back soon.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((v) => (
            <div key={v.id} className="card-lift rounded-2xl border border-[color:var(--border-soft)] bg-card overflow-hidden">
              <video src={v.video_url} controls preload="metadata" className="w-full aspect-video bg-[color:var(--sidebar)]" />
              <div className="p-4">
                <div className="font-semibold text-[15px]">{v.title}</div>
                {v.description && (
                  <p className="mt-1 text-[13px] text-[color:var(--muted-foreground)]">{v.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
