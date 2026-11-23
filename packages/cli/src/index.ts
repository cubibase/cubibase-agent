#!/usr/bin/env node
import { ControlClient, CubiBaseError } from '@cubibase/client';

const HELP = `cubibase — CubiBase CLI (JSON output; built for humans and agents)

Auth:
  CUBIBASE_TOKEN     personal access token (cb_pat_...) — create in console: Account → Access tokens
  CUBIBASE_API_URL   control plane URL (default https://api.cubibase.com)

Commands:
  whoami
  projects list
  projects get <projectId>
  projects create --name <name> [--slug <slug>]
  tables list <projectId> [--schema public]
  tables create <projectId> --name <table> --columns '<json array>' [--rls-user-column <col>]
  rows list <projectId> <table> [--limit N] [--offset N] [--order col.asc] [--filter col=op.value ...]
  rows insert <projectId> <table> --values '<json object>'
  sql <projectId> '<read-only statement>'
  rpc create <projectId> --name <fn> --return-type <type> --body '<sql>' [--args '<json array>'] [--language sql|plpgsql] [--setof] [--api-execute]
  exposure <projectId> <table> --select true|false --insert true|false --update true|false --delete true|false
  keys list <projectId>
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
    case 'rows list': {
      const filters: Record<string, string> = {};
      for (const filter of multi.filter ?? []) {
        const eq = filter.indexOf('=');
        if (eq < 1) throw new Error(`--filter expects column=op.value, got "${filter}"`);
        filters[filter.slice(0, eq)] = filter.slice(eq + 1);
      }
      result = await client.listRows(need(rest[0], 'projectId'), need(rest[1], 'table'), {
        limit: flags.limit ? Number(flags.limit) : undefined,
        offset: flags.offset ? Number(flags.offset) : undefined,
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
    case 'exposure':
      result = await client.setExposure(need(sub, 'projectId'), need(rest[0], 'table'), {
        select: boolFlag(flags, 'select'),
        insert: boolFlag(flags, 'insert'),
        update: boolFlag(flags, 'update'),
        delete: boolFlag(flags, 'delete'),
      });
      break;
    case 'keys list':
      result = await client.listApiKeys(need(rest[0], 'projectId'));
      break;
    case 'logs requests':
      result = await client.requestLogs(need(rest[0], 'projectId'), {
        status: flags.status ? Number(flags.status) : undefined,
        errorCode: flags['error-code'] as string | undefined,
        limit: flags.limit ? Number(flags.limit) : undefined,
      });
      break;
    case 'logs audit':
      result = await client.auditLogs(need(rest[0], 'projectId'), {
        action: flags.action as string | undefined,
        limit: flags.limit ? Number(flags.limit) : undefined,
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
