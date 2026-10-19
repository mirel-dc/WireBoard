export type Kind = 'rectangle' | 'text' | 'connector' | 'frame' | 'image';
export type Port = 'auto' | 'left' | 'right' | 'top' | 'bottom';
export interface Element { id: number; kind: Kind; x: number; y: number; width: number; height: number; text: string; title: string; fontWeight: 400 | 600; fill: string; stroke: string; fontSize: number; from: number | null; to: number | null; fromPort: Port; toPort: Port; image: string | null; parentFrameId: number | null }
export type Anchor = { type: 'element'; elementId: number; u: number; v: number } | { type: 'connector'; elementId: number; t: number } | { type: 'point'; x: number; y: number };
export type Author = 'user' | 'codex' | 'claude';
export type CommentStatus = 'open' | 'awaiting_review' | 'resolved';
export interface CommentMessage { id: number; author: Author; text: string; createdAt: string }
export interface CommentThread { id: number; anchor: Anchor; anchorSnapshot: (Pick<Element, 'kind' | 'title' | 'text' | 'x' | 'y' | 'width' | 'height' | 'from' | 'to'> & { elementId: number; worldX: number; worldY: number }) | null; messages: CommentMessage[]; status: CommentStatus; createdAt: string; updatedAt: string; reviewRevision: number | null }
export interface Board { version: number; id: string; title: string; revision: number; nextId: number; elements: Element[]; comments: CommentThread[]; nextCommentId: number; nextMessageId: number }
export interface BoardSummary { id: string; title: string; slug: string; revision: number; elementCount: number }
export type Patch = Partial<Pick<Element, 'text' | 'title' | 'fontWeight' | 'fill' | 'stroke' | 'fontSize' | 'x' | 'y' | 'width' | 'height' | 'from' | 'to' | 'fromPort' | 'toPort' | 'parentFrameId'>>;
export type CommentOperation = { op: 'comment_create'; anchor: Anchor; author: Author; text: string } | { op: 'comment_reply'; threadId: number; author: Author; text: string; submitForReview: boolean } | { op: 'comment_status'; threadId: number; author: 'user'; status: 'open' | 'resolved' } | { op: 'comment_reanchor'; threadId: number; author: 'user'; anchor: Anchor };
export type Operation = { op: 'create'; element: Partial<Element> & { kind: Kind } } | { op: 'update'; id: number; patch: Patch } | { op: 'move'; ids: number[]; dx: number; dy: number } | { op: 'resize'; id: number; width: number; height: number } | { op: 'delete'; ids: number[] } | { op: 'duplicate'; ids: number[]; dx: number; dy: number } | { op: 'rename'; title: string } | CommentOperation;
export interface BoardEvent { id: string; revision: number; kind: 'created' | 'changed' | 'deleted'; commandId?: string; actorId?: string }
export type Source = 'user'|'codex'|'claude'|'legacy';
export interface Actor {id:string;source:Source}
export interface CommandMeta {id:string;actor:Actor;label:string}
export type EntityKey = {type:'board'}|{type:'element'|'comment';id:number};
export interface FieldKey {entity:EntityKey;field:string}
export type OptionalValue = {present:false}|{present:true;value:unknown};
export interface FieldGuard {key:FieldKey;value:OptionalValue;stamp:string}
export interface FieldStampEntry {key:FieldKey;stamp:string}
export interface CommandRequest {revision:number;operations:Operation[];command?:CommandMeta;guards?:FieldGuard[]}
export interface HistoryAction {commandId:string;label:string}
export interface HistorySummary {undo:HistoryAction|null;redo:HistoryAction|null}
export interface CommandReceipt {id:string;fingerprint:string;committedRevision:number}
export interface HistoryCommand {revision:number;direction:'undo'|'redo';targetCommandId:string;command:CommandMeta}
export interface EditState {board:Board;stamps:FieldStampEntry[];history:HistorySummary;receipt:CommandReceipt|null}
export interface FontMetrics{regular:Record<string,number>;semibold:Record<string,number>;fallback:number}
export interface Bounds{x:number;y:number;width:number;height:number}
export interface TextRow{text:string;x:number;y:number;size:number;weight:number}
export interface ElementLayout{id:number;bounds:Bounds;title:TextRow[];body:TextRow[];fitHeight:number;overflow:boolean}
export interface ConnectorLayout{id:number;points:{x:number;y:number}[];captionBounds:Bounds;caption:TextRow[]}
export interface SceneLayout{elements:ElementLayout[];connectors:ConnectorLayout[]}
