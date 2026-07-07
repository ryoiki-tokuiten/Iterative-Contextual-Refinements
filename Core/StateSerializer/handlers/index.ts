/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Handler Registry - Registers all mode state handlers on import
 */

import { registerModeHandler } from '../ModeStateHandler';
import { deepthinkStateHandler } from './DeepthinkStateHandler';
import { contextualStateHandler } from './ContextualStateHandler';
import { adaptiveDeepthinkStateHandler } from './AdaptiveDeepthinkStateHandler';

// Auto-register all handlers on module import
registerModeHandler(deepthinkStateHandler);
registerModeHandler(contextualStateHandler);
registerModeHandler(adaptiveDeepthinkStateHandler);
