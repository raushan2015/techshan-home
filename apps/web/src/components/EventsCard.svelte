<script lang="ts">
  import { CalendarDays, ChevronRight, MapPin } from '@lucide/svelte';
  import type { CalendarEvent, IntegrationState } from '../services/dashboard';

  let { state, events, onOpenSettings }: { state: IntegrationState; events: CalendarEvent[]; onOpenSettings: () => void } = $props();

  function eventDay(value: string, allDay: boolean) {
    const date = new Date(allDay ? `${value}T00:00:00` : value);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (eventDate.getTime() === today.getTime()) return 'Today';
    if (eventDate.getTime() === tomorrow.getTime()) return 'Tomorrow';
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  }

  function eventTime(event: CalendarEvent) {
    if (event.allDay) return 'All day';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(event.start));
  }
</script>

<section class="glass-card events-card" aria-label="Upcoming calendar events">
  <header class="section-heading">
    <div class="heading-title"><CalendarDays size={22} /><h2>Upcoming events</h2></div>
    <button class="text-button" type="button" aria-label={state === 'connected' ? 'Manage connected calendars' : 'Connect Google Calendar'} onclick={onOpenSettings}>
      {state === 'connected' ? 'Manage' : 'Connect'} <ChevronRight size={15} />
    </button>
  </header>

  {#if events.length > 0}
    {#each events.slice(0, 3) as event, index (event.id)}
      <div class="event-row">
        <div class="event-time"><strong>{eventDay(event.start, event.allDay)}</strong><span>{eventTime(event)}</span></div>
        <div class={index % 2 ? 'event-marker marker-coral' : 'event-marker marker-blue'}></div>
        <div class="event-info"><strong>{event.summary}</strong><span>{event.calendarName}</span></div>
      </div>
    {/each}
  {:else if state === 'connected'}
    <div class="empty-events"><CalendarDays size={22} /><span>No upcoming events in the next two weeks.</span></div>
  {:else}
    <div class="event-row">
      <div class="event-time"><strong>Calendar</strong><span>—</span></div>
      <div class="event-marker marker-blue"></div>
      <div class="event-info">
        <strong>{state === 'unavailable' ? 'Calendar needs attention' : 'Calendar not connected'}</strong>
        <span><MapPin size={13} /> {state === 'unavailable' ? 'Reconnect Google Calendar in Settings' : 'Connect Google Calendar in Settings'}</span>
      </div>
    </div>
    <div class="event-row muted-row">
      <div class="event-time"><strong>Next</strong><span>—</span></div>
      <div class="event-marker marker-coral"></div>
      <div class="event-info"><strong>Shared with your home</strong><span>Only calendars you select are shown</span></div>
    </div>
  {/if}
</section>
