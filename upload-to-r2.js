// Batch upload all compressed GLB models to R2 via wrangler
// Usage: node upload-to-r2.js [--dry-run]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const manifest = JSON.parse(fs.readFileSync('models/manifest.json', 'utf-8'));
const dryRun = process.argv.includes('--dry-run');

const BUCKET = 'tokensyber-models';
const models = manifest.map(m => ({ id: m.id, name: m.name, file: m.file, displayImage: m.displayImage }));
let success = 0;
let failed = 0;

console.log(`Uploading ${models.length} models to R2 bucket: ${BUCKET}${dryRun ? ' (DRY RUN)' : ''}\n`);

async function uploadFile(localPath, remoteKey, contentType, description) {
  if (!fs.existsSync(localPath)) {
    console.log(`  SKIP: ${localPath} not found`);
    return false;
  }
  const sizeMB = (fs.statSync(localPath).size / 1024 / 1024).toFixed(1);
  const label = description || path.basename(localPath);
  console.log(`  Uploading ${label} (${sizeMB} MB) → ${remoteKey}...`);

  if (dryRun) return true;

  try {
    // Use --remote flag for production upload
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${remoteKey}" --file="${localPath}" --ct=${contentType} --cache-control "public, max-age=31536000, immutable" --remote`,
      { stdio: 'pipe', timeout: 60000 }
    );
    return true;
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    return false;
  }
}

async function run() {
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const idx = `${i + 1}/${models.length}`;
    console.log(`[${idx}] ${m.id} (${m.name})`);

    // Upload GLB model
    const glbOk = await uploadFile(m.file, m.file, 'model/gltf-binary', 'GLB');
    if (glbOk) success++;

    // Upload display image
    if (m.displayImage) {
      const imgOk = await uploadFile(m.displayImage, m.displayImage, 'image/jpeg', 'Image');
      if (imgOk) success++;
    }
  }

  // Upload manifest
  console.log(`\nUploading manifest.json...`);
  const manifestOk = await uploadFile('models/manifest.json', 'models/manifest.json', 'application/json', 'Manifest');
  if (manifestOk) success++;

  // Summary
  const total = models.length * 2 + 1;
  console.log('\n========================================');
  console.log(`Done! ${success}/${total} files uploaded`);
  console.log('Public URL: https://pub-32c2ddcfcf824086b7a3ff0cd0c0aa78.r2.dev/');
}

run().catch(console.error);
