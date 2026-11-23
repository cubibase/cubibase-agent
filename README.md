# CubiBase Agent Toolkit

Public monorepo for the CubiBase agent-facing packages. CubiBase is a PostgreSQL backend platform (database, auth, REST/RPC data API, functions, storage) — these packages let AI agents and developers operate it end to end.

| Package | Purpose |
| --- | --- |
| [`@cubibasehq/client`](packages/client) | Typed TypeScript client for the Control API and project Data API. Structured errors with stable codes and `Retry-After`. |
| [`@cubibasehq/mcp`](packages/mcp) | Model Context Protocol server (stdio) with 75 tools: projects, full schema (tables, columns, policies, triggers, indexes, types, views), rows, SQL, storage uploads and signed links, function deployments/secrets/triggers, logs, Data API, and offline docs search. Read-only mode (`CUBIBASE_READ_ONLY=1`) and feature groups (`CUBIBASE_FEATURES`). |
| [`@cubibasehq/cli`](packages/cli) | `cubibase` CLI with JSON output and the same console parity, built for scripting and agents. |

## Agent skill

The canonical skill lives in **[github.com/cubibase/skills](https://github.com/cubibase/skills)** ([Agent Skills format](https://agentskills.io/specification.md)): `cubibase/SKILL.md` plus `references/` (pricing, API). The same skill ships inside `@cubibasehq/mcp` and `@cubibasehq/cli` as `SKILL.md`, and is served at <https://cubibase.com/SKILL.md>.

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
cubibase storage upload <projectId> --bucket avatars --path u1.png --file ./u1.png
cubibase functions deploy <projectId> hello
```

## Development

```bash
npm install
npm run build
npm test
npm run lint
node scripts/sync-docs.mjs   # refresh the bundled docs-search corpus from the website content
```

Docs: <https://cubibase.com/docs> · Agent guide: <https://cubibase.com/docs/agents>

MIT © CubiBase
