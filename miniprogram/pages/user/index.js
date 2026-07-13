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
    // 登录草稿：用户选填的头像/昵称，点「微信一键登录」时一并保存
    draftAvatar: "",
    draftNick: "",
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

  // 选择微信头像（chooseAvatar 必须由按钮 open-type 在点击手势里触发）
  onChooseAvatar(e) {
    this.setData({ draftAvatar: e.detail.avatarUrl });
  },

  // 昵称填写（type="nickname" 输入框，blur/input 时取值）
  onNickInput(e) {
    this.setData({ draftNick: e.detail.value });
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

  // 一键登录 + 授权手机号：一个按钮完成所有事。
  // 用户点击 -> 微信弹窗询问是否授权手机号 -> 允许 -> 拿到 code
  //   -> 云函数 getPhoneNumber 解密 -> 同时 fetchOpenid -> 落本地
  async onOneClickLogin(e) {
    if (this.data.loading) return;
    const code = e.detail && e.detail.code;
    if (!code) {
      // 用户在弹窗里点了"拒绝"，或个人主体小程序无权限
      wx.showToast({ title: "已取消授权", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      const [openid, phoneRes] = await Promise.all([
        fetchOpenid(),
        callCloud("getPhoneNumber", { code }, { toast: false }),
      ]);
      if (!phoneRes.ok || !phoneRes.data || !phoneRes.data.phoneNumber) {
        // 手机号拿不到（个人主体 / 权限未开通），仍然按 openid 登录
        saveLoginStatus({ avatarUrl: "", nickName: "" }, openid, null);
        wx.showToast({ title: "登录成功（未获取到手机号）", icon: "none" });
      } else {
        saveLoginStatus(
          { avatarUrl: "", nickName: "" },
          openid,
          phoneRes.data.phoneNumber
        );
        wx.showToast({ title: "登录成功", icon: "success" });
      }
      this.refreshUserInfo();
      this.loadSummary();
    } catch (err) {
      console.error("one-click login failed:", err);
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
