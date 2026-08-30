import { defineConfig, devices } from '@playwright/test';

/**
 * Regresión de UI real (FASE 9.1.2).
 *
 * Existe porque varios defectos de 8.5.x fueron de CABLEADO del DOM, no de
 * decisión: el estado resolvía «nube» correctamente y la tarjeta seguía
 * pintando «Local». Las guardas que leen el fuente no detectan esa clase de
 * fallo; solo verlo renderizado lo detecta.
 *
 * No hay servidor: las peticiones se sirven desde disco con `page.route`, así
 * que la suite no depende del runtime local ni de la red.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    // El plugin de Figma mide 360×560; se prueba a su tamaño real.
    viewport: { width: 400, height: 700 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
