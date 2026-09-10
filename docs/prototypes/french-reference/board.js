const guard = document.querySelector('.board-guard');
const output = document.querySelector('.measurements');
const root = document.documentElement;

const positions = {
  0: [[50, 50]],
  1: [[20, 20], [80, 20], [20, 80], [80, 80]],
  2: [[20, 20], [80, 20], [50, 50], [20, 80], [80, 80]],
  3: [[20, 20], [80, 20], [50, 50], [20, 80], [80, 80]],
  4: [[20, 20], [80, 20], [20, 80], [80, 80]],
  5: [[20, 20], [80, 20], [50, 50], [20, 80], [80, 80]],
  6: [[20, 18], [20, 50], [20, 82], [80, 18], [80, 50], [80, 82]],
};

function half(value) {
  const node = document.createElement('span');
  node.className = 'half';
  for (const [x, y] of positions[value]) {
    const pip = document.createElement('i');
    pip.className = 'pip';
    pip.style.left = `${x}%`; pip.style.top = `${y}%`;
    node.appendChild(pip);
  }
  return node;
}

function domino(id, orientation = 'vertical') {
  const node = document.createElement('div');
  node.className = `domino ${orientation}`;
  node.dataset.tile = id;
  const [a, b] = id.split('-').map(Number);
  node.append(half(a), half(b));
  return node;
}

const fixtures = {
  opening: {
    arms: [
      ['right', ['0-4']], ['left', ['0-2']], ['up', ['0-5']], ['down', ['0-1']],
    ], hand: ['3-6','2-4','1-3','5-6','2-2','4-5'], hidden: 6,
  },
  late: {
    arms: [
      ['right', ['0-4','4-4','4-6','3-6','3-5','1-5','1-2']],
      ['left', ['0-2','2-2','2-6','5-6','5-5','4-5']],
      ['up', ['0-5','2-5','2-3','3-3','1-3','1-6']],
      ['down', ['0-1','1-1','1-4','3-4','3-6']],
    ], hand: ['0-6'], hidden: 1,
  },
};

// JamDom's public desktop client uses a 1000x800 game surface, a 450x390
// French board, and 30x60 dominoes. These are its board-centre coordinates,
// expressed in that 30px logical unit. The route turns; the tiles do not shrink.
const referenceRoutes = {
  right: [[270,195,'horizontal'],[330,195,'horizontal'],[390,195,'horizontal'],[435,210,'vertical'],[435,270,'vertical'],[435,330,'vertical'],[420,375,'horizontal'],[360,375,'horizontal'],[300,375,'horizontal'],[270,330,'vertical'],[270,270,'vertical'],[315,240,'horizontal'],[375,240,'horizontal'],[400,285,'vertical'],[385,330,'horizontal'],[325,340,'horizontal'],[305,295,'vertical']],
  left: [[180,195,'horizontal'],[120,195,'horizontal'],[60,195,'horizontal'],[15,180,'vertical'],[15,120,'vertical'],[15,60,'vertical'],[30,15,'horizontal'],[90,15,'horizontal'],[150,15,'horizontal'],[180,60,'vertical'],[180,120,'vertical'],[135,150,'horizontal'],[75,150,'horizontal'],[50,105,'vertical'],[65,60,'horizontal'],[125,50,'horizontal'],[145,95,'vertical'],[100,110,'horizontal']],
  up: [[225,135,'vertical'],[225,75,'vertical'],[240,30,'horizontal'],[300,30,'horizontal'],[360,30,'horizontal'],[420,30,'horizontal'],[435,75,'vertical'],[435,135,'vertical'],[390,160,'horizontal'],[330,160,'horizontal'],[285,145,'vertical'],[270,85,'vertical'],[315,65,'horizontal'],[375,65,'horizontal'],[400,110,'vertical'],[355,125,'horizontal']],
  down: [[225,255,'vertical'],[225,315,'vertical'],[210,360,'horizontal'],[150,360,'horizontal'],[90,360,'horizontal'],[30,360,'horizontal'],[15,315,'vertical'],[15,255,'vertical'],[60,230,'horizontal'],[120,230,'horizontal'],[165,245,'vertical'],[180,305,'vertical'],[135,325,'horizontal'],[75,325,'horizontal'],[50,280,'vertical'],[95,265,'horizontal']],
};

// Preserve the reference ratio as the table grows: 30px on a 1000px table.
// This is selected once on page load and remains unchanged between fixtures.
const tableBox = document.querySelector('.table').getBoundingClientRect();
const lockedUnit = Math.max(30, Math.min(60, Math.round(tableBox.width * .03)));
root.style.setProperty('--played-short', `${lockedUnit}px`);
root.style.setProperty('--hand-short', `${lockedUnit}px`);
root.style.setProperty('--reference-scale', `${lockedUnit / 30}`);

function buildPlacements(data) {
  const placed = [{ id: '0-0', cx: 225, cy: 195, orientation: 'vertical' }];
  for (const [direction, ids] of data.arms) {
    let open = 0;
    let previous = [225, 195];
    ids.forEach((id, index) => {
      const [cx, cy, orientation] = referenceRoutes[direction][index];
      const [a, b] = id.split('-').map(Number);
      const outward = a === open ? b : a;
      const travel = orientation === 'horizontal'
        ? (cx >= previous[0] ? 'right' : 'left')
        : (cy >= previous[1] ? 'down' : 'up');
      const renderId = travel === 'right' || travel === 'down'
        ? `${open}-${outward}`
        : `${outward}-${open}`;
      placed.push({ id: renderId, cx, cy, orientation });
      open = outward;
      previous = [cx, cy];
    });
  }
  return placed;
}

function render(name) {
  const data = fixtures[name];
  guard.replaceChildren();
  const scale = lockedUnit / 30;
  const items = buildPlacements(data);
  for (const p of items) {
    const node = domino(p.id, p.orientation);
    const width = p.orientation === 'horizontal' ? lockedUnit * 2 : lockedUnit;
    const height = p.orientation === 'horizontal' ? lockedUnit : lockedUnit * 2;
    node.style.left = `${p.cx * scale - width / 2}px`;
    node.style.top = `${p.cy * scale - height / 2}px`;
    guard.appendChild(node);
  }
  document.querySelector('.local-hand').replaceChildren(...data.hand.map((id) => domino(id)));
  document.querySelectorAll('.rack').forEach((rack) => rack.replaceChildren(...Array.from({ length: data.hidden }, () => {
    const back = document.createElement('i'); back.className = 'back'; return back;
  })));
  output.value = `${items.length} played · ${lockedUnit}×${lockedUnit * 2}px everywhere · JamDom 450×390 route · never shrinks`;
}

document.querySelectorAll('[data-fixture]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-fixture]').forEach((b) => b.classList.toggle('active', b === button));
  render(button.dataset.fixture);
}));
render('late');
