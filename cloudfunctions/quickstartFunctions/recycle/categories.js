// 云回收 · 品类模块
// 对应接口契约：1.1 initRecycleDB、2.1 listCategories
const cloud = require("wx-server-sdk");

const db = cloud.database();

// 示例品类数据（来自数据字典，平台可后续在控制台增删改）
// icon 为旧版内置图标 key；iconFileId 为管理端上传的自定义图标。
const SAMPLE_CATEGORIES = [
  { name: "旧衣", unit: "kg", priceRef: "0.2元/kg", icon: "clothes", sortOrder: 1, enabled: true },
  { name: "纸品", unit: "kg", priceRef: "0.8元/kg", icon: "paper", sortOrder: 2, enabled: true },
  { name: "家电", unit: "件", priceRef: "面议", icon: "appliance", sortOrder: 3, enabled: true },
  { name: "金属", unit: "kg", priceRef: "2.0元/kg", icon: "metal", sortOrder: 4, enabled: true },
  { name: "塑料", unit: "kg", priceRef: "0.5元/kg", icon: "plastic", sortOrder: 5, enabled: true },
];

// initRecycleDB — 创建集合并写入示例品类
// 仅开发期手动调用一次；可重复调用（集合已存在被 catch，品类非空时跳过写入）
const initRecycleDB = async () => {
  // 1. 创建三个集合，已存在则忽略异常
  for (const name of ["categories", "addresses", "orders"]) {
    try {
      await db.createCollection(name);
    } catch (e) {
      // 集合已存在会抛错，属正常情况，忽略
    }
  }

  // 2. 仅当 categories 为空时写入示例品类，避免重复调用产生重复数据
  try {
    const { total } = await db.collection("categories").count();
    if (total === 0) {
      for (const cat of SAMPLE_CATEGORIES) {
        await db.collection("categories").add({ data: cat });
      }
    }
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }

  return { success: true };
};

// listCategories — 获取上架品类列表，按 sortOrder 升序
const listCategories = async () => {
  try {
    const res = await db
      .collection("categories")
      .where({ enabled: true })
      .orderBy("sortOrder", "asc")
      .get();
    const fileIds = [...new Set(res.data.map((item) => item.iconFileId).filter(Boolean))];
    const urlMap = {};
    if (fileIds.length) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: fileIds });
        (tempRes.fileList || []).forEach((item) => {
          urlMap[item.fileID] = item.tempFileURL || "";
        });
      } catch (e) {
        // 单个历史文件失效时仍返回品类，前端继续使用内置图标兜底。
      }
    }
    return {
      success: true,
      data: res.data.map((item) => ({
        ...item,
        iconImageUrl: item.iconFileId ? urlMap[item.iconFileId] || "" : "",
      })),
    };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

module.exports = { initRecycleDB, listCategories };
