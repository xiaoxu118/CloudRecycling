// 订单详情
const { callCloud } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");

const STATUS_MAP = {
  submitted: { text: "已提交，等待确认", step: 1 },
  confirmed: { text: "已确认，等待上门", step: 2 },
  assigned: { text: "回收员处理中", step: 3 },
  recycling: { text: "回收员处理中", step: 3 },
  completed: { text: "已完成", step: 4 },
  canceled: { text: "已取消", step: 0 },
  rejected: { text: "暂不可回收", step: 0 },
};

const STEPS = ["已提交", "已确认", "上门回收", "已完成"];

Page({
  data: {
    id: "",
    order: null,
    statusText: "",
    step: 0,
    steps: STEPS,
    canCancel: false,
    isPhoto: false,
    loading: true,
  },

  onLoad(query) {
    if (!checkLogin()) return;
    
    if (!query.id) {
      wx.showToast({ title: "缺少订单号", icon: "none" });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ id: query.id });
    this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true });
    const res = await callCloud("getOrderDetail", { id: this.data.id });
    if (res.ok) {
      const order = res.data;
      const sm = STATUS_MAP[order.status] || { text: order.status, step: 0 };
      this.setData({
        order,
        statusText: sm.text,
        step: sm.step,
        canCancel: order.status === "submitted" || order.status === "confirmed",
        isPhoto: order.source === "photo",
        loading: false,
      });
    } else {
      this.setData({ loading: false });
      if (res.errMsg === "ORDER_NOT_FOUND") {
        setTimeout(() => wx.navigateBack(), 800);
      }
    }
  },

  previewPhoto(e) {
    const idx = e.currentTarget.dataset.index;
    const urls = this.data.order.photoUrls || [];
    wx.previewImage({ current: urls[idx], urls });
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