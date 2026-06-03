// Vitest alias target for Next.js' `server-only` package. The real
// module throws at import time outside an RSC build, which would
// crash any test suite that imports a server-tagged module. This
// empty shim lets the tests run while keeping the import-time guard
// active in the actual Next.js build (alias only applies in vitest).
export {};
