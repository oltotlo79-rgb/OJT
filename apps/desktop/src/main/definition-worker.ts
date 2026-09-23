import { parentPort } from 'node:worker_threads';
import { validateDefinition } from '@ojt/content';

parentPort?.once('message', (definition: unknown) => {
  try {
    parentPort?.postMessage(validateDefinition(definition));
  } catch (error) {
    parentPort?.postMessage({
      id: undefined,
      note: '',
      reasons: [`検証を続行できません：${String(error)}`],
    });
  }
});
