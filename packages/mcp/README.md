# @cubibase/mcp

Model Context Protocol server for [CubiBase](https://cubibase.com). Gives AI agents (Claude, Cursor, Codex, ...) direct access to projects, schema, rows, read-only SQL, logs, usage, and the project Data API.

## Install & run

```bash
npx -y @cubibase/mcp
```

Configuration (environment):

| Variable | Required | Meaning |
| --- | --- | --- |
| `CUBIBASE_TOKEN` | yes | Personal access token `cb_pat_...` — console → Account → Access tokens |
| `CUBIBASE_API_URL` | no | Control plane URL (default `https://api.cubibase.com`) |
| `CUBIBASE_SERVICE_KEY` | no | Project secret key `cb_sec_...` — enables Data API tools as the service actor |

### Claude Desktop / Cursor / any MCP client

```json
{
  "mcpServers": {
    "cubibase": {
      "command": "npx",
      "args": ["-y", "@cubibase/mcp"],
      "env": { "CUBIBASE_TOKEN": "cb_pat_..." }
    }
  }
}
```

## Tools

- `cubibase_list_projects`, `cubibase_get_project`, `cubibase_create_project`
- `cubibase_list_tables`, `cubibase_create_table`, `cubibase_set_exposure`, `cubibase_create_policy`
- `cubibase_list_rows`, `cubibase_insert_row`, `cubibase_run_sql` (read-only), `cubibase_create_sql_function`
- `cubibase_data_list`, `cubibase_data_rpc`, `cubibase_data_openapi` (Data API; service key)
- `cubibase_list_api_keys`, `cubibase_request_logs`, `cubibase_audit_logs`, `cubibase_usage`

Every tool returns JSON. Errors carry the engine's stable `code`, `requestId`, and `retryAfterSeconds` (on HTTP 429) so agents can recover deterministically.

## Security model

- The PAT's scope (`read`/`write`/`admin`) and optional project restriction are enforced server-side.
- Data API tools run as the service actor; **row-level security still applies**. Grant service access with a policy using `cubibase.current_role() = 'service'`.
- Secret key material is never returned by any tool.

MIT © CubiBase
