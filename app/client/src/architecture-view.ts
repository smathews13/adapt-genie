import type { AstPillFamily } from './astrolabe-pill';
import type { NodeReport } from './architecture';

export const NODE_FAMILY: Record<NodeReport['tone'], AstPillFamily> = {
  connected: 'pos',
  disconnected: 'neg',
  neutral: 'neutral-outline',
  local: 'neutral-outline',
};
