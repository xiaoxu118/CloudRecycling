// 品类列表（支持多选）
const { callCloud } = require("../../utils/cloud");

Page({
  data: {
    categories: [], // 每项加 selected 字段
    loading: true,
    selectedCount: 0,
  },

  onLoad() {
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

  // 切换选中
  toggleSelect(e) {
    const idx = e.currentTarget.dataset.index;
    const key = `categories[${idx}].selected`;
    const next = !this.data.categories[idx].selected;
    this.setData({ [key]: next });
    const selectedCount = this.data.categories.filter((c) => c.selected).length;
    this.setData({ selectedCount });
  },

  // 下一步：把所选品类暂存到全局，跳下单页
  goNext() {
    const selected = this.data.categories.filter((c) => c.selected);
    if (selected.length === 0) {
      wx.showToast({ title: "请至少选择一个品类", icon: "none" });
      return;
    }
    // 用全局暂存所选品类，避免 URL 过长
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
