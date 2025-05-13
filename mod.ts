// deno-lint-ignore-file no-explicit-any
import { concat } from "@std/bytes/concat";

/**
 * A Redis client for interacting with a Redis server.
 *
 * ```ts
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

/**
 * The command to send to the Redis server. This should be an
 * array of arguments, where the first argument is the command name and the
 * remaining arguments are the command's arguments. For the list of commands,
 * see {@link https://redis.io/docs/latest/commands/ | Redis commands}.
 */
export type Command = readonly (string | number | Uint8Array)[];
/**
 * The reply from the Redis server. This can be a string, number,
 * boolean, null, or an array of replies. The type of the reply depends on the
 * command sent. For example, the
 * {@linkcode https://redis.io/docs/latest/commands/get/ | GET} command
 * returns a string, while the
 * {@linkcode https://redis.io/docs/latest/commands/mget/ | MGET} command
 * returns an array of strings.
 */
export type Reply =
  | string
  | number
  | null
  | boolean
  | bigint
  | Record<string, any>
  | readonly Reply[];

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

async function* readLines(
  readable: ReadableStream<Uint8Array<ArrayBufferLike>>,
) {
  let chunks: Uint8Array<ArrayBufferLike> = new Uint8Array();
  for await (const chunk of readable) {
    chunks = concat([chunks, chunk]) as Uint8Array<ArrayBufferLike>;
    let index;
    while (
      (index = chunks.indexOf(CRLF_BYTES[0])) !== -1 &&
      chunks[index + 1] === CRLF_BYTES[1]
    ) {
      yield chunks.subarray(0, index);
      chunks = chunks.subarray(index + 2);
    }
  }
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

/**
 * Chunks an array into smaller arrays of two elements each. Used for map
 * replies which are returned as a flat array of key-value pairs.
 *
 * @param array The array to chunk
 * @returns An array of arrays, each containing two elements from the original
 * array.
 */
function chunk<T>(array: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += 2) {
    result.push(array.slice(i, i + 2));
  }
  return result;
}

async function readReply(
  iterator: AsyncIterableIterator<Uint8Array>,
  raw = false,
): Promise<Reply> {
  const { value } = await iterator.next();
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
    case VERBATIM_STRING_PREFIX:
      return parseLine(value) === "-1" ? null : readReply(iterator, raw);
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
      return Object.fromEntries(chunk(array));
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
 * ```ts
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
 * ```ts
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
 * ```ts
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
 * ```ts
 * import { RedisClient } from "@iuioiua/redis";
 * import { deadline } from "jsr:@std/async/deadline";
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
 * ```ts
 * import { RedisClient } from "@iuioiua/redis";
 * import { retry } from "jsr:@std/async/retry";
 *
 * using redisConn = await Deno.connect({ port: 6379 });
 * const redisClient = new RedisClient(redisConn);
 *
 * // Retries to connect until successful const the exponential backoff algorithm.
 * await retry(() => redisClient.sendCommand(["GET", "foo"]));
 * ```
 *
 * @example Pipeline commands
 *
 * See
 * {@link https://redis.io/docs/latest/develop/use/pipelining/ | Redis pipelining}
 * for more information.
 *
 * ```ts
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
 * ```ts
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
 * ```ts
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
 * ```ts
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
 *   "#!lua name=myfunc\nredis.register_function('knock_knock', function() return 'Who\\'s there?' end)",
 * ]);
 * assertEquals(reply2, "myfunc");
 *
 * const reply3 = await redisClient.sendCommand(["FCALL", "knock_knock", 0]);
 * assertEquals(reply3, "Who's there?");
 * ```
 */
export class RedisClient {
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #lines: AsyncIterableIterator<Uint8Array>;
  #queue: Promise<any> = Promise.resolve();

  /**
   * Constructs a new instance.
   *
   * @param conn The connection to the Redis server. This should be a
   * {@linkcode ReadableStream} and {@linkcode WritableStream} pair, such as the
   * one returned by {@linkcode Deno.connect}.
   */
  constructor(
    readonly conn: {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    },
  ) {
    this.#writer = conn.writable.getWriter();
    this.#lines = readLines(conn.readable);
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.#queue = this.#queue.then(task);
    return this.#queue;
  }

  /**
   * Sends a command to the Redis server and returns the reply.
   *
   * @param command The command to send to the Redis server. This should be an
   * array of arguments, where the first argument is the command name and the
   * remaining arguments are the command's arguments. For the list of commands,
   * see {@link https://redis.io/docs/latest/commands/ | Redis commands}.
   * @param raw If `true`, the reply will be returned as a raw
   * {@linkcode Uint8Array}. This is useful for commands that return binary
   * data, such as {@linkcode https://redis.io/docs/latest/commands/get/ | GET}.
   * The default is `false`, which returns the reply as a JavaScript value.
   *
   * @returns The reply from the Redis server. This can be a string, number,
   * boolean, null, or an array of replies. The type of the reply depends on the
   * command sent. For example, the
   * {@linkcode https://redis.io/docs/latest/commands/get/ | GET} command
   * returns a string, while the
   * {@linkcode https://redis.io/docs/latest/commands/mget/ | MGET} command
   * returns an array of strings.
   *
   * @example Basic usage
   *
   * ```ts
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
    return this.#enqueue(() => {
      this.#writer.write(createRequest(command));
      return readReply(this.#lines, raw);
    });
  }

  /**
   * Writes a command to the Redis server without listening for a reply.
   *
   * @param command The command to send to the Redis server. This should be an
   * array of arguments, where the first argument is the command name and the
   * remaining arguments are the command's arguments. For the list of commands,
   * see {@link https://redis.io/docs/latest/commands/ | Redis commands}.
   *
   * @example Basic usage
   * ```ts
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
    return this.#enqueue(() => this.#writer.write(createRequest(command)));
  }

  /**
   * Used for pub/sub. Listens for replies from the Redis server.
   *
   * See
   * {@link https://redis.io/docs/latest/develop/interact/pubsub/ | Redis Pub/Sub}
   * for more information.
   *
   * @param raw If `true`, the reply will be yield as a raw
   * {@linkcode Uint8Array}. This is useful for commands that return binary
   * data, such as {@linkcode https://redis.io/docs/latest/commands/get/ | GET}.
   * The default is `false`, which returns the reply as a JavaScript value.
   *
   * @returns An async iterable iterator that yields replies from the Redis
   * server. The replies can be of various types, including strings, numbers,
   * booleans, null, and arrays of replies. The type of the reply depends on
   * the command sent. For example, the
   * {@linkcode https://redis.io/docs/latest/commands/get/ | GET} command
   * returns a string, while the
   * {@linkcode https://redis.io/docs/latest/commands/mget/ | MGET} command
   * returns an array of strings.
   *
   * @example Basic usage
   * ```ts
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
   * @param commands The array of commands to send to the Redis server. Each
   * command should be an array of arguments, where the first argument is the
   * command name and the remaining arguments are the command's arguments. For
   * the list of commands, see
   * {@link https://redis.io/docs/latest/commands/ | Redis commands}.
   * @param raw If `true`, the reply will be yield as a raw
   * {@linkcode Uint8Array}. This is useful for commands that return binary
   * data, such as {@linkcode https://redis.io/docs/latest/commands/get/ | GET}.
   * The default is `false`, which returns the reply as a JavaScript value.
   *
   * @returns An array of replies from the Redis server. The replies can be of
   * various types, including strings, numbers, booleans, null, and arrays of
   * replies. The type of the reply depends on the command sent. For example,
   * the
   * {@linkcode https://redis.io/docs/latest/commands/get/ | GET} command
   * returns a string, while the
   * {@linkcode https://redis.io/docs/latest/commands/mget/ | MGET} command
   * returns an array of strings.
   *
   * @example Basic usage
   *
   * ```ts
   * import { RedisClient } from "@iuioiua/redis";
   * import { assertEquals } from "@std/assert/equals";
   *
   * using redisConn = await Deno.connect({ port: 6379 });
   * const redisClient = new RedisClient(redisConn);
   *
   * const replies = await redisClient.pipelineCommands([
   *   ["INCR", "A"],
   *   ["INCR", "A"],
   *   ["INCR", "A"],
   *   ["INCR", "A"],
   * ]);
   * assertEquals(replies, [1, 2, 3, 4]);
   * ```
   */
  pipelineCommands(
    commands: readonly Command[],
    raw = false,
  ): Promise<Reply[]> {
    return this.#enqueue(() => {
      const bytes = concat(commands.map(createRequest));
      this.#writer.write(bytes);
      return readNReplies(this.#lines, commands.length, raw);
    });
  }
}
