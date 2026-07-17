const TABBAR_ROUTES = new Set([
  "pages/home/index",
  "pages/order-list/index",
  "pages/user/index",
]);

const normalizeRoute = (url) => String(url || "").replace(/^\//, "");

// 普通页面优先返回上一页；扫码直达、页面栈已重建或当前就是 TabBar 页时，
// 改用 switchTab，避免 navigateBack with an invalid tabbar page。
const backOrSwitchTab = (fallbackUrl = "/pages/home/index") => {
  const pages = getCurrentPages();
  const currentRoute = pages.length ? normalizeRoute(pages[pages.length - 1].route) : "";
  const fallbackRoute = normalizeRoute(fallbackUrl);
  const safeFallback = TABBAR_ROUTES.has(fallbackRoute) ? `/${fallbackRoute}` : "/pages/home/index";

  if (pages.length > 1 && !TABBAR_ROUTES.has(currentRoute)) {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: safeFallback }),
    });
    return;
  }

  wx.switchTab({ url: safeFallback });
};

module.exports = { backOrSwitchTab };
