<script lang="ts">
    import { moment } from 'obsidian';
    
    export let records: { date: string, value: number, isMet?: boolean }[] = [];
    export let days: number = 90;
    export let cellSize: 's' | 'm' | 'l' = 'm';
    export let groupByMonth: boolean = true;
    export let formatValue: ((v: number) => string) | null = null;
    export let onBoxClick: ((date: string) => void) | null = null;
    
    // Labels for the rows
    export let dayLabels = ['Mon', 'Wed', 'Fri', 'Sun'];
    
    $: numWeeks = Math.ceil(days / 7);
    $: startDate = moment().startOf('week').subtract(numWeeks - 1, 'weeks');
    $: endDate = moment().endOf('week');
    
    $: weeks = (() => {
        const gridDates: string[] = [];
        let curr = moment(startDate);
        while (curr.isSameOrBefore(endDate, 'day')) {
            gridDates.push(curr.format('YYYY-MM-DD'));
            curr.add(1, 'days');
        }
        
        const wks: string[][] = [];
        for (let i = 0; i < gridDates.length; i += 7) {
            wks.push(gridDates.slice(i, i + 7));
        }
        while (wks.length > numWeeks + 1) wks.shift();
        return wks;
    })();
    
    $: maxVal = Math.max(...records.map(r => r.value), 0.1);
    
    function getBoxInfo(date: string) {
        const rec = records.find(r => r.date === date);
        const val = rec ? rec.value : 0;
        const isMet = rec ? !!rec.isMet : false;
        
        let lvl = 0;
        let cls = '';
        
        if (val > 0 || rec) {
            const ratio = Math.min(val / maxVal, 1);
            lvl = 1;
            if (ratio > 0.75) lvl = 4;
            else if (ratio > 0.5) lvl = 3;
            else if (ratio > 0.25) lvl = 2;
            
            if (isMet) cls = `lvl-${lvl}-success`;
            else cls = `lvl-${lvl}-fail`;
        }
        
        const title = date + (formatValue ? `: ${formatValue(val)}` : `: ${val}`);
        
        return { val, cls, title };
    }
    
    let lastMonth = "";
    function getMonthLabel(weekDates: string[], weekIdx: number) {
        const firstDayOfMonth = weekDates.find(d => moment(d).date() === 1 || (weekIdx === 0 && moment(d).date() <= 7));
        if (firstDayOfMonth) {
            const m = moment(firstDayOfMonth).format('MMM');
            if (m !== lastMonth) {
                lastMonth = m;
                return { text: m, showMargin: groupByMonth && lastMonth !== "" };
            }
        }
        return { text: "", showMargin: false };
    }
    
    // Reset lastMonth before render
    $: lastMonth = "";
</script>

<div class="unified-heatmap-container size-{cellSize}">
    <div class="unified-heatmap-scroll">
        <div class="heatmap-labels-col">
            <div class="heatmap-label-empty"></div>
            {#each dayLabels as lbl}
                <div class="heatmap-day-label">{lbl}</div>
            {/each}
        </div>
        
        <div class="unified-heatmap-grid-github">
            {#each weeks as weekDates, weekIdx}
                {@const mInfo = getMonthLabel(weekDates, weekIdx)}
                <div class="heatmap-week-col">
                    {#if mInfo.text}
                        <div class="heatmap-month-label" style="{mInfo.showMargin ? 'margin-left:8px;' : ''}">{mInfo.text}</div>
                    {:else}
                        <div class="heatmap-month-label empty"></div>
                    {/if}
                    
                    {#each weekDates as d}
                        {@const info = getBoxInfo(d)}
                        <div 
                            class="heatmap-box {info.cls}" 
                            title={info.title}
                            role="button"
                            tabindex="0"
                            on:click={() => onBoxClick && onBoxClick(d)}
                            on:keydown={(e) => e.key === 'Enter' && onBoxClick && onBoxClick(d)}
                        ></div>
                    {/each}
                </div>
            {/each}
        </div>
    </div>
</div>
