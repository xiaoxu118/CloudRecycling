// 云回收 · 品类模块
// 对应接口契约：1.1 initRecycleDB、2.1 listCategories
const cloud = require("wx-server-sdk");

const db = cloud.database();

// 示例品类数据（来自数据字典，平台可后续在控制台增删改）
const SAMPLE_CATEGORIES = [
  { name: "纸箱/废纸", unit: "kg", priceRef: "0.8元/kg", icon: "", sortOrder: 1, enabled: true },
  { name: "塑料瓶/塑料", unit: "kg", priceRef: "0.5元/kg", icon: "", sortOrder: 2, enabled: true },
  { name: "易拉罐/金属", unit: "kg", priceRef: "2.0元/kg", icon: "", sortOrder: 3, enabled: true },
  { name: "旧衣物", unit: "kg", priceRef: "0.2元/kg", icon: "", sortOrder: 4, enabled: true },
  { name: "旧家电", unit: "件", priceRef: "面议", icon: "", sortOrder: 5, enabled: true },
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
    return { success: true, data: res.data };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

module.exports = { initRecycleDB, listCategories };
