export const clientTypeRules = { required: "Client type is required" };

export const clientEmailRules = { required: "Email is required" };

export const clientPhoneRules = {
  required: "Phone is required",
  pattern: {
    value: /^\+373\d{8}$/,
    message: "Phone must be in format +37300000000",
  },
};
