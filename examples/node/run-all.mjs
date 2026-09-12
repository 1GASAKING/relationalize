/**
 * Runs every Node example in order and reports a pass/fail summary.
 *
 * Run from the repository root (after building):
 *   npm --prefix node run examples:all
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const SCRIPTS = [
  'memory_example.mjs',
  'local_fs_example.mjs',
  'local_fs_example_csv_output.mjs',
  'concurrency_example.mjs',
  'rtdb_conversion_test.mjs',
  'rtdb_schema_tree.mjs',
  'full_pokemon_psql_pipeline.mjs',
  'full_mongodb_psql_pipeline.mjs',
  's3_redshift_example.mjs',
  'full_pokemon_s3_redshift_pipeline.mjs',
];

let failed = 0;
for (const script of SCRIPTS) {
  console.log(`\n${'#'.repeat(72)}`);
  console.log(`# RUNNING ${script}`);
  console.log(`${'#'.repeat(72)}`);
  const result = spawnSync(process.execPath, [join(here, script)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAILED: ${script} (exit code ${result.status})`);
  }
}

console.log(`\n${SCRIPTS.length - failed}/${SCRIPTS.length} examples succeeded.`);
process.exitCode = failed > 0 ? 1 : 0;
