export type { Command, Reply } from "./_shared.ts";
import { RedisClient as DenoRedisClient } from "./deno.ts";
import { RedisClient as WebRedisClient } from "./web.ts";

export const RedisClient = navigator.userAgent?.includes("Deno")
  ? DenoRedisClient
  : WebRedisClient;
