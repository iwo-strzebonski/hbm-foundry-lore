/**
 * Package the lore module into a versioned zip ready to drop into a
 * Foundry VTT instance's Data/modules/ directory.
 */

import { createWriteStream, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const moduleJson = JSON.parse(readFileSync(resolve(root, 'module.json'), 'utf8')) as { id: string; version: string };
const outFile = resolve(root, `${moduleJson.id}-v${moduleJson.version}.zip`);

await new Promise<void>((resolveAll, rejectAll) => {
  const output = createWriteStream(outFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`✓ Packaged ${outFile} (${archive.pointer()} bytes)`);
    resolveAll();
  });
  archive.on('warning', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') console.warn(err);
    else rejectAll(err);
  });
  archive.on('error', rejectAll);

  archive.pipe(output);
  // Foundry expects everything under a folder named after the module id.
  archive.file(resolve(root, 'module.json'), { name: `${moduleJson.id}/module.json` });
  archive.directory(resolve(root, 'lang'), `${moduleJson.id}/lang`);
  archive.directory(resolve(root, 'packs'), `${moduleJson.id}/packs`, (entry) => {
    if (entry.name.endsWith('LOCK')) return false;
    return entry;
  });
  archive.finalize();
});
