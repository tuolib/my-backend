/**
 * fix-seed-images.ts
 * 检查 seed 文件中所有图片链接：修复不可访问的 + 去除重复的
 *
 * 用法:
 *   bun packages/database/src/fix-seed-images.ts                  # 仅修复不可访问的图片
 *   bun packages/database/src/fix-seed-images.ts --dedup          # 修复 + 去重（需要 Unsplash API Key）
 *   bun packages/database/src/fix-seed-images.ts --dry-run        # 仅检测，不修改文件
 *   bun packages/database/src/fix-seed-images.ts --dedup --dry-run
 *
 * 环境变量:
 *   UNSPLASH_ACCESS_KEY  — Unsplash API 访问密钥（--dedup 模式必须）
 *                          免费申请: https://unsplash.com/oauth/applications
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ── 配置 ──
const CONCURRENCY = 20;
const TIMEOUT_MS = 8000;
const DRY_RUN = process.argv.includes('--dry-run');
const DEDUP = process.argv.includes('--dedup');
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY || '';

const DIR = resolve(import.meta.dir);
const FILES = [
  resolve(DIR, 'seed-images.ts'),
  resolve(DIR, 'seed.ts'),
  resolve(DIR, 'seed-prod.ts'),
];

const UNSPLASH_BASE = 'https://images.unsplash.com/photo-';
const UNSPLASH_SUFFIX = '?w=800&h=800&fit=crop';
const CDN_BASE = 'https://cdn.dummyjson.com/product-images';

// ── Unsplash API 速率限制（官方免费版: 50 requests/hour） ──
const UNSPLASH_RATE_LIMIT = 50;
const UNSPLASH_REQUEST_INTERVAL_MS = 1500; // 请求间隔 1.5 秒，避免过快

class UnsplashRateLimiter {
  private requestTimestamps: number[] = [];
  private requestCount = 0;
  private exhausted = false;

  /** 清除超过 1 小时的旧记录 */
  private pruneOld(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.requestTimestamps = this.requestTimestamps.filter((t) => t > oneHourAgo);
  }

  /** 是否还有剩余配额 */
  hasQuota(): boolean {
    if (this.exhausted) return false;
    this.pruneOld();
    return this.requestTimestamps.length < UNSPLASH_RATE_LIMIT;
  }

  /** 剩余配额数 */
  remaining(): number {
    if (this.exhausted) return 0;
    this.pruneOld();
    return Math.max(0, UNSPLASH_RATE_LIMIT - this.requestTimestamps.length);
  }

  /** 标记为配额耗尽（服务端返回 429/403 时调用） */
  markExhausted(): void {
    this.exhausted = true;
  }

  /** 本次运行总请求数 */
  total(): number {
    return this.requestCount;
  }

  /**
   * 等待直到可以发送下一个请求。
   * 返回 false 表示配额已用尽，调用方应停止请求。
   */
  async waitForSlot(): Promise<boolean> {
    if (!this.hasQuota()) return false;

    // 确保与上一次请求保持间隔
    if (this.requestTimestamps.length > 0) {
      const last = this.requestTimestamps[this.requestTimestamps.length - 1];
      const wait = UNSPLASH_REQUEST_INTERVAL_MS - (Date.now() - last);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    return this.hasQuota();
  }

  /** 记录一次 API 请求 */
  record(): void {
    this.requestTimestamps.push(Date.now());
    this.requestCount++;
  }
}

const rateLimiter = new UnsplashRateLimiter();

// ── 分类 → Unsplash 搜索关键词 ──
const CATEGORY_KEYWORDS: Record<string, string> = {
  phones: 'smartphone mobile phone',
  earphones: 'headphones earbuds wireless earphones',
  'smart-watches': 'smartwatch wearable watch',
  laptops: 'laptop notebook computer',
  tablets: 'tablet ipad digital device',
  keyboards: 'keyboard mechanical keyboard',
  'big-appliance': 'home appliance refrigerator washing machine',
  'small-appliance': 'small home appliance blender vacuum',
  'kitchen-appliance': 'kitchen appliance cookware',
  menswear: 'mens fashion clothing style',
  womenswear: 'womens fashion dress clothing',
  shoes: 'shoes sneakers footwear',
  snacks: 'snacks food candy chips',
  drinks: 'beverages drinks coffee tea',
  fresh: 'fresh fruit vegetables produce',
  skincare: 'skincare beauty cosmetics serum',
  makeup: 'makeup lipstick beauty cosmetics',
  'wash-care': 'body wash shampoo personal care',
  literature: 'books reading literature novel',
  education: 'education textbook study learning',
  comic: 'comic manga anime illustration',
  fitness: 'fitness gym workout equipment',
  outdoor: 'outdoor hiking camping adventure',
  sportswear: 'sportswear athletic clothing',
  furniture: 'furniture interior design chair table',
  bedding: 'bedding pillow bedroom sheets',
  storage: 'storage organizer home shelf',
  'milk-powder': 'baby milk formula infant',
  diapers: 'baby diaper infant care',
  toys: 'toys children play colorful',
};

// ── 备选图片池（--dedup 模式没有 API key 时的兜底） ──
const FALLBACK_UNSPLASH_IDS = [
  '1523275335684-37898b6baf30',
  '1505740420928-5e560c06d30e',
  '1496181133206-80ce9b88a853',
  '1542291026-7eec264c27ff',
  '1555041469-a586c5baa691',
  '1526506118085-60ce8714f8c5',
  '1504280390367-361c6d9f38f4',
  '1558171813-01ed3d751f21',
  '1544145945-f90425340c7e',
  '1512820790803-83ca734da794',
  '1534438327276-14e5300c3a48',
  '1489987707025-afc232f7ea0f',
  '1556228578-8c89e6adf883',
  '1599490659213-e2c5673dbaff',
  '1558060318554-8b37e30fd5fa',
  '1584568694244-14fbdf83bd30',
  '1566748861876-c7e74c17eb5a',
  '1544244015-0df4b3ffc6b0',
  '1522771739844-6a9f6d5f14af',
  '1558997519-83ea9252edf8',
];

// ── 工具函数 ──
async function checkUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

async function checkUrls(urls: string[]): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const queue = [...urls];
  let completed = 0;
  const total = queue.length;

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift()!;
      const ok = await checkUrl(url);
      results.set(url, ok);
      completed++;
      if (completed % 20 === 0 || completed === total) {
        console.log(`  [${completed}/${total}] 已检测...`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return results;
}

/** 从 Unsplash API 搜索图片，返回 photo ID 列表（受速率限制保护） */
async function searchUnsplash(query: string, perPage = 30, page = 1): Promise<string[]> {
  // 检查并等待速率限制
  const canProceed = await rateLimiter.waitForSlot();
  if (!canProceed) {
    console.warn(`  ⚠ 已达到 Unsplash API 每小时 ${UNSPLASH_RATE_LIMIT} 次请求限制，停止请求`);
    return [];
  }

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&orientation=squarish`;
  try {
    rateLimiter.record();
    console.log(`  [API ${rateLimiter.total()}/${UNSPLASH_RATE_LIMIT}] 搜索: "${query}" (page ${page})`);

    const resp = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    });

    // 读取服务端返回的速率限制信息
    const serverRemaining = resp.headers.get('X-Ratelimit-Remaining');
    if (serverRemaining !== null) {
      console.log(`    服务端剩余配额: ${serverRemaining}`);
    }

    // 服务端触发速率限制
    if (resp.status === 429 || resp.status === 403) {
      console.error(`  ⚠ Unsplash API 返回 ${resp.status}，速率限制已触发，停止所有请求`);
      rateLimiter.markExhausted();
      return [];
    }

    if (!resp.ok) {
      console.error(`  Unsplash API 错误: ${resp.status} ${resp.statusText}`);
      return [];
    }
    const data = (await resp.json()) as { results: { id: string; urls: { raw: string } }[] };
    // 从 raw URL 中提取 photo ID (格式: https://images.unsplash.com/photo-{ID}?ixid=...)
    return data.results
      .map((r) => {
        const match = r.urls.raw.match(/photo-([^?]+)/);
        return match ? match[1] : '';
      })
      .filter(Boolean);
  } catch (err) {
    console.error(`  Unsplash API 请求失败:`, err);
    return [];
  }
}

// ── 解析 seed-images.ts 结构：保留分类上下文 ──

interface CategoryEntry {
  category: string;
  ids: string[];              // 按顺序的所有 ID（含重复）
  lineStart: number;          // 数组开始行号
  lineEnd: number;            // 数组结束行号
}

/** 解析 seed-images.ts，提取每个分类及其图片 ID 列表（保留重复和顺序） */
function parseSeedImages(content: string): CategoryEntry[] {
  const lines = content.split('\n');
  const entries: CategoryEntry[] = [];
  // 匹配分类 key 行，如: phones: [    或    'smart-watches': [
  const catStartRe = /^\s*'?([a-z][\w-]*)'?\s*:\s*\[/;
  let current: CategoryEntry | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!current) {
      const m = catStartRe.exec(line);
      if (m) {
        current = { category: m[1], ids: [], lineStart: i, lineEnd: -1 };
        // 同一行可能有 u() 调用
        for (const um of line.matchAll(/u\('([^']+)'\)/g)) {
          current.ids.push(um[1]);
        }
      }
    } else {
      // 收集 u() 调用
      for (const um of line.matchAll(/u\('([^']+)'\)/g)) {
        current.ids.push(um[1]);
      }
      // 检查数组结束
      if (line.includes('],')) {
        current.lineEnd = i;
        entries.push(current);
        current = null;
      }
    }
  }
  return entries;
}

/** 从 seed.ts / seed-prod.ts 提取 cdnImg 路径（去重） */
function extractCdnPaths(content: string): string[] {
  return [...new Set([...content.matchAll(/cdnImg\('([^']+)'\)/g)].map((m) => m[1]))];
}

// ── 去重逻辑 ──

async function dedup() {
  console.log('=== 去重模式 ===\n');

  if (!UNSPLASH_KEY) {
    console.error(
      '错误: --dedup 需要 Unsplash API Key。\n' +
        '请设置环境变量: UNSPLASH_ACCESS_KEY=your_key\n' +
        '免费申请: https://unsplash.com/oauth/applications\n'
    );
    process.exit(1);
  }

  // 1) 读取并解析
  const seedImagesContent = readFileSync(FILES[0], 'utf-8');
  const categories = parseSeedImages(seedImagesContent);

  // 收集全局已用 ID（包括 seed.ts / seed-prod.ts 中引用的 seed-images 池）
  const globalUsedIds = new Set<string>();
  for (const cat of categories) {
    for (const id of cat.ids) globalUsedIds.add(id);
  }

  // 统计每个 ID 的全局出现次数
  const globalFreq = new Map<string, number>();
  for (const cat of categories) {
    for (const id of cat.ids) {
      globalFreq.set(id, (globalFreq.get(id) || 0) + 1);
    }
  }

  const duplicateIds = [...globalFreq].filter(([, c]) => c > 1);
  const totalDupReferences = duplicateIds.reduce((sum, [, c]) => sum + c - 1, 0);

  console.log(`分类数: ${categories.length}`);
  console.log(`总图片引用: ${categories.reduce((s, c) => s + c.ids.length, 0)}`);
  console.log(`唯一 ID 数: ${globalUsedIds.size}`);
  console.log(`重复 ID 数: ${duplicateIds.length} (共 ${totalDupReferences} 处需替换)`);

  if (duplicateIds.length === 0) {
    console.log('\n没有重复图片，无需去重!');
    return;
  }

  console.log(`\n重复 ID 详情 (前 30):`);
  duplicateIds
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([id, count]) => console.log(`  x${count} ${id}`));

  if (DRY_RUN) {
    console.log('\nDRY RUN 结束，未修改任何文件。');
    return;
  }

  // 2) 为每个分类，标记哪些位置需要替换
  //    策略：每个 ID 全局只保留第一次出现，后续出现全部替换
  const firstSeen = new Set<string>();
  const replacementPlan: { catIdx: number; posInCat: number; category: string }[] = [];

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    for (let pi = 0; pi < cat.ids.length; pi++) {
      const id = cat.ids[pi];
      if (firstSeen.has(id)) {
        replacementPlan.push({ catIdx: ci, posInCat: pi, category: cat.category });
      } else {
        firstSeen.add(id);
      }
    }
  }

  console.log(`\n需替换 ${replacementPlan.length} 处重复引用`);

  // 3) 按分类分组，批量从 Unsplash 搜索替换图片
  const byCat = new Map<string, { catIdx: number; posInCat: number }[]>();
  for (const rp of replacementPlan) {
    const list = byCat.get(rp.category) || [];
    list.push(rp);
    byCat.set(rp.category, list);
  }

  console.log('\n开始从 Unsplash 搜索替换图片...');
  console.log(`当前 API 配额: ${rateLimiter.remaining()}/${UNSPLASH_RATE_LIMIT} 次/小时\n`);

  // 收集新 ID 到一个全局 set，确保新图也不重复
  const allNewIds = new Set<string>(globalUsedIds);
  // 记录每个替换位置的新 ID
  const newIdMap = new Map<string, string>(); // `${catIdx}:${posInCat}` → newId
  let quotaExhausted = false;

  for (const [category, positions] of byCat) {
    const keyword = CATEGORY_KEYWORDS[category] || category.replace(/-/g, ' ');
    const needed = positions.length;

    // 检查配额是否已耗尽
    if (quotaExhausted || !rateLimiter.hasQuota()) {
      quotaExhausted = true;
      console.log(`  ${category}: 需要 ${needed} 张 → 配额已用尽，全部使用 picsum.photos 兜底`);
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        newIdMap.set(`${pos.catIdx}:${pos.posInCat}`, `PICSUM_${category}_${i}`);
      }
      continue;
    }

    console.log(`  ${category}: 需要 ${needed} 张新图 (搜索: "${keyword}") [剩余配额: ${rateLimiter.remaining()}]`);

    // 多页搜索以获取足够的候选
    const candidates: string[] = [];
    for (let page = 1; candidates.length < needed && page <= 5; page++) {
      // 每次搜索前再次检查配额
      if (!rateLimiter.hasQuota()) {
        console.warn(`    ⚠ API 配额已用尽，停止搜索`);
        quotaExhausted = true;
        break;
      }

      const ids = await searchUnsplash(keyword, 30, page);
      if (ids.length === 0 && !rateLimiter.hasQuota()) {
        // searchUnsplash 因配额耗尽返回空
        quotaExhausted = true;
        break;
      }
      for (const id of ids) {
        if (!allNewIds.has(id)) {
          candidates.push(id);
          allNewIds.add(id);
          if (candidates.length >= needed) break;
        }
      }
    }

    if (candidates.length < needed) {
      console.log(`    ⚠ 仅找到 ${candidates.length}/${needed} 张，剩余用 picsum.photos 兜底`);
    }

    // 分配新 ID
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const key = `${pos.catIdx}:${pos.posInCat}`;
      if (i < candidates.length) {
        newIdMap.set(key, candidates[i]);
      } else {
        // picsum 兜底
        const picsumId = `PICSUM_${category}_${i}`;
        newIdMap.set(key, picsumId);
      }
    }

    console.log(`    ✓ 已分配 ${Math.min(candidates.length, needed)} 张 Unsplash + ${Math.max(0, needed - candidates.length)} 张 picsum`);
  }

  if (quotaExhausted) {
    console.log(`\n⚠ Unsplash API 配额已耗尽（本次共使用 ${rateLimiter.total()} 次请求）`);
    console.log(`  部分分类已使用 picsum.photos 兜底，可稍后重新运行以获取更多 Unsplash 图片`);
  }

  // 4) 验证新图片可访问性
  const newUnsplashIds = [...newIdMap.values()].filter((id) => !id.startsWith('PICSUM_'));
  if (newUnsplashIds.length > 0) {
    console.log(`\n验证 ${newUnsplashIds.length} 张新图片可访问性...`);
    const urls = newUnsplashIds.map((id) => `${UNSPLASH_BASE}${id}${UNSPLASH_SUFFIX}`);
    const results = await checkUrls(urls);
    let failCount = 0;
    for (const [key, newId] of newIdMap) {
      if (newId.startsWith('PICSUM_')) continue;
      const url = `${UNSPLASH_BASE}${newId}${UNSPLASH_SUFFIX}`;
      if (!results.get(url)) {
        failCount++;
        // 不可访问的也用 picsum 兜底
        const [catIdx, posInCat] = key.split(':');
        newIdMap.set(key, `PICSUM_fallback_${catIdx}_${posInCat}`);
      }
    }
    if (failCount > 0) {
      console.log(`  ⚠ ${failCount} 张新图不可访问，已用 picsum 兜底`);
    } else {
      console.log(`  ✓ 全部可访问`);
    }
  }

  // 5) 在 categories 数组中执行替换
  for (const [key, newId] of newIdMap) {
    const [catIdxStr, posStr] = key.split(':');
    const catIdx = parseInt(catIdxStr);
    const pos = parseInt(posStr);
    categories[catIdx].ids[pos] = newId;
  }

  // 6) 重建 seed-images.ts
  console.log('\n写入 seed-images.ts...');
  const lines = seedImagesContent.split('\n');

  for (const cat of categories) {
    // 重建该分类的数组内容
    const indent = '    ';
    const newLines: string[] = [];

    for (let i = 0; i < cat.ids.length; i++) {
      const id = cat.ids[i];
      const comma = i < cat.ids.length - 1 ? ',' : ',';
      if (id.startsWith('PICSUM_')) {
        const catName = cat.category.replace(/-/g, '+');
        const picsumUrl = `https://picsum.photos/seed/${catName}${i}/800/800`;
        newLines.push(`${indent}'${picsumUrl}'${comma}`);
      } else {
        newLines.push(`${indent}u('${id}')${comma}`);
      }
    }

    // 替换 lineStart+1 到 lineEnd-1 之间的行（保留数组开始行和结束行）
    // 找到第一个 u() 调用所在行
    let contentStart = cat.lineStart;
    // 如果开始行本身没有 u() 调用，内容从下一行开始
    if (!/u\('/.test(lines[cat.lineStart]) && !/'https:\/\//.test(lines[cat.lineStart])) {
      contentStart = cat.lineStart + 1;
    }
    // 结束行如果只有 ], 则内容到 lineEnd - 1
    let contentEnd = cat.lineEnd;
    if (/^\s*\],?\s*$/.test(lines[cat.lineEnd])) {
      contentEnd = cat.lineEnd - 1;
    }

    // 替换
    lines.splice(contentStart, contentEnd - contentStart + 1, ...newLines);

    // 调整后续分类的行号偏移
    const delta = newLines.length - (contentEnd - contentStart + 1);
    for (const otherCat of categories) {
      if (otherCat.lineStart > cat.lineEnd) {
        otherCat.lineStart += delta;
        otherCat.lineEnd += delta;
      }
    }
  }

  const newContent = lines.join('\n');
  writeFileSync(FILES[0], newContent, 'utf-8');

  // 统计结果
  const finalIds = [...newContent.matchAll(/u\('([^']+)'\)/g)].map((m) => m[1]);
  const finalPicsum = [...newContent.matchAll(/'https:\/\/picsum\.photos/g)].length;
  const finalUnique = new Set(finalIds).size;
  console.log(`\n去重完成!`);
  console.log(`  Unsplash 图片: ${finalIds.length} 引用, ${finalUnique} 唯一`);
  console.log(`  Picsum 兜底: ${finalPicsum} 张`);
  console.log(`  重复数: ${finalIds.length - finalUnique}`);
  console.log(`  API 请求总计: ${rateLimiter.total()}/${UNSPLASH_RATE_LIMIT} (本小时)`);
}

// ── 修复不可访问链接 ──

async function fixBroken() {
  console.log(DRY_RUN ? '=== DRY RUN 模式（仅检测不替换）===' : '=== 检测 & 替换模式 ===');
  console.log();

  const fileContents = new Map<string, string>();
  for (const f of FILES) {
    fileContents.set(f, readFileSync(f, 'utf-8'));
  }

  const urlsToCheck = new Set<string>();

  // seed-images.ts 中的 Unsplash IDs
  const seedImagesContent = fileContents.get(FILES[0])!;
  const unsplashIds = [...new Set([...seedImagesContent.matchAll(/u\('([^']+)'\)/g)].map((m) => m[1]))];
  console.log(`seed-images.ts: 发现 ${unsplashIds.length} 个唯一 Unsplash ID`);
  for (const id of unsplashIds) urlsToCheck.add(`${UNSPLASH_BASE}${id}${UNSPLASH_SUFFIX}`);

  // seed.ts / seed-prod.ts 中的 CDN 路径
  const allCdnPaths: string[] = [];
  for (const f of FILES.slice(1)) {
    allCdnPaths.push(...extractCdnPaths(fileContents.get(f)!));
  }
  const uniqueCdnPaths = [...new Set(allCdnPaths)];
  console.log(`seed.ts + seed-prod.ts: 发现 ${uniqueCdnPaths.length} 个唯一 CDN 路径`);
  for (const p of uniqueCdnPaths) urlsToCheck.add(`${CDN_BASE}/${p}`);

  console.log(`\n总计需检测 ${urlsToCheck.size} 个唯一 URL\n`);

  console.log('开始检测图片可访问性...');
  const results = await checkUrls([...urlsToCheck]);

  const broken: string[] = [];
  const working: string[] = [];
  for (const [url, ok] of results) {
    (ok ? working : broken).push(url);
  }

  console.log(`\n检测完成: ${working.length} 可用, ${broken.length} 不可用\n`);

  if (broken.length === 0) {
    console.log('所有图片链接均可访问，无需替换!');
    return;
  }

  console.log('不可用的图片:');
  for (const url of broken) console.log(`  ✗ ${url}`);
  console.log();

  if (DRY_RUN) {
    console.log('DRY RUN 结束，未修改任何文件。');
    return;
  }

  // 验证备选图片池
  console.log('验证备选 Unsplash 图片...');
  const fallbackUrls = FALLBACK_UNSPLASH_IDS.map((id) => `${UNSPLASH_BASE}${id}${UNSPLASH_SUFFIX}`);
  const fallbackResults = await checkUrls(fallbackUrls);
  const verifiedFallbackIds = FALLBACK_UNSPLASH_IDS.filter((id) =>
    fallbackResults.get(`${UNSPLASH_BASE}${id}${UNSPLASH_SUFFIX}`)
  );
  console.log(
    verifiedFallbackIds.length === 0
      ? '所有备选图片均不可用，将使用 picsum.photos 作为兜底'
      : `备选池中 ${verifiedFallbackIds.length} 个可用\n`
  );

  const replacements = new Map<string, string>();
  let fbIdx = 0;

  for (const url of broken) {
    if (url.startsWith(UNSPLASH_BASE)) {
      const oldId = url.replace(UNSPLASH_BASE, '').replace(UNSPLASH_SUFFIX, '');
      const newId =
        verifiedFallbackIds.length > 0
          ? verifiedFallbackIds[fbIdx++ % verifiedFallbackIds.length]
          : `PICSUM_${fbIdx++}`;
      replacements.set(oldId, newId);
    } else if (url.startsWith(CDN_BASE)) {
      const oldPath = url.replace(`${CDN_BASE}/`, '');
      const parts = oldPath.split('/');
      const name = parts[parts.length - 2] || parts[0] || 'product';
      const readable = name.replace(/[^a-zA-Z0-9]/g, '+');
      replacements.set(
        oldPath,
        `https://placehold.co/800x800/EEE/999/webp?text=${encodeURIComponent(readable)}&font=roboto`
      );
    }
  }

  console.log('开始替换...\n');
  let totalReplacements = 0;

  for (const [filePath, content] of fileContents) {
    let updated = content;
    let fileReplacements = 0;
    const fileName = filePath.split('/').pop();

    for (const [oldVal, newVal] of replacements) {
      if (filePath.endsWith('seed-images.ts')) {
        if (!oldVal.startsWith('http') && !oldVal.startsWith('PICSUM_')) {
          const oldPattern = `u('${oldVal}')`;
          if (newVal.startsWith('PICSUM_')) {
            const picsumUrl = `https://picsum.photos/800/800?random=${newVal.replace('PICSUM_', '')}`;
            const count = updated.split(oldPattern).length - 1;
            updated = updated.replaceAll(oldPattern, `'${picsumUrl}'`);
            fileReplacements += count;
          } else {
            const count = updated.split(oldPattern).length - 1;
            updated = updated.replaceAll(oldPattern, `u('${newVal}')`);
            fileReplacements += count;
          }
        }
      } else {
        if (oldVal.includes('/') && newVal.startsWith('https://placehold.co')) {
          const oldPattern = `cdnImg('${oldVal}')`;
          const count = updated.split(oldPattern).length - 1;
          updated = updated.replaceAll(oldPattern, `'${newVal}'`);
          fileReplacements += count;
        }
      }
    }

    if (fileReplacements > 0) {
      writeFileSync(filePath, updated, 'utf-8');
      console.log(`  ${fileName}: 替换了 ${fileReplacements} 处`);
      totalReplacements += fileReplacements;
    } else {
      console.log(`  ${fileName}: 无需替换`);
    }
  }

  console.log(`\n完成! 共替换 ${totalReplacements} 处。`);
}

// ── 入口 ──
async function main() {
  if (DEDUP) {
    await dedup();
  } else {
    await fixBroken();
  }
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
