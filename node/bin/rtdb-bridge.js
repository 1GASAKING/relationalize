#!/usr/bin/env node
// Thin launcher so `rtdb-bridge` works as an npm bin without a global install.
// The real implementation lives in src/rtdb_bridge/cli.ts (compiled to dist).
import { main } from '../dist/src/rtdb_bridge/cli.js';

process.exitCode = main(process.argv.slice(2));
