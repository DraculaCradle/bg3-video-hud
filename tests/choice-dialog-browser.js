import { VideoHUD } from '../scripts/hud.js';
import { LayoutStore } from '../scripts/persistence.js';
import { actor, item, userWithFlags } from './fixtures.js';

// Original synthetic data; no Foundry connection, rulebook or player document.
export function createChoiceDialogFixture() {
  const user = userWithFlags();
  const spell = item('dialog-spell', 'spell', { level: 1, activities: new Map() }, {
    uuid: 'Actor.dialog-fixture.Item.dialog-spell', name: '弹窗模拟法术 Long spell name'
  });
  const weapon = item('dialog-weapon', 'weapon', { activities: new Map() });
  const hero = actor('dialog-fixture', [spell, weapon], { system: {
    spells: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 2, max: 3, level: i + 1 }]))
  } });
  const use = () => { throw Error('Layout fixture must not invoke a native workflow'); };
  const cast = { id: 'cast', type: 'utility', canUse: true, requiresSpellSlot: true, item: spell, actor: hero, use };
  spell.actor = hero; spell.system.activities.set(cast.id, cast);
  for (let i = 0; i < 50; i++) {
    const source = item(`source-${i}`, 'feat', { uses: { max: 2, spent: 0 }, activities: new Map([
      ['source-cast', { type: 'cast', spell: { uuid: spell.uuid, level: 1 }, canUse: true }]
    ]) }, { name: `模拟来源 ${i} ${'LongName'.repeat(8)}` });
    hero.items.set(source.id, source);
    weapon.system.activities.set(`activity-${i}`, { id: `activity-${i}`, type: 'utility', canUse: true, use,
      name: `模拟活动 ${i} ${'Name'.repeat(14)}` });
  }
  const hud = new VideoHUD({ store: new LayoutStore(user), user, onDisable: () => hud.clear(), onError: () => {} });
  let attempt;
  const box = element => {
    const r = element?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
  };
  return {
    start(kind) {
      hud.clear(); hud.setActor(hero); hud.detailed = kind === 'activity';
      attempt = { result: 'waiting', dock: box(hud.root) };
      const current = attempt;
      const promise = kind === 'allocation' ? hud.allocate({ item: spell, count: 3, consumed: false,
        selected: Array.from({ length: 50 }, (_, i) => ({ id: `target-${i}`, name: `目标 ${i} ${'LongName'.repeat(10)}` })) })
        : hud.chooseUse(hero, kind === 'activity' ? weapon : spell);
      promise.then(value => { current.result = value ? 'accepted' : 'cancelled'; current.closedAtResolution = !hud.choiceDialog?.open; });
    },
    refresh: () => hud.render(),
    closeAndRefresh() { hud.choiceDialog.close(); hud.render(); },
    switchActor: () => hud.setActor(actor('another-fixture')),
    switchToken: () => hud.setActor(hero, { id: 'another-token' }),
    revealLast() { hud.choiceDialog?.querySelector('.bg3-video-hud-choice-body')?.lastElementChild?.lastElementChild?.scrollIntoView({ block: 'end' }); },
    snapshot() {
      const dialog = hud.choiceDialog, body = dialog?.querySelector('.bg3-video-hud-choice-body');
      return { ...attempt, dockNow: box(hud.root), open: !!dialog?.open, dialog: box(dialog), body: box(body),
        bodyScrollTop: body?.scrollTop, bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0,
        outsideHUD: dialog ? !hud.root.contains(dialog) : null,
        hudContainsChoices: !!hud.root?.querySelector('.bg3-video-hud-choice'),
        activeInside: dialog?.contains(document.activeElement) ?? false,
        focusedItem: document.activeElement?.dataset?.itemId,
        activeBox: box(document.activeElement),
        childDialog: !!hud.dialog?.open, writes: user.writes.length };
    },
    dispose: () => hud.destroy()
  };
}
