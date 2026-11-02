import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createAndPostGoodsReceipt,
  createGoodsReceipt,
  createStockTransfer,
  createWriteOff,
  getGoodsReceipts,
  getStockTransfers,
  getWriteOffs,
  postGoodsReceipt,
  postStockTransfer,
  postWriteOff,
  type CreateGoodsReceiptInput,
  type CreateStockTransferInput,
  type CreateWriteOffInput,
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
      // Stock changed server-side: refresh documents, item quantities and per-warehouse stock.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [OPS_KEY, kind, workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] }),
      ]);
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
