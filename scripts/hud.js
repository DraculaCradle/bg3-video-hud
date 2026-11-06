import { MODULE_ID, GROUPS, actorStats, groupFor, itemsFor, normalizeLayout, reorder, slotPools,
  spellLevels, spellLevel, toggleId, usesLabel, values } from './model.js';
import { useOwnedItem, restActor } from './actions.js';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function button(text, action, title, data = {}) {
  const element = node('button', text);
  element.type = 'button';
  element.dataset.action = action;
  element.title = title ?? text;
  element.setAttribute('aria-label', title ?? text);
  Object.assign(element.dataset, data);
  return element;
}

export class VideoHUD {
  constructor({ store, user, onDisable, onError }) {
    Object.assign(this, { store, user, onDisable, onError });
    this.actor = null;
    this.edit = false;
    this.level = 'all';
    this.action = 'all';
    this.busy = new Set();
    this.status = '';
    this.destroyed = false;
  }

  clear() {
    this.root?.remove();
    this.root = null;
    this.actor = null;
    this.token = null;
    document.body.classList.remove('bg3-video-hud-active');
  }

  destroy() { this.destroyed = true; this.clear(); }

  setActor(actor, token = null) {
    if (this.destroyed) return;
    if (!actor) { this.clear(); return; }
    if (this.actor?.uuid !== actor.uuid) {
      this.edit = false;
      this.level = 'all';
      this.action = 'all';
      this.status = '';
      for (const list of this.root?.querySelectorAll('[data-scroll-group]') ?? []) {
        list.scrollTop = 0; list.scrollLeft = 0;
      }
    }
    this.actor = actor;
    this.token = token;
    this.render();
  }

  render() {
    if (this.destroyed || !this.actor) return;
    const actor = this.actor;
    const prefs = this.store.read(actor);
    const active = this.root?.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? JSON.stringify(active.dataset) : null;
    const scroll = new Map([...(this.root?.querySelectorAll('[data-scroll-group]') ?? [])]
      .map(list => [list.dataset.scrollGroup, { top: list.scrollTop, left: list.scrollLeft }]));
    const root = node('aside', undefined, 'bg3-video-hud');
    root.classList.toggle('bg3-video-hud-editing', this.edit);
    root.id = MODULE_ID;
    root.setAttribute('aria-label', 'BG3 Video HUD');
    root.addEventListener('click', event => {
      const control = event.target.closest('button[data-action]');
      if (control && !control.disabled) this.run(() => this.click(control, event));
    });
    root.addEventListener('dragstart', event => this.drag(event));
    root.addEventListener('dragover', event => {
      if (this.edit && event.target.closest('[data-item-id]')) event.preventDefault();
    });
    root.addEventListener('drop', event => this.run(() => this.drop(event)));

    const header = node('header', undefined, 'bg3-video-hud-header');
    const portrait = button('', 'sheet', `Open ${actor.name ?? 'character'} sheet`);
    portrait.className = 'bg3-video-hud-portrait';
    const src = this.token?.document?.texture?.src ?? this.token?.texture?.src ?? actor.img;
    if (src) {
      const image = node('img');
      image.src = src;
      image.alt = actor.name ?? 'Character';
      image.addEventListener('error', () => image.replaceWith(node('span', '?')), { once: true });
      portrait.append(image);
    } else portrait.append(node('span', '?'));
    header.append(portrait);
    const stats = actorStats(actor);
    const summary = node('div', undefined, 'bg3-video-hud-summary');
    const name = node('strong', actor.name ?? 'Character');
    name.title = actor.name ?? 'Character';
    summary.append(name, node('span',
      `HP ${stats.hp}/${stats.maxHp}${stats.tempHp ? ` (+${stats.tempHp} temp)` : ''} · AC ${stats.ac}`));
    for (const resource of stats.resources) {
      const line = node('small', `${resource.label || 'Resource'} ${resource.value ?? '—'}/${resource.max ?? '—'}`);
      line.title = line.textContent;
      summary.append(line);
    }
    header.append(summary);
    const controls = node('div', undefined, 'bg3-video-hud-controls');
    const edit = button(this.edit ? 'Done' : 'Edit', 'edit', 'Edit item visibility and order');
    edit.setAttribute('aria-pressed', String(this.edit));
    controls.append(edit, button('Original HUD', 'disable', 'Return to the original BG3 HUD'));
    header.append(controls);
    root.append(header);

    const filters = node('div', undefined, 'bg3-video-hud-filters');
    const activations = node('nav', undefined, 'bg3-video-hud-activations');
    activations.setAttribute('aria-label', 'Activation filters, not turn resource counters');
    for (const [key, label] of [['all', 'All actions'], ['action', 'Action'], ['bonus', 'Bonus Action'], ['reaction', 'Reaction']]) {
      const control = button(label, 'filter-action', label, { value: key });
      control.setAttribute('aria-pressed', String(this.action === key));
      control.disabled = this.edit;
      activations.append(control);
    }
    filters.append(activations, this.spellControls(prefs));
    root.append(filters);
    if (this.edit) root.append(node('p', 'Edit mode: show/hide, pin spells, drag items or use arrow buttons. Item use is disabled.', 'bg3-video-hud-help'));

    const panels = node('div', undefined, 'bg3-video-hud-panels');
    const items = itemsFor(actor, prefs, { edit: this.edit, level: this.level, action: this.action });
    for (const group of GROUPS) {
      const section = node('section', undefined, 'bg3-video-hud-panel');
      section.dataset.group = group;
      section.append(node('h3', group));
      const groupItems = items.filter(i => groupFor(i) === group);
      const list = node('ul', undefined, 'bg3-video-hud-items');
      list.dataset.scrollGroup = group;
      list.setAttribute('aria-label', `${group} items`);
      if (groupItems.length) list.tabIndex = 0;
      for (const item of groupItems) list.append(this.itemRow(item, prefs));
      if (!groupItems.length) section.append(node('p', this.edit ? 'No owned items in this group.' : 'No items match these filters.', 'bg3-video-hud-empty'));
      section.append(list);
      panels.append(section);
    }
    root.append(panels);
    const footer = node('footer');
    for (const [kind, label] of [['short', 'Short Rest'], ['long', 'Long Rest']]) {
      const control = button(label, 'rest', `${label} (system dialog)`, { value: kind });
      control.disabled = this.busy.has(`${actor.uuid}:rest`);
      footer.append(control);
    }
    const status = node('span', this.status, 'bg3-video-hud-status');
    status.title = this.status;
    status.setAttribute('role', 'status');
    footer.append(status);
    root.append(footer);
    if (this.root?.isConnected) this.root.replaceWith(root);
    else document.body.append(root);
    this.root = root;
    for (const list of root.querySelectorAll('[data-scroll-group]')) {
      const position = scroll.get(list.dataset.scrollGroup);
      if (position) { list.scrollTop = position.top; list.scrollLeft = position.left; }
    }
    // Hide only the upstream DOM shell, after our replacement is mounted.
    // Never toggle upstream settings or touch its persistent player flags.
    document.body.classList.add('bg3-video-hud-active');
    if (focusKey) [...root.querySelectorAll('button, ul[tabindex]')]
      .find(b => JSON.stringify(b.dataset) === focusKey)?.focus({ preventScroll: true });
  }

  spellControls(prefs) {
    const box = node('div', undefined, 'bg3-video-hud-spells');
    const nav = node('nav');
    nav.setAttribute('aria-label', 'Spell level');
    for (const level of ['all', ...spellLevels(this.actor)]) {
      const text = level === 'all' ? 'All' : level === 0 ? '0 · Cantrips' : String(level);
      const control = button(text, 'filter-level', `Spell level: ${text}`, { value: String(level) });
      control.setAttribute('aria-pressed', String(String(this.level) === String(level)));
      control.disabled = this.edit;
      nav.append(control);
    }
    const pinned = button('Pinned only', 'pinned-only', 'Show only pinned spells');
    pinned.setAttribute('aria-pressed', String(prefs.pinnedOnly));
    nav.append(pinned);
    box.append(nav);
    const pools = slotPools(this.actor);
    const slots = node('small', pools.length
      ? pools.map(p => `${p.label}: ${p.value ?? '?'}/${p.max ?? '?'}`).join(' · ')
      : 'No spell-slot pools. Cantrips and innate uses use system rules.');
    slots.title = slots.textContent;
    box.append(slots);
    return box;
  }

  itemRow(item, prefs) {
    const row = node('li', undefined, 'bg3-video-hud-item');
    row.dataset.itemId = item.id;
    row.draggable = this.edit;
    if (prefs.hidden.includes(item.id)) row.classList.add('bg3-video-hud-item-hidden');
    const detail = [item.name ?? 'Unnamed item', item.type === 'spell' ? `Level ${spellLevel(item)}` : item.type,
      usesLabel(item)].filter(Boolean).join(' · ');
    const use = button('', 'use', detail, { itemId: item.id });
    use.className = 'bg3-video-hud-use';
    const initial = node('span', [...(item.name || '?')].slice(0, 2).join(''), 'bg3-video-hud-item-initial');
    initial.setAttribute('aria-hidden', 'true');
    use.append(initial);
    if (item.img) {
      const image = node('img');
      image.src = item.img;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      use.append(image);
    }
    const label = node('span', item.name ?? 'Unnamed item', 'bg3-video-hud-item-label');
    use.append(label);
    if (usesLabel(item)) {
      use.append(node('small', usesLabel(item).replace(/ uses$/, ''), 'bg3-video-hud-uses'));
    }
    use.disabled = this.edit || this.busy.has(`${this.actor.uuid}:${item.id}`);
    row.append(use);
    if (this.edit) {
      const buttons = node('div', undefined, 'bg3-video-hud-edit-controls');
      const hidden = prefs.hidden.includes(item.id);
      const visibility = button(hidden ? 'Show' : 'Hide', 'visibility', `${hidden ? 'Show' : 'Hide'} ${item.name}`, { itemId: item.id });
      visibility.setAttribute('aria-pressed', String(!hidden));
      buttons.append(visibility);
      if (item.type === 'spell') {
        const pin = button(prefs.pinned.includes(item.id) ? 'Unpin' : 'Pin', 'pin', `Pin ${item.name}`, { itemId: item.id });
        pin.setAttribute('aria-pressed', String(prefs.pinned.includes(item.id)));
        buttons.append(pin);
      }
      buttons.append(button('↑', 'move', `Move ${item.name} up`, { itemId: item.id, direction: '-1' }),
        button('↓', 'move', `Move ${item.name} down`, { itemId: item.id, direction: '1' }));
      row.append(buttons);
    }
    return row;
  }

  async run(callback) {
    const actorUuid = this.actor?.uuid;
    try { await callback(); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'The system could not complete this action.';
      if (this.actor?.uuid === actorUuid) this.status = message;
      this.onError?.(message);
      try { this.render(); } catch { this.clear(); }
    }
  }

  async save(transform) {
    const actor = this.actor;
    await this.store.update(actor, transform);
    if (this.actor?.uuid === actor.uuid) this.render();
  }

  async perform(key, operation) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.status = '';
    try { this.render(); return await operation(); }
    finally { this.busy.delete(key); this.render(); }
  }

  async click(control, event) {
    const { action, itemId, value, direction } = control.dataset;
    const actor = this.actor;
    if (!actor) return;
    switch (action) {
      case 'disable': return this.onDisable();
      case 'sheet': return actor.sheet?.render({ force: true });
      case 'edit': this.edit = !this.edit; this.render(); break;
      case 'filter-action': this.action = value; this.render(); break;
      case 'filter-level': this.level = value === 'all' ? 'all' : Number(value); this.render(); break;
      case 'pinned-only': return this.save(p => ({ ...p, pinnedOnly: !p.pinnedOnly }));
      case 'visibility': if (this.edit) return this.save(p => ({ ...p, hidden: toggleId(p.hidden, itemId) })); break;
      case 'pin': if (this.edit) return this.save(p => ({ ...p, pinned: toggleId(p.pinned, itemId) })); break;
      case 'move': {
        if (!this.edit) return;
        const all = itemsFor(actor, this.store.read(actor), { edit: true });
        const item = all.find(i => i.id === itemId);
        if (!item) return;
        const siblings = all.filter(i => groupFor(i) === groupFor(item));
        const index = siblings.findIndex(i => i.id === itemId);
        const target = siblings[index + Number(direction)];
        if (!target) return;
        // Moving down inserts after the following item; moving up inserts before it.
        return this.save(p => {
          const order = itemsFor(actor, p, { edit: true }).map(i => i.id);
          if (Number(direction) < 0) return { ...p, order: reorder(order, itemId, target.id) };
          const from = order.indexOf(itemId), to = order.indexOf(target.id);
          order.splice(from, 1); order.splice(to, 0, itemId);
          return { ...p, order };
        });
      }
      case 'use': if (!this.edit) return this.perform(`${actor.uuid}:${itemId}`, () => useOwnedItem(actor, itemId, this.user, event)); break;
      case 'rest': return this.perform(`${actor.uuid}:rest`, () => restActor(actor, value, this.user));
    }
  }

  drag(event) {
    if (!this.edit || !event.dataTransfer) return;
    const itemId = event.target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    event.dataTransfer.setData('application/x-bg3-video-hud', JSON.stringify({ actor: this.actor.uuid, itemId }));
    event.dataTransfer.effectAllowed = 'move';
  }

  async drop(event) {
    if (!this.edit || !event.dataTransfer) return;
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/x-bg3-video-hud');
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const target = event.target.closest('[data-item-id]')?.dataset.itemId;
    if (!data || data.actor !== this.actor.uuid || !target) return;
    const actor = this.actor;
    const all = values(actor.items);
    const sourceItem = all.find(i => i.id === data.itemId), targetItem = all.find(i => i.id === target);
    if (!sourceItem || !targetItem || groupFor(sourceItem) !== groupFor(targetItem)) return;
    return this.save(p => ({ ...normalizeLayout(p),
      order: reorder(itemsFor(actor, p, { edit: true }).map(i => i.id), data.itemId, target) }));
  }
}
