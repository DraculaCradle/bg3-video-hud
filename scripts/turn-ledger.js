import { canUseActor } from './model.js';

// Observed native uses, not invented D&D action limits. No actor/user writes.
export class TurnLedger {
  constructor() { this.key = null; this.counts = new Map(); this.seen = new Set(); }
  sync(combat) {
    const key = combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
    if (key !== this.key) { this.key = key; this.counts.clear(); this.seen.clear(); }
  }
  observe(activity, config, results, user, combat) {
    this.sync(combat);
    const id = results?.message?.id;
    // Linked consumption prepares source updates; it does not emit a second
    // postUseActivity. Count its spell too, deduplicating the native message ID.
    if (!this.key || !id || this.seen.has(id) || !canUseActor(activity.actor, user)) return;
    const activation = activity.activation?.type;
    const type = activation?.startsWith('reaction') ? 'reaction' : activation;
    if (!['action', 'bonus', 'reaction'].includes(type)) return;
    this.seen.add(id);
    const key = `${activity.actor.uuid}:${type}`; this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
  state(actor, type, combat) {
    this.sync(combat);
    if (!this.key) return { label: '战斗外', used: null };
    const used = this.counts.get(`${actor.uuid}:${type}`) ?? 0;
    return { label: used ? `已用${used}` : '未记录使用', used };
  }
}
