<script lang="ts">
  import { onMount } from 'svelte';
  import { X, CalendarDays, Images, ShieldCheck, ArrowUpRight, MapPin, Navigation, Search, Thermometer } from '@lucide/svelte';
  import type { BrandingConfig, DashboardStatus, GoogleCalendarStatus, ImmichStatus, WeatherLocation, WeatherSettings, WeatherSnapshot } from '../services/dashboard';
  import {
    beginGoogleCalendarConnection,
    disconnectGoogleCalendar,
    loadBranding,
    loadDashboardStatus,
    loadGoogleCalendarStatus,
    loadImmichStatus,
    loadWeatherSettings,
    saveGoogleOAuthSettings,
    saveGoogleCalendarSelection,
    saveImmichAlbumSelection,
    saveImmichSettings,
    testImmichConnection,
    disconnectImmich,
    removeBrandingLogo,
    saveBrandingName,
    uploadBrandingLogo,
    saveWeatherSettings as saveSettings,
    searchWeatherLocations,
  } from '../services/dashboard';

  let {
    open = $bindable(false),
    status = $bindable<DashboardStatus>(),
    weather = $bindable<WeatherSnapshot>(),
  }: { open: boolean; status: DashboardStatus; weather: WeatherSnapshot } = $props();

  type TemperatureUnit = WeatherSettings['temperatureUnit'];
  let locationQuery = $state('');
  let unit = $state<TemperatureUnit>('celsius');
  let locations = $state<WeatherLocation[]>([]);
  let searching = $state(false);
  let saving = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let googleCalendar = $state<GoogleCalendarStatus>({
    configured: false, connected: false, clientIdHint: null,
    redirectUri: 'http://127.0.0.1:3000/auth/google/callback', returnUrl: 'http://127.0.0.1:5173/',
    calendars: [], selectedCalendarIds: [], lastSyncedAt: null, lastError: null,
  });
  let selectedCalendarIds = $state<string[]>([]);
  let calendarSaving = $state(false);
  let calendarError = $state('');
  let calendarMessage = $state('');
  let connectingCalendar = $state(false);
  let savingOAuth = $state(false);
  let oauthClientId = $state('');
  let oauthClientSecret = $state('');
  let oauthRedirectUri = $state('http://127.0.0.1:3000/auth/google/callback');
  let oauthReturnUrl = $state('http://127.0.0.1:5173/');
  let immich = $state<ImmichStatus>({ configured: false, connected: false, serverUrl: '', apiKeyHint: null, albums: [], selectedAlbumIds: [], photoCount: 0, refreshedAt: null, lastError: null });
  let immichServerUrl = $state('');
  let immichApiKey = $state('');
  let selectedImmichAlbums = $state<string[]>([]);
  let immichSaving = $state(false);
  let immichError = $state('');
  let immichMessage = $state('');
  let branding = $state<BrandingConfig>({ name: null, customLogo: false, logoUpdatedAt: null });
  let brandNameInput = $state('');
  let brandSaving = $state(false);
  let brandError = $state('');
  let brandMessage = $state('');

  const brandLogoSrc = $derived(branding.customLogo && branding.logoUpdatedAt ? `/api/v1/settings/branding/logo?v=${encodeURIComponent(branding.logoUpdatedAt)}` : '/logo-mark.png');

  onMount(async () => {
    const [settingsResult, googleResult, immichResult, brandingResult] = await Promise.allSettled([loadWeatherSettings(), loadGoogleCalendarStatus(), loadImmichStatus(), loadBranding()]);
    if (settingsResult.status === 'fulfilled' && settingsResult.value) {
      locationQuery = settingsResult.value.location.label;
      unit = settingsResult.value.temperatureUnit;
    } else if (settingsResult.status === 'rejected') {
      errorMessage = 'Could not load weather settings.';
    }
    if (googleResult.status === 'fulfilled') {
      googleCalendar = googleResult.value;
      selectedCalendarIds = googleResult.value.selectedCalendarIds;
      oauthRedirectUri = googleResult.value.redirectUri;
      oauthReturnUrl = googleResult.value.returnUrl;
    } else {
      calendarError = 'Could not load Google Calendar status.';
    }
    if (immichResult.status === 'fulfilled') {
      immich = immichResult.value;
      immichServerUrl = immichResult.value.serverUrl;
      selectedImmichAlbums = immichResult.value.selectedAlbumIds;
    } else immichError = 'Could not load Immich status.';
    if (brandingResult.status === 'fulfilled') {
      branding = brandingResult.value;
      brandNameInput = brandingResult.value.name ?? '';
    }
  });

  async function saveBrandName() {
    brandSaving = true; brandError = ''; brandMessage = '';
    const name = brandNameInput.trim();
    try {
      branding = await saveBrandingName(name === '' ? null : name);
      brandNameInput = branding.name ?? '';
      brandMessage = branding.name ? 'Brand name saved.' : 'Default brand name restored.';
      window.dispatchEvent(new Event('branding-updated'));
    } catch (error) { brandError = error instanceof Error ? error.message : 'Could not save the brand name.'; }
    finally { brandSaving = false; }
  }

  async function onLogoChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      brandError = 'Choose a PNG, JPEG, or WebP image.';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      brandError = 'The logo must be 2 MB or smaller.';
      return;
    }
    brandSaving = true; brandError = ''; brandMessage = '';
    try {
      branding = await uploadBrandingLogo(file);
      brandMessage = 'Custom logo saved.';
      window.dispatchEvent(new Event('branding-updated'));
    } catch (error) { brandError = error instanceof Error ? error.message : 'Could not use this image as the logo.'; }
    finally { brandSaving = false; }
  }

  async function resetLogo() {
    brandSaving = true; brandError = ''; brandMessage = '';
    try {
      branding = await removeBrandingLogo();
      brandMessage = 'Default logo restored.';
      window.dispatchEvent(new Event('branding-updated'));
    } catch (error) { brandError = error instanceof Error ? error.message : 'Could not remove the custom logo.'; }
    finally { brandSaving = false; }
  }

  async function saveImmichConnection(test = true) {
    immichSaving = true; immichError = ''; immichMessage = '';
    try {
      immich = await saveImmichSettings({ serverUrl: immichServerUrl, apiKey: immichApiKey || undefined });
      immichApiKey = '';
      selectedImmichAlbums = immich.selectedAlbumIds;
      immichMessage = test ? `Connected to Immich. ${immich.albums.length} albums found.` : 'Immich settings saved securely.';
      status = await loadDashboardStatus();
      window.dispatchEvent(new Event('immich-updated'));
    } catch (error) { immichError = error instanceof Error ? error.message : 'Could not save Immich settings.'; }
    finally { immichSaving = false; }
  }

  async function testImmich() {
    if (immichApiKey || immichServerUrl !== immich.serverUrl) return saveImmichConnection();
    immichSaving = true; immichError = ''; immichMessage = '';
    try { immich = await testImmichConnection(); selectedImmichAlbums = immich.selectedAlbumIds; immichMessage = `Connected to Immich. ${immich.albums.length} albums found.`; status = await loadDashboardStatus(); window.dispatchEvent(new Event('immich-updated')); }
    catch (error) { immichError = error instanceof Error ? error.message : 'Could not connect to Immich.'; }
    finally { immichSaving = false; }
  }

  async function saveImmichAlbums() {
    immichSaving = true; immichError = ''; immichMessage = '';
    try { immich = await saveImmichAlbumSelection(selectedImmichAlbums); immichMessage = `${immich.photoCount} photos ready for the slideshow.`; status = await loadDashboardStatus(); window.dispatchEvent(new Event('immich-updated')); }
    catch (error) { immichError = error instanceof Error ? error.message : 'Could not save album selection.'; }
    finally { immichSaving = false; }
  }

  async function removeImmich() {
    immichSaving = true; immichError = ''; immichMessage = '';
    try { immich = await disconnectImmich(); immichServerUrl = ''; immichApiKey = ''; selectedImmichAlbums = []; immichMessage = 'Immich disconnected.'; status = await loadDashboardStatus(); window.dispatchEvent(new Event('immich-updated')); }
    catch (error) { immichError = error instanceof Error ? error.message : 'Could not disconnect Immich.'; }
    finally { immichSaving = false; }
  }

  async function saveOAuthSettings() {
    calendarError = '';
    calendarMessage = '';
    savingOAuth = true;
    try {
      googleCalendar = await saveGoogleOAuthSettings({
        clientId: oauthClientId.trim() || undefined,
        clientSecret: oauthClientSecret || undefined,
        redirectUri: oauthRedirectUri,
        returnUrl: oauthReturnUrl,
      });
      oauthClientId = '';
      oauthClientSecret = '';
      calendarMessage = 'Google OAuth settings saved securely. You can connect the account now.';
    } catch (error) {
      calendarError = error instanceof Error ? error.message : 'Could not save Google OAuth settings.';
    } finally {
      savingOAuth = false;
    }
  }

  async function connectCalendar() {
    calendarError = '';
    calendarMessage = '';
    connectingCalendar = true;
    try {
      window.location.assign(await beginGoogleCalendarConnection());
    } catch (error) {
      calendarError = error instanceof Error ? error.message : 'Could not start Google Calendar authorization.';
      connectingCalendar = false;
    }
  }

  async function saveCalendars() {
    calendarError = '';
    calendarMessage = '';
    calendarSaving = true;
    try {
      await saveGoogleCalendarSelection(selectedCalendarIds);
      googleCalendar = await loadGoogleCalendarStatus();
      status = await loadDashboardStatus();
      calendarMessage = 'Calendar selection saved. Events are refreshed every five minutes.';
    } catch (error) {
      calendarError = error instanceof Error ? error.message : 'Could not save selected calendars.';
    } finally {
      calendarSaving = false;
    }
  }

  async function disconnectCalendar() {
    calendarError = '';
    calendarMessage = '';
    calendarSaving = true;
    try {
      googleCalendar = await disconnectGoogleCalendar();
      selectedCalendarIds = [];
      status = await loadDashboardStatus();
      calendarMessage = 'Google Calendar has been disconnected.';
    } catch (error) {
      calendarError = error instanceof Error ? error.message : 'Could not disconnect Google Calendar.';
    } finally {
      calendarSaving = false;
    }
  }

  async function searchLocations() {
    errorMessage = '';
    successMessage = '';
    if (locationQuery.trim().length < 2) {
      errorMessage = 'Enter a city or postal code to search.';
      return;
    }
    searching = true;
    try {
      locations = await searchWeatherLocations(locationQuery);
      if (locations.length === 0) errorMessage = 'No matching locations found.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Location search failed.';
    } finally {
      searching = false;
    }
  }

  async function saveLocation(location: WeatherLocation) {
    errorMessage = '';
    successMessage = '';
    saving = true;
    try {
      const settings: WeatherSettings = { location, temperatureUnit: unit };
      weather = await saveSettings(settings);
      status = await loadDashboardStatus();
      locationQuery = location.label;
      locations = [];
      successMessage = weather.current ? 'Forecast connected and refreshed.' : 'Location saved. The forecast will appear when the provider responds.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Could not save this location.';
    } finally {
      saving = false;
    }
  }

  async function useCurrentLocation() {
    errorMessage = '';
    successMessage = '';
    if (!navigator.geolocation) {
      errorMessage = 'This browser does not support location access.';
      return;
    }

    saving = true;
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 15_000,
        });
      });
      const { latitude, longitude } = position.coords;
      let locationLabel = 'Current location';
      try {
        const reverseUrl = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
        reverseUrl.searchParams.set('latitude', String(latitude));
        reverseUrl.searchParams.set('longitude', String(longitude));
        reverseUrl.searchParams.set('localityLanguage', navigator.language.split('-')[0] || 'en');
        const response = await fetch(reverseUrl, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const place = await response.json() as {
            city?: string;
            locality?: string;
            principalSubdivision?: string;
            countryName?: string;
          };
          const city = place.city || place.locality;
          if (city) locationLabel = [city, place.principalSubdivision, place.countryName].filter(Boolean).join(', ');
        }
      } catch {
        // Keep the precise coordinates and forecast even when the city lookup is unavailable.
      }
      await saveLocation({
        label: locationLabel,
        latitude,
        longitude,
      });
    } catch (error) {
      errorMessage = error instanceof GeolocationPositionError
        ? error.code === error.PERMISSION_DENIED ? 'Location access was denied. You can search for a city instead.' : 'Could not read this device location.'
        : error instanceof Error ? error.message : 'Could not set the current location.';
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <div class="panel-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (open = false)} onkeydown={(event) => event.key === 'Escape' && (open = false)}>
    <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
      <header class="panel-header"><div><span class="eyebrow">YOUR HOME</span><h2 id="settings-title">Settings</h2></div><button class="icon-button panel-close" onclick={() => (open = false)} aria-label="Close settings"><X size={19} /></button></header>
      <p class="panel-intro">Connect your services and tune the shared dashboard for every screen.</p>

      <section class="branding-settings-section" aria-labelledby="branding-settings-title">
        <div class="panel-section-label" id="branding-settings-title">BRAND NAME & LOGO</div>
        <p class="weather-setting-description">Choose how this dashboard is named and marked on every screen. Leave the name empty to show the default TECHSHAN-HOME.</p>
        <label class="field-label" for="brand-name">Brand name</label>
        <div class="location-search-row">
          <input id="brand-name" bind:value={brandNameInput} placeholder="TECHSHAN-HOME" maxlength="40" autocomplete="off" />
          <button class="search-location-button" type="button" onclick={saveBrandName} disabled={brandSaving}>{brandSaving ? 'Saving' : 'Save name'}</button>
        </div>
        <div class="branding-logo-row">
          <span class="brand-logo-preview"><img src={brandLogoSrc} alt="Current brand logo" /></span>
          <div class="branding-logo-actions">
            <input id="brand-logo-input" type="file" accept="image/png,image/jpeg,image/webp" hidden onchange={onLogoChosen} />
            <button class="calendar-action-button" type="button" onclick={() => document.getElementById('brand-logo-input')?.click()} disabled={brandSaving}>{brandSaving ? 'Working...' : 'Upload logo'}</button>
            {#if branding.customLogo}<button class="calendar-disconnect-button" type="button" onclick={resetLogo} disabled={brandSaving}>Reset logo</button>{/if}
          </div>
        </div>
        <p class="calendar-setup-hint">PNG, JPEG, or WebP up to 2 MB. It fills the top-bar mark on every dashboard screen.</p>
        {#if brandError}<p class="settings-message error-message" role="alert">{brandError}</p>{/if}
        {#if brandMessage}<p class="settings-message success-message" role="status">{brandMessage}</p>{/if}
      </section>

      <section class="weather-settings-section" aria-labelledby="weather-settings-title">
        <div class="panel-section-label" id="weather-settings-title">SHARED WEATHER</div>
        <p class="weather-setting-description">Choose a place or use this device's location. The selection is shared across your dashboard displays.</p>
        <label class="field-label" for="weather-location">Location</label>
        <div class="location-search-row">
          <input id="weather-location" bind:value={locationQuery} placeholder="City or postal code" autocomplete="off" />
          <button class="search-location-button" type="button" onclick={searchLocations} disabled={searching || saving} aria-label="Search locations"><Search size={17} />{searching ? 'Searching' : 'Search'}</button>
        </div>
        {#if locations.length}
          <div class="location-results" aria-label="Location results">
            {#each locations as location}
              <button class="location-result" type="button" onclick={() => saveLocation(location)} disabled={saving}>
                <MapPin size={16} /><span>{location.label}</span><ArrowUpRight size={14} />
              </button>
            {/each}
          </div>
        {/if}
        <button class="current-location-button" type="button" onclick={useCurrentLocation} disabled={saving}>
          <Navigation size={16} />{saving ? 'Updating forecast...' : "Use this device's current location"}
        </button>
        <label class="field-label unit-label" for="weather-unit"><Thermometer size={15} />Temperature units</label>
        <select id="weather-unit" bind:value={unit} onchange={() => { if (weather.location) void saveLocation(weather.location); else errorMessage = 'Choose a location first; temperature units apply to the shared forecast.'; }}>
          <option value="celsius">Celsius (°C)</option>
          <option value="fahrenheit">Fahrenheit (°F)</option>
        </select>
        {#if weather.location}<p class="selected-location">Current shared location: <strong>{weather.location.label}</strong></p>{/if}
        {#if errorMessage}<p class="settings-message error-message" role="alert">{errorMessage}</p>{/if}
        {#if successMessage}<p class="settings-message success-message" role="status">{successMessage}</p>{/if}
      </section>

      <section class="calendar-settings-section" aria-labelledby="calendar-settings-title">
        <div class="panel-section-label" id="calendar-settings-title">GOOGLE CALENDAR</div>
        {#if googleCalendar.connected}
          <p class="weather-setting-description">Choose which calendars appear on every dashboard screen.</p>
          {#if googleCalendar.calendars.length}
            <div class="calendar-choices" aria-label="Available Google calendars">
              {#each googleCalendar.calendars as calendar (calendar.id)}
                <label class="calendar-choice">
                  <input type="checkbox" value={calendar.id} bind:group={selectedCalendarIds} />
                  <span><strong>{calendar.summary}</strong>{#if calendar.primary}<small>Primary calendar</small>{/if}</span>
                </label>
              {/each}
            </div>
            <div class="calendar-actions">
              <button class="calendar-action-button" type="button" onclick={saveCalendars} disabled={calendarSaving}>
                {calendarSaving ? 'Saving...' : 'Save selected calendars'}
              </button>
              <button class="calendar-disconnect-button" type="button" onclick={disconnectCalendar} disabled={calendarSaving}>Disconnect</button>
            </div>
          {:else}
            <p class="calendar-setup-hint">Google is connected, but no calendars were returned for this account.</p>
            <button class="calendar-disconnect-button" type="button" onclick={disconnectCalendar} disabled={calendarSaving}>Disconnect</button>
          {/if}
          {#if googleCalendar.lastSyncedAt}<p class="selected-location">Last calendar sync: <strong>{new Date(googleCalendar.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong></p>{/if}
        {:else}
          <p class="weather-setting-description">Enter your Google OAuth web client details. The client secret is encrypted on this server and never sent back to the browser. Calendar and event access is read-only.</p>
          <label class="field-label" for="google-client-id">OAuth client ID</label>
          <input class="oauth-field" id="google-client-id" bind:value={oauthClientId} placeholder={googleCalendar.clientIdHint ?? '123...apps.googleusercontent.com'} autocomplete="off" />
          <label class="field-label oauth-label" for="google-client-secret">OAuth client secret</label>
          <input class="oauth-field" id="google-client-secret" type="password" bind:value={oauthClientSecret} placeholder={googleCalendar.configured ? 'Saved securely; leave blank to keep it' : 'Google Cloud client secret'} autocomplete="new-password" />
          <label class="field-label oauth-label" for="google-redirect-uri">Authorized redirect URI</label>
          <input class="oauth-field" id="google-redirect-uri" bind:value={oauthRedirectUri} spellcheck="false" />
          <label class="field-label oauth-label" for="google-return-url">Dashboard return URL</label>
          <input class="oauth-field" id="google-return-url" bind:value={oauthReturnUrl} spellcheck="false" />
          <p class="calendar-setup-hint">Add the exact redirect URI above to your Google Cloud OAuth client. Google Cloud project and consent-screen setup are still required.</p>
          <div class="calendar-actions">
            <button class="calendar-action-button" type="button" onclick={saveOAuthSettings} disabled={savingOAuth}>
              {savingOAuth ? 'Saving securely...' : 'Save OAuth settings'}
            </button>
            {#if googleCalendar.configured}
              <button class="calendar-action-button" type="button" onclick={connectCalendar} disabled={connectingCalendar || savingOAuth || Boolean(oauthClientId.trim() || oauthClientSecret) || oauthRedirectUri !== googleCalendar.redirectUri || oauthReturnUrl !== googleCalendar.returnUrl}>
                {connectingCalendar ? 'Opening Google...' : 'Connect Google Calendar'}
              </button>
            {/if}
          </div>
        {/if}
        {#if calendarError || googleCalendar.lastError}<p class="settings-message error-message" role="alert">{calendarError || googleCalendar.lastError}</p>{/if}
        {#if calendarMessage}<p class="settings-message success-message" role="status">{calendarMessage}</p>{/if}
      </section>

      <section class="immich-settings-section" aria-labelledby="immich-settings-title">
        <div class="panel-section-label" id="immich-settings-title"><Images size={15} /> IMMICH PHOTOS</div>
        <p class="weather-setting-description">Connect your Immich server and choose albums for the shared slideshow. The API key is encrypted on this server and never sent back to the browser.</p>
        <label class="field-label" for="immich-server-url">Immich server URL</label>
        <input class="oauth-field" id="immich-server-url" bind:value={immichServerUrl} placeholder="http://immich.local:2283" spellcheck="false" autocomplete="url" />
        <label class="field-label oauth-label" for="immich-api-key">API key</label>
        <input class="oauth-field" id="immich-api-key" type="password" bind:value={immichApiKey} placeholder={immich.apiKeyHint ? `Saved securely (${immich.apiKeyHint}); leave blank to keep it` : 'Immich API key'} autocomplete="new-password" />
        <p class="calendar-setup-hint">Create a read-only API key in Immich with album and asset read access. Use this dashboard only on a trusted local network until sign-in is enabled.</p>
        <div class="calendar-actions">
          <button class="calendar-action-button" type="button" onclick={() => saveImmichConnection(false)} disabled={immichSaving}>{immichSaving ? 'Saving...' : 'Save settings'}</button>
          <button class="calendar-action-button" type="button" onclick={testImmich} disabled={immichSaving || !immichServerUrl.trim()}>{immichSaving ? 'Checking...' : 'Test connection'}</button>
          {#if immich.configured}<button class="calendar-disconnect-button" type="button" onclick={removeImmich} disabled={immichSaving}>Disconnect</button>{/if}
        </div>
        {#if immich.connected}
          <div class="immich-albums">
            <p class="field-label">Albums for the slideshow</p>
            {#if immich.albums.length}
              {#each immich.albums as album (album.id)}
                <label class="calendar-choice"><input type="checkbox" value={album.id} bind:group={selectedImmichAlbums} /><span><strong>{album.name}</strong><small>{album.assetCount} items</small></span></label>
              {/each}
              <button class="calendar-action-button immich-album-save" type="button" onclick={saveImmichAlbums} disabled={immichSaving}>{immichSaving ? 'Saving...' : 'Save selected albums'}</button>
            {:else}<p class="calendar-setup-hint">No albums are available for this API key.</p>{/if}
          </div>
          {#if immich.refreshedAt}<p class="selected-location">{immich.photoCount} photos · refreshed {new Date(immich.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>{/if}
        {/if}
        {#if immichError || immich.lastError}<p class="settings-message error-message" role="alert">{immichError || immich.lastError}</p>{/if}
        {#if immichMessage}<p class="settings-message success-message" role="status">{immichMessage}</p>{/if}
      </section>
      <div class="panel-note"><ShieldCheck size={18} /><p>Weather settings are stored on this server. Selected coordinates go to Open-Meteo for forecasts and to JMA for nearby observations in Japan. When you choose device location, your browser also sends its coordinates and request IP to BigDataCloud to look up the city name.</p></div>
      <div class="panel-footer"><span>{branding.name ?? 'TECHSHAN-HOME'}</span><span>Setup is being built</span></div>
    </div>
  </div>
{/if}
