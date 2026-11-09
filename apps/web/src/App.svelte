<script lang="ts">
  import Dashboard from './routes-or-views/Dashboard.svelte';

  let settingsOpen = $state(false);
</script>

<Dashboard bind:settingsOpen />
