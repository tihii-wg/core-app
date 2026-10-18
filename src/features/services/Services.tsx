import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";

import type { Service, serviceCategory } from "../../lib/types";
import { Button } from "../../ui/Button";

import { Description } from "@radix-ui/react-dialog";

import AddNewServiceForm from "./AddNewServiceForm";
import useGetServices from "./useGetServices";
import { useDebounce } from "../../hooks/useDebounce";
import EditServiceForm from "./UpdateServiceForm";
import useDeleteService from "./useDeleteService";
import { ErrorState, NoSearchResults, NoServices } from "../../ui/EmptyState";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import { industryServiceCategoryOptions, industryServiceCopy, serviceCategoryLabel } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";

export function Services() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);

  const [selectedService, setSelectedService] = useState<Service | null>(null);

  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);

  const debunceSearch = useDebounce(searchQuery, 400);
  const categoryQuery = categoryFilter === "all" ? undefined : (categoryFilter as serviceCategory);
  const { services, isLoading, isPending, error, refetch } = useGetServices(debunceSearch, categoryQuery);
  const { formatMoney } = useWorkspaceMoney();
  const { mutate: deleteServiceMutation, isPending: isDeleting } = useDeleteService();
  const canManage = canManageServices(useActiveWorkspaceRole());
  const { workflow } = useIndustryWorkflow();
  const serviceCopy = industryServiceCopy(workflow);
  const categoryOptions = [
    { value: "all", label: t("services.filters.allCategories") },
    ...industryServiceCategoryOptions(workflow).map((category) => ({
      value: category,
      label: serviceCategoryLabel(category),
    })),
  ];

  useEffect(() => {
    if (categoryFilter === "all") return;
    if (!workflow.serviceCategories.includes(categoryFilter as serviceCategory)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, workflow.slug, workflow.serviceCategories]);

  // Stats
  const activeServices = services?.filter((s) => s.status === "active").length;

  // Format duration
  // const formatDuration = (minutes: number): string => {
  //   if (minutes < 60) return `${minutes} min`;
  //   const hours = Math.floor(minutes / 60);
  //   const mins = minutes % 60;
  //   return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  // };

  // Table columns
  const columns: Column<Service>[] = [
    {
      key: "name",
      header: t("services.columns.service"),
      cell: (service) => (
        <div className="max-w-[28rem] min-w-0">
          <p className="truncate font-medium text-foreground" title={service.service_name}>{service.service_name}</p>
          {service.description && <p className="truncate text-xs text-muted-foreground" title={service.description}>{service.description}</p>}
        </div>
      ),
    },
    {
      key: "category",
      header: t("services.columns.category"),
      className: "hidden sm:table-cell",
      cell: (service) =>
        service.category ? <StatusBadge variant="default">{serviceCategoryLabel(service.category)}</StatusBadge> : <span className="text-subtle-foreground">—</span>,
    },
    {
      key: "price",
      header: t("services.columns.price"),
      className: "text-right w-[140px] whitespace-nowrap",
      cell: (service) => <span className="font-medium text-foreground tabular-nums">{formatMoney(service.service_price)}</span>,
    },
    {
      key: "status",
      header: t("common.status"),
      className: "text-right w-[120px]",
      cell: (service) => (
        <div className="flex justify-end">
          {service.status === "active" ? (
            <StatusBadge variant="success" dot>{t("services.statuses.active")}</StatusBadge>
          ) : (
            <StatusBadge variant="muted" dot>{t("services.statuses.inactive")}</StatusBadge>
          )}
        </div>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      className: "w-[64px] text-right",
      cell: (service) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="hover:bg-destructive/10 hover:text-destructive"
          aria-label={t("services.deleteAriaLabel", { name: service.service_name })}
          onClick={(e) => {
            e.stopPropagation();
            setServiceToDelete(service);
          }}
        >
          <Trash2 />
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("services.title")}
        description={isPending ? t("services.loading") : t("services.activeCount", { count: activeServices })}
        actions={
          canManage ? (
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus />
              {t("services.addService")}
            </Button>
          ) : undefined
        }
      />

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t("services.searchPlaceholder")}
        filters={[
          {
            key: "category",
            label: t("services.filters.category"),
            options: categoryOptions,
            value: categoryFilter,
            onChange: setCategoryFilter,
          },
        ]}
        onClearFilters={() => {
          setSearchQuery("");
          setCategoryFilter("all");
        }}
      />

      <DataTable
        columns={columns}
        isLoading={isLoading}
        data={services}
        emptyState={
          error ? (
            <ErrorState title={t("services.loadError")} description={error.message} onRetry={() => refetch()} />
          ) : searchQuery || categoryFilter !== "all" ? (
            <NoSearchResults query={searchQuery || serviceCategoryLabel(categoryFilter)} />
          ) : (
            <NoServices onAddService={canManage ? () => setCreateModalOpen(true) : undefined} />
          )
        }
        keyExtractor={(service) => service.id}
        onRowClick={
          canManage
            ? (service) => {
                setSelectedService(service);
                setEditModalOpen(true);
              }
            : undefined
        }
      />

      {/* Create Service Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <Description className="sr-only">{serviceCopy.createDescription}</Description>
          <DialogHeader>
            <DialogTitle>{t("services.dialogs.createTitle")}</DialogTitle>
          </DialogHeader>
          <AddNewServiceForm setCreateModalOpen={setCreateModalOpen} />
        </DialogContent>
      </Dialog>

      {/*Create Edit Service Modal*/}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-lg">
          <Description className="sr-only">{serviceCopy.editDescription}</Description>
          <DialogHeader>
            <DialogTitle>{t("services.dialogs.editTitle")}</DialogTitle>
          </DialogHeader>
          {selectedService && <EditServiceForm service={selectedService} setEditModalOpen={setEditModalOpen} />}
        </DialogContent>
      </Dialog>

      {/*Delete sevice */}
      <Dialog
        open={!!serviceToDelete}
        onOpenChange={(open) => {
          if (!open) setServiceToDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("services.dialogs.deleteTitle")}</DialogTitle>
            <Description className="sr-only">{t("services.dialogs.deleteDescription")}</Description>
          </DialogHeader>

          <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
            <Trans
              i18nKey="services.dialogs.deleteConfirm"
              values={{ name: serviceToDelete?.service_name }}
              components={{ strong: <strong className="font-medium text-foreground" /> }}
            />
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceToDelete(null)}>
              {t("common.cancel")}
            </Button>

            <Button
              variant="destructive"
              onClick={() => {
                if (!serviceToDelete) return;

                deleteServiceMutation(serviceToDelete.id, {
                  onSuccess: () => {
                    setServiceToDelete(null);
                  },
                });
              }}
              disabled={isDeleting}
            >
              {isDeleting ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
