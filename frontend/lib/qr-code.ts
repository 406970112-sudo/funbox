export type QrContentType = 'link' | 'text' | 'wifi' | 'contact';
export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

export type QrContentFields = {
  contactEmail: string;
  contactName: string;
  contactPhone: string;
  link: string;
  text: string;
  wifiHidden: boolean;
  wifiPassword: string;
  wifiSecurity: WifiSecurity;
  wifiSsid: string;
};

export type QrValidationResult = {
  caption: string;
  error: string | null;
  payload: string;
};

export const DEFAULT_QR_FIELDS: QrContentFields = {
  contactEmail: 'hello@funbox.app',
  contactName: 'FunBox',
  contactPhone: '13800138000',
  link: 'https://funbox.app/download',
  text: '欢迎使用 FunBox',
  wifiHidden: false,
  wifiPassword: 'funbox2026',
  wifiSecurity: 'WPA',
  wifiSsid: 'FunBox WiFi',
};

export function validateQrContent(
  type: QrContentType,
  fields: QrContentFields,
): QrValidationResult {
  if (type === 'link') {
    const value = fields.link.trim();

    if (!value) {
      return invalid('请输入需要生成二维码的链接。');
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
      return invalid('请输入有效的 HTTP 或 HTTPS 链接。');
    }

    const normalizedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;

    try {
      const url = new URL(normalizedValue);

      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
        return invalid('请输入有效的 HTTP 或 HTTPS 链接。');
      }

      return {
        caption: url.hostname.replace(/^www\./, ''),
        error: null,
        payload: url.toString(),
      };
    } catch {
      return invalid('链接格式不正确，请检查后重试。');
    }
  }

  if (type === 'text') {
    const value = fields.text.trim();

    return value
      ? { caption: '文本内容', error: null, payload: value }
      : invalid('请输入需要放入二维码的文本。');
  }

  if (type === 'wifi') {
    const ssid = fields.wifiSsid.trim();

    if (!ssid) {
      return invalid('请输入 Wi-Fi 名称。');
    }

    if (fields.wifiSecurity !== 'nopass' && !fields.wifiPassword) {
      return invalid('加密网络需要填写 Wi-Fi 密码。');
    }

    const password = fields.wifiSecurity === 'nopass' ? '' : fields.wifiPassword;
    const payload = [
      `WIFI:T:${fields.wifiSecurity}`,
      `S:${escapeWifiValue(ssid)}`,
      `P:${escapeWifiValue(password)}`,
      `H:${fields.wifiHidden ? 'true' : 'false'}`,
      '',
    ].join(';');

    return { caption: ssid, error: null, payload };
  }

  const name = fields.contactName.trim();
  const phone = fields.contactPhone.trim();
  const email = fields.contactEmail.trim();

  if (!name) {
    return invalid('请输入联系人姓名。');
  }

  if (!phone && !email) {
    return invalid('手机号和邮箱至少填写一项。');
  }

  const payload = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCardValue(name)}`,
    phone ? `TEL;TYPE=CELL:${escapeVCardValue(phone)}` : null,
    email ? `EMAIL:${escapeVCardValue(email)}` : null,
    'END:VCARD',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return { caption: name, error: null, payload };
}

export function fileSafeQrName(caption: string): string {
  const normalized = caption
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

  return normalized || 'funbox-qr';
}

function invalid(error: string): QrValidationResult {
  return { caption: '等待输入', error, payload: '' };
}

function escapeWifiValue(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}
