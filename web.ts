// deno-lint-ignore-file no-explicit-any
import { chunk } from "@std/collections/chunk";
import { concat } from "@std/bytes/concat";

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

/** Command sent to a Redis server. */
export type Command = (string | number | Uint8Array)[];
/** Reply received from a Redis server and triggered by a command. */
export type Reply =
  | string
  | number
  | null
  | boolean
  | bigint
  | Record<string, any>
  | Reply[];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ARRAY_PREFIX = "*".charCodeAt(0);
const ATTRIBUTE_PREFIX = "|".charCodeAt(0);
const BIG_NUMBER_PREFIX = "(".charCodeAt(0);
const BLOB_ERROR_PREFIX = "!".charCodeAt(0);
const BOOLEAN_PREFIX = "#".charCodeAt(0);
const BULK_STRING_PREFIX = "$".charCodeAt(0);
const DOUBLE_PREFIX = ",".charCodeAt(0);
const ERROR_PREFIX = "-".charCodeAt(0);
const INTEGER_PREFIX = ":".charCodeAt(0);
const MAP_PREFIX = "%".charCodeAt(0);
const NULL_PREFIX = "_".charCodeAt(0);
const PUSH_PREFIX = ">".charCodeAt(0);
const SET_PREFIX = "~".charCodeAt(0);
const SIMPLE_STRING_PREFIX = "+".charCodeAt(0);
const VERBATIM_STRING_PREFIX = "=".charCodeAt(0);

const CRLF_BYTES = encoder.encode("\r\n");
const ARRAY_PREFIX_BYTES = encoder.encode("*");
const BULK_STRING_PREFIX_BYTES = encoder.encode("$");

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

export class RedisLineStream extends TransformStream<Uint8Array, Uint8Array> {
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

async function readReply(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  raw = false,
): Promise<Reply> {
  const { value } = await reader.read();
  if (value === undefined) {
    return Promise.reject(new TypeError("No reply received"));
  }
  const line = decoder.decode(value.slice(1));
  switch (value[0]) {
    case ARRAY_PREFIX:
    case PUSH_PREFIX: {
      const length = Number(line);
      return length === -1 ? null : await readNReplies(reader, length);
    }
    case ATTRIBUTE_PREFIX: {
      // TODO: include attribute data somehow
      const length = Number(line) * 2;
      // Read but don't return attribute data
      await readNReplies(reader, length);
      return readReply(reader, raw);
    }
    case BIG_NUMBER_PREFIX:
      return BigInt(line);
    case BLOB_ERROR_PREFIX: {
      // Skip to reading the next line, which is a string
      const { value } = await reader.read();
      return Promise.reject(decoder.decode(value));
    }
    case BOOLEAN_PREFIX:
      return line === "t";
    case BULK_STRING_PREFIX:
    case VERBATIM_STRING_PREFIX: {
      switch (line) {
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
      switch (line) {
        case "inf":
          return Infinity;
        case "-inf":
          return -Infinity;
        default:
          return Number(line);
      }
    }
    case ERROR_PREFIX:
      return Promise.reject(line);
    case MAP_PREFIX: {
      const length = Number(line) * 2;
      const array = await readNReplies(reader, length);
      return Object.fromEntries(chunk(array, 2));
    }
    case NULL_PREFIX:
      return null;
    case SET_PREFIX:
      return new Set(await readNReplies(reader, Number(line), raw));
    case SIMPLE_STRING_PREFIX:
      return line;
    // No prefix
    default:
      return raw ? value : decoder.decode(value);
  }
}

export class RedisClient {
  #conn: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
  #reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(
    conn: {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    },
  ) {
    this.#conn = conn;
    this.#reader = this.#conn.readable
      .pipeThrough(new RedisLineStream())
      .getReader();
  }

  async sendCommand(command: Command): Promise<Reply> {
    await ReadableStream.from([command])
      .pipeThrough(new RedisSerializationStream())
      .pipeTo(this.#conn.writable, { preventClose: true });
    return readReply(this.#reader);
  }

  async *readReplies(raw = false): AsyncGenerator<Reply> {
    while (true) {
      yield await readReply(this.#reader, raw);
    }
  }
}
