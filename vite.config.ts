import { paraglide } from '@inlang/paraglide-sveltekit/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		paraglide({
			project: './project.inlang',
			outdir: './src/lib/paraglide'
		})
	],
	optimizeDeps: {
		include: ['@lucide/svelte'],
		exclude: []
	},
	resolve: {
		dedupe: ['@lucide/svelte']
	},
	ssr: {
		noExternal: ['@lucide/svelte']
	}
});
