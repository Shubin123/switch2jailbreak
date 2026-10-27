const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function packageRelease(root, destination) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const revision = git(['rev-parse', '--verify', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('A committed source revision is required');
  if (git(['status', '--porcelain'])) throw new Error('Release packaging requires a clean working tree');
  const archiveName = `switch2jailbreak-${revision.slice(0, 12)}.tar`;
  const names = [archiveName, 'release-manifest.json', 'SHA256SUMS'];
  fs.mkdirSync(destination, { recursive: true });
  for (const name of names) {
    if (fs.existsSync(path.join(destination, name))) throw new Error(`Refusing to overwrite ${name}`);
  }
  const staging = fs.mkdtempSync(path.join(destination, '.release-'));
  try {
    const archive = execFileSync('git', ['-C', root, 'archive', '--format=tar', '--prefix=switch2jailbreak/', revision], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const manifest = {
      schema_version: '1.0.0',
      source_revision: revision,
      archive: archiveName,
      archive_sha256: hash(archive),
      archive_bytes: archive.length,
      scope: 'Research workspace source; no native payload or working browser jailbreak included',
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(staging, archiveName), archive);
    fs.writeFileSync(path.join(staging, 'release-manifest.json'), manifestBytes);
    fs.writeFileSync(path.join(staging, 'SHA256SUMS'), `${hash(archive)}  ${archiveName}\n${hash(manifestBytes)}  release-manifest.json\n`);
    for (const name of names) fs.renameSync(path.join(staging, name), path.join(destination, name));
    return manifest;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = packageRelease;

if (require.main === module) {
  try {
    const root = path.join(__dirname, '..');
    console.log(JSON.stringify(packageRelease(root, path.resolve(process.argv[2] || path.join(root, 'dist'))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
