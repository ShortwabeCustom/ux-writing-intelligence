import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const workspace = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/api-key-storage.ts';",
      "export * from './src/selection.ts';",
      "export * from './src/shared/messages.ts';",
    ].join('\n'),
    resolveDir: workspace,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});

const moduleSource = bundle.outputFiles[0]?.text;

if (moduleSource === undefined) {
  throw new Error('Unable to compile modules for testing.');
}

const core = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

function createStorage(initialValue) {
  const values = new Map();

  if (initialValue !== undefined) {
    values.set(core.API_KEY_STORAGE_KEY, initialValue);
  }

  return {
    values,
    async getAsync(key) {
      return values.get(key);
    },
    async setAsync(key, value) {
      values.set(key, value);
    },
    async deleteAsync(key) {
      values.delete(key);
    },
  };
}

test('initial API key state is unconfigured', async () => {
  const storage = createStorage();
  assert.equal(await core.getApiKeyConfigured(storage), false);
});

test('valid API key is trimmed, stored and detected', async () => {
  const storage = createStorage();
  assert.equal(await core.saveApiKey(storage, '  internal-test-key  '), true);
  assert.equal(storage.values.get(core.API_KEY_STORAGE_KEY), 'internal-test-key');
  assert.equal(await core.getApiKeyConfigured(storage), true);
});

test('empty API key is rejected and not stored', async () => {
  const storage = createStorage();
  assert.equal(await core.saveApiKey(storage, '   '), false);
  assert.equal(storage.values.has(core.API_KEY_STORAGE_KEY), false);
});

test('existing API key can be replaced', async () => {
  const storage = createStorage('first-key');
  assert.equal(await core.saveApiKey(storage, 'second-key'), true);
  assert.equal(storage.values.get(core.API_KEY_STORAGE_KEY), 'second-key');
});

test('API key can be deleted', async () => {
  const storage = createStorage('temporary-key');
  await core.deleteApiKey(storage);
  assert.equal(await core.getApiKeyConfigured(storage), false);
});

test('storage failures are propagated for safe mapping by MAIN', async () => {
  const readFailure = {
    async getAsync() { throw new Error('read failure'); },
    async setAsync() {},
    async deleteAsync() {},
  };
  const writeFailure = {
    async getAsync() { return undefined; },
    async setAsync() { throw new Error('write failure'); },
    async deleteAsync() {},
  };
  const deleteFailure = {
    async getAsync() { return undefined; },
    async setAsync() {},
    async deleteAsync() { throw new Error('delete failure'); },
  };

  await assert.rejects(core.getApiKeyConfigured(readFailure));
  await assert.rejects(core.saveApiKey(writeFailure, 'valid-key'));
  await assert.rejects(core.deleteApiKey(deleteFailure));
});

test('MAIN status messages expose only configured booleans', () => {
  const messages = [
    core.createApiKeyStatusMessage('API_KEY_STATUS', true),
    core.createApiKeyStatusMessage('API_KEY_SAVED', true),
    core.createApiKeyStatusMessage('API_KEY_DELETED', false),
  ];
  const serializedMessages = JSON.stringify(messages);

  assert.equal(serializedMessages.includes('apiKey'), false);
  assert.deepEqual(messages.map((message) => message.payload.configured), [true, true, false]);
});

test('UI message guard validates SAVE_API_KEY payloads', () => {
  assert.equal(core.isUiToMainMessage({ type: 'SAVE_API_KEY', apiKey: 'temporary' }), true);
  assert.equal(core.isUiToMainMessage({ type: 'SAVE_API_KEY' }), false);
  assert.equal(core.isUiToMainMessage({ type: 'SAVE_API_KEY', apiKey: 42 }), false);
  assert.equal(core.isUiToMainMessage({ type: 'UNKNOWN' }), false);
});

test('Selection states preserve Phase 1 behavior', () => {
  assert.deepEqual(core.getSelectionState([]), { status: 'no-selection' });
  assert.deepEqual(core.getSelectionState([
    { type: 'FRAME', id: '1', name: 'Frame' },
    { type: 'RECTANGLE', id: '2', name: 'Rectangle' },
  ]), { status: 'multiple-selection', count: 2 });
  assert.deepEqual(core.getSelectionState([
    { type: 'FRAME', id: '1', name: 'Checkout' },
  ]), {
    status: 'invalid-selection',
    nodeType: 'FRAME',
    nodeName: 'Checkout',
  });
  assert.deepEqual(core.getSelectionState([
    { type: 'TEXT', id: '3', name: 'Button label', characters: 'Continuar' },
  ]), {
    status: 'ready',
    nodeId: '3',
    nodeName: 'Button label',
    text: 'Continuar',
  });
});

test('empty and whitespace-only TextNodes are blocked before Analyze', () => {
  for (const characters of ['', '   \n\t  ']) {
    assert.deepEqual(core.getSelectionState([{
      type: 'TEXT',
      id: 'empty-text',
      name: 'Empty label',
      characters,
    }]), {
      status: 'empty-text',
      nodeId: 'empty-text',
      nodeName: 'Empty label',
      text: characters,
    });
  }
});

test('very long TextNodes remain valid without an arbitrary client limit', () => {
  const text = 'Contenido de interfaz '.repeat(10_000);
  const state = core.getSelectionState([{
    type: 'TEXT',
    id: 'long-text',
    name: 'Long copy',
    characters: text,
  }]);

  assert.equal(state.status, 'ready');
  assert.equal(state.text, text);
});

test('removed nodes degrade safely to no-selection', () => {
  assert.deepEqual(core.getSelectionState([{
    type: 'TEXT',
    id: 'removed-text',
    name: 'Removed copy',
    characters: 'Unavailable',
    removed: true,
  }]), { status: 'no-selection' });
});
