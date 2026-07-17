import type { Category, Order, RecycleSettings } from "../types";

let orders: Order[] = [
  {
    _id: "mock-order-1",
    orderNo: "20260716001842",
    source: "category",
    summary: "纸箱 约12kg 等2类",
    status: "submitted",
    addressSnapshot: { contactName: "王女士", phone: "138****4821", region: "上海市 浦东新区", detail: "张江路 88 号" },
    appointDate: "2026-07-17",
    appointSlot: "09:00-12:00",
    items: [{ categoryName: "纸箱", unit: "kg", estWeight: 12 }],
    remark: "到了请先电话联系",
    createTime: Date.now() - 35 * 60 * 1000,
    updateTime: Date.now() - 35 * 60 * 1000,
  },
  {
    _id: "mock-order-2",
    orderNo: "20260715009631",
    source: "photo",
    summary: "拍照提交 3张",
    status: "processing",
    addressSnapshot: { contactName: "李先生", phone: "186****2310", region: "上海市 闵行区", detail: "虹桥路 1200 号" },
    appointDate: "2026-07-16",
    appointSlot: "12:00-18:00",
    estimatePrice: 86,
    recyclerName: "陈师傅",
    recyclerPhone: "13900001234",
    adminRemark: "用户希望下午三点后上门",
    createTime: Date.now() - 24 * 60 * 60 * 1000,
    updateTime: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    _id: "mock-order-3",
    orderNo: "20260714005208",
    source: "category",
    summary: "旧家电 2件",
    status: "completed",
    addressSnapshot: { contactName: "周女士", phone: "137****9206", region: "上海市 静安区", detail: "江宁路 306 号" },
    appointDate: "2026-07-15",
    appointSlot: "09:00-12:00",
    finalCount: 2,
    finalPrice: 160,
    recyclerName: "张师傅",
    recyclerPhone: "13800001000",
    createTime: Date.now() - 2 * 24 * 60 * 60 * 1000,
    updateTime: Date.now() - 24 * 60 * 60 * 1000,
    completedAt: Date.now() - 24 * 60 * 60 * 1000,
  },
];

let categories: Category[] = [
  { _id: "c1", name: "纸箱", unit: "kg", priceRef: "0.8元/kg起", sortOrder: 1, enabled: true },
  { _id: "c2", name: "塑料瓶", unit: "kg", priceRef: "1.2元/kg起", sortOrder: 2, enabled: true },
  { _id: "c3", name: "旧家电", unit: "件", priceRef: "现场估价", sortOrder: 3, enabled: false },
];

let settings: RecycleSettings = {
  key: "recycle_rules",
  minWeightKg: 5,
  minCount: 0,
  photoOrderCheckMinQuantity: false,
  siteName: "绿源废品回收平台",
  servicePhone: "4008889999",
  notifyEnabled: true,
  autoAssign: false,
  maxDistanceKm: 10,
  updateTime: Date.now() - 3 * 24 * 60 * 60 * 1000,
};

export const isDevPreview = () =>
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("mock") === "1";

export async function mockCall<T>(type: string, data: Record<string, unknown>): Promise<T> {
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  if (type === "adminListOrders") {
    const status = String(data.status || "");
    const keyword = String(data.keyword || "").toLowerCase();
    const filtered = orders.filter((item) => (!status || item.status === status) && (!keyword || item.orderNo.toLowerCase().includes(keyword)));
    return { list: filtered, total: filtered.length, hasMore: false } as T;
  }
  if (type === "adminGetOrderDetail") return orders.find((item) => item._id === data.id) as T;
  if (type === "adminUpdateOrder") {
    orders = orders.map((item) => item._id === data.id ? { ...item, ...data, status: data.status as Order["status"], updateTime: Date.now() } : item);
    return undefined as T;
  }
  if (type === "adminListCategories") return categories as T;
  if (type === "adminSaveCategory") {
    const category = data.category as Category;
    if (category._id) categories = categories.map((item) => item._id === category._id ? category : item);
    else categories = [...categories, { ...category, _id: `c${Date.now()}` }];
    return undefined as T;
  }
  if (type === "adminGetSettings") return settings as T;
  if (type === "adminSaveSettings") {
    settings = { ...(data.settings as RecycleSettings), key: "recycle_rules", updateTime: Date.now() };
    return settings as T;
  }
  throw new Error(`本地预览未实现接口：${type}`);
}
