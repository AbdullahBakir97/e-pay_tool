/** IPC channel names and the typed API the preload bridge exposes. */

import type {
  AppStatus,
  CheckResult,
  Issue,
  PolicyIds,
  PolicyOptions,
  Product,
  ProductEdit,
} from './types'

export const IPC = {
  listProducts: 'products:list',
  getProduct: 'products:get',
  scanBarcode: 'products:scan',
  createFromPhotos: 'products:createFromPhotos',
  updateProduct: 'products:update',
  addPhotos: 'products:addPhotos',
  enrichProduct: 'products:enrich',
  publishProduct: 'products:publish',
  publishAllReady: 'products:publishAllReady',
  checkProduct: 'products:check',
  pickPhotos: 'dialog:pickPhotos',
  getStatus: 'app:status',
  signIn: 'app:signIn',
  getPolicies: 'policies:list',
  getPolicyIds: 'policies:getSelected',
  setPolicyIds: 'policies:setSelected',
  productsChanged: 'products:changed',
  runDiagnostics: 'diagnostics:run',
  runWriteTest: 'diagnostics:writeTest',
  openMarketSearch: 'market:openSearch',
} as const

export interface EpayApi {
  listProducts(): Promise<Product[]>
  getProduct(id: number): Promise<Product | null>
  scanBarcode(code: string): Promise<number>
  createFromPhotos(paths: string[]): Promise<number>
  updateProduct(id: number, edit: ProductEdit): Promise<void>
  addPhotos(id: number, paths: string[]): Promise<void>
  enrichProduct(id: number): Promise<void>
  publishProduct(id: number): Promise<void>
  publishAllReady(): Promise<number>
  checkProduct(id: number): Promise<Issue[]>
  pickPhotos(): Promise<string[]>
  getStatus(): Promise<AppStatus>
  signIn(): Promise<void>
  getPolicies(): Promise<PolicyOptions>
  getPolicyIds(): Promise<PolicyIds>
  setPolicyIds(ids: PolicyIds): Promise<void>
  runDiagnostics(): Promise<CheckResult[]>
  runWriteTest(): Promise<CheckResult[]>
  /** Opens a pre-filled eBay sold-listings search in the real browser. */
  openMarketSearch(productId: number): Promise<boolean>
  onProductsChanged(listener: () => void): () => void
}
