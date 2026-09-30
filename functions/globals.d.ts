type PagesFunction<Env = unknown> = (context: { request: Request; env: Env; params: Record<string, string> }) => Response | Promise<Response>;
type D1PreparedStatement = { bind(...values: unknown[]): D1PreparedStatement; first<T = unknown>(column?: string): Promise<T | null>; all<T = unknown>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
type D1Database = { prepare(query: string): D1PreparedStatement; batch(statements: D1PreparedStatement[]): Promise<unknown> };
type R2Bucket = { get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>; put(key: string, value: Uint8Array, options?: unknown): Promise<unknown> };
