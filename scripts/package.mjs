import { mkdir, copyFile, chmod, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [platform, source] = process.argv.slice(2);
if (!['windows-x86_64', 'linux-x86_64', 'macos-arm64', 'macos-x86_64'].includes(platform) || !source) {
  throw new Error('Usage: node scripts/package.mjs <platform> <native-binary>');
}
const output = resolve(root, 'dist', platform);
const windows = platform.startsWith('windows');
await mkdir(output, { recursive: true });
const binary = resolve(output, windows ? 'wireboard.exe' : 'wireboard');
if (resolve(source) !== binary) await copyFile(resolve(source), binary);
if (!windows) await chmod(binary, 0o755);
for (const file of ['README.md', 'LICENSE', 'AGENTS.md', 'CLAUDE.md', windows ? 'launch.cmd' : 'launch.sh', 'examples/agent-slide.json', 'skills/wireboard/SKILL.md', 'docs/agents/wireboard-comments.md']) {
  const destination = resolve(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(root, file), destination);
  if (file === 'launch.sh') await chmod(destination, 0o755);
}
await copyFile(resolve(root, 'frontend/public/fonts/OFL.txt'), resolve(output, 'Golos-Text-OFL.txt'));
await cp(resolve(root, 'THIRD-PARTY-LICENSES'), resolve(output, 'THIRD-PARTY-LICENSES'), { recursive: true });
console.log(`Packaged ${platform}: ${output}`);
