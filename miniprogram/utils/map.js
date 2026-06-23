// 云回收 · 地图/定位工具
// 依赖腾讯位置服务 WebService Key（逆地理编码）。
// 申请地址：https://lbs.qq.com/  控制台 → 应用管理 → 我的应用 → 创建 key
// ⚠️ 还需在腾讯位置服务控制台为该 key 勾选「WebServiceAPI」并把本小程序 AppID 加入白名单。
// 同时确保 app.json 已配置 permission.scope.userLocation 与 requiredPrivateInfos。
const MAP_KEY = "4MRBZ-EYLYI-XRCGF-UC33Z-SNYOO-OVFEI"; // TODO: 替换为你的腾讯地图 key

// wx.getLocation —— 取当前经纬度（gcj02 供逆地理编码用）
const getLocation = () =>
  new Promise((resolve, reject) => {
    wx.getLocation({
      type: "gcj02",
      success: resolve,
      fail: reject,
    });
  });

// 腾讯逆地理编码：经纬度 → 中文地址
// 返回 { address, province, city, district, latitude, longitude, ... }
const reverseGeocode = (latitude, longitude) =>
  new Promise((resolve, reject) => {
    if (!MAP_KEY || MAP_KEY === "YOUR_MAP_KEY") {
      return reject(new Error("MAP_KEY_NOT_SET"));
    }
    wx.request({
      url: "https://apis.map.qq.com/ws/geocoder/v1/",
      data: {
        location: `${latitude},${longitude}`,
        key: MAP_KEY,
        get_poi: 0,
      },
      success: (res) => {
        const data = res.data || {};
        if (data.status !== 0) {
          return reject(new Error(data.message || "GEOCODE_FAILED"));
        }
        const r = data.result || {};
        const comp = r.address_component || {};
        const province = comp.province || "";
        // 直辖市（上海/北京/天津/重庆）逆地理常返回空 city，用 province 兜底，保证省市区三段完整
        const city = comp.city || province;
        resolve({
          address: r.address || "",
          formatted: (r.formatted_addresses && r.formatted_addresses.recommend) || r.address || "",
          province,
          city,
          district: comp.district || "",
          street: comp.street || "",
          streetNumber: comp.street_number || "",
          latitude,
          longitude,
        });
      },
      fail: reject,
    });
  });

// 一步到位：取当前定位并转中文地址（首页左上角用）
// 返回逆地理编码结果对象；失败时 reject，调用方自行兜底。
const getCurrentAddress = async () => {
  const loc = await getLocation();
  return reverseGeocode(loc.latitude, loc.longitude);
};

module.exports = {
  MAP_KEY,
  getLocation,
  reverseGeocode,
  getCurrentAddress,
};
