/** Classify transport failures without displaying URLs, credentials or provider payloads. */
export function requestFailure(cause) {
    const chain = [], seen = new Set();
    for (let item = cause; item && chain.length < 4 && !seen.has(item); item = item.cause) {
        seen.add(item);
        chain.push([item.code, item.errno, item.message].filter(value => typeof value === 'string').join(' '));
    }
    const detail = chain.join(' ');
    const failure = (code, message) => ({ code, message });
    if (/ECONNRESET|socket hang up|connection reset|\bEPIPE\b/iu.test(detail)) return failure('CONNECTION_RESET', '导演接口连接在返回完整结果前被中断（连接重置）。请检查直连网络与服务商连接；这不是剧本 JSON 内容校验错误。');
    if (/ECONNREFUSED|connection refused/iu.test(detail)) return failure('CONNECTION_REFUSED', '无法连接导演接口（连接被拒绝）。请确认服务正在运行。');
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|name resolution/iu.test(detail)) return failure('DNS_FAILED', '无法解析导演接口的地址。请检查地址与当前网络的域名解析。');
    if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|connect(?:ion)? timed? ?out/iu.test(detail)) return failure('NETWORK_TIMEOUT', '连接导演接口或等待网络响应超时。请检查直连网络与服务商状态。');
    if (/CERT_|certificate|ERR_TLS|SSL_ERROR|TLS handshake/iu.test(detail)) return failure('TLS_FAILED', '导演接口的安全连接验证失败。请检查接口地址、系统时间和网络证书配置。');
    if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/iu.test(detail)) return failure('NETWORK_FAILED', '浏览器未能完成导演接口请求。请检查酒馆是否仍在运行，以及当前网络连接。');
    if (/response_format|json_schema|structured.output|unsupported.{0,30}json/iu.test(detail)) return failure('UNSUPPORTED_FORMAT', '接口不支持当前结构化输出格式，请在 API 设置中选择该接口支持的格式后重试。');
    if (/bad request|unprocessable entity/iu.test(detail)) return failure('REQUEST_FAILED', '所选接口拒绝了本次请求，但酒馆未提供详细原因。');
    if (/invalid_api_key|authentication|unauthorized|\b401\b/iu.test(detail)) return failure('REQUEST_FAILED', '导演接口认证失败：请确认密钥由当前 API 地址对应的服务商签发，并且仍然有效。');
    if (/insufficient|quota|balance|余额|\b402\b/iu.test(detail)) return failure('REQUEST_FAILED', '导演接口的余额或额度不足，请检查此密钥所属账户的用量。');
    if (/model.{0,50}(?:not found|not exist|invalid|unavailable)|\bmodel_not_found\b/iu.test(detail)) return failure('REQUEST_FAILED', '导演接口不接受当前模型名称，请填写该接口实际提供的模型名称。');
    if (/rate.?limit|too many requests|\b429\b/iu.test(detail)) return failure('REQUEST_FAILED', '导演接口请求过于频繁或额度受限，请稍后重试。');
    return failure('REQUEST_FAILED', '导演接口请求失败，现有错误详情不足以定位原因。请查看酒馆启动终端中对应请求的错误记录。');
}
