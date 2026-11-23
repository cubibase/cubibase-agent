#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ControlClient, CubiBaseError } from '@cubibasehq/client';

const HELP = `cubibase — CubiBase CLI (JSON output; built for humans and agents)

Auth:
  CUBIBASE_TOKEN     personal access token (cb_pat_...) — create in console: Account → Access tokens
  CUBIBASE_API_URL   control plane URL (default https://api.cubibase.com)

Projects:
  whoami
  projects list
  projects get <projectId>
  projects create --name <name> [--slug <slug>]
  projects update <projectId> [--name <name>] [--region <region>]

Database:
  tables list <projectId> [--schema public]
  tables create <projectId> --name <table> --columns '<json array>' [--rls-user-column <col>]
  tables add-column <projectId> <table> --column '<json object>'
  tables drop-column <projectId> <table> <column>
  rows list <projectId> <table> [--limit N] [--offset N] [--order col.asc] [--filter col=op.value ...]
  rows insert <projectId> <table> --values '<json object>'
  rows update <projectId> <table> <id> --values '<json object>'
  rows delete <projectId> <table> <id>
  sql <projectId> '<read-only statement>'
  rpc create <projectId> --name <fn> --return-type <type> --body '<sql>' [--args '<json array>'] [--language sql|plpgsql] [--setof] [--api-execute]
  rpc drop <projectId> <name> [--args 'integer, text']
  exposure <projectId> <table> --select true|false --insert true|false --update true|false --delete true|false
  policies list <projectId>
  policies create <projectId> --table <t> --name <p> [--command SELECT] [--using '<expr>'] [--with-check '<expr>']
  policies drop <projectId> <table> <policy>
  triggers list <projectId>
  triggers create <projectId> --table <t> --name <tr> --events INSERT,UPDATE --function <fn> [--timing BEFORE|AFTER] [--level ROW|STATEMENT]
  triggers enable <projectId> <table> <trigger> --enabled true|false
  triggers drop <projectId> <table> <trigger>
  indexes list <projectId>
  indexes create <projectId> --table <t> --name <idx> [--columns '<json array>'] [--method btree] [--unique] [--expression '<expr>'] [--where '<expr>']
  indexes drop <projectId> <name>
  types list <projectId>
  types enum <projectId> --name <type> --labels a,b,c
  types composite <projectId> --name <type> --attributes '<json array>'
  types add-label <projectId> <type> --label <label> [--before <l>] [--after <l>]
  types drop <projectId> <name>
  views list <projectId>
  views create <projectId> --name <view> --query '<select>' [--materialized] [--replace] [--api-select]
  views refresh <projectId> <name>
  views drop <projectId> <name>

Storage:
  storage usage <projectId>
  storage buckets <projectId>
  storage create-bucket <projectId> --name <bucket> [--public true|false] [--size-limit N] [--mime-types '["image/png"]']
  storage update-bucket <projectId> <bucket> [--public true|false] [--size-limit N] [--mime-types '<json array>']
  storage delete-bucket <projectId> <bucket>
  storage ls <projectId> --bucket <bucket> [--prefix p] [--search s] [--limit N] [--offset N]
  storage upload <projectId> --bucket <bucket> --path <object/path> --file <local file> [--mime-type t] [--overwrite]
  storage rm <projectId> <objectId>
  storage sign <projectId> <objectId> [--expires-in N]

Functions:
  functions templates
  functions usage <projectId>
  functions list <projectId>
  functions get <projectId> <idOrName>
  functions create <projectId> --name <fn> [--file <source.ts>] [--source '<code>'] [--template <id>] [--language typescript|javascript] [--http-auth public|jwt|api_key|internal] [--timeout N] [--memory N]
  functions update <projectId> <idOrName> [--file <source.ts>] [--source '<code>'] [--enabled true|false] [--http-auth ...] [--timeout N] [--memory N]
  functions delete <projectId> <idOrName>
  functions deploy <projectId> <idOrName>
  functions deployments <projectId> <idOrName>
  functions activate <projectId> <idOrName> <deploymentId>
  functions secret-set <projectId> <idOrName> --name <NAME> --value <value>
  functions secret-rm <projectId> <idOrName> <name>
  functions trigger-add <projectId> <idOrName> --kind http|database|storage|schedule [--config '<json>'] [--enabled true|false]
  functions trigger-update <projectId> <idOrName> <triggerId> [--config '<json>'] [--enabled true|false]
  functions trigger-rm <projectId> <idOrName> <triggerId>
  functions test <projectId> <idOrName> [--method POST] [--path ''] [--headers '<json>'] [--body '<string>'] [--event '<json>']
  functions executions <projectId> [--function-id id] [--trigger kind] [--status s] [--limit N]
  functions execution <projectId> <executionId>

Platform:
  keys list <projectId>
  keys create <projectId> --kind publishable|secret [--name n]
  keys revoke <projectId> <keyId>
  logs requests <projectId> [--status N] [--error-code code] [--limit N]
  logs audit <projectId> [--action name] [--limit N]
  usage
  tokens list                       (requires an interactive session JWT, not a PAT)

Errors print JSON {"error":{code,message,status,retryAfterSeconds}} to stderr; exit code 1.
On 429, wait retryAfterSeconds before retrying.
`;

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
  multi: Record<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const multi: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
        if (key === 'filter') (multi.filter ??= []).push(next);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, multi };
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`Missing ${what}. Run "cubibase --help".`);
  return value;
}

function jsonFlag(flags: ParsedArgs['flags'], key: string): unknown {
  const raw = flags[key];
  if (typeof raw !== 'string') throw new Error(`--${key} expects a JSON value`);
  return JSON.parse(raw);
}

function boolFlag(flags: ParsedArgs['flags'], key: string, fallback = false): boolean {
  const raw = flags[key];
  if (raw === undefined) return fallback;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  throw new Error(`--${key} expects true or false`);
}

function numFlag(flags: ParsedArgs['flags'], key: string): number | undefined {
  const raw = flags[key];
  if (raw === undefined || raw === true) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} expects a number`);
  return value;
}

function sourceFlag(flags: ParsedArgs['flags']): string | undefined {
  if (typeof flags.file === 'string') return readFileSync(flags.file, 'utf8');
  if (typeof flags.source === 'string') return flags.source;
  return undefined;
}

const MIME_BY_EXT: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.zip': 'application/zip', '.wasm': 'application/wasm',
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  const token = process.env.CUBIBASE_TOKEN;
  if (!token) {
    throw new Error('CUBIBASE_TOKEN is required. Create a personal access token in the console (Account → Access tokens).');
  }
  const client = new ControlClient({ baseUrl: process.env.CUBIBASE_API_URL, token });
  const { positional, flags, multi } = parseArgs(argv);
  const [command, sub, ...rest] = positional;

  let result: unknown;
  switch (`${command} ${sub ?? ''}`.trim()) {
    case 'whoami':
      result = await client.me();
      break;

    // ---- Projects ----
    case 'projects list':
      result = await client.listProjects();
      break;
    case 'projects get':
      result = await client.getProject(need(rest[0], 'projectId'));
      break;
    case 'projects create':
      result = await client.createProject({
        name: need(flags.name as string | undefined, '--name'),
        slug: flags.slug as string | undefined,
      });
      break;
    case 'projects update':
      result = await client.updateProject(need(rest[0], 'projectId'), {
        name: flags.name as string | undefined,
        region: flags.region as string | undefined,
      });
      break;

    // ---- Tables & columns ----
    case 'tables list':
      result = await client.listTables(need(rest[0], 'projectId'), (flags.schema as string) ?? 'public');
      break;
    case 'tables create':
      result = await client.createTable(need(rest[0], 'projectId'), {
        name: need(flags.name as string | undefined, '--name'),
        columns: jsonFlag(flags, 'columns') as Array<{ name: string; type: string }>,
        rlsUserColumn: flags['rls-user-column'] as string | undefined,
      });
      break;
    case 'tables add-column':
      result = await client.addColumn(
        need(rest[0], 'projectId'),
        need(rest[1], 'table'),
        jsonFlag(flags, 'column') as { name: string; type: string },
      );
      break;
    case 'tables drop-column':
      await client.dropColumn(need(rest[0], 'projectId'), need(rest[1], 'table'), need(rest[2], 'column'));
      result = { dropped: true };
      break;

    // ---- Rows & SQL ----
    case 'rows list': {
      const filters: Record<string, string> = {};
      for (const filter of multi.filter ?? []) {
        const eq = filter.indexOf('=');
        if (eq < 1) throw new Error(`--filter expects column=op.value, got "${filter}"`);
        filters[filter.slice(0, eq)] = filter.slice(eq + 1);
      }
      result = await client.listRows(need(rest[0], 'projectId'), need(rest[1], 'table'), {
        limit: numFlag(flags, 'limit'),
        offset: numFlag(flags, 'offset'),
        order: flags.order as string | undefined,
        ...filters,
      });
      break;
    }
    case 'rows insert':
      result = await client.insertRow(
        need(rest[0], 'projectId'),
        need(rest[1], 'table'),
        jsonFlag(flags, 'values') as Record<string, unknown>,
      );
      break;
    case 'rows update':
      result = await client.updateRow(
        need(rest[0], 'projectId'),
        need(rest[1], 'table'),
        need(rest[2], 'row id'),
        jsonFlag(flags, 'values') as Record<string, unknown>,
      );
      break;
    case 'rows delete':
      result = await client.deleteRow(need(rest[0], 'projectId'), need(rest[1], 'table'), need(rest[2], 'row id'));
      break;
    case 'sql':
      result = await client.runSql(need(sub, 'projectId'), need(rest.join(' '), 'SQL statement'));
      break;
    case 'rpc create':
      result = await client.createSqlFunction(need(sub, 'projectId'), {
        name: need(flags.name as string | undefined, '--name'),
        returnType: need(flags['return-type'] as string | undefined, '--return-type'),
        body: need(flags.body as string | undefined, '--body'),
        arguments: flags.args ? (jsonFlag(flags, 'args') as Array<{ name: string; type: string }>) : undefined,
        language: flags.language as 'sql' | 'plpgsql' | undefined,
        returnsSetof: boolFlag(flags, 'setof'),
        apiExecute: boolFlag(flags, 'api-execute'),
      });
      break;
    case 'rpc drop':
      await client.dropSqlFunction(need(sub, 'projectId'), need(rest[0], 'function name'), flags.args as string | undefined);
      result = { dropped: true };
      break;
    case 'exposure':
      result = await client.setExposure(need(sub, 'projectId'), need(rest[0], 'table'), {
        select: boolFlag(flags, 'select'),
        insert: boolFlag(flags, 'insert'),
        update: boolFlag(flags, 'update'),
        delete: boolFlag(flags, 'delete'),
      });
      break;

    // ---- Policies ----
    case 'policies list':
      result = await client.listPolicies(need(rest[0], 'projectId'));
      break;
    case 'policies create':
      result = await client.createPolicy(need(rest[0], 'projectId'), {
        table: need(flags.table as string | undefined, '--table'),
        name: need(flags.name as string | undefined, '--name'),
        command: flags.command as string | undefined,
        using: flags.using as string | undefined,
        withCheck: flags['with-check'] as string | undefined,
      });
      break;
    case 'policies drop':
      await client.dropPolicy(need(rest[0], 'projectId'), need(rest[1], 'table'), need(rest[2], 'policy'));
      result = { dropped: true };
      break;

    // ---- Database triggers ----
    case 'triggers list':
      result = await client.listDbTriggers(need(rest[0], 'projectId'));
      break;
    case 'triggers create':
      result = await client.createDbTrigger(need(rest[0], 'projectId'), {
        table: need(flags.table as string | undefined, '--table'),
        name: need(flags.name as string | undefined, '--name'),
        events: need(flags.events as string | undefined, '--events').split(',') as Array<'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'>,
        function: need(flags.function as string | undefined, '--function'),
        timing: flags.timing as 'BEFORE' | 'AFTER' | 'INSTEAD OF' | undefined,
        level: flags.level as 'ROW' | 'STATEMENT' | undefined,
        when: flags.when as string | undefined,
      });
      break;
    case 'triggers enable':
      result = await client.setDbTriggerEnabled(
        need(rest[0], 'projectId'), need(rest[1], 'table'), need(rest[2], 'trigger'), boolFlag(flags, 'enabled', true),
      );
      break;
    case 'triggers drop':
      await client.dropDbTrigger(need(rest[0], 'projectId'), need(rest[1], 'table'), need(rest[2], 'trigger'));
      result = { dropped: true };
      break;

    // ---- Indexes ----
    case 'indexes list':
      result = await client.listIndexes(need(rest[0], 'projectId'));
      break;
    case 'indexes create':
      result = await client.createIndex(need(rest[0], 'projectId'), {
        table: need(flags.table as string | undefined, '--table'),
        name: need(flags.name as string | undefined, '--name'),
        columns: flags.columns ? (jsonFlag(flags, 'columns') as Array<{ column: string }>) : undefined,
        method: flags.method as string | undefined,
        unique: boolFlag(flags, 'unique'),
        expression: flags.expression as string | undefined,
        where: flags.where as string | undefined,
      });
      break;
    case 'indexes drop':
      await client.dropIndex(need(rest[0], 'projectId'), need(rest[1], 'index name'));
      result = { dropped: true };
      break;

    // ---- Types ----
    case 'types list':
      result = await client.listTypes(need(rest[0], 'projectId'));
      break;
    case 'types enum':
      result = await client.createEnumType(need(rest[0], 'projectId'), {
        name: need(flags.name as string | undefined, '--name'),
        labels: need(flags.labels as string | undefined, '--labels').split(','),
      });
      break;
    case 'types composite':
      result = await client.createCompositeType(need(rest[0], 'projectId'), {
        name: need(flags.name as string | undefined, '--name'),
        attributes: jsonFlag(flags, 'attributes') as Array<{ name: string; type: string }>,
      });
      break;
    case 'types add-label':
      result = await client.addTypeLabel(need(rest[0], 'projectId'), need(rest[1], 'type name'), {
        label: need(flags.label as string | undefined, '--label'),
        before: flags.before as string | undefined,
        after: flags.after as string | undefined,
      });
      break;
    case 'types drop':
      await client.dropType(need(rest[0], 'projectId'), need(rest[1], 'type name'));
      result = { dropped: true };
      break;

    // ---- Views ----
    case 'views list':
      result = await client.listViews(need(rest[0], 'projectId'));
      break;
    case 'views create':
      result = await client.createView(need(rest[0], 'projectId'), {
        name: need(flags.name as string | undefined, '--name'),
        query: need(flags.query as string | undefined, '--query'),
        materialized: boolFlag(flags, 'materialized'),
        replace: boolFlag(flags, 'replace'),
        apiSelect: boolFlag(flags, 'api-select'),
      });
      break;
    case 'views refresh':
      result = await client.refreshView(need(rest[0], 'projectId'), need(rest[1], 'view name'));
      break;
    case 'views drop':
      await client.dropView(need(rest[0], 'projectId'), need(rest[1], 'view name'));
      result = { dropped: true };
      break;

    // ---- Storage ----
    case 'storage usage':
      result = await client.storageUsage(need(rest[0], 'projectId'));
      break;
    case 'storage buckets':
      result = await client.listBuckets(need(rest[0], 'projectId'));
      break;
    case 'storage create-bucket':
      result = await client.createBucket(need(rest[0], 'projectId'), {
        name: need(flags.name as string | undefined, '--name'),
        public: boolFlag(flags, 'public'),
        fileSizeLimitBytes: numFlag(flags, 'size-limit'),
        allowedMimeTypes: flags['mime-types'] ? (jsonFlag(flags, 'mime-types') as string[]) : undefined,
      });
      break;
    case 'storage update-bucket':
      result = await client.updateBucket(need(rest[0], 'projectId'), need(rest[1], 'bucket'), {
        ...(flags.public !== undefined ? { public: boolFlag(flags, 'public') } : {}),
        ...(flags['size-limit'] !== undefined ? { fileSizeLimitBytes: numFlag(flags, 'size-limit') } : {}),
        ...(flags['mime-types'] !== undefined ? { allowedMimeTypes: jsonFlag(flags, 'mime-types') as string[] } : {}),
      });
      break;
    case 'storage delete-bucket':
      result = await client.deleteBucket(need(rest[0], 'projectId'), need(rest[1], 'bucket'));
      break;
    case 'storage ls':
      result = await client.listObjects(need(rest[0], 'projectId'), {
        bucket: need(flags.bucket as string | undefined, '--bucket'),
        prefix: flags.prefix as string | undefined,
        search: flags.search as string | undefined,
        limit: numFlag(flags, 'limit'),
        offset: numFlag(flags, 'offset'),
      });
      break;
    case 'storage upload': {
      const file = need(flags.file as string | undefined, '--file');
      const content = new Uint8Array(readFileSync(file));
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
      result = await client.uploadFile(need(rest[0], 'projectId'), {
        bucket: need(flags.bucket as string | undefined, '--bucket'),
        path: need(flags.path as string | undefined, '--path'),
        content,
        mimeType: (flags['mime-type'] as string | undefined) ?? MIME_BY_EXT[ext] ?? 'application/octet-stream',
        fileName: basename(file),
        overwrite: boolFlag(flags, 'overwrite'),
      });
      break;
    }
    case 'storage rm':
      result = await client.deleteObject(need(rest[0], 'projectId'), need(rest[1], 'objectId'));
      break;
    case 'storage sign':
      result = await client.signObjectUrl(need(rest[0], 'projectId'), need(rest[1], 'objectId'), numFlag(flags, 'expires-in'));
      break;

    // ---- Functions ----
    case 'functions templates':
      result = await client.functionTemplates();
      break;
    case 'functions usage':
      result = await client.functionsUsage(need(rest[0], 'projectId'));
      break;
    case 'functions list':
      result = await client.listFunctions(need(rest[0], 'projectId'));
      break;
    case 'functions get':
      result = await client.getFunction(need(rest[0], 'projectId'), need(rest[1], 'function id or name'));
      break;
    case 'functions create':
      result = await client.createFunction(need(rest[0], 'projectId'), {
        name: need(flags.name as string | undefined, '--name'),
        description: flags.description as string | undefined,
        language: flags.language as 'typescript' | 'javascript' | undefined,
        sourceCode: sourceFlag(flags),
        templateId: flags.template as string | undefined,
        httpAuthMode: flags['http-auth'] as 'public' | 'jwt' | 'api_key' | 'internal' | undefined,
        timeoutSeconds: numFlag(flags, 'timeout'),
        memoryMb: numFlag(flags, 'memory'),
      });
      break;
    case 'functions update':
      result = await client.updateFunction(need(rest[0], 'projectId'), need(rest[1], 'function id or name'), {
        description: flags.description as string | undefined,
        language: flags.language as 'typescript' | 'javascript' | undefined,
        sourceCode: sourceFlag(flags),
        ...(flags.enabled !== undefined ? { enabled: boolFlag(flags, 'enabled') } : {}),
        httpAuthMode: flags['http-auth'] as 'public' | 'jwt' | 'api_key' | 'internal' | undefined,
        timeoutSeconds: numFlag(flags, 'timeout'),
        memoryMb: numFlag(flags, 'memory'),
      });
      break;
    case 'functions delete':
      result = await client.deleteFunction(need(rest[0], 'projectId'), need(rest[1], 'function id or name'));
      break;
    case 'functions deploy':
      result = await client.deployFunction(need(rest[0], 'projectId'), need(rest[1], 'function id or name'));
      break;
    case 'functions deployments':
      result = await client.listDeployments(need(rest[0], 'projectId'), need(rest[1], 'function id or name'));
      break;
    case 'functions activate':
      result = await client.activateDeployment(need(rest[0], 'projectId'), need(rest[1], 'function id or name'), need(rest[2], 'deploymentId'));
      break;
    case 'functions secret-set':
      result = await client.setFunctionSecret(
        need(rest[0], 'projectId'), need(rest[1], 'function id or name'),
        need(flags.name as string | undefined, '--name'), need(flags.value as string | undefined, '--value'),
      );
      break;
    case 'functions secret-rm':
      result = await client.deleteFunctionSecret(need(rest[0], 'projectId'), need(rest[1], 'function id or name'), need(rest[2], 'secret name'));
      break;
    case 'functions trigger-add':
      result = await client.createFunctionTrigger(need(rest[0], 'projectId'), need(rest[1], 'function id or name'), {
        kind: need(flags.kind as string | undefined, '--kind') as 'http' | 'database' | 'storage' | 'schedule',
        enabled: flags.enabled !== undefined ? boolFlag(flags, 'enabled') : undefined,
        config: flags.config ? (jsonFlag(flags, 'config') as Record<string, unknown>) : undefined,
      });
      break;
    case 'functions trigger-update':
      result = await client.updateFunctionTrigger(
        need(rest[0], 'projectId'), need(rest[1], 'function id or name'), need(rest[2], 'triggerId'),
        {
          ...(flags.enabled !== undefined ? { enabled: boolFlag(flags, 'enabled') } : {}),
          ...(flags.config !== undefined ? { config: jsonFlag(flags, 'config') as Record<string, unknown> } : {}),
        },
      );
      break;
    case 'functions trigger-rm':
      result = await client.deleteFunctionTrigger(need(rest[0], 'projectId'), need(rest[1], 'function id or name'), need(rest[2], 'triggerId'));
      break;
    case 'functions test':
      result = await client.testFunction(need(rest[0], 'projectId'), need(rest[1], 'function id or name'), {
        method: flags.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined,
        path: flags.path as string | undefined,
        headers: flags.headers ? (jsonFlag(flags, 'headers') as Record<string, string>) : undefined,
        body: flags.body as string | undefined,
        event: flags.event ? (jsonFlag(flags, 'event') as Record<string, unknown>) : undefined,
      });
      break;
    case 'functions executions':
      result = await client.functionExecutions(need(rest[0], 'projectId'), {
        functionId: flags['function-id'] as string | undefined,
        trigger: flags.trigger as string | undefined,
        status: flags.status as string | undefined,
        limit: numFlag(flags, 'limit'),
        offset: numFlag(flags, 'offset'),
      });
      break;
    case 'functions execution':
      result = await client.functionExecution(need(rest[0], 'projectId'), need(rest[1], 'executionId'));
      break;

    // ---- Platform ----
    case 'keys list':
      result = await client.listApiKeys(need(rest[0], 'projectId'));
      break;
    case 'keys create':
      result = await client.createApiKey(
        need(rest[0], 'projectId'),
        need(flags.kind as string | undefined, '--kind') as 'publishable' | 'secret',
        (flags.name as string | undefined) ?? 'secret',
      );
      break;
    case 'keys revoke':
      await client.revokeApiKey(need(rest[0], 'projectId'), need(rest[1], 'keyId'));
      result = { revoked: true };
      break;
    case 'logs requests':
      result = await client.requestLogs(need(rest[0], 'projectId'), {
        status: numFlag(flags, 'status'),
        errorCode: flags['error-code'] as string | undefined,
        limit: numFlag(flags, 'limit'),
      });
      break;
    case 'logs audit':
      result = await client.auditLogs(need(rest[0], 'projectId'), {
        action: flags.action as string | undefined,
        limit: numFlag(flags, 'limit'),
      });
      break;
    case 'usage':
      result = await client.usage();
      break;
    case 'tokens list':
      result = await client.listAccessTokens();
      break;
    default:
      throw new Error(`Unknown command "${positional.join(' ')}". Run "cubibase --help".`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((err: unknown) => {
  const payload = err instanceof CubiBaseError
    ? { error: err.toJSON() }
    : { error: { code: 'cli_error', message: err instanceof Error ? err.message : String(err) } };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
});
