// 个人中心
const {
  isLoggedIn,
  getUserInfo,
  fetchOpenid,
  saveLoginStatus,
  clearLoginStatus,
} = require("../../utils/auth");
const { callCloud } = require("../../utils/cloud");

Page({
  data: {
    loggedIn: false,
    avatarUrl: "",
    nickName: "",
    loading: false,
    orderCount: 0,
    addressCount: 0,
    phone: "",
    openid: "",
  },

  onShow() {
    this.refreshUserInfo();
    if (isLoggedIn()) {
      this.loadSummary();
    }
  },

  refreshUserInfo() {
    const loggedIn = isLoggedIn();
    const userInfo = getUserInfo();

    if (loggedIn && userInfo) {
      const { getPhone, getOpenid } = require("../../utils/auth");
      this.setData({
        loggedIn: true,
        avatarUrl: userInfo.avatarUrl || "",
        nickName: userInfo.nickName || "",
        phone: getPhone() || "",
        openid: getOpenid() || "",
      });
    } else {
      this.setData({
        loggedIn: false,
        avatarUrl: "",
        nickName: "",
        phone: "",
        openid: "",
      });
    }
  },

  async loadSummary() {
    if (!isLoggedIn()) return;
    const res = await callCloud("getUserSummary", {}, { toast: false });
    if (res.ok && res.data) {
      this.setData({
        orderCount: res.data.orderCount || 0,
        addressCount: res.data.addressCount || 0,
      });
    }
  },

  // 登录后修改头像
  onChangeAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    const { getUserInfo, getOpenid, getPhone, saveLoginStatus } = require("../../utils/auth");
    const info = getUserInfo() || {};
    saveLoginStatus({ ...info, avatarUrl }, getOpenid(), getPhone());
    this.setData({ avatarUrl });
  },

  // 登录后修改昵称（点头像旁边的名字进入编辑）
  onChangeNickInput(e) {
    const nickName = e.detail.value || "";
    const { getUserInfo, getOpenid, getPhone, saveLoginStatus } = require("../../utils/auth");
    const info = getUserInfo() || {};
    saveLoginStatus({ ...info, nickName }, getOpenid(), getPhone());
    this.setData({ nickName });
  },

  // 个人主体可用：由云函数获取可信 OpenID，不依赖手机号授权能力。
  async onWechatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const openid = await fetchOpenid();
      saveLoginStatus({ avatarUrl: "", nickName: "" }, openid, null);
      this.refreshUserInfo();
      await this.loadSummary();
      wx.showToast({ title: "登录成功", icon: "success" });
    } catch (err) {
      console.error("wechat login failed:", err);
      wx.showToast({ title: "登录失败，请重试", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 点 openid 一键复制，方便造数据/排查
  onCopyOpenid() {
    if (!this.data.openid) return;
    wx.setClipboardData({ data: this.data.openid });
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出登录吗？",
      success: (res) => {
        if (res.confirm) {
          clearLoginStatus();
          this.refreshUserInfo();
          wx.showToast({ title: "已退出", icon: "success" });
        }
      },
    });
  },

  goAddress() {
    wx.navigateTo({ url: "/pages/address/list" });
  },

  goOrders() {
    wx.switchTab({ url: "/pages/order-list/index" });
  },

  onAbout() {
    wx.showModal({
      title: "关于云回收",
      content: "云回收 · 让回收更简单。如需帮助请联系平台客服。",
      showCancel: false,
    });
  },
});
