import { parseResponse } from "./response";

describe("parseResponse", () => {
  test("parses JSON responses by default", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(parseResponse(response)).resolves.toEqual({ ok: true });
  });

  test("returns text when JSON parsing fails", async () => {
    const response = new Response("plain text", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });

    await expect(parseResponse(response)).resolves.toBe("plain text");
  });

  test("keeps explicit text expectation", async () => {
    const response = new Response("data: hello\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    await expect(parseResponse(response, "text")).resolves.toBe(
      "data: hello\n\n"
    );
  });

  test("returns a data URL for binary content when base64 is expected", async () => {
    const response = new Response(new Blob([new Uint8Array([1, 2, 3])]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });

    // 二进制跨 background 消息通道只能以字符串回传，因此必须转成 data URL
    await expect(parseResponse(response, "base64")).resolves.toMatch(
      /^data:application\/octet-stream;base64,/
    );
  });

  test("throws a clear error when non-stream path receives SSE", async () => {
    const response = new Response("data: hello\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    await expect(parseResponse(response)).rejects.toThrow(
      "Received text/event-stream"
    );
  });

  test("extracts HTTP error body", async () => {
    const response = new Response(JSON.stringify({ error: "bad" }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });

    await expect(parseResponse(response)).rejects.toThrow('"status":400');
  });
});
