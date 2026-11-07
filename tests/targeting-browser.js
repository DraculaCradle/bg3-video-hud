import { actor, item, userWithFlags } from './fixtures.js';
import { VideoHUD } from '../scripts/hud.js';
import { LayoutStore } from '../scripts/persistence.js';

export function createTargetingFixture(synthetic = false) {
  const originalCanvas = globalThis.canvas;
  const board = document.createElement('canvas');
  board.id = 'board'; board.width = 800; board.height = 400;
  board.style.cssText = 'position:fixed;left:20px;top:20px;width:800px;height:400px;cursor:grab;z-index:1';
  document.body.append(board);
  const user = userWithFlags(), errors = [], calls = [], selections = [];
  const scene = { id: 'target-test' };
  const token = (id, x, y, extra = {}) => ({ id, visible: true, center: { x, y },
    bounds: { contains: (px, py) => Math.abs(px - x) <= 12 && Math.abs(py - y) <= 12 },
    document: { parent: scene, _source: { level: 'ground' }, uuid: `Scene.target-test.Token.${id}` },
    actor: actor(id), ...extra });
  const tokens = [token('one', 100, 100), token('two', 200, 100), token('three', 300, 100),
    token('hidden', 150, 100, { isVisible: false })];
  // Original diagram art for offline input tests/previews; no uploaded frames.
  const drawing = board.getContext('2d');
  drawing.fillStyle = '#172922'; drawing.fillRect(0, 0, board.width, board.height);
  drawing.strokeStyle = '#354d3c'; drawing.lineWidth = 1;
  for (let x = 0; x < board.width; x += 40) {
    drawing.beginPath(); drawing.moveTo(x, 0); drawing.lineTo(x, board.height); drawing.stroke();
  }
  for (let y = 0; y < board.height; y += 40) {
    drawing.beginPath(); drawing.moveTo(0, y); drawing.lineTo(board.width, y); drawing.stroke();
  }
  tokens.filter(t => t.isVisible !== false).forEach((t, i) => {
    const x = t.center.x * 2 + 40, y = t.center.y * 2 + 20;
    drawing.beginPath(); drawing.arc(x, y, 24, 0, Math.PI * 2);
    drawing.fillStyle = '#314a69'; drawing.fill(); drawing.strokeStyle = '#d9bd7b'; drawing.stroke();
    drawing.fillStyle = '#fff4d4'; drawing.font = '18px system-ui'; drawing.textAlign = 'center';
    drawing.fillText(String(i + 1), x, y + 6);
  });
  const canvas = globalThis.canvas = { ready: true, scene, level: { id: 'ground' },
    app: { screen: { width: 800, height: 400 } },
    // Simulate zoom 2x, map panning and a canvas with a CSS offset.
    stage: { worldTransform: { applyInverse: ({ x, y }) => ({ x: (x - 40) / 2, y: (y - 20) / 2 }) } },
    tokens: { placeables: tokens, setTargets: ids => selections.push(ids) } };
  const activity = (id, count) => ({ id, canUse: true, target: { affects: { type: 'creature', count } },
    use: async config => { calls.push({ id, config, targets: selections.at(-1) }); return undefined; } });
  const single = activity('single', 1), multi = activity('multi', 2);
  // Actual prepared weapon shape: blank affects.type must still prompt a token.
  single.type = 'attack'; single.target.affects = { type: '', count: '' };
  const caster = actor('target-caster', [item('attack', 'weapon', { activities: new Map([['single', single]]) }, { name: '练习攻击' }),
    item('spell', 'spell', { level: 1, activities: new Map([['multi', multi]]) }, { name: '群体练习法术' })], {
    name: '试炼施法者（模拟）', system: { attributes: { hp: { value: 18, max: 24 }, ac: { value: 14 } },
      spells: { spell1: { value: 2, max: 3 } } }
  });
  const originalSystem = structuredClone(caster.system);
  const hud = new VideoHUD({ store: new LayoutStore(user), user, onDisable: () => hud.clear(), onError: e => errors.push(e) });
  const use = id => hud.root.querySelector(`[data-action="use"][data-item-id="${id}"]`).click();
  const send = (type, x, y, button = 0) => board.dispatchEvent(new PointerEvent(type,
    { bubbles: true, cancelable: true, pointerId: 1, button, clientX: x * 2 + 60, clientY: y * 2 + 40 }));
  const drag = (x1, y1, x2, y2) => { send('pointerdown', x1, y1); send('pointermove', x2, y2); send('pointerup', x2, y2); };
  let nativePresses = 0;
  board.addEventListener('pointerdown', () => nativePresses++);
  // Synthetic DOM events cannot acquire a real pointer capture. Production uses
  // real capture; the separate CDP case below verifies trusted mouse input.
  if (synthetic) board.setPointerCapture = () => {};
  hud.setActor(caster);
  return { hud, board, user, errors, calls, selections, scene, tokens, canvas, single, multi, caster, originalSystem,
    use, send, drag, get nativePresses() { return nativePresses; },
    snapshot: () => ({ calls: calls.length, targets: selections.at(-1) ?? [], selections: selections.length,
      picking: hud.targeting.picking, cursor: board.style.cursor, nativePresses,
      actor: hud.actor?.uuid, box: !!document.querySelector('.bg3-video-hud-target-box'), writes: user.writes.length }),
    dispose() { hud.destroy(); board.remove(); globalThis.canvas = originalCanvas; } };
}

export async function targetingBrowserTests({ test, assert, equal, flush }) {
  const f = createTargetingFixture(true);
  const { hud, board, user, errors, calls, selections, tokens, caster, originalSystem, use, send, drag } = f;
  try {
    await test('single target executes once after a map click, preserving pan/zoom/CSS offset and actor', async () => {
      use('attack'); await flush(); equal(calls.length, 0);
      assert(hud.root.querySelector('[data-action="cancel-target"]'));
      assert(hud.root.querySelector('[data-action="edit"]').disabled);
      drag(100, 100, 100, 100); await flush();
      equal(calls.length, 1); equal(calls.at(-1).targets, ['one']); equal(hud.actor, caster);
      equal(f.nativePresses, 0); equal(board.style.cursor, 'grab');
      assert(!document.querySelector('.bg3-video-hud-target-box'));
    });
    await test('multi target automatically selects visible token centres on reverse-drag release', async () => {
      use('spell'); await flush();
      send('pointerdown', 250, 150); send('pointermove', 50, 50);
      assert(!document.querySelector('.bg3-video-hud-target-box').hidden);
      equal(calls.length, 1); send('pointerup', 50, 50); await flush();
      equal(calls.length, 2); equal(calls.at(-1).targets, ['one', 'two']); equal(f.nativePresses, 0);
      equal(user.writes.length, 0); equal(caster.system, originalSystem);
    });
    await test('empty or excessive ranges do not use skills, change targets or silently truncate the set', async () => {
      const before = calls.length, selected = selections.length;
      use('spell'); await flush();
      drag(0, 0, 10, 10); await flush(); equal(calls.length, before); equal(selections.length, selected);
      drag(0, 0, 350, 150); await flush(); equal(calls.length, before); equal(selections.length, selected);
      assert(hud.root.textContent.includes('最多 2 个'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await flush(); equal(calls.length, before); assert(!hud.targeting.picking);
      assert(!document.querySelector('.bg3-video-hud-target-box')); equal(board.style.cursor, 'grab');
      send('pointerdown', 100, 100); equal(f.nativePresses, 1);
    });
    await test('clicking empty space or dragging a single-target skill cannot execute it', async () => {
      const before = calls.length;
      use('attack'); await flush(); drag(0, 0, 0, 0); drag(100, 100, 200, 100); await flush();
      equal(calls.length, before);
      hud.root.querySelector('[data-action="cancel-target"]').click(); await flush();
      assert(!hud.targeting.picking); equal(calls.length, before);
    });
    await test('permission revoked, item removed, hidden target or unavailable map coordinates block use', async () => {
      const before = calls.length;
      use('attack'); await flush(); caster.isOwner = false; drag(100, 100, 100, 100); await flush();
      equal(calls.length, before); assert(errors.at(-1).includes('拥有权限')); caster.isOwner = true;
      use('attack'); await flush(); const old = caster.items.get('attack'); caster.items.delete('attack');
      drag(100, 100, 100, 100); await flush(); equal(calls.length, before);
      caster.items.set('attack', old); hud.render();
      use('attack'); await flush(); tokens[0].visible = false; drag(100, 100, 100, 100); await flush();
      equal(calls.length, before); tokens[0].visible = true;
      hud.targeting.cancel(); await flush();
      use('attack'); await flush(); f.canvas.app.screen.width = 0;
      drag(100, 100, 100, 100); await flush(); equal(calls.length, before);
      assert(hud.status.includes('地图坐标不可用')); assert(!hud.targeting.picking);
      assert(!document.querySelector('.bg3-video-hud-target-box')); equal(board.style.cursor, 'grab');
      f.canvas.app.screen.width = 800;
    });
    await test('actor change clears selection listeners and does not overwrite new actor status', async () => {
      use('attack'); await flush();
      hud.setActor(actor('another')); drag(100, 100, 100, 100); await flush();
      assert(!hud.targeting.picking); equal(hud.status, ''); equal(board.style.cursor, 'grab');
      hud.setActor(caster);
    });
    await test('scene teardown and disabling remove only our transient selection overlay', async () => {
      const before = calls.length;
      use('spell'); await flush(); send('pointerdown', 0, 0); send('pointermove', 100, 100);
      hud.clear(); send('pointerup', 100, 100); await flush(); equal(calls.length, before);
      assert(!document.querySelector('.bg3-video-hud-target-box')); equal(board.style.cursor, 'grab');
      equal(user.writes.length, 0);
    });
  } finally {
    f.dispose();
  }
}
