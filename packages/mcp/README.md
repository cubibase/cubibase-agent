# @cubibasehq/mcp

Model Context Protocol server for [CubiBase](https://cubibase.com). Gives AI agents (Claude, Cursor, Codex, ...) console-grade access: projects, full schema management (tables, columns, policies, triggers, indexes, types, views), rows, read-only SQL, storage (buckets, uploads, signed links), serverless functions (deploy, secrets, triggers, logs), the project Data API, and offline docs search.

## Install & run

```bash
npx -y @cubibasehq/mcp
```

Configuration (environment):

| Variable | Required | Meaning |
| --- | --- | --- |
| `CUBIBASE_TOKEN` | yes | Personal access token `cb_pat_...` — console → Account → Access tokens |
| `CUBIBASE_API_URL` | no | Control plane URL (default `https://api.cubibase.com`) |
| `CUBIBASE_SERVICE_KEY` | no | Project secret key `cb_sec_...` — enables Data API tools as the service actor |
| `CUBIBASE_READ_ONLY` | no | `1` hides every mutating tool (safe exploration mode) |
| `CUBIBASE_FEATURES` | no | Comma-separated tool groups: `projects,database,storage,functions,data,observability,docs` (default: all) |

### Claude Desktop / Cursor / any MCP client

```json
{
  "mcpServers": {
    "cubibase": {
      "command": "npx",
      "args": ["-y", "@cubibasehq/mcp"],
      "env": { "CUBIBASE_TOKEN": "cb_pat_..." }
    }
  }
}
```

Read-only inspection agent (no writes are even advertised):

```json
{
  "mcpServers": {
    "cubibase": {
      "command": "npx",
      "args": ["-y", "@cubibasehq/mcp"],
      "env": { "CUBIBASE_TOKEN": "cb_pat_...", "CUBIBASE_READ_ONLY": "1" }
    }
  }
}
```

## Tools (75)

**Projects** — `cubibase_list_projects`, `cubibase_get_project`, `cubibase_create_project`, `cubibase_update_project`, `cubibase_delete_project`

**Database** — `cubibase_list_tables`, `cubibase_create_table`, `cubibase_add_column`, `cubibase_drop_column`, `cubibase_set_exposure`, `cubibase_list_policies`, `cubibase_create_policy`, `cubibase_drop_policy`, `cubibase_list_db_triggers`, `cubibase_create_db_trigger`, `cubibase_set_db_trigger_enabled`, `cubibase_drop_db_trigger`, `cubibase_list_indexes`, `cubibase_create_index`, `cubibase_drop_index`, `cubibase_list_types`, `cubibase_create_enum_type`, `cubibase_create_composite_type`, `cubibase_add_enum_label`, `cubibase_drop_type`, `cubibase_list_views`, `cubibase_create_view`, `cubibase_refresh_view`, `cubibase_drop_view`, `cubibase_list_rows`, `cubibase_insert_row`, `cubibase_update_row`, `cubibase_delete_row`, `cubibase_run_sql` (read-only), `cubibase_create_sql_function`, `cubibase_drop_sql_function`

**Storage** — `cubibase_storage_usage`, `cubibase_list_buckets`, `cubibase_create_bucket`, `cubibase_update_bucket`, `cubibase_delete_bucket`, `cubibase_list_objects`, `cubibase_upload_file` (end-to-end: reserve → presigned S3 POST → complete; text or base64), `cubibase_create_upload_url` (presigned POST for large out-of-band uploads), `cubibase_complete_upload`, `cubibase_delete_object`, `cubibase_sign_object_url`

**Functions** — `cubibase_function_templates`, `cubibase_functions_usage`, `cubibase_list_functions`, `cubibase_get_function`, `cubibase_create_function`, `cubibase_update_function`, `cubibase_delete_function`, `cubibase_deploy_function`, `cubibase_list_deployments`, `cubibase_activate_deployment`, `cubibase_set_function_secret`, `cubibase_delete_function_secret`, `cubibase_create_function_trigger`, `cubibase_update_function_trigger`, `cubibase_delete_function_trigger`, `cubibase_test_function`, `cubibase_function_executions`, `cubibase_function_execution`

**Data API** (service key) — `cubibase_data_list`, `cubibase_data_rpc`, `cubibase_data_openapi`

**Observability** — `cubibase_list_api_keys`, `cubibase_create_api_key`, `cubibase_revoke_api_key`, `cubibase_request_logs`, `cubibase_audit_logs`, `cubibase_usage`

**Docs** — `cubibase_search_docs` (offline ranked search over the bundled cubibase.com documentation; returns excerpts + URLs, fetch `{url}.md` for full pages)

Every tool returns JSON. Errors carry the engine's stable `code`, `requestId`, and `retryAfterSeconds` (on HTTP 429) so agents can recover deterministically.

## Security model

- The PAT's scope (`read`/`write`/`admin`) and optional project restriction are enforced server-side.
- `CUBIBASE_READ_ONLY=1` removes mutating tools from the tool list entirely — defense in depth on top of a read-scope token.
- `CUBIBASE_FEATURES` narrows the surface (e.g. `database,docs` for a schema-only assistant).
- Data API tools run as the service actor; **row-level security still applies**. Grant service access with a policy using `cubibase.current_role() = 'service'`.
- Secret key material is never returned by any tool.

MIT © CubiBase
