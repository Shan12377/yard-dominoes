/** Shared live-table feedback. Dialog lives outside the rerendered app. */
export function confirmTableExit(message: string, leave: () => void | Promise<void>): void {
  if (document.querySelector('.table-exit-dialog')) return;
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'table-exit-dialog';
  dialog.setAttribute('aria-labelledby', 'table-exit-title');
  dialog.setAttribute('aria-describedby', 'table-exit-description');
  const title = document.createElement('h2');
  title.id = 'table-exit-title'; title.textContent = 'Leave table?';
  const description = document.createElement('p');
  description.id = 'table-exit-description'; description.textContent = message;
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'row';
  const stay = document.createElement('button'); stay.className = 'act ghost';
  stay.textContent = 'Stay at table'; stay.autofocus = true;
  stay.onclick = () => dialog.close();
  const go = document.createElement('button'); go.className = 'act'; go.textContent = 'Leave table';
  let pending = false;
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  go.onclick = async () => {
    if (pending) return;
    pending = true; go.disabled = true; stay.disabled = true; go.textContent = 'Leaving…';
    try { await leave(); dialog.close(); }
    catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Could not leave. Please try again.';
      pending = false; go.disabled = false; stay.disabled = false; go.textContent = 'Leave table';
    }
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  });
  actions.append(stay, go); dialog.append(title, description, error, actions);
  document.body.append(dialog); dialog.showModal();
}

export function handTurnCue(panel: HTMLElement, active: boolean, pending = false): void {
  panel.classList.toggle('hand-turn-active', active && !pending);
  panel.classList.toggle('hand-move-pending', pending);
  panel.setAttribute('aria-label', pending ? 'Your hand, sending move' : active ? 'Your hand, your turn' : 'Your hand, waiting');
}

/** Keep the rack and its corner identity on the same authoritative turn cue. */
export function stationTurnCue(station: HTMLElement, active: boolean): void {
  station.classList.toggle('turn', active);
  const copy = station.querySelector('.table-seat-copy');
  if (!copy) return;
  const cue = document.createElement('span');
  cue.className = 'table-seat-turn';
  cue.textContent = 'Playing';
  // Keep its line reserved when inactive; changing turns must not move the board.
  cue.style.visibility = active ? 'visible' : 'hidden';
  copy.appendChild(cue);
}

/**
 * Which collapsed French player tabs are open, by table slot. Module scope on
 * purpose: render() rebuilds every station on each Duppy turn, and a tab the
 * player opened must not snap shut underneath them.
 */
const openFrenchTabs = new Set<string>();

/**
 * Mobile French (owner, 2026-09-14): a player's photo, name and rack collapse
 * to a small tab at the rim, so the clockwise pinwheel has the felt; tapping
 * the tab opens a small panel beside it and tapping again closes it. It is a
 * disclosure beside the table, never a modal over a live hand.
 *
 * The panel is built here rather than restyling the station's own name and
 * rack, which Practice and the Lounge each lay out differently.
 */
export function frenchPhoneTab(station: HTMLElement, slot: string, bones: number): void {
  station.classList.add('station-tab');
  station.dataset.bones = String(bones);
  station.setAttribute('role', 'button');
  station.tabIndex = 0;
  const name = station.querySelector('.table-seat-copy strong')?.textContent?.trim() || 'Player';
  const info = station.querySelector('.table-seat-copy small')?.textContent?.trim()
    || `${bones} bone${bones === 1 ? '' : 's'}`;
  station.setAttribute('aria-label', `${name}, ${bones} bone${bones === 1 ? '' : 's'} left. Tap for details`);

  const details = document.createElement('div');
  details.className = 'station-tab-details';
  const title = document.createElement('strong');
  title.textContent = name;
  const line = document.createElement('small');
  line.textContent = info;
  const backs = document.createElement('span');
  backs.className = 'station-tab-backs';
  backs.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < bones; i += 1) backs.appendChild(document.createElement('i'));
  details.append(title, line, backs);
  // A plain word says the tab opens; a bare photo did not (owner, 2026-09-14).
  const cue = document.createElement('span');
  cue.className = 'station-tab-cue';
  cue.setAttribute('aria-hidden', 'true');
  cue.textContent = 'View';
  // Face-down bones hanging half off the table edge, like a real player's
  // hand at the rim (owner, 2026-09-15). Only their inner half is on the felt.
  const rack = document.createElement('span');
  rack.className = 'station-tab-rack';
  rack.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < bones; i += 1) rack.appendChild(document.createElement('i'));
  station.append(cue, rack, details);

  const sync = () => {
    const open = openFrenchTabs.has(slot);
    station.classList.toggle('station-tab-open', open);
    station.setAttribute('aria-expanded', String(open));
  };
  const toggle = () => {
    if (openFrenchTabs.has(slot)) openFrenchTabs.delete(slot);
    else openFrenchTabs.add(slot);
    sync();
  };
  station.addEventListener('click', toggle);
  station.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  });
  sync();
}

/**
 * The shuffle-and-deal that opens a hand: the YaadDominoes mark, a shuffling
 * pile, then one concealed bone flying to each seat in turn. Transform-only,
 * so it adds no layout work on slower phones. Practice plays the full
 * version; a Lounge table cannot pause the server clock or the duppies, so it
 * plays the `quick` one and is cleared the moment the first bone is laid
 * (owner, 2026-09-16: the shuffle in the Lounge too, desktop and phone).
 */
export function dealOverlay(onSkip: () => void, quick = false): HTMLElement {
  const make = (tag: string, cls: string, text?: string) => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const overlay = make('div', quick ? 'practice-deal-overlay quick-deal' : 'practice-deal-overlay');
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-label', 'Shuffling, then dealing one domino to each player in turn');
  const mark = make('div', 'practice-deal-mark');
  mark.append(make('strong', '', 'YAAD'), make('span', '', 'DOMINOES'));
  const shuffle = make('div', 'practice-shuffle-pile');
  for (let i = 0; i < 14; i += 1) {
    const bone = make('i', 'practice-shuffle-bone');
    bone.style.setProperty('--shuffle-index', String(i));
    shuffle.appendChild(bone);
  }
  const flights = make('div', 'practice-deal-flights');
  const seats = ['bottom', 'right', 'top', 'left'] as const;
  for (let i = 0; i < 28; i += 1) {
    const bone = make('i', `practice-deal-bone deal-to-${seats[i % seats.length]}`);
    bone.style.setProperty('--deal-index', String(i));
    bone.style.setProperty('--deal-slot', String(Math.floor(i / seats.length) - 3));
    flights.appendChild(bone);
  }
  const skip = make('button', 'practice-deal-skip', 'Skip') as HTMLButtonElement;
  skip.type = 'button';
  skip.onclick = onSkip;
  overlay.append(mark, shuffle, flights, skip);
  return overlay;
}
