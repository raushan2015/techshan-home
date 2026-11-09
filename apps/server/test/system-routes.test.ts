import { describe, expect, it } from 'vitest';
import { mapWeatherIntegrationState } from '../src/modules/system/routes';

describe('mapWeatherIntegrationState', () => {
  it('maps ready and stale forecasts to connected', () => {
    expect(mapWeatherIntegrationState('ready')).toBe('connected');
    expect(mapWeatherIntegrationState('stale')).toBe('connected');
  });

  it('maps unconfigured weather to not-configured', () => {
    expect(mapWeatherIntegrationState('not-configured')).toBe('not-configured');
  });

  it('maps loading and error states to unavailable', () => {
    expect(mapWeatherIntegrationState('loading')).toBe('unavailable');
    expect(mapWeatherIntegrationState('unavailable')).toBe('unavailable');
  });
});
