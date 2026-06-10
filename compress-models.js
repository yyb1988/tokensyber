// Batch compress all 29 GLB models: DRACO + WebP textures + 2K resolution
// Usage: node compress-models.js [--dry-run]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const manifest = JSON.parse(fs.readFileSync('models/manifest.json', 'utf-8'));
const dryRun = process.argv.includes('--dry-run');

const models = manifest.map(m => ({
  id: m.id,
  name: m.name,
  file: m.file,
  rarity: m.rarity,
}));

console.log(`Found ${models.length} models to compress${dryRun ? ' (DRY RUN)' : ''}\n`);

let totalOriginal = 0;
let totalCompressed = 0;
const results = [];

for (let i = 0; i < models.length; i++) {
  const { id, name, file, rarity } = models[i];
  const idx = `${i + 1}/${models.length}`;

  if (!fs.existsSync(file)) {
    console.log(`[${idx}] SKIP ${id} - file not found: ${file}`);
    results.push({ id, name, status: 'skip', reason: 'file not found' });
    continue;
  }

  const origSize = fs.statSync(file).size;
  totalOriginal += origSize;
  const origMB = (origSize / 1024 / 1024).toFixed(1);

  const dir = path.dirname(file);
  const basename = path.basename(file);
  const tmpFile = path.join(dir, basename.replace('.glb', '-tmp.glb'));
  const bakFile = path.join(dir, basename.replace('.glb', '.glb.bak'));

  console.log(`[${idx}] ${id} (${rarity}, ${origMB} MB)...`);

  if (dryRun) {
    results.push({ id, name, origMB, status: 'would-compress' });
    continue;
  }

  try {
    // Compress to temp file
    const cmd = `npx gltf-transform optimize "${file}" "${tmpFile}" --compress draco --texture-compress webp --texture-size 2048`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 });
    const infoLine = output.split('\n').find(l => l.includes('→'));
    console.log(`  ${infoLine ? infoLine.trim() : 'done'}`);

    const newSize = fs.statSync(tmpFile).size;
    totalCompressed += newSize;
    const newMB = (newSize / 1024 / 1024).toFixed(1);
    const ratio = (origSize / newSize).toFixed(1);

    // Backup original then replace with compressed
    fs.renameSync(file, bakFile);
    fs.renameSync(tmpFile, file);

    console.log(`  ${origMB} → ${newMB} MB (${ratio}x) ✓`);
    results.push({ id, name, origMB, newMB, ratio, status: 'ok' });
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    // Clean up temp file if exists
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    results.push({ id, name, origMB, status: 'error', error: err.message });
  }
}

// Summary
console.log('\n========================================');
console.log('SUMMARY');
console.log('========================================');
const ok = results.filter(r => r.status === 'ok');
const skipped = results.filter(r => r.status === 'skip');
const errors = results.filter(r => r.status === 'error');

console.log(`Total: ${models.length} | OK: ${ok.length} | Skipped: ${skipped.length} | Errors: ${errors.length}`);

if (!dryRun && ok.length > 0) {
  const origTotal = (totalOriginal / 1024 / 1024 / 1024).toFixed(2);
  const compTotal = (totalCompressed / 1024 / 1024).toFixed(1);
  const overallRatio = (totalOriginal / totalCompressed).toFixed(1);
  console.log(`Original: ${(totalOriginal/1024/1024/1024).toFixed(2)} GB → Compressed: ${compTotal} MB (${overallRatio}x)`);
  console.log(`Backups saved as .glb.bak alongside each compressed file`);
}

if (errors.length > 0) {
  console.log('\nErrors:');
  errors.forEach(e => console.log(`  ${e.id}: ${e.error}`));
}
