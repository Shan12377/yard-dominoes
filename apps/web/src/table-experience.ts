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
