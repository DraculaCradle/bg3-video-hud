import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(manifest.id, 'bg3-video-hud');
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.compatibility.minimum, '14');
assert.equal(manifest.relationships.systems[0].compatibility.verified, '6.0.6');
assert.deepEqual(manifest.relationships.requires.map(r => r.id).sort(), ['bg3-hud-core', 'bg3-hud-dnd5e']);
for (const file of [...manifest.esmodules, ...manifest.styles]) assert.ok(existsSync(file), `Missing manifest asset: ${file}`);
let checked = 0;
for (const dir of ['scripts', 'tests', 'tools']) {
  for (const entry of readdirSync(dir, { recursive: true })) {
    if (!/\.(m?js)$/.test(entry)) continue;
    execFileSync(process.execPath, ['--check', `${dir}/${entry}`], { stdio: 'inherit' });
    checked++;
  }
}
console.log(`Manifest and ${checked} JavaScript files validated.`);
