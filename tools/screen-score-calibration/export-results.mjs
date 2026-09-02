import { writeFile } from 'node:fs/promises';

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function exportResults(path, report) {
  await writeFile(path, canonicalJson(report), 'utf8');
}
