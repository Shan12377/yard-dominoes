/**
 * Real profile photos — "Rank badge and profile photo" has been sold in
 * TIER_PITCH.yardie since lounges.ts existed, with nothing to upload one.
 * design.md already drew the line this follows: "Never use a real person's
 * likeness [for the preset avatar art]. Human players upload their own
 * photo." That's this file.
 *
 * One object per user (`<user id>/photo.webp`), upsert on every re-upload —
 * no `has_photo` column anywhere. The client just asks for the deterministic
 * public URL and falls back to the preset avatar on `onerror`; a boolean
 * flag here would only ever be a cache of what the bucket already knows.
 *
 * Uploaded LIVE, with no review queue — the existing report-a-player flow
 * (reports.ts) is the moderation path for a bad photo, the same as it is for
 * any other conduct problem. The real gate is tier, enforced by
 * migration 0030's storage RLS policies, not by this file.
 */

import { supabase } from './online.ts';

function db() {
  if (!supabase) throw new Error('Photos need online mode — set VITE_SUPABASE_URL');
  return supabase;
}

const BUCKET = 'profile-photos';
const SIZE = 512; // matches the preset avatar art's own square size, design.md

function pathFor(userId: string): string {
  return `${userId}/photo.webp`;
}

export function photoUrl(userId: string): string {
  return db().storage.from(BUCKET).getPublicUrl(pathFor(userId)).data.publicUrl;
}

/** Center-cropped to a square and downscaled client-side, so a phone's
 *  multi-megabyte original never touches the network or the bucket. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not process that image');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('could not process that image'))),
      'image/webp',
      0.85,
    );
  });
}

/** Rewords the RLS rejection into the actual reason, rather than the raw
 *  "new row violates row-level security policy" postgres text. */
function friendlyError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (message.toLowerCase().includes('row-level security')) {
    return new Error('Photos are a Yardie perk — upgrade to add one');
  }
  return new Error(message);
}

export async function uploadMyPhoto(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('That is not an image file');
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in first');

  const blob = await toSquareWebp(file);
  const { error } = await db().storage.from(BUCKET).upload(pathFor(auth.user.id), blob, {
    upsert: true,
    contentType: 'image/webp',
  });
  if (error) throw friendlyError(error);
}

export async function removeMyPhoto(): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in first');
  const { error } = await db().storage.from(BUCKET).remove([pathFor(auth.user.id)]);
  if (error) throw friendlyError(error);
}
