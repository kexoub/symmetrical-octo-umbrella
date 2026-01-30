import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/types';

import type { Bindings, Passkey } from '../types';
import { getOrCreateUser, getUser, getUserPasskeys, getPasskeyById } from '../lib/passkeys';
import { 
  successResponse, 
  errors, 
  errorResponse,
  createLogger,
  HTTP_STATUS,
  ERROR_CODES,
  getCurrentTimestamp 
} from '../lib/api-utils';

const app = new Hono<{ Bindings: Bindings }>();
const logger = createLogger('AuthRoute');

// 常量定义
const CHALLENGE_TTL = 300; // 5分钟
const SESSION_TTL = 86400; // 24小时

// ============ 验证 Schema ============

const registerChallengeSchema = z.object({
  username: z.string()
    .min(3, '用户名至少需要3个字符')
    .max(50, '用户名不能超过50个字符')
    .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, '用户名只能包含字母、数字、下划线、横线和中文'),
  email: z.string().email('请输入有效的邮箱地址'),
});

// ============ 辅助函数 ============

// 获取 RP ID
function getRpID(c: Hono.Context<{ Bindings: Bindings }>): string {
  return c.env.RP_ID || new URL(c.req.url).hostname;
}

// 获取 Origin
function getOrigin(c: Hono.Context<{ Bindings: Bindings }>): string {
  return c.env.ORIGIN || new URL(c.req.url).origin;
}

// 从客户端数据中提取 challenge
function extractChallengeFromClientData(response: RegistrationResponseJSON | AuthenticationResponseJSON): string | null {
  try {
    const clientDataJSON = response.response.clientDataJSON;
    const clientData = JSON.parse(
      new TextDecoder().decode(
        typeof clientDataJSON === 'string'
          ? Uint8Array.from(atob(clientDataJSON.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
          : new Uint8Array(clientDataJSON)
      )
    );
    return clientData.challenge;
  } catch (error) {
    logger.error('Failed to extract challenge from client data', error);
    return null;
  }
}

// 创建会话
async function createSession(
  kv: KVNamespace,
  userId: string,
  ttl: number = SESSION_TTL
): Promise<string> {
  const sessionToken = crypto.randomUUID();
  await kv.put(`session:${sessionToken}`, userId, { expirationTtl: ttl });
  return sessionToken;
}

// 存储 challenge
async function storeChallenge(
  kv: KVNamespace,
  challenge: string,
  value: string,
  ttl: number = CHALLENGE_TTL
): Promise<void> {
  await kv.put(`challenge:${challenge}`, value, { expirationTtl: ttl });
}

// 获取并删除 challenge
async function getAndDeleteChallenge(
  kv: KVNamespace,
  challenge: string
): Promise<string | null> {
  const key = `challenge:${challenge}`;
  const value = await kv.get(key);
  if (value) {
    await kv.delete(key);
  }
  return value;
}

// ============ 路由定义 ============

// 注册 - 生成挑战
app.post('/register/challenge', zValidator('json', registerChallengeSchema), async (c) => {
  // 检查注册是否启用
  if (!c.env.REGISTER_ENABLED) {
    return errors.forbidden(c, '注册功能已禁用');
  }

  const { username, email } = c.req.valid('json');
  const rpID = getRpID(c);

  try {
    logger.info('Generating registration challenge', { username, email });

    // 检查用户是否已存在
    const existingUser = await getUser(c.env.DB, username, email);
    if (existingUser) {
      return errors.conflict(c, '用户名或邮箱已被注册');
    }

    // 获取或创建用户
    const user = await getOrCreateUser(c.env.DB, username, email);
    const userPasskeys = await getUserPasskeys(c.env.DB, user.id);

    // 生成注册选项
    const options = await generateRegistrationOptions({
      rpName: c.env.RP_NAME,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.username,
      excludeCredentials: userPasskeys.map(pk => ({
        id: pk.id,
        type: 'public-key',
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });

    // 存储 challenge
    await storeChallenge(c.env.KV_SESSIONS, options.challenge, user.id);

    logger.info('Registration challenge generated', { userId: user.id });
    return successResponse(c, options);
  } catch (error) {
    logger.error('Failed to generate registration challenge', error, { username, email });
    return errors.internal(c, '生成注册挑战失败');
  }
});

// 注册 - 验证响应
app.post('/register/verify', async (c) => {
  let response: RegistrationResponseJSON;
  
  try {
    const body = await c.req.json<{ response: RegistrationResponseJSON }>();
    response = body.response;
    
    if (!response) {
      return errors.validation(c, { response: '缺少响应数据' });
    }
  } catch (error) {
    return errors.validation(c, { body: '无效的请求体' });
  }

  const expectedChallenge = extractChallengeFromClientData(response);
  
  if (!expectedChallenge) {
    return errors.validation(c, { challenge: '无法从响应中提取 challenge' });
  }

  // 获取并验证 challenge
  const userId = await getAndDeleteChallenge(c.env.KV_SESSIONS, expectedChallenge);
  
  if (!userId) {
    return errorResponse(
      c,
      '挑战已过期或不存在，请重新尝试',
      ERROR_CODES.AUTH_SESSION_EXPIRED,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  const expectedRPID = getRpID(c);
  const expectedOrigin = getOrigin(c);

  try {
    logger.info('Verifying registration response', { userId });

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
    });

    const { verified, registrationInfo } = verification;

    if (!verified || !registrationInfo) {
      return errorResponse(
        c,
        '验证失败',
        ERROR_CODES.AUTH_UNAUTHORIZED,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const { credentialPublicKey, credentialID, counter } = registrationInfo;

    // 存储新的 Passkey
    await c.env.DB.prepare(`
      INSERT INTO Passkeys (id, user_id, pubkey_blob, sign_counter, created_at) 
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      credentialID,
      userId,
      credentialPublicKey as ArrayBuffer,
      counter,
      getCurrentTimestamp()
    ).run();

    // 创建会话
    const sessionToken = await createSession(c.env.KV_SESSIONS, userId);

    logger.info('Registration verified successfully', { userId });
    return successResponse(c, { verified: true, token: sessionToken });
  } catch (error) {
    logger.error('Failed to verify registration', error, { userId });
    return errorResponse(
      c,
      error instanceof Error ? error.message : '验证失败',
      ERROR_CODES.AUTH_UNAUTHORIZED,
      HTTP_STATUS.BAD_REQUEST
    );
  }
});

// 登录 - 生成挑战
app.post('/login/challenge', async (c) => {
  const rpID = getRpID(c);

  try {
    logger.info('Generating authentication challenge');

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });

    // 存储 challenge（值为 "true" 表示这是一个登录挑战）
    await storeChallenge(c.env.KV_SESSIONS, options.challenge, 'true');

    logger.info('Authentication challenge generated');
    return successResponse(c, options);
  } catch (error) {
    logger.error('Failed to generate authentication challenge', error);
    return errors.internal(c, '生成登录挑战失败');
  }
});

// 登录 - 验证响应
app.post('/login/verify', async (c) => {
  let response: AuthenticationResponseJSON;
  
  try {
    response = await c.req.json<AuthenticationResponseJSON>();
    
    if (!response) {
      return errors.validation(c, { response: '缺少响应数据' });
    }
  } catch (error) {
    return errors.validation(c, { body: '无效的请求体' });
  }

  const challenge = extractChallengeFromClientData(response);
  
  if (!challenge) {
    return errors.validation(c, { challenge: '无法从响应中提取 challenge' });
  }

  // 获取并删除 challenge
  const expectedChallenge = await getAndDeleteChallenge(c.env.KV_SESSIONS, challenge);
  
  if (!expectedChallenge) {
    return errorResponse(
      c,
      '挑战已过期或不存在',
      ERROR_CODES.AUTH_SESSION_EXPIRED,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // 获取 passkey
  const passkey = await getPasskeyById(c.env.DB, response.id);
  if (!passkey) {
    return errors.notFound(c, '凭证');
  }

  const expectedRPID = getRpID(c);
  const expectedOrigin = getOrigin(c);

  try {
    logger.info('Verifying authentication response', { passkeyId: passkey.id });

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID,
      authenticator: {
        credentialID: passkey.id,
        credentialPublicKey: new Uint8Array(passkey.pubkey_blob),
        counter: passkey.sign_counter,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return errorResponse(
        c,
        '验证失败',
        ERROR_CODES.AUTH_UNAUTHORIZED,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const { authenticationInfo } = verification;

    // 更新签名计数器
    await c.env.DB.prepare('UPDATE Passkeys SET sign_counter = ? WHERE id = ?')
      .bind(authenticationInfo.newCounter, passkey.id)
      .run();

    // 创建会话
    const sessionToken = await createSession(c.env.KV_SESSIONS, passkey.user_id);

    logger.info('Authentication verified successfully', { userId: passkey.user_id });
    return successResponse(c, { verified: true, token: sessionToken });
  } catch (error) {
    logger.error('Failed to verify authentication', error, { passkeyId: passkey.id });
    return errorResponse(
      c,
      error instanceof Error ? error.message : '验证失败',
      ERROR_CODES.AUTH_UNAUTHORIZED,
      HTTP_STATUS.BAD_REQUEST
    );
  }
});

// 退出登录
app.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errors.unauthorized(c, '缺少有效的认证令牌');
  }

  const token = authHeader.split(' ')[1];
  
  try {
    logger.info('Logging out user', { token: token.substring(0, 8) + '...' });
    
    await c.env.KV_SESSIONS.delete(`session:${token}`);
    
    logger.info('User logged out successfully');
    return successResponse(c, null, '退出登录成功');
  } catch (error) {
    logger.error('Failed to logout', error);
    return errors.internal(c, '退出登录失败');
  }
});

// 检查会话状态
app.get('/session', async (c) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return successResponse(c, { valid: false });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const userId = await c.env.KV_SESSIONS.get(`session:${token}`);
    
    if (!userId) {
      return successResponse(c, { valid: false });
    }

    // 获取用户基本信息
    const user = await c.env.DB.prepare(`
      SELECT id, username, email, role, level, avatar 
      FROM Users 
      WHERE id = ?
    `).bind(userId).first<{
      id: string;
      username: string;
      email: string;
      role: string;
      level: number;
      avatar?: string;
    }>();

    if (!user) {
      // 用户不存在，删除无效会话
      await c.env.KV_SESSIONS.delete(`session:${token}`);
      return successResponse(c, { valid: false });
    }

    return successResponse(c, { valid: true, user });
  } catch (error) {
    logger.error('Failed to check session', error);
    return errors.internal(c, '检查会话状态失败');
  }
});

export default app;
