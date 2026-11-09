/**
 * Backward-compatible alias of order-attachment-remote (Drive + NAS).
 * Prefer deploying / calling order-attachment-remote going forward.
 */
import { routeRemoteAttachment } from "../_shared/orderAttachmentRemoteHandlers.ts";

Deno.serve(routeRemoteAttachment);
