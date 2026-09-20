import { useState } from "react";
import {
  Plus,
  // Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
// import { StatusBadge } from "../../ui/StatusBadge";

import type { Service } from "../..//lib/types";
import { Button } from "../../ui/Button";

import { Description } from "@radix-ui/react-dialog";

import AddNewServiceForm from "./AddNewServiceForm";
import useGetServices from "./useGetServices";
import { useDebounce } from "../../hooks/useDebounce";
import EditServiceForm from "./UpdateServiceForm";

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

  const debunceSearch = useDebounce(searchQuery, 400);
  // const debunceCategoryFilter = useDebounce(categoryFilter, 400);
  const { services, isLoading, isPending } = useGetServices(debunceSearch);

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
        <div>
          <p className="font-medium text-[#282e33]">{service.service_name}</p>
          <p className="text-xs text-[#939699]">{service.description}</p>
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
    //     <div className="flex items-center gap-1 text-[#939699]">
    //       <Clock className="h-4 w-4" />
    //       <span>{formatDuration(service.duration)}</span>
    //     </div>
    //   ),
    //   className: "hidden sm:table-cell",
    // },
    {
      key: "price",
      header: "Price",
      className: "text-right w-[120px]",
      cell: (service) => <span className="font-medium text-[#282e33]">${service.service_price}</span>,
    },
    {
      key: "status",
      header: "Status",
      className: "text-right w-[120px]",
      cell: (service) => (
        <div className="flex justify-end gap-1">
          {service.status === "active" ? (
            <>
              <CheckCircle className="h-4 w-4 text-[#099b49]" />
              <span className="text-sm text-[#099b49]">Active</span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-[#939699]" />
              <span className="text-sm text-[#939699]">Inactive</span>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Services"
        description={isPending ? "Loading services..." : `${activeServices} active services`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
            Add Service
          </Button>
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
        keyExtractor={(service) => service.id}
        onRowClick={(service) => {
          setSelectedService(service);
          setEditModalOpen(true);
        }}
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
    </div>
  );
}
