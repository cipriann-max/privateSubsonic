import { Agent, interceptors, type Dispatcher } from "undici";

/**
 * Shared undici dispatcher for all outbound HTTP (provider API calls and the
 * stream proxy). undici v7 removed the `maxRedirections` option from
 * `request()`; following redirects now requires the redirect interceptor,
 * composed here once and reused everywhere via the `dispatcher` option.
 * Archive.org relies on this: /download URLs 302-redirect to the real node.
 */
export const httpDispatcher: Dispatcher = new Agent().compose(
  interceptors.redirect({ maxRedirections: 10 }),
);