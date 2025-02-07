# @iuioiua/redis

[![JSR](https://jsr.io/badges/@iuioiua/redis)](https://jsr.io/@iuioiua/redis)
[![CI](https://github.com/iuioiua/redis/actions/workflows/ci.yml/badge.svg)](https://github.com/iuioiua/redis/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/iuioiua/redis/branch/main/graph/badge.svg?token=8IDAVSL014)](https://r2d2-coverage.deno.dev/)

Minimal [Redis](https://redis.io/) client for [Deno](https://deno.land/).

```ts
import { RedisClient } from "@iuioiua/redis";
import { assertEquals } from "@std/assert/equals";

using redisConn = await Deno.connect({ port: 6379 });
const redisClient = new RedisClient(redisConn);

const reply1 = await redisClient.sendCommand(["SET", "hello", "world"]);
assertEquals(reply1, "OK");

const reply2 = await redisClient.sendCommand(["GET", "hello"]);
assertEquals(reply2, "world");
```

## Features

- Supports RESPv2, RESP3, raw data, pipelining, pub/sub, transactions and Lua
  scripts.
- Compatible with timeouts and retries.
- One of the fastest Redis clients in Deno.
- Written to be easily understood and debugged.
- Encourages the use of actual Redis commands without intermediate abstractions.

## Resources

- [Documentation](https://jsr.io/@iuioiua/redis/doc)
- [Contributing guidelines](./CONTRIBUTING.md)

## Size comparison

| Module         | Size (KB) | Dependencies |
| -------------- | --------- | ------------ |
| @iuioiua/redis | 25.04     | 4            |
| deno-redis     | 213.19    | 33           |
| npm:ioredis    | 895.38    | 10           |
| npm:redis      | 968.17    | 9            |

Recorded on December 20, 2024.

> Note: Results were produced using `deno info <module>`
