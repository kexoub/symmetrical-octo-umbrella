// S3 客户端工具类 - 使用 AWS S3 兼容 API
export class S3Client {
  private endpoint: string;
  private bucket: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;

  constructor(config: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
  }) {
    this.endpoint = config.endpoint.replace(/\/$/, ''); // 移除末尾斜杠
    this.bucket = config.bucket;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region = config.region || 'auto';
  }

  // 生成 AWS Signature V4
  private async signRequest(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: ArrayBuffer | Uint8Array
  ): Promise<Record<string, string>> {
    const date = new Date();
    const dateStamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
    const timeStamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    
    const host = new URL(this.endpoint).host;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    
    // 计算 body hash
    const bodyHash = body 
      ? await this.sha256(body)
      : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // empty string hash

    // 规范请求
    const canonicalRequest = [
      method,
      path,
      '', // query string
      `host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${timeStamp}\n`,
      signedHeaders,
      bodyHash
    ].join('\n');

    // 待签名字符串
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timeStamp,
      credentialScope,
      await this.sha256(new TextEncoder().encode(canonicalRequest))
    ].join('\n');

    // 计算签名
    const signingKey = await this.getSigningKey(dateStamp);
    const signature = await this.hmacHex(signingKey, stringToSign);

    // 授权头
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      'Host': host,
      'X-Amz-Date': timeStamp,
      'X-Amz-Content-SHA256': bodyHash,
      'Authorization': authorization,
    };
  }

  private async getSigningKey(dateStamp: string): Promise<ArrayBuffer> {
    const kDate = await this.hmac(
      new TextEncoder().encode(`AWS4${this.secretAccessKey}`),
      dateStamp
    );
    const kRegion = await this.hmac(kDate, this.region);
    const kService = await this.hmac(kRegion, 's3');
    const kSigning = await this.hmac(kService, 'aws4_request');
    return kSigning;
  }

  private async hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  }

  private async hmacHex(key: ArrayBuffer, message: string): Promise<string> {
    const signature = await this.hmac(key, message);
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 上传文件
  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void> {
    const path = `/${this.bucket}/${key}`;
    const headers = await this.signRequest('PUT', path, {
      'Content-Type': contentType,
    }, body);

    const response = await fetch(`${this.endpoint}${path}`, {
      method: 'PUT',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`S3 upload failed: ${response.status} ${errorText}`);
    }
  }

  // 获取文件
  async get(key: string): Promise<{ body: ReadableStream | null; contentType: string; size: number } | null> {
    const path = `/${this.bucket}/${key}`;
    const headers = await this.signRequest('GET', path);

    const response = await fetch(`${this.endpoint}${path}`, {
      method: 'GET',
      headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`S3 get failed: ${response.status}`);
    }

    return {
      body: response.body,
      contentType: response.headers.get('Content-Type') || 'application/octet-stream',
      size: parseInt(response.headers.get('Content-Length') || '0'),
    };
  }

  // 删除文件
  async delete(key: string): Promise<void> {
    const path = `/${this.bucket}/${key}`;
    const headers = await this.signRequest('DELETE', path);

    const response = await fetch(`${this.endpoint}${path}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed: ${response.status}`);
    }
  }

  // 生成公开访问URL
  getPublicUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }
}

// 创建 S3 客户端实例的辅助函数
export function createS3Client(env: {
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_REGION?: string;
}): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    region: env.S3_REGION,
  });
}
