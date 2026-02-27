import { Hono } from "hono";
import { productService } from "./service";
import { createProductDto, updateProductDto, productQueryDto } from "./types";
import { ok } from "../../shared/types/response";

const productRoutes = new Hono();

productRoutes.get("/", async (c) => {
  const query = productQueryDto.parse(c.req.query());
  const result = await productService.list(query);
  return c.json(ok(result.items, { pagination: result.pagination }));
});

productRoutes.get("/:id", async (c) => {
  const product = await productService.getById(c.req.param("id"));
  return c.json(ok(product));
});

productRoutes.post("/", async (c) => {
  const body = createProductDto.parse(await c.req.json());
  const product = await productService.create(body);
  return c.json(ok(product), 201);
});

productRoutes.put("/:id", async (c) => {
  const body = updateProductDto.parse(await c.req.json());
  const product = await productService.update(c.req.param("id"), body);
  return c.json(ok(product));
});

productRoutes.delete("/:id", async (c) => {
  await productService.delete(c.req.param("id"));
  return c.json(ok(null), 200);
});

export { productRoutes };
