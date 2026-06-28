// Browser-side helpers that call the /api/auth route. The server holds
// MASTER_PASSWORD and the stored notebook password; the client only ever
// learns ok: true/false.

async function postAuth(payload: any): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export function loginWithPassword(password: string) {
  return postAuth({ action: "login", password });
}

export function verifyMasterPassword(master: string) {
  return postAuth({ action: "verify-master", master });
}

export function changeNotebookPassword(master: string, newPassword: string) {
  return postAuth({ action: "change-password", master, newPassword });
}
