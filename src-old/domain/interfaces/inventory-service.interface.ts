export interface IInventoryService {
  lookupInventory(productName?: string, brandId?: string, category?: string): Promise<any[]>;
}