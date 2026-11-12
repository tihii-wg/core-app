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
import { allocatePaid, type PaymentStageInput } from "../finance/paymentStages";
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

function svc(
  partial: Pick<OrderService, "id" | "serviceId" | "serviceName" | "price"> & Partial<OrderService>,
): OrderService {
  return {
    quantity: 1,
    kind: "service",
    discountType: null,
    discountValue: null,
    technicianId: null,
    ...partial,
  };
}

function mat(
  partial: Pick<OrderMaterial, "id" | "itemName" | "price"> & Partial<OrderMaterial>,
): OrderMaterial {
  return {
    quantity: 1,
    supplySource: "catalog",
    ...partial,
  };
}

function buildServices(t: (key: string) => string, demoPack: string): OrderService[] {
  if (demoPack === "furniture") {
    return [
      svc({ id: "demo-svc-1", serviceId: "demo-f-1", serviceName: t("settings.printTemplates.demo.byIndustry.furniture.svcMeasurement"), price: 800, kind: "labor" }),
      svc({ id: "demo-svc-2", serviceId: "demo-f-2", serviceName: t("settings.printTemplates.demo.byIndustry.furniture.svcDesign"), price: 2500, kind: "service" }),
      svc({
        id: "demo-svc-3",
        serviceId: "demo-f-3",
        serviceName: t("settings.printTemplates.demo.byIndustry.furniture.svcProduction"),
        price: 12000,
        kind: "service",
        warrantyMonths: 12,
        technicianId: "demo-emp-1",
        technicianName: t("settings.printTemplates.demo.employeeLead"),
      }),
      svc({ id: "demo-svc-4", serviceId: "demo-f-4", serviceName: t("settings.printTemplates.demo.byIndustry.furniture.svcDelivery"), price: 1500 }),
      svc({ id: "demo-svc-5", serviceId: "demo-f-5", serviceName: t("settings.printTemplates.demo.byIndustry.furniture.svcInstall"), price: 3500, kind: "labor" }),
    ];
  }
  if (demoPack === "device") {
    return [
      svc({ id: "demo-svc-1", serviceId: "demo-d-1", serviceName: t("settings.printTemplates.demo.byIndustry.device.svcDiagnostics"), price: 250, kind: "labor" }),
      svc({
        id: "demo-svc-2",
        serviceId: "demo-d-2",
        serviceName: t("settings.printTemplates.demo.byIndustry.device.svcScreen"),
        price: 1800,
        warrantyMonths: 3,
        technicianId: "demo-emp-1",
        technicianName: t("settings.printTemplates.demo.employeeLead"),
      }),
    ];
  }
  if (demoPack === "site") {
    return [
      svc({ id: "demo-svc-1", serviceId: "demo-s-1", serviceName: t("settings.printTemplates.demo.byIndustry.site.svcVisit"), price: 400, kind: "labor" }),
      svc({
        id: "demo-svc-2",
        serviceId: "demo-s-2",
        serviceName: t("settings.printTemplates.demo.byIndustry.site.svcInstall"),
        price: 2200,
        warrantyMonths: 12,
        technicianId: "demo-emp-1",
        technicianName: t("settings.printTemplates.demo.employeeLead"),
      }),
    ];
  }
  if (demoPack === "other") {
    return [
      svc({ id: "demo-svc-1", serviceId: "demo-o-1", serviceName: t("settings.printTemplates.demo.byIndustry.other.svcMain"), price: 1000 }),
      svc({ id: "demo-svc-2", serviceId: "demo-o-2", serviceName: t("settings.printTemplates.demo.byIndustry.other.svcExtra"), price: 500, kind: "labor" }),
    ];
  }
  return [
    svc({ id: "demo-svc-1", serviceId: "demo-catalog-svc-1", serviceName: t("settings.printTemplates.demo.serviceDiagnostics"), price: 500, kind: "labor" }),
    svc({
      id: "demo-svc-2",
      serviceId: "demo-catalog-svc-2",
      serviceName: t("settings.printTemplates.demo.serviceOilChange"),
      price: 800,
      discountType: "percent",
      discountValue: 10,
      warrantyMonths: 6,
      warrantyKm: 10_000,
      technicianId: "demo-emp-1",
      technicianName: t("settings.printTemplates.demo.employeeLead"),
      comment: t("settings.printTemplates.demo.lineCommentSample"),
    }),
    svc({ id: "demo-svc-3", serviceId: "demo-catalog-svc-3", serviceName: t("settings.printTemplates.demo.serviceBrakes"), price: 1200 }),
  ];
}

function buildMaterials(t: (key: string) => string, demoPack: string): OrderMaterial[] {
  if (demoPack === "furniture") {
    return [
      mat({ id: "demo-mat-1", inventoryItemId: "demo-inv-1", itemName: `${t("settings.printTemplates.demo.byIndustry.furniture.matLdsp")} (SKU LDSP-16)`, price: 450, quantity: 12 }),
      mat({ id: "demo-mat-2", inventoryItemId: "demo-inv-2", itemName: `${t("settings.printTemplates.demo.byIndustry.furniture.matMdf")} (SKU MDF-F)`, price: 320, quantity: 8 }),
      mat({ id: "demo-mat-3", inventoryItemId: "demo-inv-3", itemName: `${t("settings.printTemplates.demo.byIndustry.furniture.matHinges")} (SKU BLUM-H)`, price: 85, quantity: 16 }),
      mat({ id: "demo-mat-4", inventoryItemId: "demo-inv-4", itemName: `${t("settings.printTemplates.demo.byIndustry.furniture.matSlides")} (SKU BLUM-S)`, price: 120, quantity: 6 }),
      mat({ id: "demo-mat-5", itemName: `${t("settings.printTemplates.demo.byIndustry.furniture.matCountertop")} (SKU TOP-1)`, price: 2800, supplySource: "one_time" }),
    ];
  }
  if (demoPack === "device") {
    return [
      mat({ id: "demo-mat-1", inventoryItemId: "demo-inv-1", itemName: `${t("settings.printTemplates.demo.byIndustry.device.matScreen")} (SKU SCR-14)`, price: 950 }),
      mat({ id: "demo-mat-2", itemName: `${t("settings.printTemplates.demo.byIndustry.device.matAdhesive")} (SKU ADH-1)`, price: 60, supplySource: "one_time" }),
    ];
  }
  if (demoPack === "site") {
    return [
      mat({ id: "demo-mat-1", inventoryItemId: "demo-inv-1", itemName: `${t("settings.printTemplates.demo.byIndustry.site.matCable")} (SKU CAB-2.5)`, price: 18, quantity: 25 }),
      mat({ id: "demo-mat-2", inventoryItemId: "demo-inv-2", itemName: `${t("settings.printTemplates.demo.byIndustry.site.matOutlet")} (SKU OUT-1)`, price: 45, quantity: 4 }),
    ];
  }
  if (demoPack === "other") {
    return [mat({ id: "demo-mat-1", inventoryItemId: "demo-inv-1", itemName: `${t("settings.printTemplates.demo.byIndustry.other.matMain")} (SKU GEN-1)`, price: 200 })];
  }
  return [
    mat({ id: "demo-mat-1", inventoryItemId: "demo-inv-1", itemName: `${t("settings.printTemplates.demo.materialOilFilter")} (SKU OF-001)`, price: 150 }),
    mat({ id: "demo-mat-2", inventoryItemId: "demo-inv-2", itemName: `${t("settings.printTemplates.demo.materialEngineOil")} (SKU EO-5W40)`, price: 80, quantity: 4 }),
    mat({ id: "demo-mat-3", itemName: `${t("settings.printTemplates.demo.materialGasket")} (SKU OT-GASKET)`, price: 45, supplySource: "one_time" }),
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
    defaultCommentsVisibility: "private",
    defaultFilesVisibility: "private",
    lineCommentsVisibility: "public",
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
    paymentStageTemplate: null,
    subscriptionStatus: "active",
    subscriptionStartedAt: null,
    subscriptionExpiresAt: null,
    subscriptionUpdatedAt: null,
    attachmentStorage: "app",
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
  // No slug → auto_repair so legacy previews keep a full vehicle token set.
  const profile = industryProfile(input.industrySlug?.trim() || "auto_repair");
  const demoPack = profile.demoPack;
  const isVehicle = profile.assetKind === "vehicle";

  const services = buildServices(t, demoPack);
  const materials = buildMaterials(t, demoPack);
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
  const headerDiscount = demoPack === "furniture" ? 0 : 100;
  const totalPrice = Math.round((money.total - headerDiscount) * 100) / 100;
  const discountTotal = Math.round((money.discountTotal + headerDiscount) * 100) / 100;
  const vat = orderVatBreakdown({ total: totalPrice, vatRate });
  const paid =
    demoPack === "furniture"
      ? Math.round(totalPrice * 0.5 * 100) / 100
      : Math.min(1000, Math.round(totalPrice * 0.4 * 100) / 100);
  const remaining = Math.round((totalPrice - paid) * 100) / 100;

  const workspace = buildWorkspace({ ...input, locale, currency }, t);
  const legalEntity = buildLegalEntity(workspace, t);
  const client = buildClient(input.documentType, t);
  const vehicle = isVehicle ? buildVehicle(mileageUnit) : null;
  const deviceLabel =
    profile.assetKind === "vehicle" && vehicle
      ? `${vehicle.make} ${vehicle.model} ${vehicle.year}`
      : profile.assetKind === "device"
        ? t("settings.printTemplates.demo.byIndustry.device.asset")
        : profile.assetKind === "site"
          ? t("settings.printTemplates.demo.byIndustry.site.asset")
          : profile.assetKind === "project"
            ? t("settings.printTemplates.demo.byIndustry.furniture.asset")
            : t("settings.printTemplates.demo.byIndustry.other.asset");
  const description =
    demoPack === "furniture"
      ? t("settings.printTemplates.demo.byIndustry.furniture.notes")
      : demoPack === "device"
        ? t("settings.printTemplates.demo.byIndustry.device.notes")
        : demoPack === "site"
          ? t("settings.printTemplates.demo.byIndustry.site.notes")
          : demoPack === "other"
            ? t("settings.printTemplates.demo.byIndustry.other.notes")
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
    vehicleId: vehicle?.id ?? null,
    vehicleMileageSnapshot: isVehicle ? 125_000 : null,
    vehicleMileageUnitSnapshot: isVehicle ? mileageUnit : null,
    device: deviceLabel,
    vin: isVehicle ? (vehicle?.vin ?? "") : "",
    carNumber: isVehicle ? (vehicle?.licensePlate ?? "") : "",
    // Always fill industry tokens so template previews never show empty placeholders.
    // Values stay pack-realistic; vehicle/other packs still get non-empty demo strings.
    deviceSerial: demoPack === "device" ? "SN-A1782-BX91" : "SN-DEMO-0001",
    deviceImei: demoPack === "device" ? "356938035643809" : "000000000000000",
    deviceCondition: t("settings.printTemplates.demo.byIndustry.device.condition"),
    deviceCompleteness: t("settings.printTemplates.demo.byIndustry.device.completeness"),
    // Passcode is never printed; only device demos keep a value for UI coverage.
    devicePasscode: demoPack === "device" ? "demo-passcode-never-print" : "",
    siteAddress: t("settings.printTemplates.demo.byIndustry.site.objectAddress"),
    productDimensions: demoPack === "furniture" ? "2400×720×600" : "1200×600×450",
    measurementAt: addDaysIso(now, demoPack === "furniture" ? -3 : -1),
    installationAt: addDaysIso(now, demoPack === "furniture" ? 5 : 3),
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

  // Demo schedule: furniture 50/30/20 (prepayment paid in full), other packs 50/50.
  const stageInputs: PaymentStageInput[] =
    demoPack === "furniture"
      ? [
          { position: 0, name: t("settings.printTemplates.demo.paymentStages.prepayment"), mode: "percent", percent: 50, dueDate: dateOnly(addDaysIso(now, -3)) },
          { position: 1, name: t("settings.printTemplates.demo.paymentStages.production"), mode: "percent", percent: 30, dueDate: dateOnly(addDaysIso(now, 3)) },
          { position: 2, name: t("settings.printTemplates.demo.paymentStages.final"), mode: "remainder", dueDate: dateOnly(addDaysIso(now, 10)) },
        ]
      : [
          { position: 0, name: t("settings.printTemplates.demo.paymentStages.prepayment"), mode: "percent", percent: 50, dueDate: dateOnly(addDaysIso(now, -1)) },
          { position: 1, name: t("settings.printTemplates.demo.paymentStages.final"), mode: "remainder", dueDate: dateOnly(addDaysIso(now, 7)) },
        ];
  const paymentStages = allocatePaid(stageInputs, totalPrice, paid, { today: now });

  const warrantyService = services.find((line) => line.warrantyMonths) ?? services[0]!;
  const warrantyMonths = warrantyService.warrantyMonths ?? (isVehicle ? 6 : 12);
  const warrantyRecords: WarrantySnapshot[] = [
    {
      id: "demo-warr-1",
      orderId: order.id,
      itemKind: "service",
      itemName: warrantyService.serviceName,
      orderServiceId: warrantyService.id ?? null,
      orderMaterialId: null,
      durationMonths: warrantyMonths,
      durationDays: null,
      mileageLimit: isVehicle ? (warrantyService.warrantyKm ?? 10_000) : null,
      startsAt: todayIso,
      endsOn: dateOnly(addDaysIso(now, Math.round(warrantyMonths * 30.44))),
      startMileage: isVehicle ? 125_000 : null,
      expiresAtMileage: isVehicle ? 135_000 : null,
      mileageUnit: isVehicle ? mileageUnit : null,
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
    paymentStages,
    warrantyRecords,
    printedAt: now,
    documentKind: input.documentType,
    workspaceVatRate: vatRate,
    invoiceTaxTotal: vat?.vat ?? null,
  });
}
