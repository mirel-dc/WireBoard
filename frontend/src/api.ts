import type { Board, BoardEvent, BoardSummary, Operation,CommandRequest,HistoryCommand,EditState,CommandReceipt,FontMetrics } from './types';
export class ApiError extends Error { constructor(public code: string, message: string,public details?:unknown) { super(message); } }
async function response(path: string, init?: RequestInit) {
  let result: Response;
  try { result = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
  catch { throw new ApiError('connection', 'Сервер недоступен. Изменения не сохранены.'); }
  if (!result.ok) { const error = await result.json().catch(() => ({ code: 'request', message: `Ошибка запроса (${result.status})` })); throw new ApiError(error.code, error.message,error.details); }
  return result;
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const result=await response(path,{method,body:body===undefined?undefined:JSON.stringify(body)});
  try{return await result.json();}catch{throw new ApiError('connection','Ответ сервера не подтверждён. Проверим результат по квитанции команды.');}
}
export const api = {
  metrics:()=>request<FontMetrics>('/api/layout-metrics'),
  library:()=>request<{path:string;boardCount:number}>('/api/library'),
  list: () => request<BoardSummary[]>('/api/boards'),
  create: (title: string) => request<Board>('/api/boards', 'POST', { title }),
  getBoard: (id: string) => request<Board>(`/api/boards/${id}`),
  apply: (id: string, command:CommandRequest|number, operations?:Operation[]) => request<Board>(`/api/boards/${id}/apply`, 'POST', typeof command==='number'?{revision:command,operations}:command),
  history: (id: string, command:HistoryCommand|number, direction?:'undo'|'redo') => request<Board>(`/api/boards/${id}/history`, 'POST', typeof command==='number'?{revision:command,direction}:command),
  applyState: (id:string,command:CommandRequest)=>request<EditState>(`/api/boards/${id}/apply?state=1`,'POST',command),
  historyState: (id:string,command:HistoryCommand)=>request<EditState>(`/api/boards/${id}/history?state=1`,'POST',command),
  editState: (id:string,actorId:string,commandId?:string)=>request<EditState>(`/api/boards/${id}/edit-state?actorId=${encodeURIComponent(actorId)}${commandId?`&commandId=${encodeURIComponent(commandId)}`:''}`),
  receipt: (id:string,commandId:string)=>request<CommandReceipt>(`/api/boards/${id}/commands/${encodeURIComponent(commandId)}`),
  delete: (id: string, revision: number) => request(`/api/boards/${id}?revision=${revision}`, 'DELETE'),
  import: (board: unknown) => request<Board>('/api/import', 'POST', board),
  svg: async (id: string, frame?: number) => (await response(`/api/boards/${id}/render?format=svg${frame === undefined ? '' : `&frame=${frame}`}`)).text(),
  download: async (id: string, format: 'svg' | 'png', frame?: number) => (await response(`/api/boards/${id}/render?format=${format}${frame === undefined ? '' : `&frame=${frame}`}`)).blob(),
  subscribe(onChange: (event: BoardEvent | null) => void, onConnection: (online: boolean) => void) {
    const source = new EventSource('/api/events'); source.onopen = () => onConnection(true); source.onerror = () => onConnection(false);
    source.addEventListener('board', event => { try { onChange(JSON.parse((event as MessageEvent).data)); } catch { onChange(null); } });
    source.addEventListener('reload', () => onChange(null)); return () => source.close();
  },
};
