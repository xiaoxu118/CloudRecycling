// 云回收 · 管理后台模块
// B 方案：Web 后台生成登录票据，小程序扫码确认后换取管理 session。
const cloud = require("wx-server-sdk");

const db = cloud.database();
const _ = db.command;

const LOGIN_TICKET_TTL = 5 * 60 * 1000;
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;
const PAGE_SIZE_MAX = 50;
// 临时开发开关：开启后所有管理接口跳过管理员 Session 校验。
// ⚠️ 维护完成后必须改回 false，并重新部署云函数。
const DEV_BYPASS_ADMIN_AUTH = true;
const DEFAULT_RECYCLE_SETTINGS = {
  minWeightKg: 5,
  minCount: 0,
  photoOrderCheckMinQuantity: false,
};

const normalizeStatus = (status) => {
  if (["confirmed", "assigned", "recycling"].includes(status)) return "processing";
  if (status === "rejected") return "canceled";
  return status;
};

const getTempUrls = async (fileIDs) => {
  if (!Array.isArray(fileIDs) || fileIDs.length === 0) return [];
  const tmp = await cloud.getTempFileURL({ fileList: fileIDs });
  return tmp.fileList.map((f) => f.tempFileURL).filter(Boolean);
};

const randomId = (prefix = "") => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 24; i += 1) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}${s}`;
};

const ensureCollection = async (name) => {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 集合已存在时忽略。
  }
};

const getAdminByOpenid = async (openid) => {
  if (!openid) return null;
  const res = await db
    .collection("admins")
    .where({ openid, enabled: true })
    .limit(1)
    .get();
  return res.data[0] || null;
};

const assertAdminSession = async (sessionToken) => {
  if (DEV_BYPASS_ADMIN_AUTH) {
    return {
      ok: true,
      admin: { name: "临时开发管理员", role: "admin" },
      session: null,
    };
  }
  if (!sessionToken) {
    return { ok: false, errMsg: "ADMIN_SESSION_REQUIRED" };
  }
  const now = Date.now();
  const res = await db
    .collection("admin_sessions")
    .where({ token: sessionToken, expiresAt: _.gt(now) })
    .limit(1)
    .get();
  const session = res.data[0];
  if (!session) {
    return { ok: false, errMsg: "ADMIN_SESSION_EXPIRED" };
  }
  const admin = await getAdminByOpenid(session.openid);
  if (!admin) {
    return { ok: false, errMsg: "NO_PERMISSION" };
  }
  return { ok: true, admin, session };
};

const initAdminCollections = async () => {
  for (const name of ["admins", "admin_login_tickets", "admin_sessions", "settings"]) {
    await ensureCollection(name);
  }
  return { success: true };
};

const adminCreateLoginTicket = async () => {
  try {
    await initAdminCollections();
    const ticket = randomId("t_");
    const webNonce = randomId("n_");
    const now = Date.now();
    const expiresAt = now + LOGIN_TICKET_TTL;
    const page = "pages/admin-login/index";

    await db.collection("admin_login_tickets").add({
      data: {
        ticket,
        webNonce,
        status: "pending",
        createTime: now,
        expiresAt,
      },
    });

    const data = {
      ticket,
      webNonce,
      page,
      path: `/${page}?ticket=${ticket}`,
      expiresAt,
      qrFileID: "",
      qrUrl: "",
    };

    try {
      const codeRes = await cloud.openapi.wxacode.getUnlimited({
        scene: `t=${ticket}`,
        page,
        checkPath: false,
      });
      const upload = await cloud.uploadFile({
        cloudPath: `admin-login/${ticket}.png`,
        fileContent: codeRes.buffer,
      });
      const tmp = await cloud.getTempFileURL({ fileList: [upload.fileID] });
      data.qrFileID = upload.fileID;
      data.qrUrl = (tmp.fileList[0] && tmp.fileList[0].tempFileURL) || "";
    } catch (e) {
      // 小程序未发布、openapi 权限未配置时可能失败；返回 path 便于开发者工具手动打开页面测试。
      data.qrError = "WXACODE_CREATE_FAILED";
    }

    return { success: true, data };
  } catch (e) {
    console.error("adminCreateLoginTicket failed:", e);
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminConfirmLoginTicket = async (event, OPENID) => {
  const { ticket } = event;
  if (!ticket) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  try {
    await initAdminCollections();
    const admin = await getAdminByOpenid(OPENID);
    if (!admin) {
      return { success: false, errMsg: "NO_PERMISSION", data: { openid: OPENID } };
    }

    const now = Date.now();
    const res = await db
      .collection("admin_login_tickets")
      .where({ ticket, status: "pending", expiresAt: _.gt(now) })
      .limit(1)
      .get();
    if (res.data.length === 0) {
      return { success: false, errMsg: "LOGIN_TICKET_EXPIRED" };
    }

    const sessionToken = randomId("s_");
    const expiresAt = now + ADMIN_SESSION_TTL;
    await db.collection("admin_sessions").add({
      data: {
        token: sessionToken,
        openid: OPENID,
        adminName: admin.name || "",
        role: admin.role || "admin",
        createTime: now,
        expiresAt,
      },
    });
    await db
      .collection("admin_login_tickets")
      .where({ ticket })
      .update({
        data: {
          status: "confirmed",
          openid: OPENID,
          adminName: admin.name || "",
          sessionToken,
          confirmedAt: now,
        },
      });

    return { success: true, data: { adminName: admin.name || "管理员" } };
  } catch (e) {
    console.error("adminConfirmLoginTicket failed:", e);
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminCheckLoginTicket = async (event) => {
  const { ticket, webNonce } = event;
  if (!ticket || !webNonce) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  try {
    const now = Date.now();
    const res = await db
      .collection("admin_login_tickets")
      .where({ ticket })
      .limit(1)
      .get();
    const item = res.data[0];
    if (!item) {
      return { success: false, errMsg: "LOGIN_TICKET_EXPIRED" };
    }
    if (item.webNonce !== webNonce) {
      return { success: false, errMsg: "NO_PERMISSION" };
    }
    if (item.expiresAt <= now && item.status === "pending") {
      return { success: false, errMsg: "LOGIN_TICKET_EXPIRED" };
    }
    if (item.status !== "confirmed") {
      return { success: true, data: { status: item.status } };
    }
    return {
      success: true,
      data: {
        status: "confirmed",
        sessionToken: item.sessionToken,
        adminName: item.adminName || "管理员",
      },
    };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminListOrders = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };

  const status = event.status || "";
  const keyword = (event.keyword || "").trim();
  const sortField = event.sortField === "updateTime" ? "updateTime" : "createTime";
  const sortOrder = event.sortOrder === "asc" ? "asc" : "desc";
  let page = parseInt(event.page, 10) || 1;
  let pageSize = parseInt(event.pageSize, 10) || 20;
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = 20;
  if (pageSize > PAGE_SIZE_MAX) pageSize = PAGE_SIZE_MAX;

  const conditions = [];
  if (status === "processing") {
    conditions.push({ status: _.in(["processing", "confirmed", "assigned", "recycling"]) });
  } else if (status === "canceled") {
    conditions.push({ status: _.in(["canceled", "rejected"]) });
  } else if (status) {
    conditions.push({ status });
  }
  const statusWhere = conditions[0] || {};
  const where = statusWhere;

  try {
    const coll = db.collection("orders");
    const listFields = {
      orderNo: true,
      source: true,
      status: true,
      summary: true,
      remark: true,
      adminRemark: true,
      addressSnapshot: true,
      appointDate: true,
      appointSlot: true,
      estimatePrice: true,
      finalWeight: true,
      finalPrice: true,
      createTime: true,
      updateTime: true,
    };

    // CloudBase 对嵌套字段 + RegExp + OR 的组合查询在部分环境中匹配不稳定。
    // 管理端有关键词时先按状态读取订单，再在云函数内对统一文本做包含匹配，
    // 保证 addressSnapshot.contactName / phone 等嵌套字段可以正常搜索。
    if (keyword) {
      const countRes = await coll.where(statusWhere).count();
      const all = [];
      const batchSize = 100;
      for (let skip = 0; skip < countRes.total; skip += batchSize) {
        const batch = await coll
          .where(statusWhere)
          .orderBy(sortField, sortOrder)
          .skip(skip)
          .limit(batchSize)
          .field(listFields)
          .get();
        all.push(...batch.data);
      }
      const normalizeSearchText = (value) =>
        String(value || "")
          .normalize("NFKC")
          .replace(/[\s\-—_()（）]/g, "")
          .toLowerCase();
      const needle = normalizeSearchText(keyword);
      const matched = all.filter((item) => {
        const address = item.addressSnapshot || {};
        return [
          item.orderNo,
          item.summary,
          item.remark,
          item.adminRemark,
          address.contactName,
          address.phone,
          item.contactName,
          item.phone,
        ].some((value) => normalizeSearchText(value).includes(needle));
      });
      const start = (page - 1) * pageSize;
      return {
        success: true,
        data: {
          list: matched.slice(start, start + pageSize).map((item) => ({
            ...item,
            status: normalizeStatus(item.status),
          })),
          total: matched.length,
          hasMore: start + pageSize < matched.length,
          searchMeta: {
            version: "contact-search-v3",
            scanned: all.length,
            matched: matched.length,
          },
        },
      };
    }

    const listPromise = coll
      .where(where)
      .orderBy(sortField, sortOrder)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .field(listFields)
      .get();
    const [countRes, listRes] = await Promise.all([
      coll.where(where).count(),
      listPromise,
    ]);
    const list = listRes.data.map((item) => ({
      ...item,
      status: normalizeStatus(item.status),
    }));
    return {
      success: true,
      data: {
        list,
        total: countRes.total,
        hasMore: page * pageSize < countRes.total,
      },
    };
  } catch (e) {
    console.error("adminListOrders failed:", e);
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminGetOrderDetail = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  if (!event.id) return { success: false, errMsg: "PARAM_INVALID" };

  try {
    const res = await db.collection("orders").doc(event.id).get();
    const order = res.data;
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
    return { success: false, errMsg: "ORDER_NOT_FOUND" };
  }
};

const adminUpdateOrder = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  const { id, status } = event;
  if (!id || !status) return { success: false, errMsg: "PARAM_INVALID" };

  const allowStatuses = ["submitted", "processing", "completed", "canceled"];
  if (!allowStatuses.includes(status)) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }

  const transferProofs = Array.isArray(event.transferProofs) ? event.transferProofs : [];
  const cancelReason = (event.cancelReason || event.rejectReason || "").trim();

  if (status === "canceled" && !cancelReason) {
    return { success: false, errMsg: "CANCEL_REASON_REQUIRED" };
  }

  const data = {
    status,
    updateTime: Date.now(),
  };
  ["estimatePrice", "finalWeight", "finalCount", "finalPrice"].forEach((key) => {
    if (event[key] !== undefined && event[key] !== "") {
      data[key] = Number(event[key]);
    }
  });
  ["recyclerId", "recyclerName", "recyclerPhone", "adminRemark"].forEach((key) => {
    if (event[key] !== undefined) data[key] = event[key] || "";
  });
  if (event.transferProofs !== undefined) data.transferProofs = transferProofs;
  if (cancelReason) data.cancelReason = cancelReason;
  if (status === "completed") data.completedAt = Date.now();
  if (status === "canceled") data.canceledAt = Date.now();

  try {
    await db.collection("orders").doc(id).update({ data });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminListCategories = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  try {
    const res = await db.collection("categories").orderBy("sortOrder", "asc").get();
    const fileIds = [...new Set(res.data.map((item) => item.iconFileId).filter(Boolean))];
    const urlMap = {};
    if (fileIds.length) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: fileIds });
        (tempRes.fileList || []).forEach((item) => {
          urlMap[item.fileID] = item.tempFileURL || "";
        });
      } catch (e) {
        // 保留品类数据，失效图标由管理端显示为未配置。
      }
    }
    return {
      success: true,
      data: res.data.map((item) => ({
        ...item,
        iconImageUrl: item.iconFileId ? urlMap[item.iconFileId] || "" : "",
      })),
    };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminSaveCategory = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  const c = event.category || {};
  if (!c.name || !c.unit) return { success: false, errMsg: "PARAM_INVALID" };

  const data = {
    name: c.name,
    unit: c.unit,
    priceRef: c.priceRef || "",
    icon: c.icon || "",
    iconFileId: c.iconFileId || "",
    sortOrder: Number(c.sortOrder) || 0,
    enabled: c.enabled !== false,
  };

  try {
    if (c._id) {
      await db.collection("categories").doc(c._id).update({ data });
      return { success: true, data: { _id: c._id } };
    }
    const addRes = await db.collection("categories").add({ data });
    return { success: true, data: { _id: addRes._id } };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminGetSettings = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  try {
    const [rulesRes, bannerRes] = await Promise.all([
      db.collection("settings").where({ key: "recycle_rules" }).limit(1).get(),
      db.collection("settings").where({ key: "home_banner" }).limit(1).get(),
    ]);
    const data = rulesRes.data[0] || {};
    const banner = bannerRes.data[0] || {};
    let bannerImageUrl = "";
    if (banner.imageFileId) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [banner.imageFileId] });
        bannerImageUrl =
          (tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL) || "";
      } catch (e) {
        bannerImageUrl = "";
      }
    }
    return {
      success: true,
      data: {
        ...DEFAULT_RECYCLE_SETTINGS,
        minWeightKg: Number(data.minWeightKg) || DEFAULT_RECYCLE_SETTINGS.minWeightKg,
        minCount: Number(data.minCount) || DEFAULT_RECYCLE_SETTINGS.minCount,
        photoOrderCheckMinQuantity: data.photoOrderCheckMinQuantity === true,
        bannerImageFileId: banner.imageFileId || "",
        bannerImageUrl,
      },
    };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminSaveSettings = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  const settings = event.settings || {};
  const now = Date.now();
  const data = {
    key: "recycle_rules",
    minWeightKg: Number(settings.minWeightKg) || DEFAULT_RECYCLE_SETTINGS.minWeightKg,
    minCount: Number(settings.minCount) || 0,
    photoOrderCheckMinQuantity: settings.photoOrderCheckMinQuantity === true,
    updateTime: now,
  };
  try {
    const res = await db
      .collection("settings")
      .where({ key: "recycle_rules" })
      .limit(1)
      .get();
    if (res.data[0]) {
      await db.collection("settings").doc(res.data[0]._id).update({ data });
    } else {
      await db.collection("settings").add({ data: { ...data, createTime: now } });
    }
    if (settings.bannerImageFileId !== undefined) {
      const bannerData = {
        key: "home_banner",
        imageFileId: settings.bannerImageFileId || "",
        updateTime: now,
      };
      const bannerRes = await db
        .collection("settings")
        .where({ key: "home_banner" })
        .limit(1)
        .get();
      if (bannerRes.data[0]) {
        await db.collection("settings").doc(bannerRes.data[0]._id).update({ data: bannerData });
      } else {
        await db.collection("settings").add({ data: { ...bannerData, createTime: now } });
      }
    }
    return { success: true, data };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const SETTING_TYPES = ["text", "number", "boolean", "image"];

const adminListSystemSettings = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  try {
    const res = await db.collection("settings").orderBy("key", "asc").get();
    const legacyRules = res.data.find((item) => item.key === "recycle_rules") || {};
    const rows = res.data.filter((item) => item.key !== "recycle_rules").map((item) => ({
      ...item,
      value: String(item.value !== undefined ? item.value : item.imageFileId || ""),
      type: item.type || (item.key === "home_banner" ? "image" : "text"),
      label: item.label || (item.key === "home_banner" ? "首页 Banner" : item.key),
      description: item.description || "",
    }));
    const defaults = [
      { key: "home_banner", label: "首页 Banner", type: "image", value: "", description: "小程序首页顶部背景图" },
      { key: "service_phone", label: "客服电话", type: "text", value: "400-800-1234", description: "首页展示及拨打的客服电话" },
      { key: "map_key", label: "腾讯地图 Key", type: "text", value: "", description: "腾讯位置服务 WebService Key" },
      { key: "recycle_min_weight_kg", label: "最低起收重量", type: "number", value: String(legacyRules.minWeightKg || 5), description: "单位：kg" },
      { key: "recycle_min_count", label: "最低起收件数", type: "number", value: String(legacyRules.minCount || 0), description: "设置为 0 表示不限制件数" },
      { key: "photo_order_check_min_quantity", label: "拍照订单校验起收量", type: "boolean", value: String(legacyRules.photoOrderCheckMinQuantity === true), description: "true 开启，false 关闭" },
    ];
    defaults.forEach((item) => {
      if (!rows.some((row) => row.key === item.key)) rows.push({ ...item, _id: `virtual:${item.key}` });
    });
    rows.sort((a, b) => a.key.localeCompare(b.key));
    const imageIds = rows.filter((item) => item.type === "image" && item.value).map((item) => item.value);
    const urlMap = {};
    if (imageIds.length) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: imageIds });
        (tempRes.fileList || []).forEach((item) => {
          urlMap[item.fileID] = item.tempFileURL || "";
        });
      } catch (e) {}
    }
    return {
      success: true,
      data: rows.map((item) => ({ ...item, imageUrl: item.type === "image" ? urlMap[item.value] || "" : "" })),
    };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

const adminSaveSystemSetting = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  const setting = event.setting || {};
  const key = String(setting.key || "").trim();
  const type = SETTING_TYPES.includes(setting.type) ? setting.type : "text";
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) {
    return { success: false, errMsg: "SETTING_KEY_INVALID" };
  }
  const now = Date.now();
  const value = String(setting.value === undefined ? "" : setting.value);
  const data = {
    key,
    value,
    type,
    label: String(setting.label || key).trim(),
    description: String(setting.description || "").trim(),
    updateTime: now,
  };
  if (key === "home_banner") data.imageFileId = data.value;
  try {
    const res = await db.collection("settings").where({ key }).limit(1).get();
    if (res.data[0]) {
      await db.collection("settings").doc(res.data[0]._id).update({ data });
    } else {
      await db.collection("settings").add({ data: { ...data, createTime: now } });
    }
    return { success: true, data };
  } catch (e) {
    console.error("adminSaveSystemSetting failed:", { key, type, error: e });
    return {
      success: false,
      errMsg: "SETTING_SAVE_FAILED",
      data: {
        message: e && (e.errMsg || e.message) ? e.errMsg || e.message : "数据库写入失败",
      },
    };
  }
};

const adminDeleteSystemSetting = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  if (!event.id) return { success: false, errMsg: "PARAM_INVALID" };
  try {
    await db.collection("settings").doc(event.id).remove();
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

module.exports = {
  initAdminCollections,
  adminCreateLoginTicket,
  adminConfirmLoginTicket,
  adminCheckLoginTicket,
  adminListOrders,
  adminGetOrderDetail,
  adminUpdateOrder,
  adminListCategories,
  adminSaveCategory,
  adminGetSettings,
  adminSaveSettings,
  adminListSystemSettings,
  adminSaveSystemSetting,
  adminDeleteSystemSetting,
};
