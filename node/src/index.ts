/**
 * Top-level barrel for the Node/TypeScript replica of the Python project.
 *
 * ```ts
 * import { Relationalize, Schema, convertExportToEnvelope } from '@relationalize/node';
 * ```
 *
 * Everything is also available from the subpath exports
 * `@relationalize/node/relationalize` and `@relationalize/node/rtdb_bridge`.
 */
export * from './relationalize/index.js';
export * from './rtdb_bridge/index.js';
