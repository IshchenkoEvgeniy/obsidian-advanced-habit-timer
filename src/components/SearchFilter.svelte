<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { setIcon } from 'obsidian';
    import type { Action } from 'svelte/action';

    export interface FilterOption {
        value: string;
        label: string;
    }

    export let value: string;
    export let options: FilterOption[] = [];
    export let allLabel: string;
    export let ariaLabel: string;
    export let emptyLabel = 'Nothing found';

    let root: HTMLElement;
    let input: HTMLInputElement;
    let open = false;
    let query = '';

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    $: allOptions = [{ value: 'all', label: allLabel }, ...options];
    $: selectedLabel = allOptions.find(option => option.value === value)?.label || allLabel;
    $: visibleOptions = allOptions.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));

    onMount(() => {
        const closeOutside = (event: MouseEvent): void => {
            if (open && root && !root.contains(event.target as Node)) close();
        };
        document.addEventListener('mousedown', closeOutside);
        return () => document.removeEventListener('mousedown', closeOutside);
    });

    async function toggle(): Promise<void> {
        open = !open;
        if (!open) return;
        query = '';
        await tick();
        input?.focus();
    }

    function close(): void {
        open = false;
        query = '';
    }

    function select(option: FilterOption): void {
        value = option.value;
        close();
    }

    function handleInputKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        } else if (event.key === 'Enter' && visibleOptions[0]) {
            event.preventDefault();
            select(visibleOptions[0]);
        }
    }
</script>

<div class="search-filter" bind:this={root}>
    <button class="filter-trigger" type="button" aria-label={ariaLabel} aria-expanded={open} on:click={toggle}>
        <span class="selected-label">{selectedLabel}</span>
        <span class="chevron" use:icon={open ? 'chevron-up' : 'chevron-down'}></span>
    </button>

    {#if open}
        <div class="filter-popover">
            <div class="search-box">
                <span use:icon={'search'}></span>
                <input bind:this={input} bind:value={query} type="search" placeholder={ariaLabel} on:keydown={handleInputKeydown} />
            </div>
            <div class="option-list" role="listbox" aria-label={ariaLabel}>
                {#each visibleOptions as option (option.value)}
                    <button type="button" class:active={option.value === value} role="option" aria-selected={option.value === value} on:click={() => select(option)}>
                        <span>{option.label}</span>
                        {#if option.value === value}<span class="check" use:icon={'check'}></span>{/if}
                    </button>
                {:else}
                    <div class="empty-result">{emptyLabel}</div>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .search-filter { position:relative; flex:1 1 150px; min-width:130px; max-width:230px; }
    .filter-trigger { display:grid; grid-template-columns:minmax(0,1fr) 14px; align-items:center; gap:7px; width:100%; height:36px; padding:0 9px; border-radius:5px; text-align:left; }
    .chevron,.check { display:block; width:14px; height:14px; color:var(--text-muted); }
    .selected-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .filter-popover { position:absolute; top:calc(100% + 5px); left:0; z-index:50; width:max(100%,240px); padding:7px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-primary); box-shadow:0 8px 24px rgba(0,0,0,.28); }
    .search-box { display:grid; grid-template-columns:16px minmax(0,1fr); align-items:center; gap:6px; padding:0 8px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--background-modifier-form-field); }
    .search-box > span { display:block; width:15px; height:15px; color:var(--text-muted); }
    .search-box input { width:100%; height:34px; padding:0; border:0; box-shadow:none; background:transparent; }
    .option-list { max-height:260px; margin-top:6px; overflow-y:auto; }
    .option-list button { display:grid; grid-template-columns:minmax(0,1fr) 16px; align-items:center; gap:8px; width:100%; min-height:34px; padding:6px 8px; border:0; border-radius:4px; background:transparent; text-align:left; white-space:normal; }
    .option-list button:hover,.option-list button.active { background:var(--background-modifier-hover); color:var(--text-normal); }
    .option-list button span:first-child { overflow-wrap:anywhere; }
    .empty-result { padding:14px 8px; color:var(--text-muted); text-align:center; font-size:.8rem; }
    @media (max-width:600px) {
        .search-filter { max-width:none; }
        .filter-popover { position:fixed; top:auto; right:12px; bottom:12px; left:12px; width:auto; }
        .option-list { max-height:45vh; }
    }
</style>
