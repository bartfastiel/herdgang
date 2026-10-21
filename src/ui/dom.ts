// Small DOM helpers without a framework.

type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function svg(tag: string, attrs: Record<string, string | number>, ...children: Node[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  for (const c of children) el.appendChild(c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastTimer = 0;

/** short message at the bottom, optionally with an action (e.g. „Rückgängig“) */
export function toast(message: string, action?: { label: string; run: () => void }): void {
  let box = document.getElementById('toast');
  if (!box) {
    box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(box);
  }
  clear(box);
  box.appendChild(h('span', null, message));
  if (action) {
    box.appendChild(
      h('button', {
        type: 'button',
        class: 'link',
        onclick: () => {
          action.run();
          (box as HTMLElement).classList.remove('show');
        },
      }, action.label),
    );
  }
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (box as HTMLElement).classList.remove('show'), 6000);
}

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Heute';
  if (d.toDateString() === y.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(t: number): string {
  return new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}


/** choice as a row of buttons (role=radiogroup); tapping the chosen option again clears the choice */
export function segmented<T extends string>(label: string, options: { value: T; label: string }[], value: T | undefined, onChange: (v: T | undefined) => void, allowNone = true): HTMLElement {
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const render = (cur: T | undefined) => {
    clear(group);
    for (const o of options) {
      group.appendChild(
        h('button', {
          type: 'button',
          role: 'radio',
          class: 'seg-btn' + (cur === o.value ? ' on' : '') + ' v-' + o.value,
          'aria-checked': cur === o.value ? 'true' : 'false',
          onclick: () => {
            const next = cur === o.value && allowNone ? undefined : o.value;
            render(next);
            onChange(next);
          },
        }, o.label),
      );
    }
  };
  render(value);
  return group;
}

/** two-step delete without a browser dialog: the first tap asks, the second one acts */
export function confirmButton(label: string, confirmLabel: string, run: () => void, cls = 'danger'): HTMLButtonElement {
  let armed = false;
  let timer = 0;
  const b = h('button', {
    type: 'button',
    class: cls,
    onclick: () => {
      if (armed) {
        clearTimeout(timer);
        run();
        return;
      }
      armed = true;
      b.textContent = confirmLabel;
      b.classList.add('armed');
      timer = window.setTimeout(() => {
        armed = false;
        b.textContent = label;
        b.classList.remove('armed');
      }, 4000);
    },
  }, label);
  return b;
}

/** like Element.append, but null/false are skipped */
export function add(el: Node, ...children: Child[]): void {
  append(el, children);
}
