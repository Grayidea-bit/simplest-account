// chart.ts — hand-rolled SVG donut chart for the expense-by-category breakdown.
// No chart library: slices are drawn as stroked circle arcs using stroke-dasharray math.

import { formatCents, type SummaryCategoryShare } from './api';

/** Fixed, pleasant palette. Cycles with modulo if there are more categories than colors. */
const PALETTE = [
  '#a63d2f', // rust
  '#c98a2c', // ochre
  '#2f6f4f', // forest
  '#3d6b8a', // steel blue
  '#7a4f8a', // plum
  '#8a6d3b', // brass
  '#4f7a6b', // moss teal
  '#b0562f', // terracotta
  '#5c5c8a', // indigo slate
  '#9b8c4f', // olive gold
];

export function colorForIndex(i: number): string {
  return PALETTE[i % PALETTE.length];
}

const SIZE = 216;
const CENTER = SIZE / 2;
const RADIUS = 78;
const STROKE = 30;
const GAP = 3; // px arc-length gap between slices, for separation

function svgNS(tag: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

export function renderDonut(container: HTMLElement, data: SummaryCategoryShare[]): void {
  container.innerHTML = '';

  const total = data.reduce((sum, d) => sum + d.total, 0);
  if (data.length === 0 || total <= 0) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.innerHTML =
      '<span class="chart-empty-glyph">○</span><p>No expenses logged this month yet.</p>';
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';

  const svg = svgNS('svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('class', 'donut-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Expense distribution by category');

  const circumference = 2 * Math.PI * RADIUS;

  // faint track ring underneath the slices
  const track = svgNS('circle');
  track.setAttribute('cx', String(CENTER));
  track.setAttribute('cy', String(CENTER));
  track.setAttribute('r', String(RADIUS));
  track.setAttribute('class', 'donut-track');
  track.setAttribute('stroke-width', String(STROKE));
  svg.appendChild(track);

  const group = svgNS('g');
  group.setAttribute('transform', `rotate(-90 ${CENTER} ${CENTER})`);
  svg.appendChild(group);

  let cumulative = 0;
  data.forEach((slice, i) => {
    const fraction = slice.total / total;
    const rawLen = fraction * circumference;
    const len = Math.max(rawLen - GAP, 0);
    const circle = svgNS('circle');
    circle.setAttribute('cx', String(CENTER));
    circle.setAttribute('cy', String(CENTER));
    circle.setAttribute('r', String(RADIUS));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', colorForIndex(i));
    circle.setAttribute('stroke-width', String(STROKE));
    circle.setAttribute('stroke-dasharray', `${len} ${circumference - len}`);
    circle.setAttribute('stroke-dashoffset', String(-cumulative));
    circle.setAttribute('class', 'donut-slice');
    circle.style.animationDelay = `${i * 60}ms`;
    const title = svgNS('title');
    title.textContent = `${slice.category_name}: ${formatCents(slice.total)} (${slice.pct.toFixed(1)}%)`;
    circle.appendChild(title);
    group.appendChild(circle);
    cumulative += rawLen;
  });

  wrap.appendChild(svg);

  const centerLabel = document.createElement('div');
  centerLabel.className = 'donut-center';
  centerLabel.innerHTML = `
    <span class="donut-center-amount">${formatCents(total)}</span>
    <span class="donut-center-caption">spent</span>
  `;
  wrap.appendChild(centerLabel);

  container.appendChild(wrap);

  const legend = document.createElement('ul');
  legend.className = 'chart-legend';
  data.forEach((slice, i) => {
    const li = document.createElement('li');
    li.className = 'chart-legend-item';
    li.innerHTML = `
      <span class="legend-swatch" style="--swatch: ${colorForIndex(i)}"></span>
      <span class="legend-name">${escapeHtml(slice.category_name)}</span>
      <span class="legend-amount">${formatCents(slice.total)}</span>
      <span class="legend-pct">${slice.pct.toFixed(1)}%</span>
    `;
    legend.appendChild(li);
  });
  container.appendChild(legend);
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
