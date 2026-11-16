import { Hono } from 'hono';

const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ status: 'ok' }));

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
