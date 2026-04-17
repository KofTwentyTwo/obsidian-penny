import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { streamRequest } from "../../src/providers/node-stream";

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
