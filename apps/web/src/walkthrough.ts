export type WalkthroughView =
  | 'play'
  | 'lounges'
  | 'rankings'
  | 'academy'
  | 'membership'
  | 'profile'
  | 'fair';

export interface WalkthroughStep {
  view: WalkthroughView;
  target: string;
  label: string;
  title: string;
  caption: string;
}

/**
 * The tour follows the decision a new player actually makes: set up a
 * practice hand first, then learn where the rest of the app lives. Keeping
 * the copy here makes it testable and keeps the DOM code in main.ts small.
 */
export const WALKTHROUGH_STEPS: readonly WalkthroughStep[] = [
  {
    view: 'play',
    target: '[data-tour="game"]',
    label: 'Practice setup',
    title: 'Choose the kind of table',
    caption: 'Partner is two against two. Open Hand lets partners see each other’s tiles. Cut Throat is everyone for themselves. French uses a four-arm board and the lowest score wins.',
  },
  {
    view: 'play',
    target: '[data-tour="set"]',
    label: 'Practice setup',
    title: 'Choose how the set ends',
    caption: 'Six love needs six straight wins while the other side stays at zero. First to six is a simple race. The line under this menu changes to explain your choice.',
  },
  {
    view: 'play',
    target: '[data-tour="duppy"]',
    label: 'Practice setup',
    title: 'Set the duppy strength',
    caption: 'Duppies are computer players. Pickney plays anything legal; stronger levels remember passes and read the board. The pace menu controls how long they pause between moves.',
  },
  {
    view: 'play',
    target: '[data-tour="deal"]',
    label: 'Practice setup',
    title: 'Deal when you are ready',
    caption: 'This starts a private practice set against duppies. It works offline, does not affect rankings, and your playable tiles are shown in your rack.',
  },
  {
    view: 'lounges',
    target: '[data-tour="nav-lounges"]',
    label: 'Around the yard',
    title: 'Lounges are social rooms',
    caption: 'Enter a lounge to chat, watch tables, or take an open seat. A quick age check appears before social features; guests can play and listen without buying membership.',
  },
  {
    view: 'rankings',
    target: '[data-tour="nav-rankings"]',
    label: 'Around the yard',
    title: 'Rankings count real tables',
    caption: 'Switch between Partner and Cut Throat standings. Only completed rated sets against people move the board—practice games with duppies never count.',
  },
  {
    view: 'academy',
    target: '[data-tour="nav-academy"]',
    label: 'Around the yard',
    title: 'Academy teaches from the pips up',
    caption: 'Open a belt for short lessons and drills. Game guides explain special formats, while later belts teach counting suits, reading passes, partnership, and tournament decisions.',
  },
  {
    view: 'membership',
    target: '[data-tour="nav-membership"]',
    label: 'Around the yard',
    title: 'Membership buys the social layer',
    caption: 'Every game mode, ranked play, and deal verification stay free. Yardie and VIP add profile and lounge extras; this screen shows exactly what each tier includes.',
  },
  {
    view: 'profile',
    target: '[data-tour="nav-profile"]',
    label: 'Around the yard',
    title: 'Profile keeps your place in the yard',
    caption: 'Choose your name and optional details here. Secure the guest session before changing phones or clearing the browser, or sign in to an account you already secured.',
  },
  {
    view: 'fair',
    target: '[data-tour="nav-fair"]',
    label: 'Last stop',
    title: 'Every completed deal can be checked',
    caption: 'After a hand ends, “Verify this deal” rebuilds the shuffle on your device, shows every original starting hand, and confirms they match the lock published before play. No trust or technical knowledge required.',
  },
] as const;
