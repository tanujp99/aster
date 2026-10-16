// Tiny DOM helpers — no framework needed for a handful of screens.

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function fmtBytes(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

export function progressBar(): { el: HTMLElement; set(stage: string, frac: number): void; hide(): void } {
  const label = h('span', { class: 'prog-label' });
  const fill = h('div', { class: 'prog-fill' });
  const el = h('div', { class: 'prog', hidden: true }, h('div', { class: 'prog-track' }, fill), label);
  return {
    el,
    set(stage, frac) {
      el.hidden = false;
      label.textContent = stage;
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    },
    hide() { el.hidden = true; },
  };
}
