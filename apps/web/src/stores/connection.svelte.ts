/**
 * Live connection state of the device viewing the dashboard.
 *
 * All data is read in the browser and never uploaded anywhere:
 * - `navigator.onLine` plus the window `online`/`offline` events for the
 *   device's network-interface status.
 * - The Network Information API (`navigator.connection`, Chromium browsers)
 *   for a connection-class estimate, downlink and round-trip estimates, and
 *   the data-saver flag. Safari and Firefox do not expose the API; those
 *   fields then stay `null` and the UI shows "Not reported".
 * - A lightweight probe of the server's `/api/v1/health` endpoint, because
 *   `navigator.onLine === true` does not guarantee that this dashboard's
 *   server is reachable.
 */

export type EffectiveConnectionType = 'slow-2g' | '2g' | '3g' | '4g';

/** The subset of the Network Information API used here (Chromium-only today). */
interface NetworkInformation extends EventTarget {
  readonly effectiveType?: EffectiveConnectionType;
  readonly downlink?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
}

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

function readNetworkInformation(): NetworkInformation | null {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection ?? null;
}

class ConnectionStore {
  /** Device network-interface status as reported by the browser. */
  online = $state(true);
  /** Whether `/api/v1/health` answered; `null` until the first probe finishes. */
  serverReachable = $state<boolean | null>(null);
  /** Connection-class estimate from the Network Information API, if exposed. */
  effectiveType = $state<EffectiveConnectionType | null>(null);
  /** Downlink estimate in megabits per second, if exposed. */
  downlink = $state<number | null>(null);
  /** Round-trip-time estimate in milliseconds, if exposed. */
  rtt = $state<number | null>(null);
  saveData = $state(false);
  /** Whether the browser exposes the Network Information API at all. */
  networkInfoAvailable = $state(false);

  #networkInfo: NetworkInformation | null = null;
  #timer: number | undefined;
  #probing = false;
  #started = false;

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#networkInfo = readNetworkInformation();
    this.networkInfoAvailable = this.#networkInfo !== null;
    this.#networkInfo?.addEventListener('change', this.#readDeviceState);
    window.addEventListener('online', this.#handleConnectivityEvent);
    window.addEventListener('offline', this.#handleConnectivityEvent);
    document.addEventListener('visibilitychange', this.#handleConnectivityEvent);
    this.#readDeviceState();
    void this.probeServer();
    this.#timer = window.setInterval(() => void this.probeServer(), HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#networkInfo?.removeEventListener('change', this.#readDeviceState);
    window.removeEventListener('online', this.#handleConnectivityEvent);
    window.removeEventListener('offline', this.#handleConnectivityEvent);
    document.removeEventListener('visibilitychange', this.#handleConnectivityEvent);
    window.clearInterval(this.#timer);
  }

  /** Re-check the dashboard server immediately; updates `serverReachable`. */
  async probeServer(): Promise<void> {
    if (this.#probing) return;
    this.#probing = true;
    try {
      const response = await fetch('/api/v1/health', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      this.serverReachable = response.ok;
    } catch {
      this.serverReachable = false;
    } finally {
      this.#probing = false;
    }
  }

  #readDeviceState = (): void => {
    this.online = navigator.onLine;
    const info = this.#networkInfo;
    if (!info) return;
    this.effectiveType = info.effectiveType ?? null;
    this.downlink = typeof info.downlink === 'number' ? info.downlink : null;
    this.rtt = typeof info.rtt === 'number' ? info.rtt : null;
    this.saveData = info.saveData === true;
  };

  /** Re-read device state and re-probe when connectivity or tab focus changes. */
  #handleConnectivityEvent = (): void => {
    this.#readDeviceState();
    if (document.visibilityState !== 'hidden') void this.probeServer();
  };
}

export const connection = new ConnectionStore();
