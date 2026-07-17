# 云回收（帮帮回收）

云回收是一个基于微信云开发（CloudBase）的预约上门回收系统。目前包含微信小程序用户端和 Web 管理端：用户可以选择回收品类或拍照提交物品、维护上门地址、预约回收并查看订单；管理员可以扫码登录后台，处理订单、登记最终重量和金额、上传打款凭证，并维护品类及回收规则。

1.0 版本不接入线上支付。回收款在线下完成，系统仅记录订单结果、最终金额和打款凭证。

## 功能概览

### 微信小程序

- 首页定位、Banner、回收品类和参考价格展示
- 按品类预约或拍照提交物品
- 地址新增、编辑、删除、默认地址和地图选点
- 最低起收重量/件数校验
- 预约日期、时间段及备注填写
- 我的订单列表、详情和已提交订单取消
- 最终重量、数量、金额、回收人员和打款凭证展示
- 微信头像昵称登录；符合主体条件时支持手机号授权

### Web 管理端

- 管理员使用微信扫码，由小程序确认登录
- 管理员 OpenID 白名单及短期 Session 鉴权
- 订单分页、状态筛选，支持按订单号、摘要、备注、联系人或手机号搜索，并可按创建时间或修改时间排序
- 更新订单状态、最终重量/数量/金额、回收人员及管理备注
- 可选登记最终重量、数量、金额和打款凭证；这些信息为空时也可完成订单
- 回收品类维护，支持为每个品类上传、预览、替换或移除自定义图标
- Key/Value 通用配置中心，所有 `value` 统一按字符串存储，类型仅用于后台标识
- 内置首页 Banner、客服电话、腾讯地图 Key、最低起收量等常用配置

## 技术架构

```text
微信小程序（原生 WXML / WXSS / JavaScript + Vant Weapp）
                         │
                         │ wx.cloud.callFunction
                         ▼
           quickstartFunctions 单一云函数
                  按 event.type 分发
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        CloudBase 数据库       CloudBase 云存储
              ▲                     ▲
              └──────────┬──────────┘
                         │
                Web 管理端（静态站点）
```

小程序和管理端的业务数据均通过云函数访问，不直接读写数据库。云函数使用 `cloud.DYNAMIC_CURRENT_ENV` 自动绑定部署环境。

## 目录结构

```text
CloudRecycling/
├── miniprogram/                         微信小程序
│   ├── pages/                           首页、下单、地址、订单、用户中心等页面
│   ├── components/                      公共组件
│   └── utils/                           云函数、登录和地图工具
├── cloudfunctions/quickstartFunctions/  单一云函数后端
│   ├── index.js                         event.type 分发入口
│   └── recycle/
│       ├── categories.js                品类及业务数据初始化
│       ├── address.js                   用户地址
│       ├── orders.js                    用户订单
│       └── admin.js                     后台鉴权和管理接口
├── admin-web/                           无构建流程的静态管理后台
├── 开发指令/                            产品与开发文档
├── project.config.json                  微信开发者工具配置
└── uploadCloudFunction.sh               云函数 CLI 部署脚本模板
```

## 核心业务流程

```text
用户选择品类或上传照片
→ 填写物品数量、地址和预约时间
→ 创建“已提交”订单
→ 管理员接单并更新为“处理中”
→ 回收人员上门，线下支付回收款
→ 管理员填写最终金额并上传打款凭证
→ 订单更新为“已完成”
```

订单对外统一为四种状态：

| 状态值 | 文案 | 说明 |
|---|---|---|
| `submitted` | 已提交 | 等待平台处理，用户可以取消 |
| `processing` | 处理中 | 联系用户、安排人员或上门回收中 |
| `completed` | 已完成 | 已完成回收；金额、重量和打款凭证可选登记 |
| `canceled` | 已取消 | 用户或管理员取消 |

后端仍兼容 `confirmed`、`assigned`、`recycling` 和 `rejected` 等旧状态，并在用户端归一化显示。

## 云数据库集合

| 集合 | 用途 |
|---|---|
| `categories` | 回收品类、单位、参考价、排序和上下架状态 |
| `addresses` | 用户地址，通过 `_openid` 隔离 |
| `orders` | 订单、地址快照、物品、金额、人员和凭证 |
| `settings` | 最低起收量等业务配置 |
| `admins` | 管理员 OpenID 白名单 |
| `admin_login_tickets` | Web 扫码登录一次性票据 |
| `admin_sessions` | 管理后台短期 Session |

项目中还保留了 quickstart 模板的 `sales` 集合示例接口，但它不属于云回收核心业务。

## 本地开发

本项目没有命令行构建、lint 或自动化测试流程，主要通过微信开发者工具运行。

### 1. 配置云开发环境

在以下两个位置填写同一个云开发环境 ID：

- `miniprogram/app.js` 中的 `globalData.env`
- `admin-web/config.js` 中的 `ADMIN_CONFIG.env`

当前仓库已填写开发环境 ID；切换环境时需要同时修改这两处。云函数名称默认为 `quickstartFunctions`。

### 2. 安装依赖

小程序使用 Vant Weapp：

```bash
cd miniprogram
npm install
```

然后在微信开发者工具中执行“工具 → 构建 npm”。

云函数依赖 `wx-server-sdk`。通常上传云函数时选择“云端安装依赖”即可；需要在本地安装时运行：

```bash
cd cloudfunctions/quickstartFunctions
npm install
```

### 3. 配置腾讯位置服务

定位和逆地理编码使用腾讯位置服务 WebService API。将 `miniprogram/utils/map.js` 中的 `MAP_KEY` 替换为自己的 Key，并在腾讯位置服务控制台：

- 为 Key 开启 WebService API；
- 将小程序 AppID 加入白名单；
- 确保相关域名符合小程序网络请求配置。

`miniprogram/app.json` 已声明 `getLocation` 和 `chooseLocation` 所需的隐私权限。

### 4. 编译小程序

使用微信开发者工具打开项目根目录。工具会读取 `project.config.json` 中的 `miniprogramRoot` 和 `cloudfunctionRoot` 自动识别项目。

注意：`project.private.config.json` 属于本地私有配置，如果存在，会覆盖 `project.config.json` 中的同名字段。

## 初始化与部署

### 部署云函数

在微信开发者工具中右键 `cloudfunctions/quickstartFunctions`，选择：

> 上传并部署：云端安装依赖

也可以补全 `uploadCloudFunction.sh` 中的 `installPath`、`envId` 和 `projectPath` 后，通过微信开发者工具 CLI 部署。

云函数 `config.json` 已声明以下 OpenAPI 权限：

- `wxacode.get`
- `wxacode.getUnlimited`
- `phonenumber.getPhoneNumber`

手机号能力需要符合微信对小程序主体和能力开通的要求；不符合条件时仍可在地址中手动填写联系电话。

### 初始化业务数据

首次部署后，需要调用一次云函数动作 `initRecycleDB`。它会创建：

- `categories`
- `addresses`
- `orders`

并在品类为空时写入旧衣、纸品、家电、金属和塑料五条示例数据。该初始化可重复调用，不会重复写入非空品类集合。

管理后台首次发起登录时会自动初始化 `admins`、`admin_login_tickets`、`admin_sessions` 和 `settings` 集合，也可以提前调用 `initAdminCollections`。

## 配置管理员

管理端采用“小程序扫码确认登录”：

1. 打开 Web 管理端，生成一次性登录二维码。
2. 使用微信扫码进入小程序隐藏页 `pages/admin-login/index`。
3. 非管理员确认时，页面会显示当前 OpenID。
4. 在云数据库 `admins` 集合中添加该管理员：

```json
{
  "openid": "管理员的 OpenID",
  "name": "运营管理员",
  "role": "admin",
  "enabled": true
}
```

5. 重新扫码，确认后 Web 端会获得有效期 12 小时的管理 Session。

生成扫码二维码依赖 `wxacode.getUnlimited`。小程序未发布或权限未配置时，接口会返回用于开发者工具测试的页面路径。

## 部署 Web 管理端

`admin-web/` 是纯 HTML/CSS/JavaScript 静态站点，不需要构建。可以直接上传到 CloudBase 静态网站托管。

部署前确认：

- `admin-web/config.js` 的环境 ID 和云函数名正确；
- CloudBase Web 端身份能力已开启；
- 当前实现可以匿名登录后调用云函数，如环境未开启匿名登录，需要启用该能力或接入正式 Web OAuth；
- 生产环境应绑定正式域名，并仅通过云函数的管理员白名单和 Session 进行权限控制。

更详细的后台说明见 [`admin-web/README.md`](./admin-web/README.md)。

## 开发约定

- 后端继续采用单一云函数模式：新增能力时在 `quickstartFunctions/index.js` 的 `switch (event.type)` 中注册，不另建云函数。
- 用户订单和地址必须根据云函数上下文中的 `OPENID` 做归属校验，不能信任前端传入的 OpenID。
- 历史订单保存地址快照，用户修改或删除地址不会影响既有订单。
- 管理端修改订单、品类或配置的接口必须校验 `sessionToken`。
- 用户只能取消 `submitted` 状态的订单。
- 将订单更新为 `completed` 时，最终金额、实际重量/件数和打款凭证均为选填。
- 图片在数据库中保存云存储 `fileID`，展示时由云函数转换为临时 URL。

## 相关文档

- [云回收 1.0 产品需求文档](./开发指令/云回收1.0产品需求文档.md)
- [云回收 1.0 开发文档](./开发指令/云回收1.0开发文档.md)
- [Web 管理后台说明](./admin-web/README.md)

## 当前限制

- 暂无线上支付、自动打款或提现能力。
- 暂无工作人员专用小程序端。
- 暂无命令行构建、lint 和自动化测试。
- 管理后台目前是单一管理员角色，不区分运营、财务或调度权限。
