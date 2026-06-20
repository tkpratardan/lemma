// Shapes from the Jupyter Server REST API (/api/sessions, /api/kernels) that
// this codebase actually reads. Both adapters/jupyterlab/discovery.ts and
// adapters/kernel-http/client.ts hit the same /api/sessions endpoint and were
// each typing it `any[]` independently — one real shape, not two `any`s.
export interface JupyterKernelModel {
  id: string;
  name: string;
  last_activity?: string;
}

export interface JupyterSession {
  type?: string;
  path?: string;
  notebook?: { path?: string };
  kernel: JupyterKernelModel;
}
