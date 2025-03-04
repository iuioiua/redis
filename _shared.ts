/** Command sent to a Redis server. */
export type Command = (string | number | Uint8Array)[];
/** Reply received from a Redis server and triggered by a command. */
export type Reply =
  | string
  | number
  | null
  | boolean
  | bigint
  // deno-lint-ignore no-explicit-any
  | Record<string, any>
  | Reply[];

const encoder = new TextEncoder();

export const ARRAY_PREFIX = "*".charCodeAt(0);
export const ATTRIBUTE_PREFIX = "|".charCodeAt(0);
export const BIG_NUMBER_PREFIX = "(".charCodeAt(0);
export const BLOB_ERROR_PREFIX = "!".charCodeAt(0);
export const BOOLEAN_PREFIX = "#".charCodeAt(0);
export const BULK_STRING_PREFIX = "$".charCodeAt(0);
export const DOUBLE_PREFIX = ",".charCodeAt(0);
export const ERROR_PREFIX = "-".charCodeAt(0);
export const INTEGER_PREFIX = ":".charCodeAt(0);
export const MAP_PREFIX = "%".charCodeAt(0);
export const NULL_PREFIX = "_".charCodeAt(0);
export const PUSH_PREFIX = ">".charCodeAt(0);
export const SET_PREFIX = "~".charCodeAt(0);
export const SIMPLE_STRING_PREFIX = "+".charCodeAt(0);
export const VERBATIM_STRING_PREFIX = "=".charCodeAt(0);

export const CRLF_BYTES = encoder.encode("\r\n");
export const ARRAY_PREFIX_BYTES = encoder.encode("*");
export const BULK_STRING_PREFIX_BYTES = encoder.encode("$");
