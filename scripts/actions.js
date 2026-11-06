import { canUseActor, values } from './model.js';

function requireOwner(actor, user) {
  if (!canUseActor(actor, user)) throw new Error('请先选择你拥有权限的角色，再使用此控件。');
}

export async function useOwnedItem(actor, itemId, user, event, activityId = null) {
  requireOwner(actor, user);
  const item = actor.items?.get?.(itemId) ?? values(actor.items).find(i => i.id === itemId);
  if (!item) throw new Error('此物品已不属于当前角色，请重新选择。');
  // Resolve from the current actor every time; never accept arbitrary dropped UUIDs.
  if (activityId) {
    const activity = item.system?.activities?.get?.(activityId)
      ?? values(item.system?.activities).find(a => a.id === activityId);
    if (typeof activity?.use !== 'function') throw new Error('系统无法使用此活动。');
    return activity.use({ event });
  }
  if (typeof item.use !== 'function') throw new Error('此物品没有可用的系统使用流程，请从角色卡操作。');
  // D&D5e 6.0.6 Item5e.use selects activities, opens dialogs, consumes resources,
  // handles concentration/templates and creates chat cards. Do not duplicate it.
  return item.use({ event });
}

export async function restActor(actor, kind, user) {
  requireOwner(actor, user);
  if (!['short', 'long'].includes(kind)) throw new Error('不支持此休息类型。');
  const method = kind === 'short' ? 'shortRest' : 'longRest';
  if (typeof actor[method] !== 'function') throw new Error('此角色不支持休息操作。');
  return actor[method](); // Keep the system's confirmation and resource recovery.
}
