// apps/web/src/onlinetableview.ts
//
// Rendering only — same DOM-building style as loungeview.ts and main.ts.
// No state lives here; OnlineGame (onlinetable.ts) owns it, this module only
// reads it and calls back into it.

import { OnlineGame } from './onlinetable.ts';
import { listLoungeTables, type OpenTable } from './lounges.ts';
import { createTable, joinTable } from './online.ts';
import { tileEl, renderBoard, scoreTrack, backsEl, el } from './render.ts';
import { DUPPY_LABELS, DUPPY_LEVELS } from '@yard/engine';
import type { GameMode } from '@yard/engine';

export async function openTablesPanel(
  loungeId: string,
  onJoin: (tableId: string) => void,
  rerender: () => void,
): Promise<HTMLElement> {
  const wrap = el('div', 'panel');
  wrap.append(el('div', 'eyebrow', 'Open tables'), el('h2', undefined, 'Sit down'));

  let tables: OpenTable[] = [];
  try { tables = await listLoungeTables(loungeId); } catch { /* shown as empty below */ }

  if (tables.length === 0) {
    wrap.append(el('p', 'muted', 'No tables running here yet. Start one.'));
  } else {
    const list = el('div', 'stack');
    for (const t of tables) {
      const row = el('div', 'row');
      row.append(el('span', undefined, `${t.mode === 'partner' ? 'Partner' : 'Cut throat'} · ${t.format === 'sixlove' ? 'Six love' : 'First to six'}`));
      row.append(el('span', 'muted', `${t.occupiedSeats}/${t.seatCount}`));
      const join = document.createElement('button');
      join.className = 'act ghost';
      join.textContent = t.status === 'waiting' ? 'Sit down' : 'Watch';
      join.onclick = () => void (async () => {
        if (t.status === 'waiting') await joinTable(t.joinCode);
        onJoin(t.id);
      })();
      row.appendChild(join);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  wrap.appendChild(startTableForm(loungeId, onJoin));
  return wrap;
}

function startTableForm(loungeId: string, onJoin: (tableId: string) => void): HTMLElement {
  const form = el('div', 'row');
  const mode = document.createElement('select');
  mode.innerHTML = `<option value="partner">Partner — 2 v 2</option><option value="cutthroat">Cut throat</option>`;
  const seatCount = document.createElement('select');
  seatCount.innerHTML = `<option value="4">4 players</option><option value="3">3 players</option><option value="2">2 players</option>`;
  const duppy = document.createElement('select');
  duppy.innerHTML = DUPPY_LEVELS.map((d) => `<option value="${d}">${DUPPY_LABELS[d]}</option>`).join('');

  for (const [label, control] of [['Game', mode], ['Seats', seatCount], ['Fill empty seats with', duppy]] as const) {
    const field = el('label', 'field');
    field.append(el('span', undefined, label), control);
    form.appendChild(field);
  }

  const go = document.createElement('button');
  go.className = 'act';
  go.textContent = 'Start table';
  go.onclick = () => void (async () => {
    go.disabled = true;
    try {
      const seats = Number(seatCount.value);
      const fill = new Array(Math.max(0, seats - 1)).fill(duppy.value);
      const { tableId } = await createTable({
        mode: mode.value as GameMode,
        format: mode.value === 'cutthroat' ? 'firstToSix' : 'sixlove',
        seatCount: seats as 2 | 3 | 4,
        duppies: fill,
        loungeId,
      });
      onJoin(tableId);
    } finally {
      go.disabled = false;
    }
  })();
  form.appendChild(go);
  return form;
}

export function joinByCodeField(onJoin: (tableId: string) => void): HTMLElement {
  const row = el('div', 'row');
  const input = document.createElement('input');
  input.placeholder = 'Join code';
  input.maxLength = 6;
  const go = document.createElement('button');
  go.className = 'act ghost';
  go.textContent = 'Join';
  go.onclick = () => void (async () => {
    const code = input.value.trim();
    if (!code) return;
    const { tableId } = await joinTable(code);
    onJoin(tableId);
  })();
  row.append(input, go);
  return row;
}

let pendingTile: string | null = null;

export function liveTableView(game: OnlineGame, rerender: () => void, onLeave: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();

  const head = el('div', 'panel');
  const top = el('div', 'spread');
  top.append(el('h2', undefined, `Table ${game.table.joinCode}`));
  const leave = document.createElement('button');
  leave.className = 'act ghost';
  leave.textContent = 'Leave';
  leave.onclick = () => { game.leave(); onLeave(); };
  top.appendChild(leave);
  head.appendChild(top);
  if (game.isSpectator) head.append(el('div', 'muted', 'Watching — spectators never see anyone\'s tiles'));
  frag.appendChild(head);

  const board = el('div', 'scoreboard');
  if (game.table.mode === 'partner') {
    board.append(
      scoreTrack('You & partner', game.scores[(game.mySide ?? 0)] ?? 0, { us: true }),
      scoreTrack('Them', game.scores[1 - (game.mySide ?? 0)] ?? 0),
    );
  } else {
    game.scores.forEach((s, i) => board.append(scoreTrack(`Seat ${i}`, s, { us: i === game.mySeat })));
  }
  frag.appendChild(board);

  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, game.hand?.board ?? null);
  felt.appendChild(line);
  frag.appendChild(felt);

  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    frag.appendChild(countdown(game.hand.turn_expires_at, rerender));
  }

  const seatsRow = el('div', 'seats');
  game.seats.forEach((s) => {
    const card = el('div', 'seat');
    if (game.hand?.turn === s.seatIndex && game.hand.status === 'active') card.classList.add('turn');
    card.append(el('h3', undefined, s.userId ? (s.username ?? `Seat ${s.seatIndex}`) : `Duppy · ${s.duppyLevel}`));
    const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
    card.append(el('div', 'meta', `${count} tile${count === 1 ? '' : 's'}`));
    if (s.seatIndex !== game.mySeat) card.append(backsEl(count));
    seatsRow.appendChild(card);
  });
  frag.appendChild(seatsRow);

  if (!game.isSpectator) frag.appendChild(myHandPanel(game, rerender));

  if (game.hand?.status !== 'active' && game.hand?.result) {
    frag.appendChild(handResultPanel(game, rerender));
  }

  return frag;
}

function countdown(expiresAt: string, rerender: () => void): HTMLElement {
  const remaining = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const bar = el('div', 'panel');
  bar.append(el('div', 'muted', remaining > 0 ? `${remaining}s to play` : 'time\'s up — a duppy will play for this seat'));
  if (remaining > 0) setTimeout(rerender, 1000);
  return bar;
}

function myHandPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', game.isMyTurn() ? 'Your play' : 'Your hand'));
  const legal = game.legalMovesForMe();
  const playable = new Set(legal.flatMap((m) => ('tile' in m ? [m.tile] : [])));
  const hand = el('div', 'hand');

  for (const tile of game.myTiles) {
    const node = tileEl(tile);
    const can = playable.has(tile);
    node.classList.add(can ? 'playable' : 'dead');
    if (pendingTile === tile) node.classList.add('chosen');
    if (can) {
      node.tabIndex = 0;
      const choose = () => {
        const options = legal.filter((m) => 'tile' in m && m.tile === tile);
        if (options.length === 1) { pendingTile = null; void game.play(options[0]); }
        else { pendingTile = pendingTile === tile ? null : tile; rerender(); }
      };
      node.onclick = choose;
      node.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } };
    }
    hand.appendChild(node);
  }
  panel.appendChild(hand);

  if (pendingTile) {
    const choice = el('div', 'row');
    choice.append(el('span', 'muted', 'Which end?'));
    for (const move of legal.filter((m) => 'tile' in m && m.tile === pendingTile)) {
      const b = document.createElement('button');
      b.className = 'act ghost';
      b.textContent = (move as any).end === 'left' ? 'Left end' : 'Right end';
      b.onclick = () => { pendingTile = null; void game.play(move); };
      choice.appendChild(b);
    }
    panel.appendChild(choice);
  }

  const onlyPass = legal.length === 1 && legal[0].kind === 'pass';
  if (game.isMyTurn() && onlyPass) {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = 'Pass';
    b.onclick = () => void game.play(legal[0]);
    panel.appendChild(b);
  }
  return panel;
}

function handResultPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  const r = game.hand!.result as any;
  panel.append(el('h2', undefined, r.tie ? 'Tied on count — replay' : 'Hand over'));

  if (game.canChoosePose()) {
    const row = el('div', 'row');
    row.append(el('span', 'muted', 'Who should pose?'));
    const pass = document.createElement('button');
    pass.className = 'act ghost';
    pass.textContent = 'Pass pose';
    pass.onclick = () => void game.dealNext(true);
    const keep = document.createElement('button');
    keep.className = 'act';
    keep.textContent = 'Keep pose';
    keep.onclick = () => void game.dealNext(false);
    row.append(pass, keep);
    panel.appendChild(row);
    return panel;
  }

  if (game.winnerSide === null && !game.isSpectator) {
    const next = document.createElement('button');
    next.className = 'act';
    next.textContent = 'Deal next hand';
    next.onclick = () => void game.dealNext(false);
    panel.appendChild(next);
  } else if (game.winnerSide !== null) {
    panel.append(el('p', 'muted', 'Set over.'));
  }
  return panel;
}
