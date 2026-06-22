// 首页
const { callCloud, getEnvTip, clearEnvTip } = require("../../utils/cloud");

Page({
  data: {
    categories: [], // 热门品类（可选展示）
    showTip: false,
    tipTitle: "",
    tipContent: "",
  },

  onShow() {
    this.loadCategories();
  },

  // 加载品类（首页只展示部分，接口失败不阻塞静态入口）
  async loadCategories() {
    const res = await callCloud("listCategories", {}, { toast: false });
    if (res.ok) {
      this.setData({ categories: res.data.slice(0, 5) });
    } else {
      // 平台级错误（环境/部署）通过弹窗提示
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

  // 按品类预约
  goCategory() {
    wx.navigateTo({ url: "/pages/category/index" });
  },

  // 拍照提交
  goPhoto() {
    wx.navigateTo({ url: "/pages/order-create/index?source=photo" });
  },

  // 我的订单
  goOrderList() {
    wx.switchTab({ url: "/pages/order-list/index" });
  },

  onCloseTip() {
    this.setData({ showTip: false });
  },
});
