import type { Drill, TileId } from '@yard/engine';

export interface AcademyVisual {
  alt: string;
  notice: string;
  takeaway: string;
  tryIt: string;
  answer: string;
}

/**
 * One teaching contract for every lesson: see the position, name the read,
 * carry one rule to the table, then make a decision. The matching SVGs are
 * generated deterministically by scripts/gen-diagrams.ts.
 */
export const ACADEMY_VISUALS: Record<string, AcademyVisual> = {
  B1L1: { alt: 'A large five-three tile separates five pips from three pips.', notice: 'The bar splits one tile into two counted halves.', takeaway: 'Read both halves before you play a tile.', tryIt: 'How many pips are on the smaller half?', answer: 'Three.' },
  B1L2: { alt: 'A three-one tile joins an open three while a four-two is rejected.', notice: 'The touching halves carry the same number.', takeaway: 'Match either open end. Nothing goes into the middle.', tryIt: 'With ends 3 and 5, can 2-5 play?', answer: 'Yes. Put 5 against 5; 2 becomes the new end.' },
  B1L3: { alt: 'Five connected tiles form one line with arrows at its two open ends.', notice: 'Only the two outside ends are open for the next tile.', takeaway: 'Follow the line and play at an end.', tryIt: 'Can a tile be added beside the middle double?', answer: 'No. Only an open end accepts the next tile.' },
  B1L4: { alt: 'Your seven tiles are face up while all three opponents show blue tile backs.', notice: 'You see your own faces; everybody else sees only your tile count.', takeaway: 'Protect your hand. Read opponents from plays and passes.', tryIt: 'Can the duppy see the pips in your hand?', answer: 'No. It receives the public board and hand sizes, never your tiles.' },
  B1L5: { alt: 'A hand shrinks from three tiles to two, one and finally empty.', notice: 'The last tile leaves the hand and ends the hand immediately.', takeaway: 'First player with no tiles wins the hand.', tryIt: 'You hold one legal tile. What happens when you play it?', answer: 'You domino. The hand is over.' },

  B2L1: { alt: 'The complete double-six set is arranged in seven rows, with all seven tiles carrying a three highlighted.', notice: 'Every suit appears on exactly seven tiles in the full set.', takeaway: 'Seven is the number behind counting suits out.', tryIt: 'Six tiles carrying a five are visible and you hold the seventh. Who controls fives?', answer: 'You do. No unseen player can hold another five.' },
  B2L2: { alt: 'Tournament play forces the double-six while casual sporting allows another opening tile.', notice: 'The same hand has different legal openings under different table rules.', takeaway: 'Tournament: lead 6-6. Casual: sporting must be declared.', tryIt: 'Can tournament play open 2-5 while holding 6-6?', answer: 'No. The double-six must be led.' },
  B2L3: { alt: 'Four seats surround a table with an anticlockwise arrow and partners joined across.', notice: 'The player on your right goes next; your partner sits opposite.', takeaway: 'Jamaican play moves anticlockwise.', tryIt: 'After the bottom seat plays, which side goes next?', answer: 'The seat on the bottom player’s right.' },
  B2L4: { alt: 'The board ends are two and five while every tile in your hand lacks both suits.', notice: 'No tile matches either open end.', takeaway: 'If neither end matches, pass. You are still in the hand.', tryIt: 'Ends are 2 and 5; you hold 1-4 and 3-6. What do you do?', answer: 'Pass.' },
  B2L5: { alt: 'A jammed board is surrounded by four revealed hands with individual pip totals.', notice: 'A full round of passes blocks the board and starts the count.', takeaway: 'Count the pips left in each hand separately.', tryIt: 'Four players pass in a row. What decides the winner?', answer: 'The lowest individual pip count.' },
  B2L6: { alt: 'Four blocked hands show 10, 4, 2 and 6 pips; the player with 2 wins for the north-south side.', notice: 'North and South hold more together, but South alone has the lowest hand.', takeaway: 'Lowest individual wins the block for their side.', tryIt: 'Partner has 11, you have 3, opponents have 4 each. Who wins?', answer: 'Your side. Your individual 3 is lowest.' },
  B2L7: { alt: 'A six-pip score track fills to six-love, while a second track at five-nil is cleared by one opposing win.', notice: 'One win by the side under love bruks the run back to zero-zero.', takeaway: 'Six-love needs an unbroken run while they stay on zero.', tryIt: 'You lead 5-0 and they win the next hand. New score?', answer: '0-0. Your five is bruk.' },
  B2L8: { alt: 'A one-all score moves through a highlighted playoff and finishes two-zero.', notice: 'At one-all, the playoff winner goes straight to two-zero.', takeaway: 'One all play two makes the next hand worth the set swing.', tryIt: 'At 1-1 you win the playoff. What is the score?', answer: '2-0.' },
  B2L9: { alt: 'Partner seating joins opposite seats into two sides while cut throat shows four separate sides.', notice: 'Same table, different meaning for who wins with whom.', takeaway: 'Partner: opposite seats share a side. Cut throat: every player is alone.', tryIt: 'In partner play, where does your partner sit?', answer: 'Directly opposite you.' },

  B3L1: { alt: 'Seven tiles sit beside a suit tally that marks a long five suit and a blank void.', notice: 'The tally shows where the hand is long, short and empty before play begins.', takeaway: 'Read your own suit shape before choosing a plan.', tryIt: 'You hold four tiles carrying five. What is your long suit?', answer: 'Fives.' },
  B3L2: { alt: 'A hand long in fives poses double-five with three callouts around the tile.', notice: 'The pose keeps a route home, denies fives and signals the partner.', takeaway: 'Pose the double of your strongest suit when the rules allow it.', tryIt: 'You are long in fives and hold 5-5. Strong casual pose?', answer: '5-5.' },
  B3L3: { alt: 'Two boards compare ends your hand can answer with ends that shut your hand out.', notice: 'Control means the open ends keep returning to suits you hold.', takeaway: 'Shape the ends toward your long suits.', tryIt: 'Both ends match tiles in your hand. Who has control?', answer: 'You have ways back into the board.' },
  B3L4: { alt: 'Two legal plays branch to show what each opens for the player on your right.', notice: 'A legal tile can still feed the next player exactly what they want.', takeaway: 'Judge the new end, not only the tile leaving your hand.', tryIt: 'Your right-hand opponent has shown fives. Should you open a five without a reason?', answer: 'Usually no. You may be feeding them.' },
  B3L5: { alt: 'Heavy six-six and six-five tiles are flagged beside a blocked-board count.', notice: 'Heavy tiles become expensive when the hand blocks.', takeaway: 'Shed weight early unless the tile is controlling the board.', tryIt: 'Which costs more in a block: 6-5 or 2-1?', answer: '6-5: eleven pips instead of three.' },
  B3L6: { alt: 'Playing four-four leaves four open while playing four-one changes the end to one.', notice: 'A double repeats its suit; a mixed tile moves the board on.', takeaway: 'Play a double when keeping that suit open helps you.', tryIt: 'What end remains after 4-4 is played on a four?', answer: 'Four.' },

  B4L1: { alt: 'East passes on open four and one; permanent no-four and no-one badges remain as the board changes.', notice: 'The pass proves two voids, and tiles never return to that hand.', takeaway: 'Record both open suits mentally and never erase them.', tryIt: 'A player passes on 4 and 1; later ends are 6 and 1. Which end stops them?', answer: 'The 1.' },
  B4L2: { alt: 'Six tiles carrying five are crossed off and the seventh five glows in your hand.', notice: 'All seven fives are accounted for.', takeaway: 'When you hold the seventh, that suit belongs to you.', tryIt: 'Six fours are visible and you hold the only remaining four. Is four safe to leave open?', answer: 'Yes. Only you can answer it.' },
  B4L3: { alt: 'Three opponent seats each carry a short permanent list of suits they passed on.', notice: 'The void map grows with every pass and never shrinks.', takeaway: 'Track three small lists, not twenty-eight hidden tiles.', tryIt: 'West passed on 2 and 6, then later on 3 and 6. What is West void in?', answer: '2, 3 and 6.' },
  B4L4: { alt: 'Four frames show a partner signal, a pass, stopping a feed and opening the partner’s repeated suit.', notice: 'Legal plays and passes form a conversation across the table.', takeaway: 'Support the partner’s long suit; stop feeding a suit they passed on.', tryIt: 'Partner passes on fives. Should you keep opening five?', answer: 'No. The pass proved they cannot answer it.' },
  B4L5: { alt: 'A sequence plays into known voids until passes stack and the board jams.', notice: 'The plan changes from racing out to closing the board on purpose.', takeaway: 'Use known voids to force the passes that create a winning block.', tryIt: 'You are light on count and both opponents are void in six. Useful end?', answer: 'Six. It can force their passes and help jam the board.' },
  B4L6: { alt: 'With three tiles left, one branch races out and loses the block while the other protects count and wins.', notice: 'Late in the hand, the lowest count can matter more than the fastest exit.', takeaway: 'At three tiles, compare your go-out plan with your block count.', tryIt: 'You cannot force domino and one play sheds eleven pips. What should matter?', answer: 'Protecting your individual count.' },
  B4L7: { alt: 'A board marks a hard six, a stranded dead double and two last-suit tiles forming a key.', notice: 'All three reads come from accounting for seven tiles in a suit.', takeaway: 'Count first; then name the hard end, dead double or key.', tryIt: 'You hold the last answering tile in two open suits. What do you have?', answer: 'The key.' },

  B5L1: { alt: 'Your hand, public board and void badges progressively cross impossible tiles from an unseen-tile list.', notice: 'Each public fact narrows the possible hands without guessing.', takeaway: 'Eliminate what cannot be held before predicting what can.', tryIt: 'A player passed on six. Can any tile in their hand contain six?', answer: 'No.' },
  B5L2: { alt: 'The same position branches under scores five-zero, zero-five and one-all.', notice: 'The scoreline changes whether safety, a jam or the playoff is worth most.', takeaway: 'Choose for the set score, not only the current hand.', tryIt: 'You trail 0-5 in six-love. Why can a risky jam be right?', answer: 'Any hand you win bruks their five back to zero.' },
  B5L3: { alt: 'A deliberate false suit signal sends an opponent toward the wrong read.', notice: 'A false signal only works after normal signalling is believable.', takeaway: 'Do not lie in a language you cannot already speak.', tryIt: 'Should a learner fake a signal before reading real ones reliably?', answer: 'No.' },
  B5L4: { alt: 'The same hand is played as aggressive heavy-tile shedding and as careful control.', notice: 'Repeated choices reveal how a player values weight and control.', takeaway: 'Build a read over hands; do not stereotype from one move.', tryIt: 'A player repeatedly dumps heavy tiles immediately. What tendency is visible?', answer: 'Aggressive shedding.' },
  B5L5: { alt: 'Even timing bars hide hand strength while one long hesitation exposes a difficult choice.', notice: 'Changing speed gives opponents information for free.', takeaway: 'Use the same deliberate rhythm with strong and weak hands.', tryIt: 'What can a sudden long pause reveal?', answer: 'That the decision or hand is difficult.' },
  B5L6: { alt: 'Tournament rules highlight a forced double-six and reject the sporting alternative.', notice: 'The opening rule removes casual choice at a tournament table.', takeaway: 'Know the format before sitting: tournament forces 6-6.', tryIt: 'You hold 6-6 in the opening tournament hand. What must you lead?', answer: '6-6.' },
};

export interface DrillChoice {
  label: string;
  correct?: boolean;
  explanation: string;
}

export interface DrillScenario {
  setup: string;
  choices: DrillChoice[];
  /** Every drill opens on a visible situation, never a text-only riddle. */
  visual: {
    label: string;
    line?: TileId[];
    hand?: TileId[];
    facts: readonly string[];
  };
}

export const GAME_GUIDES = [
  {
    id: 'french',
    title: 'French',
    eyebrow: 'Four-way cross',
    body: 'The opening double sits in the middle and the board grows along four arms. After round one, the winner must pose a double. Scores are the pips left in each hand, with French penalties added. The set stops when any score reaches 100, and the lowest score wins.',
    takeaway: 'Low score wins. Watch all four arms and avoid the ten-point penalties.',
  },
  {
    id: 'across',
    title: 'Across',
    eyebrow: 'Two people, four seats',
    body: 'Across uses partner rules, but two people control the four seats. You play Player 1 and Player 3, which sit opposite. Your opponent plays Player 2 and Player 4. Each seat keeps its own hidden hand and acts only on its proper turn.',
    takeaway: 'Follow the player number. One person controls the two opposite seats on each side.',
  },
] as const;

/**
 * One small, legal French opening used by the Academy guide. Keep the data
 * here, beside the teaching copy, rather than arranging arbitrary bones in
 * CSS: every arm must touch the centre double with the matching half.
 */
export const FRENCH_GUIDE_CROSS = {
  center: '0-0',
  arms: [
    { place: 'north', tile: '2-0', horizontal: false },
    { place: 'east', tile: '0-3', horizontal: true },
    { place: 'south', tile: '0-4', horizontal: false },
    { place: 'west', tile: '5-0', horizontal: true },
  ],
} as const;

const SCENARIOS: Record<string, DrillScenario> = {
  B1D1: { setup: 'The open ends are 3 and 5.', visual: {
    label: 'Open ends', line: ['3-3', '3-5'], facts: ['3 is open', '5 is open'],
  }, choices: [
    { label: '2-5', correct: true, explanation: 'The five matches the open five.' },
    { label: '1-4', explanation: 'Neither half matches 3 or 5.' },
    { label: '2-6', explanation: 'Neither half matches 3 or 5.' },
  ] },
  B1D2: { setup: 'The open ends are 2 and 6. Pick a legal tile.', visual: {
    label: 'Open ends', line: ['2-2', '2-6'], facts: ['2 is open', '6 is open'],
  }, choices: [
    { label: '1-4', explanation: 'It matches neither end.' },
    { label: '2-3', correct: true, explanation: 'The two matches the open two.' },
    { label: '4-5', explanation: 'It matches neither end.' },
  ] },
  B2D1: { setup: 'The board is blocked. Counts are You 3, Partner 11, East 4, West 4.', visual: {
    label: 'Blocked hand', line: ['4-4', '1-4', '1-1'], facts: ['Four passes · board blocked', 'You · 3 pips', 'Partner · 11 pips', 'East · 4 pips', 'West · 4 pips'],
  }, choices: [
    { label: 'Your side wins', correct: true, explanation: 'Your individual 3 is the lowest count.' },
    { label: 'Their side wins', explanation: 'Team totals do not decide a Jamaican blocked hand.' },
    { label: 'It is tied', explanation: 'Only the lowest individual count matters first.' },
  ] },
  B2D2: { setup: 'You lead 5-0 in six-love. The other side wins one hand.', visual: {
    label: 'Six-love score', line: ['5-5', '0-5'], facts: ['Before · you lead 5–0', 'Next hand · they win'],
  }, choices: [
    { label: '5-1', explanation: 'Six-love does not keep two live scores.' },
    { label: '0-0', correct: true, explanation: 'Their win bruks your run back to nothing.' },
    { label: '5-0', explanation: 'The losing side’s win must change the score.' },
  ] },
  B3D1: { setup: 'Casual pose. Your hand includes 5-5, 4-5, 2-5, 1-5, 3-6, 2-4, 0-1.', visual: {
    label: 'Your hand', hand: ['5-5', '4-5', '2-5', '1-5', '3-6', '2-4', '0-1'], facts: ['Four fives · your long suit'],
  }, choices: [
    { label: '5-5', correct: true, explanation: 'Pose the double of the suit where you are longest.' },
    { label: '3-6', explanation: 'Six is not your strongest suit here.' },
    { label: '0-1', explanation: 'Blank and one give you little control.' },
  ] },
  B3D2: { setup: 'The player on your right has played fives twice. You can leave five or two open.', visual: {
    label: 'Read the next seat', line: ['5-5', '2-5'], facts: ['Player on your right · showed five twice', 'Choose the new open end'],
  }, choices: [
    { label: 'Leave five open', explanation: 'That feeds the next player’s shown suit.' },
    { label: 'Leave two open', correct: true, explanation: 'It avoids feeding the player on your right.' },
  ] },
  B4D1: { setup: 'East passes while the ends are 4 and 1.', visual: {
    label: 'Pass read', line: ['4-4', '1-4'], facts: ['East passed', 'No 4', 'No 1'],
  }, choices: [
    { label: 'East has no 4 and no 1', correct: true, explanation: 'A pass proves the player cannot match either open suit.' },
    { label: 'East has no doubles', explanation: 'The pass says nothing about unrelated doubles.' },
    { label: 'East has only 4s', explanation: 'A four would have been a legal play.' },
  ] },
  B4D2: { setup: 'Partner passes on five, then later plays six twice.', visual: {
    label: 'Partner’s public story', line: ['5-5', '2-5', '2-6', '6-6'], facts: ['Partner passed on 5', 'Partner played 6 twice'],
  }, choices: [
    { label: 'Open five for partner', explanation: 'Partner already proved they are void in five.' },
    { label: 'Open six for partner', correct: true, explanation: 'Repeated sixes suggest partner is long there.' },
    { label: 'Ignore both reads', explanation: 'Partner play is public information you should use.' },
  ] },
  B4D3: { setup: 'A jam is likely. An open two lets you play 1-2, leaving 1-1 in your hand. Your opponent’s lightest possible hand is 4 pips.', visual: {
    label: 'Protect the count', line: ['2-2', '1-2'], hand: ['1-1'], facts: ['Play 1-2 on the open 2', 'Then you hold 1-1 · 2 pips', 'Opponent’s lightest possible hand · 4 pips'],
  }, choices: [
    { label: 'Yes. Protect the 1-1 count', correct: true, explanation: 'Two pips can win the block if it remains your lowest hand.' },
    { label: 'No. Partner’s total decides', explanation: 'The partner’s pips do not decide the lowest individual.' },
  ] },
  B5D1: { setup: 'You lead 5-0. One play keeps control; another chases a flashy domino but opens their long suit.', visual: {
    label: 'Set score changes the plan', line: ['5-5', '0-5'], facts: ['Score · 5–0', 'Keep control to close six-love'],
  }, choices: [
    { label: 'Keep control', correct: true, explanation: 'At 5-0, the safe hand closes six-love.' },
    { label: 'Chase the flashy line', explanation: 'Style is not worth giving away the set-closing hand.' },
  ] },
  B5D2: { setup: 'West passed on 2 and 6. Unseen candidates are 2-5, 3-5 and 4-6.', visual: {
    label: 'Eliminate the impossible', line: ['2-2', '2-6'], facts: ['West passed', 'No 2', 'No 6', 'Candidates · 2-5, 3-5, 4-6'],
  }, choices: [
    { label: 'Only 3-5 remains possible', correct: true, explanation: 'The pass eliminates every tile carrying 2 or 6.' },
    { label: '2-5 and 3-5', explanation: 'West cannot hold a two after that pass.' },
    { label: 'All three remain possible', explanation: 'A pass permanently rules out both open suits.' },
  ] },
};

export function scenarioFor(drill: Drill): DrillScenario {
  const scenario = SCENARIOS[drill.id];
  if (!scenario) throw new Error(`Missing Academy drill scenario: ${drill.id}`);
  return scenario;
}
