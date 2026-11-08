export function item(id, type = 'feat', system = {}, extra = {}) {
  return { id, name: id, type, system: type === 'feat' && !Object.hasOwn(system, 'activities') && !Object.hasOwn(system, 'activation') ? { activation: { type: 'action' }, ...system } : system, sort: 0, ...extra };
}

export function actor(id = 'hero', items = [], extra = {}) {
  return { id, uuid: `Actor.${id}`, name: id, isOwner: true,
    items: new Map(items.map(i => [i.id, i])), system: {}, ...extra };
}

export function userWithFlags() {
  const user = {
    id: 'player', flags: {}, writes: [],
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) {
      this.writes.push({ scope, key, value: structuredClone(value) });
      this.flags[scope] ??= {};
      const parts = key.split('.');
      let target = this.flags[scope];
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = structuredClone(value);
    }
  };
  return user;
}
