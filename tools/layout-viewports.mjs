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
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
    height: rect.height, width: rect.width, clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
    font: parseFloat(css.fontSize), gap: parseFloat(css.rowGap), cell: cell.height,
    portrait: root.querySelector('.bg3-video-hud-portrait').getBoundingClientRect().height,
    dpr: window.devicePixelRatio,
    lists: [...root.querySelectorAll('.bg3-video-hud-items')].map(list => {
      const box = list.getBoundingClientRect(), first = list.querySelector('button')?.getBoundingClientRect();
      return { height: box.height, left: box.left, right: box.right,
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
