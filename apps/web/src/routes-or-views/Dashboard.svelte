<script lang="ts">
  import { onMount } from 'svelte';
  import { Bell, Settings, Wifi, WifiOff, ChevronLeft, ChevronRight, Images } from '@lucide/svelte';
  import ClockCard from '../components/ClockCard.svelte';
  import WeatherCard from '../components/WeatherCard.svelte';
  import EventsCard from '../components/EventsCard.svelte';
  import SettingsPanel from '../components/SettingsPanel.svelte';
  import { connection } from '../stores/connection.svelte';
  import { loadCalendarEvents, loadDashboardStatus, loadSlideshowPhotos, loadWeatherSnapshot, type CalendarEventsSnapshot, type DashboardStatus, type SlideshowPhoto, type WeatherSnapshot } from '../services/dashboard';

  const effectiveTypeLabels: Record<string, string> = { 'slow-2g': 'Slow 2G', '2g': '2G', '3g': '3G', '4g': '4G class' };

  let { settingsOpen = $bindable(false) }: { settingsOpen: boolean } = $props();
  let status = $state<DashboardStatus>({ weather: 'not-configured', calendar: 'not-configured', photos: 'not-configured' });
  let weather = $state<WeatherSnapshot>({
    state: 'not-configured', location: null, temperatureUnit: 'celsius', timezone: null,
    current: null, hourly: [], updatedAt: null,
  });
  let calendarEvents = $state<CalendarEventsSnapshot>({ state: 'not-configured', events: [], lastSyncedAt: null });
  let photos = $state<SlideshowPhoto[]>([]);
  let photoIndex = $state(0);
  let currentPhoto = $derived(photos[photoIndex]);
  let connectionInfoOpen = $state(false);

  const connectionHealthy = $derived(connection.online && connection.serverReachable !== false);
  const connectionLabel = $derived(!connection.online ? 'Offline' : connection.serverReachable === false ? 'Unreachable' : 'Local');

  onMount(() => {
    connection.start();
    return () => connection.stop();
  });

  // Close the connection popover on Escape or clicks outside of it.
  $effect(() => {
    if (!connectionInfoOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') connectionInfoOpen = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.connection-wrap')) connectionInfoOpen = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  });

  onMount(() => {
    const refreshPhotos = async () => {
      const next = await loadSlideshowPhotos().catch(() => ({ photos, refreshedAt: null }));
      photos = next.photos;
      if (photoIndex >= photos.length) photoIndex = 0;
    };
    const refresh = async () => {
      const [nextStatus, nextWeather, nextCalendar] = await Promise.all([
        loadDashboardStatus(),
        loadWeatherSnapshot(),
        loadCalendarEvents().catch(() => calendarEvents),
      ]);
      status = nextStatus;
      weather = nextWeather;
      calendarEvents = nextCalendar;
      await refreshPhotos();
    };
    const params = new URLSearchParams(window.location.search);
    if (params.has('calendar')) {
      settingsOpen = true;
      window.history.replaceState({}, '', window.location.pathname);
    }
    void refresh();
    window.addEventListener('immich-updated', refreshPhotos);
    const timer = window.setInterval(() => { void refresh(); }, 5 * 60 * 1000);
    return () => { window.clearInterval(timer); window.removeEventListener('immich-updated', refreshPhotos); };
  });

  function movePhoto(direction: number) {
    if (photos.length < 2) return;
    photoIndex = (photoIndex + direction + photos.length) % photos.length;
  }

  $effect(() => {
    if (photos.length < 2) return;
    const timer = window.setInterval(() => movePhoto(1), 10_000);
    return () => window.clearInterval(timer);
  });
</script>

<main class="dashboard-shell">
  <div class="backdrop"></div>
  <header class="topbar">
    <a class="brand" href="/" aria-label="TECHSHAN-HOME dashboard"><span class="brand-mark"><img src="/logo.png" alt="" /></span><span>TECHSHAN-HOME</span></a>
    <div class="top-actions">
      <button class="icon-button notification-button" aria-label="Notifications" disabled title="Notifications are not available yet"><Bell size={19} /><i></i></button>
      <div class="connection-wrap">
        <button
          class="connection-pill"
          class:offline={!connectionHealthy}
          onclick={() => (connectionInfoOpen = !connectionInfoOpen)}
          aria-expanded={connectionInfoOpen}
          aria-haspopup="dialog"
          title="Connection status"
        >
          {#if connectionHealthy}<Wifi size={18} />{:else}<WifiOff size={18} />{/if}
          <span>{connectionLabel}</span>
        </button>
        {#if connectionInfoOpen}
          <div class="connection-popover glass-card" role="dialog" aria-label="Connection details">
            <strong>Connection</strong>
            <ul>
              <li><span>Device network</span><b>{connection.online ? 'Connected' : 'Offline'}</b></li>
              <li><span>Dashboard server</span><b>{connection.serverReachable === null ? 'Checking…' : connection.serverReachable ? 'Reachable' : 'Unreachable'}</b></li>
              <li><span>Connection class</span><b>{connection.effectiveType ? effectiveTypeLabels[connection.effectiveType] : 'Not reported'}</b></li>
              <li><span>Downlink estimate</span><b>{connection.downlink !== null ? `${connection.downlink} Mbps` : 'Not reported'}</b></li>
              <li><span>Latency estimate</span><b>{connection.rtt !== null ? `${connection.rtt} ms` : 'Not reported'}</b></li>
              {#if connection.networkInfoAvailable}<li><span>Data saver</span><b>{connection.saveData ? 'On' : 'Off'}</b></li>{/if}
            </ul>
            <button class="connection-refresh" onclick={() => connection.probeServer()}>Check again</button>
          </div>
        {/if}
      </div>
      <button class="icon-button" onclick={() => (settingsOpen = true)} aria-label="Open settings"><Settings size={20} /></button>
    </div>
  </header>

  <div class="dashboard-grid">
    <aside class="left-rail">
      <ClockCard />
      <WeatherCard state={status.weather} {weather} />
      <EventsCard state={status.calendar} events={calendarEvents.events} onOpenSettings={() => (settingsOpen = true)} />
    </aside>

    <section class="photo-stage" aria-label="Immich photo slideshow">
      {#if currentPhoto}<img class="photo-image" src={`/api/v1/photos/${encodeURIComponent(currentPhoto.id)}/image`} alt={currentPhoto.fileName} />{/if}
      <div class="photo-shade"></div>
      <button class="photo-nav photo-prev" aria-label="Previous photo" onclick={() => movePhoto(-1)} disabled={photos.length < 2}><ChevronLeft size={23} /></button>
      <button class="photo-nav photo-next" aria-label="Next photo" onclick={() => movePhoto(1)} disabled={photos.length < 2}><ChevronRight size={23} /></button>
      <div class="photo-caption"><span class="photo-caption-mark"><Images size={16} /></span><span><strong>{currentPhoto ? 'Immich' : 'Your photos'}</strong><small>{currentPhoto ? `${currentPhoto.albumName} · ${photoIndex + 1} of ${photos.length}` : status.photos === 'connected' ? 'Select an album in Settings' : 'Connect Immich to get started'}</small></span></div>
      {#if photos.length > 1}<div class="slide-indicator" aria-label={`Photo ${photoIndex + 1} of ${photos.length}`}><span class="active-dot"></span></div>{/if}
    </section>

    <footer class="dashboard-footer">
      <div class="welcome-copy"><span class="eyebrow">A LITTLE MORE AT HOME</span><strong>A calm place to land.</strong></div>
      <div class="service-chips"><span class="service-chip"><span class="status-dot"></span>Private by design</span><span class="service-chip">One shared dashboard</span></div>
    </footer>
  </div>
  <SettingsPanel bind:open={settingsOpen} bind:status bind:weather />
</main>
