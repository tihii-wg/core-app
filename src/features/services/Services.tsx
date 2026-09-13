import { useState, useMemo } from "react";
import { Plus, Clock, CheckCircle, XCircle } from "lucide-react";

// import { Textarea } from "../../ui/Textarea";
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { StatusBadge } from "../../ui/StatusBadge";
// import { Spinner } from "../../ui/Spinner";
import { useApp } from "../../lib/appContext";
import type { Service } from "../..//lib/types";
import { Button } from "../../ui/Button";
// import { Label } from "../../ui/Label";
// import { Input } from "../../ui/Input";
import { Description } from "@radix-ui/react-dialog";
// import AddNewOrderForm from "../orders/AddNewOrderForm";
import AddNewServiceForm from "./AddNewServiceForm";

const categoryOptions = [
  { value: "all", label: "All Categories" },
  { value: "Repair", label: "Repair" },
  { value: "Assessment", label: "Assessment" },
  { value: "Software", label: "Software" },
  { value: "Data", label: "Data" },
  { value: "Upgrade", label: "Upgrade" },
];

export function Services() {
  const { services, addService } = useApp();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    duration: "",
    price: "",
    description: "",
    status: "active" as "active" | "inactive",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stats
  const activeServices = services.filter((s) => s.status === "active").length;

  // Filtered data
  const filteredServices = useMemo(() => {
    return services.filter((service) => {
      const matchesSearch = !searchQuery || service.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === "all" || service.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [services, searchQuery, categoryFilter]);

  // Format duration
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // Table columns
  const columns: Column<Service>[] = [
    {
      key: "name",
      header: "Service",
      cell: (service) => (
        <div>
          <p className="font-medium text-[#282e33]">{service.name}</p>
          <p className="text-xs text-[#939699]">{service.description}</p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (service) => <StatusBadge variant="default">{service.category}</StatusBadge>,
    },
    {
      key: "duration",
      header: "Duration",
      cell: (service) => (
        <div className="flex items-center gap-1 text-[#939699]">
          <Clock className="h-4 w-4" />
          <span>{formatDuration(service.duration)}</span>
        </div>
      ),
      className: "hidden sm:table-cell",
    },
    {
      key: "price",
      header: "Price",
      cell: (service) => <span className="font-medium text-[#282e33]">${service.price}</span>,
      className: "text-right",
    },
    {
      key: "status",
      header: "Status",
      cell: (service) => (
        <div className="flex items-center gap-1">
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

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.category) errors.category = "Category is required";
    if (!formData.duration || parseInt(formData.duration) <= 0) {
      errors.duration = "Valid duration is required";
    }
    if (!formData.price || parseFloat(formData.price) <= 0) {
      errors.price = "Valid price is required";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateService = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    addService({
      name: formData.name,
      category: formData.category,
      duration: parseInt(formData.duration),
      price: parseFloat(formData.price),
      description: formData.description,
      status: formData.status,
    });

    setIsSubmitting(false);
    setCreateModalOpen(false);
    setFormData({
      name: "",
      category: "",
      duration: "",
      price: "",
      description: "",
      status: "active",
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Services"
        description={`${activeServices} active services`}
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
        filters={[
          {
            key: "category",
            label: "Category",
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

      <DataTable columns={columns} data={filteredServices} keyExtractor={(service) => service.id} />

      {/* Create Service Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <Description className="sr-only">Manage your workspace service</Description>
          <DialogHeader>
            <DialogTitle>Add New Service</DialogTitle>
          </DialogHeader>
          <AddNewServiceForm
           
         
            setCreateModalOpen={setCreateModalOpen}
          
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
