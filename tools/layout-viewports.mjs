// Test/preview inputs only. Effective CSS viewport + emulated DPR model zoom;
// they do not reproduce an operating system's display settings or browser chrome.
export const SCREEN_SIZES = [[1280, 720], [1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]];
export const ZOOM_FACTORS = [1, 1.25, 1.5, 2];
export const ZOOM_CASES = SCREEN_SIZES.flatMap(([screenWidth, screenHeight]) => ZOOM_FACTORS.map(zoom => ({
  width: Math.floor(screenWidth / zoom), height: Math.floor(screenHeight / zoom), deviceScaleFactor: zoom,
  label: `${screenWidth}x${screenHeight} at ${zoom * 100}% effective viewport`, screenWidth, screenHeight, zoom
})));

// Self-contained so DevTools/Playwright can evaluate it inside the fixture page.
export function measureHUD() {
  const root = document.getElementById('bg3-video-hud'), rect = root.getBoundingClientRect();
  const css = getComputedStyle(root), cell = root.querySelector('.bg3-video-hud-use').getBoundingClientRect();
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--video-cell)'; root.append(probe);
  const nominalCell = probe.getBoundingClientRect().width; probe.remove();
  const badges = [...root.querySelectorAll('.bg3-video-hud-condition-ring > li')].map(s => s.getBoundingClientRect());
  const portrait = root.querySelector('.bg3-video-hud-portrait-wrap').getBoundingClientRect();
  const pact = root.querySelector('.bg3-video-hud-pact-slots'), pactBox = pact?.getBoundingClientRect();
  const rail = root.querySelector('.bg3-video-hud-spells').getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
    height: rect.height, width: rect.width, clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
    font: parseFloat(css.fontSize), gap: parseFloat(css.rowGap), cell: cell.height, nominalCell,
    portrait: root.querySelector('.bg3-video-hud-portrait').getBoundingClientRect().height,
    dpr: window.devicePixelRatio,
    noFooter: !root.querySelector('footer'),
    headingControlsAdjacent: [...root.querySelectorAll('.bg3-video-hud-panel-heading')].every(heading => {
      const gear = heading.querySelector('button').getBoundingClientRect(), search = heading.querySelector('input').getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(heading).columnGap);
      return gear.width > 0 && search.width > 0 && Math.abs(search.left - gear.right - gap) < 1
        && Math.abs(search.top - gear.top) < 1;
    }),
    conditionsCentered: !badges.length || Math.abs(badges.reduce((sum, b) => sum + b.x + b.width / 2, 0) / badges.length - portrait.x - portrait.width / 2) < 1,
    pactFits: !pact || (pactBox.width > 0 && pactBox.height > 0 && pactBox.left >= rail.right - 1 && pactBox.right <= rect.right + 1
      && pactBox.top >= rect.top - 1 && pactBox.bottom <= rect.bottom + 1
      && pact.contains(document.elementFromPoint(pactBox.x + pactBox.width / 2, pactBox.y + pactBox.height / 2))
      && [...pact.querySelectorAll('i')].every(pip => {
        const b = pip.getBoundingClientRect();
        return b.width >= 4 && b.height >= 6 && b.left >= pactBox.left && b.right <= pactBox.right
          && b.top >= pactBox.top && b.bottom <= pactBox.bottom;
      })),
    conditionsFit: [...root.querySelectorAll('.bg3-video-hud-condition-ring > li')].every(slot => {
      const box = slot.getBoundingClientRect(), wrap = slot.closest('.bg3-video-hud-portrait-wrap').getBoundingClientRect();
      const badge = slot.firstElementChild;
      return box.left >= wrap.left - 1 && box.right <= wrap.right + 1 && box.top >= wrap.top - 1 && box.bottom <= wrap.bottom + 1
        && box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.top >= rect.top - 1 && box.bottom <= rect.bottom + 1
        && badge.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }),
    lists: [...root.querySelectorAll('.bg3-video-hud-items')].map(list => {
      const box = list.getBoundingClientRect(), first = list.querySelector('button')?.getBoundingClientRect();
      const style = getComputedStyle(list), columns = style.gridTemplateColumns.split(' ').map(parseFloat).filter(Number.isFinite);
      const tail = list.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
        - columns.reduce((sum, n) => sum + n, 0) - Math.max(0, columns.length - 1) * (parseFloat(style.columnGap) || 0);
      return { height: box.height, left: box.left, right: box.right, tail,
        twoRowsFit: list.clientHeight + 1 >= (first?.height ?? Math.min(list.clientWidth, cell.height)) * 2 + parseFloat(getComputedStyle(list).rowGap),
        square: [...list.querySelectorAll('.bg3-video-hud-use')].every(button => {
          const r = button.getBoundingClientRect(); return Math.abs(r.width - r.height) < 0.6;
        }),
        firstFits: !first || (first.top >= box.top - 1 && first.bottom <= box.bottom + 1 && first.right <= box.right + 1) };
    }),
    controlsFit: [...root.querySelectorAll('.bg3-video-hud-controls button, .bg3-video-hud-end button, footer button')].every(button => {
      const b = button.getBoundingClientRect();
      if (!b.width || !b.height) return true;
      return b.left >= rect.left && b.right <= rect.right && b.top >= rect.top && b.bottom <= rect.bottom;
    }) };
}
