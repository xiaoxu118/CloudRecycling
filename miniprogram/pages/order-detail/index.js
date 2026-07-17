// 订单详情
const { callCloud } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");
const { backOrSwitchTab } = require("../../utils/navigation");

const STATUS_MAP = {
  submitted: { text: "已提交", step: 1 },
  processing: { text: "处理中", step: 2 },
  confirmed: { text: "处理中", step: 2 },
  assigned: { text: "处理中", step: 2 },
  recycling: { text: "处理中", step: 2 },
  completed: { text: "已完成", step: 3 },
  canceled: { text: "已取消", step: 0 },
  rejected: { text: "已取消", step: 0 },
};

const STEPS = ["已提交", "处理中", "已完成"];

Page({
  data: {
    id: "",
    order: null,
    statusText: "",
    step: 0,
    steps: STEPS,
    canCancel: false,
    loading: true,
  },

  onLoad(query) {
    if (!checkLogin()) return;
    
    if (!query.id) {
      wx.showToast({ title: "缺少订单号", icon: "none" });
      this.backTimer = setTimeout(() => backOrSwitchTab("/pages/order-list/index"), 600);
      return;
    }
    this.setData({ id: query.id });
    this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true });
    const res = await callCloud("getOrderDetail", { id: this.data.id });
    if (res.ok) {
      const order = {
        ...res.data,
        completedAtText: this.formatTime(res.data.completedAt),
        canceledAtText: this.formatTime(res.data.canceledAt),
      };
      const hasFinalWeight = order.finalWeight != null && Number(order.finalWeight) > 0;
      const hasFinalCount = order.finalCount != null && Number(order.finalCount) > 0;
      const hasFinalPrice = order.finalPrice != null && Number(order.finalPrice) > 0;
      const hasEstimatePrice = order.estimatePrice != null;
      order.hasAmountInfo = hasEstimatePrice || hasFinalWeight || hasFinalCount || hasFinalPrice;
      order.hasFinalWeight = hasFinalWeight;
      order.hasFinalCount = hasFinalCount;
      order.hasFinalPrice = hasFinalPrice;
      order.hasEstimatePrice = hasEstimatePrice;
      const sm = STATUS_MAP[order.status] || { text: order.status, step: 0 };
      this.setData({
        order,
        statusText: sm.text,
        step: sm.step,
        canCancel: order.status === "submitted",
        loading: false,
      });
    } else {
      this.setData({ loading: false });
      if (res.errMsg === "ORDER_NOT_FOUND") {
        this.backTimer = setTimeout(() => backOrSwitchTab("/pages/order-list/index"), 800);
      }
    }
  },

  onUnload() {
    if (this.backTimer) clearTimeout(this.backTimer);
  },

  previewPhoto(e) {
    const idx = e.currentTarget.dataset.index;
    const urls = this.data.order.photoUrls || [];
    wx.previewImage({ current: urls[idx], urls });
  },

  previewTransfer(e) {
    const idx = e.currentTarget.dataset.index;
    const urls = this.data.order.transferProofUrls || [];
    wx.previewImage({ current: urls[idx], urls });
  },

  formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
  },

  onCancel() {
    wx.showModal({
      title: "取消订单",
      content: "确定取消该订单？",
      success: async (r) => {
        if (!r.confirm) return;
        const res = await callCloud("cancelOrder", { id: this.data.id });
        if (res.ok) {
          wx.showToast({ title: "已取消", icon: "success" });
          this.loadDetail();
        }
      },
    });
  },
});
