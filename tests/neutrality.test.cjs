/** Distribution guard: no class-specific scripts or sample macros in the module. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'module.json'), 'utf8'));
assert.equal(manifest.id, 'pf1-automation-engine');
assert.equal(manifest.version, '1.5.1');
assert.ok(!manifest.esmodules.some(p => p.endsWith('combat-hooks.js')));
for (const p of manifest.esmodules) assert.ok(fs.existsSync(path.join(root, p)), `Missing runtime script ${p}`);
assert.ok(!fs.existsSync(path.join(root, 'scripts/combat-hooks.js')));
assert.ok(!fs.existsSync(path.join(root, 'macros/enregistrer-cold-adaptation.js')));
for (const name of manifest.esmodules) {
  const body = fs.readFileSync(path.join(root, name), 'utf8');
  assert.doesNotMatch(body, /kineticistGatherPower|Cold Adaptation|Shroud of Water|Accumulation de pouvoir/i, `Class-specific logic in ${name}`);
}
console.log('PASS: manifest and runtime scripts are class-neutral; legacy files absent');
