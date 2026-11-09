<script lang="ts">
  import { Cloud, CloudLightning, CloudRain, CloudSnow, CloudSun, Settings2, Sun } from '@lucide/svelte';
  import type { IntegrationState, WeatherSnapshot } from '../services/dashboard';

  let { state, weather }: { state: IntegrationState; weather: WeatherSnapshot } = $props();

  const symbol = $derived(weather.temperatureUnit === 'fahrenheit' ? '°F' : '°C');
  const temperature = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value)}${symbol}`;

  function condition(code: number | null | undefined) {
    if (code == null) return 'Forecast';
    if (code === 0) return 'Clear sky';
    if (code === 1) return 'Mainly clear';
    if (code === 2) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if (code === 45 || code === 48) return 'Fog';
    if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
    if ([95, 96, 99].includes(code)) return 'Thunderstorm';
    return 'Cloudy';
  }

  function hourLabel(value: string) {
    const date = new Date(value);
    // The server emits true UTC timestamps; render the forecast location's
    // local hour. Fall back to UTC when the timezone name is not usable.
    const timeZone = weather.timezone ?? 'UTC';
    try {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone }).format(date);
    } catch {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(date);
    }
  }

  const conditionLabel = $derived(
    weather.current?.observationStation && (weather.current.precipitationLastHour ?? 0) > 0
      ? 'Rain nearby'
      : condition(weather.current?.weatherCode),
  );
</script>

<section class="glass-card weather-card" aria-label="Weather">
  <div class="weather-current">
    <div class="weather-icon">
      {#if !weather.current}
        <CloudSun size={48} strokeWidth={1.6} />
      {:else if [0, 1].includes(weather.current.weatherCode ?? -1)}
        <Sun size={45} strokeWidth={1.6} />
      {:else if [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weather.current.weatherCode ?? -1)}
        <CloudRain size={45} strokeWidth={1.6} />
      {:else if [71, 73, 75, 77, 85, 86].includes(weather.current.weatherCode ?? -1)}
        <CloudSnow size={45} strokeWidth={1.6} />
      {:else if [95, 96, 99].includes(weather.current.weatherCode ?? -1)}
        <CloudLightning size={45} strokeWidth={1.6} />
      {:else if weather.current.weatherCode === 2}
        <CloudSun size={45} strokeWidth={1.6} />
      {:else}
        <Cloud size={45} strokeWidth={1.6} />
      {/if}
    </div>
    <div class="weather-empty">
      <span class="eyebrow">{weather.location?.label ?? 'WEATHER'}</span>
      {#if weather.current}
        <strong>{temperature(weather.current.temperature)} · {conditionLabel}</strong>
        <span>
          {#if weather.current.feelsLike != null}Feels like {temperature(weather.current.feelsLike)} · {/if}
          {#if weather.current.humidity != null}{Math.round(weather.current.humidity)}% humidity{/if}
          {#if weather.current.precipitationLastHour != null && weather.current.precipitationLastHour > 0} · {weather.current.precipitationLastHour} mm rain in the past hour{/if}
        </span>
        {#if weather.current.observationStation && weather.current.observedAt}
          <small class="weather-observation">Observed at {weather.current.observationStation} · {new Date(weather.current.observedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
        {/if}
      {:else}
        <strong>{weather.state === 'unavailable' ? 'Weather temporarily unavailable' : 'Your forecast, at a glance'}</strong>
        <span>{weather.state === 'not-configured' ? 'Choose a location in Settings to begin' : 'Waiting for the latest forecast'}</span>
      {/if}
    </div>
    {#if state === 'not-configured'}<Settings2 class="weather-settings" size={17} aria-hidden="true" />{/if}
  </div>
  <div class="forecast-strip" aria-label="Hourly forecast">
    {#each weather.hourly.slice(0, 6) as hour, i}
      <div class="forecast-item">
        <span>{i === 0 ? 'Now' : hourLabel(hour.time)}</span>
        {#if [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(hour.weatherCode ?? -1)}
          <CloudRain size={18} />
        {:else if [71, 73, 75, 77, 85, 86].includes(hour.weatherCode ?? -1)}
          <CloudSnow size={18} />
        {:else if [95, 96, 99].includes(hour.weatherCode ?? -1)}
          <CloudLightning size={18} />
        {:else if [0, 1].includes(hour.weatherCode ?? -1)}
          <Sun size={18} />
        {:else if hour.weatherCode === 2}
          <CloudSun size={18} />
        {:else}
          <Cloud size={18} />
        {/if}
        <small>{temperature(hour.temperature)}</small>
        {#if hour.precipitationProbability != null}<small class="forecast-rain">{hour.precipitationProbability}% rain</small>{/if}
      </div>
    {:else}
      {#each ['Now', '11', '12', '1', '2', '3'] as hour}
        <div class="forecast-item"><span>{hour}</span><CloudSun size={18} /><small>—</small></div>
      {/each}
    {/each}
  </div>
  {#if weather.state === 'stale' && weather.updatedAt}
    <p class="weather-stale">Showing cached forecast · updated {new Date(weather.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
  {:else if weather.current && weather.updatedAt}
    <p class="weather-stale">{weather.current.observationStation ? `JMA observed · ${weather.current.observationStation} · JMA rain outlook · Open-Meteo temperature forecast` : 'Weather by Open-Meteo'} · updated {new Date(weather.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
  {/if}
</section>
