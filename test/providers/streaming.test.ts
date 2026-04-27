import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { streamRequest, withTimeout } from "../../src/providers/node-stream";

/**
 * These tests spin up a tiny real HTTP server on an ephemeral port and exercise
 * streamRequest() against it. Using a real server gives us genuine chunked
 * delivery, abort behavior, and error-status coverage without mocking Node's
 * http module.
 */

describe("streamRequest", () => {
  let server: Server;
  let baseUrl: string;

  // Each test handler is a fresh function assigned per-test
  let currentHandler: (req: import("http").IncomingMessage, res: import("http").ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => currentHandler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("emits chunks as they arrive and resolves with status + fullText", async () => {
    currentHandler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("chunk-1-");
      // Delay the second chunk so we can prove real chunked delivery
      setTimeout(() => {
        res.write("chunk-2");
        res.end();
      }, 20);
    };

    const received: string[] = [];
    const result = await streamRequest({
      url: `${baseUrl}/stream`,
      method: "GET",
      headers: {},
      onChunk: (text) => received.push(text),
    });

    expect(result.status).toBe(200);
    expect(result.fullText).toBe("chunk-1-chunk-2");
    // Both chunks should have been delivered as separate onChunk calls
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received.join("")).toBe("chunk-1-chunk-2");
  });

  it("POSTs a body and forwards headers", async () => {
    let seenBody = "";
    let seenAuth = "";
    currentHandler = (req, res) => {
      seenAuth = req.headers["authorization"] ?? "";
      const bufs: Buffer[] = [];
      req.on("data", (b: Buffer) => bufs.push(b));
      req.on("end", () => {
        seenBody = Buffer.concat(bufs).toString();
        res.writeHead(200);
        res.end("ok");
      });
    };

    const result = await streamRequest({
      url: `${baseUrl}/post`,
      method: "POST",
      headers: { authorization: "Bearer xyz", "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
      onChunk: () => { /* ignore */ },
    });

    expect(result.status).toBe(200);
    expect(seenBody).toBe('{"hello":"world"}');
    expect(seenAuth).toBe("Bearer xyz");
  });

  it("aborts mid-stream when the AbortSignal fires", async () => {
    let serverSawAbort = false;
    currentHandler = (req, res) => {
      res.writeHead(200);
      res.write("part-1");
      req.on("close", () => {
        // Node fires this when the client drops the connection
        if (!res.writableEnded) serverSawAbort = true;
      });
      // Never end the response -- we're testing client-side abort
    };

    const controller = new AbortController();
    const received: string[] = [];

    const promise = streamRequest({
      url: `${baseUrl}/slow`,
      method: "GET",
      headers: {},
      signal: controller.signal,
      onChunk: (text) => {
        received.push(text);
        // Abort after first chunk arrives
        controller.abort();
      },
    });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(received[0]).toBe("part-1");
    // Give the server event loop a tick to process the socket close
    await new Promise((r) => setTimeout(r, 20));
    expect(serverSawAbort).toBe(true);
  });

  it("rejects immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    currentHandler = (_req, res) => {
      res.writeHead(200);
      res.end("should not be reached");
    };

    await expect(
      streamRequest({
        url: `${baseUrl}/x`,
        method: "GET",
        headers: {},
        signal: controller.signal,
        onChunk: () => { /* ignore */ },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("captures 4xx responses with full body text (not thrown)", async () => {
    currentHandler = (_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad request detail" } }));
    };

    const result = await streamRequest({
      url: `${baseUrl}/bad`,
      method: "POST",
      headers: {},
      body: "{}",
      onChunk: () => { /* ignore */ },
    });

    expect(result.status).toBe(400);
    expect(result.fullText).toContain("bad request detail");
  });

  it("captures 5xx responses with full body text", async () => {
    currentHandler = (_req, res) => {
      res.writeHead(503);
      res.end("server overloaded");
    };

    const result = await streamRequest({
      url: `${baseUrl}/oops`,
      method: "GET",
      headers: {},
      onChunk: () => { /* ignore */ },
    });

    expect(result.status).toBe(503);
    expect(result.fullText).toBe("server overloaded");
  });

  describe("timeout", () => {
    it("rejects with TimeoutError when the server never responds", async () => {
      // Handler accepts the connection but never writes a response. Without a
      // timeout, this hangs forever -- the bug we're fixing in #18.
      currentHandler = (_req, _res) => {
        // Intentionally do nothing -- never send headers, never end the response.
      };

      const start = Date.now();
      await expect(
        streamRequest({
          url: `${baseUrl}/never-responds`,
          method: "GET",
          headers: {},
          timeoutMs: 150,
          onChunk: () => { /* never called */ },
        }),
      ).rejects.toMatchObject({ name: "TimeoutError" });

      // Should fire near our 150ms threshold, not run to completion or vitest's 5s default.
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(140);
      expect(elapsed).toBeLessThan(2000);
    });

    it("does not fire when the server responds within the budget", async () => {
      currentHandler = (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      };

      const result = await streamRequest({
        url: `${baseUrl}/fast`,
        method: "GET",
        headers: {},
        timeoutMs: 1000,
        onChunk: () => { /* ignore */ },
      });
      expect(result.status).toBe(200);
      expect(result.fullText).toBe("ok");
    });

    it("timeout error is distinguishable from AbortError", async () => {
      currentHandler = (_req, _res) => {
        // Never respond
      };

      const promise = streamRequest({
        url: `${baseUrl}/timeout-not-abort`,
        method: "GET",
        headers: {},
        timeoutMs: 100,
        onChunk: () => { /* ignore */ },
      });

      const err = await promise.catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("TimeoutError");
      expect(err.name).not.toBe("AbortError");
      expect(err.message).toMatch(/timed? ?out/i);
    });
  });

  it("does not let a throwing onChunk consumer kill the stream", async () => {
    currentHandler = (_req, res) => {
      res.writeHead(200);
      res.write("a");
      setTimeout(() => { res.write("b"); res.end(); }, 10);
    };

    const received: string[] = [];
    const result = await streamRequest({
      url: `${baseUrl}/throw`,
      method: "GET",
      headers: {},
      onChunk: (text) => {
        received.push(text);
        if (text === "a") throw new Error("consumer failed");
      },
    });

    expect(result.status).toBe(200);
    expect(result.fullText).toBe("ab");
    expect(received).toContain("a");
    expect(received).toContain("b");
  });
});

describe("withTimeout", () => {
  it("resolves with the original value when the promise completes within budget", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000);
    expect(result).toBe("ok");
  });

  it("rejects with TimeoutError when the promise takes longer than the budget", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
    const start = Date.now();
    await expect(withTimeout(slow, 50)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(150);
  });

  it("propagates the timeoutMs in the error message", async () => {
    const slow = new Promise(() => { /* never resolves */ });
    const err = await withTimeout(slow, 75).catch((e) => e);
    expect(err.message).toMatch(/75/);
    expect(err.message).toMatch(/timed? ?out/i);
  });

  it("returns the promise unchanged when timeoutMs is undefined", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("done"), 50));
    const result = await withTimeout(slow, undefined);
    expect(result).toBe("done");
  });

  it("returns the promise unchanged when timeoutMs is zero", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("done"), 50));
    const result = await withTimeout(slow, 0);
    expect(result).toBe("done");
  });

  it("propagates rejections from the wrapped promise", async () => {
    const failing = Promise.reject(new Error("upstream failure"));
    await expect(withTimeout(failing, 1000)).rejects.toThrow("upstream failure");
  });
});
