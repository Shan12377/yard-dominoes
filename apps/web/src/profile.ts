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
  BACKGROUNDS, BACKGROUND_LABEL, backgroundUrl,
} from './lounges.ts';
import type { Avatar, Background, Gender, MyProfile, Origin } from './lounges.ts';

/** The circular portrait worn on a seat. Alt text names the character, not
 *  the filename — a screen reader should hear "gold head-wrap", not "wrap". */
export function avatarImg(avatar: Avatar, alt = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'avatar';
  img.src = avatarUrl(avatar);
  img.alt = alt;
  img.width = 32;
  img.height = 32;
  return img;
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

// --------------------------------------------------------------- profile --
let profileError: string | null = null;
let profileSaving = false;

/** The caller owns whether the panel is open at all (each has its own
 *  "Edit profile" toggle); this only clears a stale error when it reopens. */
export function clearProfileError() { profileError = null; }

/**
 * `onSaved` hands the refreshed profile back to the caller rather than this
 * module writing to either caller's own "current player" state directly —
 * loungeview.ts keeps it on `loungeState.me`, the live table's account tab
 * keeps its own local copy. Also where the caller decides to close the panel.
 */
export function profilePanel(
  me: MyProfile,
  rerender: () => void,
  onSaved: (me: MyProfile) => void,
): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Your profile'));
  panel.append(el('h2', undefined, 'Who yuh be'));

  panel.appendChild(photoSection(me, rerender));

  const name = document.createElement('input');
  name.className = 'field';
  name.value = me.username;
  name.maxLength = 24;
  name.setAttribute('aria-label', 'Your name');
  panel.append(el('label', 'field-label', 'Name'), name);

  panel.append(el('label', 'field-label', 'Where you play from'));
  panel.append(el('p', 'muted small',
    'Yard or foreign — both are Jamaican. Somebody in Brooklyn flying the '
    + 'flag is still foreign, and that is the point of asking.'));
  let origin: Origin | null = me.origin;
  const originRow = choiceRow(
    [['yardie', 'Yardie'], ['foreign', 'Foreign']],
    () => origin,
    (v) => { origin = v as Origin | null; },
  );
  panel.appendChild(originRow);

  panel.append(el('label', 'field-label', 'Location (optional)'));
  panel.append(el('p', 'muted small',
    'So a bredrin nearby can spot you and link up. Entirely your call — '
    + 'leave it blank and nobody sees a location on your card.'));
  const location = document.createElement('input');
  location.className = 'field';
  location.value = me.location ?? '';
  location.maxLength = 60;
  location.placeholder = 'e.g. Kingston, JA or Brooklyn, NY';
  location.setAttribute('aria-label', 'Location');
  panel.append(location);

  panel.append(el('label', 'field-label', 'Call me (optional)'));
  let gender: Gender | null = me.gender;
  const genderRow = choiceRow(
    [['f', 'She'], ['m', 'He']],
    () => gender,
    (v) => { gender = v as Gender | null; },
  );
  panel.appendChild(genderRow);

  panel.append(el('label', 'field-label', 'Presence (optional)'));
  panel.append(el('p', 'muted small',
    'A character for the seat, if you would rather not show your face. '
    + '"Plain" is presence without one either.'));
  let avatar: Avatar | null = me.avatar;
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
    btn.onclick = () => { avatar = avatar === id ? null : id; paintAvatars(); };
    avatarGrid.appendChild(btn);
  }
  paintAvatars();
  panel.append(avatarGrid, avatarCaption);

  panel.append(el('label', 'field-label', 'Seat backdrop (optional)'));
  panel.append(el('p', 'muted small',
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
    btn.appendChild(img);
    btn.onclick = () => { background = background === id ? null : id; paintBackgrounds(); };
    backgroundGrid.appendChild(btn);
  }
  paintBackgrounds();
  panel.append(backgroundGrid, backgroundCaption);

  if (profileError) panel.append(el('div', 'banner', profileError));

  const save = document.createElement('button');
  save.className = 'act';
  save.textContent = profileSaving ? 'Saving…' : 'Save';
  save.disabled = profileSaving;
  save.onclick = () => void (async () => {
    profileSaving = true;
    profileError = null;
    rerender();
    try {
      await saveProfile({ username: name.value, origin, gender, avatar, background, location: location.value });
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
