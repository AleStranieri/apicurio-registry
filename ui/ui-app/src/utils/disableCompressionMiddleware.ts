import type { Middleware } from "@microsoft/kiota-http-fetchlibrary";
import type { RequestOption } from "@microsoft/kiota-abstractions";
import { CompressionHandlerOptions } from "@microsoft/kiota-http-fetchlibrary";

/**
 * Disables request body compression for all Registry API calls in standalone mode.
 * Registry 3.3.x does not decode gzip-compressed request bodies (returns 400).
 */
export class DisableCompressionMiddleware implements Middleware {
    next: Middleware | undefined;

    async execute(url: string, requestInit: RequestInit,
        requestOptions?: Record<string, RequestOption>): Promise<Response> {
        if (!this.next) {
            throw new Error("DisableCompressionMiddleware.next is not set");
        }
        const compression = new CompressionHandlerOptions({ enableCompression: false });
        return this.next.execute(url, requestInit, {
            ...requestOptions,
            [compression.getKey()]: compression
        });
    }
}
