/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert/equals";
import { assertRejects } from "@std/assert/rejects";
import { type Command, RedisClient, RedisError, type Reply } from "./mod.ts";

const redisConn = await Deno.connect({ port: 6379 });
const redisClient = new RedisClient(redisConn);

function createConn(output: string) {
  return {
    readable: ReadableStream.from([output]).pipeThrough(
      new TextEncoderStream(),
    ),
    writable: new WritableStream(),
  };
}

async function assertSendCommandEquals(command: Command, expected: Reply) {
  const actual = await redisClient.sendCommand(command);
  assertEquals(actual, expected);
}

async function assertReadReplyEquals<T extends Reply>(
  output: string,
  expected: T,
  raw = false,
) {
  const redisClient = new RedisClient(createConn(output));
  const { value } = await redisClient.readReplies<T>(raw).next();
  assertEquals<T>(value, expected);
}

function assertReadReplyRejects(output: string, expectedMsg: string) {
  const redisClient = new RedisClient(createConn(output));
  return assertRejects(
    () => redisClient.readReplies().next(),
    RedisError,
    expectedMsg,
  );
}

Deno.test("readReply() - mixed array", () =>
  assertReadReplyEquals("*3\r\n$5\r\nstring\r\n:123\r\n$-1\r\n", [
    "string",
    123,
    null,
  ]));

Deno.test("readReply() - empty array", () =>
  assertReadReplyEquals("*0\r\n", []));

Deno.test("readReply() - null array", () =>
  assertReadReplyEquals("*-1\r\n", null));

Deno.test("readReply() - nested array", () =>
  assertReadReplyEquals("*2\r\n*3\r\n:1\r\n$5\r\nhello\r\n:2\r\n#f\r\n", [[
    1,
    "hello",
    2,
  ], false]));

Deno.test("readReply() - attribute", async () => {
  await assertReadReplyEquals(
    "|1\r\n+key-popularity\r\n%2\r\n$1\r\na\r\n,0.1923\r\n$1\r\nb\r\n,0.0012\r\n*2\r\n:2039123\r\n:9543892\r\n",
    [2039123, 9543892],
  );
  await assertReadReplyEquals(
    "*3\r\n:1\r\n:2\r\n|1\r\n+ttl\r\n:3600\r\n:3\r\n",
    [
      1,
      2,
      3,
    ],
  );
});

Deno.test("readReply() - positive big number", () =>
  assertReadReplyEquals(
    "(3492890328409238509324850943850943825024385\r\n",
    3492890328409238509324850943850943825024385n,
  ));

Deno.test("readReply() - negative big number", () =>
  assertReadReplyEquals(
    "(-3492890328409238509324850943850943825024385\r\n",
    -3492890328409238509324850943850943825024385n,
  ));

Deno.test("readReply() - true boolean", () =>
  assertReadReplyEquals("#t\r\n", true));

Deno.test("readReply() - false boolean", () =>
  assertReadReplyEquals("#f\r\n", false));

Deno.test("readReply() - integer", () => assertReadReplyEquals(":42\r\n", 42));

Deno.test("readReply() - bulk string", () =>
  assertReadReplyEquals("$5\r\nhello\r\n", "hello"));

Deno.test("readReply() - bulk string containing CRLF (known issue)", () =>
  assertReadReplyEquals("$7\r\nhello\r\n\r\n", "hello"));

Deno.test("readReply() - emtpy bulk string", () =>
  assertReadReplyEquals(
    "%2\r\n$5\r\nempty\r\n$0\r\n\r\n$3\r\nfoo\r\n$3\r\nbar\r\n",
    { empty: "", foo: "bar" },
  ));

Deno.test("readReply() - emtpy raw bulk string", () =>
  assertReadReplyEquals("$0\r\n\r\n", new Uint8Array(), true));

Deno.test("readReply() - null bulk string", () =>
  assertReadReplyEquals("$-1\r\n", null));

Deno.test("readReply() - blob error", async () => {
  await assertReadReplyRejects(
    "!21\r\nSYNTAX invalid syntax\r\n",
    "SYNTAX invalid syntax",
  );
});

Deno.test("readReply() - error", async () => {
  await assertReadReplyRejects(
    "-ERR this is the error description\r\n",
    "ERR this is the error description",
  );
});

Deno.test("readReply() - double", () =>
  assertReadReplyEquals(",1.23\r\n", 1.23));

Deno.test("readReply() - positive infinity double", () =>
  assertReadReplyEquals(",inf\r\n", Infinity));

Deno.test("readReply() - negative infinity double", () =>
  assertReadReplyEquals(",-inf\r\n", -Infinity));

Deno.test("readReply() - map", () =>
  assertReadReplyEquals("%2\r\n+first\r\n:1\r\n+second\r\n:2\r\n", {
    first: 1,
    second: 2,
  }));

Deno.test("readReply() - null", () => assertReadReplyEquals("_\r\n", null));

Deno.test("readReply() - push", () =>
  assertReadReplyEquals(
    ">4\r\n+pubsub\r\n+message\r\n+somechannel\r\n+this is the message\r\n",
    ["pubsub", "message", "somechannel", "this is the message"],
  ));

Deno.test("readReply() - set", () =>
  assertReadReplyEquals(
    "~5\r\n+orange\r\n+apple\r\n#t\r\n:100\r\n:999\r\n",
    new Set(["orange", "apple", true, 100, 999]),
  ));

Deno.test("readReply() - simple string", () =>
  assertReadReplyEquals("+OK\r\n", "OK"));

Deno.test("readReply() - verbatim string", () =>
  assertReadReplyEquals("=15\r\ntxt:Some string\r\n", "txt:Some string"));

Deno.test("readReply() - large reply", async () => {
  const reply = "a".repeat(4096 * 2);
  await assertReadReplyEquals(`$${reply.length}\r\n${reply}\r\n`, reply);
});

Deno.test("RedisClient.sendCommand() - transactions", async () => {
  await assertSendCommandEquals(["MULTI"], "OK");
  await assertSendCommandEquals(["INCR", "FOO"], "QUEUED");
  await assertSendCommandEquals(["INCR", "BAR"], "QUEUED");
  await assertSendCommandEquals(["EXEC"], [1, 1]);
});

Deno.test("RedisClient.sendCommand() - raw data", async () => {
  const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assertEquals(await redisClient.sendCommand(["SET", "binary", data]), "OK");
  assertEquals(await redisClient.sendCommand(["GET", "binary"], true), data);
});

Deno.test("RedisClient.sendCommand() - eval script", () =>
  assertSendCommandEquals(["EVAL", "return ARGV[1]", 0, "hello"], "hello"));

Deno.test("RedisClient.sendCommand() - Lua script", async () => {
  await assertSendCommandEquals([
    "FUNCTION",
    "LOAD",
    "#!lua name=mylib\nredis.register_function('knockknock', function() return 'Who\\'s there?' end)",
  ], "mylib");
  await assertSendCommandEquals(["FCALL", "knockknock", 0], "Who's there?");
});

Deno.test("RedisClient.sendCommand() - RESP3", async () => {
  await redisClient.sendCommand(["HELLO", 3]);
  await assertSendCommandEquals(["HSET", "hash3", "foo", 1, "bar", 2], 2);
  await assertSendCommandEquals(["HGETALL", "hash3"], {
    foo: "1",
    bar: "2",
  });
});

Deno.test("RedisClient.sendCommand() - race condition (#146)", async () => {
  await Promise.all(Array.from({ length: 20 }, async () => {
    const key = crypto.randomUUID();
    const value = crypto.randomUUID();
    await redisClient.sendCommand(["SET", key, value]);
    const result = await redisClient.sendCommand(["GET", key]);
    assertEquals(result, value);
  }));
});

Deno.test("RedisClient.pipelineCommands()", async () => {
  assertEquals(
    await redisClient.pipelineCommands([
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
    ]),
    [1, 2, 3, 4],
  );
});

Deno.test("RedisClient.writeCommand() + RedisClient.readReplies()", async () => {
  await redisClient.writeCommand(["SUBSCRIBE", "mychannel"]);
  const iterator = redisClient.readReplies();
  assertEquals(await iterator.next(), {
    value: ["subscribe", "mychannel", 1],
    done: false,
  });
  await redisClient.writeCommand(["UNSUBSCRIBE"]);
  assertEquals(await iterator.next(), {
    value: ["unsubscribe", "mychannel", 0],
    done: false,
  });
});

Deno.test("RedisClient.sendCommand() - error recovery", async () => {
  // Send an invalid command that will cause an error
  await assertRejects(
    () => redisClient.sendCommand(["INVALIDCOMMAND", "arg1"]),
    RedisError,
    "ERR unknown command 'INVALIDCOMMAND', with args beginning with: 'arg1' ",
  );

  // Subsequent commands should still work
  await assertSendCommandEquals(["SET", "test-key", "test-value"], "OK");
  await assertSendCommandEquals(["GET", "test-key"], "test-value");

  // Another error should also be handled correctly
  await assertRejects(
    () => redisClient.sendCommand(["YETANOTHERBADCMD"]),
    RedisError,
    "ERR unknown command 'YETANOTHERBADCMD', with args beginning with: ",
  );

  // And subsequent commands should still work
  await assertSendCommandEquals(["DEL", "test-key"], 1);
});
