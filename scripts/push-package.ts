import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Resolve paths and load package manifest
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let id = '';
let version = '';

if (existsSync(resolve(root, 'module.json'))) {
  const moduleJson = JSON.parse(readFileSync(resolve(root, 'module.json'), 'utf8'));
  id = moduleJson.id;
  version = moduleJson.version;
} else if (existsSync(resolve(root, 'system.json'))) {
  const systemJson = JSON.parse(readFileSync(resolve(root, 'system.json'), 'utf8'));
  id = systemJson.id;
  version = systemJson.version;
} else if (existsSync(resolve(root, 'dist', 'system.json'))) {
  const systemJson = JSON.parse(readFileSync(resolve(root, 'dist', 'system.json'), 'utf8'));
  id = systemJson.id;
  version = systemJson.version;
} else {
  console.error("Error: Could not find system.json or module.json manifest!");
  process.exit(1);
}

const zipPath = resolve(root, `${id}-v${version}.zip`);

if (!existsSync(zipPath)) {
  console.error(`Error: Packaged zip file not found at ${zipPath}`);
  console.error("Please run 'bun run package' first to generate the zip package.");
  process.exit(1);
}

// 2. Determine ingest URL and API token from environment variables
const ingestUrl = process.env.FOUNDRY_INGEST_URL;
const apiToken = process.env.FOUNDRY_INGEST_TOKEN;

if (!ingestUrl) {
  console.error("Error: FOUNDRY_INGEST_URL environment variable is not defined!");
  console.error("Please define FOUNDRY_INGEST_URL in your .env file.");
  process.exit(1);
}

if (!apiToken) {
  console.error("Error: FOUNDRY_INGEST_TOKEN environment variable is not defined!");
  console.error("Please define FOUNDRY_INGEST_TOKEN in your .env file.");
  process.exit(1);
}

console.log(`Pushing package "${id}" version ${version}...`);
console.log(`Target URL: ${ingestUrl}`);

// 3. Build multipart form data and perform upload
const formData = new FormData();
const fileBlob = Bun.file(zipPath);
formData.append('file', fileBlob, `${id}-v${version}.zip`);

try {
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      'X-API-TOKEN': apiToken
    },
    body: formData
  });

  if (response.ok) {
    const data = await response.json();
    console.log("✓ Package successfully pushed and ingested!");
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error(`Error: Ingest server returned status ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error(`Response details: ${text}`);
    process.exit(1);
  }
} catch (error) {
  console.error("Error connecting to ingest server:", error);
  process.exit(1);
}
