import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  listRestaurantSchema,
  createRestaurantSchema,
  listMenuItemSchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  deleteMenuItemSchema,
} from './menu.schema.ts';
import { RestaurantService, MenuItemService } from './menu.service.ts';
import { ApiResult, onZodError } from '@/utils/response.ts';

const menuRoute = new Hono();

// POST /api/v1/menu/restaurant/list — 查询饭店列表
menuRoute.post(
  '/restaurant/list',
  zValidator('json', listRestaurantSchema, onZodError),
  async (c) => {
    const { page, pageSize } = c.req.valid('json');
    const data = await RestaurantService.list(page, pageSize);
    return ApiResult.success(c, data);
  }
);

// POST /api/v1/menu/restaurant/create — 新建饭店
menuRoute.post(
  '/restaurant/create',
  zValidator('json', createRestaurantSchema, onZodError),
  async (c) => {
    const data = await RestaurantService.create(c.req.valid('json'));
    return ApiResult.success(c, data, '饭店创建成功');
  }
);

// POST /api/v1/menu/list — 查询菜单（按饭店）
menuRoute.post('/list', zValidator('json', listMenuItemSchema, onZodError), async (c) => {
  const { restaurantId, page, pageSize } = c.req.valid('json');
  const data = await MenuItemService.list(restaurantId, page, pageSize);
  return ApiResult.success(c, data);
});

// POST /api/v1/menu/create — 新建菜品
menuRoute.post(
  '/create',
  zValidator('json', createMenuItemSchema, onZodError),
  async (c) => {
    try {
      const data = await MenuItemService.create(c.req.valid('json'));
      return ApiResult.success(c, data, '菜品创建成功');
    } catch (e: any) {
      return ApiResult.error(c, e.message, 400);
    }
  }
);

// POST /api/v1/menu/update — 更新菜品
menuRoute.post(
  '/update',
  zValidator('json', updateMenuItemSchema, onZodError),
  async (c) => {
    try {
      const data = await MenuItemService.update(c.req.valid('json'));
      return ApiResult.success(c, data, '菜品更新成功');
    } catch (e: any) {
      return ApiResult.error(c, e.message, 400);
    }
  }
);

// POST /api/v1/menu/delete — 删除菜品
menuRoute.post(
  '/delete',
  zValidator('json', deleteMenuItemSchema, onZodError),
  async (c) => {
    try {
      const data = await MenuItemService.delete(c.req.valid('json').id);
      return ApiResult.success(c, data, '菜品删除成功');
    } catch (e: any) {
      return ApiResult.error(c, e.message, 400);
    }
  }
);

export { menuRoute };
