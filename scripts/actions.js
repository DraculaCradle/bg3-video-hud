import { canUseActor, values } from './model.js';

function requireOwner(actor, user) {
  if (!canUseActor(actor, user)) throw new Error('Select a character you own before using this control.');
}

export async function useOwnedItem(actor, itemId, user, event, activityId = null) {
  requireOwner(actor, user);
  const item = actor.items?.get?.(itemId) ?? values(actor.items).find(i => i.id === itemId);
  if (!item) throw new Error('This item no longer belongs to the selected actor.');
  // Resolve from the current actor every time; never accept arbitrary dropped UUIDs.
  if (activityId) {
    const activity = item.system?.activities?.get?.(activityId)
      ?? values(item.system?.activities).find(a => a.id === activityId);
    if (typeof activity?.use !== 'function') throw new Error('This activity cannot be used by the system.');
    return activity.use({ event });
  }
  if (typeof item.use !== 'function') throw new Error('This item type has no system use workflow. Open its character sheet instead.');
  // D&D5e 6.0.6 Item5e.use selects activities, opens dialogs, consumes resources,
  // handles concentration/templates and creates chat cards. Do not duplicate it.
  return item.use({ event });
}

export async function restActor(actor, kind, user) {
  requireOwner(actor, user);
  if (!['short', 'long'].includes(kind)) throw new Error('Unsupported rest type.');
  const method = kind === 'short' ? 'shortRest' : 'longRest';
  if (typeof actor[method] !== 'function') throw new Error('This actor does not support resting.');
  return actor[method](); // Keep the system's confirmation and resource recovery.
}
