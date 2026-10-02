import { useState } from "react";
import {
  Plus,
  // Clock,
  Trash2,
} from "lucide-react";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";

import type { Service } from "../..//lib/types";
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

// const categoryOptions = [
//   { value: "All", label: "All Categories" },
//   { value: "Repair", label: "Repair" },
//   { value: "Assessment", label: "Assessment" },
//   { value: "Software", label: "Software" },
//   { value: "Data", label: "Data" },
//   { value: "Upgrade", label: "Upgrade" },
// ];

export function Services() {
  const [searchQuery, setSearchQuery] = useState("");
  // const [categoryFilter, setCategoryFilter] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);

  const [selectedService, setSelectedService] = useState<Service | null>(null);

  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);

  const debunceSearch = useDebounce(searchQuery, 400);
  // const debunceCategoryFilter = useDebounce(categoryFilter, 400);
  const { services, isLoading, isPending, error, refetch } = useGetServices(debunceSearch);
  const { formatMoney } = useWorkspaceMoney();
  const { mutate: deleteServiceMutation, isPending: isDeleting } = useDeleteService();
  const canManage = canManageServices(useActiveWorkspaceRole());

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
      header: "Service",
      cell: (service) => (
        <div className="max-w-[28rem] min-w-0">
          <p className="truncate font-medium text-foreground" title={service.service_name}>{service.service_name}</p>
          {service.description && <p className="truncate text-xs text-muted-foreground" title={service.description}>{service.description}</p>}
        </div>
      ),
    },
    // {
    //   key: "category",
    //   header: "Category",
    //   cell: (service) => <StatusBadge variant="default">{service.category}</StatusBadge>,
    // },
    // {
    //   key: "duration",
    //   header: "Duration",
    //   cell: (service) => (
    //     <div className="flex items-center gap-1 text-muted-foreground">
    //       <Clock className="h-4 w-4" />
    //       <span>{formatDuration(service.duration)}</span>
    //     </div>
    //   ),
    //   className: "hidden sm:table-cell",
    // },
    {
      key: "price",
      header: "Price",
      className: "text-right w-[140px] whitespace-nowrap",
      cell: (service) => <span className="font-medium text-foreground tabular-nums">{formatMoney(service.service_price)}</span>,
    },
    {
      key: "status",
      header: "Status",
      className: "text-right w-[120px]",
      cell: (service) => (
        <div className="flex justify-end">
          {service.status === "active" ? (
            <StatusBadge variant="success" dot>Active</StatusBadge>
          ) : (
            <StatusBadge variant="muted" dot>Inactive</StatusBadge>
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
          aria-label={`Delete ${service.service_name}`}
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
        title="Services"
        description={isPending ? "Loading services..." : `${activeServices} active services`}
        actions={
          canManage ? (
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus />
              Add Service
            </Button>
          ) : undefined
        }
      />

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search services..."
        // filters={[
        //   {
        //     key: "category",
        //     label: "Category",
        //     options: categoryOptions,
        //     value: categoryFilter,
        //     onChange: setCategoryFilter,
        //   },
        // ]}
        // onClearFilters={() => {
        //   setSearchQuery("");
        //   setCategoryFilter("all");
        // }}
      />

      <DataTable
        columns={columns}
        isLoading={isLoading}
        data={services}
        emptyState={
          error ? (
            <ErrorState title="Could not load services" description={error.message} onRetry={() => refetch()} />
          ) : searchQuery ? (
            <NoSearchResults query={searchQuery} />
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
          <Description className="sr-only">Manage your workspace service</Description>
          <DialogHeader>
            <DialogTitle>Add New Service</DialogTitle>
          </DialogHeader>
          <AddNewServiceForm setCreateModalOpen={setCreateModalOpen} />
        </DialogContent>
      </Dialog>

      {/*Create Edit Service Modal*/}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-lg">
          <Description className="sr-only">Edit workspace service</Description>
          <DialogHeader>
            <DialogTitle>Edit Service</DialogTitle>
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
            <DialogTitle>Delete service?</DialogTitle>
            <Description className="sr-only">Confirm deletion of the selected service.</Description>
          </DialogHeader>

          <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
            Are you sure you want to delete <strong className="font-medium text-foreground">{serviceToDelete?.service_name}</strong>?
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceToDelete(null)}>
              Cancel
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
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
