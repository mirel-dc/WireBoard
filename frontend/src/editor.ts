import {CommandQueue,makeGuards} from './commands';
import {CLIPBOARD_TYPE,copySelection,parseClipboard,pasteSelection} from './clipboard';
import {command as shortcut,isTextTarget} from './keyboard';
import { Comments } from './comments';
import { InlineTextEditor } from './text-editor';
import { installIcons } from './icons';
import { api, ApiError } from './api';
import { CanvasView, orderedFrames } from './canvas';
import { Interaction, type Tool } from './interaction';
import { showBoards, showSlides, showProperties } from './panels';
import { Presentation } from './presentation';
import type { Board, BoardEvent, BoardSummary, CommentOperation, Operation,Actor,EditState } from './types';
function browserActor():Actor {let id:string=crypto.randomUUID();try{const saved=localStorage.getItem('wireboard:actorId');if(saved&&saved.length<=128)id=saved;else localStorage.setItem('wireboard:actorId',id);}catch{}return {id,source:'user'};}
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export class Editor {
  board: Board | null = null; boards: BoardSummary[] = []; view = new CanvasView(); busy = false; online = false; private loading = 0; private opening = false; private queued = false; private toastTimer = 0;
  private actor=browserActor();private queue:CommandQueue|null=null;private refreshing=false;private queueError:unknown=null;
  private selectionEpoch=0;private pasteCount=0;private pasteIdentity='';
  private draft: { id: number; revision: number; board: string; base:EditState } | null = null;
  textEditor = new InlineTextEditor();
  comments = new Comments(this.view, {current:()=>this.board,commit:(board,ops,revision)=>this.commitComments(board,ops,revision),report:error=>this.report(error),confirm:async()=>{if(this.queue?.mode==='uncertain')await this.queue.retry();else if(this.queue?.mode==='conflict')this.queue.discard();},anchorMode:()=>this.interaction.setTool('comment')});
  interaction = new Interaction(this.view, { current: () => this.board, editState:()=>this.queue!.projectedState(), busy: () => this.opening || !!this.draft, apply: (ops, revision, base) => this.apply(ops, revision, base), create:(element,base)=>this.createObjects([{op:'create',element}],[base.board.nextId],base,'Создание объекта'),select: ids => this.select(ids), edit: id => this.editText(id), comment: (anchor, point) => this.comments.place(anchor, point), tool: tool => this.tool(tool), changed: () => { if (this.queued) void this.refresh(); }, report: error => this.report(error) });
  presentation = new Presentation(error => this.report(error));
  constructor() {
    this.view.onCamera = () => { el('zoom-value').textContent = `${Math.round(this.view.camera.zoom * 100)}%`; this.scheduleSaveView(); };
    this.view.onPins=()=>this.comments.renderPins();
    this.view.onChrome=()=>{if(this.draft){const e=this.board?.elements.find(e=>e.id===this.draft?.id);if(e)this.textEditor.position(e,this.view);}};
    addEventListener('pagehide',()=>this.saveView());
    installIcons(); this.bind(); try{document.querySelector('.workspace')!.classList.toggle('sidebar-hidden',innerWidth<900||localStorage.getItem('wireboard:library-sidebar')==='closed');}catch{}
  }
  status(message: string, error = false) { el('status').textContent = message; el('status').dataset.state = error ? 'error' : 'ok'; }
  report(error: unknown) { const message = error instanceof Error ? error.message : 'Не удалось выполнить действие'; el('toast').textContent = message; el('toast').hidden = false; window.clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => { el('toast').hidden = true; }, 6500); this.status(message, true); }
  async start() {
    try {
      // Ignore obsolete login fragments from bookmarks created by older releases.
      if(new URLSearchParams(location.hash.slice(1)).has('auth'))history.replaceState(null,'',location.pathname+location.search);
      const library=await api.library();el('library-location').textContent=library.path;el('library-location').title=library.path;
      this.view.metrics=await api.metrics();await document.fonts.ready;
      api.subscribe(event=>this.event(event),online=>{this.online=online;if(!online)this.status('Сервер недоступен · сохранение невозможно',true);else if(this.board){this.queued=true;void this.refresh();}});
      await this.reloadBoards();await this.openLocation();
      window.addEventListener('popstate',()=>{void this.openLocation().catch(error=>this.report(error));});
    }catch(error){this.report(error);}
  }
  private async openLocation() {
    if(!this.canNavigate()){this.boardAddress(this.board?.id??null);return;}
    const slug=/^\/b\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(location.pathname)?.[1];
    const legacy=new URLSearchParams(location.search).get('board');
    const requested=slug??legacy;
    const board=this.boards.find(board=>slug?board.slug===slug:board.id===legacy);
    if(board){await this.open(board.id,false);return;}
    this.empty();this.status(requested?'Доска по этой ссылке отсутствует в этой библиотеке':'Библиотека открыта · выберите доску',!!requested);
  }
  private canNavigate(){if(this.busy||this.opening||this.interaction.active||this.comments.isSending||this.draft||this.queue?.hasPending){this.report(new Error('Завершите текущее действие или закройте черновик.'));return false;}return true;}
  private boardAddress(id:string|null,push=false){const url=new URL(location.href);const slug=this.boards.find(board=>board.id===id)?.slug;url.pathname=slug?`/b/${slug}`:'/';if(id&&!slug)url.searchParams.set('board',id);else url.searchParams.delete('board');url.hash='';if(push&&url.href!==location.href)history.pushState(null,'',url);else history.replaceState(null,'',url);}
  private saveView() { if (!this.board) return; try { localStorage.setItem(`wireboard:view:${this.board.id}`, JSON.stringify({ camera: this.view.camera, selected: this.view.selected })); } catch { /* View preferences are optional. */ } }
  private saveTimer=0;
  private scheduleSaveView(){window.clearTimeout(this.saveTimer);this.saveTimer=window.setTimeout(()=>this.saveView(),300);}
  private savedView(id: string): { camera: { x: number; y: number; zoom: number }; selected: number[] } | null {
    try { const value = JSON.parse(localStorage.getItem(`wireboard:view:${id}`) ?? 'null'); if (!value || !value.camera || ![value.camera.x, value.camera.y, value.camera.zoom].every(Number.isFinite) || Math.abs(value.camera.x) > 1e7 || Math.abs(value.camera.y) > 1e7 || value.camera.zoom < .1 || value.camera.zoom > 4 || !Array.isArray(value.selected)) return null; return { camera: value.camera, selected: value.selected.filter((id: unknown) => Number.isSafeInteger(id)) }; } catch { return null; }
  }
  private renderBoards(){const search=el<HTMLInputElement>('board-search').value.trim().toLocaleLowerCase();const boards=this.boards.filter(board=>board.title.toLocaleLowerCase().includes(search));el('board-count').textContent=String(this.boards.length);showBoards(boards,this.board?.id,id=>{void this.open(id);});}
  private async reloadBoards() { this.boards = await api.list(); this.renderBoards(); }
  private empty() { window.clearTimeout(this.saveTimer);this.saveView();this.board = null;this.queue=null; this.view.clear(); el('board-title').textContent = 'Выберите доску'; el('property-content').textContent = 'Откройте доску из библиотеки.'; el('slides').replaceChildren();el('slide-count').textContent='0'; el('canvas-hint').textContent='Выберите доску слева или создайте новую';el('canvas-hint').hidden = false; this.comments.update(); el('context-toolbar').hidden=true;this.renderBoards();document.title='Wireboard — локальная библиотека'; }
  async open(id: string, push = true) {
    window.clearTimeout(this.saveTimer);this.saveView();
    if (!this.canNavigate()) { this.boardAddress(this.board?.id??null); return; }
    const generation = ++this.loading; this.opening=true; this.comments.cancelAnchor();this.interaction.setTool('select'); this.status('Открываем доску…');
    try { if(!this.boards.some(board=>board.id===id))await this.reloadBoards();const state = await api.editState(id,this.actor.id);const board=state.board; if (generation !== this.loading) return; const saved = this.savedView(id); this.board = board; this.view.selected = saved?.selected ?? []; this.view.setBoard(board);this.queue=new CommandQueue(this.actor,state,{apply:api.applyState,history:api.historyState,editState:api.editState},()=>this.syncQueue());this.syncQueue(); if (saved) { this.view.camera = saved.camera; this.view.updateCamera(); } else this.view.fit(); if(innerWidth<900)document.querySelector('.workspace')!.classList.add('sidebar-hidden'); this.boardAddress(id,push);this.panels(); this.saveView(); await this.reloadBoards();document.title=`${board.title} — Wireboard`; this.status('Все изменения сохранены'); } catch (error) { this.boardAddress(this.board?.id??null);this.report(error); } finally {this.opening=false;if(this.queued)await this.refresh();}
  }
  private panels(force = false) { if (!this.board) return; el('board-title').textContent = this.board.title; showSlides(this.board, this.view.selected, id => { this.select([id]); this.view.fit(id); }); const base=this.queue?.projectedState();showProperties(this.board, this.view.selected, (ops, revision) => this.apply(ops, revision, base), id => this.editText(id), force,()=>{const focused=this.queue!.projectedState();return(ops,revision)=>this.apply(ops,revision,focused);}); this.context(); this.comments.update(); }
  select(ids: number[]) { this.interaction.finishNudge();this.selectionEpoch++;this.view.setSelection(ids); this.panels(); this.scheduleSaveView(); }
  private createObjects(operations:Operation[],ids:number[],base:EditState,label:string){
    const queue=this.queue;if(!queue||this.opening)return;
    const epoch=++this.selectionEpoch,boardId=this.board?.id;
    void queue.enqueue({label,operations,guards:makeGuards(base,operations)},()=>{
      if(this.queue===queue&&this.board?.id===boardId&&this.selectionEpoch===epoch)this.select(ids);
    }).catch(()=>{});
  }
  private clipboardAllowed(){return !!this.board&&!!this.queue&&!this.opening&&!this.draft&&!this.presentation.active&&!isTextTarget(document.activeElement)&&!document.querySelector('dialog[open]')&&!this.interaction.gesture;}
  private copy(event:ClipboardEvent){
    this.interaction.finishNudge();
    if(!this.clipboardAllowed()||!event.clipboardData)return;
    try{const snapshot=copySelection(this.board!,this.view.selected);if(!snapshot)return;const text=JSON.stringify(snapshot);if(text.length>32*1024*1024)throw new Error('Копия превышает 32 MiB.');event.clipboardData.setData(CLIPBOARD_TYPE,text);event.clipboardData.setData('text/plain',text);event.preventDefault();this.pasteIdentity='';this.pasteCount=0;this.status('Выделение скопировано');}catch(error){event.preventDefault();this.report(error);}
  }
  private paste(event:ClipboardEvent){
    this.interaction.finishNudge();
    if(!this.clipboardAllowed()||!event.clipboardData)return;
    const data=event.clipboardData,typed=data.types.includes(CLIPBOARD_TYPE),raw=data.getData(typed?CLIPBOARD_TYPE:'text/plain');
    try{
      const snapshot=parseClipboard(raw);
      if(typed&&!snapshot)throw new Error('Некорректная копия Wireboard. Скопируйте объекты заново.');
      const rect=this.view.svg.getBoundingClientRect(),center=this.view.worldPoint(rect.x+rect.width/2,rect.y+rect.height/2),base=this.queue!.projectedState();
      if(snapshot){
        event.preventDefault();const identity=`${this.board!.id}:${raw}`;if(identity!==this.pasteIdentity){this.pasteIdentity=identity;this.pasteCount=0;}this.pasteCount++;
        const nodes=snapshot.elements.filter(e=>e.kind!=='connector'),left=Math.min(...nodes.map(e=>e.x)),top=Math.min(...nodes.map(e=>e.y)),right=Math.max(...nodes.map(e=>e.x+e.width)),bottom=Math.max(...nodes.map(e=>e.y+e.height));
        const same=snapshot.sourceBoardId===this.board!.id,offset={x:(same?24:center.x-(left+right)/2)+24*(this.pasteCount-1),y:(same?24:center.y-(top+bottom)/2)+24*(this.pasteCount-1)};
        const pasted=pasteSelection(snapshot,base.board,offset);this.createObjects(pasted.operations,pasted.ids,base,'Вставка объектов');return;
      }
      const file=[...data.items].find(item=>item.kind==='file')?.getAsFile();if(file){event.preventDefault();void this.image(file);return;}
      if(raw){event.preventDefault();const text=raw.replace(/\r\n?/g,'\n');if([...text].length>10000)throw new Error('Текст больше 10000 символов.');this.createObjects([{op:'create',element:{id:base.board.nextId,kind:'text',x:center.x-160,y:center.y-50,width:320,height:100,text}}],[base.board.nextId],base,'Вставка текста');}
    }catch(error){event.preventDefault();this.report(error);}
  }
  private tool(tool: Tool) { document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === tool))); el('tool-hint').textContent = tool === 'comment' ? 'Выберите объект, связь или точку для комментария' : tool === 'connector' ? 'Выберите первый блок, затем второй' : tool === 'hand' ? 'Прокрутка — холст · Ctrl/Cmd + колесо или pinch — масштаб' : ['rectangle','text','frame'].includes(tool)?'Протяните для размера · щелчок — обычный размер · Shift — квадрат':'Стрелки — 1 · Shift — 10 · Ctrl+C / Ctrl+V · Ctrl/Cmd + колесо — масштаб'; }
  private actionLabel(operations:Operation[]) {
    const first=operations[0];if(!first)return 'Изменение';
    return ({move:'Перенос блока',resize:'Изменение размера',create:'Создание объекта',delete:'Удаление объекта',duplicate:'Дублирование',rename:'Название доски',update:'Изменение свойств',comment_create:'Новый комментарий',comment_reply:'Ответ в обсуждении',comment_status:'Статус обсуждения',comment_reanchor:'Привязка комментария'} as Record<string,string>)[first.op];
  }
  async apply(operations:Operation[], _revision = this.board?.revision, base?:EditState) {
    if(!this.queue||this.opening)return false;
    try {const state=base??this.queue.projectedState();await this.queue.enqueue({label:this.actionLabel(operations),operations,guards:makeGuards(state,operations)});return true;}
    catch{return false;}
  }
  private syncQueue() {
    const queue=this.queue;if(!queue)return;
    this.board=queue.projected();this.view.project(this.board);this.panels();
    const history=queue.summary;
    for(const [id,action,verb]of [['undo',history.undo,'Отменить'],['redo',history.redo,'Повторить']]as const){const button=el<HTMLButtonElement>(id);button.disabled=!action;button.title=action?`${verb}: ${action.label}`:`${verb}: история пуста`;button.setAttribute('aria-description',button.title);}
    const problem=queue.mode==='uncertain'||queue.mode==='conflict';el('operation-return').hidden=!problem;
    if(problem){
      const uncertain=queue.mode==='uncertain';el('operation-message').textContent=uncertain?'Ответ на сохранение не подтверждён. Проверим, было ли действие сохранено; повтор не выполнит его дважды.':queue.error instanceof Error?queue.error.message:'Свойства объекта изменились. Просмотрите изменения или отмените несохранённое действие.';
      el('operation-retry').textContent=uncertain?'Повторить сохранение':'Посмотреть изменения';el<HTMLButtonElement>('operation-discard').disabled=uncertain;
      if(this.queueError!==queue.error){this.queueError=queue.error;if(queue.error)this.report(queue.error);if(!this.comments.isSending&&(!this.draft||uncertain))el<HTMLDialogElement>('operation-dialog').showModal();}
    }else{this.queueError=null;const dialog=el<HTMLDialogElement>('operation-dialog');if(dialog.open)dialog.close();this.status(queue.hasPending?'Сохраняем…':'Все изменения сохранены');}
  }
  private boardsTimer=0;
  private scheduleBoards(){window.clearTimeout(this.boardsTimer);this.boardsTimer=window.setTimeout(()=>{void this.reloadBoards().catch(error=>this.report(error));},1000);}
  private event(event: BoardEvent | null) {
    // Our own command already returned its state; only the library counters may need a refresh.
    if(event?.kind==='changed'&&event.id===this.board?.id&&event.actorId===this.actor.id&&this.queue?.isOwn(event.commandId)){const listed=this.boards.find(board=>board.id===event.id);if(!listed||listed.title!==this.board.title||listed.elementCount!==this.board.elements.length)this.scheduleBoards();return;}
    if (!event || event.kind === 'created' || event.kind === 'deleted' || event.kind === 'changed') this.scheduleBoards();
    if (event?.kind === 'deleted' && event.id === this.board?.id) { if (this.draft) { this.status('Доска удалена · черновик остаётся доступен', true); return; } this.empty();this.boardAddress(null);this.status('Доска удалена · выберите другую доску'); return; }
    if (!event || event.id === this.board?.id && event.revision > this.board.revision) { this.queued = true; if (!this.interaction.active) void this.refresh(); }
  }
  private async refresh() {
    if(!this.board||this.opening||this.interaction.active)return;
    if(this.refreshing){this.queued=true;return;}
    this.refreshing=true;this.queued=false;const id=this.board.id;
    try {
      const commandId=this.queue?.inFlightId;
      const state=await api.editState(id,this.actor.id,commandId);
      if(commandId!==this.queue?.inFlightId){this.queued=true;return;}
      if(this.board?.id!==id||this.opening||this.interaction.active){this.queued=true;return;}
      if(state.board.revision<(this.queue?.confirmed.board.revision??0)){this.queued=true;return;}
      this.view.setBoard(state.board);this.queue?.accept(state);
      if(this.draft){this.status('Доска изменилась · ваш черновик сохранён');el('draft-message').textContent='Другой клиент изменил доску. Ваш текст остался в черновике.';}
    }catch(error){this.report(error);}finally{this.refreshing=false;if(this.queued&&!this.interaction.active&&!this.opening)window.setTimeout(()=>{void this.refresh();},25);}
  }
  private editText(id: number) { if (!this.board || !this.queue || this.opening) return; if(this.draft){if(this.draft.id!==id)this.report(new Error('Сначала сохраните или отмените текущий текст.'));el<HTMLTextAreaElement>('text-draft').focus();return;} const e = this.board.elements.find(e => e.id === id); if (!e) return; this.draft = { id, revision: this.board.revision, board: this.board.id,base:this.queue.projectedState() }; el<HTMLTextAreaElement>('text-draft').value = e.text; el('draft-message').textContent = ''; el('draft-retry').hidden = true; el('draft-save').hidden = false; this.textEditor.show(e,this.view); }
  private async saveText(retry:boolean) {
    if(!this.draft||!this.queue||this.busy)return;const draft=this.draft;this.busy=true;
    const operations:Operation[]=[{op:'update',id:draft.id,patch:{text:el<HTMLTextAreaElement>('text-draft').value,title:el<HTMLInputElement>('title-draft').value}}];
    try {
      if(retry){if(this.queue.mode==='uncertain'){await this.queue.retry();return;}this.queue.discard();this.queue.accept(await api.editState(draft.board,this.actor.id));}
      const base=retry?this.queue.projectedState():draft.base;
      await this.queue.enqueue({label:'Изменение текста',operations,guards:makeGuards(base,operations)},commandId=>{
        if(this.draft!==draft)return;
        const submitted=operations[0];if(submitted.op!=='update')return;
        if(el<HTMLTextAreaElement>('text-draft').value===submitted.patch.text&&el<HTMLInputElement>('title-draft').value===submitted.patch.title){this.draft=null;this.textEditor.close();}
        else{
          const e=draft.base.board.elements.find(e=>e.id===draft.id)!;
          for(const field of ['text','title']as const)if(e[field]!==submitted.patch[field]){e[field]=submitted.patch[field]!;const key={entity:{type:'element' as const,id:e.id},field};const entry=draft.base.stamps.find(s=>s.key.entity.type==='element'&&s.key.entity.id===e.id&&s.key.field===field);if(entry)entry.stamp=commandId;else draft.base.stamps.push({key,stamp:commandId});}
          el('draft-message').textContent='Отправленная версия сохранена. Новые изменения остаются в черновике.';el('draft-retry').hidden=true;el('draft-save').hidden=false;
        }
      });
    }catch(error){this.report(error);if(this.draft!==draft)return;el('draft-message').textContent='Текст изменился в другом клиенте. Ваш черновик сохранён; повтор подтвердит замену текста свежей версии.';el('draft-retry').hidden=false;el('draft-save').hidden=true;}
    finally{this.busy=false;if(this.queued)void this.refresh();}
  }
  private async commitComments(boardId:string,operations:CommentOperation[],_revision:number):Promise<Board> {
    if(!this.queue||this.board?.id!==boardId||this.opening)throw new Error('Доска сменилась. Вернитесь к исходному обсуждению.');
    if(_revision>this.queue.confirmed.board.revision)this.queue.accept(await api.editState(boardId,this.actor.id));
    const state=this.queue.projectedState();if(_revision!==state.board.revision)throw new ApiError('conflict','Доска изменилась. Черновик комментария сохранён; подтвердите отправку на свежей версии.');
    return this.queue.enqueue({label:this.actionLabel(operations),operations,guards:makeGuards(state,operations)});
  }
  private context(){
    const selected=this.board?.elements.filter(e=>this.view.selected.includes(e.id))??[];el('context-toolbar').hidden=!selected.length;
    const e=selected.length===1?selected[0]:null;
    el('context-edit').hidden=!e;el('context-fit').hidden=!e||!['rectangle','text'].includes(e.kind);
    el('context-comment').hidden=!e; const swatches=el('context-swatches');swatches.replaceChildren();
    if(e?.kind==='rectangle')for(const [name,fill,stroke]of [['Нейтральный','#ffffff','#ddd7e5'],['Тёплый','#fff0b8','#ccad49'],['Голубой','#e0ecf8','#90abc7'],['Мятный','#e0f0e8','#91b4a2'],['Лиловый','#eee5f8','#ae91c5']]){const b=document.createElement('button');b.className='swatch';b.style.setProperty('--swatch',fill);b.setAttribute('aria-label',name);b.setAttribute('aria-pressed',String(e.fill===fill));b.onclick=()=>{void this.apply([{op:'update',id:e.id,patch:{fill,stroke}}]);};swatches.append(b);}
    const overflow=e?this.view.scene.querySelector(`[data-id="${e.id}"] [data-text-overflow="true"]`):null;
    el('context-fit').classList.toggle('needs-fit',!!overflow);
  }
  private history(direction:'undo'|'redo') {this.interaction.finishNudge();if(this.interaction.gesture?.type==='connector-end')this.interaction.cancel();if(this.queue&&!this.draft&&!this.opening)this.queue.history(direction);}
  private async image(file: File) { if (!this.board) return; if (file.size > 8 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { this.report(new Error('Выберите PNG/JPEG/WebP до 8 MiB.')); return; } try { const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); const bitmap = await createImageBitmap(file); const width = Math.min(400, Math.max(20, bitmap.width)), height = Math.min(10000, Math.max(20, width * bitmap.height / bitmap.width)); bitmap.close(); const rect = this.view.svg.getBoundingClientRect(); const point = this.view.worldPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); await this.apply([{ op: 'create', element: { kind: 'image', x: point.x - width / 2, y: point.y - height / 2, width, height, image: data } }]); } catch (error) { this.report(error); } }
  private async download(format: 'json' | 'svg' | 'png') { if (!this.board) return; try { const frame = el<HTMLInputElement>('export-frame').checked ? this.board.elements.find(e => this.view.selected.includes(e.id) && e.kind === 'frame')?.id : undefined; if (el<HTMLInputElement>('export-frame').checked && frame === undefined) throw new Error('Сначала выберите слайд.'); const blob = format === 'json' ? new Blob([JSON.stringify(await api.getBoard(this.board.id), null, 2)], { type: 'application/json' }) : await api.download(this.board.id, format, frame); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `wireboard-${this.board.id}.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { this.report(error); } }
  private bind() {
    document.addEventListener('pointerdown',()=>this.interaction.finishNudge(),true);
    document.addEventListener('focusin',event=>{if(isTextTarget(event.target))this.interaction.finishNudge();if(event.target!==this.view.svg&&this.interaction.gesture?.type==='connector-end')this.interaction.cancel();});
    el('context-edit').onclick=()=>{if(this.view.selected.length===1)this.editText(this.view.selected[0]);};
    el('context-comment').onclick=()=>{const e=this.board?.elements.find(e=>e.id===this.view.selected[0]);if(e)this.comments.place(e.kind==='connector'?{type:'connector',elementId:e.id,t:.5}:{type:'element',elementId:e.id,u:1,v:0});};
    el('context-fit').onclick=()=>{const e=this.board?.elements.find(e=>e.id===this.view.selected[0]);const height=Number(this.view.scene.querySelector(`[data-id="${e?.id}"] [data-fit-height]`)?.getAttribute('data-fit-height'));if(e&&Number.isFinite(height))void this.apply([{op:'resize',id:e.id,width:e.width,height}]);};
    el('properties-open').onclick=()=>{el('properties').hidden=!el('properties').hidden;el('properties-open').setAttribute('aria-expanded',String(!el('properties').hidden));if(innerWidth<900&&!el('properties').hidden)this.comments.close();};
    el('properties-close').onclick=()=>{el('properties').hidden=true;el('properties-open').setAttribute('aria-expanded','false');el('properties-open').focus();};
    window.addEventListener('beforeunload',event=>{if(this.draft||this.queue?.hasPending){event.preventDefault();event.returnValue='';}});

    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.onclick = () => {this.comments.cancelAnchor();this.interaction.setTool(button.dataset.tool as Tool);});
    el('board-search').oninput=()=>this.renderBoards();
    const newBoard=()=>{el<HTMLInputElement>('create-title').value='';el<HTMLDialogElement>('create-dialog').showModal();};
    el('new-board').onclick=newBoard;el('library-new').onclick=newBoard;
    el('create-form').onsubmit = event => { event.preventDefault(); void (async () => { try { const board = await api.create(el<HTMLInputElement>('create-title').value); el<HTMLDialogElement>('create-dialog').close(); await this.open(board.id); } catch (error) { this.report(error); } })(); };
    el('board-title').onclick = () => { if (!this.board) return; el<HTMLInputElement>('rename-title').value = this.board.title; el<HTMLDialogElement>('rename-dialog').showModal(); };
    el('rename-form').onsubmit = event => { event.preventDefault(); void this.apply([{ op: 'rename', title: el<HTMLInputElement>('rename-title').value }]).then(saved => { if (saved) el<HTMLDialogElement>('rename-dialog').close(); }); };
    el('operation-retry').onclick=()=>{void this.queue?.retry().then(()=>{if(this.queue?.mode==='conflict')el<HTMLDialogElement>('operation-dialog').close();});};
    el('operation-discard').onclick=()=>{this.queue?.discard();};
    el('operation-return').onclick=()=>el<HTMLDialogElement>('operation-dialog').showModal();
    el<HTMLDialogElement>('operation-dialog').addEventListener('cancel',event=>{if(this.queue?.mode==='uncertain')event.preventDefault();else this.queue?.discard();});
    el('text-form').onsubmit = event => { event.preventDefault(); void this.saveText(false); }; el('draft-retry').onclick = () => { void this.saveText(true); };
    document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.onclick = () => button.closest('dialog')!.close());
    el('draft-cancel').onclick=()=>{this.draft=null;this.textEditor.close();}; el('text-form').addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();this.draft=null;this.textEditor.close();}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void this.saveText(!el('draft-retry').hidden);}});
    el('undo').onclick = () => { void this.history('undo'); }; el('redo').onclick = () => { void this.history('redo'); };
    el('zoom-in').onclick = () => this.view.animateZoom(1.2); el('zoom-out').onclick = () => this.view.animateZoom(1 / 1.2); el('zoom-value').onclick = el('fit').onclick = () => this.view.fit();
    el('toggle-sidebar').onclick = () => { const workspace=document.querySelector('.workspace')!; const shown=innerWidth<900?workspace.classList.contains('sidebar-mobile-open')&&!workspace.classList.contains('sidebar-hidden'):!workspace.classList.contains('sidebar-hidden');workspace.classList.toggle('sidebar-hidden',shown);workspace.classList.toggle('sidebar-mobile-open',innerWidth<900&&!shown); if(innerWidth<900 && !workspace.classList.contains('sidebar-hidden'))this.comments.close();try{localStorage.setItem('wireboard:library-sidebar',workspace.classList.contains('sidebar-hidden')?'closed':'open');}catch{} };
    el('present').onclick = () => { if (this.board) void this.presentation.enter(this.board, this.view.selected[0]); };
    el('export-open').onclick = () => el<HTMLDialogElement>('export-dialog').showModal(); document.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => button.onclick = () => { void this.download(button.dataset.export as 'json' | 'svg' | 'png'); });
    el('image-open').onclick = () => el<HTMLInputElement>('image-file').click(); el<HTMLInputElement>('image-file').onchange = event => { const input = event.target as HTMLInputElement; if (input.files?.[0]) void this.image(input.files[0]); input.value = ''; };
    el('import-open').onclick = () => el<HTMLInputElement>('import-file').click(); el<HTMLInputElement>('import-file').onchange = event => { const input = event.target as HTMLInputElement, file = input.files?.[0]; if (file) void (async () => { try { if (file.size > 32 * 1024 * 1024) throw new Error('JSON больше 32 MiB'); const board = await api.import(JSON.parse(await file.text())); await this.open(board.id); } catch (error) { this.report(error); } })(); input.value = ''; };
    el('delete-board').onclick = () => { if (!this.board) return; el('delete-name').textContent = this.board.title; el<HTMLInputElement>('delete-confirm').value = ''; el<HTMLDialogElement>('delete-dialog').showModal(); };
    el('delete-form').onsubmit = event => { event.preventDefault(); if (!this.board || el<HTMLInputElement>('delete-confirm').value !== this.board.title) { this.report(new Error('Название не совпадает.')); return; } void (async () => { try { await api.delete(this.board!.id, this.board!.revision); el<HTMLDialogElement>('delete-dialog').close(); this.empty(); await this.reloadBoards(); this.boardAddress(null);this.status('Библиотека открыта · выберите доску'); } catch (error) { this.report(error); } })(); };
    document.addEventListener('copy',event=>this.copy(event));document.addEventListener('paste',event=>this.paste(event));
    document.addEventListener('keydown', event => this.key(event)); document.addEventListener('keyup', event => {this.interaction.releaseNudge(event.code); if (event.code === 'Space') this.interaction.space = false; });
  }
  private key(event: KeyboardEvent) {
    if (this.presentation.key(event)) return;
    if (isTextTarget(document.activeElement)||event.isComposing || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { this.interaction.finishNudge(true);this.comments.cancelAnchor();this.interaction.setTool('select'); if(this.draft){this.draft=null;this.textEditor.close();return;} this.interaction.cancel(); this.select([]); return; }
    if(this.board&&this.queue&&this.interaction.nudgeKey(event)){event.preventDefault();return;}
    if(!/^(Shift|Control|Meta|Alt)/.test(event.code))this.interaction.finishNudge();
    const resolved=shortcut(event);const command=event.ctrlKey||event.metaKey;
    if(resolved==='undo'||resolved==='redo'){event.preventDefault();this.history(resolved);return;}
    if (command && event.code === 'KeyA') { event.preventDefault(); this.select(this.board?.elements.map(e => e.id) ?? []); return; }
    if (command && event.code === 'KeyD') { event.preventDefault(); if (this.view.selected.length) void this.apply([{ op: 'duplicate', ids: this.view.selected, dx: 40, dy: 40 }]); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (this.view.selected.length) void this.apply([{ op: 'delete', ids: this.view.selected }]); return; }
    if ((event.code === 'Space' || event.key === 'Enter') && document.activeElement?.closest('button,a,[contenteditable=true]')) return;
    if (event.code === 'Space') { event.preventDefault(); this.interaction.space = true; return; }
    if (event.key === 'Enter' && this.view.selected.length === 1) {event.preventDefault(); this.editText(this.view.selected[0]); return; }
    if(resolved){event.preventDefault();this.comments.cancelAnchor();this.interaction.setTool(resolved);}
  }
}
