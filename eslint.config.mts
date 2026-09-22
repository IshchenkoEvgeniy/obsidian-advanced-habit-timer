import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				project: './tsconfig.eslint.json',
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"lint-errors.json",
		"build_errors.txt",
		"cloudflare-companion/dist",
	]),
	{
		plugins: {
			obsidianmd,
		},
		rules: {
			"obsidianmd/ui/sentence-case": "warn",
		},
	},
	// Node-скрипты (Playwright-проверки, импорт-скрипты): среда выполнения — Node.js.
	{
		files: ["scripts/**/*.mjs", "cloudflare-companion/scripts/**/*.mjs"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	// cloudflare-companion — отдельное Cloudflare Workers-приложение (D1):
	// fetch и др. глобалы — штатные API среды, Obsidian API там недоступен.
	{
		files: ["cloudflare-companion/**"],
		rules: {
			"no-restricted-globals": "off",
		},
	},
	// Тесты гоняются в Node (vitest, environment: node) и легитимно используют
	// node:sqlite / node:zlib / Buffer для проверки Node-стороны companion.
	{
		files: ["tests/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			"import/no-nodejs-modules": "off",
		},
	},
	// companion типизируется собственным tsconfig (Workers-среда: lib WebWorker).
	{
		files: ["cloudflare-companion/src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				project: ['./cloudflare-companion/tsconfig.json'],
			},
		},
	},
);
