export const MIN_FOUNDRY = '14.367';
export const TARGET_FOUNDRY = '14.370';
export const MIN_DND5E = '6.0.6';
export const TARGET_DND5E = '6.1.1';

const supportedSystems = new Set([MIN_DND5E, '6.1.0', TARGET_DND5E]);

export function supportsHUD(foundryVersion, systemId, systemVersion) {
  if (systemId !== 'dnd5e' || !supportedSystems.has(systemVersion)) return false;
  const match = /^14\.(\d+)$/.exec(String(foundryVersion));
  return Boolean(match && Number(match[1]) >= Number(MIN_FOUNDRY.split('.')[1]));
}
