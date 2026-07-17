# 云回收管理后台

这是云回收 Web 管理后台静态站点，部署到 CloudBase 静态网站托管后，通过 `quickstartFunctions` 读取真实云数据库数据。

## 登录方案

当前采用“小程序扫码确认登录”：

1. Web 后台调用 `adminCreateLoginTicket` 创建一次性登录票据和小程序码。
2. 管理员用微信扫码打开小程序隐藏页 `pages/admin-login/index`。
3. 小程序调用 `adminConfirmLoginTicket`，云函数用当前 `OPENID` 查询 `admins` 集合。
4. 通过白名单后，Web 携带 `ticket + webNonce` 轮询 `adminCheckLoginTicket` 获取短期 `sessionToken`。
5. 管理接口必须携带 `sessionToken`，云函数校验通过才会返回真实数据。

## 首次配置

1. 部署 `cloudfunctions/quickstartFunctions`，并确保 `config.json` 包含 `wxacode.getUnlimited` 权限。
2. 调用一次 `initAdminCollections`，或首次打开后台时由登录接口自动创建管理相关集合。
3. 用非管理员微信扫码一次，确认页会提示“无权限”并展示当前 `OpenID`。
4. 在云开发数据库 `admins` 集合中新增管理员：

```json
{
  "openid": "扫码页展示的 OpenID",
  "name": "运营管理员",
  "role": "admin",
  "enabled": true
}
```

5. 在 CloudBase 控制台开启 Web 端可用的身份能力。当前页面会尝试匿名登录后调用云函数，若环境未开启匿名登录，需要在控制台启用匿名登录或改成正式 Web OAuth 登录。

## 部署

`admin-web/` 使用 Vite + React + TypeScript 开发，构建结果仍是可部署到 CloudBase 静态网站托管的纯静态文件。

```bash
npm install
npm run dev
npm run build
```

如需在不调用云环境、不扫码的情况下验证管理页面，开发服务可访问 `http://localhost:5173/?mock=1#/orders`。本地预览只在 Vite 开发模式下生效，生产构建不会启用登录绕过。

开发模式的登录页也会显示“账号密码”选项，本地测试账号为 `admin`，密码为 `admin123`。该入口只会进入 Mock 预览，不读写真实 CloudBase 数据，且不会在生产模式显示。

开发服务默认使用 Vite 端口，生产构建输出到 `dist/`。部署时上传 `dist/` 目录内容。若云开发环境 ID 变化，修改 `public/config.js`；该文件会在构建时复制到 `dist/config.js`。

正式使用建议绑定自定义域名，并只把后台域名发给运营人员。真正的权限边界仍在云函数的管理员白名单和 session 校验。
