<script lang="ts">
	import { Command as CommandPrimitive } from 'cmdk-sv';
	import { cn } from '$lib/utils.js';
	import type { ClassValue } from 'clsx';

	type $$Props = Omit<CommandPrimitive.EmptyProps, 'class'> & {
		class?: ClassValue | null | undefined;
	};
	let className: ClassValue | null | undefined = undefined;
	export { className as class };
</script>

<CommandPrimitive.Empty class={cn('py-6 text-center text-sm', className)} {...$$restProps}>
	<slot />
</CommandPrimitive.Empty>
