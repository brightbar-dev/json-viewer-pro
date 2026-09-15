/**
 * Small line icons on a 16×16 grid, built with DOM APIs: no image requests, no
 * web fonts, nothing a page's content security policy can block.
 */

const PATHS = {
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm3.6-1.4L14 14',
  filter: 'M2.5 3h11L9.5 8v4.5l-3 1.5V8Z',
  code: 'M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4',
  tree: 'M3 2.5v11M3 5.5h4M3 10.5h4M9 5.5h4M9 10.5h4',
  copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
  chevron: 'M4.5 6.5 8 10l3.5-3.5',
  up: 'M4.5 9.5 8 6l3.5 3.5',
  down: 'M4.5 6.5 8 10l3.5-3.5',
  expand: 'M8 2v4.5M5.5 4 8 1.5 10.5 4M8 14v-4.5M5.5 12 8 14.5 10.5 12',
  collapse: 'M8 1.5V6M5.5 3.5 8 6l2.5-2.5M8 14.5V10M5.5 12.5 8 10l2.5 2.5',
  sort: 'M2.5 4h11M2.5 8h7M2.5 12h3.5',
  table: 'M2 3h12v10H2zM2 6.5h12M6.5 6.5V13',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  download: 'M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5 6.5 12 13 4.5',
} as const;

export type IconName = keyof typeof PATHS;

/** The SVG namespace (an identifier, not an address that is ever fetched). */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'jvp-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.appendChild(path);
  return svg;
}
