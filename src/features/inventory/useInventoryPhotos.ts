import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18next from "../../i18n";
import { getInventoryPhotoUrls, inventoryPhotoThumbPath, removeInventoryPhoto, uploadInventoryPhoto } from "../../services/apiInventoryPhotos";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

const URL_STALE_MS = 50 * 60_000;

/** Signed URLs (1 h) of the list thumbnails of one page — a single storage request per page. */
export function useInventoryThumbUrls(photoPaths: readonly (string | null | undefined)[]) {
  const thumbPaths = useMemo(
    () => [...new Set(photoPaths.filter((path): path is string => Boolean(path)).map(inventoryPhotoThumbPath))].sort(),
    [photoPaths],
  );
  const { data } = useQuery({
    queryKey: ["inventory-photo-urls", thumbPaths],
    queryFn: () => getInventoryPhotoUrls(thumbPaths),
    enabled: thumbPaths.length > 0,
    staleTime: URL_STALE_MS,
    gcTime: URL_STALE_MS,
    placeholderData: keepPreviousData,
  });
  return (photoPath: string | null | undefined) => (photoPath ? data?.[inventoryPhotoThumbPath(photoPath)] ?? null : null);
}

export function useFullPhotoUrl(photoPath: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["inventory-photo-urls", "full", photoPath],
    queryFn: async () => (await getInventoryPhotoUrls([photoPath as string]))[photoPath as string] ?? null,
    enabled: enabled && Boolean(photoPath),
    staleTime: URL_STALE_MS,
    gcTime: URL_STALE_MS,
  });
}

export function useUploadInventoryPhoto() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: ({ itemId, file, previousPath }: { itemId: string; file: File; previousPath?: string | null }) =>
      uploadInventoryPhoto(workspaceId, itemId, file, previousPath),
    onMutate: () => {
      toast.loading(i18next.t("inventory.photo.uploading"), { id: "inventory-photo" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18next.t("inventory.photo.uploaded"), { id: "inventory-photo" });
    },
    onError: (error) => {
      toast.error(error.message, { id: "inventory-photo" });
    },
  });
}

export function useRemoveInventoryPhoto() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: ({ itemId, photoPath }: { itemId: string; photoPath: string }) => removeInventoryPhoto(workspaceId, itemId, photoPath),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      toast.success(i18next.t("inventory.photo.removed"), { id: "inventory-photo" });
    },
    onError: (error) => {
      toast.error(error.message, { id: "inventory-photo" });
    },
  });
}

