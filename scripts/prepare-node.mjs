import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const target = join(root, 'src-tauri', 'binaries', `node-${triple}`);

mkdirSync(dirname(target), { recursive: true });
copyFileSync(process.execPath, target);
chmodSync(target, 0o755);
console.log(`Node ${process.version} copied to ${target}`);
