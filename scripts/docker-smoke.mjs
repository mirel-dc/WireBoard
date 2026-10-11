// Development verification only; Docker/just users do not need Node.js.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {randomUUID} from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const exec = promisify(execFile);
const root = resolve('work', `docker-smoke-${Date.now()}`);
await mkdir(root, { recursive: true });
// Dedicated project/volume/port: verification never stops the user's service.
const project = `wireboard-smoke-${Date.now()}`;
const port = process.env.WIREBOARD_SMOKE_PORT ?? '19849';
const peerPort = process.env.WIREBOARD_SMOKE_PEER_PORT ?? '19850';
const peerProject = `${project}-peer`;
const peerOrigin = `http://127.0.0.1:${peerPort}`;
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, COMPOSE_PROJECT_NAME: project, WIREBOARD_PORT: port, WIREBOARD_DATA_DIR: resolve(root,'library'), WIREBOARD_UID: String(process.getuid?.()??10001), WIREBOARD_GID: String(process.getgid?.()??10001) };
await mkdir(env.WIREBOARD_DATA_DIR,{recursive:true});
await mkdir(resolve(root,'peer-library'),{recursive:true});
let commandErrorCount = 0;
async function command(executable, args, timeout = 60000, environment = env) {
  try {
    return await exec(executable, args, { env: environment, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    // A captured command may contain a private browser grant. Do not dump stdout.
    const diagnostics = String(error.stderr ?? '').replace(/#auth=[^\s"']+/g, '#auth=[redacted]');
    const file = resolve(root, `command-error-${++commandErrorCount}.log`);
    await writeFile(file, diagnostics);
    throw new Error(`${executable} ${args[0]} failed (exit ${error.code ?? 'unknown'}); see ${file}`);
  }
}
async function compose(...args) { return command('docker', ['compose', ...args], args[0] === 'up' ? 150000 : 60000); }
async function composePeer(...args) { return command('docker', ['compose', ...args], args[0] === 'up' ? 150000 : 60000, { ...env, COMPOSE_PROJECT_NAME: peerProject, WIREBOARD_PORT: peerPort, WIREBOARD_DATA_DIR: resolve(root,'peer-library') }); }
async function just(...args) { return command('just', args); }
async function cli(...args) { return JSON.parse((await just('cli', ...args)).stdout); }
async function authenticate(page, expectedOrigin = origin, transport = compose) {
  const { stdout } = await transport('exec', '-T', 'wireboard', 'wireboard', '--data-dir', '/data', 'open', '--print-url');
  const url = stdout.trim();
  assert.equal(url,`${expectedOrigin}/`,'CLI returns the published local URL');
  try { await page.goto(url); }
  catch { throw new Error('Browser session navigation failed (private URL omitted)'); }
  await expect(page.locator('#status')).toContainText(/Библиотека открыта|сохранены/);
  assert.ok(new URL(page.url()).hash === '', 'Browser must remove the private grant from its address');
}
let browser;
let primaryError;
try {
  await compose('up', '--detach', '--wait', '--wait-timeout', '120');
  await composePeer('up', '--detach', '--wait', '--wait-timeout', '120');
  assert.equal((await fetch(`${origin}/api/boards`)).status, 200);
  const user = await compose('exec', '-T', 'wireboard', 'id', '-u');
  assert.equal(user.stdout.trim(), env.WIREBOARD_UID);
  const permissions = await compose('exec', '-T', 'wireboard', 'stat', '-c', '%a', '/data/runtime.json');
  assert.equal(permissions.stdout.trim(), '600');
  const title = "Docker · Русская доска's \"quoted\" text; literal $value";
  const board = await cli('create', '--title', title);
  assert.equal(board.title, title, 'just must preserve Unicode, spaces, apostrophes and shell characters');
  const publicSlug = (await cli('boards')).find(item => item.id === board.id).slug;
  await assert.rejects(exec('just', ['cli', 'inspect', 'invalid/board'], { env, windowsHide: true, timeout: 60000 }), error => {
    const value = JSON.parse(error.stderr);
    assert.equal(value.code, 'validation');
    assert.equal(value.message, 'Некорректный ID доски');
    return true;
  });
  const operations = resolve(root, "операции с пробелами's.json");
  await writeFile(operations, await readFile('examples/agent-slide.json'));
  await just('upload', operations, '/data/operations.json');
  const saved = await cli('apply', board.id, '--revision', '0', '--file', '/data/operations.json');
  assert.equal(saved.revision, 1);
  assert.equal(saved.elements.length, 4);
  for (const extension of ['svg', 'png', 'json']) {
    const remote = `/data/slide.${extension}`;
    const local = resolve(root, `slide.${extension}`);
    if (extension === 'json') await cli('export', board.id, '--output', remote);
    else await cli('render', board.id, '--frame', '1', '--output', remote);
    await just('download', remote, local);
  }
  const png = await readFile(resolve(root, 'slide.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1920);
  assert.equal(png.readUInt32BE(20), 1080);
  assert.match(await readFile(resolve(root, 'slide.svg'), 'utf8'), /Пользователь/);
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'slide.json'), 'utf8')).elements, saved.elements);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const issues = [];
  page.on('pageerror', error => issues.push(error.message));
  await authenticate(page);
  const peerPage = await page.context().newPage();
  await authenticate(peerPage, peerOrigin, composePeer);
  assert.equal((await page.request.get(`${origin}/api/boards`)).status(), 200);
  assert.equal((await peerPage.request.get(`${peerOrigin}/api/boards`)).status(), 200);
  await peerPage.close();
  if(!await page.locator('#sidebar').isVisible())await page.locator('#toggle-sidebar').click();
  await page.locator('#boards button').filter({ hasText: title }).click();
  await expect(page.locator('#scene')).toContainText('Пользователь');
  await expect(page).toHaveURL(`${origin}/b/${publicSlug}`);
  await page.screenshot({ path: resolve(root, 'editor.png'), fullPage: true });
  await page.locator('#present').click();
  await expect(page.locator('#presentation')).toBeVisible();
  await expect(page.locator('#presentation svg')).toBeVisible();
  await page.screenshot({ path: resolve(root, 'presentation.png'), fullPage: true });
  await page.keyboard.press('Escape');

  // Verify the full browser -> API -> persistent store path through NAT.
  await page.locator('#canvas #scene [data-id="2"]').dblclick();
  await page.getByLabel('Текст объекта').fill('Браузер → Docker → сохранено');
  await page.getByRole('button', { name: 'Сохранить текст', exact: true }).click();
  await expect(page.locator('#canvas #scene')).toContainText(/Браузер → Docker →\s*сохранено/);
  let edited = await cli('inspect', board.id);
  assert.equal(edited.elements.find(element => element.id === 2).text, 'Браузер → Docker → сохранено');
  assert.equal(edited.revision, 2);
  await writeFile(operations,JSON.stringify([{op:'comment_create',author:'user',text:'Проверь Docker',anchor:{type:'element',elementId:2,u:1,v:0}},{op:'comment_reply',threadId:1,author:'claude',text:'Проверено через CLI',submitForReview:true}]));
  await just('upload',operations,'/data/comment-operations.json');
  edited=await cli('apply',board.id,'--revision','2','--file','/data/comment-operations.json');
  const comments=await cli('comments',board.id,'--status','awaiting_review','--thread','1');assert.equal(comments.threads.length,1);assert.equal(comments.threads[0].target.id,2);
  await expect(page.locator('.comment-pin')).toHaveCount(1);
  assert.deepEqual(issues, []);
  const ux=await cli('create','--title','UX durable history smoke'),moveId=randomUUID();
  const ownFile=resolve(root,'ux-own.json'),moveFile=resolve(root,'ux-move.json'),agentFile=resolve(root,'ux-agent.json');
  await writeFile(ownFile,JSON.stringify([{op:'create',element:{kind:'rectangle',x:100,y:100,text:'Own'}}]));await just('upload',ownFile,'/data/ux-own.json');
  const own=['--actor-id','smoke-user','--author','user'];await cli('apply',ux.id,'--revision','0','--file','/data/ux-own.json','--command-id',randomUUID(),...own);
  await writeFile(moveFile,JSON.stringify([{op:'move',ids:[1],dx:40,dy:0}]));await just('upload',moveFile,'/data/ux-move.json');const moveArgs=['apply',ux.id,'--revision','1','--file','/data/ux-move.json','--command-id',moveId,...own];await cli(...moveArgs);
  await writeFile(agentFile,JSON.stringify([{op:'update',id:1,patch:{text:'Agent preserved'}}]));await just('upload',agentFile,'/data/ux-agent.json');await cli('apply',ux.id,'--revision','2','--file','/data/ux-agent.json','--command-id',randomUUID(),'--actor-id','smoke-codex','--author','codex');
  const undone=await cli('history',ux.id,'--revision','2','--direction','undo','--target-command-id',moveId,'--command-id',randomUUID(),...own);assert.equal(undone.elements[0].x,100);assert.equal(undone.elements[0].text,'Agent preserved');
  const stream = await fetch(`${origin}/api/events`, {
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  assert.equal((await reader.read()).done, false);
  await browser.close(); browser = undefined;

  const started = Date.now();
  await compose('stop');
  assert.ok(Date.now() - started < 15000, 'SIGTERM must stop without forced kill');
  while (!(await reader.read()).done) { /* Drain pending events until graceful EOF. */ }
  reader.releaseLock();
  const stoppedId = (await compose('ps', '--all', '--quiet', 'wireboard')).stdout.trim();
  const stopped = JSON.parse((await command('docker', ['inspect', stoppedId])).stdout)[0];
  assert.equal(stopped.State.ExitCode, 0);
  await compose('run', '--rm', '--no-deps', '--entrypoint', 'sh', 'wireboard', '-c', 'test ! -e /data/runtime.json');
  await just('down');
  await compose('up', '--detach', '--wait', '--wait-timeout', '120');
  assert.deepEqual(await cli('inspect', board.id), edited);
  assert.equal((await cli('boards')).find(item => item.id === board.id).slug, publicSlug);
  assert.equal((await fetch(`${origin}/b/${publicSlug}`)).status, 200);
  const repeated=await cli(...moveArgs);assert.equal(repeated.revision,4);assert.equal(repeated.elements[0].x,100);assert.equal((await cli('command',ux.id,moveId)).committedRevision,2);
  await writeFile(resolve(root, 'verification.json'), JSON.stringify({ project, port, peerProject, peerPort, board: board.id, checks: ['non-root', 'private-runtime', 'plain-local-library', 'just-argv', 'upload', 'apply', 'png-svg-json-download', 'browser-without-login', 'two-ports-one-browser', 'browser-edit', 'presentation', 'sigterm-sse-eof-exit-zero-runtime-cleanup', 'down-up-persistence','own Undo preserves agent text','identified replay after restart'], retainedLibraries:[env.WIREBOARD_DATA_DIR,resolve(root,'peer-library')] }, null, 2));
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  // Independent cleanup attempts; preserve the original failure if cleanup also fails.
  const cleanup = await Promise.allSettled([
    browser?.close(),
    compose('down'), // Retain both verification volumes; never use -v.
    composePeer('down'),
  ]);
  if (cleanup.some(result => result.status === 'rejected')) {
    if (primaryError) console.error(`Docker smoke cleanup also failed; see diagnostics in ${root}`);
    else throw new Error(`Docker smoke cleanup failed; see diagnostics in ${root}`);
  }
}
console.log(`Docker smoke passed: ${root}`);
