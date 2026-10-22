import { afterEach, expect, it, vi } from "vitest";
import { configureEmbeddedRequestMiddleware, getRegistryClient } from "./rest.utils";
import type { ConfigService } from "@services/useConfigService";
import type { AuthService } from "@apitomy/common-ui-components";
import type { Middleware } from "@microsoft/kiota-http-fetchlibrary";

const config = { artifactsUrl: () => "http://localhost/apis/registry/v3" } as ConfigService;
const auth = { isOidcAuthEnabled: () => false, isBasicAuthEnabled: () => false } as AuthService;

afterEach(() => { configureEmbeddedRequestMiddleware(); vi.unstubAllGlobals(); });

it("runs host middleware before the SDK terminal fetch handler and clears it on teardown", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const middleware: Middleware = {
        next: undefined,
        async execute(url, init, options) {
            const headers = new Headers(init.headers);
            headers.set("X-Embedded", "console");
            return this.next!.execute(url, { ...init, headers }, options);
        }
    };
    configureEmbeddedRequestMiddleware([middleware]);
    await getRegistryClient(config, auth).system.info.get();
    expect(new Headers(fetch.mock.calls[0][1].headers).get("X-Embedded")).toBe("console");
    configureEmbeddedRequestMiddleware();
    await getRegistryClient(config, auth).system.info.get();
    expect(new Headers(fetch.mock.calls[1][1].headers).has("X-Embedded")).toBe(false);
});
