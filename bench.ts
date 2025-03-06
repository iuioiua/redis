/// <reference lib="deno.ns" />
import * as denoRedis from "jsr:@db/redis";
import { Redis } from "npm:ioredis";
import { createClient } from "npm:redis";

import { RedisClient } from "./mod.ts";

const hostname = "127.0.0.1";
const port = 6379;

const redisConn = await Deno.connect({ hostname, port });
const redisClient = new RedisClient(redisConn);
const denoRedisConn = await denoRedis.connect({ hostname, port });
const ioRedis = new Redis();

const nodeRedisClient = await createClient().connect();

Deno.bench("@iuioiua/redis", { group: "ping", baseline: true }, async () => {
  await redisClient.sendCommand(["PING"]);
});

Deno.bench(
  "@iuioiua/redis",
  { group: "hash set and get", baseline: true },
  async () => {
    await redisClient.sendCommand(["HSET", "hash", "a", "foo", "b", "bar"]);
    await redisClient.sendCommand(["HGETALL", "hash"]);
  },
);

Deno.bench(
  "@iuioiua/redis",
  { group: "pipeline", baseline: true },
  async () => {
    await redisClient.pipelineCommands([
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
    ]);
  },
);

Deno.bench("@db/redis", { group: "ping" }, async () => {
  await denoRedisConn.ping();
});

Deno.bench("@db/redis", { group: "hash set and get" }, async () => {
  await denoRedisConn.hset("hash", { a: "foo", b: "bar" });
  await denoRedisConn.hgetall("hash");
});

Deno.bench("@db/redis", { group: "pipeline" }, async () => {
  const pl = denoRedisConn.pipeline();
  pl.incr("X");
  pl.incr("X");
  pl.incr("X");
  pl.incr("X");
  await pl.flush();
});

Deno.bench("npm:ioredis", { group: "ping" }, async () => {
  await ioRedis.ping();
});

Deno.bench("npm:ioredis", { group: "hash set and get" }, async () => {
  await ioRedis.hset("hash", { a: "foo", b: "bar" });
  await ioRedis.hgetall("hash");
});

Deno.bench("npm:ioredis", { group: "pipeline" }, async () => {
  const pl = ioRedis.pipeline();
  pl.incr("X");
  pl.incr("X");
  pl.incr("X");
  pl.incr("X");
  await pl.exec();
});

Deno.bench("npm:redis", { group: "ping" }, async () => {
  await nodeRedisClient.ping();
});

Deno.bench("npm:redis", { group: "hash set and get" }, async () => {
  await nodeRedisClient.hSet("hash", { a: "foo", b: "bar" });
  await nodeRedisClient.hGetAll("hash");
});

Deno.bench("npm:redis", { group: "pipeline" }, async () => {
  await nodeRedisClient.incr("X");
  await nodeRedisClient.incr("X");
  await nodeRedisClient.incr("X");
  await nodeRedisClient.incr("X");
});
