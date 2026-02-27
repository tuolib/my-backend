import { Hono } from 'hono';
import { productService } from '@/domain/product/service';
import { createProductDto, updateProductDto, productQueryDto } from '@/domain/product/types';
import { ApiResult } from '@/shared/types/response';

const productRoutes = new Hono();

productRoutes.get('/', async (c) => {
  const query = productQueryDto.parse(c.req.query());
  const result = await productService.list(query);
  // return c.json(ok(result.items, { pagination: result.pagination }));
  return ApiResult.success(c, { items: result.items, pagination: result.pagination });
});

productRoutes.get('/:id', async (c) => {
  const product = await productService.getById(c.req.param('id'));
  // return c.json(ok(product));
  return ApiResult.success(c, product);
});

productRoutes.post('/', async (c) => {
  const body = createProductDto.parse(await c.req.json());
  const product = await productService.create(body);
  // return c.json(ok(product), 201);
  return ApiResult.success(c, product);
});

productRoutes.put('/:id', async (c) => {
  const body = updateProductDto.parse(await c.req.json());
  const product = await productService.update(c.req.param('id'), body);
  // return c.json(ok(product));
  return ApiResult.success(c, product);
});

productRoutes.delete('/:id', async (c) => {
  await productService.delete(c.req.param('id'));
  // return c.json(ok(null), 200);
  return ApiResult.success(c);
});

export { productRoutes };
