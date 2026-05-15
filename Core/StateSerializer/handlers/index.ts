/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Handler Registry - Registers all mode state handlers on import
 */

import { registerModeHandler } from '../ModeStateHandler';
import { deepthinkStateHandler } from './DeepthinkStateHandler';
import { agenticStateHandler } from './AgenticStateHandler';
import { contextualStateHandler } from './ContextualStateHandler';
import { adaptiveDeepthinkStateHandler } from './AdaptiveDeepthinkStateHandler';
import { websiteModeStateHandler } from './WebsiteModeStateHandler';
import { dynamicComputeStateHandler } from './DynamicComputeStateHandler';

// Auto-register all handlers on module import
registerModeHandler(deepthinkStateHandler);
registerModeHandler(agenticStateHandler);
registerModeHandler(contextualStateHandler);
registerModeHandler(adaptiveDeepthinkStateHandler);
registerModeHandler(websiteModeStateHandler);
registerModeHandler(dynamicComputeStateHandler);
