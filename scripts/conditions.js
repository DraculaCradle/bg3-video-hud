import { values } from './model.js';

// Read the selected (possibly synthetic) actor, never the world actor by ID.
// Native temporaryEffects already accounts for transferred/active effects.
export function portraitConditions(actor, token, registry = globalThis.CONFIG?.statusEffects ?? [], localize = key => globalThis.game?.i18n?.localize?.(key) ?? key) {
  if (!actor) return [];
  const definitions = new Map(values(registry).map(s => [s.id, s]));
  const result = [], seen = new Set(), images = new Set();
  const label = (name, fallback) => String(localize(name || fallback) || name || fallback);
  const add = entry => { result.push(entry); if (entry.img) images.add(entry.img); };
  const effects = actor.temporaryEffects ?? actor.appliedEffects ?? actor.effects;
  for (const effect of values(effects)) {
    if (!effect || effect.disabled || effect.isSuppressed || effect.suppressed) continue;
    const statuses = [...(effect.statuses ?? [])].filter(id => typeof id === 'string');
    if (statuses.length && statuses.every(id => seen.has(id))) continue;
    // Fallback collections can contain permanent passive enchantments.
    if (actor.temporaryEffects == null && effect.isTemporary === false && !statuses.length) continue;
    const definition = definitions.get(statuses[0]);
    const img = effect.img || effect.icon || definition?.img || definition?.icon || '';
    if (!img && !statuses.length && !effect.name && !effect.label) continue;
    const key = effect.uuid || `${effect.parent?.uuid ?? 'actor'}.${effect.id ?? effect._id ?? result.length}`;
    add({ key, name: label(effect.name || effect.label || definition?.name || definition?.label, statuses[0] || '状态'), img });
    statuses.forEach(id => seen.add(id));
  }
  for (const id of actor.statuses ?? []) {
    if (seen.has(id)) continue;
    const definition = definitions.get(id);
    add({ key: `status.${id}`, name: label(definition?.name || definition?.label, id), img: definition?.img || definition?.icon || '' });
    seen.add(id);
  }
  const overlay = token?.document?.overlayEffect ?? token?.overlayEffect;
  if (typeof overlay === 'string' && overlay && !images.has(overlay)) {
    const definition = values(registry).find(s => (s.img || s.icon) === overlay);
    add({ key: 'token.overlay', name: label(definition?.name || definition?.label, 'Token 叠加状态'), img: overlay });
  }
  return result;
}

export function conditionRing(entries, slots = 10) {
  const overflow = entries.length > slots;
  const visible = entries.slice(0, overflow ? slots - 1 : slots);
  if (overflow) visible.push({ key: 'overflow', name: entries.slice(slots - 1).map(e => e.name).join('、'), count: entries.length - slots + 1 });
  return visible.map((entry, i) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / visible.length;
    return { ...entry, x: 50 + Math.cos(angle) * 42, y: 50 + Math.sin(angle) * 42 };
  });
}
