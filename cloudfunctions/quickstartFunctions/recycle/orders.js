// 云回收 · 订单模块（核心）
// 对应接口契约：4.1 createOrder、4.2 getOrderList、4.3 getOrderDetail、4.4 cancelOrder、4.5 getTempFileURL
// 待办：R13 订单号规则+时区、R15 幂等（前端按钮防抖为主）
const cloud = require("wx-server-sdk");

const db = cloud.database();

const DEFAULT_RECYCLE_SETTINGS = {
  minWeightKg: 5,
  minCount: 0,
  photoOrderCheckMinQuantity: false,
};

// 订单列表分组：小程序端只展示 全部 / 进行中 / 已完成。
const STATUS_GROUPS = {
  ongoing: ["submitted", "processing", "confirmed", "assigned", "recycling"],
  completed: ["completed"],
};

const STATUS_FILTERS = {
  submitted: ["submitted"],
  processing: ["processing", "confirmed", "assigned", "recycling"],
  completed: ["completed"],
  canceled: ["canceled", "rejected"],
};

const normalizeStatus = (status) => {
  if (["confirmed", "assigned", "recycling"].includes(status)) return "processing";
  if (status === "rejected") return "canceled";
  return status;
};

const getRecycleSettingsData = async () => {
  try {
    const res = await db
      .collection("settings")
      .where({
        key: db.command.in([
          "recycle_rules",
          "recycle_min_weight_kg",
          "recycle_min_count",
          "photo_order_check_min_quantity",
        ]),
      })
      .get();
    const byKey = {};
    res.data.forEach((item) => { byKey[item.key] = item; });
    const data = byKey.recycle_rules || {};
    return {
      ...DEFAULT_RECYCLE_SETTINGS,
      minWeightKg: Number(byKey.recycle_min_weight_kg && byKey.recycle_min_weight_kg.value) || Number(data.minWeightKg) || DEFAULT_RECYCLE_SETTINGS.minWeightKg,
      minCount: Number(byKey.recycle_min_count && byKey.recycle_min_count.value) || Number(data.minCount) || DEFAULT_RECYCLE_SETTINGS.minCount,
      photoOrderCheckMinQuantity: byKey.photo_order_check_min_quantity
        ? String(byKey.photo_order_check_min_quantity.value) === "true" || byKey.photo_order_check_min_quantity.value === true
        : data.photoOrderCheckMinQuantity === true,
    };
  } catch (e) {
    return { ...DEFAULT_RECYCLE_SETTINGS };
  }
};

const getRecycleSettings = async () => {
  const settings = await getRecycleSettingsData();
  return { success: true, data: settings };
};

const getPublicSettings = async () => {
  const defaults = {
    servicePhone: "400-800-1234",
    mapKey: "",
  };
  try {
    const res = await db.collection("settings").where({
      key: db.command.in(["service_phone", "map_key"]),
    }).get();
    const map = {};
    res.data.forEach((item) => { map[item.key] = item.value; });
    return {
      success: true,
      data: {
        servicePhone: map.service_phone || defaults.servicePhone,
        mapKey: map.map_key || defaults.mapKey,
      },
    };
  } catch (e) {
    return { success: true, data: defaults };
  }
};

// 生成订单号：yyyyMMdd + 6位随机。日期部分按北京时间(UTC+8)计算，避免云函数 UTC 时区跨零点出错（R13）
const genOrderNo = () => {
  const bj = new Date(Date.now() + 8 * 3600 * 1000); // 偏移到北京时间
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bj.getUTCDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  return `${y}${m}${d}${rand}`;
};

// 拼接列表摘要 summary（接口契约 4.1 规则）
const buildSummary = (source, items, photos) => {
  if (source === "photo") {
    return `拍照提交 ${(photos || []).length}张`;
  }
  if (source === "general") {
    const categoryName = items && items[0] && items[0].categoryName;
    return `${categoryName || "未指定品类"} · 预约上门回收`;
  }
  // category：items 只有 4 字段不含 unit，按非 0 的量推断单位（estCount 优先表示"件"）
  const list = items || [];
  const first = list[0] || {};
  const isCount = Number(first.estCount) > 0;
  const qty = isCount ? first.estCount : first.estWeight;
  const unit = isCount ? "件" : "kg";
  let s = `${first.categoryName || "回收物"} 约${qty || 0}${unit}`;
  if (list.length > 1) {
    s += ` 等${list.length}类`;
  }
  return s;
};

const getTempUrls = async (fileIDs) => {
  if (!Array.isArray(fileIDs) || fileIDs.length === 0) return [];
  const tmp = await cloud.getTempFileURL({ fileList: fileIDs });
  return tmp.fileList.map((f) => f.tempFileURL).filter(Boolean);
};

const normalizeItem = (item = {}) => ({
  categoryId: item.categoryId || "",
  categoryName: item.categoryName || "",
  estWeight: Number(item.estWeight) || 0,
  estCount: Number(item.estCount) || 0,
});

const meetsMinQuantity = (weight, count, settings) => {
  const needWeight = Number(settings.minWeightKg) > 0;
  const needCount = Number(settings.minCount) > 0;
  if (needWeight && weight >= Number(settings.minWeightKg)) return true;
  if (needCount && count >= Number(settings.minCount)) return true;
  if (!needWeight && !needCount) return true;
  return false;
};

const getBeijingDateString = () => {
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// createOrder — 提交回收订单
const createOrder = async (event, OPENID) => {
  const { source, items, photos, addressId, appointDate, appointSlot, remark } = event;

  // 1. 基础必填校验
  if (
    !["category", "photo", "general"].includes(source) ||
    !addressId ||
    !appointDate ||
    !appointSlot ||
    !/^\d{4}-\d{2}-\d{2}$/.test(appointDate) ||
    appointDate < getBeijingDateString()
  ) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  if (source === "category" && (!Array.isArray(items) || items.length === 0)) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  if (source === "photo" && (!Array.isArray(photos) || photos.length === 0)) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  if (
    (source === "photo" && photos.length > 9) ||
    (source === "general" && Array.isArray(photos) && photos.length > 6)
  ) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }

  try {
    // 2. 校验地址归属并生成快照
    const addrRes = await db
      .collection("addresses")
      .where({ _id: addressId, _openid: OPENID })
      .get();
    if (addrRes.data.length === 0) {
      return { success: false, errMsg: "ADDRESS_NOT_FOUND" };
    }
    const addr = addrRes.data[0];
    if (!addr.phone) {
      return { success: false, errMsg: "PHONE_REQUIRED" };
    }
    const addressSnapshot = {
      contactName: addr.contactName,
      phone: addr.phone,
      region: addr.region,
      detail: addr.detail,
    };

    // 3. 按管理端配置校验最低起收标准，云端校验是最终准入。
    const settings = await getRecycleSettingsData();
    const normalizedItems = ["category", "general"].includes(source)
      ? (Array.isArray(items) ? items : []).map(normalizeItem)
      : [];
    const totalWeight = normalizedItems.reduce(
      (sum, it) => sum + (Number(it.estWeight) || 0),
      0
    );
    const totalCount = normalizedItems.reduce(
      (sum, it) => sum + (Number(it.estCount) || 0),
      0
    );

    if (source === "category") {
      const hasValidItem = normalizedItems.some((it) => it.estWeight > 0 || it.estCount > 0);
      if (!hasValidItem || !meetsMinQuantity(totalWeight, totalCount, settings)) {
        return { success: false, errMsg: "BELOW_MIN_QUANTITY" };
      }
    } else if (settings.photoOrderCheckMinQuantity) {
      const photoWeight = Number(event.estWeight) || 0;
      const photoCount = Number(event.estCount) || 0;
      if (!meetsMinQuantity(photoWeight, photoCount, settings)) {
        return { success: false, errMsg: "BELOW_MIN_QUANTITY" };
      }
    }

    // 4. 组装订单数据
    const now = Date.now();
    const orderNo = genOrderNo();
    const data = {
      _openid: OPENID, // 手动写入归属
      orderNo,
      source,
      summary: buildSummary(source, normalizedItems, photos),
      items: normalizedItems,
      photos: ["photo", "general"].includes(source) && Array.isArray(photos) ? photos : [],
      addressSnapshot,
      appointDate,
      appointSlot,
      remark: remark || "",
      status: "submitted",
      estimatePrice: null,
      finalWeight: null,
      finalCount: null,
      finalPrice: null,
      recyclerId: null,
      recyclerName: "",
      recyclerPhone: "",
      cancelReason: "",
      adminRemark: "",
      transferProofs: [],
      createTime: now,
      updateTime: now,
    };

    const addRes = await db.collection("orders").add({ data });
    return { success: true, data: { _id: addRes._id, orderNo } };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// getOrderList — 我的订单列表（分页 + 四态 status 筛选，兼容旧 statusGroup）
const getOrderList = async (event, OPENID) => {
  const { status, statusGroup, includeCounts } = event;
  let page = parseInt(event.page, 10) || 1;
  let pageSize = parseInt(event.pageSize, 10) || 20;
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = 20;
  if (pageSize > 50) pageSize = 50; // 上限保护

  // 构造查询条件
  // status 支持三种形式：
  //   1) 四态别名: submitted / processing / completed / canceled （见 STATUS_FILTERS）
  //   2) 原始状态字符串: submitted/processing/confirmed/assigned/recycling/completed/canceled/rejected
  //   3) 数组：以上任意组合，取并集
  const ALL_RAW_STATUSES = [
    "submitted",
    "processing",
    "confirmed",
    "assigned",
    "recycling",
    "completed",
    "canceled",
    "rejected",
  ];
  const resolveStatuses = (input) => {
    if (!input) return null;
    const arr = Array.isArray(input) ? input : [input];
    const set = new Set();
    for (const item of arr) {
      if (!item) continue;
      if (STATUS_FILTERS[item]) {
        STATUS_FILTERS[item].forEach((x) => set.add(x));
      } else if (ALL_RAW_STATUSES.includes(item)) {
        set.add(item);
      }
    }
    return set.size ? Array.from(set) : null;
  };

  const where = { _openid: OPENID };
  const statuses = resolveStatuses(status);
  if (statuses) {
    where.status = db.command.in(statuses);
  } else if (statusGroup && STATUS_GROUPS[statusGroup]) {
    where.status = db.command.in(STATUS_GROUPS[statusGroup]);
  }

  try {
    const coll = db.collection("orders");
    const listPromise = coll
      .where(where)
      .orderBy("createTime", "desc")
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .field({
        orderNo: true,
        source: true,
        status: true,
        summary: true,
        items: true,
        addressSnapshot: true,
        appointDate: true,
        appointSlot: true,
        finalWeight: true,
        finalCount: true,
        finalPrice: true,
        cancelReason: true,
        recyclerName: true,
        recyclerPhone: true,
        createTime: true,
        updateTime: true,
      })
      .get();

    // 计数和列表互不依赖，并行执行可省掉一次数据库往返等待。
    const tasks = [coll.where(where).count(), listPromise];
    if (includeCounts) {
      tasks.push(
        coll.where({ _openid: OPENID }).count(),
        coll
          .where({
            _openid: OPENID,
            status: db.command.in(STATUS_GROUPS.ongoing),
          })
          .count(),
        coll.where({ _openid: OPENID, status: "completed" }).count()
      );
    }

    const [countRes, listRes, allRes, ongoingRes, completedRes] = await Promise.all(tasks);
    const total = countRes.total;

    const hasMore = page * pageSize < total;
    const list = listRes.data.map((item) => ({
      ...item,
      status: normalizeStatus(item.status),
    }));
    const data = { list, total, hasMore };
    if (includeCounts) {
      data.counts = {
        all: allRes.total,
        ongoing: ongoingRes.total,
        completed: completedRes.total,
      };
    }
    return { success: true, data };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// getUserSummary — 用户中心只需要数量，不再分别拉取订单列表和完整地址列表。
const getUserSummary = async (event, OPENID) => {
  try {
    const [orderRes, addressRes] = await Promise.all([
      db.collection("orders").where({ _openid: OPENID }).count(),
      db.collection("addresses").where({ _openid: OPENID }).count(),
    ]);
    return {
      success: true,
      data: {
        orderCount: orderRes.total,
        addressCount: addressRes.total,
      },
    };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// getOrderDetail — 订单详情（含 photos 临时 URL）
const getOrderDetail = async (event, OPENID) => {
  const id = event.id;
  if (!id) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }

  try {
    const res = await db
      .collection("orders")
      .where({ _id: id, _openid: OPENID })
      .get();
    if (res.data.length === 0) {
      return { success: false, errMsg: "ORDER_NOT_FOUND" };
    }
    const order = res.data[0];

    const photoUrls = await getTempUrls(order.photos);
    const transferProofUrls = await getTempUrls(order.transferProofs);

    return {
      success: true,
      data: {
        ...order,
        status: normalizeStatus(order.status),
        photoUrls,
        transferProofUrls,
      },
    };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// cancelOrder — 用户取消订单（仅 submitted 可取消）
const cancelOrder = async (event, OPENID) => {
  const id = event.id;
  if (!id) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }

  try {
    const res = await db
      .collection("orders")
      .where({ _id: id, _openid: OPENID })
      .get();
    if (res.data.length === 0) {
      return { success: false, errMsg: "ORDER_NOT_FOUND" };
    }
    const status = normalizeStatus(res.data[0].status);
    if (status !== "submitted") {
      return { success: false, errMsg: "ORDER_STATUS_INVALID" };
    }

    await db
      .collection("orders")
      .where({ _id: id, _openid: OPENID })
      .update({
        data: {
          status: "canceled",
          cancelReason: event.cancelReason || "用户取消",
          canceledAt: Date.now(),
          updateTime: Date.now(),
        },
      });

    return { success: true };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// getTempFileURL — 批量换图片临时链接（可选，前端也可直接 wx.cloud.getTempFileURL）
const getTempFileURL = async (event) => {
  const fileIDs = event.fileIDs;
  if (!Array.isArray(fileIDs) || fileIDs.length === 0) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  try {
    const tmp = await cloud.getTempFileURL({ fileList: fileIDs });
    const data = tmp.fileList.map((f) => ({
      fileID: f.fileID,
      tempFileURL: f.tempFileURL,
    }));
    return { success: true, data };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};



// getHomeBanner — 首页 banner 背景图配置。
// 从 settings 集合读取 key = "home_banner" 的文档（{ imageFileId }），
// 若配置了 fileID 则换取临时 URL 返回，未配置返回 null，前端用 CSS 渐变兜底。
const getHomeBanner = async () => {
  try {
    const res = await db
      .collection("settings")
      .where({ key: "home_banner" })
      .limit(1)
      .get();
    const doc = res.data[0];
    const imageFileId = doc && (doc.value || doc.imageFileId) ? doc.value || doc.imageFileId : null;
    let imageUrl = null;
    if (imageFileId) {
      try {
        const tmp = await cloud.getTempFileURL({ fileList: [imageFileId] });
        imageUrl = (tmp.fileList && tmp.fileList[0] && tmp.fileList[0].tempFileURL) || null;
      } catch (e) {
        imageUrl = null;
      }
    }
    return { success: true, data: { imageFileId, imageUrl } };
  } catch (e) {
    return { success: true, data: { imageFileId: null, imageUrl: null } };
  }
};

// devSeedOrders — ⚠️ 仅供开发期造测试数据用，正式上线前删除本 case！
// 给当前 OPENID 生成若干覆盖各状态的假订单，方便验证列表 / 筛选 / 详情。
// 前端调用示例：wx.cloud.callFunction({ name: "quickstartFunctions",
//   data: { type: "devSeedOrders", count: 6 } })
const devSeedOrders = async (event, OPENID) => {
  const count = Math.min(parseInt(event.count, 10) || 6, 20);
  const statuses = ["submitted", "processing", "confirmed", "assigned", "recycling", "completed", "canceled", "rejected"];
  const now = Date.now();
  const created = [];
  for (let i = 0; i < count; i += 1) {
    const status = statuses[i % statuses.length];
    const isDone = status === "completed";
    const isCanceled = status === "canceled" || status === "rejected";
    const orderNo = genOrderNo();
    const data = {
      _openid: OPENID,
      orderNo,
      source: i % 2 === 0 ? "category" : "photo",
      summary: i % 2 === 0 ? `废纸 约${5 + i}kg` : `拍照提交 ${1 + (i % 3)}张`,
      items: i % 2 === 0
        ? [{ categoryId: "paper", categoryName: "废纸", estWeight: 5 + i, estCount: 0 }]
        : [],
      photos: [],
      addressSnapshot: {
        contactName: "测试用户",
        phone: "13800000000",
        region: "北京市 北京市 朝阳区",
        detail: `测试路 ${i + 1} 号`,
      },
      appointDate: new Date(now + i * 86400000).toISOString().slice(0, 10),
      appointSlot: i % 2 === 0 ? "09:00-12:00" : "14:00-18:00",
      remark: `dev seed #${i}`,
      status,
      estimatePrice: null,
      finalWeight: isDone ? 6 + i : null,
      finalCount: null,
      finalPrice: isDone ? 12 + i * 3 : null,
      recyclerId: null,
      recyclerName: "",
      recyclerPhone: "",
      cancelReason: isCanceled ? (status === "rejected" ? "平台拒单：地址超出服务范围" : "用户取消") : "",
      adminRemark: "",
      transferProofs: [],
      createTime: now - i * 3600000,
      updateTime: now - i * 1800000,
    };
    const res = await db.collection("orders").add({ data });
    created.push({ _id: res._id, orderNo, status });
  }
  return { success: true, data: { created, count: created.length } };
};

module.exports = {
  createOrder,
  getOrderList,
  getUserSummary,
  devSeedOrders,
  getOrderDetail,
  cancelOrder,
  getTempFileURL,
  getRecycleSettings,
  getHomeBanner,
  getPublicSettings,
};
