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
    for (const label of ['Equipment', 'Features', 'Spells', 'HP 9/12', 'AC 15', 'Pact L2: 1/1', 'L1: 0/2']) assert(root().textContent.includes(label), label);
  });
  await test('document strings render as text rather than executable HTML', async () => {
    assert(root().textContent.includes(sword.name));
    assert(!root().querySelector('img[onerror]')); assert(!window.injected);
  });
  await test('item/resource changes rerender without losing selected actor', async () => {
    hero.system.attributes.hp.value = 0;
    await Hooks.emit('updateActor', hero);
    assert(root().textContent.includes('HP 0/12'));
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
    assert(root().textContent.includes('you own'));
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
    await select(actor('empty')); assert(root().textContent.includes('HP —/—')); assert(root().textContent.includes('AC —'));
    equal(find('edit').textContent, 'Edit');
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
  await test('disable restores upstream display and never overwrites original preferences', async () => {
    await click('disable'); assert(!root()); assert(originalVisible());
    equal(user.flags['bg3-hud-core'], { layout: ['untouched'] });
    equal(user.flags['bg3-hud-dnd5e'], { order: ['original'] });
    assert(user.writes.every(w => w.scope === MODULE_ID));
    equal([...settings.keys()], [`${MODULE_ID}.enabled`]);
  });
  await test('unload removes temporary suppression', async () => {
    await enable(); assert(root());
    window.dispatchEvent(new Event('beforeunload')); assert(!root()); assert(originalVisible());
  });
} catch (error) { failed++; lines.push(`HARNESS FAILURE: ${error.stack ?? error}`); }
results.textContent = `${lines.join('\n')}\n${passed} passed, ${failed} failed`;
results.dataset.status = failed ? 'failed' : 'passed';
results.dataset.count = String(passed + failed);
