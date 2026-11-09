<script lang="ts">
  import { onMount } from 'svelte';

  let clock = $state('');
  let date = $state('');

  function update() {
    const now = new Date();
    clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now);
    date = new Intl.DateTimeFormat(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(now);
  }

  onMount(() => {
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  });
</script>

<section class="glass-card clock-card" aria-label="Current time and date">
  <p class="date-line">{date}</p>
  <div class="clock-line"><span>{clock}</span></div>
</section>
