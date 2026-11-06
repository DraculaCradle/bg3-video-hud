import { actor, item, userWithFlags } from './fixtures.js';
import { MODULE_ID } from '../scripts/model.js';
import { LayoutStore } from '../scripts/persistence.js';

const results = document.querySelector('#test-results');
const lines = [];
let passed = 0, failed = 0;
const assert = (ok, message = 'assertion failed') => { if (!ok) throw new Error(message); };
const equal = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
async function test(name, callback) {
  try { await callback(); passed++; lines.push(`PASS ${name}`); }
  catch (error) { failed++; lines.push(`FAIL ${name}: ${error.stack ?? error}`); }
}
const handlers = new Map();
globalThis.Hooks = {
  on(name, fn) { const list = handlers.get(name) ?? []; list.push({ fn }); handlers.set(name, list); },
  once(name, fn) { const list = handlers.get(name) ?? []; list.push({ fn, once: true }); handlers.set(name, list); },
  async emit(name, ...args) {
    const list = [...(handlers.get(name) ?? [])];
    handlers.set(name, list.filter(h => !h.once));
    for (const handler of list) await handler.fn(...args);
    await flush();
  }
};
const notifications = [];
globalThis.ui = { notifications: { error: text => notifications.push(text), warn: text => notifications.push(text) } };
const settings = new Map(), definitions = new Map();
const user = userWithFlags();
user.flags['bg3-hud-core'] = { layout: ['untouched'] };
user.flags['bg3-hud-dnd5e'] = { order: ['original'] };
const oldFlags = JSON.stringify(user.flags);
const setFlag = user.setFlag.bind(user);
user.setFlag = async (...args) => { await setFlag(...args); await Hooks.emit('updateUser', user); };
let uses = 0, shortRests = 0, longRests = 0;
const sword = item('sword', 'weapon', { activities: [{ activation: { type: 'action' } }] }, {
  name: '<img src=x onerror="window.injected=true">',
  use: async config => { assert(config.event instanceof MouseEvent); uses++; return { official: true }; }
});
const light = item('light', 'spell', { level: 0, activities: [{ activation: { type: 'action' } }] }, { use: async () => undefined });
const hex = item('hex', 'spell', { level: 1, activities: [{ activation: { type: 'bonus' } }] }, { use: async () => undefined });
const hero = actor('hero', [sword, item('bow', 'weapon'), item('second-wind'), light, hex], {
  system: { attributes: { hp: { value: 9, max: 12 }, ac: { value: 15 } },
    spells: { spell1: { value: 0, max: 2 }, pact: { value: 1, max: 1, level: 2 } } },
  shortRest: async () => { shortRests++; }, longRest: async () => { longRests++; }
});
user.character = hero;
globalThis.canvas = { ready: true, tokens: { controlled: [{ actor: hero }] } };
globalThis.game = {
  world: { id: 'modstest', title: 'ModsTest' },
  user, version: '14.0', system: { id: 'dnd5e', version: '6.0.6' },
  modules: new Map([[MODULE_ID, {}], ['bg3-hud-core', { active: true }], ['bg3-hud-dnd5e', { active: true }]]),
  settings: {
    register(scope, key, definition) { definitions.set(`${scope}.${key}`, definition); settings.set(`${scope}.${key}`, definition.default); },
    get(scope, key) { return settings.get(`${scope}.${key}`); },
    async set(scope, key, value) { settings.set(`${scope}.${key}`, value); definitions.get(`${scope}.${key}`)?.onChange?.(value); await flush(); }
  }, keybindings: { register() {} }
};
const root = () => document.getElementById(MODULE_ID);
const originalVisible = () => getComputedStyle(document.getElementById('bg3-hotbar')).display !== 'none';
const find = (action, itemId) => root()?.querySelector(`button[data-action="${action}"]${itemId ? `[data-item-id="${itemId}"]` : ''}`);
async function click(action, itemId) {
  const button = find(action, itemId); assert(button, `Missing ${action} ${itemId ?? ''}`); button.click(); await flush();
}
async function enable() { await game.settings.set(MODULE_ID, 'enabled', true); }
async function select(next) { canvas.tokens.controlled = next ? [{ actor: next }] : []; await Hooks.emit('controlToken'); }

try {
  await import('../scripts/module.js');
  await Hooks.emit('init');
  await Hooks.emit('ready');

  await test('defaults to original HUD; does not write upstream flags/settings', async () => {
    assert(!root()); assert(originalVisible()); equal(JSON.stringify(user.flags), oldFlags);
    equal([...settings.keys()], [`${MODULE_ID}.enabled`]);
  });
  await test('scene control enables complete HUD and scopes suppression to original shell', async () => {
    const controls = { tokens: { tools: {} } };
    await Hooks.emit('getSceneControlButtons', controls);
    await controls.tokens.tools.bg3VideoHUD.onChange({}, true); await flush();
    assert(root()); assert(!originalVisible());
    for (const label of ['装备', '特性', '法术', '生命 9/12', '护甲 15', '契约2环：1/1', '1环：0/2']) assert(root().textContent.includes(label), label);
    for (const label of ['编辑', '原版界面', '附赠动作', '反应', '仅固定', '短休', '长休']) assert(root().textContent.includes(label), label);
    equal(definitions.get(`${MODULE_ID}.enabled`).name, '启用 BG3 视频界面');
    equal([...root().querySelectorAll('[data-group]')].map(section => section.dataset.group), ['Equipment', 'Features', 'Spells']);
    equal(root().querySelector('.bg3-video-hud-summary strong').textContent, hero.name);
  });
  await test('document strings render as text rather than executable HTML', async () => {
    assert(root().textContent.includes(sword.name));
    assert(!root().querySelector('img[onerror]')); assert(!window.injected);
    assert(find('use', 'sword').getAttribute('aria-label').includes(sword.name));
    assert(find('use', 'sword').title.includes(sword.name));
  });
  await test('a missing item image leaves a visible fallback and the full accessible name', async () => {
    sword.img = 'data:image/png;base64,invalid';
    await Hooks.emit('updateActor', hero);
    find('use', 'sword').querySelector('img')?.dispatchEvent(new Event('error'));
    const initial = find('use', 'sword').querySelector('.bg3-video-hud-item-initial');
    assert(initial.getBoundingClientRect().width > 0 && initial.getBoundingClientRect().height > 0);
    assert(find('use', 'sword').getAttribute('aria-label').includes(sword.name));
    delete sword.img;
    await Hooks.emit('updateActor', hero);
  });
  await test('item/resource changes rerender without losing selected actor', async () => {
    hero.system.attributes.hp.value = 0;
    await Hooks.emit('updateActor', hero);
    assert(root().textContent.includes('生命 0/12'));
    hero.items.set('new', item('new'));
    await Hooks.emit('createItem', hero.items.get('new'));
    assert(find('use', 'new'));
  });
  await test('item click invokes official use; double clicks are blocked while pending', async () => {
    let resolve;
    const original = sword.use;
    sword.use = async config => { await original(config); return new Promise(r => { resolve = r; }); };
    find('use', 'sword').click(); await flush();
    assert(find('use', 'sword').disabled);
    find('use', 'sword').click(); await flush(); equal(uses, 1);
    resolve(); await flush(); assert(!find('use', 'sword').disabled);
    sword.use = original;
  });
  await test('official cancellation does not report fabricated success or change slots', async () => {
    await click('use', 'hex'); equal(hero.system.spells.spell1.value, 0);
    equal(root().querySelector('[role="status"]').textContent, '');
  });
  await test('system exceptions surface to user and release busy state', async () => {
    const original = sword.use;
    sword.use = async () => { throw new Error('System rejected consumption'); };
    await click('use', 'sword');
    assert(root().textContent.includes('System rejected consumption'));
    assert(notifications.some(n => n.includes('System rejected consumption')));
    assert(!find('use', 'sword').disabled); sword.use = original;
  });
  await test('late workflow errors do not write status onto a newly selected actor', async () => {
    const original = sword.use;
    let reject;
    sword.use = () => new Promise((_resolve, fail) => { reject = fail; });
    find('use', 'sword').click(); await flush();
    await select(actor('other'));
    reject(new Error('Previous actor workflow failed')); await flush();
    assert(!root().textContent.includes('Previous actor workflow failed'));
    assert(notifications.some(n => n.includes('Previous actor workflow failed')));
    sword.use = original; await select(hero); assert(!find('use', 'sword').disabled);
  });
  await test('rests use both official workflows', async () => {
    for (const kind of ['short', 'long']) { root().querySelector(`[data-action="rest"][data-value="${kind}"]`).click(); await flush(); }
    equal(shortRests, 1); equal(longRests, 1);
  });
  await test('edit mode persists visibility, exposes hidden items and prevents item use', async () => {
    await click('edit'); assert(find('use', 'sword').disabled);
    await click('visibility', 'sword');
    assert(find('use', 'sword').closest('li').classList.contains('bg3-video-hud-item-hidden'));
    await click('edit'); assert(!find('use', 'sword'));
    await click('edit'); await click('visibility', 'sword');
    assert(!find('use', 'sword').closest('li').classList.contains('bg3-video-hud-item-hidden'));
  });
  await test('keyboard-accessible ordering moves up and down within group', async () => {
    root().querySelector('[data-action="move"][data-item-id="sword"][data-direction="-1"]').click(); await flush();
    const order = () => [...root().querySelectorAll('.bg3-video-hud-panel:first-child li')].map(n => n.dataset.itemId);
    equal(order().slice(0, 2), ['sword', 'bow']);
    root().querySelector('[data-action="move"][data-item-id="sword"][data-direction="1"]').click(); await flush();
    equal(order().slice(0, 2), ['bow', 'sword']);
  });
  await test('drag reorders only actor-owned items in same group', async () => {
    const target = root().querySelector('li[data-item-id="bow"]');
    const transfer = new DataTransfer();
    transfer.setData('application/x-bg3-video-hud', JSON.stringify({ actor: hero.uuid, itemId: 'sword' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); await flush();
    equal(new LayoutStore(user).read(hero).order.slice(0, 2), ['sword', 'bow']);
    const writes = user.writes.length;
    for (const payload of ['invalid JSON', JSON.stringify({ actor: 'Actor.enemy', itemId: 'sword' }),
      JSON.stringify({ actor: hero.uuid, itemId: 'hex' }), JSON.stringify({ actor: hero.uuid, itemId: 'foreign' })]) {
      transfer.setData('application/x-bg3-video-hud', payload);
      root().querySelector('li[data-item-id="bow"]').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
      await flush();
    }
    equal(user.writes.length, writes);
  });
  await test('pin and level filters compose, including cantrips', async () => {
    await click('pin', 'light'); await click('pinned-only'); await click('edit');
    assert(find('use', 'light')); assert(!find('use', 'hex'));
    root().querySelector('[data-action="filter-level"][data-value="1"]').click(); await flush();
    assert(!find('use', 'light')); assert(!find('use', 'hex'));
    root().querySelector('[data-action="filter-level"][data-value="0"]').click(); await flush(); assert(find('use', 'light'));
    await click('pinned-only');
    root().querySelector('[data-action="filter-level"][data-value="all"]').click(); await flush();
  });
  await test('action/bonus/reaction controls filter without writing turn resources', async () => {
    root().querySelector('[data-action="filter-action"][data-value="bonus"]').click(); await flush();
    assert(find('use', 'hex')); assert(!find('use', 'light')); assert(!find('use', 'sword'));
    root().querySelector('[data-action="filter-action"][data-value="all"]').click(); await flush();
  });
  await test('unowned token selection restores original HUD, without assigned-PC fallback', async () => {
    await select(actor('enemy', [], { isOwner: false })); assert(!root()); assert(originalVisible());
    await select(hero); assert(root());
  });
  await test('permission revoked immediately before use prevents the action', async () => {
    hero.isOwner = false; const previous = uses;
    await click('use', 'sword'); equal(uses, previous);
    assert(root().textContent.includes('拥有权限'));
    await Hooks.emit('updateActor', hero); assert(!root()); assert(originalVisible());
    hero.isOwner = true; await select(hero);
  });
  await test('scene teardown removes replacement; canvas ready restores it', async () => {
    await Hooks.emit('canvasTearDown'); assert(!root()); assert(originalVisible());
    await Hooks.emit('updateActor', hero); assert(!root());
    await Hooks.emit('canvasReady'); assert(root());
  });
  await test('missing actor stats and portrait are safe; actor switches reset edit/filters', async () => {
    await click('edit');
    await select(actor('empty')); assert(root().textContent.includes('生命 —/—')); assert(root().textContent.includes('护甲 —'));
    equal(find('edit').textContent, '编辑');
    await select(hero);
  });
  await test('unsupported system fails open to original HUD', async () => {
    game.system.version = '7.0.0'; await Hooks.emit('updateActor', hero);
    assert(!root()); assert(originalVisible());
    game.system.version = '6.0.6'; await enable(); assert(root());
  });
  await test('a render failure restores original HUD and reports the failure', async () => {
    const getFlag = user.getFlag;
    user.getFlag = () => { throw new Error('Flag read unavailable'); };
    await Hooks.emit('updateUser', user); assert(!root()); assert(originalVisible());
    assert(notifications.some(n => n.includes('Flag read unavailable')));
    user.getFlag = getFlag; await Hooks.emit('updateUser', user); assert(root());
  });
  await test('an action-time render failure restores original and releases the busy lock', async () => {
    const getFlag = user.getFlag;
    const count = uses;
    user.getFlag = () => { throw new Error('Action render unavailable'); };
    await click('use', 'sword'); assert(!root()); assert(originalVisible()); equal(uses, count);
    user.getFlag = getFlag; await Hooks.emit('updateUser', user);
    assert(root()); assert(!find('use', 'sword').disabled);
  });
  await test('disable restores upstream display and never overwrites original preferences', async () => {
    await click('disable'); assert(!root()); assert(originalVisible());
    equal(user.flags['bg3-hud-core'], { layout: ['untouched'] });
    equal(user.flags['bg3-hud-dnd5e'], { order: ['original'] });
    assert(user.writes.every(w => w.scope === MODULE_ID));
    equal([...settings.keys()], [`${MODULE_ID}.enabled`]);
  });
  await test('scene tool reads live setting after other controls toggle the HUD', async () => {
    const controls = { tokens: { tools: {} } };
    await Hooks.emit('getSceneControlButtons', controls);
    const tool = controls.tokens.tools.bg3VideoHUD;
    equal(tool.button, true);
    await tool.onChange(); await flush(); assert(root());
    await click('disable'); assert(!root());
    await tool.onChange(); await flush(); assert(root());
    await tool.onChange(); await flush(); assert(!root()); assert(originalVisible());
  });
  // The Node runner now drives actual viewport changes and keyboard events.
  await enable();
  const crowded = actor('crowded', Array.from({ length: 180 }, (_, i) => item(`crowded-${i}`,
    i < 60 ? 'weapon' : i < 120 ? 'feat' : 'spell', { level: i % 10 },
    { name: `超长名称 Long equipment, feature or spell ${i}` })), {
    name: '林间游侠（示例角色） Example Ranger — a very long character name',
    system: { attributes: { hp: { value: 12, max: 12 }, ac: { value: 14 } },
      spells: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 2, max: 3 }])),
      resources: { primary: { label: 'Very long resource name', value: 2, max: 4 } } }
  });
  window.bg3LayoutTest = {
    crowded: () => select(crowded), reset: () => select(hero),
    refresh: () => Hooks.emit('updateActor', crowded), writes: () => user.writes.length, enable
  };
  const interactions = await new Promise(resolve => {
    window.finishBG3BrowserInteractions = resolve;
    results.dataset.status = 'interactive';
  });
  for (const outcome of interactions) {
    if (outcome.passed) { passed++; lines.push(`PASS ${outcome.name}`); }
    else { failed++; lines.push(`FAIL ${outcome.name}: ${outcome.error}`); }
  }
  results.dataset.status = 'running';
  delete window.finishBG3BrowserInteractions;
  delete window.bg3LayoutTest;
  await test('unload removes temporary suppression', async () => {
    await enable(); assert(root());
    window.dispatchEvent(new Event('beforeunload')); assert(!root()); assert(originalVisible());
  });
  await test('a different world registers no HUD settings, controls or API and writes no flags', async () => {
    handlers.clear();
    game.world = { id: 'campaign', title: 'Campaign' };
    game.modules.set(MODULE_ID, {});
    const flags = JSON.stringify(user.flags);
    game.settings.register = () => { throw new Error('Foreign world settings registration'); };
    game.keybindings.register = () => { throw new Error('Foreign world keybindings registration'); };
    await import('../scripts/module.js?foreign-world-bootstrap');
    await Hooks.emit('init'); await Hooks.emit('ready');
    const controls = { tokens: { tools: {} } };
    await Hooks.emit('getSceneControlButtons', controls);
    assert(!root()); assert(originalVisible());
    assert(!controls.tokens.tools.bg3VideoHUD); assert(!game.modules.get(MODULE_ID).api);
    equal(JSON.stringify(user.flags), flags);
  });
} catch (error) { failed++; lines.push(`HARNESS FAILURE: ${error.stack ?? error}`); }
results.textContent = `${lines.join('\n')}\n${passed} passed, ${failed} failed`;
results.dataset.status = failed ? 'failed' : 'passed';
results.dataset.count = String(passed + failed);
