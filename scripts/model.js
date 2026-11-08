export const MODULE_ID = 'bg3-video-hud';
export const GROUPS = ['Weapons', 'Items', 'Features', 'Spells'];
export const DEFAULT_RATIOS = [2, 2, 3, 5];

export function values(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

export function canUseActor(actor, user) {
  if (!actor || !user) return false;
  return typeof actor.testUserPermission === 'function'
    ? Boolean(actor.testUserPermission(user, 'OWNER')) : actor.isOwner === true;
}

export function selectActor(tokens, user, canvasReady = true) {
  if (!canvasReady) return null;
  const controlled = values(tokens);
  // A selected unowned token must never silently use the assigned PC instead.
  if (controlled.length) return controlled.find(t => canUseActor(t.actor, user))?.actor ?? null;
  return canUseActor(user?.character, user) ? user.character : null;
}

const idList = value => [...new Set(Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.length) : [])];
export function normalizeLayout(data = {}) {
  return {
    version: 1, order: idList(data?.order), hidden: idList(data?.hidden),
    pinned: idList(data?.pinned), pinnedOnly: data?.pinnedOnly === true,
    ...(validRatios(data?.ratios) ? { ratios: [...data.ratios] }
      : validRatios(data?.ratios, 3) ? { ratios: [data.ratios[0] / 2, data.ratios[0] / 2, ...data.ratios.slice(1)] } : {})
  };
}

export function validRatios(ratios, length = GROUPS.length) {
  return Array.isArray(ratios) && ratios.length === length
    && ratios.every(n => Number.isFinite(n) && n > 0 && n <= 10000);
}

export function resizeColumns(widths, index, delta, minimum = 56) {
  if (!validRatios(widths) || ![0, 1, 2].includes(index) || !Number.isFinite(delta)) return [...DEFAULT_RATIOS];
  const result = [...widths], sum = widths[index] + widths[index + 1];
  const floor = Math.min(minimum, sum / 3);
  result[index] = Math.max(floor, Math.min(sum - floor, widths[index] + delta));
  result[index + 1] = sum - result[index];
  return result;
}

// Prepared native activities and optional automation visibility are read only.
export function manualActivities(item) {
  const premades = item?.flags?.['chris-premades'] ?? {};
  const hidden = new Set((Array.isArray(premades.hiddenActivities) ? premades.hiddenActivities : [])
    .map(key => premades.activityIdentifiers?.[key]).filter(Boolean));
  return values(item?.system?.activities).filter(a => a && a.canUse !== false && a.isHidden !== true
    && a.midiProperties?.automationOnly !== true && !hidden.has(a.id));
}

export function hasActiveUse(item) {
  if (item?.canUse === false || item?.isHidden === true) return false;
  const activeType = type => ['none', 'special', 'action', 'bonus', 'minute', 'hour', 'day',
    'legendary', 'mythic', 'lair', 'crew'].includes(type) || String(type ?? '').startsWith('reaction');
  const activities = values(item?.system?.activities);
  if (activities.length) return manualActivities(item).some(a => ['attack', 'cast'].includes(a.type)
    || activeType(a.activation?.type));
  // Legacy activation data is used only when no modern activities are present.
  return activeType(item?.system?.activation?.type);
}

export function groupFor(item) {
  if (item?.type === 'spell') return 'Spells';
  const subtype = item?.system?.type?.value ?? item?.system?.consumableType;
  if (subtype === 'ammo') return null;
  if (item?.type === 'weapon') return 'Weapons';
  if (item?.type === 'feat') return hasActiveUse(item) ? 'Features' : null;
  if (['equipment', 'consumable', 'tool', 'loot', 'container'].includes(item?.type)
    && hasActiveUse(item)) return 'Items';
  return null;
}

export function activationTypes(item) {
  const types = manualActivities(item).map(a => a.activation?.type).filter(Boolean);
  if (!values(item.system?.activities).length && item.system?.activation?.type) types.push(item.system.activation.type);
  return [...new Set(types.flatMap(type => type.startsWith('reaction') ? [type, 'reaction'] : [type]))];
}

export function spellLevel(item) {
  const n = Number(item.system?.level);
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : 0;
}

export function itemsFor(actor, layout, { edit = false, level = 'all', action = 'all' } = {}) {
  const prefs = normalizeLayout(layout);
  const order = new Map(prefs.order.map((id, index) => [id, index]));
  return values(actor?.items).filter(item => {
    if (!item.id || !groupFor(item)) return false;
    if (edit) return true; // Hidden combat items remain discoverable; character records stay excluded.
    if (prefs.hidden.includes(item.id)) return false;
    if (action !== 'all' && !activationTypes(item).includes(action)) return false;
    if (item.type === 'spell') {
      if (prefs.pinnedOnly && !prefs.pinned.includes(item.id)) return false;
      if (level !== 'all' && spellLevel(item) !== Number(level)) return false;
    }
    return true;
  }).sort((a, b) => {
    const rank = (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity);
    return (Number.isNaN(rank) ? 0 : rank) || (a.sort ?? 0) - (b.sort ?? 0)
      || String(a.name ?? '').localeCompare(String(b.name ?? '')) || a.id.localeCompare(b.id);
  });
}

export function reorder(order, sourceId, targetId) {
  const ids = idList(order);
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return ids;
  ids.splice(ids.indexOf(sourceId), 1);
  ids.splice(ids.indexOf(targetId), 0, sourceId);
  return ids;
}

export function toggleId(ids, id) {
  const list = idList(ids);
  return list.includes(id) ? list.filter(i => i !== id) : [...list, id];
}

function numberOrNull(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function slotPools(actor) {
  const pools = [];
  const spells = actor?.system?.spells ?? {};
  for (let level = 1; level <= 9; level++) {
    const slot = spells[`spell${level}`];
    if (!slot) continue;
    if ((numberOrNull(slot.max) ?? 0) <= 0 && (numberOrNull(slot.value) ?? 0) <= 0) continue;
    pools.push({ key: `spell${level}`, level, value: numberOrNull(slot.value), max: numberOrNull(slot.max), label: `${level}环` });
  }
  if (spells.pact && ((numberOrNull(spells.pact.max) ?? 0) > 0 || (numberOrNull(spells.pact.value) ?? 0) > 0)) {
    pools.push({ key: 'pact', level: numberOrNull(spells.pact.level), value: numberOrNull(spells.pact.value),
      max: numberOrNull(spells.pact.max), label: `契约${numberOrNull(spells.pact.level) ?? '?'}环` });
  }
  return pools;
}

export function spellLevels(actor) {
  const max = Math.max(0, ...values(actor?.items).filter(i => i.type === 'spell').map(spellLevel),
    ...slotPools(actor).map(p => p.level ?? 0));
  return Array.from({ length: Math.min(9, max) + 1 }, (_, i) => i);
}

export function usesLabel(item) {
  const uses = item.system?.uses;
  const max = numberOrNull(uses?.max);
  if (max === null || max <= 0) return '';
  const remaining = numberOrNull(uses.value) ?? (uses.spent != null ? max - Number(uses.spent) : null);
  return `${remaining === null ? '?' : Math.max(0, remaining)}/${max} 次`;
}

export function actorStats(actor) {
  const attributes = actor?.system?.attributes ?? {};
  const resources = Object.values(actor?.system?.resources ?? {}).filter(r => r && (r.label || r.max));
  return {
    hp: attributes.hp?.value ?? '—', maxHp: attributes.hp?.max ?? '—', tempHp: attributes.hp?.temp ?? 0,
    ac: attributes.ac?.value ?? '—', resources
  };
}
