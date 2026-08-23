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

function choice(label: string, move: Move, className: string): HTMLElement {
  const card = node('div', `coach-choice ${className}`);
  card.append(node('span', 'coach-choice-label', label));
  const tile = moveTile(move);
  if (tile) card.append(tileEl(tile));
  else card.append(node('strong', 'coach-pass', moveName(move)));
  return card;
}

function decisionReason(review: MoveReview): string {
  if (review.grade !== 'best') return review.note;
  const ends = review.position?.ends ?? [];
  if (review.move.kind === 'pass') return 'Neither open end matched a tile in your hand.';
  if (ends.length === 0) return 'This was your strongest opening from the choices available.';
  return 'This was the strongest way to handle this position. Compare the open ends and the tiles you kept.';
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
    if (id === moveTile(review.move)) tile.classList.add('coach-played-tile');
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

    const compare = node('div', 'coach-compare');
    compare.append(choice('You played', current.move, 'actual'));
    compare.append(choice(
      current.grade === 'best' ? 'Best move' : 'Stronger play', current.best, 'best'));
    root.append(compare);

    const why = node('div', 'coach-why');
    why.append(node('div', 'coach-kicker', 'Why it matters'));
    why.append(node('p', undefined, decisionReason(current)));
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
