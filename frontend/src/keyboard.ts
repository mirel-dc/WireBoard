import type {Tool} from './interaction';
export type EditorShortcut='undo'|'redo'|Tool;
export function isTextTarget(target:EventTarget|null):boolean {
  return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
}
export function command(event:KeyboardEvent):EditorShortcut|null {
  if(event.isComposing||isTextTarget(event.target))return null;
  if(event.ctrlKey||event.metaKey){if(event.code==='KeyZ')return event.shiftKey?'redo':'undo';if(event.code==='KeyY')return 'redo';return null;}
  if(event.altKey)return null;
  return ({KeyV:'select',KeyH:'hand',KeyR:'rectangle',KeyT:'text',KeyL:'connector',KeyF:'frame',KeyC:'comment'} as Record<string,Tool>)[event.code]??null;
}
