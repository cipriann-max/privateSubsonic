/**
 * Provider contract. One file, one shape, one implementation for v0.1.
 * Adding Musopen later should be a new module in this directory exporting
 * the same shape — no loader, no manifest, no registry beyond index.ts.
 */
export type { Provider, SearchOpts, SearchResult, Artist, Album, Track } from "../types.js";