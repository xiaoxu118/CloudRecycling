// 云回收 · 订单模块（核心）
// 对应接口契约：4.1 createOrder、4.2 getOrderList、4.3 getOrderDetail、4.4 cancelOrder、4.5 getTempFileURL
// 待办：R13 订单号规则+时区、R15 幂等（前端按钮防抖为主）
const cloud = require("wx-server-sdk");

const db = cloud.database();

const DEFAULT_SETTINGS = {
  key: "recycle_rules",
  minWeightKg: 5,
  minCount: 0,
  photoOrderCheckMinQuantity: false,
};

// 进行中 / 已结束 状态分组（对应列表 tab）
const STATUS_GROUPS = {
  ongoing: ["submitted", "processing", "confirmed", "assigned", "recycling"],
  done: ["completed", "canceled", "rejected"],
};

const LEGACY_STATUS_MAP = {
  confirmed: "processing",
  assigned: "processing",
  recycling: "processing",
  rejected: "canceled",
};

const normalizeStatus = (status) => LEGACY_STATUS_MAP[status] || status;

const getRecycleSettings = async () => {
  try {
    const result = await db.collection("settings").where({ key: "recycle_rules" }).limit(1).get();
    return { success: true, data: result.data[0] ? { ...DEFAULT_SETTINGS, ...result.data[0] } : { ...DEFAULT_SETTINGS } };
  } catch (e) {
    return { success: true, data: { ...DEFAULT_SETTINGS } };
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

// createOrder — 提交回收订单
const createOrder = async (event, OPENID) => {
  const { source, items, photos, addressId, appointDate, appointSlot, remark } = event;

  // 1. 基础必填校验
  if (
    (source !== "category" && source !== "photo") ||
    !addressId ||
    !appointDate ||
    !appointSlot
  ) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  if (source === "category" && (!Array.isArray(items) || items.length === 0)) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  if (source === "photo" && (!Array.isArray(photos) || photos.length === 0)) {
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
    const addressSnapshot = {
      contactName: addr.contactName,
      phone: addr.phone,
      region: addr.region,
      detail: addr.detail,
    };

    // 3. source=category 根据管理端配置校验最低起收量。
    if (source === "category") {
      const settingsResult = await getRecycleSettings();
      const settings = settingsResult.data;
      const totalWeight = items.reduce(
        (sum, it) => sum + (Number(it.estWeight) || 0),
        0
      );
      const totalCount = items.reduce(
        (sum, it) => sum + (Number(it.estCount) || 0),
        0
      );
      const weightEnabled = Number(settings.minWeightKg) > 0;
      const countEnabled = Number(settings.minCount) > 0;
      const weightPassed = weightEnabled && totalWeight >= Number(settings.minWeightKg);
      const countPassed = countEnabled && totalCount >= Number(settings.minCount);
      // 当两个阈值同时开启时，重量或件数任一达标即可提交。
      if ((weightEnabled || countEnabled) && !(weightPassed || countPassed)) {
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
      summary: buildSummary(source, items, photos),
      items: source === "category" ? items : [],
      photos: source === "photo" ? photos : [],
      addressSnapshot,
      appointDate,
      appointSlot,
      remark: remark || "",
      status: "submitted",
      estimatePrice: null,
      finalWeight: null,
      finalCount: null,
      finalPrice: null,
      recyclerName: "",
      recyclerPhone: "",
      transferProofs: [],
      cancelReason: "",
      adminRemark: "",
      createTime: now,
      updateTime: now,
    };

    const addRes = await db.collection("orders").add({ data });
    return { success: true, data: { _id: addRes._id, orderNo } };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// getOrderList — 我的订单列表（分页 + statusGroup 筛选）
const getOrderList = async (event, OPENID) => {
  const { statusGroup } = event;
  let page = parseInt(event.page, 10) || 1;
  let pageSize = parseInt(event.pageSize, 10) || 20;
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = 20;
  if (pageSize > 50) pageSize = 50; // 上限保护

  // 构造查询条件
  const where = { _openid: OPENID };
  if (statusGroup && STATUS_GROUPS[statusGroup]) {
    where.status = db.command.in(STATUS_GROUPS[statusGroup]);
  }

  try {
    const coll = db.collection("orders");
    const countRes = await coll.where(where).count();
    const total = countRes.total;

    const listRes = await coll
      .where(where)
      .orderBy("createTime", "desc")
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .field({
        orderNo: true,
        source: true,
        status: true,
        summary: true,
        appointDate: true,
        appointSlot: true,
        createTime: true,
      })
      .get();

    const hasMore = page * pageSize < total;
    return {
      success: true,
      data: {
        list: listRes.data.map((item) => ({ ...item, status: normalizeStatus(item.status) })),
        total,
        hasMore,
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

    // 把 photos 的 fileID 批量换成临时 URL
    const resolveUrls = async (fileList) => {
      if (!Array.isArray(fileList) || fileList.length === 0) return [];
      const tmp = await cloud.getTempFileURL({ fileList });
      return tmp.fileList.map((f) => f.tempFileURL || "");
    };
    const [photoUrls, transferProofUrls] = await Promise.all([
      resolveUrls(order.photos),
      resolveUrls(order.transferProofs),
    ]);

    return {
      success: true,
      data: { ...order, status: normalizeStatus(order.status), photoUrls, transferProofUrls },
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
    const status = res.data[0].status;
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

module.exports = {
  createOrder,
  getOrderList,
  getOrderDetail,
  cancelOrder,
  getTempFileURL,
  getRecycleSettings,
};
