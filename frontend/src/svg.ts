export const ns='http://www.w3.org/2000/svg';
export function setAttrs(node:globalThis.Element,values:Record<string,string|number>):void{for(const [key,value]of Object.entries(values)){const text=String(value);if(node.getAttribute(key)!==text)node.setAttribute(key,text);}}
export function svgElement<K extends keyof SVGElementTagNameMap>(kind:K,attrs:Record<string,string|number>={}):SVGElementTagNameMap[K]{const node=document.createElementNS(ns,kind) as SVGElementTagNameMap[K];setAttrs(node,attrs);return node;}
