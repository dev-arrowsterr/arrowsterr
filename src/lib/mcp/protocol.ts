import "server-only";

// The Model Context Protocol over plain HTTP: one JSON-RPC message in, one JSON reply out.
// Stateless, so it runs on any instance with no sessions or streams to keep open.

export const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
export type RpcReply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export const ok = (id: RpcRequest["id"], result: unknown): RpcReply => ({ jsonrpc: "2.0", id: id ?? null, result });
export const fail = (id: RpcRequest["id"], code: number, message: string): RpcReply => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const NO_METHOD = -32601;
export const BAD_PARAMS = -32602;
export const INTERNAL = -32603;

/** A JSON Schema for a tool's input, in the small subset MCP clients read. */
export type Schema = { type: "object"; properties: Record<string, Record<string, unknown>>; required?: string[]; additionalProperties?: boolean };

/** What a tool returns: text the model reads, plus the same data as structured content. */
export type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

export function textResult(data: Record<string, unknown>, summary?: string): ToolResult {
  const text = JSON.stringify(data);
  return { content: [{ type: "text", text: summary ? `${summary}\n\n${text}` : text }], structuredContent: data };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** A mistake in what the caller sent. It goes back to the model as a tool error it can fix. */
export class ToolError extends Error {}
