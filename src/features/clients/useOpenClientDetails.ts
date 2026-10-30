import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { Client } from "../../lib/types";
import { getClient } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { clientQueryKey } from "./useGetClient";

/** Load a workspace client by id and open the existing Client Details sheet. */
export function useOpenClientDetails() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);

  const openClient = useCallback(
    async (clientId: string, knownClient?: Client | null) => {
      const id = clientId.trim();
      if (!id) return;

      if (knownClient && knownClient.id === id) {
        setSelectedClient(knownClient);
        setDetailPanelOpen(true);
        return;
      }

      try {
        const client = await queryClient.fetchQuery({
          queryKey: clientQueryKey(workspaceId, id),
          queryFn: () => getClient(workspaceId, id),
        });
        if (!client) {
          toast.error(i18n.t("clients.errors.notFoundOrForbidden"));
          return;
        }
        setSelectedClient(client);
        setDetailPanelOpen(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : i18n.t("common.somethingWentWrong"));
      }
    },
    [queryClient, workspaceId],
  );

  return {
    selectedClient,
    detailPanelOpen,
    setDetailPanelOpen,
    openClient,
    onClientUpdated: setSelectedClient,
  };
}
