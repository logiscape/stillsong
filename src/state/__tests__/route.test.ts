import { describe, expect, it } from 'vitest';
import { routeForBoot } from '../route';

describe('routeForBoot', () => {
  it('sends each install state to its screen', () => {
    expect(routeForBoot({ state: 'ready', version: '2026.10.22-1' })).toBe('create');
    expect(routeForBoot({ state: 'not-installed' })).toBe('setup');
    expect(routeForBoot({ state: 'needs-update', installedVersion: null })).toBe('update');
    expect(routeForBoot({ state: 'needs-update', installedVersion: '2026.09.03-1' })).toBe('update');
    expect(routeForBoot({ state: 'updating', prepared: false })).toBe('update');
    expect(routeForBoot({ state: 'updating', prepared: true })).toBe('update');
  });
});
