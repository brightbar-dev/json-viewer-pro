// The project has no @types/node (tests run in Node, the code targets browsers).
// Declare the few Node APIs tests use.
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
declare module 'node:util' {
  export function isDeepStrictEqual(a: unknown, b: unknown): boolean;
}
