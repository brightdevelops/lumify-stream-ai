import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const MAINTENANCE_STREAMING_MESSAGE =
  "Streaming is temporarily disabled for scheduled maintenance. We'll be back Monday at 9:00 AM WAT.";
export const MAINTENANCE_PURCHASE_MESSAGE =
  "Credit purchases are temporarily disabled for scheduled maintenance. We'll be back Monday at 9:00 AM WAT.";

/**
 * Reads the maintenance_mode flag from public.site_settings via the
 * publishable-key client (anon SELECT policy makes this safe).
 * Polls every 60s so a flip from the admin dashboard takes effect quickly
 * without a page reload.
 */
export function useMaintenanceMode(): { enabled: boolean; loaded: boolean } {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchFlag = async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "maintenance_mode")
        .maybeSingle();
      if (cancelled) return;
      setEnabled(Boolean(data?.value));
      setLoaded(true);
    };
    fetchFlag();
    const id = window.setInterval(fetchFlag, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return { enabled, loaded };
}
