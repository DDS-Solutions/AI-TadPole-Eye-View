import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig(baseConfig, {
  testMatch: /telemetryTable\.performance\.ts/,
});
