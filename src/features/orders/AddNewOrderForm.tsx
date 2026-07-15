import { useState } from "react";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { useGetClients } from "../clients/useGetClients";
import { useApp } from "../../lib/appContext";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
// import type { Order, OrderStatus } from "../../lib/types";

export default function AddNewOrderForm({ setCreateModalOpen, searchQuery }) {
  const { employees, services, addOrder } = useApp();

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { clients } = useGetClients(searchQuery);

  // Form state
  const [formData, setFormData] = useState({
    clientId: "",
    device: "",
    service: "",
    description: "",
    assignedEmployeeId: "",
    deadline: "",
    totalPrice: "",
  });

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.clientId) errors.clientId = "Client is required";
    if (!formData.device.trim()) errors.device = "Device is required";
    if (!formData.service) errors.service = "Service is required";
    if (!formData.assignedEmployeeId) errors.assignedEmployeeId = "Employee is required";
    if (!formData.deadline) errors.deadline = "Deadline is required";
    if (!formData.totalPrice || parseFloat(formData.totalPrice) <= 0) {
      errors.totalPrice = "Valid price is required";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateOrder = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    const client = clients.find((c) => c.id === formData.clientId);
    const employee = employees.find((e) => e.id === formData.assignedEmployeeId);

    addOrder({
      clientId: formData.clientId,
      clientName: client?.name || "",
      device: formData.device,
      service: formData.service,
      description: formData.description,
      status: "new",
      assignedEmployeeId: formData.assignedEmployeeId,
      assignedEmployeeName: employee?.name || "",
      deadline: formData.deadline,
      totalPrice: parseFloat(formData.totalPrice),
      paymentStatus: "unpaid",
    });

    setIsSubmitting(false);
    setCreateModalOpen(false);
    setFormData({
      clientId: "",
      device: "",
      service: "",
      description: "",
      assignedEmployeeId: "",
      deadline: "",
      totalPrice: "",
    });
  };
  return (
    <>
      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label>Client *</Label>
          <Select value={formData.clientId} onValueChange={(value) => setFormData({ ...formData, clientId: value })}>
            <SelectTrigger className={formErrors.clientId ? "border-[#f41f20]" : ""}>
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {clients?.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {formErrors.clientId && <p className="text-xs text-[#f41f20]">{formErrors.clientId}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>Device *</Label>
          <Input
            value={formData.device}
            onChange={(e) => setFormData({ ...formData, device: e.target.value })}
            placeholder="e.g., iPhone 14 Pro"
            className={formErrors.device ? "border-[#f41f20]" : ""}
          />
          {formErrors.device && <p className="text-xs text-[#f41f20]">{formErrors.device}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>Service *</Label>
          <Select value={formData.service} onValueChange={(value) => setFormData({ ...formData, service: value })}>
            <SelectTrigger className={formErrors.service ? "border-[#f41f20]" : ""}>
              <SelectValue placeholder="Select service" />
            </SelectTrigger>
            <SelectContent>
              {services
                .filter((s) => s.status === "active")
                .map((service) => (
                  <SelectItem key={service.id} value={service.name}>
                    {service.name} - ${service.price}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {formErrors.service && <p className="text-xs text-[#f41f20]">{formErrors.service}</p>}
        </div>

        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Describe the issue or work needed..." rows={3} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Assigned Employee *</Label>
            <Select value={formData.assignedEmployeeId} onValueChange={(value) => setFormData({ ...formData, assignedEmployeeId: value })}>
              <SelectTrigger className={formErrors.assignedEmployeeId ? "border-[#f41f20]" : ""}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {employees
                  .filter((e) => e.status === "active" && e.role === "technician")
                  .map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {formErrors.assignedEmployeeId && <p className="text-xs text-[#f41f20]">{formErrors.assignedEmployeeId}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Deadline *</Label>
            <div className="relative">
              <Input type="date" value={formData.deadline} onChange={(e) => setFormData({ ...formData, deadline: e.target.value })} className={formErrors.deadline ? "border-[#f41f20]" : ""} />
            </div>
            {formErrors.deadline && <p className="text-xs text-[#f41f20]">{formErrors.deadline}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Total Price ($) *</Label>
          <Input
            type="number"
            value={formData.totalPrice}
            onChange={(e) => setFormData({ ...formData, totalPrice: e.target.value })}
            placeholder="0.00"
            className={formErrors.totalPrice ? "border-[#f41f20]" : ""}
          />
          {formErrors.totalPrice && <p className="text-xs text-[#f41f20]">{formErrors.totalPrice}</p>}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setCreateModalOpen(false)} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleCreateOrder} disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
          {isSubmitting ? <Spinner className="h-4 w-4" /> : "Create Order"}
        </Button>
      </div>
    </>
  );
}
