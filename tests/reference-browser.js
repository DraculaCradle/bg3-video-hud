import { VideoHUD } from '../scripts/hud.js';
import { LayoutStore } from '../scripts/persistence.js';
import { actor, item, userWithFlags } from './fixtures.js';

export async function referenceBrowserTests({ test, assert, equal, flush }) {
  const user = userWithFlags(), store = new LayoutStore(user), errors = [];
  const gear = Array.from({ length: 30 }, (_, i) => item(`gear${i}`, 'weapon', {}, { name: `测试装备 ${i}` }));
  const hero = actor('reference', gear, { system: { attributes: { hp: { value: 12, max: 20, temp: 3 }, ac: { value: 14 } } } });
  const hud = new VideoHUD({ user, store, onDisable: () => hud.clear(), onError: e => errors.push(e) });
  const token = { id: 'own-token' }, previousCombat = game.combat;
  const delay = () => new Promise(resolve => setTimeout(resolve, 0));
  hud.setActor(hero, token);
  try {
    await test('character records and passive items are absent from all four HUD groups and editors; bulk counts and draft edits include only combat items', async () => {
      const records = ['class', 'subclass', 'background', 'race', 'species', 'facility'].map(type => item(`record-${type}`, type));
      const combat = [item('blade', 'weapon'), item('potion', 'consumable', { activation: { type: 'action' } }), item('racial-action', 'feat'),
        item('background-active', 'feat'), item('spell', 'spell')];
      const passive = [item('armor', 'equipment'), item('shield', 'equipment'), item('gem', 'loot'),
        item('paper', 'loot'), item('passive-feat', 'feat', { activation: { type: '' } }),
        item('ammo', 'consumable', { type: { value: 'ammo' }, activation: { type: 'action' } })];
      const candidate = actor('taxonomy', [...records, ...passive, ...combat]);
      const before = JSON.stringify([...candidate.items.values()]), writes = user.writes.length;
      try {
        hud.setActor(candidate);
        for (const record of [...records, ...passive]) assert(!hud.root.querySelector(`[data-item-id="${record.id}"]`));
        for (const entry of combat) assert(hud.root.querySelector(`[data-item-id="${entry.id}"]`));
        hud.beginEdit('Weapons'); assert(hud.editorDialog.open);
        for (const record of records) assert(!hud.editorDialog.querySelector(`[data-item-id="${record.id}"]`));
        hud.bulkEdit('none'); await flush(); equal([...hud.draft.hidden].sort(), ['blade']);
        hud.editorDialog.querySelector('[data-action=cancel-edit]').click(); await flush();
        hud.beginEdit('Items');
        assert(hud.editorDialog.querySelector('[data-item-id=potion]'));
        for (const entry of passive) assert(!hud.editorDialog.querySelector(`[data-item-id="${entry.id}"]`));
        hud.bulkEdit('none'); await flush(); equal(hud.draft.hidden, ['potion']);
        hud.editorDialog.querySelector('[data-action=cancel-edit]').click(); await flush();
        hud.beginEdit(); assert(hud.root.textContent.includes('已显示 5/5'));
        hud.bulkEdit('none'); await flush(); equal(hud.draft.hidden.length, 5);
        for (const record of records) assert(!hud.draft.hidden.includes(record.id));
        equal(JSON.stringify([...candidate.items.values()]), before); equal(user.writes.length, writes);
      } finally { hud.setActor(hero, token); }
    });
    await test('reference structure separates portrait, four framed decks and circular native action controls', async () => {
      assert(hud.root.querySelector('.bg3-video-hud-end .bg3-video-hud-turn'));
      equal(hud.root.querySelectorAll('.bg3-video-hud-panel').length, 4);
      equal(hud.root.querySelectorAll('[role=separator]').length, 3);
      equal(getComputedStyle(hud.root).backgroundColor, 'rgba(0, 0, 0, 0)');
      const bar = hud.root.querySelector('.bg3-video-hud-health');
      assert(parseFloat(bar.style.getPropertyValue('--hp')) + parseFloat(bar.style.getPropertyValue('--temp')) <= 100);
      assert(hud.root.querySelector('.bg3-video-hud-vitals').textContent.includes('AC 14'));
    });
    await test('column keyboard resizing persists only own layout and resets without dropping hidden IDs', async () => {
      await store.update(hero, p => ({ ...p, hidden: ['gear2'] })); hud.render();
      const before = [...hud.root.querySelectorAll('.bg3-video-hud-panel')].map(e => e.getBoundingClientRect().width);
      hud.root.querySelector('[data-divider="0"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await flush(); await delay();
      const after = [...hud.root.querySelectorAll('.bg3-video-hud-panel')].map(e => e.getBoundingClientRect().width);
      assert(after[0] > before[0]); assert(after[1] < before[1]); assert(Math.abs(after[2] - before[2]) < 1);
      equal(store.read(hero).hidden, ['gear2']);
      hud.root.querySelector('[data-divider="0"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await flush(); equal(store.read(hero).ratios, [2, 2, 3, 5]); equal(store.read(hero).hidden, ['gear2']);
    });
    await test('group editor is a separate scrollable popup; cancel and actor change discard draft', async () => {
      const before = user.writes.length; hud.beginEdit('Weapons');
      assert(hud.editorDialog.open); assert(!hud.root.contains(hud.editorDialog));
      hud.editorDialog.querySelector('[data-action=visibility]').click(); await flush(); assert(hud.draft.hidden.length > 1);
      hud.editorDialog.close(); await delay(); assert(!hud.edit); equal(user.writes.length, before);
      hud.beginEdit('Weapons'); hud.setActor(hero, { id: 'other-token' }); await delay();
      assert(!hud.editorDialog); assert(!hud.edit); equal(user.writes.length, before); hud.setActor(hero, token);
    });
    await test('end turn cannot double advance or operate another token and native failure releases button', async () => {
      let finish, calls = 0;
      game.combat = { started: true, combatant: { actor: hero, tokenId: token.id, isOwner: true },
        nextTurn: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
      hud.render(); const button = hud.root.querySelector('[data-action=end-turn]'); button.click(); button.click(); await flush();
      equal(calls, 1); assert(hud.root.querySelector('[data-action=end-turn]').disabled); finish(); await flush();
      hud.setActor(hero, { id: 'other-token' }); assert(hud.root.querySelector('[data-action=end-turn]').disabled);
      hud.setActor(hero, token); game.combat.nextTurn = async () => { throw Error('native refused'); };
      hud.root.querySelector('[data-action=end-turn]').click(); await flush(); equal(errors.at(-1), 'native refused'); assert(!hud.busy.size);
    });
    await test('reaction resource modal returns explicit choice and cancels on scene/actor loss without native calls', async () => {
      const spell = item('shield', 'spell', { level: 1 });
      const sources = [{ item: { id: 'source', name: '反应来源' }, level: 1, remaining: 2, max: 3 }];
      const pending = hud.chooseReactionSource(spell, sources); assert(hud.reactionDialog.open);
      hud.reactionDialog.querySelector('[data-action=reaction-source]').click(); equal(await pending, 'source');
      const cancel = hud.chooseReactionSource(spell, sources); hud.setActor(null); equal(await cancel, null);
      hud.setActor(hero, token);
    });
    await test('source manager requires explicit delete confirmation and only deletes selected managed source', async () => {
      const spell = item('spell', 'spell', { level: 1, activities: new Map() }, { uuid: `${hero.uuid}.Item.spell`, actor: hero });
      const activity = { id: 'cast', canUse: true, type: 'utility', use() {}, consumption: { spellSlot: true } };
      spell.system.activities.set('cast', activity); hero.items.set(spell.id, spell);
      let deletes = 0;
      const source = item('managed', 'feat', { uses: { max: 1, spent: 0 }, activities: new Map([['bg3sourcecast001', {
        type: 'cast', canUse: true, spell: { uuid: spell.uuid, level: 1 }
      }]]) }, { flags: { 'bg3-video-hud': { castingSource: { spell: spell.uuid } } }, delete: async () => { deletes++; hero.items.delete('managed'); } });
      hero.items.set(source.id, source); void hud.chooseUse(hero, spell); hud.sourceManager();
      const select = hud.dialog.querySelector('select'); select.value = source.id; select.dispatchEvent(new Event('change'));
      hud.dialog.querySelector('[data-action=delete-source]').click(); equal(deletes, 0);
      document.querySelector('[data-action=cancel-delete-source]').click(); await delay(); equal(deletes, 0);
      hud.dialog.querySelector('[data-action=delete-source]').click();
      const confirm = document.querySelector('[data-action=confirm-delete-source]'); confirm.click(); confirm.click(); await flush();
      equal(deletes, 1); assert(hero.items.has('spell')); hud.closeChoice();
    });
  } finally { hud.destroy(); game.combat = previousCombat; }
}
