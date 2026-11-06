export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
export function button(text, action, title, data = {}) {
  const element = node('button', text);
  element.type = 'button'; element.dataset.action = action;
  element.title = title ?? text; element.setAttribute('aria-label', title ?? text);
  Object.assign(element.dataset, data);
  return element;
}

/** Enriched descriptions are untrusted HTML, even when supplied by an owned item. */
export function descriptionFragment(html) {
  const parsed = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  const allowed = new Set('p div span section strong b em i u s br hr ul ol li dl dt dd h1 h2 h3 h4 h5 h6 table thead tbody tr td th a code pre sup sub'.split(' '));
  const blocked = new Set('script style iframe object embed svg math template form input button'.split(' '));
  const fragment = document.createDocumentFragment();
  const copy = (source, dest) => {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { dest.append(document.createTextNode(child.textContent)); continue; }
      const tag = child.nodeName.toLowerCase();
      if (blocked.has(tag)) continue;
      if (!allowed.has(tag)) { copy(child, dest); continue; }
      const clean = node(tag);
      if (tag === 'a') {
        try {
          const url = new URL(child.getAttribute('href') ?? '', location.href);
          if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
            clean.href = url.href; clean.target = '_blank'; clean.rel = 'noopener noreferrer';
          }
        } catch { /* Keep link text without an executable URL. */ }
      }
      copy(child, clean); dest.append(clean);
    }
  };
  copy(parsed.body, fragment); return fragment;
}

export class RichTooltip {
  constructor() { this.generation = 0; }
  hide() {
    this.generation++; clearTimeout(this.timer); this.root?.remove(); this.root = null;
    if (this.anchor?.getAttribute('aria-describedby') === 'bg3-video-hud-tooltip') this.anchor.removeAttribute('aria-describedby');
    this.anchor = null;
  }
  hideSoon() {
    const generation = this.generation;
    queueMicrotask(() => { if (this.generation === generation) this.hide(); });
  }
  show(item, anchor, valid) {
    this.hide(); const generation = this.generation;
    this.timer = setTimeout(async () => {
      let content;
      try { content = await item.richTooltip?.({ secrets: false }); } catch { /* Native tooltip failure keeps the fallback usable. */ }
      if (this.generation !== generation || !anchor.isConnected || !valid()) return;
      const card = node('aside', undefined, 'bg3-video-hud-tooltip');
      card.id = 'bg3-video-hud-tooltip'; card.setAttribute('role', 'tooltip');
      const heading = node('header'); heading.append(node('strong', item.name ?? '未命名物品'));
      const close = button('×', 'close-tooltip', '关闭物品说明'); close.onclick = () => this.hide(); heading.append(close);
      const body = node('div', undefined, 'bg3-video-hud-description');
      body.append(descriptionFragment(content?.content ?? item.system?.description?.value ?? '暂无说明。'));
      card.append(heading, body); document.body.append(card); this.root = card;
      anchor.setAttribute('aria-describedby', card.id);
      this.anchor = anchor;
      const bounds = anchor.getBoundingClientRect(), size = card.getBoundingClientRect();
      card.style.left = `${Math.max(8, Math.min(innerWidth - size.width - 8, bounds.left))}px`;
      card.style.top = `${Math.max(8, bounds.top - size.height - 8)}px`;
      card.addEventListener('mouseleave', () => this.hide());
    }, 120);
  }
}

export function modal(title, onClose) {
  const dialog = node('dialog', undefined, 'bg3-video-hud-dialog');
  const header = node('header'); header.append(node('h2', title));
  const close = button('×', 'close-modal', '关闭窗口'); header.append(close); dialog.append(header);
  const previous = document.activeElement;
  const finish = () => { dialog.remove(); onClose?.(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  close.onclick = () => dialog.close(); dialog.addEventListener('close', finish, { once: true });
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  } });
  document.body.append(dialog); dialog.showModal(); return dialog;
}
