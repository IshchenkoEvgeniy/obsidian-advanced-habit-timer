import type { BoardItem } from './types';
export function shapePath(shape: BoardItem['shape']): string {
    switch (shape) {
        case 'ellipse': return 'M 50 1 A 49 49 0 1 0 50 99 A 49 49 0 1 0 50 1';
        case 'diamond': return 'M50 1 L99 50 L50 99 L1 50 Z';
        case 'triangle': return 'M50 1 L99 99 L1 99 Z';
        case 'hexagon': return 'M25 1 L75 1 L99 50 L75 99 L25 99 L1 50 Z';
        case 'star': return 'M50 1 L61 35 L98 35 L68 57 L79 94 L50 72 L21 94 L32 57 L2 35 L39 35 Z';
        case 'arrow': return 'M1 30 L60 30 L60 1 L99 50 L60 99 L60 70 L1 70 Z';
        case 'cloud': return 'M20 80 C-10 80 -5 40 18 40 C10 10 50 0 63 25 C90 5 110 45 87 58 C115 85 65 110 50 85 C37 102 15 102 20 80 Z';
        case 'cylinder': return 'M1 18 C1 -4 99 -4 99 18 L99 82 C99 104 1 104 1 82 Z M1 18 C1 40 99 40 99 18';
        case 'round': return 'M12 1 H88 Q99 1 99 12 V88 Q99 99 88 99 H12 Q1 99 1 88 V12 Q1 1 12 1 Z';
        // Flowchart shapes: terminator (pill), data (parallelogram), document, predefined process.
        case 'pill': return 'M20 1 H80 A19 49 0 0 1 80 99 H20 A19 49 0 0 1 20 1 Z';
        case 'parallelogram': return 'M20 1 H99 L80 99 H1 Z';
        case 'document': return 'M1 1 H99 V80 Q75 100 50 80 Q25 60 1 80 Z';
        case 'predefined': return 'M1 1 H99 V99 H1 Z M14 1 V99 M86 1 V99';
        default: return 'M1 1 H99 V99 H1 Z';
    }
}
export function dashArray(dash?: string, width = 2): string | undefined { return dash === 'dash' ? `${width * 4} ${width * 3}` : dash === 'dot' ? `${width} ${width * 2}` : undefined; }
