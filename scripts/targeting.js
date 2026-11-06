import { canUseActor, values } from './model.js';
import { resolveOwnedItem, useOwnedItem } from './actions.js';

// Read prepared system data, never evaluate formulas or infer rules from names.
export function targetPlan(activity) {
  const target = activity?.target;
  if (target?.template?.type) return { mode: 'area' };
  const affects = target?.affects;
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
    getSystem = () => globalThis.game?.dnd5e, hooks = globalThis.Hooks }) {
    Object.assign(this, { user, onStatus, onError, current, getCanvas, getSystem, hooks });
    this.sequence = 0;
    this.picking = false;
  }

  cancel() {
    this.sequence++;
    this.stopPicking?.();
  }

  async use(actor, itemId, event) {
    if (this.picking) return;
    const sequence = ++this.sequence;
    const canvas = this.getCanvas();
    const scene = canvas?.scene;
    const item = resolveOwnedItem(actor, itemId, this.user);
    const activities = values(item.system?.activities).filter(a => a.canUse === true && typeof a.use === 'function');
    // Activity-less items still use their official chat-card workflow. Unknown
    // data never turns into a guessed attack or an invented resource operation.
    if (!activities.length) return useOwnedItem(actor, itemId, this.user, event);
    let activity = activities[0];
    if (activities.length > 1 && !event?.shiftKey) {
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
    const plan = targetPlan(activity);
    if (plan.mode === 'native') return useOwnedItem(actor, itemId, this.user, event, activity.id);
    if (typeof canvas.tokens?.setTargets !== 'function') throw new Error('当前场景的目标选择接口不可用。');

    if (plan.mode !== 'area') {
      const selected = await this.pick(canvas, plan, active).finally(() => this.stopPicking?.());
      if (!selected || !active()) {
        if (active()) this.onStatus?.('已取消目标选择。');
        return;
      }
      fresh();
      if (JSON.stringify(targetPlan(activity)) !== JSON.stringify(plan)) throw new Error('目标规则已更改，请重新选择技能。');
      const visible = new Set(visibleTargets(canvas));
      if (selected.some(t => !visible.has(t))) throw new Error('目标已离开场景或不可见，请重新选择。');
      canvas.tokens.setTargets(selected.map(t => t.id), { mode: 'replace' });
      this.onStatus?.(`已选择 ${selected.length} 个目标，交由系统处理。`);
      // Leave targets selected, just like Foundry's targeting tool. Restoring
      // here would race D&D5e's subsequent (not awaited) attack/roll dialogs.
      return useOwnedItem(actor, itemId, this.user, event, activity.id);
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
      return await useOwnedItem(actor, itemId, this.user, event, activity.id, { bg3VideoHUD: nonce });
    } finally {
      this.hooks.off('dnd5e.postUseActivity', afterUse);
    }
  }

  pick(canvas, plan, active) {
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
        if (event.key === 'Escape') { intercept(event); finish(null); }
      }, options);
    });
  }
}
