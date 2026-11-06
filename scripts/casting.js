import { MODULE_ID, canUseActor, slotPools, values, spellLevel } from './model.js';
import { resolveOwnedItem } from './actions.js';

export const SOURCE_ACTIVITY = 'bg3sourcecast001';
export const RECOVERY = { '': '不自动恢复', sr: '短休', lr: '长休', day: '每日' };

export function usableActivities(item) {
  return values(item?.system?.activities).filter(a => a.canUse === true && typeof a.use === 'function');
}

export function castingSources(actor, spell) {
  return values(actor?.items).flatMap(item => values(item.system?.activities)
    .filter(a => a.type === 'cast' && a.spell?.uuid === spell.uuid && a.canUse !== false)
    .map(activity => {
      const uses = item.system?.uses ?? {};
      const max = Number(uses.max) || 0;
      return { item, activity, max, remaining: max ? Math.max(0, max - (Number(uses.spent) || 0)) : null,
        enabled: item.flags?.[MODULE_ID]?.castingSource?.enabled !== false,
        managed: item.flags?.[MODULE_ID]?.castingSource?.spell === spell.uuid,
        level: Number(activity.spell.level) || spellLevel(spell) };
    }));
}

export function castingPools(actor, spell, activity) {
  if (spell.type !== 'spell' || !spellLevel(spell)
    || !(activity.requiresSpellSlot || activity.consumption?.spellSlot)) return [];
  return slotPools(actor).filter(p => p.level >= spellLevel(spell));
}

export function sourceData(spell, input) {
  const name = String(input.name ?? '').trim();
  const max = Number(input.max), remaining = Number(input.remaining), level = Number(input.level);
  if (!name || name.length > 120 || !Number.isInteger(max) || max < 0 || max > 999
    || !Number.isInteger(remaining) || remaining < 0 || remaining > max
    || !Number.isInteger(level) || level < spellLevel(spell) || level > 9
    || !Object.hasOwn(RECOVERY, input.period)) throw new Error('请检查来源名称、次数、恢复方式与施法环阶。');
  return { name, type: 'feat', img: spell.img,
    flags: { [MODULE_ID]: { castingSource: { spell: spell.uuid, enabled: input.enabled !== false } } },
    system: { uses: { max: max ? String(max) : '', spent: max - remaining,
      recovery: max && input.period ? [{ period: input.period, type: 'recoverAll' }] : [] },
    activities: { [SOURCE_ACTIVITY]: { _id: SOURCE_ACTIVITY, type: 'cast', name,
      spell: { uuid: spell.uuid, level, properties: [], spellbook: false },
      consumption: { spellSlot: false, scaling: { allowed: true, max: String(level - spellLevel(spell)) },
        targets: max ? [{ type: 'itemUses', target: '', value: '1' }] : [] }
    } } } };
}

export async function saveCastingSource(actor, spellId, user, input, sourceId = null) {
  const spell = resolveOwnedItem(actor, spellId, user);
  if (spell.type !== 'spell' || !spell.uuid) throw new Error('请选择当前角色拥有的法术。');
  const data = sourceData(spell, input);
  if (!sourceId) {
    if (typeof actor.createEmbeddedDocuments !== 'function') throw new Error('原生来源创建接口不可用。');
    return (await actor.createEmbeddedDocuments('Item', [data]))[0];
  }
  const source = resolveOwnedItem(actor, sourceId, user);
  if (source.type !== 'feat' || source.flags?.[MODULE_ID]?.castingSource?.spell !== spell.uuid
    || !source.system?.activities?.get?.(SOURCE_ACTIVITY)) throw new Error('只能编辑本模组为此法术创建的来源。');
  // Edit only the fields managed by this source editor, preserving unrelated data.
  return source.update({ name: data.name, 'system.uses': data.system.uses,
    [`system.activities.${SOURCE_ACTIVITY}.name`]: data.name,
    [`system.activities.${SOURCE_ACTIVITY}.spell.level`]: data.system.activities[SOURCE_ACTIVITY].spell.level,
    [`system.activities.${SOURCE_ACTIVITY}.consumption`]: data.system.activities[SOURCE_ACTIVITY].consumption,
    [`flags.${MODULE_ID}.castingSource.enabled`]: input.enabled !== false });
}

/** Validated native use configuration. No resource value is subtracted here. */
export function nativeCastingOptions(actor, item, activity, choice = {}) {
  const config = {};
  if (choice.slot && choice.sourceId) throw new Error('请选择一种施法方式。');
  if (choice.slot) {
    const pool = castingPools(actor, item, activity).find(p => p.key === choice.slot);
    if (!pool) throw new Error('法术位已更改，请重新选择施法方式。');
    config.spell = { slot: pool.key };
    config.scaling = Math.max(0, pool.level - spellLevel(item));
  }
  if (choice.sourceId) {
    const source = castingSources(actor, item).find(s => s.item.id === choice.sourceId);
    if (!source?.enabled || (source.max && !source.remaining) || !source.activity.relativeUUID) {
      throw new Error('施法来源已停用、耗尽或不可用，请重新选择。');
    }
    config.cause = { activity: source.activity.relativeUUID, resources: true };
    const targets = values(activity.consumption?.targets);
    // Replace the spell's own charge source, preserving unrelated material or
    // foreign-resource costs. Native consumption applies both lists atomically.
    config.consume = { spellSlot: false, resources: targets.flatMap((target, index) =>
      target.type === 'activityUses' || (target.type === 'itemUses' && (!target.target || target.target === item.id)) ? [] : [index]) };
    config.scaling = Math.max(0, source.level - spellLevel(item));
  }
  return config;
}

export function scaledActivity(activity, scaling = 0) {
  if (!scaling) return activity;
  if (typeof activity.item?.clone !== 'function') throw new Error('系统升环预览接口不可用，请使用原生流程。');
  // Item5e.clone/scaledClone already prepare final attributes. Preparing again
  // can duplicate base damage parts, so never run preparation a second time.
  const clone = typeof activity.item.scaledClone === 'function'
    ? activity.item.scaledClone(scaling, { keepId: true })
    : activity.item.clone({ 'flags.dnd5e.scaling': scaling }, { keepId: true });
  const scaled = clone.system?.activities?.get?.(activity.id);
  if (!scaled) throw new Error('系统未能准备升环活动。');
  return scaled;
}

// Explicit standard identifiers; never parse translated names or descriptions.
// Additional homebrew repetition is a user-selected use option, not inferred rules.
export function sequencePlan(item, activity, { level = spellLevel(item), count = null, mode = null } = {}) {
  const activities = usableActivities(item);
  const attack = activities.filter(a => a.type === 'attack');
  const damage = activities.filter(a => a.type === 'damage');
  const identifier = item.system?.identifier;
  const bundle = bundledActivity(item);
  const actorLevel = Number(item.actor?.system?.details?.level)
    || values(item.actor?.items).filter(i => i.type === 'class').reduce((n, i) => n + (Number(i.system?.levels) || 0), 0);
  let n = 1, roller = activity, method = 'attack', standard = false;
  if (identifier === 'scorching-ray' && attack.length === 1 && (!bundle || bundle.id === activity.id)) {
    n = Math.max(3, level + 1); roller = attack[0]; standard = true;
  } else if (identifier === 'eldritch-blast' && attack.length === 1) {
    n = 1 + [5, 11, 17].filter(l => actorLevel >= l).length; roller = attack[0]; standard = true;
  }
  // Native multi-attack target counts are not automatically treated as a number
  // of attacks. Only explicit standard profiles or user-entered repetitions are.
  if (count !== null && count !== '') {
    n = Number(count);
    method = mode ?? (activity.type === 'damage' ? 'damage' : 'attack');
    roller = method === 'damage' ? (damage.length === 1 ? damage[0] : activity)
      : (attack.length === 1 ? attack[0] : activity);
  }
  if (!Number.isInteger(n) || n < 1 || n > 20 || !['attack', 'damage'].includes(method)) {
    throw new Error('重复结算次数须为 1～20。');
  }
  if (n === 1 && !standard && !count
    && !(activity.type === 'attack' && Number(activity.target?.affects?.count) === 1)) return null;
  if (typeof roller?.[method === 'attack' ? 'rollAttack' : 'rollDamage'] !== 'function') {
    throw new Error('此活动缺少所选的原生掷骰接口。');
  }
  if (method === 'attack' && typeof roller.rollDamage !== 'function') {
    throw new Error('此活动缺少原生伤害接口，请选择原生使用。');
  }
  return { count: n, rollerId: roller.id, method, standard, damageScaling: standard ? 0 : undefined };
}

export function bundledActivity(item) {
  if (item.system?.identifier !== 'scorching-ray') return null;
  return usableActivities(item).find(a => a.type === 'utility' && a.consumption?.spellSlot === true) ?? null;
}

export function requireActor(actor, user) {
  if (!canUseActor(actor, user)) throw new Error('你已不再拥有此角色的操作权限。');
}
