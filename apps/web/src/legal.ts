/**
 * Terms, privacy, and the age screen.
 *
 * These are the three things Stripe requires before it will let a real card
 * through, and the three things a game with voice chat between strangers
 * needs whether or not anyone asks for them.
 *
 * The text is deliberately written the way the rest of the app speaks. Plain
 * words are not weaker than legalese — an unreadable policy is worse evidence
 * of consent than a readable one, and every regulator that has looked at the
 * question has said so.
 *
 * IMPORTANT — this is a well-informed draft, not legal advice. The blanks in
 * ENTITY have to be filled in once the LLC exists, and a lawyer should read
 * both documents before real money moves.
 */

import { el } from './render.ts';

/**
 * Fill these in once the LLC is formed and the Stripe account is opened.
 * Everything user-facing reads from here, so there is exactly one place to
 * change and no stale company name hiding in a paragraph somewhere.
 */
export const ENTITY = {
  /** Registered company name, e.g. 'Beat Di Table LLC'. */
  legalName: 'Beat Di Table LLC (pending formation)',
  /** Registered agent's address — NOT a home address. See docs. */
  address: '[registered agent address — to be added]',
  /** A monitored inbox. Required: this is where privacy requests land. */
  email: '[support@ — to be added]',
  /** Where the company is formed. Drives which law governs. */
  jurisdiction: 'the State of Florida, United States',
} as const;

export const PRODUCT = 'Beat Di Table';
export const LAST_UPDATED = '1 August 2026';

/** COPPA's line. Below this, no chat, no voice, no tables with strangers. */
export const AGE_FLOOR = 13;

const BIRTH_YEAR_KEY = 'bdt:birth-year';

// ------------------------------------------------------------- age screen --

/**
 * A neutral age screen: it asks what year you were born, rather than asking
 * whether you are old enough. Asking "are you 13?" tells a child exactly
 * which answer opens the door, which is the one thing the FTC has said an
 * age screen must not do.
 *
 * This is an honest gate, not a security control — anyone can type a
 * different year. That is true of every age screen on the web. Its job is to
 * avoid knowingly collecting a young child's chat and voice, not to be
 * unbeatable.
 */
export function birthYear(): number | null {
  const raw = localStorage.getItem(BIRTH_YEAR_KEY);
  const year = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(year) ? year : null;
}

export function setBirthYear(year: number): void {
  localStorage.setItem(BIRTH_YEAR_KEY, String(year));
}

/** Age in whole years, taking the birth year at its most generous. */
export function ageFrom(year: number, now = new Date()): number {
  return now.getFullYear() - year;
}

/**
 * Whether the social layer may open. `null` means we have not asked yet —
 * which is different from "no", and the caller has to show the screen.
 */
export function socialAllowed(): boolean | null {
  const year = birthYear();
  if (year === null) return null;
  return ageFrom(year) >= AGE_FLOOR;
}

/**
 * The screen itself. `onAnswer` fires once a plausible year is given, with
 * whether the social layer may open — the caller decides what to do next.
 */
export function ageGate(onAnswer: (allowed: boolean) => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'One question first'));
  panel.append(el('h2', undefined, 'What year were you born?'));
  panel.append(el('p', undefined,
    'The lounges have chat and live voice with people you have not met. We ask '
    + 'once, we keep only the year, and it never leaves your device.'));

  const form = el('form', 'age-gate') as HTMLFormElement;
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.placeholder = 'YYYY';
  input.required = true;
  // Nobody playing dominoes online was born in 1890, and a four-digit box
  // stops a stray keypress being read as a birth year.
  input.min = String(new Date().getFullYear() - 120);
  input.max = String(new Date().getFullYear());
  input.setAttribute('aria-label', 'Year of birth');

  const go = document.createElement('button');
  go.type = 'submit';
  go.className = 'act';
  go.textContent = 'Continue';

  const error = el('p', 'age-error');
  error.hidden = true;

  form.append(input, go);
  panel.append(form, error);

  form.onsubmit = (event) => {
    event.preventDefault();
    const year = Number(input.value);
    const age = Number.isInteger(year) ? ageFrom(year) : Number.NaN;
    if (!Number.isFinite(age) || age < 0 || age > 120) {
      error.hidden = false;
      error.textContent = 'That does not look like a year of birth.';
      return;
    }
    setBirthYear(year);
    onAnswer(age >= AGE_FLOOR);
  };

  return panel;
}

/** Shown when the answer was below the floor. Never a dead end — solo play stays. */
export function tooYoungView(onPlay: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Lounges'));
  panel.append(el('h2', undefined, 'The lounges are 13 and over'));
  panel.append(el('p', undefined,
    'That is where the chat and the live voice are, and the rules about talking '
    + 'to strangers online are strict for a reason. The game itself is not going '
    + 'anywhere — every mode, every duppy, the coach and the Academy all still '
    + 'work, and none of them need anybody else at the table.'));
  const play = document.createElement('button');
  play.className = 'act';
  play.textContent = 'Play against the duppies';
  play.onclick = onPlay;
  panel.appendChild(play);
  return panel;
}

// -------------------------------------------------------------- documents --

type Section = [heading: string, ...paragraphs: string[]];

function document_(eyebrow: string, title: string, intro: string, sections: Section[]): HTMLElement {
  const panel = el('div', 'panel legal');
  panel.append(el('div', 'eyebrow', eyebrow));
  panel.append(el('h2', undefined, title));
  panel.append(el('p', 'legal-updated', `Last updated ${LAST_UPDATED}`));
  panel.append(el('p', undefined, intro));
  for (const [heading, ...paragraphs] of sections) {
    const block = el('div', 'lesson');
    block.appendChild(el('h3', undefined, heading));
    for (const text of paragraphs) block.appendChild(el('p', undefined, text));
    panel.appendChild(block);
  }
  const foot = el('p', 'legal-updated',
    `${ENTITY.legalName} · ${ENTITY.address} · ${ENTITY.email}`);
  panel.appendChild(foot);
  return panel;
}

export function termsView(): HTMLElement {
  return document_('Legal', 'Terms of service',
    `These are the rules for using ${PRODUCT}. Using it means you accept them. `
    + 'They are short because the service is simple: it is a dominoes game.',
    [
      ['Who runs this',
        `${PRODUCT} is operated by ${ENTITY.legalName}, ${ENTITY.address}. `
        + `These terms are governed by the laws of ${ENTITY.jurisdiction}.`],

      ['How old you have to be',
        `You must be at least ${AGE_FLOOR} to use the lounges, chat or voice. `
        + 'Playing on your own against the computer has no age limit, because it '
        + 'involves nobody else.',
        'If you are under 18, you need a parent or guardian to agree to these '
        + 'terms for you. If we learn that someone under 13 has been using the '
        + 'social features, we delete the account and anything attached to it.'],

      ['This is a game, not gambling',
        'There is no wagering, no cash prizes, and no stakes on any hand. A '
        + 'membership buys features. It does not buy an advantage in a hand, and '
        + 'it never will — the tiles do not know who paid.',
        'Coins are a virtual currency you can buy and gift to other players. They '
        + 'never affect the deal, the rules, or the tiles you are given, and they '
        + 'cannot be cashed out, sold, or converted back into money by you or by '
        + `us — they only ever move from a purchase, or from one player's balance `
        + 'to another\'s.'],

      ['Fair dealing',
        'Every deal is provably fair: we commit to a shuffle before it happens '
        + 'and reveal the seed afterwards so your own device can check it. Tap '
        + '"Verify this deal" any time. We do not stack tiles, and the Fair Deal '
        + 'page explains exactly how you can hold us to that.',
        'The computer opponents are given the board, the tile counts and the '
        + 'record of who passed. They are never given your tiles.'],

      ['Behaving at the table',
        'Do not harass, threaten or abuse other players. Do not use voice or '
        + 'chat for anything you would not say at somebody\'s yard. Do not '
        + 'cheat, automate play, or try to break the service for other people.',
        'We can suspend or remove an account that does these things. There is a '
        + 'report button — use it, and we will look.'],

      ['Membership, billing and refunds',
        'Memberships are subscriptions. They renew automatically at the price '
        + 'and interval shown at checkout until you cancel, and you can cancel '
        + 'any time.',
        'Cancelling stops the next renewal. It does not end the period you have '
        + 'already paid for — you keep what you bought until it runs out.',
        'Coins are a one-time purchase, not a subscription. Once spent or gifted '
        + 'they cannot be reversed, but an unused balance from a payment made in '
        + 'error is refundable the same way a membership charge is.',
        'If something is broken, or you were charged in error, or you changed '
        + `your mind within 14 days and have barely used it, write to ${ENTITY.email} `
        + 'and we will refund you. We would rather refund a person than argue '
        + 'with them.'],

      ['If we change these terms',
        'We will say so in the app before a change that actually affects you '
        + 'takes effect. Carrying on using the service after that means you '
        + 'accept the new version.'],

      ['The usual disclaimers',
        'The service is provided as it is. We work hard to keep it running, but '
        + 'we do not promise it will never go down, and we are not liable for '
        + 'indirect or consequential losses. Nothing here limits any right you '
        + 'have that cannot legally be limited — and in some countries that '
        + 'includes a good deal.'],

      ['Getting in touch',
        `Questions, complaints, or anything at all: ${ENTITY.email}.`],
    ]);
}

export function privacyView(): HTMLElement {
  return document_('Legal', 'Privacy policy',
    'The short version: we collect very little, we never record your voice, and '
    + 'we do not sell anything about you to anybody. The long version follows, '
    + 'and it says the same thing.',
    [
      ['What we actually collect',
        'If you play on your own, we hold nothing about you on our servers. Your '
        + 'game, your coach history and the habits it spots stay in your own '
        + 'browser and are never uploaded.',
        'If you go online, you get an anonymous account automatically — no email, '
        + 'no password, no name. Attached to it are a username if you choose one, '
        + 'your game results and ratings, chat you send in a lounge, which lounge '
        + 'you last visited, and a coin balance if you have ever bought or been '
        + 'given coins.',
        'If you buy a membership, our payment processor holds your card details. '
        + 'We never see or store a card number. We keep a record that a payment '
        + 'happened, for what, and when — that is a financial record we are '
        + 'required to keep.'],

      ['Voice is never recorded',
        'Live voice goes directly between the players at the table, device to '
        + 'device. It does not pass through our servers, it is not recorded, and '
        + 'there is nothing for us to hand over or lose, because no copy is ever '
        + 'made. When you leave a table, the microphone is released.',
        'One exception worth naming honestly: if a player is behind a restrictive '
        + 'network, audio may need to be passed through a relay to reach them. A '
        + 'relay forwards encrypted audio and cannot listen to it, and still '
        + 'nothing is recorded.'],

      ['The pre-recorded voices',
        'The computer opponents speak with recordings made by a person who agreed '
        + 'to it. Those are files shipped with the app. Your microphone is never '
        + 'used for them, and is never switched on unless you join voice and '
        + 'grant permission — guests can hear a room without ever being asked '
        + 'for a microphone at all.'],

      ['Video is different from voice, honestly stated',
        'Video is a members-only feature, off by default, that shows the table '
        + 'who you are while you play. Your camera is never switched on unless '
        + 'you turn video on yourself and grant permission — nobody is ever shown '
        + 'without asking first.',
        'Unlike voice, video is NOT sent directly between players. It is relayed '
        + 'through a video infrastructure provider so it stays smooth on a phone '
        + 'connection, the same way a video call through any modern app works. '
        + 'That provider carries the encrypted video to reach the other seats and '
        + 'does not store or record it — we do not record it either, and nothing '
        + 'about a video call is kept once the hand or your camera ends.',
        'Turning your camera off, or leaving the table, stops your video '
        + 'immediately for everyone else.'],

      ['Who else touches the data',
        'We use a small number of companies to run the service, and only for '
        + 'that: a database and authentication provider, a payment processor, a '
        + 'web host, a connection-relay service for voice, and a video '
        + 'infrastructure provider for members who turn video on. Each of them '
        + 'may process what is strictly needed to do their part. None of them '
        + 'are allowed to use it for their own purposes.',
        'Some of these companies are in the United States. If you are in the UK '
        + 'or the EU, your information may therefore be handled outside your '
        + 'country under the standard safeguards those countries require.'],

      ['We do not track you around the web',
        'No advertising networks, no third-party analytics pixels, no selling or '
        + 'sharing of personal information for advertising. There is nothing to '
        + 'opt out of, because we never started.'],

      ['Children',
        `The lounges, chat and voice are for people aged ${AGE_FLOOR} and over. `
        + 'We ask for a year of birth before opening them, and keep only that '
        + 'year, on your own device. We do not knowingly collect anything from a '
        + 'child under 13. If you believe we have, write to us and we will delete '
        + 'it.'],

      ['How long we keep it',
        'Game and account data stays while the account exists. Chat messages are '
        + 'kept so a room still reads sensibly when you return, and are removed '
        + 'with the account. The coin ledger — purchases and gifts — is kept the '
        + 'same way a bank statement is, so a balance can always be reconstructed '
        + 'and disputed if something looks wrong. Payment records are kept for as '
        + 'long as tax and accounting rules require, which is longer than '
        + 'everything else.'],

      ['Your rights over it',
        'You can ask for a copy of what we hold, ask us to correct it, or ask us '
        + 'to delete it and close the account. If you are in the UK or the EU, '
        + 'you additionally have the right to object to processing, to ask us to '
        + 'restrict it, and to complain to your national data protection '
        + 'authority. If you are in California, you have the right to know, to '
        + 'delete, and to not be discriminated against for asking.',
        `Write to ${ENTITY.email} and we will action it. We will not charge you `
        + 'for asking, and we will not make you explain yourself.'],

      ['Security, honestly stated',
        'Connections are encrypted. What the server will let a player read is '
        + 'enforced by the database itself rather than by the app, which is the '
        + 'stronger place to enforce it. No service can promise it will never be '
        + 'breached, and we are not going to be the first to claim otherwise.'],

      ['Contact',
        `${ENTITY.legalName}, ${ENTITY.address}. Email ${ENTITY.email}.`],
    ]);
}
