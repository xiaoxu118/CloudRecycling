// 云回收 · 管理后台模块
// B 方案：Web 后台生成登录票据，小程序扫码确认后换取管理 session。
const cloud = require("wx-server-sdk");

const db = cloud.database();
const _ = db.command;

const LOGIN_TICKET_TTL = 5 * 60 * 1000;
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;
const PAGE_SIZE_MAX = 50;

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
  for (const name of ["admins", "admin_login_tickets", "admin_sessions"]) {
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
  let page = parseInt(event.page, 10) || 1;
  let pageSize = parseInt(event.pageSize, 10) || 20;
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = 20;
  if (pageSize > PAGE_SIZE_MAX) pageSize = PAGE_SIZE_MAX;

  const where = {};
  if (status) where.status = status;
  if (keyword) {
    where.orderNo = db.RegExp({ regexp: keyword, options: "i" });
  }

  try {
    const coll = db.collection("orders");
    const countRes = await coll.where(where).count();
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
        addressSnapshot: true,
        appointDate: true,
        appointSlot: true,
        estimatePrice: true,
        finalWeight: true,
        finalPrice: true,
        createTime: true,
        updateTime: true,
      })
      .get();
    return {
      success: true,
      data: {
        list: listRes.data,
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
    let photoUrls = [];
    if (Array.isArray(order.photos) && order.photos.length > 0) {
      const tmp = await cloud.getTempFileURL({ fileList: order.photos });
      photoUrls = tmp.fileList.map((f) => f.tempFileURL);
    }
    return { success: true, data: { ...order, photoUrls } };
  } catch (e) {
    return { success: false, errMsg: "ORDER_NOT_FOUND" };
  }
};

const adminUpdateOrder = async (event) => {
  const auth = await assertAdminSession(event.sessionToken);
  if (!auth.ok) return { success: false, errMsg: auth.errMsg };
  const { id, status } = event;
  if (!id || !status) return { success: false, errMsg: "PARAM_INVALID" };

  const allowStatuses = [
    "submitted",
    "confirmed",
    "assigned",
    "recycling",
    "completed",
    "canceled",
    "rejected",
  ];
  if (!allowStatuses.includes(status)) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }

  const data = {
    status,
    updateTime: Date.now(),
  };
  ["estimatePrice", "finalWeight", "finalPrice"].forEach((key) => {
    if (event[key] !== undefined && event[key] !== "") {
      data[key] = Number(event[key]);
    }
  });
  ["recyclerId", "rejectReason", "adminRemark"].forEach((key) => {
    if (event[key] !== undefined) data[key] = event[key] || "";
  });

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
    return { success: true, data: res.data };
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
};
