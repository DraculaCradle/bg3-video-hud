import { MODULE_ID, GROUPS, DEFAULT_RATIOS, actorStats, groupFor, itemsFor, normalizeLayout, reorder, slotPools,
  spellLevels, spellLevel, toggleId, usesLabel, values, resizeColumns, autoColumnWidths } from './model.js';
import { restActor, endTurn, canEndTurn } from './actions.js';
import { TargetWorkflow } from './targeting.js';
import { node, button, RichTooltip, modal } from './ui.js';
import { castingPools, castingSources, usableActivities, bundledActivity, nativeCastingOptions,
  saveCastingSource, deleteCastingSource, RECOVERY, sequencePlan, requireActor } from './casting.js';
import { TargetVisuals, partyRows, INTEGRATIONS } from './visuals.js';
import { TurnLedger } from './turn-ledger.js';

// Display labels only: stable model groups, item IDs and stored layouts are unchanged.
const groupLabels = { Weapons: '武器', Items: '物品', Features: '特性', Spells: '法术' };
const itemLabels = { weapon: '武器', equipment: '装备', consumable: '消耗品', container: '容器',
  loot: '杂物', tool: '工具', feat: '特性', background: '背景', class: '职业',
  subclass: '子职业', race: '种族', species: '种族', facility: '设施' };

export class VideoHUD {
  constructor({ store, user, onDisable, onError }) {
    Object.assign(this, { store, user, onDisable, onError });
    this.actor = null;
    this.edit = false;
    this.detailed = false;
    this.level = 'all';
    this.action = 'all';
    this.busy = new Set();
    this.status = '';
    this.destroyed = false;
    this.queries = {};
    this.tooltip = new RichTooltip();
    this.ledger = new TurnLedger();
    this.visuals = new TargetVisuals({ user, getOrigin: () => this.token
      ?? values(globalThis.canvas?.tokens?.controlled).find(t => t.actor === this.actor) });
    this.targeting = new TargetWorkflow({ user, visuals: this.visuals,
      chooseUse: (actor, item, event) => this.chooseUse(actor, item, event),
      allocate: options => this.allocate(options),
      onProgress: progress => {
        if (this.actor !== progress.item.actor) return;
        this.progress = progress; this.visuals.mark(progress); this.render();
        if (progress.stage === 'done') setTimeout(() => {
          if (!this.destroyed && this.progress === progress && !this.busy.size) { this.progress = null; this.render(); }
        }, 1200);
      },
      current: actor => this.actor === actor && !this.destroyed,
      onStatus: message => { this.status = message; this.render(); },
      onError: (message, { stale = false } = {}) => {
        this.onError?.(message);
        if (!stale) { this.status = message; this.render(); }
      } });
    // A focused overflow control must remain visible when zoom/resizing changes
    // the viewport. CSS performs the sizing; this never renders or writes flags.
    this.keepFocusVisible = () => {
      const active = document.activeElement;
      this.positionChrome();
      if ((this.root?.contains(active) || this.choiceDialog?.contains(active)) && active.closest('[data-scroll-group]')) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };
    globalThis.addEventListener('resize', this.keepFocusVisible);
    this.chromeObserver = new ResizeObserver(() => this.positionChrome());
    this.cancelInlineChoice = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || this.dialog?.open
        || event.target?.closest?.('dialog, [role="dialog"], .application')
        || (!this.pendingUse && !this.pendingAllocation)) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.closeChoice();
    };
    document.addEventListener('keydown', this.cancelInlineChoice);
  }

  clear() {
    this.chromeObserver.disconnect();
    this.cancelResize?.();
    this.targeting.cancel();
    this.pendingUse?.resolve(null); this.pendingUse = null;
    this.pendingAllocation?.resolve(null); this.pendingAllocation = null;
    this.dismissChoiceDialog();
    this.dismissEditor(); this.reactionDialog?.close();
    this.tooltip.hide(); this.visuals.destroy(); this.dialog?.close();
    this.edit = false; this.draft = null; this.editGroup = null; this.progress = null;
    this.root?.remove();
    this.root = null;
    this.actor = null;
    this.token = null;
    document.body.classList.remove('bg3-video-hud-active');
  }

  destroy() {
    this.destroyed = true;
    globalThis.removeEventListener('resize', this.keepFocusVisible);
    document.removeEventListener('keydown', this.cancelInlineChoice);
    this.clear();
  }

  setActor(actor, token = null) {
    if (this.destroyed) return;
    if (!actor) { this.clear(); return; }
    if (this.actor?.uuid !== actor.uuid || this.token?.id !== token?.id) {
      this.cancelResize?.();
      this.targeting.cancel();
      this.pendingUse?.resolve(null); this.pendingUse = null;
      this.pendingAllocation?.resolve(null); this.pendingAllocation = null;
      this.dismissChoiceDialog();
      this.dismissEditor(); this.reactionDialog?.close();
      this.edit = false; this.draft = null; this.editGroup = null;
      this.dialog?.close(); this.tooltip.hide(); this.progress = null;
    }
    if (this.actor?.uuid !== actor.uuid) {
      this.queries = {}; this.draft = null; this.editGroup = null;
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
    if (this.destroyed || !this.actor || this.resizing) return;
    const actor = this.actor;
    const prefs = this.edit && this.draft ? this.draft : this.store.read(actor);
    const active = this.root?.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? JSON.stringify(active.dataset) : null;
    const selection = active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = new Map([...(this.root?.querySelectorAll('[data-scroll-group]') ?? [])]
      .map(list => [list.dataset.scrollGroup, { top: list.scrollTop, left: list.scrollLeft }]));
    const root = node('aside', undefined, 'bg3-video-hud');
    root.classList.toggle('bg3-video-hud-editing', this.edit && !this.editGroup);
    root.id = MODULE_ID;
    root.setAttribute('aria-busy', String(this.saving === true));
    root.setAttribute('aria-label', 'BG3 视频界面');
    root.addEventListener('click', event => {
      const control = event.target.closest('button[data-action]');
      if (control && !control.disabled) this.run(() => this.click(control, event));
    });
    root.addEventListener('input', event => {
      if (event.isComposing) return;
      const group = event.target.dataset.queryGroup;
      if (group) { this.queries[group] = event.target.value; this.render(); }
    });
    root.addEventListener('compositionend', event => {
      const group = event.target.dataset.queryGroup;
      if (group) { this.queries[group] = event.target.value; this.render(); }
    });
    const explain = event => {
      const use = event.target.closest('[data-action="use"]');
      if (!use || this.edit || this.busy.size) return;
      const item = values(actor.items).find(i => i.id === use.dataset.itemId);
      if (item) this.tooltip.show(item, use, () => this.actor === actor && !this.destroyed);
    };
    root.addEventListener('mouseover', explain); root.addEventListener('focusin', explain);
    root.addEventListener('mouseout', event => {
      if (!event.relatedTarget?.closest?.('.bg3-video-hud-tooltip') && !event.relatedTarget?.closest?.('[data-action="use"]')) this.tooltip.hideSoon();
    });
    root.addEventListener('focusout', event => {
      // A focused shell can lose focus during replacement. Removing an adjacent
      // tooltip synchronously invalidates replaceWith's insertion reference.
      if (!event.relatedTarget?.closest?.('.bg3-video-hud-tooltip')) this.tooltip.hideSoon();
    });
    root.addEventListener('dragstart', event => this.drag(event));
    root.addEventListener('dragover', event => {
      if (this.edit && event.target.closest('[data-item-id]')) event.preventDefault();
    });
    root.addEventListener('drop', event => this.run(() => this.drop(event)));

    const header = node('header', undefined, 'bg3-video-hud-header');
    const portrait = button('', 'sheet', `打开 ${actor.name ?? '角色'} 的角色卡`);
    portrait.className = 'bg3-video-hud-portrait';
    const src = this.token?.document?.texture?.src ?? this.token?.texture?.src ?? actor.img;
    if (src) {
      const animated = /\.(webm|mp4|m4v)(?:[?#]|$)/i.test(src);
      const image = node(animated ? 'video' : 'img');
      if (animated) { image.autoplay = true; image.loop = true; image.muted = true; image.playsInline = true; }
      image.src = src;
      image.alt = actor.name ?? '角色';
      image.addEventListener('error', () => image.replaceWith(node('span', '?')), { once: true });
      portrait.append(image);
    } else portrait.append(node('span', '?'));
    header.append(portrait);
    const stats = actorStats(actor);
    const summary = node('div', undefined, 'bg3-video-hud-summary');
    const name = node('strong', actor.name ?? '角色');
    name.title = actor.name ?? '角色';
    summary.append(name, node('span',
      `生命 ${stats.hp}/${stats.maxHp}${stats.tempHp ? `（临时+${stats.tempHp}）` : ''} · 护甲 ${stats.ac}`, 'bg3-video-hud-stats-text'));
    const vitals = node('div', undefined, 'bg3-video-hud-vitals');
    const armor = node('span', `AC ${stats.ac}`); armor.title = `护甲 ${stats.ac}`; vitals.append(armor);
    if (Number.isFinite(Number(stats.hp)) && Number(stats.maxHp) > 0) {
      const bar = node('div', undefined, 'bg3-video-hud-health');
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `生命 ${stats.hp}/${stats.maxHp}，临时生命 ${stats.tempHp || 0}`);
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', stats.maxHp);
      bar.setAttribute('aria-valuenow', Math.max(0, Math.min(stats.hp, stats.maxHp)));
      bar.title = bar.getAttribute('aria-label');
      const total = Number(stats.maxHp) + Math.max(0, Number(stats.tempHp) || 0);
      const current = Math.max(0, Math.min(Number(stats.maxHp), Number(stats.hp)));
      bar.style.setProperty('--hp', `${current / total * 100}%`);
      bar.style.setProperty('--temp', `${Math.max(0, Number(stats.tempHp) || 0) / total * 100}%`);
      bar.append(node('b', `${stats.hp}/${stats.maxHp}${stats.tempHp ? ` +${stats.tempHp}` : ''}`));
      vitals.append(bar);
    }
    summary.append(vitals);
    for (const resource of stats.resources) {
      const line = node('small', `${resource.label || '资源'} ${resource.value ?? '—'}/${resource.max ?? '—'}`);
      line.title = line.textContent;
      summary.append(line);
    }
    header.append(summary);
    const controls = node('div', undefined, 'bg3-video-hud-controls');
    const edit = button(this.edit ? '完成' : '编辑', 'edit', '编辑物品显示与排序');
    edit.disabled = this.busy.size > 0 || this.saving === true;
    edit.setAttribute('aria-pressed', String(this.edit));
    controls.append(edit, button('原版界面', 'disable', '关闭本 HUD，返回 Foundry 或已启用的其他 HUD'));
    header.append(controls);
    root.append(header);
    const ratios = prefs.columnSizing === 'manual' ? prefs.ratios : DEFAULT_RATIOS;
    root.dataset.columnSizing = prefs.columnSizing ?? 'auto';
    const countPrefs = this.edit ? this.store.read(actor) : prefs;
    const countItems = itemsFor(actor, countPrefs);
    this.columnCounts = GROUPS.map(group => countItems.filter(item => groupFor(item) === group).length);
    root.style.setProperty('--video-columns', ratios.map(n => `minmax(0, ${n}fr)`).join(' '));

    const filters = node('div', undefined, 'bg3-video-hud-filters');
    const activations = node('nav', undefined, 'bg3-video-hud-activations');
    activations.dataset.scrollGroup = 'activations';
    activations.setAttribute('aria-label', '按动作类型筛选，不代表剩余动作次数');
    for (const [key, label] of [['all', '全部'], ['action', '动作'], ['bonus', '附赠动作'], ['reaction', '反应']]) {
      const control = button('', 'filter-action', label, { value: key });
      const symbol = node('i', { all: '◇', action: '●', bonus: '▲', reaction: '✦' }[key], `bg3-video-hud-resource-${key}`);
      symbol.setAttribute('aria-hidden', 'true');
      control.append(symbol, node('span', label));
      control.setAttribute('aria-pressed', String(this.action === key));
      if (key !== 'all') {
        const state = this.ledger.state(actor, key, globalThis.game?.combat);
        const indicator = node('small', state.used ? `${state.used}` : '', 'bg3-video-hud-action-state');
        indicator.title = `${state.label}；记录原生使用，不限制额外动作或代替系统规则。`;
        control.append(indicator);
      }
      control.disabled = this.edit;
      activations.append(control);
    }
    if (actor.statuses?.has('concentrating') || actor.system?.attributes?.concentration?.effects?.size) {
      const concentration = node('span', '◉', 'bg3-video-hud-concentration');
      concentration.title = '专注中'; concentration.setAttribute('aria-label', '专注中'); activations.append(concentration);
    }
    filters.append(activations, this.spellControls(prefs));
    root.append(filters);
    if (this.edit && !this.editGroup) root.append(this.editToolbar(prefs));

    const panels = node('div', undefined, 'bg3-video-hud-panels');
    const items = itemsFor(actor, prefs, { edit: this.edit, level: this.level, action: this.action });
    for (const group of GROUPS) {
      const section = node('section', undefined, 'bg3-video-hud-panel');
      section.dataset.group = group;
      const heading = node('div', undefined, 'bg3-video-hud-panel-heading');
      const title = node('h3', groupLabels[group]); title.title = groupLabels[group]; heading.append(title);
      const search = node('input'); search.type = 'search'; search.placeholder = '搜索…';
      search.dataset.queryGroup = group; search.value = this.queries[group] ?? '';
      search.setAttribute('aria-label', `搜索${groupLabels[group]}`); heading.append(search);
      const gear = button('⚙', 'edit-group', `编辑${groupLabels[group]}栏位`, { value: group });
      gear.disabled = this.busy.size > 0; heading.append(gear); section.append(heading);
      const groupItems = items.filter(i => groupFor(i) === group
        && String(i.name ?? '').toLocaleLowerCase().includes((this.queries[group] ?? '').trim().toLocaleLowerCase()));
      const list = node('ul', undefined, 'bg3-video-hud-items');
      list.dataset.scrollGroup = group;
      list.setAttribute('aria-label', `${groupLabels[group]}列表`);
      if (groupItems.length) list.tabIndex = 0;
      for (const item of groupItems) list.append(this.itemRow(item, prefs, !this.editGroup));
      if (!groupItems.length) list.append(node('li', this.edit ? '此分类没有角色物品。' : '没有符合筛选条件的物品。', 'bg3-video-hud-empty'));
      section.append(list);
      panels.append(section);
    }
    root.append(panels);
    this.installDividers(root, panels);
    const end = node('div', undefined, 'bg3-video-hud-end');
    end.append(button('♙ 角色卡', 'sheet', '打开角色卡'));
    const combat = globalThis.game?.combat;
    const primary = button('', combat?.started ? 'end-turn' : 'rest', combat?.started ? '结束当前角色回合' : '短休（系统确认窗口）', { value: 'short' });
    primary.className = 'bg3-video-hud-turn';
    primary.append(node('b', combat?.started ? '⌛' : '☾'), node('span', combat?.started ? '结束回合' : '短休'));
    primary.disabled = this.busy.size > 0 || (combat?.started && !canEndTurn(actor, this.token, this.user, combat));
    end.append(primary);
    const longRest = button('☾ 长休', 'rest', '长休（系统确认窗口）', { value: 'long' });
    longRest.disabled = this.busy.size > 0; end.append(longRest); root.append(end);
    const footer = node('footer');
    footer.append(button('队伍', 'party', '查看可访问的队伍角色'), button('联动', 'integrations', '动画、骰子与自动化状态'));
    const detailed = button('详细', 'detailed', '显示活动、重复结算和原生使用选项');
    detailed.setAttribute('aria-pressed', String(this.detailed));
    detailed.disabled = this.busy.size > 0 || this.edit || this.saving === true;
    footer.append(detailed);
    if (this.targeting.picking) footer.append(button('取消选目标', 'cancel-target', '取消目标选择，不使用技能'));
    const stages = { attack: '攻击掷骰', damage: '伤害掷骰', done: '已完成', stopped: '已停止', error: '结算中断' };
    const progress = this.progress;
    if (progress && this.busy.size && !['done', 'stopped', 'error'].includes(progress.stage)) {
      footer.append(button('停止后续', 'stop-sequence', '停止尚未执行的结算；当前原生窗口仍可自行取消'));
    }
    const progressText = progress ? `${progress.item.name} · ${stages[progress.stage] ?? '结算'} ${Math.min(progress.index + 1, progress.total)}/${progress.total}` : '';
    const status = node('span', progressText || this.status, 'bg3-video-hud-status');
    status.title = this.status;
    status.setAttribute('role', 'status');
    footer.append(status);
    footer.prepend(controls);
    root.append(footer);
    if (this.root?.isConnected) this.root.parentNode.replaceChild(root, this.root);
    else document.body.append(root);
    this.root = root;
    this.chromeObserver.disconnect(); this.chromeObserver.observe(root);
    const sidebar = document.getElementById('sidebar'); if (sidebar) this.chromeObserver.observe(sidebar);
    // Finish geometry before restoring offsets: interim wide grids can clamp
    // scrollTop/scrollLeft and lose the focused high-level spell filter.
    this.positionChrome();
    for (const list of root.querySelectorAll('[data-scroll-group]')) {
      const position = scroll.get(list.dataset.scrollGroup);
      if (position) { list.scrollTop = position.top; list.scrollLeft = position.left; }
    }
    // Hide only the upstream DOM shell, after our replacement is mounted.
    // Never toggle upstream settings or touch its persistent player flags.
    document.body.classList.add('bg3-video-hud-active');
    if (focusKey) {
      const focused = [...root.querySelectorAll('button, input, select, [data-scroll-group][tabindex], [data-divider]')]
        .find(b => JSON.stringify(b.dataset) === focusKey);
      focused?.focus({ preventScroll: true });
      if (focused?.tagName === 'INPUT' && selection?.[0] !== null && selection?.[0] !== undefined) {
        try { focused.setSelectionRange(...selection); } catch { /* Numeric input has no selection API. */ }
      }
    }
    this.syncChoiceDialog();
    this.syncEditor();
  }

  spellControls(prefs) {
    const box = node('div', undefined, 'bg3-video-hud-spells');
    const nav = node('nav');
    nav.dataset.scrollGroup = 'spell-levels';
    nav.setAttribute('aria-label', '法术环阶');
    const pools = slotPools(this.actor);
    const spells = itemsFor(this.actor, {}, { edit: true }).filter(i => i.type === 'spell');
    for (const level of ['all', ...spellLevels(this.actor)]) {
      const text = level === 'all' ? '全部' : level === 0 ? '戏法' : ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][level];
      const control = button('', 'filter-level', `法术环阶：${level === 'all' ? '全部' : `${level}环`}`, { value: String(level) });
      control.append(node('span', text));
      const indicators = node('span', undefined, 'bg3-video-hud-level-pips');
      const pool = pools.find(p => p.key === `spell${level}`);
      if (pool) {
        control.title += ` · 法术位 ${pool.value}/${pool.max}`;
        for (let i = 0; i < Math.min(12, Number(pool.max) || 0); i++) {
          const pip = node('i'); pip.classList.toggle('available', i < pool.value); indicators.append(pip);
        }
      } else indicators.textContent = level === 'all' ? '◇' : String(spells.filter(i => spellLevel(i) === level).length);
      indicators.setAttribute('aria-hidden', 'true'); control.append(indicators);
      control.setAttribute('aria-pressed', String(String(this.level) === String(level)));
      control.disabled = this.edit;
      nav.append(control);
    }
    const pinned = button('★', 'pinned-only', '仅显示已固定的法术');
    pinned.append(node('span', '仅固定', 'bg3-video-hud-stats-text'));
    pinned.setAttribute('aria-pressed', String(prefs.pinnedOnly));
    nav.append(pinned);
    box.append(nav);
    const slots = node('small', pools.length
      ? pools.map(p => `${p.label}：${p.value ?? '?'}/${p.max ?? '?'}`).join(' · ')
      : '无法术位。戏法与天赋施法按系统规则处理。');
    slots.title = slots.textContent;
    slots.dataset.scrollGroup = 'spell-pools';
    slots.tabIndex = 0;
    const pips = node('span', undefined, 'bg3-video-hud-slot-pips'); pips.setAttribute('aria-hidden', 'true');
    for (const pool of pools) {
      const group = node('span'); group.title = `${pool.label}：${pool.value}/${pool.max}`;
      for (let i = 0; i < Math.min(Number(pool.max) || 0, 12); i++) {
        const pip = node('i'); if (i < pool.value) pip.className = 'available'; group.append(pip);
      }
      pips.append(group);
    }
    slots.append(pips); box.append(slots);
    return box;
  }

  positionChrome() {
    const root = this.root;
    if (!root) return;
    const sidebar = document.getElementById('sidebar')?.getBoundingClientRect();
    const reserved = sidebar?.width > 80 && sidebar.left > innerWidth / 2
      && sidebar.right >= innerWidth - 50 ? innerWidth - sidebar.left + 12 : 12;
    root.style.setProperty('--video-right', `${reserved}px`);
    const panels = root.querySelector('.bg3-video-hud-panels');
    const geometryKey = JSON.stringify([innerWidth, innerHeight, devicePixelRatio, reserved, root.clientHeight, this.columnCounts, root.dataset.columnSizing]);
    if (!this.resizing && root.columnGeometryKey !== geometryKey) {
      root.columnGeometryKey = geometryKey;
      // The root stays viewport-sized; count changes only redistribute its deck.
      const available = panels.getBoundingClientRect().width;
      if (available <= 0) return;
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--video-cell)'; root.append(probe);
      const cell = probe.getBoundingClientRect().width; probe.remove();
      if (cell <= 0) return;
      const lists = [...panels.querySelectorAll('.bg3-video-hud-items')];
      const gap = parseFloat(getComputedStyle(lists[0]).columnGap) || 0;
      const panelGap = parseFloat(getComputedStyle(panels).columnGap) || 0;
      const frame = lists.map(list => {
        const section = getComputedStyle(list.parentElement), css = getComputedStyle(list);
        return ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
          .reduce((sum, key) => sum + (parseFloat(section[key]) || 0), 0)
          + (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0)
          // A hidden probe can report overlay scrollbars even when the real
          // list reserves a gutter. Measure each actual list (borders included).
          + list.offsetWidth - list.clientWidth;
      });
      const rows = Math.max(1, Math.floor((lists[0].clientHeight + gap) / (cell + gap)));
      // The allocator's gap is the grid gap. Panel gaps are reserved separately.
      const plan = autoColumnWidths(this.columnCounts, { width: available - panelGap * 3 + gap * 3, cell, gap, frame, rows });
      if (root.dataset.columnSizing !== 'manual') {
        root.style.setProperty('--video-columns', plan.widths.map(width => `${width}px`).join(' '));
        // Explicit whole columns fill every list. The common tile size fits
        // the entire deck; spare capacity remains usable empty icon slots.
        const sections = [...panels.querySelectorAll('.bg3-video-hud-panel')];
        sections.forEach((section, i) => {
          section.style.setProperty('--video-icon-columns', String(plan.columns[i]));
          section.style.setProperty('--video-cell', `${plan.cell}px`);
        });
      }
    }
    const bounds = panels.getBoundingClientRect();
    const sections = [...panels.querySelectorAll('.bg3-video-hud-panel')].map(el => el.getBoundingClientRect());
    for (const handle of panels.querySelectorAll('[data-divider]')) {
      const i = Number(handle.dataset.divider), a = sections[i], b = sections[i + 1];
      handle.style.left = `${(a.right + b.left) / 2 - bounds.left}px`;
      handle.setAttribute('aria-valuenow', String(Math.round(a.width / (a.width + b.width) * 100)));
    }
  }

  installDividers(root, panels) {
    const widths = () => [...panels.querySelectorAll('.bg3-video-hud-panel')].map(el => el.getBoundingClientRect().width);
    const resize = (initial, i, delta) => resizeColumns(initial, i, delta, Math.min(56, initial[i] * .85, initial[i + 1] * .85));
    const apply = next => {
      root.dataset.columnSizing = 'manual';
      for (const section of panels.querySelectorAll('.bg3-video-hud-panel')) {
        section.style.removeProperty('--video-icon-columns'); section.style.removeProperty('--video-cell');
      }
      root.style.setProperty('--video-columns', next.map(n => `minmax(0, ${n}fr)`).join(' '));
      this.positionChrome();
    };
    const save = async (actor, next) => {
      requireActor(actor, this.user);
      await this.store.update(actor, prefs => {
        if (next) return { ...prefs, ratios: next, columnSizing: 'manual' };
        const reset = { ...prefs }; delete reset.ratios; delete reset.columnSizing; return reset;
      });
      if (this.actor === actor) this.render();
    };
    for (let i = 0; i < GROUPS.length - 1; i++) {
      const handle = node('div', '⋮', 'bg3-video-hud-divider');
      handle.dataset.divider = String(i); handle.tabIndex = 0;
      handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', `调整${groupLabels[GROUPS[i]]}与${groupLabels[GROUPS[i + 1]]}宽度`);
      handle.setAttribute('aria-valuemin', '1'); handle.setAttribute('aria-valuemax', '99');
      handle.title = '拖动或方向键调整宽度；双击或 Home 恢复按数量自动分配';
      const available = () => !this.busy.size && !this.edit && !this.saving && !this.resizing;
      handle.ondblclick = () => { if (available()) this.run(() => save(this.actor, null)); };
      handle.onkeydown = event => {
        if (!available() || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? null : resize(widths(), i,
          (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 20 : 5));
        this.run(() => save(this.actor, next));
      };
      handle.onpointerdown = event => {
        if (event.button !== 0 || !available()) return;
        event.preventDefault(); event.stopPropagation(); this.tooltip.hide();
        const actor = this.actor, token = this.token, initial = widths(), x = event.clientX, id = event.pointerId;
        let next = initial;
        const abort = new AbortController(); this.resizing = true;
        handle.setPointerCapture(id);
        const finish = commit => {
          if (!this.resizing) return;
          this.resizing = false; this.cancelResize = null; abort.abort();
          if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
          if (commit && this.actor === actor && this.token === token) this.run(() => save(actor, next));
          else this.render();
        };
        this.cancelResize = () => finish(false);
        const options = { signal: abort.signal };
        handle.addEventListener('pointermove', ev => {
          if (ev.pointerId !== id) return;
          next = resize(initial, i, ev.clientX - x); apply(next);
        }, options);
        handle.addEventListener('pointerup', ev => { if (ev.pointerId === id) finish(true); }, options);
        handle.addEventListener('pointercancel', this.cancelResize, options);
        handle.addEventListener('lostpointercapture', this.cancelResize, options);
        window.addEventListener('blur', this.cancelResize, options);
        window.addEventListener('resize', this.cancelResize, options);
        document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } }, options);
      };
      panels.append(handle);
    }
  }

  beginEdit(group = null) {
    if (this.busy.size) return;
    if (this.edit) { if (group) this.editGroup = group; this.render(); return; }
    this.tooltip.hide(); this.progress = null;
    this.editorError = '';
    this.draft = normalizeLayout(this.store.read(this.actor));
    this.editBase = JSON.stringify(this.draft); this.editGroup = group;
    this.edit = true; this.render();
  }

  dismissEditor() {
    const dialog = this.editorDialog; this.editorDialog = null;
    if (dialog?.open) dialog.close(); dialog?.remove();
    if (dialog) this.restoreEditorFocus(dialog.dataset.editGroup, this.actor);
  }

  restoreEditorFocus(group, actor) {
    setTimeout(() => {
      if (this.destroyed || this.actor !== actor || this.edit || this.choiceDialog?.open || this.dialog?.open) return;
      [...(this.root?.querySelectorAll('[data-action="edit-group"]') ?? [])]
        .find(control => control.dataset.value === group)?.focus({ preventScroll: true });
    }, 0);
  }

  syncEditor() {
    if (!this.edit || !this.editGroup) { this.dismissEditor(); return; }
    let dialog = this.editorDialog;
    if (dialog && !dialog.open) {
      this.dismissEditor(); this.edit = false; this.draft = null; this.editGroup = null; this.render(); return;
    }
    if (!dialog) {
      dialog = modal(`编辑${groupLabels[this.editGroup]}栏位`, () => {
        if (this.editorDialog !== dialog) return;
        const group = this.editGroup, actor = this.actor;
        this.editorDialog = null; this.edit = false; this.draft = null; this.editGroup = null; this.render();
        this.restoreEditorFocus(group, actor);
      });
      this.editorDialog = dialog; dialog.classList.add('bg3-video-hud-editor-dialog');
      dialog.dataset.editGroup = this.editGroup;
      dialog.addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        if (control && !control.disabled && control.dataset.action !== 'close-modal') this.run(() => this.click(control, event));
      });
      dialog.addEventListener('input', event => {
        if (event.isComposing || !event.target.dataset.queryGroup) return;
        this.queries[this.editGroup] = event.target.value; this.render();
      });
      dialog.addEventListener('compositionend', event => {
        if (!event.target.dataset.queryGroup) return;
        this.queries[this.editGroup] = event.target.value; this.render();
      });
      dialog.addEventListener('dragstart', event => this.drag(event));
      dialog.addEventListener('dragover', event => { if (event.target.closest('[data-item-id]')) event.preventDefault(); });
      dialog.addEventListener('drop', event => this.run(() => this.drop(event)));
    }
    const previous = dialog.querySelector('.bg3-video-hud-editor-body'), active = document.activeElement;
    const key = previous?.contains(active) ? JSON.stringify(active.dataset) : null;
    const selection = active?.tagName === 'INPUT' ? active.selectionStart : null;
    const scroll = previous?.querySelector('ul')?.scrollTop ?? 0;
    const body = node('div', undefined, 'bg3-video-hud-editor-body');
    if (this.editorError) { const error = node('p', this.editorError); error.setAttribute('role', 'alert'); body.append(error); }
    const query = node('input'); query.type = 'search'; query.dataset.queryGroup = this.editGroup;
    query.setAttribute('aria-label', `搜索${groupLabels[this.editGroup]}`); query.placeholder = '搜索名称…';
    query.value = this.queries[this.editGroup] ?? '';
    const list = node('ul'); list.dataset.scrollGroup = 'editor-items';
    const prefs = this.draft;
    for (const item of itemsFor(this.actor, prefs, { edit: true }).filter(i => groupFor(i) === this.editGroup
      && i.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))) {
      list.append(this.itemRow(item, prefs));
    }
    body.append(query, this.editToolbar(prefs), list);
    if (previous) previous.replaceWith(body); else dialog.append(body);
    list.scrollTop = scroll;
    const focus = [...body.querySelectorAll('input, button')].find(el => JSON.stringify(el.dataset) === key);
    if (focus) { focus.focus({ preventScroll: true }); if (selection !== null) { try { focus.setSelectionRange(selection, selection); } catch {} } }
    else if (!previous) query.focus();
  }

  async commitEdit() {
    if (!this.edit || !this.draft || this.saving) return;
    const actor = this.actor; requireActor(actor, this.user);
    if (JSON.stringify(this.store.read(actor)) !== this.editBase) throw new Error('布局已在其他窗口更改，请取消编辑后重试。');
    const draft = normalizeLayout(this.draft);
    this.saving = true; this.render();
    try {
      await this.store.update(actor, () => draft);
      if (this.actor === actor) { this.edit = false; this.draft = null; this.editGroup = null; }
    } finally { this.saving = false; this.render(); }
  }

  editToolbar(prefs) {
    const bar = node('div', undefined, 'bg3-video-hud-help');
    bar.dataset.scrollGroup = 'edit-toolbar'; bar.setAttribute('aria-label', '快捷栏编辑工具');
    const items = itemsFor(this.actor, {}, { edit: true }).filter(i => !this.editGroup || groupFor(i) === this.editGroup);
    bar.append(node('span', `编辑${this.editGroup ? groupLabels[this.editGroup] : '全部'}：已显示 ${items.filter(i => !prefs.hidden.includes(i.id)).length}/${items.length}`));
    for (const [value, label] of [['all', '全选'], ['none', '清空'], ['reset', '恢复自动全部']]) {
      const control = button(label, 'bulk-edit', value === 'reset' ? '恢复此分类的自动显示和排序' : `${label}当前分类搜索结果`, { value });
      control.disabled = this.saving; bar.append(control);
    }
    for (const [action, label] of [['save-edit', '保存'], ['cancel-edit', '取消']]) {
      const control = button(label, action, label === '取消' ? '丢弃本次尚未保存的布局改动' : '保存本次布局');
      control.disabled = this.saving; bar.append(control);
    }
    return bar;
  }

  bulkEdit(value) {
    if (!this.edit || this.saving) return;
    const all = itemsFor(this.actor, {}, { edit: true }).filter(i => !this.editGroup || groupFor(i) === this.editGroup);
    const selected = value === 'reset' ? all : all.filter(i => String(i.name ?? '').toLocaleLowerCase()
      .includes((this.queries[groupFor(i)] ?? '').trim().toLocaleLowerCase()));
    const ids = new Set(selected.map(i => i.id));
    return this.save(p => ({ ...p,
      hidden: value === 'none' ? [...new Set([...p.hidden, ...ids])] : p.hidden.filter(id => !ids.has(id)),
      ...(value === 'reset' ? { order: p.order.filter(id => !ids.has(id)),
        pinned: p.pinned.filter(id => !ids.has(id)), pinnedOnly: this.editGroup && this.editGroup !== 'Spells' ? p.pinnedOnly : false } : {})
    }));
  }

  chooseUse(actor, item) {
    this.tooltip.hide(); this.progress = null; this.choiceError = '';
    const activities = usableActivities(item);
    const single = !this.detailed && activities.length === 1 ? activities[0] : null;
    // Skip choices only when there is one usable activity and no spell-level
    // or source decision. TargetWorkflow still rechecks ownership/context and
    // delegates consumption, configuration and rolls to the native system.
    const needsCasting = single && item.type === 'spell'
      && (spellLevel(item) > 0 || castingSources(actor, item).length > 0);
    if (single && !needsCasting) return Promise.resolve({ activityId: single.id,
      slot: null, sourceId: null, count: null, manual: false, nativeOnly: false });
    return new Promise(resolve => {
      this.pendingUse = { actor, item, group: groupFor(item), phase: single ? 'casting' : 'activity',
        activityId: single?.id, resolve, manual: false, count: '' };
      this.render();
    });
  }

  closeChoice() {
    const item = this.pendingUse?.item ?? this.pendingAllocation?.item;
    const actor = this.actor;
    this.pendingUse?.resolve(null); this.pendingUse = null;
    this.pendingAllocation?.resolve(null); this.pendingAllocation = null;
    this.dismissChoiceDialog();
    this.progress = null; this.choiceError = ''; this.tooltip.hide(); this.render();
    // The owning use promise releases its busy lock in microtasks. Restore
    // keyboard focus after that, without stealing it from another dialog.
    setTimeout(() => {
      if (!item || this.destroyed || this.actor !== actor || this.choiceDialog?.open || this.dialog?.open) return;
      [...(this.root?.querySelectorAll('[data-action="use"]') ?? [])]
        .find(control => control.dataset.itemId === item.id && !control.disabled)?.focus({ preventScroll: true });
    }, 0);
  }

  dismissChoiceDialog() {
    const dialog = this.choiceDialog;
    this.choiceDialog = null;
    // Clear identity before close: its queued close event must not cancel a
    // subsequent choice or an already accepted native use.
    if (dialog?.open) dialog.close();
    dialog?.remove();
  }

  syncChoiceDialog() {
    const state = this.pendingUse ?? this.pendingAllocation;
    if (!state) { this.dismissChoiceDialog(); return; }
    let dialog = this.choiceDialog;
    let created = false;
    if (dialog && dialog.choiceState === state && !dialog.open) {
      // Native close events are queued. A simultaneous document refresh must
      // honor cancellation rather than reopen the just-closed window.
      this.closeChoice(); return;
    }
    if (!dialog || dialog.choiceState !== state || !dialog.open) {
      this.dismissChoiceDialog();
      const title = this.pendingAllocation ? '分配目标' : '选择使用方式';
      dialog = modal(title, () => {
        if (this.choiceDialog !== dialog) return;
        this.choiceDialog = null;
        if (this.pendingUse === state || this.pendingAllocation === state) this.closeChoice();
      }, { restoreFocus: false });
      dialog.classList.add('bg3-video-hud-choice-dialog');
      dialog.choiceState = state;
      this.choiceDialog = dialog;
      created = true;
      dialog.addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        if (control && !control.disabled && control.dataset.action !== 'close-modal') this.run(() => this.click(control, event));
      });
    }
    const previous = dialog.querySelector('.bg3-video-hud-choice-body');
    const active = dialog.contains(document.activeElement) ? document.activeElement : null;
    const bodyHadFocus = previous?.contains(active) === true;
    const focusKey = active ? JSON.stringify({ data: active.dataset, label: active.getAttribute('aria-label'), type: active.type }) : null;
    const top = previous?.scrollTop ?? 0;
    const body = node('div', undefined, 'bg3-video-hud-choice-body');
    if (this.choiceError) {
      const error = node('p', this.choiceError, 'bg3-video-hud-choice-error'); error.setAttribute('role', 'alert'); body.append(error);
    }
    body.append(this.choicePanel(this.pendingUse, this.pendingAllocation));
    if (previous) previous.replaceWith(body); else dialog.append(body);
    body.scrollTop = top;
    const controls = [...body.querySelectorAll('button, input, select')];
    const focused = controls.find(control => JSON.stringify({ data: control.dataset,
      label: control.getAttribute('aria-label'), type: control.type }) === focusKey);
    if (!this.dialog?.open && (created || bodyHadFocus)) {
      const next = focused && !focused.disabled ? focused : controls.find(control => !control.disabled);
      next?.focus({ preventScroll: true });
      if (!focused || focused.disabled) next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  chooseActivity(id) {
    const state = this.pendingUse;
    if (!state || state.actor !== this.actor) return;
    const activity = usableActivities(state.item).find(a => a.id === id);
    if (!activity) throw new Error('此活动已不可用，请重新选择。');
    this.choiceError = ''; state.activityId = id;
    if (!this.detailed && !(state.item.type === 'spell'
      && (spellLevel(state.item) > 0 || castingSources(this.actor, state.item).length))) {
      this.finishChoice({}); return;
    }
    state.phase = 'casting'; this.render();
  }

  finishChoice(data) {
    const state = this.pendingUse;
    if (!state || state.actor !== this.actor) return;
    const choice = { activityId: state.activityId, slot: data.slot || null,
      sourceId: data.sourceId || null, count: state.count === '' ? null : Number(state.count), manual: state.manual,
      nativeOnly: data.nativeOnly === 'true' };
    const activity = usableActivities(state.item).find(a => a.id === state.activityId);
    nativeCastingOptions(this.actor, state.item, activity, choice);
    if (!choice.nativeOnly) sequencePlan(state.item, activity, { count: choice.count,
      level: Number(state.item.system.level || 0) + (nativeCastingOptions(this.actor, state.item, activity, choice).scaling || 0) });
    this.pendingUse = null; state.resolve(choice); this.render();
  }

  choicePanel(pending, allocation) {
    const row = node('div', undefined, 'bg3-video-hud-choice');
    row.dataset.scrollGroup = 'use-options';
    if (allocation) {
      row.append(node('strong', `${allocation.item.name} · 分配 ${allocation.allocation.length}/${allocation.count}`));
      if (allocation.consumed) row.append(node('small', '系统已调整施放参数；消耗以原生记录为准。'));
      for (const target of allocation.selected) {
        const line = node('div', undefined, 'bg3-video-hud-allocation-row');
        line.append(node('span', `${target.document?.name ?? target.name ?? '目标'} ×${allocation.allocation.filter(t => t === target).length}`),
          button('−', 'allocate-minus', '减少一次分配', { value: target.id }), button('+', 'allocate-plus', '分配一次给此目标', { value: target.id }));
        row.append(line);
      }
      row.append(button('撤回一次', 'allocate-undo'), button('取消', 'allocate-cancel'));
      const confirm = button(`施放（${allocation.allocation.length}/${allocation.count}）`, 'allocate-confirm');
      confirm.disabled = allocation.allocation.length !== allocation.count; row.append(confirm); return row;
    }
    const navigation = node('div');
    if (pending.phase !== 'activity') navigation.append(button('返回', 'back-choice'));
    navigation.append(button('取消', 'close-choice')); row.append(navigation);
    row.append(node('strong', pending.item.name ?? '使用物品'));
    const cards = node('div', undefined, 'bg3-video-hud-option-cards');
    if (pending.phase === 'activity') {
      const bundle = bundledActivity(pending.item);
      for (const activity of usableActivities(pending.item)) {
        const control = button(bundle?.id === activity.id ? `施放并结算 · ${activity.name || '施放'}` : (activity.name || '使用'),
          'choose-activity', '选择此原生活动', { value: activity.id });
        if (activity.img) { const img = node('img'); img.src = activity.img; img.alt = ''; control.prepend(img); }
        cards.append(control);
      }
    } else {
      const activity = usableActivities(pending.item).find(a => a.id === pending.activityId);
      const pools = castingPools(this.actor, pending.item, activity);
      for (const pool of pools) {
        const control = button(`${pool.label} · ${pool.value}/${pool.max}`, 'choose-cast', `用${pool.label}进入原生施放流程`, { slot: pool.key });
        this.decorateCastCard(control, pending.item, pool.level, pool.label, pool.value, pool.max);
        control.disabled = pool.value === 0; cards.append(control);
      }
      for (const source of castingSources(this.actor, pending.item)) {
        const control = button(`${source.item.name} · ${source.max ? `${source.remaining}/${source.max}` : '不限次数'}`,
          'choose-cast', `${source.level}环来源，消耗与恢复由系统处理`, { sourceId: source.item.id });
        this.decorateCastCard(control, pending.item, source.level, source.item.name, source.remaining, source.max);
        control.disabled = !source.enabled || (source.max && !source.remaining); cards.append(control);
      }
      if (!pools.length) cards.append(button('使用并结算', 'choose-cast', '选择目标后使用本次原生活动'));
      cards.append(button('原生使用／其他方式', 'choose-cast', '使用原生自动化，不启动本界面的重复结算', { nativeOnly: 'true' }));
      if (pending.item.type === 'spell') cards.append(button('管理免费来源', 'source-manager'));
      if (['attack', 'damage'].includes(activity?.type) || bundledActivity(pending.item)) {
        const settings = node('div', undefined, 'bg3-video-hud-sequence-options');
        const countLabel = node('label', '结算次数（空白为自动）：');
        const count = node('input'); count.type = 'number'; count.min = '1'; count.max = '20'; count.value = pending.count;
        count.setAttribute('aria-label', '自定义重复结算次数');
        count.oninput = () => { pending.count = count.value; }; countLabel.append(count);
        const modeLabel = node('label', '手动分配／撤回');
        const manual = node('input'); manual.type = 'checkbox'; manual.checked = pending.manual;
        manual.onchange = () => { pending.manual = manual.checked; }; modeLabel.prepend(manual);
        settings.append(countLabel, modeLabel); row.append(settings);
      }
    }
    row.append(cards); return row;
  }

  decorateCastCard(control, item, level, label, remaining, maximum) {
    control.replaceChildren();
    const emblem = node('span', undefined, 'bg3-video-hud-cast-emblem');
    if (item.img) { const image = node('img'); image.src = item.img; image.alt = ''; emblem.append(image); }
    emblem.append(node('b', ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][level] ?? '—'));
    const pips = node('span', undefined, 'bg3-video-hud-level-pips'); pips.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < Math.min(12, maximum || 0); i++) {
      const pip = node('i'); pip.classList.toggle('available', i < remaining); pips.append(pip);
    }
    control.append(emblem, node('span', label), node('small', maximum ? `剩余 ${remaining}/${maximum}` : '不限次数'), pips);
  }

  allocate({ item, selected, count, consumed }) {
    this.choiceError = '';
    return new Promise(resolve => {
      this.pendingAllocation = { item, selected, count, consumed, allocation: [], resolve };
      this.render();
    });
  }

  changeAllocation(id, direction) {
    const state = this.pendingAllocation; if (!state) return;
    const target = state.selected.find(t => t.id === id); if (!target) return;
    if (direction > 0 && state.allocation.length < state.count) state.allocation.push(target);
    else if (direction < 0) { const at = state.allocation.lastIndexOf(target); if (at >= 0) state.allocation.splice(at, 1); }
    this.render();
  }

  sourceManager() {
    const state = this.pendingUse;
    if (!state || state.actor !== this.actor || state.item.type !== 'spell') return;
    this.dialog?.close();
    const dialog = modal('免费施法来源', () => { if (this.dialog === dialog) this.dialog = null; }); this.dialog = dialog;
    const form = node('form'), selector = node('select'); selector.setAttribute('aria-label', '编辑已有来源');
    const add = node('option', '新建来源'); add.value = ''; selector.append(add);
    const sources = castingSources(this.actor, state.item).filter(s => s.managed);
    for (const source of sources) { const opt = node('option', source.item.name); opt.value = source.item.id; selector.append(opt); }
    form.append(selector);
    const fields = {};
    for (const [key, label, type] of [['name', '来源名称', 'text'], ['max', '次数上限（0 为不限）', 'number'],
      ['remaining', '剩余次数', 'number'], ['level', '施法环阶', 'number']]) {
      const box = node('label', label), input = node('input'); input.type = type; input.name = key; input.required = true;
      if (type === 'number') { input.min = key === 'level' ? String(state.item.system.level || 0) : '0'; input.max = key === 'level' ? '9' : '999'; input.step = '1'; }
      fields[key] = input; box.append(input); form.append(box);
    }
    const recovery = node('label', '恢复方式'), period = node('select');
    for (const [value, label] of Object.entries(RECOVERY)) { const opt = node('option', label); opt.value = value; period.append(opt); }
    recovery.append(period); form.append(recovery);
    const enabledLabel = node('label', '启用来源'), enabled = node('input'); enabled.type = 'checkbox'; enabledLabel.prepend(enabled); form.append(enabledLabel);
    const load = () => {
      const source = sources.find(s => s.item.id === selector.value);
      fields.name.value = source?.item.name ?? '免费施法'; fields.max.value = source?.max ?? 1;
      fields.remaining.value = source ? (source.remaining ?? 0) : 1; fields.level.value = source?.level ?? Number(state.item.system.level || 0);
      period.value = source?.item.system?.uses?.recovery?.[0]?.period ?? 'lr'; enabled.checked = source?.enabled ?? true;
    };
    const refreshRemaining = () => {
      const max = Number(fields.max.value); fields.remaining.disabled = max === 0;
      fields.remaining.max = String(Math.max(0, max));
      if (!max || Number(fields.remaining.value) > max) fields.remaining.value = Math.max(0, max);
    };
    selector.onchange = () => { load(); refreshRemaining(); }; fields.max.oninput = refreshRemaining;
    load(); refreshRemaining();
    const error = node('p'); error.setAttribute('role', 'alert');
    const save = node('button', '保存来源'); save.type = 'submit';
    const remove = button('删除所选来源', 'delete-source', '仅删除本模组创建的所选来源，需要再次确认');
    remove.disabled = true;
    selector.addEventListener('change', () => { remove.disabled = !selector.value; });
    remove.onclick = () => {
      const id = selector.value, selected = sources.find(s => s.item.id === id);
      if (!selected || save.disabled) return;
      const confirmation = modal('删除免费来源');
      confirmation.append(node('p', `删除“${selected.item.name}”？此操作仅删除这个专用来源特性，不删除法术。`));
      const confirm = button('确认删除', 'confirm-delete-source');
      const cancel = button('取消', 'cancel-delete-source'); cancel.onclick = () => confirmation.close();
      const issue = node('p'); issue.setAttribute('role', 'alert');
      confirm.onclick = async () => {
        if (confirm.disabled) return; confirm.disabled = true;
        try {
          if (this.actor !== state.actor || this.pendingUse !== state || !dialog.open) throw new Error('角色或物品已改变，请重新打开来源管理。');
          await deleteCastingSource(state.actor, state.item.id, this.user, id);
          confirmation.close(); dialog.close(); this.render();
        } catch (e) { issue.textContent = e.message; confirm.disabled = false; }
      };
      dialog.addEventListener('close', () => confirmation.close(), { once: true });
      confirmation.append(issue, cancel, confirm); cancel.focus();
    };
    form.append(node('small', '保存会创建或编辑此角色上的专用原生来源特性；实际施放、扣次和恢复交由系统。'), error, save);
    form.append(remove);
    form.onsubmit = async event => {
      event.preventDefault(); if (save.disabled) return; save.disabled = true;
      try {
        if (this.actor !== state.actor || this.pendingUse !== state) throw new Error('角色或物品已改变，请重新打开来源管理。');
        const input = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
        await saveCastingSource(state.actor, state.item.id, this.user, { ...input, period: period.value, enabled: enabled.checked }, selector.value || null);
        dialog.close(); if (this.actor === state.actor) this.render();
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    };
    dialog.append(form); fields.name.focus();
  }

  openParty() {
    this.dialog?.close(); const dialog = modal('队伍概览', () => { if (this.dialog === dialog) this.dialog = null; });
    this.dialog = dialog; dialog.append(partyRows(globalThis.game, this.user, () => dialog.close()));
  }

  chooseReactionSource(item, sources) {
    // One explicitly confirmed optional automation reaction at a time.
    if (this.reactionDialog?.open) return Promise.resolve(null);
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return; settled = true;
        if (this.reactionDialog === dialog) this.reactionDialog = null;
        if (dialog.open) dialog.close(); dialog.remove(); resolve(value);
      };
      const dialog = modal('护盾术反应 · 选择施法资源', () => finish(null));
      this.reactionDialog = dialog;
      dialog.append(node('p', '已进入原生反应流程。选择本次资源，取消将停止本次施放。'));
      const cards = node('div', undefined, 'bg3-video-hud-option-cards');
      for (const source of sources) {
        const control = button('', 'reaction-source', source.item.name, { sourceId: source.item.id });
        this.decorateCastCard(control, item, source.level, source.item.name, source.remaining, source.max);
        control.onclick = () => finish(source.item.id); cards.append(control);
      }
      const slot = button('使用法术位', 'reaction-slot'); slot.onclick = () => finish('slot');
      const cancel = button('取消施放', 'reaction-cancel'); cancel.onclick = () => finish(null);
      dialog.append(cards, slot, cancel); cancel.focus();
    });
  }

  openIntegrations() {
    this.dialog?.close(); const dialog = modal('骰子与动画联动', () => { if (this.dialog === dialog) this.dialog = null; }); this.dialog = dialog;
    for (const [id, label] of INTEGRATIONS) dialog.append(node('p', `${label}：${globalThis.game?.modules?.get(id)?.active ? '已启用' : '未启用'}`));
    dialog.append(node('p', '原生聊天／掷骰事件交给已安装的模组；不重复请求 3D 骰子或自动应用伤害。自动动画未启用时使用本界面的轻量投射与目标反馈。'));
  }

  itemRow(item, prefs, editing = true) {
    const row = node('li', undefined, 'bg3-video-hud-item');
    row.dataset.itemId = item.id;
    row.draggable = this.edit && editing;
    if (prefs.hidden.includes(item.id)) row.classList.add('bg3-video-hud-item-hidden');
    const detail = [item.name ?? '未命名物品', item.type === 'spell' ? `${spellLevel(item)}环法术` : (itemLabels[item.type] ?? '物品'),
      usesLabel(item)].filter(Boolean).join(' · ');
    const use = button('', 'use', detail, { itemId: item.id });
    use.className = 'bg3-video-hud-use';
    const initial = node('span', [...(item.name || '?')].slice(0, 2).join(''), 'bg3-video-hud-item-initial');
    initial.setAttribute('aria-hidden', 'true');
    use.append(initial);
    if (item.img) {
      use.classList.add('has-icon');
      const image = node('img');
      image.src = item.img;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); use.classList.remove('has-icon'); }, { once: true });
      use.append(image);
    }
    const label = node('span', item.name ?? '未命名物品', 'bg3-video-hud-item-label');
    use.append(label);
    const badge = node('span', item.type === 'spell' ? (['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][spellLevel(item)]) : item.type === 'weapon' ? '⚔' : '✦', 'bg3-video-hud-item-badge');
    badge.setAttribute('aria-hidden', 'true'); use.append(badge);
    if (usesLabel(item)) {
      use.append(node('small', usesLabel(item).replace(/ 次$/, ''), 'bg3-video-hud-uses'));
    }
    use.disabled = this.edit || this.busy.size > 0 || item.flags?.[MODULE_ID]?.castingSource?.enabled === false;
    row.append(use);
    if (this.edit && editing && (!this.editGroup || groupFor(item) === this.editGroup)) {
      const buttons = node('div', undefined, 'bg3-video-hud-edit-controls');
      const hidden = prefs.hidden.includes(item.id);
      const visibility = button(hidden ? '显示' : '隐藏', 'visibility', `${hidden ? '显示' : '隐藏'} ${item.name}`, { itemId: item.id });
      visibility.setAttribute('aria-pressed', String(!hidden));
      buttons.append(visibility);
      if (item.type === 'spell') {
        const pin = button(prefs.pinned.includes(item.id) ? '取消固定' : '固定', 'pin', `固定或取消固定 ${item.name}`, { itemId: item.id });
        pin.setAttribute('aria-pressed', String(prefs.pinned.includes(item.id)));
        buttons.append(pin);
      }
      buttons.append(button('↑', 'move', `上移 ${item.name}`, { itemId: item.id, direction: '-1' }),
        button('↓', 'move', `下移 ${item.name}`, { itemId: item.id, direction: '1' }));
      row.append(buttons);
    }
    return row;
  }

  async run(callback) {
    const actorUuid = this.actor?.uuid;
    try { await callback(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '系统未能完成此操作，请重试或从角色卡操作。';
      if (this.actor?.uuid === actorUuid) this.status = message;
      if (this.choiceDialog?.open) this.choiceError = message;
      if (this.editorDialog?.open) this.editorError = message;
      this.onError?.(message);
      try { this.render(); } catch { this.clear(); }
    }
  }

  async save(transform) {
    const actor = this.actor;
    if (this.edit && this.draft) {
      this.draft = normalizeLayout(transform(this.draft)); this.render(); return;
    }
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
      case 'cancel-target': this.targeting.cancel(); this.status = '已取消目标选择。'; this.render(); return;
      case 'sheet': return actor.sheet?.render({ force: true });
      case 'edit': return this.edit ? this.commitEdit() : this.beginEdit();
      case 'detailed': if (!this.busy.size && !this.edit && !this.saving) {
        this.detailed = !this.detailed; this.render();
      } return;
      case 'edit-group': return this.beginEdit(value);
      case 'save-edit': return this.commitEdit();
      case 'cancel-edit': this.edit = false; this.draft = null; this.editGroup = null; this.render(); return;
      case 'bulk-edit': return this.bulkEdit(value);
      case 'close-choice': this.closeChoice(); return;
      case 'choose-activity': return this.chooseActivity(value);
      case 'choose-cast': return this.finishChoice(control.dataset);
      case 'source-manager': return this.sourceManager();
      case 'back-choice': if (this.pendingUse) { this.pendingUse.phase = 'activity'; this.render(); } return;
      case 'allocate-plus': return this.changeAllocation(value, 1);
      case 'allocate-minus': return this.changeAllocation(value, -1);
      case 'allocate-undo': this.pendingAllocation?.allocation.pop(); this.render(); return;
      case 'allocate-confirm': if (this.pendingAllocation?.allocation.length === this.pendingAllocation?.count) {
        const state = this.pendingAllocation; this.pendingAllocation = null; state.resolve(state.allocation); this.render();
      } return;
      case 'allocate-cancel': { const state = this.pendingAllocation; this.pendingAllocation = null; state?.resolve(null); this.render(); return; }
      case 'stop-sequence': this.targeting.cancel(); this.status = '已请求停止后续结算，当前原生窗口请自行取消。'; this.render(); return;
      case 'party': this.openParty(); return;
      case 'integrations': this.openIntegrations(); return;
      case 'filter-action': this.action = value; this.render(); break;
      case 'filter-level': this.level = value === 'all' ? 'all' : Number(value); this.render(); break;
      case 'pinned-only': return this.save(p => ({ ...p, pinnedOnly: !p.pinnedOnly }));
      case 'visibility': if (this.edit) return this.save(p => ({ ...p, hidden: toggleId(p.hidden, itemId) })); break;
      case 'pin': if (this.edit) return this.save(p => ({ ...p, pinned: toggleId(p.pinned, itemId) })); break;
      case 'move': {
        if (!this.edit) return;
        const all = itemsFor(actor, this.draft ?? this.store.read(actor), { edit: true });
        const item = all.find(i => i.id === itemId);
        if (!item) return;
        const siblings = all.filter(i => groupFor(i) === groupFor(item));
        const index = siblings.findIndex(i => i.id === itemId);
        const target = siblings[index + Number(direction)];
        if (!target) return;
        // Moving down inserts after the following item; moving up inserts before it.
        await this.save(p => {
          const order = itemsFor(actor, p, { edit: true }).map(i => i.id);
          if (Number(direction) < 0) return { ...p, order: reorder(order, itemId, target.id) };
          const from = order.indexOf(itemId), to = order.indexOf(target.id);
          order.splice(from, 1); order.splice(to, 0, itemId);
          return { ...p, order };
        });
        // Deliberate keyboard/button ordering reveals the moved control after
        // all save-triggered renders. Unrelated updates preserve wheel position.
        if (this.actor?.uuid === actor.uuid) this.keepFocusVisible();
        return;
      }
      case 'use': if (!this.edit && !this.busy.size) return this.perform(`${actor.uuid}:${itemId}`, () => this.targeting.use(actor, itemId, event)); break;
      case 'end-turn': if (!this.busy.size) return this.perform(`${actor.uuid}:turn`, () => endTurn(actor, this.token, this.user, globalThis.game?.combat)); return;
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
