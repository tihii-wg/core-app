import { describe, expect, it } from "vitest";
import {
  applyClientAssetFilter,
  deriveClientDevices,
  deriveClientSites,
  deviceAssetFilter,
  siteAssetFilter,
  type ClientAssetOrder,
} from "./clientAssets";

function order(id: string, createdAt: string, extra: Partial<ClientAssetOrder> = {}): ClientAssetOrder {
  return { id, createdAt, ...extra };
}

describe("deriveClientDevices", () => {
  it("groups orders by normalized name + serial + IMEI and counts them", () => {
    const devices = deriveClientDevices([
      order("o1", "2026-01-01", { device: "iPhone 13", deviceSerial: "SN-1", deviceImei: "111" }),
      order("o2", "2026-03-05", { device: "  iphone   13 ", deviceSerial: "sn-1", deviceImei: "111" }),
      order("o3", "2026-02-01", { device: "iPhone 13", deviceSerial: "SN-2", deviceImei: "222" }),
    ]);

    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({
      name: "iPhone 13",
      serial: "SN-1",
      imei: "111",
      orderCount: 2,
      lastOrderDate: "2026-03-05",
      orderIds: ["o1", "o2"],
    });
    expect(devices[1]).toMatchObject({ serial: "SN-2", orderCount: 1, orderIds: ["o3"] });
  });

  it("skips orders without any device data and sorts newest first", () => {
    const devices = deriveClientDevices([
      order("o1", "2026-01-01"),
      order("o2", "2026-01-01", { device: "Old laptop" }),
      order("o3", "2026-04-01T10:00:00Z", { device: "New laptop" }),
    ]);

    expect(devices.map((device) => device.name)).toEqual(["New laptop", "Old laptop"]);
    expect(devices[0]?.lastOrderDate).toBe("2026-04-01");
  });

  it("keeps same-name devices with different serials apart", () => {
    const devices = deriveClientDevices([
      order("o1", "2026-01-01", { device: "TV", deviceSerial: "A" }),
      order("o2", "2026-01-02", { device: "TV", deviceSerial: "B" }),
      order("o3", "2026-01-03", { device: "TV" }),
    ]);
    expect(devices).toHaveLength(3);
  });
});

describe("deriveClientSites", () => {
  it("prefers siteAddress, falls back to product dimensions, skips empty", () => {
    const sites = deriveClientSites([
      order("o1", "2026-01-01", { siteAddress: "Str. Mihai Viteazul 5", productDimensions: "200x60" }),
      order("o2", "2026-02-01", { siteAddress: " str. mihai   viteazul 5 ", productDimensions: "210x60" }),
      order("o3", "2026-01-15", { productDimensions: "Wardrobe 240x60" }),
      order("o4", "2026-01-20"),
    ]);

    expect(sites).toHaveLength(2);
    expect(sites[0]).toMatchObject({
      label: "Str. Mihai Viteazul 5",
      details: "210x60",
      orderCount: 2,
      lastOrderDate: "2026-02-01",
      orderIds: ["o1", "o2"],
    });
    expect(sites[1]).toMatchObject({ label: "Wardrobe 240x60", details: "", orderCount: 1 });
  });
});

describe("deriveClientSites — object / product in device", () => {
  it("uses the order object (device) for furniture / field services, alone or with the address", () => {
    const sites = deriveClientSites([
      order("o1", "2026-01-01", { device: "Кухня угловая" }),
      order("o2", "2026-01-02", { device: "Шкаф-купе", siteAddress: "ул. Пушкина 1" }),
    ]);
    expect(sites.map((site) => site.label).sort()).toEqual(["Кухня угловая", "ул. Пушкина 1 · Шкаф-купе"]);
  });
});

describe("asset filters", () => {
  it("builds filters and narrows a list by order id", () => {
    const [device] = deriveClientDevices([
      order("o1", "2026-01-01", { device: "Phone", deviceSerial: "S1" }),
      order("o2", "2026-01-02", { device: "Phone", deviceSerial: "S1" }),
    ]);
    const filter = deviceAssetFilter(device!);
    expect(filter).toMatchObject({ kind: "device", label: "Phone · S1", orderIds: ["o1", "o2"] });

    const list = [{ id: "o1" }, { id: "o2" }, { id: "o3" }];
    expect(applyClientAssetFilter(list, filter).map((item) => item.id)).toEqual(["o1", "o2"]);
    expect(applyClientAssetFilter(list, null)).toBe(list);

    const [site] = deriveClientSites([order("o3", "2026-01-01", { siteAddress: "Main st" })]);
    expect(siteAssetFilter(site!)).toMatchObject({ kind: "site", label: "Main st", orderIds: ["o3"] });
  });
});
