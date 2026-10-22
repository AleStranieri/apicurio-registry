import type { Middleware } from "@microsoft/kiota-http-fetchlibrary";
import type { RequestOption } from "@microsoft/kiota-abstractions";
import { CompressionHandlerOptions } from "@microsoft/kiota-http-fetchlibrary";

/** The console proxy requires its CSRF cookie on writes, even with local auth disabled. */
export class ConsoleProxyMiddleware implements Middleware {
    next: Middleware | undefined;

    async execute(url: string, requestInit: RequestInit,
        requestOptions?: Record<string, RequestOption>): Promise<Response> {
        if (!this.next) {
            throw new Error("ConsoleProxyMiddleware.next is not set");
        }
        const target = new URL(url, window.location.origin);
        const headers = new Headers(requestInit.headers);
        if (target.origin === window.location.origin &&
            target.pathname.startsWith("/api/proxy/plugin/apicurio-registry/registry-api/")) {
            const cookie = document.cookie.split(";").map(value => value.trim())
                .find(value => value.startsWith("csrf-token="));
            if (cookie) {
                headers.set("X-CSRFToken", cookie.slice("csrf-token=".length));
            }
            // The Registry 3.3.1 used by this PoC does not decode gzip request bodies.
            const compression = new CompressionHandlerOptions({ enableCompression: false });
            requestOptions = { ...requestOptions, [compression.getKey()]: compression };
        }
        return this.next.execute(url, { ...requestInit, headers }, requestOptions);
    }
}
