export default {
  inputLabel: "Search orders, clients and inventory",
  resultsLabel: "Search results",
  minLength_one: "Type at least {{count}} character to search.",
  minLength_other: "Type at least {{count}} characters to search.",
  searching: "Searching...",
  noResults: 'No results for "{{term}}"',
  groupCount: "{{shown}} of {{total}}",
  groups: {
    orders: "Orders",
    clients: "Clients",
    inventory: "Inventory",
  },
  errors: {
    orders: "Could not load orders.",
    clients: "Could not load clients.",
    inventory: "Could not load inventory.",
  },
  byIndustry: {
    auto_repair: {
      inputLabel: "Search orders, clients and parts",
    },
    repair_device: {
      inputLabel: "Search orders, clients and parts",
    },
    field_service: {
      inputLabel: "Search orders, customers and supplies",
    },
    default: {
      inputLabel: "Search orders, clients and inventory",
    },
  },
};
