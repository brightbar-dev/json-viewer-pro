// The project has no @types/node (tests run in Node, the code targets browsers).
// Declare the one Node API a test uses.
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
