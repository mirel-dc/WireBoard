import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {randomUUID} from 'node:crypto';

const exec = promisify(execFile);
const binary = resolve(process.argv[2] ?? (process.platform === 'win32' ? 'target/release/wireboard.exe' : 'target/release/wireboard'));
const root = resolve('work', `release-smoke-${process.platform}-${Date.now()}`);
await mkdir(root, { recursive: true });
let server;
let runtime;
let errors = '';
async function start() {
  server = spawn(binary, ['--data-dir', root, 'serve', '--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  errors = '';
  server.stderr.on('data', chunk => { errors += chunk.toString(); });
  let spawnError;
  server.on('error', error => { spawnError = error; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Server exited: ${errors}`);
    try {
      const candidate = JSON.parse(await readFile(resolve(root, 'runtime.json'), 'utf8'));
      if (candidate.pid === server.pid) { runtime = candidate; return; }
    } catch { /* Runtime file is not ready. */ }
    await new Promise(done => setTimeout(done, 50));
  }
  throw new Error(`Server startup timed out: ${errors}`);
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise(done => server.once('exit', done));
  server.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT');
  let timeout;
  try { await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Server did not stop')), 15000); })]); }
  catch { server.kill('SIGKILL'); await exited; throw new Error('Server required forced termination'); }
  finally { clearTimeout(timeout); }
}
async function cli(...args) {
  const result = await exec(binary, ['--data-dir', root, ...args], { windowsHide: true, timeout: 30000 });
  return JSON.parse(result.stdout);
}
async function request(path, init = {}) {
  return fetch(runtime.endpoint + path, { ...init, headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json', ...init.headers } });
}
try {
  await start();
  const unauth = await fetch(runtime.endpoint + '/api/boards');
  assert.equal(unauth.status, 200);
  const html = await (await fetch(runtime.endpoint + '/')).text();
  assert.match(html, /Wireboard/);
  assert.match(html, /assets\/index-/);
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(runtime.endpoint + asset)).status, 200);
  const board = await cli('create', '--title', 'Release · Кириллица');
  const operations = JSON.parse(await readFile(resolve('examples/agent-slide.json'), 'utf8'));
  const file = resolve(root, 'operations.json');
  await writeFile(file, JSON.stringify(operations));
  const saved = await cli('apply', board.id, '--revision', '0', '--file', file);
  assert.equal(saved.revision, 1);
  assert.equal(saved.elements.length, 4);
  await assert.rejects(cli('apply', board.id, '--revision', '0', '--file', file), error => {
    assert.equal(JSON.parse(error.stderr).code, 'conflict');
    return true;
  });
  const svg = resolve(root, 'slide.svg'), png = resolve(root, 'slide.png'), json = resolve(root, 'board.json');
  await cli('render', board.id, '--frame', '1', '--output', svg);
  await cli('render', board.id, '--frame', '1', '--output', png);
  await cli('export', board.id, '--output', json);
  assert.match(await readFile(svg, 'utf8'), /Пользователь/);
  const pixels = await readFile(png);
  assert.equal(pixels.subarray(1, 4).toString(), 'PNG');
  assert.equal(pixels.readUInt32BE(16), 1920);
  assert.equal(pixels.readUInt32BE(20), 1080);
  const exported = JSON.parse(await readFile(json, 'utf8'));
  assert.deepEqual(exported.elements, saved.elements);
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      const issues = [];
      page.on('pageerror', error => issues.push(error.message));
      await page.goto(runtime.endpoint);
      if(!await page.locator('#sidebar').isVisible())await page.locator('#toggle-sidebar').click();
      await page.locator('#boards button').filter({ hasText: 'Release · Кириллица' }).click();
      await page.locator('#scene').getByText('Пользователь', { exact: true }).waitFor();
      await page.screenshot({ path: resolve('work', `release-editor-${process.platform}.png`), fullPage: true });
      await page.locator('#present').click();
      await page.locator('#presentation').waitFor({ state: 'visible' });
      await page.locator('#presentation svg').waitFor({ state: 'visible' });
      await page.screenshot({ path: resolve('work', `release-presentation-${process.platform}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      assert.deepEqual(issues, []);
    } finally { await browser.close(); }
  }
  // Export with a real image for the cross-OS import verification.
  const imageApply = await request(`/api/boards/${board.id}/apply`, { method: 'POST', body: JSON.stringify({ revision: 1, operations: [{ op: 'create', element: { kind: 'image', x: 410, y: 360, width: 100, height: 56.25, image: `data:image/png;base64,${pixels.toString('base64')}` } }] }) });
  assert.equal(imageApply.status, 200);
  await cli('export', board.id, '--output', resolve('work', `portable-${process.platform}.json`));
  await writeFile(file,JSON.stringify([{op:'comment_create',author:'user',text:'Проверь карточку',anchor:{type:'element',elementId:2,u:1,v:0}},{op:'comment_reply',threadId:1,author:'codex',text:'Проверил',submitForReview:true}]));
  const discussed=await cli('apply',board.id,'--revision','2','--file',file);
  assert.equal(discussed.comments[0].status,'awaiting_review');
  const comments=await cli('comments',board.id,'--status','awaiting_review');assert.equal(comments.threads.length,1);assert.equal(comments.revision,3);
  await stop();
  await start();
  const restored = await cli('inspect', board.id);
  assert.equal(restored.revision, 3);
  assert.deepEqual(restored.comments,discussed.comments);
  assert.equal(restored.elements.length, 5);
  assert.equal(restored.elements[4].kind, 'image');
  assert.deepEqual(restored.elements.slice(0, 4), saved.elements);
  const ux=await cli('create','--title','UX durable history smoke');
  const ownFile=resolve(root,'own-create.json'),moveFile=resolve(root,'own-move.json'),agentFile=resolve(root,'agent-text.json');
  await writeFile(ownFile,JSON.stringify([{op:'create',element:{kind:'frame',width:600,height:300}},{op:'create',element:{kind:'rectangle',x:100,y:100,width:200,height:100,text:'Own'}}]));
  const source=['--actor-id','smoke-user','--author','user'];
  await cli('apply',ux.id,'--revision','0','--file',ownFile,'--command-id',randomUUID(),...source);
  await writeFile(moveFile,JSON.stringify([{op:'move',ids:[2],dx:40,dy:0}]));const moveId=randomUUID();
  const moveArgs=['apply',ux.id,'--revision','1','--file',moveFile,'--command-id',moveId,...source];await cli(...moveArgs);
  await writeFile(agentFile,JSON.stringify([{op:'update',id:2,patch:{text:'Agent preserved'}}]));
  await cli('apply',ux.id,'--revision','2','--file',agentFile,'--command-id',randomUUID(),'--actor-id','smoke-codex','--author','codex');
  const undone=await cli('history',ux.id,'--revision','2','--direction','undo','--target-command-id',moveId,'--command-id',randomUUID(),...source);
  assert.equal(undone.elements[1].x,100);assert.equal(undone.elements[1].text,'Agent preserved');
  await stop();await start();const replayed=await cli(...moveArgs);assert.equal(replayed.revision,4);assert.equal(replayed.elements[1].x,100);assert.equal((await cli('command',ux.id,moveId)).committedRevision,2);
  const importFlag = process.argv.indexOf('--import');
  if (importFlag !== -1) {
    const portable = JSON.parse(await readFile(process.argv[importFlag + 1], 'utf8'));
    const response = await request('/api/import', { method: 'POST', body: JSON.stringify(portable) });
    assert.equal(response.status, 200);
    const imported = await response.json();
    assert.deepEqual(imported.elements, portable.elements);
    assert.notEqual(imported.id, portable.id);
    const edit = await request(`/api/boards/${imported.id}/apply`, { method: 'POST', body: JSON.stringify({ revision: imported.revision, operations: [{ op: 'update', id: 2, patch: { text: 'Перенесено и изменено' } }] }) });
    assert.equal(edit.status, 200);
    assert.equal((await edit.json()).elements.find(element => element.id === 2).text, 'Перенесено и изменено');
    console.log('Cross-OS JSON with image imported, compared and edited successfully.');
  }
  await stop();
  const report = { platform: process.platform, binary, data: root, checks: ['embedded UI', 'authentication', 'CLI create/apply/comments', 'atomic comment reply and review', 'revision conflict', 'SVG/PNG 1920x1080', 'JSON export with Cyrillic and image', 'restart persistence including comments','own Undo preserves agent text','identified replay after restart'], passed: true };
  await writeFile(resolve('work', `release-smoke-${process.platform}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await stop();
}
