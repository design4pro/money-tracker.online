import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { packages } from './probe.mjs';

function readManifest(path) {
  if (!existsSync(path)) throw new Error(`Missing required file ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function wranglerConfig(dir) {
  const configs = ['toml', 'json', 'jsonc'].map(extension => `${dir}/wrangler.${extension}`);
  return configs.find(path => existsSync(path));
}

export function verifyContracts(root = '.') {
  for (const worker of packages) {
    const dir = `${root}/apps/${worker}`;
    const manifest = readManifest(`${dir}/package.json`);
    const lock = readManifest(`${dir}/package-lock.json`);
    const commands = ['check', 'test', 'build', 'deploy:staging', 'deploy:production'];
    if (worker === 'app') commands.push('migrate:staging', 'migrate:production');
    for (const command of commands) {
      if (!manifest.scripts?.[command]?.trim()) throw new Error(`Missing ${worker} npm script ${command}`);
    }
    if (!lock.packages?.['node_modules/wrangler']?.version) throw new Error(`Missing locked Wrangler for ${worker}`);
    if (!wranglerConfig(dir)) {
      throw new Error(`Missing Wrangler configuration for ${worker}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    verifyContracts(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
