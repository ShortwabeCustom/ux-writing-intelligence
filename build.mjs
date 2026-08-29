import { watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const workspace = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(workspace, 'dist');
const isWatchMode = process.argv.includes('--watch');

async function buildPlugin() {
  await mkdir(distDirectory, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(workspace, 'src/code.ts')],
    outfile: path.join(distDirectory, 'code.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'info',
  });

  const uiBundle = await esbuild.build({
    entryPoints: [path.join(workspace, 'src/ui.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });

  const [template, styles] = await Promise.all([
    readFile(path.join(workspace, 'ui/ui.html'), 'utf8'),
    readFile(path.join(workspace, 'ui/styles.css'), 'utf8'),
  ]);

  const bundledScript = uiBundle.outputFiles[0]?.text;

  if (bundledScript === undefined) {
    throw new Error('esbuild did not produce a UI bundle.');
  }

  const outputHtml = template
    .replace('/* INLINE_STYLES */', styles)
    .replace('/* INLINE_SCRIPT */', bundledScript.replace(/<\/script/giu, '<\\/script'));

  await writeFile(path.join(distDirectory, 'ui.html'), outputHtml, 'utf8');
}

async function runBuild() {
  try {
    await buildPlugin();
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
}

await runBuild();

if (isWatchMode) {
  let rebuildTimer;
  const scheduleBuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      void runBuild();
    }, 80);
  };

  watch(path.join(workspace, 'src'), { recursive: true }, scheduleBuild);
  watch(path.join(workspace, 'ui'), { recursive: true }, scheduleBuild);
}
