import type { HandReview, Move, MoveReview, TileId } from '@yard/engine';
import { renderBoard, tileEl } from './render.ts';

const LABEL = {
  best: 'Best move',
  fine: 'Also works',
  loose: 'Gave up ground',
  blunder: 'Changed the hand',
} as const;

export interface CoachViewOptions {
  review: HandReview;
  score: number;
  onClose: () => void;
  onLesson?: (reference: string) => void;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const out = document.createElement(tag);
  if (className) out.className = className;
  if (text !== undefined) out.textContent = text;
  return out;
}

function moveName(move: Move): string {
  if (move.kind === 'pass') return 'Pass';
  if (move.kind === 'draw') return 'Draw';
  return move.tile;
}

function moveTile(move: Move): TileId | null {
  return move.kind === 'pass' || move.kind === 'draw' ? null : move.tile;
}

function moveDetail(move: Move): string | null {
  if (move.kind === 'play') return `Played on the ${move.end} end`;
  if (move.kind === 'playcross') return `Played on arm ${move.arm + 1}`;
  if (move.kind === 'pose') return 'Opened the hand';
  return null;
}

function sameMove(a: Move, b: Move): boolean {
  return a.kind === b.kind
    && a.seat === b.seat
    && (a as { tile?: TileId }).tile === (b as { tile?: TileId }).tile
    && (a as { end?: string }).end === (b as { end?: string }).end
    && (a as { arm?: number }).arm === (b as { arm?: number }).arm;
}

function readableEnds(ends: number[]): string | null {
  if (ends.length === 0) return null;
  const names = ['blank', 'one', 'two', 'three', 'four', 'five', 'six'];
  return ends.map((pip) => names[pip] ?? String(pip)).join(' and ');
}

function tileName(tile: TileId | null): string | null {
  return tile?.replace('-', '–') ?? null;
}

function choice(label: string, move: Move, className: string): HTMLElement {
  const card = node('div', `coach-choice ${className}`);
  card.append(node('span', 'coach-choice-label', label));
  const tile = moveTile(move);
  if (tile) card.append(tileEl(tile));
  else card.append(node('strong', 'coach-pass', moveName(move)));
  const detail = moveDetail(move);
  if (detail) card.append(node('span', 'coach-move-detail', detail));
  return card;
}

export function outcomeReason(review: MoveReview): string | null {
  if (!review.exact || review.grade === 'best') return null;
  if (review.valueActual === -1 && review.valueBest === 1) {
    return 'On this completed deal, your choice leaves a forced loss against best play. The stronger choice keeps a winning route.';
  }
  if (review.valueActual === -1 && review.valueBest === 0) {
    return 'On this completed deal, your choice leaves a forced loss. The stronger choice can still save a tied block.';
  }
  if (review.valueActual === 0 && review.valueBest === 1) {
    return 'On this completed deal, your choice settles for a tied block. The stronger choice keeps a winning route.';
  }
  return null;
}

/**
 * Turn the exact solver's verdict into a board read a person can verify.
 * It intentionally uses only this seat's before/after hand and public ends.
 */
export function practicalReason(review: MoveReview): string | null {
  const after = review.position?.after;
  const actualTile = moveTile(review.move);
  const bestTile = moveTile(review.best);
  if (!after || !actualTile || !bestTile || sameMove(review.move, review.best)) return null;

  const actualEnds = readableEnds(after.actual.ends);
  const bestEnds = readableEnds(after.best.ends);
  if (!actualEnds || !bestEnds) return null;

  const actualKeepsBest = after.actual.hand.includes(bestTile);
  const bestKeepsActual = after.best.hand.includes(actualTile);
  const retained = actualKeepsBest && bestKeepsActual
    ? ` It keeps ${tileName(bestTile)} in your hand instead of ${tileName(actualTile)}.`
    : '';

  return `${tileName(actualTile)} leaves ${actualEnds} open. ` +
    `${tileName(bestTile)} leaves ${bestEnds} open.${retained} ` +
    'The visible pip count alone does not prove the result; the completed-deal review checks the replies that follow.';
}

function decisionReason(review: MoveReview): string {
  if (review.grade !== 'best') return review.note;
  const ends = review.position?.ends ?? [];
  if (review.move.kind === 'pass') return 'Neither open end matched a tile in your hand.';
  if (ends.length === 0) return 'This was your strongest opening from the choices available.';
  return 'That was one of the strongest moves available. There is no separate “better” tile to copy here.';
}

function positionView(review: MoveReview): HTMLElement {
  const position = node('section', 'coach-position');
  position.append(node('div', 'coach-kicker', `Decision ${review.ply + 1} · before you played`));

  if (!review.position) {
    position.append(node('p', 'coach-muted',
      'This older saved review has no visual position. Review a new hand to see the table here.'));
    return position;
  }

  const felt = node('div', 'coach-felt');
  const line = node('div', 'line coach-line');
  felt.append(line);
  position.append(felt);
  requestAnimationFrame(() => {
    renderBoard(line, review.position.board, {
      box: { width: Math.max(260, felt.clientWidth - 28), height: 250 },
    });
  });

  const handBlock = node('div', 'coach-hand-block');
  handBlock.append(node('div', 'coach-choice-label', 'Your hand then'));
  const hand = node('div', 'hand coach-hand');
  for (const id of review.position.hand) {
    const tile = tileEl(id);
    if (id === moveTile(review.move)) {
      tile.classList.add(review.grade === 'best' ? 'coach-best-tile' : 'coach-played-tile');
    }
    if (id === moveTile(review.best) && id !== moveTile(review.move)) tile.classList.add('coach-best-tile');
    hand.append(tile);
  }
  handBlock.append(hand);
  position.append(handBlock);
  return position;
}

/**
 * One visual decision at a time. The sticky exit and the board/hand snapshot
 * are shared by local and online play so the Coach cannot drift into two
 * different products again.
 */
export function coachReviewView(options: CoachViewOptions): HTMLElement {
  const { review } = options;
  const root = node('section', 'coach-review-surface');
  root.tabIndex = -1;
  root.setAttribute('aria-label', 'Hand review');
  root.onkeydown = (event) => {
    if (event.key === 'Escape') options.onClose();
  };
  let index = Math.max(0, review.reviews.findIndex((move) => move.ply === review.criticalPly));

  const renderDecision = () => {
    root.replaceChildren();

    const bar = node('header', 'coach-review-bar');
    const close = node('button', 'coach-close', '← Back to result');
    close.type = 'button';
    close.onclick = options.onClose;
    bar.append(close, node('strong', undefined, 'Hand review'));
    const done = node('button', 'coach-done', 'Done');
    done.type = 'button';
    done.onclick = options.onClose;
    bar.append(done);
    root.append(bar);

    if (review.reviews.length === 0) {
      const empty = node('div', 'coach-empty');
      empty.append(node('h2', undefined, 'No decision to review'));
      empty.append(node('p', 'coach-muted', 'The hand never gave you more than one legal choice.'));
      root.append(empty);
      return;
    }

    const current = review.reviews[index];
    const heading = node('div', 'coach-decision-head');
    const title = node('div');
    title.append(node('div', 'coach-kicker', `Decision ${index + 1} of ${review.reviews.length}`));
    title.append(node('h2', undefined,
      current.grade === 'best' ? 'You read this one well.' : 'Here is what changed the position.'));
    const grade = node('span', `coach-grade ${current.grade}`, LABEL[current.grade]);
    heading.append(title, grade);
    root.append(heading, positionView(current));

    if (current.grade !== 'best') {
      const compare = node('div', 'coach-compare');
      compare.append(choice('You played', current.move, 'actual'));
      compare.append(choice('Stronger play', current.best, 'best'));
      root.append(compare);
    } else {
      root.append(node('div', 'coach-confirmed', 'One of the best moves.'));
    }

    const why = node('div', 'coach-why');
    why.append(node('div', 'coach-kicker', 'Why it matters'));
    const outcome = outcomeReason(current);
    if (outcome) why.append(node('strong', 'coach-outcome', outcome));
    why.append(node('p', undefined, decisionReason(current)));
    const practical = practicalReason(current);
    if (practical) why.append(node('p', 'coach-practical', practical));
    root.append(why);

    const actions = node('div', 'coach-actions');
    const previous = node('button', 'act ghost', 'Previous');
    previous.disabled = index === 0;
    previous.onclick = () => { index--; renderDecision(); root.scrollIntoView({ block: 'start' }); };
    const next = node('button', 'act', index === review.reviews.length - 1 ? 'Done' : 'Next decision');
    next.onclick = index === review.reviews.length - 1
      ? options.onClose
      : () => { index++; renderDecision(); root.scrollIntoView({ block: 'start' }); };
    actions.append(previous);
    if (current.lesson && options.onLesson) {
      const lesson = node('button', 'act ghost', 'Learn this');
      lesson.onclick = () => options.onLesson!(current.lesson!);
      actions.append(lesson);
    }
    actions.append(next);
    root.append(actions);
  };

  renderDecision();
  requestAnimationFrame(() => root.focus());
  return root;
}
