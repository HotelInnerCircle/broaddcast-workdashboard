/**
 * What to do when a request throws.
 *
 * Next.js shows the person a generic page with a digest - "Digest: 3481462143"
 * - and by default writes nothing that ties that digest to a stack trace. An
 * error reported as a digest and nothing else takes an afternoon to find, which
 * is exactly what happened with the employee detail page.
 *
 * This prints the digest next to the error, the route it came from, and the
 * stack, so the number on the person's screen can be searched for in the
 * function logs and lands on the line that threw.
 *
 * It deliberately logs no request body, no query values and no headers: those
 * carry session tokens and an employee's own data, and a log is a place things
 * leak from. The route and the stack are enough to find any of this again.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  const err = error as { digest?: string; message?: string; stack?: string; name?: string };
  // `notFound()` and `redirect()` are thrown on purpose and are not faults.
  if (typeof err?.digest === "string" && /^(NEXT_NOT_FOUND|NEXT_REDIRECT)/.test(err.digest)) return;

  console.error(
    [
      "",
      "=== request failed ===",
      `digest:  ${err?.digest ?? "(none)"}`,
      `where:   ${request?.method ?? "?"} ${request?.path ?? context?.routePath ?? "?"}`,
      `kind:    ${context?.routerKind ?? "?"} / ${context?.routeType ?? "?"}`,
      `error:   ${err?.name ?? "Error"}: ${err?.message ?? String(error)}`,
      err?.stack ? `stack:\n${err.stack}` : "",
      "======================",
    ].join("\n"),
  );
}

export async function register() {
  // Nothing to start up yet. When an error reporter (Sentry and the like) is
  // added, this is where it is initialised.
}
