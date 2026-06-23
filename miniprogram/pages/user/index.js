// 个人中心
const {
  isLoggedIn,
  getUserInfo,
  fetchOpenid,
  saveLoginStatus,
  clearLoginStatus,
} = require("../../utils/auth");

Page({
  data: {
    loggedIn: false,
    avatarUrl: "",
    nickName: "",
    loading: false,
    // 登录草稿：用户选填的头像/昵称，点「微信一键登录」时一并保存
    draftAvatar: "",
    draftNick: "",
  },

  onShow() {
    this.refreshUserInfo();
  },

  refreshUserInfo() {
    const loggedIn = isLoggedIn();
    const userInfo = getUserInfo();

    if (loggedIn && userInfo) {
      this.setData({
        loggedIn: true,
        avatarUrl: userInfo.avatarUrl || "",
        nickName: userInfo.nickName || "",
      });
    } else {
      this.setData({
        loggedIn: false,
        avatarUrl: "",
        nickName: "",
      });
    }
  },

  // 选择微信头像（chooseAvatar 必须由按钮 open-type 在点击手势里触发）
  onChooseAvatar(e) {
    this.setData({ draftAvatar: e.detail.avatarUrl });
  },

  // 昵称填写（type="nickname" 输入框，blur/input 时取值）
  onNickInput(e) {
    this.setData({ draftNick: e.detail.value });
  },

  // 一键登录：openid 为鉴权核心，头像/昵称为用户选填资料
  async onLogin() {
    if (this.data.loading) return;

    this.setData({ loading: true });
    try {
      const openid = await fetchOpenid();
      const userInfo = {
        avatarUrl: this.data.draftAvatar || "",
        nickName: this.data.draftNick || "微信用户",
      };
      saveLoginStatus(userInfo, openid, null);
      wx.showToast({ title: "登录成功", icon: "success" });
      this.refreshUserInfo();
    } catch (e) {
      console.error("login failed:", e);
      wx.showToast({ title: "登录失败，请重试", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出登录吗？",
      success: (res) => {
        if (res.confirm) {
          clearLoginStatus();
          this.setData({ draftAvatar: "", draftNick: "" });
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
