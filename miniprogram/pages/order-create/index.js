const { callCloud } = require("../../utils/cloud");
const { checkLogin, getOpenid } = require("../../utils/auth");

const APPOINT_SLOTS = [
  "09:00-12:00",
  "12:00-18:00",
  "18:00-21:00",
];

Page({
  data: {
    source: "category",
    items: [],
    categoryOptions: [],
    selectedCategory: null,
    photos: [],
    photoUrls: [],
    maxPhotos: 9,
    pickedAddress: null,
    appointDate: "",
    appointSlot: "",
    remark: "",
    submitting: false,
    minWeight: 5,
    minCount: 0,
    photoOrderCheckMinQuantity: false,
    today: "",
  },

  onLoad(options) {
    if (!checkLogin()) return;

    const source = options.source || "category";
    this.setData({
      source,
      today: this.getToday(),
      maxPhotos: source === "general" ? 6 : 9,
    });

    if (source === "category") {
      const selected = getApp().globalData.selectedCategories || [];
      const items = selected.map((c) => ({
        ...c,
        estWeight: 0,
        estCount: 0,
      }));
      this.setData({ items });
    } else if (source === "general") {
      this.loadGeneralCategories();
    }

    this.loadRecycleSettings();
  },

  onShow() {
    const app = getApp();
    const addr = app.globalData && app.globalData.pickedAddress;
    if (addr) {
      this.setData({ pickedAddress: addr });
      app.globalData.pickedAddress = null;
    }
  },

  async loadRecycleSettings() {
    const res = await callCloud("getRecycleSettings", {}, { toast: false });
    if (res.ok && res.data) {
      this.setData({
        minWeight: Number(res.data.minWeightKg) || 5,
        minCount: Number(res.data.minCount) || 0,
        photoOrderCheckMinQuantity: res.data.photoOrderCheckMinQuantity === true,
      });
    }
  },

  async loadGeneralCategories() {
    const res = await callCloud("listCategories", {}, { toast: false });
    const categories = res.ok && Array.isArray(res.data) ? res.data : [];
    this.setData({
      categoryOptions: [
        ...categories.map((item) => ({
          categoryId: item._id,
          categoryName: item.name,
        })),
        { categoryId: "", categoryName: "其他" },
      ],
    });
  },

  onGeneralCategoryChange(e) {
    const selectedCategory = this.data.categoryOptions[Number(e.detail.value)] || null;
    this.setData({ selectedCategory });
  },

  onQuantityInput(e) {
    const { idx, field } = e.currentTarget.dataset;
    const value = Number(e.detail.value) || 0;
    const key = `items[${idx}].${field}`;
    this.setData({ [key]: value });
  },

  onPhotoUpload() {
    const remaining = this.data.maxPhotos - this.data.photos.length;
    if (remaining <= 0) return;
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const tempFiles = res.tempFiles;
        const newPhotos = [];
        const newUrls = [];

        for (const file of tempFiles) {
          const openid = getOpenid() || "anonymous";
          const rand = Math.random().toString(36).substr(2, 9);
          const cloudPath = `recycle/${openid}/${Date.now()}-${rand}.jpg`;
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: file.tempFilePath,
          });
          newPhotos.push(uploadRes.fileID);
          newUrls.push(file.tempFilePath);
        }

        this.setData({
          photos: [...this.data.photos, ...newPhotos],
          photoUrls: [...this.data.photoUrls, ...newUrls],
        });
      },
    });
  },

  onPhotoRemove(e) {
    const idx = e.currentTarget.dataset.idx;
    const photos = this.data.photos.filter((_, i) => i !== idx);
    const photoUrls = this.data.photoUrls.filter((_, i) => i !== idx);
    this.setData({ photos, photoUrls });
  },

  onPhotoPreview(e) {
    const idx = e.currentTarget.dataset.idx;
    wx.previewImage({
      current: this.data.photoUrls[idx],
      urls: this.data.photoUrls,
    });
  },

  goAddress() {
    wx.navigateTo({
      url: "/pages/address/list?mode=select",
      success: (res) => {
        res.eventChannel.on("selectAddress", (addr) => {
          if (!addr || !addr._id) return;
          this.setData({ pickedAddress: addr });
          const app = getApp();
          if (app.globalData) app.globalData.pickedAddress = null;
        });
      },
    });
  },

  onDateChange(e) {
    const appointDate = e.detail.value;
    if (appointDate < this.data.today) {
      wx.showToast({ title: "不能选择今天之前的日期", icon: "none" });
      return;
    }
    this.setData({ appointDate });
  },

  onSlotChange(e) {
    this.setData({ appointSlot: APPOINT_SLOTS[e.detail.value] });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  getToday() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },

  async onSubmit() {
    const {
      source,
      items,
      photos,
      selectedCategory,
      pickedAddress,
      appointDate,
      appointSlot,
      remark,
    } = this.data;

    if (!pickedAddress) {
      return wx.showToast({ title: "请选择回收地址", icon: "none" });
    }
    if (!pickedAddress.phone) {
      return wx.showToast({ title: "请先完善地址联系电话", icon: "none" });
    }
    if (!appointDate) {
      return wx.showToast({ title: "请选择预约日期", icon: "none" });
    }
    if (appointDate < this.data.today) {
      return wx.showToast({ title: "不能选择今天之前的日期", icon: "none" });
    }
    if (!appointSlot) {
      return wx.showToast({ title: "请选择预约时间段", icon: "none" });
    }

    if (source === "category") {
      const validItems = items.filter((i) => i.estWeight > 0 || i.estCount > 0);
      if (validItems.length === 0) {
        return wx.showToast({ title: "请填写预估重量或数量", icon: "none" });
      }

      const totalWeight = validItems.reduce((sum, i) => sum + (i.estWeight || 0), 0);
      const totalCount = validItems.reduce((sum, i) => sum + (i.estCount || 0), 0);
      const meetWeight = this.data.minWeight > 0 && totalWeight >= this.data.minWeight;
      const meetCount = this.data.minCount > 0 && totalCount >= this.data.minCount;
      const noMin = this.data.minWeight <= 0 && this.data.minCount <= 0;
      if (!noMin && !meetWeight && !meetCount) {
        const tips = [];
        if (this.data.minWeight > 0) tips.push(`${this.data.minWeight}kg`);
        if (this.data.minCount > 0) tips.push(`${this.data.minCount}件`);
        return wx.showToast({ title: `未达最低起收量(${tips.join("或")})`, icon: "none" });
      }
    } else if (source === "photo") {
      if (photos.length === 0) {
        return wx.showToast({ title: "请至少上传一张照片", icon: "none" });
      }
    }

    this.setData({ submitting: true });

    try {
      const params = {
        source,
        addressId: pickedAddress._id,
        appointDate,
        appointSlot,
        remark,
      };

      if (source === "category") {
        params.items = items.map((i) => ({
          categoryId: i.categoryId,
          categoryName: i.categoryName,
          estWeight: i.estWeight,
          estCount: i.estCount,
        }));
      } else if (source === "photo") {
        params.photos = photos;
      } else if (source === "general") {
        params.photos = photos;
        params.items = selectedCategory
          ? [
              {
                categoryId: selectedCategory.categoryId,
                categoryName: selectedCategory.categoryName,
                estWeight: 0,
                estCount: 0,
              },
            ]
          : [];
      }

      const res = await callCloud("createOrder", params);
      if (res.ok) {
        wx.showToast({ title: "提交成功", icon: "success" });
        setTimeout(() => {
          wx.switchTab({ url: "/pages/order-list/index" });
        }, 1000);
      }
    } catch (e) {
      console.error("submit failed:", e);
    } finally {
      this.setData({ submitting: false });
    }
  },
});
