# Плавность редактора — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ручное редактирование в браузере без лагов и лишней работы: единый цикл кадра, инкрементальная сцена, один запрос на правку, плавный зум и hover.

**Architecture:** Новый планировщик кадра (`frame.ts`) собирает все изменения состояния и рисует слои одним `requestAnimationFrame`. `canvas.ts` становится фасадом над `scene.ts` (элементы и стрелки в локальных координатах, только изменённые), `overlay.ts` (постоянные узлы выделения) и чистыми модулями `camera.ts`/`diff.ts`. Сервер отдаёт edit-state прямо в ответе `apply`/`history` при `?state=1` и пишет `commandId`/`actorId` в SSE, чтобы клиент не перезагружал доску на своё эхо.

**Tech Stack:** TypeScript 5.9 без фреймворка, Vite 7, SVG DOM; Rust 2024 + axum 0.8; Playwright 1.64 (e2e и node-side unit-спеки).

**Spec:** `docs/superpowers/specs/2026-10-19-editor-smoothness-design.md`

## Global Constraints

- Новые npm- и cargo-зависимости не добавляются.
- Формат файла доски и CLI-контракт не меняются; `POST /apply` и `POST /history` без `?state=1` отвечают как раньше (`Board`).
- Тексты интерфейса и ошибок — на русском; коммиты, имена веток и PR — на английском, формат `<type>: <description>`.
- Стиль кода как в `frontend/src`: плотные строки, без лишних комментариев; комментарий только там, где причина неочевидна.
- DOM-атрибуты, на которые опираются e2e, сохраняются: `data-id`, `data-kind`, `data-resize`, `data-handle`, `data-connector-end`, `data-end`, `data-selected`, `data-frame-header-hit`, `data-fit-height`, `data-text-overflow`, `data-connector-label`, `data-drop-target="<id>"`, `data-connector-target="<id>"`, `data-creation-preview`.
- Перед любым запуском Playwright выполнить `npm run build`: сервер в debug-сборке читает `frontend/dist` с диска.
- Бюджеты: время работы кадра планировщика ≤16 мс (p90), pointerup-обработчик + следующий кадр ≤16 мс, своя правка = ровно один запрос `POST /api/boards/{id}/apply?state=1`, без `render`.
- Debounce: миниатюры 1500 мс, список досок 1000 мс, `saveView` 300 мс (плюс сохранение на `pagehide`); анимация зума 140 мс, fade выделения 80 мс; `prefers-reduced-motion: reduce` отключает обе анимации.

## Review Focus

- Агент удаляет выделенный блок: рамка и хэндлы должны исчезнуть, а не висеть над пустым местом (тест в Task 4).
- Undo удаления возвращает блок на холст: дифф сцены должен заметить «новый» id (тест в Task 4).
- Быстрые повторные клики «+» зума не теряют шаги: цель анимации накапливается (тест в Task 5).
- Переключение доски, пока грузится миниатюра прошлой доски: чужая миниатюра не должна попасть в новый список (тест в Task 8).
- Чужая правка приходит, пока своя правка в полёте: подавление своего SSE-эха не должно её проглотить (существующий `own_sse_before_ack_does_not_double_move` в `e2e/command-queue.spec.ts` должен оставаться зелёным после Task 7).

---

## Файлы

- Create `frontend/src/frame.ts` — планировщик кадра (слои, объединение, замер длительности).
- Create `frontend/src/camera.ts` — чистая математика камеры, анимация зума, `reducedMotion`.
- Create `frontend/src/diff.ts` — `changedIds` между двумя версиями доски.
- Create `frontend/src/svg.ts` — `svgElement`, `setAttrs`.
- Create `frontend/src/scene.ts` — `SceneRenderer`: элементы, стрелки, маркеры.
- Create `frontend/src/overlay.ts` — `OverlayRenderer`: hover, выделение, хэндлы, концы связи, marquee, превью.
- Create `frontend/src/slides.ts` — `SlideList` и `frameSignature`.
- Rewrite `frontend/src/canvas.ts` — фасад `CanvasView` с прежним публичным API.
- Modify `frontend/src/preview.ts` — экспорт `layoutElement`, `layoutConnector`.
- Modify `frontend/src/editor.ts`, `interaction.ts`, `comments.ts`, `commands.ts`, `api.ts`, `types.ts`, `panels.ts`, `style.css`.
- Modify `src/api.rs`; tests in `tests/commands_api.rs`.
- Create `e2e/unit/*.spec.ts`, `e2e/unit/fixtures.ts`, `e2e/smoothness.spec.ts`, `e2e/perf.spec.ts`; modify `playwright.config.ts`, `e2e/command-queue.spec.ts` и route-шаблоны в остальных спеках.
- Create `scripts/apply-bench.mjs`.

### Task 1: Сервер — edit-state в ответе команды и автор в SSE

**Files:**
- Modify: `src/api.rs` (imports, `changed`, `apply`, `history`, `edit_state`, вызовы `changed` в `create`/`delete`/`import`)
- Test: `tests/commands_api.rs`

**Interfaces:**
- Produces: `POST /api/boards/{id}/apply?state=1` и `POST /api/boards/{id}/history?state=1` → JSON `{board, stamps, history, receipt}` (тот же вид, что `GET /edit-state`; `history` для `command.actor`, `receipt` для `command.id`). Без параметра — прежний `Board`. `state=1` без `command` → 400 `validation`.
- Produces: SSE-событие `board` с `kind:"changed"` получает поля `commandId` и `actorId`, если коммит пришёл с `command`; иначе полей нет.

- [ ] **Step 1: Write the failing tests**

Добавить в конец `tests/commands_api.rs`:

```rust
async fn post_json(url: &str, path: &str, body: &impl serde::Serialize) -> reqwest::Response {
    client()
        .post(format!("{url}{path}"))
        .bearer_auth("secret")
        .json(body)
        .send()
        .await
        .unwrap()
}
#[tokio::test]
async fn apply_with_state_returns_edit_state() {
    let (_d, url, _, b, task) = server().await;
    let req = common::request(1, ops(json!([{"op":"move","ids":[1],"dx":20,"dy":0}])));
    let r = post_json(&url, &format!("/api/boards/{}/apply?state=1", b.id), &req).await;
    assert_eq!(r.status(), 200);
    let state: Value = r.json().await.unwrap();
    let id = req.command.as_ref().unwrap().id.clone();
    assert_eq!(state["board"]["revision"], 2);
    assert_eq!(state["board"]["elements"][0]["x"], 20.0);
    assert_eq!(state["receipt"]["id"], id);
    assert_eq!(state["receipt"]["committedRevision"], 2);
    assert_eq!(state["history"]["undo"]["commandId"], id);
    assert!(state["stamps"].is_array());
    task.abort();
}
#[tokio::test]
async fn history_with_state_returns_edit_state() {
    let (_d, url, _, b, task) = server().await;
    let req = common::request(1, ops(json!([{"op":"move","ids":[1],"dx":20,"dy":0}])));
    assert_eq!(post_json(&url, &format!("/api/boards/{}/apply", b.id), &req).await.status(), 200);
    let undo = wireboard::history::HistoryCommand {
        revision: 2,
        direction: wireboard::store::HistoryDirection::Undo,
        target_command_id: req.command.as_ref().unwrap().id.clone(),
        command: common::meta(),
    };
    let r = post_json(&url, &format!("/api/boards/{}/history?state=1", b.id), &undo).await;
    assert_eq!(r.status(), 200);
    let state: Value = r.json().await.unwrap();
    assert_eq!(state["board"]["revision"], 3);
    assert_eq!(state["board"]["elements"][0]["x"], 0.0);
    assert_eq!(state["receipt"]["id"], undo.command.id);
    assert_eq!(state["history"]["redo"]["commandId"], req.command.as_ref().unwrap().id);
    task.abort();
}
#[tokio::test]
async fn state_response_requires_command_and_valid_query() {
    let (_d, url, _, b, task) = server().await;
    let legacy = CommandRequest {
        revision: 1,
        operations: ops(json!([{"op":"move","ids":[1],"dx":20,"dy":0}])),
        command: None,
        guards: None,
    };
    let r = post_json(&url, &format!("/api/boards/{}/apply?state=1", b.id), &legacy).await;
    assert_eq!(r.status(), 400);
    let r = post_json(&url, &format!("/api/boards/{}/apply?state=yes", b.id), &legacy).await;
    assert_eq!(r.status(), 400);
    let board: Value = client()
        .get(format!("{url}/api/boards/{}", b.id))
        .bearer_auth("secret")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(board["revision"], 1);
    task.abort();
}
#[tokio::test]
async fn changed_event_names_the_command() {
    let (_d, url, state, b, task) = server().await;
    let mut events = state.events.subscribe();
    let req = common::request(1, ops(json!([{"op":"move","ids":[1],"dx":20,"dy":0}])));
    assert_eq!(post_json(&url, &format!("/api/boards/{}/apply", b.id), &req).await.status(), 200);
    let event: Value = serde_json::from_str(&events.try_recv().unwrap()).unwrap();
    assert_eq!(event["commandId"], req.command.as_ref().unwrap().id);
    assert_eq!(event["actorId"], "test-user");
    let legacy = CommandRequest {
        revision: 2,
        operations: ops(json!([{"op":"move","ids":[1],"dx":5,"dy":0}])),
        command: None,
        guards: None,
    };
    assert_eq!(post_json(&url, &format!("/api/boards/{}/apply", b.id), &legacy).await.status(), 200);
    let event: Value = serde_json::from_str(&events.try_recv().unwrap()).unwrap();
    assert!(event.get("commandId").is_none());
    assert!(event.get("actorId").is_none());
    task.abort();
}
```

Проверка фикстуры: `server()` в этом файле создаёт доску с одним блоком на revision 1, `common::request` берёт актёра `test-user`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --locked --test commands_api state -- --nocapture` и `cargo test --locked --test commands_api changed_event`
Expected: FAIL — `apply_with_state_returns_edit_state` получает `Board` без `receipt`; `state_response_requires_command_and_valid_query` получает 200; `changed_event_names_the_command` не находит `commandId`.

- [ ] **Step 3: Implement**

В `src/api.rs`:

1. Импорты: `history::{Actor, CommandMeta, CommandRequest, FieldStampEntry, HistoryCommand, Source}` и `extract::{DefaultBodyLimit, Path, Query, Request, State, rejection::{JsonRejection, QueryRejection}}`.

2. Заменить `fn changed`:

```rust
fn changed(state: &ApiState, id: &str, revision: u64, kind: &str, command: Option<&CommandMeta>) {
    let mut event = json!({"id":id,"revision":revision,"kind":kind});
    if let Some(command) = command {
        event["commandId"] = json!(command.id);
        event["actorId"] = json!(command.actor.id);
    }
    let _ = state.events.send(event.to_string());
}
#[derive(Deserialize, Default)]
struct ResponseQuery {
    #[serde(default)]
    state: Option<u8>,
}
impl ResponseQuery {
    fn wants_state(&self) -> bool {
        self.state == Some(1)
    }
}
fn response_query(query: Result<Query<ResponseQuery>, QueryRejection>) -> Result<ResponseQuery, AppError> {
    query
        .map(|Query(query)| query)
        .map_err(|_| AppError::validation("Некорректные параметры запроса"))
}
fn edit_state_value(
    store: &Store,
    id: &str,
    actor: &Actor,
    command_id: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    let board = store.get(id)?;
    let stamps = store
        .stamps(id)?
        .into_iter()
        .map(|(key, stamp)| FieldStampEntry { key, stamp })
        .collect::<Vec<_>>();
    let history = store.history_summary(id, actor)?;
    let receipt = match command_id {
        Some(command_id) => store.receipt(id, command_id)?,
        None => None,
    };
    Ok(json!({"board":board,"stamps":stamps,"history":history,"receipt":receipt}))
}
```

3. В `create`, `delete` и `import` дописать последним аргументом `None`: `changed(&state, &board.id, board.revision, "created", None);`, `changed(&state, &id, query.revision + 1, "deleted", None);`.

4. Заменить `apply`:

```rust
async fn apply(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    query: Result<Query<ResponseQuery>, QueryRejection>,
    payload: Result<Json<ApplyRequest>, JsonRejection>,
) -> Result<Json<serde_json::Value>, AppError> {
    let query = response_query(query)?;
    let request = body(payload)?;
    if query.wants_state() && request.command.is_none() {
        return Err(AppError::validation("Для ответа state=1 нужен command"));
    }
    let mut store = state.store.lock().await;
    let outcome = store.execute(&id, &request)?;
    if outcome.committed {
        changed(&state, &id, outcome.board.revision, "changed", request.command.as_ref());
    }
    match request.command.as_ref().filter(|_| query.wants_state()) {
        Some(command) => Ok(Json(edit_state_value(&store, &id, &command.actor, Some(&command.id))?)),
        None => Ok(Json(json!(outcome.board))),
    }
}
```

5. В `history` добавить параметр `query: Result<Query<ResponseQuery>, QueryRejection>,` перед `payload`, первой строкой `let query = response_query(query)?;`, тип ответа `Result<Json<serde_json::Value>, AppError>`, а хвост после построения `HistoryCommand` заменить:

```rust
    let mut store = state.store.lock().await;
    let outcome = store.execute_history(&id, &request)?;
    if outcome.committed {
        changed(&state, &id, outcome.board.revision, "changed", Some(&request.command));
    }
    if query.wants_state() {
        return Ok(Json(edit_state_value(&store, &id, &request.command.actor, Some(&request.command.id))?));
    }
    Ok(Json(json!(outcome.board)))
```

6. Тело `edit_state` после проверки `actor_id`:

```rust
    let store = state.store.lock().await;
    let actor = Actor {
        id: query.actor_id,
        source: Source::User,
    };
    Ok(Json(edit_state_value(&store, &id, &actor, query.command_id.as_deref())?))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo fmt && cargo test --locked` и `cargo clippy --locked --all-targets -- -D warnings`
Expected: все тесты PASS, включая `legacy_apply_stays_compatible`, `duplicate_command_emits_one_change`, `history_is_actor_scoped`; clippy без предупреждений.

- [ ] **Step 5: Commit**

```bash
git add src/api.rs tests/commands_api.rs
git commit -m "feat: return edit state from commands and tag change events with the command"
```

### Task 2: Unit-проект Playwright и планировщик кадра

**Files:**
- Modify: `playwright.config.ts`
- Create: `frontend/src/frame.ts`, `e2e/unit/fixtures.ts`
- Test: `e2e/unit/frame.spec.ts`

**Interfaces:**
- Produces (`frame.ts`): `type Layer='camera'|'scene'|'overlay'|'pins'|'chrome'`; `const LAYERS:readonly Layer[]`; `type Dirty=ReadonlySet<number>|'all'`; `type Painter=(layer:Layer,dirty:Dirty)=>void`; `type RequestFrame=(callback:()=>void)=>void`; `class FrameScheduler{constructor(painter:Painter,requestFrame?:RequestFrame,onFrame?:(ms:number)=>void);get pending():boolean;invalidate(layer:Layer,ids?:Iterable<number>):void;flush():void}`. Слои рисуются в порядке `LAYERS`; `dirty` для слоёв кроме `scene` всегда `'all'`; painter может инвалидировать более поздний слой в том же кадре, более ранний — уходит в следующий кадр.
- Produces (`e2e/unit/fixtures.ts`): `element(patch:Partial<Element>&{id:number}):Element`, `board(elements:Element[],id?:string):Board`, `metrics:FontMetrics`.

- [ ] **Step 1: Add the unit project**

В `playwright.config.ts` заменить массив `projects`:

```ts
  projects: [
    { name: 'unit', testDir: './e2e/unit' },
    { name: 'chromium', testIgnore: 'unit/**', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: 'unit/**', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: 'unit/**', use: { ...devices['Desktop Safari'] } },
  ],
```

Создать `e2e/unit/fixtures.ts`:

```ts
import type {Board,Element,FontMetrics} from '../../frontend/src/types';
export function element(patch:Partial<Element>&{id:number}):Element{return {kind:'rectangle',x:0,y:0,width:220,height:112,text:'',title:'',fontWeight:400,fill:'#eee5f8',stroke:'#ae91c5',fontSize:16,from:null,to:null,fromPort:'auto',toPort:'auto',image:null,parentFrameId:null,...patch};}
export function board(elements:Element[],id='board'):Board{return {version:3,id,title:'Test',revision:1,nextId:elements.length+1,elements,comments:[],nextCommentId:1,nextMessageId:1};}
export const metrics:FontMetrics={regular:{},semibold:{},fallback:.55};
```

- [ ] **Step 2: Write the failing test**

`e2e/unit/frame.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {FrameScheduler,type Dirty,type Layer} from '../../frontend/src/frame';
function harness(onPaint:(layer:Layer,frames:FrameScheduler)=>void=()=>{}){
  const calls:[Layer,Dirty][]=[],queue:(()=>void)[]=[];
  const frames:FrameScheduler=new FrameScheduler((layer,dirty)=>{calls.push([layer,dirty]);onPaint(layer,frames);},callback=>{queue.push(callback);});
  return {calls,queue,frames,run(){queue.shift()?.();}};
}
test('coalesces invalidations into one ordered frame',()=>{
  const h=harness();h.frames.invalidate('overlay');h.frames.invalidate('overlay');h.frames.invalidate('camera');
  expect(h.queue).toHaveLength(1);h.run();
  expect(h.calls.map(([layer])=>layer)).toEqual(['camera','overlay']);expect(h.frames.pending).toBe(false);
});
test('scene ids merge until a full repaint is requested',()=>{
  const h=harness();h.frames.invalidate('scene',[1,2]);h.frames.invalidate('scene',[2,3]);h.run();
  expect([...(h.calls[0][1] as ReadonlySet<number>)]).toEqual([1,2,3]);
  h.frames.invalidate('scene',[4]);h.frames.invalidate('scene');h.run();expect(h.calls[1][1]).toBe('all');
});
test('a painter can invalidate a later layer within the same frame',()=>{
  const h=harness((layer,frames)=>{if(layer==='camera')frames.invalidate('pins');});
  h.frames.invalidate('camera');h.run();
  expect(h.calls.map(([layer])=>layer)).toEqual(['camera','pins']);expect(h.queue).toHaveLength(0);
});
test('an earlier layer invalidated while painting waits for the next frame',()=>{
  let once=true;const h=harness((layer,frames)=>{if(layer==='overlay'&&once){once=false;frames.invalidate('camera');}});
  h.frames.invalidate('overlay');h.run();expect(h.calls.map(([layer])=>layer)).toEqual(['overlay']);
  expect(h.queue).toHaveLength(1);h.run();expect(h.calls.map(([layer])=>layer)).toEqual(['overlay','camera']);
});
test('reports the duration of every frame',()=>{
  const times:number[]=[],queue:(()=>void)[]=[];
  const frames=new FrameScheduler(()=>{},callback=>{queue.push(callback);},ms=>times.push(ms));
  frames.invalidate('chrome');queue.shift()!();expect(times).toHaveLength(1);expect(times[0]).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx playwright test --project=unit e2e/unit/frame.spec.ts`
Expected: FAIL — `Cannot find module '../../frontend/src/frame'`.

- [ ] **Step 4: Implement `frontend/src/frame.ts`**

```ts
export type Layer='camera'|'scene'|'overlay'|'pins'|'chrome';
export const LAYERS:readonly Layer[]=['camera','scene','overlay','pins','chrome'];
export type Dirty=ReadonlySet<number>|'all';
export type Painter=(layer:Layer,dirty:Dirty)=>void;
export type RequestFrame=(callback:()=>void)=>void;
const nextFrame:RequestFrame=callback=>{requestAnimationFrame(()=>callback());};
export class FrameScheduler {
  private layers=new Set<Layer>();private ids=new Set<number>();private all=false;private scheduled=false;private flushing=false;
  constructor(private painter:Painter,private requestFrame:RequestFrame=nextFrame,private onFrame?:(ms:number)=>void){}
  get pending():boolean{return this.layers.size>0;}
  invalidate(layer:Layer,ids?:Iterable<number>):void{
    this.layers.add(layer);
    if(layer==='scene'){if(ids===undefined)this.all=true;else for(const id of ids)this.ids.add(id);}
    this.schedule();
  }
  flush():void{
    this.flushing=true;const started=performance.now();
    try{
      for(const layer of LAYERS){
        if(!this.layers.delete(layer))continue;
        let dirty:Dirty='all';if(layer==='scene'){dirty=this.all?'all':this.ids;this.ids=new Set();this.all=false;}
        this.painter(layer,dirty);
      }
    }finally{this.flushing=false;this.onFrame?.(performance.now()-started);this.schedule();}
  }
  private schedule(){if(this.scheduled||this.flushing||!this.layers.size)return;this.scheduled=true;this.requestFrame(()=>{this.scheduled=false;this.flush();});}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test --project=unit && npm run typecheck`
Expected: 5 passed; typecheck без ошибок.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts frontend/src/frame.ts e2e/unit
git commit -m "feat: add frame scheduler and node-side unit test project"
```

### Task 3: Чистые модули — камера, дифф доски, раскладка элемента

**Files:**
- Create: `frontend/src/camera.ts`, `frontend/src/diff.ts`
- Modify: `frontend/src/preview.ts` (полная замена содержимого, логика переносится без изменений)
- Test: `e2e/unit/camera.spec.ts`, `e2e/unit/diff.spec.ts`, `e2e/unit/preview.spec.ts`

**Interfaces:**
- Produces (`camera.ts`): `interface Camera{x:number;y:number;zoom:number}`; `MIN_ZOOM=.1`, `MAX_ZOOM=4`, `ZOOM_MS=140`; `zoomAround(camera:Camera,zoom:number,anchor:Point):Camera` (anchor в пикселях относительно `#canvas`, зум зажат в `[MIN_ZOOM,MAX_ZOOM]`, x/y в `±1e7`); `easeOut(t:number):number`; `isDiscreteZoom(e:{deltaMode:number;deltaY:number}):boolean`; `reducedMotion():boolean`; `class ZoomAnimation{active:boolean;get target():number|null;retarget(current:number,target:number,anchor:Point,now:number):void;step(camera:Camera,now:number):Camera;stop():void}`.
- Produces (`diff.ts`): `sameElement(a:Element,b:Element):boolean`; `changedIds(prev:Board|null,next:Board):Set<number>|'all'` (`'all'` при другой доске или `prev===null`; иначе изменённые, добавленные и удалённые id).
- Produces (`preview.ts`): `layoutElement(e:Element,metrics:FontMetrics):ElementLayout`; `layoutConnector(board:Board,e:Element,metrics:FontMetrics,points:Point[]):ConnectorLayout`; `projectScene` и `textWidth` — прежние сигнатуры и результат.

- [ ] **Step 1: Write the failing tests**

`e2e/unit/camera.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {ZOOM_MS,ZoomAnimation,isDiscreteZoom,zoomAround} from '../../frontend/src/camera';
test('zoomAround keeps the anchor point still',()=>{
  const camera={x:80,y:70,zoom:1},anchor={x:300,y:200},world={x:(anchor.x-camera.x)/camera.zoom,y:(anchor.y-camera.y)/camera.zoom};
  const next=zoomAround(camera,2,anchor);
  expect(next.zoom).toBe(2);expect((anchor.x-next.x)/next.zoom).toBeCloseTo(world.x,9);expect((anchor.y-next.y)/next.zoom).toBeCloseTo(world.y,9);
});
test('zoomAround clamps the zoom range',()=>{
  expect(zoomAround({x:0,y:0,zoom:1},10,{x:0,y:0}).zoom).toBe(4);expect(zoomAround({x:0,y:0,zoom:1},.01,{x:0,y:0}).zoom).toBe(.1);
});
test('mouse wheel steps animate while trackpad pinch applies directly',()=>{
  expect(isDiscreteZoom({deltaMode:1,deltaY:-3})).toBe(true);expect(isDiscreteZoom({deltaMode:0,deltaY:-100})).toBe(true);expect(isDiscreteZoom({deltaMode:0,deltaY:-4.5})).toBe(false);
});
test('zoom animation eases toward the target and then stops',()=>{
  const animation=new ZoomAnimation(),anchor={x:100,y:100};animation.retarget(1,2,anchor,0);expect(animation.target).toBe(2);
  const middle=animation.step({x:0,y:0,zoom:1},ZOOM_MS/2);expect(middle.zoom).toBeGreaterThan(1.5);expect(middle.zoom).toBeLessThan(2);expect(animation.active).toBe(true);
  const end=animation.step(middle,ZOOM_MS);expect(end.zoom).toBe(2);expect(animation.active).toBe(false);expect(animation.target).toBeNull();
});
test('stop cancels a running animation',()=>{const animation=new ZoomAnimation();animation.retarget(1,3,{x:0,y:0},0);animation.stop();expect(animation.active).toBe(false);expect(animation.target).toBeNull();});
```

`e2e/unit/diff.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {changedIds} from '../../frontend/src/diff';
import {board,element} from './fixtures';
test('reports moved, added and removed elements',()=>{
  const before=board([element({id:1}),element({id:2}),element({id:3})]),after=board([element({id:1}),element({id:2,x:50}),element({id:4})]);
  expect([...(changedIds(before,after) as Set<number>)].sort()).toEqual([2,3,4]);
});
test('requests a full repaint for a first or different board',()=>{expect(changedIds(null,board([]))).toBe('all');expect(changedIds(board([],'a'),board([],'b'))).toBe('all');});
test('a cloned projection changes nothing',()=>{const before=board([element({id:1,image:'data:image/png;base64,AAAA'})]);expect((changedIds(before,structuredClone(before)) as Set<number>).size).toBe(0);});
```

`e2e/unit/preview.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {layoutElement,projectScene} from '../../frontend/src/preview';
import {board,element,metrics} from './fixtures';
const rows=(layout:ReturnType<typeof layoutElement>)=>[...layout.title,...layout.body];
test('element layout only translates with the element',()=>{
  for(const kind of ['rectangle','text'] as const){
    const e=element({id:1,kind,x:137.5,y:-42,title:kind==='rectangle'?'Заголовок карточки':'',text:'Длинное описание '.repeat(6)});
    const absolute=layoutElement(e,metrics),local=layoutElement({...e,x:0,y:0},metrics);
    expect(local.fitHeight).toBe(absolute.fitHeight);expect(local.overflow).toBe(absolute.overflow);expect(rows(local).length).toBeGreaterThan(1);
    rows(local).forEach((row,i)=>{const other=rows(absolute)[i];expect(row.text).toBe(other.text);expect(row.x+e.x).toBeCloseTo(other.x,9);expect(row.y+e.y).toBeCloseTo(other.y,9);});
  }
});
test('projectScene is built from layoutElement',()=>{
  const e=element({id:1,x:10,y:20,title:'Карточка',text:'Текст'});expect(projectScene(board([e]),metrics).elements[0]).toEqual(layoutElement(e,metrics));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test --project=unit`
Expected: FAIL — модулей `camera`, `diff` нет; `layoutElement` не экспортирован.

- [ ] **Step 3: Implement `frontend/src/camera.ts`**

```ts
import type {Point} from './anchors';
export interface Camera{x:number;y:number;zoom:number}
export const MIN_ZOOM=.1,MAX_ZOOM=4,ZOOM_MS=140;
const clampZoom=(zoom:number)=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,zoom));
const clampCoordinate=(value:number)=>Math.max(-1e7,Math.min(1e7,value));
export function zoomAround(camera:Camera,zoom:number,anchor:Point):Camera{
  const next=clampZoom(zoom),x=(anchor.x-camera.x)/camera.zoom,y=(anchor.y-camera.y)/camera.zoom;
  return {x:clampCoordinate(anchor.x-x*next),y:clampCoordinate(anchor.y-y*next),zoom:next};
}
export const easeOut=(t:number)=>1-(1-Math.min(1,Math.max(0,t)))**3;
// Mouse wheels report lines or large pixel steps; trackpad pinch reports small fractional deltas.
export const isDiscreteZoom=(e:{deltaMode:number;deltaY:number})=>e.deltaMode===1||Math.abs(e.deltaY)>=50;
export const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
export class ZoomAnimation {
  active=false;private from=1;private to=1;private started=0;private anchor:Point={x:0,y:0};
  get target():number|null{return this.active?this.to:null;}
  retarget(current:number,target:number,anchor:Point,now:number):void{this.from=current;this.to=clampZoom(target);this.anchor=anchor;this.started=now;this.active=true;}
  step(camera:Camera,now:number):Camera{const t=(now-this.started)/ZOOM_MS;if(t>=1)this.active=false;return zoomAround(camera,t>=1?this.to:this.from+(this.to-this.from)*easeOut(t),this.anchor);}
  stop():void{this.active=false;}
}
```

- [ ] **Step 4: Implement `frontend/src/diff.ts`**

```ts
import type {Board,Element} from './types';
const FIELDS:readonly (keyof Element)[]=['kind','x','y','width','height','text','title','fontWeight','fill','stroke','fontSize','from','to','fromPort','toPort','image','parentFrameId'];
export const sameElement=(a:Element,b:Element)=>FIELDS.every(field=>a[field]===b[field]);
export function changedIds(prev:Board|null,next:Board):Set<number>|'all'{
  if(!prev||prev.id!==next.id)return 'all';
  const before=new Map(prev.elements.map(e=>[e.id,e])),changed=new Set<number>();
  for(const e of next.elements){const old=before.get(e.id);if(!old||!sameElement(old,e))changed.add(e.id);before.delete(e.id);}
  for(const id of before.keys())changed.add(id);
  return changed;
}
```

- [ ] **Step 5: Rewrite `frontend/src/preview.ts`**

Логика `wrap`, `truncate`, `layout` и `caption` переносится без изменений, меняется только область видимости:

```ts
import {connectorPoints,pointOnRoute,type Point} from './anchors';
import type {Board,Element,FontMetrics,SceneLayout,TextRow,Bounds,ElementLayout,ConnectorLayout} from './types';
export const textWidth=(s:string,size:number,weight:number,metrics:FontMetrics)=>Array.from(s).reduce((w,c)=>w+((weight===600?metrics.semibold:metrics.regular)[c]??metrics.fallback),0)*size;
function measure(metrics:FontMetrics){
  // Keep advances independent of browser shaping and canvas measurement.
  const width=(s:string,size:number,weight:number)=>textWidth(s,size,weight,metrics);
  const wrap=(s:string,size:number,max:number,weight:number)=>{const lines:string[]=[];for(const p of s.split('\n')){let line='';for(const word of p.trim().split(/\s+/u).filter(Boolean)){const candidate=line?`${line} ${word}`:word;if(width(candidate,size,weight)<=max){line=candidate;continue;}if(line){lines.push(line);line='';}for(const c of Array.from(word)){if(line&&width(line+c,size,weight)>max){lines.push(line);line='';}line+=c;}}lines.push(line);}return lines;};
  const truncate=(lines:string[],rows:number,size:number,max:number,weight:number)=>{if(lines.length<=rows)return lines;const result=lines.slice(0,rows);if(result.length){let last=Array.from(result.at(-1)!);while(last.length&&width(last.join('')+'…',size,weight)>max)last.pop();result[result.length-1]=last.join('')+'…';}return result;};
  return {width,wrap,truncate};
}
export function layoutElement(e:Element,metrics:FontMetrics):ElementLayout{
  const {wrap,truncate}=measure(metrics);
  const padding=e.kind==='text'?4:16,max=Math.max(1,e.width-padding*2),titleSize=Math.min(96,e.fontSize+4);const allTitle=e.title?wrap(e.title,titleSize,max,600):[],title=truncate(allTitle,2,titleSize,max,600);const titleHeight=title.length*titleSize*1.25+(title.length?8:0),allBody=e.text?wrap(e.text,e.fontSize,max,e.fontWeight):[],fitHeight=Math.min(10000,Math.max(20,padding*2+titleHeight+allBody.length*e.fontSize*1.4)),available=Math.max(0,e.height-padding*2-titleHeight),rows=Math.floor(available/(e.fontSize*1.4)),overflow=allTitle.length>2||allBody.length>rows;const body=truncate(allBody,rows,e.fontSize,max,e.fontWeight);if(overflow&&!body.length&&e.text&&e.height>=padding+e.fontSize)body.push('…');const centered=e.kind==='rectangle',contentHeight=titleHeight+body.length*e.fontSize*1.4;let y=e.y+(centered?Math.max(padding,(e.height-contentHeight)/2):padding);const x=centered?e.x+e.width/2:e.x+padding;const project=(lines:string[],size:number,weight:number,spacing:number):TextRow[]=>lines.map(text=>{const row={text,x,y:y+size,size,weight};y+=size*spacing;return row;});const titleRows=project(title,titleSize,600,1.25);if(title.length)y+=8;return{id:e.id,bounds:{x:e.x,y:e.y,width:e.width,height:e.height},title:titleRows,body:project(body,e.fontSize,e.fontWeight,1.4),fitHeight,overflow};
}
export function layoutConnector(board:Board,e:Element,metrics:FontMetrics,points:Point[]):ConnectorLayout{
  const {width,wrap,truncate}=measure(metrics);
  const center=pointOnRoute(points,.5),lines=truncate(wrap(e.text,e.fontSize,260,e.fontWeight),2,e.fontSize,260,e.fontWeight),w=Math.max(0,...lines.map(s=>width(s,e.fontSize,e.fontWeight)))+16,h=lines.length*e.fontSize*1.4+12,endpoints=board.elements.filter(n=>n.id===e.from||n.id===e.to),frame=board.elements.filter(f=>f.kind==='frame'&&endpoints.every(n=>n.x>=f.x&&n.y>=f.y&&n.x+n.width<=f.x+f.width&&n.y+n.height<=f.y+f.height)).sort((a,b)=>a.width*a.height-b.width*b.height||a.id-b.id)[0];const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));let x=center.x-w/2;if(frame&&frame.width>=w+16)x=clamp(x,frame.x+8,frame.x+frame.width-w-8);const min=frame&&frame.height>=h+16?frame.y+8:-Infinity,max=frame&&frame.height>=h+16?frame.y+frame.height-h-8:Infinity;const intervals=board.elements.filter(n=>!['frame','connector'].includes(n.kind)&&x<n.x+n.width+8&&x+w>n.x-8).map(n=>[n.y-h-8,n.y+n.height+8]).sort((a,b)=>a[0]-b[0]);const merged:number[][]=[];for(const [a,b]of intervals){const last=merged.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);}const desired=clamp(center.y-h-8,min,max),y=[desired,...merged.flat()].filter(v=>v>=min&&v<=max&&!merged.some(([a,b])=>v>a&&v<b)).sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired)||a-b)[0]??desired;const bounds:Bounds={x,y,width:w,height:h};return{id:e.id,points,captionBounds:bounds,caption:lines.map((text,i)=>({text,x:x+w/2,y:y+6+e.fontSize+i*e.fontSize*1.4,size:e.fontSize,weight:e.fontWeight}))};
}
export function projectScene(board:Board,metrics:FontMetrics):SceneLayout {
  return {elements:board.elements.filter(e=>e.kind!=='connector').map(e=>layoutElement(e,metrics)),connectors:board.elements.filter(e=>e.kind==='connector').map(e=>layoutConnector(board,e,metrics,connectorPoints(board,e,n=>n).map(({x,y})=>({x,y}))))};
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx playwright test --project=unit && npm run typecheck && npm run build && npx playwright test --project=chromium e2e/editor-ux.spec.ts -g shared_layout_fixture`
Expected: unit — все PASS; `shared_layout_fixture_and_live_caption` PASS (общий фикстур раскладки не изменился).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/camera.ts frontend/src/diff.ts frontend/src/preview.ts e2e/unit
git commit -m "refactor: extract camera math, board diff and per-element layout"
```

### Task 4: Холст на цикле кадра — сцена, оверлей, фасад

Самая крупная задача: старый `canvas.ts` рисует всё синхронно и опирается на серверный SVG, поэтому сцена, оверлей и фасад меняются вместе. Публичный API `CanvasView` сохраняется, кроме `setBoard(board)` без второго аргумента, нового `clear()` и колбэков `onPins`/`onChrome` вместо `onPreview`.

**Files:**
- Create: `frontend/src/svg.ts`, `frontend/src/scene.ts`, `frontend/src/overlay.ts`
- Rewrite: `frontend/src/canvas.ts`
- Modify: `frontend/src/editor.ts` (конструктор, `empty`, `open`, `select`, `syncQueue`, `refresh`, новый `scheduleSaveView`)
- Test: `e2e/smoothness.spec.ts` (новый)

**Interfaces:**
- Consumes: `FrameScheduler`, `Dirty`, `Layer` (Task 2); `Camera`, `ZoomAnimation`, `zoomAround`, `reducedMotion` (Task 3); `changedIds` (Task 3); `layoutElement`, `layoutConnector`, `textWidth` (Task 3).
- Produces (`svg.ts`): `svgElement<K extends keyof SVGElementTagNameMap>(kind:K,attrs?:Record<string,string|number>):SVGElementTagNameMap[K]`; `setAttrs(node:globalThis.Element,values:Record<string,string|number>):void` (пишет атрибут только если значение изменилось).
- Produces (`scene.ts`): `class SceneRenderer{constructor(root:SVGGElement,defs:SVGDefsElement,metrics:()=>FontMetrics|null);clear():void;setZoom(zoom:number):void;paint(board:Board,dirty:Dirty,project:(e:Element)=>Element,points:(e:Element)=>Point[],previewId:number|null):void}`. Группа не-стрелки имеет `transform="translate(x y)"`, дочерние узлы — в локальных координатах.
- Produces (`overlay.ts`): `interface OverlayState{selected:Element[];connectorEnds:{id:number;from:Point|null;to:Point|null}|null;hover:Element|null;marquee:Bounds|null;drop:Element|null;create:{bounds:Bounds;kind:Kind}|null;connectorTarget:{element:Element;port:Point}|null;zoom:number}`; `class OverlayRenderer{constructor(root:SVGGElement);render(state:OverlayState):void}`. Hover-рамка — `rect[data-hover]`.
- Produces (`canvas.ts`): `CanvasView` с полями `svg, world, scene, board, selected, camera:Camera, metrics, preview, resizePreview, frames:FrameScheduler, onCamera, onPins, onChrome` и методами `setBoard(board)`, `clear()`, `updateCamera()`, `worldPoint`, `pan`, `zoom(factor,clientX?,clientY?)`, `animateZoom(factor,clientX?,clientY?)`, `fit(frameId?)`, `reveal(point)`, `setSelection(ids)`, `setHover(id|null)`, `project(e)`/`project(board)`, `previewConnector`, `previewMove`, `previewResize`, `highlightDrop`, `previewCreate`, `clearPreview`, `marquee`, `elementAt`. Экспорт `members`, `orderedFrames` без изменений. Отладочный буфер `globalThis.wireboardFrameStats:number[]` (последние 600 длительностей кадра, мс).

- [ ] **Step 1: Write the failing tests**

`e2e/smoothness.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {setup,board,apply,box} from './ux-helpers';
test('editor_paints_the_scene_without_server_svg',async({page})=>{
  const renders:string[]=[];page.on('request',r=>{if(r.url().includes('/render?format=svg')&&!r.url().includes('frame='))renders.push(r.url());});
  const id=await setup(page);
  await apply(page,id,1,[{op:'create',element:{kind:'rectangle',x:420,y:100,text:'B'}},{op:'create',element:{kind:'connector',from:1,to:2}}]);
  await expect(page.locator('#scene-defs marker#arrow-3')).toBeAttached();
  await expect(page.locator('#scene [data-id="3"] path').first()).toHaveAttribute('marker-end','url(#arrow-3)');
  await page.reload();await expect(page.locator('#scene [data-id="3"]')).toBeAttached();await expect(page.locator('#scene [data-id="2"]')).toContainText('B');
  expect(renders).toEqual([]);
});
test('drag_moves_block_without_recreating_its_text',async({page})=>{
  const id=await setup(page);const text=page.locator('#scene [data-id="1"] text').first();await text.evaluate(n=>{(n as unknown as {mark:boolean}).mark=true;});
  const b=await box(page);await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+95,b.y+65,{steps:6});
  await expect.poll(async()=>(await box(page)).x).toBeCloseTo(b.x+60,0);expect(await text.evaluate(n=>!!(n as unknown as {mark?:boolean}).mark)).toBe(true);
  await page.mouse.up();await expect.poll(async()=>(await board(page,id)).revision).toBe(2);await expect(page.locator('#status')).toContainText('сохранены');
  expect(await text.evaluate(n=>!!(n as unknown as {mark?:boolean}).mark)).toBe(true);
});
test('agent_deleting_the_selected_block_hides_its_handles',async({page})=>{
  const id=await setup(page);await page.locator('#scene [data-id="1"]').click();await expect(page.locator('[data-handle="e"]')).toBeVisible();
  await apply(page,id,1,[{op:'delete',ids:[1]}]);
  await expect(page.locator('#scene [data-id="1"]')).toHaveCount(0);await expect(page.locator('[data-handle="e"]')).toBeHidden();
});
test('undo_restores_a_deleted_block_on_the_canvas',async({page})=>{
  const id=await setup(page);await page.locator('#scene [data-id="1"]').click();await page.keyboard.press('Delete');
  await expect(page.locator('#scene [data-id="1"]')).toHaveCount(0);await expect.poll(async()=>(await board(page,id)).revision).toBe(2);
  await page.keyboard.press('Control+z');await expect(page.locator('#scene [data-id="1"]')).toBeVisible();await expect(page.locator('#scene [data-id="1"]')).toContainText('Card');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/smoothness.spec.ts`
Expected: FAIL — `editor_paints_the_scene_without_server_svg` видит запросы `render?format=svg`; `drag_moves_block_without_recreating_its_text` теряет метку (текст пересоздаётся при переносе). Остальные два могут уже проходить — это регрессионные тесты.

- [ ] **Step 3: Implement `frontend/src/svg.ts`**

```ts
export const ns='http://www.w3.org/2000/svg';
export function setAttrs(node:globalThis.Element,values:Record<string,string|number>):void{for(const [key,value]of Object.entries(values)){const text=String(value);if(node.getAttribute(key)!==text)node.setAttribute(key,text);}}
export function svgElement<K extends keyof SVGElementTagNameMap>(kind:K,attrs:Record<string,string|number>={}):SVGElementTagNameMap[K]{const node=document.createElementNS(ns,kind) as SVGElementTagNameMap[K];setAttrs(node,attrs);return node;}
```

- [ ] **Step 4: Implement `frontend/src/scene.ts`**

```ts
import type {Board,Element,FontMetrics,TextRow} from './types';
import type {Point} from './anchors';
import type {Dirty} from './frame';
import {layoutConnector,layoutElement,textWidth} from './preview';
import {setAttrs,svgElement} from './svg';
const SHAPES=['rectangle','text','image'];
function textNode(row:TextRow,anchor:string){const t=svgElement('text',{x:row.x,y:row.y,'font-family':'Golos Text','font-size':row.size,'font-weight':row.weight,'font-kerning':'none','font-variant-ligatures':'none','text-anchor':anchor,fill:'#302b3b','pointer-events':'none'});const span=svgElement('tspan',{x:row.x,y:row.y});span.textContent=row.text;t.append(span);return t;}
export class SceneRenderer {
  private groups=new Map<number,SVGGElement>();private signatures=new Map<number,string>();private images=new Map<number,string|null>();private zoom=1;
  constructor(private root:SVGGElement,private defs:SVGDefsElement,private metrics:()=>FontMetrics|null){}
  clear():void{this.root.replaceChildren();this.defs.replaceChildren();this.groups.clear();this.signatures.clear();this.images.clear();}
  setZoom(zoom:number):void{this.zoom=zoom;for(const group of this.groups.values())if(group.dataset.kind==='frame')this.frameHeader(group,Number(group.dataset.titleWidth??0));}
  paint(board:Board,dirty:Dirty,project:(e:Element)=>Element,points:(e:Element)=>Point[],previewId:number|null):void{
    const metrics=this.metrics();if(!metrics)return;
    const live=new Set(board.elements.map(e=>e.id));
    for(const [id,group]of this.groups)if(!live.has(id)){group.remove();this.groups.delete(id);this.signatures.delete(id);this.images.delete(id);}
    for(const e of board.elements)if(e.kind!=='connector'&&(dirty==='all'||dirty.has(e.id)))this.paintElement(project(e),metrics);
    // Captions avoid the projected obstacles, so connectors use the projected board.
    const projected={...board,elements:board.elements.map(project)};
    for(const e of projected.elements)if(e.kind==='connector')this.paintConnector(projected,e,metrics,points(e),previewId===e.id);
    this.syncMarkers(board);
  }
  private groupFor(e:Element):SVGGElement{
    let group=this.groups.get(e.id);if(group)return group;
    group=svgElement('g',{'data-id':e.id,'data-kind':e.kind});
    const first=(kinds:string[])=>[...this.root.children].find(n=>kinds.includes(n.getAttribute('data-kind')??''))??null;
    this.root.insertBefore(group,e.kind==='frame'?first(['connector',...SHAPES]):e.kind==='connector'?first(SHAPES):null);
    this.groups.set(e.id,group);return group;
  }
  private paintElement(e:Element,metrics:FontMetrics){
    const group=this.groupFor(e);setAttrs(group,{transform:`translate(${e.x} ${e.y})`});
    const tag=e.kind==='image'?'image':'rect';let shape=group.querySelector<SVGGraphicsElement>(':scope > rect:not([data-frame-header-hit]),:scope > image');
    if(!shape||shape.tagName!==tag){shape?.remove();shape=svgElement(tag);group.prepend(shape);}
    setAttrs(shape,{x:0,y:0,width:e.width,height:e.height,rx:e.kind==='frame'?12:5,fill:e.kind==='text'?'transparent':e.fill,stroke:e.kind==='text'?'none':e.kind==='frame'?'#b0bdb4':e.stroke,'stroke-width':e.kind==='frame'?1.5:2});
    if(e.kind==='image'&&this.images.get(e.id)!==e.image){this.images.set(e.id,e.image);setAttrs(shape,{href:e.image??'',preserveAspectRatio:'xMidYMid meet'});}
    if(e.kind==='frame'){this.paintFrame(group,e,metrics);return;}
    // Layout runs in element-local space: moving a block keeps its text nodes.
    const layout=layoutElement({...e,x:0,y:0},metrics),signature=JSON.stringify(layout);
    if(this.signatures.get(e.id)===signature)return;this.signatures.set(e.id,signature);
    group.querySelectorAll(':scope > g,:scope > clipPath').forEach(n=>n.remove());
    const clip=svgElement('clipPath',{id:`text-${e.id}`});clip.append(svgElement('rect',{...layout.bounds}));
    const rows=svgElement('g',{'clip-path':`url(#text-${e.id})`,'data-fit-height':layout.fitHeight,'data-text-overflow':String(layout.overflow),'pointer-events':'none'});
    rows.append(...[...layout.title,...layout.body].map(row=>textNode(row,e.kind==='rectangle'?'middle':'start')));group.append(clip,rows);
  }
  private paintFrame(group:SVGGElement,e:Element,metrics:FontMetrics){
    const width=textWidth(e.text,15,e.fontWeight,metrics);group.dataset.titleWidth=String(width);this.frameHeader(group,width);
    let title=group.querySelector<SVGTextElement>(':scope > text');if(!title){title=svgElement('text',{'font-family':'Golos Text','font-size':15,fill:'#66786c','pointer-events':'none'});group.append(title);}
    setAttrs(title,{x:0,y:-12,'font-weight':e.fontWeight});if(title.textContent!==e.text)title.textContent=e.text;
  }
  private frameHeader(group:SVGGElement,titleWidth:number){
    let hit=group.querySelector<SVGRectElement>('[data-frame-header-hit]');if(!hit){hit=svgElement('rect',{'data-frame-header-hit':'',fill:'transparent','pointer-events':'all'});group.append(hit);}
    const z=this.zoom,height=Math.max(24/z,20);setAttrs(hit,{x:-4/z,y:-18-height/2,width:Math.max(24/z,titleWidth+8/z),height});
  }
  private paintConnector(board:Board,e:Element,metrics:FontMetrics,points:Point[],preview:boolean){
    const group=this.groupFor(e),layout=layoutConnector(board,e,metrics,points);
    if(preview)group.setAttribute('data-connector-preview',String(e.id));else group.removeAttribute('data-connector-preview');
    const d=points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
    let paths=group.querySelectorAll(':scope > path');if(!paths.length){group.prepend(svgElement('path'),svgElement('path'));paths=group.querySelectorAll(':scope > path');}
    setAttrs(paths[0],{d,fill:'none',stroke:e.stroke,'stroke-width':2,'marker-end':`url(#arrow-${e.id})`});setAttrs(paths[1],{d,fill:'none',stroke:'transparent','stroke-width':16});
    const signature=JSON.stringify([layout.captionBounds,layout.caption]);if(this.signatures.get(e.id)===signature)return;this.signatures.set(e.id,signature);
    group.querySelectorAll(':scope > rect,:scope > text').forEach(n=>n.remove());
    if(e.text)group.append(svgElement('rect',{...layout.captionBounds,rx:3,fill:'#ffffff','data-connector-label':'true'}),...layout.caption.map(row=>textNode(row,'middle')));
  }
  private syncMarkers(board:Board){
    const wanted=new Map(board.elements.filter(e=>e.kind==='connector').map(e=>[`arrow-${e.id}`,e.stroke]));
    for(const marker of [...this.defs.querySelectorAll('marker')]){const fill=wanted.get(marker.id);if(fill===undefined){marker.remove();continue;}setAttrs(marker.firstElementChild!,{fill});wanted.delete(marker.id);}
    for(const [id,fill]of wanted){const marker=svgElement('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',fill}));this.defs.append(marker);}
  }
}
```

- [ ] **Step 5: Implement `frontend/src/overlay.ts`**

```ts
import type {Bounds,Element,Kind} from './types';
import type {Point} from './anchors';
import {reducedMotion} from './camera';
import {setAttrs,svgElement} from './svg';
const ACCENT='#7e4bb2';
const HANDLES=[['nw',0,0,'nwse'],['n',.5,0,'ns'],['ne',1,0,'nesw'],['e',1,.5,'ew'],['se',1,1,'nwse'],['s',.5,1,'ns'],['sw',0,1,'nesw'],['w',0,.5,'ew']] as const;
export interface OverlayState{selected:Element[];connectorEnds:{id:number;from:Point|null;to:Point|null}|null;hover:Element|null;marquee:Bounds|null;drop:Element|null;create:{bounds:Bounds;kind:Kind}|null;connectorTarget:{element:Element;port:Point}|null;zoom:number}
const show=(node:globalThis.Element,visible:boolean)=>setAttrs(node,{display:visible?'inline':'none'});
// Nodes are created once and only updated, so a frame never rebuilds the overlay.
export class OverlayRenderer {
  private hover=svgElement('rect',{'data-hover':'',rx:6,fill:'none',stroke:ACCENT,'stroke-opacity':.55,'pointer-events':'none',display:'none'});
  private drop=svgElement('rect',{rx:4,fill:'#7e4bb211',stroke:ACCENT,'pointer-events':'none',display:'none'});
  private create=svgElement('g',{'pointer-events':'none',display:'none'});private createRect=svgElement('rect');private createLabel=svgElement('text',{fill:'#51316f','font-family':'Golos Text'});
  private target=svgElement('g',{'pointer-events':'none',display:'none'});private targetRect=svgElement('rect',{rx:5,fill:'#7e4bb211',stroke:ACCENT});private targetDot=svgElement('circle',{fill:ACCENT});
  private frames=svgElement('g',{'pointer-events':'none'});private controls=svgElement('g');
  private handles=HANDLES.map(([handle,,,cursor])=>{const g=svgElement('g',{'data-handle':handle,cursor:`${cursor}-resize`,display:'none'});g.append(svgElement('rect',{fill:'transparent'}),svgElement('rect',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private ends=(['from','to'] as const).map(end=>{const g=svgElement('g',{'data-end':end,cursor:'crosshair','aria-label':end==='from'?'Начало связи':'Конец связи',display:'none'});g.append(svgElement('circle',{fill:'transparent'}),svgElement('circle',{fill:'#ffffff',stroke:ACCENT,'pointer-events':'none'}));return g;});
  private marquee=svgElement('rect',{fill:'#7e4bb220',stroke:ACCENT,'pointer-events':'none',display:'none'});
  private selectionKey='';
  constructor(root:SVGGElement){this.create.append(this.createRect,this.createLabel);this.target.append(this.targetRect,this.targetDot);this.controls.append(...this.handles,...this.ends);root.replaceChildren(this.hover,this.drop,this.create,this.target,this.frames,this.controls,this.marquee);}
  render(s:OverlayState):void{
    const z=s.zoom;
    show(this.hover,!!s.hover);if(s.hover)setAttrs(this.hover,{x:s.hover.x-2,y:s.hover.y-2,width:s.hover.width+4,height:s.hover.height+4,'stroke-width':1/z});
    show(this.drop,!!s.drop);if(s.drop)setAttrs(this.drop,{'data-drop-target':s.drop.id,x:s.drop.x,y:s.drop.y,width:s.drop.width,height:s.drop.height,'stroke-width':2/z,'stroke-dasharray':`${6/z} ${4/z}`});else this.drop.removeAttribute('data-drop-target');
    show(this.create,!!s.create);
    if(s.create){const b=s.create.bounds,k=s.create.kind;setAttrs(this.create,{'data-creation-preview':k});setAttrs(this.createRect,{...b,rx:k==='frame'?12:5,fill:k==='text'?'none':k==='frame'?'#e0f0e844':'#eee5f866',stroke:ACCENT,'stroke-width':1.5/z,'stroke-dasharray':`${5/z} ${3/z}`});setAttrs(this.createLabel,{x:b.x,y:b.y-10/z,'font-size':12/z});this.createLabel.textContent=`${Math.round(b.width)} × ${Math.round(b.height)}`;}
    else this.create.removeAttribute('data-creation-preview');
    show(this.target,!!s.connectorTarget);
    if(s.connectorTarget){const {element:e,port}=s.connectorTarget;setAttrs(this.target,{'data-connector-target':e.id});setAttrs(this.targetRect,{x:e.x,y:e.y,width:e.width,height:e.height,'stroke-width':2/z});setAttrs(this.targetDot,{cx:port.x,cy:port.y,r:5/z});}
    else this.target.removeAttribute('data-connector-target');
    const boxes=s.selected.filter(e=>e.kind!=='connector');
    while(this.frames.childElementCount<boxes.length)this.frames.append(svgElement('rect',{rx:6,fill:'none',stroke:ACCENT}));
    [...this.frames.children].forEach((rect,i)=>{const e=boxes[i];show(rect,!!e);if(e)setAttrs(rect,{x:e.x-4,y:e.y-4,width:e.width+8,height:e.height+8,'stroke-width':1.5/z});});
    const single=s.selected.length===1&&s.selected[0].kind!=='connector'?s.selected[0]:null;
    this.handles.forEach((g,i)=>{show(g,!!single);if(!single){g.removeAttribute('data-resize');return;}const [,u,v]=HANDLES[i],x=single.x+single.width*u,y=single.y+single.height*v,size=24/z,mark=8/z;setAttrs(g,{'data-resize':single.id});setAttrs(g.children[0],{x:x-size/2,y:y-size/2,width:size,height:size});setAttrs(g.children[1],{x:x-mark/2,y:y-mark/2,width:mark,height:mark,rx:1.5/z,'stroke-width':1/z});});
    this.ends.forEach((g,i)=>{const ends=s.connectorEnds,p=ends?(i===0?ends.from:ends.to):null;show(g,!!p);if(!p||!ends){g.removeAttribute('data-connector-end');return;}setAttrs(g,{'data-connector-end':ends.id});setAttrs(g.children[0],{cx:p.x,cy:p.y,r:12/z});setAttrs(g.children[1],{cx:p.x,cy:p.y,r:4/z,'stroke-width':1.5/z});});
    show(this.marquee,!!s.marquee);if(s.marquee)setAttrs(this.marquee,{...s.marquee,'stroke-width':1/z});
    const key=s.selected.map(e=>e.id).join(',');
    if(key!==this.selectionKey){this.selectionKey=key;if(key&&!reducedMotion())for(const layer of [this.frames,this.controls])layer.animate([{opacity:0},{opacity:1}],{duration:80,easing:'ease-out'});}
  }
}
```

- [ ] **Step 6: Rewrite `frontend/src/canvas.ts`**

```ts
import type {Board,Bounds,Element,FontMetrics,Kind} from './types';
import {connectorPoints,connectorPreviewPoints,type ConnectorEnd,type ConnectorTarget,type Point} from './anchors';
import {FrameScheduler,type Dirty,type Layer} from './frame';
import {SceneRenderer} from './scene';
import {OverlayRenderer} from './overlay';
import {ZoomAnimation,reducedMotion,zoomAround,type Camera} from './camera';
import {changedIds} from './diff';
export function members(board: Board, ids: number[]) {
  const set = new Set(ids);
  const frontier=board.elements.filter(e=>ids.includes(e.id)&&e.kind==='frame').map(e=>e.id);
  while(frontier.length){const parent=frontier.pop()!;for(const e of board.elements)if(e.parentFrameId===parent&&!set.has(e.id)){set.add(e.id);frontier.push(e.id);}}
  return [...set];
}
export function orderedFrames(board: Board) { return board.elements.filter(e => e.kind === 'frame').sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id); }
const FRAME_SAMPLES=600;
const clampCoordinate=(value:number)=>Math.max(-1e7,Math.min(1e7,value));
// Debug buffer read by e2e/perf.spec.ts.
const recordFrame=(ms:number)=>{const stats=((globalThis as {wireboardFrameStats?:number[]}).wireboardFrameStats??=[]);stats.push(ms);if(stats.length>FRAME_SAMPLES)stats.shift();};
export class CanvasView {
  svg = document.querySelector<SVGSVGElement>('#canvas')!;
  world = document.querySelector<SVGGElement>('#world')!;
  scene = document.querySelector<SVGGElement>('#scene')!;
  board: Board | null = null; selected: number[] = []; camera: Camera = { x: 80, y: 70, zoom: 1 };
  metrics:FontMetrics|null=null;
  preview: { ids: number[]; dx: number; dy: number } | null = null;
  resizePreview: {id:number;width:number;height:number;x:number;y:number} | null = null;
  onCamera: (() => void) | null = null; onPins: (() => void) | null = null; onChrome: (() => void) | null = null;
  readonly frames=new FrameScheduler((layer,dirty)=>this.paint(layer,dirty),undefined,recordFrame);
  private renderer=new SceneRenderer(this.scene,document.querySelector<SVGDefsElement>('#scene-defs')!,()=>this.metrics);
  private overlay=new OverlayRenderer(document.querySelector<SVGGElement>('#selection')!);
  private zoomAnimation=new ZoomAnimation();
  private connectorPreview:{board:Board;id:number;end:ConnectorEnd;point:Point;target:ConnectorTarget|null}|null=null;
  private hover:number|null=null;private marqueeBounds:Bounds|null=null;private drop:number|null=null;private creation:{bounds:Bounds;kind:Kind}|null=null;private paintedZoom=0;
  constructor() { new ResizeObserver(() => this.updateCamera()).observe(this.svg); }
  setBoard(board: Board) { if(this.board?.id!==board.id){this.renderer.clear();this.board=null;this.hover=null;} this.svg.dataset.board = board.id; this.project(board); }
  clear() { this.board=null;this.selected=[];this.hover=null;this.clearPreview();this.renderer.clear();delete this.svg.dataset.board;this.frames.invalidate('overlay');this.frames.invalidate('pins'); }
  updateCamera() { for(const layer of ['camera','overlay','pins','chrome'] as const)this.frames.invalidate(layer); }
  worldPoint(clientX: number, clientY: number) { const rect = this.svg.getBoundingClientRect(); return { x: (clientX - rect.x - this.camera.x) / this.camera.zoom, y: (clientY - rect.y - this.camera.y) / this.camera.zoom }; }
  pan(dx:number,dy:number){this.zoomAnimation.stop();this.camera={...this.camera,x:clampCoordinate(this.camera.x-dx),y:clampCoordinate(this.camera.y-dy)};this.updateCamera();}
  zoom(factor: number, clientX?: number, clientY?: number) { this.zoomAnimation.stop();this.camera=zoomAround(this.camera,this.camera.zoom*factor,this.anchor(clientX,clientY));this.updateCamera(); }
  animateZoom(factor:number,clientX?:number,clientY?:number){
    if(reducedMotion()){this.zoom(factor,clientX,clientY);return;}
    // Repeated steps extend the running target instead of restarting from the current frame.
    this.zoomAnimation.retarget(this.camera.zoom,(this.zoomAnimation.target??this.camera.zoom)*factor,this.anchor(clientX,clientY),performance.now());this.updateCamera();
  }
  private anchor(clientX?:number,clientY?:number):Point{const rect=this.svg.getBoundingClientRect();return{x:(clientX??rect.x+rect.width/2)-rect.x,y:(clientY??rect.y+rect.height/2)-rect.y};}
  fit(frameId?: number) {
    if (!this.board) return; this.zoomAnimation.stop(); const elements = frameId === undefined ? this.board.elements.filter(e => e.kind !== 'connector') : this.board.elements.filter(e => e.id === frameId); if (!elements.length) { this.camera = { x: 80, y: 70, zoom: 1 }; this.updateCamera(); return; }
    const x = Math.min(...elements.map(e => e.x)), y = Math.min(...elements.map(e => e.y)) - 25, right = Math.max(...elements.map(e => e.x + e.width)), bottom = Math.max(...elements.map(e => e.y + e.height));
    const rect = this.svg.getBoundingClientRect(); const zoom = Math.min(1.25, Math.max(.1, Math.min((rect.width - 100) / (right - x), (rect.height - 160) / (bottom - y)))); this.camera = { x: (rect.width - (right - x) * zoom) / 2 - x * zoom, y: (rect.height - (bottom - y) * zoom) / 2 - y * zoom, zoom }; this.updateCamera();
  }
  reveal(point:Point){this.zoomAnimation.stop();const rect=this.svg.getBoundingClientRect();this.camera={...this.camera,x:rect.width/2-point.x*this.camera.zoom,y:rect.height/2-point.y*this.camera.zoom};this.updateCamera();}
  setSelection(ids: number[]) { this.selected = ids.filter(id => this.board?.elements.some(e => e.id === id)); this.frames.invalidate('overlay'); }
  setHover(id:number|null){if(this.hover===id)return;this.hover=id;this.frames.invalidate('overlay');}
  project(e:Element):Element;
  project(board:Board):void;
  project(input:Element|Board):Element|void {
    if('kind' in input){const resize=this.resizePreview?.id===input.id?this.resizePreview:null;const move=this.preview?.ids.includes(input.id)?this.preview:null;return {...input,x:resize?.x??input.x+(move?.dx??0),y:resize?.y??input.y+(move?.dy??0),width:resize?.width??input.width,height:resize?.height??input.height};}
    const dirty=changedIds(this.board,input);this.board=input;this.selected=this.selected.filter(id=>input.elements.some(e=>e.id===id));
    document.querySelector('#canvas-hint')!.toggleAttribute('hidden',input.elements.length>0);
    this.frames.invalidate('scene',dirty==='all'?undefined:dirty);this.frames.invalidate('overlay');this.frames.invalidate('pins');
  }
  previewConnector(board:Board,id:number,end:ConnectorEnd,point:Point,target:ConnectorTarget|null){this.connectorPreview={board,id,end,point,target};this.previewChanged([]);}
  previewMove(ids: number[], dx: number, dy: number) { const previous=this.preview?.ids??[];this.preview = { ids, dx, dy };this.previewChanged([...previous,...ids]); }
  previewResize(id:number,width:number,height:number,x=this.board!.elements.find(e=>e.id===id)!.x,y=this.board!.elements.find(e=>e.id===id)!.y){const previous=this.resizePreview?[this.resizePreview.id]:[];this.resizePreview={id,width,height,x,y};this.previewChanged([...previous,id]);}
  highlightDrop(frameId:number|null){if(this.drop===frameId)return;this.drop=frameId;this.frames.invalidate('overlay');}
  previewCreate(bounds:Bounds,kind:Kind){this.creation={bounds,kind};this.frames.invalidate('overlay');}
  marquee(x: number, y: number, width: number, height: number) { this.marqueeBounds={x,y,width,height};this.frames.invalidate('overlay'); }
  clearPreview() { const ids=[...(this.preview?.ids??[]),...(this.resizePreview?[this.resizePreview.id]:[])];this.preview = null;this.resizePreview=null;this.connectorPreview=null;this.creation=null;this.marqueeBounds=null;this.previewChanged(ids); }
  elementAt(target: EventTarget | null): Element | undefined { const id = (target as globalThis.Element | null)?.closest?.('[data-id]')?.getAttribute('data-id'); return this.board?.elements.find(e => e.id === Number(id)); }
  private previewChanged(ids:number[]){this.frames.invalidate('scene',ids);this.frames.invalidate('overlay');this.frames.invalidate('pins');}
  private linkPoints(e:Element){const p=this.connectorPreview;if(p?.id===e.id){const link=p.board.elements.find(n=>n.id===e.id)!;return connectorPreviewPoints(p.board,link,p.end,p.point,p.target);}return this.board?connectorPoints(this.board,e,n=>this.project(n)):[];}
  private paint(layer:Layer,dirty:Dirty){
    if(layer==='camera'){
      if(this.zoomAnimation.active){this.camera=this.zoomAnimation.step(this.camera,performance.now());if(this.zoomAnimation.active)this.updateCamera();}
      const transform=`translate(${this.camera.x} ${this.camera.y}) scale(${this.camera.zoom})`;this.world.setAttribute('transform',transform);document.querySelector('#dots')!.setAttribute('patternTransform',transform);
      if(this.paintedZoom!==this.camera.zoom){this.paintedZoom=this.camera.zoom;this.renderer.setZoom(this.camera.zoom);}
      this.onCamera?.();return;
    }
    if(layer==='scene'){if(this.board)this.renderer.paint(this.board,dirty,e=>this.project(e),e=>this.linkPoints(e),this.connectorPreview?.id??null);return;}
    if(layer==='overlay'){this.paintOverlay();return;}
    if(layer==='pins'){this.onPins?.();return;}
    this.onChrome?.();
  }
  private paintOverlay(){
    const board=this.board,find=(id:number|null)=>id===null?null:board?.elements.find(e=>e.id===id)??null;
    const selected=(board?.elements.filter(e=>this.selected.includes(e.id))??[]).map(e=>this.project(e)),single=selected.length===1?selected[0]:null;
    let connectorEnds=null;if(single?.kind==='connector'){const points=this.linkPoints(single);connectorEnds={id:single.id,from:points[0]??null,to:points.at(-1)??null};}
    let connectorTarget=null;const p=this.connectorPreview,target=p?.target?p.board.elements.find(n=>n.id===p.target!.id):undefined;
    if(p&&target){const points=this.linkPoints(p.board.elements.find(n=>n.id===p.id)!),port=p.end==='from'?points[0]:points.at(-1);if(port)connectorTarget={element:target,port};}
    const hover=find(this.hover),showHover=hover&&!this.selected.includes(hover.id)&&!this.preview&&!this.resizePreview;
    this.overlay.render({selected,connectorEnds,hover:showHover?this.project(hover):null,marquee:this.marqueeBounds,drop:find(this.drop),create:this.creation,connectorTarget,zoom:this.camera.zoom});
    // style.css matches [data-selected='true'].
    for(const group of this.scene.querySelectorAll(':scope > [data-kind="connector"]')){if(this.selected.includes(Number(group.getAttribute('data-id'))))group.setAttribute('data-selected','true');else group.removeAttribute('data-selected');}
  }
}
```

- [ ] **Step 7: Wire `frontend/src/editor.ts`**

Точечные замены (old → new):

1. Конструктор, строка с `this.view.onCamera = () => { el('zoom-value')…};` целиком →

```ts
    this.view.onCamera = () => { el('zoom-value').textContent = `${Math.round(this.view.camera.zoom * 100)}%`; this.scheduleSaveView(); };
    this.view.onPins=()=>this.comments.renderPins();
    this.view.onChrome=()=>{if(this.draft){const e=this.board?.elements.find(e=>e.id===this.draft?.id);if(e)this.textEditor.position(e,this.view);}};
    addEventListener('pagehide',()=>this.saveView());
```

2. Следующая строка: удалить фрагмент `this.view.onPreview=()=>this.comments.renderPins(); `.
3. В `empty()`: `this.view.board = null;this.view.sourceBoard=null; this.view.scene.replaceChildren(); this.view.setSelection([]); delete this.view.svg.dataset.board;` → `this.view.clear();`.
4. В `open()`: `const { state, svg } = await api.editSnapshot(id,this.actor.id);` → `const state = await api.editState(id,this.actor.id);`; `this.view.setBoard(board, svg);` → `this.view.setBoard(board);`.
5. В `refresh()`: `const {state,svg}=await api.editSnapshot(id,this.actor.id,commandId);` → `const state=await api.editState(id,this.actor.id,commandId);`; `this.view.setBoard(state.board,svg);` → `this.view.setBoard(state.board);`.
6. В `syncQueue()` удалить строку `if(queue.confirmed.board.revision>(this.view.sourceBoard?.revision??-1)&&!this.refreshing&&!this.interaction.active){this.queued=true;void this.refresh();}` — подтверждённое состояние из ответа сервера уже актуально, а чужие правки приходят через SSE.
7. В `select()`: `this.panels(); this.saveView(); }` → `this.panels(); this.scheduleSaveView(); }`.
8. После метода `saveView` добавить поле и метод:

```ts
  private saveTimer=0;
  private scheduleSaveView(){window.clearTimeout(this.saveTimer);this.saveTimer=window.setTimeout(()=>this.saveView(),300);}
```

Проверить, что других обращений не осталось: `grep -n "sourceBoard\|onPreview\|editSnapshot\|view.board =" frontend/src/*.ts` — пусто, кроме определения `editSnapshot` в `api.ts` (удаляется в Task 7).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium`
Expected: все chromium-спеки PASS, включая 4 новых в `e2e/smoothness.spec.ts`. Если падает спек, читающий `transform` камеры или DOM сразу после действия без `expect.poll`, — обернуть чтение в `expect.poll`/`toHaveAttribute` (отрисовка теперь в следующем кадре), а не откатывать планировщик.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/svg.ts frontend/src/scene.ts frontend/src/overlay.ts frontend/src/canvas.ts frontend/src/editor.ts e2e/smoothness.spec.ts
git commit -m "perf: paint the canvas from a frame loop with incremental scene and persistent overlay"
```

### Task 5: Ощущение — плавный зум, hover, курсор

**Files:**
- Modify: `frontend/src/interaction.ts` (импорт, wheel, конструктор, `move`, `down`, новый `hover`)
- Modify: `frontend/src/editor.ts` (кнопки зума)
- Modify: `frontend/src/style.css`
- Test: `e2e/smoothness.spec.ts`

**Interfaces:**
- Consumes: `CanvasView.animateZoom`, `CanvasView.setHover`, `CanvasView.zoom` (Task 4); `isDiscreteZoom` (Task 3).

- [ ] **Step 1: Write the failing tests**

Дописать в `e2e/smoothness.spec.ts`:

```ts
const zoomSamples=(page:import('@playwright/test').Page)=>page.evaluate(()=>new Promise<number[]>(resolve=>{
  const svg=document.querySelector('#canvas')!,r=svg.getBoundingClientRect(),out:number[]=[];
  svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,deltaMode:0,ctrlKey:true,clientX:r.x+300,clientY:r.y+300,bubbles:true,cancelable:true}));
  const tick=()=>{out.push((document.querySelector('#world') as SVGGElement).transform.baseVal.consolidate()!.matrix.a);if(out.length<20)requestAnimationFrame(tick);else resolve(out);};requestAnimationFrame(tick);
}));
test('wheel_zoom_eases_to_the_target',async({page})=>{
  await setup(page);const samples=await zoomSamples(page);
  expect(new Set(samples.map(v=>v.toFixed(4))).size).toBeGreaterThan(2);expect(samples.at(-1)).toBeCloseTo(Math.exp(.2),3);
});
test('reduced_motion_zooms_in_one_step',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await setup(page);const samples=await zoomSamples(page);
  expect(new Set(samples.map(v=>v.toFixed(4))).size).toBe(1);expect(samples[0]).toBeCloseTo(Math.exp(.2),3);
});
test('fast_zoom_button_clicks_accumulate',async({page})=>{
  await setup(page);for(let i=0;i<3;i++)await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-value')).toHaveText('173%');
});
test('hover_outlines_a_block_without_selecting_it',async({page})=>{
  await setup(page);await page.keyboard.press('Escape');const b=await box(page);
  await page.mouse.move(b.x+20,b.y+20);await expect(page.locator('#selection [data-hover]')).toBeVisible();await expect(page.locator('[data-handle="e"]')).toBeHidden();
  await page.mouse.move(b.x+b.width+150,b.y+b.height+150);await expect(page.locator('#selection [data-hover]')).toBeHidden();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=chromium e2e/smoothness.spec.ts`
Expected: FAIL — `wheel_zoom_eases_to_the_target` (один шаг без промежуточных значений), `hover_outlines_a_block_without_selecting_it` (hover не выставляется). `fast_zoom_button_clicks_accumulate` и `reduced_motion_zooms_in_one_step` могут проходить и сейчас — это защита от регрессий.

- [ ] **Step 3: Implement**

`frontend/src/interaction.ts`:

1. После `import {wheelIntent} from './navigation';` добавить `import {isDiscreteZoom} from './camera';`.
2. В обработчике `wheel`: `if(intent.type==='zoom')view.zoom(intent.factor,e.clientX,e.clientY);else view.pan(intent.dx,intent.dy);` → `if(intent.type==='zoom'){if(isDiscreteZoom(e))view.animateZoom(intent.factor,e.clientX,e.clientY);else view.zoom(intent.factor,e.clientX,e.clientY);}else view.pan(intent.dx,intent.dy);`
3. После `view.svg.addEventListener('contextmenu',e=>e.preventDefault());` добавить `view.svg.addEventListener('pointerleave',()=>view.setHover(null));`
4. Начало `move`: `private move(event:PointerEvent){const g=this.gesture;if(!g||g.pointer!==event.pointerId)return;` → `private move(event:PointerEvent){const g=this.gesture;if(!g){this.hover(event);return;}if(g.pointer!==event.pointerId)return;`
5. Начало `down`: `private down(event:PointerEvent){\n    this.finishNudge();` → `private down(event:PointerEvent){\n    this.finishNudge();this.view.setHover(null);`
6. После метода `setTool` добавить:

```ts
  private hover(event:PointerEvent){const target=this.tool==='select'&&!this.space?this.view.elementAt(event.target):undefined;this.view.setHover(target&&target.kind!=='connector'&&target.kind!=='frame'?target.id:null);}
```

`frontend/src/editor.ts`: `el('zoom-in').onclick = () => this.view.zoom(1.2); el('zoom-out').onclick = () => this.view.zoom(1 / 1.2);` → `el('zoom-in').onclick = () => this.view.animateZoom(1.2); el('zoom-out').onclick = () => this.view.animateZoom(1 / 1.2);`

`frontend/src/style.css`: после правила `#canvas[data-tool='comment'], …{ cursor: crosshair; }` добавить строку:

```css
#canvas[data-tool='select'] #scene > :is([data-kind='rectangle'], [data-kind='text'], [data-kind='image']), #canvas[data-tool='select'] [data-frame-header-hit] { cursor: move; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium e2e/smoothness.spec.ts e2e/navigation-links.spec.ts e2e/editor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/interaction.ts frontend/src/editor.ts frontend/src/style.css e2e/smoothness.spec.ts
git commit -m "feat: ease wheel and button zoom and outline blocks on hover"
```

### Task 6: Пины комментариев без пересоздания

**Files:**
- Modify: `frontend/src/comments.ts` (метод `renderPins`)
- Test: `e2e/smoothness.spec.ts`

**Interfaces:**
- Consumes: `CanvasView.onPins` вызывает `renderPins()` один раз за кадр (Task 4).
- Produces: `.comment-pin[data-thread]` и `.pin-leader[data-thread]` переиспользуются между кадрами; удаляются только при исчезновении обсуждения из видимых.

- [ ] **Step 1: Write the failing test**

Дописать в `e2e/smoothness.spec.ts`:

```ts
test('pins_follow_the_camera_without_being_recreated',async({page})=>{
  const id=await setup(page);await apply(page,id,1,[{op:'comment_create',author:'user',text:'Пин',anchor:{type:'element',elementId:1,u:.5,v:.5}}]);
  const pin=page.locator('.comment-pin');await expect(pin).toHaveCount(1);await pin.evaluate(n=>{(n as unknown as {mark:boolean}).mark=true;});
  const before=(await pin.boundingBox())!;const canvas=(await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.wheel(0,120);
  await expect.poll(async()=>(await pin.boundingBox())!.y).toBeLessThan(before.y-50);
  expect(await pin.evaluate(n=>!!(n as unknown as {mark?:boolean}).mark)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx playwright test --project=chromium e2e/smoothness.spec.ts -g pins_follow`
Expected: FAIL — метка теряется, потому что `renderPins` делает `replaceChildren`.

- [ ] **Step 3: Implement**

Заменить метод `renderPins()` в `frontend/src/comments.ts` целиком:

```ts
  renderPins() {
    this.pinsToggle.textContent = this.pinsVisible ? 'Скрыть метки на схеме' : 'Показать метки на схеме';
    const board = this.cb.current();
    const threads = board && this.pinsVisible ? board.comments.filter(c => c.status !== 'resolved' && (this.filters.has(c.status) || this.selection === c.id)).sort((a,b)=>Number(b.id===this.selection)-Number(a.id===this.selection)||a.id-b.id) : [];
    // Reuse nodes: camera and preview frames must not drop focus or restart transitions.
    const pins = new Map([...this.layer.querySelectorAll<HTMLButtonElement>('.comment-pin')].map(pin => [pin.dataset.thread!, pin]));
    const leaders = new Map([...this.layer.querySelectorAll<HTMLElement>('.pin-leader')].map(leader => [leader.dataset.thread!, leader]));
    const placed: { x: number; y: number }[] = [], shown = new Set<string>();
    for (const thread of threads) {
      const key = String(thread.id), p = this.anchorPoint(thread.anchor, thread);
      const origin = { x: this.view.camera.x + p.x * this.view.camera.zoom, y: this.view.camera.y + p.y * this.view.camera.zoom }; let x = origin.x, y = origin.y;
      while (placed.some(p => Math.hypot(p.x - x, p.y - y) < 44)) { x += 44; }
      placed.push({ x, y }); shown.add(key);
      let leader = leaders.get(key);
      if (x !== origin.x) { if (!leader) { leader = node('span', undefined, 'pin-leader'); leader.dataset.thread = key; this.layer.prepend(leader); } leader.style.left = `${origin.x}px`; leader.style.top = `${origin.y}px`; leader.style.width = `${x - origin.x}px`; }
      else { leader?.remove(); leaders.delete(key); }
      let pin = pins.get(key);
      if (!pin) { const created = node('button', key); created.dataset.thread = key; created.onclick = () => { created.focus({ preventScroll: true }); this.openThread(thread.id); }; this.layer.append(created); pin = created; }
      pin.className = `comment-pin ${thread.status}${this.orphan(thread) ? ' orphaned' : ''}`; pin.setAttribute('aria-label', `Комментарий ${thread.id}: ${labels[thread.status]}`); pin.style.left = `${x}px`; pin.style.top = `${y}px`;
    }
    for (const [key, pin] of pins) if (!shown.has(key)) pin.remove();
    for (const [key, leader] of leaders) if (!shown.has(key)) leader.remove();
    this.position();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium e2e/smoothness.spec.ts e2e/comments.spec.ts e2e/comment-popover.spec.ts`
Expected: PASS (включая счётчики `.comment-pin` в `comment-popover.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/comments.ts e2e/smoothness.spec.ts
git commit -m "perf: reuse comment pin nodes across frames"
```

### Task 7: Один запрос на правку и тишина на своё эхо

**Files:**
- Modify: `frontend/src/types.ts` (`BoardEvent`), `frontend/src/api.ts` (`applyState`, `historyState`; удалить `snapshot`, `editSnapshot`), `frontend/src/commands.ts` (`Adapter`, `pump`, `finish`, `isOwn`), `frontend/src/editor.ts` (создание очереди, `event`, `refresh`, `scheduleBoards`)
- Modify: route-шаблоны `**/api/boards/${id}/apply` во всех `e2e/*.spec.ts`; переписать `late_snapshot_does_not_erase_projection` в `e2e/command-queue.spec.ts`
- Test: `e2e/smoothness.spec.ts`

**Interfaces:**
- Consumes: серверный `?state=1` и `commandId`/`actorId` в SSE (Task 1).
- Produces: `api.applyState(id:string,command:CommandRequest):Promise<EditState>`, `api.historyState(id:string,command:HistoryCommand):Promise<EditState>`; `BoardEvent{id;revision;kind;commandId?:string;actorId?:string}`; `CommandQueue.isOwn(commandId?:string):boolean` (команда в полёте или среди 32 последних подтверждённых).

- [ ] **Step 1: Write the failing test**

Дописать в `e2e/smoothness.spec.ts` (импортировать `drag` из `./ux-helpers`):

```ts
test('own_drag_sends_exactly_one_request',async({page})=>{
  const id=await setup(page);const calls:string[]=[];
  page.on('request',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/api/'))calls.push(`${r.method()} ${url.pathname}${url.search}`);});
  await drag(page,40,0);await expect.poll(async()=>(await board(page,id)).revision).toBe(2);await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  await page.waitForTimeout(1200);
  expect(calls).toEqual([`POST /api/boards/${id}/apply?state=1`]);
});
```

`page.request` в хелпере `board()` идёт мимо страницы и в `calls` не попадает.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx playwright test --project=chromium e2e/smoothness.spec.ts -g own_drag`
Expected: FAIL — в `calls` есть `POST …/apply` без `state`, `GET …/edit-state…`, `GET /api/boards`.

- [ ] **Step 3: Implement the client**

`frontend/src/types.ts`: `export interface BoardEvent { id: string; revision: number; kind: 'created' | 'changed' | 'deleted' }` → `export interface BoardEvent { id: string; revision: number; kind: 'created' | 'changed' | 'deleted'; commandId?: string; actorId?: string }`.

`frontend/src/api.ts`: удалить свойства `snapshot` и `editSnapshot` целиком; после `history:` добавить:

```ts
  applyState: (id:string,command:CommandRequest)=>request<EditState>(`/api/boards/${id}/apply?state=1`,'POST',command),
  historyState: (id:string,command:HistoryCommand)=>request<EditState>(`/api/boards/${id}/history?state=1`,'POST',command),
```

`frontend/src/commands.ts`:

1. `interface Adapter {apply(id:string,request:CommandRequest):Promise<Board>;history(id:string,request:HistoryCommand):Promise<Board>;…}` → `interface Adapter {apply(id:string,request:CommandRequest):Promise<EditState>;history(id:string,request:HistoryCommand):Promise<EditState>;editState(id:string,actorId:string,commandId?:string):Promise<EditState>}`.
2. В `pump`: `if(p.kind==='edit')await this.adapter.apply(id,p.request as CommandRequest);else await this.adapter.history(id,p.request as HistoryCommand);\n      const state=await this.adapter.editState(id,this.actor.id,p.meta.id);this.running=false;this.finish(p,state);` → `const state=p.kind==='edit'?await this.adapter.apply(id,p.request as CommandRequest):await this.adapter.history(id,p.request as HistoryCommand);this.running=false;this.finish(p,state);`
3. Поле класса: `private recent:string[]=[];`. В начало тела `finish` после проверки `if(this.pending[0]!==p)return;` добавить `this.recent.push(p.meta.id);if(this.recent.length>32)this.recent.shift();`.
4. Метод после `get inFlightId()`: `isOwn(commandId?:string):boolean{return !!commandId&&(commandId===this.inFlightId||this.recent.includes(commandId));}`

`frontend/src/editor.ts`:

1. В `open()`: `this.queue=new CommandQueue(this.actor,state,api,()=>this.syncQueue());` → `this.queue=new CommandQueue(this.actor,state,{apply:api.applyState,history:api.historyState,editState:api.editState},()=>this.syncQueue());`
2. Заменить метод `event` целиком:

```ts
  private boardsTimer=0;
  private scheduleBoards(){window.clearTimeout(this.boardsTimer);this.boardsTimer=window.setTimeout(()=>{void this.reloadBoards().catch(error=>this.report(error));},1000);}
  private event(event: BoardEvent | null) {
    // Our own command already returned its state; only the library counters may need a refresh.
    if(event?.kind==='changed'&&event.id===this.board?.id&&event.actorId===this.actor.id&&this.queue?.isOwn(event.commandId)){const listed=this.boards.find(board=>board.id===event.id);if(!listed||listed.title!==this.board.title||listed.elementCount!==this.board.elements.length)this.scheduleBoards();return;}
    if (event?.kind === 'created' || event?.kind === 'deleted' || event?.kind === 'changed') this.scheduleBoards();
    if (event?.kind === 'deleted' && event.id === this.board?.id) { if (this.draft) { this.status('Доска удалена · черновик остаётся доступен', true); return; } this.empty();this.boardAddress(null);this.status('Доска удалена · выберите другую доску'); return; }
    if (!event || event.id === this.board?.id && event.revision > this.board.revision) { this.queued = true; if (!this.interaction.active) void this.refresh(); }
  }
```

3. В `refresh()` удалить `await this.reloadBoards();` (список обновляет `scheduleBoards` по событию).

- [ ] **Step 4: Update e2e route patterns**

С `?state=1` glob `**/api/boards/${id}/apply` больше не совпадает с URL. Заменить только в `page.route`/`page.unroute`:

```bash
sed -i -E 's#(page\.(un)?route\(`\*\*/api/boards/\$\{id\}/apply)`#\1**`#g' e2e/*.spec.ts
grep -n "route(\`\*\*/api/boards/\${id}/apply" e2e/*.spec.ts
```

Expected: каждая найденная строка оканчивается на `/apply**\``; прямые `page.request.post(\`/api/boards/${id}/apply\``…)` не тронуты (`grep -n "apply\*\*" e2e/*.ts | grep -v route` — пусто).

В `e2e/command-queue.spec.ts` заменить тест `late_snapshot_does_not_erase_projection` целиком (раньше он держал серверный `render`, которого больше нет; теперь поздним снимком служит `edit-state`):

```ts
test('late_snapshot_does_not_erase_projection',async({page})=>{
  const id=await setup(page);const initial=await box(page);let release!:()=>void,seen!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),captured=new Promise<void>(resolve=>{seen=resolve;});let first=true;
  await page.route(new RegExp(`/api/boards/${id}/edit-state`),async route=>{if(!first){await route.continue();return;}first=false;const response=await route.fetch();seen();await held;await route.fulfill({response});});
  await apply(page,id,1,[{op:'update',id:1,patch:{text:'Agent snapshot'}}]);await captured;
  await drag(page,40,0);await expect.poll(async()=>(await board(page,id)).revision).toBe(3);await expect(page.locator('#status')).toHaveText('Все изменения сохранены');
  release();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.locator('#scene')).toContainText('Agent snapshot');await expect.poll(async()=>(await box(page)).x).toBeCloseTo(initial.x+40,0);expect((await board(page,id)).elements[0].x).toBe(140);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=chromium`
Expected: всё PASS, в том числе `own_drag_sends_exactly_one_request`, `own_sse_before_ack_does_not_double_move`, `lost_response_retries_same_payload`, `library.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/commands.ts frontend/src/editor.ts e2e
git commit -m "perf: confirm edits with one request and ignore our own change events"
```

### Task 8: Миниатюры слайдов и панели без лишних перерисовок

**Files:**
- Create: `frontend/src/slides.ts`
- Modify: `frontend/src/panels.ts` (удалить `showSlides`, убрать `orderedFrames` из импорта), `frontend/src/editor.ts` (импорт, поле `slides`, `panels`, `empty`, `syncQueue`)
- Test: `e2e/unit/slides.spec.ts`, `e2e/smoothness.spec.ts`

**Interfaces:**
- Consumes: `members`, `orderedFrames` (`canvas.ts`); `api.svg(id,frame)` (`api.ts`).
- Produces: `THUMBNAIL_DELAY=1500`; `frameSignature(board:Board,frameId:number):string` (элементы-члены фрейма и стрелки, касающиеся их; картинка учитывается длиной); `class SlideList{constructor(list:HTMLElement,count:HTMLElement,fit:(id:number)=>void);update(board:Board,selected:number[]):void;clear():void}`. Новые фреймы грузят миниатюру сразу, изменённые — через `THUMBNAIL_DELAY` после последнего изменения, по одной за раз; миниатюра — data URL, заменяется после `load`.

- [ ] **Step 1: Write the failing tests**

`e2e/unit/slides.spec.ts`:

```ts
import {test,expect} from '@playwright/test';
import {frameSignature} from '../../frontend/src/slides';
import {board,element} from './fixtures';
test('frame signature changes only with the frame content',()=>{
  const frame=element({id:1,kind:'frame',width:600,height:400}),inner=element({id:2,parentFrameId:1}),outer=element({id:3,x:900});
  const before=frameSignature(board([frame,inner,outer]),1);
  expect(frameSignature(board([frame,inner,{...outer,x:1200}]),1)).toBe(before);
  expect(frameSignature(board([frame,{...inner,x:40},outer]),1)).not.toBe(before);
  expect(frameSignature(board([frame,inner,outer,element({id:4,kind:'connector',from:2,to:3})]),1)).not.toBe(before);
});
```

Дописать в `e2e/smoothness.spec.ts`:

```ts
test('saving_keeps_untouched_pins_thumbnails_and_text',async({page})=>{
  const id=await setup(page);
  await apply(page,id,1,[{op:'create',element:{kind:'frame',x:600,y:60,width:400,height:260,text:'Слайд'}},{op:'create',element:{kind:'rectangle',x:640,y:120,width:200,height:112,text:'Внутри'}},{op:'comment_create',author:'user',text:'Пин',anchor:{type:'element',elementId:3,u:.5,v:.5}}]);
  await expect(page.locator('.comment-pin')).toHaveCount(1);await expect(page.locator('#slides img')).toHaveAttribute('src',/^data:image\/svg/);
  const nodes='[document.querySelector(".comment-pin"),document.querySelector("#slides img"),document.querySelector("#scene [data-id=\\"3\\"] text")]';
  await page.evaluate(`${nodes}.forEach(n=>{n.mark=true;})`);
  await drag(page,40,0);await expect.poll(async()=>(await board(page,id)).revision).toBe(3);await expect(page.locator('#status')).toHaveText('Все изменения сохранены');await page.waitForTimeout(1700);
  expect(await page.evaluate(`${nodes}.map(n=>!!n?.mark)`)).toEqual([true,true,true]);
});
test('a_previous_board_thumbnail_never_lands_in_the_next_board',async({page})=>{
  const id=await setup(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/render\?format=svg&frame=/,async route=>{await held;await route.continue();});
  await apply(page,id,1,[{op:'create',element:{kind:'frame',x:600,y:60,width:400,height:260,text:'Слайд'}}]);await expect(page.locator('#slides .slide-row')).toHaveCount(1);
  const other=await(await page.request.post('/api/boards',{headers:{Origin:'http://127.0.0.1:19843'},data:{title:`Other ${Date.now()}`}})).json();
  const row=page.locator('#boards button').filter({hasText:other.title});await expect(row).toBeVisible();await row.click();
  await expect(page.locator('#canvas')).toHaveAttribute('data-board',other.id);release();await page.waitForTimeout(500);
  await expect(page.locator('#slides .slide-row')).toHaveCount(0);await expect(page.locator('#slides img')).toHaveCount(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx playwright test --project=unit e2e/unit/slides.spec.ts; npx playwright test --project=chromium e2e/smoothness.spec.ts -g "saving_keeps|previous_board"`
Expected: unit FAIL (нет модуля `slides`); `saving_keeps_untouched_pins_thumbnails_and_text` FAIL (миниатюра — URL, а не data URL, и пересоздаётся `showSlides`).

- [ ] **Step 3: Implement `frontend/src/slides.ts`**

```ts
import type {Board} from './types';
import {api} from './api';
import {members,orderedFrames} from './canvas';
export const THUMBNAIL_DELAY=1500;
export function frameSignature(board:Board,frameId:number):string{
  const ids=new Set(members(board,[frameId]));
  for(const e of board.elements)if(e.kind==='connector'&&(ids.has(e.from??-1)||ids.has(e.to??-1)))ids.add(e.id);
  return JSON.stringify(board.elements.filter(e=>ids.has(e.id)).map(e=>[e.id,e.kind,e.x,e.y,e.width,e.height,e.text,e.title,e.fill,e.stroke,e.fontSize,e.fontWeight,e.from,e.to,e.fromPort,e.toPort,e.image?.length??0]));
}
interface Slide{button:HTMLButtonElement;image:HTMLImageElement;number:HTMLSpanElement;label:HTMLSpanElement;signature:string;loaded:string}
export class SlideList {
  private slides=new Map<number,Slide>();private boardId='';private timer=0;private loading=false;private again=false;
  private empty=Object.assign(document.createElement('p'),{className:'empty-slides',textContent:'Создайте первый слайд инструментом F. Он станет рамкой для вашей истории.'});
  constructor(private list:HTMLElement,private count:HTMLElement,private fit:(id:number)=>void){}
  clear():void{window.clearTimeout(this.timer);this.slides.clear();this.boardId='';this.list.replaceChildren();this.count.textContent='0';}
  update(board:Board,selected:number[]):void{
    if(board.id!==this.boardId){this.clear();this.boardId=board.id;}
    const frames=orderedFrames(board),live=new Set(frames.map(f=>f.id));this.count.textContent=String(frames.length);
    for(const [id,slide]of this.slides)if(!live.has(id)){slide.button.remove();this.slides.delete(id);}
    let fresh=false,stale=false;
    frames.forEach((frame,index)=>{
      let slide=this.slides.get(frame.id);
      if(!slide){const button=document.createElement('button'),image=document.createElement('img'),number=document.createElement('span'),label=document.createElement('span');image.alt='';number.className='slide-number';button.append(image,number,label);button.onclick=()=>this.fit(frame.id);slide={button,image,number,label,signature:'',loaded:''};this.slides.set(frame.id,slide);fresh=true;}
      slide.button.className=`slide-row${selected.includes(frame.id)?' active':''}`;slide.number.textContent=String(index+1).padStart(2,'0');slide.label.textContent=frame.text||`Слайд ${index+1}`;
      slide.signature=frameSignature(board,frame.id);if(slide.signature!==slide.loaded)stale=true;
      if(this.list.children[index]!==slide.button)this.list.insertBefore(slide.button,this.list.children[index]??null);
    });
    if(frames.length)this.empty.remove();else this.list.append(this.empty);
    if(stale){window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>{void this.load();},fresh?0:THUMBNAIL_DELAY);}
  }
  // One render at a time keeps the server render semaphore free for exports.
  private async load(){
    if(this.loading){this.again=true;return;}
    this.loading=true;const boardId=this.boardId;
    try{
      for(const [id,slide]of this.slides){
        if(slide.signature===slide.loaded)continue;const signature=slide.signature;
        try{
          const source=await api.svg(boardId,id);if(this.boardId!==boardId||this.slides.get(id)!==slide)return;
          const url=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,probe=new Image();
          probe.onload=()=>{if(this.slides.get(id)===slide)slide.image.src=url;};probe.src=url;slide.loaded=signature;delete slide.button.dataset.thumbnail;
        }catch{slide.button.dataset.thumbnail='error';}
      }
    }finally{this.loading=false;if(this.again){this.again=false;void this.load();}}
  }
}
```

Неудачная миниатюра помечается `data-thumbnail="error"` и перезагружается при следующем изменении фрейма; тост не показывается — это не действие пользователя.

- [ ] **Step 4: Wire the editor and panels**

`frontend/src/panels.ts`: удалить функцию `showSlides` целиком; импорт `import { orderedFrames,members } from './canvas';` → `import { members } from './canvas';`.

`frontend/src/editor.ts`:

1. Импорт `import { showBoards, showSlides, showProperties } from './panels';` → `import { showBoards, showProperties } from './panels';` и добавить `import { SlideList } from './slides';`.
2. Поле класса рядом с `textEditor`: `slides = new SlideList(el('slides'), el('slide-count'), id => { this.select([id]); this.view.fit(id); });` и `private panelKey='';`.
3. В `panels()`: `showSlides(this.board, this.view.selected, id => { this.select([id]); this.view.fit(id); });` → `this.slides.update(this.board, this.view.selected);`.
4. В `empty()`: `el('slides').replaceChildren();el('slide-count').textContent='0';` → `this.slides.clear();`.
5. В `syncQueue()`: `this.board=queue.projected();this.view.project(this.board);this.panels();` → `this.board=queue.projected();this.view.project(this.board);const panelKey=`${queue.confirmed.board.id}|${queue.confirmed.board.revision}|${this.view.selected.join(',')}`;if(panelKey!==this.panelKey){this.panelKey=panelKey;this.panels();}`
- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && npm run build && npx playwright test --project=unit && npx playwright test --project=chromium`
Expected: всё PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/slides.ts frontend/src/panels.ts frontend/src/editor.ts e2e
git commit -m "perf: debounce slide thumbnails and repaint panels only on new revisions"
```

### Task 9: Бюджеты производительности и замер сохранения

**Files:**
- Create: `e2e/perf.spec.ts`, `scripts/apply-bench.mjs`
- Modify: этот план (раздел «Результаты замеров» внизу)

**Interfaces:**
- Consumes: `globalThis.wireboardFrameStats` (Task 4).

- [ ] **Step 1: Write the perf spec**

`e2e/perf.spec.ts`:

```ts
import {test,expect,type Page} from '@playwright/test';
import {setup,apply,box,bounding} from './ux-helpers';
const FRAME_BUDGET_MS=16;
const p90=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.9))];};
type Stats={wireboardFrameStats:number[]};
async function bigBoard(page:Page){
  const id=await setup(page),operations:unknown[]=[];
  for(let i=0;i<239;i++)operations.push({op:'create',element:{kind:'rectangle',x:(i%20)*240,y:300+Math.floor(i/20)*180,width:200,height:112,title:`Блок ${i}`,text:'Описание блока для проверки переноса'}});
  for(let i=0;i<60;i++)operations.push({op:'create',element:{kind:'connector',from:2+i,to:3+i,text:i%3?'':'связь'}});
  await apply(page,id,1,operations);await expect(page.locator('#scene > [data-kind="connector"]')).toHaveCount(60);await expect(page.locator('#status')).toContainText('сохранены');
}
async function frames(page:Page,action:()=>Promise<void>){
  await page.evaluate(()=>{(globalThis as unknown as Stats).wireboardFrameStats.length=0;});await action();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  return page.evaluate(()=>[...(globalThis as unknown as Stats).wireboardFrameStats]);
}
test.describe('smoothness budget on 300 elements',()=>{
  test.skip(({browserName})=>browserName!=='chromium','Budgets are calibrated for Chromium');
  test('drag_resize_pan_zoom_stay_within_the_frame_budget',async({page})=>{
    await bigBoard(page);const b=await box(page);
    const drag=await frames(page,async()=>{await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();for(let i=1;i<=30;i++)await page.mouse.move(b.x+35+i*4,b.y+35+i*2);await page.mouse.up();});
    await page.locator('#scene [data-id="1"]').click();const h=await bounding(page.locator('[data-handle="se"]'));
    const resize=await frames(page,async()=>{await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();for(let i=1;i<=30;i++)await page.mouse.move(h.x+h.width/2+i*3,h.y+h.height/2+i*2);await page.mouse.up();});
    const canvas=(await page.locator('#canvas').boundingBox())!;await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
    const pan=await frames(page,async()=>{for(let i=0;i<30;i++)await page.mouse.wheel(0,40);});
    const zoom=await frames(page,async()=>{await page.keyboard.down('Control');for(let i=0;i<10;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(40);}await page.keyboard.up('Control');await page.waitForTimeout(300);});
    for(const [name,values]of Object.entries({drag,resize,pan,zoom})){expect(values.length,name).toBeGreaterThan(5);expect(p90(values),name).toBeLessThanOrEqual(FRAME_BUDGET_MS);}
  });
  test('drop_handler_and_next_frame_fit_one_frame',async({page})=>{
    await bigBoard(page);const b=await box(page);
    await page.evaluate(()=>{const w=window as unknown as {upStart:number;upEnd:number};addEventListener('pointerup',()=>{w.upStart=performance.now();},{capture:true});addEventListener('pointerup',()=>{w.upEnd=performance.now();});});
    await page.mouse.move(b.x+35,b.y+35);await page.mouse.down();await page.mouse.move(b.x+135,b.y+75,{steps:10});
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await page.evaluate(()=>{(globalThis as unknown as Stats).wireboardFrameStats.length=0;});
    await page.mouse.up();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const result=await page.evaluate(()=>{const w=globalThis as unknown as Stats&{upStart:number;upEnd:number};return {handler:w.upEnd-w.upStart,frame:w.wireboardFrameStats[0]??0};});
    expect(result.handler+result.frame).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run build && npx playwright test --project=chromium e2e/perf.spec.ts`
Expected: PASS. Если бюджет превышен — профилировать (Chrome DevTools Performance через `--headed`, или временно логировать длительности слоёв) и исправлять горячий слой, а не поднимать `FRAME_BUDGET_MS`. Записать фактические p90 в раздел «Результаты замеров».

- [ ] **Step 3: Write `scripts/apply-bench.mjs`**

```js
// Measures POST /apply latency on a large board with long history.
// Usage: node scripts/apply-bench.mjs http://127.0.0.1:19871
import {deflateSync,crc32} from 'node:zlib';
import {randomBytes,randomUUID} from 'node:crypto';
const base=process.argv[2]??'http://127.0.0.1:19871';
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base},body:body&&JSON.stringify(body)});if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.json();}
function png(width,height){
  const stride=width*4+1,raw=Buffer.alloc(stride*height);for(let y=0;y<height;y++)randomBytes(width*4).copy(raw,y*stride+1);
  const chunk=(type,data)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([length,body,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const board=await call('/api/boards','POST',{title:`Apply bench ${Date.now()}`});let revision=board.revision;
const operations=[];for(let i=0;i<299;i++)operations.push({op:'create',element:{kind:'rectangle',x:(i%20)*240,y:Math.floor(i/20)*180,width:200,height:112,text:`Блок ${i}`}});
operations.push({op:'create',element:{kind:'image',x:0,y:-600,width:400,height:300,image:`data:image/png;base64,${png(512,512).toString('base64')}`}});
revision=(await call(`/api/boards/${board.id}/apply`,'POST',{revision,operations})).revision;
const actor={id:'bench',source:'user'};
async function move(i){const started=performance.now();const next=await call(`/api/boards/${board.id}/apply?state=1`,'POST',{revision,operations:[{op:'move',ids:[1+(i%299)],dx:1,dy:0}],command:{id:randomUUID(),actor,label:'Bench'}});revision=next.board.revision;return performance.now()-started;}
for(let i=0;i<500;i++)await move(i);
const times=[];for(let i=0;i<50;i++)times.push(await move(i));times.sort((a,b)=>a-b);
console.log(JSON.stringify({p50:+times[25].toFixed(1),p90:+times[45].toFixed(1),max:+times[49].toFixed(1)}));
```

- [ ] **Step 4: Run the bench on a release build**

```bash
cargo build --release --locked
target/release/wireboard serve --port 19871 --data-dir work/apply-bench &
sleep 2 && node scripts/apply-bench.mjs http://127.0.0.1:19871; kill %1
```

На Windows бинарник — `target/release/wireboard.exe`. Если сервер отклонит `Origin` или потребует токен, взять заголовки из `e2e/ux-helpers.ts` (`apply()`), они работают для локального сервера.

Expected: JSON с `p50`, `p90`, `max`. Записать в «Результаты замеров». Если `p90 > 50` мс — дописать в раздел «Риски» спека пункт «Инкрементальная запись журнала — следующий подпроект» с цифрами, кода не трогать.

- [ ] **Step 5: Commit**

```bash
git add e2e/perf.spec.ts scripts/apply-bench.mjs docs/superpowers
git commit -m "test: add frame budget checks and an apply latency bench"
```

### Task 10: Итоговая проверка и ревью

**Files:**
- Modify: при необходимости — найденные ревью дефекты; этот план (результаты).

- [ ] **Step 1: Full checks on the final version**

```bash
npm run typecheck
npm run build
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
npx playwright test
```

Expected: всё зелёное во всех проектах (`unit`, `chromium`, `firefox`, `webkit`); `perf.spec.ts` в firefox/webkit — skipped. Красный прогон показывать как есть и чинить код, а не тесты.

- [ ] **Step 2: Manual check in the browser**

Пересобрать фронтенд, перезапустить тестовый сервер `wireboard-audit` (порт 19870, данные в `work/ux-overhaul-audit`) и пройти на доске из 120+ объектов: перенос, resize, pan, Ctrl+колесо, кнопки зума, hover, правка текста, Undo/Redo. Параллельно изменить блок через CLI (`target/debug/wireboard … apply` с `--data-dir work/ux-overhaul-audit` или `curl` на `/apply`) и убедиться, что правка агента появляется без мигания миниатюр и пинов. Повторить замер аудита: запросы на одну правку (ожидается один `apply?state=1`) и время pointerup.

- [ ] **Step 3: Code review**

Запустить агентов `code-reviewer`, `typescript-reviewer` и `rust-reviewer` на `git diff main...HEAD`. Исправить CRITICAL и HIGH, повторить Step 1 после исправлений.

- [ ] **Step 4: Record results and commit**

Заполнить «Результаты замеров» ниже фактическими цифрами (до/после), затем:

```bash
git add docs/superpowers
git commit -m "docs: record editor smoothness measurements"
```

## Результаты замеров

| Метрика | Аудит 19.10 (80 блоков, 40 стрелок) | После этапа 1 |
|---|---|---|
| Запросов на одну правку | 8 (apply, 3× edit-state, 2× render, 2× список) | 1 (`POST …/apply?state=1`, без `render`; проверено тестом `own_drag_sends_exactly_one_request`) |
| pointerup → кадр | ≈46 мс | ≈62–67 мс на 300 элементах (обработчик ≈61–65 мс + кадр ≈1–2 мс; Chromium, 3 прогона), бюджет 16 мс не выполнен |
| p90 кадра: перенос / resize / pan / зум (300 элементов) | не измерялось | перенос 2.0–2.2 / resize 1.7–1.8 / pan 0.4–0.6 / зум 0.6–0.7 мс (p90 длительности кадра, 3 прогона) |
| `apply` p50 / p90 / max, release, 300 элементов + 500 команд + картинка 1 МиБ | не измерялось | p50 ≈ 93–95 / p90 ≈ 110–120 / max ≈ 140–200 мс (2 прогона; бюджет p90 ≤ 50 мс не выполнен) |
