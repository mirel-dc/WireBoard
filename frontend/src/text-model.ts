import {layoutElement} from './preview';
import type {Element,FontMetrics,Operation,Patch} from './types';
export interface TextDraft{title:string;text:string}
export interface Edit{draft:TextDraft;caret:{field:'title'|'text';offset:number}}
export const TITLE_MAX=256,TEXT_MAX=10000,MAX_HEIGHT=10000,MIN_EDIT_ZOOM=.5;
const GROWS=['rectangle','text'];
// Agents may store line breaks in a title; the single-line field shows them as spaces.
export const displayTitle=(title:string)=>title.replace(/\r?\n/g,' ');
export function draftOf(e:Element):TextDraft{return{title:e.kind==='rectangle'?displayTitle(e.title):'',text:e.text};}
const join=(head:string,text:string)=>text?`${head}\n${text}`:head;
// Enter in the title: the tail after the caret becomes the first line of the description.
export function splitTitle(d:TextDraft,start:number,end:number):Edit{
  const tail=d.title.slice(end);
  return{draft:{title:d.title.slice(0,start),text:tail?join(tail,d.text):d.text},caret:{field:'text',offset:0}};
}
// Backspace at the start of the description joins its first line to the title.
export function joinTitle(d:TextDraft):Edit|null{
  const br=d.text.indexOf('\n'),title=d.title+(br<0?d.text:d.text.slice(0,br));
  if(title.length>TITLE_MAX)return null;
  return{draft:{title,text:br<0?'':d.text.slice(br+1)},caret:{field:'title',offset:d.title.length}};
}
// A multi-line paste into the title keeps its first line there and moves the rest into the description.
export function pasteIntoTitle(d:TextDraft,start:number,end:number,pasted:string):Edit|null{
  const lines=pasted.replace(/\r\n?/g,'\n').split('\n');if(lines.length<2)return null;
  const rest=lines.slice(1).join('\n'),title=(d.title.slice(0,start)+lines[0]).slice(0,TITLE_MAX),text=join(rest+d.title.slice(end),d.text).slice(0,TEXT_MAX);
  return{draft:{title,text},caret:{field:'text',offset:Math.min(rest.length,text.length)}};
}
// The block grows to fit the draft but never shrinks below the height it had when editing began.
export function growHeight(e:Element,d:TextDraft,metrics:FontMetrics):number{
  if(!GROWS.includes(e.kind))return e.height;
  return Math.min(MAX_HEIGHT,Math.max(e.height,layoutElement({...e,title:d.title,text:d.text},metrics).fitHeight));
}
export function textOperations(e:Element,d:TextDraft,height:number):Operation[]{
  const patch:Patch={};if(e.kind==='rectangle'&&d.title!==displayTitle(e.title))patch.title=d.title;if(d.text!==e.text)patch.text=d.text;
  const operations:Operation[]=[];if(Object.keys(patch).length)operations.push({op:'update',id:e.id,patch});
  if(height!==e.height)operations.push({op:'resize',id:e.id,width:e.width,height});
  return operations;
}
