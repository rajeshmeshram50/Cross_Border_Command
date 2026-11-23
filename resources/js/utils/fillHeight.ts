
export function fillHeight(el: HTMLElement, min = 0): number {
  const scroller = el.closest('.main-content') as HTMLElement | null;
  const rect = el.getBoundingClientRect();
  const top = scroller
    ? rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop
    : rect.top + (document.scrollingElement?.scrollTop ?? 0);
  const space = scroller ? scroller.clientHeight : window.innerHeight;
  const px = (v: string) => parseFloat(v) || 0;
  let below = 0;
  for (let node: HTMLElement | null = el; node && node !== scroller && node !== document.body; node = node.parentElement) {
    below += px(getComputedStyle(node).marginBottom);
    const parent = node.parentElement;
    const ps = parent ? getComputedStyle(parent) : null;
    const gap = ps && /flex|grid/.test(ps.display) ? px(ps.rowGap) : 0;
    for (let s = node.nextElementSibling as HTMLElement | null; s; s = s.nextElementSibling as HTMLElement | null) {
      const ss = getComputedStyle(s);
      if (ss.display === 'none' || ss.position === 'absolute' || ss.position === 'fixed') continue;
      below += s.offsetHeight + px(ss.marginTop) + px(ss.marginBottom) + gap;
    }
    if (parent && parent !== scroller && ps) below += px(ps.paddingBottom) + px(ps.borderBottomWidth);
  }
  if (!scroller) {
    const f = document.querySelector('footer.footer') as HTMLElement | null;
    below += f ? f.offsetHeight + 8 : 15;
  }
  return Math.max(min, Math.floor(space - top - below));
}
