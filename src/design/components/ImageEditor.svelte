<script lang="ts">
    import { clone, type BoardItem, type SketchStroke } from '../types';
    import { imageMarkPath, imageStrokeHit } from '../image-marks';
    import type { DesignService } from '../service';
    export let service: DesignService;
    export let item: BoardItem;
    export let onSave: (values: Partial<BoardItem>) => void;
    export let onClose: () => void;
    const tr = service.tr.bind(service);
    let mode: 'crop' | 'draw' | 'erase' = 'crop', color = '#ef4444', width = 5;
    let crop = clone(item.crop || { x: 0, y: 0, w: 1, h: 1 }), marks = clone(item.imageStrokes || []);
    let stage: HTMLDivElement, ratio = item.w / item.h;
    let ready = false, loadError = false;
    let stroke: SketchStroke | undefined;
    let drag: { pointer: number; point: { x: number; y: number }; crop: typeof crop; handle: string; marks?: SketchStroke[] } | undefined;
    const bounded = (value: number) => Math.max(0, Math.min(1, value));
    function point(event: PointerEvent) { const rect = stage.getBoundingClientRect(); return { x: bounded((event.clientX - rect.left) / rect.width), y: bounded((event.clientY - rect.top) / rect.height) }; }
    function down(event: PointerEvent) {
        if (event.button !== 0 || !ready) return;
        event.preventDefault(); stage.setPointerCapture(event.pointerId);
        const p = point(event), handle = (event.target as HTMLElement).closest('[data-crop-handle]')?.getAttribute('data-crop-handle') || '';
        drag = { pointer: event.pointerId, point: p, crop: clone(crop), handle };
        if (mode === 'draw') stroke = { points: [[p.x, p.y]], width: width / stage.getBoundingClientRect().width, color };
        else if (mode === 'erase') { drag.marks = clone(marks); erase(p); }
        else if (!handle) { crop = { x: Math.min(.98, p.x), y: Math.min(.98, p.y), w: .02, h: .02 }; drag.handle = 'new'; }
    }
    function erase(p: { x: number; y: number }) { const rect = stage.getBoundingClientRect(); marks = marks.filter(mark => !imageStrokeHit(mark, p, rect.width, rect.height)); }
    function move(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointer) return;
        const p = point(event);
        if (mode === 'draw' && stroke) { stroke = { ...stroke, points: [...stroke.points, [p.x, p.y]] }; return; }
        if (mode === 'erase') { erase(p); return; }
        const before = drag.crop, dx = p.x - drag.point.x, dy = p.y - drag.point.y;
        if (drag.handle === 'move') { crop = { ...before, x: Math.max(0, Math.min(1 - before.w, before.x + dx)), y: Math.max(0, Math.min(1 - before.h, before.y + dy)) }; return; }
        if (drag.handle === 'new') { const x = Math.min(p.x, drag.point.x, .98), y = Math.min(p.y, drag.point.y, .98); crop = { x, y, w: Math.min(1 - x, Math.max(.02, Math.abs(p.x - drag.point.x))), h: Math.min(1 - y, Math.max(.02, Math.abs(p.y - drag.point.y))) }; return; }
        let left = before.x, top = before.y, right = before.x + before.w, bottom = before.y + before.h;
        if (drag.handle.includes('w')) left = Math.min(right - .02, Math.max(0, before.x + dx));
        if (drag.handle.includes('e')) right = Math.max(left + .02, Math.min(1, before.x + before.w + dx));
        if (drag.handle.includes('n')) top = Math.min(bottom - .02, Math.max(0, before.y + dy));
        if (drag.handle.includes('s')) bottom = Math.max(top + .02, Math.min(1, before.y + before.h + dy));
        crop = { x: left, y: top, w: right - left, h: bottom - top };
    }
    function up(event: PointerEvent) { if (!drag || event.pointerId !== drag.pointer) return; if (stroke) { if (stroke.points.length === 1) stroke.points.push([...stroke.points[0]!] as [number, number]); marks = [...marks, stroke]; } drag = undefined; stroke = undefined; }
    function cancel() { if (drag && mode === 'crop') crop = drag.crop; if (drag?.marks) marks = drag.marks; drag = undefined; stroke = undefined; }
    function loaded(event: Event) { const image = event.currentTarget as HTMLImageElement; if (image.naturalWidth && image.naturalHeight) { ratio = image.naturalWidth / image.naturalHeight; ready = true; } }
    function save() { onSave({ crop, imageStrokes: marks, h: Math.max(1, item.w * crop.h / crop.w / ratio) }); }
</script>

<div class="design-image-editor">
    <div class="design-image-editor-heading"><div><h2>{tr('design_image_edit')}</h2><p>{tr('design_image_edit_hint')}</p></div><button class="design-icon-button" on:click={onClose} aria-label={tr('cancel')}>×</button></div>
    <div class="design-image-editor-tools"><button class:mod-cta={mode === 'crop'} on:click={() => mode = 'crop'}>{tr('design_crop')}</button><button class:mod-cta={mode === 'draw'} on:click={() => mode = 'draw'}>{tr('design_draw_on_image')}</button><button class:mod-cta={mode === 'erase'} on:click={() => mode = 'erase'}>{tr('design_eraser')}</button><input type="color" aria-label={tr('design_color')} bind:value={color} /><input type="range" min="1" max="16" aria-label={tr('design_draw_width')} bind:value={width} /><button disabled={!marks.length} on:click={() => marks = marks.slice(0, -1)}>{tr('design_undo')}</button><button on:click={() => crop = { x: 0, y: 0, w: 1, h: 1 }}>{tr('design_reset_crop')}</button></div>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Image editing surface with pointer capture.) -->
    <div bind:this={stage} class="design-image-stage" class:is-drawing={mode !== 'crop'} role="img" aria-label={tr('design_image_edit')} style:aspect-ratio={ratio} style:max-width={`${Math.max(180, Math.min(1000, (window.innerHeight - 250) * ratio))}px`} on:pointerdown={down} on:pointermove={move} on:pointerup={up} on:pointercancel={cancel}>
        <img draggable="false" src={service.image(item.path || '')} alt={item.text || ''} on:load={loaded} on:error={() => loadError = true} />
        <svg viewBox={`0 0 1000 ${1000 / ratio}`} preserveAspectRatio="none" aria-hidden="true">{#each [...marks, ...(stroke ? [stroke] : [])] as mark}<path d={imageMarkPath(mark, 1000, 1000 / ratio)} fill="none" stroke={mark.color || '#ef4444'} stroke-width={mark.width * 1000} stroke-linecap="round" stroke-linejoin="round" />{/each}</svg>
        {#if mode === 'crop'}<div class="design-crop-box" data-crop-handle="move" style:left={`${crop.x * 100}%`} style:top={`${crop.y * 100}%`} style:width={`${crop.w * 100}%`} style:height={`${crop.h * 100}%`}>{#each ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as handle}<span data-crop-handle={handle} class="design-crop-handle" style:left={handle.includes('w') ? '0' : handle.includes('e') ? 'calc(100% - 10px)' : 'calc(50% - 5px)'} style:top={handle.includes('n') ? '0' : handle.includes('s') ? 'calc(100% - 10px)' : 'calc(50% - 5px)'}></span>{/each}</div>{/if}
    </div>
    {#if loadError}<p>{tr('design_no_image')}</p>{/if}
    <div class="design-image-editor-footer"><button on:click={onClose}>{tr('cancel')}</button><button class="mod-cta" disabled={!ready} on:click={save}>{tr('save')}</button></div>
</div>
