import { configuration } from './support.mjs';
import { buildApp } from '../../src/web/app.ts';
import { createSessionResolver } from '../../src/infra/supabase/session.ts';
const { url, key } = configuration();
const app = await buildApp(createSessionResolver(url, key));
await app.listen({ port: 3338, host: '127.0.0.1' });
console.log('Backend de teste em http://127.0.0.1:3338, conectado ao Supabase configurado.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close());
