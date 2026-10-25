export default {
  order: {
    new: "New",
    "in-progress": "In Progress",
    "waiting-parts": "Waiting Parts",
    completed: "Completed",
    paid: "Paid",
    cancelled: "Cancelled",
    byIndustry: {
      auto_repair: {
        "waiting-parts": "Waiting Parts",
      },
      repair_device: {
        "waiting-parts": "Waiting Parts",
      },
      field_service: {
        "waiting-parts": "Waiting Supplies",
      },
      default: {
        "waiting-parts": "Waiting Parts",
      },
    },
  },
  payment: {
    unpaid: "Unpaid",
    partial: "Partially Paid",
    paid: "Paid",
  },
  invoice: {
    draft: "Draft",
    sent: "Sent",
    paid: "Paid",
    overdue: "Overdue",
  },
  inventory: {
    in_stock: "In Stock",
    low_stock: "Low Stock",
    out_of_stock: "Out of Stock",
  },
};
