import type { EventPipelineInput } from './eventPipeline.orchestrator';
import { eventPipelineOrchestrator } from './eventPipeline.orchestrator';

export const pushEventToBus = async (
  props: EventPipelineInput
): Promise<void> => {
  await eventPipelineOrchestrator(props);
};
