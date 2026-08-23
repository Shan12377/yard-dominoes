/**
 * Referral attribution — pure browser storage, no Supabase import.
 *
 * main.ts calls captureReferralCode() at boot; online.ts's signInAsGuest()
 * calls takeReferralCode() once, at the moment a fresh anonymous account is
 * actually created. Splitting this into its own dependency-free file is what
 * lets main.ts touch it at all without violating client.md's bundle-discipline
 * rule (no static import of online.ts/lounges.ts/loungeview.ts from main.ts).
 */

const KEY = 'yard:referralCode';

/** Stash ?ref=CODE from the URL, if present, and strip it from the address bar. */
export function captureReferralCode(): void {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (!ref) return;
  try {
    localStorage.setItem(KEY, ref);
  } catch {
    // Private browsing or storage disabled — attribution just doesn't happen.
  }
  params.delete('ref');
  const rest = params.toString();
  history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
}

/** Read back whatever was captured, if anything, and clear it — one-shot. */
export function takeReferralCode(): string | null {
  try {
    const code = localStorage.getItem(KEY);
    if (code) localStorage.removeItem(KEY);
    return code;
  } catch {
    return null;
  }
}
