/**
 * Command-line bridge: Firebase RTDB export JSON -> canonical bridge envelope.
 *
 * Ported from `rtdb_bridge/__main__.py`. This entry point exists so a
 * non-TypeScript host (a shell pipeline, a CI job, another process) can use
 * the bridge over stdin/stdout.
 *
 * ```
 * rtdb-bridge --database-name demo < export.json > envelope.json
 * rtdb-bridge -i export.json -o envelope.json --no-validate
 * node dist/src/rtdb_bridge/cli.js --version
 * ```
 *
 * Stdout carries *only* the envelope JSON so a caller can `JSON.parse` it
 * directly; every diagnostic goes to stderr.
 *
 * Exit codes:
 *   0   envelope written to stdout/output file
 *   1   bad usage, unreadable input, or invalid input JSON
 *   2   the bridge failed while converting the export
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  isPlainObject,
  type JsonObject,
} from '../relationalize/relationalize.js';

import { convertExportToEnvelope } from './envelope.js';
import { version } from './version.js';

export interface CliOptions {
  input?: string;
  output?: string;
  databaseName: string;
  sourceName?: string;
  knownFields?: string;
  indent: number;
  noValidate: boolean;
}

type Parsed =
  | { kind: 'run'; options: CliOptions }
  | { kind: 'help' }
  | { kind: 'version' };

export const HELP_TEXT = `usage: rtdb-bridge [-h] [-i FILE] [-o FILE]
                        [--database-name NAME] [--source-name NAME]
                        [--known-fields a,b,c] [--indent N] [--no-validate]
                        [--version]

Convert a Firebase Realtime Database export JSON into the canonical
rtdb-bridge envelope (database + tree + sql).

options:
  -h, --help            show this help message and exit
  -i, --input FILE      RTDB export JSON file. Defaults to stdin.
  -o, --output FILE     Write the envelope here. Defaults to stdout.
  --database-name NAME  Display name for the database/canvas root
                        (default: rtdb_to_sql).
  --source-name NAME    Original export/database name recorded in source
                        (default: the database name).
  --known-fields a,b,c  Comma-separated field names that are keyed maps (RTDB
                        sub-collections keyed by business ids).
  --indent N            JSON indentation. 0 emits compact JSON (default: 2).
  --no-validate         Skip JSON-schema validation of the produced envelope.
  --version             show program's version number and exit
`;

/** Parse argv. Throws an Error with a usage message on bad input. */
export function parseArgs(argv: readonly string[]): Parsed {
  const options: CliOptions = {
    databaseName: 'rtdb_to_sql',
    indent: 2,
    noValidate: false,
  };

  const takeValue = (flag: string, next: string | undefined): string => {
    if (next === undefined) {
      throw new Error(`argument ${flag}: expected one argument`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        return { kind: 'help' };
      case '--version':
        return { kind: 'version' };
      case '-i':
      case '--input':
        options.input = takeValue(arg, argv[++i]);
        break;
      case '-o':
      case '--output':
        options.output = takeValue(arg, argv[++i]);
        break;
      case '--database-name':
        options.databaseName = takeValue(arg, argv[++i]);
        break;
      case '--source-name':
        options.sourceName = takeValue(arg, argv[++i]);
        break;
      case '--known-fields':
        options.knownFields = takeValue(arg, argv[++i]);
        break;
      case '--indent': {
        const raw = takeValue(arg, argv[++i]);
        const parsed = Number.parseInt(raw, 10);
        if (Number.isNaN(parsed)) {
          throw new Error(`argument --indent: invalid int value: '${raw}'`);
        }
        options.indent = parsed;
        break;
      }
      case '--no-validate':
        options.noValidate = true;
        break;
      default:
        throw new Error(`unrecognized arguments: ${arg}`);
    }
  }

  return { kind: 'run', options };
}

/** Read + parse the RTDB export from a path (or stdin when path is None/-). */
export function readExport(path?: string): unknown {
  let text: string;
  if (path === undefined || path === null || path === '-') {
    text = readFileSync(0, 'utf8');
  } else {
    text = readFileSync(path, 'utf8');
  }
  if (!text.trim()) {
    throw new Error('empty input: no RTDB export JSON was provided');
  }
  return JSON.parse(text);
}

/** Parse the `--known-fields` comma separated list. */
export function parseKnownFields(raw?: string): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const fields = raw
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
  return fields.length ? fields : undefined;
}

/** Serialize the envelope exactly like `json.dumps(envelope, indent=N)`. */
export function dumpEnvelope(envelope: unknown, indent: number): string {
  return indent && indent > 0
    ? JSON.stringify(envelope, null, indent)
    : JSON.stringify(envelope);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run the CLI. Returns the process exit code. */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`rtdb-bridge: ${errorMessage(error)}\n`);
    return 1;
  }

  if (parsed.kind === 'help') {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  const options = parsed.options;

  let exportTree: unknown;
  try {
    exportTree = readExport(options.input);
  } catch (error) {
    process.stderr.write(
      `rtdb-bridge: cannot read input: ${errorMessage(error)}\n`,
    );
    return 1;
  }

  if (!isPlainObject(exportTree)) {
    process.stderr.write(
      'rtdb-bridge: input must be a JSON object (the RTDB export tree)\n',
    );
    return 1;
  }

  let envelope;
  try {
    envelope = convertExportToEnvelope(
      exportTree as JsonObject,
      options.databaseName,
      options.sourceName,
      parseKnownFields(options.knownFields),
      !options.noValidate,
    );
  } catch (error) {
    // Surface any bridge failure to the host.
    process.stderr.write(
      `rtdb-bridge: conversion failed: ${errorMessage(error)}\n`,
    );
    return 2;
  }

  const payload = dumpEnvelope(envelope, options.indent);

  try {
    if (options.output) {
      writeFileSync(options.output, payload, 'utf8');
    } else {
      process.stdout.write(payload);
      process.stdout.write('\n');
    }
  } catch (error) {
    process.stderr.write(
      `rtdb-bridge: cannot write output: ${errorMessage(error)}\n`,
    );
    return 1;
  }

  return 0;
}

// Allow `node dist/src/rtdb_bridge/cli.js` to behave like `python -m rtdb_bridge`.
const entry = process.argv[1];
const isDirectRun =
  entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (isDirectRun) {
  process.exitCode = main();
}
