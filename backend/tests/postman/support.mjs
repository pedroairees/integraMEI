import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const privateDir = resolve(root, 'tmp/postman-private');
export const artifactDir = resolve(root, 'output/testes-postman');
export const collectionDir = resolve(root, 'backend/tests/postman');
export function json(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export function read(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function configuration() {
  for (const path of ['backend/.env', 'frontend/.env.local']) {
    const file = resolve(root, path);
    if (existsSync(file)) process.loadEnvFile(file);
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const adminKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !adminKey) throw Error('Configure as variáveis Supabase no backend/.env; não coloque segredos na coleção.');
  return { url, key, adminKey };
}
export function environment(name, values) {
  return { name, values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true, type: /password|token|key/i.test(key) ? 'secret' : 'default' })), _postman_variable_scope: 'environment' };
}
