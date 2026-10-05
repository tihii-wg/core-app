export default {
  create: {
    nameLabel: "Workspace *",
    namePlaceholder: "Workspace",
    nameRequired: "Name is required",
    businessTypeLabel: "Business type *",
    businessTypePlaceholder: "Business type",
    businessTypeRequired: "Business type is required",
    roleLabel: "Role *",
    rolePlaceholder: "Role",
    roleRequired: "Role is required",
    submit: "Add Company",
  },
  toast: {
    created: "Workspace was created!",
    createFailed: "Could not create the workspace",
    switching: "Chenging...",
    switched: "Workspace was chenged",
    switchFailed: "Could not switch workspace",
  },
  redirect: {
    noWorkspaces: "You are not a member of any workspace yet.",
  },
  errors: {
    noAccess: "You do not have access to this workspace",
    industryNotFound: "Selected business type was not found",
  },
  industries: {
    auto_repair: "Auto Repair & Service",
    phone_electronics_repair: "Phone & Electronics Repair",
    computer_repair: "Computer Repair",
    appliance_repair: "Appliance Repair",
    equipment_repair: "Equipment Repair",
    electrical_services: "Electrical Services",
    home_services: "Home Services",
    other: "Other",
  },
  industryPresets: {
    restaurant: {
      label: "Restaurants & cafés",
      hint: "For venues with menus, reservations and repeat visits.",
    },
    beauty: {
      label: "Beauty salons",
      hint: "Fits appointments, specialists and loyalty programs.",
    },
    fitness: {
      label: "Fitness & sports",
      hint: "For memberships, training sessions and client retention.",
    },
    medical: {
      label: "Medical",
      hint: "For clinics, appointments and careful patient handling.",
    },
    retail: {
      label: "Retail",
      hint: "For storefronts, orders and assortment management.",
    },
    professional_services: {
      label: "Professional services",
      hint: "For agencies, consultants and service teams.",
    },
    auto_service: {
      label: "Auto service",
      hint: "For diagnostics, repairs and service bookings.",
    },
    electronics_repair: {
      label: "Electronics repair",
      hint: "For workshops, repair requests and repair status tracking.",
    },
  },
  logo: {
    errors: {
      invalidFile: "Please select a JPG, PNG, or WebP image smaller than 5 MB.",
      uploadFailed: "Unable to upload company logo. Please try again.",
      removeFailed: "Unable to remove company logo. Please try again.",
      loadFailed: "Unable to load company logo. Please try again.",
      invalidWorkspaceId: "Invalid workspace ID",
      noRowReturned: "avatar_path update failed: no row was returned",
      cropEmpty: "Crop area is empty",
      canvasUnavailable: "Canvas is unavailable",
      webpConversionFailed: "WebP conversion failed",
      signedUrlEmpty: "Signed URL was empty",
      invalidLogoPath: "Invalid logo path",
      imageUnreadable: "Image could not be read",
    },
  },
};
