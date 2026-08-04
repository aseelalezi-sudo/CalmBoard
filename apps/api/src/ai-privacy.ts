type SanitizableAIRequest = {
  text: string;
  tasks: Array<{ serial: string; title: string }>;
};

type SensitiveKind =
  | "SECRET"
  | "AUTH_TOKEN"
  | "API_KEY"
  | "PRIVATE_KEY"
  | "EMAIL"
  | "PHONE"
  | "PAYMENT_CARD"
  | "IBAN"
  | "IP_ADDRESS"
  | "UUID"
  | "NATIONAL_ID"
  | "SENSITIVE_URL"
  | "TASK_REFERENCE";

const secretParameterNames = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "credential",
  "key",
  "password",
  "refresh_token",
  "secret",
  "signature",
  "sig",
  "token",
]);

class RequestSanitizer {
  private readonly replacements = new Map<SensitiveKind, Map<string, string>>();

  private replacement(kind: SensitiveKind, value: string) {
    let values = this.replacements.get(kind);
    if (!values) {
      values = new Map();
      this.replacements.set(kind, values);
    }
    const existing = values.get(value);
    if (existing) return existing;
    const replacement = `[${kind}_${values.size + 1}]`;
    values.set(value, replacement);
    return replacement;
  }

  taskReference(value: string) {
    return this.replacement("TASK_REFERENCE", value);
  }

  text(value: string) {
    let sanitized = value;

    sanitized = sanitized.replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
      (privateKey) => this.replacement("PRIVATE_KEY", privateKey),
    );
    sanitized = sanitized.replace(/\bssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]{20,}(?:\s+[^\r\n]+)?/gu, (privateKey) =>
      this.replacement("PRIVATE_KEY", privateKey),
    );

    sanitized = sanitized.replace(
      /(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s<>"']+/giu,
      (candidate) => {
        const trailing = candidate.match(/[),.;!?،؛]+$/u)?.[0] ?? "";
        const urlValue = trailing ? candidate.slice(0, -trailing.length) : candidate;
        try {
          const url = new URL(urlValue);
          const hasSecretParameter = [...url.searchParams.keys()].some((key) =>
            secretParameterNames.has(key.toLowerCase()),
          );
          if (url.username || url.password || hasSecretParameter) {
            return `${this.replacement("SENSITIVE_URL", urlValue)}${trailing}`;
          }
        } catch {
          // A malformed URL is handled by the remaining token and identity filters.
        }
        return candidate;
      },
    );

    sanitized = sanitized.replace(
      /\b(Bearer|Basic)\s+([A-Za-z0-9+/_=-]{8,})/giu,
      (_match, scheme: string, credential: string) => `${scheme} ${this.replacement("AUTH_TOKEN", credential)}`,
    );

    sanitized = sanitized.replace(
      /(^|[\s,{])((?:password|passwd|secret|token|api[_ -]?key|access[_ -]?key|client[_ -]?secret|authorization|كلمة\s+المرور|رمز\s+الوصول|المفتاح\s+السري|مفتاح\s+api))\s*([:=：])\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\r\n]+)/gimu,
      (_match, prefix: string, label: string, separator: string, secret: string) =>
        `${prefix}${label}${separator}${this.replacement("SECRET", secret)}`,
    );

    sanitized = sanitized.replace(
      /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})\b/gu,
      (secret) => this.replacement("API_KEY", secret),
    );

    sanitized = sanitized.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu, (token) =>
      this.replacement("AUTH_TOKEN", token),
    );

    sanitized = sanitized.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/giu, (iban) => this.replacement("IBAN", iban));

    sanitized = sanitized.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/giu, (email) =>
      this.replacement("EMAIL", email.toLowerCase()),
    );

    sanitized = sanitized.replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/gu, (address) =>
      address.split(".").every((octet) => Number(octet) <= 255) ? this.replacement("IP_ADDRESS", address) : address,
    );

    sanitized = sanitized.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      (uuid) => this.replacement("UUID", uuid.toLowerCase()),
    );

    sanitized = sanitized.replace(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/gu, (identifier) =>
      this.replacement("NATIONAL_ID", identifier),
    );
    sanitized = sanitized.replace(/(?<!\d)[12]\d{9}(?!\d)/gu, (identifier) =>
      this.replacement("NATIONAL_ID", identifier),
    );

    sanitized = sanitized.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu, (candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && validLuhn(digits)
        ? this.replacement("PAYMENT_CARD", digits)
        : candidate;
    });

    sanitized = sanitized.replace(/(?<!\d)\+\d(?:[\s().-]?\d){7,14}(?!\d)/gu, (phone) =>
      this.replacement("PHONE", phone.replace(/\D/g, "")),
    );
    sanitized = sanitized.replace(/(?<!\d)05\d{8}(?!\d)/gu, (phone) => this.replacement("PHONE", phone));

    return sanitized;
  }
}

function validLuhn(digits: string) {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function sanitizeAIProviderRequest<T extends SanitizableAIRequest>(request: T): T {
  const sanitizer = new RequestSanitizer();
  return {
    ...request,
    text: sanitizer.text(request.text),
    tasks: request.tasks.map((task) => ({
      ...task,
      serial: sanitizer.taskReference(task.serial),
      title: sanitizer.text(task.title),
    })),
  } as T;
}
