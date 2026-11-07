/**
 * Client-side only demo PrintContext for template thumbnails / previews.
 * Never persisted or sent to the server.
 */

import i18n, { currentLanguage } from "../../i18n";
import { isAppLanguage } from "../../i18n/languages";
import type {
  Client,
  InvoiceDocument,
  InvoiceItem,
  Order,
  OrderMaterial,
  OrderService,
  Vehicle,
} from "../../lib/types";
import type { LegalEntity } from "../../services/apiLegalEntities";
import type { WorkspaceDetails } from "../../services/apiWorkspaces";
import { orderVatBreakdown } from "../finance/orderVat";
import type { PaymentBalance } from "../finance/paymentTypes";
import { classifyInvoiceItems } from "../invoices/invoiceItemSections";
import { computeOrderMoney } from "../orders/orderTotals";
import type { WarrantySnapshot } from "../orders/warranty";
import type { MileageUnit } from "../../lib/types";
import { industryProfile } from "../industries/industryProfile";
import {
  emptyPrintContext,
  type PrintContext,
  type PrintDocumentKind,
} from "./templateVariables";

/** Sentinel id for the demo data source in preview selectors (never a real UUID). */
export const DEMO_PRINT_SOURCE_ID = "__demo__";

/** Tiny SVG placeholder logo (data URI) — used when no workspace logo is available. */
export const DEMO_LOGO_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48">` +
      `<rect width="160" height="48" rx="6" fill="#1e3a5f"/>` +
      `<text x="80" y="30" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="14" font-weight="600">DEMO</text>` +
      `</svg>`,
  );

export type DemoPrintContextInput = {
  documentType: PrintDocumentKind;
  locale?: string;
  currency?: string;
  vatRate?: number | null;
  mileageUnit?: MileageUnit;
  /** Prefer a real workspace logo URL when already loaded in the UI. */
  logoUrl?: string | null;
  /** Prefer the real workspace display name when already loaded. */
  companyName?: string | null;
  /** Workspace industry slug — shapes demo asset / line items (client-side only). */
  industrySlug?: string | null;
  /** Fixed "today" for deterministic tests. */
  now?: Date;
};

function demoT(locale: string): (key: string) => string {
  const lng = isAppLanguage(locale) ? locale : currentLanguage();
  const t = i18n.getFixedT(lng);
  return (key: string) => String(t(key as never));
}

function addDaysIso(base: Date, days: number): string {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function buildServices(t: (key: string) => string): OrderService[] {
  return [
    {
      id: "demo-svc-1",
      serviceId: "demo-catalog-svc-1",
      serviceName: t("settings.printTemplates.demo.serviceDiagnostics"),
      price: 500,
      quantity: 1,
      kind: "labor",
      discountType: null,
      discountValue: null,
      technicianId: null,
    },
    {
      id: "demo-svc-2",
      serviceId: "demo-catalog-svc-2",
      serviceName: t("settings.printTemplates.demo.serviceOilChange"),
      price: 800,
      quantity: 1,
      kind: "service",
      discountType: "percent",
      discountValue: 10,
      warrantyMonths: 6,
      warrantyKm: 10_000,
      technicianId: "demo-emp-1",
      technicianName: t("settings.printTemplates.demo.employeeLead"),
    },
    {
      id: "demo-svc-3",
      serviceId: "demo-catalog-svc-3",
      serviceName: t("settings.printTemplates.demo.serviceBrakes"),
      price: 1200,
      quantity: 1,
      kind: "service",
      discountType: null,
      discountValue: null,
    },
  ];
}

function buildMaterials(t: (key: string) => string): OrderMaterial[] {
  return [
    {
      id: "demo-mat-1",
      inventoryItemId: "demo-inv-1",
      itemName: `${t("settings.printTemplates.demo.materialOilFilter")} (SKU OF-001)`,
      price: 150,
      quantity: 1,
      supplySource: "catalog",
    },
    {
      id: "demo-mat-2",
      inventoryItemId: "demo-inv-2",
      itemName: `${t("settings.printTemplates.demo.materialEngineOil")} (SKU EO-5W40)`,
      price: 80,
      quantity: 4,
      supplySource: "catalog",
    },
    {
      id: "demo-mat-3",
      itemName: `${t("settings.printTemplates.demo.materialGasket")} (SKU OT-GASKET)`,
      price: 45,
      quantity: 1,
      supplySource: "one_time",
    },
  ];
}

function buildWorkspace(input: DemoPrintContextInput, t: (key: string) => string): WorkspaceDetails {
  const name = input.companyName?.trim() || t("settings.printTemplates.demo.companyName");
  return {
    id: "demo-workspace",
    name,
    ownerId: "demo-owner",
    industryId: null,
    industryName: null,
    industrySlug: input.industrySlug?.trim() || "auto_repair",
    avatarPath: null,
    inventoryMarkup: null,
    language: input.locale ?? "ru",
    timezone: "Europe/Chisinau",
    dateFormat: "DD.MM.YYYY",
    currency: input.currency ?? "MDL",
    role: "owner",
    companyAddress: t("settings.printTemplates.demo.companyAddress"),
    billingEmail: "demo@example.com",
    registrationNumber: "1002600000000",
    taxVatNumber: "1012600000000",
    iban: "MD00AG000000000000000000",
    bankName: t("settings.printTemplates.demo.bankName"),
    bankCode: "AGMDMD2X",
    companyDescription: "",
    printExtraInfo: t("settings.printTemplates.demo.companyPhone"),
    countryCode: "MD",
    documentLanguage: input.locale ?? "ru",
    warrantyStart: "closed_at",
    warrantyServiceMonths: 6,
    warrantyServiceKm: 10_000,
    warrantyPartsMonths: 3,
    warrantyPartsKm: 5_000,
    defaultCommentsVisibility: "team",
    defaultFilesVisibility: "team",
    preventDuplicateDeviceOrders: false,
    showClientMiddleName: false,
    defaultPhoneConsent: true,
    preventDuplicatePhones: false,
    defaultEmailConsent: true,
    preventDuplicateEmails: false,
    invoiceNumberTemplate: "INV-{YYYY}-{###}",
    invoiceDueDays: 10,
    invoiceOrderDetailsMode: "detailed",
    preventBackdatedInvoices: false,
    defaultLegalEntityId: "demo-le-1",
    onlinePaymentsEnabled: false,
    requireTaxInvoiceNumber: false,
    ownerCanManageClosedOrders: false,
    subscriptionStatus: "active",
    subscriptionStartedAt: null,
    subscriptionExpiresAt: null,
    subscriptionUpdatedAt: null,
  };
}

function buildLegalEntity(workspace: WorkspaceDetails, t: (key: string) => string): LegalEntity {
  return {
    id: "demo-le-1",
    workspaceId: workspace.id,
    legalName: workspace.name,
    address: workspace.companyAddress,
    registrationNumber: workspace.registrationNumber,
    taxNumber: workspace.taxVatNumber,
    billingEmail: workspace.billingEmail,
    iban: workspace.iban,
    bankName: workspace.bankName,
    bankCode: workspace.bankCode,
    additionalInfo: `${t("settings.printTemplates.demo.companyPhone")} · ${workspace.billingEmail}`,
    isDefault: true,
  };
}

function buildClient(documentType: PrintDocumentKind, t: (key: string) => string): Client {
  if (documentType === "invoice") {
    return {
      id: "demo-client-org",
      name: t("settings.printTemplates.demo.buyerOrgName"),
      email: "buyer@example.com",
      phone: "+373 69 000 000",
      address: t("settings.printTemplates.demo.buyerOrgAddress"),
      balance: 0,
      created_at: "",
      client_type: "organization",
      tax_id: "1005600000001",
      contact_person: t("settings.printTemplates.demo.clientName"),
    };
  }
  return {
    id: "demo-client-1",
    name: t("settings.printTemplates.demo.clientName"),
    email: "ivan.petrov@example.com",
    phone: "+373 69 000 000",
    address: t("settings.printTemplates.demo.clientAddress"),
    balance: 0,
    created_at: "",
    client_type: "individual",
    tax_id: "2000100000000",
    contact_person: null,
  };
}

function buildVehicle(mileageUnit: MileageUnit): Vehicle {
  return {
    id: "demo-vehicle-1",
    workspaceId: "demo-workspace",
    clientId: "demo-client-1",
    make: "Toyota",
    model: "Camry",
    year: 2018,
    vin: "JTNB11HK0J3000000",
    licensePlate: "ABC 123",
    initialMileage: 0,
    currentMileage: 125_000,
    mileageUnit,
    engineDisplacement: 2.5,
    fuelType: "petrol",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

/**
 * Builds a complete fictional PrintContext so every registry token resolves to a non-empty value.
 */
export function demoPrintContext(input: DemoPrintContextInput): PrintContext {
  const locale = (input.locale?.trim() || "ru").toLowerCase();
  const currency = input.currency?.trim() || "MDL";
  const vatRate = input.vatRate == null || !Number.isFinite(input.vatRate) ? 20 : Number(input.vatRate);
  const mileageUnit: MileageUnit = input.mileageUnit === "mi" ? "mi" : "km";
  const now = input.now ?? new Date();
  const todayIso = now.toISOString();
  const t = demoT(locale);

  const services = buildServices(t);
  const materials = buildMaterials(t);
  const money = computeOrderMoney({
    services: services.map((line) => ({
      price: line.price,
      qty: line.quantity,
      discountType: line.discountType,
      discountValue: line.discountValue,
    })),
    materials: materials.map((line) => ({
      price: line.price,
      qty: line.quantity,
      discountType: line.discountType,
      discountValue: line.discountValue,
    })),
  });
  const headerDiscount = 100;
  const totalPrice = Math.round((money.total - headerDiscount) * 100) / 100;
  const discountTotal = Math.round((money.discountTotal + headerDiscount) * 100) / 100;
  const vat = orderVatBreakdown({ total: totalPrice, vatRate });
  const paid = 1000;
  const remaining = Math.round((totalPrice - paid) * 100) / 100;

  const profile = industryProfile(input.industrySlug);
  const workspace = buildWorkspace({ ...input, locale, currency }, t);
  const legalEntity = buildLegalEntity(workspace, t);
  const client = buildClient(input.documentType, t);
  // Always populate vehicle so every print token can resolve; order.device/description follow assetKind.
  const vehicle = buildVehicle(mileageUnit);
  const deviceLabel =
    profile.assetKind === "vehicle"
      ? `${vehicle.make} ${vehicle.model} ${vehicle.year}`
      : profile.assetKind === "device"
        ? t("settings.printTemplates.demo.byIndustry.device.asset")
        : profile.assetKind === "site"
          ? t("settings.printTemplates.demo.byIndustry.site.asset")
          : profile.assetKind === "project"
            ? t("settings.printTemplates.demo.byIndustry.furniture.asset")
            : t("settings.printTemplates.demo.byIndustry.other.asset");
  const description =
    profile.demoPack === "furniture"
      ? t("settings.printTemplates.demo.byIndustry.furniture.notes")
      : t("settings.printTemplates.demo.orderNotes");

  // Demo always fills closedAt so print tokens never render empty (even for open WO previews).
  const closedAt = todayIso;
  const status: Order["status"] = input.documentType === "work_order" ? "in-progress" : "closed";

  const order: Order = {
    id: "demo-order-1",
    workspace_id: workspace.id,
    clientId: client.id,
    clientName: client.name,
    clientType: client.client_type,
    clientEmail: client.email,
    clientPhone: client.phone,
    orderNumber: "ORD-2026-0001",
    vehicleId: vehicle.id,
    vehicleMileageSnapshot: 125_000,
    vehicleMileageUnitSnapshot: mileageUnit,
    device: deviceLabel,
    vin: profile.assetKind === "device" ? "SN-DEMO-0001" : (vehicle.vin ?? ""),
    carNumber: profile.assetKind === "vehicle" ? (vehicle.licensePlate ?? "") : "",
    service: services.map((line) => line.serviceName).join(", "),
    services,
    materials,
    description,
    status,
    customStatus: {
      name: t(
        input.documentType === "work_order"
          ? "settings.printTemplates.demo.statusInProgress"
          : "settings.printTemplates.demo.statusClosed",
      ),
      color: null,
    },
    closedAt,
    assignedEmployeeId: "demo-emp-1",
    assignedEmployeeName: t("settings.printTemplates.demo.employeeLead"),
    team: [
      { employeeId: "demo-emp-1", name: t("settings.printTemplates.demo.employeeLead"), role: "lead" },
      { employeeId: "demo-emp-2", name: t("settings.printTemplates.demo.employeeHelper"), role: "helper" },
    ],
    deadline: addDaysIso(now, 2),
    totalPrice,
    vatRate,
    taxTotal: vat?.vat ?? null,
    subtotal: money.subtotal,
    discountTotal,
    discountType: "amount",
    discountValue: headerDiscount,
    isPaid: false,
    paymentStatus: "partial",
    taxInvoiceNumber: "TF-2026-0042",
    createdById: "demo-user-1",
    createdByName: t("settings.printTemplates.demo.acceptedBy"),
    createdAt: todayIso,
    updatedAt: todayIso,
  };

  const invoiceItems: InvoiceItem[] = [
    ...services.map((line, index) => ({
      id: `demo-inv-item-s${index + 1}`,
      invoiceId: "demo-invoice-1",
      serviceId: line.serviceId || null,
      serviceName: line.serviceName,
      price: line.price,
      quantity: line.quantity,
      position: index,
      createdAt: todayIso,
    })),
    ...materials.map((line, index) => ({
      id: `demo-inv-item-m${index + 1}`,
      invoiceId: "demo-invoice-1",
      serviceId: null,
      serviceName: line.itemName,
      price: line.price,
      quantity: line.quantity,
      position: services.length + index,
      createdAt: todayIso,
    })),
  ];

  const invoice: InvoiceDocument = {
    id: "demo-invoice-1",
    workspaceId: workspace.id,
    invoiceNumber: "INV-2026-0001",
    clientId: client.id,
    clientName: client.name,
    clientPhone: client.phone,
    orderId: order.id,
    orderNumber: order.orderNumber,
    device: deviceLabel,
    carNumber: order.carNumber,
    vin: order.vin,
    description: t("settings.printTemplates.demo.invoiceNotes"),
    subtotal: money.subtotal,
    amount: totalPrice,
    total: totalPrice,
    status: "sent",
    dueDate: dateOnly(addDaysIso(now, 10)),
    createdAt: todayIso,
    updatedAt: todayIso,
    paidAt: addDaysIso(now, -1),
    createdById: "demo-user-1",
    createdByName: t("settings.printTemplates.demo.acceptedBy"),
    items: invoiceItems,
  };

  const invoiceSections = classifyInvoiceItems(invoiceItems, {
    services: services.map((line) => ({
      serviceId: line.serviceId || null,
      serviceName: line.serviceName,
      price: line.price,
      quantity: line.quantity,
    })),
    materials: materials.map((line) => ({
      itemName: line.itemName,
      price: line.price,
      quantity: line.quantity,
    })),
  });

  const paymentBalance: PaymentBalance = {
    total: totalPrice,
    netPaid: paid,
    remaining,
    overpayment: 0,
    status: "partial",
    hasLedger: true,
    isLegacyUnreconciled: false,
  };

  const warrantyRecords: WarrantySnapshot[] = [
    {
      id: "demo-warr-1",
      orderId: order.id,
      itemKind: "service",
      itemName: services[1]!.serviceName,
      orderServiceId: services[1]!.id ?? null,
      orderMaterialId: null,
      durationMonths: 6,
      durationDays: null,
      mileageLimit: 10_000,
      startsAt: todayIso,
      endsOn: dateOnly(addDaysIso(now, 182)),
      startMileage: 125_000,
      expiresAtMileage: 135_000,
      mileageUnit,
    },
  ];

  return emptyPrintContext({
    order,
    invoice,
    invoiceSections,
    client,
    vehicle,
    workspace,
    legalEntity,
    logoUrl: input.logoUrl?.trim() || DEMO_LOGO_DATA_URI,
    companyPhone: t("settings.printTemplates.demo.companyPhone"),
    currency,
    dateFormat: "DD.MM.YYYY",
    timeZone: "Europe/Chisinau",
    locale,
    paymentBalance,
    warrantyRecords,
    printedAt: now,
    documentKind: input.documentType,
    workspaceVatRate: vatRate,
    invoiceTaxTotal: vat?.vat ?? null,
  });
}
