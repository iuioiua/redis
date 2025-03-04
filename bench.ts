import * as denoRedis from "@db/redis";
import { Redis } from "ioredis";
import { createClient } from "redis";
import { RedisClient as DenoRedisClient } from "./deno.ts";
import { RedisClient as WebRedisClient } from "./web.ts";

const hostname = "127.0.0.1";
const port = 6379;

const redisConn = await Deno.connect({ hostname, port });
const denoRedisClient = new DenoRedisClient(redisConn);
const webRedisClient = new WebRedisClient(redisConn);
const denoRedisConn = await denoRedis.connect({ hostname, port });
const ioRedis = new Redis();

const nodeRedisClient = await createClient().connect();

Deno.bench({
  name: "@iuioiua/redis (deno)",
  ignore: true,
  baseline: true,
  async fn() {
    await denoRedisClient.sendCommand(["PING"]);

    await denoRedisClient.sendCommand(["SET", "mykey", "Hello"]);
    await denoRedisClient.sendCommand(["GET", "mykey"]);

    await denoRedisClient.sendCommand(["HSET", "hash", "a", "foo", "b", "bar"]);
    await denoRedisClient.sendCommand(["HGETALL", "hash"]);

    await denoRedisClient.pipelineCommands([
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
    ]);
  },
});

Deno.bench({
  name: "@iuioiua/redis (web)",
  baseline: true,
  async fn() {
    await webRedisClient.sendCommand(["PING"]);

    await webRedisClient.sendCommand(["SET", "mykey", "Hello"]);
    await webRedisClient.sendCommand(["GET", "mykey"]);

    await webRedisClient.sendCommand(["HSET", "hash", "a", "foo", "b", "bar"]);
    await webRedisClient.sendCommand(["HGETALL", "hash"]);

    await webRedisClient.pipelineCommands([
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
      ["INCR", "X"],
    ]);
  },
});

Deno.bench({
  name: "@db/redis",
  async fn() {
    await denoRedisConn.ping();

    await denoRedisConn.set("mykey", "Hello");
    await denoRedisConn.get("mykey");

    await denoRedisConn.hset("hash", { a: "foo", b: "bar" });
    await denoRedisConn.hgetall("hash");

    const pl = denoRedisConn.pipeline();
    pl.incr("X");
    pl.incr("X");
    pl.incr("X");
    pl.incr("X");
    await pl.flush();
  },
});

Deno.bench({
  name: "npm:ioredis",
  async fn() {
    await ioRedis.ping();

    await ioRedis.set("mykey", "Hello");
    await ioRedis.get("mykey");

    await ioRedis.hset("hash", { a: "foo", b: "bar" });
    await ioRedis.hgetall("hash");

    const pl = ioRedis.pipeline();
    pl.incr("X");
    pl.incr("X");
    pl.incr("X");
    pl.incr("X");
    await pl.exec();
  },
});

Deno.bench({
  name: "npm:redis",
  async fn() {
    await nodeRedisClient.ping();

    await nodeRedisClient.set("mykey", "Hello");
    await nodeRedisClient.get("mykey");

    await nodeRedisClient.hSet("hash", { a: "foo", b: "bar" });
    await nodeRedisClient.hGetAll("hash");

    // Auto-pipelining
    await nodeRedisClient.incr("X");
    await nodeRedisClient.incr("X");
    await nodeRedisClient.incr("X");
    await nodeRedisClient.incr("X");
  },
});
