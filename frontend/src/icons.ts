const paths = {
  select: 'M5 3l14 9-7 1-3 7z', hand: 'M8 12V6a2 2 0 014 0v5-4a2 2 0 014 0v5-2a2 2 0 014 0v5c0 4-3 7-7 7h-2l-7-8a2 2 0 013-3l3 3',
  rectangle: 'M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z', text: 'M5 5h14M12 5v15M8 20h8', connector: 'M4 20L20 4M10 4h10v10', frame: 'M4 5h16v14H4zM8 9h8M8 13h5',
  image: 'M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M16 8h1', undo: 'M9 4L3 10l6 6M3 10h10a7 7 0 017 7', redo: 'M15 4l6 6-6 6M21 10H11a7 7 0 00-7 7',
  comment: 'M4 4h16v12H9l-5 5zM8 8h8M8 12h5', plus: 'M12 4v16M4 12h16', fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5', play: 'M7 4l14 8-14 8z', export: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4', close: 'M6 6l12 12M6 18L18 6', edit: 'M4 20l4-1L20 7l-3-3L5 16z', settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M8 15v6', copy: 'M9 9h12v12H9zM15 9V3H3v12h6', boards: 'M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v6H3zM14 15h7v6h-7z', minus: 'M5 12h14',
} as const;
export function icon(name: keyof typeof paths) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('icon'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg; }
export function installIcons() {
  const names: Record<string, keyof typeof paths> = { select: 'select', hand: 'hand', rectangle: 'rectangle', text: 'text', connector: 'connector', frame: 'frame', comment: 'comment' };
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.replaceChildren(icon(names[button.dataset.tool!] ?? 'select')));
  for (const [id, name] of Object.entries({ 'image-open': 'image', undo: 'undo', redo: 'redo', 'new-board': 'plus', fit: 'fit', 'zoom-in': 'plus', 'zoom-out': 'minus' } as const)) document.getElementById(id)?.replaceChildren(icon(name));
}
