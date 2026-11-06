/** Restricted arithmetic for deterministic previews. No eval, functions or dice rolling. */
export function averageFormula(formula, data = {}, replace = globalThis.Roll?.replaceFormulaData) {
  let source = String(formula ?? '').trim();
  if (!source || source.length > 512) return null;
  if (source.includes('@')) {
    if (typeof replace !== 'function') return null;
    try { source = replace(source, data, { missing: 'NaN', warn: false }); } catch { return null; }
  }
  source = source.replace(/\b(\d*)d(\d+)\b/gi, (_, n, faces) => {
    const count = Number(n || 1), sides = Number(faces);
    return count <= 1000 && sides > 0 && sides <= 100000 ? `(${count}*${sides + 1}/2)` : 'NaN';
  });
  const tokens = source.match(/\d+(?:\.\d+)?|[()+*/-]/g);
  if (!tokens || tokens.join('') !== source.replace(/\s/g, '')) return null;
  let index = 0;
  const factor = () => {
    const token = tokens[index++];
    if (token === '+') return factor();
    if (token === '-') return -factor();
    if (token === '(') { const n = expression(); if (tokens[index++] !== ')') throw Error(); return n; }
    if (!/^\d/.test(token ?? '')) throw Error();
    return Number(token);
  };
  const term = () => { let n = factor(); while (['*', '/'].includes(tokens[index])) {
    const op = tokens[index++], r = factor(); n = op === '*' ? n * r : n / r;
  } return n; };
  const expression = () => { let n = term(); while (['+', '-'].includes(tokens[index])) {
    const op = tokens[index++], r = term(); n = op === '+' ? n + r : n - r;
  } return n; };
  try { const n = expression(); return index === tokens.length && Number.isFinite(n) ? n : null; }
  catch { return null; }
}

export function hitChance(bonus, ac, { advantage = false, disadvantage = false, critical = 20 } = {}) {
  if (!Number.isFinite(bonus) || !Number.isFinite(ac)) return null;
  let successes = 0;
  for (let die = 1; die <= 20; die++) if (die > 1 && (die >= critical || die + bonus >= ac)) successes++;
  const p = successes / 20;
  return advantage === disadvantage ? p : advantage ? 1 - (1 - p) ** 2 : p ** 2;
}

export function combatEstimate(activity, target, origin, canvas = globalThis.canvas, user = globalThis.game?.user) {
  const result = { chance: null, average: null, distance: null, range: null, blocked: null, mode: '普通', note: '基础估算；临时修正、抗性与额外规则以系统结算为准。' };
  // Visibility does not grant permission to expose target AC or private HP.
  const actor = target?.actor;
  const observe = !!actor && (user?.isGM || (typeof actor.testUserPermission === 'function'
    ? actor.testUserPermission(user, 'OBSERVER') : actor.isOwner === true));
  try {
    const attack = activity.getAttackData?.();
    const bonus = attack ? averageFormula(attack.parts.join('+'), attack.data) : null;
    const fields = globalThis.game?.dnd5e?.dataModels?.shared?.D20RollModificationField;
    const ability = activity.ability;
    const modes = fields?.combineFields?.(activity.actor.system,
      [`abilities.${ability}.attack.roll`, 'rolls.attack', `rolls.attack.${activity.actionType}`],
      { rules: { category: 'attack', actor: activity.actor, item: activity.item, rollData: activity.getRollData?.() } }) ?? {};
    result.mode = modes.advantage === modes.disadvantage ? '普通' : modes.advantage ? '优势' : '劣势';
    result.chance = observe ? hitChance(bonus, actor.system?.attributes?.ac?.value,
      { ...modes, critical: activity.criticalThreshold ?? 20 }) : null;
  } catch { /* Unknown/unsupported roll mechanics do not produce a guessed percentage. */ }
  try {
    const rolls = activity.getDamageConfig?.().rolls ?? [];
    const means = rolls.map(r => averageFormula(r.parts.join('+'), r.data));
    if (means.length && means.every(n => n !== null)) result.average = means.reduce((n, r) => n + r, 0);
  } catch { /* Keep the native roll available even when its preview is unsupported. */ }
  try {
    if (origin?.center && target?.center) {
      const measurement = canvas?.grid?.measurePath?.([origin.center, target.center]);
      result.distance = Number.isFinite(measurement?.distance) ? measurement.distance : null;
      result.blocked = origin.checkCollision?.(target.center, { type: 'sight', mode: 'any' }) ?? null;
      const range = activity.getUsageData?.().range ?? activity.range;
      const convert = globalThis.game?.dnd5e?.utils?.convertLength;
      if (range?.units && Number(range.value) > 0 && convert) {
        const maximum = Number(range.long) || Number(range.value);
        const converted = convert(maximum, range.units, canvas.scene.grid.units, { strict: false });
        if (Number.isFinite(converted) && result.distance !== null) result.range = result.distance <= converted;
      }
    }
  } catch { /* Distance/LOS unknown is distinct from a failed range check. */ }
  return result;
}
