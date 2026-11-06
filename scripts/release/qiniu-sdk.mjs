import qiniu from "qiniu";
import { basename } from "node:path";

function failure(action, status) {
  // SDK errors can contain signed requests. Never propagate their raw messages.
  return Object.assign(new Error(`七牛 ${action} 失败${status ? ` (${status})` : "，请检查网络与凭据"}`), { status });
}

export function createQiniuClient(settings, request = fetch) {
  const mac = new qiniu.auth.digest.Mac(settings.accessKey, settings.secretKey);
  const config = new qiniu.conf.Config({ useHttpsDomain: true,
    ...(settings.region ? { regionsProvider: qiniu.httpc.Region.fromRegionId(settings.region) } : {}) });
  const bucket = new qiniu.rs.BucketManager(mac, config);
  const form = new qiniu.form_up.FormUploader(config);
  const resume = new qiniu.resume_up.ResumeUploader(config);
  async function call(action, work) {
    let result;
    try { result = await work(); } catch (error) { throw failure(action, error.statusCode ?? error.resp?.statusCode); }
    if (result.resp?.statusCode !== 200) throw failure(action, result.resp?.statusCode);
    return result.data;
  }
  function token(key, insertOnly, size) {
    return new qiniu.rs.PutPolicy({ scope: `${settings.bucket}:${key}`, insertOnly: insertOnly ? 1 : 0,
      expires: 3600, fsizeLimit: size }).uploadToken(mac);
  }
  return {
    async stat(key) {
      try { return await call("查询对象", () => bucket.stat(settings.bucket, key)); }
      catch (error) { if (error.status === 612) return null; throw error; }
    },
    putBuffer(key, bytes, { insertOnly = true, mimeType = "application/json" } = {}) {
      const extra = new qiniu.form_up.PutExtra(basename(key), {}, mimeType);
      return call("上传清单/锁", () => form.put(token(key, insertOnly, bytes.length), key, bytes, extra));
    },
    putFile(key, path, size, recordFile) {
      const extra = qiniu.resume_up.PutExtra.create();
      extra.mimeType = "application/octet-stream";
      extra.resumeRecordFile = recordFile;
      return call("分片上传", () => resume.putFileV2(token(key, true, size), key, path, extra));
    },
    headers(key, cacheControl) {
      return call("设置缓存", () => bucket.changeHeaders(settings.bucket, key, { "Cache-Control": cacheControl }));
    },
    async remove(key) {
      // Do not use the SDK's automatic deletion retries for a mutex: if the
      // first delete succeeded but its response was lost, a retry might delete
      // the next publisher's lock. Send one request and report uncertainty.
      let response;
      try {
        const provider = await config.getRegionsProvider({ bucketName: settings.bucket, accessKey: settings.accessKey });
        const [region] = await provider.getRegions();
        const endpoint = region.services.rs[0].getValue({ scheme: "https" });
        const url = new URL(qiniu.rs.deleteOp(settings.bucket, key), endpoint).href;
        response = await request(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { Authorization: qiniu.util.generateAccessToken(mac, url, ""), "Content-Type": "application/x-www-form-urlencoded" } });
        await response.body?.cancel();
      } catch { throw failure("释放发布锁（未自动重试）"); }
      if (response.status !== 200 && response.status !== 612) throw failure("释放发布锁（未自动重试）", response.status);
    },
    async refresh(urls) {
      // The pinned SDK's CDN helper uses HTTP. Reuse its signing implementation
      // with HTTPS and reject redirects so upload/management tokens never leak.
      const url = "https://fusion.qiniuapi.com/v2/tune/refresh";
      let response, data;
      try {
        response = await request(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { Authorization: qiniu.util.generateAccessToken(mac, url, ""), "Content-Type": "application/json" },
          body: JSON.stringify({ urls }) });
        data = await response.json();
      } catch { throw failure("刷新 CDN"); }
      if (!response.ok || data.code !== 200 || data.invalidUrls?.length || data.invalidDirs?.length) throw failure("刷新 CDN", data.code ?? response.status);
      return data.requestId;
    },
  };
}
