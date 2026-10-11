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
  snapshot: async (id: string): Promise<{ board: Board; svg: string }> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const board = await request<Board>(`/api/boards/${id}`);
      const render = await response(`/api/boards/${id}/render?format=svg`);
      const svg = await render.text();
      if (Number(render.headers.get('x-board-revision')) === board.revision) return { board, svg };
    }
    throw new ApiError('conflict', 'Доска быстро меняется. Повторите открытие.');
  },
  list: () => request<BoardSummary[]>('/api/boards'),
  create: (title: string) => request<Board>('/api/boards', 'POST', { title }),
  getBoard: (id: string) => request<Board>(`/api/boards/${id}`),
  apply: (id: string, command:CommandRequest|number, operations?:Operation[]) => request<Board>(`/api/boards/${id}/apply`, 'POST', typeof command==='number'?{revision:command,operations}:command),
  history: (id: string, command:HistoryCommand|number, direction?:'undo'|'redo') => request<Board>(`/api/boards/${id}/history`, 'POST', typeof command==='number'?{revision:command,direction}:command),
  editState: (id:string,actorId:string,commandId?:string)=>request<EditState>(`/api/boards/${id}/edit-state?actorId=${encodeURIComponent(actorId)}${commandId?`&commandId=${encodeURIComponent(commandId)}`:''}`),
  editSnapshot: async(id:string,actorId:string,commandId?:string):Promise<{state:EditState;svg:string}>=>{
    for(let attempt=0;attempt<4;attempt++) {
      const state=await api.editState(id,actorId,commandId);const render=await response(`/api/boards/${id}/render?format=svg`);const svg=await render.text();
      if(Number(render.headers.get('x-board-revision'))===state.board.revision)return {state,svg};
    }
    throw new ApiError('conflict','Доска быстро меняется. Повторите открытие.');
  },
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
