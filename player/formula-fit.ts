/** 宽式子先缩到 80%，仍放不下则保留水平滚动和右侧渐隐提示。 */
export function fitFormulas(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.katex-display').forEach((display) => {
    const formula = display.querySelector<HTMLElement>(':scope > .katex');
    if (!formula || display.offsetParent === null) return;
    formula.style.fontSize = '';
    const base = parseFloat(getComputedStyle(formula).fontSize), available = display.clientWidth;
    if (!available) return;
    const natural = Math.max(formula.scrollWidth, formula.getBoundingClientRect().width), ratio = Math.max(.8, Math.min(1, available / Math.max(1, natural)));
    formula.style.fontSize = `${base * ratio}px`;
    display.dataset.scale = String(ratio);
    display.classList.toggle('formula-overflow', display.scrollWidth > display.clientWidth + 1);
    const edge = () => display.classList.toggle('formula-at-end', display.scrollLeft + display.clientWidth >= display.scrollWidth - 1);
    display.onscroll = edge; edge();
  });
}
