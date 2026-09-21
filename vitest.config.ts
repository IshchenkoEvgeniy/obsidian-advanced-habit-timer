import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Use node environment — no DOM needed for pure logic tests
        environment: 'node',
        // Resolve 'obsidian' to our manual mock so we don't need the real package
        alias: {
            obsidian: new URL('./tests/__mocks__/obsidian.ts', import.meta.url).pathname,
        },
        // Include only files inside tests/
        include: ['tests/**/*.test.ts'],
        // TypeScript via built-in esbuild transformer — no separate config needed
    },
});
