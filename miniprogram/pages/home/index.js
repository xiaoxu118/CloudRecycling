// 首页
const { callCloud, getEnvTip, clearEnvTip } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");
const { getCurrentAddress } = require("../../utils/map");

Page({
  data: {
    categories: [],
    showTip: false,
    tipTitle: "",
    tipContent: "",
    locationText: "定位中...",
    fullAddress: "",
    locating: false,
  },

  onShow() {
    this.loadCategories();
    this.loadLocation();
  },

  // 获取当前定位并显示中文地址（左上角）
  async loadLocation() {
    if (this.data.locating) return;
    this.setData({ locating: true });
    try {
      const addr = await getCurrentAddress();
      // 左上角常态显示「市+区」，退化到 province/formatted
      const text =
        [addr.city, addr.district].filter(Boolean).join("") ||
        addr.province ||
        addr.formatted ||
        "未知位置";
      // 完整地址：省市区 + 详细地址，点击时展示
      const full =
        [addr.province, addr.city, addr.district].filter(Boolean).join("") +
          (addr.address || addr.formatted || "") || text;
      this.setData({ locationText: text, fullAddress: full });
    } catch (e) {
      console.warn("loadLocation failed:", e);
      const msg = (e && e.message) || "";
      // 未配置 key 时给出可读提示，其它情况（拒绝授权/失败）显示「点击定位」可重试
      this.setData({
        locationText: msg === "MAP_KEY_NOT_SET" ? "未配置地图Key" : "点击定位",
        fullAddress: "",
      });
    } finally {
      this.setData({ locating: false });
    }
  },

  // 点击左上角地址区：已定位则展示完整地址，未定位则重试
  onTapLocation() {
    if (this.data.fullAddress) {
      wx.showModal({
        title: "当前位置",
        content: this.data.fullAddress,
        showCancel: false,
        confirmText: "知道了",
      });
    } else {
      this.loadLocation();
    }
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