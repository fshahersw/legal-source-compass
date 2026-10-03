/** A JSON value; server functions may only return serializable data, so untyped payloads use this instead of `any`. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
