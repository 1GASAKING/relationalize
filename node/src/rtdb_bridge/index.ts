/**
 * rtdb_bridge - Firebase RTDB export JSON -> canonical UI envelope.
 *
 * TypeScript port of the `rtdb_bridge` Python package
 * (`rtdb_bridge/__init__.py`).
 *
 * ```
 * rtdb export.json -> convertExportToEnvelope(...)
 *                  -> { envelopeVersion, generator, source,
 *                       database, tree, sql, warnings }
 * ```
 */
export { version as __version__ } from './version.js';

// contracts
export {
  ENVELOPE_VERSION,
  GENERATOR_NAME,
  KIND_ICONS,
  POSTGRES_TYPE_MAPPING,
  SCHEMA_NODE_KINDS,
  SCHEMA_NODE_ORIGINS,
  SCHEMA_TABLE_TYPES,
  UI_TYPE_LABELS,
  UI_TYPE_ORDER,
  choiceParts,
  kindIcon,
  normalizeTypeLabel,
} from './contracts.js';

// envelope
export {
  DEFAULT_DIALECT,
  DEFAULT_SCHEMA_NAME,
  PIPELINE_VERSION,
  SOURCE_FORMAT,
  buildDatabaseSchema,
  buildEnvelope,
  buildSqlContract,
  convertExportToEnvelope,
  validateEnvelope,
  type EnvelopeWarning,
  type RtdbBridgeEnvelope,
} from './envelope.js';

// json schema validator
export {
  validateInstance,
  type SchemaRegistry,
  type ValidationError,
} from './jsonSchema.js';

// preprocess
export {
  DEFAULT_KNOWN_COLLECTION_FIELDS,
  extractCollectionRecords,
  keyedMapsToArrays,
} from './preprocess.js';

// pipeline
export {
  CollectionInfo,
  ExportPipelineResult,
  RelationRef,
  TableInfo,
  isRelationId,
  relationalizeExport,
  runPipeline,
} from './pipeline.js';

// schemas
export {
  SCHEMA_FILENAMES,
  loadAllSchemas,
  loadSchema,
  type SchemaName,
} from './schemas.js';

// ui_tree
export {
  buildColumnsUi,
  buildDatabaseTree,
  buildKeysUi,
  buildReferencesUi,
  buildTypesUi,
  isPartial,
  isNullable,
  keySamples,
  sampleDistinct,
  schemaColumnsForRows,
  tableToUiTree,
  valueTypes,
  type UiTreeNode,
} from './uiTree.js';
