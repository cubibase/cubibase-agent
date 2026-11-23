# @cubibasehq/cli

`cubibase` — command-line access to [CubiBase](https://cubibase.com) with JSON output, designed for scripting and AI agents.

```bash
npm install -g @cubibasehq/cli
export CUBIBASE_TOKEN=cb_pat_...   # console → Account → Access tokens
cubibase --help
```

## Examples

```bash
cubibase projects list
cubibase projects create --name "My App"
cubibase tables list <projectId>
cubibase tables create <projectId> --name notes \
  --columns '[{"name":"id","type":"uuid","primaryKey":true,"default":"gen_random_uuid()"},{"name":"body","type":"text"}]'
cubibase rows list <projectId> notes --filter status=eq.active --limit 10
cubibase rows insert <projectId> notes --values '{"body":"hello"}'
cubibase sql <projectId> 'select count(*) from notes'
cubibase logs requests <projectId> --status 403 --limit 20
cubibase usage
```

Errors print `{"error":{code,message,status,retryAfterSeconds}}` to stderr and exit 1. On 429, wait `retryAfterSeconds` before retrying.

Environment: `CUBIBASE_TOKEN` (required), `CUBIBASE_API_URL` (default `https://api.cubibase.com`).

MIT © CubiBase
