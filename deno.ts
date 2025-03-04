// deno-lint-ignore-file no-explicit-any
import { chunk } from "@std/collections/chunk";
import { concat } from "@std/bytes/concat";
import { writeAll } from "@std/io/write-all";
import type { Reader, Writer } from "@std/io/types";
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

/**
 * Transforms a command, which is an array of arguments, into an RESP request.
 *
 * @see {@link https://redis.io/docs/reference/protocol-spec/#send-commands-to-a-redis-server}
 */
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

async function* readLines(reader: Reader): AsyncIterableIterator<Uint8Array> {
  const buffer = new Uint8Array(1024);
  let chunks = new Uint8Array();
  while (true) {
    const result = await reader.read(buffer);
    if (result === null) break;
    chunks = concat([chunks, buffer.subarray(0, result)]);
    let index;
    while (
      (index = chunks.indexOf(CRLF_BYTES[0])) !== -1 &&
      chunks[index + 1] === CRLF_BYTES[1]
    ) {
      yield chunks.subarray(0, index);
      chunks = chunks.subarray(index + 2);
    }
  }
  yield chunks;
}

function readNReplies(
  iterator: AsyncIterableIterator<Uint8Array>,
  length: number,
  raw = false,
): Promise<Reply[]> {
  return Array.fromAsync({ length }, () => readReply(iterator, raw));
}

function parseLine(value: Uint8Array): string {
  return decoder.decode(value.slice(1));
}

async function readReply(
  iterator: AsyncIterableIterator<Uint8Array>,
  raw = false,
): Promise<Reply> {
  const { value } = await iterator.next();
  if (value.length === 0) {
    return Promise.reject(new TypeError("No reply received"));
  }
  switch (value[0]) {
    case ARRAY_PREFIX:
    case PUSH_PREFIX: {
      const length = Number(parseLine(value));
      return length === -1 ? null : await readNReplies(iterator, length);
    }
    case ATTRIBUTE_PREFIX: {
      // TODO: include attribute data somehow
      const length = Number(parseLine(value)) * 2;
      // Read but don't return attribute data
      await readNReplies(iterator, length);
      return readReply(iterator, raw);
    }
    case BIG_NUMBER_PREFIX:
      return BigInt(parseLine(value));
    case BLOB_ERROR_PREFIX: {
      // Skip to reading the next line, which is a string
      const { value } = await iterator.next();
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
          return readReply(iterator, raw);
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
      const array = await readNReplies(iterator, length);
      return Object.fromEntries(chunk(array, 2));
    }
    case NULL_PREFIX:
      return null;
    case SET_PREFIX:
      return new Set(
        await readNReplies(iterator, Number(parseLine(value)), raw),
      );
    case SIMPLE_STRING_PREFIX:
      return parseLine(value);
    // No prefix
    default:
      return raw ? value : decoder.decode(value);
  }
}

/**
 * A Redis client for interacting with a Redis server.
 *
 * @example Send RESPv2 commands
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
 * @example Send RESP3 commands
 *
 * Switch to
 * {@link https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md | RESP3}
 * by sending a {@link https://redis.io/docs/latest/commands/hello/ | HELLO}
 * command with the version number 3.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { assertEquals } from "@std/assert/equals";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * // Switch to RESP3
 * await redisClient.sendCommand(["HELLO", 3]);
 *
 * const reply1 = await redisClient.sendCommand(["HSET", "myhash", "foo", 1, "bar", 2]);
 * assertEquals(reply1, 2);
 *
 * const reply2 = await redisClient.sendCommand(["HGETALL", "myhash"]);
 * assertEquals(reply2, { foo: "1", bar: "2" });
 * ```
 *
 * @example Receive raw data
 *
 * Receive raw data by setting the `raw` parameter to `true` for your given
 * method. This functionality is exclusive to bulk string replies.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { assertEquals } from "@std/assert/equals";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
 *
 * const reply1 = await redisClient.sendCommand(["SET", "data", data]);
 * assertEquals(reply1, "OK");
 *
 * const reply2 = await redisClient.sendCommand(["GET", "data"], true);
 * assertEquals(reply2, data);
 * ```
 *
 * @example Execute operations with timeouts
 *
 * See the Deno Standard Library's
 * {@linkcode https://jsr.io/@std/async/doc/~/deadline | deadline()} for more
 * information. This function can be applied to any asynchronous operation.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { deadline } from "@std/async/deadline";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * // Rejects with a timeout error if the command takes longer than 100 milliseconds.
 * await deadline(redisClient.sendCommand(["GET", "foo"]), 100);
 * ```
 *
 * @example Retry operations
 *
 * See the Deno Standard Library's
 * {@linkcode https://jsr.io/@std/async/doc/~/retry | retry()} for more
 * information. This function can be applied to any asynchronous operation.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { retry } from "@std/async/retry";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * // Retries to connect until successful using the exponential backoff algorithm.
 * await retry(() => redisClient.sendCommand(["GET", "foo"]));
 * ```
 *
 * @example Pipeline commands
 *
 * See
 * {@link https://redis.io/docs/latest/develop/use/pipelining/ | Redis pipelining}
 * for more information.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { assertEquals } from "@std/assert/equals";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * const replies = await redisClient.pipelineCommands([
 *   ["INCR", "Y"],
 *   ["INCR", "Y"],
 *   ["INCR", "Y"],
 *   ["INCR", "Y"],
 * ]);
 * assertEquals(replies, [1, 2, 3, 4]);
 * ```
 *
 * @example Use pub/sub channels
 *
 * See
 * {@link https://redis.io/docs/latest/develop/interact/pubsub/ | Redis Pub/Sub}
 * for more information.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { assertEquals } from "@std/assert/equals";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * await redisClient.writeCommand(["SUBSCRIBE", "mychannel"]);
 * for await (const reply of redisClient.readReplies()) {
 *   assertEquals(reply, ["subscribe", "mychannel", 1]);
 *   break;
 * }
 * await redisClient.writeCommand(["UNSUBSCRIBE", "mychannel"]);
 * ```
 *
 * @example Perform transaction
 *
 * See {@link https://redis.io/docs/latest/develop/interact/transactions/ | Transactions}
 * for more information.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { assertEquals } from "@std/assert/equals";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * assertEquals(await redisClient.sendCommand(["MULTI"]), "OK");
 * assertEquals(await redisClient.sendCommand(["INCR", "QUX"]), "QUEUED");
 * assertEquals(await redisClient.sendCommand(["INCR", "QUX"]), "QUEUED");
 * assertEquals(await redisClient.sendCommand(["EXEC"]), [1, 2]);
 * ```
 *
 * @example Execute Lua scripts
 *
 * See
 * {@link https://redis.io/docs/latest/develop/interact/programmability/eval-intro/ | Scripting with Lua}
 * for more information.
 *
 * ```ts ignore
 * import { RedisClient } from "@iuioiua/redis";
 * import { assertEquals } from "@std/assert/equals";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * const reply1 = await redisClient.sendCommand(["EVAL", "return ARGV[1]", 0, "hello"]);
 * assertEquals(reply1, "hello");
 *
 * const reply2 = await redisClient.sendCommand([
 *   "FUNCTION",
 *   "LOAD",
 *   "#!lua name=mylib\nredis.register_function('knockknock', function() return 'Who\\'s there?' end)",
 * ]);
 * assertEquals(reply2, "mylib");
 *
 * const reply3 = await redisClient.sendCommand(["FCALL", "knockknock", 0]);
 * assertEquals(reply3, "Who's there?");
 * ```
 */
export class RedisClient {
  #conn: Reader & Writer;
  #lines: AsyncIterableIterator<Uint8Array>;
  #queue: Promise<any> = Promise.resolve();

  constructor(conn: Reader & Writer) {
    this.#conn = conn;
    this.#lines = readLines(this.#conn);
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.#queue = this.#queue.then(task);
    return this.#queue;
  }

  /**
   * Sends a command to the Redis server and returns the reply.
   *
   * @example Basic usage
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
   */
  sendCommand(command: Command, raw = false): Promise<Reply> {
    return this.#enqueue(async () => {
      await writeAll(this.#conn, createRequest(command));
      return readReply(this.#lines, raw);
    });
  }

  /**
   * Writes a command to the Redis server without listening for a reply.
   *
   * @example Basic usage
   * ```ts ignore
   * import { RedisClient } from "@iuioiua/redis";
   * import { assertEquals } from "@std/assert/equals";
   *
   * using redisConn = await Deno.connect({ port: 6379 });
   * const redisClient = new RedisClient(redisConn);
   *
   * await redisClient.writeCommand(["SUBSCRIBE", "mychannel"]);
   * for await (const reply of redisClient.readReplies()) {
   *   assertEquals(reply, ["subscribe", "mychannel", 1]);
   *   break;
   * }
   * await redisClient.writeCommand(["UNSUBSCRIBE", "mychannel"]);
   * ```
   */
  writeCommand(command: Command): Promise<void> {
    return this.#enqueue(() => writeAll(this.#conn, createRequest(command)));
  }

  /**
   * Used for pub/sub. Listens for replies from the Redis server.
   *
   * See
   * {@link https://redis.io/docs/latest/develop/interact/pubsub/ | Redis Pub/Sub}
   * for more information.
   *
   * @example Basic usage
   * ```ts ignore
   * import { RedisClient } from "@iuioiua/redis";
   * import { assertEquals } from "@std/assert/equals";
   *
   * using redisConn = await Deno.connect({ port: 6379 });
   * const redisClient = new RedisClient(redisConn);
   *
   * await redisClient.writeCommand(["SUBSCRIBE", "mychannel"]);
   * for await (const reply of redisClient.readReplies()) {
   *   assertEquals(reply, ["subscribe", "mychannel", 1]);
   *   break;
   * }
   * await redisClient.writeCommand(["UNSUBSCRIBE", "mychannel"]);
   * ```
   */
  async *readReplies(raw = false): AsyncIterableIterator<Reply> {
    while (true) {
      yield readReply(this.#lines, raw);
    }
  }

  /**
   * Pipelines commands to the Redis server and returns the replies.
   *
   * See
   * {@link https://redis.io/docs/latest/develop/use/pipelining/ | Redis pipelining}
   * for more information.
   *
   * @example Basic usage
   *
   * ```ts ignore
   * import { RedisClient } from "@iuioiua/redis";
   * import { assertEquals } from "@std/assert/equals";
   *
   * using redisConn = await Deno.connect({ port: 6379 });
   * const redisClient = new RedisClient(redisConn);
   *
   * const replies = await redisClient.pipelineCommands([
   *   ["INCR", "Y"],
   *   ["INCR", "Y"],
   *   ["INCR", "Y"],
   *   ["INCR", "Y"],
   * ]);
   * assertEquals(replies, [1, 2, 3, 4]);
   * ```
   */
  pipelineCommands(commands: Command[], raw = false): Promise<Reply[]> {
    return this.#enqueue(async () => {
      const bytes = concat(commands.map(createRequest));
      await writeAll(this.#conn, bytes);
      return readNReplies(this.#lines, commands.length, raw);
    });
  }
}
