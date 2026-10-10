<script lang="ts">
    import { tick } from 'svelte';
    import { setIcon } from 'obsidian';
    import type { DesignService } from '../service';
    import { parseTodo, toggleTodo, editTodo, insertTodo, removeTodo, moveTodo } from '../todo';
    import { canvasScroll } from '../canvas-scroll';
    export let service: DesignService;
    export let text = '', title = '', readOnly = false, interacting = true, compact = false, zoom = 1;
    export let onChange: (text: string) => void;
    export let onTitle: (title: string) => void;
    let root: HTMLDivElement, addition: HTMLTextAreaElement;
    let edit: { index: number; value: string; base: string } | undefined;
    let adding = false, at = 0, draft = '', addBase = '', error = '';
    const word = (ru: string, en: string) => service.plugin.settings.language === 'ru' ? ru : en;
    const icon = (node: HTMLElement, name: string) => { setIcon(node, name); };
    $: lines = parseTodo(text);
    $: done = lines.filter(line => line.done).length;
    $: detailed = !compact || Boolean(edit) || adding;
    function source() {
        if (!edit) return text;
        if (edit.base !== text) { error = word('Список изменился. Скопируй введённый текст или нажми Escape и попробуй снова.', 'The list changed. Copy your draft or press Escape and try again.'); return undefined; }
        return editTodo(text, edit.index, edit.value);
    }
    function apply(change: (source: string) => string) {
        if (readOnly || !interacting) return false;
        const value = source(); if (value === undefined) return false;
        const next = change(value); edit = undefined; error = '';
        if (next !== text) onChange(next);
        return true;
    }
    async function focusRow(index: number) { await tick(); root?.querySelector<HTMLInputElement>(`[data-todo-row="${index}"] input[type="text"]`)?.focus(); }
    async function startAdd(index: number) {
        if (!apply(value => value)) return;
        await tick(); adding = true; at = Math.min(index, lines.length); draft = ''; addBase = text;
        await tick(); addition?.focus();
    }
    async function add(again = false) {
        if (readOnly || !interacting || !adding || !draft.trim()) return;
        if (addBase !== text) { error = word('Список изменился. Скопируй новое дело и добавь его снова.', 'The list changed. Copy your new task and add it again.'); return; }
        const count = parseTodo(draft).length, next = insertTodo(text, at, draft);
        adding = false; draft = ''; error = ''; if (next !== text) onChange(next);
        if (again) { await tick(); await startAdd(at + count); }
    }
    function rowKey(event: KeyboardEvent, index: number) {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); edit = undefined; error = ''; (event.currentTarget as HTMLInputElement).value = lines[index]?.text || ''; (event.currentTarget as HTMLInputElement).blur(); }
        else if (event.key === 'Enter') { event.preventDefault(); void startAdd(index + 1); }
        else if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const offset = event.key === 'ArrowUp' ? -1 : 1; if (apply(value => moveTodo(value, index, offset))) void focusRow(Math.max(0, Math.min(lines.length - 1, index + offset))); }
        else if (event.key === 'Backspace' && !(event.currentTarget as HTMLInputElement).value) { event.preventDefault(); if (apply(value => removeTodo(value, index))) void focusRow(Math.max(0, index - 1)); }
    }
    function retainFocus(event: PointerEvent) { if (event.pointerType !== 'touch') event.preventDefault(); }
</script>

<div bind:this={root} class="canvas-todo" class:design-widget-passive={!interacting} use:canvasScroll={{ enabled: interacting, zoom }}>
    <div class="design-widget-heading" title={word('Перетащи заголовок, чтобы переместить список', 'Drag the header to move the list')}>
        <span class="design-widget-grip" use:icon={'grip-vertical'}></span>
        <input class="canvas-todo-title" aria-label={word('Название списка дел', 'To-do list title')} placeholder={service.tr('design_todo')} value={title} disabled={readOnly} on:blur={event => { if (!readOnly && event.currentTarget.value !== title) onTitle(event.currentTarget.value); }} on:keydown={event => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = title; event.currentTarget.blur(); } }} />
        <small>{done}/{lines.length}</small>
    </div>
    {#if !detailed}<div class="design-widget-summary">{lines.slice(0, 3).map(line => `${line.done ? '✓' : '□'} ${line.text}`).join('\n')}</div>
    {:else}
        <div class="canvas-todo-scroll design-widget-body" data-canvas-interactive>
            {#each [...lines, undefined] as line, index}
                {#if adding && at === index}<div class="canvas-todo-add"><textarea bind:this={addition} bind:value={draft} aria-label={word('Новое дело', 'New task')} placeholder={word('Напиши дело…', 'Write a task…')} rows="2" on:keydown={event => { event.stopPropagation(); if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void add(true); } if (event.key === 'Escape') { adding = false; draft = ''; error = ''; } }}></textarea><button disabled={readOnly || !draft.trim()} on:click={() => void add()}>{service.tr('save')}</button><button on:click={() => { adding = false; draft = ''; error = ''; }}>{service.tr('cancel')}</button></div>{/if}
                {#if line}<div class="design-todo-line" data-todo-row={index} class:is-done={line.done}>
                    <input type="checkbox" checked={line.done} disabled={readOnly} aria-label={`${word('Выполнено', 'Completed')}: ${line.text}`} on:change={() => apply(value => toggleTodo(value, index))} />
                    <input class="canvas-todo-text" type="text" value={line.text} aria-label={`${word('Дело', 'Task')} ${index + 1}`} disabled={readOnly} on:focus={() => { edit = { index, value: line.text, base: text }; error = ''; }} on:input={event => { if (edit?.index === index) edit.value = event.currentTarget.value; }} on:blur={event => { if (edit?.index === index && apply(value => value)) event.currentTarget.value = parseTodo(text)[index]?.text || line.text; }} on:keydown={event => rowKey(event, index)} />
                    {#if !readOnly}<div class="canvas-todo-row-actions"><button disabled={index === 0} aria-label={word('Переместить дело выше', 'Move task up')} on:pointerdown={retainFocus} on:click={() => { if (apply(value => moveTodo(value, index, -1))) void focusRow(index - 1); }}>↑</button><button disabled={index === lines.length - 1} aria-label={word('Переместить дело ниже', 'Move task down')} on:pointerdown={retainFocus} on:click={() => { if (apply(value => moveTodo(value, index, 1))) void focusRow(index + 1); }}>↓</button><button aria-label={word('Удалить дело', 'Delete task')} on:pointerdown={retainFocus} on:click={() => apply(value => removeTodo(value, index))}><span use:icon={'x'}></span></button></div>{/if}
                </div>{/if}
            {/each}
            {#if !lines.length && !adding}<small class="design-widget-empty">{service.tr('design_todo_empty')}</small>{/if}
        </div>
        {#if error}<small class="design-warning" role="alert">{error}</small>{/if}
        {#if !readOnly}<button class="canvas-todo-add-button design-widget-body" on:pointerdown={retainFocus} on:click={() => void startAdd(lines.length)}>+ {word('Добавить дело', 'Add task')}</button>{/if}
    {/if}
</div>
