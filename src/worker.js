import { simulate, sensitivity } from './simulator.js';
self.onmessage = ({ data }) => {
  const { id, action, project, spec } = data;
  try {
    const options = { onProgress: progress => self.postMessage({ id, type: 'progress', progress }) };
    const result = action === 'sensitivity' ? sensitivity(project, spec, options) : simulate(project, options);
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: { message: error.message, code: error.code ?? 'ERROR', details: error.details ?? {} } });
  }
};
