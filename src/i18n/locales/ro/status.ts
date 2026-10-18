import type en from "../en/status";
import type { Messages } from "../../types";

const status: Messages<typeof en> = {
  order: {
    new: "Nouă",
    "in-progress": "În lucru",
    "waiting-parts": "Așteaptă piese",
    completed: "Finalizată",
    paid: "Achitată",
    cancelled: "Anulată",
    byIndustry: {
      auto_repair: {
        "waiting-parts": "Așteaptă piese",
      },
      repair_device: {
        "waiting-parts": "Așteaptă piese",
      },
      field_service: {
        "waiting-parts": "Așteaptă consumabile",
      },
      default: {
        "waiting-parts": "Așteaptă piese",
      },
    },
  },
  payment: {
    unpaid: "Neachitată",
    partial: "Parțial",
    paid: "Achitată",
  },
  invoice: {
    draft: "Ciornă",
    sent: "Trimisă",
    paid: "Achitată",
    overdue: "Restantă",
  },
  inventory: {
    in_stock: "În stoc",
    low_stock: "Stoc redus",
    out_of_stock: "Lipsă din stoc",
  },
};

export default status;
