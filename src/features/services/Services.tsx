import { useEffect, useMemo, useState } from "react";
import { useListTopAnchor } from "../../hooks/useListTopAnchor";
import { Trans, useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";

import type { Service, serviceCategory } from "../../lib/types";
import { Button } from "../../ui/Button";

import { Description } from "@radix-ui/react-dialog";

import CreateServiceDialog from "./CreateServiceDialog";
import { useServiceCategoriesInUse, useServicesPage } from "./useGetServices";
import { ServerListPager } from "../../ui/ServerListPager";
import { DEFAULT_LIST_PAGE_SIZE, type ListPageSize } from "../../lib/serverPaging";
import { useDebounce } from "../../hooks/useDebounce";
import EditServiceForm from "./UpdateServiceForm";
import useDeleteService from "./useDeleteService";
import { ErrorState, NoSearchResults, NoServices } from "../../ui/EmptyState";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { canManageServices } from "../workspaces/workspaceRoles";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import {
  industryServiceCategoryOptions,
  industryServiceCopy,
  normalizeServiceCategory,
  serviceCategoryLabel,
} from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { cn } from "../../lib/utils";

type StatusFilter = "all" | "active" | "inactive";

export function Services() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 400);
  const categoryQuery = categoryFilter === "all" ? undefined : (categoryFilter as serviceCategory);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ListPageSize>(DEFAULT_LIST_PAGE_SIZE);
  // After a page switch the list starts at the top of the screen (filters scroll out of view).
  const listTop = useListTopAnchor();
  // Paginated in the database: search, category and status filters run there; one page is loaded.
  const {
    data: servicesPage,
    isLoading,
    isPending,
    error,
    refetch,
  } = useServicesPage({ search: debouncedSearch, category: categoryQuery, status: statusFilter, page, pageSize });
  const services = useMemo(() => servicesPage?.rows ?? [], [servicesPage]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryQuery, statusFilter, pageSize]);
  const { formatMoney } = useWorkspaceMoney();
  const { mutate: deleteServiceMutation, isPending: isDeleting } = useDeleteService();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const canManage = withSubscriptionWriteAccess(canManageServices(useActiveWorkspaceRole()), subscriptionAllowsWrite);
  const { workflow } = useIndustryWorkflow();
  const serviceCopy = industryServiceCopy(workflow);
  // Categories actually used by this workspace's services (legacy codes or another industry's codes)
  // stay filterable after an industry change.
  const categoriesInUse = useServiceCategoriesInUse();
  const filterCategoryCodes = useMemo(() => {
    const codes = [...industryServiceCategoryOptions(workflow)];
    for (const category of categoriesInUse) {
      const code = normalizeServiceCategory(category);
      if (code && !codes.includes(code)) codes.push(code);
    }
    return codes;
  }, [workflow, categoriesInUse]);
  const categoryOptions = [
    { value: "all", label: t("services.filters.allCategories") },
    ...filterCategoryCodes.map((category) => ({
      value: category,
      label: serviceCategoryLabel(category, workflow.slug),
    })),
  ];

  useEffect(() => {
    if (categoryFilter === "all") return;
    if (!filterCategoryCodes.includes(categoryFilter as serviceCategory)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, filterCategoryCodes]);

  const visibleServices = services;
  const activeCount = servicesPage?.activeTotal ?? 0;
  const filteredEmpty = statusFilter !== "all";

  const openEdit = (service: Service) => {
    setSelectedService(service);
    setEditModalOpen(true);
  };

  const columns: Column<Service>[] = [
    {
      key: "name",
      header: t("services.columns.service"),
      cell: (service) => {
        const inactive = service.status === "inactive";
        return (
          <div className="max-w-[28rem] min-w-0">
            <p className={cn("truncate font-medium", inactive ? "text-muted-foreground" : "text-foreground")} title={service.service_name}>
              {service.service_name}
            </p>
            {service.description ? (
              <p className="truncate text-xs text-muted-foreground" title={service.description}>
                {service.description}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "category",
      header: t("services.columns.category"),
      className: "hidden sm:table-cell",
      cell: (service) =>
        service.category ? <StatusBadge variant="default">{serviceCategoryLabel(service.category, workflow.slug)}</StatusBadge> : <span className="text-subtle-foreground">—</span>,
    },
    {
      key: "price",
      header: t("services.columns.price"),
      className: "text-right w-[140px] whitespace-nowrap",
      cell: (service) => (
        <span className={cn("font-semibold tabular-nums", service.status === "inactive" ? "text-muted-foreground" : "text-foreground")}>
          {formatMoney(service.service_price)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      className: "text-right w-[120px]",
      cell: (service) => (
        <div className="flex justify-end">
          {service.status === "active" ? (
            <StatusBadge variant="success" dot>
              {t("services.statuses.active")}
            </StatusBadge>
          ) : (
            <StatusBadge variant="muted" dot>
              {t("services.statuses.inactive")}
            </StatusBadge>
          )}
        </div>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      className: "w-[96px] text-right",
      cell: (service) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("services.editAriaLabel", { name: service.service_name })}
            onClick={(event) => {
              event.stopPropagation();
              openEdit(service);
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("services.deleteAriaLabel", { name: service.service_name })}
            onClick={(event) => {
              event.stopPropagation();
              setServiceToDelete(service);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("services.title")}
        description={isPending ? t("services.loading") : t("services.activeCount", { count: activeCount })}
        actions={
          canManage ? (
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus />
              {t("services.addService")}
            </Button>
          ) : undefined
        }
      />

      <SubscriptionReadOnlyNotice />

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
          {
            key: "status",
            label: t("services.filters.status"),
            options: [
              { value: "all", label: t("services.filters.allStatuses") },
              { value: "active", label: t("services.statuses.active") },
              { value: "inactive", label: t("services.statuses.inactive") },
            ],
            value: statusFilter,
            onChange: (value) => setStatusFilter(value as StatusFilter),
          },
        ]}
        onClearFilters={() => {
          setSearchQuery("");
          setCategoryFilter("all");
          setStatusFilter("all");
        }}
      />

      <div ref={listTop.ref}>
      <DataTable
        columns={columns}
        isLoading={isLoading}
        data={visibleServices}
        emptyState={
          error ? (
            <ErrorState title={t("services.loadError")} description={error.message} onRetry={() => refetch()} />
          ) : filteredEmpty || searchQuery || categoryFilter !== "all" ? (
            <NoSearchResults
              query={
                searchQuery ||
                (categoryFilter !== "all" ? serviceCategoryLabel(categoryFilter, workflow.slug) : t("services.filters.activeFiltersFallback"))
              }
            />
          ) : (
            <NoServices onAddService={canManage ? () => setCreateModalOpen(true) : undefined} />
          )
        }
        keyExtractor={(service) => service.id}
        onRowClick={canManage ? openEdit : undefined}
        rowClassName={(service) => (service.status === "inactive" ? "bg-muted/20" : undefined)}
      />

      </div>

      {!isLoading && (servicesPage?.total ?? 0) > 0 ? (
        <ServerListPager
          page={servicesPage?.page ?? page}
          pageCount={servicesPage?.pageCount ?? 1}
          pageSize={pageSize}
          total={servicesPage?.total ?? 0}
          onPageChange={(next) => {
            setPage(next);
            listTop.scrollToListTop();
          }}
          onPageSizeChange={(size) => {
            setPageSize(size);
            listTop.scrollToListTop();
          }}
        />
      ) : null}

      <CreateServiceDialog open={createModalOpen} onOpenChange={setCreateModalOpen} />

      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-lg">
          <Description className="sr-only">{serviceCopy.editDescription}</Description>
          <DialogHeader>
            <DialogTitle>{t("services.dialogs.editTitle")}</DialogTitle>
          </DialogHeader>
          {selectedService && <EditServiceForm service={selectedService} setEditModalOpen={setEditModalOpen} />}
        </DialogContent>
      </Dialog>

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
