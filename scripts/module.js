import { MODULE_ID, selectActor, values } from './model.js';
import { LayoutStore } from './persistence.js';
import { VideoHUD } from './hud.js';
import { reactionResources } from './reactions.js';

let hud;
let canvasReady = false;
let refreshQueued = false;
let compatibilityWarning = false;
let selectionWarning = null;
let renderFailed = false;

function compatible() {
  return game.system?.id === 'dnd5e' && String(game.version).split('.')[0] === '14'
    && game.system.version === '6.0.6';
}

// Explicitly safe for support: no actor/user names, IDs, flags or credentials.
function status() {
  const tokens = values(globalThis.canvas?.tokens?.controlled);
  const owned = tokens.filter(t => selectActor([t], game.user));
  const assignedOwner = !!selectActor([], game.user);
  const enabled = game.settings.get(MODULE_ID, 'enabled') === true;
  const ready = canvasReady && globalThis.canvas?.ready === true;
  const reason = !enabled ? 'disabled' : !compatible() ? 'incompatible'
    : !ready ? 'canvas-not-ready' : tokens.length && !owned.length ? 'selected-not-owned'
    : !owned.length && !assignedOwner ? 'no-owned-character' : renderFailed ? 'render-error' : 'ready';
  return { version: game.modules.get(MODULE_ID)?.version, enabled, compatible: compatible(),
    canvasReady: ready, controlled: tokens.length, owned: owned.length, assignedOwner,
    hudVisible: !!hud?.root?.isConnected, reason };
}

function refresh() {
  if (!hud) return;
  try {
    if (!game.settings.get(MODULE_ID, 'enabled')) { selectionWarning = null; hud.clear(); return; }
    if (!compatible()) {
      hud.clear();
      if (!compatibilityWarning) {
        compatibilityWarning = true;
        ui.notifications.warn('请使用 Foundry VTT V14 和 D&D5e 6.0.6。无需安装其他 HUD 模组。');
      }
      return;
    }
    const tokens = values(globalThis.canvas?.tokens?.controlled);
    const actor = selectActor(tokens, game.user, canvasReady);
    const token = tokens.find(t => t.actor === actor) ?? null;
    if (!actor && canvasReady) {
      const reason = tokens.length ? 'selected-not-owned' : 'no-owned-character';
      if (selectionWarning !== reason) {
        selectionWarning = reason;
        ui.notifications.warn(tokens.length
          ? 'BG3 视频界面：所选 Token 没有关联可操作的角色，或当前账号没有该角色的 OWNER（所有者）权限。请由 GM 核实角色权限。'
          : 'BG3 视频界面：请先选择拥有 OWNER（所有者）权限的角色 Token，或让 GM 为当前玩家分配角色。');
      }
    } else if (actor) selectionWarning = null;
    hud.setActor(actor, token);
    renderFailed = false;
  } catch (error) {
    renderFailed = true;
    hud.clear(); // Restore the native/optional HUD rather than stranding the player.
    ui.notifications.error(`BG3 视频界面：${error.message}`);
  }
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => { refreshQueued = false; refresh(); });
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'enabled', {
    name: '启用 BG3 视频界面',
    hint: '默认关闭。可在任意世界手动开启，仅对当前客户端生效；需 Foundry VTT V14 与 D&D5e 6.0.6。关闭后恢复原版界面。',
    scope: 'client', config: true, type: Boolean, default: false, onChange: scheduleRefresh
  });
  game.keybindings.register(MODULE_ID, 'toggle', {
    name: '切换 BG3 视频界面', editable: [],
    onDown: () => { toggle().catch(e => ui.notifications.error(e.message)); return true; }
  });
});

async function toggle() {
  await game.settings.set(MODULE_ID, 'enabled', !game.settings.get(MODULE_ID, 'enabled'));
}

Hooks.once('ready', () => {
  canvasReady = globalThis.canvas?.ready === true;
  hud = new VideoHUD({
    user: game.user, store: new LayoutStore(game.user),
    onDisable: () => game.settings.set(MODULE_ID, 'enabled', false),
    onError: message => ui.notifications.error(`BG3 视频界面：${message}`)
  });
  // Small public API for macros; no upstream source imports or monkey patches.
  game.modules.get(MODULE_ID).api = Object.freeze({ toggle, refresh: scheduleRefresh, status });
  refresh();
});

Hooks.on('getSceneControlButtons', controls => {
  if (!controls.tokens?.tools) return;
  controls.tokens.tools.bg3VideoHUD = {
    name: 'bg3VideoHUD', title: '切换 BG3 视频界面', icon: 'fas fa-table-cells',
    // A momentary button reads the current setting each click. A cached toggle's
    // active state could become stale after the HUD button or a macro disables it.
    button: true, order: 101,
    onChange: () => toggle()
  };
});

Hooks.on('canvasReady', () => { canvasReady = true; scheduleRefresh(); });
Hooks.on('canvasTearDown', () => { canvasReady = false; hud?.clear(); });
for (const event of ['controlToken', 'deleteToken', 'updateToken', 'updateActor', 'deleteActor',
  'createItem', 'updateItem', 'deleteItem', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect',
  'updateUser', 'updateCombat', 'deleteCombat']) Hooks.on(event, scheduleRefresh);
Hooks.on('dnd5e.postUseActivity', (activity, config, results) => {
  if (!hud || !compatible()) return;
  hud.ledger.observe(activity, config, results, game.user, game.combat);
  if (activity.actor === hud.actor && !config.bg3Sequence && activity.type !== 'attack') {
    queueMicrotask(() => {
      if (activity.actor === hud?.actor) hud.visuals.pulse(values(game.user.targets), activity.type === 'heal' ? 'heal' : 'cast');
    });
  }
  scheduleRefresh();
});
Hooks.on('dnd5e.postRollAttack', (_rolls, { subject } = {}) => {
  if (hud && compatible() && subject?.actor === hud.actor) hud.visuals.pulse(values(game.user.targets), 'attack');
});
Hooks.on('hoverToken', (token, hovered) => {
  if (!hud?.root?.isConnected || !compatible() || hud.targeting.picking) return;
  if (hovered && token.visible && !token.document?.hidden) hud.visuals.status(token);
  else hud.visuals.stop();
});
globalThis.addEventListener('beforeunload', () => hud?.destroy());

Hooks.on('midi-qol.preItemRollV2', async payload => {
  if (!compatible() || !hud?.root?.isConnected || !game.modules.get('midi-qol')?.active) return;
  try {
    const actor = hud.actor, token = hud.token, scene = globalThis.canvas?.scene;
    return await reactionResources(payload, { user: game.user,
      current: subject => compatible() && hud?.root?.isConnected && subject === actor
        && hud.actor === actor && hud.token === token && globalThis.canvas?.scene === scene,
      choose: (item, sources) => hud.chooseReactionSource(item, sources) });
  } catch (error) {
    ui.notifications.error(`BG3 视频界面：${error.message}`);
    return false;
  }
});
