/**
 * Dashboard Zod 校验 Schema
 */
import { z } from 'zod';

export const orderStatsSchema = z.object({
  range: z.enum(['day', 'week', 'month']).default('day'),
  days: z.number().int().min(1).max(90).default(7),
});

export const salesStatsSchema = z.object({
  range: z.enum(['day', 'week', 'month']).default('day'),
  days: z.number().int().min(1).max(90).default(7),
});
