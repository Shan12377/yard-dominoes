/**
 * Profile editing — "who yuh be": name, origin, location, gender, avatar,
 * seat backdrop, and a tier-gated photo upload.
 *
 * Extracted from loungeview.ts so the live table's own account tab can reuse
 * it. loungeview.ts already imports FROM onlinetableview.ts (it hands built
 * panels down into liveTableView), so onlinetableview.ts importing anything
 * back from loungeview.ts would be a circular dependency — this module sits
 * below both instead.
 */

import { el } from './render.ts';
import { photoUrl, uploadMyPhoto, removeMyPhoto } from './photo.ts';
import {
  saveProfile, myProfile, TIER_PITCH, AVATARS, AVATAR_LABEL, avatarUrl,
  AVATAR_ACCESSORIES, AVATAR_ACCESSORY_LABEL, avatarAccessoryUrl,
  BACKGROUNDS, BACKGROUND_LABEL, backgroundUrl, myCoinBalance, buyCoins, COIN_PACK_LABEL,
  liveNowPlayers,
} from './lounges.ts';
import type { LivePlayer } from './lounges.ts';
import type { Avatar, AvatarAccessory, Background, Gender, MyProfile, Origin } from './lounges.ts';
import {
  listReports, resolveReport, dismissReport, listAdmins, grantAdmin, revokeAdmin,
} from './reports.ts';
import type { Report, Admin } from './reports.ts';
import { sendFeedback, listFeedback, markFeedbackReviewed } from './feedback.ts';
import type { FeedbackItem } from './feedback.ts';
import { listReferralStats } from './referraladmin.ts';
import type { ReferralCodeStats } from './referraladmin.ts';
import { myReferralCode, becomeReferrer } from './myreferral.ts';
import type { MyReferralCode } from './myreferral.ts';

/** Roughly how long ago, for a last-seen or filed-at line — a coarse grain
 *  is the useful one here, not a live-ticking clock. Exported: loungeview.ts
 *  needs this too (bredrin last-seen), and importing it back from there
 *  would be the same circular-dependency problem this whole module exists
 *  to avoid — see the file header. */
export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The circular portrait worn on a seat. Alt text names the character, not
 *  the filename — a screen reader should hear "gold head-wrap", not "wrap". */
export function avatarImg(
  avatar: Avatar,
  alt = '',
  accessory: AvatarAccessory | null = null,
): HTMLElement {
  const shell = document.createElement('span');
  shell.className = 'avatar-shell';
  const img = document.createElement('img');
  img.className = 'avatar';
  img.src = avatarUrl(avatar);
  img.alt = alt;
  img.width = 32;
  img.height = 32;
  shell.appendChild(img);
  if (accessory) {
    const flair = document.createElement('img');
    flair.className = `avatar-accessory avatar-accessory-${accessory}`;
    flair.src = avatarAccessoryUrl(accessory);
    flair.alt = '';
    flair.width = 22;
    flair.height = 22;
    shell.appendChild(flair);
  }
  return shell;
}

// ----------------------------------------------------------------- photo --
let photoBusy = false;
let photoError: string | null = null;
let photoVersion = 0;
/** null = not yet checked. Set by the preview <img>'s own load/error, since
 *  there is no has_photo column to ask instead — see photo.ts. */
let photoExists: boolean | null = null;

function photoSection(me: MyProfile, rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('label', 'field-label', 'Profile photo (optional)'));

  if (me.tier === 'guest') {
    section.append(el('p', 'muted small',
      `A real photo instead of a preset character — part of Yardie, ${TIER_PITCH.yardie.price}.`));
    return section;
  }

  section.append(el('p', 'muted small',
    'Shown wherever your seat card is, live the moment you upload it. The ' +
    'report button is the safety net if someone puts up something bad.'));

  if (photoError) section.append(el('div', 'banner small', photoError));

  const img = document.createElement('img');
  img.className = 'photo-preview';
  img.alt = '';
  img.width = 96;
  img.height = 96;
  img.src = `${photoUrl(me.id)}?v=${photoVersion}`;
  img.onload = () => { if (photoExists !== true) { photoExists = true; rerender(); } };
  img.onerror = () => {
    img.style.display = 'none';
    if (photoExists !== false) { photoExists = false; rerender(); }
  };
  section.appendChild(img);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.onchange = () => void (async () => {
    const file = input.files?.[0];
    if (!file) return;
    photoBusy = true;
    photoError = null;
    rerender();
    try {
      await uploadMyPhoto(file);
      photoVersion += 1;
      photoExists = true;
    } catch (err) {
      photoError = err instanceof Error ? err.message : 'could not upload';
    } finally {
      photoBusy = false;
      rerender();
    }
  })();

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'act ghost small';
  pick.textContent = photoBusy ? 'Uploading…' : 'Upload photo';
  pick.disabled = photoBusy;
  pick.onclick = () => input.click();

  const row = el('div', 'row');
  row.append(pick, input);

  if (photoExists) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'act ghost small';
    remove.textContent = 'Remove';
    remove.disabled = photoBusy;
    remove.onclick = () => void (async () => {
      photoBusy = true;
      photoError = null;
      rerender();
      try {
        await removeMyPhoto();
        photoVersion += 1;
        photoExists = false;
      } catch (err) {
        photoError = err instanceof Error ? err.message : 'could not remove';
      } finally {
        photoBusy = false;
        rerender();
      }
    })();
    row.appendChild(remove);
  }

  section.appendChild(row);
  return section;
}

// ----------------------------------------------------------------- coins --
// Balance and the only purchase path, folded into the profile rather than a
// separate toggle — coins were previously reachable from three different
// entry points (a "Coins" header button, a per-hand reveal button, a gift
// button buried in the roster line) with no single place that answered
// "where do I check my balance or buy more". This is that place now.
let coinBalance: number | null = null;
let coinBalanceLoading = false;
let coinBusy = false;
let coinError: string | null = null;

function coinSection(rerender: () => void): HTMLElement {
  if (coinBalance === null && !coinBalanceLoading) {
    coinBalanceLoading = true;
    void myCoinBalance().then((n) => { coinBalance = n; coinBalanceLoading = false; rerender(); });
  }
  const section = el('div', 'stack');
  section.append(el('label', 'field-label', 'Coins'));
  section.append(el('p', 'muted small',
    'Never cash out — money in, utility only. Buy a bredrin a drink, or reshuffle a rough French hand.'));
  section.append(el('div', 'coin-balance', coinBalance === null ? '…' : `${coinBalance} coins`));
  if (coinError) section.append(el('div', 'banner small', coinError));
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'act ghost small';
  buy.textContent = coinBusy ? 'Opening checkout…' : `Buy ${COIN_PACK_LABEL}`;
  buy.disabled = coinBusy;
  buy.onclick = () => void (async () => {
    coinBusy = true; coinError = null; rerender();
    try {
      window.location.href = await buyCoins();
    } catch (err) {
      coinError = err instanceof Error ? err.message : 'checkout unavailable';
      coinBusy = false;
      rerender();
    }
  })();
  section.appendChild(buy);
  return section;
}

// -------------------------------------------------------------- referral --
// A player's OWN code, self-serve. The admin-granted 20% founder codes never
// come from here — this path always writes the public rate server-side (see
// referrals/index.ts), so self-serve can never reach the founders' number.
let myCode: MyReferralCode | null | undefined; // undefined = not fetched yet
let myCodeLoading = false;
let myCodeBusy = false;
let myCodeError: string | null = null;
let myCodeCopied = false;
let myCodeReferralOpen = false;

function referralSection(rerender: () => void): HTMLElement {
  if (myCode === undefined && !myCodeLoading) {
    myCodeLoading = true;
    void myReferralCode()
      .then((c) => { myCode = c; })
      .catch((err) => { myCodeError = err instanceof Error ? err.message : 'could not load'; })
      .finally(() => { myCodeLoading = false; rerender(); });
  }

  const section = collapsibleSection('Referrals', myCodeReferralOpen, (v) => { myCodeReferralOpen = v; });
  section.append(el('p', 'muted small',
    'Send people your link. When someone you sent signs up and pays, you earn a cut — '
    + 'every renewal, not just the first payment — plus 100 coins the moment their first '
    + 'payment clears. They get 5% off that first payment too.'));

  if (myCodeError) section.append(el('div', 'banner small', myCodeError));

  if (myCodeLoading && myCode === undefined) {
    section.append(el('p', 'muted small', 'Loading…'));
    return section;
  }

  if (!myCode) {
    const become = document.createElement('button');
    become.type = 'button';
    become.className = 'act ghost small';
    become.textContent = myCodeBusy ? 'Setting you up…' : 'Become a referrer';
    become.disabled = myCodeBusy;
    become.onclick = () => void (async () => {
      myCodeBusy = true; myCodeError = null; rerender();
      try {
        const result = await becomeReferrer();
        myCode = { ...result, referredCount: 0, totalOwedCents: 0 };
      } catch (err) {
        myCodeError = err instanceof Error ? err.message : 'could not set that up';
      } finally {
        myCodeBusy = false;
        rerender();
      }
    })();
    section.appendChild(become);
    return section;
  }

  const link = `${window.location.origin}/?ref=${myCode.code}`;
  section.append(el('p', undefined, link));
  section.append(el('p', 'muted small',
    `${myCode.commissionPct}% commission · ${myCode.referredCount} referred · `
    + `$${(myCode.totalOwedCents / 100).toFixed(2)} earned so far`));
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'act ghost small';
  copy.textContent = myCodeCopied ? 'Copied!' : 'Copy my link';
  copy.onclick = () => void (async () => {
    try {
      await navigator.clipboard.writeText(link);
      myCodeCopied = true;
    } catch {
      myCodeError = 'could not copy — select and copy the link above';
    }
    rerender();
  })();
  section.appendChild(copy);
  return section;
}

// -------------------------------------------------------------- feedback --
// Send side, open to anyone signed in. Review side lives in adminSection
// below, gated the same way reports are.
let feedbackDraft = '';
let feedbackRating: number | null = null;
let feedbackSending = false;
let feedbackSent = false;
let feedbackError: string | null = null;

function starRow(get: () => number | null, set: (v: number | null) => void): HTMLElement {
  const row = el('div', 'choices');
  const paint = () => {
    for (const b of Array.from(row.children) as HTMLButtonElement[]) {
      const value = Number(b.dataset.value);
      const chosen = get();
      b.textContent = chosen !== null && value <= chosen ? '★' : '☆';
      b.setAttribute('aria-pressed', String(value === chosen));
    }
  };
  for (let value = 1; value <= 5; value++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice star';
    b.dataset.value = String(value);
    b.setAttribute('aria-label', `${value} star${value === 1 ? '' : 's'}`);
    b.onclick = () => { set(get() === value ? null : value); paint(); };
    row.appendChild(b);
  }
  paint();
  return row;
}

function feedbackSection(rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('label', 'field-label', 'Help mek the app better'));
  section.append(el('p', 'muted small',
    'How yuh rate it so far, and why? This goes straight to the ' +
    'people building the app, not into a queue nobody reads.'));

  if (feedbackSent) {
    section.append(el('p', 'muted small', 'Sent — thank you.'));
    return section;
  }

  section.appendChild(starRow(() => feedbackRating, (v) => { feedbackRating = v; }));

  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.placeholder = 'What happened, or what would help?';
  textarea.value = feedbackDraft;
  textarea.oninput = () => { feedbackDraft = textarea.value; };
  section.appendChild(textarea);

  if (feedbackError) section.append(el('div', 'banner small', feedbackError));

  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'act ghost small';
  send.textContent = feedbackSending ? 'Sending…' : 'Send feedback';
  send.disabled = feedbackSending;
  send.onclick = () => void (async () => {
    feedbackSending = true;
    feedbackError = null;
    rerender();
    try {
      await sendFeedback(feedbackDraft, feedbackRating);
      feedbackDraft = '';
      feedbackRating = null;
      feedbackSent = true;
    } catch (err) {
      feedbackError = err instanceof Error ? err.message : 'could not send';
    } finally {
      feedbackSending = false;
      rerender();
    }
  })();
  section.appendChild(send);
  return section;
}

// ----------------------------------------------------------------- admin --
// Reports and feedback review, plus who else can review them — all admin-
// only, folded into the profile because that's the one place reachable from
// both the lounge and a live table. The previous home (a header button)
// only existed in the lounge's top-level list and vanished the moment you
// stepped into a room or sat at a table — an admin already inside either
// had no way to find it at all.
let reportsList: Report[] | null = null;
let reportsLoading = false;
let reportsError: string | null = null;
let reportsBusy = false;

function loadReports(rerender: () => void) {
  reportsLoading = true;
  reportsError = null;
  rerender();
  void listReports()
    .then((list) => { reportsList = list; })
    .catch((err) => { reportsError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { reportsLoading = false; rerender(); });
}

let feedbackList: FeedbackItem[] | null = null;
let feedbackLoading = false;
let feedbackListError: string | null = null;
let feedbackReviewBusy = false;

function loadFeedbackList(rerender: () => void) {
  feedbackLoading = true;
  feedbackListError = null;
  rerender();
  void listFeedback()
    .then((list) => { feedbackList = list; })
    .catch((err) => { feedbackListError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { feedbackLoading = false; rerender(); });
}

let livePlayers: LivePlayer[] | null = null;
let liveCountLoading = false;
let liveCountError: string | null = null;

function loadLiveCount(rerender: () => void) {
  liveCountLoading = true;
  liveCountError = null;
  rerender();
  void liveNowPlayers()
    .then((players) => { livePlayers = players; })
    .catch((err) => { liveCountError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { liveCountLoading = false; rerender(); });
}

function liveCountSection(rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('h3', undefined, 'Live now'));
  section.append(el('p', 'muted small',
    'Players active in a lounge in the last 15 minutes. Directional, not exact.'));
  if (liveCountError) section.append(el('div', 'banner small', liveCountError));
  if (liveCountLoading && livePlayers === null) {
    section.append(el('p', 'muted small', 'Loading…'));
  } else {
    const players = livePlayers ?? [];
    section.append(el('p', undefined, String(players.length)));
    if (players.length > 0) {
      const list = el('div', 'roster');
      for (const p of players) {
        const line = el('div', 'person');
        line.append(el('span', undefined, p.username));
        line.append(el('span', 'muted small', p.lounge));
        list.appendChild(line);
      }
      section.appendChild(list);
    }
  }
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'act small ghost';
  refresh.textContent = liveCountLoading ? 'Refreshing…' : 'Refresh';
  refresh.disabled = liveCountLoading;
  refresh.onclick = () => loadLiveCount(rerender);
  section.appendChild(refresh);
  return section;
}

let referralStats: ReferralCodeStats[] | null = null;
let referralStatsLoading = false;
let referralStatsError: string | null = null;

function loadReferralStats(rerender: () => void) {
  referralStatsLoading = true;
  referralStatsError = null;
  rerender();
  void listReferralStats()
    .then((codes) => { referralStats = codes; })
    .catch((err) => { referralStatsError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { referralStatsLoading = false; rerender(); });
}

function referralStatsSection(rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('h3', undefined, 'Referrals'));
  if (referralStatsError) section.append(el('div', 'banner small', referralStatsError));
  if (referralStatsLoading && referralStats === null) {
    section.append(el('p', 'muted small', 'Loading…'));
  } else {
    const codes = referralStats ?? [];
    if (codes.length === 0) {
      section.append(el('p', 'muted small', 'No referral codes yet.'));
    } else {
      const list = el('div', 'roster');
      for (const c of codes) {
        const line = el('div', 'person');
        line.append(el('span', undefined, `${c.ownerUsername} — ${c.code}${c.active ? '' : ' (inactive)'}`));
        line.append(el('span', 'muted small', c.ownerEmail ?? 'no email on file — anonymous guest account'));
        line.append(el('span', 'muted small', `${c.commissionPct}% · ${c.referredCount} referred`));
        line.append(el('span', 'muted small', `owed $${(c.totalOwedCents / 100).toFixed(2)}`));
        list.appendChild(line);
      }
      section.appendChild(list);
    }
  }
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'act small ghost';
  refresh.textContent = referralStatsLoading ? 'Refreshing…' : 'Refresh';
  refresh.disabled = referralStatsLoading;
  refresh.onclick = () => loadReferralStats(rerender);
  section.appendChild(refresh);
  return section;
}

let adminsList: Admin[] | null = null;
let adminsLoading = false;
let adminsError: string | null = null;
let adminsBusy = false;
let grantUsername = '';

function loadAdmins(rerender: () => void) {
  adminsLoading = true;
  adminsError = null;
  rerender();
  void listAdmins()
    .then((list) => { adminsList = list; })
    .catch((err) => { adminsError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { adminsLoading = false; rerender(); });
}

function adminsManageSection(rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('h3', undefined, 'Admins'));

  if (adminsError) section.append(el('div', 'banner small', adminsError));

  if (adminsLoading && !adminsList) {
    section.append(el('p', 'muted small', 'Loading…'));
    return section;
  }

  const list = el('div', 'roster');
  for (const a of adminsList ?? []) {
    const line = el('div', 'person');
    line.append(el('span', undefined, a.username));
    const remove = document.createElement('button');
    remove.className = 'dismiss';
    remove.textContent = 'Remove';
    remove.disabled = adminsBusy;
    remove.onclick = () => void (async () => {
      adminsBusy = true;
      adminsError = null;
      rerender();
      try {
        await revokeAdmin(a.id);
        adminsList = (adminsList ?? []).filter((x) => x.id !== a.id);
      } catch (err) {
        adminsError = err instanceof Error ? err.message : 'could not remove';
      } finally {
        adminsBusy = false;
        rerender();
      }
    })();
    line.appendChild(remove);
    list.appendChild(line);
  }
  section.appendChild(list);

  const form = el('div', 'row');
  const input = document.createElement('input');
  input.placeholder = 'username';
  input.value = grantUsername;
  input.oninput = () => { grantUsername = input.value; };
  form.appendChild(input);

  const add = document.createElement('button');
  add.className = 'act small';
  add.textContent = adminsBusy ? 'Adding…' : 'Make admin';
  add.disabled = adminsBusy;
  add.onclick = () => void (async () => {
    const username = grantUsername.trim();
    if (!username) return;
    adminsBusy = true;
    adminsError = null;
    rerender();
    try {
      const result = await grantAdmin(username);
      grantUsername = '';
      if (!result.already) {
        adminsList = [...(adminsList ?? []), { id: '', username: result.username }]
          .sort((x, y) => x.username.localeCompare(y.username));
        // The temporary id is fine here — the next loadAdmins() (panel
        // reopen) replaces it with the real one; Remove just isn't wired
        // for this row until then.
      }
    } catch (err) {
      adminsError = err instanceof Error ? err.message : 'could not add';
    } finally {
      adminsBusy = false;
      rerender();
    }
  })();
  form.appendChild(add);
  section.appendChild(form);

  return section;
}

function reportsSection(rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('h3', undefined, 'Reports'));

  if (reportsError) section.append(el('div', 'banner small', reportsError));

  if (reportsLoading && !reportsList) {
    section.append(el('p', 'muted small', 'Loading…'));
    return section;
  }
  const open = (reportsList ?? []).filter((r) => r.status === 'open');
  if (open.length === 0) {
    section.append(el('p', 'muted small', 'Nothing open.'));
    return section;
  }
  const list = el('div', 'roster');
  for (const r of open) {
    const line = el('div', 'person');
    const who = `${r.reporter?.username ?? 'someone'} reported ${r.reported?.username ?? 'someone'}`;
    line.append(el('span', undefined, who));
    line.append(el('p', 'muted small', r.reason));
    line.append(el('span', 'muted small', timeAgo(r.created_at)));

    const act = (label: string, fn: (id: string) => Promise<unknown>) => {
      const b = document.createElement('button');
      b.className = 'dismiss';
      b.textContent = label;
      b.disabled = reportsBusy;
      b.onclick = () => void (async () => {
        reportsBusy = true;
        rerender();
        try {
          await fn(r.id);
          reportsList = (reportsList ?? []).map((x) => x.id === r.id
            ? { ...x, status: label === 'Resolve' ? 'resolved' as const : 'dismissed' as const }
            : x);
        } catch (err) {
          reportsError = err instanceof Error ? err.message : 'could not update';
        } finally {
          reportsBusy = false;
          rerender();
        }
      })();
      return b;
    };
    line.append(act('Resolve', resolveReport), act('Dismiss', dismissReport));
    list.appendChild(line);
  }
  section.appendChild(list);
  return section;
}

function feedbackReviewSection(rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('h3', undefined, 'Feedback'));

  if (feedbackListError) section.append(el('div', 'banner small', feedbackListError));

  if (feedbackLoading && !feedbackList) {
    section.append(el('p', 'muted small', 'Loading…'));
    return section;
  }
  const open = (feedbackList ?? []).filter((f) => f.status === 'open');
  if (open.length === 0) {
    section.append(el('p', 'muted small', 'Nothing open.'));
    return section;
  }
  const list = el('div', 'roster');
  for (const f of open) {
    const line = el('div', 'person');
    const who = f.rating ? `${f.sender?.username ?? 'someone'} — ${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}`
      : (f.sender?.username ?? 'someone');
    line.append(el('span', undefined, who));
    line.append(el('p', 'muted small', f.message));
    line.append(el('span', 'muted small', timeAgo(f.created_at)));
    const mark = document.createElement('button');
    mark.className = 'dismiss';
    mark.textContent = 'Reviewed';
    mark.disabled = feedbackReviewBusy;
    mark.onclick = () => void (async () => {
      feedbackReviewBusy = true;
      rerender();
      try {
        await markFeedbackReviewed(f.id);
        feedbackList = (feedbackList ?? []).map((x) => x.id === f.id ? { ...x, status: 'reviewed' as const } : x);
      } catch (err) {
        feedbackListError = err instanceof Error ? err.message : 'could not update';
      } finally {
        feedbackReviewBusy = false;
        rerender();
      }
    })();
    line.appendChild(mark);
    list.appendChild(line);
  }
  section.appendChild(list);
  return section;
}

let adminDataLoaded = false;

/** Rendered on its own top-level admin view now (loungeview.ts's
 *  adminDashboardView) rather than nested inside profilePanel — exported
 *  for that. */
export function adminSection(rerender: () => void): HTMLElement {
  if (!adminDataLoaded) {
    adminDataLoaded = true;
    loadLiveCount(rerender);
    loadReports(rerender);
    loadFeedbackList(rerender);
    loadAdmins(rerender);
    loadReferralStats(rerender);
  }
  const wrap = el('div', 'stack');
  wrap.append(el('h3', undefined, 'Admin'));
  wrap.appendChild(liveCountSection(rerender));
  wrap.appendChild(reportsSection(rerender));
  wrap.appendChild(feedbackReviewSection(rerender));
  wrap.appendChild(referralStatsSection(rerender));
  wrap.appendChild(adminsManageSection(rerender));
  return wrap;
}

// --------------------------------------------------------------- profile --
let profileError: string | null = null;
let profileSaving = false;
let lookSaveError: string | null = null;
let pendingLook: { userId: string; avatar: Avatar | null; accessory: AvatarAccessory | null } | null = null;

/** The caller owns whether the panel is open at all (each has its own
 *  "Edit profile" toggle); this only clears a stale error when it reopens. */
export function clearProfileError() { profileError = null; lookSaveError = null; }

/**
 * `onSaved` hands the refreshed profile back to the caller rather than this
 * module writing to either caller's own "current player" state directly —
 * loungeview.ts keeps it on `loungeState.me`, the live table's account tab
 * keeps its own local copy. Also where the caller decides to close the panel.
 */
/**
 * A `<details>` group with a clickable summary, styled to match the rest of
 * the panel. `render()` rebuilds the whole page on every call (see
 * client.md's "Rendering model") — a `<details>`'s own `open` attribute
 * does NOT survive that, it would silently re-collapse the moment anything
 * else on the page (a coin purchase finishing, a realtime tick) triggers a
 * rerender mid-browse. `open`/`onToggle` push that state out to a
 * module-scope variable the caller owns, the same pattern `accountOpen` and
 * `bredrinsOpen` already use, so a section the player opened stays open
 * across renders it didn't ask for.
 */
function collapsibleSection(label: string, open: boolean, onToggle: (open: boolean) => void): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'collapsible';
  details.open = open;
  details.addEventListener('toggle', () => onToggle(details.open));
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  return details;
}

let basicsOpen = true;
let presenceOpen = false;
let backdropOpen = false;

export function profilePanel(
  me: MyProfile,
  rerender: () => void,
  onSaved: (me: MyProfile) => void,
): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Your profile'));
  panel.append(el('h2', undefined, 'Who yuh be'));

  panel.appendChild(feedbackSection(rerender));
  panel.appendChild(coinSection(rerender));
  panel.appendChild(referralSection(rerender));

  // The two things almost everyone actually came here to check or change —
  // open by default. Everything more cosmetic (look, backdrop) collapses so
  // the panel doesn't read as one long wall of pickers on first open.
  const basics = collapsibleSection('Basics', basicsOpen, (v) => { basicsOpen = v; });
  basics.appendChild(photoSection(me, rerender));

  const name = document.createElement('input');
  name.className = 'field';
  name.value = me.username;
  name.maxLength = 24;
  name.setAttribute('aria-label', 'Your name');
  basics.append(el('label', 'field-label', 'Name'), name);

  basics.append(el('label', 'field-label', 'Where you play from'));
  basics.append(el('p', 'muted small',
    'Yard or foreign — both are Jamaican. Somebody in Brooklyn flying the '
    + 'flag is still foreign, and that is the point of asking.'));
  let origin: Origin | null = me.origin;
  const originRow = choiceRow(
    [['yardie', 'Yardie'], ['foreign', 'Foreign']],
    () => origin,
    (v) => { origin = v as Origin | null; },
  );
  basics.appendChild(originRow);

  basics.append(el('label', 'field-label', 'Location (optional)'));
  basics.append(el('p', 'muted small',
    'So a bredrin nearby can spot you and link up. Entirely your call — '
    + 'leave it blank and nobody sees a location on your card.'));
  const location = document.createElement('input');
  location.className = 'field';
  location.value = me.location ?? '';
  location.maxLength = 60;
  location.placeholder = 'e.g. Kingston, JA or Brooklyn, NY';
  location.setAttribute('aria-label', 'Location');
  basics.append(location);

  basics.append(el('label', 'field-label', 'Call me (optional)'));
  let gender: Gender | null = me.gender;
  const genderRow = choiceRow(
    [['f', 'She'], ['m', 'He']],
    () => gender,
    (v) => { gender = v as Gender | null; },
  );
  basics.appendChild(genderRow);
  panel.appendChild(basics);

  const presence = collapsibleSection('Presence & accessory (optional)', presenceOpen, (v) => { presenceOpen = v; });
  presence.append(el('p', 'muted small',
    'Pick a face, then make it yours with one accessory. Change either anytime.'));
  // Keep a freshly selected look if a phone loses connection during save.
  // The profile re-renders to show the error, but making somebody choose all
  // over again would be the opposite of a reassuring mobile flow.
  const savedLook = pendingLook?.userId === me.id ? pendingLook : null;
  let avatar: Avatar | null = savedLook ? savedLook.avatar : me.avatar;
  let avatarAccessory: AvatarAccessory | null = savedLook ? savedLook.accessory : me.avatarAccessory;
  const lookPreview = el('div', 'avatar-look-preview');
  const paintLook = () => {
    lookPreview.replaceChildren();
    if (avatar) lookPreview.appendChild(avatarImg(avatar, '', avatarAccessory));
    else lookPreview.append(el('span', 'muted small', 'Choose a face'));
  };
  paintLook();
  presence.appendChild(lookPreview);
  const avatarCaption = el('p', 'muted small', avatar ? AVATAR_LABEL[avatar] : 'None chosen');
  const avatarGrid = el('div', 'avatar-grid');
  const paintAvatars = () => {
    for (const btn of Array.from(avatarGrid.children) as HTMLButtonElement[]) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === avatar));
    }
    avatarCaption.textContent = avatar ? AVATAR_LABEL[avatar] : 'None chosen';
  };
  for (const id of AVATARS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-choice';
    btn.dataset.value = id;
    btn.setAttribute('aria-label', AVATAR_LABEL[id]);
    btn.appendChild(avatarImg(id));
    btn.onclick = () => {
      avatar = avatar === id ? null : id;
      paintAvatars();
      paintLook();
    };
    avatarGrid.appendChild(btn);
  }
  paintAvatars();
  presence.append(avatarGrid, avatarCaption);

  presence.append(el('label', 'field-label', 'Accessory (optional)'));
  const accessoryCaption = el('p', 'muted small',
    avatarAccessory ? AVATAR_ACCESSORY_LABEL[avatarAccessory] : 'No accessory');
  const accessoryGrid = el('div', 'accessory-grid');
  const paintAccessories = () => {
    for (const btn of Array.from(accessoryGrid.children) as HTMLButtonElement[]) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === avatarAccessory));
    }
    accessoryCaption.textContent = avatarAccessory
      ? AVATAR_ACCESSORY_LABEL[avatarAccessory]
      : 'No accessory';
  };
  for (const id of AVATAR_ACCESSORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'accessory-choice';
    btn.dataset.value = id;
    btn.setAttribute('aria-label', AVATAR_ACCESSORY_LABEL[id]);
    const img = document.createElement('img');
    img.src = avatarAccessoryUrl(id);
    img.alt = '';
    img.width = 34;
    img.height = 34;
    btn.appendChild(img);
    btn.onclick = () => {
      avatarAccessory = avatarAccessory === id ? null : id;
      paintAccessories();
      paintLook();
    };
    accessoryGrid.appendChild(btn);
  }
  paintAccessories();
  presence.append(accessoryGrid, accessoryCaption);

  // A phone user should not have to hunt below every remaining profile field
  // to keep the character they just made. This only saves the look; the full
  // Save button below still commits name, location and seat backdrop together.
  const saveLook = document.createElement('button');
  saveLook.type = 'button';
  saveLook.className = 'act small';
  saveLook.textContent = profileSaving ? 'Saving…' : 'Save my look';
  saveLook.disabled = profileSaving;
  saveLook.onclick = () => void (async () => {
    if (profileSaving) return;
    pendingLook = { userId: me.id, avatar, accessory: avatarAccessory };
    profileSaving = true;
    lookSaveError = null;
    saveLook.disabled = true;
    saveLook.textContent = 'Saving…';
    try {
      await saveProfile({ avatar, avatar_accessory: avatarAccessory });
      pendingLook = null;
      const fresh = await myProfile();
      if (fresh) onSaved(fresh);
      else lookSaveError = 'saved, but your session dropped — reload to see it';
    } catch (err) {
      lookSaveError = err instanceof Error ? err.message : 'could not save';
    } finally {
      profileSaving = false;
      rerender();
    }
  })();
  const lookSaveRow = el('div', 'row');
  lookSaveRow.append(el('p', 'muted small', 'Happy with your look? Save it now.'), saveLook);
  presence.appendChild(lookSaveRow);
  if (lookSaveError) presence.append(el('div', 'banner small', lookSaveError));
  panel.appendChild(presence);

  const backdrop = collapsibleSection('Seat backdrop (optional)', backdropOpen, (v) => { backdropOpen = v; });
  backdrop.append(el('p', 'muted small',
    'A cosmetic scene worn behind your seat card. Nobody else\'s tiles or '
    + 'turn get any harder to read — it just sits at the back.'));
  let background: Background | null = me.background;
  const backgroundCaption = el('p', 'muted small', background ? BACKGROUND_LABEL[background] : 'None chosen');
  const backgroundGrid = el('div', 'background-grid');
  const paintBackgrounds = () => {
    for (const btn of Array.from(backgroundGrid.children) as HTMLButtonElement[]) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === background));
    }
    backgroundCaption.textContent = background ? BACKGROUND_LABEL[background] : 'None chosen';
  };
  for (const id of BACKGROUNDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'background-choice';
    btn.dataset.value = id;
    btn.setAttribute('aria-label', BACKGROUND_LABEL[id]);
    const img = document.createElement('img');
    img.src = backgroundUrl(id);
    img.alt = '';
    img.width = 96;
    img.height = 64;
    btn.append(img, el('span', undefined, BACKGROUND_LABEL[id]));
    btn.onclick = () => { background = background === id ? null : id; paintBackgrounds(); };
    backgroundGrid.appendChild(btn);
  }
  paintBackgrounds();
  backdrop.append(backgroundGrid, backgroundCaption);
  panel.appendChild(backdrop);

  if (profileError) panel.append(el('div', 'banner', profileError));

  const save = document.createElement('button');
  save.className = 'act';
  save.textContent = profileSaving ? 'Saving…' : 'Save';
  save.disabled = profileSaving;
  save.onclick = () => void (async () => {
    if (profileSaving) return;
    profileSaving = true;
    profileError = null;
    rerender();
    try {
      await saveProfile({
        username: name.value, origin, gender, avatar,
        avatar_accessory: avatarAccessory, background, location: location.value,
      });
      // Re-read rather than patching the local copy: the server is the only
      // thing that knows whether the name was actually accepted. Null here
      // means the session died between the save and this re-read — too
      // stale to hand back as "the fresh profile".
      const fresh = await myProfile();
      if (fresh) onSaved(fresh);
      else profileError = 'saved, but your session dropped — reload to see it';
    } catch (err) {
      profileError = err instanceof Error ? err.message : 'could not save';
    } finally {
      profileSaving = false;
      rerender();
    }
  })();
  panel.appendChild(save);

  return panel;
}

/**
 * A row of choices where picking the one already chosen clears it. That is how
 * an optional question stays answerable with "actually, never mind" — without
 * it, a player who taps "She" by accident can never take it back.
 */
function choiceRow(
  options: [string, string][],
  get: () => string | null,
  set: (v: string | null) => void,
): HTMLElement {
  const row = el('div', 'choices');
  const paint = () => {
    for (const b of Array.from(row.children) as HTMLButtonElement[]) {
      b.setAttribute('aria-pressed', String(b.dataset.value === get()));
    }
  };
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.dataset.value = value;
    b.textContent = label;
    b.onclick = () => { set(get() === value ? null : value); paint(); };
    row.appendChild(b);
  }
  paint();
  return row;
}
