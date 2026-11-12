/** Distribution guard: no class-specific scripts or sample macros in the module. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'module.json'), 'utf8'));
assert.equal(manifest.id, 'pf1-automation-engine');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'Version semver valide attendue');
assert.ok(!manifest.esmodules.some(p => p.endsWith('combat-hooks.js')));
for (const p of manifest.esmodules) assert.ok(fs.existsSync(path.join(root, p)), `Missing runtime script ${p}`);
assert.ok(!fs.existsSync(path.join(root, 'scripts/combat-hooks.js')));
assert.ok(!fs.existsSync(path.join(root, 'macros/enregistrer-cold-adaptation.js')));
for (const name of manifest.esmodules) {
  const body = fs.readFileSync(path.join(root, name), 'utf8');
  assert.doesNotMatch(body, /kineticistGatherPower|Cold Adaptation|Shroud of Water|Accumulation de pouvoir/i, `Class-specific logic in ${name}`);
}

assert.ok(!manifest.esmodules.includes('scripts/reload-core.js'),
  'PF1AE must not load its old reload hooks after delegation');
assert.ok(manifest.esmodules.includes('scripts/reload-adapter.js'),
  'PF1AE must preserve a backward-compatible reload API adapter');
const adapter=fs.readFileSync(path.join(root,'scripts/reload-adapter.js'),'utf8');
assert.match(adapter,/reloadDelegated\s*=\s*true/,
  'PF1AE must explicitly advertise that old reload hooks were removed');
assert.doesNotMatch(adapter,/Hooks\.on\(['"]pf1(?:CreateActionUse|PreActionUse|PostActionUse)/,
  'compatibility adapter must not install a second reload event handler');

console.log('PASS: manifest, reload delegation and runtime scripts are class-neutral');
