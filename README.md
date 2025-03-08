# @iuioiua/redis

[![JSR](https://jsr.io/badges/@iuioiua/redis)](https://jsr.io/@iuioiua/redis)
[![CI](https://github.com/iuioiua/redis/actions/workflows/ci.yml/badge.svg)](https://github.com/iuioiua/redis/actions/workflows/ci.yml)

Lightning-fast, lightweight and reliable [Redis](https://redis.io/) client for
all major JavaScript runtimes.

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
- [Test coverage](https://iuioiua-redis-coverage.deno.dev/)

## Known issues

### Replies containing CRLF

This package currently doesn't correctly read replies that contain CRLF (`\r\n`)
within the message. For example, if a bulk string contains a CRLF, it'll only
return the message, up to that CLRF. The simple workaround for this is to use LF
(`\n`) for delimiting newlines, instead of CRLF.

> If this issue affects you, please open a
> [new issue](https://github.com/iuioiua/redis/issues/new). Otherwise, this
> issue is a "won't fix".

## Design

Like Italian cooking, the design of this package is defined by what it doesn't
do rather than what it does do. It doesn't extend the functionality of a TCP
connection. It doesn't implement a method for each Redis command, of which there
are hundreds. Instead, the Redis client consumes a TCP connection, lets the user
write Redis commands, and returns the parsed result according to the RESP data
type. It does this using the
[Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) to
be compatible with all the major JavaScript runtimes; [Bun](https://bun.sh/),
[Cloudflare Workers](https://workers.cloudflare.com/),
[Deno](https://deno.com/), [Node.js](https://nodejs.org/en) and web browsers.
The result is a design with fewer moving parts, fewer bugs, less maintenance,
and a smaller footprint than other JavaScript implementations of Redis clients.

| Module             | Size (KB) | Dependencies |
| ------------------ | --------- | ------------ |
| jsr:@iuioiua/redis | 17.51     | 3            |
| jsr:@db/redis      | 214.31    | 34           |
| npm:ioredis        | 897.71    | 10           |
| npm:redis          | 968.17    | 9            |

> Note: Results were produced using `deno info <module>` on February 16, 2025.
