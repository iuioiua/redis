import { render } from "npm:preact-render-to-string";
import { RedisClient } from "../mod.ts";
import { HomePage, type Movie } from "./index.tsx";

const { REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD } = Deno.env
  .toObject();

const conn = await Deno.connect({
  hostname: REDIS_HOST,
  port: Number(REDIS_PORT),
});
const redisClient = new RedisClient(conn);

await redisClient.sendCommand([
  "HELLO",
  3,
  "AUTH",
  REDIS_USERNAME,
  REDIS_PASSWORD,
]);

export default {
  async fetch(request: Request) {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname !== "/") {
      return new Response("Not found", {
        status: 404,
        statusText: "Not found",
      });
    }

    const search = searchParams.get("search");
    const page = searchParams.get("page");

    const reply = await redisClient.sendCommand([
      "FT.SEARCH",
      "idx:movie",
      search || "*",
      "LIMIT",
      page ? Number(page) - 1 : 0,
      10,
    ]);

    const html = render(HomePage({
      // deno-lint-ignore no-explicit-any
      movies: (reply as any)!.results as Movie[],
      placeholder: search ?? undefined,
    }));

    return new Response(`<!DOCTYPE html>${html}`, {
      headers: { "content-type": "text/html" },
    });
  },
};
