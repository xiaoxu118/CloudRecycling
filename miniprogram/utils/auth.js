const { callCloud } = require("./cloud");

let loginStatus = {
  loggedIn: false,
  userInfo: null,
  openid: null,
  phone: null,
};

const STORAGE_KEY = "recycle_login_info";

const loadLoginStatus = () => {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY);
    if (stored) {
      const info = JSON.parse(stored);
      loginStatus = {
        loggedIn: true,
        userInfo: info.userInfo || null,
        openid: info.openid || null,
        phone: info.phone || null,
      };
    }
  } catch (e) {
    console.error("loadLoginStatus failed:", e);
  }
};

const saveLoginStatus = (userInfo, openid, phone) => {
  const info = { userInfo, openid, phone: phone || null };
  wx.setStorageSync(STORAGE_KEY, JSON.stringify(info));
  loginStatus = { loggedIn: true, userInfo, openid, phone: phone || null };
};

const clearLoginStatus = () => {
  wx.removeStorageSync(STORAGE_KEY);
  loginStatus = { loggedIn: false, userInfo: null, openid: null, phone: null };
};

const isLoggedIn = () => loginStatus.loggedIn;

const getUserInfo = () => loginStatus.userInfo;

const getOpenid = () => loginStatus.openid;

const getPhone = () => loginStatus.phone;

// 仅获取 openid —— 数据隔离鉴权的唯一身份依据，由云函数 getWXContext().OPENID 返回。
// 头像/昵称/手机号由页面通过「填写能力 / getPhoneNumber」单独收集后传入 saveLoginStatus。
const fetchOpenid = async () => {
  const openidRes = await callCloud("getOpenId", {}, { toast: false });
  if (!openidRes.ok || !openidRes.data || !openidRes.data.openid) {
    throw new Error("获取用户身份失败");
  }
  return openidRes.data.openid;
};

const checkLogin = (options = {}) => {
  const { redirect = true, showToast = true } = options;

  if (!loginStatus.loggedIn) {
    if (showToast) {
      wx.showToast({ title: "请先登录", icon: "none" });
    }
    if (redirect) {
      setTimeout(() => {
        wx.switchTab({ url: "/pages/user/index" });
      }, 800);
    }
    return false;
  }
  return true;
};

// 启动时静默拉 openid：
// - 若本地已有登录态但 openid 缺失，补一次
// - 若本地没登录态，也预热一次云函数身份（可用于埋点/预请求）
const ensureOpenid = async () => {
  if (loginStatus.openid) return loginStatus.openid;
  const openid = await fetchOpenid();
  if (loginStatus.loggedIn) {
    saveLoginStatus(loginStatus.userInfo, openid, loginStatus.phone);
  } else {
    loginStatus.openid = openid;
  }
  return openid;
};

module.exports = {
  ensureOpenid,
  loadLoginStatus,
  saveLoginStatus,
  clearLoginStatus,
  isLoggedIn,
  getUserInfo,
  getOpenid,
  getPhone,
  fetchOpenid,
  checkLogin,
};