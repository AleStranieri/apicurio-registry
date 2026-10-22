// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleProxyMiddleware } from "../../../../console-plugin/src/utils/console-proxy-middleware";

const proxy = "/api/proxy/plugin/apicurio-registry/registry-api/apis/registry/v3/groups/default/artifacts";

afterEach(() => {
    document.cookie = "csrf-token=; Max-Age=0; path=/";
});

describe("console proxy middleware", () => {
    it("adds the console CSRF token while preserving request headers and body", async () => {
        document.cookie = "csrf-token=test-token; path=/";
        const execute = vi.fn().mockResolvedValue(new Response("saved", { status: 200 }));
        const middleware = new ConsoleProxyMiddleware();
        middleware.next = { execute, next: undefined };
        const response = await middleware.execute(proxy, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "content" });
        const request = execute.mock.calls[0][1];
        expect(request.headers.get("X-CSRFToken")).toBe("test-token");
        expect(request.headers.get("Content-Type")).toBe("application/json");
        expect(request.body).toBe("content");
        expect(execute.mock.calls[0][2].CompressionHandlerOptionsKey.ShouldCompress).toBe(false);
        expect(await response.text()).toBe("saved");
    });

    it.each(["https://other.example" + proxy, "/api/kubernetes", "/apis/registry/v3"])("does not disclose the token to %s", async url => {
        document.cookie = "csrf-token=test-token; path=/";
        const execute = vi.fn().mockResolvedValue(new Response());
        const middleware = new ConsoleProxyMiddleware();
        middleware.next = { execute, next: undefined };
        await middleware.execute(url, {});
        expect(execute.mock.calls[0][1].headers.has("X-CSRFToken")).toBe(false);
    });

    it("forwards a 403 unchanged when no CSRF cookie is present", async () => {
        const execute = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
        const middleware = new ConsoleProxyMiddleware();
        middleware.next = { execute, next: undefined };
        const response = await middleware.execute(proxy, { method: "PUT" });
        expect(execute.mock.calls[0][1].headers.has("X-CSRFToken")).toBe(false);
        expect(response.status).toBe(403);
        expect(await response.text()).toBe("Forbidden");
    });
});
