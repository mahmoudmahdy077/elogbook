const returnUrlModule = await import("./return-url.ts").catch(() => null);

function assertEquals<T>(actual: T, expected: T): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

type ReturnUrlResolver = (
  input: unknown,
  appOrigin: string,
  allowedOrigins: readonly string[],
) => string | null;

function resolve(
  input: unknown,
  appOrigin = "https://app.elogbook.test",
): string | null {
  if (!returnUrlModule) throw new Error("portal return URL policy is missing");
  return (returnUrlModule.resolvePortalReturnUrl as ReturnUrlResolver)(
    input,
    appOrigin,
    ["https://app.elogbook.test", "https://elogbook.test"],
  );
}

Deno.test("portal return URL accepts the exact tenant billing relative path", () => {
  assertEquals(
    resolve("/acme-hospital/billing?tab=invoices"),
    "https://app.elogbook.test/acme-hospital/billing?tab=invoices",
  );
});

Deno.test("portal return URL accepts only an exact allowlisted origin", () => {
  assertEquals(resolve("https://elogbook.test"), "https://elogbook.test");
  assertEquals(resolve("https://elogbook.test/"), "https://elogbook.test");
});

Deno.test("portal return URL defaults to the configured app origin", () => {
  assertEquals(resolve(undefined), "https://app.elogbook.test");
  assertEquals(resolve(""), "https://app.elogbook.test");
});

Deno.test("portal return URL rejects unsafe schemes and protocol-relative URLs", () => {
  for (
    const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example/billing",
    ]
  ) {
    assertEquals(resolve(value), null);
  }
});

Deno.test("portal return URL rejects cross-origin and non-billing paths", () => {
  for (
    const value of [
      "https://evil.example/acme/billing",
      "/acme/settings",
      "/acme/billing/extra",
      "https://app.elogbook.test/acme/settings",
      "/%2f%2fevil.example/billing",
      "/\\evil.example/billing",
    ]
  ) {
    assertEquals(resolve(value), null);
  }
});
