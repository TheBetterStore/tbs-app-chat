export interface IInventoryService {
  lookupInventory(productName?: string, brandId?: string): Promise<any[]>;
}