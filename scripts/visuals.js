import { actorStats, canUseActor, values } from './model.js';
import { combatEstimate } from './estimates.js';
import { button, node } from './ui.js';

export class TargetVisuals {
  constructor({ user, getOrigin, getCanvas = () => globalThis.canvas }) {
    Object.assign(this, { user, getOrigin, getCanvas }); this.effects = new Set();
  }
  stop() { this.root?.remove(); this.root = null; this.markers?.remove(); this.markers = null; clearTimeout(this.markerTimer); }
  destroy() { this.stop(); for (const effect of this.effects) effect.remove(); this.effects.clear(); }
  project(point) {
    if (!point) return null;
    const canvas = this.getCanvas(), board = document.getElementById('board');
    const rect = board?.getBoundingClientRect(), screen = canvas?.app?.screen ?? canvas?.app?.renderer?.screen;
    const p = canvas?.stage?.worldTransform?.apply?.(point);
    return rect && screen?.width && p ? { x: rect.left + p.x * rect.width / screen.width,
      y: rect.top + p.y * rect.height / screen.height } : null;
  }
  preview(activity, point, target, progress = '') {
    this.stop();
    const origin = this.getOrigin?.(), start = this.project(origin?.center);
    if (!point) return;
    const root = node('div', undefined, 'bg3-video-hud-aim'); root.setAttribute('aria-hidden', 'true');
    if (start) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const line = document.createElementNS(svg.namespaceURI, 'line');
      for (const [key, value] of Object.entries({ x1: start.x, y1: start.y, x2: point.x, y2: point.y })) line.setAttribute(key, value);
      svg.append(line); root.append(svg);
    }
    const cursor = node('span', undefined, 'bg3-video-hud-aim-icon');
    if (activity?.img || activity?.item?.img) {
      const image = node('img'); image.src = activity.img || activity.item.img; image.alt = ''; cursor.append(image);
    } else cursor.append(node('span', '◎'));
    cursor.style.left = `${point.x + 14}px`; cursor.style.top = `${point.y + 14}px`; root.append(cursor);
    if (progress) {
      const badge = node('span', progress, 'bg3-video-hud-aim-count');
      badge.style.left = `${point.x + 45}px`; badge.style.top = `${point.y + 45}px`; root.append(badge);
    }
    if (target) {
      const estimate = combatEstimate(activity, target, origin, this.getCanvas(), this.user);
      const card = node('div', undefined, 'bg3-video-hud-aim-info');
      card.append(node('strong', target.name ?? target.document?.name ?? '目标'));
      const mayObserve = this.user?.isGM || target.actor?.testUserPermission?.(this.user, 'OBSERVER');
      if (mayObserve) { const stats = actorStats(target.actor); card.append(node('span', `生命 ${stats.hp}/${stats.maxHp} · 护甲 ${stats.ac}`)); }
      card.append(node('span', estimate.chance === null ? '命中率：未知' : `命中率·估算 ${Math.round(estimate.chance * 100)}% · ${estimate.mode}`));
      if (estimate.average !== null) card.append(node('span', `基础平均伤害 ${Number(estimate.average.toFixed(1))}`));
      const range = [estimate.distance !== null ? `距离 ${Number(estimate.distance.toFixed(1))} ${this.getCanvas()?.scene?.grid?.units ?? ''}` : '',
        estimate.range === false ? '超出基础射程' : '', estimate.blocked === true ? '视线受阻' : '', progress].filter(Boolean).join(' · ');
      if (range) card.append(node('span', range));
      card.title = estimate.note;
      card.style.left = `${Math.min(innerWidth - 240, Math.max(8, point.x + 34))}px`;
      card.style.top = `${Math.max(8, Math.min(innerHeight - 160, point.y - 100))}px`; root.append(card);
    }
    document.body.append(root); this.root = root;
  }
  status(target) {
    this.stop(); const point = this.project(target?.center); if (!point) return;
    const root = node('div', undefined, 'bg3-video-hud-aim'), card = node('div', undefined, 'bg3-video-hud-aim-info');
    card.append(node('strong', target.document?.name ?? target.name ?? '角色'));
    if (this.user?.isGM || target.actor?.testUserPermission?.(this.user, 'OBSERVER')) {
      const stats = actorStats(target.actor);
      card.append(node('span', `生命 ${stats.hp}/${stats.maxHp}${stats.tempHp ? `（临时+${stats.tempHp}）` : ''} · 护甲 ${stats.ac}`));
      const statuses = values(target.actor?.effects).filter(e => !e.disabled && e.name).map(e => e.name);
      if (statuses.length) card.append(node('small', statuses.slice(0, 6).join(' · ')));
    } else card.append(node('span', '详细状态不可查看'));
    card.style.left = `${Math.max(8, Math.min(innerWidth - 240, point.x + 24))}px`;
    card.style.top = `${Math.max(8, Math.min(innerHeight - 120, point.y - 80))}px`;
    root.append(card); document.body.append(root); this.root = root;
  }
  mark(progress) {
    this.markers?.remove(); clearTimeout(this.markerTimer);
    const root = node('div', undefined, 'bg3-video-hud-aim');
    const groups = new Map();
    progress.allocation.forEach((token, index) => { const group = groups.get(token) ?? []; group.push(index + 1); groups.set(token, group); });
    for (const [token, indices] of groups) {
      const point = this.project(token.center); if (!point) continue;
      const badge = node('span', `${progress.stage === 'done' ? '✓ ' : ''}${indices.join('·')}`, 'bg3-video-hud-aim-count');
      badge.style.left = `${point.x + 16}px`; badge.style.top = `${point.y - 30}px`; root.append(badge);
    }
    document.body.append(root); this.markers = root;
    if (['done', 'stopped', 'error'].includes(progress.stage)) this.markerTimer = setTimeout(() => { root.remove(); if (this.markers === root) this.markers = null; }, 1500);
  }
  pulse(targets, kind = 'cast') {
    // Let installed animation modules own their effects, avoiding duplicate VFX.
    if (globalThis.game?.modules?.get('autoanimations')?.active) return;
    const from = this.project(this.getOrigin?.()?.center);
    for (const target of targets) {
      const to = this.project(target.center); if (!to) continue;
      const effect = node('div', undefined, `bg3-video-hud-impact bg3-video-hud-impact-${kind}`);
      effect.style.left = `${to.x}px`; effect.style.top = `${to.y}px`; document.body.append(effect);
      this.effects.add(effect); setTimeout(() => { effect.remove(); this.effects.delete(effect); }, 650);
      if (from) {
        const beam = node('div', undefined, 'bg3-video-hud-projectile');
        beam.style.left = `${from.x}px`; beam.style.top = `${from.y}px`;
        beam.style.width = `${Math.hypot(to.x - from.x, to.y - from.y)}px`;
        beam.style.transform = `rotate(${Math.atan2(to.y - from.y, to.x - from.x)}rad)`;
        document.body.append(beam); this.effects.add(beam);
        setTimeout(() => { beam.remove(); this.effects.delete(beam); }, 450);
      }
    }
  }
}

export function partyMembers(game, user) {
  const characters = values(game?.users).map(u => u.character).filter(Boolean);
  return [...new Map(characters.map(a => [a.uuid, a])).values()].filter(a =>
    user?.isGM || a.testUserPermission?.(user, 'OBSERVER') || canUseActor(a, user));
}

export function partyRows(game, user, onSelect) {
  const list = node('div', undefined, 'bg3-video-hud-party');
  for (const actor of partyMembers(game, user)) {
    const row = node('div'), stats = actorStats(actor);
    if (actor.img) { const portrait = node('img'); portrait.src = actor.img; portrait.alt = actor.name ?? '角色'; row.append(portrait); }
    const control = button(actor.name ?? '角色', 'select-party', '选择此角色');
    const token = values(globalThis.canvas?.tokens?.placeables).find(t => t.actor === actor && t.visible && !t.document?.hidden);
    control.disabled = !canUseActor(actor, user) || !token;
    control.onclick = () => { if (token && canUseActor(actor, user) && token.visible
      && values(globalThis.canvas?.tokens?.placeables).includes(token)) { token.control({ releaseOthers: true }); onSelect?.(); } };
    row.append(control, node('span', `生命 ${stats.hp}/${stats.maxHp} · 护甲 ${stats.ac}`));
    const passive = actor.system?.skills?.prc?.passive;
    if (Number.isFinite(passive)) row.append(node('small', `被动察觉 ${passive}`));
    list.append(row);
  }
  if (!list.childElementCount) list.append(node('p', '没有可查看的已分配角色。'));
  return list;
}

export const INTEGRATIONS = [
  ['dice-so-nice', '3D 骰子'], ['autoanimations', '自动动画'], ['sequencer', 'Sequencer'], ['midi-qol', '战斗自动化']
];
