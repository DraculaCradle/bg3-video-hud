import { MODULE_ID, canUseActor, values } from './model.js';
import { resolveOwnedItem, useOwnedItem } from './actions.js';
import { nativeCastingOptions, scaledActivity, sequencePlan, requireActor, usableActivities } from './casting.js';

// Read prepared system data, never evaluate formulas or infer rules from names.
export function targetPlan(activity) {
  const target = activity?.target;
  if (target?.template?.type) return { mode: 'area' };
  const affects = target?.affects;
  // Prepared D&D5e weapon attacks may leave affects.type empty. They still
  // require a map target; utility items with the same blank field do not.
  if (activity?.type === 'enchant' || affects?.type === 'object') return { mode: 'native' };
  if (!affects?.type && activity?.type === 'attack') return { mode: 'single', max: 1 };
  if (!affects?.type || affects.type === 'self' || affects.type === 'space') return { mode: 'native' };
  const count = affects.count;
  if (count === null || count === '' || count === undefined || count === 0) return { mode: 'multi', max: null };
  const max = Number(count);
  if (!Number.isSafeInteger(max) || max < 1) return { mode: 'native' };
  return { mode: max === 1 ? 'single' : 'multi', max };
}

export function visibleTargets(canvas) {
  const level = canvas.level?.id;
  return values(canvas.tokens?.placeables).filter(token => token.actor && token.visible === true
    && token.isVisible !== false && token.renderable !== false && !token.document?.hidden
    && token.document?.parent?.id === canvas.scene?.id
    && (!level || (token.document?._source?.level ?? token.document?.level?.id ?? token.document?.level) === level));
}

export function targetsInBox(tokens, start, end) {
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  // Explicit centre inclusion: edge overlap alone does not silently add a token.
  return tokens.filter(t => t.center && t.center.x >= left && t.center.x <= right
    && t.center.y >= top && t.center.y <= bottom);
}

function descriptors(tokens) {
  return tokens.map(t => ({ token: t.document.uuid, actor: t.actor.uuid,
    name: t.document.name, img: t.document.texture?.src,
    ac: t.actor.statuses?.has('coverTotal') ? null : (t.actor.system?.attributes?.ac?.value ?? null) }));
}

/** Client-only input controller. Selection never edits actors, items or scenes. */
export class TargetWorkflow {
  constructor({ user, onStatus, onError, current, getCanvas = () => globalThis.canvas,
    getSystem = () => globalThis.game?.dnd5e, hooks = globalThis.Hooks,
    chooseUse, allocate, onProgress, visuals }) {
    Object.assign(this, { user, onStatus, onError, current, getCanvas, getSystem, hooks,
      chooseUse, allocate, onProgress, visuals });
    this.sequence = 0;
    this.picking = false;
  }

  cancel() {
    this.sequence++;
    this.stopPicking?.();
    this.visuals?.stop();
  }

  async use(actor, itemId, event) {
    if (this.picking) return;
    const sequence = ++this.sequence;
    const canvas = this.getCanvas();
    const scene = canvas?.scene;
    const item = resolveOwnedItem(actor, itemId, this.user);
    if (item.flags?.[MODULE_ID]?.castingSource?.enabled === false) throw new Error('此施法来源已在本界面停用。');
    const activities = usableActivities(item);
    // Activity-less items still use their official chat-card workflow. Unknown
    // data never turns into a guessed attack or an invented resource operation.
    if (!activities.length) return useOwnedItem(actor, itemId, this.user, event);
    let activity = activities[0], choice = {};
    if (this.chooseUse && activities.some(a => a.type)) {
      choice = await this.chooseUse(actor, item, event);
      if (!choice) return;
      const freshItem = resolveOwnedItem(actor, itemId, this.user);
      if (freshItem !== item) throw new Error('物品已更改，请重新选择。');
      activity = values(freshItem.system?.activities).find(a => a.id === choice.activityId && a.canUse === true);
      if (!activity) throw new Error('请选择当前物品的可用活动。');
    } else if (activities.length > 1 && !event?.shiftKey) {
      const choice = this.getSystem()?.applications?.activity?.ActivityChoiceDialog;
      if (typeof choice?.create !== 'function') throw new Error('系统活动选择接口不可用，请从角色卡操作。');
      activity = await choice.create(item);
      if (!activity) return;
    }
    const active = () => sequence === this.sequence && this.current(actor)
      && this.getCanvas() === canvas && canvas.ready && canvas.scene === scene;
    if (!active()) return;
    const fresh = () => {
      const owned = resolveOwnedItem(actor, itemId, this.user);
      const found = values(owned.system?.activities).find(a => a.id === activity.id);
      if (found !== activity || activity.canUse !== true) throw new Error('活动已更改或不可用，请重新选择技能。');
    };
    fresh();
    const usage = nativeCastingOptions(actor, item, activity, choice);
    const preview = scaledActivity(activity, usage.scaling || 0);
    const repetition = choice.nativeOnly ? null : sequencePlan(item, activity, { level: (Number(item.system?.level) || 0) + (usage.scaling || 0),
      count: choice.count ?? null, mode: choice.mode ?? null });
    const profile = targetPlan(preview);
    const plan = repetition && repetition.count > 1 && profile.mode !== 'area'
      ? { mode: 'multi', max: repetition.count } : profile;
    if (plan.mode === 'native') return useOwnedItem(actor, itemId, this.user, event, activity.id, usage);
    if (typeof canvas.tokens?.setTargets !== 'function') throw new Error('当前场景的目标选择接口不可用。');

    if (plan.mode !== 'area') {
      const selected = await this.pick(canvas, plan, active, preview).finally(() => this.stopPicking?.());
      if (!selected || !active()) {
        if (active()) this.onStatus?.('已取消目标选择。');
        return;
      }
      fresh();
      if (JSON.stringify(targetPlan(scaledActivity(activity, usage.scaling || 0))) !== JSON.stringify(profile)) throw new Error('目标规则已更改，请重新选择技能。');
      const visible = new Set(visibleTargets(canvas));
      if (selected.some(t => !visible.has(t))) throw new Error('目标已离开场景或不可见，请重新选择。');
      const validated = nativeCastingOptions(actor, item, activity, choice);
      if (JSON.stringify(validated) !== JSON.stringify(usage)) throw new Error('施法方式已更改，请重新选择。');
      if (repetition) return this.settleSequence({ actor, item, activity, choice, usage,
        repetition, selected, active, event, canvas });
      canvas.tokens.setTargets(selected.map(t => t.id), { mode: 'replace' });
      this.onStatus?.(`已选择 ${selected.length} 个目标，交由系统处理。`);
      // Leave targets selected, just like Foundry's targeting tool. Restoring
      // here would race D&D5e's subsequent (not awaited) attack/roll dialogs.
      return useOwnedItem(actor, itemId, this.user, event, activity.id, usage);
    }

    // V14 / D&D5e 6 uses native Region templates. Do not make a second template
    // or consume before calling the native workflow. The nonce confines this
    // hook to this exact use, including another simultaneous use of the item.
    const nonce = `${this.user.id}:${sequence}:${globalThis.crypto.randomUUID()}`;
    const afterUse = (used, config, results) => {
      if (config?.bg3VideoHUD !== nonce) return;
      // A native dialog may outlive an actor/scene change. Preserve its native
      // consumption result, but stop this use's automatic subsequent rolls.
      if (!active()) {
        this.onError?.('操作者或场景已改变，已停止本次范围技能的后续自动动作；请核实系统消耗。', { stale: true });
        return false;
      }
      try {
        // Native consumption may reprepare/delete the embedded item or make
        // canUse false (last charge). Do not re-run pre-use eligibility here.
        if (!canUseActor(actor, this.user) || used?.id !== activity.id || used.item?.uuid !== item.uuid) {
          throw new Error('Activity context changed');
        }
        const regions = (results?.templates ?? []).filter(r => r.parent === scene && typeof r.testPoint === 'function');
        if (!regions.length) {
          this.onStatus?.('未完成范围放置，已停止后续自动动作；请核实系统消耗。');
          return false;
        }
        const selected = visibleTargets(canvas).filter(t => regions.some(r => r.testPoint({
          x: t.center.x, y: t.center.y, elevation: t.document.elevation ?? 0
        })));
        canvas.tokens.setTargets(selected.map(t => t.id), { mode: 'replace' });
        this.onStatus?.(`范围内已选择 ${selected.length} 个可见目标，交由系统处理。`);
        // The usage card was created before template placement. Update only this
        // workflow's card; subsequent native rolls now read the selected targets.
        Promise.resolve(results.message?.update?.({ 'system.targets': descriptors(selected) }))
          .catch(() => this.onError?.('目标已选择，但系统聊天卡更新失败，请核实原生聊天卡。', { stale: !active() }));
        if (!selected.length) return false;
      } catch {
        this.onError?.('范围目标读取失败，已停止后续自动动作；请核实原生目标与消耗，未重试使用技能。');
        return false;
      }
    };
    this.hooks.on('dnd5e.postUseActivity', afterUse);
    try {
      return await useOwnedItem(actor, itemId, this.user, event, activity.id, { ...usage, bg3VideoHUD: nonce });
    } finally {
      this.hooks.off('dnd5e.postUseActivity', afterUse);
    }
  }

  async settleSequence({ actor, item, activity, choice, usage, repetition, selected, active, event, canvas }) {
    if (globalThis.game?.modules?.get('midi-qol')?.active) {
      // Selection is still ours; enabled automation owns attack/damage and any
      // per-ray dispatcher. A normal weapon must not fail merely because an
      // explicit target count of one produced a sequence plan.
      if (choice.manual || choice.count) throw new Error('自定义重复次数／分配请使用原生自动化界面，避免与自动化的重复结算冲突。');
      requireActor(actor, this.user);
      const available = new Set(visibleTargets(canvas));
      if (!active() || selected.some(t => !available.has(t))) return;
      canvas.tokens.setTargets(selected.map(t => t.id), { mode: 'replace' });
      this.onStatus?.('目标已选择；攻击、伤害与重复施放交由已启用的原生自动化处理。');
      return useOwnedItem(actor, item.id, this.user, event, activity.id, usage);
    }
    const distribute = count => Array.from({ length: count }, (_, i) => selected[i % selected.length]);
    let allocation = choice.manual && this.allocate
      ? await this.allocate({ item, selected, count: repetition.count, consumed: false }) : distribute(repetition.count);
    if (!allocation || !active()) return;
    const validate = (allocation, count) => {
      const available = new Set(visibleTargets(canvas));
      if (allocation.length !== count || allocation.some(t => !selected.includes(t) || !available.has(t))) {
        throw new Error('目标分配已失效，请重新选择。');
      }
      requireActor(actor, this.user);
    };
    validate(allocation, repetition.count);
    const freshItem = resolveOwnedItem(actor, item.id, this.user);
    if (values(freshItem.system.activities).find(a => a.id === activity.id) !== activity
      || JSON.stringify(nativeCastingOptions(actor, freshItem, activity, choice)) !== JSON.stringify(usage)) {
      throw new Error('活动或施法来源已改变，请重新选择。');
    }
    const nonce = `${this.user.id}:${globalThis.crypto.randomUUID()}`;
    let used, results;
    const capture = (a, config, result) => {
      if (config.bg3VideoHUD !== nonce) return;
      if (a.id !== activity.id || a.item?.uuid !== item.uuid || !active()) return false;
      used = a; results = result;
    };
    this.hooks.on('dnd5e.postUseActivity', capture);
    let outcome;
    try {
      outcome = await useOwnedItem(actor, item.id, this.user, event, activity.id,
        { ...usage, subsequentActions: false, bg3VideoHUD: nonce, bg3Sequence: true });
    } finally { this.hooks.off('dnd5e.postUseActivity', capture); }
    if (!outcome || !used || !active()) return outcome;
    const final = sequencePlan(used.item, used, {
      level: used.getRollData?.().item?.level ?? ((Number(used.item.system.level) || 0) + (Number(used.item.flags?.dnd5e?.scaling) || 0)),
      count: choice.count ?? null, mode: choice.mode ?? null
    }) ?? repetition;
    if (allocation.length !== final.count) {
      allocation = choice.manual && this.allocate
        ? await this.allocate({ item, selected, count: final.count, consumed: true }) : distribute(final.count);
      if (!allocation || !active()) { this.onStatus?.('已停止分配；施法消耗以系统记录为准。'); return outcome; }
    }
    const roller = values(used.item.system.activities).find(a => a.id === final.rollerId);
    if (!roller) throw new Error('系统未返回本次施放的结算活动；请核实消耗，不会重新施放。');
    const deltas = results?.message?.system?.deltas ?? results?.message?.data?.system?.deltas;
    const consumed = used.createConsumedFlag?.(actor, deltas);
    if (consumed) used.item.updateSource?.({ 'flags.dnd5e.consumed': consumed });
    const step = (index, stage) => this.onProgress?.({ item, allocation, index, total: final.count, stage });
    let currentIndex = 0;
    try {
      for (let index = 0; index < allocation.length; index++) {
        currentIndex = index;
        if (!active()) { step(index, 'stopped'); return outcome; }
        validate(allocation, final.count);
        canvas.tokens.setTargets([allocation[index].id], { mode: 'replace' });
        const message = { data: { system: { origin: results?.message?.id },
          flags: { 'bg3-video-hud': { sequence: { index: index + 1, total: final.count } } } } };
        let attack;
        if (final.method === 'attack') {
          step(index, 'attack');
          const rolls = await roller.rollAttack({ event }, {}, message);
          if (!rolls?.length || !active()) { step(index, 'stopped'); return outcome; }
          attack = rolls[0];
          if (attack.isFumble || (attack.isSuccess === false && Number.isFinite(attack.options?.target))) continue;
        }
        requireActor(actor, this.user);
        step(index, 'damage');
        const rolls = await roller.rollDamage({ event, isCritical: attack?.isCritical === true,
          ...Object.fromEntries(['ability', 'ammunition', 'attackMode', 'mastery']
            .filter(key => attack?.options?.[key] !== undefined).map(key => [key, attack.options[key]])),
          ...(final.damageScaling !== undefined ? { scaling: final.damageScaling } : {}) }, {}, message);
        if (!rolls?.length || !active()) { step(index, 'stopped'); return outcome; }
      }
      step(final.count, 'done');
      this.onStatus?.(`已完成 ${final.count} 次原生结算；伤害应用请查看系统聊天卡。`);
      return outcome;
    } catch (error) { step(currentIndex, 'error'); throw error; }
    finally {
      if (active()) {
        const visible = new Set(visibleTargets(canvas));
        canvas.tokens.setTargets(selected.filter(t => visible.has(t)).map(t => t.id), { mode: 'replace' });
      }
    }
  }

  pick(canvas, plan, active, activity = null) {
    const board = document.getElementById('board');
    if (!board || typeof canvas.stage?.worldTransform?.applyInverse !== 'function') {
      throw new Error('地图尚未就绪，无法选择目标。');
    }
    this.picking = true;
    const abort = new AbortController();
    const rectangle = document.createElement('div');
    rectangle.className = 'bg3-video-hud-target-box';
    rectangle.setAttribute('aria-hidden', 'true');
    rectangle.hidden = true;
    document.body.append(rectangle);
    const previousCursor = board.style.cursor;
    board.style.cursor = 'crosshair';
    const instruction = plan.mode === 'single' ? '点击地图上的目标执行；Esc 或右键取消。'
      : `拖拽框选范围，松开后自动选择并执行${plan.max ? `（最多 ${plan.max} 个）` : ''}；Esc 或右键取消。`;
    let start, pointer;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        abort.abort(); rectangle.remove();
        this.visuals?.stop();
        if (board.style.cursor === 'crosshair') board.style.cursor = previousCursor;
        if (pointer !== undefined && board.hasPointerCapture?.(pointer)) board.releasePointerCapture(pointer);
        this.stopPicking = null; this.picking = false;
        if (error) reject(error);
        else resolve(value);
      };
      this.stopPicking = () => finish(null);
      this.onStatus?.(instruction);
      const intercept = event => { event.preventDefault(); event.stopImmediatePropagation(); };
      const point = event => {
        const rect = board.getBoundingClientRect();
        const screen = canvas.app?.screen ?? canvas.app?.renderer?.screen;
        if (!rect.width || !rect.height || !screen?.width || !screen?.height) throw new Error('地图坐标不可用。');
        return canvas.stage.worldTransform.applyInverse({
          x: (event.clientX - rect.left) * screen.width / rect.width,
          y: (event.clientY - rect.top) * screen.height / rect.height
        });
      };
      const options = { capture: true, signal: abort.signal };
      const safe = callback => event => {
        try { callback(event); }
        catch (error) { finish(null, error); }
      };
      board.addEventListener('pointerdown', safe(event => {
        intercept(event);
        if (event.button === 2) { finish(null); return; }
        if (event.button !== 0 || pointer !== undefined || !active()) return;
        pointer = event.pointerId;
        start = { clientX: event.clientX, clientY: event.clientY, world: point(event) };
        board.setPointerCapture?.(pointer);
      }), options);
      board.addEventListener('pointermove', safe(event => {
        intercept(event);
        const world = point(event);
        const hovered = visibleTargets(canvas).filter(t => t.bounds?.contains(world.x, world.y)).at(-1);
        const count = start && plan.mode === 'multi' ? targetsInBox(visibleTargets(canvas), start.world, world).length : null;
        this.visuals?.preview(activity, { x: event.clientX, y: event.clientY }, hovered,
          count === null ? '' : `${count}${plan.max ? `/${plan.max}` : ''}`);
        if (!start || pointer !== event.pointerId || plan.mode !== 'multi') return;
        rectangle.hidden = false;
        Object.assign(rectangle.style, {
          left: `${Math.min(start.clientX, event.clientX)}px`, top: `${Math.min(start.clientY, event.clientY)}px`,
          width: `${Math.abs(start.clientX - event.clientX)}px`, height: `${Math.abs(start.clientY - event.clientY)}px`
        });
      }), options);
      board.addEventListener('pointerup', safe(event => {
        intercept(event);
        if (!start || pointer !== event.pointerId) return;
        const origin = start, id = pointer;
        start = undefined; pointer = undefined; rectangle.hidden = true;
        if (board.hasPointerCapture?.(id)) board.releasePointerCapture(id);
        if (!active()) { finish(null); return; }
        const end = point(event), tokens = visibleTargets(canvas);
        let selected;
        if (plan.mode === 'single') {
          if (Math.hypot(origin.clientX - event.clientX, origin.clientY - event.clientY) > 5) return;
          selected = tokens.filter(t => t.bounds?.contains(end.x, end.y)).slice(-1);
        } else {
          if (Math.abs(origin.clientX - event.clientX) < 4 || Math.abs(origin.clientY - event.clientY) < 4) return;
          selected = targetsInBox(tokens, origin.world, end);
        }
        if (!selected.length) { this.onStatus?.(`范围内没有可见目标。${instruction}`); return; }
        if (plan.max && selected.length > plan.max) {
          this.onStatus?.(`已框选 ${selected.length} 个，最多 ${plan.max} 个；请缩小选区。`); return;
        }
        finish(selected);
      }), options);
      board.addEventListener('pointercancel', () => finish(null), options);
      board.addEventListener('lostpointercapture', () => { if (start) finish(null); }, options);
      // A wheel/resize can change scene-to-screen coordinates mid-drag. Cancel
      // the selection before allowing normal map/browser navigation to proceed.
      board.addEventListener('wheel', () => finish(null), options);
      globalThis.addEventListener('blur', () => finish(null), { signal: abort.signal });
      globalThis.addEventListener('resize', () => finish(null), { signal: abort.signal });
      board.addEventListener('contextmenu', event => { intercept(event); finish(null); }, options);
      document.addEventListener('keydown', event => {
        if (event.target?.closest?.('dialog[open]')) return;
        if (event.key === 'Escape') { intercept(event); finish(null); }
      }, options);
    });
  }
}
