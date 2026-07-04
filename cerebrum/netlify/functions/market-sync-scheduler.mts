// Cerebrum — market-sync trigger. A Scheduled Function has a 30-second
// execution limit, far too short for the real sync work (NSE cookie
// handshake + indianapi.in calls + per-stock NVIDIA sentiment on Mondays).
// So this function does almost nothing: it fires the market-sync-background
// function (15-minute limit) and returns immediately. Background functions
// respond 202 instantly regardless of how long the real work takes, so this
// call resolves in well under a second.
//
// Runs daily at 10:30 UTC = 4:00 PM IST, matching the old pg_cron schedule.

import type { Config } from "@netlify/functions";

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_URL || "";
  const secret = process.env.SYNC_TRIGGER_SECRET || "";
  if (!base) {
    console.error("[market-sync-scheduler] no site URL available (process.env.URL unset)");
    return;
  }
  try {
    await fetch(`${base}/.netlify/functions/market-sync-background`, {
      method: "POST",
      headers: secret ? { "X-Sync-Secret": secret } : {},
    });
    console.log("[market-sync-scheduler] triggered market-sync-background");
  } catch (e) {
    console.error("[market-sync-scheduler] failed to trigger background sync:", e);
  }
};

export const config: Config = {
  schedule: "30 10 * * *",
};
