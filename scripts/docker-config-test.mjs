// Run with node scripts/docker-config-test.mjs; no Docker daemon is needed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'wireboard-config-'));
assert.equal(dirname(directory), resolve(tmpdir()), 'test cleanup must stay inside the temporary directory');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  (process.platform === 'win32' ? key.toUpperCase() : key) !== 'WIREBOARD_DATA_DIR'));
const justfile = join(directory, 'justfile');
function library(environment = env) {
  return execFileSync('just', ['--justfile', justfile, '--working-directory', directory,
    '--evaluate', 'WIREBOARD_DATA_DIR'], { env: environment, encoding: 'utf8', windowsHide: true }).trim();
}
try {
  copyFileSync(resolve('justfile'), justfile);
  const configured = join(directory, 'My boards');
  writeFileSync(join(directory, '.env'), `WIREBOARD_DATA_DIR="${configured.replaceAll('\\', '/')}"\n`);
  assert.equal(resolve(library()), configured, 'just must use the library configured in .env');
  const override = join(directory, 'Environment boards');
  assert.equal(resolve(library({ ...env, WIREBOARD_DATA_DIR: override })), override,
    'an explicit environment override must take precedence over .env');
  rmSync(join(directory, '.env'));
  const defaultRoot = process.platform === 'win32' ? join(env.LOCALAPPDATA, 'Wireboard')
    : process.platform === 'darwin' ? join(env.HOME, 'Library/Application Support/Wireboard')
    : join(env.XDG_DATA_HOME?.startsWith('/') ? env.XDG_DATA_HOME : join(env.HOME, '.local/share'), 'wireboard');
  assert.equal(resolve(library()), resolve(defaultRoot), 'without configuration just must use the native library');
  console.log('PASS: .env library, environment override, native default');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
