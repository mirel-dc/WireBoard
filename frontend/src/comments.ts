import { api } from './api';
import { connectorPoints, pointOnRoute, type Point } from './anchors';
import type { CanvasView } from './canvas';
import type { Anchor, Board, CommentOperation, CommentStatus, CommentThread } from './types';
interface Callbacks { current(): Board | null; commit(boardId:string, operations: CommentOperation[], revision: number): Promise<Board>; report(error: unknown): void; confirm?():Promise<void>; anchorMode(): void }
interface Draft { text: string; revision: number; anchor?: Anchor; pending?: { operation: CommentOperation; firstMessageId: number }; notice?: string }
type PopupTarget = { type: 'list' } | { type: 'anchor'; anchor: Anchor; threadId?: number; point?: Point };
const labels: Record<CommentStatus, string> = { open: 'Открыт', awaiting_review: 'Ждёт проверки', resolved: 'Решён' };
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; }
export class Comments {
  private panel = document.getElementById('comments')!;
  private content = document.getElementById('comment-content')!;
  private layer = document.getElementById('comment-pins')!;
  private pinsToggle = document.getElementById('comment-pins-toggle')!;
  private pinsVisible = true;
  private drafts = new Map<string, Draft>();
  private selections = new Map<string, number | 'new'>();
  private filters = new Set<CommentStatus>(['open', 'awaiting_review']);
  private returnFocus: HTMLElement | null = null;
  private returnPin: {board:string;id:number} | null = null;
  private sending = false;
  private boardId: string | null = null;
  private reanchoring: {board:string;id:number} | null = null;
  private popupTarget: PopupTarget = { type: 'list' };
  private popupPosition: Point | null = null;
  private popupDrag: { id: number; start: Point; origin: Point } | null = null;
  private heading = this.panel.querySelector<HTMLElement>('.panel-heading')!;
  get isSending(){return this.sending;}
  cancelAnchor(){this.reanchoring=null;}
  constructor(private view: CanvasView, private cb: Callbacks) {
    this.bindPopupDrag();
    try { this.pinsVisible = localStorage.getItem('wireboard:comment-pins') !== 'hidden'; } catch { /* View preferences are optional. */ }
    this.pinsToggle.onclick = () => {
      this.pinsVisible = !this.pinsVisible;
      try { localStorage.setItem('wireboard:comment-pins', this.pinsVisible ? 'visible' : 'hidden'); } catch { /* View preferences are optional. */ }
      this.renderPins();
    };
    document.getElementById('comments-open')!.onclick = () => this.toggle();
    document.getElementById('comments-close')!.onclick = () => this.close();
    document.querySelectorAll<HTMLButtonElement>('[data-comment-filter]').forEach(button => button.onclick = () => { const s = button.dataset.commentFilter as CommentStatus; if (this.filters.has(s)) this.filters.delete(s); else this.filters.add(s); button.setAttribute('aria-pressed', String(this.filters.has(s))); this.render(); });
    window.addEventListener('beforeunload', event => { if ([...this.drafts.values()].some(d => d.text.trim())) { event.preventDefault(); event.returnValue = ''; } });
    this.panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
    document.addEventListener('pointerdown', event => {
      const target = event.target as globalThis.Element;
      if (!this.panel.hidden && !this.panel.contains(target) && !target.closest('#comments-open, .comment-pin')) this.close(false);
    }, true);
    new ResizeObserver(() => this.position()).observe(this.panel);
    window.addEventListener('resize', () => this.position());
    window.visualViewport?.addEventListener('resize', () => this.position());
    window.visualViewport?.addEventListener('scroll', () => this.position());
  }
  private key(selection: number | 'new') { return `${this.cb.current()?.id}:${selection}`; }
  private bindPopupDrag() {
    const title = document.getElementById('comments-heading')!;
    title.tabIndex = 0;
    title.title = 'Перетащите заголовок, чтобы переместить окно. Стрелки — перемещение с клавиатуры.';
    this.heading.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || (event.target as globalThis.Element).closest('button')) return;
      event.preventDefault(); event.stopPropagation();
      const box = this.panel.getBoundingClientRect();
      this.popupDrag = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: box.x, y: box.y } };
      this.popupPosition = { x: box.x, y: box.y };
      this.panel.dataset.dragging = 'true';
      this.heading.setPointerCapture(event.pointerId);
    });
    this.heading.addEventListener('pointermove', event => {
      const drag = this.popupDrag; if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      this.popupPosition = { x: drag.origin.x + event.clientX - drag.start.x, y: drag.origin.y + event.clientY - drag.start.y };
      this.position();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.heading.addEventListener(type, event => {
      if (this.popupDrag?.id === event.pointerId) this.endPopupDrag();
    });
    title.addEventListener('keydown', event => {
      const direction: Point | undefined = ({ ArrowLeft: {x:-1,y:0}, ArrowRight: {x:1,y:0}, ArrowUp: {x:0,y:-1}, ArrowDown: {x:0,y:1} } as Record<string, Point>)[event.key];
      if (!direction || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      const box = this.panel.getBoundingClientRect(), step = event.shiftKey ? 1 : 10;
      this.popupPosition = { x: box.x + direction.x * step, y: box.y + direction.y * step };
      this.position();
    });
  }
  private endPopupDrag() {
    const id = this.popupDrag?.id; this.popupDrag = null; delete this.panel.dataset.dragging;
    if (id !== undefined && this.heading.hasPointerCapture(id)) this.heading.releasePointerCapture(id);
  }
  private get selection() { return this.selections.get(this.cb.current()?.id ?? ''); }
  private draft(selection: number | 'new') { const key = this.key(selection); let draft = this.drafts.get(key); if (!draft) { draft = { text: '', revision: this.cb.current()!.revision }; this.drafts.set(key, draft); } return draft; }
  private show(target: PopupTarget) {
    this.endPopupDrag(); this.popupPosition = null;
    const active = document.activeElement as HTMLElement;
    if (!this.panel.contains(active)) {
      this.returnFocus = active;
      this.returnPin = active?.dataset.thread ? { board: this.cb.current()!.id, id: Number(active.dataset.thread) } : null;
    }
    this.popupTarget = target;
    this.panel.hidden = false;
    document.getElementById('properties')!.hidden = true;
    document.getElementById('properties-open')!.setAttribute('aria-expanded', 'false');
    document.getElementById('comments-open')!.setAttribute('aria-expanded', 'true');
    this.content.scrollTop = 0;
    this.render();
    const input = this.content.querySelector('textarea');
    if (input && !input.disabled) this.focusComposer();
    else if (input) this.panel.focus({ preventScroll: true });
    else (this.content.querySelector<HTMLElement>('.thread-row') ?? this.panel).focus({ preventScroll: true });
  }
  private showList() { const board = this.cb.current(); if (!board) return; this.selections.delete(board.id); this.show({ type: 'list' }); }
  toggle() { if (!this.panel.hidden && this.popupTarget.type === 'list') this.close(); else this.showList(); }
  close(restoreFocus = true) { this.endPopupDrag(); this.panel.hidden = true; document.getElementById('comments-open')!.setAttribute('aria-expanded', 'false');const pin=this.returnPin?.board===this.cb.current()?.id?this.layer.querySelector<HTMLButtonElement>(`[data-thread="${this.returnPin?.id}"]`):null;const focus=pin??(this.returnFocus?.isConnected&&!this.panel.contains(this.returnFocus)?this.returnFocus:document.getElementById('comments-open'));if(restoreFocus)focus?.focus({preventScroll:true}); }
  private position() {
    if (this.panel.hidden) return;
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 12, top = (viewport?.offsetTop ?? 0) + 12;
    const right = left + (viewport?.width ?? innerWidth) - 24, bottom = top + (viewport?.height ?? innerHeight) - 24;
    this.panel.style.maxInlineSize = `${right - left}px`;
    this.panel.style.maxBlockSize = `min(560px, ${bottom - top}px)`;
    const box = this.panel.getBoundingClientRect();
    const button = document.getElementById('comments-open')!.getBoundingClientRect();
    let x = button.right - box.width, y = button.bottom + 10;
    if (this.popupPosition) { x = this.popupPosition.x; y = this.popupPosition.y; }
    else if (this.popupTarget.type === 'anchor') {
      const target = this.popupTarget;
      const thread = this.cb.current()?.comments.find(c => c.id === target.threadId);
      const point = target.point ?? this.anchorPoint(target.anchor, thread);
      const area = this.view.svg.getBoundingClientRect();
      let origin = { x: area.x + this.view.camera.x + point.x * this.view.camera.zoom, y: area.y + this.view.camera.y + point.y * this.view.camera.zoom };
      const pin = target.threadId === undefined ? null : this.layer.querySelector<HTMLButtonElement>(`[data-thread="${target.threadId}"]`);
      if (pin) { const rect = pin.getBoundingClientRect(); origin = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
      if (origin.x >= area.left && origin.x <= area.right && origin.y >= area.top && origin.y <= area.bottom) {
        x = origin.x + 14; y = origin.y + 14;
        if (x + box.width > right) x = origin.x - box.width - 14;
        if (y + box.height > bottom) y = origin.y - box.height - 14;
      }
    }
    this.panel.style.insetInlineStart = `${Math.max(left, Math.min(right - box.width, x))}px`;
    this.panel.style.insetBlockStart = `${Math.max(top, Math.min(bottom - box.height, y))}px`;
    if (this.popupPosition) this.popupPosition = { x: Math.max(left, Math.min(right - box.width, x)), y: Math.max(top, Math.min(bottom - box.height, y)) };
    if (this.content.querySelector('textarea') === document.activeElement) this.revealComposer();
  }
  private revealComposer() {
    const form = this.content.querySelector('form'), input = this.content.querySelector('textarea');
    if (!form || !input || this.panel.hidden) return;
    const area = this.content.getBoundingClientRect();
    const rect = (form.getBoundingClientRect().height <= area.height ? form : input).getBoundingClientRect();
    if (rect.bottom > area.bottom) this.content.scrollTop += rect.bottom - area.bottom;
    else if (rect.top < area.top) this.content.scrollTop -= area.top - rect.top;
  }
  private focusComposer() { const input = this.content.querySelector<HTMLTextAreaElement>('textarea'); if (input && !input.disabled) { input.focus({preventScroll:true}); this.revealComposer(); } }
  place(anchor: Anchor, clientPoint?: Point) {
    const board = this.cb.current(); if (!board) return;
    if (this.reanchoring !== null) {const mode=this.reanchoring;this.cancelAnchor();if(mode.board!==board.id){this.cb.report(new Error('Перепривязка отменена: доска изменилась.'));return;}void this.cb.commit(board.id,[{op:'comment_reanchor',threadId:mode.id,author:'user',anchor}],board.revision).then(()=>this.openThread(mode.id)).catch(error=>this.cb.report(error));return;}
    const draft = this.draft('new');
    if (draft.text && draft.anchor && JSON.stringify(draft.anchor) !== JSON.stringify(anchor)) { this.cb.report(new Error('Сначала отправьте или очистите черновик нового комментария.')); this.selections.set(board.id, 'new'); this.show({type:'anchor',anchor:draft.anchor}); return; }
    draft.anchor = anchor; if (!draft.text) draft.revision = board.revision;
    this.selections.set(board.id, 'new'); this.show({ type: 'anchor', anchor, point: clientPoint ? this.view.worldPoint(clientPoint.x, clientPoint.y) : undefined });
  }
  openThread(id: number) { const board = this.cb.current(); if (!board) return; const thread = board.comments.find(c => c.id === id); if (!thread) return; this.selections.set(board.id, id); this.show({ type: 'anchor', anchor: thread.anchor, threadId: id }); }
  update() {
    const board = this.cb.current(); const changedBoard = this.boardId !== board?.id; this.boardId = board?.id ?? null;
    if(changedBoard){this.cancelAnchor();this.close(false);}
    const selection=this.selection;
    if(board&&selection!==undefined){const draft=this.draft(selection);if(!draft.text&&!draft.pending)draft.revision=board.revision;}
    document.getElementById('comments-count')!.textContent = String(board?.comments.filter(c => c.status !== 'resolved').length ?? 0);
    this.renderPins();
    const focused = this.content.querySelector('textarea') as HTMLTextAreaElement | null;
    const restore = !changedBoard && focused === document.activeElement;
    const start = focused?.selectionStart ?? 0, end = focused?.selectionEnd ?? 0;
    this.render();
    if (restore) { const next=this.content.querySelector('textarea'); if(next&&!next.disabled){next.focus({preventScroll:true});next.setSelectionRange(start,end);} }
  }

  private orphan(thread: CommentThread) { const board = this.cb.current(); return thread.anchor.type !== 'point' && !board?.elements.some(e => e.id === (thread.anchor as { elementId: number }).elementId); }
  private anchorPoint(anchor:Anchor,thread?:CommentThread):Point{
    if(anchor.type==='point')return {x:anchor.x,y:anchor.y};
    const board=this.cb.current();const element=board?.elements.find(e=>e.id===anchor.elementId);
    if(element&&board){const e=this.view.project(element);return anchor.type==='element'?{x:e.x+e.width*anchor.u,y:e.y+e.height*anchor.v}:pointOnRoute(connectorPoints(board,e,n=>this.view.project(n)),anchor.t);}
    return {x:thread?.anchorSnapshot?.worldX??0,y:thread?.anchorSnapshot?.worldY??0};
  }
  renderPins() {
    this.pinsToggle.textContent = this.pinsVisible ? 'Скрыть метки на схеме' : 'Показать метки на схеме';
    const active=document.activeElement as HTMLElement|null;const focusedPin=active?.closest('.comment-pin')?.getAttribute('data-thread');
    this.layer.replaceChildren(); const board = this.cb.current(); if (!board || !this.pinsVisible) { this.position(); return; }
    const placed: { x: number; y: number }[] = [];
    for (const thread of board.comments.filter(c => c.status !== 'resolved' && (this.filters.has(c.status) || this.selection === c.id)).sort((a,b)=>Number(b.id===this.selection)-Number(a.id===this.selection)||a.id-b.id)) {
      const p=this.anchorPoint(thread.anchor,thread);
      const origin = { x: this.view.camera.x + p.x * this.view.camera.zoom, y: this.view.camera.y + p.y * this.view.camera.zoom }; let x = origin.x, y = origin.y;
      while (placed.some(p => Math.hypot(p.x - x, p.y - y) < 44)) { x += 44; }
      placed.push({ x, y });
      if (x !== origin.x) { const leader = node('span', undefined, 'pin-leader'); leader.style.left = `${origin.x}px`; leader.style.top = `${origin.y}px`; leader.style.width = `${x - origin.x}px`; this.layer.append(leader); }
      const pin = node('button', String(thread.id), `comment-pin ${thread.status}${this.orphan(thread) ? ' orphaned' : ''}`);pin.dataset.thread=String(thread.id); pin.setAttribute('aria-label', `Комментарий ${thread.id}: ${labels[thread.status]}`); pin.style.left = `${x}px`; pin.style.top = `${y}px`; pin.onclick = () => {pin.focus({preventScroll:true});this.openThread(thread.id);}; this.layer.append(pin);
    }
    if(focusedPin)this.layer.querySelector<HTMLButtonElement>(`[data-thread="${focusedPin}"]`)?.focus({preventScroll:true});
    this.position();
  }
  private messages(container: globalThis.Element, thread: CommentThread) {
    container.replaceChildren();
    for (const m of thread.messages) { const item = node('article', undefined, `comment-message ${m.author}`); const heading = node('div', undefined, 'message-heading'); heading.append(node('strong', m.author === 'user' ? 'Вы' : m.author === 'codex' ? 'Codex' : 'Claude'), node('time', new Date(m.createdAt).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))); item.append(heading, node('p', m.text)); container.append(item); }
  }
  private button(label: string, action: () => void, cls?: string) { const b = node('button', label, cls); b.type = 'button'; b.onclick = action; b.disabled = this.sending; return b; }
  render() {
    const oldInput = this.content.querySelector('textarea');
    const restoreInput = oldInput !== null && oldInput === document.activeElement;
    const start = oldInput?.selectionStart ?? 0, end = oldInput?.selectionEnd ?? 0;
    const scrollTop = this.content.scrollTop;
    const historyScrollTop = this.content.querySelector('.comment-messages')?.scrollTop ?? 0;
    this.content.replaceChildren(); this.renderPins(); const board = this.cb.current(); if (!board) return;
    const selection = this.selection;
    this.pinsToggle.hidden = selection !== undefined;
    document.querySelector<HTMLElement>('#comments .comment-filters')!.hidden = selection !== undefined;
    document.getElementById('comments-heading')!.textContent = selection === undefined ? 'Комментарии' : selection === 'new' ? 'Новый комментарий' : `Комментарий #${selection}`;
    this.panel.dataset.mode = selection === undefined ? 'list' : selection === 'new' ? 'new' : 'thread';
    if (selection === undefined) {
      const list = node('div', undefined, 'thread-list');
      const newDraft = this.drafts.get(this.key('new'));
      if (newDraft?.anchor && (newDraft.text || newDraft.pending)) list.append(this.button('Продолжить черновик', () => { this.selections.set(board.id, 'new'); this.show({type:'anchor',anchor:newDraft.anchor!}); }, 'thread-row'));
      for (const c of board.comments.filter(c => this.filters.has(c.status))) { const row = this.button('', () => this.openThread(c.id), 'thread-row'); row.append(node('span', `#${c.id} · ${labels[c.status]}`, 'thread-status'), node('strong', this.orphan(c) ? 'Объект удалён' : c.anchorSnapshot?.title || c.anchorSnapshot?.text.slice(0, 70) || 'Точка на холсте'), node('p', c.messages.at(-1)?.text)); list.append(row); }
      if (!list.childElementCount) list.append(node('p', 'Здесь появятся комментарии. Нажмите C и выберите место на схеме.', 'empty-comment'));
      this.content.append(list); this.content.scrollTop = scrollTop; this.position(); return;
    }
    const back = this.button('Все комментарии', () => this.showList(), 'comment-back'); this.content.append(back);
    const thread = board.comments.find(c => c.id === selection); const draft = this.draft(selection);
    if (thread) {
      this.content.append(node('span', labels[thread.status], 'thread-status'));
      if (thread.reviewRevision !== null) this.content.append(node('p', `Результат на версии ${thread.reviewRevision}`, 'review-revision'));
      this.content.append(this.button('Показать на схеме',()=>this.view.reveal(this.anchorPoint(thread.anchor,thread))));
      if (this.orphan(thread)) { this.content.append(node('p', 'Объект удалён. Комментарий сохранён.', 'orphan-notice'), this.button('Привязать к другому объекту', () => { this.reanchoring = {board:board.id,id:thread.id}; this.cb.anchorMode(); this.close(); })); }
      const history = node('div', undefined, 'comment-messages'); this.messages(history, thread); this.content.append(history);
      this.content.append(this.button(thread.status === 'resolved' ? 'Открыть снова' : thread.status === 'awaiting_review' ? 'Принять результат' : 'Отметить решённым', () => { void this.status(thread, thread.status === 'resolved' ? 'open' : 'resolved'); }, 'review-action'));
    } else if (selection !== 'new') { this.content.append(node('p', 'Ветка отменена или удалена из истории. Черновик сохранён.')); return; }
    else this.content.append(node('p', draft.anchor?.type === 'point' ? 'Точка на холсте' : draft.anchor?.type === 'connector' ? 'Связь' : 'Объект схемы', 'anchor-label'));
    const form = node('form'); const label = node('label', thread ? 'Ответ' : 'Комментарий'); const input = node('textarea'); input.rows = 3; input.maxLength = 4000; input.value = draft.text; input.disabled = this.sending; input.placeholder = thread ? 'Напишите ответ…' : 'Что стоит изменить или обсудить?'; label.append(input); form.append(label);
    input.oninput = () => { draft.text = input.value; if (!draft.pending && !draft.text) draft.revision = this.cb.current()!.revision; };
    const notice = node('p', draft.notice, 'comment-notice'); notice.setAttribute('role', 'status'); form.append(notice);
    const send = node('button', draft.pending ? 'Повторить комментарий' : 'Отправить комментарий', 'primary'); send.type = 'submit'; send.disabled = this.sending; form.append(send);
    form.append(node('span', 'Ctrl / ⌘ + Enter — отправить', 'comment-shortcut'));
    form.onsubmit = event => { event.preventDefault(); void this.send(selection, !!draft.pending); };
    input.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); } };
    this.content.append(form);
    this.content.scrollTop = scrollTop;
    const history = this.content.querySelector('.comment-messages');
    if (history) history.scrollTop = historyScrollTop;
    this.position();
    if (restoreInput && !input.disabled) { this.focusComposer(); input.setSelectionRange(start,end); }
  }
  private async status(thread: CommentThread, status: 'open' | 'resolved') {
    const board = this.cb.current(); if (!board || this.sending) return;
    const restoreFocus = this.panel.contains(document.activeElement);
    this.sending = true;
    try { await this.cb.commit(board.id,[{ op: 'comment_status', author: 'user', threadId: thread.id, status }], board.revision); }
    catch (error) { this.cb.report(error); }
    finally {
      this.sending = false; this.render();
      if (restoreFocus && !this.panel.hidden && this.cb.current()?.id === board.id) this.focusComposer();
    }
  }
  private async send(selection: number | 'new', retry: boolean) {
    const board = this.cb.current(); if (!board || this.sending) return; const draft = this.draft(selection); const text = draft.text;const draftKey=`${board.id}:${selection}`;
    if (!text.trim()) { draft.notice = 'Напишите комментарий.'; this.render(); return; }
    const operation: CommentOperation = selection === 'new' ? { op: 'comment_create', author: 'user', text, anchor: draft.anchor! } : { op: 'comment_reply', threadId: selection, author: 'user', text, submitForReview: false };
    if (selection === 'new' && !draft.anchor) return;
    const firstMessageId = draft.pending?.firstMessageId ?? board.nextMessageId;
    const popupTarget = this.popupTarget;
    let sent = false;
    const restoreFocus = this.panel.contains(document.activeElement);
    this.sending = true; this.render();
    try {
      let revision = draft.revision;
      if (retry) {
        await this.cb.confirm?.();const fresh = await api.getBoard(board.id); const pending = draft.pending!;
        const candidates = fresh.comments.filter(c => pending.operation.op === 'comment_create' ? JSON.stringify(c.anchor) === JSON.stringify(pending.operation.anchor) : pending.operation.op === 'comment_reply' && c.id === pending.operation.threadId);
        const saved = candidates.find(c => c.messages.some(m => m.id >= pending.firstMessageId && m.author === 'user' && m.text === ('text' in pending.operation ? pending.operation.text : '')));
        if (saved) {
          this.drafts.delete(draftKey);
          if (this.popupTarget === popupTarget) this.selections.set(board.id, saved.id);
          if ('text' in pending.operation && text!==pending.operation.text) {this.drafts.set(`${board.id}:${saved.id}`,{text,revision:fresh.revision,notice:'Предыдущее сообщение уже сохранено. Изменённый текст остался новым ответом.'});}
          else sent = true;
          return;
        }
        revision = fresh.revision;
      }
      const result = await this.cb.commit(board.id,[operation], revision);
      this.drafts.delete(draftKey);
      if (this.popupTarget === popupTarget) this.selections.set(board.id, selection === 'new' ? result.nextCommentId - 1 : selection);
      sent = true;
    } catch (error) { draft.pending = { operation, firstMessageId }; draft.notice = 'Ответ не подтверждён. Черновик сохранён. При повторе сначала проверим, не появился ли он на доске.'; this.cb.report(error); }
    finally {
      const focusCurrent = this.panel.contains(document.activeElement);
      this.sending = false; this.render();
      if (!this.panel.hidden && this.cb.current()?.id === board.id) {
        if (sent && this.popupTarget === popupTarget) this.close();
        else if (focusCurrent || (restoreFocus && this.popupTarget === popupTarget)) this.focusComposer();
      }
    }
  }
}
