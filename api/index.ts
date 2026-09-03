import { handle } from 'hono/vercel';
import { createAppFromEnv } from '../src/hono.ts';

const app = createAppFromEnv(process.env);

export default handle(app);
