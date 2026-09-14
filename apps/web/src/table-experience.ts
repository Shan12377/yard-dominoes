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
  station.appendChild(details);

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
