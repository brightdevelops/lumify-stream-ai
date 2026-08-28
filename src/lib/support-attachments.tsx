import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const SUPPORT_BUCKET = "support-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function uploadSupportImage(file: File, ownerId: string, conversationId: string) {
  if (!file.type.startsWith("image/")) throw new Error("Only image files are allowed.");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("Image must be smaller than 10MB.");
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${ownerId}/${conversationId}/${crypto.randomUUID()}.${ext || "png"}`;
  const { error } = await supabase.storage
    .from(SUPPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function getSupportAttachmentUrl(path: string) {
  const { data, error } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

/** Renders a signed image for a support message attachment. */
export function SupportAttachment({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSupportAttachmentUrl(path)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setErr(true));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (err) return <span className="text-[11px] opacity-70">Image unavailable</span>;
  if (!url) return <div className="h-24 w-32 rounded-md bg-black/20 animate-pulse" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Support attachment" className="max-h-56 rounded-md border border-border object-contain" />
    </a>
  );
}
