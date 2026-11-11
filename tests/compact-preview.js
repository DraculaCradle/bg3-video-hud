import { VideoHUD } from '../scripts/hud.js';
import { LayoutStore } from '../scripts/persistence.js';
import { actor, item, userWithFlags } from './fixtures.js';

// Original synthetic art/data only. No player documents or private reference assets.
const icon = (symbol, color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><radialGradient id="g"><stop stop-color="${color}"/><stop offset="1" stop-color="#101820"/></radialGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="44" text-anchor="middle" font-size="40" fill="#eee1bd">${symbol}</text></svg>`);
const equipment = ['短剑 Shortsword', '长弓 Longbow', '匕首 Dagger', '火把 Torch', '药水 Potion', '治疗药水 Healing Potion', '法术卷轴 Scroll', '炼金火 Alchemist Fire', '投掷炸弹 Bomb', '魔法护符 Amulet', '急救包 Healer Kit', '魔杖 Wand'];
const features = ['疾跑 Dash', '撤离 Disengage', '躲藏 Hide', '第二风 Second Wind', '法术恢复 Arcane Recovery', '急救 Stabilize', '野性形态 Wild Shape', '宿敌标记 Favored Foe'];
const spells = ['光亮术 Light', '魔法伎俩 Prestidigitation', '治疗伤口 Cure Wounds', '猎人印记 Hunter’s Mark', '侦测魔法 Detect Magic', '荆棘之雨 Hail of Thorns', '动物交谈 Speak with Animals', '神莓术 Goodberry', '跳跃术 Jump', '迷雾术 Fog Cloud'];
const all = [
  ...equipment.map((name, i) => item(`gear-${i}`, i < 3 ? 'weapon' : 'consumable', { activities: [{ activation: { type: 'action' } }] }, { name, img: icon(['⚔', '➶', '†', '♟'][i % 4], '#8e7044') })),
  ...features.map((name, i) => item(`feature-${i}`, 'feat', { activities: [{ activation: { type: i % 2 ? 'bonus' : 'action' } }] }, { name, img: icon(['❖', '✦', '◈', '✧'][i % 4], '#4a7957') })),
  ...spells.map((name, i) => item(`spell-${i}`, 'spell', { level: i < 2 ? 0 : 1, activities: [{ activation: { type: 'action' } }] }, { name, img: icon(['✺', '✹', '✚', '✧'][i % 4], '#6b5296') }))
];
const hero = actor('preview', all, { name: '林间游侠 · Rowan', img: icon('R', '#6c8659'),
  temporaryEffects: ['专注', '祝福', '加速', '中毒', '倒地', '隐形'].map((name, i) => ({ id: `preview-condition-${i}`, name, img: icon(['✦', '✚', '➶', '◆', '↓', '◈'][i], ['#67559b', '#a18439', '#467e95', '#4e8049', '#8b6348', '#567c9c'][i]) })),
  system: { attributes: { hp: { value: 12, max: 12 }, ac: { value: 14 } }, spells: { spell1: { value: 2, max: 3, level: 1 }, spell2: { value: 1, max: 2, level: 2 }, pact: { value: 1, max: 2, level: 3 } } } });
for (const entry of hero.items.values()) {
  entry.actor = hero; entry.uuid = `${hero.uuid}.Item.${entry.id}`;
  entry.system.description = { value: '<p>原创模拟物品说明，用于验证完整说明卡、搜索和紧凑布局。</p><p><strong>操作：</strong>点击使用；法术先选环阶或来源。需要重复结算或原生选项时，开启“详细”。</p>' };
  const activation = entry.system.activities[0]?.activation ?? { type: 'action' };
  const activity = { id: 'preview-use', name: entry.type === 'spell' ? '施放' : '使用', type: 'utility',
    canUse: true, item: entry, actor: hero, activation, consumption: { spellSlot: entry.type === 'spell' },
    target: { affects: { type: 'self', count: 1 } }, use: async () => undefined };
  entry.system.activities = new Map([[activity.id, activity]]);
  entry.use = async () => undefined;
}
const user = userWithFlags();
const hud = new VideoHUD({ store: new LayoutStore(user), user, onDisable: () => hud.clear(), onError: () => {} });
hud.setActor(hero);
// A standalone visual fixture, never imported by the runtime module.
window.compactPreview = { hud, hero, user };
