import cloudbase from "@cloudbase/js-sdk";
import { isDevPreview, mockCall } from "./mock";

const config = window.ADMIN_CONFIG || {};
let app: ReturnType<typeof cloudbase.init> | null = null;

export class CloudError extends Error {
  code: string;
  data?: unknown;

  constructor(code: string, data?: unknown) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

export async function initCloud() {
  if (isDevPreview()) return;
  if (!config.env || !config.functionName) throw new CloudError("CLOUDBASE_CONFIG_MISSING");
  app = cloudbase.init({ env: config.env });
  try {
    await app.auth({ persistence: "local" }).anonymousAuthProvider().signIn();
  } catch (error) {
    console.warn("CloudBase anonymous sign-in failed", error);
  }
}

export async function callCloud<T>(type: string, data: Record<string, unknown> = {}) {
  if (isDevPreview()) return mockCall<T>(type, data);
  if (!app) throw new CloudError("CLOUDBASE_NOT_READY");
  const response = await app.callFunction({
    name: config.functionName || "quickstartFunctions",
    data: { type, ...data },
  });
  const result = response.result as CloudFunctionResult<T> | undefined;
  if (!result) throw new CloudError("EMPTY_RESPONSE");
  if (!result.success) throw new CloudError(result.errMsg || "CALL_FAILED", result.data);
  return result.data;
}

export async function uploadTransferProof(orderNo: string, file: File) {
  if (!app) throw new CloudError("CLOUDBASE_NOT_READY");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cloudPath = `transfer-proofs/${orderNo}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}-${safeName}`;
  // CloudBase Web 运行时接受 File，SDK 的兼容类型仍将 filePath 声明为 string。
  const result = await app.uploadFile({ cloudPath, filePath: file } as never);
  return result.fileID;
}
