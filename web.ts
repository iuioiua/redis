import { chunk } from "@std/collections/chunk";
import { concat } from "@std/bytes/concat";
import {
  ARRAY_PREFIX,
  ARRAY_PREFIX_BYTES,
  ATTRIBUTE_PREFIX,
  BIG_NUMBER_PREFIX,
  BLOB_ERROR_PREFIX,
  BOOLEAN_PREFIX,
  BULK_STRING_PREFIX,
  BULK_STRING_PREFIX_BYTES,
  type Command,
  CRLF_BYTES,
  DOUBLE_PREFIX,
  ERROR_PREFIX,
  INTEGER_PREFIX,
  MAP_PREFIX,
  NULL_PREFIX,
  PUSH_PREFIX,
  type Reply,
  SET_PREFIX,
  SIMPLE_STRING_PREFIX,
  VERBATIM_STRING_PREFIX,
} from "./_shared.ts";

export type { Command, Reply };

/**
 * A Redis client for interacting with a Redis server.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { assertEquals } from "@std/assert/equals";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * const reply1 = await redisClient.sendCommand(["SET", "hello", "world"]);
 * assertEquals(reply1, "OK");
 *
 * const reply2 = await redisClient.sendCommand(["GET", "hello"]);
 * assertEquals(reply2, "world");
 * ```
 *
 * @module
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createRequest(command: Command): Uint8Array {
  const lines = [
    ARRAY_PREFIX_BYTES,
    encoder.encode(command.length.toString()),
    CRLF_BYTES,
  ];
  for (const arg of command) {
    const bytes = arg instanceof Uint8Array
      ? arg
      : encoder.encode(arg.toString());
    lines.push(
      BULK_STRING_PREFIX_BYTES,
      encoder.encode(bytes.byteLength.toString()),
      CRLF_BYTES,
      bytes,
      CRLF_BYTES,
    );
  }
  return concat(lines);
}

class RedisSerializationStream extends TransformStream<Command, Uint8Array> {
  constructor() {
    super({
      transform(command, controller) {
        controller.enqueue(ARRAY_PREFIX_BYTES);
        controller.enqueue(encoder.encode(command.length.toString()));
        controller.enqueue(CRLF_BYTES);
        for (const arg of command) {
          const bytes = arg instanceof Uint8Array
            ? arg
            : encoder.encode(arg.toString());
          controller.enqueue(BULK_STRING_PREFIX_BYTES);
          controller.enqueue(encoder.encode(bytes.length.toString()));
          controller.enqueue(CRLF_BYTES);
          controller.enqueue(bytes);
          controller.enqueue(CRLF_BYTES);
        }
      },
    });
  }
}

class RedisLineStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor() {
    let buffer = new Uint8Array();
    super({
      transform(chunk, controller) {
        buffer = concat([buffer, chunk]);
        while (true) {
          const index = buffer.indexOf(CRLF_BYTES[0]);
          if (index === -1 || (buffer[index + 1] !== CRLF_BYTES[1])) return;
          const line = buffer.subarray(0, index);
          buffer = buffer.subarray(index + 2);
          controller.enqueue(line);
        }
      },
    });
  }
}

function readNReplies(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
  raw = false,
): Promise<Reply[]> {
  return Array.fromAsync({ length }, () => readReply(reader, raw));
}

function parseLine(value: Uint8Array): string {
  return decoder.decode(value.slice(1));
}

async function readReply(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  raw = false,
): Promise<Reply> {
  const { value } = await reader.read();
  if (value === undefined) {
    return Promise.reject(new TypeError("No reply received"));
  }
  switch (value[0]) {
    case ARRAY_PREFIX:
    case PUSH_PREFIX: {
      const length = Number(parseLine(value));
      return length === -1 ? null : await readNReplies(reader, length);
    }
    case ATTRIBUTE_PREFIX: {
      // TODO: include attribute data somehow
      const length = Number(parseLine(value)) * 2;
      // Read but don't return attribute data
      await readNReplies(reader, length);
      return readReply(reader, raw);
    }
    case BIG_NUMBER_PREFIX:
      return BigInt(parseLine(value));
    case BLOB_ERROR_PREFIX: {
      // Skip to reading the next line, which is a string
      const { value } = await reader.read();
      return Promise.reject(decoder.decode(value));
    }
    case BOOLEAN_PREFIX:
      return parseLine(value) === "t";
    case BULK_STRING_PREFIX:
    case VERBATIM_STRING_PREFIX: {
      switch (parseLine(value)) {
        case "-1":
          return null;
        case "0":
          return raw ? new Uint8Array() : "";
        default:
          return readReply(reader, raw);
      }
    }
    case DOUBLE_PREFIX:
    case INTEGER_PREFIX: {
      switch (parseLine(value)) {
        case "inf":
          return Infinity;
        case "-inf":
          return -Infinity;
        default:
          return Number(parseLine(value));
      }
    }
    case ERROR_PREFIX:
      return Promise.reject(parseLine(value));
    case MAP_PREFIX: {
      const length = Number(parseLine(value)) * 2;
      const array = await readNReplies(reader, length);
      return Object.fromEntries(chunk(array, 2));
    }
    case NULL_PREFIX:
      return null;
    case SET_PREFIX:
      return new Set(await readNReplies(reader, Number(parseLine(value)), raw));
    case SIMPLE_STRING_PREFIX:
      return parseLine(value);
    // No prefix
    default:
      return raw ? value : decoder.decode(value);
  }
}

export class RedisClient {
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(
    conn: {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    },
  ) {
    this.#writer = conn.writable.getWriter();
    this.#reader = conn.readable
      .pipeThrough(new RedisLineStream())
      .getReader();
  }

  async sendCommand(command: Command, raw = false): Promise<Reply> {
    await this.writeCommand(command);
    return readReply(this.#reader, raw);
  }

  async writeCommand(command: Command): Promise<void> {
    await ReadableStream.from([command])
      .pipeThrough(new RedisSerializationStream())
      .pipeTo(this.#conn.writable, { preventClose: true });
  }

  async *readReplies(raw = false): AsyncGenerator<Reply> {
    while (true) {
      yield readReply(this.#reader, raw);
    }
  }

  async pipelineCommands(commands: Command[], raw = false): Promise<Reply[]> {
    await ReadableStream.from(commands)
      .pipeThrough(new RedisSerializationStream())
      .pipeTo(this.#conn.writable, { preventClose: true });
    return readNReplies(this.#reader, commands.length, raw);
  }
}
