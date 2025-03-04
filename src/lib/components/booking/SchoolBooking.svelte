<script lang="ts">
	interface Experience {
		id: string;
		type: 'school';
		name: string;
	}

	let { experience } = $props<{ experience: Experience }>();
</script>

<h2>{experience.name}</h2>
