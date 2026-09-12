import { randomUUID } from 'node:crypto';

import { createLocalFile, noOp, type TextIO } from './utils.js';

/**
 * A class/utility for relationalizing JSON content.
 *
 * Ported 1:1 from `relationalize/relationalize.py`.
 *
 * ```
 * const r = new Relationalize('abc', createLocalBuffer());
 * r.relationalize([{ a: 1 }]);
 * r.closeIo();
 * ```
 */
export const DELIMITER = '_';
export const ID_PREFIX = 'R';
export const ID = `${DELIMITER}rid${DELIMITER}`; // "_rid_"
export const VAL = `${DELIMITER}val${DELIMITER}`; // "_val_"
export const INDEX = `${DELIMITER}index${DELIMITER}`; // "_index_"

/** The `create_output` callable signature (identifier -> writable buffer). */
export type CreateOutput = (identifier: string) => TextIO;
/** The `on_object_write` callable signature. */
export type OnObjectWrite = (
  schema: string,
  object: Record<string, unknown>,
) => void;

export const DEFAULT_LOCAL_FILE_CALLABLE: CreateOutput = createLocalFile();

/** A JSON object (relationalize flattens everything to these + scalars). */
export type JsonObject = Record<string, unknown>;

/** Python `isinstance(value, dict)` for JSON data. */
export function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class Relationalize {
  name: string;
  createOutput: CreateOutput;
  onObjectWrite: OnObjectWrite;
  outputs: Record<string, TextIO> = {};

  constructor(
    name: string,
    createOutput: CreateOutput = DEFAULT_LOCAL_FILE_CALLABLE,
    onObjectWrite: OnObjectWrite = noOp,
  ) {
    this.name = name;
    this.createOutput = createOutput;
    this.onObjectWrite = onObjectWrite;
  }

  /**
   * Main entrypoint into this class.
   *
   * Pass in an iterable and it will relationalize it, outputting to wherever
   * was designated when instantiating the class.
   */
  relationalize(objectList: Iterable<Record<string, unknown>>): void {
    for (const item of objectList) {
      this.#writeToOutput(this.name, this.#relationalize(item));
    }
  }

  /** Writes a row to the given output. */
  #writeRow(key: string, row: Record<string, unknown>): void {
    this.outputs[key].write(JSON.stringify(row));
    this.outputs[key].write('\n');
    this.onObjectWrite(key, row);
  }

  /**
   * Writes content, either a single object or a list of objects, to the
   * output. Will create a new buffer if needed.
   */
  #writeToOutput(
    key: string,
    content: Record<string, unknown> | Array<Record<string, unknown>>,
    isSub = false,
  ): void {
    const identifier = isSub ? `${this.name}${DELIMITER}${key}` : key;
    if (!(identifier in this.outputs)) {
      this.outputs[identifier] = this.createOutput(identifier);
    }
    if (Array.isArray(content)) {
      for (const row of content) {
        this.#writeRow(identifier, row);
      }
      return;
    }
    this.#writeRow(identifier, content);
  }

  /**
   * Helper for relationalizing lists. Handles the difference between an array
   * of literals and an array of structs.
   */
  #listHelper(
    id: string,
    index: number,
    row: unknown,
    path: string,
  ): Record<string, unknown> {
    if (isPlainObject(row)) {
      const copy: JsonObject = { ...row };
      copy[ID] = id;
      copy[INDEX] = index;
      return this.#relationalize(copy, path);
    }
    return this.#relationalize({ [VAL]: row, [ID]: id, [INDEX]: index }, path);
  }

  /**
   * Recursive backbone of the relationalize structure. Traverses any arbitrary
   * JSON structure, flattening and relationalizing.
   */
  #relationalize(
    d: unknown,
    path = '',
  ): Record<string, unknown> {
    const pathPrefix = path === '' ? '' : `${path}${DELIMITER}`;
    if (Array.isArray(d)) {
      const id = Relationalize.generateRid();
      d.forEach((row, index) => {
        this.#writeToOutput(
          path,
          this.#listHelper(id, index, row, path),
          true,
        );
      });
      return { [path]: id };
    }

    if (isPlainObject(d)) {
      const tempD: Record<string, unknown> = {};
      for (const key of Object.keys(d)) {
        Object.assign(tempD, this.#relationalize(d[key], `${pathPrefix}${key}`));
      }
      return tempD;
    }

    return { [path]: d };
  }

  /** Closes every output buffer created via `create_output`. */
  closeIo(): void {
    for (const fileObject of Object.values(this.outputs)) {
      fileObject.close();
    }
  }

  /**
   * Generates a relationalize ID. EX: `R_2d0418f3b5de415086f1297cf0a9d9a5`
   */
  static generateRid(): string {
    return `${ID_PREFIX}${DELIMITER}${randomUUID().replaceAll('-', '').toLowerCase()}`;
  }
}
