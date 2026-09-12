import { closeSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal `TextIO` protocol. Anything `Relationalize` can write rows to.
 * Mirrors the Python `TextIO` return type of `create_output`.
 */
export interface TextIO {
  write(chunk: string): void;
  close(): void;
}

/**
 * A `StringIO`-compatible in-memory buffer.
 *
 * Mirrors `io.StringIO` closely enough for the pipeline: it accumulates
 * `write()` calls, then supports `seek(0)` + `read()` / `readlines()`.
 */
export class StringIO implements TextIO {
  #chunks: string[] = [];
  #closed = false;

  write(chunk: string): void {
    if (this.#closed) {
      throw new Error('I/O operation on closed buffer');
    }
    this.#chunks.push(chunk);
  }

  close(): void {
    this.#closed = true;
  }

  seek(_position: number): void {
    // In-memory buffer: content is always fully materialised, so seek is a
    // no-op kept for API parity with io.StringIO.
  }

  read(): string {
    return this.#chunks.join('');
  }

  /** Mirrors `io.StringIO.readlines()`: each line keeps its trailing `\n`. */
  readlines(): string[] {
    const content = this.read();
    if (content === '') {
      return [];
    }
    const parts = content.split('\n');
    if (parts[parts.length - 1] === '') {
      parts.pop();
    }
    return parts.map((line) => `${line}\n`);
  }

  toString(): string {
    return this.read();
  }
}

/** A line-buffered file writer mirroring `open(path, "w", buffering=1)`. */
export class FileBuffer implements TextIO {
  #fd: number;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.#fd = openSync(path, 'w');
  }

  write(chunk: string): void {
    writeSync(this.#fd, chunk);
  }

  close(): void {
    closeSync(this.#fd);
  }
}

/**
 * A `create_output`-compatible factory that utilises the local file system.
 * Mirrors `create_local_file`.
 */
export function createLocalFile(
  outputDir = '',
): (identifier: string) => TextIO {
  return (identifier: string): TextIO =>
    new FileBuffer(join(outputDir, `${identifier}.json`));
}

/**
 * A `create_output`-compatible factory that creates in-memory buffers.
 * Mirrors `create_local_buffer`.
 */
export function createLocalBuffer(): (identifier: string) => StringIO {
  return (_identifier: string): StringIO => new StringIO();
}

/** Does nothing. Mirrors Python's `no_op` default `on_object_write`. */
export function noOp(_schema: string, _object: Record<string, unknown>): void {
  // intentionally empty
}
