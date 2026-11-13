import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Running `forge register` inside the project rewrites manifest.yml's app id. If that slipped
// into a commit, the free pipeline would deploy over the paid app.
describe('editions', () => {
  it('keeps the free and paid apps on different app ids', () => {
    const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
    const paid = JSON.parse(readFileSync(new URL('../editions/paid.json', import.meta.url), 'utf8').replace(/^﻿/, ''));
    const freeId = manifest.match(/^\s+id:\s*(ari:cloud:ecosystem::app\/[0-9a-f-]+)/m)?.[1];
    expect(freeId).toBeTruthy();
    expect(freeId).not.toBe(paid.appId);
    expect(manifest).not.toMatch(/licensing:/);
  });
});
