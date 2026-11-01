type RpcError = { code?: string; message?: string } | null | undefined;

/**
 * True when a PostgREST/Postgres error means the called RPC is not installed on the connected database
 * (PGRST202 = not in the schema cache, 42883 = undefined_function). Errors raised from INSIDE an installed
 * function (permission, insufficient stock, missing table, ...) are never reported as "missing".
 */
export function isMissingRpcError(error: RpcError, name?: string) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = error.message ?? "";
  if (!/could not find the function|function .* does not exist/i.test(message)) return false;
  return name ? message.includes(name) : true;
}

/** Raised when an optional RPC (a manual SQL file) is not applied; callers can catch it to degrade. */
export class MissingRpcError extends Error {
  readonly rpcName: string;

  constructor(rpcName: string, message: string) {
    super(message);
    this.name = "MissingRpcError";
    this.rpcName = rpcName;
  }
}
