/**
 * Fixture del arnés de UI (FASE 9.1.2).
 *
 * Sirve el artefacto REAL de build —`dist/ui.html`— dentro de un iframe, y
 * coloca al test en el lugar del hilo principal. No se reescribe la interfaz
 * para probarla.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Frame, type Page } from '@playwright/test';

const workspace = path.dirname(path.dirname(path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
)));

/** Host ficticio: nada sale a la red. */
const ORIGIN = 'http://plugin.test';

export interface PluginHarness {
  page: Page;
  /** Documento de la UI real. */
  ui: Frame;
  /** Envía un mensaje MAIN -> UI. */
  send(message: unknown): Promise<void>;
  /** Mensajes que la UI devolvió al hilo principal. */
  received(): Promise<Array<Record<string, unknown>>>;
  receivedOfType(type: string): Promise<Array<Record<string, unknown>>>;
  /**
   * Espera a que la UI haya enviado `count` mensajes de un tipo.
   *
   * `postMessage` entre frames es asíncrono: leer la lista justo después de un
   * clic es una carrera del test, no del producto.
   */
  expectMessages(type: string, count: number): Promise<void>;
  /** Peticiones de red que intentó hacer la página. */
  networkRequests(): string[];
}

export const test = base.extend<{ plugin: PluginHarness }>({
  plugin: async ({ page }, use) => {
    const networkRequests: string[] = [];

    // Toda la red se sirve desde disco. Si algo pidiera un origen distinto,
    // quedaría registrado y la petición se aborta.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      networkRequests.push(route.request().url());

      if (url.origin !== ORIGIN) {
        await route.abort();
        return;
      }

      const file = url.pathname === '/ui.html'
        ? path.join(workspace, 'dist/ui.html')
        : path.join(workspace, 'tests/e2e/fixtures', path.basename(url.pathname));

      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: await readFile(file, 'utf8'),
      });
    });

    await page.goto(`${ORIGIN}/harness.html`);

    const ui = page.frameLocator('#plugin-ui');
    const uiFrame = page.frames().find((f) => f.url().endsWith('/ui.html'));

    if (uiFrame === undefined) {
      throw new Error('La UI no se cargó en el arnés.');
    }

    // La UI anuncia UI_READY al cargar; se espera a que ocurra.
    await expect.poll(async () => (await page.evaluate(
      () => (window as never as { __bridge: { received: unknown[] } })
        .__bridge.received.length,
    )) > 0).toBeTruthy();

    void ui;

    await use({
      page,
      ui: uiFrame,
      send: async (message) => {
        await page.evaluate(
          (payload) => (window as never as {
            __bridge: { send(value: unknown): void };
          }).__bridge.send(payload),
          message,
        );
      },
      received: async () => page.evaluate(
        () => (window as never as {
          __bridge: { received: Array<Record<string, unknown>> };
        }).__bridge.received,
      ),
      receivedOfType: async (type) => page.evaluate(
        (wanted) => (window as never as {
          __bridge: { receivedOfType(t: string): Array<Record<string, unknown>> };
        }).__bridge.receivedOfType(wanted),
        type,
      ),
      expectMessages: async (type, count) => {
        await expect.poll(async () => (await page.evaluate(
          (wanted) => (window as never as {
            __bridge: { receivedOfType(t: string): unknown[] };
          }).__bridge.receivedOfType(wanted).length,
          type,
        )), { timeout: 3000 }).toBe(count);
      },
      networkRequests: () => networkRequests,
    });
  },
});

export { expect };
