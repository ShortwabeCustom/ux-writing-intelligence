import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  await readFile(path.join(workspace, 'manifest.json'), 'utf8'),
);

test('el ID del plugin no cambia', () => {
  assert.equal(manifest.id, '1674592820827897160');
});

test('el acceso de red conserva el dominio de la nube', () => {
  assert.ok(
    manifest.networkAccess.allowedDomains.includes('https://writing.productdesign.mx'),
    'se perdió el acceso al backend de producción',
  );
});

test('el acceso de red incluye el runtime local en su puerto exacto', () => {
  assert.ok(manifest.networkAccess.allowedDomains.includes('http://localhost:8787'));
});

test('el acceso de red no usa comodines', () => {
  for (const domain of manifest.networkAccess.allowedDomains) {
    assert.ok(!domain.includes('*'), `dominio con comodín: ${domain}`);
  }
});

test('el acceso de red no expone 0.0.0.0 ni rangos de LAN', () => {
  const forbidden = [/0\.0\.0\.0/u, /192\.168\./u, /10\.\d+\./u, /172\.(1[6-9]|2\d|3[01])\./u];
  for (const domain of manifest.networkAccess.allowedDomains) {
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(domain), `dominio expuesto a la red: ${domain}`);
    }
  }
});

test('no se permiten otros puertos de localhost', () => {
  const localhostEntries = manifest.networkAccess.allowedDomains.filter(
    (domain) => domain.includes('localhost') || domain.includes('127.0.0.1'),
  );
  assert.deepEqual(localhostEntries, ['http://localhost:8787']);
});

test('no hay dominios ajenos al producto', () => {
  assert.deepEqual(
    [...manifest.networkAccess.allowedDomains].sort(),
    ['http://localhost:8787', 'https://writing.productdesign.mx'],
  );
});

test('el acceso de red explica por qué se usa una dirección local', () => {
  const { reasoning } = manifest.networkAccess;
  assert.equal(typeof reasoning, 'string');
  assert.ok(reasoning.length > 0);
  assert.ok(/local/iu.test(reasoning));
});

test('el manifest conserva su configuración base', () => {
  assert.equal(manifest.api, '1.0.0');
  assert.equal(manifest.main, 'dist/code.js');
  assert.equal(manifest.ui, 'dist/ui.html');
  assert.equal(manifest.documentAccess, 'dynamic-page');
});
