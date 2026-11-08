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
    await test('transparent icons hide background initials while preserving bottom names; failures restore fallback and accessible names', async () => {
      const entry = gear[0], writes = user.writes.length;
      entry.img = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><path d="M0 0L80 40" stroke="red"/></svg>');
      try {
        hud.render();
        const use = hud.root.querySelector(`[data-action="use"][data-item-id="${entry.id}"]`);
        const initial = use.querySelector('.bg3-video-hud-item-initial'), label = use.querySelector('.bg3-video-hud-item-label');
        equal(getComputedStyle(initial).display, 'none'); assert(getComputedStyle(label).display !== 'none');
        assert(label.getBoundingClientRect().height > 0); equal(label.textContent, entry.name);
        assert(use.getAttribute('aria-label').includes(entry.name)); assert(use.title.includes(entry.name));
        const box = use.getBoundingClientRect(), image = use.querySelector('img').getBoundingClientRect();
        assert(Math.abs(box.width - box.height) < .6); assert(Math.abs(image.width - image.height) < .6);
        equal(getComputedStyle(use.querySelector('img')).objectFit, 'contain');
        use.focus(); use.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await flush();
        await new Promise(resolve => setTimeout(resolve, 150));
        assert(document.activeElement === use); assert(hud.tooltip.root?.textContent.includes(entry.name));
        equal(use.getAttribute('aria-describedby'), 'bg3-video-hud-tooltip');
        assert(getComputedStyle(use.querySelector('.bg3-video-hud-item-badge')).display !== 'none');
        use.querySelector('img').dispatchEvent(new Event('error'));
        assert(getComputedStyle(initial).display !== 'none'); assert(getComputedStyle(label).display !== 'none');
        equal(user.writes.length, writes);
      } finally { delete entry.img; hud.tooltip.hide(); hud.render(); }
    });
    await test('automatic widths follow actor counts while total width stays fixed for sparse content, inventory updates and filters without writes', async () => {
      const make = (id, itemCount, spellCount) => actor(id, [item('weapon', 'weapon'), item('feature', 'feat'),
        ...Array.from({ length: itemCount }, (_, i) => item(`item-${i}`, 'consumable', { activation: { type: 'action' } })),
        ...Array.from({ length: spellCount }, (_, i) => item(`spell-${i}`, 'spell', { level: i % 2 }))]);
      const sizes = () => [...hud.root.querySelectorAll('.bg3-video-hud-panel')].map(el => el.getBoundingClientRect().width);
      const writes = user.writes.length, flags = JSON.stringify(user.flags);
      try {
        hud.setActor(make('many-items', 30, 1));
        let widths = sizes(); assert(widths[1] > widths[0] && widths[1] > widths[3]);
        const crowdedWidth = hud.root.getBoundingClientRect().width;
        hud.setActor(make('few-items', 1, 1)); assert(Math.abs(hud.root.getBoundingClientRect().width - crowdedWidth) < .6);
        hud.setActor(actor('empty-character', []));
        assert(Math.abs(hud.root.getBoundingClientRect().width - crowdedWidth) < .6);
        assert(sizes().every(width => width > 0));
        hud.setActor(make('many-spells', 1, 30));
        widths = sizes(); assert(widths[3] > widths[1] && widths[3] > widths[0]);
        assert(Math.abs(hud.root.getBoundingClientRect().width - crowdedWidth) < .6);
        hud.level = 1; hud.action = 'bonus'; hud.queries.Items = 'no match'; hud.render();
        sizes().forEach((width, i) => assert(Math.abs(width - widths[i]) < .6));
        // A live inventory change in the same actor must grow the appropriate group.
        hud.level = 'all'; hud.action = 'all'; hud.queries = {};
        const previous = widths[1];
        for (let i = 1; i <= 60; i++) hud.actor.items.set(`new-${i}`, item(`new-${i}`, 'consumable', { activation: { type: 'action' } }));
        hud.render(); assert(sizes()[1] > previous);
        assert(Math.abs(hud.root.getBoundingClientRect().width - crowdedWidth) < .6);
        equal(user.writes.length, writes); equal(JSON.stringify(user.flags), flags);
      } finally { hud.setActor(hero, token); }
    });
    await test('three-item groups keep two actual square icon columns with many spells and a narrow sidebar budget', async () => {
      const entries = [
        ...Array.from({ length: 3 }, (_, i) => item(`w-${i}`, 'weapon')),
        ...Array.from({ length: 3 }, (_, i) => item(`i-${i}`, 'consumable', { activation: { type: 'action' } })),
        ...Array.from({ length: 3 }, (_, i) => item(`f-${i}`, 'feat')),
        ...Array.from({ length: 100 }, (_, i) => item(`s-${i}`, 'spell'))];
      const sidebar = document.createElement('aside'); sidebar.id = 'sidebar';
      sidebar.style.cssText = `position:fixed;right:0;top:0;bottom:0;width:${innerWidth * .4}px`;
      try {
        hud.setActor(actor('minimum-cols', entries));
        for (const narrow of [false, true]) {
          if (narrow) document.body.append(sidebar);
          hud.render();
          for (const list of hud.root.querySelectorAll('.bg3-video-hud-items')) {
            const cards = [...list.querySelectorAll('.bg3-video-hud-use')];
            const first = cards[0].getBoundingClientRect(), second = cards[1].getBoundingClientRect();
            assert(Math.abs(first.top - second.top) < 1, 'First two icons must share a row');
            assert(second.left > first.right && second.right <= list.getBoundingClientRect().right + 1);
            assert(Math.abs(first.width - first.height) < .6);
          }
        }
      } finally { sidebar.remove(); hud.setActor(hero, token); }
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
      assert(after[0] > before[0], JSON.stringify({ before, after, prefs: store.read(hero), root: hud.root.getBoundingClientRect().toJSON() })); assert(after[1] < before[1]); assert(Math.abs(after[2] - before[2]) < 1);
      equal(store.read(hero).hidden, ['gear2']);
      hud.root.querySelector('[data-divider="0"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await flush(); equal(store.read(hero).ratios, undefined); equal(store.read(hero).columnSizing, undefined); equal(store.read(hero).hidden, ['gear2']);
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
