export default {
  sectionTitle: "Warranty",
  sectionHint: "Default warranty applied when this item is added to an order. Order lines keep their own snapshot and can still be overridden.",
  sectionHintDurationOnly:
    "Default duration warranty applied when this item is added to an order. Order lines keep their own snapshot and can still be overridden.",
  typeLabel: "Warranty type",
  enableDuration: "Duration limit",
  enableMileage: "Mileage limit",
  monthsLabel: "Duration (months)",
  monthsPlaceholder: "e.g. 12",
  kmLabel: "Mileage limit (km)",
  kmPlaceholder: "e.g. 20000",
  kmOrderHint: "On orders for vehicles in miles this value is converted automatically.",
  whicheverFirst: "Warranty ends when either limit is reached, whichever comes first.",
  durationOnlyHint: "Warranty ends when the time limit is reached.",
  types: {
    none: "No warranty",
    duration: "Duration only",
    mileage: "Mileage only",
    both: "Duration and mileage",
  },
  errors: {
    incomplete: "Enter a positive duration and/or mileage for the selected warranty type.",
    durationRequired: "Enter a positive duration in months.",
    mileageRequired: "Enter a positive mileage limit in kilometers.",
    bothRequired: "Enter both a positive duration and mileage limit.",
  },
};
