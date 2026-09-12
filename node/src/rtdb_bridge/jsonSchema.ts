/**
 * A small draft-07 JSON Schema validator.
 *
 * The Python bridge uses the optional `jsonschema` package to validate the
 * envelope. Porting that dependency is unnecessary: the canonical contracts
 * only use a handful of keywords, so this module implements exactly that
 * subset (type / const / enum / required / properties / additionalProperties /
 * items / minimum / $ref / definitions).
 *
 * Unknown keywords (e.g. `format`, `description`) are ignored, matching the
 * lenient behaviour of `jsonschema` for the schemas we ship.
 */
import { isPlainObject } from '../relationalize/relationalize.js';

export type SchemaNode = Record<string, unknown> | boolean;
export type SchemaRegistry = Map<string, Record<string, unknown>>;

export interface ValidationError {
  path: Array<string | number>;
  message: string;
  validator: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every((k) => k in b && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

function formatValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function matchesType(instance: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(instance);
    case 'array':
      return Array.isArray(instance);
    case 'string':
      return typeof instance === 'string';
    case 'integer':
      return typeof instance === 'number' && Number.isInteger(instance);
    case 'number':
      return typeof instance === 'number';
    case 'boolean':
      return typeof instance === 'boolean';
    case 'null':
      return instance === null;
    default:
      return true;
  }
}

function resolvePointer(
  doc: Record<string, unknown>,
  pointer: string,
): unknown {
  if (pointer === '' || pointer === '/') {
    return doc;
  }
  let node: unknown = doc;
  for (const rawPart of pointer.replace(/^\//, '').split('/')) {
    const part = decodeURIComponent(
      rawPart.replaceAll('~1', '/').replaceAll('~0', '~'),
    );
    if (isPlainObject(node)) {
      node = node[part];
    } else if (Array.isArray(node)) {
      node = node[Number(part)];
    } else {
      return undefined;
    }
  }
  return node;
}

function resolveRef(
  ref: string,
  doc: Record<string, unknown>,
  registry: SchemaRegistry,
): { schema: SchemaNode; doc: Record<string, unknown> } | null {
  const hashIndex = ref.indexOf('#');
  const docPart = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
  const pointer = hashIndex === -1 ? '' : ref.slice(hashIndex + 1);

  let targetDoc: Record<string, unknown> | undefined = doc;
  if (docPart) {
    targetDoc = registry.get(docPart);
    if (!targetDoc) {
      return null;
    }
  }
  const resolved = resolvePointer(targetDoc, pointer);
  if (!isPlainObject(resolved) && typeof resolved !== 'boolean') {
    return null;
  }
  return { schema: resolved as SchemaNode, doc: targetDoc };
}

function walk(
  instance: unknown,
  schema: SchemaNode,
  doc: Record<string, unknown>,
  registry: SchemaRegistry,
  path: Array<string | number>,
  errors: ValidationError[],
): void {
  if (typeof schema === 'boolean') {
    if (!schema) {
      errors.push({
        path,
        message: 'False schema does not allow a value',
        validator: 'false',
      });
    }
    return;
  }
  if (!isPlainObject(schema)) {
    return;
  }

  if (typeof schema['$ref'] === 'string') {
    const resolved = resolveRef(schema['$ref'], doc, registry);
    if (resolved) {
      walk(instance, resolved.schema, resolved.doc, registry, path, errors);
    }
    return;
  }

  if (schema['type'] !== undefined) {
    const types = Array.isArray(schema['type'])
      ? (schema['type'] as string[])
      : [schema['type'] as string];
    if (!types.some((t) => matchesType(instance, t))) {
      errors.push({
        path,
        message: `${formatValue(instance)} is not of type ${types.join(', ')}`,
        validator: 'type',
      });
      return;
    }
  }

  if ('const' in schema && !deepEqual(instance, schema['const'])) {
    errors.push({
      path,
      message: `${formatValue(instance)} is not equal to the constant ${formatValue(
        schema['const'],
      )}`,
      validator: 'const',
    });
  }

  if (Array.isArray(schema['enum'])) {
    const allowed = schema['enum'] as unknown[];
    if (!allowed.some((candidate) => deepEqual(instance, candidate))) {
      errors.push({
        path,
        message: `${formatValue(instance)} is not one of ${formatValue(allowed)}`,
        validator: 'enum',
      });
    }
  }

  if (
    typeof schema['minimum'] === 'number' &&
    typeof instance === 'number' &&
    instance < schema['minimum']
  ) {
    errors.push({
      path,
      message: `${instance} is less than the minimum of ${schema['minimum']}`,
      validator: 'minimum',
    });
  }

  if (isPlainObject(instance)) {
    const properties = isPlainObject(schema['properties'])
      ? (schema['properties'] as Record<string, SchemaNode>)
      : {};

    if (Array.isArray(schema['required'])) {
      for (const name of schema['required'] as string[]) {
        if (!(name in instance)) {
          errors.push({
            path,
            message: `'${name}' is a required property`,
            validator: 'required',
          });
        }
      }
    }

    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in instance) {
        walk(instance[key], subSchema, doc, registry, [...path, key], errors);
      }
    }

    const additional = schema['additionalProperties'];
    if (additional === false) {
      for (const key of Object.keys(instance)) {
        if (!(key in properties)) {
          errors.push({
            path: [...path, key],
            message: `Additional properties are not allowed ('${key}' was unexpected)`,
            validator: 'additionalProperties',
          });
        }
      }
    } else if (additional !== undefined && additional !== true) {
      for (const key of Object.keys(instance)) {
        if (!(key in properties)) {
          walk(
            instance[key],
            additional as SchemaNode,
            doc,
            registry,
            [...path, key],
            errors,
          );
        }
      }
    }
  }

  if (Array.isArray(instance) && schema['items'] !== undefined) {
    const items = schema['items'] as SchemaNode;
    instance.forEach((item, index) => {
      walk(item, items, doc, registry, [...path, index], errors);
    });
  }
}

/** Validate `instance` against `schema`, reporting all errors found. */
export function validateInstance(
  instance: unknown,
  schema: Record<string, unknown>,
  registry: SchemaRegistry = new Map(),
): ValidationError[] {
  const errors: ValidationError[] = [];
  walk(instance, schema, schema, registry, [], errors);
  return errors;
}
