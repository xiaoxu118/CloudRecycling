// 云回收 · 订单模块（核心）
// 对应接口契约：4.1 createOrder、4.2 getOrderList、4.3 getOrderDetail、4.4 cancelOrder、4.5 getTempFileURL
// 待办：R13 订单号规则+时区、R15 幂等（前端按钮防抖为主）
const cloud = require("wx-server-sdk");

const db = cloud.database();

// 最低起收量阈值（Q2 待平台确认，默认总重量 ≥ 5kg）
const MIN_WEIGHT_KG = 5;

// 进行中 / 已结束 状态分组（对应列表 tab）
const STATUS_GROUPS = {
  ongoing: ["submitted", "confirmed", "assigned", "recycling"],
  done: ["completed", "canceled", "rejected"],
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

    // 3. source=category 校验最低起收量（按 kg 汇总；件数类不计入重量阈值）
    if (source === "category") {
      const totalWeight = items.reduce(
        (sum, it) => sum + (Number(it.estWeight) || 0),
        0
      );
      if (totalWeight < MIN_WEIGHT_KG) {
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
      finalPrice: null,
      recyclerId: null,
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
    return { success: true, data: { list: listRes.data, total, hasMore } };
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
    let photoUrls = [];
    if (Array.isArray(order.photos) && order.photos.length > 0) {
      const tmp = await cloud.getTempFileURL({ fileList: order.photos });
      photoUrls = tmp.fileList.map((f) => f.tempFileURL);
    }

    return { success: true, data: { ...order, photoUrls } };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// cancelOrder — 用户取消订单（仅 submitted/confirmed 可取消）
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
    if (status !== "submitted" && status !== "confirmed") {
      return { success: false, errMsg: "ORDER_STATUS_INVALID" };
    }

    await db
      .collection("orders")
      .where({ _id: id, _openid: OPENID })
      .update({ data: { status: "canceled", updateTime: Date.now() } });

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
};
