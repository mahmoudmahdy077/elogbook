import { outboundRequest } from "./outbound-request.ts";

const TARGET_URL = "https://hooks.example.com/events";

type PinnedClient = object;
type CreateHttpClientOptions = {
  proxy?: { transport?: string; hostname?: string; port?: number };
};

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor?: PropertyDescriptor,
): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

Deno.test("outbound request pins fetch to a validated DNS address", async () => {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const clientFactoryDescriptor = Object.getOwnPropertyDescriptor(
    Deno,
    "createHttpClient",
  );
  const pinnedClient: PinnedClient = {};
  let factoryOptions: CreateHttpClientOptions | undefined;
  let requestInit: (RequestInit & { client?: PinnedClient }) | undefined;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init as RequestInit & { client?: PinnedClient };
      return new Response("ok", { status: 200 });
    },
  });
  Object.defineProperty(Deno, "createHttpClient", {
    configurable: true,
    writable: true,
    value: (options: CreateHttpClientOptions) => {
      factoryOptions = options;
      return pinnedClient;
    },
  });

  try {
    const result = await outboundRequest(TARGET_URL, {
      allowedHosts: ["hooks.example.com"],
      requireAllowlist: true,
      resolveHostname: () => Promise.resolve(["93.184.216.34"]),
    });

    if (!result.ok || result.status !== 200) {
      throw new Error("pinned request did not succeed");
    }
    if (factoryOptions?.proxy?.transport !== "tcp") {
      throw new Error("TCP pinning was not used");
    }
    if (factoryOptions.proxy.hostname !== "93.184.216.34") {
      throw new Error("validated IP was not pinned");
    }
    if (factoryOptions.proxy.port !== 443) {
      throw new Error("target port was not preserved");
    }
    if (requestInit?.client !== pinnedClient) {
      throw new Error("pinned client was not passed to fetch");
    }
  } finally {
    restoreProperty(globalThis, "fetch", fetchDescriptor);
    restoreProperty(Deno, "createHttpClient", clientFactoryDescriptor);
  }
});

Deno.test("outbound request fails closed when the runtime cannot pin DNS", async () => {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const clientFactoryDescriptor = Object.getOwnPropertyDescriptor(
    Deno,
    "createHttpClient",
  );
  let fetchCalls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () => {
      fetchCalls += 1;
      return new Response("unsafe");
    },
  });
  Object.defineProperty(Deno, "createHttpClient", {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const result = await outboundRequest(TARGET_URL, {
      allowedHosts: ["hooks.example.com"],
      requireAllowlist: true,
      resolveHostname: () => Promise.resolve(["93.184.216.34"]),
    });

    if (result.ok || result.category !== "blocked") {
      throw new Error("unpinning runtime did not fail closed");
    }
    if (fetchCalls !== 0) throw new Error("unpinned fetch was called");
  } finally {
    restoreProperty(globalThis, "fetch", fetchDescriptor);
    restoreProperty(Deno, "createHttpClient", clientFactoryDescriptor);
  }
});
