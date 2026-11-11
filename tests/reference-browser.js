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
    await test('portrait ring replaces footer, shows active temporary conditions with full names, and switches with the selected token', async () => {
      const icon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="gold"/></svg>');
      const candidate = actor('conditions', [], { temporaryEffects: [
        { id: 'a', name: '中毒', img: icon, statuses: new Set(['poisoned']) },
        { id: 'b', name: '专注', img: icon },
        { id: 'off', name: '停用效果', img: icon, disabled: true }
      ], statuses: new Set(['poisoned']) });
      const before = structuredClone(candidate), writes = user.writes.length;
      try {
        hud.setActor(candidate, { id: 'first' });
        assert(!hud.root.querySelector('footer')); assert(!hud.root.querySelector('[data-action=edit]'));
        let badges = [...hud.root.querySelectorAll('.bg3-video-hud-condition')];
        equal(badges.map(b => b.title), ['中毒', '专注']);
        const centres = badges.map(b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        const wrapBox = hud.root.querySelector('.bg3-video-hud-portrait-wrap').getBoundingClientRect();
        assert(centres.every(c => c.y < wrapBox.y + wrapBox.height / 2));
        assert(Math.hypot(centres[0].x - centres[1].x, centres[0].y - centres[1].y) < wrapBox.width * .28);
        equal(badges.map(b => b.tabIndex), [0, 0]);
        const box = hud.root.querySelector('.bg3-video-hud-portrait-wrap').getBoundingClientRect();
        for (const badge of badges) {
          const b = badge.getBoundingClientRect();
          assert(b.width > 0 && b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1);
          equal(badge.getAttribute('aria-label'), badge.title);
        }
        badges[0].querySelector('img').dispatchEvent(new Event('error')); equal(badges[0].textContent, '?'); equal(badges[0].title, '中毒');
        hud.setActor(candidate, { id: 'second', document: { overlayEffect: icon + '#second' } });
        equal(hud.root.querySelectorAll('.bg3-video-hud-condition').length, 3);
        hud.setActor(actor('empty-conditions', [])); equal(hud.root.querySelectorAll('.bg3-video-hud-condition').length, 0);
        equal(JSON.stringify(candidate), JSON.stringify(before)); equal(user.writes.length, writes);
      } finally { hud.setActor(hero, token); }
    });
    await test('condition overflow opens a readable full list with no More button, menu or replacement action strip', async () => {
      const candidate = actor('many-conditions', [], { temporaryEffects: Array.from({ length: 18 }, (_, i) => ({ id: `c-${i}`, name: `状态${i}`, statuses: new Set([`c-${i}`]) })) });
      const writes = user.writes.length;
      try {
        hud.setActor(candidate);
        equal(hud.root.querySelectorAll('.bg3-video-hud-condition').length, 10);
        const overflow = hud.root.querySelector('[data-action=conditions]'); equal(overflow.textContent, '+9');
        overflow.click(); await flush(); equal(hud.dialog.querySelectorAll('.bg3-video-hud-condition-list li').length, 18);
        assert(!hud.root.querySelector('[data-action=more]')); equal(typeof hud.openMore, 'undefined');
        for (const action of ['edit', 'disable', 'party', 'integrations', 'detailed']) assert(!hud.root.querySelector(`[data-action=${action}]`));
        hud.dialog.close(); await flush(); equal(user.writes.length, writes); assert(!hud.root.querySelector('footer'));
      } finally { hud.detailed = false; hud.setActor(hero, token); }
    });
    await test('NPC spell grids, counts, levels and editors honor native hidden and cached spellbook visibility without deleting sources', async () => {
      const normal = Array.from({ length: 3 }, (_, i) => item(`real-${i}`, 'spell', { level: 3 }, { name: `模拟法术${i}` }));
      const shadows = normal.map((s, i) => item(`hidden-${i}`, 'spell', { level: 3 }, { name: s.name, isHidden: true }));
      const internal = item('internal', 'spell', { level: 9, linkedActivity: { displayInSpellbook: false } }, { flags: { dnd5e: { cachedFor: 'Item.source.Activity.internal' } } });
      const cached = item('cached', 'spell', { level: 3, linkedActivity: { displayInSpellbook: true } }, { name: normal[0].name, flags: { dnd5e: { cachedFor: 'Item.source.Activity.book' } } });
      const hiddenByActor = item('actor-hidden', 'spell', { level: 9 });
      const candidate = actor('native-npc', [...normal, ...shadows, internal, cached, hiddenByActor],
        { type: 'npc', hiddenItems: new Set(['actor-hidden']) });
      const before = JSON.stringify([...candidate.items]), writes = user.writes.length;
      const expected = ['cached', 'real-0', 'real-1', 'real-2'];
      try {
        hud.setActor(candidate);
        const list = hud.root.querySelector('[data-group=Spells] .bg3-video-hud-items');
        equal([...list.children].map(row => row.dataset.itemId).sort(), expected);
        equal(hud.columnCounts[3], 4);
        assert(!hud.root.querySelector('[data-action=filter-level][data-value="9"]'));
        equal(hud.root.querySelector('[data-action=filter-level][data-value="3"] .bg3-video-hud-level-pips').textContent, '4');
        // A deliberately visible native cache keeps its own source and ID,
        // even when another genuine spell shares its name.
        assert(list.querySelector('[data-item-id=cached]') && list.querySelector('[data-item-id=real-0]'));
        hud.beginEdit('Spells');
        equal([...hud.editorDialog.querySelectorAll('[data-action=visibility]')].map(el => el.dataset.itemId).sort(), expected);
        hud.bulkEdit('none'); await flush(); equal([...hud.draft.hidden].sort(), expected);
        hud.editorDialog.querySelector('[data-action=cancel-edit]').click(); await flush();
        equal(JSON.stringify([...candidate.items]), before); equal(user.writes.length, writes);
      } finally { hud.setActor(hero, token); }
    });
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
    await test('full-width allocation fills actual grid tracks without fractional right strips for screenshot counts, sparse actors and narrow sidebars', async () => {
      const make = counts => actor('full-grid', counts.flatMap((count, group) => Array.from({ length: count }, (_, i) =>
        item(`g${group}-${i}`, ['weapon', 'consumable', 'feat', 'spell'][group], { activation: { type: 'action' } }))));
      const sidebar = document.createElement('aside'); sidebar.id = 'sidebar';
      sidebar.style.cssText = `position:fixed;right:0;top:0;bottom:0;width:${innerWidth * .4}px`;
      const writes = user.writes.length;
      try {
        for (const narrow of [false, true]) {
          if (narrow) document.body.append(sidebar);
          let total;
          for (const counts of [[3, 16, 3, 3], [0, 1, 2, 1], [0, 0, 0, 0], [3, 100, 3, 3]]) {
            hud.setActor(make(counts));
            const width = hud.root.getBoundingClientRect().width;
            if (total !== undefined) assert(Math.abs(total - width) < .6); total = width;
            const tileWidths = [];
            for (const [i, list] of [...hud.root.querySelectorAll('.bg3-video-hud-items')].entries()) {
              const css = getComputedStyle(list), cols = css.gridTemplateColumns.split(' ').map(parseFloat);
              const tail = list.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
                - cols.reduce((sum, n) => sum + n, 0) - (cols.length - 1) * parseFloat(css.columnGap);
              assert(Math.abs(tail) < 1, `No fractional blank strip: group ${i}, tail ${tail}`);
              assert(cols.length >= (counts[i] >= 3 ? 2 : 1));
              for (const use of list.querySelectorAll('.bg3-video-hud-use')) {
                const box = use.getBoundingClientRect();
                tileWidths.push(box.width);
                assert(Math.abs(box.width - box.height) < .6 && Math.abs(box.width - cols[0]) < .2);
              }
            }
            if (tileWidths.length) assert(Math.max(...tileWidths) - Math.min(...tileWidths) < .6, 'Shared square tile size across all categories');
          }
        }
        equal(user.writes.length, writes);
      } finally { sidebar.remove(); hud.setActor(hero, token); }
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
