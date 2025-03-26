import type { ComponentChildren } from "preact";
import { render } from "npm:preact-render-to-string";
import { RedisClient } from "./mod.ts";

// See https://redis.io/learn/howtos/moviesdatabase/import#movies
export interface Movie {
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
}

function Container(props: { children: ComponentChildren }) {
  return (
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      {props.children}
      <div class="mx-auto max-w-3xl"></div>
    </div>
  );
}

function Search(props: { placeholder?: string }) {
  return (
    <form id="control">
      <label
        htmlFor="search"
        class="block text-sm/6 font-medium text-gray-900"
      >
        Quick search
      </label>
      <div class="mt-2">
        <div class="flex rounded-md bg-white outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-indigo-600">
          <input
            id="search"
            name="search"
            type="text"
            class="block min-w-0 grow px-3 py-1.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6"
            placeholder="Search movies..."
            value={props.placeholder}
          />
          <div class="flex py-1.5 pr-1.5">
            <kbd class="inline-flex items-center rounded-sm border border-gray-200 px-1 font-sans text-xs text-gray-400">
              ⌘K
            </kbd>
          </div>
        </div>
      </div>

      <div class="mt-6 flex items-center justify-end gap-x-6">
        <button
          type="submit"
          class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Save
        </button>
      </div>
    </form>
  );
}

function Table(props: { movies: Movie[] }) {
  return (
    <div class="px-4 sm:px-6 lg:px-8">
      <div class="mt-8 flow-root">
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
                {props.movies.map((movie) => (
                  <tr key={movie.id}>
                    <td class="py-4 pr-3 pl-4 text-sm font-medium whitespace-nowrap text-gray-900 sm:pl-0 ">
                      {movie.extra_attributes.imdb_id
                        ? (
                          <a
                            href={`https://www.imdb.com/title/${movie.extra_attributes.imdb_id}`}
                            class="hover:underline hover:after:content-['_↗']"
                            target="_blank"
                          >
                            {movie.extra_attributes.title}
                          </a>
                        )
                        : movie.extra_attributes.title}
                    </td>
                    <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-500">
                      {movie.extra_attributes.genre}
                    </td>
                    <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-500">
                      {movie.extra_attributes.release_year}
                    </td>
                    <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-500">
                      {movie.extra_attributes.rating}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Page(props: { page?: string }) {
  return (
    <div>
      <input
        form="control"
        id="page"
        name="page"
        type="number"
        min="1"
        step="1"
        value={props.page}
        placeholder="1"
        // @ts-ignore It's fine
        onChange="this.form.submit()"
        class="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6"
      />
    </div>
  );
}

function HomePage(
  props: { movies: Movie[]; placeholder?: string; page?: string },
) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Movie search</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">
        </script>
      </head>
      <body>
        <Container>
          <Search placeholder={props.placeholder} />
          <Table movies={props.movies} />
          <Page page={props.page} />
        </Container>
      </body>
    </html>
  );
}

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
