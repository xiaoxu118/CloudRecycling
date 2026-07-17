const { callCloud } = require("../../utils/cloud");
const { backOrSwitchTab } = require("../../utils/navigation");

Page({
  data: {
    ticket: "",
    status: "ready",
    message: "请确认是否登录云回收管理后台",
    openid: "",
  },

  onLoad(options) {
    const ticket = this.parseTicket(options);
    if (!ticket) {
      this.setData({
        status: "error",
        message: "登录二维码无效或已过期",
      });
      return;
    }
    this.setData({ ticket });
  },

  parseTicket(options) {
    if (options.ticket) return options.ticket;
    if (!options.scene) return "";
    const scene = decodeURIComponent(options.scene);
    const pairs = scene.split("&");
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (key === "t") return value || "";
    }
    return "";
  },

  async onConfirm() {
    if (this.data.status === "loading") return;
    this.setData({ status: "loading", message: "正在确认登录..." });
    const res = await callCloud(
      "adminConfirmLoginTicket",
      { ticket: this.data.ticket },
      { toast: false }
    );

    if (res.ok) {
      this.setData({
        status: "success",
        message: "确认成功，请回到电脑端继续操作",
      });
      return;
    }

    if (res.errMsg === "NO_PERMISSION") {
      this.setData({
        status: "error",
        openid: (res.data && res.data.openid) || "",
        message: "当前微信不是管理员，请联系负责人加入管理员白名单",
      });
      return;
    }

    this.setData({
      status: "error",
      message: res.errMsg === "LOGIN_TICKET_EXPIRED" ? "登录二维码已过期" : "确认失败，请重试",
    });
  },

  onCancel() {
    backOrSwitchTab("/pages/home/index");
  },

  onCopyOpenid() {
    if (!this.data.openid) return;
    wx.setClipboardData({ data: this.data.openid });
  },
});
