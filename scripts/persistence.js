import { MODULE_ID, normalizeLayout } from './model.js';

// Hex encoding avoids dots and UUID collisions in Foundry's dotted flag paths.
export function actorKey(actor) {
  if (!actor?.uuid) throw new Error('该角色缺少可保存的 UUID。');
  return Array.from(new TextEncoder().encode(actor.uuid), n => n.toString(16).padStart(2, '0')).join('');
}

export class LayoutStore {
  constructor(user) { this.user = user; this.pending = new Map(); }

  read(actor) {
    const layouts = this.user.getFlag(MODULE_ID, 'layouts');
    return normalizeLayout(layouts?.[actorKey(actor)]);
  }

  update(actor, transform) {
    const key = actorKey(actor);
    // Serialize local edits; each operation reads the result of the previous write.
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const layout = normalizeLayout(transform(this.read(actor)));
      await this.user.setFlag(MODULE_ID, `layouts.${key}`, layout);
      return layout;
    });
    this.pending.set(key, next);
    next.finally(() => { if (this.pending.get(key) === next) this.pending.delete(key); }).catch(() => {});
    return next;
  }
}
