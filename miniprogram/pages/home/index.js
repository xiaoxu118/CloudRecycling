// 首页
const { callCloud, getEnvTip, clearEnvTip } = require("../../utils/cloud");
const { getCurrentAddress, setMapKey } = require("../../utils/map");

// 品类 icon 字段 → Vant 图标 name（Vant 图标见 https://vant-ui.github.io/vant-weapp/#/icon）
// 数据库中的 icon 字段：clothes / paper / appliance / metal / plastic ...
// 想换图标时，把这里的映射改掉即可（无需改后端数据）。
const VAN_ICON_MAP = {
  clothes: "bag-o",
  paper: "records",
  appliance: "tv-o",
  metal: "medal",
  plastic: "todo-list-o",
};
const DEFAULT_VAN_ICON = "label-o";

// name → 兜底 icon key（服务端未返回 icon 字段时按名字猜）
const ICON_KEY_MAP = {
  "旧衣": "clothes",
  "旧衣物": "clothes",
  "衣服": "clothes",
  "纸品": "paper",
  "废纸": "paper",
  "纸箱": "paper",
  "纸箱/废纸": "paper",
  "家电": "appliance",
  "旧家电": "appliance",
  "金属": "metal",
  "易拉罐": "metal",
  "塑料": "plastic",
};

const SERVICE_PHONE = "400-800-1234";
const HOME_DATA_TTL = 5 * 60 * 1000;
const LOCATION_TTL = 10 * 60 * 1000;

// Tab 页面会长期驻留，缓存低频变化数据，避免每次返回首页都重新请求。
const homeCache = {
  categories: null,
  categoriesAt: 0,
  bannerImageUrl: "",
  bannerAt: 0,
  location: null,
  locationAt: 0,
};

const isFresh = (timestamp, ttl) => timestamp > 0 && Date.now() - timestamp < ttl;

Page({
  data: {
    // 系统 / 导航栏
    statusBarHeight: 20,
    navBarHeight: 44,
    // 定位
    locationText: "定位中...",
    fullAddress: "",
    locating: false,
    // Banner
    bannerImageUrl: "",
    // 品类
    categories: [],
    hasSelection: false,
    // 客服
    servicePhone: SERVICE_PHONE,
    // 云环境提示
    showTip: false,
    tipTitle: "",
    tipContent: "",
  },

  onLoad() {
    // 计算自定义导航栏高度（状态栏 + 胶囊按钮对齐区）
    const sys = wx.getSystemInfoSync();
    const statusBarHeight = sys.statusBarHeight || 20;
    let navBarHeight = 44;
    try {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.top) {
        navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      }
    } catch (e) {
      // 使用默认值
    }
    this.setData({ statusBarHeight, navBarHeight });
  },

  onShow() {
    this.loadLocation();
    this.loadHomeData();
  },

  // ---------- 定位 ----------
  async loadLocation(force = false) {
    if (!force && homeCache.location && isFresh(homeCache.locationAt, LOCATION_TTL)) {
      this.setData(homeCache.location);
      return;
    }
    if (this.data.locating) return;
    this.setData({ locating: true });
    try {
      const addr = await getCurrentAddress();
      const text =
        [addr.city, addr.district].filter(Boolean).join("") ||
        addr.province ||
        addr.formatted ||
        "未知位置";
      const full =
        ([addr.province, addr.city, addr.district].filter(Boolean).join("") +
          (addr.address || addr.formatted || "")) || text;
      const location = { locationText: text, fullAddress: full };
      homeCache.location = location;
      homeCache.locationAt = Date.now();
      this.setData(location);
    } catch (e) {
      const msg = (e && e.message) || "";
      this.setData({
        locationText: msg === "MAP_KEY_NOT_SET" ? "未配置地图Key" : "点击定位",
        fullAddress: "",
      });
    } finally {
      this.setData({ locating: false });
    }
  },

  onTapLocation() {
    if (this.data.fullAddress) {
      wx.showModal({
        title: "当前位置",
        content: this.data.fullAddress,
        showCancel: false,
        confirmText: "知道了",
      });
    } else {
      this.loadLocation(true);
    }
  },

  onBannerBookTap() {
    wx.pageScrollTo({ selector: ".category-section", duration: 300 });
  },

  // 品类和 Banner 合并为一次云函数调用，减少首页首屏网络往返。
  async loadHomeData() {
    const categoriesFresh =
      homeCache.categories && isFresh(homeCache.categoriesAt, HOME_DATA_TTL);
    const bannerFresh = isFresh(homeCache.bannerAt, HOME_DATA_TTL);
    if (categoriesFresh && bannerFresh) {
      const categories = homeCache.categories.map((item) => ({ ...item, selected: false }));
      this.setData({
        categories,
        hasSelection: false,
        bannerImageUrl: homeCache.bannerImageUrl,
      });
      return;
    }

    const res = await callCloud("getHomeData", {}, { toast: false });
    if (res.ok && res.data) {
      const categories = (res.data.categories || []).map((c) => {
        const iconKey = c.icon || ICON_KEY_MAP[c.name] || "plastic";
        return {
          ...c,
          selected: false,
          iconKey,
          vanIcon: VAN_ICON_MAP[iconKey] || DEFAULT_VAN_ICON,
        };
      });
      const bannerImageUrl = (res.data.banner && res.data.banner.imageUrl) || "";
      const publicSettings = res.data.settings || {};
      const servicePhone = publicSettings.servicePhone || SERVICE_PHONE;
      if (publicSettings.mapKey) setMapKey(publicSettings.mapKey);
      const now = Date.now();
      homeCache.categories = categories.map((item) => ({ ...item, selected: false }));
      homeCache.categoriesAt = now;
      homeCache.bannerImageUrl = bannerImageUrl;
      homeCache.bannerAt = now;
      this.setData({ categories, hasSelection: false, bannerImageUrl, servicePhone });
      return;
    }

    const tip = getEnvTip();
    if (tip.show) {
      this.setData({ showTip: true, tipTitle: tip.title, tipContent: tip.content });
      clearEnvTip();
    }
  },

  onToggleCategory(e) {
    const idx = e.currentTarget.dataset.index;
    const key = `categories[${idx}].selected`;
    const selected = !this.data.categories[idx].selected;
    this.setData({ [key]: selected });
    const hasSelection = this.data.categories.some((c) => c.selected);
    this.setData({ hasSelection });
  },

  onBookTap() {
    const selected = this.data.categories.filter((c) => c.selected);
    if (!selected.length) {
      wx.navigateTo({ url: "/pages/order-create/index?source=general" });
      return;
    }
    const app = getApp();
    app.globalData.selectedCategories = selected.map((c) => ({
      categoryId: c._id,
      categoryName: c.name,
      unit: c.unit,
      priceRef: c.priceRef,
    }));
    wx.navigateTo({ url: "/pages/order-create/index?source=category" });
  },

  // ---------- 客服 ----------
  onCallService() {
    wx.makePhoneCall({
      phoneNumber: this.data.servicePhone || SERVICE_PHONE,
      fail: () => {},
    });
  },

  // ---------- 其他 ----------
  onCloseTip() {
    this.setData({ showTip: false });
  },
});
