# @cubibasehq/cli

`cubibase` — command-line access to [CubiBase](https://cubibase.com) with JSON output, designed for scripting and AI agents. Full console parity: projects, schema (tables, columns, policies, triggers, indexes, types, views), rows, SQL, storage, functions, keys, logs.

```bash
npm install -g @cubibasehq/cli
export CUBIBASE_TOKEN=cb_pat_...   # console → Account → Access tokens
cubibase --help
```

## Examples

```bash
# Projects & schema
cubibase projects list
cubibase projects create --name "My App"
cubibase tables create <projectId> --name notes \
  --columns '[{"name":"id","type":"uuid","primaryKey":true,"default":"gen_random_uuid()"},{"name":"body","type":"text"}]'
cubibase tables add-column <projectId> notes --column '{"name":"tag","type":"text","nullable":true}'
cubibase indexes create <projectId> --table notes --name notes_body_idx --columns '[{"column":"body"}]'
cubibase views create <projectId> --name recent_notes --query 'SELECT * FROM notes' --api-select

# Rows & SQL
cubibase rows list <projectId> notes --filter status=eq.active --limit 10
cubibase rows insert <projectId> notes --values '{"body":"hello"}'
cubibase rows update <projectId> notes <rowId> --values '{"body":"edited"}'
cubibase rows delete <projectId> notes <rowId>
cubibase sql <projectId> 'select count(*) from notes'

# Storage
cubibase storage create-bucket <projectId> --name avatars --public true
cubibase storage upload <projectId> --bucket avatars --path users/u1.png --file ./u1.png
cubibase storage ls <projectId> --bucket avatars --prefix users/
cubibase storage sign <projectId> <objectId> --expires-in 600

# Functions
cubibase functions create <projectId> --name hello --file ./hello.ts
cubibase functions deploy <projectId> hello
cubibase functions secret-set <projectId> hello --name API_KEY --value sk_...
cubibase functions trigger-add <projectId> hello --kind schedule --config '{"cron":"0 * * * *"}'
cubibase functions test <projectId> hello --method POST --body '{"ping":true}'
cubibase functions executions <projectId> --status error --limit 20

# Platform
cubibase keys create <projectId> --kind secret --name backend
cubibase logs requests <projectId> --status 403 --limit 20
cubibase usage
```

Errors print `{"error":{code,message,status,retryAfterSeconds}}` to stderr and exit 1. On 429, wait `retryAfterSeconds` before retrying.

Environment: `CUBIBASE_TOKEN` (required), `CUBIBASE_API_URL` (default `https://api.cubibase.com`).

MIT © CubiBase
