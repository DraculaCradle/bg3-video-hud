import { actor, item, userWithFlags } from './fixtures.js';
import { MODULE_ID } from '../scripts/model.js';
import { LayoutStore } from '../scripts/persistence.js';
import { targetingBrowserTests, createTargetingFixture } from './targeting-browser.js';
import { completeFeatureBrowserTests } from './complete-features-browser.js';
import { referenceBrowserTests } from './reference-browser.js';
import { createChoiceDialogFixture } from './choice-dialog-browser.js';

const results = document.querySelector('#test-results');
const lines = [];
let passed = 0, failed = 0;
const assert = (ok, message = 'assertion failed') => { if (!ok) throw new Error(message); };
const equal = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
async function test(name, callback) {
  console.debug(`BG3 TEST START ${name}`);
  try { await callback(); passed++; lines.push(`PASS ${name}`); }
  catch (error) { failed++; lines.push(`FAIL ${name}: ${error.stack ?? error}`); }
  results.textContent = lines.join('\n');
  console.debug(`BG3 TEST END ${name}`);
}
const handlers = new Map();
globalThis.Hooks = {
  on(name, fn) { const list = handlers.get(name) ?? []; list.push({ fn }); handlers.set(name, list); },
  once(name, fn) { const list = handlers.get(name) ?? []; list.push({ fn, once: true }); handlers.set(name, list); },
  off(name, fn) { handlers.set(name, (handlers.get(name) ?? []).filter(h => h.fn !== fn)); },
  async emit(name, ...args) {
    const list = [...(handlers.get(name) ?? [])];
    handlers.set(name, list.filter(h => !h.once));
    for (const handler of list) await handler.fn(...args);
    await flush();
  }
};
const notifications = [];
globalThis.ui = { notifications: { error: text => notifications.push(text), warn: text => notifications.push(text) } };
const settings = new Map([[`${MODULE_ID}.enabled`, false]]), definitions = new Map();
const user = userWithFlags();
user.isGM = false; user.role = 1;
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
hero.testUserPermission = (u, permission) => u.id === user.id && permission === 'OWNER' && hero.isOwner;
user.character = hero;
globalThis.canvas = { ready: true, tokens: { controlled: [{ actor: hero }] } };
globalThis.game = {
  world: { id: 'modstest', title: 'ModsTest' },
  user, version: '14.0', system: { id: 'dnd5e', version: '6.0.6' },
  modules: new Map([[MODULE_ID, {}]]),
  settings: {
    register() { throw new Error('HUD must not register an activation setting'); },
    get() { throw new Error('HUD must not read legacy activation setting'); },
    async set() { throw new Error('HUD must not write activation settings'); }
  }, keybindings: { register() {} }
};
const root = () => document.getElementById(MODULE_ID);
const originalVisible = () => getComputedStyle(document.getElementById('bg3-hotbar')).display !== 'none';
const find = (action, itemId) => root()?.querySelector(`button[data-action="${action}"]${itemId ? `[data-item-id="${itemId}"]` : ''}`);
async function click(action, itemId) {
  const button = find(action, itemId); assert(button, `Missing ${action} ${itemId ?? ''}`); button.click(); await flush();
  for (let i = 0; root()?.getAttribute('aria-busy') === 'true' && i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert(root()?.getAttribute('aria-busy') !== 'true', 'Layout saving did not settle');
}
async function enable() { const api = game.modules.get(MODULE_ID).api; if (!api.status().enabled) await api.toggle(); api.refresh(); await flush(); }
async function pause() { if (game.modules.get(MODULE_ID).api.status().enabled) await game.modules.get(MODULE_ID).api.toggle(); await flush(); }
async function select(next) { canvas.tokens.controlled = next ? [{ actor: next }] : []; await Hooks.emit('controlToken'); }

try {
  await import('../scripts/module.js');
  await Hooks.emit('init');
  await Hooks.emit('ready');

  await test('active module automatically starts Player HUD despite legacy false; no settings or flag writes', async () => {
    assert(!game.modules.has('bg3-hud-core') && !game.modules.has('bg3-hud-dnd5e'));
    assert(root()); assert(!originalVisible()); equal(JSON.stringify(user.flags), oldFlags);
    equal([...settings.keys()], [`${MODULE_ID}.enabled`]);
  });
  await test('scene control temporarily returns and resumes complete HUD without an activation setting', async () => {
    const controls = { tokens: { tools: {} } };
    await Hooks.emit('getSceneControlButtons', controls);
    await controls.tokens.tools.bg3VideoHUD.onChange(); await flush();
    assert(!root()); assert(originalVisible());
    await controls.tokens.tools.bg3VideoHUD.onChange(); await flush();
    assert(root()); assert(!originalVisible());
    for (const label of ['装备', '特性', '法术', '生命 9/12', '护甲 15', '契约2环：1/1', '1环：0/2']) assert(root().textContent.includes(label), label);
    for (const label of ['编辑', '原版界面', '附赠动作', '反应', '仅固定', '短休', '长休']) assert(root().textContent.includes(label), label);
    equal(definitions.size, 0); equal(settings.get(`${MODULE_ID}.enabled`), false);
    equal([...root().querySelectorAll('[data-group]')].map(section => section.dataset.group), ['Equipment', 'Features', 'Spells']);
    equal(root().querySelector('.bg3-video-hud-summary strong').textContent, hero.name);
  });
  await test('standalone HUD needs no BG3 shell; optional HUDs may be disabled or present without writes', async () => {
    const shell = document.getElementById('bg3-hotbar'); shell.remove();
    const native = document.createElement('div'); native.id = 'hotbar'; native.textContent = 'Native interface fixture'; document.body.append(native);
    const before = JSON.stringify(user.flags);
    try {
      await Hooks.emit('updateUser', user); assert(root()); assert(getComputedStyle(native).display === 'none');
      await click('disable'); assert(!root()); assert(getComputedStyle(native).display !== 'none');
      for (const id of ['bg3-hud-core', 'bg3-hud-dnd5e']) game.modules.set(id, { active: false });
      await game.modules.get(MODULE_ID).api.toggle(); await flush(); assert(root());
      document.body.append(shell);
      for (const id of ['bg3-hud-core', 'bg3-hud-dnd5e']) game.modules.get(id).active = true;
      await Hooks.emit('updateUser', user); assert(root()); assert(!originalVisible());
      await click('disable'); assert(originalVisible());
      for (const id of ['bg3-hud-core', 'bg3-hud-dnd5e']) assert(game.modules.get(id).active);
      await game.modules.get(MODULE_ID).api.toggle(); await flush(); assert(root());
      equal(JSON.stringify(user.flags), before);
    } finally {
      if (!shell.isConnected) document.body.append(shell);
      native.remove(); game.modules.delete('bg3-hud-core'); game.modules.delete('bg3-hud-dnd5e');
    }
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
    equal([...root().querySelectorAll('.bg3-video-hud-panel:first-child li')].slice(0, 2).map(n => n.dataset.itemId), ['sword', 'bow']);
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
  await test('scene tool reads session state after other controls temporarily return to native', async () => {
    const controls = { tokens: { tools: {} } };
    await Hooks.emit('getSceneControlButtons', controls);
    const tool = controls.tokens.tools.bg3VideoHUD;
    equal(tool.button, true);
    await tool.onChange(); await flush(); assert(root());
    await click('disable'); assert(!root());
    await tool.onChange(); await flush(); assert(root());
    await tool.onChange(); await flush(); assert(!root()); assert(originalVisible());
  });
  await targetingBrowserTests({ test, assert, equal, flush });
  await completeFeatureBrowserTests({ test, assert, equal, flush });
  await referenceBrowserTests({ test, assert, equal, flush });
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
    refresh: () => Hooks.emit('updateActor', crowded), writes: () => user.writes.length,
    notifications: () => notifications.slice(-5), enable
  };
  let targetingFixture;
  let choiceFixture;
  window.bg3ChoiceTest = {
    start(kind) { choiceFixture ??= createChoiceDialogFixture(); choiceFixture.start(kind); },
    snapshot: () => choiceFixture.snapshot(), refresh: () => choiceFixture.refresh(),
    closeAndRefresh: () => choiceFixture.closeAndRefresh(), switchToken: () => choiceFixture.switchToken(),
    revealLast: () => choiceFixture.revealLast(), switchActor: () => choiceFixture.switchActor(),
    dispose() { choiceFixture?.dispose(); choiceFixture = null; }
  };
  window.bg3TargetTest = {
    async start(kind) {
      targetingFixture?.dispose();
      targetingFixture = createTargetingFixture();
      targetingFixture.use(kind === 'single' ? 'attack' : 'spell'); await flush();
    },
    snapshot: () => targetingFixture.snapshot(),
    dispose: () => { targetingFixture?.dispose(); targetingFixture = null; }
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
  window.bg3ChoiceTest.dispose(); delete window.bg3ChoiceTest;
  window.bg3TargetTest.dispose();
  delete window.bg3TargetTest;
  await test('unload removes temporary suppression', async () => {
    await enable(); assert(root());
    window.dispatchEvent(new Event('beforeunload')); assert(!root()); assert(originalVisible());
  });
  await test('module activation automatically starts HUD in another world with no client setting', async () => {
    handlers.clear();
    game.world = { id: 'campaign', title: 'Campaign' };
    game.modules.set(MODULE_ID, {});
    canvas.tokens.controlled = [{ actor: hero }];
    const flags = JSON.stringify(user.flags);
    await import('../scripts/module.js?foreign-world-bootstrap');
    await Hooks.emit('init'); await Hooks.emit('ready');
    equal(definitions.size, 0);
    assert(root()); assert(!originalVisible());
    equal(settings.get(`${MODULE_ID}.enabled`), false);
    assert(game.modules.get(MODULE_ID).api);
    equal(JSON.stringify(user.flags), flags);
  });
  await test('temporary native return survives refresh and token changes; tool resumes without flag writes', async () => {
    const flags = JSON.stringify(user.flags);
    await click('disable'); assert(!root()); assert(originalVisible());
    await Hooks.emit('updateUser', user); await Hooks.emit('controlToken'); assert(!root());
    const controls = { tokens: { tools: {} } };
    await Hooks.emit('getSceneControlButtons', controls);
    await controls.tokens.tools.bg3VideoHUD.onChange(); await flush();
    assert(root()); assert(!originalVisible());
    equal(JSON.stringify(user.flags), flags);
  });
  await test('a fresh GM client automatically starts again after a previous session pause', async () => {
    await pause(); assert(!root());
    window.dispatchEvent(new Event('beforeunload'));
    handlers.clear(); game.modules.set(MODULE_ID, {}); user.isGM = true;
    await import('../scripts/module.js?fresh-gm-client');
    await Hooks.emit('init'); await Hooks.emit('ready');
    assert(root()); equal(game.modules.get(MODULE_ID).api.status().enabled, true);
    equal(settings.get(`${MODULE_ID}.enabled`), false); equal(definitions.size, 0);
    user.isGM = false;
  });
  await test('automatic activation preserves Foundry and system version guards', async () => {
    const version = game.version, system = { ...game.system };
    for (const unsupported of [{ version: '13.0', system },
      { version, system: { ...system, version: '6.0.5' } },
      { version, system: { ...system, id: 'other' } }]) {
      Object.assign(game, unsupported);
      await enable(); assert(!root()); assert(originalVisible());
      await pause();
    }
    Object.assign(game, { version, system });
  });
  await test('Player OWNER sees HUD; denied ownership produces a safe status and warning without bypass', async () => {
    canvas.tokens.controlled = [{ actor: hero }];
    await enable(); assert(!game.user.isGM); assert(root());
    equal(game.modules.get(MODULE_ID).api.status().reason, 'ready');
    hero.isOwner = false;
    await Hooks.emit('controlToken');
    assert(!root());
    const state = game.modules.get(MODULE_ID).api.status();
    equal(state.reason, 'selected-not-owned'); equal(state.owned, 0);
    assert(notifications.at(-1).includes('OWNER'));
    assert(!JSON.stringify(state).includes(hero.id));
    hero.isOwner = true; await Hooks.emit('controlToken'); assert(root());
    await pause();
  });
} catch (error) { failed++; lines.push(`HARNESS FAILURE: ${error.stack ?? error}`); }
results.textContent = `${lines.join('\n')}\n${passed} passed, ${failed} failed${failed ? `\nFixture notifications: ${JSON.stringify(notifications.slice(-5))}` : ''}`;
results.dataset.status = failed ? 'failed' : 'passed';
results.dataset.count = String(passed + failed);
