import { MODULE_ID, selectActor, values } from './model.js';
import { LayoutStore } from './persistence.js';
import { VideoHUD } from './hud.js';

let hud;
let canvasReady = false;
let refreshQueued = false;
let compatibilityWarning = false;

// This test module is intentionally inert outside ModsTest, even if an
// administrator accidentally enables it elsewhere. Deployment also checks the
// exact world id; no other world's enablement/settings/documents are changed.
function testWorld() { return game.world?.title === 'ModsTest'; }

function compatible() {
  return testWorld() && game.system?.id === 'dnd5e' && String(game.version).split('.')[0] === '14'
    && game.system.version === '6.0.6'
    && ['bg3-hud-core', 'bg3-hud-dnd5e'].every(id => game.modules.get(id)?.active);
}

function refresh() {
  if (!hud) return;
  if (!testWorld()) { hud.clear(); return; }
  try {
    if (!game.settings.get(MODULE_ID, 'enabled')) { hud.clear(); return; }
    if (!compatible()) {
      hud.clear();
      if (!compatibilityWarning) {
        compatibilityWarning = true;
        ui.notifications.warn('请使用 Foundry VTT V14、D&D5e 6.0.6，并启用 BG3 HUD Core 和 D&D5e 依赖。');
      }
      return;
    }
    const tokens = values(globalThis.canvas?.tokens?.controlled);
    const actor = selectActor(tokens, game.user, canvasReady);
    const token = tokens.find(t => t.actor === actor) ?? null;
    hud.setActor(actor, token);
  } catch (error) {
    hud.clear(); // Fail open to upstream HUD rather than stranding the player.
    ui.notifications.error(`BG3 视频界面：${error.message}`);
  }
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => { refreshQueued = false; refresh(); });
}

Hooks.once('init', () => {
  if (!testWorld()) return;
  game.settings.register(MODULE_ID, 'enabled', {
    name: '启用 BG3 视频界面',
    hint: '仅对当前客户端生效。关闭后恢复原版界面，不修改原版设置或布局。',
    scope: 'client', config: true, type: Boolean, default: false, onChange: scheduleRefresh
  });
  game.keybindings.register(MODULE_ID, 'toggle', {
    name: '切换 BG3 视频界面', editable: [],
    onDown: () => { toggle().catch(e => ui.notifications.error(e.message)); return true; }
  });
});

async function toggle() {
  if (!testWorld()) return;
  await game.settings.set(MODULE_ID, 'enabled', !game.settings.get(MODULE_ID, 'enabled'));
}

Hooks.once('ready', () => {
  if (!testWorld()) return;
  canvasReady = globalThis.canvas?.ready === true;
  hud = new VideoHUD({
    user: game.user, store: new LayoutStore(game.user),
    onDisable: () => game.settings.set(MODULE_ID, 'enabled', false),
    onError: message => ui.notifications.error(`BG3 视频界面：${message}`)
  });
  // Small public API for macros; no upstream source imports or monkey patches.
  game.modules.get(MODULE_ID).api = Object.freeze({ toggle, refresh: scheduleRefresh });
  refresh();
});

Hooks.on('getSceneControlButtons', controls => {
  if (!testWorld()) return;
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
