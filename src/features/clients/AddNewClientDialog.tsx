import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { useApp } from "../../lib/appContext";

export default function AddNewClientDialog({}) {
  const { addClient } = useApp();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.email.trim()) errors.email = "Email is required";
    if (!formData.phone.trim()) errors.phone = "Phone is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateClient = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    addClient({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      notes: formData.notes,
    });

    setIsSubmitting(false);
    setCreateModalOpen(false);
    setFormData({ name: "", email: "", phone: "", address: "", notes: "" });
  };

  return (
    <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Client name" className={formErrors.name ? "border-[#f41f20]" : ""} />
            {formErrors.name && <p className="text-xs text-[#f41f20]">{formErrors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@example.com"
                className={formErrors.email ? "border-[#f41f20]" : ""}
              />
              {formErrors.email && <p className="text-xs text-[#f41f20]">{formErrors.email}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+1 (555) 000-0000"
                className={formErrors.phone ? "border-[#f41f20]" : ""}
              />
              {formErrors.phone && <p className="text-xs text-[#f41f20]">{formErrors.phone}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Street address, city, state" />
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes about this client..." rows={3} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCreateModalOpen(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCreateClient} disabled={isSubmitting} className="bg-[#1973e1] hover:bg-[#1565c0] text-white">
            {isSubmitting ? <Spinner className="h-4 w-4" /> : "Add Client"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
