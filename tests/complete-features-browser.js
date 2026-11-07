import { VideoHUD } from '../scripts/hud.js';
import { LayoutStore } from '../scripts/persistence.js';
import { actor, item, userWithFlags } from './fixtures.js';
import { descriptionFragment } from '../scripts/ui.js';
import { TargetVisuals } from '../scripts/visuals.js';

export async function completeFeatureBrowserTests({ test, assert, equal, flush }) {
  const user = userWithFlags(), store = new LayoutStore(user), calls = [], errors = [];
  const spell = item('full-spell', 'spell', { identifier: 'fixture-spell', level: 1,
    description: { value: '<p>完整的法术描述 <strong>强调</strong></p>' }, activities: new Map() }, { uuid: 'Actor.full.Item.full-spell', name: '练习祝福' });
  const cast = { id: 'cast', type: 'utility', name: '施放', canUse: true, requiresSpellSlot: true,
    target: { affects: { type: 'self', count: 1 } }, consumption: { spellSlot: true } };
  const hero = actor('full', [spell, item('sword', 'weapon', {}, { name: '长剑 Alpha' }),
    item('bow', 'weapon', {}, { name: '长弓 Beta' }), item('feature', 'feat', {}, { name: '练习特性' })], {
    name: '功能模拟角色', system: { attributes: { hp: { value: 12, max: 20, temp: 3 }, ac: { value: 16 } },
      spells: { spell1: { value: 2, max: 3, level: 1 }, spell3: { value: 1, max: 2, level: 3 } } }
  });
  const nativeUse = async config => { calls.push(config); return { message: { id: 'native' } }; };
  cast.item = spell; cast.actor = hero; cast.use = nativeUse; spell.actor = hero; spell.system.activities.set(cast.id, cast);
  spell.clone = changes => {
    const clone = { ...spell, flags: { dnd5e: { scaling: changes['flags.dnd5e.scaling'] } }, system: { ...spell.system, activities: new Map() } };
    clone.system.activities.set(cast.id, { ...cast, item: clone }); return clone;
  };
  let created = 0;
  hero.createEmbeddedDocuments = async (type, data) => {
    equal(type, 'Item');
    return data.map(raw => {
      const source = { ...raw, id: `source-${++created}`, actor: hero, system: { ...raw.system, activities: new Map() } };
      for (const [id, a] of Object.entries(raw.system.activities)) source.system.activities.set(id,
        { ...a, id, canUse: true, relativeUUID: `.Item.${source.id}.Activity.${id}`, use: nativeUse });
      source.update = async changes => {
        for (const [key, value] of Object.entries(changes)) {
          let path = key.split('.'), target = source;
          while (path.length > 1) {
            const part = path.shift(); target = target instanceof Map ? target.get(part) : (target[part] ??= {});
          }
          target[path[0]] = value;
        }
        return source;
      };
      hero.items.set(source.id, source); return source;
    });
  };
  const hud = new VideoHUD({ store, user, onDisable: () => hud.clear(), onError: text => errors.push(text) });
  const find = (action, extra = '') => hud.choiceDialog?.querySelector(`[data-action="${action}"]${extra}`)
    ?? hud.root?.querySelector(`[data-action="${action}"]${extra}`);
  const click = async (action, extra = '') => {
    const control = find(action, extra); assert(control, `Missing ${action} ${extra}`); control.click(); await flush();
    for (let i = 0; hud.saving && i < 100; i++) await new Promise(r => setTimeout(r, 0));
  };
  const setQuery = async (group, query) => {
    const input = hud.root.querySelector(`[data-query-group="${group}"]`);
    input.focus(); input.value = query; input.setSelectionRange(query.length, query.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true })); await flush();
  };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  hud.setActor(hero);
  try {
    await test('HP bar and graphical slot markers represent real fixture values without writes', async () => {
      const hp = hud.root.querySelector('[role=progressbar]');
      equal(hp.getAttribute('aria-valuenow'), '12'); equal(hp.getAttribute('aria-valuemax'), '20');
      assert(hp.title.includes('临时生命 3'));
      equal(hud.root.querySelectorAll('.bg3-video-hud-slot-pips i.available').length, 3);
      equal(user.writes.length, 0);
    });
    await test('search filters one category, preserves focus/caret and does not mutate item/layout data', async () => {
      await setQuery('Equipment', 'alpha');
      equal([...hud.root.querySelector('[data-group=Equipment]').querySelectorAll('li[data-item-id]')].map(n => n.dataset.itemId), ['sword']);
      assert(hud.root.querySelector('[data-group=Spells] li'));
      equal(document.activeElement.dataset.queryGroup, 'Equipment'); equal(document.activeElement.selectionStart, 5);
      equal(user.writes.length, 0); await setQuery('Equipment', '');
    });
    await test('group bulk editing is a draft; cancel restores layout and saving commits only the user leaf', async () => {
      const original = store.read(hero), writes = user.writes.length;
      await click('edit-group', '[data-value=Equipment]');
      await click('bulk-edit', '[data-value=none]');
      equal(user.writes.length, writes); equal(store.read(hero), original);
      assert(hud.draft.hidden.includes('sword')); assert(!hud.draft.hidden.includes('feature'));
      await click('cancel-edit'); equal(store.read(hero), original);
      await click('edit-group', '[data-value=Equipment]'); await setQuery('Equipment', 'Alpha');
      await click('bulk-edit', '[data-value=none]'); await click('save-edit');
      equal(store.read(hero).hidden, ['sword']); equal(user.writes.length, writes + 1);
      assert(user.writes.at(-1).key.startsWith('layouts.'));
      await click('edit-group', '[data-value=Equipment]'); await click('bulk-edit', '[data-value=reset]');
      await click('save-edit'); await setQuery('Equipment', ''); equal(store.read(hero).hidden, []);
    });
    await test('a concurrent layout edit blocks stale draft overwrite and preserves the other client value', async () => {
      await click('edit'); await click('visibility', '[data-item-id=sword]');
      await store.update(hero, p => ({ ...p, pinned: ['full-spell'] }));
      await click('save-edit');
      assert(hud.edit); assert(errors.at(-1).includes('其他窗口更改'));
      equal(store.read(hero).pinned, ['full-spell']); equal(store.read(hero).hidden, []);
      await click('cancel-edit');
    });
    await test('native rich tooltip keeps formatted description and rejects executable HTML/links', async () => {
      spell.richTooltip = async options => { equal(options.secrets, false); return {
        content: '<p>完整说明 <strong>重点</strong></p><script>window.tooltipInjected=true</script><a href="javascript:alert(1)">危险链接</a><img src=x onerror="window.tooltipInjected=true">'
      }; };
      const use = find('use', '[data-item-id="full-spell"]');
      // Move focus onto the item; refocusing an already focused node emits no
      // focusin event and is not a keyboard-entry interaction.
      find('edit').focus(); use.focus();
      use.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      for (let i = 0; i < 50 && !document.querySelector('.bg3-video-hud-tooltip'); i++) await delay(20);
      const tooltip = document.querySelector('.bg3-video-hud-tooltip');
      assert(tooltip, JSON.stringify({ active: document.activeElement?.dataset, edit: hud.edit,
        busy: [...hud.busy], connected: use.isConnected, generation: hud.tooltip.generation }));
      equal(tooltip.querySelector('strong').textContent, spell.name); assert(tooltip.textContent.includes('完整说明'));
      assert(!tooltip.querySelector('script,img,[onclick],[onerror],a[href^="javascript:"]')); assert(!window.tooltipInjected);
      const before = user.writes.length;
      hud.render(); await flush(); equal(user.writes.length, before); assert(hud.root.isConnected);
      hud.tooltip.hide(); assert(!use.hasAttribute('aria-describedby'));
      const fragment = descriptionFragment('<iframe src="https://example.com"></iframe><b>保留</b>');
      equal(fragment.textContent, '保留');
    });
    await test('single-activity attacks and cantrips skip redundant HUD confirmations', async () => {
      const simple = item('quick-attack', 'weapon', { activities: new Map() });
      const attack = { id: 'quick-activity', type: 'attack', canUse: true, use: async () => assert(false) };
      simple.system.activities.set(attack.id, attack);
      const choice = await hud.chooseUse(hero, simple);
      equal(choice.activityId, attack.id); equal(choice.nativeOnly, false); assert(!hud.pendingUse);
      let quickCalls = 0;
      const cantrip = item('quick-cantrip', 'spell', { level: 0, activities: new Map() }, { actor: hero });
      const activity = { id: 'quick-cast', type: 'utility', canUse: true, actor: hero, item: cantrip,
        target: { affects: { type: 'self' } }, use: async () => { quickCalls++; return { official: true }; } };
      cantrip.system.activities.set(activity.id, activity); hero.items.set(cantrip.id, cantrip); hud.render();
      try { await click('use', '[data-item-id="quick-cantrip"]'); equal(quickCalls, 1); assert(!hud.pendingUse); }
      finally { hero.items.delete(cantrip.id); hud.render(); }
      equal(calls.length, 0); equal(hero.system.spells.spell1.value, 2);
    });
    await test('leveled spells retain source/slot choice; Escape cancels before native use', async () => {
      await click('use', '[data-item-id="full-spell"]');
      equal(hud.pendingUse.phase, 'casting'); assert(!find('choose-activity'));
      assert(find('choose-cast', '[data-slot=spell3]')); equal(calls.length, 0);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush();
      assert(!hud.pendingUse); equal(calls.length, 0); assert(!hud.busy.size);
    });
    await test('ambiguous activities remain explicit; detailed mode and allocation cancel stay accessible', async () => {
      const multi = item('multi-activity', 'weapon', { activities: new Map([
        ['one', { id: 'one', canUse: true, use() {} }], ['two', { id: 'two', canUse: true, use() {} }]
      ]) });
      const pending = hud.chooseUse(hero, multi); assert(find('choose-activity', '[data-value=two]'));
      // Escape must remain available to an unrelated native/application dialog.
      const native = document.createElement('div'); native.setAttribute('role', 'dialog'); document.body.append(native);
      native.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(hud.pendingUse); native.remove();
      await click('close-choice'); equal(await pending, null);
      const before = user.writes.length;
      await click('detailed'); equal(find('detailed').getAttribute('aria-pressed'), 'true');
      const detail = hud.chooseUse(hero, spell); equal(hud.pendingUse.phase, 'activity');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); equal(await detail, null);
      const allocation = hud.allocate({ item: spell, selected: [{ id: 'target', name: 'Fixture target' }], count: 2, consumed: true });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); equal(await allocation, null);
      assert(!hud.pendingAllocation); equal(calls.length, 0); equal(user.writes.length, before);
      await click('detailed'); equal(hud.detailed, false);
    });
    await test('activity and cast-level inline panels preserve return/cancel and pass native slot options', async () => {
      await click('detailed');
      await click('use', '[data-item-id="full-spell"]'); equal(calls.length, 0);
      assert(find('choose-activity')); await click('choose-activity', '[data-value=cast]');
      assert(find('choose-cast', '[data-slot=spell3]')); await click('back-choice'); equal(calls.length, 0);
      await click('choose-activity', '[data-value=cast]'); await click('choose-cast', '[data-slot=spell3]');
      equal(calls.length, 1); equal(calls[0].spell.slot, 'spell3'); equal(calls[0].scaling, 2);
      equal(hero.system.spells.spell3.value, 1); // The HUD never performed a fabricated debit.
      await click('use', '[data-item-id="full-spell"]'); await click('close-choice'); equal(calls.length, 1);
    });
    await test('source editor explicitly creates native charges, edits marked sources and delegates a free use', async () => {
      await click('use', '[data-item-id="full-spell"]'); await click('choose-activity', '[data-value=cast]');
      await click('source-manager');
      const dialog = hud.dialog, form = dialog.querySelector('form');
      form.querySelector('[name=name]').value = '模拟来源'; form.querySelector('[name=max]').value = '2';
      form.querySelector('[name=remaining]').value = '1';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
      equal(created, 1); const source = hero.items.get('source-1');
      equal(source.system.uses.spent, 1); equal(source.system.uses.recovery[0].period, 'lr');
      equal(spell.system.level, 1); equal(source.flags['bg3-video-hud'].castingSource.spell, spell.uuid);
      await click('choose-cast', '[data-source-id=source-1]');
      equal(calls.length, 2); equal(calls.at(-1).consume.spellSlot, false);
      assert(calls.at(-1).cause.activity.includes('source-1')); equal(source.system.uses.spent, 1);
      await click('use', '[data-item-id="full-spell"]'); await click('choose-activity', '[data-value=cast]'); await click('source-manager');
      const selector = hud.dialog.querySelector('select'); selector.value = 'source-1'; selector.dispatchEvent(new Event('change'));
      const enabled = hud.dialog.querySelector('input[type=checkbox]'); enabled.checked = false;
      hud.dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
      equal(source.flags['bg3-video-hud'].castingSource.enabled, false); assert(find('choose-cast', '[data-source-id=source-1]').disabled);
      await click('close-choice');
    });
    await test('normal attacks have a coordinated entry and native-only use bypasses custom repetition validation', async () => {
      const weapon = hero.items.get('bow');
      const activity = { id: 'weapon-attack', type: 'attack', canUse: true, name: '攻击',
        item: weapon, use: nativeUse, rollAttack: async () => [], rollDamage: async () => [],
        target: { affects: { type: 'creature', count: 1 } } };
      weapon.system.activities = new Map([[activity.id, activity]]);
      let promise = hud.chooseUse(hero, weapon);
      await click('choose-activity', '[data-value=weapon-attack]');
      const entry = [...hud.choiceDialog.querySelectorAll('[data-action=choose-cast]')].find(n => n.textContent === '使用并结算');
      assert(entry); hud.pendingUse.count = '999'; entry.click(); await flush();
      assert(hud.choiceDialog.querySelector('[role=alert]')); assert(hud.pendingUse);
      hud.pendingUse.count = ''; find('choose-cast').click(); await flush(); assert(!(await promise).nativeOnly);
      promise = hud.chooseUse(hero, weapon);
      await click('choose-activity', '[data-value=weapon-attack]'); hud.pendingUse.count = '999';
      await click('choose-cast', '[data-native-only=true]'); assert((await promise).nativeOnly);
    });
    await test('manual allocation supports repeated targets, undo and exact confirmation without consuming', async () => {
      const one = { id: 'one', document: { name: '目标甲' } }, two = { id: 'two', document: { name: '目标乙' } };
      const before = calls.length; const promise = hud.allocate({ item: spell, selected: [one, two], count: 3, consumed: false });
      await click('allocate-plus', '[data-value=one]'); await click('allocate-plus', '[data-value=one]');
      await click('allocate-plus', '[data-value=two]'); assert(!find('allocate-confirm').disabled);
      await click('allocate-undo'); assert(find('allocate-confirm').disabled);
      await click('allocate-plus', '[data-value=one]'); await click('allocate-confirm');
      equal((await promise).map(t => t.id), ['one', 'one', 'one']); equal(calls.length, before);
    });
    await test('party and integration dialogs are keyboard-dismissable and expose only permitted characters', async () => {
      const originalUsers = game.users;
      const secret = actor('secret-party', [], { isOwner: false, name: '不可见角色', testUserPermission: () => false });
      game.users = [{ character: hero }, { character: hero }, { character: secret }];
      try {
        await click('party'); assert(hud.dialog.textContent.includes(hero.name)); assert(!hud.dialog.textContent.includes(secret.name));
        hud.dialog.close(); await delay(0);
        await click('integrations'); assert(hud.dialog.textContent.includes('3D 骰子')); assert(hud.dialog.textContent.includes('未启用'));
        hud.dialog.dispatchEvent(new Event('cancel', { cancelable: true })); hud.dialog.close(); await delay(0);
      } finally { game.users = originalUsers; }
    });
    await test('repeated arrow ordering follows the current unsaved draft and cancel discards every move', async () => {
      hero.items.set('third-weapon', item('third-weapon', 'weapon', {}, { name: '第三武器' }));
      const original = store.read(hero), before = user.writes.length;
      await click('edit-group', '[data-value=Equipment]');
      const order = () => [...hud.root.querySelectorAll('[data-group=Equipment] li[data-item-id]')].map(n => n.dataset.itemId);
      const first = order()[0];
      await click('move', `[data-item-id="${first}"][data-direction="1"]`);
      await click('move', `[data-item-id="${first}"][data-direction="1"]`);
      equal(order().at(-1), first); equal(user.writes.length, before);
      await click('cancel-edit'); equal(store.read(hero), original); hero.items.delete('third-weapon'); hud.render();
    });
    await test('aim graphics project scene points to CSS pixels and protect non-observer target statistics', async () => {
      const oldBoard = document.getElementById('board'); if (oldBoard) oldBoard.id = 'fixture-old-board';
      const board = document.createElement('canvas'); board.id = 'board';
      board.style.cssText = 'position:fixed;left:10px;top:20px;width:200px;height:100px'; document.body.append(board);
      const origin = { center: { x: 10, y: 5 } }, canvas = { app: { screen: { width: 100, height: 50 } },
        stage: { worldTransform: { apply: p => ({ x: p.x * 2, y: p.y * 2 }) } } };
      const target = { name: '可见目标', actor: { testUserPermission: () => false,
        system: { attributes: { hp: { value: 197, max: 999 }, ac: { value: 27 } } } } };
      const visuals = new TargetVisuals({ user, getOrigin: () => origin, getCanvas: () => canvas });
      try {
        const start = visuals.project(origin.center); equal(start, { x: 50, y: 40 });
        visuals.preview({ item: {} }, { x: 150, y: 90 }, target, '2/3');
        const line = visuals.root.querySelector('line'); equal(line.getAttribute('x1'), '50'); equal(line.getAttribute('y2'), '90');
        assert(visuals.root.textContent.includes('命中率：未知')); assert(!visuals.root.textContent.includes('197'));
        assert(visuals.root.querySelector('.bg3-video-hud-aim-count').textContent === '2/3');
        visuals.stop(); assert(!visuals.root);
      } finally { visuals.destroy(); board.remove(); if (oldBoard) oldBoard.id = 'board'; }
    });
    await test('fallback VFX yields to installed animation modules and cleans its own effects', async () => {
      const previous = game.modules;
      const visuals = new TargetVisuals({ user, getOrigin: () => ({ center: { x: 1, y: 1 } }) });
      visuals.project = point => point;
      try {
        game.modules = new Map([['autoanimations', { active: true }]]);
        visuals.pulse([{ center: { x: 20, y: 20 } }]); equal(visuals.effects.size, 0);
        game.modules = new Map(); visuals.pulse([{ center: { x: 20, y: 20 } }]);
        equal(visuals.effects.size, 2); visuals.destroy(); equal(visuals.effects.size, 0);
        assert(!document.querySelector('.bg3-video-hud-projectile,.bg3-video-hud-impact'));
      } finally { visuals.destroy(); game.modules = previous; }
    });
  } finally { hud.destroy(); }
}
