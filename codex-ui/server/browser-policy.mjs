// Local preview addresses share one policy across navigation, requests and the UI service guard.
function hostName(host) {
  const value = host.toLowerCase().replace(/\.+$/, "");
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(value);
  if (!mapped) return value;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isLoopbackHost(host) {
  const value = hostName(host);
  return value === "localhost" || value.endsWith(".localhost") || value === "0.0.0.0" ||
    value === "[::1]" || value === "[::]" || /^127\.\d+\.\d+\.\d+$/.test(value);
}

export function isPrivateHost(host) {
  return isLoopbackHost(host) || /^(0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[f[cd]|\[fe[89ab])/i.test(hostName(host));
}

export function browserUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("仅支持不含内嵌凭据的 HTTP(S) 地址。");
  return url;
}

export function isBrowserServiceUrl(raw, serviceOrigin) {
  if (!serviceOrigin) return false;
  try {
    const url = new URL(raw), service = new URL(serviceOrigin);
    const port = (u) => u.port || (["https:", "wss:"].includes(u.protocol) ? "443" : "80");
    return isLoopbackHost(url.hostname) && port(url) === port(service);
  } catch { return false; }
}
