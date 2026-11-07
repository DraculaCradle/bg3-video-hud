import { castingSources, nativeCastingOptions, requireActor } from './casting.js';
import { resolveOwnedItem } from './actions.js';

// Optional Midi-QOL's awaited preItemRollV2 hook. Never initiate a reaction,
// patch its methods, alter an owned spell or consume a resource ourselves.
export async function reactionResources({ workflow, usage } = {}, { user, current, choose } = {}) {
  const activity = workflow?.activity, actor = activity?.actor, item = activity?.item;
  if (item?.type !== 'spell' || usage?.midiOptions?.isReaction !== true
    || ![item.system?.identifier, item.flags?.['chris-premades']?.info?.identifier].includes('shield')
    || usage.cause?.activity || usage.bg3ReactionResource || !current?.(actor)) return;
  requireActor(actor, user);
  const owned = resolveOwnedItem(actor, item.id, user);
  if (owned.uuid !== item.uuid) return;
  const sources = castingSources(actor, owned).filter(s => s.enabled && (!s.max || s.remaining > 0));
  if (!sources.length) return;
  const choice = await choose(owned, sources);
  if (!choice || !current(actor)) return false;
  requireActor(actor, user);
  if (resolveOwnedItem(actor, item.id, user) !== owned) return false;
  if (choice === 'slot') { usage.bg3ReactionResource = true; return; }
  if (!sources.some(s => s.item.id === choice)) throw new Error('反应来源已更改，请重新选择。');
  const config = nativeCastingOptions(actor, owned, activity, { sourceId: choice });
  // D&D5e 6's cause.resources consumes the source and spell in one native
  // transaction. Keep target, macro, dialog and material configurations intact.
  usage.cause = { ...usage.cause, ...config.cause };
  usage.consume = { ...usage.consume, ...config.consume };
  usage.scaling = config.scaling;
  usage.bg3ReactionResource = true;
}
