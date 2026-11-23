# @cubibase/client

Typed TypeScript client for the [CubiBase](https://cubibase.com) Control API and project Data API. Zero dependencies beyond `fetch` (Node 20+).

```bash
npm install @cubibase/client
```

```ts
import { ControlClient, DataClient, CubiBaseError } from '@cubibase/client';

const control = new ControlClient({ token: process.env.CUBIBASE_TOKEN });
const { projects } = await control.listProjects();

const data = new DataClient({
  baseUrl: 'https://my-app.api.cubibase.com',
  publishableKey: 'cb_pub_...',
  token: 'cb_sec_...', // service actor; RLS applies
});
const notes = await data.list('notes', { filters: { status: 'eq.active' }, limit: 10 });
const total = await data.rpc<number>('count_notes');

try {
  await control.runSql(projects[0].id, 'delete from notes');
} catch (err) {
  if (err instanceof CubiBaseError && err.retryable) {
    // wait err.retryAfterSeconds, then retry
  }
}
```

Every non-2xx response throws `CubiBaseError` with `status`, `code` (stable machine identifier), `requestId`, and `retryAfterSeconds`.

MIT © CubiBase
