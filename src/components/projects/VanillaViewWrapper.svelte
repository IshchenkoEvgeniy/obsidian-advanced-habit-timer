<script lang="ts">
    import { onDestroy } from 'svelte';
    import type { ProjectScopeDefinition } from '../../projects/types';
    import type { ProjectSubView, ViewContext } from '../../projects/views/base-view';

    export let subView: ProjectSubView & { destroy?: () => void };
    export let scope: ProjectScopeDefinition;
    export let ctx: ViewContext;

    let container: HTMLElement;

    $: if (container && subView && scope && ctx) {
        void subView.render(container, scope, ctx);
    }

    onDestroy(() => subView?.destroy?.());
</script>

<div bind:this={container} class="vanilla-view-container"></div>

<style>
    .vanilla-view-container { height:100%; min-height:0; }
</style>
