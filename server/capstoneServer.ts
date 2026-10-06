import './env.ts';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { CapstoneApplication } from './capstoneRoutes.ts';
import { send } from './courseLabHttp.ts';
const app = new CapstoneApplication(); const root = resolve(import.meta.dirname, '..', 'build'); const port = Number(process.env.PORT || 8080);
const server = createServer(async (request, response) => {
  const path = new URL(request.url!, 'http://localhost').pathname;
  if (path.startsWith('/api/capstone/') || /^\/api\/lab5[1-6]\//.test(path)) { await app.handle(request, response, path); return; }
  if (path.startsWith('/api/')) { send(response, 404, { error: 'This deployment exposes capstone routes only.' }); return; }
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(root + sep)) { send(response, 403, { error: 'Forbidden' }); return; }
  try { const data = await readFile(file); response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); response.end(data); } catch { send(response, 404, { error: 'Not found' }); }
});
server.on('error', error => { console.error(`Capstone listener failed: ${error.message}`); process.exit(1); });
server.listen(port, () => console.log(`Research workspace: http://localhost:${port}/#lab56`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { const deadline = setTimeout(() => process.exit(1), 25000); server.close(); void app.stop().finally(() => { clearTimeout(deadline); process.exit(0); }); });
