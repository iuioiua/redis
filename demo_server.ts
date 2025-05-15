import { RedisClient } from "@iuioiua/redis";

interface SearchReply {
  total_results: number;
  // Corrected version of fields in https://redis.io/learn/howtos/moviesdatabase/import#movies
  results: {
    id: string;
    extra_attributes: {
      title: string;
      plot: string;
      genre: string;
      release_year: string;
      rating: string;
      votes: string;
      poster: string;
      imdb_id: string;
    };
  }[];
}
const RESULTS_PER_PAGE = 10;

function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  return strings.reduce(
    (result, str, i) => result + str + (values[i] ?? ""),
    "",
  );
}

function renderHomePage(
  props: { reply: SearchReply; searchParams: URLSearchParams },
) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Movie Dataset</title>
        <meta name="description" content="Demo for @iuioiua/redis">
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
      </head>
      <body class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <main>
          <form id="control" class="mt-2 flex gap-2">
            <div class="flex flex-1 rounded-md bg-white outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-red-600">
              <input
                id="search"
                name="search"
                type="search"
                class="block min-w-0 grow px-3 py-1.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6"
                placeholder="Search movies..."
                value="${props.searchParams.get("search") || undefined}"
              >
              <div class="flex py-1.5 pr-1.5">
                <kbd
                  class="inline-flex items-center rounded-sm border border-gray-200 px-1 font-sans text-xs text-gray-400"
                >
                  ⌘K
                </kbd>
              </div>
            </div>
            <input type="submit" hidden>
            <a
              href="/"
              class="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 shadow-xs hover:bg-red-100"
            >
              Reset
            </a>
          </form>
          <div class="my-8 flow-root">
            <div class="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
              <div class="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                <table class="min-w-full divide-y divide-gray-300">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        class="py-3.5 pr-3 pl-4 text-left text-sm font-semibold text-gray-900 sm:pl-0"
                      >
                        Title
                      </th>
                      <th
                        scope="col"
                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                      >
                        Genre
                      </th>
                      <th
                        scope="col"
                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                      >
                        Release year
                      </th>
                      <th
                        scope="col"
                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                      >
                        Rating
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200">
                    ${props.reply.results.map((movie) =>
      html`
        <tr>
          <td class="py-4 pr-3 pl-4 text-sm font-medium whitespace-nowrap text-gray-900 sm:pl-0">
            ${movie.extra_attributes.imdb_id
          ? (
            html`
              <a
                href="https://www.imdb.com/title/${movie.extra_attributes
                .imdb_id}"
                class="hover:underline hover:after:content-['_↗']"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${movie.extra_attributes.title}
              </a>
            `
          )
          : movie.extra_attributes.title}
          </td>
          <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-500">
            ${movie.extra_attributes.genre}
          </td>
          <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-500">
            ${movie.extra_attributes.release_year}
          </td>
          <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-500">
            ${movie.extra_attributes.rating}
          </td>
        </tr>
      `
    ).join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <input
            form="control"
            id="page"
            name="page"
            type="number"
            min="1"
            max="${Math.ceil(props.reply.total_results / RESULTS_PER_PAGE) ||
      1}"
            value="${props.searchParams.get("page") || 1}"
            placeholder="1"
            onChange="this.form.submit()"
            class="mx-auto block rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-red-600 sm:text-sm/6"
          >
        </main>
        <footer class="mx-auto max-w-7xl overflow-hidden px-6 py-20 sm:py-24 lg:px-8">
          <nav
            aria-label="Footer"
            class="-mb-6 flex flex-wrap justify-center gap-x-12 gap-y-3 text-sm/6"
          >
            <a
              href="https://github.com/iuioiua/redis"
              class="text-gray-600 hover:text-gray-900"
            >
              Source
            </a>
          </nav>
        </footer>
      </body>
    </html>
  `;
}

function assertEnv(key?: string): asserts key is string {
  if (key === undefined) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const { REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD } = Deno.env
  .toObject();

assertEnv(REDIS_HOST);
assertEnv(REDIS_PORT);
assertEnv(REDIS_USERNAME);
assertEnv(REDIS_PASSWORD);

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

    const page = searchParams.get("page");

    const reply = await redisClient.sendCommand([
      "FT.SEARCH",
      "idx:movie",
      searchParams.get("search") || "*",
      "LIMIT",
      page ? Number(page) - 1 : 0,
      RESULTS_PER_PAGE,
    ]) as SearchReply;

    const homePage = renderHomePage({
      reply,
      searchParams,
    });

    return new Response(homePage, {
      headers: { "content-type": "text/html" },
    });
  },
};
