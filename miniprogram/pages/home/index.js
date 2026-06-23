// 首页
const { callCloud, getEnvTip, clearEnvTip } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");

Page({
  data: {
    categories: [],
    showTip: false,
    tipTitle: "",
    tipContent: "",
  },

  onShow() {
    this.loadCategories();
  },

  async loadCategories() {
    const res = await callCloud("listCategories", {}, { toast: false });
    if (res.ok) {
      this.setData({ categories: res.data.slice(0, 5) });
    } else {
      const tip = getEnvTip();
      if (tip.show) {
        this.setData({
          showTip: true,
          tipTitle: tip.title,
          tipContent: tip.content,
        });
        clearEnvTip();
      }
    }
  },

  goCategory() {
    if (!checkLogin()) return;
    wx.navigateTo({ url: "/pages/category/index" });
  },

  goPhoto() {
    if (!checkLogin()) return;
    wx.navigateTo({ url: "/pages/order-create/index?source=photo" });
  },

  goOrderList() {
    if (!checkLogin()) return;
    wx.switchTab({ url: "/pages/order-list/index" });
  },

  onCloseTip() {
    this.setData({ showTip: false });
  },
});