# @cubibasehq/client

Typed TypeScript client for the [CubiBase](https://cubibase.com) Control API and project Data API. Zero dependencies beyond `fetch` (Node 20+).

```bash
npm install @cubibasehq/client
```

```ts
import { ControlClient, DataClient, CubiBaseError } from '@cubibasehq/client';

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

## ControlClient surface

- **Projects**: `listProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject`, `provisioning`
- **Schema**: `listTables`, `createTable`, `addColumn`, `dropColumn`, `setExposure`, `listPolicies`, `createPolicy`, `dropPolicy`
- **Database objects**: `listDbTriggers`/`createDbTrigger`/`setDbTriggerEnabled`/`dropDbTrigger`, `listIndexes`/`createIndex`/`dropIndex`, `listTypes`/`createEnumType`/`createCompositeType`/`addTypeLabel`/`renameTypeLabel`/`dropType`, `listViews`/`createView`/`setViewApiAccess`/`refreshView`/`dropView`
- **Rows & SQL** (console-grade sql role): `listRows`, `insertRow`, `updateRow`, `deleteRow`, `runSql` (read-only), `createSqlFunction`, `dropSqlFunction`
- **Storage**: `listBuckets`/`createBucket`/`updateBucket`/`deleteBucket`, `listObjects`, `deleteObject`, `createUpload` (presigned S3 POST), `completeUpload`, `signObjectUrl`, `storageUsage`, and `uploadFile` — end-to-end upload (reserve → S3 POST → complete) for `Uint8Array`/string content
- **Functions**: `listFunctions`/`getFunction`/`createFunction`/`updateFunction`/`deleteFunction`, `deployFunction`/`listDeployments`/`activateDeployment`, `setFunctionSecret`/`deleteFunctionSecret`, `createFunctionTrigger`/`updateFunctionTrigger`/`deleteFunctionTrigger`, `testFunction`, `functionExecutions`/`functionExecution`, `functionTemplates`, `functionsUsage`
- **Platform**: `listApiKeys`/`createApiKey`/`revokeApiKey`, `requestLogs`, `auditLogs`, `usage`, `listAccessTokens`/`createAccessToken`/`revokeAccessToken`, `me`

MIT © CubiBase
