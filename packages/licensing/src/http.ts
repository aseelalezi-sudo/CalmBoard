/**
 * A transport for the LicenseHub public API. The concrete `LicenseClient`
 * talks real HTTP; tests can inject a fake by implementing `LicenseTransport`.
 */
export type ServerResponse = {
  ok: boolean;
  status: number;
  data: Record<string, any>;
  code?: string;
  message?: string;
  transportError: boolean;
};

export type TransportOptions = {
  baseUrl: string;
  timeoutMs: number;
  clientName: string;
  clientVersion: string;
  fetchImpl?: typeof fetch;
};

export interface LicenseTransport {
  activate(args: {
    licenseKey: string;
    fingerprint: string;
    deviceName?: string;
    platform?: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse>;

  validate(args: {
    licenseKey: string;
    fingerprint: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse>;

  heartbeat(args: {
    licenseKey: string;
    fingerprint: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse>;

  deactivate(args: {
    licenseKey: string;
    fingerprint: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse>;

  keys(ip?: string | null, userAgent?: string | null): Promise<ServerResponse>;
}

type LicenseClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  clientName: string;
  clientVersion: string;
  fetchImpl?: typeof fetch;
};

export class LicenseClient implements LicenseTransport {
  private readonly root: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LicenseClientOptions) {
    this.root = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  activate(args: {
    licenseKey: string;
    fingerprint: string;
    deviceName?: string;
    platform?: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse> {
    return this.request(
      "POST",
      "/licenses/activate",
      {
        license_key: args.licenseKey,
        device: {
          fingerprint: args.fingerprint,
          name: args.deviceName,
          platform: args.platform ?? "web",
        },
        client: { name: this.options.clientName, version: this.options.clientVersion },
      },
      args.ip,
      args.userAgent,
    );
  }

  validate(args: {
    licenseKey: string;
    fingerprint: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse> {
    return this.request(
      "POST",
      "/licenses/validate",
      {
        license_key: args.licenseKey,
        device: { fingerprint: args.fingerprint },
      },
      args.ip,
      args.userAgent,
    );
  }

  heartbeat(args: {
    licenseKey: string;
    fingerprint: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse> {
    return this.request(
      "POST",
      "/licenses/heartbeat",
      {
        license_key: args.licenseKey,
        device: { fingerprint: args.fingerprint },
      },
      args.ip,
      args.userAgent,
    );
  }

  deactivate(args: {
    licenseKey: string;
    fingerprint: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ServerResponse> {
    return this.request(
      "POST",
      "/licenses/deactivate",
      {
        license_key: args.licenseKey,
        device: { fingerprint: args.fingerprint },
      },
      args.ip,
      args.userAgent,
    );
  }

  keys(ip?: string | null, userAgent?: string | null): Promise<ServerResponse> {
    return this.request("GET", "/keys", null, ip, userAgent);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | null,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<ServerResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.root}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(ip ? { "x-device-ip": ip } : {}),
          ...(userAgent ? { "user-agent": userAgent } : {}),
        },
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, status: 0, data: {}, code: "network_error", transportError: true };
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    const data = (payload as { data?: unknown })?.data;
    if (response.ok && data !== undefined) {
      return {
        ok: true,
        status: response.status,
        data: typeof data === "object" && data !== null ? (data as Record<string, any>) : {},
        transportError: false,
      };
    }

    return {
      ok: false,
      status: response.status,
      data: {},
      code: (payload as { error?: { code?: string } })?.error?.code,
      message: (payload as { error?: { message?: string } })?.error?.message,
      transportError: false,
    };
  }
}
