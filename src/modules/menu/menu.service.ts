import { RestaurantRepository, MenuItemRepository } from './menu.repository.ts';
import type { CreateRestaurantInput, CreateMenuItemInput, UpdateMenuItemInput } from './menu.schema.ts';

export const RestaurantService = {
  async list(page: number, pageSize: number) {
    return RestaurantRepository.findPaginated(page, pageSize);
  },

  async create(data: CreateRestaurantInput) {
    return RestaurantRepository.create(data);
  },
};

export const MenuItemService = {
  async list(restaurantId: number, page: number, pageSize: number) {
    return MenuItemRepository.findByRestaurant(restaurantId, page, pageSize);
  },

  async create(data: CreateMenuItemInput) {
    const restaurant = await RestaurantRepository.findById(data.restaurantId);
    if (!restaurant || !restaurant.isActive) {
      throw new Error('饭店不存在或已停业');
    }
    return MenuItemRepository.create(data);
  },

  async update(data: UpdateMenuItemInput) {
    const { id, ...rest } = data;
    const item = await MenuItemRepository.findById(id);
    if (!item) throw new Error('菜品不存在');
    return MenuItemRepository.update(id, rest);
  },

  async delete(id: number) {
    const item = await MenuItemRepository.findById(id);
    if (!item) throw new Error('菜品不存在');
    return MenuItemRepository.delete(id);
  },
};
