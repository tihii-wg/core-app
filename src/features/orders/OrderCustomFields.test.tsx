import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  OrderCustomFields,
  collectCustomFieldPayload,
  validateRequiredCustomFields,
  type OrderCustomFieldValues,
} from "./OrderCustomFields";
import type { OrderFieldConfigItem } from "./orderFieldConfig";

const fields: OrderFieldConfigItem[] = [
  {
    key: "note",
    label: "Note",
    visible: true,
    required: true,
    isCustom: true,
    isSystem: false,
    type: "text",
    options: [],
    definitionId: "def-note",
    sortOrder: 10,
    canHide: true,
    canRequire: true,
    canRename: true,
    defaultLabel: "Note",
    defaultVisible: true,
    defaultRequired: false,
    defaultSortOrder: 10,
  },
  {
    key: "qty",
    label: "Qty",
    visible: true,
    required: false,
    isCustom: true,
    isSystem: false,
    type: "number",
    options: [],
    definitionId: "def-qty",
    sortOrder: 20,
    canHide: true,
    canRequire: true,
    canRename: true,
    defaultLabel: "Qty",
    defaultVisible: true,
    defaultRequired: false,
    defaultSortOrder: 20,
  },
  {
    key: "color",
    label: "Color",
    visible: true,
    required: false,
    isCustom: true,
    isSystem: false,
    type: "select",
    options: [
      { value: "red", label: "Red" },
      { value: "blue", label: "Blue" },
    ],
    definitionId: "def-color",
    sortOrder: 30,
    canHide: true,
    canRequire: true,
    canRename: true,
    defaultLabel: "Color",
    defaultVisible: true,
    defaultRequired: false,
    defaultSortOrder: 30,
  },
  {
    key: "done",
    label: "Done",
    visible: true,
    required: false,
    isCustom: true,
    isSystem: false,
    type: "checkbox",
    options: [],
    definitionId: "def-done",
    sortOrder: 40,
    canHide: true,
    canRequire: true,
    canRename: true,
    defaultLabel: "Done",
    defaultVisible: true,
    defaultRequired: false,
    defaultSortOrder: 40,
  },
];

function Harness() {
  const [values, setValues] = useState<OrderCustomFieldValues>({
    note: "",
    qty: "",
    color: "",
    done: false,
  });
  return (
    <OrderCustomFields
      fields={fields}
      values={values}
      onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
    />
  );
}

describe("OrderCustomFields", () => {
  it("renders each custom type", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/Note/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Qty/)).toBeInTheDocument();
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByLabelText(/Done/)).toBeInTheDocument();
  });

  it("validates required custom fields and collects payload", () => {
    const values: OrderCustomFieldValues = {
      note: "",
      qty: "3",
      color: "red",
      done: true,
    };
    expect(validateRequiredCustomFields(fields, values, "required")).toEqual({
      note: "required",
    });

    const payload = collectCustomFieldPayload(fields, {
      ...values,
      note: "hello",
    });
    expect(payload).toEqual([
      { definitionId: "def-note", value: "hello" },
      { definitionId: "def-qty", value: 3 },
      { definitionId: "def-color", value: "red" },
      { definitionId: "def-done", value: true },
    ]);
  });
});
