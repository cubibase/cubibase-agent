# CubiBase Agent Toolkit

Public monorepo for the CubiBase agent-facing packages. CubiBase is a PostgreSQL backend platform (database, auth, REST/RPC data API, functions, storage) — these packages let AI agents and developers operate it end to end.

| Package | Purpose |
| --- | --- |
| [`@cubibasehq/client`](packages/client) | Typed TypeScript client for the Control API and project Data API. Structured errors with stable codes and `Retry-After`. |
| [`@cubibasehq/mcp`](packages/mcp) | Model Context Protocol server (stdio) exposing projects, schema, rows, SQL, logs, and Data API tools. |
| [`@cubibasehq/cli`](packages/cli) | `cubibase` CLI with JSON output, built for scripting and agents. |

## Authentication

Create a **personal access token** (`cb_pat_...`) in the console under **Account → Access tokens** (scopes: `read` < `write` < `admin`, optional project restriction and expiry). Use it as `Authorization: Bearer` on the Control API.

For Data API access as a trusted server, create a **secret key** (`cb_sec_...`) under the project's API keys. It acts as the service actor (`cubibase.role = 'service'`); row-level security still applies — grant access with policies like `cubibase.current_role() = 'service'`.

## MCP quick start

```json
{
  "mcpServers": {
    "cubibase": {
      "command": "npx",
      "args": ["-y", "@cubibasehq/mcp"],
      "env": {
        "CUBIBASE_TOKEN": "cb_pat_...",
        "CUBIBASE_SERVICE_KEY": "cb_sec_... (optional, enables Data API tools)"
      }
    }
  }
}
```

## CLI quick start

```bash
npm install -g @cubibasehq/cli
export CUBIBASE_TOKEN=cb_pat_...
cubibase projects list
cubibase tables list <projectId>
cubibase rows list <projectId> notes --filter status=eq.active --limit 10
cubibase sql <projectId> 'select count(*) from notes'
```

## Development

```bash
npm install
npm run build
npm test
```

Docs: <https://cubibase.com/docs> · Agent guide: <https://cubibase.com/docs/agents>

MIT © CubiBase
