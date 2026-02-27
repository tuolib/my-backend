import { ConflictError, NotFoundError } from "@/shared/types/errors";
import { productRepository } from "@/domain/product/repository";
import type { CreateProductDto, UpdateProductDto, ProductQuery } from "@/domain/product/types";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const productService = {
  async list(query: ProductQuery) {
    const { items, total } = await productRepository.findAll(query);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  },

  async getById(id: string) {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError("Product", id);
    return product;
  },

  async create(dto: CreateProductDto) {
    const slug = toSlug(dto.name);
    const existing = await productRepository.findBySlug(slug);
    if (existing) throw new ConflictError(`Product with slug "${slug}" already exists`);
    return productRepository.create({ ...dto, slug });
  },

  async update(id: string, dto: UpdateProductDto) {
    const product = await productRepository.update(id, dto);
    if (!product) throw new NotFoundError("Product", id);
    return product;
  },

  async delete(id: string) {
    const product = await productRepository.delete(id);
    if (!product) throw new NotFoundError("Product", id);
    return product;
  },
};
