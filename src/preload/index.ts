/**
 * Preload bridge.
 *
 * The renderer runs with context isolation and no Node integration, so
 * this is the only surface it can reach. Every call is an explicit,
 * typed channel - the renderer never touches the filesystem, the
 * database or the network directly.
 */

import { contextBridge, ipcRenderer } from 'electron'

import { IPC, type EpayApi } from '../shared/ipc'
import type { PolicyIds, ProductEdit } from '../shared/types'

const api: EpayApi = {
  listProducts: () => ipcRenderer.invoke(IPC.listProducts),
  getProduct: (id: number) => ipcRenderer.invoke(IPC.getProduct, id),
  scanBarcode: (code: string) => ipcRenderer.invoke(IPC.scanBarcode, code),
  createFromPhotos: (paths: string[]) => ipcRenderer.invoke(IPC.createFromPhotos, paths),
  updateProduct: (id: number, edit: ProductEdit) => ipcRenderer.invoke(IPC.updateProduct, id, edit),
  addPhotos: (id: number, paths: string[]) => ipcRenderer.invoke(IPC.addPhotos, id, paths),
  enrichProduct: (id: number) => ipcRenderer.invoke(IPC.enrichProduct, id),
  publishProduct: (id: number) => ipcRenderer.invoke(IPC.publishProduct, id),
  publishAllReady: () => ipcRenderer.invoke(IPC.publishAllReady),
  checkProduct: (id: number) => ipcRenderer.invoke(IPC.checkProduct, id),
  pickPhotos: () => ipcRenderer.invoke(IPC.pickPhotos),
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  signIn: () => ipcRenderer.invoke(IPC.signIn),
  getPolicies: () => ipcRenderer.invoke(IPC.getPolicies),
  getPolicyIds: () => ipcRenderer.invoke(IPC.getPolicyIds),
  setPolicyIds: (ids: PolicyIds) => ipcRenderer.invoke(IPC.setPolicyIds, ids),
  runDiagnostics: () => ipcRenderer.invoke(IPC.runDiagnostics),
  runWriteTest: () => ipcRenderer.invoke(IPC.runWriteTest),
  openMarketSearch: (productId: number) => ipcRenderer.invoke(IPC.openMarketSearch, productId),
  onProductsChanged: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC.productsChanged, handler)
    return () => ipcRenderer.removeListener(IPC.productsChanged, handler)
  },
}

contextBridge.exposeInMainWorld('epay', api)
