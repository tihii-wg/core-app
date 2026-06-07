import { useState, useMemo } from "react";
import { Plus, Package, AlertTriangle } from "lucide-react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PageHeader } from "../../pages/PageHeader";
import { SearchAndFilters } from "../../ui/SearchAndFilters";
import { DataTable, type Column } from "../../ui/DataTable";
import { InventoryStatusBadge } from "../../ui/StatusBadge";
import { NoInventory } from "../../ui/EmptyState";
import { Spinner } from "../../ui/Spinner";
import { useApp } from "../../lib/appContext";
import type { InventoryItem } from "../../lib/types";

const categoryOptions = [
  { value: "all", label: "All Categories" },
  { value: "Screens", label: "Screens" },
  { value: "Batteries", label: "Batteries" },
  { value: "Accessories", label: "Accessories" },
  { value: "Storage", label: "Storage" },
  { value: "Memory", label: "Memory" },
  { value: "Tools", label: "Tools" },
  { value: "Components", label: "Components" },
];

export function Inventory() {
  const { inventory, addInventoryItem, updateInventoryQuantity } = useApp();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState("");

  // Form state
  const [formData, setFormData] = useState({
    sku: "",
    name: "",
    category: "",
    supplier: "",
    quantity: "",
    minQuantity: "",
    purchasePrice: "",
    salePrice: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stats
  const lowStockCount = inventory.filter((i) => i.status === "low-stock").length;
  const outOfStockCount = inventory.filter((i) => i.status === "out-of-stock").length;

  // Filtered data
  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.sku.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [inventory, searchQuery, categoryFilter]);

  // Table columns
  const columns: Column<InventoryItem>[] = [
    {
      key: "sku",
      header: "SKU",
      cell: (item) => <span className="font-mono text-sm text-[#939699]">{item.sku}</span>,
      className: "hidden sm:table-cell",
    },
    {
      key: "name",
      header: "Item Name",
      cell: (item) => (
        <div>
          <p className="font-medium text-[#282e33]">{item.name}</p>
          <p className="text-xs text-[#939699]">{item.category}</p>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (item) => item.supplier,
      className: "hidden lg:table-cell",
    },
    {
      key: "quantity",
      header: "Qty",
      cell: (item) => (
        <div className="flex items-center gap-2">
          <span className={item.quantity <= item.minQuantity ? "text-[#f41f20] font-medium" : "text-[#282e33]"}>{item.quantity}</span>
          {item.quantity <= item.minQuantity && item.quantity > 0 && <AlertTriangle className="h-4 w-4 text-[#f89200]" />}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (item) => <InventoryStatusBadge status={item.status} />,
    },
    {
      key: "purchasePrice",
      header: "Cost",
      cell: (item) => `$${item.purchasePrice}`,
      className: "hidden md:table-cell text-right",
    },
    {
      key: "salePrice",
      header: "Price",
      cell: (item) => `$${item.salePrice}`,
      className: "text-right",
    },
    {
      key: "actions",
      header: "",
      cell: (item) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedItem(item);
            setAdjustQuantity(item.quantity.toString());
            setAdjustModalOpen(true);
          }}
          className="text-[#1973e1] hover:text-[#1565c0]"
        >
          Adjust
        </Button>
      ),
    },
  ];

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.sku.trim()) errors.sku = "SKU is required";
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.category) errors.category = "Category is required";
    if (!formData.quantity || parseInt(formData.quantity) < 0) {
      errors.quantity = "Valid quantity is required";
    }
    if (!formData.minQuantity || parseInt(formData.minQuantity) < 0) {
      errors.minQuantity = "Valid minimum quantity is required";
    }
    if (!formData.purchasePrice || parseFloat(formData.purchasePrice) < 0) {
      errors.purchasePrice = "Valid purchase price is required";
    }
    if (!formData.salePrice || parseFloat(formData.salePrice) < 0) {
      errors.salePrice = "Valid sale price is required";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateItem = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    addInventoryItem({
      sku: formData.sku,
      name: formData.name,
      category: formData.category,
      supplier: formData.supplier || "Unknown",
      quantity: parseInt(formData.quantity),
      minQuantity: parseInt(formData.minQuantity),
      purchasePrice: parseFloat(formData.purchasePrice),
      salePrice: parseFloat(formData.salePrice),
    });

    setIsSubmitting(false);
    setCreateModalOpen(false);
    setFormData({
      sku: "",
      name: "",
      category: "",
      supplier: "",
      quantity: "",
      minQuantity: "",
      purchasePrice: "",
      salePrice: "",
    });
  };

  const handleAdjustQuantity = async () => {
    if (!selectedItem || !adjustQuantity) return;

    const newQuantity = parseInt(adjustQuantity);
    if (isNaN(newQuantity) || newQuantity < 0) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    updateInventoryQuantity(selectedItem.id, newQuantity);
    setIsSubmitting(false);
    setAdjustModalOpen(false);
    setSelectedItem(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description={`${inventory.length} items in stock`}
        actions={
          <Button onClick={() => setCreateModalOpen(true)} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        }
      />

      {/* Alerts */}
      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {lowStockCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#fff4e5] text-[#f89200] rounded-md text-sm">
              <AlertTriangle className="h-4 w-4" />
              {lowStockCount} items low on stock
            </div>
          )}
          {outOfStockCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#fee7e7] text-[#f41f20] rounded-md text-sm">
              <Package className="h-4 w-4" />
              {outOfStockCount} items out of stock
            </div>
          )}
        </div>
      )}

      <SearchAndFilters
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by name or SKU..."
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

      <DataTable columns={columns} data={filteredInventory} keyExtractor={(item) => item.id} emptyState={<NoInventory onAddItem={() => setCreateModalOpen(true)} />} />

      {/* Create Item Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>SKU *</Label>
                <Input
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                  placeholder="e.g., SCR-IPH15-BLK"
                  className={formErrors.sku ? "border-[#f41f20]" : ""}
                />
                {formErrors.sku && <p className="text-xs text-[#f41f20]">{formErrors.sku}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger className={formErrors.category ? "border-[#f41f20]" : ""}>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.slice(1).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.category && <p className="text-xs text-[#f41f20]">{formErrors.category}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Item Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., iPhone 15 Pro Screen Assembly"
                className={formErrors.name ? "border-[#f41f20]" : ""}
              />
              {formErrors.name && <p className="text-xs text-[#f41f20]">{formErrors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Input value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} placeholder="e.g., TechParts Direct" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder="0"
                  className={formErrors.quantity ? "border-[#f41f20]" : ""}
                />
                {formErrors.quantity && <p className="text-xs text-[#f41f20]">{formErrors.quantity}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Min Quantity *</Label>
                <Input
                  type="number"
                  value={formData.minQuantity}
                  onChange={(e) => setFormData({ ...formData, minQuantity: e.target.value })}
                  placeholder="0"
                  className={formErrors.minQuantity ? "border-[#f41f20]" : ""}
                />
                {formErrors.minQuantity && <p className="text-xs text-[#f41f20]">{formErrors.minQuantity}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Purchase Price ($) *</Label>
                <Input
                  type="number"
                  value={formData.purchasePrice}
                  onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                  placeholder="0.00"
                  className={formErrors.purchasePrice ? "border-[#f41f20]" : ""}
                />
                {formErrors.purchasePrice && <p className="text-xs text-[#f41f20]">{formErrors.purchasePrice}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Sale Price ($) *</Label>
                <Input
                  type="number"
                  value={formData.salePrice}
                  onChange={(e) => setFormData({ ...formData, salePrice: e.target.value })}
                  placeholder="0.00"
                  className={formErrors.salePrice ? "border-[#f41f20]" : ""}
                />
                {formErrors.salePrice && <p className="text-xs text-[#f41f20]">{formErrors.salePrice}</p>}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateModalOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleCreateItem} disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
              {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adjust Quantity Modal */}
      <Dialog open={adjustModalOpen} onOpenChange={setAdjustModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4 py-4">
              <div className="bg-[#f8f9fa] rounded-md p-3">
                <p className="font-medium text-[#282e33]">{selectedItem.name}</p>
                <p className="text-sm text-[#939699]">{selectedItem.sku}</p>
              </div>

              <div className="space-y-1.5">
                <Label>New Quantity</Label>
                <Input type="number" value={adjustQuantity} onChange={(e) => setAdjustQuantity(e.target.value)} placeholder="Enter new quantity" />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAdjustModalOpen(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button onClick={handleAdjustQuantity} disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
                  {isSubmitting ? <Spinner className="h-4 w-4" /> : "Update"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
