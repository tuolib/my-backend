/**
 * fix-seed-images.ts
 * 检查 seed.ts / seed-prod.ts / seed-images.ts 中所有图片链接是否可访问，
 * 不可访问的自动替换为可用的备选图片。
 *
 * 用法: bun packages/database/src/fix-seed-images.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ── 配置 ──
const CONCURRENCY = 20; // 并发请求数
const TIMEOUT_MS = 8000; // 单个请求超时
const DRY_RUN = process.argv.includes('--dry-run'); // 仅检测不替换

const DIR = resolve(import.meta.dir);
const FILES = [
  resolve(DIR, 'seed-images.ts'),
  resolve(DIR, 'seed.ts'),
  resolve(DIR, 'seed-prod.ts'),
];

// ── 备选图片池（已验证可访问的 Unsplash ID）──
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
let fallbackIdx = 0;

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
    return resp.ok; // 2xx
  } catch {
    return false;
  }
}

/** 带并发控制的批量检测 */
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

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── 提取 URL ──

/** 从 seed-images.ts 提取 Unsplash photo IDs */
function extractUnsplashIds(content: string): string[] {
  const regex = /u\('([^']+)'\)/g;
  const ids: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

/** 从 seed.ts / seed-prod.ts 提取 cdnImg 路径 */
function extractCdnPaths(content: string): string[] {
  const regex = /cdnImg\('([^']+)'\)/g;
  const paths: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    paths.push(match[1]);
  }
  return [...new Set(paths)];
}

// ── 主流程 ──
async function main() {
  console.log(DRY_RUN ? '=== DRY RUN 模式（仅检测不替换）===' : '=== 检测 & 替换模式 ===');
  console.log();

  // 1) 读取所有文件
  const fileContents = new Map<string, string>();
  for (const f of FILES) {
    fileContents.set(f, readFileSync(f, 'utf-8'));
  }

  // 2) 收集所有需要检测的 URL
  const urlsToCheck = new Set<string>();
  const unsplashBase = 'https://images.unsplash.com/photo-';
  const unsplashSuffix = '?w=800&h=800&fit=crop';
  const cdnBase = 'https://cdn.dummyjson.com/product-images';

  // seed-images.ts 中的 Unsplash IDs
  const seedImagesContent = fileContents.get(FILES[0])!;
  const unsplashIds = extractUnsplashIds(seedImagesContent);
  console.log(`seed-images.ts: 发现 ${unsplashIds.length} 个唯一 Unsplash ID`);
  for (const id of unsplashIds) {
    urlsToCheck.add(`${unsplashBase}${id}${unsplashSuffix}`);
  }

  // seed.ts / seed-prod.ts 中的 CDN 路径
  const allCdnPaths: string[] = [];
  for (const f of FILES.slice(1)) {
    const paths = extractCdnPaths(fileContents.get(f)!);
    allCdnPaths.push(...paths);
  }
  const uniqueCdnPaths = [...new Set(allCdnPaths)];
  console.log(`seed.ts + seed-prod.ts: 发现 ${uniqueCdnPaths.length} 个唯一 CDN 路径`);
  for (const p of uniqueCdnPaths) {
    urlsToCheck.add(`${cdnBase}/${p}`);
  }

  console.log(`\n总计需检测 ${urlsToCheck.size} 个唯一 URL\n`);

  // 3) 批量检测
  console.log('开始检测图片可访问性...');
  const results = await checkUrls([...urlsToCheck]);

  // 4) 统计结果
  const broken: string[] = [];
  const working: string[] = [];
  for (const [url, ok] of results) {
    if (ok) {
      working.push(url);
    } else {
      broken.push(url);
    }
  }

  console.log(`\n检测完成: ${working.length} 可用, ${broken.length} 不可用\n`);

  if (broken.length === 0) {
    console.log('所有图片链接均可访问，无需替换!');
    return;
  }

  // 5) 展示不可用的 URL
  console.log('不可用的图片:');
  for (const url of broken) {
    console.log(`  ✗ ${url}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log('DRY RUN 结束，未修改任何文件。');
    return;
  }

  // 6) 验证备选图片池
  console.log('验证备选 Unsplash 图片...');
  const fallbackUrls = FALLBACK_UNSPLASH_IDS.map(
    (id) => `${unsplashBase}${id}${unsplashSuffix}`
  );
  const fallbackResults = await checkUrls(fallbackUrls);
  const verifiedFallbackIds = FALLBACK_UNSPLASH_IDS.filter((id) =>
    fallbackResults.get(`${unsplashBase}${id}${unsplashSuffix}`)
  );

  if (verifiedFallbackIds.length === 0) {
    console.error('所有备选图片均不可用，将使用 picsum.photos 作为兜底');
  } else {
    console.log(`备选池中 ${verifiedFallbackIds.length} 个可用\n`);
  }

  // 7) 构建替换映射
  const replacements = new Map<string, string>(); // old → new

  for (const url of broken) {
    if (url.startsWith(unsplashBase)) {
      // Unsplash ID 替换
      const oldId = url.replace(unsplashBase, '').replace(unsplashSuffix, '');
      let newId: string;
      if (verifiedFallbackIds.length > 0) {
        newId = verifiedFallbackIds[fallbackIdx % verifiedFallbackIds.length];
        fallbackIdx++;
      } else {
        // 兜底用 picsum
        newId = `PICSUM_${fallbackIdx++}`;
      }
      replacements.set(oldId, newId);
    } else if (url.startsWith(cdnBase)) {
      // CDN 路径替换 — 用 placehold.co 兜底
      const oldPath = url.replace(`${cdnBase}/`, '');
      // 从路径提取一个可读名字
      const parts = oldPath.split('/');
      const name = parts[parts.length - 2] || parts[0] || 'product';
      const readable = name.replace(/[^a-zA-Z0-9]/g, '+');
      const replacement = `https://placehold.co/800x800/EEE/999/webp?text=${encodeURIComponent(readable)}&font=roboto`;
      replacements.set(oldPath, replacement);
    }
  }

  // 8) 执行替换
  console.log('开始替换...\n');
  let totalReplacements = 0;

  for (const [filePath, content] of fileContents) {
    let updated = content;
    let fileReplacements = 0;
    const fileName = filePath.split('/').pop();

    for (const [oldVal, newVal] of replacements) {
      if (filePath.endsWith('seed-images.ts')) {
        // seed-images.ts: 替换 Unsplash ID
        if (!oldVal.startsWith('http') && !oldVal.startsWith('PICSUM_')) {
          const oldPattern = `u('${oldVal}')`;
          if (newVal.startsWith('PICSUM_')) {
            // picsum 兜底: 替换整个 u() 调用为完整 URL
            const picsumUrl = `https://picsum.photos/800/800?random=${newVal.replace('PICSUM_', '')}`;
            const count = updated.split(oldPattern).length - 1;
            updated = updated.replaceAll(oldPattern, `'${picsumUrl}'`);
            fileReplacements += count;
          } else {
            const newPattern = `u('${newVal}')`;
            const count = updated.split(oldPattern).length - 1;
            updated = updated.replaceAll(oldPattern, newPattern);
            fileReplacements += count;
          }
        }
      } else {
        // seed.ts / seed-prod.ts: 替换 CDN 路径
        if (oldVal.startsWith('http') || oldVal.includes('/')) {
          if (newVal.startsWith('https://placehold.co')) {
            // CDN 路径 → placehold.co 完整 URL
            const oldPattern = `cdnImg('${oldVal}')`;
            const count = updated.split(oldPattern).length - 1;
            updated = updated.replaceAll(oldPattern, `'${newVal}'`);
            fileReplacements += count;
          }
        } else {
          // Unsplash ID (不太常见，但 seed.ts 也可能间接引用)
          // 不需要处理，seed.ts 通过 import 引用 seed-images.ts
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

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
