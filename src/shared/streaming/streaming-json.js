import { TextDecoder } from 'node:util';
import { throwIfAdminTaskCancelled } from '../tasks/admin-task-manager.js';

export class StreamingJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StreamingJsonError';
  }
}

class AsyncCharReader {
  constructor(source, {
    maxBytes,
    signal,
    onReadProgress,
    progressStepBytes = 4 * 1024 * 1024,
  }) {
    this.iterator = source[Symbol.asyncIterator]();
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.maxBytes = maxBytes;
    this.signal = signal;
    this.onReadProgress = onReadProgress;
    this.progressStepBytes = progressStepBytes;
    this.lastProgressBytes = 0;
    this.buffer = '';
    this.offset = 0;
    this.done = false;
    this.bytes = 0;
    this.firstCharacter = true;
  }

  compact() {
    if (this.offset > 65536 && this.offset * 2 > this.buffer.length) {
      this.buffer = this.buffer.slice(this.offset);
      this.offset = 0;
    }
  }

  async fill() {
    throwIfAdminTaskCancelled(this.signal);
    while (this.offset >= this.buffer.length && !this.done) {
      this.compact();
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        try {
          this.buffer += this.decoder.decode();
        } catch {
          throw new StreamingJsonError('JSON input is not valid UTF-8');
        }
        break;
      }
      const chunk = Buffer.isBuffer(next.value)
        ? next.value
        : Buffer.from(next.value);
      this.bytes += chunk.length;
      if (this.bytes > this.maxBytes) {
        throw new StreamingJsonError(
          `Decoded JSON exceeds the configured limit of ${this.maxBytes} bytes`,
        );
      }
      try {
        this.buffer += this.decoder.decode(chunk, { stream: true });
      } catch {
        throw new StreamingJsonError('JSON input is not valid UTF-8');
      }

      if (
        this.onReadProgress &&
        this.bytes - this.lastProgressBytes >= this.progressStepBytes
      ) {
        this.lastProgressBytes = this.bytes;
        await this.onReadProgress(this.bytes);
      }
    }
  }

  async peek() {
    await this.fill();
    if (this.offset >= this.buffer.length) return null;
    if (this.firstCharacter) {
      this.firstCharacter = false;
      if (this.buffer[this.offset] === '\uFEFF') {
        this.offset += 1;
        return this.peek();
      }
    }
    return this.buffer[this.offset];
  }

  async next() {
    const value = await this.peek();
    if (value === null) return null;
    this.offset += 1;
    return value;
  }

  async whitespace() {
    for (;;) {
      await this.fill();
      while (this.offset < this.buffer.length) {
        const value = this.buffer[this.offset];
        if (
          value !== ' ' &&
          value !== '\n' &&
          value !== '\r' &&
          value !== '\t'
        ) return;
        this.offset += 1;
      }
      if (this.done) return;
    }
  }
}

async function expect(reader, expected, message) {
  await reader.whitespace();
  const value = await reader.next();
  if (value !== expected) {
    throw new StreamingJsonError(message ?? `Expected ${expected}`);
  }
}

async function readStringRaw(reader, limit) {
  await reader.whitespace();
  if (await reader.next() !== '"') {
    throw new StreamingJsonError('Expected a JSON string');
  }

  const parts = ['"'];
  let bytes = 1;
  let escaped = false;

  const append = (piece) => {
    if (!piece) return;
    parts.push(piece);
    bytes += Buffer.byteLength(piece);
    if (bytes > limit) {
      throw new StreamingJsonError(
        `JSON string exceeds the configured item limit of ${limit} bytes`,
      );
    }
  };

  for (;;) {
    await reader.fill();
    if (reader.offset >= reader.buffer.length) {
      throw new StreamingJsonError('Unexpected end of JSON string');
    }

    const start = reader.offset;
    let index = start;
    while (index < reader.buffer.length) {
      const value = reader.buffer[index];
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (value === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (value === '"') {
        index += 1;
        append(reader.buffer.slice(start, index));
        reader.offset = index;
        return parts.join('');
      }
      if (value.charCodeAt(0) < 0x20) {
        throw new StreamingJsonError(
          'JSON string contains an unescaped control character',
        );
      }
      index += 1;
    }

    append(reader.buffer.slice(start, index));
    reader.offset = index;
  }
}

async function readValueRaw(reader, limit, maxDepth) {
  await reader.whitespace();
  const first = await reader.peek();
  if (first === null) {
    throw new StreamingJsonError('Unexpected end of JSON input');
  }

  if (first === '"') return readStringRaw(reader, limit);

  const parts = [];
  let bytes = 0;
  const append = (piece) => {
    if (!piece) return;
    parts.push(piece);
    bytes += Buffer.byteLength(piece);
    if (bytes > limit) {
      throw new StreamingJsonError(
        `One JSON value exceeds the configured item limit of ${limit} bytes`,
      );
    }
  };

  if (first === '{' || first === '[') {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (;;) {
      await reader.fill();
      if (reader.offset >= reader.buffer.length) {
        throw new StreamingJsonError('Unexpected end of JSON value');
      }

      const start = reader.offset;
      let index = start;
      while (index < reader.buffer.length) {
        const value = reader.buffer[index];

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (value === '\\') {
            escaped = true;
          } else if (value === '"') {
            inString = false;
          } else if (value.charCodeAt(0) < 0x20) {
            throw new StreamingJsonError(
              'JSON string contains an unescaped control character',
            );
          }
          index += 1;
          continue;
        }

        if (value === '"') {
          inString = true;
          index += 1;
          continue;
        }
        if (value === '{' || value === '[') {
          stack.push(value);
          if (stack.length > maxDepth) {
            throw new StreamingJsonError(
              `JSON nesting depth exceeds the configured limit of ${maxDepth}`,
            );
          }
          index += 1;
          continue;
        }
        if (value === '}' || value === ']') {
          const expected = value === '}' ? '{' : '[';
          if (stack.pop() !== expected) {
            throw new StreamingJsonError('JSON value has mismatched brackets');
          }
          index += 1;
          if (stack.length === 0) {
            append(reader.buffer.slice(start, index));
            reader.offset = index;
            return parts.join('');
          }
          continue;
        }
        index += 1;
      }

      append(reader.buffer.slice(start, index));
      reader.offset = index;
    }
  }

  for (;;) {
    await reader.fill();
    const start = reader.offset;
    let index = start;
    while (index < reader.buffer.length) {
      const value = reader.buffer[index];
      if (
        value === ',' ||
        value === '}' ||
        value === ']' ||
        value === ' ' ||
        value === '\n' ||
        value === '\r' ||
        value === '\t'
      ) {
        break;
      }
      index += 1;
    }

    append(reader.buffer.slice(start, index));
    reader.offset = index;
    if (index < reader.buffer.length || reader.done) break;
  }

  const raw = parts.join('');
  if (!raw) throw new StreamingJsonError('Expected a JSON value');
  return raw;
}

function parseRaw(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new StreamingJsonError(`${label} is not valid JSON`);
  }
}

/**
 * Parse a top-level JSON object while materializing one selected array one item
 * at a time. Other top-level values are bounded individually and retained only
 * when their key is requested through metadataKeys.
 *
 * @param {AsyncIterable<Buffer | Uint8Array | string>} source
 * @param {{
 *   arrayKey: string,
 *   metadataKeys?: Set<string>,
 *   maxBytes: number,
 *   maxItemBytes: number,
 *   maxDepth?: number,
 *   maxItems?: number,
 *   signal?: AbortSignal,
 *   onItem: (item: unknown, index: number) => Promise<void> | void,
 *   onProgress?: (progress: object) => Promise<void> | void
 * }} options
 */
export async function parseStreamingJsonObject(source, options) {
  const metadata = {};
  const seenKeys = new Set();
  const maxDepth = options.maxDepth ?? 128;
  const maxItems = options.maxItems ?? 5_000_000;
  let arraySeen = false;
  let itemCount = 0;
  const reader = new AsyncCharReader(source, {
    ...options,
    onReadProgress: async (decodedBytes) => {
      await options.onProgress?.({
        phase: 'parse',
        items: itemCount,
        decodedBytes,
        activity: 'read',
      });
    },
  });

  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new StreamingJsonError('maxDepth must be a positive integer');
  }
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new StreamingJsonError('maxItems must be a positive integer');
  }

  await expect(reader, '{', 'JSON document must be a top-level object');
  await reader.whitespace();
  if (await reader.peek() === '}') {
    await reader.next();
  } else {
    for (;;) {
      const keyRaw = await readStringRaw(reader, 4096);
      const key = parseRaw(keyRaw, 'JSON object key');
      if (seenKeys.has(key)) {
        throw new StreamingJsonError(`Duplicate top-level JSON property: ${key}`);
      }
      seenKeys.add(key);
      await expect(reader, ':', `Expected ':' after JSON property ${key}`);

      if (key === options.arrayKey) {
        arraySeen = true;
        await expect(
          reader,
          '[',
          `JSON property ${options.arrayKey} must be an array`,
        );
        await reader.whitespace();
        if (await reader.peek() !== ']') {
          for (;;) {
            if (itemCount >= maxItems) {
              throw new StreamingJsonError(
                `JSON ${options.arrayKey} contains more than the configured ${maxItems} items`,
              );
            }
            const raw = await readValueRaw(
              reader,
              options.maxItemBytes,
              maxDepth,
            );
            const item = parseRaw(
              raw,
              `JSON ${options.arrayKey} item ${itemCount}`,
            );
            await options.onItem(item, itemCount);
            itemCount += 1;
            if (itemCount % 100 === 0) {
              await options.onProgress?.({
                phase: 'parse',
                items: itemCount,
                decodedBytes: reader.bytes,
              });
            }
            await reader.whitespace();
            const separator = await reader.next();
            if (separator === ']') break;
            if (separator !== ',') {
              throw new StreamingJsonError(
                `Expected ',' or ']' in JSON ${options.arrayKey} array`,
              );
            }
          }
        } else {
          await reader.next();
        }
      } else {
        const raw = await readValueRaw(
          reader,
          options.maxItemBytes,
          maxDepth,
        );
        const value = parseRaw(raw, `JSON property ${key}`);
        if (options.metadataKeys?.has(key)) metadata[key] = value;
      }

      await reader.whitespace();
      const separator = await reader.next();
      if (separator === '}') break;
      if (separator !== ',') {
        throw new StreamingJsonError(
          "Expected ',' or '}' after top-level JSON property",
        );
      }
      await reader.whitespace();
    }
  }

  await reader.whitespace();
  if (await reader.next() !== null) {
    throw new StreamingJsonError('JSON document contains trailing data');
  }
  if (!arraySeen) {
    throw new StreamingJsonError(
      `JSON document must contain the ${options.arrayKey} array`,
    );
  }

  await options.onProgress?.({
    phase: 'parsed',
    items: itemCount,
    decodedBytes: reader.bytes,
  });
  return {
    metadata,
    itemCount,
    decodedBytes: reader.bytes,
  };
}
