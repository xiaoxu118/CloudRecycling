// 我的地址（双模式：管理 / 选择）
const { callCloud } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");

Page({
  data: {
    list: [],
    loading: true,
    selectMode: false,
  },

  onLoad(query) {
    if (!checkLogin()) return;
    this.setData({ selectMode: query.mode === "select" });
  },

  onShow() {
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    const res = await callCloud("getAddressList");
    if (res.ok) {
      this.setData({ list: res.data || [], loading: false });
    } else {
      this.setData({ loading: false });
    }
  },

  onPickAddress(e) {
    if (!this.data.selectMode) return;
    const addr = e.currentTarget.dataset.addr;
    getApp().globalData = getApp().globalData || {};
    getApp().globalData.pickedAddress = addr;
    wx.navigateBack();
  },

  onEdit(e) {
    const addr = e.currentTarget.dataset.addr;
    getApp().globalData = getApp().globalData || {};
    getApp().globalData.editingAddress = addr;
    wx.navigateTo({ url: `/pages/address/edit?id=${addr._id}` });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "提示",
      content: "确定删除该地址？",
      success: async (r) => {
        if (!r.confirm) return;
        const res = await callCloud("deleteAddress", { id });
        if (res.ok) {
          wx.showToast({ title: "已删除", icon: "success" });
          this.loadList();
        }
      },
    });
  },

  onAdd() {
    wx.navigateTo({ url: "/pages/address/edit" });
  },
});