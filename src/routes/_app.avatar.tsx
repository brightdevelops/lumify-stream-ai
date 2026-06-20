import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { createAvatarJob, pollAvatarJob, listAvatarJobs } from "@/lib/avatar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Upload, Sparkles, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/avatar")({
  component: AvatarPage,
});

const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George (M)" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah (F)" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam (M)" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice (F)" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian (M)" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily (F)" },
];

const LANGS = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "hi", name: "Hindi" },
  { code: "ar", name: "Arabic" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "yo", name: "Yoruba" },
  { code: "ig", name: "Igbo" },
  { code: "ha", name: "Hausa" },
];

type Job = Awaited<ReturnType<typeof listAvatarJobs>>[number];

const isNsfwError = (msg?: string | null) =>
  !!msg && (msg.includes("400168") || /nsfw|content filter|flagged/i.test(msg));

function NsfwTips({ message }: { message?: string | null }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="bg-destructive/10 border border-destructive/30 text-destructive p-3 rounded">
        <div className="font-semibold mb-1">Photo rejected by content filter</div>
        <div className="text-xs opacity-90">{message || "HeyGen flagged this image as NSFW."}</div>
      </div>
      <div className="bg-muted/40 border border-border rounded p-3 space-y-2">
        <div className="font-medium">Try a photo that follows these tips:</div>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Clear, front-facing headshot (shoulders up)</li>
          <li>Bright, even lighting — avoid heavy shadows on the face</li>
          <li>Sharp focus, no motion blur or heavy filters</li>
          <li>Plain or simple background</li>
          <li>Fully clothed (shirt visible), neutral expression</li>
          <li>No sunglasses, masks, or hands covering the face</li>
          <li>One person only, eyes open, looking at the camera</li>
          <li>Use a real photo (not AI-generated or anime)</li>
        </ul>
        <div className="text-xs text-muted-foreground pt-1">The filter can be strict — even normal selfies sometimes get flagged. A different photo usually fixes it.</div>
      </div>
    </div>
  );
}

function AvatarPage() {
  const { user } = useAuth();
  const router = useRouter();
  const createFn = useServerFn(createAvatarJob);
  const pollFn = useServerFn(pollAvatarJob);
  const listFn = useServerFn(listAvatarJobs);

  const [portrait, setPortrait] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string>("");
  const [script, setScript] = useState("");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("en");
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = async () => {
    try { setJobs(await listFn()); } catch { /* ignore */ }
  };

  useEffect(() => { void loadJobs(); }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === "done" || activeJob.status === "failed") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const updated = await pollFn({ data: { jobId: activeJob.id } });
        setActiveJob(updated as Job);
        if ((updated as Job).status === "done" || (updated as Job).status === "failed") {
          void loadJobs();
        }
      } catch (e) {
        console.error(e);
      }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeJob?.id, activeJob?.status]);

  const onFileChange = (f: File | null) => {
    setPortrait(f);
    if (portraitPreview) URL.revokeObjectURL(portraitPreview);
    setPortraitPreview(f ? URL.createObjectURL(f) : "");
  };

  const submit = async () => {
    if (!user) return;
    if (!portrait) { toast.error("Upload a portrait photo"); return; }
    if (!script.trim()) { toast.error("Enter a script"); return; }
    if (script.length > 1500) { toast.error("Script too long (max 1500 chars)"); return; }

    setSubmitting(true);
    try {
      const ext = portrait.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatar-assets").upload(path, portrait, {
        contentType: portrait.type, upsert: false,
      });
      if (upErr) throw new Error(upErr.message);

      const { jobId } = await createFn({ data: { portraitPath: path, script, sourceLang, targetLang, voiceId } });
      const fresh = (await listFn()).find((j) => j.id === jobId);
      setActiveJob(fresh ?? null);
      setJobs(await listFn());
      toast.success("Generation started — rendering takes 1–3 minutes");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start";
      if (isNsfwError(msg)) {
        toast.error("Photo rejected", { description: "HeyGen's content filter flagged this image. Try a clear, well-lit, front-facing headshot." });
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Sparkles className="h-7 w-7 text-primary" /> Talking Avatar</h1>
        <p className="text-muted-foreground mt-1">Turn a portrait into a talking video in any language. <span className="text-foreground font-medium">200 credits per video.</span></p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <div>
            <Label>Portrait photo</Label>
            <div className="mt-2 border-2 border-dashed border-border rounded-lg p-4 text-center">
              {portraitPreview ? (
                <img src={portraitPreview} alt="portrait" className="max-h-48 mx-auto rounded" />
              ) : (
                <div className="py-8 text-muted-foreground text-sm">
                  <Upload className="h-8 w-8 mx-auto mb-2" />
                  Clear front-facing photo works best
                </div>
              )}
              <Input type="file" accept="image/*" className="mt-3" onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
            </div>
          </div>

          <div>
            <Label>Script ({script.length}/1500)</Label>
            <Textarea value={script} onChange={(e) => setScript(e.target.value)} rows={5} placeholder="Type what the avatar should say..." className="mt-2" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Script language</Label>
              <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="mt-2 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Speak in</Label>
              <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="mt-2 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label>Voice</Label>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="mt-2 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              {VOICES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          <Button onClick={submit} disabled={submitting || !portrait || !script.trim()} className="w-full" size="lg">
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</> : <>Generate Video — 200 credits</>}
          </Button>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-semibold">Current job</h2>
          {!activeJob ? (
            <p className="text-sm text-muted-foreground">No active generation. Submit the form to start.</p>
          ) : activeJob.status === "done" && activeJob.video_url ? (
            <div className="space-y-3">
              <video src={activeJob.video_url} controls className="w-full rounded-lg bg-black" />
              <a href={activeJob.video_url} download className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                <Download className="h-4 w-4" /> Download MP4
              </a>
            </div>
          ) : activeJob.status === "failed" ? (
            isNsfwError(activeJob.error) ? <NsfwTips message={activeJob.error} /> : (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">{activeJob.error || "Failed"}</div>
            )
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="capitalize">{activeJob.status.replace(/_/g, " ")}…</span>
            </div>
          )}
        </Card>
      </div>

      {jobs.length > 0 && (
        <Card className="p-6">
          <h2 className="font-semibold mb-4">Recent videos</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {jobs.map((j) => (
              <div key={j.id} className="border border-border rounded-lg p-3 space-y-2">
                <div className="text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString()}</div>
                <div className="text-xs uppercase tracking-wide">{j.status}</div>
                {j.video_url && <video src={j.video_url} controls className="w-full rounded bg-black" />}
                <p className="text-sm line-clamp-2">{j.script}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
