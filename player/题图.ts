/** 讲解模式题图：适应画面，滚轮/双指缩放，拖动平移。 */
export function imageStage(box: HTMLElement, changed: (src: string) => void) {
  const img = box.querySelector<HTMLImageElement>('img')!, empty = box.querySelector<HTMLElement>('.image-empty')!;
  const file = box.querySelector<HTMLInputElement>('input')!, reset = box.querySelector<HTMLButtonElement>('button')!;
  let scale = 1, x = 0, y = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  const paint = () => { img.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };
  const zoom = (factor: number) => { scale = Math.max(1, Math.min(8, scale * factor)); if (scale === 1) x = y = 0; paint(); };
  function show(src?: string) {
    img.hidden = !src; empty.hidden = !!src; reset.hidden = !src;
    if (src) img.src = src; else img.removeAttribute('src');
    scale = 1; x = y = 0; pointers.clear(); paint();
  }
  function read(f?: File) {
    if (!f?.type.startsWith('image/')) return;
    const r = new FileReader(); r.onload = () => { const src = String(r.result); show(src); changed(src); }; r.readAsDataURL(f);
  }
  file.onchange = () => { read(file.files?.[0]); file.value = ''; };
  reset.onclick = () => { scale = 1; x = y = 0; paint(); };
  box.addEventListener('wheel', (e) => { if (img.hidden) return; e.preventDefault(); zoom(Math.exp(-e.deltaY * .002)); }, { passive: false });
  box.addEventListener('pointerdown', (e) => { if (img.hidden || (e.target as Element).closest('button')) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', (e) => {
    const old = pointers.get(e.pointerId); if (!old) return;
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (other) { const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y); if (before > 0) zoom(after / before); }
    else if (scale > 1) { x += e.clientX - old.x; y += e.clientY - old.y; paint(); }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) box.addEventListener(event, (e) => pointers.delete((e as PointerEvent).pointerId));
  addEventListener('paste', (e) => {
    if (box.hidden || !document.body.classList.contains('nosim') || !document.getElementById('pasteBox')!.hidden) return;
    const f = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (f) { e.preventDefault(); read(f); }
  });
  return { show };
}
