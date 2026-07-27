import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Loader2, Trash2, GraduationCap, Save } from "lucide-react";

export const Route = createFileRoute("/inventor/tutorials")({
  component: TutorialsAdmin,
});

type Tutorial = {
  id: string;
  title: string;
  description: string;
  video_url: string;
  storage_path: string | null;
  sort_order: number;
  created_at: string;
};

const YEAR_SECS = 60 * 60 * 24 * 365 * 5;

function TutorialsAdmin() {
  const [items, setItems] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // new-item draft
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sort, setSort] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tutorials")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setItems((data ?? []) as Tutorial[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function upload(file: File) {
    if (!title.trim()) { setErr("Add a title first."); return; }
    setErr(null); setUploading(true); setProgress("Uploading video…");
    try {
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const path = `videos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabase.storage.from("tutorial-videos").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || "video/mp4",
      });
      if (up.error) throw up.error;
      const signed = await supabase.storage.from("tutorial-videos").createSignedUrl(path, YEAR_SECS);
      if (signed.error) throw signed.error;

      setProgress("Saving…");
      const { error: insErr } = await supabase.from("tutorials").insert({
        title: title.trim(),
        description: description.trim(),
        video_url: signed.data.signedUrl,
        storage_path: path,
        sort_order: sort,
      });
      if (insErr) throw insErr;

      setTitle(""); setDescription(""); setSort(0);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      setProgress("");
    }
  }

  async function saveRow(t: Tutorial, patch: Partial<Tutorial>) {
    const next = { ...t, ...patch };
    setItems((xs) => xs.map((x) => (x.id === t.id ? next : x)));
    const { error } = await supabase
      .from("tutorials")
      .update({
        title: next.title,
        description: next.description,
        sort_order: next.sort_order,
      })
      .eq("id", t.id);
    if (error) setErr(error.message);
  }

  async function remove(t: Tutorial) {
    if (!confirm(`Delete "${t.title}"?`)) return;
    if (t.storage_path) {
      await supabase.storage.from("tutorial-videos").remove([t.storage_path]);
    }
    const { error } = await supabase.from("tutorials").delete().eq("id", t.id);
    if (error) { setErr(error.message); return; }
    setItems((xs) => xs.filter((x) => x.id !== t.id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 grid place-items-center text-primary">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Tutorial videos</h2>
          <p className="text-xs text-muted-foreground">Upload short tutorials that appear on the user Tutorial page.</p>
        </div>
      </div>

      {/* Upload card */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">Add a new tutorial</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inp} placeholder="Getting started with Lumify" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Sort order (lower shows first)</span>
            <input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} className={inp} />
          </label>
          <label className="md:col-span-2 space-y-1 text-xs text-muted-foreground">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={inp + " min-h-[70px]"} placeholder="What this tutorial covers" />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? progress || "Uploading…" : "Choose video & upload"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <span className="text-[11px] text-muted-foreground">MP4 / WebM recommended. Max ~50MB works best.</span>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>

      {/* List */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-3 border-b border-border text-sm font-medium">
          {loading ? "Loading…" : `${items.length} tutorial${items.length === 1 ? "" : "s"}`}
        </div>
        {items.length === 0 && !loading ? (
          <div className="p-6 text-sm text-muted-foreground">No tutorials yet. Upload one above.</div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((t) => (
              <li key={t.id} className="p-4 grid gap-3 md:grid-cols-[220px_1fr_auto]">
                <video src={t.video_url} controls preload="metadata" className="w-full max-w-[220px] aspect-video rounded-md bg-black" />
                <div className="space-y-2 min-w-0">
                  <input
                    defaultValue={t.title}
                    onBlur={(e) => e.target.value !== t.title && saveRow(t, { title: e.target.value })}
                    className={inp}
                  />
                  <textarea
                    defaultValue={t.description}
                    onBlur={(e) => e.target.value !== t.description && saveRow(t, { description: e.target.value })}
                    className={inp + " min-h-[60px]"}
                  />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Sort</span>
                    <input
                      type="number"
                      defaultValue={t.sort_order}
                      onBlur={(e) => {
                        const v = Number(e.target.value) || 0;
                        if (v !== t.sort_order) saveRow(t, { sort_order: v });
                      }}
                      className={inp + " w-20"}
                    />
                    <span className="ml-2">Added {new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex md:flex-col items-start gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Save className="h-3 w-3" /> autosaves on blur
                  </span>
                  <button
                    onClick={() => remove(t)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const inp = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";
