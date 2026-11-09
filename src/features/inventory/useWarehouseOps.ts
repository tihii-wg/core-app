import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createAndPostGoodsReceipt,
  createAndPostSupplierReturn,
  createGoodsReceipt,
  createStockTransfer,
  createSupplierReturn,
  createWriteOff,
  getGoodsReceipts,
  getReturnedQuantitiesForReceipt,
  getStockTransfers,
  getSupplierReturns,
  getWriteOffs,
  postGoodsReceipt,
  postStockTransfer,
  postSupplierReturn,
  postWriteOff,
  recordSupplierReturnRefund,
  type CreateGoodsReceiptInput,
  type CreateStockTransferInput,
  type CreateSupplierReturnInput,
  type CreateWriteOffInput,
  type RecordSupplierReturnRefundInput,
} from "../../services/apiWarehouseOps";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import type { WarehouseOpKind } from "./warehouseOps";

const OPS_KEY = "warehouse-ops";

export function useGetGoodsReceipts() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: [OPS_KEY, "receipt", workspaceId],
    queryFn: () => getGoodsReceipts(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useGetStockTransfers() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: [OPS_KEY, "transfer", workspaceId],
    queryFn: () => getStockTransfers(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useGetWriteOffs() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: [OPS_KEY, "writeOff", workspaceId],
    queryFn: () => getWriteOffs(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useGetSupplierReturns() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: [OPS_KEY, "supplierReturn", workspaceId],
    queryFn: () => getSupplierReturns(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useReturnedQuantitiesForReceipt(receiptId: string | null | undefined, enabled = true) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = receiptId?.trim() ?? "";
  return useQuery({
    queryKey: [OPS_KEY, "returned-qty", workspaceId, id],
    queryFn: () => getReturnedQuantitiesForReceipt(workspaceId, id),
    enabled: Boolean(workspaceId) && Boolean(id) && enabled,
  });
}

function useCreateOp<TInput>(kind: WarehouseOpKind, create: (input: TInput, workspaceId: string | undefined) => Promise<string>) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: TInput) => {
      guardWrite();
      return create(input, workspaceId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [OPS_KEY, kind, workspaceId] });
      toast.success(i18n.t("inventory.ops.toast.created"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("inventory.ops.errors.createFailed"));
    },
  });
}

export const useCreateGoodsReceipt = () => useCreateOp<CreateGoodsReceiptInput>("receipt", createGoodsReceipt);
export const useCreateStockTransfer = () => useCreateOp<CreateStockTransferInput>("transfer", createStockTransfer);
export const useCreateWriteOff = () => useCreateOp<CreateWriteOffInput>("writeOff", createWriteOff);
export const useCreateSupplierReturn = () => useCreateOp<CreateSupplierReturnInput>("supplierReturn", createSupplierReturn);

async function invalidateAfterStockChange(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined, kind: WarehouseOpKind) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [OPS_KEY, kind, workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["supplier-deliveries", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["supplier-parts", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["supplier-returns", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: [OPS_KEY, "returned-qty", workspaceId] }),
  ]);
}

async function invalidateFinanceAfterRefund(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: [OPS_KEY, "supplierReturn", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["supplier-returns", workspaceId] }),
  ]);
}

/**
 * Integrated receive: draft + post in one mutation using the same create/post APIs as
 * Warehouse → Operations. Invalidates receipt list, inventory quantities, and warehouse stock.
 */
export function useCreateAndPostGoodsReceipt() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: CreateGoodsReceiptInput) => {
      guardWrite();
      return createAndPostGoodsReceipt(input, workspaceId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [OPS_KEY, "receipt", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] }),
      ]);
      toast.success(i18n.t("inventory.ops.toast.received"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("inventory.ops.errors.postFailed"));
    },
  });
}

/** Create + post a supplier return; rolls back the draft if post fails. */
export function useCreateAndPostSupplierReturn() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: CreateSupplierReturnInput) => {
      guardWrite();
      return createAndPostSupplierReturn(input, workspaceId);
    },
    onSuccess: async (result) => {
      await invalidateAfterStockChange(queryClient, workspaceId, "supplierReturn");
      await invalidateFinanceAfterRefund(queryClient, workspaceId);
      toast.success(i18n.t("inventory.supplierReturn.success"));
      if (result.refundSkipped) {
        toast.error(i18n.t("inventory.supplierReturn.refund.refundSkipped"));
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("inventory.ops.errors.postFailed"));
    },
  });
}

/** Record money back from the supplier for an already posted return. */
export function useRecordSupplierReturnRefund() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ returnId, input }: { returnId: string; input: RecordSupplierReturnRefundInput }) => {
      guardWrite();
      return recordSupplierReturnRefund(returnId, input);
    },
    onSuccess: async () => {
      await invalidateFinanceAfterRefund(queryClient, workspaceId);
      toast.success(i18n.t("inventory.supplierReturn.refund.success"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("inventory.ops.errors.postFailed"));
    },
  });
}

function usePostOp(kind: WarehouseOpKind, post: (id: string) => Promise<void>) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (id: string) => {
      guardWrite();
      return post(id);
    },
    onSuccess: async () => {
      await invalidateAfterStockChange(queryClient, workspaceId, kind);
      toast.success(i18n.t("inventory.ops.toast.posted"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("inventory.ops.errors.postFailed"));
    },
  });
}

export const usePostGoodsReceipt = () => usePostOp("receipt", postGoodsReceipt);
export const usePostStockTransfer = () => usePostOp("transfer", postStockTransfer);
export const usePostWriteOff = () => usePostOp("writeOff", postWriteOff);
export const usePostSupplierReturn = () => usePostOp("supplierReturn", postSupplierReturn);

/**
 * Create a document and post it right away (stock changes immediately).
 * If posting fails the draft stays in Warehouse → Operations so it can be fixed and posted
 * (supplier returns roll their draft back, see createAndPostSupplierReturn).
 */
function useCreateAndPostOp<TInput>(
  kind: WarehouseOpKind,
  run: (input: TInput, workspaceId: string | undefined) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: TInput) => {
      guardWrite();
      return run(input, workspaceId);
    },
    onSuccess: async () => {
      await invalidateAfterStockChange(queryClient, workspaceId, kind);
      toast.success(i18n.t(`inventory.ops.${kind}.postedNow`));
    },
    onError: async (error: Error) => {
      // A draft may have been created before the post failed — refresh the list.
      await queryClient.invalidateQueries({ queryKey: [OPS_KEY, kind, workspaceId] });
      toast.error(error.message || i18n.t("inventory.ops.errors.postFailed"));
    },
  });
}

async function createThenPost<TInput>(
  create: (input: TInput, workspaceId: string | undefined) => Promise<string>,
  post: (id: string) => Promise<void>,
  input: TInput,
  workspaceId: string | undefined,
) {
  const id = await create(input, workspaceId);
  try {
    await post(id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(i18n.t("inventory.ops.errors.draftKeptPostFailed", { reason }));
  }
  return id;
}

export const useCreateAndPostReceiptOp = () =>
  useCreateAndPostOp<CreateGoodsReceiptInput>("receipt", (input, ws) =>
    createThenPost(createGoodsReceipt, postGoodsReceipt, input, ws),
  );
export const useCreateAndPostTransfer = () =>
  useCreateAndPostOp<CreateStockTransferInput>("transfer", (input, ws) =>
    createThenPost(createStockTransfer, postStockTransfer, input, ws),
  );
export const useCreateAndPostWriteOff = () =>
  useCreateAndPostOp<CreateWriteOffInput>("writeOff", (input, ws) =>
    createThenPost(createWriteOff, postWriteOff, input, ws),
  );
export const useCreateAndPostSupplierReturnOp = () =>
  useCreateAndPostOp<CreateSupplierReturnInput>("supplierReturn", (input, ws) =>
    createAndPostSupplierReturn(input, ws),
  );
