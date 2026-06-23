// 品类列表（支持多选）
const { callCloud } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");

Page({
  data: {
    categories: [],
    loading: true,
    selectedCount: 0,
  },

  onLoad() {
    if (!checkLogin()) return;
    this.loadCategories();
  },

  async loadCategories() {
    this.setData({ loading: true });
    const res = await callCloud("listCategories");
    if (res.ok) {
      const categories = (res.data || []).map((c) => ({ ...c, selected: false }));
      this.setData({ categories, loading: false });
    } else {
      this.setData({ loading: false });
    }
  },

  toggleSelect(e) {
    const idx = e.currentTarget.dataset.index;
    const key = `categories[${idx}].selected`;
    const next = !this.data.categories[idx].selected;
    this.setData({ [key]: next });
    const selectedCount = this.data.categories.filter((c) => c.selected).length;
    this.setData({ selectedCount });
  },

  goNext() {
    const selected = this.data.categories.filter((c) => c.selected);
    if (selected.length === 0) {
      wx.showToast({ title: "请至少选择一个品类", icon: "none" });
      return;
    }
    getApp().globalData = getApp().globalData || {};
    getApp().globalData.selectedCategories = selected.map((c) => ({
      categoryId: c._id,
      categoryName: c.name,
      unit: c.unit,
      priceRef: c.priceRef,
    }));
    wx.navigateTo({ url: "/pages/order-create/index?source=category" });
  },
});