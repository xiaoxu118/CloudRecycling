// 地址编辑（新增/修改）
const { callCloud } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");

Page({
  data: {
    id: "",
    contactName: "",
    phone: "",
    region: "",
    regionArray: [],
    detail: "",
    isDefault: false,
    saving: false,
  },

  onLoad(query) {
    if (!checkLogin()) return;
    
    if (query.id) {
      this.setData({ id: query.id });
      wx.setNavigationBarTitle({ title: "编辑地址" });
      this.loadAddress(query.id);
    } else {
      wx.setNavigationBarTitle({ title: "新增地址" });
    }
  },

  loadAddress(id) {
    const cache = (getApp().globalData && getApp().globalData.editingAddress) || null;
    if (cache && cache._id === id) {
      this.setData({
        contactName: cache.contactName,
        phone: cache.phone,
        region: cache.region,
        regionArray: cache.region ? cache.region.split(" ") : [],
        detail: cache.detail,
        isDefault: !!cache.isDefault,
      });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onRegionChange(e) {
    const arr = e.detail.value;
    this.setData({ regionArray: arr, region: arr.join(" ") });
  },

  onDefaultChange(e) {
    this.setData({ isDefault: e.detail.value });
  },

  async onSave() {
    const { id, contactName, phone, region, detail, isDefault } = this.data;
    if (!contactName.trim()) {
      return wx.showToast({ title: "请填写联系人", icon: "none" });
    }
    if (!/^1\d{10}$/.test(phone)) {
      return wx.showToast({ title: "手机号格式不正确", icon: "none" });
    }
    if (!region) {
      return wx.showToast({ title: "请选择省市区", icon: "none" });
    }
    if (!detail.trim()) {
      return wx.showToast({ title: "请填写详细地址", icon: "none" });
    }

    this.setData({ saving: true });
    const address = { contactName, phone, region, detail, isDefault };
    if (id) address._id = id;

    const res = await callCloud("saveAddress", { address });
    this.setData({ saving: false });
    if (res.ok) {
      if (getApp().globalData) getApp().globalData.editingAddress = null;
      wx.showToast({ title: "保存成功", icon: "success" });
      setTimeout(() => wx.navigateBack(), 600);
    }
  },
});