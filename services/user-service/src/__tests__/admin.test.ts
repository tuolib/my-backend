/**
 * 管理员 API 集成测试
 * 测试登录 → 改密 → profile → 管理员 CRUD（超级管理员专属）
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../index';
import { generateId, hashPassword } from '@repo/shared';
import { db, admins } from '@repo/database';

const BASE = 'http://localhost';
const testUsername = `admin-test-${Date.now()}`;
const testPassword = 'TestPass123';

// 超级管理员 token（通过 login 获取）
let superToken = '';
// 创建的普通管理员 ID
let createdAdminId = '';

/** 测试前插入一个超级管理员 */
let superAdminId = '';
beforeAll(async () => {
  superAdminId = generateId();
  const hashedPw = await hashPassword(testPassword);
  await db.insert(admins).values({
    id: superAdminId,
    username: testUsername,
    password: hashedPw,
    realName: '测试超管',
    role: 'admin',
    isSuper: true,
    status: 'active',
    mustChangePassword: false,
  }).onConflictDoNothing({ target: admins.username });
});

function req(path: string, body?: unknown, headers?: Record<string, string>) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(superToken ? { Authorization: `Bearer ${superToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Admin Auth API', () => {
  // 1. 登录成功
  test('POST /api/v1/admin/auth/login — 登录成功', async () => {
    const res = await req('/api/v1/admin/auth/login', {
      username: testUsername,
      password: testPassword,
    }, { Authorization: '' }); // 不携带旧 token
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.admin.username).toBe(testUsername);
    expect(json.data.admin.isSuper).toBe(true);
    expect(json.data.accessToken).toBeDefined();
    expect(json.data.mustChangePassword).toBe(false);
    superToken = json.data.accessToken;
  });

  // 2. 用户名不存在
  test('POST /api/v1/admin/auth/login — 用户名不存在返回 401', async () => {
    const res = await req('/api/v1/admin/auth/login', {
      username: 'nonexistent',
      password: testPassword,
    }, { Authorization: '' });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.meta.code).toBe('ADMIN_5002');
  });

  // 3. 密码错误
  test('POST /api/v1/admin/auth/login — 密码错误返回 401', async () => {
    const res = await req('/api/v1/admin/auth/login', {
      username: testUsername,
      password: 'wrong-password',
    }, { Authorization: '' });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.meta.code).toBe('ADMIN_5002');
  });

  // 4. 获取 profile
  test('POST /api/v1/admin/auth/profile — 获取管理员信息', async () => {
    const res = await req('/api/v1/admin/auth/profile');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.username).toBe(testUsername);
    expect(json.data.role).toBe('admin');
  });

  // 5. 无 token 访问需认证接口
  test('POST /api/v1/admin/auth/profile — 无 token 返回 401', async () => {
    const res = await app.request(`${BASE}/api/v1/admin/auth/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });
});

describe('Admin Manage API (Super Admin)', () => {
  const newAdminUsername = `staff-${Date.now()}`;

  // 1. 创建管理员
  test('POST /api/v1/admin/manage/create — 创建管理员', async () => {
    const res = await req('/api/v1/admin/manage/create', {
      username: newAdminUsername,
      password: 'StaffPass123',
      realName: '运营小王',
      role: 'operator',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.username).toBe(newAdminUsername);
    expect(json.data.role).toBe('operator');
    expect(json.data.isSuper).toBe(false);
    createdAdminId = json.data.id;
  });

  // 2. 重复用户名
  test('POST /api/v1/admin/manage/create — 重复用户名返回 409', async () => {
    const res = await req('/api/v1/admin/manage/create', {
      username: newAdminUsername,
      password: 'StaffPass123',
      role: 'operator',
    });
    expect(res.status).toBe(409);
  });

  // 3. 管理员列表
  test('POST /api/v1/admin/manage/list — 分页列表', async () => {
    const res = await req('/api/v1/admin/manage/list', {
      page: 1,
      pageSize: 10,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
    expect(json.data.pagination).toBeDefined();
  });

  // 4. 关键词搜索
  test('POST /api/v1/admin/manage/list — 关键词搜索', async () => {
    const res = await req('/api/v1/admin/manage/list', {
      page: 1,
      pageSize: 10,
      keyword: newAdminUsername,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items.length).toBe(1);
    expect(json.data.items[0].username).toBe(newAdminUsername);
  });

  // 5. 更新管理员
  test('POST /api/v1/admin/manage/update — 更新管理员信息', async () => {
    const res = await req('/api/v1/admin/manage/update', {
      id: createdAdminId,
      realName: '运营小王（已更新）',
      role: 'viewer',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.realName).toBe('运营小王（已更新）');
    expect(json.data.role).toBe('viewer');
  });

  // 6. 禁用管理员
  test('POST /api/v1/admin/manage/toggle-status — 禁用', async () => {
    const res = await req('/api/v1/admin/manage/toggle-status', {
      id: createdAdminId,
      status: 'disabled',
    });
    expect(res.status).toBe(200);
  });

  // 7. 被禁用的管理员无法登录
  test('POST /api/v1/admin/auth/login — 被禁用账号返回 403', async () => {
    const res = await req('/api/v1/admin/auth/login', {
      username: newAdminUsername,
      password: 'StaffPass123',
    }, { Authorization: '' });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.meta.code).toBe('ADMIN_5004');
  });

  // 8. 启用管理员
  test('POST /api/v1/admin/manage/toggle-status — 启用', async () => {
    const res = await req('/api/v1/admin/manage/toggle-status', {
      id: createdAdminId,
      status: 'active',
    });
    expect(res.status).toBe(200);
  });

  // 9. 重置密码
  test('POST /api/v1/admin/manage/reset-password — 重置密码', async () => {
    const res = await req('/api/v1/admin/manage/reset-password', {
      id: createdAdminId,
      newPassword: 'NewPass456',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('密码已重置');
  });

  // 10. 重置后可以用新密码登录（且 mustChangePassword = true）
  test('POST /api/v1/admin/auth/login — 重置后用新密码登录', async () => {
    const res = await req('/api/v1/admin/auth/login', {
      username: newAdminUsername,
      password: 'NewPass456',
    }, { Authorization: '' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.mustChangePassword).toBe(true);
  });

  // 11. 不能修改超级管理员
  test('POST /api/v1/admin/manage/update — 不能修改超级管理员', async () => {
    const res = await req('/api/v1/admin/manage/update', {
      id: superAdminId,
      realName: '试图修改超管',
    });
    expect(res.status).toBe(403);
  });

  // 12. 不能禁用超级管理员
  test('POST /api/v1/admin/manage/toggle-status — 不能禁用超级管理员', async () => {
    const res = await req('/api/v1/admin/manage/toggle-status', {
      id: superAdminId,
      status: 'disabled',
    });
    expect(res.status).toBe(403);
  });
});

describe('Admin Auth — Change Password', () => {
  const changePwUsername = `changepw-${Date.now()}`;
  const initialPassword = 'Initial123';
  let changePwToken = '';

  beforeAll(async () => {
    // 创建一个需要改密的管理员
    const hashedPw = await hashPassword(initialPassword);
    await db.insert(admins).values({
      id: generateId(),
      username: changePwUsername,
      password: hashedPw,
      role: 'operator',
      isSuper: false,
      status: 'active',
      mustChangePassword: true,
    });

    // 登录获取 token
    const res = await app.request(`${BASE}/api/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: changePwUsername, password: initialPassword }),
    });
    const json = await res.json();
    changePwToken = json.data.accessToken;
  });

  test('POST /api/v1/admin/auth/change-password — 修改密码成功', async () => {
    const res = await app.request(`${BASE}/api/v1/admin/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${changePwToken}`,
      },
      body: JSON.stringify({
        oldPassword: initialPassword,
        newPassword: 'NewSecure456',
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('密码修改成功');
  });

  test('POST /api/v1/admin/auth/change-password — 新旧密码相同返回 400', async () => {
    // 先用新密码登录获取新 token
    const loginRes = await app.request(`${BASE}/api/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: changePwUsername, password: 'NewSecure456' }),
    });
    const loginJson = await loginRes.json();
    const newToken = loginJson.data.accessToken;

    const res = await app.request(`${BASE}/api/v1/admin/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newToken}`,
      },
      body: JSON.stringify({
        oldPassword: 'NewSecure456',
        newPassword: 'NewSecure456',
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.meta.code).toBe('ADMIN_5006');
  });
});
